// /api/pdf.js  (temporary echo to debug payload decoding)
export default async function handler(req, res) {
  try {
    const b64 = String(req.query.data || '');
    if (!b64) {
      res.status(400).send('Missing data');
      return;
    }

    // Try to base64-decode & JSON-parse
    let parsed;
    try {
      const buf = Buffer.from(b64, 'base64');
      parsed = JSON.parse(buf.toString('utf8'));
    } catch {
      res.status(400).send('Invalid data');
      return;
    }

    // If we got here, decoding works — echo useful info
    res.status(200).json({
      ok: true,
      keys: Object.keys(parsed),
      sample: parsed,
    });
  } catch (e) {
    res.status(500).send('Error (echo): ' + e.message);
  }
}
