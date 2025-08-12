// api/ask.js — răspunsuri prioritare din corpus (File Search). Fără axiome.
// Dacă există VECTOR_STORE_ID -> folosește File Search (din textele tale).
// Dacă nu -> fallback simplu, fără „teologia altora”. Endpointul rămâne /api/ask.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || "";

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

function systemPrompt(userLang, hasFiles){
  const langLine = userLang==="auto"
    ? "Always answer in the language of the user's last message."
    : `Always answer in ${userLang}.`;
  const voice =
    "You are 'Theological Assistant' for paulcsavdari.info.\n" +
    "Voice & style: sober, theological, clear, direct. No hedging. No academic fluff.\n" +
    "Do NOT show citations, file names or links publicly. Paraphrase cleanly.\n";

  if (hasFiles) {
    return (
      `${langLine}\n${voice}` +
      "Base your answer PRIMARILY on the context retrieved via file_search (author's corpus). " +
      "If the retrieved context gives a clear position, answer from it directly, applied to the user's question. " +
      "Only if the retrieved context is insufficient, you MAY append at the end a very short general note (max 1–3 sentences), " +
      "introduced naturally in the same language: RO 'O altă interpretare:', EN 'Another interpretation:', SV 'En annan tolkning:'.\n" +
      "Never invent sources. If you really lack context, keep the answer concise and say that more corpus is needed on this exact topic."
    );
  } else {
    return (
      `${langLine}\n${voice}` +
      "The author's corpus is not available here. Give a concise, neutral answer to the user's question. " +
      "Do NOT pretend to represent the author's specific positions without corpus. " +
      "If useful, you MAY add at the end 1–3 short sentences with a general view, introduced as: RO 'O altă interpretare:', EN 'Another interpretation:', SV 'En annan tolkning:'."
    );
  }
}

// — A) File Search (Responses API)
async function askWithFileSearch({ question, lang }){
  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const userLang = pickLang(lang);
  const body = {
    model: DEFAULT_MODEL,
    input: [
      { role: "system", content: systemPrompt(userLang, true) },
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

// — B) Fallback fără File Search (Chat Completions)
async function askWithoutFiles({ question, lang }){
  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const userLang = pickLang(lang);
  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt(userLang, false) },
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
    let raw=""; await new Promise(r=>{ req.on("data", c=>raw+=c); req.on("end", r); });
    let body={}; try{ body=JSON.parse(raw||"{}"); } catch(_){}
    const question = String(body.question || "").trim();
    const lang = body.lang;
    if(!question){ res.status(400).json({ error: "Missing 'question'" }); return; }

    let answer;
    if (VECTOR_STORE_ID) {
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
