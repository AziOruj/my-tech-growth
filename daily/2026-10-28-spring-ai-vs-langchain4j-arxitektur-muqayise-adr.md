# Spring AI vs LangChain4j: Arxitektur Müqayisə və Seçim Matrisi (ADR)

**Tarix:** 2026-10-28 · **Kateqoriya:** Arxitektura / Framework Seçimi · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır) · LangChain4j 1.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Müasir Java ekosistemində AI tətbiqləri qurarkən Tech Lead olaraq veriləcək ən kritik strateji qərar framework seçimidir: **Spring AI**, yoxsa **LangChain4j**? Hər iki layihə yetkin mərhələyə çatsa da, fəlsəfələri, API dizaynları və komanda vərdişlərinə uyğunluğu kəskin şəkildə fərqlənir. Yanlış seçim arxitektur borca (technical debt), vendor lock-in riskinə və komandanın öyrənmə əyrisinin (learning curve) uzanmasına səbəb ola bilər.

---

## Əsas anlayışlar və Konseptual Fərqlər

| Meyar | Spring AI | LangChain4j |
|---|---|---|
| **Dizayn Fəlsəfəsi** | *Spring-idiomatic*: `RestClient`, `ChatClient` fluent API, `Advisor` zəncirləri və konvensiyalara əsaslanan Spring Boot inteqrasiyası. | *Declarative & Java-first*: Python LangChain ideyalarını saf Java tipləri ilə birləşdirən `@AiService` və annotasiya yönümlü deklarativ arxitektura. |
| **Framework Asılılığı** | Yalnız Spring ekosistemi (Spring Boot starter-lər, Spring Data konvensiyaları). | Framework-agnostic: Saf Java (SE), Quarkus, Micronaut və Spring Boot dəstəyi. |
| **RAG İmkanları** | `VectorStore`, sadə ETL pipeline-lar, Advisor interceptor-ları. | Qabaqcıl `ContentRetriever`, dinamik metadata filtering, daxili re-ranking və query transformation mexanizmləri. |
| **Tool Calling** | `java.util.function.Function` Bean-ləri və Spring Advisor-ları. | Sadə `@Tool` annotasiyası, dynamic discovery və avtomatik Javadoc/reflection parsing. |
| **Streaming & Reactive** | Project Reactor (`Flux<String>`) və Java 21 Virtual Threads ilə dərin inteqrasiya. | `StreamingResponseHandler` callback-ləri və asinxron modellər. |
| **Observability** | Spring Boot Actuator, Micrometer və OpenTelemetry ilə qutudan çıxan (out-of-the-box) metrikalar. | Xüsusi OpenTelemetry interceptor modulları və daxili listener-lər. |

---

## Arxitektur Nümunə: Eyni Tapşırıq, İki Yanaşma

Müştəri sorğusunu emal edən və sifariş statusunu yoxlayan AI komponentinin müqayisəsi:

### 1. Spring AI Yanaşması (Imperativ / Fluent)

```java
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class SpringAiCustomerService {

    private final ChatClient chatClient;

    public SpringAiCustomerService(ChatClient.Builder builder) {
        this.chatClient = builder
                .defaultSystem("Sən müştəri xidmətləri köməkçisisən.")
                .build();
    }

    public String handleInquiry(String userMessage) {
        return chatClient.prompt()
                .user(userMessage)
                .functions("orderStatusFunction") // Bean olaraq qeydiyyatdan keçmiş Function
                .call()
                .content();
    }
}
```

### 2. LangChain4j Yanaşması (Deklarativ / Interface-Driven)

```java
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.spring.AiService;
import org.springframework.stereotype.Component;

@AiService // LangChain4j runtime zamanı proxy interface yaradır
public interface LangChainCustomerAssistant {

    @SystemMessage("Sən müştəri xidmətləri köməkçisisən.")
    String handleInquiry(String userMessage);
}

// Tool ayrıca komponent olaraq verilir və avtomatik bağlanır
@Component
public class OrderTools {
    @dev.langchain4j.agent.tool.Tool("Sifariş statusunu əldə edir")
    public String getStatus(String orderId) {
        return "Sifariş yoldadır";
    }
}
```

---

## Arxitektura Qərar Qaydası (ADR - Architecture Decision Record)

Tech Lead komandası üçün seçim matrisi:

```
                                  [Yeni AI Layihəsi]
                                          |
                    +---------------------+---------------------+
                    |                                           |
         Mikroservis stack-iniz nədir?                Hədəf arxitektura nədir?
                    |                                           |
        +-----------+-----------+                     +---------+---------+
        |                       |                     |                   |
  Yalnız Spring Boot      Çoxsaylı (Quarkus,     Standart LLM /       Mürəkkəb RAG,
  və Cloud native         Micronaut, CLI)        Chatbot / Function   Multi-Agent,
        |                       |                Calling              Re-ranking
        v                       v                     |                   |
   [Spring AI]            [LangChain4j]               v                   v
                                                 [Spring AI]        [LangChain4j]
```

### Nə vaxt Spring AI seçilməlidir?
1. **Mövcud infrastruktur təmiz Spring Boot-dur:** Əgər şirkət Spring Cloud, Actuator, Security və Spring Data standartlarından istifadə edirsə, Spring AI təbii davamdır.
2. **Observability və Enterprise İdarəetmə:** Micrometer, OpenTelemetry və Prometheus metrikaları `management.*` konfiqurasiyaları ilə heç bir əlavə xərc çəkmədən işləyir.
3. **Model Context Protocol (MCP) prioritetdirsə:** Spring AI rəsmi MCP Java SDK-sını ən erkən və dərin şəkildə inteqrasiya edən ekosistemdir.

### Nə vaxt LangChain4j seçilməlidir?
1. **Daha zəngin RAG ekosistemi:** Layihənizdə sənədlərin chunk edilməsi, re-ranking (məs: Cohere), advance scoring və fərqli vector store-lar üzrə routing lazımdırsa.
2. **Kotlin / Quarkus / Standalone tətbiqlər:** Spring Boot olmadan işləyəcək konsol tətbiqləri, AWS Lambda və ya Quarkus native kompilyasiyası tələb olunursa.
3. **Domain-Driven Design (DDD) & Kod təmizliyi:** `@AiService` vasitəsilə LLM infrastrukturunu domain interface-i arxasında tamamilə gizlətmək istəyirsinizsə.

---

## Production məsələləri

- **Versiya Stabililiyi və Breaking Changes:** Hər iki layihə aktiv inkişafdadır. Spring AI `2.0.x` ilə daha sabit və Spring konsistensiyasına sahib API-yə keçsə də, LangChain4j də tez-tez versiya yenilənmələri edir. Maven modullarınızda versiyaları BOM (Bill of Materials) vasitəsilə pinləyin.
- **Virtual Threads (Project Loom):** Hər iki framework virtual thread-lərlə problemsiz işləyir. Lakin Spring AI `RestClient` vasitəsilə Virtual Thread bloklanmalarını (pinning) Spring səviyyəsində aradan qaldırır.
- **Vendor Lock-in Təhlükəsi:** Hər iki kitabxana da OpenAI, Anthropic, Ollama, Azure və AWS Bedrock provayderlərini dəyişməyə imkan verir. Əsas kilidlənmə LLM səviyyəsində deyil, framework-ün daxili `Prompt` və ya `ChatMessage` abstraksiyaları səviyyəsində baş verir.

---

## Komandaya necə tətbiq etmək

1. **ADR (Architecture Decision Record) sənədi yazın:** Komandanız üçün layihənin arxitektur repozitoriyasına `ADR-001-AI-Framework-Selection.md` sənədini yerləşdirin və seçimin səbəblərini qeyd edin.
2. **Abstraksiya Təbəqəsi (Hexagonal Architecture):** Komandaya tapşırın ki, heç vaxt Spring AI-ın `ChatClient`-ni və ya LangChain4j-nin obyektlərini domen modelinin mərkəzinə (Core Domain) sızdırmasınlar. AI interfeysləri hər zaman Port/Adapter arxasında olmalıdır.
3. **Birləşdirilmiş Təhlükəsizlik və Audit:** Hansı framework seçilməsindən asılı olmayaraq, şirkətin vahid logging və PII filter interceptor-larını framework-ün girişinə bağlayın.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Komandanız üçün **Spring AI vs LangChain4j Müqayisə Sənədi (ADR)** hazırlayın:
   - Şirkətinizin cari mikroservis arxitekturasını nəzərdən keçirin.
   - 3 əsas meyar seçin (məsələn: Observability, RAG imkanları, Öyrənmə əyrisi).
   - Hər iki framework-ə 1-dən 5-ə qədər bal verin.
2. Əgər sisteminizdə Spring Actuator və OpenTelemetry varsa, Spring AI-ın default metrikalarını araşdırın və LangChain4j-nin OpenTelemetry inteqrasiyası ilə konfiqurasiya fərqini qeyd edin.

---

## Mənbələr

- Spring AI Official Documentation: https://docs.spring.io/spring-ai/reference/ (yoxlanılmalıdır)
- LangChain4j GitHub & Documentation: https://docs.langchain4j.dev/ (yoxlanılmalıdır)
- Michael Simons, "Spring AI vs LangChain4j Architectural Overview": https://infoq.com (yoxlanılmalıdır)
- Architecture Decision Records (ADR) Pattern: https://adr.github.io/ (yoxlanılmalıdır)
```
[topics.md üçün əlavə ediləcək sətir]
| 2026-10-28 | Spring AI vs LangChain4j: Arxitektur Müqayisə və Seçim Matrisi (ADR) | Arxitektura / Framework Seçimi | Qabaqcıl | [daily/2026-10-28-spring-ai-vs-langchain4j-arxitektur-muqayise-adr.md](daily/2026-10-28-spring-ai-vs-langchain4j-arxitektur-muqayise-adr.md) |
```
