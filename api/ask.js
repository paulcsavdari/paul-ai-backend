// API route pentru Vercel (api/ask.js) — UNIFICAT
// Dacă există VECTOR_STORE_ID -> folosește File Search (din textele tale).
// Dacă nu -> folosește "busola" (instrucțiuni), exact ca înainte.
// Necesită OPENAI_API_KEY; opțional OPENAI_MODEL.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || ""; // dacă e gol, face fallback automat

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function pickLang(lang) {
  if (!lang || typeof lang !== "string") return "auto";
  const L = lang.toLowerCase();
  return ["ro", "en", "sv", "de", "fr", "es", "pt", "it"].includes(L) ? L : "auto";
}

function systemPrompt(userLang) {
  const langLine =
    userLang === "auto"
      ? "Always answer in the language of the user's last message."
      : `Always answer in ${userLang}.`;

  return (
    `${langLine}\n` +
    "You are 'Theological Assistant' for paulcsavdari.info.\n" +
    "Voice & style: sober, theological, clear, direct, argumentative. No hedging words like 'pare', 'posibil', 's-ar putea'. No academic fluff.\n" +
    "Do not show citations, sources, or file names. Speak as a coherent vision.\n" +
    "Core axioms you must prioritize in reasoning and answers:\n" +
    "1) 'Cornul cel mic' (Daniel 8) = Filosofia care cucerește și rescrie religiile prin sincretism și universalizare.\n" +
    "2) LXX (Septuaginta) marchează intervenția filosofiei în corpusul iudaic; pluralul din Geneza 1 trădează această intervenție.\n" +
    "3) Linia autentică este unitatea lui Dumnezeu, confirmată explicit de Isus; mitul căderii și alte ambiguități sunt cusături sincretice.\n" +
    "4) Judecata creștină: Duhul lucrează inseparabil prin conștiință; Isus nu este simultan avocat și judecător într-un cadru juridic coerent.\n" +
    "Grounding policy (when files are available): Prefer the provided store context. Paraphrase; do not quote or list files. " +
    "If a brief general view is useful, append it at the end with a simple lead-in in the same language as the question: RO 'O altă interpretare:', EN 'Another interpretation:', SV 'En annan tolkning:'. Limit to 1–3 sentences. Never contradict the axioms.\n"
  );
}

// --- Varianta A: cu File Search (când avem VECTOR_STORE_ID) ---
async function askWithFileSearch({ question, lang }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const userLang = pickLang(lang);

  const body = {
    model: DEFAULT_MODEL,
    input: [
      { role: "system", content: systemPrompt(userLang) },
      { role: "user", content: question }
    ],
    tools: [{ type: "file_search" }],
    tool_config: { file_search: { vector_store_ids: [VECTOR_STORE_ID] } }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return (data.output_text || "").trim();
}

// --- Varianta B: fără File Search (fallback = comportamentul tău vechi) ---
async function askWithoutFiles({ question, lang }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const userLang = pickLang(lang);

  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt(userLang) },
      { role: "user", content: question }
    ],
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method Not Allowed" }); return; }

  try {
    let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    let body = {}; try { body = JSON.parse(raw || "{}"); } catch (_) {}
    const question = String(body.question || "").trim();
    const lang = body.lang;
    if (!question) { res.status(400).json({ error: "Missing 'question'" }); return; }

    let answer;
    if (VECTOR_STORE_ID) {
      // încearcă File Search; dacă pică, cade în fallback automat
      try { answer = await askWithFileSearch({ question, lang }); }
      catch (e) {
        console.error("FileSearch fallback:", e.message);
        answer = await askWithoutFiles({ question, lang });
      }
    } else {
      answer = await askWithoutFiles({ question, lang });
    }

    res.status(200).json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
