# Spring AI: MCP Server Development (Daxili Alətlərin LLM-lərə Açılması)

**Tarix:** 2026-11-26 · **Kateqoriya:** MCP / Architecture · **Səviyyə:** Qabaqcıl  
**Versiyalar:** Java 21 · Spring Boot 4.1.x (yoxlanılmalıdır) · Spring AI 2.0.x (yoxlanılmalıdır)

---

## Niyə vacibdir

Oktyabr ayında biz **Model Context Protocol (MCP)** vasitəsilə xarici alətləri (məs. Google Drive, GitHub) öz Java proqramımıza necə qoşacağımızı öyrəndik. Lakin Tech Lead olaraq sizin ən böyük dəyəriniz daxili ekosistemdədir. Şirkətinizin daxili mikroservisləri, mülkiyyətində olan verilənlər bazaları və legacy sistemləri var. **MCP Server** qurmaqla siz bu daxili resursları vahid standartla istənilən LLM agentinə (həm öz yazdığınız Spring AI agentlərinə, həm də Claude Desktop kimi hazır alətlərə) təhlükəsiz şəkildə aça bilərsiniz. Bu, "AI-Ready Enterprise Architecture" üçün fundamentdir.

---

## Əsas anlayışlar

MCP Server üç növ primitiv təqdim edir:
1.  **Resources:** Oxunaqlı məlumatlar (məs. log faylları, verilənlər bazası cədvəlləri).
2.  **Tools:** LLM-in icra edə biləcəyi funksiyalar (məs. "Müştərinin statusunu yenilə").
3.  **Prompts:** Hazır prompt şablonları (məs. "Kodu analiz etmək üçün standart sistem təlimatı").

Nəqliyyat qatı (Transport) olaraq adətən **stdio** (lokal proseslər üçün) və ya **SSE** (Server-Sent Events, uzaqdakı serverlər üçün) istifadə olunur.

---

## Kod nümunəsi: Enterprise MCP Server

Gəlin daxili bir "Inventory Service"-i LLM-lərə açan MCP Server quraq.

### 1. Dependency-lər (pom.xml)
```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-mcp-server-spring-boot-starter</artifactId>
    <version>2.0.x</version> <!-- (yoxlanılmalıdır) -->
</dependency>
```

### 2. MCP Tool Konfiqurasiyası
Spring AI-da MCP Server qurmaq çox sadədir. `@Tool` annotasiyası ilə işarələnmiş bean-lər avtomatik olaraq MCP tool-ları kimi eksport edilir.

```java
@Configuration
@Slf4j
public class InventoryMcpConfig {

    // Daxili legacy servisimiz
    private final InventoryService inventoryService;

    public InventoryMcpConfig(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @Bean
    @Tool(description = "Məhsulun stok miqdarını və anbardakı yerini yoxlayır")
    public InventoryResponse checkStock(String skuCode) {
        log.info("MCP Tool called for SKU: {}", skuCode);
        return inventoryService.getStockInfo(skuCode);
    }

    @Bean
    public McpServer mcpServer(McpServer.Builder builder) {
        // SSE transportu istifadə edərək serveri uzaqdan qoşulmalar üçün açırıq
        return builder
                .serverName("Enterprise-Inventory-Server")
                .serverVersion("1.0.0")
                .build();
    }
}
```

### 3. SSE Endpoint (Remote Access)
Server-Sent Events vasitəsilə uzaqdakı agentlərin qoşulması üçün:

```java
@RestController
public class McpTransportController {

    private final McpServer mcpServer;

    public McpTransportController(McpServer mcpServer) {
        this.mcpServer = mcpServer;
    }

    @GetMapping("/mcp/sse")
    public SseEmitter handleSse() {
        return mcpServer.getSseHandler();
    }

    @PostMapping("/mcp/message")
    public void handleMessage(HttpServletRequest request, HttpServletResponse response) {
        mcpServer.handleMessage(request, response);
    }
}
```

---

## Arxitektura qərarları və trade-off-lar

-   **Stdio vs SSE:** Əgər MCP Serveriniz agentlə eyni maşında/konteynerdə işləyəcəksə (məs. sidecar pattern), **stdio** daha sürətli və sadədir. Əgər mərkəzi bir alətlər anbarı (Centralized Tool Hub) qurursunuzsa, **SSE** mütləqdir.
-   **Granularity:** Hər bir mikroservis öz MCP serverini saxlamalıdır, yoxsa bir Gateway MCP server olmalıdır? Tech Lead olaraq **Gateway** yanaşmasını (Aggregator) tövsiyə edirəm; bu, LLM-ə 100-lərlə ayrı serverə qoşulmaq yükünü azaldır.

---

## Production məsələləri

1.  **Security (Authentication):** MCP hələ ki daxili auth mexanizmini tam standartlaşdırmayıb. SSE istifadə edirsinizsə, API Key və ya mTLS mütləq tətbiq edilməlidir.
2.  **Rate Limiting:** LLM-lər "loop"-a düşüb tool-u saniyədə yüzlərlə dəfə çağıra bilər. Spring Cloud Gateway və ya Bucket4j ilə mütləq MCP endpoint-lərinə limit qoyun.
3.  **Discovery:** Serverin hansı tool-lara sahib olduğunu bildirən `listTools` metodu avtomatik yaradılır. Lakin tool-un təsviri (`description`) LLM-in onu başa düşməsi üçün kritikdir. Təsvirləri "prompt engineering" prinsipləri ilə yazın.

---

## Komandaya necə tətbiq etmək

1.  **"AI-Ready" APIs:** Komandanıza tapşırın ki, hər yeni biznes funksionallığı yazanda, onun MCP tool versiyasını da hazırlasınlar.
2.  **SDK Generation:** Mövcud OpenAPI (Swagger) sənədlərindən avtomatik MCP Server yaradan generatorlar qurun (Spring AI-ın gələcək versiyalarında bu inteqrasiya gözlənilir).
3.  **Internal Tool Catalog:** Şirkət daxilində hansı MCP serverlərin (Maliyyə, HR, IT Support) olduğunu göstərən bir kataloq yaradın.

---

## Bugünkü tapşırıq (30-60 dəqiqəlik praktiki məşq)

1.  Kiçik bir Spring Boot layihəsində `spring-ai-mcp-server` starter-ini qoşun.
2.  Verilənlər bazasından (H2 və ya Postgres) məlumat oxuyan bir `@Tool` yaradın.
3.  **Challenge:** Bir `McpResource` yaradın ki, sistemin `/logs/app.log` faylının son 100 sətrini LLM-ə resurs kimi təqdim etsin.
4.  Lokalda `Claude Desktop` konfiqurasiya faylına (`claude_desktop_config.json`) öz serverinizi əlavə edərək, Claude-un sizin daxili metodunuzu çağıra bildiyini test edin.

---

## Mənbələr

-   Model Context Protocol Official Site: https://modelcontextprotocol.io/
-   Spring AI MCP Documentation: https://docs.spring.io/spring-ai/reference/api/mcp.html (yoxlanılmalıdır)
-   MCP Java SDK GitHub: https://github.com/modelcontextprotocol/java-sdk (yoxlanılmalıdır)
