# LangChain4j ilə Tool Calling: Annotasiyalarla "Java-First" Agentlər

**Tarix:** 2026-10-27 · **Kateqoriya:** AI Frameworks / Tooling · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · LangChain4j 1.0.0 (yoxlanılmalıdır)

---

## Niyə vacibdir

Tech Lead olaraq, AI-nı mövcud biznes məntiqinə inteqrasiya edərkən ən böyük problem "həmin funksiyanı LLM-ə necə izah edim?" sualıdır. Spring AI-da biz adətən `Function` interface-lərini Bean olaraq qeydiyyatdan keçiririk. **LangChain4j** isə daha "Java-idiomatic" yanaşma təklif edir: `@Tool` annotasiyası. Bu, mövcud servis metodlarını heç bir əlavə JSON şeması yazmadan AI-nın istifadəsinə verməyə imkan verir. Bu, kodun oxunaqlığını artırır və AI-nın daxili sistemlərlə (DB, digər mikroservislər) əlaqəsini kəskin asanlaşdırır.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **@Tool** | Metodu AI-ya "alət" (tool) kimi təqdim edən annotasiya. LangChain4j metodun adını, parametrlərini və Javadoc-unu (və ya annotasiya daxili təsviri) oxuyaraq JSON-şema yaradır. |
| **Tool Calling** | LLM-in suala cavab vermək üçün müəyyən bir Java metodunu çağırmalı olduğunu başa düşməsi və lazım olan parametrləri JSON formatında qaytarması prosesi. |
| **AiServices** | LangChain4j-də yüksək səviyyəli abstraksiya. Interface-i LLM-ə bağlayır və tool-ları avtomatik bura inyeksiya edir. |
| **ToolSpecification** | Proqramatik olaraq tool-ların təsvir edilməsi (dinamik tool discovery üçün). |

---

## Kod nümunəsi: Biznes Servislərinin AI-ya inteqrasiyası

Təsəvvür edin ki, bir logistika sisteminiz var. AI müştərinin sifariş statusunu yoxlamalıdır.

### 1. Servis Təbəqəsi (The Tool)

```java
import dev.langchain4j.agent.tool.Tool;
import org.springframework.stereotype.Component;

@Component
public class LogisticsService {

    // AI-ya bu metodun nə etdiyini dəqiq izah edirik
    @Tool("Sifarişin cari statusunu və təxmini çatdırılma vaxtını qaytarır")
    public OrderInfo getOrderStatus(String orderId) {
        // Real sistemdə DB və ya kənar API çağırışı olacaq
        return new OrderInfo(orderId, "Yoldadır", "2026-10-30");
    }
}

// Java 21 Record
public record OrderInfo(String id, String status, String eta) {}
```

### 2. AI Service Interface-i

```java
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.spring.AiService;

@AiService
public interface LogisticsAssistant {

    @SystemMessage("Sən logistika köməkçisisən. Müştərilərə sifarişləri haqqında məlumat verirsən.")
    String chat(String userMessage);
}
```

### 3. Konfiqurasiya (Spring Boot 4.x)

```java
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AIConfig {

    @Bean
    public ChatLanguageModel chatLanguageModel() {
        return OpenAiChatModel.builder()
                .apiKey(System.getenv("OPENAI_API_KEY"))
                .modelName("gpt-4o") // Tool calling üçün güclü model lazımdır
                .build();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **Reflection vs Performance:**
   LangChain4j startup zamanı `@Tool` metodlarını tapmaq üçün reflection-dan istifadə edir. Çox sayda tool olan sistemlərdə bu, startup müddətinə cüzi təsir edə bilər, lakin runtime-da metodun çağırılması birbaşa Java çağırışıdır (yüksək performans).

2. **Error Handling (The "AI Logic"):**
   Əgər Java metodunuz `RuntimeException` atarsa, LangChain4j bunu tutub LLM-ə "Error: ..." şəklində qaytara bilər. Tech Lead olaraq qərar verməlisiniz: LLM xətanı özü interpretasiya edib istifadəçiyə desin, yoxsa proqramatik olaraq müdaxilə edilsin? `ToolExecutionResult` bu mərhələdə istifadə oluna bilər.

3. **Tool Context:**
   Bəzi tool-lar cari istifadəçinin ID-sinə (SecurityContext) ehtiyac duyur. LangChain4j-də tool metoduna `String userId` parametri əlavə edib, onu `@Tool` annotasiyasında gizlətmək olar ki, LLM onu doldurmağa çalışmasın, biz isə proqramatik inyeksiya edək.

---

## Production məsələləri

- **Hallucinated Parameters:** LLM bəzən metodu çağırmaq üçün uydurma `orderId` göndərə bilər. Metod daxilində mütləq input validation olmalıdır.
- **Dry Run / Confirmation:** Kritik əməliyyatlar (məs: "Sifarişi ləğv et") üçün LLM-in birbaşa metodu çağırmasına icazə verməyin. Bunun üçün "Human-in-the-loop" və ya iki mərhələli təsdiqləmə workflow-u qurun.
- **Tool Limits:** Bir LLM çağırışına 50 tool təsviri göndərmək həm xərcləri artırır (prompt token), həm də modelin "fikrini yayındırır". Hər servis üçün yalnız lazım olan tool-ları qruplaşdırın.

---

## Komandaya necə tətbiq etmək

1. **Javadoc Standartı:** Komandaya tapşırın ki, `@Tool` metodlarının Javadoc-larını (və ya annotasiya `value`-sunu) sanki bir junior proqramçıya izah edirmiş kimi yazsınlar. LLM-in dəqiqliyi bu təsvirlərdən asılıdır.
2. **Observability:** `langchain4j-open-telemetry` istifadə edərək, LLM-in hansı tool-u nə dərəcədə tez-tez və hansı parametrlərlə çağırdığını izləyən dashboard yaradın.
3. **Security:** AI-ya verilən metodların "Read-Only" olmasına üstünlük verin. "Write" metodları üçün mütləq audit log-lar və limitlər tətbiq edin.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Bir Spring Boot layihəsində LangChain4j inyeksiya edin.
2. Sadə bir `WeatherService` yaradın və daxilində `@Tool` annotasiyası ilə `getTemperature(String city)` metodu qurun.
3. AI-ya "Bakıda hava neçə dərəcədir?" sualını verin və konsolda Java metodunuzun işə düşdüyünü (`System.out.println` ilə) müşahidə edin.
4. Metodun təsvirini (description) qəsdən yanlış yazın (məs: "Bu metod valyuta məzənnəsini qaytarır") və LLM-in davranışının necə pisləşdiyini görün.

---

## Mənbələr

- LangChain4j Tools Documentation: https://docs.langchain4j.dev/tutorials/tools
- OpenAI Function Calling Guide: https://platform.openai.com/docs/guides/function-calling (yoxlanılmalıdır)
- Java Reflection in AI Tooling: https://www.baeldung.com/java-langchain4j (yoxlanılmalıdır)
