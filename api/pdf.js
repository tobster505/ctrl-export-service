// /api/pdf.js — Generate a simple CTRL PDF (Node/Serverless on Vercel)
// ESM module (package.json has "type": "module")
import PDFDocument from 'pdfkit';

// Helper: ASCII-only text to avoid "WinAnsi cannot encode" issues
function squash(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes → '
    .replace(/[\u201C\u201D]/g, '"')  // curly double quotes → "
    .replace(/[\u2013\u2014]/g, '-')  // en/em dashes → -
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // strip non-ASCII (emoji, arrows, etc.)
}

// Helper: coerce array-or-string into array of lines
function toLines(v) {
  if (Array.isArray(v)) return v.map(squash).filter(Boolean);
  return String(v ?? '')
    .split('\n')
    .map(squash)
    .filter(Boolean);
}

// Helper: compact counts object → "C:1  T:3  R:1  L:0"
function countsToLine(counts) {
  if (!counts || typeof counts !== 'object') return squash(String(counts ?? ''));
  const c = counts.C ?? 0, t = counts.T ?? 0, r = counts.R ?? 0, l = counts.L ?? 0;
  return `C:${c}  T:${t}  R:${r}  L:${l}`;
}

export default async function handler(req, res) {
  try {
    // -----------------------------
    // 1) Read query & payload
    // -----------------------------
    const url = new URL(req.url, 'http://localhost'); // parse safely
    const hasTest = url.searchParams.has('test');     // presence of ?test triggers sample payload
    const b64 = url.searchParams.get('data');

    let payload;

    if (hasTest && !b64) {
      // ---- Sample payload for quick testing (no Botpress needed) ----
      const sampleChartSpec = {
        type: 'radar',
        data: {
          labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
          datasets: [{ label: 'Frequency', data: [1, 3, 1, 0], fill: true }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            r: {
              min: 0, max: 5,
              ticks: { display: false },
              grid: { circular: true },
              angleLines: { display: false },
              pointLabels: { font: { size: 12 } },
            },
          },
        },
      };
      const chartUrl =
        'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));

      payload = {
        title: 'CTRL — Your Snapshot',
        intro:
          'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states. For a fuller view, try the other CTRL paths when you’re ready.',
        headline: 'You sit mostly in Triggered.',
        chartUrl,
        how:
          "You feel things fast and show it. Energy rises quickly. A brief pause or naming the wobble ('I’m on edge') often settles it.",
        journey: [
          'Most seen: Triggered. Least seen: Lead.',
          'Lead didn’t show up in this snapshot (not "bad", just not present here).',
          'You started in Triggered and ended in Regulated — an upward tilt.',
          'Overall drift toward more balance and presence.',
          'You changed state 3 time(s) out of 4; longest run: Triggered × 2.',
          'Resilience: moved up after a protected/reactive moment 2 time(s).',
          'Compared to the first three, you were slightly higher later on (about 0.8 on a 1–4 scale).',
        ],
        themesExplainer: [
          'emotion regulation — Settling yourself when feelings spike.',
          'social navigation — Reading the room and adjusting to people and context.',
          'awareness of impact — Noticing how your words and actions land.',
        ],
        raw: {
          sequence: 'T T C T R',
          counts: { C: 1, T: 3, R: 1, L: 0 },
          perQuestion: [
            { q: 'Q1', state: 'T', themes: ['social_navigation', 'awareness_impact', 'emotion_regulation'] },
            { q: 'Q2', state: 'T', themes: ['stress_awareness', 'emotion_regulation', 'confidence_resilience'] },
            { q: 'Q3', state: 'C', themes: ['feedback_handling', 'awareness_impact', 'emotion_regulation'] },
            { q: 'Q4', state: 'T', themes: ['feedback_handling', 'confidence_resilience', 'intent_awareness'] },
            { q: 'Q5', state: 'R', themes: ['social_navigation', 'boundary_awareness', 'awareness_intent'] },
          ],
        },
      };
    } else {
      if (!b64) { res.status(400).send('Missing data'); return; }
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        res.status(400).send('Invalid data'); return;
      }
    }

    // Basic shape guard
    if (!payload || typeof payload !== 'object') {
      res.status(400).send('Invalid data'); return;
    }

    // -----------------------------
    // 2) Pull fields (with defaults)
    // -----------------------------
    const name = String(url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');

    const title   = squash(payload.title   ?? 'CTRL — Snapshot');
    const intro   = squash(payload.intro   ?? '');
    const headline = squash(payload.headline ?? '');
    const how     = squash(payload.how     ?? '');
    const chartUrl = String(payload.chartUrl || '');

    const journeyLines = toLines(payload.journey);
    const themeLines   = toLines(payload.themesExplainer);

    const raw = payload.raw || {};
    const rawSequence = squash(raw.sequence ?? '');
    const rawCounts   = countsToLine(raw.counts);
    const rawPerQ     = Array.isArray(raw.perQuestion) ? raw.perQuestion : [];

    // -----------------------------
    // 3) Try to fetch chart image
    // -----------------------------
    let chartBuf = null;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) chartBuf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        console.warn('[pdf] chart fetch failed:', e?.message || e);
      }
    }

    // -----------------------------
    // 4) Build the PDF
    // -----------------------------
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    // Title
    doc.font('Helvetica-Bold').fontSize(18).text(title);
    doc.moveDown(0.6);

    // Intro
    if (intro) {
      doc.font('Helvetica').fontSize(11).text(intro);
      doc.moveDown(0.8);
    }

    // Headline
    if (headline) {
      doc.font('Helvetica-Bold').fontSize(14).text(headline);
      doc.moveDown(0.5);
    }

    // Chart
    if (chartBuf) {
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const imgW = Math.min(400, pageW);
      doc.image(chartBuf, { fit: [imgW, imgW], align: 'center' });
      doc.moveDown(0.6);
    }

    // How it tends to show up
    if (how) {
      doc.font('Helvetica-Bold').fontSize(12).text('How this tends to show up');
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(11).text(how);
      doc.moveDown(0.6);
    }

    // Where the journey points (bullets with ASCII dashes)
    if (journeyLines.length) {
      doc.font('Helvetica-Bold').fontSize(12).text('Where the journey points');
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(11);
      journeyLines.forEach(line => doc.text('- ' + line));
      doc.moveDown(0.6);
    }

    // Themes that kept popping up
    if (themeLines.length) {
      doc.font('Helvetica-Bold').fontSize(12).text('Themes that kept popping up');
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(11);
      themeLines.forEach(line => doc.text('- ' + line));
      doc.moveDown(0.6);
    }

    // Raw data
    doc.font('Helvetica-Bold').fontSize(12).text('Raw data');
    doc.moveDown(0.2);
    if (rawSequence) doc.font('Helvetica').fontSize(10).text('Sequence: ' + rawSequence);
    if (rawCounts)   doc.font('Helvetica').fontSize(10).text('Counts: ' + rawCounts);
    if (rawPerQ.length) {
      doc.moveDown(0.3);
      rawPerQ.slice(0, 5).forEach(item => {
        const themesStr = Array.isArray(item.themes) && item.themes.length
          ? ` — themes: ${item.themes.join(', ')}`
          : '';
        const line = `${item.q || ''}: ${item.state || ''}${themesStr}`;
        doc.font('Helvetica').fontSize(10).text(squash(line));
      });
    }

    doc.end();
  } catch (e) {
    console.error('[pdf] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
