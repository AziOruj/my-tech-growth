# Komanda Səviyyəsində AI Qəbulu: Kod Standartları, Review Qaydaları və Governance

**Tarix:** 2026-10-30 · **Kateqoriya:** Best Practices & Governance · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır) · ArchUnit 1.3.x (yoxlanılmalıdır)

---

## Niyə vacibdir

AI kitabxanalarını mənimsəmək texniki başlanğıcdır, lakin Tech Lead üçün əsl çağırış bu texnologiyanı komandanın gündəlik mühəndislik mədəniyyətinə düzgün inteqrasiya etməkdir. AI kodlama alətlərinin (GitHub Copilot, Cursor və s.) nəzarətsiz istifadəsi və backend kodunda LLM çağırışlarının sistemsiz paylanması texniki borca, lisenziya risklərinə, təhlükəsizlik boşluqlarına və arxitektur xaosuna yol açır. Komandada aydın kod standartları, avtomatlaşdırılmış arxitektura testləri (ArchUnit) və xüsusi AI Code Review qaydaları tətbiq edilmədikdə mikroservis ekosistemi idarəolunmaz hala gəlir.

---

## Əsas anlayışlar

1. **AI Boundary (Sərhəd İzolasiyası):** LLM və AI asılılıqları (Spring AI, LangChain4j) heç bir halda Domain və Business Logic qatına sızmamalıdır. AI yalnız infrastruktur adapteri (Hexagonal Architecture / Ports & Adapters) kimi qalmalıdır.
2. **Prompts as Code (PaC):** Prompt-lar Java kodunda dağınıq sətirlər şəklində deyil, versiyalanan resurslar (`src/main/resources/prompts/`), şablonlar və ya konfiqurasiya kimi saxlanılmalı, dəyişikliklər Git tarixçəsində izlənməlidir.
3. **Automated Architectural Enforcement:** Komandanın qoyduğu AI sərhədlərini insan faktoru ilə yoxlamaq yetərli deyil; qaydalar CI/CD pipeline-da **ArchUnit** testləri ilə avtomatik təsdiqlənməlidir.
4. **AI-Assisted Code Hygiene:** Süni intellekt tərəfindən generasiya edilmiş kod üçün tələblər (test coverage, static analysis, non-blocking I/O) əl ilə yazılmış koddan daha sərt olmalıdır.

---

## Kod nümunəsi: ArchUnit ilə AI Sərhədlərinin Avtomatlaşdırılmış Yoxlanışı

Komandada heç bir tərtibatçının birbaşa Domen servislərində Spring AI və ya LangChain4j obyektlərini çağırmaması və prompt-ların səliqəsiz yayılmaması üçün ArchUnit testi:

### 1. Maven Asılılığı

```xml
<dependency>
    <groupId>com.tngtech.archunit</groupId>
    <artifactId>archunit-junit5</artifactId>
    <version>1.3.0</version> <!-- yoxlanılmalıdır -->
    <scope>test</scope>
</dependency>
```

### 2. Arxitektura İdarəetmə Qaydaları (Architecture Governance Test)

```java
package com.company.ai.governance;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.company", importOptions = ImportOption.DoNotIncludeTests.class)
public class AiArchitectureGovernanceTest {

    /**
     * QAYDA 1: Core Domain və Application Service-lər birbaşa Spring AI
     * və ya LangChain4j kitabxanalarından asılı ola BİLMƏZ.
     * AI yalnız 'infrastructure.ai' adapterləri daxilində gizlədilməlidir.
     */
    @ArchTest
    static final ArchRule domain_must_not_depend_on_ai_frameworks =
            noClasses()
                    .that().resideInAnyPackage("..domain..", "..application.service..")
                    .should().dependOnClassesThat()
                    .resideInAnyPackage("org.springframework.ai..", "dev.langchain4j..");

    /**
     * QAYDA 2: Yalnız təyin olunmuş AI Adapter-ləri AI framework tiplərindən istifadə edə bilər.
     */
    @ArchTest
    static final ArchRule only_ai_infrastructure_can_access_spring_ai =
            classes()
                    .that().dependOnClassesThat().resideInAnyPackage("org.springframework.ai..")
                    .should().resideInAnyPackage("..infrastructure.ai..", "..config..");

    /**
     * QAYDA 3: AI adapterləri hər zaman domendə təyin olunmuş interfeysi (Port) implement etməlidir.
     */
    @ArchTest
    static final ArchRule ai_adapters_must_implement_domain_ports =
            classes()
                    .that().resideInAPackage("..infrastructure.ai.adapter..")
                    .should().implement(com.company.domain.port.AiPort.class);
}
```

### 3. Hexagonal Qatlaşdırma (Port və Adapter Nümunəsi)

```java
// 1. Core Domain Qatı (Heç bir Spring AI asılılığı yoxdur)
package com.company.domain.port;

public interface SentimentAnalysisPort extends AiPort {
    Sentiment analyzeText(String feedback);
}

// 2. İnfrastruktur Qatı (Yalnız burada AI asılılığı mövcuddur)
package com.company.infrastructure.ai.adapter;

import com.company.domain.port.Sentiment;
import com.company.domain.port.SentimentAnalysisPort;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Component;

@Component
public class SpringAiSentimentAdapter implements SentimentAnalysisPort {

    private final ChatClient chatClient;

    public SpringAiSentimentAdapter(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    @Override
    public Sentiment analyzeText(String feedback) {
        return chatClient.prompt()
                .user(u -> u.text("Mətni analiz et: {text}").param("text", feedback))
                .call()
                .entity(Sentiment.class);
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

```
              +-----------------------------------------+
              |           Web / REST Controller         |
              +-----------------------------------------+
                                   |
                                   v
              +-----------------------------------------+
              |           Domain Use Case / Core        |  <-- Təmiz Java (No AI Libs)
              +-----------------------------------------+
                                   |
                 (Port Interface)  |
                                   v
              +-----------------------------------------+
              |      Infrastructure AI Adapter (Spring) |  <-- Spring AI / LangChain4j
              +-----------------------------------------+
                     |                     |
                     v                     v
              [LLM Provider]        [Vector DB / pgvector]
```

- **Qərar:** AI kitabxanalarının interfeys arxasında təcrid edilməsi (Hexagonal Architecture).
  - *Müsbət cəhət:* Sabah Spring AI-dan LangChain4j-yə keçmək, LLM provayderini dəyişmək və ya test zamanı sadə mock təqdim etmək cəmi bir adapter dəyişikliyi tələb edir. Domain toxunulmaz qalır.
  - *Mənfi cəhət (Trade-off):* Əlavə siniflər (DTO, Mapper, Port interfeysləri) tələb olunur, kiçik layihələrdə ilkin kod həcmini artırır.
- **Qərar:** Prompt-ların kodda inline deyil, `.st` (StringTemplate) və ya `.prompt` fayllarında saxlanması.
  - *Müsbət cəhət:* Prompt mühəndisləri və komanda üzvləri Java kodunu sındırmadan prompt dəyişikliyi edə və Git diff vasitəsilə təsirini görə bilir.
  - *Mənfi cəhət:* Runtime zamanı fayl oxunması və şablon dəyişənlərinin tip təhlükəsizliyinin (compile-time type safety) zəifləməsi.

---

## Production məsələləri

1. **Həssas Məlumatların (Secret / PII) Sızması:**
   - Komandanın IDE alətlərində (Copilot, Cursor) `.ignore` faylları yaradılmalıdır. Konfiqurasiya faylları (`application.yml`, `.env`, keys) AI kontekstinə göndərilməməlidir.
   - Kod bazasında `git-secrets` və ya `trufflehog` hook-ları məcburi olmalıdır.
2. **AI Generasiya Edilmiş Hallucinated Kod Risk:**
   - AI alətləri bəzən mövcud olmayan Spring Boot metodlarını və ya təhlükəsiz olmayan default sazlamaları təklif edir (məs: `csrf().disable()` və ya köhnəlmiş thread pool idarəetməsi).
   - "Heç bir AI kodu test olunmadan və insan tərəfindən sətirbəsət oxunmadan PR-a daxil ola bilməz" qaydası institusionallaşdırılmalıdır.
3. **Lisenziya və Müəllif Hüququ Təmizliyi:**
   - Copilot/AI assistentlərində "Allow code matching public code" opsiyası söndürülməlidir (Copyleft / GPL lisenziyalı kodların kommersiya repozitoriyasına düşməməsi üçün).

---

## Komandaya necə tətbiq etmək: AI Code Review Checklist

Pull Request (PR) yoxlanışı zamanı komandanın istifadə etməli olduğu xüsusi AI yoxlama siyahısı:

| Yoxlama Bəndi | Tələb | Niyə vacibdir? |
|---|---|---|
| **Sərhəd İzolasiyası** | AI kitabxanası yalnız `infrastructure` paketindədir? | Domen kodunun framework-ə bağlanmasının qarşısını alır. |
| **Prompt İdarəetməsi** | Prompt daxilində birbaşa string concatenation (`+`) yoxdur? | Prompt Injection hücumlarının qarşısını almaq üçün mütləq parametrləşdirmə istifadə olunmalıdır. |
| **Resilience & Fallback** | Hər bir LLM çağırışında Circuit Breaker / Timeout və Fallback var? | LLM gecikmələri sistemin bütün virtual/platform thread-lərini tükəndirməməlidir. |
| **PII Təmizliyi** | LLM-ə ötürülən məlumatlar maskalanıb? | Müştəri məlumatları (email, kart, ad) xarici API-lərə sızmamalıdır. |
| **Token və Xərc Limiti** | ChatClient çağırışlarında `maxTokens` və model parametri sabitdir? | Nəzarətsiz xərc və sonsuz dövrə (agent loops) riskini aradan qaldırır. |
| **Deterministic Testlər** | Unit testlərdə real LLM çağırışı YOXDUR? | Testlər offline işləməli və mock portlar vasitəsilə yoxlanmalıdır. |

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Mövcud layihənizə və ya test moduluna **ArchUnit** kitabxanasını əlavə edin.
2. Yuxarıdakı `AiArchitectureGovernanceTest` sinifini tətbiq edin:
   - `domain` və ya `service` paketlərinin birbaşa `org.springframework.ai` və ya `dev.langchain4j` paketlərindən asılılığını bloklayın.
3. Komandanız üçün `AI-CODE-REVIEW-CHECKLIST.md` faylı yaradın və layihənin repozitoriyasının kök qovluğuna (`.github/` daxilinə) yerləşdirin.

---

## Mənbələr

- ArchUnit Official Documentation: https://www.archunit.org/userguide/html/000_Index.html (yoxlanılmalıdır)
- OWASP Top 10 for Large Language Model Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/ (yoxlanılmalıdır)
- Spring AI Reference: Architecture and Design Philosophy: https://docs.spring.io/spring-ai/reference/ (yoxlanılmalıdır)
- Martin Fowler, "Software Architecture Guide & Hexagonal Architecture": https://martinfowler.com/ (yoxlanılmalıdır)
```
[topics.md üçün əlavə ediləcək sətir]
| 2026-10-30 | Komanda Səviyyəsində AI Qəbulu: Kod Standartları, Review Qaydaları və Governance | Best Practices & Governance | Qabaqcıl | [daily/2026-10-30-ai-kod-standartlari-review-governance.md](daily/2026-10-30-ai-kod-standartlari-review-governance.md) |
```
