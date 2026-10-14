# Spring AI Chat Memory və Söhbət Tarixçəsinin İdarə Edilməsi (Advisors)

**Tarix:** 2026-10-14 · **Kateqoriya:** Spring AI · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.1 (yoxlanılmalıdır) · Spring AI 2.0.1 (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM-lər təbiətcə **stateless**-dir; onlar əvvəlki sorğuda nə dediyinizi xatırlamır. Multi-turn (çoxmərhələli) dialoq quran zaman istifadəçinin konteksti saxlaması üçün hər bir yeni sorğu ilə birlikdə əvvəlki mesajlar zəncirini (User və Assistant replikalarını) yenidən modelə göndərmək lazımdır. Əgər bunu əllə (`List<Message>` idarə edərək) etsəniz, kod bazanız tezliklə spagettiyə çevriləcək və token limitləri partlayacaq. Spring AI **Chat Memory** və **Advisor** arxitekturası ilə bu prosesi deklarativ, təmiz və production səviyyəsində idarə etməyə imkan verir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **ChatMemory** | Mesaj tarixçəsini (`List<Message>`) saxlamaq, oxumaq və silmək üçün baza interfeysi. `InMemoryChatMemory`, JDBC və ya NoSQL əsaslı implementasiyaları ola bilər. |
| **Conversation ID** | Fərqli istifadəçilərin və ya fərqli sessiyaların dialoqlarını bir-birindən ayırmaq üçün istifadə olunan unikal açar (məsələn, sessiya ID və ya `userId:chatId`). |
| **CallAdvisor / AroundAdvisor** | Spring AI-da sorğu LLM-ə getməzdən əvvəl və cavab qayıtdıqdan sonra işə düşən interceptor mexanizmi. |
| **MessageChatMemoryAdvisor** | Əvvəlki mesajları sistem promptuna deyil, LLM sorğusuna ayrıca `Message` obyektləri (User/Assistant dialoqları) kimi əlavə edən standart məsləhətçi (advisor). |
| **PromptChatMemoryAdvisor** | Tarixçəni xüsusi formatda birbaşa sistem promptunun içinə daxil edən advisor (bəzi kiçik modellər üçün daha optimaldır). |
| **Token Window Memory** | Dialoq uzandıqca token limitini aşmamaq üçün yalnız son $N$ sayda mesajı və ya müəyyən token büdcəsini saxlayan pəncərə yanaşması. |

---

## Kod nümunəsi

Ssenari: İstifadəçi müştəri xidmətləri ilə söhbət edir. Sistem hər bir istifadəçinin sessiyasını yadda saxlayır və əvvəlki sualları kontekstdə saxlayaraq cavab verir.

### 1. Konfiqurasiya: ChatMemory Bean təyini

İlkin mərhələdə lokal yaddaş üçün `InMemoryChatMemory`, paylanmış sistemlər üçün isə Redis və ya JDBC tərəfdaşları istifadə edilir.

```java
package az.example.ai.config;

import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AiChatMemoryConfig {

    @Bean
    public ChatMemory chatMemory() {
        // Production üçün RedisChatMemory və ya JdbcChatMemory tövsiyə olunur
        return new InMemoryChatMemory();
    }
}
```

### 2. Service Səviyyəsi: MessageChatMemoryAdvisor inteqrasiyası

Spring AI 2.x `ChatClient.Builder` vasitəsilə `MessageChatMemoryAdvisor` zəncirini rahatlıqla tətbiq etməyə imkan verir.

```java
package az.example.ai.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.MessageChatMemoryAdvisor;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.stereotype.Service;

import static org.springframework.ai.chat.client.advisor.AbstractChatMemoryAdvisor.CHAT_MEMORY_CONVERSATION_ID_KEY;
import static org.springframework.ai.chat.client.advisor.AbstractChatMemoryAdvisor.CHAT_MEMORY_RETRIEVE_SIZE_KEY;

@Service
public class CustomerSupportService {

    private final ChatClient chatClient;

    public CustomerSupportService(ChatClient.Builder builder, ChatMemory chatMemory) {
        this.chatClient = builder
                .defaultSystem("""
                        Siz elektron ticarət platformasının nəzakətli dəstək köməkçisisiniz.
                        İstifadəçinin suallarına söhbət kontekstini nəzərə alaraq qısa və aydın cavab verin.
                        """)
                // Standart Advisor kimi qeydiyyat: Bütün çağırışlar avtomatik yaddaşdan keçəcək
                .defaultAdvisors(
                        new MessageChatMemoryAdvisor(chatMemory)
                )
                .build();
    }

    public String chat(String conversationId, String userMessage) {
        return chatClient.prompt()
                .user(userMessage)
                // Advisor parametrlərini dinamik olaraq hər sorğuya uyğun ötürürük
                .advisors(advisorSpec -> advisorSpec
                        .param(CHAT_MEMORY_CONVERSATION_ID_KEY, conversationId)
                        .param(CHAT_MEMORY_RETRIEVE_SIZE_KEY, 10) // Son 10 mesajı LLM-ə göndər
                )
                .call()
                .content();
    }
}
```

### 3. REST Controller ilə istifadə

```java
package az.example.ai.controller;

import az.example.ai.service.CustomerSupportService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/support")
public class SupportChatController {

    private final CustomerSupportService supportService;

    public SupportChatController(CustomerSupportService supportService) {
        this.supportService = supportService;
    }

    @PostMapping("/chat")
    public ResponseEntity<ChatResponse> sendMessage(
            @RequestHeader("X-Conversation-Id") String conversationId,
            @RequestBody ChatRequest request
    ) {
        String botReply = supportService.chat(conversationId, request.message());
        return ResponseEntity.ok(new ChatResponse(conversationId, botReply));
    }

    public record ChatRequest(String message) {}
    public record ChatResponse(String conversationId, String reply) {}
}
```

---

## Arxitektura qərarları və trade-off-lar

```
İstifadəçi Sorğusu 
       │
       ▼
[MessageChatMemoryAdvisor] ──(oxuyur)──► [ChatMemory Store (Redis/DB)]
       │ (Tarixçə + Yeni Sorğu)
       ▼
   [LLM Model]
       │ (Model Cavabı)
       ▼
[MessageChatMemoryAdvisor] ──(saxlayır)─► [ChatMemory Store (Redis/DB)]
       │
       ▼
Yekun Cavab İstifadəçiyə
```

| Strategiya | Üstünlükləri | Mənfi cəhətləri | Hansı halda seçilməli? |
|---|---|---|---|
| **In-Memory (`InMemoryChatMemory`)** | Quraşdırma tələb etmir, olduqca sürətlidir, testlər üçün idealdır. | Pod restart olanda yaddaş itir; horizontal scale olmur (multi-instance pod-lar söhbəti bölüşə bilmir). | Yalnız lokal inkişaf və vahid instansiyalı sadə PoC-lar. |
| **Centralized Store (Redis / JDBC)** | Mikroservis instansiyaları arasında paylaşılan sessiya, pod restartında məlumat itmir, TTL dəstəyi. | Əlavə şəbəkə gecikməsi (I/O latency) və asılılıq (Redis/PostgreSQL). | **Production mühitləri üçün standart**. |
| **Tam Tarixçə vs Sliding Window** | Tam tarixçə modelə dialoqun bütün detallarını xatırladır. | Uzun söhbətlərdə token xərci eksponensial artır və nəhayət LLM `context_window_exceeded` xətası verir. | Qısa, 2-3 addımlıq sorğular xaricində heç vaxt tövsiyə edilmir. |
| **Sliding Window (`RETRIEVE_SIZE`)** | Proqnozlaşdırılan token xərci, stabil gecikmə müddəti. | İstifadəçi 15 mesaj əvvəl dediyi vacib detalı (məsələn: sifariş nömrəsini) unuda bilər. | Geniş müştəri dəstək çatlarda standart yanaşma. |

---

## Production məsələləri

**1. Data Isolation və Multi-Tenancy Təhlükəsizliyi**
- `conversationId` heç vaxt müştəri tərəfindən idarəolunan təhlükəsiz olmayan identifikator (məsələn, sadəcə `?id=123`) olmamalıdır. Əks halda istifadəçi başqasının dialoq tarixçəsini LLM vasitəsilə ifşa edə bilər (Insecure Direct Object Reference - IDOR).
- **Həll:** `conversationId` mütləq `userId + ":" + UUID` formatında server tərəfdən təsdiqlənməlidir.

**2. Token İdarəçiliyi və Xərc Kontrolu**
- Əgər dialoq 20 raund davam edərsə və hər raundda əvvəlki bütün dialoq təkrar göndərilərsə, 1 istifadəçinin sessiyası 50,000+ token yandıra bilər.
- **Həll:** Həmişə `CHAT_MEMORY_RETRIEVE_SIZE_KEY` limitini təyin edin (məsələn, son 6-10 mesaj). Vacib faktların itməməsi üçün dialoqun əvvəlində LLM-ə istifadəçi haqqında xülasə çıxarmaq (Conversation Summarization) və bunu sistem promptuna qoymaq tövsiyə edilir.

**3. Sessiyanın Ömrü (TTL) və GDPR / PII Təmizlənməsi**
- Söhbət yaddaşında saxlanılan mesajlar müəyyən müddətdən sonra (məsələn, 24 saat fəaliyyətsizlikdən sonra) Redis və ya bazadan avtomatik silinməlidir (TTL / Expire).
- Şəxsi məlumatların (PII) qorunması tələbinə əsasən, istifadəçi "Yaddaşı sıfırla" düyməsini sıxdıqda `chatMemory.clear(conversationId)` çağırılmalıdır.

---

## Komandaya necə tətbiq etmək

1. **MemChat API-ni birbaşa çağırmaqdan çəkinin:** Komanda üzvlərinə xatırladın ki, `chatMemory.add(...)` və ya `chatMemory.get(...)` metodlarını domen kodunda əllə çağırmaq lazım deyil. Bütün məntiq `ChatClient`-in `Advisor` zənciri vasitəsilə şəffaf şəkildə həll olunmalıdır.
2. **Konteynerlər üçün RedisChatMemory:** Kubernetes klasterində işləyəcək servislər üçün arxitektura sprintində ortaq Redis instansiyasında yaddaş açarlarının prefiks konvensiyasını təyin edin (məsələn, `ai:chat:memory:{tenant_id}:{conversation_id}`).
3. **Review Checklist:**
   - Sorğuda `CHAT_MEMORY_CONVERSATION_ID_KEY` düzgün parametr kimi ötürülürmü?
   - Dialoq üçün maksimum mesaj sayı (`CHAT_MEMORY_RETRIEVE_SIZE_KEY`) təyin edilibmi?
   - `InMemoryChatMemory` yalnız unit/integration testlərdə qalırmı?

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Spring AI layihənizdə `CustomerSupportService`-i yuxarıdakı kimi yaradın.
2. Sadə bir konsol və ya JUnit integration testi yazın:
   - 1-ci çağırış: *"Salam, mənim adım Nicatdır və mən Bakıda yaşayıram."* (`conversationId = "sess-101"`)
   - 2-ci çağırış: *"Mənim adım nədir və mən haradanam?"* (Eyni `conversationId = "sess-101"`)
   - 3-cü çağırış: Eyni sualı fərqli `conversationId = "sess-102"` ilə verin.
3. 2-ci sorğuda modelin adınızı düzgün xatırladığını, 3-cü sorğuda isə məlumatı bilmədiyini təsdiqləyin.
4. `CHAT_MEMORY_RETRIEVE_SIZE_KEY` parametrini `1` qoyaraq yaddaşın necə unudulduğunu müşahidə edin.

---

## Mənbələr

- Spring AI Reference — Chat Memory (2.0.1, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/chat-memory.html
- Spring AI Reference — ChatClient Advisors (2.0.1, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/chatclient.html#_advisors
- Enterprise Integration Patterns with LLM Memory Management: https://platform.openai.com/docs/guides/text-generation
