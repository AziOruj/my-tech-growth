# Spring AI ilə Tool / Function Calling mexanizmi

**Tarix:** 2026-10-13 · **Kateqoriya:** Spring AI · **Səviyyə:** Orta
**Versiyalar:** Java 21 · Spring Boot 4.1.1 (yoxlanılmalıdır) · Spring AI 2.0.1 (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM-lərin ən böyük məhdudiyyətlərindən biri onların real-time (cari) məlumatlara və xarici sistemlərə birbaşa çıxışının olmamasıdır (məsələn, cari valyuta məzənnəsi, istifadəçinin sifariş statusu və ya daxili anbar qalığı). Əgər hər dəfə xarici məlumatı prompt-a əvvəlcədən daxil etməyə çalışsaq (hardcoded), token limiti tez dolar və məlumat köhnələr. **Tool / Function Calling** mexanizmi LLM-ə özü qərar verərək tətbiqimizin Java metodlarını (alətlərini) "çağırmaq" səlahiyyəti verir. Tech Lead üçün bu, LLM-i sadəcə mətn generatorundan daxili mikroservislərinizlə əlaqəli işləyən **autonom agent komponentinə** çevirmək deməkdir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **Function Calling (Tools)** | LLM-in istifadəçinin sualına cavab vermək üçün hansı xarici funksiyanın çağırılmalı olduğunu müəyyənləşdirməsi və funksiyaya ötürüləcək arqumentləri JSON formatında formalaşdırması. |
| **`@Tool` annotasiyası** | Spring AI-da Java metodunu LLM tərəfindən çağırıla bilən alət kimi qeydiyyatdan keçirmək üçün istifadə olunan annotasiya. |
| **Tool Execution Lifecycle** | 1) İstifadəçi sual verir -> 2) LLM suala cavab vermək üçün alət tələb edir (`ToolCall`) -> 3) Spring AI arxa planda uyğun Java metodunu icra edir -> 4) Metodun nəticəsi LLM-ə geri ötürülür -> 5) LLM yekun cavabı natural dildə formalaşdırır. |
| **`@ToolParam` / Description** | Metodun arqumentlərini LLM-ə izah etmək üçün istifadə olunan annotasiya. Model bu təsvirlərə baxaraq parametrə nə ötürəcəyini anlayır. |
| **Dynamic vs Static Tools** | Statik alətlər `@Bean` və ya `@Tool` kimi birbaşa konteksə yazılır; dinamik alətlər isə `ChatClient` çağırışı zamanı `withTools(...)` vasitəsilə səfərbər edilir. |

---

## Kod nümunəsi

Ssenari: İstifadəçi bank hesabındakı son əməliyyatları və ya cari balansı soruşur. LLM müvafiq Java servis metodlarını (alətlərini) çağıraraq məlumatı əldə edir və istifadəçiyə dəqiq cavab qaytarır.

### 1. Tool (Alət) komponentinin yaradılması

Spring AI-da funksiyalar `@Tool` annotasiyası ilə təchiz olunmuş Spring Bean-ləridir.

```java
package az.example.ai.tools;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Component
public class BankingTools {

    private static final Logger log = LoggerFactory.getLogger(BankingTools.class);

    @Tool(description = "Get current account balance for a given account number")
    public AccountBalanceResponse getAccountBalance(
            @ToolParam(description = "The bank account number, format: AZEN00... or 16 digits") 
            String accountNumber
    ) {
        log.info("TOOL CALLED: getAccountBalance with accountNumber={}", accountNumber);
        // Real sistemdə burada Core Banking servisi çağırılır
        return new AccountBalanceResponse(accountNumber, new BigDecimal("1450.50"), "AZN");
    }

    @Tool(description = "Get recent transactions for a bank account within a date range")
    public List<TransactionDto> getRecentTransactions(
            @ToolParam(description = "The bank account number") String accountNumber,
            @ToolParam(description = "Start date in YYYY-MM-DD format") String startDate,
            @ToolParam(description = "End date in YYYY-MM-DD format") String endDate
    ) {
        log.info("TOOL CALLED: getRecentTransactions for account={}, from={}, to={}", accountNumber, startDate, endDate);
        
        // Mock data
        return List.of(
                new TransactionDto("TX-9812", new BigDecimal("-45.00"), "Supermarket", LocalDate.now().minusDays(1)),
                new TransactionDto("TX-9813", new BigDecimal("1200.00"), "Salary", LocalDate.now().minusDays(3))
        );
    }

    public record AccountBalanceResponse(String accountNumber, BigDecimal balance, String currency) {}
    public record TransactionDto(String transactionId, BigDecimal amount, String merchant, LocalDate date) {}
}
```

### 2. ChatClient ilə Tool-ların birləşdirilməsi

`ChatClient`-ə `defaultTools` və ya sorğu səviyyəsində `tools(...)` vasitəsilə alətləri ötürürük. Spring AI avtomatik olaraq bu metodların sxemini LLM-ə (məsələn, OpenAI-a) göndərir.

```java
package az.example.ai.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class BankingAssistantService {

    private final ChatClient chatClient;

    // BankingTools Spring konteksində olduğu üçün Spring AI onları avtomatik tanıyır
    public BankingTools(ChatClient.Builder builder, az.example.ai.tools.BankingTools bankingTools) {
        this.chatClient = builder
                .defaultSystem("""
                        You are a secure and helpful AI banking assistant.
                        Use the provided tools to fetch real-time data when a user asks about balances or transactions.
                        Never invent financial data. If a tool fails, inform the user politely.
                        """)
                .defaultTools(bankingTools) // Alətləri ChatClient-ə qeydiyyatdan keçiririk
                .build();
    }

    public String chatWithUser(String userId, String userQuery) {
        return chatClient.prompt()
                .user(userQuery)
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Aspekt | Avtomatik Tool Call (Spring AI Managed) | Manual Tool Execution (Low-level API) |
|---|---|---|
| **Necə işləyir?** | Spring AI arxa planda loop yaradır: LLM istəyir -> Java metodu işləyir -> Nəticə LLM-ə qayıdır -> Yekun cavab verilir. | Developer LLM-in `ToolCall` istəyini tutur, metodu əllə çağırır və cavabı yenidən LLM-ə özü göndərir. |
| **Kod mürəkkəbliyi** | **Çox aşağı**. Sadəcə `@Tool` yazmaq və `defaultTools` kimi qeyd etmək kifayətdir. | Yüksək. JSON-ların parse edilməsi və multi-turn loop-un idarəsi tələb olunur. |
| **Nəzarət və Təhlükəsizlik** | Standart hallarda bütün `@Tool` metodları LLM tərəfindən birbaşa çağırıla bilər. | Hər bir tool çağırışından əvvəl icazə (authorization) və validasiya yoxlamaları asanlıqla qoyula bilər. |
| **Performans (Latency)** | Çoxlu tool çağırışları zənciri yaranarsa (multi-step), HTTP round-trip sayı artır və cavab gecikir. | Eyni şəkildə round-trip tələb olunur, lakin paralel tool çağırışları optimallaşdırıla bilər. |

**Tech Lead Qərarı:** Standart biznes məntiqi üçün həmişə **Spring AI Managed Tool Call** istifadə edin. Əgər alət kritik əməliyyat icra edəcəksə (məsələn, pul köçürməsi), mütləq middleware / interceptor səviyyəsində təhlükəsizlik yoxlaması əlavə edin (alət çağırılmamışdan qvvəl istifadəçinin hüququ yoxlanılmalıdır).

---

## Production məsələləri

**Təhlükəsizlik və Prompt Injection Riskleri**
- **Prompt Injection via Tools:** İstifadəçi prompt vasitəsilə alətə zərərli arqumentlər ötürməyə cəhd edə bilər (məsələn, `accountNumber` yerinə SQL Injection və ya başqa istifadəçinin hesab nömrəsini daxil etməyi LLM-ə əmr etmək).
- **Həll:** `@Tool` metodlarının içində mütləq **Security / Context validation** aparın. Alətə gələn `accountNumber`-in həqiqətən cari autentifikasiya olunmuş istifadəçiyə (SecurityContext) məxsus olub-olmadığını yoxlayın. LLM-ə etibar etməyin!

**Xərc və Token İdarəçiliyi**
- Hər bir `@Tool` və onun metod imzası (parametrləri, təsvirləri) LLM-ə sistem promptu ilə birlikdə göndərilir. Əgər layihədə 50+ fərqli tool varsa, bu, hər sorğuda minlərlə əlavə input token deməkdir.
- **Tövsiyə:** `ChatClient` səviyyəsində yalnız həmin səhifə və ya istifadəçi konteksti üçün gərəkli olan alətləri (`tools(...)`) dinamik olaraq təyin edin.

**Xəta İdarəçiliyi (Error Handling)**
- Əgər alət işləyərkən exception atarsa (məsələn, Core Banking servisi sönübsө), Spring AI bu exception-ı tutaraq LLM-ə "error message" kimi ötürə bilər. Model bunu oxuyub istifadəçiyə "Sistemdə texniki nasazlıq var" deyə bilər. Tool metodlarınızda unhandled exception buraxmamağa çalışın, xətanı təmiz `String` və ya obyekt şəklində qaytarın.

---

## Komandaya necə tətbiq etmək

1. **Tool-ları Domen Servislərindən Ayırın:** Mövcud Spring Data / JPA servis metodlarını birbaşa `@Tool` ilə annotasiya etməyin. LLM üçün xüsusi `*AiTool` sinifləri yaradın; bu siniflər əsas domen servislərini çağırsın, lakin əlavə təhlükəsizlik və data sanitizasiyası təmin etsin.
2. **Review Checklist:**
   - `@ToolParam` təsvirləri ingilis dilində dəqiq və qısadırrmı? (Model rus və ya azərbaycan dilində verilən təsvirlərdə bəzən yanıla bilir).
   - Alət metodunda istifadəçi səlahiyyəti (Authorization) yoxlanılırmı?
   - Metodun qaytardığı obyektlər JSON-a rahat çevrilə bilən `record` tipindədirmi?

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. `BankingTools` sinfinə əlavə olaraq `transferFunds(String sourceAccount, String targetAccount, BigDecimal amount)` aləti əlavə edin.
2. Bu alətin daxilində məbləğ 1000 AZN-dən çox olarsa `IllegalStateException` atan (və ya simulyasiya edilmiş limit yoxlaması edən) məntiq yazın.
3. `ChatClient` ilə bir test yazın: İstifadəçi botdan *"Hesabımdan digər hesaba 1500 AZN köçür"* tələb etsin.
4. LLM-in bu aləti çağırdığını, xətanı tutduğunu və istifadəçiyə səbəbi izah edən cavab qaytardığını loglardan və test nəticəsindən izləyin.

---

## Mənbələr

- Spring AI Reference — Function Calling (2.0.1, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/functions.html
- OpenAI Documentation — Function Calling: https://platform.openai.com/docs/guides/function-calling
