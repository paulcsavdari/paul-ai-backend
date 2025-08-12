// api/corpus.js — RĂSPUNDE EXCLUSIV DIN CORPUS (OpenAI File Search, Responses API)
// Fără RO/EN/SV, fără "altă interpretare". Dacă nu există context: o propoziție scurtă în limba întrebării.
// Necesită în Vercel: OPENAI_API_KEY + VECTOR_STORE_ID (începe cu vs_...)
const MODEL = "gpt-4o"; // model stabil care merge cu file_search
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || "";

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}
function pickLang(v){
  if(!v || typeof v!=="string") return "auto";
  const l=v.toLowerCase();
  return ["ro","en","sv","de","fr","es","pt","it"].includes(l)?l:"auto";
}
function refusal(lang){
  if(lang==="en") return "No relevant context in the author's corpus for this question.";
  if(lang==="sv") return "Inget relevant underlag i författarens korpus för den här frågan.";
  return "Nu există context relevant în corpusul autorului pentru această întrebare.";
}
function cleanup(s){
  return String(s||"")
    .replace(/[“”‘’"]/g,"")
    .replace(/\(\s*mainstream\s*\)\s*:?/gi,"")
    .trim();
}
function systemPrompt(lang){
  const langLine = lang==="auto" ? 
    "Always answer in the language of the user's last message." :
    `Always answer in ${lang}.`;
  return (
    `${langLine}\n` +
    "Answer ONLY using the retrieved context from file_search (the author's corpus). " +
    "Do NOT use general knowledge and do NOT add alternative views. " +
    "If no context is retrieved, reply with ONE short sentence that says there is no relevant context in the corpus. " +
    "When context exists, paraphrase clearly (no quotes, no file names). " +
    "At the very end, add a line 'Surse:' followed by up to 3 titles visible in the snippets (lines starting with 'TITLE:'). " +
    "If there are no titles, omit the 'Surse:' line."
  );
}
async function ask({ question, lang }){
  if(!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  if(!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");

  const userLang = pickLang(lang);
  const body = {
    model: MODEL,
    input: [
      { role: "system", content: systemPrompt(userLang) },
      { role: "user", content: `User language: ${userLang}\nUser question:\n${question}` }
    ],
    tools: [{ type: "file_search" }],
    tool_resources: { file_search: { vector_store_ids: [VECTOR_STORE_ID] } } // ← corect
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

    let raw=""; await new Promise(r=>{ req.on("data",c=>raw+=c); req.on("end", r); });
    let body={}; try{ body=JSON.parse(raw||"{}"); } catch(_){}
    const question = String(body.question||"").trim();
    const lang = body.lang;
    if(!question){ return res.status(400).json({ error:"Missing 'question'" }); }

    const ans = await ask({ question, lang });
    const out = cleanup(ans);

    // Acceptăm atât răspuns cu „Surse:”, cât și fraza scurtă de refuz (în limba utilizatorului).
    const hasSources = /(^|\n)Surse\s*:/.test(out);
    if (hasSources || out.length <= 180 && /corpus/i.test(out)) {
      return res.status(200).json({ answer: out });
    }
    // dacă nu e clar, returnăm răspunsul așa cum e (mai bine vezi conținutul decât un refuz fals-pozitiv)
    return res.status(200).json({ answer: out });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Server error" });
  }
};
