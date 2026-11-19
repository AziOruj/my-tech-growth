# Spring AI: Text-to-SQL və Müəssisə Verilənlərinin Təbii Dillə Sorğulanması

**Tarix:** 2026-11-19 · **Kateqoriya:** RAG / Database · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Müəssisə daxilindəki məlumatların böyük hissəsi hələ də strukturlaşdırılmış şəkildə Relational Database-lərdə (PostgreSQL, Oracle, SQL Server) saxlanılır. Vektor bazaları (RAG) qeyri-strukturlaşdırılmış sənədlər üçün əla olsa da, "Keçən ay ən çox satış edən 5 filialımız hansıdır?" kimi aqreqasiya suallarına cavab verə bilmir. **Text-to-SQL** yanaşması LLM-lərin SQL dilini anlama qabiliyyətindən istifadə edərək, texniki olmayan istifadəçilər və analitiklər üçün birbaşa dataya çıxış imkanı yaradır. Tech Lead olaraq bu, həm daxili BI alətlərini sürətləndirmək, həm də müştəri tərəfə "ağıllı hesabat" modulu əlavə etmək üçün strateji bir addımdır.

---

## Əsas anlayışlar

1.  **Schema Context Injection:** LLM-ə verilənlər bazasının strukturunu (table names, columns, relationships) izah edən xüsusi prompt.
2.  **SQL Generation vs. Execution:** LLM SQL kodunu hazırlayır, lakin onu icra etmək üçün backend-də təhlükəsiz bir mühit (read-only user) lazımdır.
3.  **Self-Correction Loop:** Əgər LLM-in yazdığı SQL sintaktik səhv verərsə, xətanı LLM-ə geri göndərib onu düzəltməsini istəmək mexanizmi.
4.  **Schema Pruning:** LLM-ə bütün bazanı deyil, yalnız sorğuya uyğun cədvəlləri göndərmək (token qənaəti və dəqiqlik üçün).

---

## Kod nümunəsi: Dinamik SQL Generator Tool

Bu nümunədə biz Spring AI `ChatClient` və `JdbcTemplate` vasitəsilə sadə bir "Database Explorer" tool-u yaradacağıq.

### 1. Database Metadata Service

LLM-ə bazanın strukturunu vermək üçün bir servis.

```java
@Service
public class DbMetadataService {
    private final JdbcTemplate jdbcTemplate;

    public DbMetadataService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public String getSchemaDescription() {
        // Real ssenaridə burada DatabaseMetaData istifadə edərək 
        // yalnız lazım olan cədvəlləri (white-list) qaytarmaq tövsiyə olunur.
        return """
            Table: sales
            Columns: id (int), product_name (text), amount (decimal), sale_date (timestamp), region (text)
            Table: inventory
            Columns: id (int), product_name (text), stock_count (int)
            """;
    }
}
```

### 2. SQL Execution Tool

LLM-in təklif etdiyi SQL-i icra edən funksiya. **Vacib:** Bu tool üçün istifadə olunan DB user-i yalnız `SELECT` icazəsinə malik olmalıdır.

```java
public record SqlRequest(String sqlQuery) {}

@Component
public class SqlQueryTool {
    private final JdbcTemplate jdbcTemplate;

    public SqlQueryTool(@Qualifier("readOnlyJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Bean
    @Description("Verilənlər bazasında SQL sorğusu icra edir və nəticəni JSON formatında qaytarır.")
    public Function<SqlRequest, String> executeReadOnlyQuery() {
        return request -> {
            try {
                var results = jdbcTemplate.queryForList(request.sqlQuery());
                return results.toString();
            } catch (Exception e) {
                return "Xəta baş verdi: " + e.getMessage() + ". Zəhmət olmasa SQL-i düzəldib yenidən yoxla.";
            }
        };
    }
}
```

### 3. ChatClient İnteqrasiyası

```java
@Service
public class BusinessIntelligenceService {
    private final ChatClient chatClient;
    private final DbMetadataService metadataService;

    public BusinessIntelligenceService(ChatClient.Builder builder, DbMetadataService metadataService) {
        this.chatClient = builder
            .defaultSystem("""
                Sən bir Data Analyst köməkçisisən. 
                Sənə verilən verilənlər bazası strukturuna əsasən SQL sorğuları yaz və icra et.
                Struktur: {schema}
                Qaydalar:
                1. Yalnız SELECT sorğularına icazə var.
                2. Nəticələri insan dilində izah et.
                3. Əgər SQL xəta verərsə, xətanı analiz et və düzəlt.
                """.replace("{schema}", metadataService.getSchemaDescription()))
            .build();
        this.metadataService = metadataService;
    }

    public String answerBusinessQuestion(String question) {
        return chatClient.prompt()
            .user(question)
            .tools("executeReadOnlyQuery") // SqlQueryTool içindəki Bean adı
            .call()
            .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Problem | Həll Yanaşması | Trade-off |
| :--- | :--- | :--- |
| **Təhlükəsizlik** | SQL Injection-dan qorunmaq üçün LLM-in yazdığı sorğunu `GRANT SELECT` ilə məhdudlaşdırılmış istifadəçi ilə icra etmək. | `INSERT`/`UPDATE` tələb edən əməliyyatları AI-ya buraxmamaq (Manual approval lazımdır). |
| **Dəqiqlik** | Few-shot prompting (Sorğu-SQL nümunələri vermək). | Token sayını artırır və xərcləri yüksəldir. |
| **Böyük Sxemlər** | Semantic Search vasitəsilə suala uyğun olan cədvəllərin seçilməsi (Schema RAG). | Əlavə bir pre-processing addımı tələb edir. |

---

## Production məsələləri

1.  **Read-Only Replicas:** AI sorğularını əsas bazada deyil, oxuma kopyalarında (read-replicas) icra edin ki, analitik sorğular prodakşn performansına təsir etməsin.
2.  **Query Guardrails:** SQL sorğularında `LIMIT` olub-olmadığını yoxlayan bir interceptor əlavə edin. LLM-in təsadüfən 10 milyon sətri çəkməsinin qarşısını alın.
3.  **Explain Plan Validation:** Çox mürəkkəb sorğuları icra etməzdən əvvəl LLM-dən "Query Plan"-ı yoxlamasını və ya sistemin avtomatik olaraq ağır sorğuları bloklamasını təmin edin.

---

## Komandaya necə tətbiq etmək

1.  **Internal BI Tools:** İlk növbədə müştəri datası ilə deyil, daxili loglar və ya performans metrikaları bazası üzərində prototip hazırlayın.
2.  **Monitoring:** AI-ın yazdığı SQL-ləri və onların icra müddətini xüsusi bir dashboard-da (məs. Grafana) izləyin.
3.  **Data Privacy:** Bazadakı PII (Personal Identifiable Information) sütunlarını (email, telefon) LLM-ə göstərməyin və ya onları anonimləşdirilmiş görünümlər (Views) vasitəsilə təqdim edin.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Bir H2 in-memory bazası yaradın və ora `employees` cədvəli əlavə edin.
2.  Spring AI `ChatClient` istifadə edərək, "Maaşı 5000-dən çox olan neçə işçi var?" sualına SQL yazıb cavab verən servis qurun.
3.  **Challenge:** LLM-ə yanlış sütun adı verildikdə (məsələn, `salary` yerinə `wage`), onun xətanı tutub bazanın strukturuna yenidən baxaraq düzgün sütunu tapmasını təmin edən bir prompt ssenarisi qurun.

---

## Mənbələr

-   Spring AI Tool Calling: https://docs.spring.io/spring-ai/reference/api/tools.html (yoxlanılmalıdır)
-   PostgreSQL Read-Only Roles: https://www.postgresql.org/docs/current/sql-grant.html
-   Text-to-SQL Best Practices (LangChain blog): https://blog.langchain.dev/sql-research-and-benchmarking/ (konseptual oxşarlıq üçün)
