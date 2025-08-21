// /api/csv.js — Minimal CSV download endpoint for Vercel (Node runtime, ESM)

function getQueryValue(req, key) {
  const q1 = req?.query?.[key];
  if (q1) return String(q1);
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get(key) || '';
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  try {
    const rawName = getQueryValue(req, 'name') || 'ctrl.csv';
    const b64 = getQueryValue(req, 'data') || '';
    if (!b64) {
      res.status(400).send('Missing data');
      return;
    }
    const fixed = b64.replace(/ /g, '+'); // protect '+' lost as spaces
    const csv = Buffer.from(fixed, 'base64').toString('utf8');
    const name = rawName.replace(/[^A-Za-z0-9._-]/g, '_');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.status(200).send(csv);
  } catch (e) {
    console.error('CSV error', e);
    res.status(500).send('Error generating file');
  }
}
