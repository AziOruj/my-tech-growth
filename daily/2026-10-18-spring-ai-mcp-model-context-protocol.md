# Model Context Protocol (MCP) Java SDK və Spring AI İnteqrasiyası

**Tarix:** 2026-10-18 · **Kateqoriya:** MCP · **Səviyyə:** Orta  
**Versiyalar:** Java 21 · Spring Boot 4.1.2 (yoxlanılmalıdır) · Spring AI 2.0.2 (yoxlanılmalıdır) · MCP Java SDK 0.8.0 (yoxlanılmalıdır)

---

## Niyə vacibdir

Ənənəvi tool/function calling yanaşmasında hər bir mikroservis və ya alət üçün LLM client daxilində xüsusi adapterlər və kod konfiqurasiyaları yazmaq lazım gəlirdi. **Model Context Protocol (MCP)** LLM tətbiqləri ilə xarici sistemlər, verilənlər bazaları və servis alətləri arasında əlaqəni standartlaşdıran "Language Server Protocol (LSP)" bənzəri açıq protokoldur. Tech Lead olaraq MCP-ni mənimsəmək, komandanıza müxtəlif korporativ sistemləri (GitLab, PostgreSQL, Jira, daxili API-lər) vahid protokol üzərindən LLM agentlərinə standart "plug-and-play" modulu kimi təqdim etməyə imkan verir.

---

## Əsas anlayışlar

| Anlayış | Təsviri |
|---|---|
| **MCP (Model Context Protocol)** | LLM müştəriləri (Client) ilə kontekst təminatçıları (Server) arasında JSON-RPC 2.0 əsaslı açıq standart. |
| **MCP Host / Client** | LLM ilə birbaşa əlaqədə olan və MCP Server-lərdən alətləri/resursları sorğulayan tərəf (məsələn, Spring AI tətbiqimiz). |
| **MCP Server** | Alətləri (Tools), resursları (Resources) və hazır prompt-ları (Prompts) standart formatda xaricə təqdim edən müstəqil servis. |
| **Transport Layer (STDIO vs SSE)** | MCP tərəfləri arasında rabitə kanalı: lokal proseslər üçün standart I/O (`stdio`), paylanmış mikroservislər üçün HTTP/Server-Sent Events (`sse`). |
| **MCP Tool Sync** | Spring AI-ın MCP Server-də qeydiyyatdan keçmiş funksiyaları avtomatik aşkarlayıb `ChatClient` alətlərinə çevirməsi. |

---

## Kod nümunəsi

Ssenari: Şirkətin daxili müştəri statusunu yoxlayan və xarici mikroservis kimi çalışan bir MCP Server-imiz var (HTTP/SSE üzərindən). Biz Spring Boot tətbiqimizdə `McpClient` konfiqurasiya edirik və bu serverdəki alətləri Spring AI `ChatClient`-ə avtomatik inteqrasiya edirik.

### 1. Maven Dependency-ləri

```xml
<dependencies>
    <!-- Spring AI OpenAI Starter -->
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-model-openai</artifactId>
    </dependency>
    <!-- Spring AI MCP Client Starter -->
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-mcp-client</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-webflux</artifactId>
    </dependency>
</dependencies>
```

### 2. MCP Client Konfiqurasiyası (`application.yml`)

SSE transport ilə uzaq məsafədəki MCP Server-ə qoşuluruq:

```yaml
spring:
  ai:
    mcp:
      client:
        enabled: true
        name: enterprise-mcp-orchestrator
        version: 1.0.0
        connections:
          crm-service:
            transport-type: sse
            url: http://crm-internal.corp.local:8080/mcp/sse
            read-timeout: 30s
```

### 3. Java Konfiqurasiyası: MCP Tool-larının ChatClient-ə qoşulması

Spring AI, `McpSyncClient` tərəfindən təmin edilən alətləri avtomatik olaraq Spring AI `ToolCallbackProvider` instansiyasına çevirir.

```java
package az.example.ai.mcp;

import io.modelcontextprotocol.client.McpSyncClient;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.mcp.McpToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration(proxyBeanMethods = false)
public class McpClientConfiguration {

    @Bean
    public ChatClient enterpriseMcpChatClient(
            ChatClient.Builder chatClientBuilder,
            List<McpSyncClient> mcpSyncClients) {

        // Bütün konfiqurasiya edilmiş MCP Serverlərdən Tool-ları toplayırıq
        McpToolCallbackProvider mcpToolCallbackProvider = new McpToolCallbackProvider(mcpSyncClients);

        return chatClientBuilder
                .defaultSystem("""
                    Sən korporativ müştəri dəstəyi agentisən.
                    Müştəri məlumatları ilə bağlı suallar olduqda, əlçatan MCP alətlərindən istifadə et.
                    Alət cavab vermədikdə istifadəçiyə dəqiq xəta barədə məlumat ver.
                    """)
                .defaultTools(mcpToolCallbackProvider.getToolCallbacks())
                .build();
    }
}
```

### 4. Agent Servisi və İstifadə Nümunəsi

```java
package az.example.ai.mcp;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class CustomerSupportAgentService {

    private final ChatClient chatClient;

    public CustomerSupportAgentService(ChatClient enterpriseMcpChatClient) {
        this.chatClient = enterpriseMcpChatClient;
    }

    public String handleCustomerInquiry(String userQuery) {
        // Model istifadəçinin sorğusuna əsasən uzaq MCP Server-dəki uyğun Tool-u
        // (məs: getCustomerTier, checkAccountBalance) müəyyən edib icra edəcək
        return this.chatClient.prompt()
                .user(userQuery)
                .call()
                .content();
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

1. **STDIO vs SSE (Server-Sent Events) Transport:**
   - **STDIO:** MCP server lokal host-da alt-proses (sub-process, CLI aləti kimi) olaraq başladılır. Təhlükəsiz sandbox mühitləri və lokal desktop/CLI inteqrasiyaları üçün sürətlidir, lakin Kubernetes mühitində mikroservis miqyaslanması üçün yararsızdır.
   - **SSE / HTTP:** Mikroservis arxitekturalarında ən yaxşı seçimdir. MCP server ayrı bir pod kimi yaşayır, lakin şəbəkə gecikməsi (network latency) və HTTP sessiyalarının idarə edilməsi trade-off-u yaranır.

2. **Dinamik Tool Discovery vs Statik Qeydiyyat:**
   - MCP ilə alətlər dinamik şəkildə serverdən soruşulur (`listTools`). Bu, arxitekturanı modulyar edir (müştəri kodunu dəyişmədən serverdə yeni alət əlavə etmək olur).
   - **Mənfi cəhət:** Əgər uzaq MCP server çox sayda (>50) alət qaytararsa, prompt daxilinə yüklənən JSON sxemlər context window-u şişirdir və xərci artırır.

3. **Autentikasiya və Şəbəkə Təhlükəsizliyi:**
   - Tool calling birbaşa monolit içində olduqda Java metodu daxili `SecurityContext` ilə qorunurdu.
   - MCP server SSE ilə kənardadırsa, hər bir alət çağırışında OAuth2 mTLS və ya Service-to-Service JWT ötürülməsi mütləq qurulmalıdır.

---

## Production məsələləri

- **Circuit Breaking və Timeout:** Uzaq MCP server cavab vermədikdə və ya gecikdikdə LLM zəncirinin ilişib qalmaması üçün `read-timeout` mütləq sərt təyin olunmalı, `Resilience4j` ilə MCP klientlər qorunmalıdır.
- **SSE Connection Management:** Spring WebFlux alt layında işləyən SSE əlaqələri server podu yenidən başladıldıqda (restart) qopur. Kliyentin avtomatik "reconnect" və alətlərin metadata keşini yeniləmə strategiyası olmalıdır.
- **Audit Logging (Kim hansı aləti çağırdı?):** LLM-in çağırdığı hər bir MCP aləti (adı, arqumentləri və server cavabı) təhlükəsizlik və audit məqsədilə unikal `traceId` ilə loglanmalıdır.

---

## Komandaya necə tətbiq etmək

1. **Daxili Mikroservisləri MCP Server-ə çevirin:** Şirkətin ən çox istifadə olunan daxili servislərini (məsələn, İT Support ticket sistemi, CRM) kiçik bir MCP wrapper qatı ilə təmin edin ki, bütün AI komandaları eyni interfeysdən istifadə edə bilsin.
2. **Sxem Dəqiqliyi:** Server tərəfində alət parametr təsvirlərini (tool description və argument descriptions) son dərəcə aydın yazın. LLM hansı aləti nə vaxt çağıracağını yalnız bu təsvirlərə görə qərar verir.
3. **Məsuliyyət Bölgüsü:** AI backend komandası yalnız MCP Client orkestrasiyasına fokuslansın, biznes domen komandaları isə öz MCP Server-lərini müstəqil şəkildə inkişaf etdirsin.

---

## Bugünkü tapşırıq (30–60 dəqiqə)

1. Layihənizə `spring-ai-starter-mcp-client` asılılığını əlavə edin.
2. Sadə bir lokal və ya sınaq MCP serveri (məsələn, rəsmi MCP nümunələrində olan `sqlite` və ya `filesystem` serverini stdio və ya SSE ilə) konfiqurasiya edin.
3. `ChatClient`-ə `McpToolCallbackProvider` qoşaraq: "Sistemdəki mövcud faylların siyahısını mənə göstər" sorğusunu verin və LLM-in MCP vasitəsilə cavab aldığını yoxlayın.
4. Şəbəkə loglarında JSON-RPC sorğu və cavab paketlərini analiz edin.

---

## Mənbələr

- Model Context Protocol Rəsmi Spesifikasiyası: https://modelcontextprotocol.io
- MCP Java SDK Rəsmi GitHub Repozitoriyası (yoxlanılmalıdır): https://github.com/modelcontextprotocol/java-sdk
- Spring AI MCP İnteqrasiyası Sənədləri (2.0.2, yoxlanılmalıdır): https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client.html
