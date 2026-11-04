# Spring AI: Hybrid Search (Vector + Keyword) və Metadata Filtering

**Tarix:** 2026-11-04 · **Kateqoriya:** Vector DB / RAG · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

RAG (Retrieval-Augmented Generation) sistemlərində sadə semantik axtarış (vector similarity) bəzən kifayət etmir. Tech Lead olaraq iki əsas problemlə qarşılaşacaqsınız:
1.  **Dəqiqlik (Keyword mismatch):** İstifadəçi spesifik bir SKU nömrəsi və ya məhsul kodu axtardıqda, semantik axtarış "oxşar" məhsulları tapa bilər, lakin dəqiq kodu qaçıra bilər.
2.  **Məlumat İzolyasiyası (Multi-tenancy):** Bir istifadəçinin sualına cavab verərkən, sistem yalnız həmin istifadəçinin (`userId`) və ya şirkətin (`tenantId`) sənədlərini axtarmalıdır. 

**Hybrid Search** (Semantik + Full-text) və **Metadata Filtering** bu problemləri həll edərək, RAG sisteminizi "oyuncaq" modelindən production-ready həllə çevirir.

---

## Əsas anlayışlar

1.  **Semantic Search (Dense Vectors):** Mənanın yaxınlığına görə axtarış (məsələn, "göy qurşağı" və "təbiət hadisəsi").
2.  **Keyword Search (Full-Text/Sparse):** Sözlərin hərfi uyğunluğuna görə axtarış (məsələn, "iPhone 15 Pro Max").
3.  **Hybrid Search:** Hər iki metodun nəticələrini birləşdirib (adətən RRF - Reciprocal Rank Fusion alqoritmi ilə) ən relevant nəticəni təqdim etmək.
4.  **Metadata Filtering:** Axtarış sahəsini (search space) daraltmaq üçün istifadə olunan SQL-ə bənzər qaydalar (məsələn, `category == 'electronics' AND status == 'published'`).

---

## Kod nümunəsi: Metadata ilə Təhlükəsiz RAG Axtarışı

Bu nümunədə `pgvector` (PostgreSQL) istifadə edərək həm Metadata Filtering, həm də axtarış parametrlərini necə tənzimləməyi öyrənəcəyik.

### 1. Vector Store-a sənəd əlavə edərkən Metadata təyini
```java
public void ingestDocument(String content, String tenantId, String category) {
    Document doc = new Document(content, Map.of(
        "tenant_id", tenantId,
        "category", category,
        "created_at", LocalDate.now().toString()
    ));
    vectorStore.add(List.of(doc));
}
```

### 2. Filter Expression ilə Axtarış Servisi
Spring AI-ın `FilterExpressionBuilder` sinfi bizə tip-təhlükəsiz (type-safe) filtrasiya imkanı verir.

```java
package com.company.ai.search;

import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.ai.vectorstore.filter.FilterExpressionBuilder;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AdvancedSearchService {

    private final VectorStore vectorStore;

    public AdvancedSearchService(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    public List<Document> secureSearch(String query, String tenantId, String category) {
        FilterExpressionBuilder b = new FilterExpressionBuilder();

        // SQL-ə bənzər dinamik filtr: tenant_id mütləq uyğun gəlməlidir
        Filter.Expression filterExpression = b.and(
                b.eq("tenant_id", tenantId),
                b.eq("category", category)
        ).build();

        SearchRequest searchRequest = SearchRequest.builder()
                .query(query)
                .topK(5) // Ən yaxın 5 sənəd
                .similarityThreshold(0.7) // Minimum oxşarlıq həddi
                .filterExpression(filterExpression) // Metadata filtri burada tətbiq olunur
                .build();

        return vectorStore.similaritySearch(searchRequest);
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

-  **Filter-then-Search vs Search-then-Filter:**
    -  **Spring AI (Filter-then-Search):** Əvvəlcə verilənlər bazası səviyyəsində filtrləmə aparır, sonra qalan sənədlər arasında vektor axtarışı edir. Bu, həm daha sürətli, həm də daha təhlükəsizdir (tenant izolyasiyası üçün vacibdir).
-  **Hybrid Search Support:** Hər Vector DB Hybrid Search-ü eyni cür dəstəkləmir. Məsələn, `Elasticsearch` və `Qdrant` bu mövzuda çox güclüdür, `pgvector` isə əlavə SQL query-ləri tələb edə bilər.
-  **Thresholding:** `similarityThreshold` təyin edərkən diqqətli olun. Çox yüksək (0.9) olsa, heç bir nəticə tapılmaya bilər; çox aşağı (0.5) olsa, LLM-ə lazımsız və səhv məlumat (noise) göndəriləcək.

---

## Production məsələləri

1.  **Indexing Metadata:** Əgər minlərlə sənədiniz varsa, metadata sahələrinə (`tenant_id`, `category`) mütləq B-Tree və ya GIN indeksləri əlavə edin. Yoxsa filtrasiya vektor axtarışından daha yavaş ola bilər.
2.  **Scaling:** Böyük həcmli datada (milyonlarla vektor) Hybrid Search resurs tələb edir. Bu halda `Pinecone` və ya `Milvus` kimi ixtisaslaşmış bazalara keçid düşünülməlidir.
3.  **Cost:** Metadata filtrasiyası DB tərəfdə işlədiyi üçün LLM token xərclərinə təsir etmir, əksinə, lazımsız sənədləri kəsdiyi üçün xərcləri azaldır.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1.  **Data Schema Definition:** Sənədlər bazaya yazılmamışdan əvvəl hansı metadata sahələrinin (tenantId, timestamp, sourceUrl) məcburi olduğunu standartlaşdırın.
2.  **RAG Debugging Tool:** Daxili bir admin panel və ya test API-ı yaradın ki, komanda verilən suala qarşı hansı sənədlərin "retrieved" olunduğunu və onların "score"-unu görə bilsin.
3.  **Security Review:** Multi-tenant sistemlərdə filtrasiyanın kodun dərinliyində (Service layer) deyil, vahid bir `SecurityAdvisor` və ya `Aspect` vasitəsilə tətbiqini təmin edin ki, heç bir developer `tenant_id` filtrini unutmasın.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Mövcud RAG layihənizdə (və ya test proyektində) `Document` obyektinə `version` və `priority` metadata sahələri əlavə edin.
2.  `FilterExpressionBuilder` istifadə edərək, yalnız `version > 1.0` olan və `priority == 'high'` olan sənədlər arasında axtarış edən bir metod yazın.
3.  Axtarış nəticəsində gələn sənədlərin `score` (similarity) dəyərlərini log-da çap edin.

---

## Mənbələr

- Spring AI Vector Store Filtering: https://docs.spring.io/spring-ai/reference/api/vectordbs.html#_metadata_filtering (yoxlanılmalıdır)
- PostgreSQL pgvector Hybrid Search: https://github.com/pgvector/pgvector (yoxlanılmalıdır)
- RRF (Reciprocal Rank Fusion) Explained: https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking (yoxlanılmalıdır)
