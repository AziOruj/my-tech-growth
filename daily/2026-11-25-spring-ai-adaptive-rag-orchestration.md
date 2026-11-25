# Spring AI: Adaptive RAG Orchestration (Adaptiv RAG Strategiyaları)

**Tarix:** 2026-11-25 · **Kateqoriya:** RAG / AI Agents · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Son bir neçə gündə öyrəndiyimiz CRAG və Self-RAG texnikaları çox güclüdür, lakin hər sorğu üçün bu qədər hesablama resursu sərf etmək səmərəli deyil. **Adaptive RAG**, daxil olan sualın mürəkkəbliyinə görə fərqli "yollar" (pathways) seçən bir orkestrasiya qatıdır. Tech Lead kimi məqsədiniz həm "Nahar menyusu nədir?" kimi sadə sualları milisaniyələr ərzində cavablandırmaq, həm də "Son rübün maliyyə hesabatını keçən illə müqayisə et" kimi mürəkkəb analizləri dərin RAG döngələri ilə həll etməkdir. Bu, həm istifadəçi təcrübəsini (latency), həm də LLM xərclərini optimallaşdırır.

---

## Əsas anlayışlar

Adaptive RAG sistemində sorğu üç əsas marşrutdan birinə yönləndirilir:
1.  **No RAG (Direct Response):** Ümumi biliklər və ya salamlaşma üçün.
2.  **Standard/Simple RAG:** Vector DB-də birbaşa tapıla bilən faktik suallar üçün.
3.  **Complex/Agentic RAG:** Bir neçə sənədin birləşdirilməsini, CRAG və ya veb axtarışı tələb edən suallar üçün.

Bu qərarı verən komponent **Query Classifier (Router)** adlanır.

---

## Kod nümunəsi: Adaptive Router Implementation

Java 21-in `switch` expression və `sealed interfaces` imkanlarından istifadə edərək təmiz bir orkestrator quraq.

### 1. Marşrut Tipləri

```java
public enum RouteType {
    DIRECT_ANSWER, SIMPLE_RAG, COMPLEX_REFLECTIVE_RAG
}

public record RoutingDecision(RouteType route, String reasoning) {}
```

### 2. Adaptive RAG Service

```java
@Service
public class AdaptiveRagService {
    private final ChatClient chatClient;
    private final VectorStore vectorStore;
    private final SelfRagService selfRagService; // Əvvəlki dərsimizdən

    public AdaptiveRagService(ChatClient.Builder builder, VectorStore vectorStore, SelfRagService selfRagService) {
        this.chatClient = builder.build();
        this.vectorStore = vectorStore;
        this.selfRagService = selfRagService;
    }

    public String handleQuery(String userQuery) {
        // 1. Classifier: Sualın tipini müəyyən et
        RoutingDecision decision = classifyQuery(userQuery);
        
        // 2. Adaptive Routing (Java 21 switch expression)
        return switch (decision.route()) {
            case DIRECT_ANSWER -> executeDirect(userQuery);
            case SIMPLE_RAG -> executeSimpleRag(userQuery);
            case COMPLEX_REFLECTIVE_RAG -> selfRagService.generateVerifiedAnswer(userQuery);
        };
    }

    private RoutingDecision classifyQuery(String query) {
        return chatClient.prompt()
            .user(u -> u.text("""
                Sən ağıllı bir sorğu marşrutlayıcısısan. 
                Sualı analiz et və ən uyğun yolu seç:
                - DIRECT_ANSWER: Salamlaşma və ya ümumi bilik.
                - SIMPLE_RAG: Tək bir faktın Vector DB-dən tapılması.
                - COMPLEX_REFLECTIVE_RAG: Müqayisə, analiz və ya dəqiqlik tələb edən suallar.
                
                Sual: {query}
                """).param("query", query))
            .entity(RoutingDecision.class)
            .call()
            .entity();
    }

    private String executeSimpleRag(String query) {
        // Standart Vector Search + Context
        return chatClient.prompt()
            .advisors(new QuestionAnswerAdvisor(vectorStore))
            .user(query)
            .call()
            .content();
    }

    private String executeDirect(String query) {
        return chatClient.prompt().user(query).call().content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Strategiya | Gecikmə (Latency) | Xərc (Cost) | Dəqiqlik |
| :--- | :--- | :--- | :--- |
| **Static RAG** | Sabit | Sabit | Orta (bəzən lazımsız RAG edir) |
| **Adaptive RAG** | Dinamik (sualların 70%-də aşağı) | Aşağı (resurs qənaəti) | Yüksək (hər suala uyğun metod) |

**Trade-off:** Router-in özü də bir LLM çağırışıdır. Əgər router yavaş işləyirsə, bu bütün sistemi yavaşlada bilər. Kiçik və sürətli bir modeldən (məs. GPT-4o-mini və ya yerli Llama-3-8B) router kimi istifadə etmək məsləhətdir.

---

## Production məsələləri

1.  **Router Overheating:** Əgər bütün suallar `COMPLEX_REFLECTIVE_RAG`-a gedirsə, router prompt-unuzu və ya təsnifat meyarlarınızı nəzərdən keçirin.
2.  **Observability:** Hansı marşrutun daha çox istifadə edildiyini Micrometer counter-ləri ilə izləyin. Məsələn: `meterRegistry.counter("rag.adaptive.route", "type", decision.route().name()).increment();`
3.  **Fallback Logic:** Əgər router uğursuz olarsa (timeout və s.), həmişə təhlükəsiz variant kimi `SIMPLE_RAG`-a fallback edin.

---

## Komandaya necə tətbiq etmək

1.  **Golden Dataset:** Komandanıza müxtəlif mürəkkəblikdə 50 sualdan ibarət test dəsti hazırlatdırın. Router-in bu sualları düzgün marşrutlara yönləndirdiyini yoxlayan avtomatik testlər qurun.
2.  **Cost Analysis:** Rəhbərliyə Adaptive RAG-ın tətbiqindən sonra token xərclərində yaranan qənaəti (məs. "Sadə suallar üçün 80% daha ucuz model istifadə edirik") hesabat olaraq təqdim edin.
3.  **Asynchronous Routing:** Router qərar verərkən Vector DB axtarışını paralel başlada bilərsiniz (Java Virtual Threads ilə), beləliklə qərar hazır olanda məlumatlar artıq əlinizdə olar.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  `RoutingDecision` strukturuna `confidenceScore` əlavə edin. Əgər router-in inamı 0.6-dan aşağıdırsa, sistem avtomatik olaraq `COMPLEX_REFLECTIVE_RAG` yolunu seçsin.
2.  **Challenge:** Java 21-in `StructuredTaskScope.ShutdownOnSuccess` obyektindən istifadə edərək, həm `DIRECT_ANSWER` (LLM), həm də `SIMPLE_RAG` (Vector DB) proseslərini eyni anda başladın. Əgər LLM birbaşa cavab verə bilirsə (və ya router qərarı sürətlidirsə), digərini ləğv edin.
3.  Local LLM (Ollama) vasitəsilə kiçik bir router modeli qurun və Spring AI-da `ChatModel` olaraq onu router-ə bağlayın, əsas tapşırıqlar üçün isə OpenAI/Anthropic modelindən istifadə edin.

---

## Mənbələr

-   Adaptive RAG (LangChain Blog - Pattern explanation): https://blog.langchain.dev/adaptive-rag/
-   Spring AI Advisors: https://docs.spring.io/spring-ai/reference/api/advisors.html (yoxlanılmalıdır)
-   Java 21 Patterns in Action: https://openjdk.org/jeps/441 (Switch patterns) (yoxlanılmalıdır)
