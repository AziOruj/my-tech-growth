# Spring AI: Promptların Xariciləşdirilməsi və Versiyalanması

**Tarix:** 2026-11-12 · **Kateqoriya:** Best Practices / Architecture · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

AI sistemləri böyüdükcə promptlar (təlimatlar) daha mürəkkəb və uzun olur. Onları Java kodunun daxilində (hardcoded strings) saxlamaq **Separation of Concerns** prinsipini pozur, kodun oxunmasını çətinləşdirir və hər kiçik söz dəyişikliyi üçün bütün tətbiqin yenidən build/deploy olunmasını tələb edir. Tech Lead kimi, promptları proqram kodundan ayırmaq, onları versiyalamaq və domain ekspertlərinə (Prompt Engineers) koda toxunmadan onları redaktə etmək imkanı yaratmaq sizin vəzifənizdir.

---

## Əsas anlayışlar

1.  **Prompt Templates (.st):** Spring AI promptları strukturlaşdırılmış şəkildə saxlamaq üçün `PromptTemplate` sinfini və StringTemplate (.st) formatını dəstəkləyir.
2.  **Resource Abstraction:** Spring-in `Resource` interfeysi vasitəsilə promptları `classpath`, `file`, `s3` və ya verilənlər bazasından yükləmək olar.
3.  **Prompt Versioning:** Promptların fərqli versiyalarını idarə etmək (məsələn, `v1_expert_mode.st`, `v2_concise_mode.st`).
4.  **Dynamic Rendering:** İş vaxtı (runtime) prompt daxilindəki dəyişənlərin (placeholders) real data ilə əvəzlənməsi.

---

## Kod nümunəsi: Externalized Prompt Management

Aşağıdakı nümunədə prompt-u `.st` faylından yükləyib, onu dinamik parametrlərlə necə işlətməyi görəcəksiniz.

### 1. Prompt Faylı (`src/main/resources/prompts/customer-service.st`)
```text
Sən bir bankın müştəri xidmətləri asistanısan.
Müştərinin adı: {customer_name}
Müştərinin sorğusu: {user_input}

Zəhmət olmasa, sorğuya {tone} tonunda cavab ver və cavabı {max_words} sözdən çox olmasın.
```

### 2. Service Səviyyəsində İdarəetmə
`@Value` annotasiyası ilə faylı yükləyirik və `ChatClient` ilə istifadə edirik.

```java
@Service
public class SupportAgentService {

    private final ChatClient chatClient;
    
    @Value("classpath:/prompts/customer-service.st")
    private Resource supportPromptResource;

    public SupportAgentService(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    public String generateResponse(String name, String query, String tone) {
        return chatClient.prompt()
                .user(u -> u.text(supportPromptResource)
                        .param("customer_name", name)
                        .param("user_input", query)
                        .param("tone", tone)
                        .param("max_words", 50))
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Metod | Üstünlükləri | Çatışmazlıqları |
| :--- | :--- | :--- |
| **Classpath Resource** | Sadədir, Git ilə versiyalanır, əlavə infrastruktur tələb etmir. | Dəyişiklik üçün yenidən deployment (CI/CD) tələb olunur. |
| **Database / Config Server** | Runtime-da (isti-isti) prompt dəyişdirilə bilər. | Cache idarəedilməsi çətindir, bazaya asılılıq yaranır. |
| **S3 / Cloud Storage** | Böyük həcmli və mürəkkəb prompt kitabxanaları üçün ideal. | Latency (şəbəkə gecikməsi) və xüsusi access permission-lar tələb edir. |

**Tech Lead Tövsiyəsi:** Başlanğıc üçün promptları `src/main/resources/prompts/` qovluğunda saxlayın. Əgər tətbiqiniz çoxsaylı A/B testləri tələb edən dinamik bir sistemdirsə, promptları **Config Server** (Spring Cloud Config) və ya xüsusi bir **Prompt CMS**-ə köçürməyi düşünün.

---

## Production məsələləri

1.  **Prompt Injections:** Xaricdən (istifadəçidən) gələn datanı prompt template-ə yerləşdirərkən ehtiyatlı olun. `PromptTemplate` parametr əvəzləməsi edir, lakin input validation hələ də vacibdir.
2.  **Caching:** Prompt fayllarını hər dəfə diskdən oxumayın. Spring `Resource` obyektini bir dəfə yükləyib yaddaşda saxlayır, lakin dinamik (DB-yə bağlı) sistemlərdə `Caffeine` və ya `Redis` cache istifadə edin.
3.  **Observability:** Hər bir LLM çağırışında hansı prompt versiyasının işlədildiyini metadata olaraq loglara (və ya Micrometer trace-lərə) əlavə edin. Bu, "Niyə model dünən başqa cavab verirdi?" sualına cavab tapmağa kömək edəcək.

---

## Komandaya necə tətbiq etmək

1.  **Naming Convention:** Prompt faylları üçün standart adlandırma müəyyən edin: `<domain>-<intent>-v<version>.st` (məsələn: `loan-approval-v2.st`).
2.  **Folder Structure:** Kod bazasında `src/main/resources/prompts/` qovluğunu yaradın və string literallarını ora köçürməyi məcburi edin.
3.  **Prompt Reviews:** Kod review zamanı yalnız Java kodunu deyil, `.st` fayllarındakı ingilis/azərbaycan dilindəki təlimatları da nəzərdən keçirin. Promptun effektivliyini yoxlamaq üçün evaluation testlərindən istifadə edin.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Resurslar qovluğunda `summary.st` adlı fayl yaradın və ora mürəkkəb bir prompt yazın.
2.  Spring Boot projenizdə bu promptu `@Value` ilə oxuyun.
3.  Eyni funksionallığı təmin edən iki fərqli prompt faylı yaradın (məsələn, `short-summary.st` və `detailed-summary.st`).
4.  İstifadəçidən gələn parametrdən asılı olaraq hansı prompt faylının işlədiləcəyini seçən dinamik bir servis yazın.

---

## Mənbələr

-   Spring AI Prompt Templates: https://docs.spring.io/spring-ai/reference/api/prompt.html (yoxlanılmalıdır)
-   Spring Resource Loading: https://docs.spring.io/spring-framework/reference/core/resources.html (yoxlanılmalıdır)
-   Best Practices for Prompt Engineering: https://platform.openai.com/docs/guides/prompt-engineering (yoxlanılmalıdır)
