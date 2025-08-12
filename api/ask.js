// api/ask.js — UNIFICAT (File Search când există VECTOR_STORE_ID; altfel fallback pe "busola")
// Necesită: OPENAI_API_KEY (și VECTOR_STORE_ID în Vercel pentru File Search). Opțional: OPENAI_MODEL.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || ""; // dacă e gol, folosește fallback

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}
function pickLang(lang){
  if(!lang || typeof lang!=="string") return "auto";
  const L = lang.toLowerCase();
  return ["ro","en","sv","de","fr","es","pt","it"].includes(L) ? L : "auto";
}
function systemPrompt(userLang){
  const langLine = userLang==="auto"
    ? "Always answer in the language of the user's last message."
    : `Always answer in ${userLang}.`;

  return (
    `${langLine}\n` +
    "You are 'Theological Assistant' for paulcsavdari.info.\n" +
    "Voice & style: sober, theological, clear, direct, argumentative. No hedging.\n" +
    "Do not show citations, sources, or file names. Speak as a coherent vision.\n" +
    "Core axioms to prioritize in reasoning and answers:\n" +
    "1) 'Cornul cel mic' (Daniel 8) = Filosofia care cucerește și rescrie religiile prin sincretism și universalizare.\n" +
    "2) LXX (Septuaginta) marchează intervenția filosofiei în corpusul iudaic; pluralul din Geneza 1 trădează această intervenție.\n" +
    "3) Linia autentică este unitatea lui Dumnezeu, confirmată explicit de Isus; mitul căderii și alte ambiguități sunt cusături sincretice.\n" +
    "4) Judecata: Duhul lucrează inseparabil prin conștiință; Isus nu este simultan avocat și judecător într-un cadru juridic coerent.\n" +
    "5) Apocalipsa este datată de autor în pre-70, cu scrierea în 63 d.Hr.; această poziție are prioritate față de datarea mainstream (~95 d.Hr.).\n" +
    "Grounding policy: When file store context is available, base the answer primarily on it (paraphrase; do NOT list or quote files). " +
    "Start with the author's thesis applied to the question (2–5 propoziții). Only after the main answer, if useful, append 1–3 sentences with a general view, introduced naturally in the same language: RO 'O altă interpretare:', EN 'Another interpretation:', SV 'En annan tolkning:'. Never contradict the axioms.\n"
  );
}

// — A) File Search (Responses API) — folosit când avem VECTOR_STORE_ID
async function askWithFileSearch({ question, lang }){
  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error("Missing OPENAI_API_KEY");

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

  if(!resp.ok){
    const t = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return (data.output_text || "").trim();
}

// — B) Fallback fără File Search (Chat Completions) — când nu avem VECTOR_STORE_ID sau dacă A) eșuează
async function askWithoutFiles({ question, lang }){
  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const userLang = pickLang(lang);
  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.1, // ferm, puține generalități
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

  if(!resp.ok){
    const t = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

module.exports = async (req, res) => {
  cors(res);
  if(req.method==="OPTIONS"){ res.status(204).end(); return; }
  if(req.method!=="POST"){ res.status(405).json({ error: "Method Not Allowed" }); return; }

  try{
    let raw = ""; await new Promise(r=>{ req.on("data", c=>raw+=c); req.on("end", r); });
    let body = {}; try { body = JSON.parse(raw || "{}"); } catch(_){}
    const question = String(body.question || "").trim();
    const lang = body.lang;
    if(!question){ res.status(400).json({ error: "Missing 'question'" }); return; }

    let answer;
    if (VECTOR_STORE_ID) {
      // încearcă din textele tale; dacă e vreo problemă, cade pe varianta veche
      try {
        answer = await askWithFileSearch({ question, lang });
      } catch (e) {
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
