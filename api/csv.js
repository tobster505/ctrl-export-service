// api/csv.js — Vercel Serverless Function (CommonJS)
// Accepts ?name=<filename.csv>&data=<base64 csv>

module.exports = async (req, res) => {
  try {
    const name = (req.query.name || 'data.csv').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const b64 = req.query.data;
    if (!b64) return res.status(400).json({ error: 'missing data' });

    const csv = Buffer.from(decodeURIComponent(b64), 'base64').toString('utf8');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.status(200).send(csv);
  } catch (e) {
    res.status(500).json({ error: 'failed to build csv', detail: String(e) });
  }
};
