# Spring AI: Query Transformation və HyDE (Hypothetical Document Embeddings)

**Tarix:** 2026-11-08 · **Kateqoriya:** RAG / Advanced Retrieval · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Klassik RAG sistemlərinin ən böyük zəif nöqtəsi istifadəçi sualları ilə korporativ sənədlərin leksik və semantik uyğunsuzluğudur (asymmetry problem). İstifadəçi "Kartım xaricdə niyə bloklandı?" soruşduqda, embedding modeli bu qısa sualın vektorunu korporativ bazadakı "Transsərhəd əməliyyatların risk qaydaları və avtomatik bloklanma şərtləri" adlı rəsmi sənədlə kifayət qədər yaxın məsafədə yerləşdirməyə bilər.

**Query Transformation** və xüsusilə **HyDE (Hypothetical Document Embeddings)** texnikası axtarışdan əvvəl LLM-dən istifadə edərək suala hipotetik (xəyali) cavab mətni yaradır və həmin cavabın embedding-i ilə vektor bazasında axtarış aparır. Tech Lead üçün bu, sıfır vektor bazası dəyişikliyi ilə RAG axtarış dəqiqliyini (Recall/Precision) 30-40% artıran güclü bir arxitektur naxışdır.

---

## Əsas anlayışlar

1.  **Query Asymmetry:** Sualların qısa, qeyri-müəyyən və sual tonunda, hədəf sənədlərin isə faktoloji, izahlı və rəsmi dildə olması səbəbindən vektor yaxınlığının (cosine similarity) zəifləməsi.
2.  **HyDE (Hypothetical Document Embeddings):** LLM-dən faktiki düzgünlüyündən asılı olmayaraq, suala bənzər saxta/hipotetik bir sənəd parçası yaratmasını istəmək və axtarışı məhz həmin sənədin vektoru ilə həyata keçirmək.
3.  **Query Expansion / Multi-Query:** Tək bir istifadəçi sualından fərqli bucaqlardan baxan 3-5 alternativ sorğu variantı generasiya edib axtarış nəticələrini birləşdirmək (Reciprocal Rank Fusion - RRF).
4.  **Query Rewriting:** Söhbət tarixçəsindəki əvvəlki cümlələrdən asılı olan sualı (məsələn: "Bəs onun qiyməti nə qədərdir?") müstəqil, aydın suala ("iPhone 16 Pro modelinin qiyməti nə qədərdir?") çevirmək.

---

## Kod nümunəsi: HyDE və Query Expansion Service

Aşağıdakı nümunədə Spring AI `ChatClient` və `VectorStore` istifadə edərək HyDE axtarış mexanizmi və Query Rewriting tətbiq olunur.

```java
package com.company.ai.retrieval;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class AdvancedRetrievalService {

    private static final Logger log = LoggerFactory.getLogger(AdvancedRetrievalService.class);

    private final ChatClient chatClient;
    private final VectorStore vectorStore;

    public AdvancedRetrievalService(ChatClient.Builder chatClientBuilder, VectorStore vectorStore) {
        this.chatClient = chatClientBuilder.build();
        this.vectorStore = vectorStore;
    }

    /**
     * HyDE yanaşması: Hipotetik sənəd yaradaraq vektor bazasında axtarış aparır.
     */
    public List<Document> retrieveWithHyDE(String userQuery, int topK) {
        log.info("Orijinal istifadəçi sualı: {}", userQuery);

        // 1. Hipotetik cavab mətni yaradılır (sürətli və ucuz model tövsiyə olunur)
        String hypotheticalDocPrompt = """
                Aşağıdakı suala cavab verə biləcək rəsmi, texniki və ya korporativ sənəd parçasını yaz.
                Cavabın faktiki olaraq 100% dəqiq olması şərt deyil, əsas məqsəd bu mövzuda bir sənədin
                işlədəcəyi terminologiya və cümlə strukturunu əks etdirməkdir. Yalnız sənəd mətnini qaytar.
                
                Sual: {query}
                """;

        String hypotheticalDocument = chatClient.prompt()
                .user(u -> u.text(hypotheticalDocPrompt).param("query", userQuery))
                .call()
                .content();

        log.debug("Generasiya edilmiş hipotetik sənəd:\n{}", hypotheticalDocument);

        // 2. Hipotetik sənədin mətni ilə Vector Store-da axtarış aparılır
        SearchRequest searchRequest = SearchRequest.builder()
                .query(hypotheticalDocument)
                .topK(topK)
                .similarityThreshold(0.70)
                .build();

        return vectorStore.similaritySearch(searchRequest);
    }

    /**
     * Söhbət tarixçəsinə əsasən sualı kontekstləşdirən Query Rewriter
     */
    public String rewriteQueryWithHistory(String rawQuery, List<String> chatHistory) {
        if (chatHistory == null || chatHistory.isEmpty()) {
            return rawQuery;
        }

        String historyText = String.join("\n", chatHistory);
        String rewritePrompt = """
                Aşağıdakı söhbət tarixçəsini və ən son sualı nəzərə alaraq,
                vektor axtarışı üçün təkbaşına aydın olan, heç bir əvəzlikdən (o, onlar, bu və s.)
                asılı olmayan tam bir axtarış cümləsi formalaşdır.
                
                Tarixçə:
                {history}
                
                Son sual: {query}
                
                Yalnız yenidən yazılmış sorğunu qaytar:
                """;

        return chatClient.prompt()
                .user(u -> u.text(rewritePrompt)
                        .param("history", historyText)
                        .param("query", rawQuery))
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Yanaşma | Üstünlükləri | Çatışmazlıqları / Risk | İstifadə Yeri |
| :--- | :--- | :--- | :--- |
| **Standard Retrieval** | Tək sorğu, ən aşağı latency (50-100ms) və minimum xərc. | Asimmetrik və qısa suallarda semantik boşluq; zəif recall. | Sadə FAQ və aydın açar sözlərlə axtarış. |
| **HyDE** | Sənəd-sənəd yaxınlığı əldə edilir; terminologiya zənginliyi təmin olunur. | Əlavə LLM çağırışı (+300-800ms latency); LLM tamamilə fərqli mövzuya yönələrsə "hallucinated drift". | İzahedici, texniki və hüquqi sənədlərdə qabaqcıl RAG. |
| **Multi-Query (Expansion)** | Mövzunu müxtəlif bucaqlardan əhatə edir; tapılmama ehtimalını minimuma endirir. | N sayda axtarış sorğusu, nəticələrin deduplikasiyası və rerank edilməsi ehtiyacı. | Mürəkkəb analitik və çoxşaxəli istifadəçi sualları. |

---

## Production məsələləri

1.  **Latency İdarəsi (Model Seçimi):** HyDE addımında `gpt-4o` və ya `claude-3-opus` kimi ağır modellərdən istifadə etmək gecikməni (latency) kritik həddə çatdırar. HyDE generasiyası üçün **GPT-4o-mini**, **Llama 3.1 8B** və ya **Haiku** kimi yüngül, ultra-sürətli modellərdən istifadə edin.
2.  **Hipotetik Hallusinasiya Filtri:** Hipotetik sənəd orijinal sualdan çox uzaqlaşarsa (drift), similarity threshold parametrini (məsələn, 0.65-0.70) qoruma mexanizmi kimi saxlayın. Lazım gələrsə həm orijinal sorğunun, həm də HyDE nəticələrinin birləşməsini (union) götürün.
3.  **Xərc və Token İstehlakı:** HyDE hər istifadəçi sorğusuna +1 LLM çağırışı əlavə edir. Eyni tipli sorğular üçün Semantic Cache tətbiq etməklə bu xərci minimuma endirmək şərtdir.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1.  **Retrieval Evaluation Baseline:** Komandaya tapşırın ki, mövcud RAG sistemində cavab verə bilməyən və ya səhv chunk-lar tapan 20 çətin sual toplusu (Golden Dataset) qursunlar.
2.  **Strategy Pattern Tətbiqi:** Axtarış üçün `RetrievalStrategy` interfeysi yaradın (`StandardRetrievalStrategy`, `HyDeRetrievalStrategy`). Bunu Feature Flag (məsələn, LaunchDarkly və ya Spring Cloud Config) vasitəsilə A/B test edin.
3.  **Advisors ilə İnteqrasiya:** Spring AI-nin `ChatClient` Advisors zəncirinə HyDE və ya Query Rewriter addımını daxil edin ki, domen servisləri axtarışın arxa planda necə çevrildiyindən xəbərsiz qalsın (separation of concerns).

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Spring AI layihənizdə `QueryTransformationService` yaradın.
2.  Bir istifadəçi sualı üçün HyDE yanaşması ilə hipotetik sənəd yaradın və `SearchRequest`-də query kimi bu sənəddən istifadə edərək pgvector bazanızdan chunk-ları çəkin.
3.  Eyni sualı birbaşa axtarışla və HyDE axtarışı ilə müqayisə edin: tapılan sənədlərin keyfiyyət və relevantlıq fərqini konsolda analiz edin.

---

## Mənbələr

-   Original HyDE Research Paper (Gao et al.): https://arxiv.org/abs/2212.10496 (yoxlanılmalıdır)
-   Spring AI VectorStore Reference: https://docs.spring.io/spring-ai/reference/api/vectortore.html (yoxlanılmalıdır)
-   Spring AI ChatClient Documentation: https://docs.spring.io/spring-ai/reference/api/chatclient.html (yoxlanılmalıdır)
