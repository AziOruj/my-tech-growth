# Spring AI: Semantic Routing (Ağıllı Sorğu Marşrutlaşdırma)

**Tarix:** 2026-11-20 · **Kateqoriya:** Architecture / RAG · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Mürəkkəb müəssisə sistemlərində istifadəçinin hər bir sualını birbaşa RAG-a (Vector DB) və ya Text-to-SQL moduluna göndərmək həm bahalıdır, həm də yanlış cavab riskini artırır. Məsələn, "Şirkətin məzuniyyət siyasəti necədir?" sualı PDF sənədlərinə (RAG), "Keçən ay neçə nəfər məzuniyyətə çıxıb?" sualı isə relational bazaya (SQL) getməlidir. **Semantic Routing** istifadəçi niyyətini (intent) analiz edərək sorğunu ən uyğun "path"-ə yönləndirir. Tech Lead üçün bu, sistemin dəqiqliyini artırmaq və lazımsız LLM çağırışlarını azaltmaq üçün əsas memarlıq qatıdır.

---

## Əsas anlayışlar

1.  **Intent Classification:** İstifadəçi sorğusunun hansı kateqoriyaya (məs. FAQ, Sales, Technical Support, General) aid olduğunun təyini.
2.  **LLM-based Router:** LLM-in özünə "Bu sual hansı modula aiddir?" deyə soruşaraq qərar vermək (yüksək dəqiqlik, yüksək gecikmə).
3.  **Embedding-based Router:** Sualların embedding-lərini əvvəlcədən təyin olunmuş kateqoriya nümunələri ilə müqayisə edərək (Cosine Similarity) yönləndirmə (aşağı gecikmə, aşağı xərc).
4.  **Fallback Route:** Heç bir kateqoriyaya uyğun gəlməyən sorğular üçün ümumi cavab mexanizmi.

---

## Kod nümunəsi: LLM-based Semantic Router

Bu nümunədə biz istifadəçinin sualını analiz edib onu ya `RAG_SERVICE`-ə, ya `DATABASE_SERVICE`-ə, ya da `GENERAL_CHAT`-ə yönləndirən router quracağıq.

### 1. Route Təyini (Enum)

```java
public enum RouteType {
    COMPANY_POLICIES,    // RAG (PDF-lər)
    SALES_DATA,         // SQL (Database)
    GENERAL_GREETING,   // Standart LLM
    UNKNOWN             // Fallback
}
```

### 2. Router Service

```java
@Service
public class SemanticRouterService {
    private final ChatClient chatClient;

    public SemanticRouterService(ChatClient.Builder builder) {
        this.chatClient = builder
            .defaultSystem("""
                Sən bir sorğu marşrutlaşdırıcısısan (Router). 
                İstifadəçi sualını analiz et və aşağıdakı kateqoriyalardan birini SEÇ.
                
                KATEQORİYALAR:
                - COMPANY_POLICIES: Maaş, məzuniyyət, daxili qaydalar haqqında suallar.
                - SALES_DATA: Satış rəqəmləri, hesabatlar, müştəri statistikası haqqında suallar.
                - GENERAL_GREETING: Salamlaşma və ya sadə söhbət.
                - UNKNOWN: Yuxarıdakıların heç birinə uyğun gəlməyən suallar.

                YALNIZ kateqoriya adını (enum) qaytar. Başqa heç nə yazma.
                """)
            .build();
    }

    public RouteType classify(String userQuery) {
        String response = chatClient.prompt()
                .user(userQuery)
                .call()
                .content();
        
        try {
            return RouteType.valueOf(response.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return RouteType.UNKNOWN;
        }
    }
}
```

### 3. Orchestrator (Main Entry Point)

```java
@Service
public class AiOrchestrator {
    private final SemanticRouterService routerService;
    private final RagService ragService;
    private final BusinessIntelligenceService biService; // Dünənki Text-to-SQL servisi

    public AiOrchestrator(SemanticRouterService routerService, RagService ragService, BusinessIntelligenceService biService) {
        this.routerService = routerService;
        this.ragService = ragService;
        this.biService = biService;
    }

    public String handleRequest(String prompt) {
        RouteType route = routerService.classify(prompt);
        
        return switch (route) {
            case COMPANY_POLICIES -> ragService.queryDocs(prompt);
            case SALES_DATA -> biService.answerBusinessQuestion(prompt);
            case GENERAL_GREETING -> "Salam! Sizə şirkət qaydaları və ya satış hesabatları barədə kömək edə bilərəm.";
            default -> "Bağışlayın, bu sualı necə cavablandıracağımı bilmirəm. Zəhmət olmasa daha dəqiq soruşun.";
        };
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Yanaşma | Üstünlük | Çatışmazlıq |
| :--- | :--- | :--- |
| **LLM Router** | Çox mürəkkəb nüansları (nuance) başa düşür. | Hər sorğu üçün əlavə bir LLM çağırışı (latency + cost). |
| **Embedding Router** | Sürətli (milisaniyələr) və ucuzdur. | Cümlə quruluşu fərqli amma mənası eyni olan hallarda yanıla bilər. |
| **Regex/Keyword Router** | Sıfır gecikmə, tam deterministik. | Çox bəsitdir, təbii dili başa düşmür. |

**Tech Lead Tövsiyəsi:** Başlanğıc üçün LLM Router (GPT-4o-mini kimi sürətli modellərlə) istifadə edin. Əgər trafik çoxdursa, ən çox verilən sualları embedding bazasına yığıb "Semantic Cache" və ya "Embedding Router"ə keçid edin.

---

## Production məsələləri

1.  **Latency Budget:** Router sistemi tətbiqin ümumi cavab müddətinə 200ms-500ms əlavə edəcək. Bu səbəbdən router üçün ən sürətli modellərdən istifadə olunmalıdır.
2.  **Confidence Score:** LLM-ə instruction verin ki, əgər əmin deyilsə `UNKNOWN` qaytarsın. Hallüsinasiya edib sorğunu səhv modula yönləndirməsi istifadəçi təcrübəsini korlayır.
3.  **Monitoring:** Hansı route-un daha çox istifadə edildiyini və hansı sorğuların `UNKNOWN`-a düşdüyünü izləyin (Micrometer/Grafana). Bu, gələcəkdə hansı sahədə data-nı təkmilləşdirməli olduğunuzu göstərir.

---

## Komandaya necə tətbiq etmək

1.  **Route Definition:** Komanda ilə birlikdə sistemin dəstəklədiyi "Business Domains"-ləri müəyyənləşdirin.
2.  **Modular Development:** Hər bir route-u (RAG, SQL, API integration) ayrı bir servis/bean kimi inkişaf etdirin ki, unit testləri rahat olsun.
3.  **A/B Testing:** Router-in dəqiqliyini yoxlamaq üçün test dəstləri (gold dataset) hazırlayın (Məs: 100 sual və onların gözlənilən route-ları).

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Yuxarıdakı `SemanticRouterService`-i kiçik bir Spring Boot layihəsində tətbiq edin.
2.  İki fərqli "Tool" yaradın: `WeatherTool` və `StockTool`.
3.  Router-ə elə bir məntiq əlavə edin ki, əgər sual havadan danışırsa `WeatherTool`-u, aksiyalardan danışırsa `StockTool`-u işə salsın.
4.  **Challenge:** Embedding-based routing üçün sadə bir `Map<String, float[]> routeEmbeddings` yaradın və `VectorStore.similaritySearch` istifadə etmədən, sadə kosinus oxşarlığı ilə router düzəltməyə çalışın.

---

## Mənbələr

-   Spring AI ChatClient Docs: https://docs.spring.io/spring-ai/reference/api/chatclient.html (yoxlanılmalıdır)
-   Semantic Routing Patterns: https://github.com/a16z-infra/llm-app-stack (konseptual)
-   Cosine Similarity in Java: https://commons.apache.org/proper/commons-math/ (riyazi kitabxanalar üçün)
