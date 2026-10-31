# Testcontainers və Ollama ilə Spring AI İnteqrasiya Testləri (Offline CI/CD)

**Tarix:** 2026-10-31 · **Kateqoriya:** Testing & CI/CD · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır) · Testcontainers 1.20.x / Ollama Container (yoxlanılmalıdır)

---

## Niyə vacibdir

AI inteqrasiyalarında ən böyük mühəndislik səhvlərindən biri CI/CD mühitində ya canlı LLM provayderlərinə (OpenAI, Anthropic) sorğu atmaq, ya da hər şeyi ifrat mock-lamaqdır. Xarici API-ləri çağırmaq testləri qeyri-stabil (flaky), yavaş, xərcli edir və API açarlarının CI mühitində sızma riskini artırır; digər tərəfdən, sadə mock-lar LLM-in struktur çıxışını (JSON parsing), function calling mexanizmini və embedding vektorlaşdırmasını real yoxlaya bilmir. Tech Lead olaraq komandaya xarici buluddan asılı olmayan, Docker əsaslı lokal modellərlə (Ollama) təcrid olunmuş və təkrarlana bilən inteqrasiya testləri qurmaq mütləqdir.

---

## Əsas anlayışlar

1. **Testcontainers Ollama Module:** Test zamanı xüsusi Docker konteynerində Ollama instansiyasını avtomatik başladan, lazım olan yüngül modeli (məs: `llama3.2:1b`, `all-minilm` və ya `qwen2.5:0.5b`) çəkən və test bitdikdə resursları təmizləyən infrastruktur.
2. **Model Caching (Docker Volume Reuse):** CI/CD pipeline-da hər test icrasında giqabaytlarla modeli yenidən internetdən yükləməmək üçün Testcontainers host həcmlərindən (shared volume caching) istifadə edir.
3. **DynamicPropertySource:** Spring Boot tətbiqini konteynerin dinamik ayrılmış portu və Ollama URL-i ilə konfiqurasiya edir (`spring.ai.ollama.base-url`).
4. **Deterministic Contract Testing:** Xarici kommersiya modeli ilə eyni arxitekturalı yüngül lokal modeli çağırmaqla ChatClient konfiqurasiyasının, Tool Calling handler-lərinin və structured record mapping-in düzgünlüyü doğrulanır.

---

## Kod nümunəsi: Testcontainers + Ollama ilə Spring AI Testi

Aşağıdakı nümunədə Spring Boot tətbiqində strukturlaşdırılmış məlumat çıxaran servisin Testcontainers vasitəsilə tam izolyasiyada test edilməsi göstərilir.

### 1. Maven Asılılıqları

```xml
<dependencies>
    <!-- Spring AI Ollama Starter -->
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-ollama-spring-boot-starter</artifactId>
        <version>2.0.0</version> <!-- yoxlanılmalıdır -->
    </dependency>

    <!-- Testcontainers Ollama -->
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>ollama</artifactId>
        <version>1.20.4</version> <!-- yoxlanılmalıdır -->
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>junit-jupiter</artifactId>
        <version>1.20.4</version> <!-- yoxlanılmalıdır -->
        <scope>test</scope>
    </dependency>
</dependencies>
```

### 2. Test Edilən Biznes Servisi

```java
package com.company.ai.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class TicketClassifierService {

    private final ChatClient chatClient;

    public TicketClassifierService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    public record TicketClassification(String category, int priority, String summary) {}

    public TicketClassification classify(String customerMessage) {
        return chatClient.prompt()
                .system("Daxil olan müştəri şikayətini kateqoriyaya ayır: BILLING, TECHNICAL, GENERAL. " +
                        "Prioritet 1 (aşağı) ilə 5 (kritik) arasında olsun.")
                .user(customerMessage)
                .call()
                .entity(TicketClassification.class);
    }
}
```

### 3. Testcontainers ilə İnteqrasiya Testi

```java
package com.company.ai.service;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.ollama.OllamaContainer;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Testcontainers
class TicketClassifierServiceIntegrationTest {

    private static final String MODEL_NAME = "qwen2.5:0.5b"; // Yüngül və sürətli model

    @Container
    static OllamaContainer ollama = new OllamaContainer(
            DockerImageName.parse("ollama/ollama:0.5.0") // yoxlanılmalıdır
    );

    @BeforeAll
    static void initModel() throws IOException, InterruptedException {
        // Konteyner qalxdıqdan sonra daxilində modeli çəkirik
        ollama.execInContainer("ollama", "pull", MODEL_NAME);
    }

    @DynamicPropertySource
    static void configureAiProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.ai.ollama.base-url", ollama::getEndpoint);
        registry.add("spring.ai.ollama.chat.options.model", () -> MODEL_NAME);
        registry.add("spring.ai.ollama.chat.options.temperature", () -> 0.0);
    }

    @Autowired
    private TicketClassifierService classifierService;

    @Test
    void shouldClassifyBillingIssueCorrectly() {
        // Given
        String issue = "Hesabımdan iki dəfə pul çıxılıb, dərhal geri qaytarılmasını tələb edirəm!";

        // When
        TicketClassifierService.TicketClassification result = classifierService.classify(issue);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.category()).isIn("BILLING", "TECHNICAL");
        assertThat(result.priority()).isGreaterThanOrEqualTo(3);
        assertThat(result.summary()).isNotBlank();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

```
+-------------------------------------------------------------------+
| CI/CD Runner / Local Machine (Maven/Gradle test)                  |
|                                                                   |
|   +-----------------------+         +--------------------------+  |
|   | Spring Boot Test      |         | Testcontainers (Docker)  |  |
|   | (ApplicationContext)  |         |                          |  |
|   |                       | HTTP    |   +------------------+   |  |
|   | ChatClient (Ollama)   |-------->|   | Ollama Engine    |   |  |
|   |                       | (dyn)   |   | [qwen2.5 / 1b]   |   |  |
|   +-----------------------+         |   +------------------+   |  |
|                                     +--------------------------+  |
+-------------------------------------------------------------------+
```

- **Qərar:** Unit testlərdə Mockito, İnteqrasiya testlərində Testcontainers + Ollama istifadə etmək.
  - *Müsbət cəhət:* Sıfır API maliyyəti, internet kəsintilərinə qarşı 100% dözümlülük, heç bir API token CI sirlərində saxlanılmır. JSON mapping və Tool Calling real LLM mühərrikində doğrulanır.
  - *Mənfi cəhət (Trade-off):* Test işə düşmə vaxtı (startup latency) artır. Modelin ölçüsündən asılı olaraq konteynerin ayağa qalxması və model yüklənməsi əlavə 30–60 saniyə çəkə bilər.
- **Qərar:** Testlər üçün `qwen2.5:0.5b` və ya `llama3.2:1b` kimi ultra-yüngül modellərin seçilməsi.
  - *Müsbət cəhət:* CPU üzərində (CI runner-lərində GPU olmur) sürətli icra və minimal RAM (1-2 GB) tələbi.
  - *Mənfi cəhət:* Kiçik modellər böyük modellərə (GPT-4o, Claude 3.5 Sonnet) nisbətən mürəkkəb təlimatları və prompt nüanslarını daha zəif anlayır; test prompt-ları qısa və birmənalı olmalıdır.

---

## Production məsələləri

1. **CI Pipeline üçün Pre-built Docker Image:**
   - Hər test zamanı `ollama pull` çağırmaq CI vaxtını uzadır. Tech Lead komanda üçün modeli əvvəlcədən daxilində saxlayan xüsusi Docker image hazırlamalıdır (`FROM ollama/ollama ... RUN ollama pull qwen2.5:0.5b`).
2. **CPU və RAM Resurs Limitləri:**
   - GitLab Runner və ya GitHub Actions mühitində Testcontainers üçün ən azı 4GB RAM və 2 vCPU ayrılmalıdır. Əks halda Ollama OOM (Out Of Memory) səbəbindən konteyneri dayandıra bilər.
3. **Determinism (Temperature = 0.0):**
   - Testlərin gözlənilməz cavablar verməməsi üçün test konfiqurasiyasında `temperature` mütləq `0.0` təyin edilməlidir.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün addımlar)

1. **Test Qatlarını Aydın Şəkildə Ayırın:**
   - `*Test.java` (Unit testlər): Heç bir konteyner qalxmır, ChatClient mock edilir. Sürət: < 1 saniyə.
   - `*IT.java` (Integration testlər): Testcontainers + Ollama istifadə edir. Sürət: ~1-2 dəqiqə. Maven/Gradle `verify` mərhələsində işləyir.
2. **Lokal Tərtibat Mühiti üçün Default Profil:**
   - `application-test.yml` faylında Testcontainers dəstəyini aktivləşdirin ki, komanda üzvləri kompüterlərində ayrıca Ollama quraşdırmadan yalnız `mvn verify` yazmaqla testi icra edə bilsinlər.
3. **Pre-pulled Image Registry:**
   - Şirkətin daxili Docker Registry-sində (Nexus, Harbor, JFrog) lazımi test modellərini saxlayan hazır `company-ollama-test:latest` imicini yerləşdirin.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Layihənizin test moduluna `org.testcontainers:ollama` asılılığını əlavə edin.
2. Yuxarıdakı `TicketClassifierServiceIntegrationTest` nümunəsini yazın və lokal mühitdə Docker işlək vəziyyətdə testi başladın.
3. Modelin Testcontainers daxilində uğurla yükləndiyini və `TicketClassification` record-unun düzgün parse olunduğunu `mvn test -Dtest=*IntegrationTest` ilə yoxlayın.

---

## Mənbələr

- Testcontainers Ollama Module Reference: https://java.testcontainers.org/modules/ollama/ (yoxlanılmalıdır)
- Spring AI Ollama Documentation: https://docs.spring.io/spring-ai/reference/api/chat/ollama-chat.html (yoxlanılmalıdır)
- Ollama Official Model Library: https://ollama.com/library (yoxlanılmalıdır)
- Spring Boot DynamicPropertySource Guide: https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/dynamic-property-sources.html (yoxlanılmalıdır)
```
[topics.md üçün əlavə ediləcək sətir]
| 2026-10-31 | Testcontainers və Ollama ilə Spring AI İnteqrasiya Testləri (Offline CI/CD) | Testing & CI/CD | Qabaqcıl | [daily/2026-10-31-testcontainers-ollama-spring-ai-inteqrasiya-testleri.md](daily/2026-10-31-testcontainers-ollama-spring-ai-inteqrasiya-testleri.md) |
```
