# Spring AI Multi-modal: Vision (Şəkil Analizi) İnteqrasiyası

**Tarix:** 2026-11-03 · **Kateqoriya:** Multi-modal AI · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Müasir backend sistemlərində süni intellekt yalnız mətnlə məhdudlaşmır. Tech Lead olaraq, strukturlaşdırılmamış datanın (şəkillər, PDF-lər, qəbzlər) emalı üçün ənənəvi OCR (Optical Character Recognition) alətlərindən (məsələn, Tesseract) Multi-modal LLM-lərə (GPT-4o, Claude 3.5 Sonnet, Llama 3.2 Vision) keçid etmək vaxtıdır. Bu modellər şəkildəki mətni oxumaqla qalmır, həm də konteksti anlayır (məsələn, "bu şəkildəki avtomobil qəzasında zədənin ağırlıq dərəcəsini təyin et"). Spring AI-ın vahid API-ı vasitəsilə şəkil və mətni eyni sorğuda modelə göndərmək, mürəkkəb sənəd emalı (ID card verification, invoice processing) pipeline-larını xeyli sadələşdirir.

---

## Əsas anlayışlar

1. **Multi-modal LLM:** Eyni anda bir neçə tip datanı (text, image, audio, video) qəbul edib emal edə bilən modellər.
2. **Media Obyekti:** Spring AI-da şəkli və ya audionu təmsil etmək üçün istifadə olunan interfeys. O, məlumatın mənbəyini (Resource) və MIME tipini (məsələn, `image/png`) saxlayır.
3. **UserMessage with Media:** Şəkil modelə tək başına deyil, həmişə bir istifadəçi mesajının (UserMessage) tərkib hissəsi kimi göndərilir.
4. **Token Cost (Vision):** Şəkillər mətnə nisbətən daha çox token istehlak edir. Modellər şəkli "tile"-lara bölür və hər bir tile üçün sabit miqdarda token hesablayır.

---

## Kod nümunəsi: Sənəd Analizi Servisi

Bu nümunədə biz müştərinin göndərdiyi qəbz (receipt) şəklini analiz edib, ordan məlumatları strukturlaşdırılmış (JSON) şəkildə çıxaran servis hazırlayırıq.

### 1. DTO (Structured Output üçün)
```java
public record ReceiptData(
    String storeName,
    LocalDate date,
    Double totalAmount,
    List<String> items,
    String currency
) {}
```

### 2. Vision Service
```java
package com.company.ai.vision;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.util.MimeTypeUtils;

@Service
public class VisionProcessingService {

    private final ChatClient chatClient;

    public VisionProcessingService(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    public ReceiptData analyzeReceipt(Resource imageResource) {
        return chatClient.prompt()
                .user(u -> u
                    .text("""
                        Zəhmət olmasa bu qəbz şəklini analiz et və məlumatları çıxar.
                        Əgər hansısa məlumat oxunmursa, null qoy.
                        """)
                    .media(MimeTypeUtils.IMAGE_JPEG, imageResource) // Şəkil əlavə edilir
                )
                .output(ReceiptData.class) // Strukturlaşdırılmış çıxış
                .handle();
    }
}
```

### 3. Controller
```java
@RestController
@RequestMapping("/api/vision")
public class VisionController {

    private final VisionProcessingService visionService;

    public VisionController(VisionProcessingService visionService) {
        this.visionService = visionService;
    }

    @PostMapping("/analyze-receipt")
    public ReceiptData uploadReceipt(@RequestParam("file") MultipartFile file) {
        return visionService.analyzeReceipt(file.getResource());
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

- **Base64 vs Public URL:**
    - *Base64:* Şəkli birbaşa sorğunun gövdəsində göndərmək asandır, lakin payload-u 33% böyüdür və şəbəkə gecikməsinə səbəb olur.
    - *URL:* Əgər şəkli S3 kimi bir yerdə saxlayıb linkini göndərsəniz, LLM provayderi şəkli özü yükləyəcək. Bu, daha sürətlidir, lakin təhlükəsizlik (pre-signed URL) tələb edir.
- **Detail Level (Low vs High):** Bəzi modellər (məsələn, GPT-4o) "low" və ya "high" detallı analiz rejimləri təklif edir. Tech Lead olaraq, kiçik yazıları (qəbz, müqavilə) oxumaq üçün mütləq "high" rejimindən istifadəni təmin etməlisiniz (bu, daha çox token aparır).
- **Format Dəstəyi:** Hər model hər formatı dəstəkləmir. `image/png`, `image/jpeg` universal olsa da, `image/webp` və ya çoxsəhifəli `PDF` (vision üçün) modeldən-modelə dəyişir.

---

## Production məsələləri

1. **Payload Size Limits:** Bir çox API provayderi (OpenAI, Anthropic) bir sorğuda maksimum 20MB və ya 5-10 şəkil limiti qoyur. Böyük həcmli sənədlər üçün onları hissələrə bölməli və ya ölçüsünü (downsampling) azaltmalısınız.
2. **Rate Limiting:** Vision sorğuları mətn sorğularından daha çox resurs tələb etdiyi üçün tez-tez `RateLimitException` ilə qarşılaşa bilərsiniz. Exponential backoff (Resilience4j) mütləqdir.
3. **Privacy:** Şəkillərdə PII (Personally Identifiable Information) — məsələn, üzlər, nömrələr ola bilər. Modelə göndərməzdən əvvəl bu hissələrin maskalanması (redaction) tələb oluna bilər.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1. **"Vision Capabilities" Matrisi yaradın:** Hansı biznes tapşırıqları üçün (məsələn, sənəd tanıma) hansı modelin (OpenAI vs Local Llama) daha sərfəli olduğunu test edin.
2. **Image Pre-processing Standartı:** Şəkilləri modelə göndərməzdən əvvəl backend-də ölçülərini optimallaşdıran (resize) bir util servisi yaradın. Bu, həm xərcləri azaldacaq, həm də sürəti artıracaq.
3. **Fallback Strategiyası:** Vision modeli uğursuz olarsa (hallucination), ehtiyat variant kimi ənənəvi OCR servislərinə (məsələn, AWS Textract və ya Azure AI Vision) keçid mexanizmi qurun.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1. Yerli olaraq bir Spring Boot proyektində `ChatClient` quraşdırın.
2. Bir şəkildəki (məsələn, parkinq cəriməsi və ya qida etiketi) məlumatları təsvir edən və müəyyən sahələri (məsələn, "son istifadə tarixi") çıxaran servis yazın.
3. Eyni anda **iki fərqli şəkil** (məsələn, bir sənədin ön və arxa tərəfi) göndərib, modeldən onları müqayisə etməsini istəyin.
4. Loglarda istehlak edilən token sayını müşahidə edin.

---

## Mənbələr

- Spring AI Multi-modal Documentation: https://docs.spring.io/spring-ai/reference/api/chatclient.html#_multimodal (yoxlanılmalıdır)
- OpenAI Vision Guide: https://platform.openai.com/docs/guides/vision (yoxlanılmalıdır)
- Anthropic Claude Vision: https://docs.anthropic.com/claude/docs/vision (yoxlanılmalıdır)
