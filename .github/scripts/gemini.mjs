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

async function ask({ system, input, thinking, maxTokens }) {
  const errors = [];
  for (const model of MODELS) {
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          system_instruction: system,
          input,
          tools: [{ type: "google_search" }],
          generation_config: { thinking_level: thinking, max_output_tokens: maxTokens },
          store: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      errors.push(`${model}: ${e.name === "TimeoutError" ? "timeout" : e.message}`);
      continue;
    }
    const body = await res.text();
    if (!res.ok) {
      errors.push(`${model}: HTTP ${res.status} ${body.slice(0, 300)}`);
      if ([404, 429, 500, 503].includes(res.status)) continue; // növbəti model
      break; // 400/401/403 — digər modellər də eyni xətanı verəcək
    }
    const data = JSON.parse(body);
    const text = (data.steps ?? [])
      .filter((s) => s.type === "model_output")
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    if (data.status !== "completed" || !text.trim()) {
      errors.push(`${model}: status=${data.status}, mətn ${text.trim() ? "var" : "yoxdur"}`);
      continue;
    }
    console.log(`model=${model} usage=${JSON.stringify(data.usage ?? {})}`);
    return { text, model };
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
hər şey aşağıda verilib. Versiya və API-ləri google_search ilə rəsmi mənbələrdən yoxla.

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
Versiya/API iddialarını lazım olduqda google_search ilə yoxla.

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
