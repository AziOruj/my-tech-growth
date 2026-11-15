# Spring AI: Tool Calling Reliability və Accuracy Testing

**Tarix:** 2026-11-15 · **Kateqoriya:** Testing & Evaluation · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Spring AI ilə Tool Calling (Function Calling) tətbiq etdikdə, sistemin deterministik olmayan bir hissəsini (LLM) backend-in deterministik hissəsi ilə (sizin kodunuz) birləşdirirsiniz. Tech Lead olaraq ən böyük riskiniz: **LLM-in doğru funksiyanı çağırmaması** və ya **parametrləri səhv (hallucinated) ötürməsidir.** Məsələn, "Son 3 ayı ləğv et" sorğusunda LLM `cancelOrder(orderId)` əvəzinə `deleteAllOrders()` çağıra bilər. Bu tip xətaları adi Unit testlərlə tutmaq çətindir; bizə "Accuracy Evaluation" lazımdır.

---

## Əsas anlayışlar

1.  **Tool Selection Accuracy:** LLM-in mövcud 10 funksiyadan məhz lazımi olanı seçmə ehtimalı.
2.  **Parameter Extraction Accuracy:** Seçilmiş funksiyaya ötürülən arqumentlərin (JSON) doğruluğu (məsələn, tarixin ISO formatında olması).
3.  **Golden Dataset:** Test üçün hazırlanmış "Sual -> Gözlənilən Funksiya -> Gözlənilən Parametrlər" cütlüklərindən ibarət referans siyahısı.
4.  **Evaluators:** LLM-in çıxışını həmin Golden Dataset ilə müqayisə edən və "Keçdi/Qaldı" qərarı verən avtomatlaşdırılmış skriptlər və ya başqa bir LLM (Judge LLM).

---

## Kod nümunəsi: Tool Calling Accuracy Test

Spring AI 2.0.x ilə gələn test infrastrukturu vasitəsilə LLM-in tool calling performansını necə ölçəcəyimizə baxaq.

### 1. Test üçün Golden Dataset Modelini yaradaq

```java
public record ToolEvaluationCase(
    String userInput,
    String expectedFunctionName,
    Map<String, Object> expectedArgs
) {}
```

### 2. Tool Calling Evaluator-un tətbiqi

```java
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class ToolCallingAccuracyTests {

    @Autowired
    private ChatClient.Builder chatClientBuilder;

    @Test
    void evaluateOrderManagementTools() {
        // Golden Dataset: Real ssenarilər
        var testCases = List.of(
            new ToolEvaluationCase(
                "Order #555-i ləğv et", 
                "cancelOrder", 
                Map.of("orderId", "555")
            ),
            new ToolEvaluationCase(
                "Statusu 'SHIPPED' olan sifarişləri göstər", 
                "listOrders", 
                Map.of("status", "SHIPPED")
            )
        );

        ChatClient client = chatClientBuilder
            .defaultFunctions("cancelOrder", "listOrders") // Qeydiyyatdan keçmiş bean-lər
            .build();

        for (var testCase : testCases) {
            ChatResponse response = client.prompt()
                .user(testCase.userInput())
                .call()
                .chatResponse();

            AssistantMessage assistantMessage = response.getResult().getOutput();
            
            // LLM-in bir tool çağırdığını yoxlayırıq
            assertThat(assistantMessage.getToolCalls()).isNotEmpty();
            
            var toolCall = assistantMessage.getToolCalls().get(0);
            
            // 1. Tool Selection Accuracy
            assertThat(toolCall.name()).isEqualTo(testCase.expectedFunctionName());
            
            // 2. Parameter Extraction Accuracy
            // Qeyd: JSON müqayisəsi üçün Jackson ObjectMapper istifadə edin
            assertThat(toolCall.arguments()).containsAllEntriesOf(testCase.expectedArgs());
        }
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Yanaşma | Üstünlüyü | Çatışmazlığı |
| :--- | :--- | :--- |
| **Exact Match (Assertion)** | Qəti və ucuzdur. Kod səviyyəsində yoxlanılır. | LLM-in kiçik variasiyalarına (məsələn, "555" vs 555) qarşı çox həssasdır (fraqildir). |
| **LLM-as-a-Judge** | Mənanı anlayır, sinonimləri qəbul edir. | Testin özü üçün əlavə xərc və vaxt tələb olunur. Test nəticəsi özü də qeyri-deterministik ola bilər. |
| **Schema Validation** | Arqumentlərin tipinin düzgünlüyünü (Type Safety) təmin edir. | Tool-un düzgün seçildiyini yoxlamır, yalnız formatı yoxlayır. |

---

## Production məsələləri

1.  **Negative Testing:** Golden Dataset-ə elə suallar əlavə edin ki, onlar heç bir tool-u tetikləməməlidir. LLM-in "bilmirəm" deməsi, səhv tool çağırmasından daha təhlükəsizdir.
2.  **Versioning:** Tool-un təsvirini (Description) dəyişdikdə bu testləri mütləq işə salın. Kiçik bir söz dəyişikliyi LLM-in seçimini 90% accuracy-dən 40%-ə sala bilər.
3.  **CI/CD Pipeline:** Bu testlər "Integration Tests" kateqoriyasına düşür. Hər commit-də deyil, pull-request səviyyəsində işlədilməsi məsləhətdir (token xərclərinə görə).

---

## Komandaya necə tətbiq etmək

1.  **Requirement as Tool:** Analitiklərdən yeni bir funksiya istədikdə, həm də həmin funksiyanın hansı suallar tərəfindən çağırılacağını (test cases) istəyin.
2.  **Accuracy Dashboard:** Komandada hər sprint sonu "Tool Selection Accuracy" faizini izləyin. Hədəf 95%+, əks halda prompt engineering və ya fine-tuning tələb olunur.
3.  **Observability Link:** Real production loglarından gələn "LLM səhv tool çağırdı" şikayətlərini birbaşa Golden Dataset-ə yeni test case kimi əlavə edin (Bug -> Test conversion).

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Spring AI layihənizdə bir `ToolCallingAccuracyTests` yaradın.
2.  İki fərqli funksiya (məsələn, `sendEmail` və `archiveEmail`) üçün 5 ədədlik Golden Dataset qurun.
3.  Testi işə salın və parametr formatlarındakı (məsələn, `String` vs `Integer`) uyğunsuzluqların testi necə kəsdiyini müşahidə edin.
4.  Funksiyanın `@Description` hissəsini qəsdən dumanlı (vague) yazaraq LLM-in səhv tool seçməsinə nail olun və testin bunu necə tutduğunu görün.

---

## Mənbələr

-   Spring AI Testing Support: https://docs.spring.io/spring-ai/reference/api/testing.html (yoxlanılmalıdır)
-   OpenAI Function Calling Evaluation Guide: https://platform.openai.com/docs/guides/function-calling (yoxlanılmalıdır)
-   LangChain Benchmarks for Tool Calling: https://github.com/langchain-ai/langchain/tree/master/libs/core/langchain_core/utils/function_calling (konseptual oxşarlıq üçün)
