# Spring AI Embeddings və pgvector ilə Vektor Bazaları

**Tarix:** 2026-10-16 · **Kateqoriya:** Vector DB · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır)

---

## Niyə vacibdir

Klassik SQL `LIKE %search%` və ya Full-Text Search (FTS) sözlərin mənasına (semantikasına) baxa bilmir. Məsələn, "avtomobil" axtaranda "maşın" sözü olan sənədlər tapılmır. **Embeddings** (vektor təmsilləri) mətni riyazi olaraq çoxölçülü kosmosda bir nöqtəyə çevirir. Bir-birinə mənaca yaxın olan anlayışlar bu kosmosda yaxın nöqtələrdə yerləşir. Tech Lead üçün bu, RAG (Retrieval-Augmented Generation) sistemlərinin təməlidir: sənədləri necə rəqəmsallaşdırmaq və **pgvector** kimi bazalarda necə effektiv axtarmaq.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **Embedding Model** | Mətni (Text) kəsrli ədədlər massivinə (`float[]`) çevirən model (məs: `text-embedding-3-small`). |
| **Vector Dimension** | Modelin çıxışındakı ədədlərin sayı (məs: 1536 ölçü). Bazadakı sütun ölçüsü ilə eyni olmalıdır. |
| **pgvector** | PostgreSQL üçün vektor məlumat növünü və yaxınlıq axtarışını dəstəkləyən extension. |
| **Cosine Similarity** | İki vektor arasındakı bucağın kosinusu. Nəticə 1-ə nə qədər yaxındırsa, mənalar o qədər oxşardır. |
| **Vector Store** | Vektorları və onlara bağlı meta-məlumatları (JSON) saxlamaq üçün abstraksiya. |

---

## Kod nümunəsi

Ssenari: Şirkətin daxili qaydalarını (PDF/Mətn) bazaya indeksləyirik və semantik axtarış edirik.

### 1. PostgreSQL/pgvector Quraşdırma (Docker)
```bash
docker run -d --name pgvector -e POSTGRES_PASSWORD=pass -p 5432:5432 ankane/pgvector
```

### 2. Dependency-lər (Maven)
```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-pgvector-store-spring-boot-starter</artifactId>
</dependency>
```

### 3. Vektor Bazası Servisi

```java
package az.example.ai.service;

import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class KnowledgeBaseService {

    private final VectorStore vectorStore;

    public KnowledgeBaseService(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    // 1. Sənədləri indeksləmək (Embedding avtomatik yaradılır)
    public void ingestData(String content, String category) {
        Document doc = new Document(content, Map.of("category", category));
        vectorStore.add(List.of(doc));
    }

    // 2. Semantik axtarış (Similarity Search)
    public List<String> search(String query) {
        List<Document> results = vectorStore.similaritySearch(
                SearchRequest.query(query)
                        .withTopK(3) // Ən yaxın 3 sənəd
                        .withSimilarityThreshold(0.7) // Minimum oxşarlıq həddi
        );

        return results.stream()
                .map(Document::getContent)
                .toList();
    }
}
```

### 4. Application Properties
```properties
spring.ai.vectorstore.pgvector.initialize-schema=true
spring.ai.vectorstore.pgvector.distance-type=cosine
spring.ai.vectorstore.pgvector.index-type=hnsw
```

---

## Arxitektura qərarları və trade-off-lar

1. **Embedding Model Seçimi (Local vs Cloud):**
   - **OpenAI/Azure:** Yüksək keyfiyyət, amma hər embedding üçün ödəniş və şəbəkə gecikməsi.
   - **Ollama/Transformers (Local):** Tam gizlilik (data klasterdən çıxmır), xərc yoxdur, amma CPU/GPU resursu tələb edir.

2. **İndeksləmə Strategiyası (HNSW vs IVFFlat):**
   - **HNSW (Hierarchical Navigable Small Worlds):** Çox sürətlidir, yüksək dəqiqlik verir, amma RAM-da daha çox yer tutur. (Production üçün tövsiyə).
   - **IVFFlat:** Daha az RAM istifadə edir, amma data böyüdükcə axtarış sürəti düşür.

3. **Dimension mismatch:**
   - Əgər OpenAI `text-embedding-3-small` (1536) istifadə edib bazanı qurmusunuzsa, sonra modeli `ada-002`-yə dəyişmək istəsəniz, bütün bazayı silib yenidən indeksləməli olacaqsınız.

---

## Production məsələləri

- **Batch Ingestion:** 10,000 sənədi bir-bir `vectorStore.add()` etməyin. Bu, hər dəfə modelə HTTP çağırışı deməkdir. Spring AI list qəbul edir, batch şəklində göndərin.
- **Filter-lar:** `vectorStore.similaritySearch` istifadə edərkən mütləq `FilterExpression` istifadə edin (məsələn: `where tenant_id = 'abc'`). Bu, həm təhlükəsizlik, həm də sürət üçün vacibdir.
- **Observability:** Embedding yaratmaq üçün modelə gedən sorğu `Micrometer` vasitəsilə izlənilməlidir. Bəzən bir cümlənin vektorlaşması 500ms+ çəkə bilər.

---

## Komandaya necə tətbiq etmək

1. **DB Migration:** `pgvector` üçün SQL skriptlərini (Liquibase/Flyway) hazırlayın. `CREATE EXTENSION IF NOT EXISTS vector;` əmrini unutmayın.
2. **Metadata Standartı:** Komanda ilə razılaşın ki, hər bir `Document` obyektində hansı metadata olacaq (`source`, `created_at`, `version`). Bu, gələcəkdə axtarışı filterləmək üçün kritikdir.
3. **Re-indexing planı:** Embedding modelini update etmək lazım gəlsə (məsələn, daha ucuz və keyfiyyətli model çıxsa), bütün sənədləri necə yenidən emal edəcəyinizi əvvəlcədən düşünün (Job sistemi).

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. `ankane/pgvector` docker obrazını qaldırın.
2. Spring Boot layihənizə `spring-ai-pgvector-store-spring-boot-starter` əlavə edin.
3. 5-6 fərqli sahədən (məs: Java proqramlaşdırma, Kulinariya, Futbol) qısa cümlələr əlavə edin.
4. "Kod yazmaq" haqqında axtarış verin və görün sistem proqramlaşdırma ilə bağlı cümləni tapırmı, yoxsa kulinariyanı? Oxşarlıq faizini (`distance`) müşahidə edin.

---

## Mənbələr

- Spring AI Vector Store Reference (2.0.2, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/vectortokens.html
- pgvector GitHub: https://github.com/pgvector/pgvector
- OpenAI Embedding Models Guide: https://platform.openai.com/docs/guides/embeddings
