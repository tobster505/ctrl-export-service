// /api/pdf.js — CTRL Snapshot PDF (keeps same interface as your working file)
// ESM module (package.json has "type": "module")
import PDFDocument from 'pdfkit';

// ---------- Helpers (unchanged style) ----------
function squash(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // strip non-ASCII (emoji, arrows, etc.)
}
function toLines(v) {
  if (Array.isArray(v)) return v.map(squash).filter(Boolean);
  return String(v ?? '').split('\n').map(squash).filter(Boolean);
}
function countsToLine(counts) {
  if (!counts || typeof counts !== 'object') return squash(String(counts ?? ''));
  const c = counts.C ?? 0, t = counts.T ?? 0, r = counts.R ?? 0, l = counts.L ?? 0;
  return `C:${c}  T:${t}  R:${r}  L:${l}`;
}

// ---------- Brand tokens (single-hue CTRL palette) ----------
const BRAND = {
  primary: '#B3478F',     // plum-magenta
  dark:    '#4B1B3F',     // deep plum (titles)
  tint1:   '#F7DDF0',     // very light background
  tint2:   '#F2C5E6',     // chip/panel tint
  tint3:   '#E7A6D6',     // borders
  grey:    '#6B6B6B',     // secondary text
  line:    '#E8E8E8',     // dividers / chart rings
};

// ---------- Small drawing helpers ----------
function h1(doc, text) {
  doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(18).text(squash(text));
}
function h2(doc, text) {
  doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(13).text(squash(text));
}
function body(doc, text, size = 11, color = BRAND.dark) {
  doc.fillColor(color).font('Helvetica').fontSize(size).text(squash(text));
}
function bulletList(doc, lines, size = 11) {
  if (!Array.isArray(lines) || !lines.length) return;
  doc.font('Helvetica').fontSize(size).fillColor(BRAND.dark);
  for (const line of lines) doc.text('• ' + squash(line));
}
function divider(doc, vspace = 0.8) {
  doc.moveDown(vspace);
  const x1 = doc.page.margins.left;
  const x2 = doc.page.width - doc.page.margins.right;
  const y = doc.y;
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(0.75).strokeColor(BRAND.line).stroke().restore();
  doc.moveDown(0.6);
}
function chip(doc, text) {
  const padX = 8, padY = 4;
  const x = doc.x, y = doc.y;
  const w = doc.widthOfString(squash(text)) + padX * 2;
  const h = doc.currentLineHeight() + padY * 2;
  doc.save()
    .roundedRect(x - 1, y - 2, w + 2, h + 4, 6)
    .fillColor(BRAND.tint1)
    .strokeColor(BRAND.tint3)
    .lineWidth(1)
    .fillAndStroke();
  doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(10).text(squash(text), x + padX, y + padY);
  doc.restore();
  doc.moveDown(1.0);
}
function sequenceRibbon(doc, seq, x, y, width) {
  const N = Math.min(5, seq.length || 5);
  const gap = width / (N - 1 || 1);
  const r = 5;
  doc.save();
  doc.strokeColor(BRAND.line).lineWidth(1);
  for (let i = 0; i < N - 1; i++) {
    doc.moveTo(x + i * gap, y).lineTo(x + (i + 1) * gap, y);
  }
  doc.stroke();
  for (let i = 0; i < N; i++) {
    const cx = x + i * gap;
    doc.circle(cx, y, r).fillColor(BRAND.primary).fill();
    doc.font('Helvetica').fontSize(8).fillColor(BRAND.grey)
      .text(String(seq[i] ?? '').toUpperCase(), cx - 3, y + 7, { width: 6, align: 'center' });
  }
  doc.restore();
}
function directionCard(doc, label, meaning, x, y, w, h) {
  // Card
  doc.save();
  doc.roundedRect(x, y, w, h, 8).fillColor('#FFF').strokeColor(BRAND.tint3).lineWidth(1).fillAndStroke();
  doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(12).text('Direction of travel', x + 12, y + 12, { width: w - 24 });

  // Arrow
  const arrowBaseX = x + 18, arrowY = y + 50;
  doc.save().lineWidth(3).strokeColor(BRAND.primary);
  if (/Up|↗|upward/i.test(label || '')) {
    doc.moveTo(arrowBaseX, arrowY + 12).lineTo(arrowBaseX + 24, arrowY - 10).stroke();
    doc.moveTo(arrowBaseX + 24, arrowY - 10).lineTo(arrowBaseX + 24, arrowY - 1).stroke();
    doc.moveTo(arrowBaseX + 24, arrowY - 10).lineTo(arrowBaseX + 15, arrowY - 10).stroke();
  } else if (/Down|↘|down/i.test(label || '')) {
    doc.moveTo(arrowBaseX, arrowY - 8).lineTo(arrowBaseX + 24, arrowY + 14).stroke();
    doc.moveTo(arrowBaseX + 24, arrowY + 14).lineTo(arrowBaseX + 24, arrowY + 5).stroke();
    doc.moveTo(arrowBaseX + 24, arrowY + 14).lineTo(arrowBaseX + 15, arrowY + 14).stroke();
  } else {
    doc.moveTo(arrowBaseX, arrowY + 2).lineTo(arrowBaseX + 28, arrowY + 2).stroke();
    doc.moveTo(arrowBaseX + 28, arrowY + 2).lineTo(arrowBaseX + 22, arrowY - 4).stroke();
    doc.moveTo(arrowBaseX + 28, arrowY + 2).lineTo(arrowBaseX + 22, arrowY + 8).stroke();
  }
  doc.restore();

  // Label + meaning
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND.dark)
    .text(squash(label || 'Steady'), x + 52, y + 38, { width: w - 62 });
  doc.font('Helvetica').fontSize(10).fillColor(BRAND.dark)
    .text(squash(meaning || ''), x + 12, y + 72, { width: w - 24 });
  doc.restore();
}

// ---------- Sample payload for ?test=1 ----------
function samplePayload() {
  const sampleChartSpec = {
    type: 'radar',
    data: {
      labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
      datasets: [{
        label: 'Frequency',
        data: [1, 3, 1, 0],
        fill: true,
        borderColor: BRAND.primary,
        borderWidth: 2,
        backgroundColor: 'rgba(179,71,143,0.18)',
        pointBackgroundColor: BRAND.primary,
        pointRadius: 3
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        datalabels: {
          display: ctx => (ctx.dataset.data[ctx.dataIndex] > 0),
          formatter: v => v,
          align: 'end', anchor: 'end', offset: 6, clip: false,
          color: BRAND.dark, font: { size: 12, weight: 'bold' }
        }
      },
      scales: {
        r: {
          min: 0, max: 5,
          ticks: { display: true, stepSize: 1, color: BRAND.grey, backdropColor: 'transparent' },
          grid: { circular: true, color: BRAND.line },
          angleLines: { display: true, color: BRAND.line },
          pointLabels: { color: BRAND.dark, font: { size: 12, weight: '600' } }
        }
      }
    }
  };
  const chartUrl = 'https://quickchart.io/chart?v=4&plugins=datalabels&c=' +
                   encodeURIComponent(JSON.stringify(sampleChartSpec));

  return {
    title: 'CTRL — Your Snapshot',
    intro: 'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states. For a fuller view, try the other CTRL paths when you’re ready.',
    headline: 'You sit mostly in Triggered.',
    headlineMeaning: 'Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.',
    chartUrl,
    how: "You feel things fast and show it. Energy rises quickly. A brief pause or naming the wobble ('I’m on edge') often settles it.",
    directionLabel: 'Steady',
    directionMeaning: 'You started and ended in similar zones — steady overall.',
    themeLabel: 'Emotion regulation',
    themeMeaning: 'Settling yourself when feelings spike.',
    tip1: 'Take one breath and name it: “I’m on edge.”',
    tip2: 'Choose your gear on purpose: protect, steady, or lead — say it in one line.',
    journey: [
      'Most seen: Triggered. Least seen: Lead.',
      'You started in Triggered and ended in Triggered — a steady line.',
      'A mix of moves without a single rhythm.',
      'Switching: Two switches — moderate flexibility.',
      'Early vs late: early and late looked similar overall.'
    ],
    themesExplainer: [
      'emotion regulation — Settling yourself when feelings spike.',
      'social navigation — Reading the room and adjusting to people and context.'
    ],
    raw: {
      sequence: 'T T C R T',
      counts: { C: 1, T: 3, R: 1, L: 0 },
      perQuestion: [
        { q: 'Q1', state: 'T', themes: ['social_navigation'] },
        { q: 'Q2', state: 'T', themes: ['stress_awareness'] },
        { q: 'Q3', state: 'C', themes: ['feedback_handling'] },
        { q: 'Q4', state: 'R', themes: ['confidence_resilience'] },
        { q: 'Q5', state: 'T', themes: ['intent_awareness'] },
      ],
    },
  };
}

// ---------- Handler (keeps same parsing as your working code) ----------
export default async function handler(req, res) {
  try {
    // 1) Parse query exactly like the working version
    const url = new URL(req.url, 'http://localhost');
    const hasTest = url.searchParams.has('test');
    const b64 = url.searchParams.get('data');

    let payload;
    if (hasTest && !b64) {
      payload = samplePayload();
    } else {
      if (!b64) { res.status(400).send('Missing data'); return; }
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        res.status(400).send('Invalid data'); return;
      }
    }
    if (!payload || typeof payload !== 'object') {
      res.status(400).send('Invalid data'); return;
    }

    // 2) Pull fields (with safe defaults)
    const name = String(url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    const title            = squash(payload.title ?? 'CTRL — Snapshot');
    const intro            = squash(payload.intro ?? '');
    const headline         = squash(payload.headline ?? '');
    const headlineMeaning  = squash(payload.headlineMeaning ?? '');
    const how              = squash(payload.how ?? '');
    const chartUrl         = String(payload.chartUrl || '');
    const directionLabel   = squash(payload.directionLabel ?? 'Steady');
    const directionMeaning = squash(payload.directionMeaning ?? '');
    const themeLabel       = squash(payload.themeLabel ?? '');
    const themeMeaning     = squash(payload.themeMeaning ?? '');
    const tip1             = squash(payload.tip1 ?? '');
    const tip2             = squash(payload.tip2 ?? '');

    const journeyLines = toLines(payload.journey);
    const themeLines   = toLines(payload.themesExplainer);

    const raw = payload.raw || {};
    const rawSequence = squash(raw.sequence ?? '');
    const rawCounts   = typeof raw.counts === 'string' ? squash(raw.counts) : countsToLine(raw.counts);
    const rawPerQ     = Array.isArray(raw.perQuestion) ? raw.perQuestion : [];

    // 3) Fetch chart image (works for QuickChart)
    let chartBuf = null;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) chartBuf = Buffer.from(await r.arrayBuffer());
      } catch { /* ignore chart fetch errors */ }
    }

    // 4) Build PDF (2 pages)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const headerH = 28;
    const pageW = doc.page.width;
    const ML = doc.page.margins.left, MR = doc.page.margins.right;

    // Page 1 header stripe
    doc.save().rect(0, 0, pageW, headerH).fill(BRAND.primary).restore();
    doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(11).text('CTRL Snapshot', ML, 8);

    // Title & intro
    doc.y = headerH + 18;
    h1(doc, title);
    if (intro) { doc.moveDown(0.4); body(doc, intro); }
    divider(doc);

    // Headline & meaning
    if (headline) { h2(doc, headline); }
    if (headlineMeaning) body(doc, headlineMeaning);
    doc.moveDown(0.6);

    // Two columns (radar left / direction right)
    const colGap = 20;
    const colW = (pageW - ML - MR - colGap);
    const leftW = Math.floor(colW * 0.55);
    const rightW = colW - leftW;
    const leftX = ML, rightX = ML + leftW + colGap;
    const colTop = doc.y;

    // Left: radar + sequence ribbon
    if (chartBuf) {
      const imgW = Math.min(260, leftW);
      doc.image(chartBuf, leftX, colTop, { fit: [imgW, imgW] });
      const seq = (rawSequence || '').split(/\s+/).filter(Boolean);
      const ribY = colTop + imgW + 24;
      sequenceRibbon(doc, seq, leftX + 6, ribY, imgW - 12);
      doc.y = ribY + 28;
    } else {
      doc.rect(leftX, colTop, leftW, 160).strokeColor(BRAND.line).stroke();
      doc.y = colTop + 170;
    }

    // Right: direction card, theme chip, and "how"
    directionCard(doc, directionLabel, directionMeaning, rightX, colTop, rightW, 120);
    doc.y = colTop + 130;
    if (themeLabel) chip(doc, `${themeLabel}${themeMeaning ? ' — ' + themeMeaning : ''}`);
    if (how) { h2(doc, 'How this tends to show up'); body(doc, how); }

    // Clear below the tallest column
    doc.y = Math.max(doc.y, colTop + 240) + 8;
    divider(doc);

    // Two tiny tips
    h2(doc, 'Two tiny tips');
    const tips = [tip1, tip2].filter(Boolean);
    if (tips.length) bulletList(doc, tips);
    else body(doc, 'Pick one breath, one line, or one boundary. Keep it tiny.');

    // ---- Page 2: Signals
    doc.addPage();
    doc.save().rect(0, 0, pageW, headerH).fill(BRAND.primary).restore();
    doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(11).text('CTRL Snapshot — signals', ML, 8);
    doc.y = headerH + 18;

    h1(doc, 'More signals from your five moments');
    body(doc, 'These are descriptive, not a score. Use them as pointers for awareness.');
    divider(doc);

    h2(doc, 'What the pattern suggests');
    bulletList(doc, journeyLines);
    divider(doc);

    if (themeLines.length) {
      h2(doc, 'Themes that kept showing up');
      bulletList(doc, themeLines);
      divider(doc);
    }

    h2(doc, 'Raw data (for reference)');
    if (rawSequence) body(doc, 'Sequence: ' + rawSequence, 10, BRAND.grey);
    if (rawCounts)   body(doc, 'Counts: ' + rawCounts, 10, BRAND.grey);
    if (Array.isArray(rawPerQ) && rawPerQ.length) {
      doc.moveDown(0.2);
      for (const item of rawPerQ.slice(0, 5)) {
        const t = Array.isArray(item?.themes) && item.themes.length ? ` — themes: ${item.themes.join(', ')}` : '';
        body(doc, `${squash(item?.q || '')}: ${squash(item?.state || '')}${t}`, 10, BRAND.grey);
      }
    }

    divider(doc);
    h2(doc, 'A next action');
    body(doc, 'Choose one tiny thing you will try this week. Keep it under 60 seconds and repeat it once a day.', 11);

    doc.end();
  } catch (e) {
    console.error('[pdf] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
