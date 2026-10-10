// Gemini Interactions API ilə tək sorğu: agent yox, retry dövrü yox.
// Pulsuz tier: model başına 5 RPM / 20 RPD — ona görə hər iş = 1 sorğu.
//
//   node .github/scripts/gemini.mjs daily <YYYY-MM-DD>
//   node .github/scripts/gemini.mjs ask <thread-file> <reply-file>

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

const API = "https://generativelanguage.googleapis.com/v1beta/interactions";
// Birinci model 429/404/5xx verərsə növbətiyə keçilir (hər modelin öz gündəlik limiti var).
const MODELS = (process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-3-flash-preview,gemini-3.5-flash-lite")
  .split(",").map((m) => m.trim()).filter(Boolean);
const TIMEOUT_MS = 240_000;

const key = process.env.GEMINI_API_KEY;
if (!key) fail("GEMINI_API_KEY secret təyin edilməyib");

const [mode, ...args] = process.argv.slice(2);
const read = (p) => readFileSync(p, "utf8");

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

// Pulsuz tier-də Google Search grounding-in kvotası yoxdur (2026-10-11 yoxlanılıb: həmişə 429).
// Billing qoşulsa GEMINI_SEARCH=true ilə yenidən aktivləşdirmək olar.
// Interactions API alınmasa — klassik generateContent.
function attempts() {
  const [first, ...others] = MODELS;
  return [
    ...(process.env.GEMINI_SEARCH === "true" ? [{ api: "interactions", model: first, search: true }] : []),
    { api: "interactions", model: first, search: false },
    { api: "generateContent", model: first, search: false },
    ...others.map((model) => ({ api: "generateContent", model, search: false })),
  ];
}

const NO_SEARCH_NOTE = `

QEYD: Bu sorğuda internet axtarışı YOXDUR. Versiya nömrələrini bildiyin ən son məlumata görə yaz,
amma hər birinin yanında "(yoxlanılmalıdır)" qeyd et və Mənbələr bölməsində rəsmi linkləri ver.`;

function buildRequest({ api, model, search }, { system: baseSystem, input, thinking, maxTokens }) {
  const system = search ? baseSystem : baseSystem + NO_SEARCH_NOTE;
  if (api === "interactions") {
    return {
      url: API,
      body: {
        model,
        system_instruction: system,
        input,
        ...(search && { tools: [{ type: "google_search" }] }),
        generation_config: { thinking_level: thinking, max_output_tokens: maxTokens },
        store: false,
      },
    };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    },
  };
}

function extractText(api, data) {
  if (api === "interactions") {
    if (data.status !== "completed") return "";
    return (data.steps ?? [])
      .filter((s) => s.type === "model_output")
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}

async function ask(prompt) {
  const errors = [];
  for (const attempt of attempts()) {
    const label = `${attempt.api}/${attempt.model}/${attempt.search ? "search" : "no-search"}`;
    const { url, body } = buildRequest(attempt, prompt);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      errors.push(`${label}: ${e.name === "TimeoutError" ? "timeout" : e.message}`);
      console.log(`✗ ${errors.at(-1)}`);
      continue;
    }
    const raw = await res.text();
    if (!res.ok) {
      errors.push(`${label}: HTTP ${res.status} ${raw.slice(0, 200)}`);
      console.log(`✗ ${errors.at(-1)}`);
      if ([400, 404, 429, 500, 503].includes(res.status)) continue;
      break; // 401/403 — key problemi, digər cəhdlər də alınmayacaq
    }
    const text = extractText(attempt.api, JSON.parse(raw));
    if (!text.trim()) {
      errors.push(`${label}: boş cavab`);
      console.log(`✗ ${errors.at(-1)}`);
      continue;
    }
    console.log(`✓ ${label}`);
    return { text, model: label };
  }
  throw new Error(errors.join("\n"));
}

const claudeMd = read("CLAUDE.md");
const topicsMd = read("topics.md");
const dailyFiles = readdirSync("daily").filter((f) => f.endsWith(".md")).sort();

if (mode === "daily") {
  const day = args[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(`Tarix formatı səhvdir: ${day}`);
  const example = dailyFiles.length ? read(`daily/${dailyFiles.at(-1)}`) : "";

  const system = `${claudeMd}

---
Sən bu təlimatlara əməl edən mentorsan. Repo fayllarına birbaşa girişin yoxdur — lazım olan
hər şey aşağıda verilib. Versiya və API-lər üçün yalnız əmin olduğun məlumatı yaz.

CAVAB FORMATI (dəqiq belə, başqa heç nə yazma):
SLUG: <ascii-kebab-case-movzu-adi>
TOPIC: <mövzunun qısa adı>
CATEGORY: <kateqoriya>
LEVEL: <Başlanğıc | Orta | Qabaqcıl>
===CONTENT===
<faylın tam markdown məzmunu>`;

  const input = `Bugünkü tarix: ${day}

## topics.md (keçilmiş mövzular — təkrarlama)
${topicsMd}

## Üslub nümunəsi (son gündəlik fayl: ${dailyFiles.at(-1) ?? "yoxdur"})
${example}

Növbəti mövzunu seç və həmin formatda gündəlik faylı yaz.`;

  let out;
  try {
    out = await ask({ system, input, thinking: "medium", maxTokens: 24000 });
  } catch (e) {
    fail(`Gemini cavab vermədi:\n${e.message}`);
  }

  const [head, ...rest] = out.text.split("===CONTENT===");
  const content = rest.join("===CONTENT===").trim();
  const field = (name) => head.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1].trim();
  const AZ = { ə: "e", ı: "i", ö: "o", ü: "u", ş: "s", ç: "c", ğ: "g" };
  const slug = field("SLUG")?.toLowerCase()
    .replace(/[əıöüşçğ]/g, (ch) => AZ[ch])
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const topic = field("TOPIC");
  if (!slug || !topic || content.length < 2000) {
    fail(`Cavab formatı gözlənilən kimi deyil (slug=${slug}, topic=${topic}, uzunluq=${content.length})`);
  }

  const file = `daily/${day}-${slug}.md`;
  writeFileSync(file, content + "\n");
  const row = `| ${day} | ${topic} | ${field("CATEGORY") ?? "TBD"} | ${field("LEVEL") ?? "TBD"} | [${file}](${file}) |`;
  writeFileSync("topics.md", topicsMd.trimEnd() + "\n" + row + "\n");
  console.log(`Yaradıldı: ${file} (model: ${out.model})`);
} else if (mode === "ask") {
  const [threadFile, replyFile] = args;
  const thread = read(threadFile);
  // Söhbətdə adı çəkilən gündəlik faylları kontekstə əlavə et (yoxdursa — ən sonuncunu)
  const mentioned = dailyFiles.filter((f) => thread.includes(f.replace(/\.md$/, "")) || thread.includes(f.slice(0, 10)));
  const context = (mentioned.length ? mentioned : dailyFiles.slice(-1))
    .map((f) => `### daily/${f}\n${read(`daily/${f}`)}`).join("\n\n");

  const system = `${claudeMd}

---
Sən GitHub issue-da istifadəçi (AziOruj) ilə danışan mentorsan. Cavabın birbaşa GitHub şərhi kimi
dərc olunur — markdown istifadə et. Azərbaycan dilində, texniki terminlər ingiliscə, yalnız Java.
Versiya/API iddialarında əmin deyilsənsə, bunu açıq de.

İstifadəçinin ƏN SONUNCU mesajına cavab ver.
- SUAL (izah, misal, quiz, tapşırığın yoxlanması): sadəcə cavab yaz.
- DÜZƏLİŞ İSTƏYİ ("düzəlt", "əlavə et", "dəyiş", "sil", "qayda kimi yaz"): cavabdan sonra
  dəyişən hər fayl üçün FAYLIN TAM YENİ MƏZMUNUNU bu blokda ver:
  <<<FILE daily/....md>>>
  ...faylın tam məzmunu...
  <<<END>>>
  İcazə verilən fayllar: daily/*.md, topics.md, CLAUDE.md. Gələcək günlərə aid üslub
  istəkləri CLAUDE.md-yə qayda kimi yazılır. Blokdan əvvəl nəyi dəyişdiyini qısa siyahı ilə yaz.`;

  const input = `## topics.md\n${topicsMd}\n\n## Əlaqəli gündəlik fayl(lar)\n${context}\n\n## Söhbət\n${thread}`;

  let out;
  try {
    out = await ask({ system, input, thinking: "low", maxTokens: 24000 });
  } catch (e) {
    writeFileSync(replyFile, `⚠️ Gemini cavab vermədi.\n\n\`\`\`\n${e.message}\n\`\`\`\n`);
    fail("Gemini cavab vermədi");
  }

  const changed = [];
  const reply = out.text.replace(/<<<FILE ([^>\n]+)>>>\n([\s\S]*?)<<<END>>>/g, (_, path, body) => {
    path = path.trim();
    const allowed = /^daily\/[\w.-]+\.md$/.test(path) || path === "topics.md" || path === "CLAUDE.md";
    if (!allowed || path.includes("..")) return `\n> ⚠️ İcazəsiz fayl yolu rədd edildi: \`${path}\`\n`;
    if (path.startsWith("daily/") && !existsSync(path)) return `\n> ⚠️ Fayl tapılmadı: \`${path}\`\n`;
    writeFileSync(path, body.trimEnd() + "\n");
    changed.push(path);
    return "";
  });
  writeFileSync(replyFile, reply.trim() + `\n\n<sub>model: ${out.model}${changed.length ? ` · dəyişdi: ${changed.join(", ")}` : ""}</sub>\n`);
  console.log(`Cavab hazırdır (model: ${out.model}), dəyişən fayllar: ${changed.join(", ") || "yoxdur"}`);
} else {
  fail(`Naməlum rejim: ${mode}`);
}
