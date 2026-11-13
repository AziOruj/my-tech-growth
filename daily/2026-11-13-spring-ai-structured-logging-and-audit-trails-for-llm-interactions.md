# Spring AI: Structured Logging və Audit Trails for LLM Interactions

**Tarix:** 2026-11-13 · **Kateqoriya:** Observability / Governance · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Enterprise səviyyəli AI tətbiqlərində LLM-lərə gedən hər bir sorğu və onlardan gələn hər bir cavab sadəcə debug məqsədilə deyil, həm də **compliance**, **security audit** və **cost attribution** baxımından qeydə alınmalıdır. Adi `System.out.println` və ya bəsit SLF4J logları məxfi məlumatların (PII) sızmasına, JSON strukturunun pozulmasına və ya log həcminin idarəolunmaz dərəcədə böyüməsinə səbəb ola bilər. Tech Lead olaraq, komandanızla birlikdə LLM qarşılıqlı əlaqələrini strukturlaşdırılmış şəkildə (JSON log) loglamaq, PII məlumatlarını maskalamaq və hər bir sorğunu unikal audit izi (audit trail) ilə təmin edən arxitektura qurmalısınız.

---

## Əsas anlayışlar

1.  **Structured Logging (JSON Loggers):** Logların oxunabilən mətn əvəzinə JSON formatında yazılması (Logback + Logstash encoder). Bu, Elasticsearch/Kibana və ya Grafana Loki kimi sistemlərdə asan indekslənməni təmin edir.
2.  **Audit Trail:** LLM-ə göndərilən prompt, istifadəçi ID-si, sessiya tokeni, model adı, token sayı (prompt/completion tokens) və cavabın tam tarixçəsinin izlənilə bilən şəkildə saxlanılması.
3.  **PII Sanitization (Masking):** Loglara yazılmazdan əvvəl həssas məlumatların (kredit kartı, şəxsiyyət vəsiqəsi, e-poçt) avtomatik təmizlənməsi və ya maskalanması.
4.  **Spring AI Observability Integration:** Micrometer Observation API vasitəsilə LLM metrikalarının və xüsusi audit loglarının inteqrasiyası.

---

## Kod nümunəsi: Structured Audit Logging Filter/Advisor

Aşağıdakı nümunədə Spring AI `ChatClient` çağırışlarını intercept edən, token istifadəsini hesablayan və strukturlu JSON audit logu yaradan xüsusi Advisor (və ya Interceptor) nümunəsi göstərilmişdir.

### 1. Audit Log Domen Modeli
```java
public record LlmAuditRecord(
    String correlationId,
    String userId,
    String modelName,
    String promptText,
    String responseText,
    int promptTokens,
    int completionTokens,
    long durationMs,
    Instant timestamp
) {}
```

### 2. Custom Audit Advisor Implementasiyası
Spring AI 2.x Architecture üzərində qurulmuş `CallAdvisor` nümunəsi:

```java
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisor;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisorChain;
import org.springframework.ai.chat.client.advisor.api.AdvisedRequest;
import org.springframework.ai.chat.client.advisor.api.AdvisedResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.UUID;

@Component
public class LlmAuditLoggingAdvisor implements CallAroundAdvisor {

    private static final Logger log = LoggerFactory.getLogger(LlmAuditLoggingAdvisor.class);
    private final ObjectMapper objectMapper;

    public LlmAuditLoggingAdvisor(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public String getName() {
        return "LlmAuditLoggingAdvisor";
    }

    @Override
    public int getOrder() {
        return 0; // Ən birinci və ya istənilən sırada icra oluna bilər
    }

    @Override
    public AdvisedResponse aroundCall(AdvisedRequest advisedRequest, CallAroundAdvisorChain chain) {
        long startTime = System.currentTimeMillis();
        String correlationId = UUID.randomUUID().toString();
        
        // PII maskalanması (sadələşdirilmiş nümunə)
        String sanitizedPrompt = sanitizePii(advisedRequest.userText());

        // Zənciri davam etdir və cavabı al
        AdvisedResponse advisedResponse = chain.nextAroundCall(advisedRequest);

        long duration = System.currentTimeMillis() - startTime;
        
        String responseText = (advisedResponse.response() != null && 
                               advisedResponse.response().getResult() != null) ? 
                              advisedResponse.response().getResult().getOutput().getText() : "";

        int promptTokens = advisedResponse.response() != null && 
                           advisedResponse.response().getMetadata().getUsage() != null ?
                           (int) advisedResponse.response().getMetadata().getUsage().getPromptTokens() : 0;

                           
        int completionTokens = advisedResponse.response() != null && 
                               advisedResponse.response().getMetadata().getUsage() != null ?
                               (int) advisedResponse.response().getMetadata().getUsage().getGenerationTokens() : 0;

        String modelName = advisedRequest.options() != null ? advisedRequest.options().getModel() : "unknown";
        String userId = MDC.get("userId") != null ? MDC.get("userId") : "anonymous";

        LlmAuditRecord auditRecord = new LlmAuditRecord(
            correlationId,
            userId,
            modelName,
            sanitizedPrompt,
            sanitizePii(responseText),
            promptTokens,
            completionTokens,
            duration,
            Instant.now()
        );

        // Strukturlu JSON loglama
        try {
            log.info("LLM_AUDIT_TRAIL: {}", objectMapper.writeValueAsString(auditRecord));
        } catch (Exception e) {
            log.error("Failed to serialize LLM audit record", e);
        }

        return advisedResponse;
    }

    private String sanitizePii(String input) {
        if (input == null) return "";
        // Real layihədə RegEx və ya xüsusi PII maskalama kitabxanası (məsələn, Microsoft Presidio) istifadə edin
        return input.replaceAll("\\b\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}\\b", "[REDACTED_CC]")
                    .replaceAll("\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b", "[REDACTED_EMAIL]");
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Metod | Üstünlükləri | Çatışmazlıqları |
| :--- | :--- | :--- |
| **Advisor-based Auditing** | Spring AI axınına dörddəbir inteqrasiya olunur, təmiz və modul dizayndır. | Yalnız `ChatClient` üzərindən gələn çağırışları əhatə edir. |
| **HTTP Client Interceptor** | OpenAI/Anthropic API səviyyəsində bütün trafikləri tutur (framework-dən asılı deyil). | Token sayı və model metadata-sını əldə etmək çətinləşir. |
| **Asinxron Audit (Event-Driven)** | Loglama əməliyyatı əsas thread-i bloklamır (`Spring Events` / `Kafka`). | Server qəflətən sönərsə, audit logları yaddaş kuyruğunda itə bilər. |

**Tech Lead Tövsiyəsi:** Enterprise sistemlər üçün **Advisor-based** yanaşma seçin, çünki o, token istifadəsi və structured metadata-ya birbaşa çıxış verir. Logları dərhal stdout-a JSON formatında yazın və Fluentbit/Filebeat vasitəsilə mərkəzi anbarınıza (Elasticsearch) göndərin.

---

## Production məsələləri

1.  **Log Həcmi (Payload Size):** Böyük RAG sorğuları və cavabları log fayllarını sürətlə doldura bilər. Uzun cavabları loglayarkən string uzunluğunu məhdudlaşdırın (məsələn, maksimum 1000 simvol) və ya tam məzmunu yalnız təhlükəsiz S3 bucket-ə yazın, logda isə yalnız ID saxlayın.
2.  **PII Leakage:** Prompt daxilində istifadəçinin yazdığı şəxsi məlumatların loglara düşməsi GDPR/KVKK pozuntusudur. Mütləq şəkildə pre-processing və ya PII masking mexanizmi tətbiq edin.
3.  **Performance Overhead:** JSON serialization hər sorğuda əlavə CPU xərci yaradır. Jackson ObjectMapper-i optimal konfiqurasiya edin və async logback appender-lərdən istifadə edin.

---

## Komandaya necə tətbiq etmək

1.  **Standard JSON Layout:** Komandaya SLF4J üçün Logstash JSON encoder (və ya oxşar format) standartı təyin edin ki, bütün mikroservislərdə LLM logları eyni strukturda olsun.
2.  **Mandatory Correlation ID:** Bütün LLM sorğularının HTTP MDC (Mapped Diagnostic Context) üzərindən `correlationId` və `userId` daşımasını məcburi edin.
3.  **Security Review:** Audit log fayllarının kimlər tərəfindən oxuna biləcəyini (Access Control) DevOps komandası ilə birlikdə yoxlayın. AI logları həssas biznes məlumatlarını ehtiva edə bilər.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Spring Boot layihənizdə yuxarıdakı kimi bir `CallAroundAdvisor` yazın.
2.  Test sorğusu zamanı prompt daxilində qəsdən kredit kartı nömrəsi və ya e-poçt ünvanı qeyd edin.
3.  `sanitizePii` metodunun bu məlumatları maskaladığını və konsola təmizlənmiş JSON audit logunun çıxdığını yoxlayın.
4.  Micrometer MDC vasitəsilə `userId`-nin log obyektinə düşməsini təmin edin.

---

## Mənbələr

-   Spring AI Advisor API: https://docs.spring.io/spring-ai/reference/api/chatclient.html#_chat_client_advisors (yoxlanılmalıdır)
-   Logback JSON Encoder: https://github.com/logstash/logstash-logback-encoder (yoxlanılmalıdır)
-   OWASP Top 10 for Large Language Model Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/ (yoxlanılmalıdır)
