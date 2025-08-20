// Force Node runtime (NOT Edge)
export const config = { runtime: 'nodejs' };

// /api/csv.js — Minimal CSV download endpoint for Vercel (Node runtime)
export default async function handler(req, res) {
  try {
    const name = String(req.query.name || 'ctrl.csv').replace(/[^\w.\-]+/g, '_');
    const b64  = String(req.query.data || '');
    if (!b64) {
      res.status(400).send('Missing data');
      return;
    }
    const csv = Buffer.from(b64, 'base64').toString('utf8');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.status(200).send(csv);
  } catch (e) {
    console.error('CSV error:', e);
    res.status(500).send('Error generating file');
  }
}
