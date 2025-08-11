// Vercel Serverless Function – demo "brain"
module.exports = async (req, res) => {
  // CORS larg pentru test; îl restrângem după
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let raw = ''; await new Promise(r => { req.on('data', c => raw+=c); req.on('end', r); });
  let body = {}; try { body = JSON.parse(raw||'{}'); } catch(e){}
  const q = (body && body.question) ? String(body.question) : '';

  return res.status(200).json({
    answer: 'Demo live: am primit întrebarea "'+ q +'". În varianta finală voi răspunde din corpus (Canon › articole › cărți) și voi cita sursa.'
  });
};
