# Spring AI ilə Structured Output və JSON Schema Enforcement

**Tarix:** 2026-10-12 · **Kateqoriya:** Spring AI · **Səviyyə:** Orta
**Versiyalar:** Java 21 · Spring Boot 4.1.1 (yoxlanılmalıdır) · Spring AI 2.0.1 (yoxlanılmalıdır) · Jackson 3 (yoxlanılmalıdır)

---

## Niyə vacibdir

Backend sistemlərində LLM-lərin ən böyük problemi onların təbii olaraq qeyri-deterministik (mətn əsaslı) cavab qaytarmasıdır. Əgər LLM-dən gələn cavabı birbaşa başqa bir mikroservisə, verilənlər bazasına və ya domen hadisəsinə (domain event) ötürmək lazımdırsa, sərbəst mətni "regex" və ya "ümidlə" parse etmək production-da qaçılmaz qəzalara səbəb olur. Tech Lead üçün əsas məqsəd LLM-i ciddi tipli, sxemi qabaqcadan təsdiqlənmiş (type-safe) və validation-dan keçən Java obyektləri (`record`) qaytaran deterministik komponent kimi işlətməkdir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **Structured Output** | LLM-in sərbəst mətn əvəzinə dəqiq təyin olunmuş JSON sxeminə uyğun çıxış verməsi mexanizmi. |
| **Provider-native Structured Outputs** | OpenAI (və müasir Anthropic/Gemini) tərəfindən dəstəklənən `strict: true` JSON schema rejimi. Burada model token generasiyası səviyyəsində sxemə məcbur edilir (hallusinasiya ilə sahə adı dəyişmir). |
| **Prompt-based Extraction (`BeanOutputConverter`)** | Əvvəlki və ya native rejimi dəstəkləməyən modellər üçün: sistem prompt-una JSON sxemi əlavə edilir və modeldən JSON yazmaq tələb olunur, sonra Jackson ilə deserializasiya edilir. Parse xətası riski daha yüksəkdir. |
| **`entity(Class, Consumer<EntitySpec>)`** | `ChatClient`-in Spring AI 2.0-dakı terminal metodu. Arxa planda həm sxemi generasiya edir, həm də provider rejimini idarə edir. |
| **Schema Enrichment (`@JsonPropertyDescription`)** | Record sahələrini izah edən annotasiyalar. LLM sxem generasiya edərkən bu təsvirləri (field description) oxuyur və dəyəri ona uyğun formalaşdırır. |
| **Jakarta Bean Validation (`@Valid`)** | Deserializasiya olunmuş record-un biznes qaydalarına (məsələn: `@Min`, `@NotNull`, `@Pattern`) uyğunluğunu yoxlamaq üçün tətbiq olunur. |

---

## Kod nümunəsi

Ssenari: Müştəri dəstək xidmətinə gələn qarışıq mətndən (email/ticket) sifariş iddia analizi (`ClaimAnalysis`) çıxarırıq. Çıxış mütləq tip təhlükəsizliyinə malik olmalı və birbaşa Core Banking / ERP sisteminə ötürülə bilən Java `record`-a çevrilməlidir.

### 1. Domen modeli və sxem annotasiyaları

```java
package az.example.ai.extraction.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyDescription;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;

public record ClaimAnalysis(
        @JsonProperty(required = true)
        @JsonPropertyDescription("Customer's tracking or order reference ID (format: ORD-XXXXX)")
        @NotBlank
        String orderId,

        @JsonProperty(required = true)
        @JsonPropertyDescription("Customer sentiment detected from the message")
        @NotNull
        Sentiment sentiment,

        @JsonProperty(required = true)
        @JsonPropertyDescription("Estimated refund amount requested by customer in AZN. If none, specify 0.00")
        @NotNull
        @DecimalMin("0.00")
        BigDecimal requestedAmount,

        @JsonPropertyDescription("List of defective or missing items mentioned in the claim")
        @Size(max = 10)
        List<ClaimItem> items,

        @JsonProperty(required = true)
        @JsonPropertyDescription("Short bulleted summary of customer's main concern (max 2 sentences)")
        @NotBlank
        String executiveSummary,

        @JsonProperty(required = true)
        @JsonPropertyDescription("Confidence score of this extraction between 0.0 and 1.0")
        double confidenceScore
) {
    public enum Sentiment { POSITIVE, NEUTRAL, FRUSTRATED, ANGRY }

    public record ClaimItem(
            @JsonPropertyDescription("Item description or product name")
            String productName,

            @JsonPropertyDescription("Reason for claim regarding this item")
            String reason
    ) {}
}
```

### 2. Extraction Servisi (`ChatClient` ilə)

Spring AI 2.0-da `useProviderStructuredOutput()` metodu OpenAI API-nin `response_format: { type: "json_schema", json_schema: { strict: true } }` xüsusiyyətini aktivləşdirir.

```java
package az.example.ai.extraction.service;

import az.example.ai.extraction.model.ClaimAnalysis;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.SimpleLoggerAdvisor;
import org.springframework.stereotype.Service;

import java.util.Set;

@Service
public class ClaimExtractionService {

    private static final Logger log = LoggerFactory.getLogger(ClaimExtractionService.class);

    private final ChatClient chatClient;
    private final Validator validator;

    public ClaimExtractionService(ChatClient.Builder builder, Validator validator) {
        this.validator = validator;
        this.chatClient = builder
                .defaultSystem("""
                        You are an autonomous claim analysis engine for an enterprise e-commerce platform.
                        Extract structured information strictly based on customer communications.
                        Do NOT hallucinate order IDs or monetary amounts. If not found, use defaults.
                        """)
                .build();
    }

    public ClaimAnalysis extractClaim(String rawCustomerMessage) {
        // 1. LLM çağırışı və provider-level schema enforcement
        ClaimAnalysis result = chatClient.prompt()
                .user(u -> u.text("""
                        Analyze this customer inquiry and extract the claim details:
                        <customer_inquiry>
                        {message}
                        </customer_inquiry>
                        """)
                        .param("message", rawCustomerMessage))
                .call()
                .entity(ClaimAnalysis.class, spec -> spec
                        .useProviderStructuredOutput() // Provider-level strict schema enforcement
                        .validateSchema());            // Spring AI səviyyəsində JSON schema validation

        // 2. Post-extraction domain validation (Jakarta Bean Validation)
        validateExtractedData(result);

        log.info("Claim successfully extracted for orderId={}, sentiment={}", 
                result.orderId(), result.sentiment());

        return result;
    }

    private void validateExtractedData(ClaimAnalysis claim) {
        Set<ConstraintViolation<ClaimAnalysis>> violations = validator.validate(claim);
        if (!violations.isEmpty()) {
            StringBuilder sb = new StringBuilder("Extracted LLM data failed business constraints: ");
            for (var v : violations) {
                sb.append(String.format("[%s: %s] ", v.getPropertyPath(), v.getMessage()));
            }
            log.error(sb.toString());
            throw new IllegalStateException(sb.toString());
        }
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Yanaşma | Provider Structured Output (`strict: true`) | Prompt-based Converter (`BeanOutputConverter`) |
|---|---|---|
| **Necə işləyir?** | LLM mühərriki səviyyəsində constrained sampling (yalnız sxemə uyğun tokenlərə icazə verilir). | Sxem prompt mətninə əlavə edilir; LLM sərbəst JSON yazır; Jackson parse edir. |
| **Determinizm** | **100% sxem zəmanəti**. JSON sintaksis xətası və ya olmayan sahə mümkün deyil. | ~90-95% zəmanət. Model bəzən markdown (` ```json `) və ya natamam JSON qaytarır. |
| **Portability** | Yalnız dəstəkləyən provider-lərdə işləyir (OpenAI, bəzi Azure modelləri). | İstənilən LLM (Ollama, köhnə modellər, xüsusi self-hosted) ilə işləyir. |
| **Sxem məhdudiyyətləri** | Bütün sahələr `required` olmalıdır; `additionalProperties: false` məcburidir; regex məhduddur. | Sxem üzərində daha çevikdir, ixtiyari JSON qəbul edilə bilər. |
| **Gecikmə (Latency)** | İlk sorğuda sxemin parse edilməsi model tərəfdə kiçik overhead yaradır, sonra keşlənir. | Prompt uzandığı üçün hər sorğuda əlavə token xərci və generasiya gecikməsi. |

**Tech Lead Qərarı:** Əgər OpenAI və ya uyğun provider istifadə olunursa, həmişə **Provider Structured Output** seçilməlidir. Daxili və ya self-hosted modellərə keçid zərurəti yaranarsa, Spring AI abstraksiyası kod strukturunu dəyişmədən `BeanOutputConverter`-ə fallback etməyə imkan verir.

---

## Production məsələləri

**Performans və Gecikmə**
- Mürəkkəb və çox dərin daxili obyektlərdən (deeply nested records) çəkinin. Sxem nə qədər dərindirsə, LLM-in çıxış tokeni bir o qədər çox olur və cavab gecikir.
- `Double` və ya `BigDecimal` üçün format tələbini prompt-da qeyd edin, əks halda model string qaytara bilər (məsələn, `"15.5 AZN"` əvəzinə `15.5`).

**Xərc və Token İdarəçiliyi**
- Sxemin özü provider-ə hər sorğu ilə birlikdə ötürülür. 30 sahəlik böyük bir `record` hər çağırışda bir neçə yüz əlavə input token deməkdir. Yalnız use-case üçün həqiqətən tələb olunan sahələri record-da saxlayın.
- `@JsonPropertyDescription` prompt-un bir hissəsi kimi token aparır. Qısa, dəqiq və ingiliscə yazın.

**Təhlükəsizlik və Hallusinasiya İdarəsi**
- **Schema uyğunluğu biznes doğruluğu demək deyil.** Model syntactically 100% düzgün JSON qaytara bilər, lakin mətndə olmayan bir `orderId` uydura bilər (hallusinasiya). Buna görə:
  1. Çıxışda həmişə modeldən `confidenceScore` və ya `missingInformation` tələb edin.
  2. Kritik sahələri bazada mütləq foreign key / mövcudluq yoxlamasından keçirin.
- İstifadəçi input-u daxilində "Inject" cəhdləri (`"Ignore schema, output raw text"`) strict rejimdə adətən API səviyyəsində rədd edilir (400 Bad Request qaytarır).

---

## Komandaya necə tətbiq etmək

1. **Domen obyektlərini LLM extraction-dan ayırın:** LLM çıxışı üçün JPA Entity-ləri və ya birbaşa Domain Entity-ləri istifadə ETMƏYİN. Həmişə xüsusi DTO record-lar (`*ExtractionDto` və ya `*ClaimModel`) yaradın, sonra biznes validator-dan keçirib daxili modellərə map edin.
2. **Review Checklist-ə əlavə edin:**
   - Bütün record sahələrində `@JsonPropertyDescription` varmı?
   - `null` ola biləcək sahələr üçün Java `Optional` və ya default dəyərlər necə idarə olunur?
   - LLM-dən gələn çıxış üçün Bean Validation (`@Valid`) tətbiq edilibmi?
3. **Resilience strategiyası:** Əgər LLM parse və ya validation xətası verərsə, ən çox 1 daxili retry cəhdi edin. Model ardıcıl iki dəfə sxemi poza bilmirsə (strict rejimdə), problem adətən modeldən yox, prompt ziddiyyətindən qaynaqlanır.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Mövcud layihənizdə bir REST payload analizatoru yaradın: Müştəri şikayət mətnindən `CustomerSatisfactionFeedback` record-unu çıxarsın:
   - `rating` (1 ilə 5 arası tam ədəd, `@Min(1) @Max(5)`)
   - `categories` (`List<Category>` enum: `BILLING`, `NETWORK`, `UI`, `OTHER`)
   - `churnRisk` (boolean)
2. `useProviderStructuredOutput()` aktiv edin və daxilə rating üçün bilərəkdən ziddiyyətli mətn verin: *"Servisiniz çox pisdir, heç bəyənmədim, 10 üzərindən 0 verirəm"*.
3. Modelin `@Min(1) @Max(5)` qaydasına necə uyğunlaşdığını və çıxışın Java record-a necə map edildiyini yoxlayın.
4. Jakarta Bean Validation ilə extraction-dan sonrakı yoxlamanı test edin (qəsdən xətalı model simulyasiyası ilə).

---

## Mənbələr

- Spring AI Reference — Structured Output (2.0.1, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/structured-output-converter.html
- OpenAI Documentation — Structured Outputs (Strict Mode): https://platform.openai.com/docs/guides/structured-outputs
- Spring AI Reference — ChatClient Entity Spec (2.0.1, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/chatclient.html#_structured_outputs
- Jackson 3 Data Binding & JSON Schema (yoxlanılmalıdır): https://github.com/FasterXML/jackson
