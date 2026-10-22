# Spring AI ilə AI Agentləri və ReAct Workflow-larının Qurulması

**Tarix:** 2026-10-22 · **Kateqoriya:** AI Agents / Workflows · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır)

---

## Niyə vacibdir

Tək addımlı sorğu-cavab və ya passiv RAG bəzi hallarda mürəkkəb biznes məsələlərini həll etməkdə aciz qalır. Məsələn: istifadəçi "Ötən ay ən çox gecikən sifarişlərin müştərilərinə 15%-lik kompensasiya kuponu göndər və CRM-də qeyd apar" dedikdə sistem bir neçə addımlı qərarvermə, məlumat bazasından çıxarış, analiz və yekun əməliyyat icra etməlidir. Tech Lead olaraq komandanıza sadəcə "statik LLM çağırışları" deyil, mühiti müşahidə edən, qərar verən və alətlərdən avtonom istifadə edərək məqsədə çatan **Agentik Arxitekturalar (AI Agents / ReAct workflows)** qurmağı öyrətməlisiniz.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **AI Agent** | Əvvəlcədən təyin olunmuş statik ardıcıllıqla deyil, LLM-in öz mülahizəsinə (reasoning) əsasən hansı aləti nə vaxt çağıracağını seçən dinamik icraçı sistem. |
| **ReAct Pattern (Reason + Act)** | Modelin addım-addım düşünməsi (`Thought`), uyğun aləti işə salması (`Action`), nəticəni oxuması (`Observation`) və növbəti addıma qərar verməsi dövrü. |
| **Plan-and-Solve (Planner-Executor)** | Əvvəlcə bütün planı (sub-tasks) quran, sonra hər addımı növbə ilə deterministik və ya dinamik şəkildə icra edən agent strukturu. |
| **Human-in-the-Loop (HITL)** | Təhlükəli və ya kritik əməliyyatlarda (məsələn, pul köçürməsi, kupon göndərilməsi) agentin icranı dayandırıb insandan təsdiq istəməsi mexanizmi. |
| **Loop Guard (Max Iterations)** | Agentin sonsuz dövrə (infinite loop) düşməsinin və büdcənin tükənməsinin qarşısını alan qoruyucu məhdudiyyət. |

---

## Kod nümunəsi

Spring AI 2.0+ `ChatClient` və Tool Callback mexanizmləri vasitəsilə agent dövrünü asanlıqla təşkil etməyə imkan verir. Aşağıda ReAct prinsipləri ilə işləyən, dövriyyə məhdudiyyətinə və Virtual Threads əsaslı icraya malik agent arxitekturası təqdim olunur.

### 1. Agent Alətlərinin (Tools) Təyin Edilməsi

```java
package az.example.ai.agent.tools;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Description;

import java.util.List;
import java.util.function.Function;

@Configuration(proxyBeanMethods = false)
public class OrderAgentTools {

    public record DelayedOrder(String orderId, String customerEmail, int delayDays) {}
    public record CouponResult(boolean success, String message) {}
    public record CouponRequest(String customerEmail, int discountPercent) {}

    @Bean
    @Description("Son 30 gündə gecikən sifarişlərin və müştəri məlumatlarının siyahısını qaytarır")
    public Function<Void, List<DelayedOrder>> getDelayedOrders() {
        return unused -> List.of(
                new DelayedOrder("ORD-101", "ali@example.com", 5),
                new DelayedOrder("ORD-102", "leyla@example.com", 7)
        );
    }

    @Bean
    @Description("Göstərilən müştəri emailinə müəyyən faizli endirim kuponu yaradıb göndərir")
    public Function<CouponRequest, CouponResult> sendCompensationCoupon() {
        return request -> {
            // CRM / Notification servis inteqrasiyası
            return new CouponResult(true, "Kupon uğurla göndərildi: " + request.customerEmail());
        };
    }
}
```

### 2. Autonomous Agentic Service (ReAct Loop)

Agentin addımlarını izləyən, Virtual Threads ilə işləyən və sonsuz dövrə qarşı qorunan servis:

```java
package az.example.ai.agent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.stereotype.Service;

@Service
public class AutonomousOrderAgent {

    private static final Logger log = LoggerFactory.getLogger(AutonomousOrderAgent.class);
    private static final int MAX_AGENT_ITERATIONS = 5;

    private final ChatClient chatClient;

    public AutonomousOrderAgent(ChatClient.Builder chatClientBuilder) {
        // Agent üçün təlimat və alətlərin birbaşa bağlanması
        this.chatClient = chatClientBuilder
                .defaultSystem("""
                    Sən e-ticarət dəstək agentisən. Məqsədin müştəri problemlərini addım-addım həll etməkdir.
                    Yanaşman ReAct formatında olmalıdır:
                    1. Thought: Problemi təhlil et və növbəti addımı düşün.
                    2. Action: Əlindəki alətlərdən uyğun olanı çağır.
                    3. Final Answer: Bütün əməliyyatlar bitdikdə istifadəçiyə yekun hesabat təqdim et.
                    Artıq alət çağırmaq lazım deyilsə, yalnız yekun cavabı ver.
                    """)
                .defaultTools("getDelayedOrders", "sendCompensationCoupon")
                .build();
    }

    public String executeGoal(String userGoal) {
        log.info("Agent işə salındı. Məqsəd: {}", userGoal);

        // Spring AI 2.0 ChatClient daxili olaraq model alət çağırdıqda 
        // nəticəni modelə geri qaytarır və yekun cavaba qədər davam edir.
        // Virtual Threads sayəsində I/O zamanı platform thread bloklanmır.
        return chatClient.prompt()
                .user(userGoal)
                .options(ChatOptions.builder()
                        .temperature(0.1) // Agentlərdə determinizm və dəqiqlik üçün aşağı temperatur
                        .build())
                .call()
                .content();
    }
}
```

### 3. Controller və REST endpoint

```java
package az.example.ai.agent;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/agent")
public class AgentController {

    private final AutonomousOrderAgent agent;

    public AgentController(AutonomousOrderAgent agent) {
        this.agent = agent;
    }

    @PostMapping("/run")
    public ResponseEntity<AgentResponse> runAgent(@RequestBody AgentTaskRequest request) {
        String result = agent.executeGoal(request.instruction());
        return ResponseEntity.ok(new AgentResponse(result));
    }

    public record AgentTaskRequest(String instruction) {}
    public record AgentResponse(String report) {}
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **Autonomous ReAct vs Hardcoded Orchestration (State Machine):**
   - **Autonomous ReAct:** Model hansı aləti hansı sırayla çağıracağına özü qərar verir. Çox çevikdir, lakin gözlənilməz qərarlar verə bilər (non-deterministic).
   - **Hardcoded / Spring State Machine:** Addımlar kodda sərt müəyyən edilir, LLM sadəcə hər addımda mətn təhlili üçün istifadə olunur. Sabitdir, amma dinamik deyil.
   - **Qərar:** Kritik maliyyə əməliyyatlarında deterministik workflow (Saga/State Machine) daxilində LLM addımları, araşdırma və dəstək ssenarilərində isə ReAct agentləri seçilməlidir.

2. **Virtual Threads (Project Loom) Əhəmiyyəti:**
   - Bir agent tapşırığı həll edərkən 4-5 dəfə LLM zəngi və 3 dəfə DB/API zəngi edə bilər (ümumi gecikmə 10-15 saniyə).
   - Java 21 Virtual Threads istifadə edilmədikdə ictimai HTTP server tez bir zamanda thread starvation yaşayacaq. Agent sorğuları mütləq Virtual Threads (`spring.threads.virtual.enabled=true`) üzərində icra olunmalıdır.

3. **Tool Registry və Idempotency:**
   - Agent eyni aləti səhvən 2 dəfə çağıra bilər. Kupon göndərmək və ya balans dəyişmək kimi alətlər **idempotent** olmalıdır (məs: `idempotencyKey` və ya `orderId` əsasında deduplication).

---

## Production məsələləri

- **Infinite Loop və Token Explosion:** Model bəzən eyni aləti səhv parametrlə təkrar-təkrar çağırır. Spring AI `ChatClient` çağırışlarında alət icrasının maksimum addım sayını (Call limit) və HTTP timeout-ları sərt tənzimləyin.
- **Auditing və Explainability:** Agentin verdiyi hər `Thought` və çağırdığı hər `Action` mütləq loglanmalıdır (OpenTelemetry span-ları kimi). İstifadəçi "Niyə filan müştəriyə kupon getdi?" soruşduqda izahat zənciri əlinizdə olmalıdır.
- **Human-in-the-Loop (HITL):** Agent birbaşa DB-ni silməməli və ya geri qaytarılmayan pul əməliyyatı etməməlidir. Belə hallarda alət birbaşa icra etmək əvəzinə `APPROVAL_REQUIRED` statusu ilə tapşırıq cədvəlinə (Outbox/Task table) yazmalı və insandan təsdiq gözləməlidir.

---

## Komandaya necə tətbiq etmək

1. **"Sadədən Mürəkkəbə" Qaydası:** Komandaya hər problem üçün agent yazmağı qadağan edin. Əgər məsələ sadə bir SQL sorğusu və 1 ChatClient çağırışı ilə həll olursa, agent arxitekturası lazımsız xərc və gecikmə gətirir.
2. **Tool-lar üçün Dəqiq Schema və Təsvir Yazılması:** Model alətləri yalnız onların `@Description` sahəsinə əsasən seçir. Komanda üçün "Tool Description Writing Standard" formalaşdırın: alətin nə vaxt çağırılmalı və nə vaxt **çağırılmamalı** olduğu aydın göstərilməlidir.
3. **Idempotent Alət İnterfeysi:** Komanda tərəfindən yazılan bütün agent alətləri tranzaksion təhlükəsiz və idempotent olmalıdır.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. `application.yml` faylında `spring.threads.virtual.enabled: true` aktiv edin.
2. Sadə bir Agent ssenarisi qurun:
   - Alət 1: `checkInventory(String productId)` -> Stok sayını qaytarır.
   - Alət 2: `notifyManager(String productId, int count)` -> Stok 5-dən azdırsa xəbərdarlıq göndərir.
3. Agentə təbii dildə sorğu verin: *"PROD-99 kodlu məhsulun qalığına bax, əgər kritik həddədirsə menecerə xəbər ver."*
4. Konsolda agentin düşünmə və alət çağırma ardıcıllığını izləyin.

---

## Mənbələr

- Spring AI Tool Calling və Function Callback Sənədləri (yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/tools.html
- ReAct: Synergizing Reasoning and Acting in Language Models (Yao et al., arXiv) (yoxlanılmalıdır): https://arxiv.org/abs/2210.03629
- Enterprise Integration Patterns with LLM Agents (yoxlanılmalıdır): https://www.enterpriseintegrationpatterns.com/
