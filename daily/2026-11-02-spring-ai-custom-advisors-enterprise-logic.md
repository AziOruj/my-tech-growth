# Spring AI Custom Advisors: Müəssisə Səviyyəli Məntiqin İdarə Edilməsi

**Tarix:** 2026-11-02 · **Kateqoriya:** Spring AI / Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Spring AI-da `ChatClient` ilə işləyərkən, bəzən hər bir LLM çağırışından əvvəl və ya sonra (cross-cutting concerns) xüsusi biznes məntiqi tətbiq etmək lazım gəlir. Məsələn: token xərclərinə nəzarət etmək üçün köhnə mesajları silmək (Context Pruning), cavablara avtomatik hüquqi xəbərdarlıqlar (Legal Disclaimers) əlavə etmək və ya istifadəçinin roluna əsasən sistem promptunu dinamik dəyişmək. Tech Lead olaraq, bu məntiqi hər bir Controller və ya Servis daxilində təkrar yazmaq əvəzinə, Spring-in AOP (Aspect Oriented Programming) fəlsəfəsinə uyğun gələn **Advisor API**-dan istifadə edərək mərkəzləşdirilmiş və təkrar istifadə edilə bilən komponentlər yaratmalısınız.

---

## Əsas anlayışlar

1. **CallAdvisor:** `ChatClient`-in sorğu (request) və cavab (response) dövriyyəsinə müdaxilə edən komponentdir.
2. **AroundAdvisor:** Həm sinxron (`call()`), həm də asinxron/streaming (`stream()`) çağırışları əhatə edə bilən ən güclü interseptor növüdür.
3. **Request/Response Transformation:** Advisor-lar göndərilən `Prompt`-u modifikasiya edə və ya modeldən gələn `ChatResponse`-u dəyişdirərək (məsələn, PII-ləri təmizləyərək) proqrama geri qaytara bilər.
4. **Order (Ardıcıllıq):** Çoxsaylı Advisor-lar zəncirvari şəkildə işləyir. Məsələn, əvvəlcə təhlükəsizlik Advisor-u, sonra isə loglama Advisor-u işə düşə bilər.

---

## Kod nümunəsi: Custom Token-Cap və Compliance Advisor

Aşağıdakı nümunədə iki xüsusi Advisor yaradılır: biri kontekst pəncərəsini qorumaq üçün mesaj sayını limitləyir, digəri isə cavabın sonuna avtomatik olaraq "AI tərəfindən yaradılıb" qeydi əlavə edir.

### 1. Custom Advisor: Dynamic Context Pruning

```java
package com.company.ai.advisors;

import org.springframework.ai.chat.client.AdvisedRequest;
import org.springframework.ai.chat.client.RequestResponseAdvisor;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.model.ChatResponse;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Bu advisor söhbət tarixcəsində yalnız son N mesajın 
 * modelə göndərilməsini təmin edərək xərcləri azaldır.
 */
public class ContextSizeLimitAdvisor implements RequestResponseAdvisor {

    private final int maxMessages;

    public ContextSizeLimitAdvisor(int maxMessages) {
        this.maxMessages = maxMessages;
    }

    @Override
    public AdvisedRequest adviseRequest(AdvisedRequest request, Map<String, Object> context) {
        List<Message> messages = new ArrayList<>(request.messages());
        
        if (messages.size() > maxMessages) {
            // Son mesajları saxla (User prompt + son history)
            int skipCount = messages.size() - maxMessages;
            List<Message> prunedMessages = messages.subList(skipCount, messages.size());
            
            return AdvisedRequest.from(request)
                    .withMessages(prunedMessages)
                    .build();
        }
        return request;
    }

    @Override
    public ChatResponse adviseResponse(ChatResponse response, Map<String, Object> context) {
        return response; // Cavaba toxunmuruq
    }

    @Override
    public int getOrder() {
        return 100; // Zəncirdəki sırası
    }
}
```

### 2. Custom Advisor: Compliance Disclaimer

```java
package com.company.ai.advisors;

import org.springframework.ai.chat.client.AdvisedRequest;
import org.springframework.ai.chat.client.ChatClientCustomizer;
import org.springframework.ai.chat.client.RequestResponseAdvisor;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class ComplianceDisclaimerAdvisor implements RequestResponseAdvisor {

    private static final String DISCLAIMER = "\n\n[Xəbərdarlıq: Bu cavab süni intellekt tərəfindən yaradılıb.]";

    @Override
    public AdvisedRequest adviseRequest(AdvisedRequest request, Map<String, Object> context) {
        return request;
    }

    @Override
    public ChatResponse adviseResponse(ChatResponse response, Map<String, Object> context) {
        List<Generation> modifiedGenerations = response.getResults().stream()
                .map(gen -> {
                    String newText = gen.getOutput().getContent() + DISCLAIMER;
                    return new Generation(newText, gen.getMetadata());
                })
                .collect(Collectors.toList());

        return new ChatResponse(modifiedGenerations, response.getMetadata());
    }
}
```

### 3. Advisor-ların ChatClient-ə tətbiqi

```java
@Service
public class EnterpriseAiService {

    private final ChatClient chatClient;

    public EnterpriseAiService(ChatClient.Builder builder) {
        this.chatClient = builder
                .defaultAdvisors(
                    new ContextSizeLimitAdvisor(5), // Yalnız son 5 mesajı saxla
                    new ComplianceDisclaimerAdvisor() // Disclaimer əlavə et
                )
                .build();
    }

    public String processQuery(String userPrompt) {
        return chatClient.prompt()
                .user(userPrompt)
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

- **Qərar: Interceptor vs Advisor.** 
  - *İzah:* Standart HTTP Interceptor-lar yalnız aşağı səviyyəli baytlarla işləyir. Advisor-lar isə Spring AI-ın `Message`, `Prompt` və `ChatResponse` obyektlərinə birbaşa giriş imkanı verir. Bu, semantik modifikasiyalar üçün daha əlverişlidir.
- **Qərar: Stateful vs Stateless Advisors.**
  - *Trade-off:* Advisor-lar daxilində vəziyyət (state) saxlamaq (məsələn, bir istifadəçinin neçə token xərclədiyi) yaddaş sızmalarına və çoxmüvafiq (concurrency) problemlərə yol aça bilər. Tech Lead olaraq advisor-ları mümkün qədər *stateless* saxlamağı və ya state-i xarici Redis/DB-də idarə etməyi tövsiyə edin.
- **Latency (Gecikmə):** Hər bir Advisor zəncirə əlavə emal vaxtı qatır. Xüsusilə cavabı modifikasiya edən Advisor-lar böyük mətnlərdə `String` manipulyasiyası səbəbindən CPU-nu yükləyə bilər.

---

## Production məsələləri

1. **Streaming Dəstəyi:** Əgər `stream()` istifadə edirsinizsə, `RequestResponseAdvisor` yerinə `AroundAdvisor` istifadə etməli və `Flux` axınını (stream) manipulyasiya etmək üçün `aroundStream` metodunu implement etməlisiniz. Sadə `adviseResponse` metodları streaming cavabları üçün effektiv olmaya bilər.
2. **Error Handling:** Advisor daxilində baş verən xəta bütün LLM çağırışını dayandıracaq. Advisor-lar mütləq `try-catch` blokları ilə əhatə olunmalı və AI modelinin əsas funksionallığını pozmamalıdır.
3. **Security Context:** Advisor daxilində `SecurityContextHolder`-a müraciət edərək, sorğu göndərən istifadəçinin icazələrinə uyğun olaraq prompt-u dinamik filtrdən keçirə bilərsiniz.

---

## Komandaya necə tətbiq etmək (Tech Lead üçün praktik addımlar)

1. **"Standard Library" yaradın:** Müəssisə daxilində bütün AI servislərinin istifadə etməli olduğu ortaq Advisor-lardan ibarət daxili bir kitabxana (starter) hazırlayın.
2. **Auditing Standartı:** Hər bir LLM çağırışını (giriş, çıxış, token sayı, xərc) mərkəzi bazaya yazan bir `AuditAdvisor` tətbiqini məcburi edin.
3. **Review Proseduru:** Prompt-ları modifikasiya edən Advisor-ların kod review-suna xüsusi diqqət yetirin, çünki bu, modelin davranışını ("hallucination" riskini) birbaşa dəyişə bilər.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1. `RequestResponseAdvisor` interfeysini implement edən bir `LoggingAdvisor` yaradın.
2. Bu advisor sorğu göndərilməzdən əvvəl modelə göndərilən tam promptu (System + User messages) loglara çıxarsın.
3. Model cavab verdikdən sonra neçə saniyə çəkdiyini (latency) hesablayıb çap etsin.
4. Advisor-u mövcud `ChatClient`-ə əlavə edin və nəticəni yoxlayın.

---

## Mənbələr

- Spring AI Advisor Documentation: https://docs.spring.io/spring-ai/reference/api/chatclient.html#_advisors (yoxlanılmalıdır)
- Spring AI GitHub Samples (Advisors): https://github.com/spring-projects/spring-ai/tree/main/spring-ai-docs/src/main/antora/modules/ROOT/examples/chat-client (yoxlanılmalıdır)
- Aspect Oriented Programming in Spring: https://docs.spring.io/spring-framework/reference/core/aop.html (yoxlanılmalıdır)
