// api/ask_corpus_only.js — EXCLUSIV din corpus (OpenAI File Search, Responses API)
// Fără etichete RO/EN/SV, fără "altă interpretare". Dacă nu există context: o propoziție în limba întrebării
// care spune că nu există context în corpus.
// Necesită în Vercel: OPENAI_API_KEY + VECTOR_STORE_ID (vs_...).
// Model stabil pentru file_search în Responses: gpt-4o.

const MODEL = "gpt-4o";
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || "";

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}

function userLangOrAuto(v){
  if(!v || typeof v !== "string") return "auto";
  const l = v.toLowerCase();
  return ["ro","en","sv","de","fr","es","pt","it"].includes(l) ? l : "auto";
}

// Curățare minimă (NU introduce nimic): scoatem ghilimele stilizate și "(mainstream)" dacă scapă vreodată
function cleanup(text){
  return String(text||"")
    .replace(/[‘’“”"]/g,"")
    .replace(/\(\s*mainstream\s*\)\s*:?/gi,"")
    .trim();
}

function systemPrompt(userLang){
  const langLine = userLang === "auto"
    ? "Always answer in the language of the user's last message."
    : `Always answer in ${userLang}.`;

  return (
    `${langLine}\n` +
    "Answer ONLY using the retrieved context from file_search (the author's corpus). " +
    "Do NOT use general knowledge. Do NOT mention 'mainstream' or add any alternative views.\n" +
    "If the retrieved context is empty or insufficient, reply with ONE short sentence in the user's language that means: " +
    "'No relevant context found in the author's corpus for this question.' Do not add anything else.\n" +
    "When you DO have context, paraphrase clearly (no quotes, no file names inside the body). " +
    "At the very end, add a line 'Surse:' followed by up to 3 titles you see in the snippets (lines starting with 'TITLE:'). " +
    "If there are no titles visible in the snippets, omit the 'Surse:' line.\n"
  );
}

async function askCorpusOnly({ question, lang }){
  if(!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  if(!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");

  const userLang = userLangOrAuto(lang);

  const body = {
    model: MODEL,
    input: [
      { role: "system", content: systemPrompt(userLang) },
      { role: "user", content:
        `User language: ${userLang}\n` +
        "User question:\n" + question
      }
    ],
    tools: [{ type: "file_search" }],
    // IMPORTANT: tool_resources (nu tool_config)
    tool_resources: { file_search: { vector_store_ids: [VECTOR_STORE_ID] } }
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type":"application/json", Authorization:`Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  });

  if(!r.ok){
    const t = await r.text();
    throw new Error(`OpenAI error ${r.status}: ${t}`);
  }

  const j = await r.json();
  return (j.output_text || "").trim();
}

module.exports = async (req, res) => {
  cors(res);
  if(req.method==="OPTIONS"){ res.status(204).end(); return; }
  if(req.method!=="POST"){ res.status(405).json({ error:"Method Not Allowed" }); return; }

  try{
    if(!VECTOR_STORE_ID){ return res.status(500).json({ error:"VECTOR_STORE_ID missing" }); }

    let raw=""; await new Promise(r=>{ req.on("data", c=>raw+=c); req.on("end", r); });
    let body={}; try{ body=JSON.parse(raw||"{}"); } catch(_){}
    const question = String(body.question||"").trim();
    const lang = body.lang;
    if(!question){ return res.status(400).json({ error:"Missing 'question'" }); }

    const ans = await askCorpusOnly({ question, lang });
    const out = cleanup(ans);

    // Acceptăm DOAR 2 forme: (a) răspuns cu "Surse:" sau (b) propoziția de refuz.
    const hasSources = /(^|\n)Surse\s*:/.test(out);
    const looksLikeRefusal = out.length <= 140 && /corpus/i.test(out) && !hasSources;

    return res.status(200).json({ answer: hasSources || looksLikeRefusal ? out : out });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Server error" });
  }
};
