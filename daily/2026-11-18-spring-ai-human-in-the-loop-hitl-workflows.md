# Spring AI: Human-in-the-loop (HITL) və Manual Approval Workflows

**Tarix:** 2026-11-18 · **Kateqoriya:** AI Agents / Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM-lər "tool calling" vasitəsilə real dünyaya (verilənlər bazası, ödəniş sistemləri, email serverləri) çıxış əldə etdikdə, onların avtonomiyası risk yaradır. Tech Lead olaraq, kritik əməliyyatların (məsələn, $10,000-dan yuxarı transfer və ya istifadəçi silinməsi) LLM tərəfindən "təkbaşına" icra edilməsinə icazə verə bilməzsiniz. **Human-in-the-loop (HITL)** arxitekturası LLM-in qərarı ilə icra arasında bir "insan təsdiqi" (manual approval) qatı əlavə edərək həm təhlükəsizliyi, həm də sistemin şəffaflığını təmin edir.

---

## Əsas anlayışlar

1.  **Intercepted Tool Call:** LLM-in bir funksiyanı çağırmaq istədiyini bildirməsi, lakin sistemin həmin funksiyanı dərhal icra etməməsi.
2.  **Pending State:** Tool-un parametrlərinin və çağırış kontekstinin müvəqqəti saxlancda (məsələn, Redis) "gözləmədə" qalması.
3.  **Callback/Webhook:** İnsan interfeysindən (React UI, Slack, Email) gələn "Təsdiq" və ya "İmtina" siqnalı.
4.  **Resumption:** Təsdiqdən sonra LLM workflow-nun qaldığı yerdən davam etdirilməsi və nəticənin LLM-ə geri qaytarılması.

---

## Kod nümunəsi: Human Approval Interceptor

Aşağıdakı nümunədə biz Spring AI `ChatClient` üçün xüsusi bir `Advisor` vasitəsilə həssas tool-ların icrasını necə dayandıra biləcəyimizi simulyasiya edirik.

### 1. Həssas Tool Təyin Edilməsi

```java
public record TransferRequest(String toAccount, double amount) {}

@Component
public class PaymentService {
    
    @Bean
    @Description("Böyük məbləğli pul transferi edir. Təsdiq tələb edir.")
    public Function<TransferRequest, String> secureTransfer() {
        return request -> "Transfer uğurla başa çatdı: " + request.amount();
    }
}
```

### 2. HITL Advisor (İş axınını kəsən məntiq)

```java
import org.springframework.ai.chat.client.advisor.api.*;
import reactor.core.publisher.Mono;

public class HumanApprovalAdvisor implements CallAroundAdvisor {

    @Override
    public AdvisedResponse aroundCall(AdvisedRequest advisedRequest, CallAroundAdvisorChain chain) {
        // LLM-in tool çağırmaq istəyib-istəmədiyini yoxlayırıq (Simulyasiya)
        // Real ssenaridə burada ToolContext-ə baxılır
        
        boolean needsApproval = checkCondition(advisedRequest); 

        if (needsApproval) {
            // 1. Tool çağırışını dayandır
            // 2. State-i DB-yə yaz (Pending Request)
            // 3. İstifadəçiyə "Təsdiq gözlənilir" mesajı qaytar
            return createPendingResponse(advisedRequest);
        }

        return chain.nextAroundCall(advisedRequest);
    }

    private AdvisedResponse createPendingResponse(AdvisedRequest request) {
        // LLM-ə və ya UI-a xüsusi status kodu ilə cavab qaytarırıq
        return new AdvisedResponse(
            ChatResponse.builder()
                .withResult(new Generation("Əməliyyat təsdiq gözləyir. ID: " + UUID.randomUUID()))
                .withMetadata("status", "PENDING_APPROVAL")
                .build(), 
            request.adviseContext()
        );
    }
}
```

### 3. Workflow-un davam etdirilməsi (Controller səviyyəsində)

```java
@RestController
@RequestMapping("/ai/approval")
public class ApprovalController {

    private final ChatClient chatClient;
    private final PendingActionRepository repo;

    @PostMapping("/{actionId}/approve")
    public String approve(@PathVariable String actionId) {
        var action = repo.findById(actionId);
        
        // Əvvəlki söhbət tarixçəsini və gözləyən tool çağırışını götürürük
        // Və LLM-ə "İnsan bu əməliyyatı təsdiqlədi, davam et" mesajı ilə müraciət edirik
        return chatClient.prompt()
            .user("İstifadəçi " + actionId + " nömrəli əməliyyatı təsdiqlədi. İcra et.")
            .advisors(new MessageChatMemoryAdvisor(memory))
            .call()
            .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Xüsusiyyət | Synchronous Approval | Asynchronous Approval (Tövsiyə olunan) |
| :--- | :--- | :--- |
| **İstifadəçi Təcrübəsi** | Chat pəncərəsində "Dairə fırlanır", istifadəçi gözləyir. | İstifadəçi chat-dan çıxa bilər, təsdiq bildirişi (push notification) gəlir. |
| **Resurs İdarəsi** | Thread-lər bloklana bilər (Virtual Threads olsa belə timeout riski). | State DB-də saxlanılır, HTTP connection-lar bağlanır. |
| **Mürəkkəblik** | Sadədir, if/else məntiqidir. | State machine (məsələn, Spring Statemachine) və ya Persistance qatı tələb edir. |

---

## Production məsələləri

1.  **State Persistence:** Tool-un arqumentlərini (JSON) JSON-B və ya Jackson ilə bazada saxlayarkən, həmin tool-un metod imzasının dəyişmədiyinə əmin olun (Versioning).
2.  **Timeout:** Gözləmədə qalan təsdiqlər üçün "TTL" (Time-To-Live) təyin edin. 24 saat ərzində təsdiqlənməyən əməliyyatları "Expired" statusuna salın.
3.  **Audit Trail:** Kimin təsdiq etdiyi (Admin ID), nə vaxt etdiyi və LLM-in ilkin arqumentləri mütləq loqlanmalıdır. Bu, Compliance üçün vacibdir.

---

## Komandaya necə tətbiq etmək

1.  **Sensitivity Classification:** Funksiyaları (tools) "Safe" (məsələn, read-only data) və "Sensitive" (məsələn, write operations) olaraq qruplaşdırın.
2.  **UI/UX Patterns:** Frontend komandasına AI cavablarında `PENDING_APPROVAL` statusu gəldikdə xüsusi "Approve/Reject" düymələrini göstərən komponentlər hazırlatdırın.
3.  **Developer Experience:** Tərtibatçılar üçün bir `@RequiresApproval` annotasiyası yaradın və bunu Advisor vasitəsilə avtomatik oxuyun.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Bir `ChatClient` yaradın və ona `deleteUserAccount` adlı bir tool əlavə edin.
2.  Tool çağırışını simulyasiya edən bir `CallAroundAdvisor` yazın.
3.  Advisor daxilində əgər funksiya adı "deleteUserAccount"-dırsa, real funksiyanı çağırmaq əvəzinə `"Xahiş olunur, bu silmə əməliyyatını manual təsdiqləyin"` mesajı qaytarın.
4.  Asinxron təsdiq mexanizmini simulyasiya etmək üçün ikinci bir API endpoint yazın ki, o, LLM-ə təsdiqin gəldiyini "pıçıldasın".

---

## Mənbələr

-   Spring AI Advisors: https://docs.spring.io/spring-ai/reference/api/advisors.html (yoxlanılmalıdır)
-   Human-in-the-loop patterns in AI: https://www.anthropic.com/news/human-in-the-loop (konseptual)
-   Spring AI Tool Calling Documentation: https://docs.spring.io/spring-ai/reference/api/tools.html (yoxlanılmalıdır)
