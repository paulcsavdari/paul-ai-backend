// api/ingest.js — upload text în Qdrant (protejat cu ADMIN_TOKEN)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const COL_CANON = process.env.QDRANT_COLLECTION_CANON || 'paul_canon';
const COL_MAIN  = process.env.QDRANT_COLLECTION_MAINSTREAM || 'paul_mainstream';

function send(res, code, obj){ res.status(code).setHeader('Content-Type','application/json'); res.end(JSON.stringify(obj)); }
function cors(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,x-admin-token'); }

async function embed(text){
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${OPENAI_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'text-embedding-3-small', input:text })
  });
  if(!r.ok) throw new Error('embed failed');
  const j=await r.json(); return j.data[0].embedding;
}
async function ensureCollection(name){
  await fetch(`${QDRANT_URL}/collections/${name}`, {
    method:'PUT',
    headers:{ 'Content-Type':'application/json','api-key':QDRANT_API_KEY },
    body: JSON.stringify({ vectors:{ size:1536, distance:'Cosine' } })
  }); // idempotent
}
function chunk(text, size=1100, overlap=220){
  const out=[]; for(let i=0;i<text.length;i+=(size-overlap)){ out.push(text.slice(i, i+size)); }
  return out;
}

module.exports = async (req, res) => {
  cors(res);
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return send(res,405,{error:'Method not allowed'});

  if(!ADMIN_TOKEN) return send(res,500,{error:'Missing ADMIN_TOKEN'});
  if(req.headers['x-admin-token'] !== ADMIN_TOKEN) return send(res,401,{error:'Unauthorized'});

  if(!OPENAI_API_KEY || !QDRANT_URL || !QDRANT_API_KEY) return send(res,500,{error:'Missing OpenAI/Qdrant envs'});

  let raw=''; await new Promise(r=>{ req.on('data',c=>raw+=c); req.on('end',r); });
  let body={}; try{ body=JSON.parse(raw||'{}'); }catch(_){}
  const collection = (body.collection==='main') ? COL_MAIN : COL_CANON;
  const title   = String(body.title||'').trim();
  const section = String(body.section||'').trim();
  const lang    = (body.lang||'ro').slice(0,2);
  const text    = String(body.text||'').trim();
  if(!text) return send(res,400,{error:'No text provided'});

  await ensureCollection(collection);
  const parts = chunk(text);
  const points = [];
  for(let i=0;i<parts.length;i++){
    const v = await embed(parts[i]);
    points.push({ id: Date.now()+i, vector:v, payload:{ title, section, lang, text: parts[i] }});
  }
  const r = await fetch(`${QDRANT_URL}/collections/${collection}/points?wait=true`, {
    method:'PUT', headers:{ 'Content-Type':'application/json','api-key':QDRANT_API_KEY },
    body: JSON.stringify({ points })
  });
  if(!r.ok){ const t = await r.text(); return send(res,500,{error:'Qdrant upsert failed', detail:t}); }
  return send(res,200,{ ok:true, added: points.length, collection });
};
