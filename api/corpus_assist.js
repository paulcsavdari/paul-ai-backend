// api/corpus_assist.js — EXCLUSIV din corpus folosind Assistants API + File Search (vector store)
// Fără RO/EN/SV, fără mainstream. Dacă nu există context: o propoziție scurtă în limba întrebării.
// ENV necesare în Vercel (Production): OPENAI_API_KEY, VECTOR_STORE_ID (vs_...)
// Model: gpt-4o (stabil cu file_search în Assistants)

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
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

function buildInstructions(userLang){
  const langLine = userLang==="auto"
    ? "Always answer in the language of the user's last message."
    : `Always answer in ${userLang}.`;
  return (
    `${langLine}\n` +
    "Answer ONLY using the retrieved context from file_search (the author's corpus). " +
    "Do NOT use general knowledge and do NOT add alternative views.\n" +
    "If no context is retrieved, reply with ONE short sentence in the user's language meaning: " +
    "'No relevant context in the author's corpus for this question.'\n" +
    "When context exists: paraphrase clearly (no quotes, no file names). " +
    "At the very end, add a line 'Surse:' followed by up to 3 titles visible in the snippets (lines starting with 'TITLE:'). " +
    "If there are no titles, omit the 'Surse:' line.\n"
  );
}

async function askWithAssistants({ question, lang }){
  if(!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  if(!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
  };

  const userLang = pickLang(lang);

  // 1) Creăm un Assistant cu file_search și vector store atașat (tool_resources)
  const aRes = await fetch("https://api.openai.com/v1/assistants", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "paul-corpus-assistant-ephemeral",
      model: MODEL,
      instructions: buildInstructions(userLang),
      tools: [{ type: "file_search" }],
      tool_resources: { file_search: { vector_store_ids: [VECTOR_STORE_ID] } },
      temperature: 0.2
    })
  });
  if(!aRes.ok){
    throw new Error(`Assistant create error ${aRes.status}: ${await aRes.text()}`);
  }
  const assistant = await aRes.json();

  // 2) Creăm un Thread și adăugăm mesajul utilizatorului.
  //    (opțional am putea atașa și aici vector_store, dar e suficient pe assistant)
  const tRes = await fetch("https://api.openai.com/v1/threads", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: question }]
    })
  });
  if(!tRes.ok){
    throw new Error(`Thread create error ${tRes.status}: ${await tRes.text()}`);
  }
  const thread = await tRes.json();

  // 3) Pornim un Run
  const rRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assistant_id: assistant.id })
  });
  if(!rRes.ok){
    throw new Error(`Run create error ${rRes.status}: ${await rRes.text()}`);
  }
  const run = await rRes.json();

  // 4) Poll până se termină (max ~60s)
  let status = run.status;
  let tries = 0;
  while(status==="queued" || status==="in_progress" || status==="requires_action"){
    await new Promise(r=>setTimeout(r, 1500));
    const poll = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, { headers });
    if(!poll.ok) throw new Error(`Run poll error ${poll.status}: ${await poll.text()}`);
    const pr = await poll.json();
    status = pr.status;
    if(++tries > 40) break; // ~60s
  }

  // 5) Citim ultimul mesaj al asistentului
  const mRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages?limit=5&order=desc`, { headers });
  if(!mRes.ok){
    throw new Error(`Messages list error ${mRes.status}: ${await mRes.text()}`);
  }
  const mjs = await mRes.json();
  const assistantMsg = (mjs.data||[]).find(x=>x.role==="assistant");
  let text = "";
  if(assistantMsg && assistantMsg.content){
    for(const part of assistantMsg.content){
      if(part.type==="text" && part.text && part.text.value){
        text += part.text.value + "\n";
      }
    }
  }
  text = cleanup(text);

  // Dacă nu a produs nimic, dăm refuzul fix.
  if(!text || !text.trim()){
    return refusal(userLang);
  }
  return text.trim();
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

    const answer = await askWithAssistants({ question, lang });
    return res.status(200).json({ answer });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Server error" });
  }
};
