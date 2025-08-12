// api/corpus_v2.js — EXCLUSIV din corpus, Assistants API v2 + File Search
// • Surse cu link-uri clickabile (HTML): <ul><li><a href="URL">Titlu</a></li></ul>
// • Fără "RO/EN/SV", fără mainstream. Curățăm artefactele de tip 
// • Dacă nu există context: o propoziție scurtă în limba întrebării.
// ENV (Production): OPENAI_API_KEY, VECTOR_STORE_ID (vs_...)
// Model: gpt-4o (stabil cu file_search în Assistants v2)

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
// Curățăm ghilimele stilizate + citările de tip 【...†source】
function cleanup(html){
  return String(html||"")
    .replace(/【[^】]*】/g, "")           // elimină note de tip 
    .replace(/[“”‘’"]/g, "")            // ghilimele tipografice
    .trim();
}

// Instrucțiuni: răspuns 250–400 cuvinte când există context + Surse ca HTML <ul><li><a...>
function instructions(userLang){
  const langLine = userLang==="auto"
    ? "Always answer in the language of the user's last message."
    : `Always answer in ${userLang}.`;
  return (
    `${langLine}\n` +
    "Answer ONLY using the retrieved context from file_search (the author's corpus). " +
    "Do NOT use general knowledge and do NOT add alternative views. " +
    "When sufficient context exists, write a clear, structured answer in 2–4 paragraphs (≈250–400 words). " +
    "Summarize the author's line of argument and key reasons.\n" +
    "If no context is retrieved, reply with ONE short sentence in the user's language meaning: " +
    "'No relevant context in the author's corpus for this question.'\n" +
    "At the very end, output a 'Surse:' section as HTML with clickable links, by extracting TITLE: and URL: from the snippets. " +
    "Exact format:\n" +
    "Surse:\n<ul>\n<li><a href='URL1' target='_blank' rel='noopener'>TITLE 1</a></li>\n" +
    "<li><a href='URL2' target='_blank' rel='noopener'>TITLE 2</a></li>\n" +
    "<li><a href='URL3' target='_blank' rel='noopener'>TITLE 3</a></li>\n</ul>\n" +
    "If there are no titles/URLs visible, omit the 'Surse:' section entirely.\n"
  );
}

async function askCorpus({ question, lang }){
  if(!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  if(!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    "OpenAI-Beta": "assistants=v2"
  };
  const userLang = pickLang(lang);

  // 1) Assistant efemer cu file_search + vector store atașat
  const aRes = await fetch("https://api.openai.com/v1/assistants", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "paul-corpus-assistant-ephemeral",
      model: MODEL,
      instructions: instructions(userLang),
      tools: [{ type: "file_search" }],
      tool_resources: { file_search: { vector_store_ids: [VECTOR_STORE_ID] } },
      temperature: 0.2
    })
  });
  if(!aRes.ok) throw new Error(`Assistant create error ${aRes.status}: ${await aRes.text()}`);
  const assistant = await aRes.json();

  // 2) Thread cu mesajul utilizatorului
  const tRes = await fetch("https://api.openai.com/v1/threads", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [{ role: "user", content: question }] })
  });
  if(!tRes.ok) throw new Error(`Thread create error ${tRes.status}: ${await tRes.text()}`);
  const thread = await tRes.json();

  // 3) Run
  const rRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assistant_id: assistant.id })
  });
  if(!rRes.ok) throw new Error(`Run create error ${rRes.status}: ${await rRes.text()}`);
  const run = await rRes.json();

  // 4) Poll până se termină (max ~60s)
  let status = run.status, tries = 0;
  while(status==="queued" || status==="in_progress" || status==="requires_action"){
    await new Promise(r=>setTimeout(r,1500));
    const poll = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, { headers });
    if(!poll.ok) throw new Error(`Run poll error ${poll.status}: ${await poll.text()}`);
    const pr = await poll.json();
    status = pr.status;
    if(++tries > 40) break;
  }

  // 5) Ultimul mesaj al asistentului
  const mRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages?limit=5&order=desc`, { headers });
  if(!mRes.ok) throw new Error(`Messages list error ${mRes.status}: ${await mRes.text()}`);
  const mjs = await mRes.json();
  const assistantMsg = (mjs.data||[]).find(x=>x.role==="assistant");
  let text = "";
  if(assistantMsg && assistantMsg.content){
    for(const part of assistantMsg.content){
      if(part.type==="text" && part.text && part.text.value) text += part.text.value + "\n";
    }
  }
  text = cleanup(text);
  if(!text.trim()) return refusal(userLang);
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

    const answer = await askCorpus({ question, lang });
    return res.status(200).json({ answer });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Server error" });
  }
};
