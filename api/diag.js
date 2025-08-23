// /api/diag.js
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, runtime: 'nodejs' }));
}
