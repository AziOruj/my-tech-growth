# LangChain4j ilə Qabaqcıl RAG: Metadata Filtering və Re-ranking

**Tarix:** 2026-10-26 · **Kateqoriya:** RAG / LangChain4j · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · LangChain4j 1.0.0 (yoxlanılmalıdır)

---

## Niyə vacibdir

Sadə RAG (Naive RAG) sistemləri çox vaxt "küy" (noise) gətirir. Əgər minlərlə sənədiniz varsa, yalnız semantik oxşarlıq (cosine similarity) kifayət etmir. Tech Lead olaraq bilməlisiniz ki, modelin cavab keyfiyyətini artırmaq üçün iki kritik addım var: **Metadata Filtering** (lazımsız sənədləri əvvəlcədən kəsmək) və **Re-ranking** (tapılmış sənədləri daha dəqiq model ilə yenidən sıralamaq). Bu, həm "hallucination" riskini azaldır, həm də token xərclərinə qənaət edir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **Metadata Filtering** | Vektor axtarışından əvvəl və ya axtarış zamanı sənədləri müəyyən atributlara (məs: `user_id`, `date`, `category`) görə süzgəcdən keçirmək. |
| **ContentRetriever** | LangChain4j-də sənədlərin tapılması məntiqini abstraksiya edən interfeys. |
| **Scoring Model (Re-ranker)** | İlkin tapılmış (məsələn, 20 sənəd) nəticəni analiz edib, onların suala həqiqətən nə dərəcədə uyğun olduğunu 0-1 arası balla qiymətləndirən model. |
| **Cross-Encoder** | Re-ranking üçün istifadə olunan, bi-encoder-lərdən (embedding) daha yavaş, lakin daha dəqiq olan model tipi. |

---

## Kod nümunəsi: Professional RAG Konfiqurasiyası

Bu nümunədə biz sənədləri yalnız müəyyən bir müştəriyə aid olanlar içərisindən axtaracağıq və tapılan nəticələri **Cohere Re-ranker** ilə yenidən sıralayacağıq.

### 1. Maven Dependency (pom.xml)

```xml
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-cohere</artifactId>
    <version>1.0.0</version> <!-- yoxlanılmalıdır -->
</dependency>
```

### 2. Advanced RAG Konfiqurasiyası

```java
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.cohere.CohereScoringModel;
import dev.langchain4j.model.scoring.ScoringModel;
import dev.langchain4j.rag.DefaultRetrievalAugmentor;
import dev.langchain4j.rag.RetrievalAugmentor;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.rag.query.Metadata;
import dev.langchain4j.rag.query.filter.Filter;
import dev.langchain4j.rag.query.filter.MetadataFilterBuilder;
import dev.langchain4j.store.embedding.EmbeddingStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RAGConfiguration {

    @Bean
    public RetrievalAugmentor retrievalAugmentor(
            EmbeddingStore<TextSegment> embeddingStore,
            EmbeddingModel embeddingModel,
            ScoringModel scoringModel) {

        // 1. Metadata Filtering: Yalnız "HR" departamentinə aid sənədləri axtar
        Filter departmentFilter = MetadataFilterBuilder.metadataKey("dept").isEqualTo("HR");

        ContentRetriever contentRetriever = EmbeddingStoreContentRetriever.builder()
                .embeddingStore(embeddingStore)
                .embeddingModel(embeddingModel)
                .maxResults(10) // İlkin olaraq 10 sənəd tap
                .filter(departmentFilter)
                .build();

        // 2. Re-ranking: Tapılan 10 sənədi Cohere ilə yenidən sırala və ən yaxşı 3-nü seç
        return DefaultRetrievalAugmentor.builder()
                .contentRetriever(contentRetriever)
                .scoringModel(scoringModel)
                .minScore(0.7) // Yalnız 0.7-dən yuxarı nəticələri saxla
                .build();
    }

    @Bean
    public ScoringModel scoringModel() {
        return CohereScoringModel.withApiKey(System.getenv("COHERE_API_KEY"));
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **Pre-filtering vs Post-filtering:**
   - **Pre-filtering:** (Yuxarıdakı nümunə) Axtarış bazasını daraldır, daha sürətlidir və dəqiqdir. Lakin hər sənədin metadatası vektor bazasında (məs: pgvector) düzgün indekslənməlidir.
   - **Post-filtering:** LLM-ə göndərmədən əvvəl Java kodunda süzməkdir. Bu, yavaşdır və lazım olan sayda (top-k) nəticə qaytarmaya bilər (çünki süzgəcdən sonra əldə az sənəd qalır).

2. **Re-ranking Latency:**
   - Re-ranking əlavə bir şəbəkə çağırışıdır (Cohere və ya Jina AI). Bu, cavab müddətinə 200ms-500ms əlavə edə bilər. Lakin "Precision" (dəqiqlik) kritik olan sistemlərdə (məs: hüquqi və ya tibbi sənədlər) bu mütləqdir.

3. **Hybrid Search:**
   - LangChain4j həmçinin həm Keyword (BM25), həm də Vector axtarışını birləşdirməyə imkan verir. Re-ranker bu iki fərqli mənbədən gələn nəticələri vahid bir sıralamaya salmaq üçün ən yaxşı alətdir.

---

## Production məsələləri

- **Cost Optimization:** Hər re-ranking çağırışı puldur. `maxResults` parametrini ilkin mərhələdə çox yüksək (məs: 100) qoymayın, çünki re-ranker hər bir sənəd üçün token xərcləyir.
- **Tenant Isolation:** Multitenant sistemlərdə metadata filtering seçimləri deyil, məcburiyyətdir. Səhvən digər müştərinin məlumatının axtarışa düşməsi ən böyük təhlükəsizlik boşluğudur (`Filter.metadataKey("tenant_id").isEqualTo(...)`).
- **Cold Start:** Əgər öz re-ranker modelinizi (məs: HuggingFace-dən) Java daxilində (ONNX runtime ilə) işlədirsinizsə, ilk sorğularda gecikməyə hazır olun.

---

## Komandaya necə tətbiq etmək

1. **RAG Pipeline-ın Vizuallaşdırılması:** Komandaya başa salın ki, RAG sadəcə "axtar və tap" deyil, çoxmərhələli bir boru xəttidir (ETL -> Retrieval -> Filtering -> Scoring -> Generation).
2. **Evaluation Metrics:** Re-ranking tətbiq etdikdən sonra **Hit Rate** və **MRR (Mean Reciprocal Rank)** göstəricilərini ölçmək üçün testlər qurun.
3. **Metadata Standartı:** Sənədlər vektor bazasına yazılarkən hansı metadata sahələrinin (timestamp, author, access_level) məcburi olduğunu müəyyən edən bir "Schema Policy" yaradın.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Mövcud Spring Boot layihənizdə `EmbeddingStoreContentRetriever` yaradın.
2. `MetadataFilterBuilder` istifadə edərək, yalnız keçən ay yaradılmış sənədləri süzən bir filtr əlavə edin.
3. (Opsional) Cohere-dən pulsuz sınaq açarı alaraq `CohereScoringModel` inteqrasiya edin və axtarış nəticələrinin necə dəyişdiyini müşahidə edin.

---

## Mənbələr

- LangChain4j RAG Documentation: https://docs.langchain4j.dev/tutorials/rag
- Cohere Rerank API: https://cohere.com/rerank (yoxlanılmalıdır)
- Metadata Filtering in Vector DBs: https://www.pinecone.io/learn/vector-search-filtering/ (yoxlanılmalıdır)
