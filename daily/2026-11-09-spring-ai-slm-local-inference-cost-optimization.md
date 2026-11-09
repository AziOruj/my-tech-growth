# Spring AI: Small Language Models (SLMs) və Local Inference (Cost & Privacy Optimization)

**Tarix:** 2026-11-09 · **Kateqoriya:** Cost Optimization & Performance · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Enterprise AI sistemlərində hər bir xırda tapşırıq (məsələn, mətni klassifikasiya etmək və ya qısa xülasə çıxarmaq) üçün GPT-4o və ya Claude 3.5 Sonnet kimi "ağır" modellərdən istifadə etmək həm iqtisadi, həm də performans baxımından səmərəsizdir. Tech Lead olaraq sizin vəzifəniz **Small Language Models (SLM)** — yəni Llama 3.2 (1B/3B), Phi-3.5 və ya Gemma 2b kimi yüngül modelləri yerli (local) infrastrukturda və ya ucuz servislərdə işlətməklə həm bulud xərclərini (Cloud API costs) azaltmaq, həm də PII (Personally Identifiable Information) məlumatlarını daxili şəbəkədən kənara çıxarmamaqdır.

---

## Əsas anlayışlar

1.  **Small Language Models (SLM):** Parametr sayı az olan (adətən 1B - 7B arası), konkret tapşırıqlarda (summarization, extraction, classification) yüksək dəqiqlik göstərən modellər.
2.  **Local Inference (Ollama/LocalAI):** LLM-i Docker konteynerində və ya daxili GPU serverdə işlətmək. Spring AI Ollama və LocalAI üçün doğma (native) dəstək təqdim edir.
3.  **Model Routing:** Gələn sorğunun mürəkkəbliyinə görə onu ucuz/sürətli (SLM) və ya bahalı/ağıllı (LLM) modelə yönləndirmə arxitekturası.
4.  **Quantization:** Modellərin çəkisini (weights) 16-bitdən 4-bit və ya 8-bitə sıxaraq RAM istifadəsini azaltmaq və sürəti artırmaq (keyfiyyətdən cüzi itki ilə).

---

## Kod nümunəsi: Multi-Model Configuration və Router Pattern

Aşağıdakı nümunədə həm OpenAI (LLM), həm də yerli Ollama (SLM) eyni layihədə konfiqurasiya edilir və bir `TaskRouterService` vasitəsilə mürəkkəbliyə görə paylanır.

### 1. `application.yml` konfiqurasiyası
```yaml
spring:
  ai:
    openai:
      api-key: ${OPENAI_API_KEY}
      chat:
        options:
          model: gpt-4o
    ollama:
      base-url: http://localhost:11434
      chat:
        options:
          model: llama3.2:3b # Yerli yüngül model
```

### 2. Router Service (Java 21+)
```java
package com.company.ai.routing;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.ollama.OllamaChatModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class ModelRouterService {

    private final ChatClient highEndClient; // GPT-4o
    private final ChatClient localClient;   // Ollama / Llama 3.2

    public ModelRouterService(OpenAiChatModel openAiModel, OllamaChatModel ollamaModel) {
        this.highEndClient = ChatClient.builder(openAiModel).build();
        this.localClient = ChatClient.builder(ollamaModel).build();
    }

    public String processTask(String input, TaskType type) {
        return switch (type) {
            // Sadə işlər üçün yerli SLM istifadə olunur
            case CLASSIFICATION, SUMMARIZATION, EXTRACTION -> {
                System.out.println("Routing to SLM (Ollama)...");
                yield localClient.prompt()
                        .user(input)
                        .call()
                        .content();
            }
            // Mürəkkəb məntiq üçün bulud LLM istifadə olunur
            case REASONING, CODE_GENERATION, COMPLEX_ADVICE -> {
                System.out.println("Routing to LLM (OpenAI)...");
                yield highEndClient.prompt()
                        .user(input)
                        .call()
                        .content();
            }
        };
    }

    public enum TaskType {
        CLASSIFICATION, SUMMARIZATION, EXTRACTION, REASONING, CODE_GENERATION, COMPLEX_ADVICE
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Xüsusiyyət | Cloud LLM (GPT-4o) | Local SLM (Llama 3.2 / Phi-3) |
| :--- | :--- | :--- |
| **Xərc** | Token başına ödəniş (bahalı) | Sıfır token xərci (yalnız infra) |
| **Latency** | Şəbəkə asılılığı (yüksək) | Local network (aşağı, GPU-dan asılıdır) |
| **Data Privacy** | Məlumat kənara çıxır (PII riski) | Məlumat daxildə qalır (Təhlükəsiz) |
| **Dəqiqlik** | Çox yüksək (Generalist) | Konkret tapşırıqda yaxşı, mürəkkəb məntiqdə zəif |

---

## Production məsələləri

1.  **İnfrastruktur Tələbləri:** Yerli SLM işlətmək üçün Kubernetes klasterində GPU (NVIDIA A100/L40 və s.) dəstəkli node-lar lazımdır. Əgər GPU yoxdursa, CPU üzərində `quantized` (4-bit) modellər işlətmək mümkündür, lakin bu, saniyədə token sayını (TPS) aşağı salacaq.
2.  **Fallback Mexanizmi:** Yerli Ollama instance-ı həddən artıq yüklənərsə və ya cavab gecikərsə, avtomatik olaraq Cloud API-ya keçid (fallback) təmin edən `Resilience4j` dövrəsi qurulmalıdır.
3.  **Cold Start:** Konteyner ilk dəfə qalxdıqda modelin RAM-a yüklənməsi 10-30 saniyə çəkə bilər. `Pre-loading` metodlarından istifadə edin.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1.  **AI Task Inventory:** Komanda ilə birlikdə tətbiq olunan bütün AI funksiyalarının siyahısını çıxarın və onları "Sadə" (SLM-ə uyğun) və "Mürəkkəb" (LLM tələb edən) kateqoriyalarına bölün.
2.  **Hybrid Deployment:** Dev/Staging mühitlərində xərcləri azaltmaq üçün default model olaraq Ollama təyin edin, yalnız istehsalatda (Production) mühüm tapşırıqlar üçün Cloud provayderləri açın.
3.  **Monitoring:** SLM-in çıxardığı nəticələrin keyfiyyətini (Accuracy) mütəmadi olaraq LLM-lə müqayisə edən (LLM-as-a-judge) avtomatik testlər qurun.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Lokalda [Ollama](https://ollama.com/) yükləyin və `llama3.2:1b` (ən yüngül) modelini çəkin.
2.  Spring AI layihənizə `spring-ai-ollama-spring-boot-starter` əlavə edin.
3.  Mətnin sentiment analizi (Positive/Negative) üçün kiçik bir metod yazın və bunu həm OpenAI, həm də Ollama ilə yoxlayın. Nəticənin nə qədər oxşar və sürətli olduğunu analiz edin.

---

## Mənbələr

-   Spring AI Ollama Documentation: https://docs.spring.io/spring-ai/reference/api/chat/ollama.html (yoxlanılmalıdır)
-   Llama 3.2 Models (Meta): https://ai.meta.com/blog/llama-3-2-connect-2024/ (yoxlanılmalıdır)
-   Microsoft Phi-3.5 Documentation: https://huggingface.co/microsoft/Phi-3.5-mini-instruct (yoxlanılmalıdır)
