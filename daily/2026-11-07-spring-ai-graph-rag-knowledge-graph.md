# Spring AI: GraphRAG və Knowledge Graph İnteqrasiyası

**Tarix:** 2026-11-07 · **Kateqoriya:** RAG / Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Standart RAG (Vector Search) "top-k" oxşar sənəd parçalarını tapmaqda əladır, lakin sənədlər arasındakı mürəkkəb əlaqələri izləməkdə çətinlik çəkir. Məsələn, "A layihəsində işləyən developerlərin istifadə etdiyi ortaq kitabxanalar hansılardır?" sualına Vector RAG cavab verməkdə çətinlik çəkə bilər, çünki bu məlumat müxtəlif sənədlərə dağılmışdır.

**GraphRAG**, məlumatları bir **Knowledge Graph (Bilik Qrafı)** şəklində (Varlıqlar və Əlaqələr) saxlayaraq, LLM-ə strukturlaşdırılmış və qlobal bir baxış bucağı qazandırır. Tech Lead üçün bu, korporativ bilik bazalarının (confluence, jira, code documentation) daha effektiv analizi deməkdir.

---

## Əsas anlayışlar

1.  **Nodes (Təpələr):** Varlıqlar (məsələn: `Developer`, `Project`, `Library`).
2.  **Edges (Tillər):** Varlıqlar arasındakı münasibətlər (məsələn: `WORKS_ON`, `USES`).
3.  **Cypher Query:** Neo4j kimi qraf bazalarında məlumatı sorgulamaq üçün istifadə olunan dil (SQL-in qraf ekvivalenti).
4.  **Hybrid Retrieval:** Həm qraf strukturu (traversal), həm də vektor oxşarlığının eyni anda istifadə edilməsi.

---

## Kod nümunəsi: Neo4j və Spring AI ilə GraphRAG

Spring AI, Neo4j ilə inteqrasiya olunaraq həm vektorları, həm də qraf əlaqələrini dəstəkləyir.

```java
package com.company.ai.graphrag;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.PromptTemplate;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.document.Document;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class GraphRagService {

    private final ChatClient chatClient;
    private final VectorStore vectorStore; // Neo4jVectorStore olaraq konfiqurasiya edilib

    public GraphRagService(ChatClient.Builder builder, VectorStore vectorStore) {
        this.chatClient = builder.build();
        this.vectorStore = vectorStore;
    }

    public String askComplexQuestion(String question) {
        // 1. Vector Search ilə kontekst tapmaq
        List<Document> similarDocs = vectorStore.similaritySearch(question);
        String vectorContext = similarDocs.stream()
                .map(Document::getContent)
                .collect(Collectors.joining("\n"));

        // 2. LLM-dən qraf bazası üçün Cypher query hazırlamasını istəmək
        // (Bu addım real GraphRAG-da daha mürəkkəbdir)
        String cypherQueryGenerationPrompt = """
                Aşağıdakı suala cavab tapmaq üçün Neo4j Cypher sorğusu yaz.
                Sual: {question}
                Schema: (:Person)-[:WORKS_ON]->(:Project)-[:USES]->(:Library)
                Yalnız sorğunu qaytar.
                """;

        String cypherQuery = chatClient.prompt()
                .user(u -> u.text(cypherQueryGenerationPrompt).param("question", question))
                .call()
                .content();

        // 3. Biz burada sadəlik üçün Neo4j-dən gələn nəticəni simulyasiya edirik
        // Real tətbiqdə: Neo4jClient istifadə edərək cypherQuery-ni icra edirsiniz
        String graphResults = "Project X uses Spring Boot, Project Y uses Quarkus.";

        // 4. Son Cavabın Yaradılması
        return chatClient.prompt()
                .system("Sən qraf və vektor məlumatlarını birləşdirən analitiksən.")
                .user(u -> u.text("Vektor məlumatı: {v}\nQraf məlumatı: {g}\nSual: {q}")
                        .param("v", vectorContext)
                        .param("g", graphResults)
                        .param("q", question))
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

-   **Schema Design:** Qrafın sxemini düzgün qurmaq kritikdir. Hər şeyi qrafa əlavə etmək (over-engineering) performansı sala bilər. Yalnız vacib varlıqlar və əlaqələr qrafda saxlanılmalı, detallar isə vektor bazasında qalmalıdır.
-   **Graph Extraction:** Sənədlərdən avtomatik olaraq "Triples" (Subject-Predicate-Object) çıxarmaq bahalı prosesdir. Bunun üçün `gpt-4o` kimi güclü modellər tələb olunur.
-   **Neo4j vs. Traditional DBs:** Əgər verilənləriniz onsuz da relasiyalıdırsa, pgvector ilə SQL join-ləri "Pseudo-GraphRAG" kimi işləyə bilər. Lakin dərin əlaqələr (3+ hop) üçün Neo4j mütləqdir.

---

## Production məsələləri

1.  **Cypher Injection:** LLM tərəfindən yaradılan Cypher sorğularını birbaşa bazada icra etmək təhlükəli ola bilər. Read-only user istifadə edin və sorğunu validasiya edən guardrail-lər qurun.
2.  **Indexing Latency:** Qrafın qurulması (Entity Extraction) vaxt aparır. Bunu real-time deyil, asinxron (background job) olaraq həyata keçirin.
3.  **Visualization:** Tech Lead olaraq komandaya qrafı vizuallaşdırmaq üçün alətlər (Neo4j Bloom) təqdim edin ki, LLM-in niyə müəyyən əlaqəni qurduğunu görə bilsinlər.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1.  **Pilot Layihə:** Mövcud RAG sisteminizdə "hallucination" olan və ya "global" suallara cavab verə bilməyən bir sahəni seçin.
2.  **Entity Mapping:** Domain expert-lərlə görüşüb əsas varlıqları (Entities) müəyyən edin.
3.  **Spring AI + Neo4j:** Maven-ə `spring-ai-neo4j-store-spring-boot-starter` əlavə edərək kiçik bir PoC (Proof of Concept) başladın.
4.  **Schema Enforcement:** LLM-ə Cypher yazdırarkən mütləq qraf sxemini (schema) prompt-a daxil edin.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Neo4j (Docker-də) quraşdırın.
2.  Spring AI istifadə edərək bir mətndən (məsələn, bir hekayə və ya texniki tapşırıq) "Kim?, Nə etdi?, Harada?" üçlüklərini (triples) çıxaran bir metod yazın.
3.  Bu üçlükləri Neo4j-yə "CREATE" komandası ilə göndərin.

---

## Mənbələr

-   Spring AI Neo4j Vector Store: https://docs.spring.io/spring-ai/reference/api/vectortore/neo4j.html (yoxlanılmalıdır)
-   Microsoft GraphRAG Research: https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/ (yoxlanılmalıdır)
-   Neo4j Cypher Refcard: https://neo4j.com/docs/cypher-cheat-sheet/ (yoxlanılmalıdır)
