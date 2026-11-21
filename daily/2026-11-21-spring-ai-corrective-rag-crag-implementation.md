# Spring AI: Corrective RAG (CRAG) Pattern ilə RAG Keyfiyyətinin Artırılması

**Tarix:** 2026-11-21 · **Kateqoriya:** RAG / Advanced Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Standart RAG (Retrieval-Augmented Generation) sistemlərinin ən böyük problemi "GIGO" (Garbage In, Garbage Out) prinsipidir. Əgər Vector DB-dən gələn sənədlər istifadəçinin sualı ilə birbaşa əlaqəli deyilsə, LLM səhv və ya hallüsinasiya dolu cavab verəcəkdir. **Corrective RAG (CRAG)** arxitekturası retrieved sənədləri generativ mərhələyə keçməzdən əvvəl "qiymətləndirən" bir qat əlavə edir. Tech Lead olaraq bu pattern-i tətbiq etməklə siz sistemin etibarlılığını (reliability) və cavab dəqiqliyini kritik dərəcədə artıra bilərsiniz.

---

## Əsas anlayışlar

1.  **Retrieval Evaluator:** Gətirilən sənədlərin suala nə dərəcədə uyğun olduğunu yoxlayan komponent (çox vaxt kiçik və sürətli bir LLM).
2.  **Knowledge Refinement:** Sənəddəki artıq (noise) məlumatların təmizlənməsi.
3.  **Web Search Fallback:** Əgər Vector DB-də uyğun məlumat yoxdursa, sistemin avtomatik olaraq internetdə (məsələn, Tavily və ya Google Search API vasitəsilə) axtarış etməsi.
4.  **Confidence Threshold:** Sənədin "kifayət qədər yaxşı" olub-olmadığını müəyyən edən hədd.

---

## Kod nümunəsi: CRAG Workflow İcraçısı

Bu nümunədə biz sənədləri qiymətləndirən və lazım gəldikdə "web search" moduluna keçid edən bir servis quracağıq.

### 1. Qiymətləndirmə Modeli (Evaluator)

```java
public record EvaluationResult(boolean isRelevant, double confidenceScore) {}

@Service
public class DocumentEvaluator {
    private final ChatClient chatClient;

    public DocumentEvaluator(ChatClient.Builder builder) {
        this.chatClient = builder
            .defaultSystem("Sən sənəd qiymətləndiricisisən. Verilmiş sənədin istifadəçi sualına RELEVANT (uyğun) və ya IRRELEVANT (uyğun deyil) olduğunu müəyyən et.")
            .build();
    }

    public boolean checkRelevance(String query, String documentContent) {
        String response = chatClient.prompt()
                .user(u -> u.text("Sual: {query}\nSənəd: {doc}\nCavab (Yalnız 'YES' və ya 'NO'):")
                        .param("query", query)
                        .param("doc", documentContent))
                .call()
                .content();
        
        return response != null && response.trim().equalsIgnoreCase("YES");
    }
}
```

### 2. CRAG Service Orchestrator

```java
@Service
public class CorrectiveRagService {
    private final VectorStore vectorStore;
    private final DocumentEvaluator evaluator;
    private final ChatClient chatClient;
    // Təsəvvür edək ki, xarici axtarış üçün bir servisimiz var
    private final WebSearchService webSearchService; 

    public CorrectiveRagService(VectorStore vectorStore, DocumentEvaluator evaluator, 
                               ChatClient.Builder builder, WebSearchService webSearchService) {
        this.vectorStore = vectorStore;
        this.evaluator = evaluator;
        this.chatClient = builder.build();
        this.webSearchService = webSearchService;
    }

    public String getAnswer(String userQuery) {
        // 1. Retrieval
        List<Document> docs = vectorStore.similaritySearch(
            SearchRequest.query(userQuery).withTopK(3)
        );

        // 2. Evaluation
        boolean hasRelevantDocs = docs.stream()
                .anyMatch(doc -> evaluator.checkRelevance(userQuery, doc.getContent()));

        String context;
        if (hasRelevantDocs) {
            // Relevat sənədləri birləşdir
            context = docs.stream()
                    .filter(doc -> evaluator.checkRelevance(userQuery, doc.getContent()))
                    .map(Document::getContent)
                    .collect(Collectors.joining("\n"));
        } else {
            // 3. Fallback to Web Search
            context = webSearchService.search(userQuery);
        }

        // 4. Final Generation
        return chatClient.prompt()
                .user(u -> u.text("Kontekst: {context}\nSual: {query}")
                        .param("context", context)
                        .param("query", userQuery))
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Addım | Üstünlük | Trade-off |
| :--- | :--- | :--- |
| **LLM Evaluator** | Sənədin mənasını başa düşərək qiymətləndirir. | Hər RAG prosesinə əlavə gecikmə (latency) əlavə edir. |
| **Web Search Fallback** | Bazada olmayan suallara cavab verə bilir. | Xarici API asılılığı və əlavə xərc. |
| **Filtering docs** | LLM-ə yalnız təmizlənmiş data göndərir. | Bəzən "zəif" əlaqəli sənədlərdəki vacib detalları itirə bilər. |

**Tech Lead Tövsiyəsi:** Evaluator üçün həmişə ən ucuz və ən sürətli modeli (məsələn, GPT-4o-mini və ya yerli Llama-3-8B) istifadə edin. Məqsəd sənədi "anlamaq" deyil, sadəcə "uyğunluq yoxlaması" etməkdir.

---

## Production məsələləri

1.  **Parallel Evaluation:** Əgər 5-10 sənəd gətirirsinizsə, bunları `evaluator.checkRelevance` ilə dövrə salmaq əvəzinə Java-nın **Virtual Threads** (Project Loom) imkanlarından istifadə edərək paralel yoxlayın.
2.  **Prompt Refinement:** Evaluator üçün prompt-u çox sərt (strict) qoymayın. Sənəddə sualın cavabının yalnız bir hissəsi olsa belə, onu `YES` kimi qəbul etmək daha təhlükəsizdir.
3.  **Observability:** Neçə faiz sorğunun Web Search-ə "fallback" etdiyini izləyin. Əgər bu rəqəm yüksəkdirsə, Vector DB-dəki data-nızın köhnəldiyini və ya yetərsiz olduğunu anlayacaqsınız.

---

## Komandaya necə tətbiq etmək

1.  **Iterative implementation:** Əvvəlcə standart RAG qurun, sonra evaluator qatını əlavə edin.
2.  **Evaluation Dataset:** Komandaya tapşırın ki, "bilərəkdən" bazada olmayan suallar siyahısı hazırlasınlar (Web search fallback-in işləməsini yoxlamaq üçün).
3.  **Tooling:** Web search üçün `TavilySearch` və ya `SerpApi` kimi hazır Spring AI inteqrasiyalarını nəzərdən keçirin.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Mövcud RAG layihənizdə bir `DocumentEvaluator` yaradın.
2.  `CompletableFuture` və ya `StructuredTaskScope` (Java 21+) istifadə edərək gətirilən 3 sənədin relevatlığını paralel yoxlayan kod yazın.
3.  Simulyasiya edilmiş bir `WebSearchService` yaradın (bazada məlumat olmayanda "İnternetdən məlumat gətirildi..." mesajı qaytarsın).
4.  **Challenge:** Evaluator-un cavablarını `Structured Output` (dünənki mövzulardan xatırlayın) vasitəsilə JSON formatında alın (məs: `{"relevant": true, "reason": "..."}`).

---

## Mənbələr

-   CRAG Paper (Original): https://arxiv.org/abs/2401.15884
-   Spring AI Advisors documentation: https://docs.spring.io/spring-ai/reference/api/advisors.html (yoxlanılmalıdır)
-   Project Loom (Virtual Threads) in Spring: https://spring.io/blog/2022/10/11/embracing-virtual-threads (yoxlanılmalıdır)
