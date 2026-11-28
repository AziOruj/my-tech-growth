# Spring AI: Prompt Caching (Context Caching) ilə Xərc və Gecikmənin Azaldılması

**Tarix:** 2026-11-28 · **Kateqoriya:** Performance & Cost Optimization · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Müasir enterprise RAG sistemlərində və agent workflow-larında LLM-ə hər sorğu ilə birlikdə on minlərlə token həcmində sistem təlimatları, sənəd parçaları və Tool meta-məlumatları göndərilir. Əgər hər istifadəçi sorğusunda bu nəhəng kontekst sıfırdan emal edilərsə, tətbiqin həm maliyyə xərcləri eksponensial artır, həm də Time-to-First-Token (TTFT) gecikməsi saniyələrlə ölçülür. Tech Lead olaraq **Prompt Caching (Context Caching)** mexanizmini tətbiq etməklə input token xərclərini 50-80%-dək, sorğuya cavab müddətini isə 2-4 dəfə azaltmaq mümkündür.

---

## Əsas anlayışlar

1. **Prefix Caching (Prompt Caching):** LLM provayderlərinin (Anthropic Claude, OpenAI, Google Gemini) sorğunun başlanğıc prefiksini (məs. böyük System Prompt, statik RAG sənədləri) yaddaşda saxlaması və növbəti eyni prefiksli sorğularda təkrar hesablamadan (KV cache reuse) istifadə etməsi.
2. **Cache Breakpoint:** Anthropic Claude kimi modellərdə hansı hissənin keşlənəcəyini göstərən xüsusi markerlər (`cache_control: {"type": "ephemeral"}`).
3. **Minimum Token Threshold:** Keşlənmə adətən yalnız müəyyən bir token həcmindən sonra (məs. 1024 və ya 2048 token) aktivləşir.
4. **Cache TTL & Eviction:** Keşlənmiş kontekst adətən sonuncu istifadədən sonra müəyyən müddət (adətən 5-10 dəqiqə) canlı qalır; hər Cache Hit zamanı bu taymer yenilənir.
5. **Deterministic Ordering:** Keşin uğurlu olması üçün promptun statik hissələri mütləq şəkildə ən başda yer almalı, dəyişən hissələr (istifadəçi sualı, cari saat və s.) isə sonda gəlməlidir.

---

## Kod nümunəsi: Anthropic / OpenAI Prompt Caching Konfiqurasiyası

Aşağıdakı nümunədə geniş hüquqi məlumat bazasını və ya böyük sistem təlimatını keşləmək üçün Spring AI `ChatClient` və xüsusi `Advisor` yanaşmasından istifadə edirik.

### 1. Keşlənəcək böyük bilik bazası və ya təlimat modeli
```java
package com.example.ai.caching;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.AdvisedRequest;
import org.springframework.ai.chat.client.advisor.api.AdvisedResponse;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisor;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisorChain;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.anthropic.AnthropicChatOptions;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Anthropic üçün System Prompt-a Ephemeral Cache Control metadata-sı əlavə edən Advisor.
 */
@Component
public class AnthropicPromptCacheAdvisor implements CallAroundAdvisor {

    @Override
    public AdvisedResponse aroundCall(AdvisedRequest advisedRequest, CallAroundAdvisorChain chain) {
        // Əsas böyük sistem mətninə cache_control metadata-sı bağlayırıq
        SystemMessage cachedSystemMessage = new SystemMessage(
                advisedRequest.systemText(),
                Map.of("cache_control", Map.of("type", "ephemeral"))
        );

        AdvisedRequest enrichedRequest = AdvisedRequest.from(advisedRequest)
                .withSystemText(cachedSystemMessage.getText())
                // Lazım gələrsə provider-ə məxsus ChatOptions burada yenilənir
                .build();

        return chain.nextAroundCall(enrichedRequest);
    }

    @Override
    public String getName() {
        return "AnthropicPromptCacheAdvisor";
    }

    @Override
    public int getOrder() {
        return 10;
    }
}
```

### 2. Service səviyyəsində deterministik Prompt arxitekturası
```java
package com.example.ai.caching;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.stereotype.Service;

@Service
public class EnterpriseKnowledgeService {

    private static final Logger log = LoggerFactory.getLogger(EnterpriseKnowledgeService.class);
    private final ChatClient chatClient;
    private final MeterRegistry meterRegistry;

    // Tutaq ki, bu mətn şirkətin 3000 tokenlik daxili standartlar sənədidir
    private static final String MASSIVE_STATIC_REGULATIONS = """
            [BÖYÜK KORPORATİV NİZAMNAMƏ VƏ TEXNİKİ TƏLİMATLAR...]
            Maddə 1: Bütün mikroservislər OpenTelemetry izləməsi təmin etməlidir.
            Maddə 2: PII məlumatları mütləq şifrələnməlidir.
            ... (minlərlə sətir mühüm kontekst) ...
            """;

    public EnterpriseKnowledgeService(ChatClient.Builder chatClientBuilder,
                                      AnthropicPromptCacheAdvisor cacheAdvisor,
                                      MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        this.chatClient = chatClientBuilder
                .defaultAdvisors(cacheAdvisor)
                .defaultSystem(MASSIVE_STATIC_REGULATIONS) // Statik prefiks həmişə eyni qalır
                .build();
    }

    public String answerEmployeeQuery(String userQuery) {
        ChatResponse response = chatClient.prompt()
                .user(userQuery) // Dinamik hissə ən sonda əlavə olunur
                .call()
                .chatResponse();

        recordCacheMetrics(response);

        return response.getResult().getOutput().getContent();
    }

    private void recordCacheMetrics(ChatResponse response) {
        Usage usage = response.getMetadata().getUsage();
        if (usage != null) {
            // Provayderdən asılı olaraq metadata daxilində cache oxunuşları gəlir
            // Məsələn: cache_read_input_tokens və ya prompt_tokens_details
            log.info("Prompt Tokens: {}, Output Tokens: {}", 
                    usage.getPromptTokens(), usage.getGenerationTokens());

            meterRegistry.counter("ai.tokens.prompt.total").increment(usage.getPromptTokens());
        }
    }
}
```

### 3. Application Configuration
```yaml
spring:
  ai:
    anthropic:
      api-key: ${ANTHROPIC_API_KEY}
      chat:
        options:
          model: claude-3-5-sonnet-latest
          max-tokens: 2000
          temperature: 0.2
```

---

## Arxitektura qərarları və trade-off-lar

| Parametr | Standart LLM Çağırışı | Prompt Caching ilə |
| :--- | :--- | :--- |
| **Xərc (Input Tokens)** | Hər sorğu üçün 100% ödəniş | Keş hit olduqda ~75-90% endirim |
| **Gecikmə (TTFT)** | Yüksək (bütün prompt hər dəfə parse edilir) | Çox aşağı (prefill mərhələsi atlanır) |
| **Prompt Quruluşu** | Sərbəst sıra (istifadəçi mesajı əvvəl və ya sonra) | Ciddi determinizm (statik prefiks birinci olmalıdır) |
| **Cache Miss Maliyyəsi** | Yoxdur | Keşin yazılması zamanı ilk çağırış üçün kiçik əlavə ödəniş (məs. +25%) |

### Əsas Dizayn Qaydası: "Statikdən Dinamikə Doğru"
Əgər promptunuza cari tarix (`LocalDate.now()`), dinamik sessiya ID və ya təsadüfi generated string əlavə edirsinizsə, bunu **System Prompt-un ən yuxarısına qoymayın**. Əks halda, bütün prefiks fərqli olacaq və Cache tamamilə yararsız (Cache Miss) qalacaq.

---

## Production məsələləri

1. **Cache Hit Ratio Monitorinqi:**
   - LLM provayderlərinin cavabında gələn `cache_creation_input_tokens` və `cache_read_input_tokens` göstəricilərini Micrometer vasitəsilə Prometheus/Grafana-ya ötürün. Sağlam bir sistemdə Hit Ratio 70%-dən yuxarı olmalıdır.
2. **Tenant İzolasiyası və Təhlükəsizlik:**
   - Əgər multi-tenant arxitekturadasınızsa, A müştərisinin konfidensial sənədlərini B müştərisinin sorğusu üçün keşlənmiş ortaq prefiksə daxil etməyin. Hər şirkət/tenant üçün ayrıca system prefiksi müəyyən edilməlidir.
3. **Session Warm-up (Pre-warming):**
   - Əgər bilik bazası yenilənibsə və ya sistem səhər pik saatlara girirsə, ilk istifadəçilərin gecikmə yaşamaması üçün bir arxa plan işi (cron job) vasitəsilə ən çox istifadə edilən böyük promptları bir dəfə LLM-ə göndərib keşi "qızdırmaq" (warm-up) olar.

---

## Komandaya necə tətbiq etmək

1. **Prompt Şablonlarının Standartlaşdırılması:** Komanda üçün qızıl qayda tərtib edin: `[Böyük Nizamnamə/Sənədlər] -> [Dəyişməz Tool Təsvirləri] -> [Söhbət Tarixçəsi] -> [İstifadəçinin Son Sualı]`.
2. **Kataloq Səviyyəsində Audit:** Tətbiqinizdəki bütün `ChatClient` çağırışlarını analiz edin. 1500+ token həcminə çatan bütün sistem promptlarını müəyyənləşdirib dərhal keşləməni aktivləşdirin.
3. **Maliyyə Hesabatlığı (FinOps):** Ayın sonunda rəhbərliyə Prompt Caching sayəsində qənaət edilən API büdcəsini göstərən bir qrafik təqdim edin.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1. Spring AI layihənizdə ən azı 1500-2000 sözdən (və ya böyük bir Markdown faylından) ibarət statik bir korporativ təlimat hazırlayın.
2. `AnthropicPromptCacheAdvisor` (və ya OpenAI üçün eyni məntiqli advisor) yaradaraq bu təlimatı `SystemMessage` metadata-sı ilə təmin edin.
3. Eyni böyük sistem promptu ilə ardıcıl 3 sorğu göndərin. Birinci çağırış ilə 2-ci və 3-cü çağırışların cavab müddətlərini (millaniyə ilə) və loglarda əks olunan token statistikasını müqayisə edin.

---

## Mənbələr

- Spring AI Advisors & Messages: https://docs.spring.io/spring-ai/reference/api/advisors.html (yoxlanılmalıdır)
- Anthropic Prompt Caching Guide: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching (yoxlanılmalıdır)
- OpenAI Prompt Caching Documentation: https://platform.openai.com/docs/guides/prompt-caching (yoxlanılmalıdır)
- Micrometer AI Metrics Architecture: https://micrometer.io/ (yoxlanılmalıdır)
