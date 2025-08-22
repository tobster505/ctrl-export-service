// /api/pdf.js — CTRL Snapshot (enhanced) — Node/Serverless on Vercel (ESM)
import PDFDocument from 'pdfkit';

// ---------- Brand tokens (adjust once and reuse) ----------
const BRAND = {
  // CTRL Plum family (neutral, not "good/bad")
  plum500: '#7348C7',
  plum300: '#9D7BE0',
  plum100: '#E9E1FB',
  ink900:  '#2B2737',
  ink600:  '#4A4458',
  ink400:  '#6E6780',
  line:    '#E8E6EF',
};

// ---------- Text helpers ----------
function squash(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
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

// ---------- Tiny drawing helpers ----------
function hRule(doc, x, y, w, color = BRAND.line) {
  doc.save().lineWidth(1).strokeColor(color).moveTo(x, y).lineTo(x + w, y).stroke().restore();
}
function label(doc, x, y, text) {
  doc.save()
    .fillColor(BRAND.plum500)
    .font('Helvetica-Bold').fontSize(9)
    .text(squash(text).toUpperCase(), x, y)
    .restore();
}
function sectionTitle(doc, x, y, text) {
  doc.save()
    .fillColor(BRAND.ink900)
    .font('Helvetica-Bold').fontSize(13)
    .text(squash(text), x, y)
    .restore();
}
function body(doc, x, y, text, size = 10.5, color = BRAND.ink600, w = 0) {
  doc.save()
    .fillColor(color)
    .font('Helvetica').fontSize(size)
    .text(squash(text), x, y, { width: w || undefined })
    .restore();
}
function bulletList(doc, x, y, lines, opts = {}) {
  const { size = 10.5, gap = 4, color = BRAND.ink600, width = 0 } = opts;
  let cy = y;
  doc.save().fillColor(color).font('Helvetica').fontSize(size);
  for (const line of lines) {
    doc.circle(x + 2, cy + 5, 1.6).fill(color).fillColor(color);
    doc.text(squash(line), x + 10, cy - 2, { width: width || undefined });
    cy += doc.currentLineHeight() + gap;
  }
  doc.restore();
  return cy;
}
function chip(doc, x, y, text, fg = '#fff', bg = BRAND.plum500, padX = 8, padY = 4) {
  const t = squash(text);
  doc.save().font('Helvetica-Bold').fontSize(9);
  const w = doc.widthOfString(t) + padX * 2;
  const h = doc.currentLineHeight() + padY * 2;
  doc.roundedRect(x, y, w, h, 6).fill(bg);
  doc.fillColor(fg).text(t, x + padX, y + padY);
  doc.restore();
  return { w, h };
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  try {
    // Parse URL and payload
    const url = new URL(req.url, 'http://localhost');
    const hasTest = url.searchParams.has('test');
    const b64 = url.searchParams.get('data');

    let payload;
    if (hasTest && !b64) {
      // Smoke-test payload (no Botpress needed)
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
              ticks: { display: true, stepSize: 1, backdropColor: 'rgba(0,0,0,0)' },
              grid: { circular: true },
              angleLines: { display: true },
              pointLabels: { color: '#4A4458', font: { size: 12 } },
            },
          },
        },
      };
      const chartUrl = 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));
      payload = {
        title: 'CTRL — Your Snapshot',
        intro: 'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states. For a fuller view, try the other CTRL paths when you’re ready.',
        headline: 'You sit mostly in Triggered.',
        how: "You feel things fast and show it. Energy rises quickly. A brief pause or naming the wobble ('I’m on edge') often settles it.",
        chartUrl,
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones — steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        tip1: 'Take one breath and name it: “I’m on edge.”',
        tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
        journey: [
          'Direction: Steady',
          'You touched three states: you can shift when needed; a brief pause helps you choose on purpose.',
          'Least seen: Lead. Guiding wasn’t in focus; offer a simple next step or summary when it helps the group.',
          'Pattern: Varied responses without one rhythm.',
          'Switching: Three switches — high reactivity or agility; use a pause to make switches intentional. Longest run: Triggered × 2.',
          'Resilience: One upward recovery — evidence you can reset.',
          'Retreat: One slip — name it and reset.',
          'Early vs late: clearly steadier later on.',
        ],
        themesExplainer: [
          'Emotion regulation — Settling yourself when feelings spike.',
          'Social navigation — Reading the room and adjusting to people and context.',
          'Awareness of impact — Noticing how your words and actions land.',
        ],
        raw: {
          sequence: 'T T C R T',
          counts: { C: 1, T: 3, R: 1, L: 0 },
          perQuestion: [
            { q: 'Q1', state: 'T', themes: ['social_navigation', 'awareness_impact', 'emotion_regulation'] },
            { q: 'Q2', state: 'T', themes: ['stress_awareness', 'emotion_regulation', 'confidence_resilience'] },
            { q: 'Q3', state: 'C', themes: ['feedback_handling', 'awareness_impact', 'emotion_regulation'] },
            { q: 'Q4', state: 'R', themes: ['feedback_handling', 'confidence_resilience', 'intent_awareness'] },
            { q: 'Q5', state: 'T', themes: ['social_navigation', 'boundary_awareness', 'awareness_intent'] },
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

    // Pull fields with safe defaults
    const name = String(url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    const title    = squash(payload.title   ?? 'CTRL — Snapshot');
    const intro    = squash(payload.intro   ?? '');
    const headline = squash(payload.headline ?? '');
    const how      = squash(payload.how     ?? '');
    const chartUrl = String(payload.chartUrl || '');

    // Optional richer fields
    const directionLabel   = squash(payload.directionLabel   ?? '');
    const directionMeaning = squash(payload.directionMeaning ?? '');
    const themeLabel       = squash(payload.themeLabel       ?? '');
    const themeMeaning     = squash(payload.themeMeaning     ?? '');
    const tip1             = squash(payload.tip1 ?? '');
    const tip2             = squash(payload.tip2 ?? '');
    const tipsArr          = Array.isArray(payload.tips) ? payload.tips.map(squash) : [tip1, tip2].filter(Boolean);

    // Lists
    const journeyLines = toLines(payload.journey);
    const themeLines   = toLines(payload.themesExplainer);

    // Raw
    const raw = payload.raw || {};
    const rawSequence = squash(raw.sequence ?? '');
    const rawCounts   = countsToLine(raw.counts);
    const rawPerQ     = Array.isArray(raw.perQuestion) ? raw.perQuestion : [];

    // Chart image
    let chartBuf = null;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) chartBuf = Buffer.from(await r.arrayBuffer());
      } catch { /* ignore chart errors */ }
    }

    // ---------- Build PDF ----------
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    // PAGE 1 — Snapshot
    const W = doc.page.width, H = doc.page.height, M = doc.page.margins.left;
    const colGutter = 22;
    const colW = (W - M - doc.page.margins.right - colGutter) / 2;

    // Header label
    label(doc, M, 36, 'CTRL Snapshot');

    // Headline
    doc.fillColor(BRAND.ink900).font('Helvetica-Bold').fontSize(18).text(title, M, 54);

    // Sub intro
    if (intro) {
      body(doc, M, 80, intro, 10.5, BRAND.ink600, colW);
    }

    // Two columns
    let leftTop = 130;
    let rightTop = 110;

    // Left: headline state & "how"
    if (headline) {
      doc.fillColor(BRAND.ink900).font('Helvetica-Bold').fontSize(15).text(headline, M, leftTop, { width: colW });
      leftTop = doc.y + 8;
    }

    if (directionLabel) {
      const chipDims = chip(doc, M, leftTop, `Direction: ${directionLabel}`);
      leftTop += chipDims.h + 8;
      if (directionMeaning) {
        body(doc, M, leftTop, directionMeaning, 10.5, BRAND.ink600, colW);
        leftTop = doc.y + 10;
      }
    }

    if (how) {
      sectionTitle(doc, M, leftTop, 'How this tends to show up');
      leftTop += 18;
      body(doc, M, leftTop, how, 10.5, BRAND.ink600, colW);
      leftTop = doc.y + 14;
    }

    if (themeLabel || themeMeaning) {
      sectionTitle(doc, M, leftTop, 'Theme in focus');
      leftTop += 18;
      if (themeLabel) doc.fillColor(BRAND.ink900).font('Helvetica-Bold').fontSize(11).text(themeLabel, M, leftTop, { width: colW });
      if (themeMeaning) body(doc, M, doc.y + 2, themeMeaning, 10.5, BRAND.ink600, colW);
      leftTop = doc.y + 10;
    }

    if (tipsArr.length) {
      sectionTitle(doc, M, leftTop, 'Two tiny tips');
      leftTop += 18;
      leftTop = bulletList(doc, M, leftTop, tipsArr.slice(0, 2), { width: colW });
      leftTop += 2;
    }

    // Right column: radar + (optional) sequence chips
    if (chartBuf) {
      const box = 360; // image box
      doc.save()
        .rect(M + colW + colGutter, rightTop, colW, box).strokeColor(BRAND.line).lineWidth(0.5).stroke()
        .restore();

      const imgW = Math.min(colW - 20, box - 20);
      doc.image(chartBuf, M + colW + colGutter + (colW - imgW) / 2, rightTop + 10, { width: imgW });
      rightTop += box + 12;
    }

    // A light divider
    hRule(doc, M, Math.max(leftTop, rightTop) + 10, W - M * 2);

    // PAGE 2 — Signals
    doc.addPage();

    label(doc, M, 36, 'CTRL Snapshot — signals');
    sectionTitle(doc, M, 54, 'More signals from your five moments');
    body(doc, M, 74, 'These are descriptive, not a score. Use them as pointers for awareness.', 10.5, BRAND.ink600);

    // What the pattern suggests
    sectionTitle(doc, M, 110, 'What the pattern suggests');
    let cy = bulletList(doc, M, 130, journeyLines, { width: W - M * 2 });

    // Themes
    if (themeLines.length) {
      cy += 8;
      sectionTitle(doc, M, cy, 'Themes that kept showing up');
      cy += 20;
      cy = bulletList(doc, M, cy, themeLines, { width: W - M * 2 });
    }

    // Raw data
    cy += 8;
    sectionTitle(doc, M, cy, 'Raw data (for reference)');
    cy += 18;
    if (rawSequence) body(doc, M, cy, 'Sequence: ' + rawSequence, 10, BRAND.ink600); 
    if (rawCounts)   body(doc, M, doc.y + 2, 'Counts: ' + rawCounts, 10, BRAND.ink600);
    if (Array.isArray(rawPerQ) && rawPerQ.length) {
      cy = doc.y + 6;
      const lines = rawPerQ.slice(0, 5).map(it => {
        const th = Array.isArray(it.themes) && it.themes.length ? ` — themes: ${it.themes.join(', ')}` : '';
        return `${it.q || ''}: ${it.state || ''}${th}`;
      });
      cy = bulletList(doc, M, cy, lines, { width: W - M * 2, size: 10 });
    }

    // Next action (small callout)
    cy += 10;
    sectionTitle(doc, M, cy, 'A next action');
    cy += 16;
    const call = 'Choose one tiny thing you will try this week. Keep it under 60 seconds and repeat it once a day.';
    doc.save()
      .roundedRect(M, cy - 6, W - M * 2, 40, 8).fill(BRAND.plum100)
      .fillColor(BRAND.ink900).font('Helvetica').fontSize(10.5)
      .text(call, M + 12, cy, { width: W - M * 2 - 24 })
      .restore();

    doc.end();
  } catch (e) {
    console.error('[pdf] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
