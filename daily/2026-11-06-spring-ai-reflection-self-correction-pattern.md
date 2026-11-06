# Spring AI: Reflection və Self-Correction Workflow-ları

**Tarix:** 2026-11-06 · **Kateqoriya:** AI Agents / Design Patterns · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM-lər "one-shot" (tək cəhddə) mürəkkəb tapşırıqlarda çox vaxt kiçik detalları qaçırır və ya məntiqi səhvlər edir. Tech Lead olaraq sistemin kritik hissələrində (məsələn, avtomatik kod generatoru, hüquqi sənəd analizi və ya maliyyə hesabatı) LLM-in çıxışına kor-koranə etibar edə bilməzsiniz.

**Reflection (Refleksiya)** pattern-i LLM-ə öz işini tənqid etməyi və səhvlərini düzəltməyi tapşırır. Bu, sistemin dəqiqliyini (accuracy) insan müdaxiləsi olmadan dramatik şəkildə artırır.

---

## Əsas anlayışlar

1.  **Generator:** İlkin nəticəni hazırlayan LLM komponenti.
2.  **Reflector (Critique):** Generatorun nəticəsini müəyyən edilmiş meyarlar (məsələn: "təhlükəsizlik qaydalarına uyğundurmu?", "hesablamalar dəqiqdirmi?") əsasında yoxlayan və rəy (feedback) verən LLM komponenti.
3.  **Self-Correction Loop:** Generatorun rəy əsasında öz cavabını yenidən işləməsi prosesi.
4.  **Stopping Condition:** Dövrün nə vaxt dayanacağını təyin edən məntiq (məsələn, maksimum 3 cəhd və ya Reflector-un "Təsdiq edildi" cavabı).

---

## Kod nümunəsi: "Reflective" Məqalə Yazarı

Aşağıdakı nümunədə biz bir yazıçı agent yaradırıq ki, o, yazdığı mətni özü yoxlayır və rəy əsasında təkmilləşdirir.

```java
package com.company.ai.reflection;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;
import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class ReflectionService {

    private final ChatClient chatClient;

    public ReflectionService(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    public String generateRefinedContent(String topic) {
        // 1. İlkin "Draft" yaratmaq
        String draft = chatClient.prompt()
                .system("Sən peşəkar texniki yazıçısan.")
                .user("Mövzu haqqında qısa məqalə yaz: " + topic)
                .call()
                .content();

        log.info("İlkin draft hazırlandı.");

        int maxIterations = 2;
        String currentVersion = draft;

        for (int i = 0; i < maxIterations; i++) {
            // 2. Refleksiya (Tənqid) mərhələsi
            String critique = chatClient.prompt()
                    .system("Sən sərt bir redaktorsan. Aşağıdakı mətndəki məntiqi səhvləri və çatışmazlıqları tap. " +
                            "Əgər hər şey mükəmməldirsə, yalnız 'MÜKƏMMƏL' yaz.")
                    .user(currentVersion)
                    .call()
                    .content();

            if (critique.contains("MÜKƏMMƏL")) {
                log.info("Mətn kafi hesab edildi (Iterasiya: {})", i + 1);
                break;
            }

            log.info("Tənqid alındı: {}", critique);

            // 3. Self-Correction (Təkmilləşdirmə)
            currentVersion = chatClient.prompt()
                    .system("Sən yazıçısan. Verilmiş tənqidi nəzərə alaraq mətni yenidən yaz.")
                    .user(String.format("Orijinal mətn: %s\n\nTənqid: %s", currentVersion, critique))
                    .call()
                    .content();
        }

        return currentVersion;
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

-   **Latency vs. Quality:** Reflection dövrləri sistemin cavab vermə müddətini 2-3 dəfə artırır. UI-da mütləq "Progressive Loading" və ya "Asynchronous Processing" istifadə edilməlidir.
-   **Model Diversity:** Generator üçün daha ucuz (GPT-4o-mini), Reflector üçün isə daha ağıllı/bahalı (GPT-4o və ya Claude 3.5 Sonnet) model istifadə etmək effektiv strategiyadır.
-   **Infinite Loops:** Modellər bəzən eyni tənqidi təkrar edə bilər. Həmişə `maxIterations` sayğacı tətbiq edilməlidir.

---

## Production məsələləri

1.  **Token Cost:** Hər dövr yeni tokenlər deməkdir. Mürəkkəb Reflection-ları yalnız yüksək dəqiqlik tələb edən biznes tapşırıqları üçün saxlayın.
2.  **Logging & Debugging:** Reflection prosesində baş verən bütün "draft" və "critique" addımlarını verilənlər bazasında saxlayın. Bu, modelin niyə səhv istiqamətə getdiyini anlamaq üçün yeganə yoldur.
3.  **Prompt Drift:** Modeli tənqid etməyə məcbur etdikdə, o, bəzən olmayan səhvləri "uydurmağa" başlayır. Promptda "Əgər hər şey düzdürsə, müdaxilə etmə" təlimatı kritikdir.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1.  **Kritik nöqtələri müəyyən edin:** Harda "Hallucination" riski yüksəkdir? Həmin modullar üçün Reflection quraşdırın.
2.  **Rubrics (Meyarlar) hazırlayın:** Reflector agentə nəyi yoxlayacağını konkret siyahı ilə verin (məsələn: 1. Terminologiya düzgündürmü? 2. Kod işləkdirmi? 3. JSON formatı valid-dirmi?).
3.  **Human-in-the-loop:** Çox yüksək riskli işlərdə Reflector-un tənqidindən sonra son təsdiqi insanın verməsi üçün bir "Approval Workflow" əlavə edin.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Daxil edilən Java kodunu analiz edən və ondakı potensial bug-ları tapan bir `BugHunter` agenti yaradın.
2.  İkinci bir agent yazın ki, bu tənqidlər əsasında kodu avtomatik düzəltsin.
3.  Düzəldilmiş kodu yenidən `BugHunter`-ə göndərin. Əgər hələ də bug tapılsa, cəhdlərin sayını limitləyərək prosesi təkrarlayın.

---

## Mənbələr

-   Iterative Refinement Pattern: https://www.promptingguide.ai/techniques/reflection (yoxlanılmalıdır)
-   Spring AI ChatClient Docs: https://docs.spring.io/spring-ai/reference/api/chatclient.html (yoxlanılmalıdır)
-   Reflection in Agentic Workflows (Andrew Ng): https://www.deeplearning.ai/the-batch/how-agents-can-improve-llm-performance/ (yoxlanılmalıdır)
