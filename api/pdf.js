// /api/pdf.js — CTRL PDF with boxed sections + big chart + prominent tips
// ESM module (package.json has "type": "module")
import PDFDocument from 'pdfkit';

// ---------- Helpers ----------
function squash(s) {
  // Keep text ASCII-safe and readable
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")    // curly single quotes → '
    .replace(/[\u201C\u201D]/g, '"')    // curly double quotes → "
    .replace(/[\u2013\u2014]/g, '-')    // en/em dash → -
    .replace(/\u00D7/g, 'x')            // multiplication sign × → x (prevents "Triggered  2" issue)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}
function toLines(v) {
  if (Array.isArray(v)) return v.map(squash).filter(Boolean);
  return String(v ?? '')
    .split('\n')
    .map(squash)
    .filter(Boolean);
}
function countsToLine(counts) {
  if (!counts || typeof counts !== 'object') return squash(String(counts ?? ''));
  const c = counts.C ?? 0, t = counts.T ?? 0, r = counts.R ?? 0, l = counts.L ?? 0;
  return `C:${c}  T:${t}  R:${r}  L:${l}`;
}

// ---------- Drawing helpers ----------
function drawSectionBox(doc, { x, y, w, title, lines, pad = 12, fill = '#F4F2F8', titleColor = '#2B2540', textColor = '#2B2540' }) {
  const textWidth = w - pad * 2;
  let h = 0;

  // Measure
  const titleH = title ? doc.font('Helvetica-Bold').fontSize(12).heightOfString(title, { width: textWidth }) : 0;
  h += title ? titleH + 6 : 0;

  doc.font('Helvetica').fontSize(11);
  for (const ln of (lines || [])) {
    h += doc.heightOfString(ln, { width: textWidth }) + 6;
  }
  h += pad * 2;

  // Box
  doc.save();
  doc.roundedRect(x, y, w, h, 8).fill(fill);
  doc.restore();

  // Content
  let ty = y + pad;
  if (title) {
    doc.fillColor(titleColor).font('Helvetica-Bold').fontSize(12).text(title, x + pad, ty, { width: textWidth });
    ty += titleH + 6;
  }
  doc.fillColor(textColor).font('Helvetica').fontSize(11);
  for (const ln of (lines || [])) {
    doc.text(ln, x + pad, ty, { width: textWidth });
    ty += doc.heightOfString(ln, { width: textWidth }) + 6;
  }

  return { boxHeight: h };
}

function drawTipBox(doc, { x, y, w, title, tip, pad = 12, fill = '#EDE8F8', titleColor = '#2B2540', accent = '#7348C7' }) {
  const textWidth = w - pad * 2;
  // Measure
  const titleH = title ? doc.font('Helvetica-Bold').fontSize(11).heightOfString(title, { width: textWidth }) : 0;
  doc.font('Helvetica').fontSize(11);
  const tipH = doc.heightOfString(tip, { width: textWidth });

  const h = pad + (title ? titleH + 6 : 0) + tipH + pad;

  // Box
  doc.save();
  doc.roundedRect(x, y, w, h, 8).fill(fill);
  doc.restore();

  // Title
  let ty = y + pad;
  if (title) {
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(11).text(title, x + pad, ty, { width: textWidth });
    ty += titleH + 6;
  }
  // Tip
  doc.fillColor('#2B2540').font('Helvetica').fontSize(11).text(tip, x + pad, ty, { width: textWidth });

  return { boxHeight: h };
}

export default async function handler(req, res) {
  try {
    // --------------------------------
    // 1) Parse query + payload as before
    // --------------------------------
    const url = new URL(req.url, 'http://localhost');
    const hasTest = url.searchParams.has('test');
    const b64 = url.searchParams.get('data');

    let payload;
    if (hasTest && !b64) {
      // Minimal sample payload (kept for smoke test)
      const sampleChartSpec = {
        type: 'radar',
        data: {
          labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
          datasets: [{ label: 'Frequency', data: [1, 3, 1, 0], fill: true }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { r: { min: 0, max: 5, ticks: { display: true, stepSize: 1, backdropColor: 'rgba(0,0,0,0)' }, grid: { circular: true }, angleLines: { display: true }, pointLabels: { font: { size: 12 } } } }
        }
      };
      const chartUrl = 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));
      payload = {
        title: 'CTRL — Your Snapshot',
        intro: 'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states. For a fuller view, try the other CTRL paths when you’re ready.',
        headline: 'You sit mostly in Triggered.',
        chartUrl,
        how: "You feel things fast and show it. Energy rises quickly. A brief pause or naming the wobble ('I’m on edge') often settles it.",
        // We’ll also accept tip1/tip2 if present (kept out of journey)
        tip1: 'Take one breath and name it: "I’m on edge."',
        tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
        journey: [
          'Direction: Steady — You started and ended in similar zones — steady overall.',
          'You touched three states: you can shift when needed; a brief pause helps you choose on purpose.',
          'Least seen: Lead — guiding wasn’t in focus; offer a simple next step or summary when it helps the group.',
          'Pattern: Varied responses without one rhythm.',
          'Switching: Three switches — high reactivity or agility; use a pause to make switches intentional. Longest run: Triggered x 2.',
          'Resilience: One upward recovery — evidence you can reset.',
          'Retreat: One slip — name it and reset.',
          'Early vs late: clearly steadier later on.'
        ],
        themesExplainer: [
          'Emotion regulation — Settling yourself when feelings spike.',
          'Social navigation — Reading the room and adjusting to people and context.',
          'Awareness of impact — Noticing how your words and actions land.'
        ],
        raw: {
          sequence: 'T T C R T',
          counts: { C:1, T:3, R:1, L:0 },
          perQuestion: [
            { q: 'Q1', state: 'T', themes: ['social_navigation','awareness_impact','emotion_regulation'] },
            { q: 'Q2', state: 'T', themes: ['stress_awareness','emotion_regulation','confidence_resilience'] },
            { q: 'Q3', state: 'C', themes: ['feedback_handling','awareness_impact','emotion_regulation'] },
            { q: 'Q4', state: 'R', themes: ['feedback_handling','confidence_resilience','intent_awareness'] },
            { q: 'Q5', state: 'T', themes: ['social_navigation','boundary_awareness','awareness_intent'] }
          ]
        }
      };
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

    // --------------------------------
    // 2) Extract fields (with fallbacks)
    // --------------------------------
    const name = String(url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');

    const title     = squash(payload.title   ?? 'CTRL — Snapshot');
    const intro     = squash(payload.intro   ?? '');
    const headline  = squash(payload.headline ?? '');
    const how       = squash(payload.how     ?? '');
    const chartUrl  = String(payload.chartUrl || '');

    // Tips: prefer explicit tip1/tip2, else parse a "Tips: a | b" line out of journey
    let tip1 = squash(payload.tip1 ?? '');
    let tip2 = squash(payload.tip2 ?? '');

    let journeyLines = toLines(payload.journey);
    if ((!tip1 || !tip2) && journeyLines.length) {
      const tipsIdx = journeyLines.findIndex(l => /^tips\s*:/i.test(l));
      if (tipsIdx >= 0) {
        const raw = journeyLines.splice(tipsIdx, 1)[0]; // remove tips line from journey
        const parts = raw.replace(/^tips\s*:\s*/i, '').split('|').map(s => squash(s.trim())).filter(Boolean);
        if (!tip1 && parts[0]) tip1 = parts[0];
        if (!tip2 && parts[1]) tip2 = parts[1];
      }
    }
    // Always ensure two short tips exist
    if (!tip1) tip1 = 'Take one slow breath before you speak.';
    if (!tip2) tip2 = 'Add a 30-second check: “What does this moment need?”';

    const themeLines = toLines(payload.themesExplainer);

    const raw = payload.raw || {};
    const rawSequence = squash(raw.sequence ?? '');
    const rawCounts   = countsToLine(raw.counts);
    const rawPerQ     = Array.isArray(raw.perQuestion) ? raw.perQuestion : [];

    // --------------------------------
    // 3) Fetch chart image (bigger)
    // --------------------------------
    let chartBuf = null;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) chartBuf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        console.warn('[pdf] chart fetch failed:', e?.message || e);
      }
    }

    // --------------------------------
    // 4) Build the PDF (boxed layout)
    // --------------------------------
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right; // ~515
    let cursorY = doc.page.margins.top;

    // Header
    doc.fillColor('#2B2540').font('Helvetica-Bold').fontSize(18).text(squash(title), { width: pageW });
    cursorY = doc.y + 8;

    if (intro) {
      // Intro box
      const { boxHeight } = drawSectionBox(doc, {
        x: doc.page.margins.left, y: cursorY, w: pageW,
        title: null,
        lines: [intro],
        pad: 12,
        fill: '#F4F2F8'
      });
      cursorY += boxHeight + 12;
    }

    // Headline (outside a box for emphasis)
    if (headline) {
      doc.fillColor('#2B2540').font('Helvetica-Bold').fontSize(14).text(squash(headline), doc.page.margins.left, cursorY);
      cursorY = doc.y + 8;
    }

    // Chart (bigger)
    if (chartBuf) {
      const imgW = Math.min(460, pageW); // larger radar
      doc.image(chartBuf, doc.page.margins.left, cursorY, { width: imgW, height: imgW });
      cursorY += imgW + 14;
    }

    // "How this tends to show up"
    if (how) {
      const { boxHeight } = drawSectionBox(doc, {
        x: doc.page.margins.left, y: cursorY, w: pageW,
        title: 'How this tends to show up',
        lines: [how],
        pad: 12,
        fill: '#F4F2F8'
      });
      cursorY += boxHeight + 12;
    }

    // From journey, pick the first line that starts with "Direction:" for a small box
    const dirLineIdx = journeyLines.findIndex(l => /^direction\b/i.test(l));
    if (dirLineIdx >= 0) {
      const { boxHeight } = drawSectionBox(doc, {
        x: doc.page.margins.left, y: cursorY, w: pageW,
        title: 'Direction of travel',
        lines: [journeyLines[dirLineIdx].replace(/^direction:\s*/i, '')],
        pad: 12,
        fill: '#F4F2F8'
      });
      cursorY += boxHeight + 12;
      journeyLines.splice(dirLineIdx, 1);
    }

    // Theme in focus: take the first theme as the “focus”
    if (themeLines.length) {
      const firstTheme = themeLines[0];
      const { boxHeight } = drawSectionBox(doc, {
        x: doc.page.margins.left, y: cursorY, w: pageW,
        title: 'Theme in focus',
        lines: [firstTheme],
        pad: 12,
        fill: '#F4F2F8'
      });
      cursorY += boxHeight + 16;
    }

    // Two tip boxes side-by-side
    const colGap = 12;
    const colW = (pageW - colGap) / 2;
    // If not enough vertical space for both tip boxes, new page
    const minTipBoxH = 80; // rough min
    if (cursorY + minTipBoxH > (doc.page.height - doc.page.margins.bottom - 120)) {
      doc.addPage();
      cursorY = doc.page.margins.top;
    }

    const leftTip  = drawTipBox(doc, { x: doc.page.margins.left, y: cursorY, w: colW, title: 'Try this', tip: tip1 });
    const rightTip = drawTipBox(doc, { x: doc.page.margins.left + colW + colGap, y: cursorY, w: colW, title: 'Try this next time', tip: tip2 });
    const tipsH = Math.max(leftTip.boxHeight, rightTip.boxHeight);
    cursorY += tipsH + 18;

    // --- PAGE 2: More signals ---
    doc.addPage();
    cursorY = doc.page.margins.top;

    doc.fillColor('#2B2540').font('Helvetica-Bold').fontSize(14).text('More signals from your five moments', doc.page.margins.left, cursorY);
    doc.moveDown(0.4);
    doc.fillColor('#4A4458').font('Helvetica').fontSize(10)
      .text('These are descriptive, not a score. Use them as pointers for awareness.');
    cursorY = doc.y + 10;

    // What the pattern suggests (boxed list from the rest of journey lines)
    if (journeyLines.length) {
      const pretty = journeyLines.map(s => s.replace(/^-\s*/, ''));

      // Split into bullet paragraphs (we’ll prefix with "• " but keep ASCII)
      const para = pretty.map(s => '• ' + s);
      const { boxHeight } = drawSectionBox(doc, {
        x: doc.page.margins.left, y: cursorY, w: pageW,
        title: 'What the pattern suggests',
        lines: para,
        pad: 12,
        fill: '#F4F2F8'
      });
      cursorY += boxHeight + 12;
    }

    // Themes that kept showing up
    if (themeLines.length) {
      const bullets = themeLines.map(s => '• ' + s);
      const { boxHeight } = drawSectionBox(doc, {
        x: doc.page.margins.left, y: cursorY, w: pageW,
        title: 'Themes that kept showing up',
        lines: bullets,
        pad: 12,
        fill: '#F4F2F8'
      });
      cursorY += boxHeight + 12;
    }

    // Raw data (sequence + counts + perQ)
    const rawLines = [];
    if (rawSequence) rawLines.push('Sequence: ' + rawSequence);
    if (rawCounts)   rawLines.push('Counts: ' + rawCounts);
    if (rawPerQ.length) {
      for (const item of rawPerQ.slice(0, 5)) {
        const themesStr = Array.isArray(item.themes) && item.themes.length
          ? ` — themes: ${item.themes.join(', ')}`
          : '';
        rawLines.push(`${item.q || ''}: ${item.state || ''}${themesStr}`);
      }
    }
    if (rawLines.length) {
      const { boxHeight } = drawSectionBox(doc, {
        x: doc.page.margins.left, y: cursorY, w: pageW,
        title: 'Raw data (for reference)',
        lines: rawLines,
        pad: 12,
        fill: '#F4F2F8'
      });
      cursorY += boxHeight + 12;
    }

    // A next action
    const nextAction = 'Choose one tiny thing you will try this week. Keep it under 60 seconds and repeat it once a day.';
    drawSectionBox(doc, {
      x: doc.page.margins.left, y: cursorY, w: pageW,
      title: 'A next action',
      lines: [nextAction],
      pad: 12,
      fill: '#F4F2F8'
    });

    doc.end();
  } catch (e) {
    console.error('[pdf] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
