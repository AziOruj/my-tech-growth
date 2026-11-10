# Spring AI: Multi-tenancy in RAG (Vector DB Isolation & Security)

**Tarix:** 2026-11-10 · **Kateqoriya:** RAG / Security · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Enterprise (B2B) tətbiqlərdə ən kritik tələblərdən biri **data isolation**-dır. RAG (Retrieval-Augmented Generation) sistemləri qurduğunuzda, A müştərisinin sənədləri heç bir halda B müştərisinin sorğusuna cavab olaraq çıxmamalıdır. Tech Lead olaraq, hər müştəri üçün ayrı Vector DB instance-ı saxlamaq (bahalı və idarəedilməz) ilə vahid bazada filtrasiya tətbiq etmək (performans və təhlükəsizlik riski) arasında düzgün arxitektur seçim etməlisiniz.

---

## Əsas anlayışlar

1.  **Shared Index with Metadata Filtering:** Bütün müştərilərin embedding-ləri eyni kolleksiyada/cədvəldə saxlanılır, lakin hər bir sənədə `tenantId` metadata etiketi əlavə edilir.
2.  **Vector Store Filtering:** LLM-ə göndəriləcək konteksti axtararkən (retrieval), Vector DB səviyyəsində `WHERE tenantId = '...'` filtrinin tətbiq edilməsi.
3.  **Logical vs Physical Isolation:** 
    *   *Logical:* Metadata filtrləri ilə (Shared Table).
    *   *Physical:* Hər tenant üçün ayrı kolleksiya və ya ayrı DB şeması.
4.  **Security Context Propagation:** İstifadəçinin tenant məlumatının avtomatik olaraq AI servis layihəsinə ötürülməsi.

---

## Kod nümunəsi: Metadata-yönümlü Multi-tenant RAG

Aşağıdakı nümunədə Spring AI-nin `FilterExpression` API-sindən istifadə edərək, sorğu zamanı yalnız cari tenant-a aid məlumatların gətirilməsini təmin edirik.

### 1. Document Ingestion (Sənədlərin yüklənməsi)
Sənədləri bazaya yazarkən `tenantId` mütləq əlavə edilməlidir.

```java
@Service
public class MultiTenantIngestionService {

    private final VectorStore vectorStore;

    public MultiTenantIngestionService(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    public void uploadDocuments(List<Document> docs, String tenantId) {
        List<Document> enrichedDocs = docs.stream()
                .map(doc -> {
                    doc.getMetadata().put("tenant_id", tenantId);
                    return doc;
                })
                .toList();
        
        vectorStore.accept(enrichedDocs);
    }
}
```

### 2. Secure Retrieval (Təhlükəsiz Axtarış)
Axtarış zamanı istifadəçinin tenant ID-sini `SearchRequest`-ə filtr kimi əlavə edirik.

```java
@Service
public class MultiTenantSearchService {

    private final VectorStore vectorStore;

    public List<Document> search(String query, String tenantId) {
        // Spring AI Filter Expression (Metadata filter)
        var filterExpression = new Filter.Expression(
                new Filter.Key("tenant_id"), 
                Filter.Expression.Operand.EQ, 
                new Filter.Value(tenantId)
        );

        SearchRequest request = SearchRequest.query(query)
                .withTopK(5)
                .withSimilarityThreshold(0.7)
                .withFilterExpression(filterExpression);

        return vectorStore.similaritySearch(request);
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Strategiya | Üstünlükləri | Çatışmazlıqları |
| :--- | :--- | :--- |
| **Shared Collection (Metadata)** | Aşağı xərc, asan scaling, asan maintenance. | Bir tenantın çox datası olarsa, digərlərinin axtarış sürətinə (latency) təsir edə bilər. |
| **Separate Collections** | Daha yüksək təhlükəsizlik, hər tenant üçün fərdi index tuning imkanı. | Minlərlə tenant olduqda Vector DB instance-ı şişə bilər (resource exhaustion). |
| **Separate DB Instances** | Maksimum izolyasiya, compliance (GDPR/SOC2) üçün ideal. | Çox baha başa gəlir və DevOps yükü çoxdur. |

**Tech Lead Tövsiyəsi:** Əgər hər bir tenant-ın datası milyonlarla sətir deyilsə, **Shared Collection + Metadata Filtering** ən effektiv yoldur. Lakin bazada `tenant_id` üzərində **index** (HNSW metadata filter optimization) olduğundan əmin olun.

---

## Production məsələləri

1.  **Index Optimization:** `pgvector` və ya `Qdrant` istifadə edirsinizsə, metadata filtrlərinin sürətli işləməsi üçün həmin sahələri (fields) xüsusi indeksləməlisiniz (məsələn, PostgreSQL-də `CREATE INDEX ON vector_table ((metadata->>'tenant_id'));`).
2.  **Global Filter Enforcement:** Səhvən filtrsiz axtarış etməmək üçün, `ChatClient` və ya `VectorStore` ətrafında bir `Aspect` (AOP) və ya `Advisor` yaradaraq `tenant_id` filtrini məcburi (mandatory) edin.
3.  **Token Quotas per Tenant:** Multi-tenant sistemlərdə bir müştərinin bütün LLM büdcəsini bitirməməsi üçün hər tenant üzrə token limitləri (Rate Limiting) tətbiq edin.

---

## Komandaya necə tətbiq etmək

1.  **Standardize Metadata:** Bütün komandalara sənəd yükləyərkən istifadə ediləcək metadata açarlarını (məsələn, `tenant_id`, `department_id`, `visibility`) standartlaşdırın (Enum və ya Constant class ilə).
2.  **Review Security:** Kod review zamanı AI retrieval hissələrində filtrasiyanın mütləq tətbiq olunduğunu yoxlayan xüsusi qayda (check-list) əlavə edin.
3.  **Tenant-Aware Testing:** İnteqrasiya testlərində A tenantının sorğusu ilə B tenantının datasına çıxışın qeyri-mümkün olduğunu yoxlayan test keyslər yazın.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Lokal `pgvector` bazasında sənədləri iki fərqli `tenant_id` ilə yadda saxlayın.
2.  `FilterExpression` istifadə edərək bir tenant üçün axtarış edin və digər tenant-ın məlumatlarının nəticəyə girmədiyini doğrulayın.
3.  (Bonus) Spring Security-dən `SecurityContextHolder` vasitəsilə cari istifadəçinin tenant ID-sini avtomatik götürən bir `VectorStore` wrapper-i yazmağa çalışın.

---

## Mənbələr

-   Spring AI Vector Store Filtering: https://docs.spring.io/spring-ai/reference/api/vectortore.html#filtering (yoxlanılmalıdır)
-   pgvector Metadata Indexing: https://github.com/pgvector/pgvector (yoxlanılmalıdır)
-   Qdrant Payload Filtering: https://qdrant.tech/documentation/concepts/filtering/ (yoxlanılmalıdır)
