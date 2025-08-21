// /api/pdf.js — PDF export for CTRL (Vercel / Node 22, ESM)
import PDFDocument from 'pdfkit';

export default async function handler(req, res) {
  try {
    const name = String(req.query.name || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    const b64  = String(req.query.data || '');
    if (!b64) { res.status(400).send('Missing data'); return; }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch {
      res.status(400).send('Invalid data'); return;
    }

    // --- sanitise to ASCII so PDFKit's built-in fonts are safe ---
    const S = (s) => {
      s = String(s || '');
      // strip emoji / symbols
      s = s.replace(/[\u{1F000}-\u{1FFFF}]/gu, '');
      // normalise punctuation & symbols
      const map = {
        '–':'-','—':'-','-':'-',
        '“':'"','”':'"','„':'"','‟':'"','’':"'",'‘':"'",'…':'...',
        '•':'- ','·':'- ','●':'- ','▪':'- ',
        '→':'->','←':'<-',
        '×':'x','✕':'x','✖':'x',
        '≈':'~','≃':'~','≅':'~','≡':'=',
        'Δ':'delta','∼':'~','≥':'>=','≤':'<='
      };
      return s.replace(/[–—-“”„‟’‘…•·●▪→←×✕✖≈≃≅≡Δ∼≥≤]/g, (c) => map[c] || '');
    };

    const title    = S(payload.title   || 'CTRL — Your Snapshot');
    const intro    = S(payload.intro   || '');
    const headline = S(payload.headline|| '');
    const how      = S(payload.how     || '');
    const journey  = S(payload.journey || '');
    const themes   = S(payload.themesExplainer || '');

    // Try to pull the chart image (optional)
    let chartBuf = null;
    const chartUrl = String(payload.chartUrl || '');
    if (chartUrl.startsWith('http')) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) chartBuf = Buffer.from(await r.arrayBuffer());
      } catch { /* ignore */ }
    }

    // --- headers ---
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);

    // --- build PDF ---
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    doc.font('Helvetica-Bold').fontSize(18).text(title);
    doc.moveDown(0.5);

    if (intro)    { doc.font('Helvetica').fontSize(10).text(intro); doc.moveDown(0.6); }
    if (headline) { doc.font('Helvetica-Bold').fontSize(12).text(headline); doc.moveDown(0.6); }

    if (chartBuf) { doc.image(chartBuf, { fit: [460, 300], align: 'center' }); doc.moveDown(0.8); }

    if (how) {
      doc.font('Helvetica-Bold').text('How this tends to show up');
      doc.moveDown(0.2);
      doc.font('Helvetica').text(how);
      doc.moveDown(0.6);
    }

    if (journey) {
      doc.font('Helvetica-Bold').text('Where the journey points');
      doc.moveDown(0.2);
      doc.font('Helvetica').text(journey);
      doc.moveDown(0.6);
    }

    if (themes) {
      doc.font('Helvetica-Bold').text('Themes that kept popping up');
      doc.moveDown(0.2);
      doc.font('Helvetica').text(themes);
      doc.moveDown(0.6);
    }

    // Raw block (all optional)
    const raw = payload.raw || {};
    const seq    = Array.isArray(raw.seq) ? raw.seq.join(' ') : S(raw.sequence || '');
    const counts = raw.counts
      ? `C:${raw.counts.C||0}  T:${raw.counts.T||0}  R:${raw.counts.R||0}  L:${raw.counts.L||0}`
      : S(raw.countsText || '');
    const path   = Array.isArray(raw.seq) ? raw.seq.join(' -> ') : S(raw.pathText || '');
    const extra  = S(raw.extra || '');

    doc.font('Helvetica-Bold').text('Raw data');
    doc.moveDown(0.2);
    if (seq)    doc.font('Helvetica').text(`Sequence: ${seq}`);
    if (counts) doc.text(`Counts: ${counts}`);
    if (path)   doc.text(`Path: ${path}`);
    if (extra)  doc.text(extra);

    doc.end();
  } catch (e) {
    res.status(500).send('Error generating PDF');
  }
}
