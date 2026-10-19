# Spring AI ilə Observability, Token İdarəsi və Distributed Tracing (Micrometer & OpenTelemetry)

**Tarix:** 2026-10-19 · **Kateqoriya:** Observability · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır) · Micrometer 1.15.x (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM əsaslı tətbiqlər ənənəvi REST mikroservislərindən fərqli işləyir: burada sorğu gecikmələri millisaniyələrlə deyil, saniyələrlə ölçülür və hər bir uğursuz və ya səmərəsiz prompt birbaşa maliyyə itkisinə (token xərcləri) çevrilir. Tech Lead olaraq sistemin hansı prompt-lara nə qədər token sərf etdiyini, hansı advisor və ya tool-un zənciri yubandırdığını və xəta anında prompt kontekstini necə debug edəcəyinizi görmək üçün möhkəm observasiya (observability) infrastrukturuna ehtiyacınız var. Spring AI bu məsələni Spring Boot-un standart `Micrometer Observation API`-si üzərindən həll edərək metrikləri və paylanmış izləmələri (distributed tracing) Prometheusa və OpenTelemetry/Zipkin/Jaeger kollektorlarına avtomatik ötürür.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **Micrometer Observation API** | Həm metrikləri (Metrics), həm də izləmələri (Distributed Tracing / Spans) vahid API ilə idarə edən Spring Boot instrumentasiya mexanizmi. |
| **Spring AI ChatClient Observation** | LLM modelinə gedən sorğuları, prompt mətnini, model parametrlərini və cavab vaxtını avtomatik span və metrik kimi qeydə alan daxili konfiqurasiya. |
| **Token Usage Metrics** | `gen_ai.client.token.usage` kimi standart OpenTelemetry semantikası: prompt (input) və completion (output) token saylarının izlənilməsi. |
| **ObservationConvention & KeyValues** | LLM çağırışlarına aid metadata etiketləri (məs: `gen_ai.system=openai`, `gen_ai.request.model=gpt-4o`, `customer.tenant.id`). |
| **Baggage / Tracing Context** | Mikroservis zənciri boyunca (məs: API Gateway -> Backend -> AI Orchestrator) istifadəçi və təşkilat identifikatorlarını daşıyan paylanmış kontekst. |

---

## Kod nümunəsi

Aşağıdakı nümunədə Spring AI ilə OpenAI çağırışlarının metrik və tracing-lərini aktivləşdiririk, həmçinin xüsusi biznes etiketlərini (`tenant-id`, `feature-flag`) izləmə span-inə əlavə edən `ObservationConvention` yaradırıq.

### 1. Maven Dependency-ləri

```xml
<dependencies>
    <!-- Spring AI OpenAI Starter -->
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-model-openai</artifactId>
    </dependency>

    <!-- Spring Boot Actuator və Micrometer -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>

    <!-- Distributed Tracing: OpenTelemetry və Zipkin/OTLP Exporter -->
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-tracing-bridge-otel</artifactId>
    </dependency>
    <dependency>
        <groupId>io.opentelemetry</groupId>
        <artifactId>opentelemetry-exporter-otlp</artifactId>
    </dependency>
</dependencies>
```

### 2. Konfiqurasiya (`application.yml`)

Prompt və cavab məzmununun təhlükəsizlik səbəbilə default olaraq loglanmasının qarşısını almaq və ya ehtiyac olduqda idarəli açmaq üçün konfiqurasiya:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  tracing:
    sampling:
      probability: 1.0 # Production-da adətən 0.1 və ya dinamik seçilir
  otlp:
    tracing:
      endpoint: http://otel-collector.internal:4318/v1/traces
  ai:
    chat:
      observations:
        # Development mühitində prompt/completion mətnini span attribute-lara əlavə etmək üçün:
        include-prompt: false # Production-da PII sızmasının qarşısını almaq üçün false saxlanmalıdır
        include-completion: false

spring:
  ai:
    openai:
      chat:
        options:
          model: gpt-4o
```

### 3. Xüsusi Token və Biznes Konteksti Filteri (Custom Observation Filter)

Hər bir LLM sorğusuna aid təşkilat (`tenant_id`) və ya istifadəçi kateqoriyasını izləmə metadatasına əlavə edirik:

```java
package az.example.ai.observability;

import io.micrometer.common.KeyValue;
import io.micrometer.common.KeyValues;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationFilter;
import org.springframework.ai.chat.observation.ChatModelObservationContext;
import org.springframework.stereotype.Component;

@Component
public class EnterpriseAiObservationFilter implements ObservationFilter {

    private static final String TENANT_HEADER = "X-Tenant-Id";

    @Override
    public Observation.Context map(Observation.Context context) {
        // Yalnız Spring AI Chat Model kontekstlərinə müdaxilə edirik
        if (context instanceof ChatModelObservationContext chatContext) {
            
            // Kontekstə xüsusi biznes tag-ləri əlavə edirik
            String tenantId = resolveCurrentTenant();
            
            KeyValues customTags = KeyValues.of(
                    KeyValue.of("enterprise.tenant.id", tenantId),
                    KeyValue.of("enterprise.environment", "production")
            );

            // OpenTelemetry semantikasında request modelini yoxlaya bilərik
            chatContext.addLowCardinalityKeyValues(customTags);
        }
        return context;
    }

    private String resolveCurrentTenant() {
        // Real layihədə SecurityContext və ya MDC-dən oxunur
        return "tenant-fintech-az";
    }
}
```

### 4. Advisor vasitəsilə Sorğu Səviyyəsində Token İstifadəsinin İzlənilməsi

Əgər hər bir cavabdan sonra istifadə olunan dəqiq token sayını biznes məqsədilə DB-yə yazmaq və ya real vaxtda balansdan çıxmaq lazımdırsa:

```java
package az.example.ai.observability;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.AdvisedRequest;
import org.springframework.ai.chat.client.advisor.api.AdvisedResponse;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisor;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisorChain;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.stereotype.Component;

@Component
public class TokenCostTrackingAdvisor implements CallAroundAdvisor {

    private static final Logger log = LoggerFactory.getLogger(TokenCostTrackingAdvisor.class);

    @Override
    public String getName() {
        return "TokenCostTrackingAdvisor";
    }

    @Override
    public int getOrder() {
        return 0; // Ən yüksək prioritetlə zəncirin başında işləsin
    }

    @Override
    public AdvisedResponse aroundCall(AdvisedRequest advisedRequest, CallAroundAdvisorChain chain) {
        long startTime = System.currentTimeMillis();
        
        // Zənciri icra edirik
        AdvisedResponse response = chain.nextAroundCall(advisedRequest);
        
        long duration = System.currentTimeMillis() - startTime;
        
        // LLM Metadata-dan token istifadəsini çıxarırıq
        if (response.response() != null && response.response().getMetadata() != null) {
            Usage usage = response.response().getMetadata().getUsage();
            if (usage != null) {
                Long promptTokens = usage.getPromptTokens();
                Long generationTokens = usage.getGenerationTokens();
                Long totalTokens = usage.getTotalTokens();

                log.info("AI Çağırışı tamamlandı | Vaxt: {} ms | Prompt Token: {} | Generation Token: {} | Ümumi: {}",
                        duration, promptTokens, generationTokens, totalTokens);
                
                // Tech Lead Qeydi: Burada Kafka-ya "billing.token.consumed" hadisəsi göndərilə bilər
            }
        }

        return response;
    }
}
```

### 5. ChatClient Konfiqurasiyası və İstifadə

```java
package az.example.ai.observability;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class AnalyticsReportService {

    private final ChatClient chatClient;

    public AnalyticsReportService(ChatClient.Builder builder, TokenCostTrackingAdvisor tokenAdvisor) {
        this.chatClient = builder
                .defaultAdvisors(tokenAdvisor)
                .build();
    }

    public String generateExecutiveSummary(String quarterlyData) {
        return this.chatClient.prompt()
                .user("Aşağıdakı rüblük maliyyə göstəricilərini xülasə et:\n" + quarterlyData)
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **High-Cardinality vs Low-Cardinality Etiketləri:**
   - **Low-Cardinality (Metriklər üçün):** `model`, `provider`, `tenant_id` kimi sonlu sayda dəyər alan teqlər Prometheus metriklərinə əlavə edilməlidir. Əks halda Prometheus TSDB "cardinality explosion" səbəbindən çökə bilər.
   - **High-Cardinality (Tracing üçün):** `user_id`, `trace_id`, `session_id`, xam prompt mətni yalnız OpenTelemetry Tracing span atributlarına (attributes) yazılmalıdır.

2. **Full Prompt Payloads Tracing-də saxlanılmalıdırmı?**
   - **Müsbət tərəfi:** LLM-in verdiyi halüsinasiyanı və ya səhv Tool çağırışını dərhal Jaeger/Grafana Tempo-da görmək imkanı verir.
   - **Mənfi tərəfi və Təhlükəsizlik:** İstifadəçinin göndərdiyi PII (Personal Identifiable Information), kredit kartı və ya konfidensial məlumatlar telemetriya bazasına (məsələn, Elasticsearch, Tempo) düşür. Production-da `management.ai.chat.observations.include-prompt=false` qalmalıdır.

3. **Client-side Advisor vs Observation API:**
   - `CallAroundAdvisor` biznes məntiqinə yönəlik (məs: real vaxtda istifadəçi balansının azaldılması) əməliyyatlar üçün idealdır.
   - `Micrometer Observation` isə infrastruktur səviyyəli monitorinq (SLO/SLA, Alerting, Grafana Dashboards) üçün yeganə standart olmalıdır.

---

## Production məsələləri

- **Prometheus Alerting Qaydaları:**
  - `gen_ai_client_token_usage_total` üzərində kəskin sıçrayış baş verdikdə (məsələn, son 5 dəqiqədə normaldan 5 dəfə çox token istifadəsi) xəbərdarlıq qurun. Bu, komandanı dövrə düşmüş agentlərdən (infinite loop) və ya kiberhücumlardan qoruyur.
- **Latency SLO:** LLM çağırışları üçün `p95` və `p99` gecikmələri adətən yüksək olur (3–10 saniyə). HTTP connection timeout (`readTimeout`) ən az 30-60 saniyə qoyulmalı və bu müddət OpenTelemetry span-lərində aydın izlənməlidir.
- **Cost Allocation (Xərclərin şöbələr üzrə bölgüsü):** Hər departamentə və ya layihəyə xüsusi bir `tenant_id` və ya `service_name` bağı təyin edərək aylıq OpenAI/Anthropic faturasını komandalar arasında bölüşdürmək üçün Micrometer metriklərindən istifadə edin.

---

## Komandaya necə tətbiq etmək

1. **Grafana Dashboard Şablonu:** Komandanız üçün hazır "Spring AI Metrics" tablosu (Dashboard) qurun:
   - Real vaxt prompt/generation token sürəti (tokens/sec).
   - Orta cavab müddəti (Model Latency).
   - 4xx və 5xx xəta nisbətləri (Error Rate).
2. **Span Kontekst Standartı:** Bütün developerlərə təlimat verin: `ChatClient` çağırılan metodlar mövcud `@Observed` və ya Spring Web tracing zəncirini kəsməməli, kontekst reaktiv və ya virtual thread-lərdə düzgün yayılmalıdır (`ContextSnapshot`).
3. **Məxfi Məlumat Filterləri:** Loqlara və telemetriyaya gedən məlumatları maskalamaq üçün ortaq bir Sanitizer komponenti təyin edin.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Mövcud layihənizə `micrometer-registry-prometheus` və `micrometer-tracing-bridge-otel` əlavə edin.
2. `http://localhost:8080/actuator/prometheus` endpoint-ini açın və bir `ChatClient` sorğusu icra edin.
3. Prometheus çıxışında `gen_ai_client_operation_seconds_count` və `gen_ai_client_token_usage` metriklərini tapın.
4. `EnterpriseAiObservationFilter` sinfini tətbiq edərək metriklərə fərdi bir tag (məs: `department="core-banking"`) əlavə edin və həmin tag-in Prometheus çıxışında göründüyünü təsdiqləyin.

---

## Mənbələr

- Spring AI Observability Sənədləri (2.0.2, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/observability.html
- OpenTelemetry GenAI Semantic Conventions (yoxlanılmalıdır): https://opentelemetry.io/docs/specs/semconv/gen-ai/
- Micrometer Observation Rəsmi Sənədləri (1.15.x, yoxlanılmalıdır): https://micrometer.io/docs/observation
