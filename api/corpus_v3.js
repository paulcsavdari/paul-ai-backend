// api/corpus_v3.js — EXCLUSIV din corpus, Assistants API v2 + File Search, cu REFERINȚE CLICKABILE
// • Răspuns scurt (5–8 fraze), fără mainstream, fără RO/EN/SV.
// • Sursele sunt construite programatic din citațiile Assistants (file_citation) -> link-uri utile.
// ENV (Production): OPENAI_API_KEY, VECTOR_STORE_ID (vs_...)
// Model: gpt-4o (stabil pentru file_search în Assistants v2)

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
function cleanupText(s){
  return String(s||"")
    .replace(/【[^】]*】/g, "")   // artefacte tip 
    .replace(/[“”‘’"]/g, "")    // ghilimele tipografice
    .replace(/\(\s*mainstream\s*\)\s*:?/gi,"")
    .trim();
}
function humanTitleFromURL(url){
  try{
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean);
    const last = seg[seg.length-1] || u.hostname;
    return decodeURIComponent(last).replace(/[-_]+/g, " ").replace(/\b\w/g, c=>c.toUpperCase());
  }catch(_){ return url; }
}
function filenameToURL(name){
  // ex: https_paulcsavdari_info_daniel_apocalipsa_ro_exilul_insula_patmos.txt
  if(!name) return null;
  let n = name.replace(/\.txt$/i,"").replace(/\.md$/i,"").replace(/\.html?$/i,"");
  if(n.startsWith("https_")) n = "https://" + n.slice(6).replace(/_/g,"/");
  else if(n.startsWith("http_")) n = "http://" + n.slice(5).replace(/_/g,"/");
  else return null;
  return n;
}
function buildInstructions(userLang){
  const langLine = userLang==="auto"
    ? "Always answer in the language of the user's last message."
    : `Always answer in ${userLang}.`;
  return (
    `${langLine}\n` +
    "Answer ONLY using the retrieved context from file_search (the author's corpus). " +
    "Do NOT use general knowledge and do NOT add alternative views. " +
    "Write a clear answer in 5–8 sentences. No quotes, no file names, no labels.\n" +
    "If no context is retrieved, reply with ONE short sentence meaning the corpus has no relevant context."
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
      instructions: buildInstructions(userLang),
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

  // 5) Ultimul mesaj + strângem citațiile (file_citation) pentru surse
  const mRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages?limit=10&order=desc`, { headers });
  if(!mRes.ok) throw new Error(`Messages list error ${mRes.status}: ${await mRes.text()}`);
  const mjs = await mRes.json();

  const assistantMsg = (mjs.data||[]).find(x=>x.role==="assistant");
  let bodyText = "";
  const citedFileIds = new Set();

  if(assistantMsg && assistantMsg.content){
    for(const part of assistantMsg.content){
      if(part.type==="text" && part.text && part.text.value){
        bodyText += part.text.value + "\n";
        const anns = part.text.annotations || [];
        for(const ann of anns){
          if(ann.type==="file_citation" && ann.file_citation && ann.file_citation.file_id){
            citedFileIds.add(ann.file_citation.file_id);
          }
        }
      }
    }
  }
  bodyText = cleanupText(bodyText).trim();
  if(!bodyText) return refusal(userLang);

  // 6) Transformăm citațiile în link-uri
  const headersFiles = {
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    "OpenAI-Beta": "assistants=v2"
  };
  const sources = [];
  for(const fid of Array.from(citedFileIds).slice(0,3)){
    try{
      const fRes = await fetch(`https://api.openai.com/v1/files/${fid}`, { headers: headersFiles });
      if(!fRes.ok) continue;
      const f = await fRes.json();
      const meta = f.metadata || {};
      const url = meta.url || meta.source_url || filenameToURL(f.filename);
      if(!url) continue;
      const title = meta.title || humanTitleFromURL(url);
      sources.push({ title, url });
    }catch(_){}
  }

  // 7) Combinăm răspuns + „Surse” (HTML) doar dacă avem linkuri
  let out = bodyText;
  if(sources.length){
    out += "\n\nSurse:\n<ul>\n" + sources.map(s => 
      `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></li>`
    ).join("\n") + "\n</ul>";
  }
  return out.trim();
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
