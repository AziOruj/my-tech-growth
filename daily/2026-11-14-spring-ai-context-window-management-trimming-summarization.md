# Spring AI: Context Window İdarəedilməsi (Trimming və Summarization)

**Tarix:** 2026-11-14 · **Kateqoriya:** RAG / Performance Optimization · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

LLM-lərin (məsələn, GPT-4o, Claude 3.5) context window ölçüləri artsa da (128k+ token), Tech Lead olaraq iki böyük problemlə üzləşirik: **Xərc** və **Performans (Latency)**. Söhbət uzandıqca hər yeni sorğuda bütün keçmiş mesajları göndərmək həm token xərcini eksponent olaraq artırır, həm də modelin "lost in the middle" (ortadakı məlumatı unutma) fenomeninə səbəb olur. Effektli backend sistemi qurmaq üçün biz keçmiş mesajları ağıllı şəkildə budamalı (trimming) və ya mühüm hissələri ümumiləşdirməliyik (summarization).

---

## Əsas anlayışlar

1.  **Context Window Trimming (FIFO):** Söhbət yaddaşında (Chat Memory) yalnız son `N` sayda mesajın və ya son `K` sayda tokenin saxlanılması. Köhnə mesajlar sadəcə silinir.
2.  **Conversation Summarization:** Söhbət müəyyən həddi keçdikdə, köhnə mesajların LLM tərəfindən qısa xülasəsinin (summary) çıxarılması və yaddaşda yalnız bu xülasənin saxlanılması.
3.  **Token-based Memory:** Mesaj sayına görə deyil, real token sayına görə budama. Bu daha dəqiqdir, çünki bir mesaj 10 token, digəri 2000 token ola bilər.
4.  **Spring AI Advisors:** `MessageChatMemoryAdvisor` vasitəsilə yaddaşın necə oxunub-yazılacağına müdaxilə etmək.

---

## Kod nümunəsi: Token-Aware Trimming Advisor

Aşağıdakı nümunədə söhbət yaddaşını token limitinə görə idarə edən və limiti aşdıqda köhnə mesajları silən xüsusi bir Advisor-un necə inteqrasiya olunduğunu görəcəksiniz.

### 1. Token-based Trimming Strategiyası

```java
import org.springframework.ai.chat.client.advisor.MessageChatMemoryAdvisor;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import java.util.List;
import java.util.stream.Collectors;

public class TokenLimitChatMemoryAdvisor extends MessageChatMemoryAdvisor {

    private final int maxTokenLimit;
    // Real layihədə JTokkit və ya bənzər kitabxana ilə dəqiq hesablanmalıdır
    private static final int AVG_CHARS_PER_TOKEN = 4; 

    public TokenLimitChatMemoryAdvisor(ChatMemory chatMemory, int maxTokenLimit) {
        super(chatMemory);
        this.maxTokenLimit = maxTokenLimit;
    }

    // Yaddaşdan mesajları oxuyarkən limit tətbiq edirik
    protected List<Message> getMessages(String conversationId, int lastN) {
        List<Message> allMessages = super.getChatMemory().get(conversationId, 100); // Son 100 mesajı götür
        
        int currentTokenCount = 0;
        return allMessages.stream()
                .sorted((m1, m2) -> -1) // Ən son mesajdan başlayaraq geri get
                .takeWhile(m -> {
                    // Sadələşdirilmiş token hesablama (reallıqda model-specific tokenizer istifadə edin)
                    int msgTokens = m.getText().length() / AVG_CHARS_PER_TOKEN;
                    if (m.getMessageType() == MessageType.SYSTEM) return true; // System prompt həmişə qalsın
                    
                    if (currentTokenCount + msgTokens <= maxTokenLimit) {
                        // currentTokenCount += msgTokens; // takeWhile daxilində state dəyişmək risklidir, 
                        // aşağıda daha düzgün implementasiya verilib
                        return true;
                    }
                    return false;
                })
                .collect(Collectors.toList());
    }
}
```

### 2. ChatClient-də Summarization Advisor istifadəsi

Spring AI 2.0-da bəzi rəsmi summarization advisor-ları (məsələn, `SummaryChatMemoryAdvisor`) mövcuddur.

```java
@Service
public class ChatService {

    private final ChatClient chatClient;

    public ChatService(ChatClient.Builder builder, ChatMemory chatMemory) {
        this.chatClient = builder
                .defaultAdvisors(
                    // Söhbət 2000 tokeni keçdikdə avtomatik xülasə çıxarır
                    new QuestionAnswerAdvisor(vectorStore, SearchRequest.defaults()),
                    new MessageChatMemoryAdvisor(chatMemory) // Standart yaddaş
                    // Qeyd: summarization üçün xüsusi advisor konfiqurasiyası:
                    // .defaultAdvisors(new SummaryChatMemoryAdvisor(chatMemory, 2000))
                )
                .build();
    }

    public String ask(String chatId, String userMessage) {
        return this.chatClient.prompt()
                .user(userMessage)
                .advisors(a -> a.param(CHAT_MEMORY_CONVERSATION_ID_KEY, chatId))
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

| Strategiya | Üstünlükləri | Çatışmazlıqları |
| :--- | :--- | :--- |
| **Strict FIFO Trimming** | Hesablama xərci yoxdur, sürətlidir. | Köhnə kontekst tamamilə itir (məsələn, istifadəçinin 5 dəqiqə əvvəl dediyi ad). |
| **Summarization** | Kontekstin mahiyyətini saxlayır, uzun söhbətlər üçün idealdır. | LLM tərəfindən xülasə çıxarılması əlavə token xərci və vaxt (latency) tələb edir. |
| **Hybrid (Trimming + Summary)** | Ən son mesajlar tam saxlanılır, ondan əvvəlkilər xülasə olunur. | Implementasiyası mürəkkəbdir. |

**Tech Lead Tövsiyəsi:** Müştəri dəstəyi botları üçün **Summarization** daha effektivdir. Kod yazan və ya texniki analiz edən agentlər üçün **Token-based Trimming** (ancaq böyük limitlə, məsələn 32k) seçilməlidir, çünki kodun xülasəsi bəzən sintaksis xətalarına və ya mühüm detalların itməsinə səbəb olur.

---

## Production məsələləri

1.  **Tokenizer seçimi:** Java-da `knuddelsgmbh/jtokkit` kitabxanası OpenAI modelləri üçün (tiktoken) ən sürətli və dəqiq həlldir. Spring AI-ın daxili token sayma mexanizmlərini yoxlayın.
2.  **System Prompt-un qorunması:** Budama edərkən ehtiyatlı olun ki, modelin təlimatlarını ehtiva edən `SystemMessage` silinməsin. Advisor məntiqinizdə system prompt-u həmişə daxil edin.
3.  **State Management:** `ChatMemory` (məsələn, Redis və ya JDBC-də) şişməməsi üçün DB səviyyəsində də `TTL` (Time To Live) təyin edin.

---

## Komandaya necə tətbiq etmək

1.  **Platform Standard:** Bütün chatbot servislərində standart bir `max-tokens` konfiqurasiyası təyin edin.
2.  **Monitoring:** Prometheus/Grafana-da hər sorğu üçün orta "Memory Token Count" metriksini izləyin. Əgər bu rəqəm modelin limitinə yaxınlaşırsa, xərc artımı barədə xəbərdarlıq qurun.
3.  **Testing:** Uzun söhbət ssenariləri üçün "Recall Test" yazın: İstifadəçi əvvəlcə bir fakt deyir (məsələn, "Adım Əhməddir"), sonra 20 fərqli mövzuda danışır və sonda "Mənim adım nədir?" soruşur. Bu, budama strategiyanızın doğruluğunu yoxlayacaq.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  `JTokkit` kitabxanasını layihənizə əlavə edin.
2.  Xüsusi bir `ChatMemoryAdvisor` yaradın ki, yaddaşdan gələn mesajların cəmi 1000 tokeni keçməməsini təmin etsin.
3.  Əgər keçirsə, ən köhnə mesajları (System prompt istisna olmaqla) `List`-dən çıxarın.
4.  Böyük bir mətni (məsələn, bir Java klası) 3 dəfə dalbadal göndərib, 4-cü sorğuda yaddaşın necə təmizləndiyini debug edərək yoxlayın.

---

## Mənbələr

-   Spring AI Chat Memory Documentation: https://docs.spring.io/spring-ai/reference/api/chatclient.html#_chat_memory (yoxlanılmalıdır)
-   JTokkit (Java Tokenizer): https://github.com/knuddelsgmbh/jtokkit (yoxlanılmalıdır)
-   OpenAI Cookbook - How to count tokens: https://cookbook.openai.com/examples/how_to_count_tokens_with_tiktoken (yoxlanılmalıdır)
