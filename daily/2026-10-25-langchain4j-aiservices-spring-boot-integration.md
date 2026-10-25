# LangChain4j AiServices və Spring Boot İnteqrasiyası

**Tarix:** 2026-10-25 · **Kateqoriya:** AI Frameworks · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · LangChain4j 1.0.0 (yoxlanılmalıdır)

---

## Niyə vacibdir

Spring AI çox güclü və "Spring-native" bir həll olsa da, Java ekosistemində AI inteqrasiyası üçün ən yetkin və zəngin kitabxana **LangChain4j** hesab olunur. Tech Lead olaraq, komandanızın kod bazasını təmiz saxlamaq üçün "Declarative AI Services" konseptini bilməlisiniz. Bu, eynilə Spring Data JPA interfeysləri kimi, AI məntiqini interfeyslər arxasında gizlətməyə, kodu daha oxunaqlı, test edilə bilən və modellərdən asılı olmayan hala gətirməyə imkan verir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **AiServices** | LangChain4j-nin ən yüksək səviyyəli API-si. AI-ni Java interfeysi kimi təsvir etməyə imkan verir. |
| **ChatLanguageModel** | LLM ilə birbaşa əlaqə quran aşağı səviyyəli interfeys (OpenAI, Anthropic, Gemini və s.). |
| **Structured Outputs** | `@Description` və ya POJO qaytarma növü vasitəsilə AI-nin cavabını birbaşa Java obyektinə çevirmək. |
| **System/User Messages** | `@SystemMessage` və `@UserMessage` anotasiyaları ilə prompt-ları metod səviyyəsində idarə etmək. |

---

## Kod nümunəsi: Deklarativ AI Xidməti

LangChain4j-nin Spring Boot starter-indən istifadə edərək, müştəri dəstəyi üçün ağıllı bir agent yaradaq.

### 1. Maven Dependency (pom.xml)

```xml
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-open-ai-spring-boot-starter</artifactId>
    <version>1.0.0</version> <!-- yoxlanılmalıdır -->
</dependency>
```

### 2. AiService İnterfeysinin Təyini

Bu interfeys LLM ilə interaksiyanı tamamilə abstraksiya edir.

```java
package az.example.ai.customer;

import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import dev.langchain4j.service.V;
import dev.langchain4j.service.spring.AiService;

@AiService
public interface CustomerSupportAgent {

    @SystemMessage("""
        Sən mehriban müştəri xidmətləri agentisən. 
        Müştərilərə {{department}} şöbəsi adından kömək edirsən.
        Cavabların qısa və peşəkar olmalıdır.
    """)
    String answer(@V("department") String department, @UserMessage String userQuery);

    @SystemMessage("Verilmiş mətndən müştərinin emosional vəziyyətini (SENTIMENT) təyin et.")
    Sentiment analyzeSentiment(String text);
}

enum Sentiment {
    POSITIVE, NEUTRAL, NEGATIVE
}
```

### 3. Konfiqurasiya və İstifadə

Spring Boot avtomatik olaraq `CustomerSupportAgent` üçün bir bean yaradacaq.

```java
package az.example.ai.customer;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class SupportRunner implements CommandLineRunner {

    private final CustomerSupportAgent agent;

    public SupportRunner(CustomerSupportAgent agent) {
        this.agent = agent;
    }

    @Override
    public void run(String... args) {
        // 1. Sadə söhbət
        String response = agent.answer("Texniki Dəstək", "Parolumu necə sıfırlaya bilərəm?");
        System.out.println("AI Cavabı: " + response);

        // 2. Strukturlaşdırılmış çıxış (Sentiment analysis)
        Sentiment sentiment = agent.analyzeSentiment("Sizin xidmətdən çox narazıyam, hər şey çox ləngdir!");
        System.out.println("Müştəri əhval-ruhiyyəsi: " + sentiment); // Çıxış: NEGATIVE
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **Spring AI vs LangChain4j:**
   - **Spring AI:** Əgər layihəniz tamamilə Spring ekosisteminə (Spring Integration, Batch, Cloud) bağlıdırsa və minimalist yanaşma istəyirsinizsə seçin.
   - **LangChain4j:** Əgər daha geniş model dəstəyi (15+ provayder), daha yetkin RAG imkanları və "AiServices" kimi güclü abstraksiyalar lazımdırsa seçin. Hal-hazırda LangChain4j daha çox "production" təcrübəsinə malikdir.

2. **Interface-Driven Design:**
   - `AiServices` istifadə etdikdə, biznes məntiqi LLM-in necə çağırılmasından (HTTP client, retry, JSON parsing) tamamilə ayrılır. Bu, Tech Lead-ə imkan verir ki, sabah LLM provayderini (məs: OpenAI-dan Anthropic-ə) yalnız bir konfiqurasiya sətri ilə dəyişsin, kodun özünə toxunmasın.

3. **Loose Coupling:**
   - İnterfeyslər sayəsində Unit Testlərdə AI agentini asanlıqla Mock etmək olar. Bu, LLM xərclərini azaltmaq və CI/CD prosesini sürətləndirmək üçün kritikdir.

---

## Production məsələləri

- **Error Handling:** `AiServices` daxilində baş verən şəbəkə xətalarını və ya model limitlərini (Rate Limit) idarə etmək üçün `@Retry` (Spring Retry və ya Resilience4j) ilə birlikdə istifadə edin.
- **Observability:** LangChain4j `ChatModelListener` interfeysini təqdim edir. Bu interfeys vasitəsilə hər bir sorğunun nə qədər token yandırdığını və hansı "internal prompt"-un getdiyini loqlaya bilərsiniz.
- **Prompt Versioning:** Prompt-lar Java kodunun içində (`@SystemMessage`) sərt şəkildə yazılmamalıdır. Böyük layihələrdə bunları `Resource` fayllarından (JSON/YAML) yükləmək daha məqsədəuyğundur.

---

## Komandaya necə tətbiq etmək

1. **Abstraksiya standartı:** Komandaya tapşırın ki, heç vaxt `ChatLanguageModel` (aşağı səviyyəli) obyektini birbaşa Controller və ya Service daxilində çağırmasınlar. Həmişə bir `@AiService` interfeysi yaradılmalıdır.
2. **Modular AI:** AI funksionallığını (məs: tərcümə xidməti, xülasə xidməti) ayrı-ayrı interfeyslərə bölün. Bu, "God Object" AI agentlərinin yaranmasının qarşısını alır.
3. **Review prosesi:** Prompt dəyişikliklərini kod review-nun bir hissəsi kimi deyil, biznes logikasının bir hissəsi kimi nəzərdən keçirin.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Yeni bir Spring Boot layihəsi yaradın və `langchain4j-open-ai-spring-boot-starter` əlavə edin.
2. Bir `NewsSummaryService` interfeysi yaradın.
3. İnterfeys daxilində mətni qəbul edən və onu `Summary` adlı bir Java rekorduna (field-lər: `title`, `briefDescription`, `category`) çevirən metod yazın.
4. `application.properties` faylında OpenAI API key-inizi qeyd edin.
5. Bir unit test yazaraq AI-nin qaytardığı Java obyektinin düzgünlüyünü yoxlayın.

---

## Mənbələr

- LangChain4j AiServices Documentation: https://docs.langchain4j.dev/tutorials/ai-services
- LangChain4j Spring Boot Starter: https://github.com/langchain4j/langchain4j-spring
- Comparison: LangChain4j vs Spring AI: https://www.baeldung.com/java-langchain4j (yoxlanılmalıdır)
