# Spring AI ilə RAG (Retrieval-Augmented Generation) və ETL Pipeline

**Tarix:** 2026-10-17 · **Kateqoriya:** RAG · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM-lər yalnız təlim olunduqları statik biliklərə sahibdirlər və korporativ məlumat bazalarından, yenilənən daxili sənədlərdən bixəbərdirlər. Modelin bütün daxili korporativ biliklərlə yenidən təlim olunması (fine-tuning) bahalı və statikdir. **RAG (Retrieval-Augmented Generation)** modeli xarici bilik bazası ilə bağlayır: istifadəçinin sualına uyğun ən aktual sənəd hissələri (chunks) bazadan tapılır və modelə kontekst kimi ötürülür. Tech Lead olaraq düzgün chunking, sənəd ingestasiyası (ETL) və `Advisor` mexanizmini qurmaq sisteminizin cavab keyfiyyətini və xərcini birbaşa müəyyən edir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **RAG (Retrieval-Augmented Generation)** | LLM sorğusuna xarici mənbədən axtarılmış kontekst sənədləri əlavə edərək cavab alma memarlığı. |
| **ETL Pipeline (Spring AI)** | Sənədin oxunması (`DocumentReader`), parçalanması/zənginləşdirilməsi (`DocumentTransformer`) və vektor bazasına yazılması (`DocumentWriter`). |
| **Chunking & TokenTextSplitter** | Böyük sənədlərin LLM context window həddini aşmaması və semantik bütövlüyü qoruması üçün optimal ölçülərə bölünməsi. |
| **QuestionAnsweringAdvisor** | Spring AI `ChatClient` zəncirinə qoşulan, istifadəçi sualına uyğun vektor axtarışı aparıb sistem promptuna kontekst kimi əlavə edən advisor. |
| **Hallucination Reduction** | Modelin uydurma məlumat verməsinin qarşısını almaq üçün faktiki sənədlərin "Ground Truth" kimi təqdim olunması. |

---

## Kod nümunəsi

Ssenari: Şirkətin daxili qaydalar toplusunu oxuyub parçalayaraq vektor bazasına yazırıq (ETL), sonra isə istifadəçi sual verəndə `ChatClient` avtomatik olaraq bu bazadan kontekst çəkib cavab verir.

### 1. Maven Dependency-ləri
```xml
<dependencies>
    <!-- Spring AI Core və Vector Store (pgvector) -->
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-model-openai</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-pgvector-store-spring-boot-starter</artifactId>
    </dependency>
</dependencies>
```

### 2. ETL Sənəd İstehlakı Servisi (Ingestion Service)

```java
package az.example.ai.rag;

import org.springframework.ai.document.Document;
import org.springframework.ai.reader.TextReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class DocumentIngestionService {

    private final VectorStore vectorStore;

    public DocumentIngestionService(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    public void ingestResource(Resource resource) {
        // 1. EXTRACT: Mətn sənədini oxuyuruq
        TextReader textReader = new TextReader(resource);
        textReader.getCustomMetadata().put("source", resource.getFilename());
        List<Document> rawDocuments = textReader.get();

        // 2. TRANSFORM: TokenTextSplitter ilə sənədləri chunk-lara bölürük
        // defaultChunkSize = 800 token, minChunkSizeChars = 350, chunkOverlap = 100 token
        TokenTextSplitter textSplitter = new TokenTextSplitter(800, 350, 10, 100, true);
        List<Document> splitDocuments = textSplitter.apply(rawDocuments);

        // 3. LOAD: Vektor bazasına yazırıq (avtomatik embedding yaradılır)
        vectorStore.accept(splitDocuments);
    }
}
```

### 3. RAG ChatClient Konfiqurasiyası və Servisi

```java
package az.example.ai.rag;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.QuestionAnsweringAdvisor;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Service;

@Service
public class CorporateKnowledgeService {

    private final ChatClient chatClient;

    public CorporateKnowledgeService(ChatClient.Builder chatClientBuilder, VectorStore vectorStore) {
        // QuestionAnsweringAdvisor: prompt göndərilmədən öncə VectorStore-da axtarış edir
        SearchRequest searchRequest = SearchRequest.builder()
                .topK(4)
                .similarityThreshold(0.75)
                .build();

        this.chatClient = chatClientBuilder
                .defaultAdvisors(new QuestionAnsweringAdvisor(vectorStore, searchRequest))
                .build();
    }

    public String askQuestion(String userQuestion) {
        return this.chatClient.prompt()
                .user(userQuestion)
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **Chunk Size vs Overlap (Parçalanma nisbəti):**
   - **Böyük chunk (1500+ token):** Daha zəngin kontekst verir, lakin axtarış dəqiqliyi düşür və LLM context window-u tez doldurur, qiymət artır.
   - **Kiçik chunk (200-300 token):** Dəqiq semantik axtarış tapır, amma cümlə ortasından kəsildiyi üçün LLM bütöv fikri itirir.
   - **Chunk Overlap (məsələn, 100-150 token):** Parçalanma sərhədlərində mənanın qırılmaması üçün mütləq tətbiq edilməlidir.

2. **Similarity Threshold Həddi:**
   - Hədd çox aşağı olarsa (məsələn, < 0.60), mövzu ilə əlaqəsiz sənədlər kontekstə düşüb modeli çaşdırır (noise injection).
   - Çox yüksək olarsa (məsələn, > 0.85), parafraz edilmiş düzgün faktlar belə tapılmaya bilər. 0.70-0.78 adətən optimal balansı təmin edir.

3. **In-memory ETL vs Async Job Ingestion:**
   - Sənədlər yüzlərlə səhifə olduqda HTTP sorğusu içində synchronous ingest etmək thread bloklanmasına səbəb olur. Ingestion mütləq arxa planda Spring Batch və ya Kafka eventi vasitəsilə asinxron işləməlidir.

---

## Production məsələləri

- **Token Xərcləri (Cost Optimization):** Hər `topK` sənəd prompt-a əlavə olunur. Əgər `topK=5` hər biri 800 tokendirsa, sadəcə kontekst 4,000 token təşkil edəcək. Token sərfiyyatını `Micrometer` vasitəsilə izləyin.
- **Tenant İzolyasiyası və Təhlükəsizlik:** Sənədləri ingest edərkən mütləq metadata daxilində `organizationId` və ya `departmentId` qeyd edin. `QuestionAnsweringAdvisor`-a filter expression əlavə edin ki, bir şöbənin əməkdaşı digər şöbənin gizli fayllarını axtarışda görməsin.
- **Lost in the Middle problemi:** Modellər adətən promptun ən əvvəlində və ən sonunda olan kontekstə daha çox fikir verir, ortada qalan sənədləri isə diqqətdən qaçıra bilər. Kontekst sənədlərinin sayı həddindən artıq çox olmamalıdır.

---

## Komandaya necə tətbiq etmək

1. **İnput Mənbələrini Standartlaşdırın:** Fayl formatlarına görə (`PdfReader`, `TextReader`, `JsonReader`) komandada ortaq abstraction interfeysi qurun (`DocumentIngester`).
2. **"No Answer" Qaydası:** Prompt şablonuna birmənalı olaraq yazın: *"Əgər verilən kontekstdə sualın cavabı yoxdursa, 'Bu barədə məlumatım yoxdur' de və özündən məlumat uydurma"*. Bu, biznes auditlərində reputasiya itkisinin qarşısını alır.
3. **Chunking Testləri:** Komandanın CI/CD pipeline-ına RAG axtarış dəqiqliyini test edən mock testlər əlavə edin (Integration Test ilə pgvector-a nümunə qoyub test sorğuları icra edin).

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Layihənizdə `CorporateKnowledgeService` sinfini yaradın və `QuestionAnsweringAdvisor` əlavə edin.
2. Daxili layihə readme faylını və ya uydurma bir şirkət siyasəti mətnini (məsələn: "Şirkətdə məzuniyyət günləri 28 təqvim günüdür") `TokenTextSplitter` ilə parçalayıb əvvəlki dərsdə qurduğunuz `pgvector`-a yazın.
3. ChatClient vasitəsilə sual verin: "Məzuniyyət müddəti nə qədərdir?". LLM-in təqdim etdiyiniz mətndən sitat gətirərək dəqiq cavab verdiyini yoxlayın.
4. `topK` parametrini dəyişərək çıxan nəticələri və token sayını müqayisə edin.

---

## Mənbələr

- Spring AI RAG & QuestionAnsweringAdvisor Sənədləri (2.0.2, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html
- Spring AI Document Readers and Splitters: https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html
- Pinecone: Chunking Strategies for LLM Applications: https://www.pinecone.io/learn/chunking-strategies/
