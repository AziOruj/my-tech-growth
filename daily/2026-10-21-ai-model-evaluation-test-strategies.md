# AI Modellərinin və RAG Cavablarının Qiymətləndirilməsi (Evaluation)

**Tarix:** 2026-10-21 · **Kateqoriya:** Evaluation / Testing · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır)

---

## Niyə vacibdir

Deterministik proqram təminatından fərqli olaraq, LLM-lər eyni sorğuya müxtəlif vaxtlarda fərqli cavablar verə bilər (non-deterministic). Tech Lead olaraq "Sistem yaxşı işləyir" demək üçün subyektiv hissiyat kifayət deyil. Xüsusilə RAG (Retrieval-Augmented Generation) sistemlərində modelin gətirdiyi sənədlərin suala uyğunluğunu (Relevancy) və modelin özündən yalan uydurmadığını (Faithfulness/Hallucination) kəmiyyətlərlə ölçməlisiniz. AI Evaluation, tətbiqin hər versiya yenilənməsində (və ya model dəyişikliyində) sistemin keyfiyyətinin pisləşmədiyinə (regression) əmin olmağın yeganə yoludur.

---

## Əsas anlayışlar

| Metrika / Anlayış | Təsviri |
|---|---|
| **Faithfulness (Sadiqlik)** | Modelin verdiyi cavabın yalnız təqdim olunan kontekstə (sənədlərə) əsaslanıb-əsaslanmadığını ölçür. Halüsinasiyanın qarşısını alır. |
| **Answer Relevancy** | Modelin cavabının istifadəçinin sualına nə dərəcədə birbaşa və dolğun cavab verdiyini ölçür. |
| **Context Precision** | Vektor bazasından gətirilən sənədlərin (context) sual üçün nə dərəcədə faydalı olduğunu ölçür. |
| **LLM-as-a-judge** | Bir modelin (məs: GPT-4o) digər modelin cavabını müəyyən kriteriyalar üzrə 1-5 arası balla və ya True/False olaraq qiymətləndirməsi. |
| **Ground Truth** | "Qızıl Standart" - müəyyən suallar üçün əvvəlcədən hazırlanmış ideal cavablar toplusu. |

---

## Kod nümunəsi

Spring AI 2.0+ versiyası `Evaluator` API-sini təqdim edir. Bu API bizə avtomatlaşdırılmış testlər yazmağa imkan verir. Aşağıda RAG sisteminin cavabını qiymətləndirən bir test nümunəsi verilmişdir.

### 1. Relevancy Evaluator-un qurulması

```java
package az.example.ai.evaluation;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.evaluation.EvaluationRequest;
import org.springframework.ai.evaluation.EvaluationResponse;
import org.springframework.ai.evaluation.RelevancyEvaluator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class RagEvaluationTests {

    @Autowired
    private ChatClient.Builder chatClientBuilder;

    @Test
    void testCustomerSupportRagRelevancy() {
        // 1. Setup: Qiymətləndirici LLM (adətən daha güclü bir model seçilir)
        ChatClient evaluatorChatClient = chatClientBuilder.build();
        RelevancyEvaluator evaluator = new RelevancyEvaluator(evaluatorChatClient);

        // 2. Test ssenarisi
        String userQuery = "Bankda hesabı necə açmaq olar?";
        String context = "Hesab açmaq üçün şəxsiyyət vəsiqəsi ilə filiallarımıza yaxınlaşmalısınız.";
        String aiResponse = "Siz istənilən filialımızda şəxsiyyət vəsiqənizi təqdim etməklə hesab aça bilərsiniz.";

        // 3. Qiymətləndirmə sorğusu
        // Burada həm sualı, həm konteksti, həm də modelin cavabını ötürürük
        EvaluationRequest evaluationRequest = new EvaluationRequest(
                userQuery, 
                List.of(), // Əlavə metadata (isteğe bağlı)
                aiResponse
        );

        // 4. İcra
        EvaluationResponse result = evaluator.evaluate(evaluationRequest);

        // 5. Assert: Modelin suala uyğun cavab verdiyini yoxlayırıq
        // pass = true/false qaytarır
        assertThat(result.isPass()).isTrue();
        System.out.println("Qiymətləndirmə nəticəsi: " + result.getScore()); // Ballı sistemdirsə
    }
}
```

### 2. Batch Evaluation (Toplu Qiymətləndirmə)

Real layihələrdə biz tək bir sualı deyil, "Dataset"-i yoxlamalıyıq.

```java
@Service
public class EvaluationService {

    private final RelevancyEvaluator relevancyEvaluator;

    public EvaluationService(ChatClient.Builder builder) {
        this.relevancyEvaluator = new RelevancyEvaluator(builder.build());
    }

    public void runFullSuite(List<TestCase> testCases) {
        long passed = testCases.stream()
            .map(tc -> {
                EvaluationRequest req = new EvaluationRequest(tc.query(), tc.context(), tc.actualResponse());
                return relevancyEvaluator.evaluate(req);
            })
            .filter(EvaluationResponse::isPass)
            .count();

        System.out.println("Success rate: " + (passed * 100.0 / testCases.size()) + "%");
    }
}

record TestCase(String query, List<org.springframework.ai.document.Document> context, String actualResponse) {}
```

---

## Arxitektura qərarları və trade-off-lar

1. **Evaluator Model Seçimi:**
   - **GPT-4o / Claude 3.5 Sonnet:** Çox bahalıdır, lakin "insan kimi" qiymətləndirmə aparır. Ground Truth yaradarkən istifadə olunur.
   - **GPT-4o-mini / Llama-3:** Ucuzdur, CI/CD-də sürətli qaçışlar üçün uyğundur.
   - **Trade-off:** Əgər evaluator modeliniz zəif olsa, o, səhv cavabı "düz" kimi qəbul edə bilər (False Positive).

2. **Deterministik vs LLM-based Eval:**
   - Sadə `String.contains()` və ya `Cosine Similarity` (embeddings) kifayət deyil, çünki model sinonimlər istifadə edə bilər. Lakin LLM-based eval daha gec və baha başa gəlir.

3. **CI/CD İnteqrasiyası:**
   - Hər commit-də bütün eval testlərini qaçırmaq (məsələn, 1000 test case) çox baha ola bilər. Tech Lead olaraq **"Smoke Eval"** (ən kritik 10 sual) və **"Weekly Full Eval"** strategiyasını qura bilərsiniz.

---

## Production məsələləri

- **Cost Control:** Evaluation zamanı modelə verilən context çox böyükdürsə, token xərci artır. Context-i trim (kəsmək) etmək və ya ən vacib sənədləri göndərmək lazımdır.
- **Data Privacy:** Evaluation zamanı real istifadəçi datası "judge" modelinə gedə bilər. Dünən keçdiyimiz **PII Masking** burada da tətbiq olunmalıdır.
- **Versioning:** Modelin temperaturunu (temperature) 0-a yaxın qoyun ki, qiymətləndirmənin özü də mümkün qədər stabil qalsın.

---

## Komandaya necə tətbiq etmək

1. **Ground Truth Kitabxanası:** Komanda ilə birlikdə sistemin cavab verməli olduğu ən vacib 50 sualı və onların ideal cavablarını bir JSON/CSV faylında toplayın.
2. **Dashboard Yaradın:** Micrometer ilə evaluation ballarını Prometheus-a göndərin və Grafana-da "AI Accuracy Score" qrafiki qurun.
3. **Fail-on-degradation:** CI/CD pipeline-da "Success rate" 85%-dən aşağı düşərsə, build-i dayandırın. Bu, modelin "təkmilləşdirilməsi" zamanı regression-ların qarşısını alacaq.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Spring AI projenizə `spring-ai-test-starter` (əgər varsa) və ya `RelevancyEvaluator` dəstəyini əlavə edin.
2. Bir RAG pipeline-ı simulyasiya edin (sənəd oxunması və cavab).
3. `RelevancyEvaluator` istifadə edərək 3 fərqli ssenari üçün test yazın:
   - Tam doğru cavab.
   - Tamamilə mövzudan kənar cavab (Hallucination).
   - Qismən doğru cavab.
4. Testlərin necə nəticələndiyini və balları (score) konsolda müşahidə edin.

---

## Mənbələr

- Spring AI Evaluation Sənədləri (yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/testing.html
- DeepLearning.AI - Evaluation of LLM Applications (yoxlanılmalıdır): https://www.deeplearning.ai/short-courses/evaluating-and-debugging-generative-ai/
- LangChain4j Evaluation API (alternativ olaraq): https://docs.langchain4j.dev/tutorials/rag/#evaluation
