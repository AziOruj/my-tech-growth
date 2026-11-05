# Spring AI: Multi-Agent Systems (Orchestrator-Worker) və Agentlər arası Əməkdaşlıq

**Tarix:** 2026-11-05 · **Kateqoriya:** AI Agents / Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Mürəkkəb biznes proseslərini (məsələn, sığorta iddialarının emalı və ya geniş proqram təminatı analizi) tək bir LLM çağırışı və ya tək bir "general-purpose" agent ilə həll etmək çox vaxt uğursuzluqla nəticələnir. Agent "hallucination" edir və ya kontekst daxilində itir. 

Tech Lead olaraq, sistemi **Multi-Agent** arxitekturasına keçirməklə:
1.  **Dəqiqliyi artırırsınız:** Hər agentin spesifik bir sahəsi (Research, Coding, Review) olur.
2.  **Scalability təmin edirsiniz:** Agentlər paralel işləyə bilir.
3.  **Maintainability:** Hər bir agentin promptu və alətləri (tools) daha kiçik, test edilə bilən və idarəolunan olur.

---

## Əsas anlayışlar

1.  **Orchestrator (Manager) Agent:** İstifadəçinin sorğusunu analiz edir, onu alt tapşırıqlara bölür və uyğun "Worker" agentlərə tapşırıq verir.
2.  **Worker (Specialized) Agent:** Dar bir sahə üzrə ixtisaslaşmış agent (məsələn, "SQL Expert" və ya "Python Analyst").
3.  **Handoff (Delegation):** Bir agentin işini bitirib nəticəni digər agentə və ya yenidən Orchestrator-a ötürməsi prosesi.
4.  **Shared Context (Blackboard):** Bütün agentlərin əlçatanlığı olan və söhbətin vəziyyətini (state) saxlayan yaddaş sahəsi.

---

## Kod nümunəsi: Araşdırma və Yazıçı Agentlərinin Koordinasiyası

Bu nümunədə bir `Orchestrator` yaradacağıq ki, o, mövzunu araşdırmaq üçün `ResearcherAgent`-ə müraciət edir, sonra nəticəni məqalə yazmaq üçün `WriterAgent`-ə göndərir.

```java
package com.company.ai.agents;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.SimpleLoggerAdvisor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

@Service
public class ContentOrchestrator {

    private final ChatClient researcherAgent;
    private final ChatClient writerAgent;

    public ContentOrchestrator(ChatClient.Builder builder) {
        // Araşdırma alətləri ilə təchiz olunmuş Researcher Agent
        this.researcherAgent = builder
                .defaultSystem("Sən peşəkar araşdırmaçısan. Mövzu haqqında dəqiq faktlar tap.")
                .defaultAdvisors(new SimpleLoggerAdvisor())
                .build();

        // Yaradıcı yazı qabiliyyəti olan Writer Agent
        this.writerAgent = builder
                .defaultSystem("Sən texniki yazıçısan. Verilmiş faktlar əsasında bloq postu yaz.")
                .build();
    }

    public String generateFullReport(String topic) {
        // Step 1: Research
        String researchData = researcherAgent.prompt()
                .user("Mövzu: " + topic)
                .call()
                .content();

        // Step 2: Write based on research
        return writerAgent.prompt()
                .user("Aşağıdakı faktlar əsasında məqalə yaz: " + researchData)
                .call()
                .content();
    }
}
```

### Qabaqcıl Yanaşma: Tool Calling ilə Dinamik Handoff
Daha mürəkkəb ssenarilərdə Orchestrator agent digər agentləri bir "Tool" kimi çağıra bilər.

```java
public record AgentResponse(String result) {}

@Service
public class AgentTools {
    
    private final ChatClient legalAgent;

    public AgentTools(ChatClient.Builder builder) {
        this.legalAgent = builder.defaultSystem("Hüquqi analiz et.").build();
    }

    @Tool("consult_legal_expert")
    public AgentResponse consultLegal(String query) {
        String response = legalAgent.prompt().user(query).call().content();
        return new AgentResponse(response);
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

-  **Sequential vs. Parallel:** Tapşırıqlar bir-birindən asılıdırsa (araşdırma -> yazı), Sequential; asılı deyilsə (məsələn, eyni vaxtda 3 müxtəlif xəbər saytını skan etmək), Parallel (Java Virtual Threads ilə) icra edilməlidir.
-  **State Management:** Multi-agent sistemlərdə söhbət tarixcəsini (memory) necə bölüşmək kritikdir. Bütün tarixi hər agentə göndərmək token limitini aşar. Hər agentə yalnız ona aid olan "subset" göndərilməlidir.
-  **Loop Prevention:** Agentlərin bir-birini sonsuz dövrdə çağırmasının qarşısını almaq üçün mütləq `max_iterations` limiti qoyulmalıdır.

---

## Production məsələləri

1.  **Cost Escalation:** 1 sorğu 5-10 LLM çağırışına səbəb ola bilər. Tech Lead olaraq hər bir "agent chain" üçün büdcə limiti və monitorinq (OpenTelemetry) quraşdırmalısınız.
2.  **Latency:** Ardıcıl çağırışlar istifadəçi gözləməsini artırır. UI-da "Streaming" istifadə etmək və hər agentin gedişatını (məsələn: "Araşdırmaçı tapşırıq üzərində işləyir...") göstərmək lazımdır.
3.  **Reliability:** Əgər bir Worker Agent uğursuz olarsa (timeout, rate limit), Orchestrator bunu necə idarə etməlidir? (Retry logic və ya fallback agent).

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1.  **Decomposition Workshop:** Komanda ilə birlikdə mürəkkəb biznes prosesini kiçik agent tapşırıqlarına bölün.
2.  **Standardized Interfaces:** Agentlər arası mesajlaşma formatını (POJO-lar) əvvəlcədən müəyyən edin ki, müxtəlif developerlər müxtəlif agentləri eyni vaxtda hazırlaya bilsin.
3.  **Testing Strategy:** Hər agenti tək-tək (unit test) və sonra birlikdə (integration test) yoxlayın. Agentlərin bir-birinə verdiyi məlumatların keyfiyyətini ölçün.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  İki ixtisaslaşmış `ChatClient` (məsələn, "Matematik" və "Filoloq") yaradın.
2.  Bir `Orchestrator` servisi yazın ki, istifadəçinin sualının növünə görə (riyaziyyat yoxsa dilçilik) sorğunu uyğun agentə yönləndirsin.
3.  Java 21 `StructuredTaskScope` (Preview) və ya `CompletableFuture` istifadə edərək, iki fərqli agenti paralel çağırıb nəticələri birləşdirən bir metod hazırlayın.

---

## Mənbələr

- Spring AI Agents Overview: https://docs.spring.io/spring-ai/reference/api/chatclient.html (yoxlanılmalıdır)
- Orchestrator-Worker Pattern in AI: https://www.anthropic.com/research/building-effective-agents (yoxlanılmalıdır)
- Java 21 Concurrency for AI: https://openjdk.org/jeps/444 (yoxlanılmalıdır)
