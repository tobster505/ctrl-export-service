// api/pdf.js  — Vercel Serverless Function (CommonJS)
// Robustly reads ?data=<base64 json>, renders a simple PDF.
// Handles both old "overview" payloads and the new intro/headline/how/journey/themesExplainer/raw layout.
// Strips/normalizes characters PDFKit can’t encode by default.

const PDFDocument = require('pdfkit');

function sanitize(s) {
  // Replace characters that the default PDFKit font can’t encode.
  // You can swap this for a Unicode font if you prefer, but this keeps it simple/stable on serverless.
  const map = {
    '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'",
    '→': '->', '…': '...', ' ': ' ', ' ': ' '
  };
  return String(s || '').replace(/[^\x00-\x7F]/g, (c) => map[c] || ' ');
}

function safeText(doc, s, opts) {
  doc.text(sanitize(s), opts || {});
}

module.exports = async (req, res) => {
  try {
    // Accept both GET ?data= and POST body.data for flexibility
    const q = req.query || {};
    let dataB64 = q.data || q.payload || (req.body && (req.body.data || req.body.payload));
    if (!dataB64) {
      return res.status(400).json({ error: 'missing data' });
    }

    let json;
    try {
      const raw = Buffer.from(decodeURIComponent(dataB64), 'base64').toString('utf8');
      json = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: 'bad payload', detail: String(e) });
    }

    const filename = (q.name || 'ctrl_report.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.pipe(res);

    // ===== Title =====
    doc.fontSize(18);
    safeText(doc, json.title || 'CTRL — Your Snapshot');
    doc.moveDown(0.75);

    doc.fontSize(11);

    // ===== “Overview” (legacy) or new fields =====
    // If an "overview" string exists, show it first (legacy clients); otherwise use the new sections.
    if (json.overview) {
      safeText(doc, json.overview);
      doc.moveDown(0.75);
    } else {
      if (json.intro) { safeText(doc, json.intro); doc.moveDown(0.5); }
      if (json.headline) { doc.fontSize(13); safeText(doc, json.headline); doc.moveDown(0.5); doc.fontSize(11); }
    }

    // ===== Chart =====
    if (json.chartUrl) {
      try {
        const r = await fetch(json.chartUrl);
        const buf = Buffer.from(await r.arrayBuffer());
        // Fit nicely on page
        doc.image(buf, { width: 440, align: 'center' });
        doc.moveDown(0.5);
      } catch (e) {
        safeText(doc, '(Chart unavailable)');
        doc.moveDown(0.5);
      }
    }

    // ===== How this tends to show up =====
    if (json.how) {
      doc.fontSize(12);
      safeText(doc, 'How this tends to show up', { underline: true });
      doc.moveDown(0.25);
      doc.fontSize(11);
      safeText(doc, json.how);
      doc.moveDown(0.5);
    }

    // ===== Where the journey points (bullets) =====
    if (json.journey) {
      doc.fontSize(12);
      safeText(doc, 'Where the journey points', { underline: true });
      doc.moveDown(0.25);
      doc.fontSize(11);
      const lines = String(json.journey).split('\n').map(s => s.replace(/^•\s?/, '').trim()).filter(Boolean);
      for (const line of lines) {
        safeText(doc, '• ' + line);
      }
      doc.moveDown(0.5);
    }

    // ===== Themes =====
    if (json.themesExplainer) {
      doc.fontSize(12);
      safeText(doc, 'Themes that kept popping up', { underline: true });
      doc.moveDown(0.25);
      doc.fontSize(11);
      const lines = String(json.themesExplainer).split('\n').map(s => s.replace(/^•\s?/, '').trim()).filter(Boolean);
      for (const line of lines) {
        safeText(doc, '• ' + line);
      }
      doc.moveDown(0.5);
    }

    // ===== Raw =====
    if (json.raw) {
      doc.fontSize(12);
      safeText(doc, 'Raw data', { underline: true });
      doc.moveDown(0.25);
      doc.fontSize(10);
      doc.font('Courier');
      if (json.raw.sequence) safeText(doc, 'Sequence: ' + json.raw.sequence);
      if (json.raw.counts) safeText(doc, 'Counts:   ' + json.raw.counts);
      if (json.raw.perQuestion) {
        doc.moveDown(0.25);
        doc.font('Helvetica').fontSize(11);
        safeText(doc, 'Per-question:');
        doc.font('Courier').fontSize(10);
        const lines = String(json.raw.perQuestion).split('\n').filter(Boolean);
        for (const l of lines) safeText(doc, l);
      }
    }

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to build pdf', detail: String(err) });
  }
};
