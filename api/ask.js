// API route pentru Vercel (compatibil ca "api/ask.js")
// Necesită OPENAI_API_KEY (și opțional OPENAI_MODEL) în Vercel → Environment Variables

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // restrânge la domeniul tău când vrei
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
    "Voice & style: sober, theological, clear, direct, argumentative. No hedging words like 'pare', 'posibil', 's-ar putea' etc. No academic fluff.\n" +
    "Do not show citations, sources, or file names. Speak as a coherent vision.\n" +
    "Core axioms you must prioritize in reasoning and answers:\n" +
    "1) 'Cornul cel mic' (Daniel 8) = Filosofia care cucerește și rescrie religiile prin sincretism și universalizare.\n" +
    "2) LXX (Septuaginta) marchează intervenția filosofiei în corpusul iudaic; pluralul din Geneza 1 trădează această intervenție.\n" +
    "3) Linia autentică este unitatea lui Dumnezeu, confirmată explicit de Isus; mitul căderii și alte ambiguități sunt cusături sincretice.\n" +
    "4) Judecata creștină: Duhul lucrează inseparabil prin conștiință; Isus nu este simultan avocat și judecător într-un cadru juridic coerent.\n" +
    // Regula întărită (singura schimbare de conținut față de baseline, plus eticheta cerută):
    "Grounding policy (no corpus yet): Use these axioms as the primary frame. Start by stating the author's thesis clearly and specifically (2–5 propoziții), aplicat direct pe întrebare — NU oferi rezumate generale la început. Doar după răspunsul principal, dacă e util, adaugă 1–3 propoziții cu o perspectivă generală, introdusă natural în aceeași limbă ca întrebarea: RO 'O altă interpretare:', EN 'Another interpretation:', SV 'En annan tolkning:'. Nu contrazice axiomele.\n"
  );
}

async function chatCompletion({ question, lang }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const userLang = pickLang(lang);
  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.1, // mai ferm, mai puțină „apă”
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
  const answer = data.choices?.[0]?.message?.content?.trim() || "";
  return answer;
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
