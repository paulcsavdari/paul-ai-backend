// api/ask_fs.js — răspunsuri din vector store (OpenAI File Search)
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;

function cors(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type"); }
function pickLang(lang){ if(!lang||typeof lang!=="string") return "auto"; const L=lang.toLowerCase(); return ["ro","en","sv","de","fr","es","pt","it"].includes(L)?L:"auto"; }

function systemPrompt(userLang){
  const langLine = userLang==="auto" ? "Always answer in the language of the user's last message." : `Always answer in ${userLang}.`;
  return (
    `${langLine}\n` +
    "You are 'Theological Assistant' for paulcsavdari.info.\n" +
    "Voice & style: sober, theological, clear, direct, argumentative. No hedging.\n" +
    "Do not show citations, sources, or file names. Speak as a coherent vision.\n" +
    "Core axioms to prioritize:\n" +
    "1) 'Cornul cel mic' (Daniel 8) = philosophy that conquers and rewrites religions via syncretism/universalization.\n" +
    "2) LXX marks philosophical intervention; plural in Genesis 1 betrays it.\n" +
    "3) Authentic line: God's unity confirmed by Jesus; 'fall' etc. are later syncretic seams.\n" +
    "4) Judgment: the Spirit works through conscience; Jesus is not both advocate and judge in a coherent legal frame.\n" +
    "When the store provides relevant context, base your answer on it (paraphrase, no quotes). " +
    "If a brief general view is useful, append at the end with a simple lead-in in the same language: RO 'O altă interpretare:', EN 'Another interpretation:', SV 'En annan tolkning:'. Keep it to 1–3 sentences.\n"
  );
}

async function askOpenAI({ question, lang }){
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  if (!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");

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

  if (!resp.ok) { const text = await resp.text(); throw new Error(`OpenAI error ${resp.status}: ${text}`); }
  const data = await resp.json();
  const answer = (data.output_text || "").trim();
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

    const answer = await askOpenAI({ question, lang });
    res.status(200).json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
