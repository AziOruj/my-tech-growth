# Semantic Caching ilə LLM Xərclərinin və Gecikmələrin Azaldılması

**Tarix:** 2026-10-23 · **Kateqoriya:** Performance & Cost Optimization · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM-lərin istifadəsi hər zaman iki böyük problemlə qarşılaşır: **yüksək gecikmə (latency)** və **yüksək xərc (token cost)**. Tech Lead olaraq bilməlisiniz ki, istifadəçilərin verdiyi sualların 30-40%-i adətən təkrarlanan və ya məna baxımından çox yaxın olan sorğulardır. Standart `Cache-Control` (exact match) burada işləmir, çünki "Parolumu necə sıfırlayım?" və "Şifrəni dəyişmək üçün nə etməliyəm?" sorğuları eyni mənaya gəlsə də, mətn olaraq fərqlidir. **Semantic Caching** bu problemi həll edərək məna yaxınlığına görə nəticələri yaddaşda saxlayır və sistemi həm sürətləndirir, həm də büdcəyə qənaət edir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **Semantic Cache** | Sorğunun özünü deyil, onun vektor (embedding) təsvirini cache-də axtaran sistem. |
| **Similarity Threshold** | İki sorğunun "eyni" sayılması üçün tələb olunan minimum kosinus oxşarlığı (məs: 0.95). |
| **Vector Store as Cache** | Cache-in saxlanıldığı yer (məsələn, Redis, Qdrant və ya pgvector). Redis ultra-aşağı gecikmə üçün tövsiyə olunur. |
| **Cache Hit/Miss** | Əgər vektor bazasında kifayət qədər yaxın sorğu tapılarsa "Hit" (LLM-ə zəng edilmir), tapılmazsa "Miss" (LLM çağırılır və nəticə cache-ə yazılır). |

---

## Kod nümunəsi: Redis və Spring AI ilə Semantic Caching

Spring AI 2.0-da `ChatClient` interfeysi `Advisor` mexanizmi vasitəsilə semantic caching-i dəstəkləyir. Aşağıda Redis üzərində qurulmuş real implementasiya nümunəsi verilmişdir.

### 1. Maven Dependency (Redis Vector Store)

```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-redis-spring-boot-starter</artifactId>
</dependency>
```

### 2. Semantic Cache Konfiqurasiyası

```java
package az.example.ai.cache;

import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.vectorstore.RedisVectorStore;
import org.springframework.ai.vectorstore.RedisVectorStore.RedisVectorStoreConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import redis.clients.jedis.JedisPooled;

@Configuration
public class SemanticCacheConfig {

    @Bean
    public RedisVectorStore cacheVectorStore(EmbeddingModel embeddingModel) {
        // Cache üçün xüsusi bir Redis index-i yaradırıq
        return new RedisVectorStore(
                RedisVectorStoreConfig.builder()
                        .withIndexName("llm-semantic-cache")
                        .withPrefix("cache:")
                        .build(),
                embeddingModel,
                new JedisPooled("localhost", 6379),
                true // Index-i avtomatik yarat
        );
    }
}
```

### 3. Advisor Vasitəsilə ChatClient-ə inteqrasiya

```java
package az.example.ai.cache;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.QuestionAnswerAdvisor;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Service;

@Service
public class SupportService {

    private final ChatClient chatClient;

    public SupportService(ChatClient.Builder builder, VectorStore cacheVectorStore) {
        this.chatClient = builder
                .defaultAdvisors(
                    // QuestionAnswerAdvisor burada semantic cache rolunu oynayır.
                    // Əgər VectorStore-da oxşarlıq dərəcəsi 0.98-dən yuxarı nəticə varsa, 
                    // LLM çağırılmadan birbaşa cache-dən cavab qayıdacaq.
                    new QuestionAnswerAdvisor(cacheVectorStore, SearchRequest.defaults()
                            .withSimilarityThreshold(0.98) 
                            .withTopK(1))
                )
                .build();
    }

    public String askSupport(String question) {
        return this.chatClient.prompt()
                .user(question)
                .call()
                .content();
    }
}
```

*Qeyd: Spring AI 2.0-da xüsusi `SemanticCacheAdvisor` (yoxlanılmalıdır) daha geniş funksionallıq təqdim edə bilər, lakin `QuestionAnswerAdvisor` eyni məntiqi icra edir.*

---

## Arxitektura qərarları və trade-off-lar

1. **Threshold Seçimi (Dəqiqlik vs Qənaət):**
   - **Yüksək Threshold (0.99):** Yalnız demək olar ki, eyni olan sualları cache-dən gətirir. Təhlükəsizdir, amma "hit ratio" aşağı olur.
   - **Aşağı Threshold (0.90):** Bəzən məna olaraq fərqli, amma yaxın olan suallara yanlış cache cavabı verə bilər (Hallucination risk).
   - **Tövsiyə:** 0.95-0.97 aralığından başlayın və monitorinq əsasında tənzimləyin.

2. **Embedding Modelinin Eyniliyi:**
   - Cache-ə yazılan vektorlar hansı model (məs: `text-embedding-3-small`) ilə yaradılıbsa, axtarış da eyni modellə edilməlidir. Modeli dəyişsəniz, cache-i boşaltmalısınız.

3. **Multi-tenancy:**
   - Əgər sistem fərqli müştərilərə (tenants) xidmət edirsə, bir müştərinin sualının cavabı digərinə cache-dən verilməməlidir. `SearchRequest` daxilində `filter` (metadata) istifadə edərək `tenantId` əsaslı izolyasiya qurun.

---

## Production məsələləri

- **TTL (Time-to-Live):** Semantic cache sonsuz qalmamalıdır. Məlumatlar köhnəlir. Redis-də vektor sənədlərinə TTL təyin etməklə "cache invalidation" məsələsini həll edin.
- **Privacy (PII):** İstifadəçinin şəxsi məlumatlarını (məs: "Mənim 1234 nömrəli sifarişim haradadır?") cache-ə atmayın. Cache-ə yalnız ümumi, şəxsiyyəti bəlli etməyən (non-PII) sorğuları daxil etmək üçün filtr qoyun.
- **Observability:** Redis-dən gələn cavabın "cache hit" olduğunu anlamaq üçün Custom Advisor yazaraq `Micrometer` counter-lərini artırın. Bu sizə LLM-dən nə qədər qənaət etdiyinizi vizuallaşdırmağa kömək edəcək.

---

## Komandaya necə tətbiq etmək

1. **Ölçmə (Baseline):** İlk olaraq mövcud LLM xərclərini və orta cavab müddətini (p95 latency) ölçün.
2. **Kritik olmayan sahələrdən başlayın:** Əvvəlcə FAQ və ya "Help Center" tipli botlarda semantic cache tətbiq edin.
3. **Cache Invalidation Strategiyası:** Biznes məntiqi dəyişdikdə (məs: yeni bir kampaniya başladıqda və ya qaydalar dəyişdikdə) əlaqəli cache-ləri təmizləmək üçün mexanizm (məs: `@CacheEvict` bənzəri event-driven təmizləmə) qurun.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Lokal mühitdə Redis-i (Stack versiyasını - Vector search üçün) işə salın: `docker run -p 6379:6379 redis/redis-stack:latest`.
2. Yuxarıdakı `SupportService` strukturunu qurun.
3. Eyni sualı iki fərqli cümlə ilə verin:
   - "How to reset my password?"
   - "Steps for password reset."
4. İkinci sorğunun cavabının milisaniyələr ərzində (LLM-ə getmədən) gəldiyini yoxlayın.
5. `SimilarityThreshold`-u dəyişərək davranışın necə dəyişdiyini müşahidə edin.

---

## Mənbələr

- Spring AI Vector Database Sənədləri (yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/vectordbs.html
- Redis VL (Vector Library) for Java (yoxlanılmalıdır): https://github.com/RedisVentures/redis-vlj
- LLM Caching Strategies and Best Practices (yoxlanılmalıdır): https://www.langchain.com/blog/semantic-caching

| Tarix | Mövzu | Kateqoriya | Səviyyə | Fayl |
|-------|-------|------------|---------|------|
| 2026-10-23 | Semantic Caching (Redis + Spring AI) | Performance & Cost | Qabaqcıl | [daily/2026-10-23-semantic-caching-spring-ai-redis.md](daily/2026-10-23-semantic-caching-spring-ai-redis.md) |
