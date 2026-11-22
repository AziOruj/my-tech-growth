# Spring AI: Self-RAG (Self-Reflective RAG) ilə Özünü Tənqid Edən Sistemlər

**Tarix:** 2026-11-22 · **Kateqoriya:** RAG / Advanced Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Dünən öyrəndiyimiz CRAG (Corrective RAG) əsasən gətirilən sənədlərin keyfiyyətinə fokuslanırdı. Lakin **Self-RAG** bir addım daha irəli gedir: o, həm sənədləri, həm də *modelin öz yaratdığı cavabı* tənqid süzgəcindən keçirir. Tech Lead olaraq, kritik biznes qərarları verən (məsələn, hüquqi və ya maliyyə məsləhətçisi) AI sistemlərində hallüsinasiyanı sıfıra endirmək üçün bu pattern əvəzedilməzdir. Self-RAG sistemə "mən bu suala cavab verə bilmirəm" və ya "verdiyim cavab sənədlərlə ziddiyyət təşkil edir" demək imkanı verir.

---

## Əsas anlayışlar

Self-RAG arxitekturası xüsusi "reflection" (əks-olunma) addımlarından ibarətdir:
1.  **Retrieve Decision:** Sualın cavabı üçün xarici məlumata ehtiyac varmı?
2.  **Is Relevant (IS_REL):** Gətirilən sənədlər suala həqiqətən cavab verirmi?
3.  **Is Supported (IS_SUP):** Yaradılan cavab sənədlərdəki faktlara əsaslanırmı (hallüsinasiya yoxdur ki)?
4.  **Is Useful (IS_USE):** Cavab istifadəçinin sualını tam bağlayırmı?

---

## Kod nümunəsi: Self-Reflective Orchestrator

Bu nümunədə cavabın doğruluğunu yoxlayan və lazım gəldikdə təkrar cəhd edən bir dövriyyə (loop) quracağıq.

### 1. Reflection Modelləri (Structured Output)

```java
public record CritiqueResult(
    boolean isSupportedByFacts, 
    boolean answersQuery, 
    String critiqueNote
) {}
```

### 2. Self-RAG Service

```java
@Service
public class SelfRagService {
    private final ChatClient chatClient;
    private final VectorStore vectorStore;

    public SelfRagService(ChatClient.Builder builder, VectorStore vectorStore) {
        this.chatClient = builder.build();
        this.vectorStore = vectorStore;
    }

    public String generateVerifiedAnswer(String userQuery) {
        // 1. Retrieval
        List<Document> docs = vectorStore.similaritySearch(
            SearchRequest.query(userQuery).withTopK(3)
        );
        String context = docs.stream().map(Document::getContent).collect(Collectors.joining("\n"));

        int maxRetries = 3;
        for (int i = 0; i < maxRetries; i++) {
            // 2. Generation
            String candidateAnswer = chatClient.prompt()
                .user(u -> u.text("Kontekst: {context}\nSual: {query}")
                    .param("context", context)
                    .param("query", userQuery))
                .call()
                .content();

            // 3. Self-Critique (Reflection)
            CritiqueResult critique = critiqueAnswer(userQuery, context, candidateAnswer);

            if (critique.isSupportedByFacts() && critique.answersQuery()) {
                return candidateAnswer; // Cavab təsdiqləndi
            }
            
            // Əgər səhvdirsə, növbəti dövriyyədə tənqidi nəzərə alaraq yenidən soruşuruq
            System.out.println("Tənqid: " + critique.critiqueNote());
        }

        return "Bağışlayın, kifayət qədər dəqiq cavab yaradıla bilmədi.";
    }

    private CritiqueResult critiqueAnswer(String query, String context, String answer) {
        return chatClient.prompt()
            .user(u -> u.text("""
                Sən bir tənqidçisən. Aşağıdakı cavabı bu meyarlarla qiymətləndir:
                1. Cavab kontekstdəki faktlara əsaslanırmı? (isSupportedByFacts)
                2. Cavab suala tam cavab verirmi? (answersQuery)
                
                Sual: {query}
                Kontekst: {context}
                Cavab: {answer}
                """)
                .param("query", query)
                .param("context", context)
                .param("answer", answer))
            .entity(CritiqueResult.class) // Structured Output
            .call()
            .entity();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Üstünlük | Trade-off |
| :--- | :--- |
| **Yüksək Dəqiqlik:** Hallüsinasiyalar model tərəfindən aşkar edilir. | **Yüksək Gecikmə (Latency):** Hər cavab üçün LLM ən azı 2 dəfə çağırılır. |
| **Fakt-mərkəzli:** Cavabın mənbəyə sadiqliyi təmin olunur. | **Token Xərci:** Bir neçə dəfəlik "retry" dövriyyələri xərci artırır. |
| **Özünü Təkmilləşdirmə:** Model tənqid qeydlərindən istifadə edərək növbəti cəhddə daha yaxşı cavab verir. | **Mürəkkəblik:** Döngü (loop) və state idarəetməsi lazımdır. |

---

## Production məsələləri

1.  **Asynchronous Critique:** Əgər istifadəçi "streaming" gözləyirsə, Self-RAG tətbiq etmək çətindir. Bu pattern daha çox backend-də işlənən batch proseslər və ya yüksək dəqiqlik tələb edən asinxron tapşırıqlar üçün idealdır.
2.  **Model Diversification:** Kritik sistemlərdə cavabı yaradan modellə (məs. GPT-4o), onu tənqid edən modelin (məs. Claude 3.5 Sonnet) fərqli olması tövsiyə olunur. Bu, modelin öz səhvini görməmə riskini azaldır.
3.  **Token Limits:** Dövriyyə sayını (`maxRetries`) kiçik saxlayın (2 və ya 3), əks halda sonsuz loop-lar və ya çox baha başa gələn sorğular yarana bilər.

---

## Komandaya necə tətbiq etmək

1.  **Audit Logs:** Bütün reflection nəticələrini (CritiqueResult) DB-yə yazın. Hansı sənədlərin modeldə daha çox "confused" yaratdığını analiz edin.
2.  **Fallback to Human:** Əgər 3 cəhddən sonra model hələ də özünü tənqid edirsə, sorğunu avtomatik olaraq bir "Human-in-the-loop" (HITL) növbəsinə yönləndirin.
3.  **Unit Testing:** Self-RAG-ın mürəkkəb olduğunu nəzərə alaraq, `CritiqueResult`-u simulyasiya edən Mock testlər yazın ki, loop məntiqiniz düzgün işləsin.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  `generateVerifiedAnswer` metodunu elə dəyişin ki, hər uğursuz cəhddən sonra əvvəlki səhv cavabı və tənqid qeydini (critiqueNote) növbəti prompt-a "nümunə kimi" daxil etsin (Few-shot prompting).
2.  **Challenge:** Əgər `isSupportedByFacts` false olarsa, sistemin Vector DB-dən yeni (fərqli) sənədlər gətirməsini (Re-retrieval) təmin edin.
3.  Java 21-in `StructuredTaskScope` imkanından istifadə edərək, eyni anda 2 fərqli modeldən tənqid alıb (Consensus pattern), yalnız hər ikisi "YES" dedikdə cavabı qəbul edən bir struktur qurun.

---

## Mənbələr

-   Self-RAG Research Paper: https://arxiv.org/abs/2310.11511
-   Spring AI Structured Output Reference: https://docs.spring.io/spring-ai/reference/api/structured-output-converter.html (yoxlanılmalıdır)
-   Building Reliable RAG Systems (Blog): https://spring.io/blog/category/ai (yoxlanılmalıdır)
