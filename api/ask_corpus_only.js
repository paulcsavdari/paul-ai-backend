// api/ask_corpus_only.js — RĂSPUNDE EXCLUSIV DIN CORPUS (OpenAI File Search)
// FIX: folosim `tool_resources` (nu `tool_config`).
// Necesită în Vercel: OPENAI_API_KEY + VECTOR_STORE_ID (vs_...)

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || "";

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}
function pickLang(lang){
  if(!lang || typeof lang!=="string") return "ro";
  const L = lang.toLowerCase();
  return ["ro","en","sv","de","fr","es","pt","it"].includes(L) ? L : "ro";
}
function refusal(lang){
  if(lang==="en") return "NO CORPUS CONTEXT FOR THIS QUESTION.";
  if(lang==="sv") return "INGET KORPUSUNDERLAG FÖR DENNA FRÅGA.";
  return "NU AM CONTEXT ÎN CORPUS PENTRU ACEASTĂ ÎNTREBARE.";
}
function systemPrompt(lang){
  const label = lang==="ro" ? "O altă interpretare:" : (lang==="sv" ? "En annan tolkning:" : "Another interpretation:");
  return (
    "Answer ONLY using the retrieved context from file_search (the author's corpus). " +
    "If the retrieved context is empty or insufficient, DO NOT answer from general knowledge. " +
    "Instead, reply EXACTLY with the fixed message in the user's language (see below).\n\n" +
    "Rules:\n" +
    "1) Use corpus context first; paraphrase cleanly; no quotes, no file names in the body.\n" +
    "2) At the very end, add a line 'Surse:' followed by up to 3 titles you see in the context (look for lines starting with 'TITLE:' inside the snippets). If none, omit this line.\n" +
    "3) Do NOT write language codes like RO/EN/SV and do NOT print parentheses like (mainstream).\n" +
    `4) Never add a general view unless it is explicitly present in the retrieved context. Do not invent '${label}'.\n` +
    "5) If context is missing, return ONLY the fixed message—no extra words.\n"
  );
}

// --- Responses API + file_search (cu tool_resources)
async function askCorpusOnly({ question, lang }){
  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error("Missing OPENAI_API_KEY");
  if(!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");

  const body = {
    model: MODEL,
    input: [
      { role: "system", content: systemPrompt(lang) },
      { role: "user", content:
        `Language: ${lang}\n` +
        `FixedRefusal(when no context): ${refusal(lang)}\n\n` +
        `User question: ${question}`
      }
    ],
    tools: [{ type: "file_search" }],
    tool_resources: { file_search: { vector_store_ids: [VECTOR_STORE_ID] } }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });

  if(!resp.ok){
    const t = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return (data.output_text || "").trim();
}

// — curățare de siguranță
function cleanup(a){
  return String(a||"")
    .replace(/\bRO\s*[:\-]?\s*/gi,"")
    .replace(/\bEN\s*[:\-]?\s*/gi,"")
    .replace(/\bSV\s*[:\-]?\s*/gi,"")
    .replace(/\(\s*mainstream\s*\)\s*:?/gi,"")
    .trim();
}

module.exports = async (req,res)=>{
  cors(res);
  if(req.method==="OPTIONS"){ res.status(204).end(); return; }
  if(req.method!=="POST"){ res.status(405).json({error:"Method Not Allowed"}); return; }

  try{
    if(!VECTOR_STORE_ID) { res.status(500).json({error:"VECTOR_STORE_ID missing"}); return; }

    let raw=""; await new Promise(r=>{ req.on("data", c=>raw+=c); req.on("end", r); });
    let body={}; try{ body=JSON.parse(raw||"{}"); } catch(_){}
    const question = String(body.question||"").trim();
    const lang = pickLang(body.lang);
    if(!question){ res.status(400).json({error:"Missing 'question'"}); return; }

    const ans = await askCorpusOnly({ question, lang });
    const out = cleanup(ans);

    const hasRefusal = out.toUpperCase().includes(refusal(lang));
    const hasSources = /(^|\n)Surse\s*:/.test(out);
    if(!hasRefusal && !hasSources){
      return res.status(200).json({ answer: refusal(lang) });
    }

    res.status(200).json({ answer: out });
  }catch(err){
    console.error(err);
    res.status(500).json({ error:"Server error" });
  }
};
