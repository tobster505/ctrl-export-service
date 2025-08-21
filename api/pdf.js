// /api/pdf.js  — compact GET API that builds the PDF from short params
// Usage (short): /api/pdf?name=ctrl_report.pdf&seq=TTCTR&th=emotion_regulation,social_navigation,awareness_impact
// (No big base64 payloads; no emojis; ASCII only to avoid font issues)

import PDFDocument from 'pdfkit';

// ── helpers ──────────────────────────────────────────────────────────────────
const mapName = { C: 'Concealed', T: 'Triggered', R: 'Regulated', L: 'Lead' };
const order = ['C', 'T', 'R', 'L'];
const scoreOf = s => ({ C: 1, T: 2, R: 3, L: 4 })[s] || 0;
const clean = s => String(s || '')
  // strip emojis & non-ASCII so pdfkit’s built-in font never errors
  .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

function countsFromSeq(seq) {
  const c = { C: 0, T: 0, R: 0, L: 0 };
  for (const ch of seq) if (c[ch] !== undefined) c[ch] += 1;
  return c;
}

function metricsFromSeq(seq) {
  const scores = seq.map(scoreOf);
  const diffs = [];
  let switches = 0, upAfterLow = 0, downAfterHigh = 0, longest = 1, curr = 1;

  for (let i = 0; i < scores.length - 1; i++) {
    const a = scores[i], b = scores[i + 1];
    diffs.push(Math.sign(b - a));
    if (seq[i] !== seq[i + 1]) switches++;
    if (a <= 2 && b >= 3) upAfterLow++;
    if (a >= 3 && b <= 2) downAfterHigh++;
    if (seq[i] === seq[i + 1]) { curr++; longest = Math.max(longest, curr); }
    else curr = 1;
  }

  // simple shape tag
  const sum = diffs.reduce((p, v) => p + v, 0);
  const signChanges = diffs.slice(1).filter((v, i) => v && v !== diffs[i]).length;
  const shape = signChanges >= 2 ? 'oscillating'
              : sum >= 2           ? 'increasing'
              : sum <= -2          ? 'decreasing'
              : 'stable';

  const early = (scores[0] + scores[1] + scores[2]) / 3;
  const late  = (scores[3] + scores[4]) / 2;
  const delta = +(late - early).toFixed(2);

  return { switches, longest, shape, upAfterLow, downAfterHigh, delta };
}

function headlineFromCounts(counts) {
  const pairs = order.map(k => [k, counts[k]]).sort((a, b) => b[1] - a[1]);
  const top = pairs.filter(p => p[1] === pairs[0][1]).map(p => p[0]);
  if (top.length === 1) return `You sit mostly in ${mapName[top[0]]}.`;
  if (top.length >= 2)  return `You often bounce between ${mapName[top[0]]} and ${mapName[top[1]]}.`;
  return `No single state stood out.`;
}

function howFromDominant(doms) {
  // tiny, plain-English explainers per state
  const explain = {
    C: 'You tend to hold things in at first. Naming what you feel helps you show it safely.',
    T: 'You feel things fast and show it. A brief pause or saying “I’m on edge” often settles it.',
    R: 'You stay mostly steady and respectful, even when pressed. You check impact and keep course.',
    L: 'You lead calmly. You sense the room, respond clearly, and help others steady themselves.'
  };
  if (doms.length === 1) return explain[doms[0]];
  return `${explain[doms[0]]} ${explain[doms[1]]}`;
}

function bulletsFrom(seq, counts) {
  const domPairs = order.map(k => [k, counts[k]]).sort((a, b) => b[1] - a[1]);
  const doms = domPairs.filter(p => p[1] === domPairs[0][1]).map(p => p[0]);
  const least = domPairs[domPairs.length - 1][0];
  const m = metricsFromSeq(seq);

  const b = [];
  b.push(`Most seen: ${mapName[domPairs[0][0]]}. Least seen: ${mapName[least]}.`);
  if (counts.L === 0) b.push(`Lead didn’t show up in this snapshot (not “bad”, just not present here).`);
  b.push(`You started in ${mapName[seq[0]]} and ended in ${mapName[seq[4]]}.`);
  const shapeText = { increasing: 'an upward tilt', decreasing: 'a downward tilt', oscillating: 'a back-and-forth pattern', stable: 'a steadier line' }[m.shape];
  b.push(`Overall: ${shapeText}.`);
  b.push(`You changed state ${m.switches} time(s); longest run: ${mapName[seq.sort((a,b)=>0)[0]]} × ${m.longest}.`);
  if (m.upAfterLow)   b.push(`Resilience: moved up after a protected/reactive moment ${m.upAfterLow} time(s).`);
  if (m.downAfterHigh) b.push(`Retreat: slipped after a steady/leading moment ${m.downAfterHigh} time(s).`);
  if (m.delta) b.push(`Later vs early: ${m.delta > 0 ? 'slightly higher later on' : 'slightly lower later on'} (Δ ${m.delta} on a 1–4 scale).`);
  return b;
}

function themesExplainer(thKeys) {
  const map = {
    emotion_regulation: 'emotion regulation — Settling yourself when feelings spike.',
    social_navigation:  'social navigation — Reading the room and adjusting to people and context.',
    awareness_impact:   'awareness of impact — Noticing how your words and actions land.'
  };
  return thKeys.map(k => map[k]).filter(Boolean);
}

function quickChartUrl(counts) {
  const spec = {
    type: 'radar',
    data: {
      labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
      datasets: [{ label: 'Frequency', data: [counts.C, counts.T, counts.R, counts.L], fill: true }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { r: { min: 0, max: 5, ticks: { display: false }, grid: { circular: true }, angleLines: { display: false }, pointLabels: { font: { size: 12 } } } }
    }
  };
  return 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(spec));
}

// ── handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
    // Accept short params
    const name = clean(req.query.name || 'ctrl_report.pdf');
    const seqRaw = String(req.query.seq || '').toUpperCase().replace(/[^CTRL]/g, '');
    if (seqRaw.length !== 5) {
      res.status(400).send('Missing or invalid seq (expect 5 letters from C,T,R,L).');
      return;
    }
    const seq = seqRaw.split('');
    const counts = countsFromSeq(seq);
    const domPairs = order.map(k => [k, counts[k]]).sort((a, b) => b[1] - a[1]);
    const doms = domPairs.filter(p => p[1] === domPairs[0][1]).map(p => p[0]);

    const th = String(req.query.th || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    // Copy (plain English)
    const title = 'CTRL — Your Snapshot';
    const intro = 'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states. For a fuller view, try the other CTRL paths when you’re ready.';
    const headline = headlineFromCounts(counts);
    const how = howFromDominant(doms);
    const bullets = bulletsFrom(seq, counts);
    const themeLines = themesExplainer(th);

    // Chart
    const chartUrl = quickChartUrl(counts);
    const img = await fetch(chartUrl).then(r => r.arrayBuffer());

    // PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);

    const doc = new PDFDocument({ margin: 42 });
    doc.pipe(res);

    // Title
    doc.font('Helvetica-Bold').fontSize(18).text(title);
    doc.moveDown(0.6);

    // Intro
    doc.font('Helvetica').fontSize(11).text(clean(intro));
    doc.moveDown(0.8);

    // Headline
    doc.font('Helvetica-Bold').fontSize(13).text(clean(headline));
    doc.moveDown(0.6);

    // Chart
    doc.font('Helvetica-Bold').fontSize(12).text('CTRL Radar (frequency across five moments)');
    doc.moveDown(0.3);
    doc.image(Buffer.from(img), { fit: [360, 280], align: 'center' });
    doc.moveDown(0.6);

    // How it shows up
    doc.font('Helvetica-Bold').fontSize(12).text('How this tends to show up');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(11).text(clean(how));
    doc.moveDown(0.6);

    // Journey bullets
    doc.font('Helvetica-Bold').fontSize(12).text('Where the journey points');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(11);
    bullets.forEach(line => doc.text('• ' + clean(line)));
    doc.moveDown(0.6);

    // Themes
    if (themeLines.length) {
      doc.font('Helvetica-Bold').fontSize(12).text('Themes that kept popping up');
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(11);
      themeLines.forEach(t => doc.text('• ' + clean(t)));
      doc.moveDown(0.6);
    }

    // Raw data
    doc.font('Helvetica-Bold').fontSize(12).text('Raw data');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(11)
       .text(`Sequence: ${seq.join(' ')}`)
       .text(`Counts: C:${counts.C}  T:${counts.T}  R:${counts.R}  L:${counts.L}`);

    doc.end();
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).send('Error generating PDF');
  }
}
