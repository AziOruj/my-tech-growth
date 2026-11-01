# Resilience və Fault Tolerance LLM Sistemlərində: Spring AI və Resilience4j

**Tarix:** 2026-11-01 · **Kateqoriya:** Resilience & Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır) · Resilience4j 2.3.x (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM API-ləri ənənəvi REST servislərə nisbətən qat-qat qeyri-sabitdir: qəfil gecikmələr (latency spikes), HTTP 429 (Rate Limit / Quota Exceeded), regional kəsintilər və 503 xətaları tez-tez baş verir. Əgər backend arxitekturanız tək bir model provayderinə (məsələn, yalnız OpenAI) birbaşa bağlıdırsa, ilk kəsintidə bütün sisteminiz dayanacaq və istifadəçi sorğuları cavabsız qalacaq. Tech Lead olaraq vəzifəniz provayder qəzalarından tam təcrid olunmuş, Circuit Breaker ilə qorunan və avtomatik olaraq ehtiyat modellərə (Fallback Model: OpenAI → Anthropic → Lokal Ollama) keçid edən dayanıqlı (fault-tolerant) LLM şlüzü qurmaqdır.

---

## Əsas anlayışlar

1. **LLM Circuit Breaker:** Uğursuz sorğuların (timeout, 5xx xətaları) nisbəti müəyyən həddi (threshold) keçdikdə dövrəni açır (`OPEN` statusu), əsas LLM-ə izafi sorğuların getməsinin qarşısını alır və dərhal fallback mexanizmini işə salır.
2. **Multi-Provider Fallback:** Əsas model (məsələn, `gpt-4o`) xəta verdikdə və ya gecikdikdə sistemin dinamik olaraq alternativ provayderə (məsələn, `claude-3-5-sonnet` və ya daxili host edilən `ollama/qwen2.5`) yönləndirilməsi.
3. **Adaptive Rate Limiter & Concurrency Limiter:** Provayderin TPM (Tokens Per Minute) və ya RPM (Requests Per Minute) kvotasını aşmamaq üçün çıxan sorğuları buferləyən və eyni vaxtda icra olunan LLM çağırışlarının sayını məhdudlaşdıran qoruyucu filtr.
4. **Exponential Backoff & Retry:** Şəbəkənin ani titrəmələri və ya müvəqqəti 429 (Too Many Requests) xətalarında sorğunu eksponensial artan fasilələrlə (məsələn: 500ms, 1500ms, 4500ms) yenidən cəhd etmək.

---

## Kod nümunəsi: Resilience4j ilə Multi-Model Fallback Servisi

Aşağıdakı nümunədə Spring Boot 4.x və Spring AI mühitində əsas model sıradan çıxdıqda ehtiyat modelə keçən və Circuit Breaker ilə idarə olunan resilient servis nümayiş etdirilir.

### 1. Maven Asılılıqları

```xml
<dependencies>
    <!-- Spring AI Provayderləri -->
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-openai-spring-boot-starter</artifactId>
        <version>2.0.0</version> <!-- yoxlanılmalıdır -->
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-anthropic-spring-boot-starter</artifactId>
        <version>2.0.0</version> <!-- yoxlanılmalıdır -->
    </dependency>

    <!-- Resilience4j Spring Boot Starter -->
    <dependency>
        <groupId>io.github.resilience4j</groupId>
        <artifactId>resilience4j-spring-boot3</artifactId>
        <version>2.3.0</version> <!-- yoxlanılmalıdır -->
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-aop</artifactId>
    </dependency>
</dependencies>
```

### 2. Konfiqurasiya (`application.yml`)

```yaml
resilience4j:
  circuitbreaker:
    instances:
      llmService:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 10
        minimum-number-of-calls: 5
        failure-rate-threshold: 50
        slow-call-rate-threshold: 70
        slow-call-duration-threshold: 5s
        wait-duration-in-open-state: 20s
        permitted-number-of-calls-in-half-open-state: 3
        record-exceptions:
          - org.springframework.web.client.RestClientResponseException
          - java.util.concurrent.TimeoutException
          - java.io.IOException
  ratelimiter:
    instances:
      llmService:
        limit-for-period: 50 # Dəqiqədə 50 sorğu
        limit-refresh-period: 60s
        timeout-duration: 2s
```

### 3. Çoxprovayderli ChatClient Konfiqurasiyası

```java
package com.company.ai.resilience.config;

import org.springframework.ai.anthropic.AnthropicChatModel;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

@Configuration
public class MultiProviderAiConfig {

    @Bean
    @Primary
    @Qualifier("primaryChatClient")
    public ChatClient primaryChatClient(OpenAiChatModel openAiChatModel) {
        return ChatClient.builder(openAiChatModel)
                .defaultSystem("Sən operativ və dəqiq müştəri dəstəyi köməkçisisən.")
                .build();
    }

    @Bean
    @Qualifier("fallbackChatClient")
    public ChatClient fallbackChatClient(AnthropicChatModel anthropicChatModel) {
        return ChatClient.builder(anthropicChatModel)
                .defaultSystem("Sən operativ və dəqiq müştəri dəstəyi köməkçisisən.")
                .build();
    }
}
```

### 4. Circuit Breaker və Fallback ilə İdarə Olunan Biznes Servisi

```java
package com.company.ai.resilience.service;

import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import io.github.resilience4j.ratelimiter.annotation.RateLimiter;
import io.github.resilience4j.retry.annotation.Retry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class ResilientCustomerSupportService {

    private static final Logger log = LoggerFactory.getLogger(ResilientCustomerSupportService.class);

    private final ChatClient primaryChatClient;
    private final ChatClient fallbackChatClient;

    public ResilientCustomerSupportService(
            @Qualifier("primaryChatClient") ChatClient primaryChatClient,
            @Qualifier("fallbackChatClient") ChatClient fallbackChatClient) {
        this.primaryChatClient = primaryChatClient;
        this.fallbackChatClient = fallbackChatClient;
    }

    @CircuitBreaker(name = "llmService", fallbackMethod = "executeFallbackModel")
    @RateLimiter(name = "llmService")
    public String generateSupportResponse(String userPrompt) {
        log.info("Əsas model (OpenAI) çağırılır...");
        return primaryChatClient.prompt()
                .user(userPrompt)
                .call()
                .content();
    }

    /**
     * Əsas modeldə xəta baş verdikdə (Circuit Breaker OPEN və ya Exception zamanı)
     * avtomatik icra olunan fallback metod.
     */
    public String executeFallbackModel(String userPrompt, Throwable throwable) {
        log.warn("Əsas model çağırışında xəta baş verdi! Səbəb: {}. Fallback modelə (Anthropic) keçilir...", 
                throwable.getMessage());

        try {
            return fallbackChatClient.prompt()
                    .user(userPrompt)
                    .call()
                    .content();
        } catch (Exception ex) {
            log.error("Hər iki model provayderi sıradan çıxdı!", ex);
            // Graceful degradation: statik və ya keşilmiş biznes cavabı
            return "Hörmətli müştəri, hazırda xidmətimizdə texniki yenilənmə gedir. " +
                   "Zəhmət olmasa bir neçə dəqiqə sonra yenidən cəhd edin və ya dəstək xətti ilə əlaqə saxlayın.";
        }
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

```
                      +-----------------------------+
                      |       Müştəri Sorğusu       |
                      +-----------------------------+
                                     |
                                     v
                       [ Resilience4j Rate Limiter ]
                                     |
                                     v
                      [ Resilience4j Circuit Breaker ]
                       /                            \
           (Normal / CLOSED)                    (Xəta / OPEN)
                     /                                \
                    v                                  v
    +-------------------------------+  Fallback  +-------------------------------+
    |  Primary Provider (OpenAI)   | -------->  | Fallback Provider (Anthropic) |
    +-------------------------------+            +-------------------------------+
                                                               |
                                                          (Hər ikisi uğursuz)
                                                               v
                                                 +-------------------------------+
                                                 |   Graceful Degradation        |
                                                 |   (Statik mesaj / Keş)        |
                                                 +-------------------------------+
```

- **Qərar:** Çoxprovayderli (Multi-Vendor) arxitekturadan istifadə.
  - *Müsbət cəhət:* Vendor lock-in aradan qalxır; 99.99% sistem əlçatanlığı təmin olunur.
  - *Mənfi cəhət (Trade-off):* Prompt fərqlilikləri. GPT-4o üçün optimallaşdırılmış prompt Claude 3.5 və ya Llama modelində bir qədər fərqli nəticə verə bilər. Həmçinin hər iki provayder üçün təhlükəsizlik açarları və müqavilələr idarə edilməlidir.
- **Qərar:** Retry yerinə birbaşa Circuit Breaker + Fallback prioriteti.
  - *Müsbət cəhət:* LLM çağırışları təbii olaraq yavaşdır (1–5 saniyə). Təkrar cəhdlər (Retry) istifadəçinin gözləmə vaxtını 15-20 saniyəyə çatdırıb HTTP worker thread-ləri tükəndirə bilər. Əvəzində 1 cəhddən sonra dərhal alternativ modelə keçmək latency-ni qoruyur.
  - *Mənfi cəhət:* Ani lokal şəbəkə itkisində əsas model lüzumsuz yerə fallback-ə keçə bilər (bunun qarşısını almaq üçün `minimum-number-of-calls` düzgün tənzimlənməlidir).

---

## Production məsələləri

1. **Xərc və Qiymət Nəzarəti (Cost Explosion):**
   - Fallback modeli seçərkən diqqətli olun. Əsas model ucuz (`gpt-4o-mini`), ehtiyat model isə bahalı (`claude-3-opus`) olarsa, əsas provayderdən gələn 429 xətaları zamanı bütün trafik bahalı modelə axıb büdcənizi qısa müddətdə tükədə bilər. Fallback həmişə bərabər və ya daha ucuz model olmalıdır.
2. **Context Window və Token Limitləri:**
   - Ehtiyat modelin kontekst pəncərəsi (context window) ən azı əsas model qədər böyük olmalıdır. Əks halda böyük RAG sorğuları fallback zamanı `ContextWindowExceededException` xətası verəcək.
3. **OpenTelemetry və Alerting:**
   - Circuit Breaker `OPEN` vəziyyətinə keçdikdə dərhal DevOps komandasına PagerDuty/Slack xəbərdarlığı getməlidir. Micrometer vasitəsilə `resilience4j.circuitbreaker.state` metriki mütləq dashboard-a çıxarılmalıdır.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün addımlar)

1. **Vahid "ResilientChatClient" Wrapper Komponenti Hazırlayın:**
   - Komanda üzvlərinin hər yerdə ayrı-ayrılıqda `@CircuitBreaker` yazmaması üçün bu mexanizmi `ChatClient` səviyyəsində Advisor və ya dekorator kimi inkapsulyasiya edin.
2. **Chaos Testing (Xaos Testləri) Tətbiq Edin:**
   - Staging mühitində OpenAI açarını qəsdən yanlış təyin edin və ya WireMock ilə HTTP 500 qaytarın. Sistemin heç bir istifadəçi sorğusunu itirmədən Anthropic və ya Ollama-ya keçdiyini test edin.
3. **Structured Output Fallback Uyğunluğu:**
   - Əgər `entity(OrderDto.class)` kimi struktur çıxış istifadə edirsinizsə, hər iki modelin həmin JSON sxemini eyni dəqiqliklə çıxara bildiyini inteqrasiya testləri ilə təsdiqləyin.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Layihənizə `resilience4j-spring-boot3` və `spring-boot-starter-aop` əlavə edin.
2. İki ChatClient konfiqurasiya edin: biri əsas model (məs: OpenAI və ya uzaq server), digəri isə lokal Ollama (`ollamaChatModel`).
3. Əsas modelin endpoint-ini saxta bir URL ilə sıradan çıxarın və sorğunun xətasız şəkildə lokal Ollama modelinə yönləndiyini loglarda müşahidə edin.

---

## Mənbələr

- Resilience4j Official Documentation: https://resilience4j.readme.io/docs (yoxlanılmalıdır)
- Spring AI ChatClient Reference: https://docs.spring.io/spring-ai/reference/api/chatclient.html (yoxlanılmalıdır)
- OpenAI Rate Limits and Error Codes: https://platform.openai.com/docs/guides/rate-limits (yoxlanılmalıdır)
- Resilience4j Spring Boot Metrics & Monitoring: https://resilience4j.readme.io/docs/micrometer (yoxlanılmalıdır)
