// /api/pdf.js — Robust PDF endpoint for Vercel (Node runtime, ESM)
// - Accepts GET ?data=<base64(json)>&name=<filename>
// - Never crashes: validates input + catches all errors
// - Works whether query comes from req.query or req.url
// - Sanitises emojis / smart quotes (WinAnsi-safe) to avoid "WinAnsi cannot encode" errors
// - Embeds QuickChart image if provided (optional)

import PDFDocument from 'pdfkit';

// ---- helpers ---------------------------------------------------------------
const clean = (s) =>
  String(s || '')
    // strip emojis
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    // normalise quotes/dashes
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-');

function getQueryValue(req, key) {
  // Support both req.query (Vercel Node) and parsing req.url manually
  const q1 = req?.query?.[key];
  if (q1) return String(q1);
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get(key) || '';
  } catch {
    return '';
  }
}

function b64ToObj(b64) {
  // Vercel sometimes gives spaces for '+' if not encoded; normalise
  const fixed = String(b64).replace(/ /g, '+');
  const buf = Buffer.from(fixed, 'base64');
  return JSON.parse(buf.toString('utf8'));
}

async function fetchImageBuffer(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`image fetch ${r.status}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(to);
  }
}

// ---- handler ---------------------------------------------------------------
export default async function handler(req, res) {
  try {
    const nameRaw = getQueryValue(req, 'name') || 'ctrl_report.pdf';
    const name = nameRaw.replace(/[^A-Za-z0-9._-]/g, '_');

    const dataParam = getQueryValue(req, 'data');
    if (!dataParam) {
      res.status(400).send('Missing data');
      return;
    }

    let payload;
    try {
      payload = b64ToObj(dataParam);
    } catch (e) {
      console.error('Bad data JSON', e);
      res.status(400).send('Invalid data');
      return;
    }

    // Extract with sane defaults
    const title     = clean(payload.title || 'CTRL — Your Snapshot');
    const intro     = clean(payload.intro || '');
    const headline  = clean(payload.headline || '');
    const how       = clean(payload.how || '');
    const journey   = clean(payload.journey || '');
    const bullets   = Array.isArray(payload.bullets) ? payload.bullets.map(clean) : [];
    const themes    = clean(payload.themesExplainer || '');
    const chartUrl  = payload.chartUrl ? String(payload.chartUrl) : '';
    const raw       = payload.raw || {};

    // Start PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,         // 48pt = ~17mm
      info: { Title: title }
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('error', (e) => console.error('PDF error', e));
    const done = new Promise((resolve) => doc.on('end', resolve));

    // Fonts & base layout
    doc.font('Helvetica');

    // Title
    doc.fontSize(18).text(title, { align: 'left' }).moveDown(0.6);

    // Intro block
    if (intro) {
      doc.fontSize(11).text(intro, { align: 'left' }).moveDown(0.8);
    }

    // Headline (overall state)
    if (headline) {
      doc.fontSize(14).text(headline, { align: 'left' }).moveDown(0.6);
    }

    // --- Chart (near top) ---------------------------------------------------
    if (chartUrl) {
      try {
        const img = await fetchImageBuffer(chartUrl);
        // keep it readable: max width 420pt
        const maxW = 420;
        const x = doc.x;
        const y = doc.y;
        doc.image(img, x, y, { width: maxW });
        doc.moveDown(0.6);
      } catch (e) {
        console.error('Chart fetch/paint failed', e);
        // Continue without chart
      }
    }

    // "How this tends to show up"
    if (how) {
      doc.fontSize(12).text('How this tends to show up', { underline: true }).moveDown(0.2);
      doc.fontSize(11).text(how).moveDown(0.6);
    }

    // "Where the journey points" — bullet list
    if (journey || bullets.length) {
      doc.fontSize(12).text('Where the journey points', { underline: true }).moveDown(0.2);
      if (journey) doc.fontSize(11).text(journey).moveDown(0.2);
      for (const b of bullets) {
        doc.fontSize(11).text(`• ${b}`);
      }
      doc.moveDown(0.6);
    }

    // Themes
    if (themes) {
      doc.fontSize(12).text('Themes that kept popping up', { underline: true }).moveDown(0.2);
      // If themes already contain bullets, print as-is; else one paragraph
      if (themes.includes('•')) {
        themes.split('\n').forEach(line => doc.fontSize(11).text(clean(line)));
      } else {
        doc.fontSize(11).text(themes);
      }
      doc.moveDown(0.6);
    }

    // Raw data (append if present)
    if (raw && (raw.sequence || raw.counts || raw.perQuestion)) {
      doc.fontSize(12).text('Raw data', { underline: true }).moveDown(0.2);
      if (raw.sequence)     doc.fontSize(10).text(`Sequence: ${clean(raw.sequence)}`);
      if (raw.counts)       doc.fontSize(10).text(`Counts: ${clean(String(raw.counts))}`);
      if (Array.isArray(raw.perQuestion)) {
        doc.moveDown(0.2);
        raw.perQuestion.forEach((q, idx) => {
          const line =
            `Q${idx + 1}: ${clean(q.stateName || q.state || '')}` +
            (q.themes?.length ? `  — themes: ${clean(q.themes.join(', '))}` : '');
          doc.fontSize(10).text(line);
        });
      }
    }

    // Footer
    doc.moveDown(1.0);
    doc.fontSize(8).fillColor('#666').text('CTRL — Generated by /api/pdf');

    // Finalise & respond
    doc.end();
    await done;

    const pdfBuffer = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.status(200).send(pdfBuffer);
  } catch (e) {
    console.error('Handler failed', e);
    res.status(500).send('Error generating PDF');
  }
}
