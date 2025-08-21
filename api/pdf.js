// /api/pdf.js
import PDFDocument from 'pdfkit';

// Helper: sanitize text for PDF (remove emoji, replace fancy chars, arrows)
function sanitize(txt) {
  return String(txt || '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '') // strip emoji
    .replace(/\u2192/g, '->')               // → to ->
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-');
}

// Helper: parse seq from query robustly
function parseSeq(q) {
  if (!q) return '';
  // Accept "TTCTR", "T,T,C,T,R", "T T C T R"
  const raw = String(q).toUpperCase().replace(/[^CTLR]/g, '');
  return raw;
}

// Compute metrics (same logic family as your V3 summary)
function analyze(seq) {
  const ord = { C: 1, T: 2, R: 3, L: 4 };
  const name = s => ({ C: 'Concealed', T: 'Triggered', R: 'Regulated', L: 'Lead' }[s] || s);
  const arr = seq.split('');

  // counts
  const counts = { C: 0, T: 0, R: 0, L: 0 };
  arr.forEach(s => counts[s]++);

  // dominant + least
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topCount = entries[0][1];
  const dominantStates = entries.filter(e => e[1] === topCount).map(e => e[0]);
  const least = Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0];

  // switches / volatility
  let switches = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] !== arr[i - 1]) switches++;
  const volatility = +(switches / 4).toFixed(2);

  // longest streak
  let longestStreak = { state: arr[0], len: 1 };
  let cur = { state: arr[0], len: 1 };
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur.state) cur.len++;
    else {
      if (cur.len > longestStreak.len) longestStreak = { ...cur };
      cur = { state: arr[i], len: 1 };
    }
  }
  if (cur.len > longestStreak.len) longestStreak = { ...cur };

  // slope / momentum
  const nums = arr.map(s => ord[s]);
  const slope = nums[4] - nums[0];
  let momentumTag = 'flat';
  if (slope >= 2) momentumTag = 'strong_up';
  else if (slope === 1) momentumTag = 'up';
  else if (slope === -1) momentumTag = 'down';
  else if (slope <= -2) momentumTag = 'strong_down';

  // pattern shape
  let altPairs = 0;
  for (let i = 2; i < arr.length; i++) {
    if (arr[i] === arr[i - 2] && arr[i] !== arr[i - 1]) altPairs++;
  }
  const oscillation = altPairs >= 2;
  let patternTag = 'erratic';
  if (switches === 0) patternTag = 'stable';
  else if (oscillation && volatility >= 0.75) patternTag = 'oscillating';
  else if (volatility <= 0.25) patternTag = 'light_shift';
  else if (momentumTag === 'strong_up' || momentumTag === 'up') patternTag = 'increasing';
  else if (momentumTag === 'strong_down' || momentumTag === 'down') patternTag = 'decreasing';
  else patternTag = 'mixed';

  // early vs late
  const mean = a => a.reduce((x, y) => x + ord[y], 0) / a.length;
  const early = arr.slice(0, 3), late = arr.slice(3);
  const earlyLateShift = +(mean(late) - mean(early)).toFixed(2);

  // resilience & retreat
  let resilience = 0, retreat = 0;
  for (let i = 0; i < arr.length - 1; i++) {
    const now = arr[i], nxt = arr[i + 1];
    const d = ord[nxt] - ord[now];
    if ((now === 'C' || now === 'T') && d > 0) resilience++;
    if ((now === 'R' || now === 'L') && d < 0) retreat++;
  }

  return {
    arr, counts, dominantStates, least,
    first: arr[0], last: arr[4],
    switches, volatility, longestStreak,
    slope, momentumTag, patternTag,
    earlyLateShift, resilience, retreat,
    name
  };
}

// Build QuickChart URL (no ticks/grid; labels only)
function buildChartUrl(counts) {
  const spec = {
    type: 'radar',
    data: {
      labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
      datasets: [{ label: 'Frequency', data: [counts.C, counts.T, counts.R, counts.L], fill: true }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 5,
          ticks: { display: false },
          grid: { circular: true },
          angleLines: { display: false },
          pointLabels: { font: { size: 12 } }
        }
      }
    }
  };
  return 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(spec));
}

// Themes explainer map
const THEME_COPY = {
  emotion_regulation: 'emotion regulation — Settling yourself when feelings spike.',
  social_navigation:  'social navigation — Reading the room and adjusting to people and context.',
  awareness_impact:   'awareness of impact — Noticing how your words and actions land.',
  boundary_awareness: 'boundary awareness — Knowing when to say yes/no and holding your line.',
  confidence_resilience: 'confidence & resilience — Self-belief and bouncing back after wobbles.',
  intent_awareness:   'awareness of intent — Tracking what you’re aiming to do before you act.',
  feedback_handling:  'feedback handling — Taking in praise and critique without spinning.'
};

export default async function handler(req, res) {
  try {
    // ---------- 1) Inputs ----------
    const name = String(req.query.name || 'ctrl_report.pdf');
    let headline = sanitize(req.query.headline || '');
    let how = sanitize(req.query.how || '');
    let journey = sanitize(req.query.journey || '');
    const themesParam = String(req.query.th || '').trim();
    const dataB64 = req.query.data;

    let seq = parseSeq(req.query.seq);

    // Optional: parse base64 JSON payload instead
    if (!seq && dataB64) {
      try {
        const json = JSON.parse(Buffer.from(String(dataB64), 'base64').toString('utf8'));
        if (json.seq) seq = parseSeq(json.seq);
        headline = sanitize(json.headline || headline);
        how = sanitize(json.how || how);
        journey = sanitize(json.journey || journey);
      } catch {
        return res.status(400).send('Invalid data');
      }
    }

    // Validate seq
    if (!seq || seq.length !== 5) {
      return res.status(400).send('Missing or invalid seq (expect 5 letters from C,T,R,L).');
    }

    // ---------- 2) Metrics ----------
    const M = analyze(seq);

    // Default headline if none provided
    if (!headline) {
      if (M.dominantStates.length === 1) {
        const m = M.dominantStates[0];
        headline = `You sit mostly in ${M.name(m)}.`;
      } else if (M.dominantStates.length === 2) {
        const [a, b] = M.dominantStates;
        headline = `You often bounce between ${M.name(a)} and ${M.name(b)}.`;
      } else {
        headline = `No single state dominated in this snapshot.`;
      }
    }

    // Default “how” if missing (short, plain English)
    if (!how) {
      const dom = M.dominantStates[0];
      if (dom === 'T') how = 'You feel things fast and show it. A brief pause or naming the wobble (“I’m on edge”) often settles it.';
      else if (dom === 'C') how = 'You tend to hold things in and move on. A simple check-in line can help surface what matters.';
      else if (dom === 'R') how = 'You steady quickly and stay practical. Small moments of warmth help others feel it too.';
      else if (dom === 'L') how = 'You bring presence and direction. Leave room for others to contribute without overguiding.';
    }

    // Default “journey” bullets from metrics
    const dirWord = M.slope > 0 ? 'upward' : M.slope < 0 ? 'downward' : 'steady';
    const patternCopy = {
      stable: 'Mostly steady across the five moments.',
      light_shift: 'Small shifts, mostly steady.',
      increasing: 'A general move toward balance & presence.',
      decreasing: 'A general drift toward protection/reactivity.',
      oscillating: 'Back-and-forth across contexts.',
      mixed: 'A mixed picture with several changes.',
      erratic: 'Frequent swings with little consistency.'
    }[M.patternTag];

    const journeyBullets = [
      `Most seen: ${M.name(M.dominantStates[0])}${M.dominantStates.length > 1 ? ` (tie)` : ''}. Least seen: ${M.name(M.least)}.`,
      M.counts.L === 0 ? 'Lead didn’t show up in this snapshot (not “bad”, just not present here).' : null,
      `You started in ${M.name(M.first)} and ended in ${M.name(M.last)} — a ${dirWord} tilt.`,
      patternCopy,
      `You changed state ${M.switches} time(s) out of 4; longest run: ${M.name(M.longestStreak.state)} × ${M.longestStreak.len}.`,
      `Resilience: moved up after a protected/reactive moment ${M.resilience} time(s).`,
      `Compared to the first three, you were ${M.earlyLateShift > 0 ? 'slightly higher later on' : M.earlyLateShift < 0 ? 'slightly lower later on' : 'about the same'} (Δ ≈ ${Math.abs(M.earlyLateShift)} on a 1–4 scale).`
    ].filter(Boolean);

    // Themes lines
    const themeLines = themesParam
      ? themesParam.split(',').map(s => s.trim()).filter(Boolean).map(t => THEME_COPY[t] || t)
      : [];

    const chartUrl = buildChartUrl(M.counts);

    // ---------- 3) Build PDF ----------
    // Fetch chart image
    const imgBuffer = await fetch(chartUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Title + intro
    doc.fontSize(18).text('CTRL — Your Snapshot');
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#444')
      .text(
        'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states. For a fuller view, try the other CTRL paths when you’re ready.',
        { width: 500 }
      );

    // Headline
    doc.moveDown(0.8);
    doc.fillColor('#000').fontSize(14).text(sanitize(headline));

    // Chart
    doc.moveDown(0.6);
    doc.image(imgBuffer, { fit: [480, 260], align: 'center' });

    // How it tends to show up
    doc.moveDown(0.8);
    doc.fontSize(12).text('How this tends to show up');
    doc.fontSize(11).fillColor('#111').text(sanitize(how), { width: 500 });

    // Where the journey points (bullets)
    doc.moveDown(0.6);
    doc.fontSize(12).text('Where the journey points');
    doc.fontSize(11).list(journeyBullets.map(sanitize), { bulletIndent: 10, textIndent: 16, width: 500 });

    // Themes
    if (themeLines.length) {
      doc.moveDown(0.6);
      doc.fontSize(12).text('Themes that kept popping up');
      doc.fontSize(11).list(themeLines.map(sanitize), { bulletIndent: 10, textIndent: 16, width: 500 });
    }

    // Raw data page
    doc.addPage();
    doc.fontSize(12).text('Raw data');
    doc.moveDown(0.3);
    doc.fontSize(10)
      .text(`Sequence: ${M.arr.join(' ')}`)
      .text(`Counts: C:${M.counts.C}  T:${M.counts.T}  R:${M.counts.R}  L:${M.counts.L}`)
      .text(`Path: ${M.arr.join(' -> ')}`)
      .text(`Pattern: ${M.patternTag} | Switches: ${M.switches} | Longest: ${M.name(M.longestStreak.state)} × ${M.longestStreak.len}`)
      .text(`Slope: ${M.slope} | Momentum: ${M.momentumTag} | Early→Late Δ: ${M.earlyLateShift}`)
      .text(`Resilience: ${M.resilience} | Retreat: ${M.retreat}`)
      .moveDown(0.3)
      .text(`Chart: ${chartUrl}`);

    doc.end();
  } catch (e) {
    console.error(e);
    res.status(500).send('PDF generation error');
  }
}
