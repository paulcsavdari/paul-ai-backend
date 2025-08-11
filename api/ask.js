// api/ask.js — RAG + router "sensibil vs. neutru", multilingv (Qdrant API Key sau JWT)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COL_CANON = process.env.QDRANT_COLLECTION_CANON || 'paul_canon';
const COL_MAIN  = process.env.QDRANT_COLLECTION_MAINSTREAM || 'paul_mainstream';

const SENSITIVE = [
  'cornul cel mic','daniel 8','2300 seri','2300 seri și dimineți','curățirea sanctuarului',
  'septuaginta','lxx','antioh','antioh epifanes','filosofia greacă','rămășița','1260','vremea sfârșitului',
  'little horn','daniel 8','2300 evenings','2300 mornings','cleansing of the sanctuary',
  'septuagint','lxx','antiochus','greek philosophy','remnant','time of the end'
];

function send(res, code, obj){ res.status(code).setHeader('Content-Type','application/json'); res.end(JSON.stringify(obj)); }
function cors(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); }
function isSensitive(q){ const s=(q||'').toLowerCase(); return SENSITIVE.some(k=>s.includes(k.toLowerCase())); }

// ——— Qdrant headers: acceptă fie API Key, fie JWT (Bearer)
function qdrantHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (QDRANT_API_KEY?.startsWith('eyJ')) h['Authorization'] = `Bearer ${QDRANT_API_KEY}`; // JWT
  else if (QDRANT_API_KEY) h['api-key'] = QDRANT_API_KEY; // API key clasic
  return h;
}

async function embed(text){
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${OPENAI_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'text-embedding-3-small', input:text })
  });
  if(!r.ok) throw new Error('embedding failed'); const j=await r.json(); return j.data[0].embedding;
}

async function chat(messages){
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${OPENAI_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.2, messages })
  });
  if(!r.ok) throw new Error('chat failed'); const j=await r.json(); return j.choices?.[0]?.message?.content || '';
}

async function qsearch(collection, vector, topK=6, threshold=0.76){
  try{
    const r = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
      method:'POST',
      headers: qdrantHeaders(),
      body: JSON.stringify({ vector, limit: topK, with_payload:true, score_threshold: threshold })
    });
    if(!r.ok) return [];
    const j = await r.json();
    return (j.result||[]).map(p=>({
      score: p.score,
      text: p.payload?.text || '',
      title: p.payload?.title || '',
      section: p.payload?.section || '',
      lang: p.payload?.lang || 'ro'
    }));
  }catch(_){ return []; }
}

function buildPrompt({userQ, lang, sensitive, canonCtx, mainCtx}){
  const bullets = a => a.map(c=>`- [${c.title}${c.section?(' › '+c.section):''}] ${c.text}`).join('\n');
  const system = [
    'You are the author’s theological assistant.',
    'Always reply in the SAME LANGUAGE as the user question.',
    'When quoting the author, include citations as: Title › Section.',
    'If topic is SENSITIVE, prioritise the author’s position; mention mainstream briefly.',
    'If NOT sensitive, give a general overview; if any author corpus is relevant, add a short note with citations.',
    'Never invent sources.'
  ].join('\n');

  const ctxHeader = sensitive
    ? 'SENSITIVE topic. Use ONLY the author corpus below (add mainstream only as brief contrast).'
    : 'NON-sensitive topic. You may include general info. If corpus snippets exist, summarise briefly with citations.';

  const ctx = [
    ctxHeader,
    canonCtx?.length ? '\nAuthor corpus:\n'+bullets(canonCtx) : '',
    (!sensitive && mainCtx?.length) ? '\nMainstream context (optional):\n'+bullets(mainCtx) : ''
  ].join('\n');

  return [
    { role:'system', content: system },
    { role:'user', content: `Question: ${userQ}\n\nContext:\n${ctx}\n\nRespond in ${lang || 'the user language'}.` }
  ];
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return send(res,405,{error:'Method not allowed'});
  if (!OPENAI_API_KEY || !QDRANT_URL || !QDRANT_API_KEY) return send(res,500,{error:'Missing env vars'});

  try{
    let raw=''; await new Promise(r=>{ req.on('data',c=>raw+=c); req.on('end',r); });
    let body={}; try{ body=JSON.parse(raw||'{}'); }catch(_){}
    const userQ = String(body.question||'').trim();
    const lang  = (body.lang||'en').slice(0,2);
    if(!userQ) return send(res,400,{error:'Missing question'});

    const sensitive = isSensitive(userQ);
    const vec = await embed(userQ);
    const canon = await qsearch(COL_CANON, vec, 6, 0.76);
    const main  = sensitive ? [] : await qsearch(COL_MAIN, vec, 4, 0.8);

    if (sensitive && canon.length===0){
      return send(res,200,{answer: lang==='ro'
        ? 'Subiect sensibil pentru teologia autorului, dar nu există încă material în corpus. Vom adăuga în curând.'
        : 'This is a SENSITIVE topic for the author’s theology, but the corpus has not been added yet.'});
    }

    const messages = buildPrompt({userQ, lang, sensitive, canonCtx:canon, mainCtx:main});
    const answer = await chat(messages);
    return send(res,200,{answer});
  }catch(e){
    console.error(e);
    return send(res,500,{error:'Server error'});
  }
};
