// /api/pdf.js — Generate a simple CTRL PDF
import PDFDocument from 'pdfkit';

export default async function handler(req, res) {
  try {
    const name = String(req.query.name || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');

    // ----- 1) Get payload (either ?data=base64json or ?test=1) -----
    let payload;
    const b64 = req.query.data;
    if (req.query.test === '1' && !b64) {
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
      const chartUrl = 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));

      // Built-in sample payload for testing
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
          counts: 'C:1  T:3  R:1  L:0',
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
        payload = JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8'));
      } catch {
        res.status(400).send('Invalid data'); return;
      }
    }

    // ----- 2) Sanitize to avoid font encoding issues -----
    const squash = (s) => String(s || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // strip non-ASCII (emojis, arrows, etc.)

    // Pull fields with defaults
    const {
      title = 'CTRL — Snapshot',
      intro = '',
      headline = '',
      chartUrl = '',
      how = '',
      journey = [],
      themesExplainer = [],
      raw = {},
    } = payload;

    // Fetch chart image (optional)
    let chartBuf = null;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) chartBuf = Buffer.from(await r.arrayBuffer());
      } catch { /* ignore chart errors; continue */ }
    }

    // ----- 3) Build PDF -----
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    // Title
    doc.font('Helvetica-Bold').fontSize(18).text(squash(title));
    doc.moveDown(0.6);

    // Intro
    if (intro) {
      doc.font('Helvetica').fontSize(11).text(squash(intro));
      doc.moveDown(0.8);
    }

    // Headline
    if (headline) {
      doc.font('Helvetica-Bold').fontSize(14).text(squash(headline));
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
      doc.font('Helvetica').fontSize(11).text(squash(how));
      doc.moveDown(0.6);
    }

    // Journey bullets
    const journeyArr = Array.isArray(journey) ? journey : String(journey).split('\n').filter(Boolean);
    if (journeyArr.length) {
      doc.font('Helvetica-Bold').fontSize(12).text('Where the journey points');
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(11);
      journeyArr.forEach(line => doc.text('• ' + squash(line)));
      doc.moveDown(0.6);
    }

    // Themes
    const themesArr = Array.isArray(themesExplainer) ? themesExplainer : String(themesExplainer).split('\n').filter(Boolean);
    if (themesArr.length) {
      doc.font('Helvetica-Bold').fontSize(12).text('Themes that kept popping up');
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(11);
      themesArr.forEach(t => doc.text('• ' + squash(t)));
      doc.moveDown(0.6);
    }

    // Raw data
    doc.font('Helvetica-Bold').fontSize(12).text('Raw data');
    doc.moveDown(0.2);
    const seq = squash(raw.sequence || '');
    const counts = squash(raw.counts || '');
    if (seq)   doc.font('Helvetica').fontSize(10).text('Sequence: ' + seq);
    if (counts) doc.font('Helvetica').fontSize(10).text('Counts: ' + counts);
    const perQ = Array.isArray(raw.perQuestion) ? raw.perQuestion : [];
    if (perQ.length) {
      doc.moveDown(0.3);
      perQ.slice(0, 5).forEach(item => {
        const line = `${item.q}: ${item.state}` + (item.themes?.length ? ` — themes: ${item.themes.join(', ')}` : '');
        doc.font('Helvetica').fontSize(10).text(squash(line));
      });
    }

    doc.end();
  } catch (e) {
    res.status(500).send('Error generating PDF: ' + e.message);
  }
}
