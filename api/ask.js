// api/ask.js — backend fără corpus, limbă automată, mainstream etichetat natural
// Necesită: OPENAI_API_KEY (și opțional OPENAI_MODEL) în Vercel → Environment Variables

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // poți restrânge la domeniul tău
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function pickLang(lang) {
  if (!lang || typeof lang !== "string") return "auto";
  const L = lang.toLowerCase();
  return ["ro", "en", "sv", "de", "fr", "es", "pt", "it"].includes(L) ? L : "auto";
}

function mainstreamLabel(lang) {
  switch (lang) {
    case "ro": return "O altă interpretare:";
    case "sv": return "En annan tolkning:";
    case "de": return "Eine andere Deutung:";
    case "fr": return "Une autre interprétation :";
    case "es": return "Otra interpretación:";
    case "pt": return "Outra interpretação:";
    case "it": return "Un'altra interpretazione:";
    case "en": default: return "Another interpretation:";
  }
}

function systemPrompt(userLang) {
  const langLine =
    userLang === "auto"
      ? "Always answer in the language of the user's last message. Keep the entire reply in that language."
      : `Always answer in ${userLang}. Keep the entire reply in that language.`;

  // Instrucțiuni privind vocea și axiomele
  const voice = (
    "You are 'Theological Assistant' for paulcsavdari.info.\n" +
    "Voice & style: sober, theological, clear, direct, argumentative. No hedging (no 'pare', 'posibil', 's-ar putea', etc.). No academic fluff.\n" +
    "Do not show citations, sources, or file names. Speak as a coherent vision.\n"
  );

  const axioms = (
    "Core axioms to prioritize:\n" +
    "1) 'Cornul cel mic' (Daniel 8) = the philosophical force that conquers and rewrites religions via syncretism and universalization.\n" +
    "2) LXX (Septuaginta) marks the intervention of philosophy in the Jewish corpus; the plural in Genesis 1 betrays this intervention.\n" +
    "3) The authentic line is God's unity confirmed explicitly by Jesus; myths like the 'fall' are later syncretic seams.\n" +
    "4) Christian judgment: the Spirit works inseparably through conscience; Jesus is not simultaneously advocate and judge in a coherent legal frame.\n"
  );

  const mainstreamRule = (
    "Grounding policy (no corpus yet): Use these axioms as the primary frame. " +
    "If you add a short mainstream context (max 1–3 sentences), append it after the main answer using a neutral, localized lead-in. " +
    "Examples of the lead-in per language: RO 'O altă interpretare:', EN 'Another interpretation:', SV 'En annan tolkning:', DE 'Eine andere Deutung:', FR 'Une autre interprétation :', ES 'Otra interpretación:', PT 'Outra interpretação:', IT 'Un'altra interpretazione:'. " +
    "Never use labels like 'For context (mainstream):', and never mix languages in the same reply. Never contradict the axioms.\n"
  );

  return `${langLine}\n${voice}${axioms}${mainstreamRule}`;
}

async function chatCompletion({ question, lang }) {
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
  let answer = data.choices?.[0]?.message?.content?.trim() || "";
  return postProcess(answer, userLang);
}

function postProcess(text, userLang) {
  const lang = userLang === "auto" ? "en" : userLang;
  const label = mainstreamLabel(lang);
  const patterns = [
    /\bPentru context(?:ul)?(?: \(mainstream\))?:/gi,
    /\bFor context(?: \(mainstream\))?:/gi,
    /\bMainstream(?: view)?:/gi,
    /\bInterpretarea curent[ăa]:/gi,
    /\bVanlig tolkning:/gi,
    /\bViziunea majoritar[ăa]:/gi
  ];
  let out = text;
  for (const p of patterns) out = out.replace(p, label + " ");
  return out.replace(/\s{2,}/g, " ");
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method Not Allowed" }); return; }

  try {
    let raw = ""; await new Promise(r => { req.on('data', c => raw += c); req.on('end', r); });
    let body = {}; try { body = JSON.parse(raw || '{}'); } catch (_) {}
    const question = String(body.question || '').trim();
    const lang = body.lang;
    if (!question) { res.status(400).json({ error: "Missing 'question'" }); return; }

    const answer = await chatCompletion({ question, lang });
    res.status(200).json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
