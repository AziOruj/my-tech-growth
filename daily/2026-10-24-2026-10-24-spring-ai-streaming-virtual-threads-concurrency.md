# Spring AI Streaming və Virtual Threads ilə High-Throughput LLM Sistemləri

**Tarix:** 2026-10-24 · **Kateqoriya:** Performance & Concurrency · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır)

---

## Niyə vacibdir

Ənənəvi REST API-lər adətən 50-200 ms ərzində cavab qaytarır, lakin LLM çağırışları (xüsusilə böyük kontekst və reasoning modelləri ilə) 3-30 saniyəyə qədər bloklayıcı I/O gözləməsi yaradır. Ənənəvi OS-thread-per-request modeli bu miqyasda thread pool-un dərhal tükənməsinə və throughput-un çökməsinə səbəb olur. Tech Lead olaraq bilməlisiniz ki, **Java 21 Virtual Threads** platform thread resurslarını qoruyur, **Streaming (Server-Sent Events - SSE və ya Project Reactor Flux)** isə istifadəçinin Time-To-First-Token (TTFT) göstəricisini saniyələrdən millisaniyələrə endirərək qavranılan gecikməni (perceived latency) kəskin azaldır.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **Time-To-First-Token (TTFT)** | Sorğu göndərildikdən sonra LLM-dən ilk tokenin çatmasına qədər keçən vaxt. İstifadəçi təcrübəsi üçün ən kritik metrikadır. |
| **Virtual Threads (Project Loom)** | JVM səviyyəsində idarə olunan yüngül thread-lər. LLM-in 10 saniyəlik bloklayıcı HTTP çağırışında OS thread-ini bloklamır, daşıyıcı (carrier) thread-i azad edir. |
| **Reactive Streaming (`Flux<String>`)** | Spring AI-da `chatClient.prompt().stream().content()` vasitəsilə cavabın bütöv deyil, token-token axın şəklində qəbul edilməsi. |
| **Server-Sent Events (SSE)** | HTTP bağlantısı vasitəsilə brauzerə və ya frontend müştəriyə biristiqamətli real-time stream göndərən standart protokol (`text/event-stream`). |

---

## Kod nümunəsi: Virtual Threads + SSE Streaming Controller

Aşağıdakı nümunədə Spring Boot 4.x üzərində virtual thread-ləri aktiv edirik və `ChatClient.stream()` mexanizmi ilə token axınını Server-Sent Events kimi ötürürük.

### 1. `application.yml` konfiqurasiyası

Virtual thread-ləri bütün Tomcat və asinxron icraçılar üçün qlobal şəkildə aktivləşdiririk:

```yaml
spring:
  threads:
    virtual:
      enabled: true
  ai:
    openai:
      api-key: ${OPENAI_API_KEY}
      chat:
        options:
          model: gpt-4o-mini
          temperature: 0.7
```

### 2. Streaming REST Controller

Spring AI 2.0 `ChatClient` həm bloklayıcı `.call()`, həm də reaktiv `.stream()` API-sini təmin edir.

```java
package az.example.ai.streaming;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.time.Duration;

@RestController
@RequestMapping("/api/v1/stream")
public class AiStreamingController {

    private static final Logger log = LoggerFactory.getLogger(AiStreamingController.class);
    private final ChatClient chatClient;

    public AiStreamingController(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * Tokenləri Server-Sent Events (text/event-stream) vasitəsilə müştəriyə çatdırır.
     */
    @GetMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamChat(@RequestParam("prompt") String prompt) {
        log.info("Sorğu qəbul edildi. Cari thread: {}, Virtual: {}", 
                Thread.currentThread().getName(), 
                Thread.currentThread().isVirtual());

        return this.chatClient.prompt()
                .user(prompt)
                .stream()
                .content()
                .map(token -> ServerSentEvent.<String>builder()
                        .data(token)
                        .event("message")
                        .build())
                .timeout(Duration.ofSeconds(60))
                .doOnError(e -> log.error("Streaming zamanı xəta: ", e))
                .onErrorResume(e -> Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("error")
                                .data("Xəta baş verdi: " + e.getMessage())
                                .build()
                ));
    }
}
```

### 3. Virtual Threads ilə Parallel Batch LLM Processing

Bəzən eyni anda yüzlərlə sənədi analiz etmək lazımdır. Virtual thread-lərlə bunu ənənəvi bloklayıcı tərzdə, amma inanılmaz miqyasda idarə edə bilərik:

```java
package az.example.ai.streaming;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.concurrent.StructuredTaskScope;

@Service
public class DocumentSummarizerService {

    private final ChatClient chatClient;

    public DocumentSummarizerService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * Java 21 Structured Concurrency istifadə edərək 100-lərlə mətni paralel xülasə edir.
     */
    public List<String> summarizeBatchConcurrently(List<String> documents) {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            List<StructuredTaskScope.Subtask<String>> tasks = documents.stream()
                    .map(doc -> scope.fork(() -> 
                        this.chatClient.prompt()
                                .user("Aşağıdakı mətni 1 cümlə ilə xülasə et:\n" + doc)
                                .call()
                                .content()
                    ))
                    .toList();

            scope.join();           // Bütün virtual thread-lərin bitməsini gözləyirik
            scope.throwIfFailed();  // Hər hansı xəta olarsa dərhal throw edirik

            return tasks.stream()
                    .map(StructuredTaskScope.Subtask::get)
                    .toList();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Proses kəsildi", e);
        } catch (Exception e) {
            throw new RuntimeException("Batch xülasə zamanı xəta", e);
        }
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **Virtual Threads vs WebFlux (Fully Reactive):**
   - **Virtual Threads (`spring.threads.virtual.enabled=true`):** Standart Spring MVC (Tomcat) üzərində işləyir. Kod sadə, oxunaqlı və imperativ qalır (`ThreadLocal`, Spring Security konteksti itmir).
   - **WebFlux (Netty):** Əgər frontend-ə `Flux<ServerSentEvent>` ötürürsünüzsə, Spring MVC də bunu dəstəkləyir (Tomcat asinxron Servlet mexanizmi ilə). Sistem boyu WebFlux-a keçməyə ehtiyac yoxdur; yalnız streaming endpoint-lərdə `Flux` qaytarmaq kifayətdir.

2. **Structured Concurrency (Java 21 JEP 453) Üstünlüyü:**
   - LLM sorğularında `CompletableFuture.allOf()` yerinə `StructuredTaskScope` istifadə etdikdə, əgər sorğulardan biri xəta verərsə və ya vaxt aşımına (timeout) uğrayarsa, digər alt tapşırıqlar (subtasks) avtomatik `cancel` edilir. Bu, LLM xərclərinin boşuna getməsinin qarşısını alır.

3. **Client Disconnect Problemi:**
   - İstifadəçi səhifəni bağlayarsa (və ya bağlantı kəsilərsə), streaming sorğusu LLM provayderinə qarşı dayandırılmalıdır. Əks halda arxa planda LLM hələ də token hasil edəcək və bu sizin büdcənizi azaldacaq. Reaktiv axında `doOnCancel()` vasitəsilə LLM HTTP bağlantısını bağlamaq lazımdır.

---

## Production məsələləri

- **Reverse Proxy (Nginx / Cloudflare) Buffering:** Production-da ən çox rast gəlinən səhv: Nginx və ya Ingress Controller cavabları buferləyir (`proxy_buffering on;`). Nəticədə SSE streaming işləmir və istifadəçi bütün cavab bitənə qədər gözləməli olur. Nginx konfiqurasiyasında `proxy_buffering off;` və `X-Accel-Buffering: no` başlıqları təmin edilməlidir.
- **Rate Limiting & Connection Pooling:** Virtual Threads sayəsində eyni anda 10 000 paralel LLM çağırışı başlada bilərsiniz, lakin OpenAI/Anthropic/yerli modelin API rate limit-ləri (RPM/TPM) və HTTP Connection Pool (məsələn, HttpClient `maxConnectionsPerRoute`) tez bir zamanda tükənəcək. Virtual thread-ləri `Semaphore` və ya `Bucket4j` ilə məhdudlaşdırın.
- **Monitoring (Stream Metrics):** SSE bağlantılarının uzun müddət açıq qalması Tomcat aktiv bağlantı sayını artırır. Micrometer ilə `http.server.requests` metrikasında `duration` və aktiv streaming sayını xüsusi izləyin.

---

## Komandaya necə tətbiq etmək

1. **Giriş qaydası:** Bütün generativ cavab verən UI funksiyaları (çat, köməkçi, kod analizi) üçün streaming-i standart qəbul edin. İstifadəçilərə 15 saniyəlik boş spinner göstərmək UX anti-patternidir.
2. **Virtual Thread yoxlaması:** Kod bazasında `synchronized` bloklarının (carrier thread pinning yarada bilən köhnə kitabxanaların) olub-olmadığını `-Djdk.tracePinnedThreads=full` parametri ilə test mühitində yoxlayın.
3. **Timeout standartı:** Hər bir streaming axını üçün həm ümumi timeout (məs: 60 saniyə), həm də `idle timeout` (iki token arasında maksimum 10 saniyə fasilə) təyin edin.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Mövcud Spring Boot layihənizdə `application.yml` faylında `spring.threads.virtual.enabled: true` aktiv edin.
2. Yuxarıdakı `AiStreamingController` sinfini yaradın.
3. Terminaldan `curl` vasitəsilə streaming-i test edin:
   ```bash
   curl -N -X GET "http://localhost:8080/api/v1/stream/chat?prompt=Tell%20me%20a%20long%20story%20about%20a%20Java%20developer"
   ```
4. Cavabın bloklanmadan, token-token axaraq necə gəldiyini və terminalda hər bir event-i dərhal müşahidə edin.
5. Konsolda `Thread.currentThread().isVirtual()` çıxışının `true` olduğunu təsdiqləyin.

---

## Mənbələr

- Spring AI Streaming Documentation (yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/chatclient.html#_streaming_responses
- Spring Boot Virtual Threads Guide (yoxlanılmalıdır): https://docs.spring.io/spring-boot/reference/features/spring-application.html#features.spring-application.virtual-threads
- OpenJDK JEP 444: Virtual Threads: https://openjdk.org/jeps/444
- OpenJDK JEP 453: Structured Concurrency (Preview): https://openjdk.org/jeps/453
