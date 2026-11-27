# Spring AI: Long-term Entity Memory (Fərdi Süni İntellekt Təcrübəsi)

**Tarix:** 2026-11-27 · **Kateqoriya:** AI Agents / Personalization · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Sessiya əsaslı `ChatMemory` (Short-term Memory) LLM-in cari söhbəti xatırlamasını təmin edir, lakin istifadəçi sabah qayıtdıqda AI hər şeyi unudur. Tech Lead olaraq, tətbiqinizin "yapışqanlığını" (retention) artırmaq üçün **Long-term Entity Memory** arxitekturasını qurmalısınız. Bu, AI-ın istifadəçi üstünlüklərini (məs. "Həmişə kod nümunələrini Java-da ver", "Mənim stack-im Spring Boot-dur") həftələr və ya aylar sonra da xatırlamasına imkan verir. Bu, generativ AI-dan fərdi köməkçiyə keçid nöqtəsidir.

---

## Əsas anlayışlar

1.  **Short-term Memory:** Söhbət pəncərəsi daxilindəki mesajlar (adətən `MessageChatMemory` ilə idarə olunur).
2.  **Long-term Memory (Entity Memory):** İstifadəçi haqqında faktların, üstünlüklərin və keçmiş qərarların strukturlaşdırılmış və ya semantik şəkildə saxlanması.
3.  **Entity Extraction:** Söhbət əsnasında LLM-in "Mən Postgres istifadə edirəm" kimi cümlələrdən faktları çıxarması prosesi.
4.  **Memory Retrieval:** Yeni sorğu gəldikdə, həm sessiya yaddaşını, həm də profil bazasından (Vector Store) müvafiq faktları çəkib prompt-a əlavə etmək.

---

## Kod nümunəsi: Personalization Advisor

Bu nümunədə istifadəçinin uzunmüddətli üstünlüklərini Vector Store-dan oxuyan və hər sorğuya əlavə edən xüsusi bir `Advisor` hazırlayacağıq.

### 1. Entity (Fakt) Modelimiz
```java
public record UserPreference(String userId, String preference, LocalDateTime updatedAt) {}
```

### 2. Custom Personalization Advisor
Bu advisor hər bir LLM çağırışından əvvəl istifadəçinin keçmiş məlumatlarını semantik olaraq axtarır.

```java
@Component
public class PersonalizationAdvisor implements CallAroundAdvisor {

    private final VectorStore vectorStore;

    public PersonalizationAdvisor(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    @Override
    public AdvisedResponse aroundCall(AdvisedRequest advisedRequest, CallAroundAdvisorChain chain) {
        String userId = (String) advisedRequest.userAttributes().get("user_id");
        
        // 1. İstifadəçi profilindən müvafiq faktları axtarırıq
        List<Document> relevantPreferences = vectorStore.similaritySearch(
                SearchRequest.query(advisedRequest.userText())
                        .withFilterExpression("userId == '" + userId + "'")
                        .withTopK(3)
        );

        String context = relevantPreferences.stream()
                .map(Document::getContent)
                .collect(Collectors.joining("\n"));

        // 2. Prompt-u istifadəçi məlumatları ilə zənginləşdiririk
        String enrichedSystemText = advisedRequest.systemText() + 
            "\nİstifadəçi haqqında bildiyin faktlar:\n" + context;

        AdvisedRequest enrichedRequest = AdvisedRequest.from(advisedRequest)
                .withSystemText(enrichedSystemText)
                .build();

        return chain.nextAroundCall(enrichedRequest);
    }

    @Override
    public String getName() {
        return "PersonalizationAdvisor";
    }

    @Override
    public int getOrder() {
        return 0;
    }
}
```

### 3. ChatClient-in konfiqurasiyası
```java
@RestController
public class ChatController {

    private final ChatClient chatClient;

    public ChatController(ChatClient.Builder builder, PersonalizationAdvisor personalizationAdvisor) {
        this.chatClient = builder
                .defaultAdvisors(personalizationAdvisor, new MessageChatMemoryAdvisor(new InMemoryChatMemory()))
                .build();
    }

    @GetMapping("/chat")
    public String chat(@RequestParam String userId, @RequestParam String message) {
        return chatClient.prompt()
                .user(message)
                .advisors(a -> a.param("user_id", userId))
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

-   **Extraction Strategy:** Faktları nə zaman yaddaşa yazmalı?
    -   *Synchronous:* Hər cavabdan sonra LLM-dən soruşuruq: "Bu mesajda yeni fakt varmı?". Bu, latensiyanı artırır.
    -   *Asynchronous (Tövsiyə olunan):* Mesajı RabbitMQ/Kafka-ya atırıq, ayrı bir worker LLM vasitəsilə faktları çıxarıb Vector Store-a yazır.
-   **Vector vs Relational:** Əgər faktlar sərtdirsə (məs. "Doğum tarixi"), relational DB daha yaxşıdır. Əgər faktlar qeyri-səlisdirsə (məs. "İstifadəçi texniki izahları xoşlayır"), Vector Store (pgvector) ideal seçimdir.

---

## Production məsələləri

1.  **Privacy (GDPR/KVKK):** İstifadəçinin "məni unut" (right to be forgotten) tələbi olduqda, həm relational, həm də Vector Store-dakı bütün `userId`-yə bağlı embedding-lər silinməlidir.
2.  **Memory Decay (Yaddaşın köhnəlməsi):** İnsanlar fikirlərini dəyişir. Embedding-lərdə `timestamp` saxlayın və köhnə faktların çəkisini azaldın və ya yeni fakt eyni mövzudadırsa, köhnəni overwrite edin.
3.  **Conflict Resolution:** Əgər `ChatMemory` (cari söhbət) və `Long-term Memory` (keçmiş) ziddiyyət təşkil edirsə, adətən cari söhbətə üstünlük verilir.

---

## Komandaya necə tətbiq etmək

1.  **User Profiling Service:** AI-dan asılı olmayan vahid bir "User Context Service" yaradın.
2.  **Explicit vs Implicit:** İstifadəçiyə AI-ın onun haqqında nə yadda saxladığını görmək və redaktə etmək imkanı verin (Transparency).
3.  **Evaluation:** "AI keçmiş faktı düzgün tətbiq etdimi?" sualını yoxlayan test ssenariləri (LLM-as-a-judge) hazırlayın.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Mövcud Spring AI layihənizdə bir `VectorStore` (məs. Redis və ya SimpleVectorStore) qurun.
2.  İstifadəçinin keçmiş mesajlarından avtomatik "İstifadəçi üstünlükləri" çıxaran asinxron bir `@EventListener` (Spring Events) yaradın.
3.  `PersonalizationAdvisor`-u tətbiq edərək, AI-ın ikinci söhbətdə "Mənim adım nədir?" sualına birinci söhbətdə verilən məlumata əsasən cavab verməsini təmin edin.

---

## Mənbələr

-   Spring AI Advisors: https://docs.spring.io/spring-ai/reference/api/advisors.html (yoxlanılmalıdır)
-   Generative AI Patterns (Memory): https://www.deeplearning.ai/short-courses/
-   LangChain4j Entity Memory Discussion: https://github.com/langchain4j/langchain4j/issues (Konseptual oxşarlıq üçün)
