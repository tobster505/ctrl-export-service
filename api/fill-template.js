// /api/fill-template.js — Fill your visual PDF using the template in /public
// ESM module (package.json has "type": "module")
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// -------- utilities ----------
const MAUVE_500 = rgb(0x73/255, 0x48/255, 0xC7/255); // #7348C7
const MAUVE_050 = rgb(0xF6/255, 0xF2/255, 0xFC/255); // very light background
const MAUVE_100 = rgb(0xED/255, 0xE7/255, 0xFA/255); // light section box
const GREY_700  = rgb(0x4A/255, 0x44/255, 0x58/255); // #4A4458
const GREY_900  = rgb(0x25/255, 0x23/255, 0x2B/255);

function squash(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function toLines(v) {
  if (Array.isArray(v)) return v.map(squash).filter(Boolean);
  return String(v ?? '')
    .split('\n')
    .map(s => squash(s).trim())
    .filter(Boolean);
}

function countsToLine(counts) {
  const c = counts?.C ?? 0, t = counts?.T ?? 0, r = counts?.R ?? 0, l = counts?.L ?? 0;
  return `C:${c}  T:${t}  R:${r}  L:${l}`;
}

// Simple word-wrapper using font metrics
function wrapText(text, font, fontSize, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';

  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      // too-long single word: hard break
      if (font.widthOfTextAtSize(w, fontSize) > maxWidth) {
        let cur = '';
        for (const ch of w) {
          const t2 = cur + ch;
          if (font.widthOfTextAtSize(t2, fontSize) <= maxWidth) cur = t2;
          else { if (cur) lines.push(cur); cur = ch; }
        }
        line = cur;
      } else {
        line = w;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Draw a text block, returns new Y top position after the block
function drawParagraph(page, text, { x, y, width, font, size, color = GREY_900, lineGap = 4 }) {
  const lines = wrapText(text, font, size, width);
  let cursorY = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: cursorY, size, font, color });
    cursorY -= (size + lineGap);
  }
  return cursorY;
}

// Rounded box helper
function drawRoundedRect(page, { x, y, w, h, r = 8, fill, stroke, opacity = 1 }) {
  // pdf-lib lacks path arcs, but we can fake with rectangles; for simplicity use straight corners here
  page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: stroke, opacity, borderOpacity: opacity, borderWidth: stroke ? 1 : 0 });
}

// ------------- handler -------------
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const hasTest = url.searchParams.has('test');
    const b64 = url.searchParams.get('data');

    // 1) Load template
    const templatePath = path.join(process.cwd(), 'public', 'CTRL_Perspective_template.pdf');
    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    // Fonts
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 2) Build / parse payload
    let payload;
    if (hasTest && !b64) {
      const sampleChartSpec = {
        type: 'radar',
        data: { labels: ['Concealed','Triggered','Regulated','Lead'], datasets: [{ label: 'Frequency', data: [1,3,1,0], fill: true }] },
        options: {
          plugins: { legend: { display: false } },
          scales: { r: { min:0, max:5, ticks: { display:true, stepSize:1, backdropColor:'rgba(0,0,0,0)' }, grid: { circular:true }, angleLines:{ display:true }, pointLabels:{ color:'#4A4458', font:{ size:12 } } } }
        }
      };
      const chartUrl = 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));

      payload = {
        title: 'CTRL — Your Snapshot',
        headline: 'You sit mostly in Triggered.',
        headlineMeaning: "Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.",
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
          'Lead didn’t show up in this snapshot (not "bad", just not present here).',
          'You started in Triggered and ended in Triggered — a steady line.',
          'You changed state 3 time(s) out of 4; longest run: Triggered × 2.'
        ],
        raw: {
          sequence: 'T T C R T',
          counts: { C:1, T:3, R:1, L:0 }
        }
      };
    } else {
      if (!b64) { res.status(400).send('Missing data'); return; }
      try { payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }
      catch { res.status(400).send('Invalid data'); return; }
    }

    // 3) Pull + sanitize fields
    const title            = squash(payload.title || 'CTRL — Snapshot');
    const headline         = squash(payload.headline || '');
    const headlineMeaning  = squash(payload.headlineMeaning || payload.how || '');
    const directionLabel   = squash(payload.directionLabel || '');
    const directionMeaning = squash(payload.directionMeaning || '');
    const themeLabel       = squash(payload.themeLabel || '');
    const themeMeaning     = squash(payload.themeMeaning || '');
    const tip1             = squash(payload.tip1 || '');
    const tip2             = squash(payload.tip2 || '');
    const journeyLines     = toLines(payload.journey);
    const chartUrl         = String(payload.chartUrl || '');
    const rawSeq           = squash(payload?.raw?.sequence || '');
    const rawCounts        = (typeof payload?.raw?.counts === 'object')
      ? countsToLine(payload.raw.counts)
      : squash(payload?.raw?.counts || '');

    // 4) Fetch chart image (bigger)
    let chartImage;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) {
          const arr = await r.arrayBuffer();
          // QuickChart returns PNG by default
          chartImage = await pdfDoc.embedPng(arr);
        }
      } catch { /* ignore chart failure */ }
    }

    // 5) Layout on first page (ignoring template’s built-in labels; we draw our own)
    const page = pdfDoc.getPage(0);
    const { width: PW, height: PH } = page.getSize();

    const margin = 44;
    let y = PH - margin;

    // Title row
    page.drawText('CTRL — Perspective Profile', {
      x: margin, y, size: 14, font: fontBold, color: MAUVE_500
    });
    y -= 24;

    // Section 1: Current state (boxed)
    const secPad = 12;
    let boxH = 90;
    drawRoundedRect(page, { x: margin, y: y - boxH, w: PW - margin*2, h: boxH, fill: MAUVE_100, stroke: null, opacity: 1 });

    let cursor = y - secPad;
    page.drawText('Your current state is', { x: margin + secPad, y: cursor, size: 10, font: fontBold, color: GREY_700 });
    cursor -= 18;

    cursor = drawParagraph(page, headline, {
      x: margin + secPad, y: cursor, width: PW - (margin + secPad)*2,
      font: fontBold, size: 16, color: GREY_900, lineGap: 4
    });

    cursor -= 6;
    cursor = drawParagraph(page, headlineMeaning, {
      x: margin + secPad, y: cursor, width: PW - (margin + secPad)*2,
      font: fontRegular, size: 11, color: GREY_900, lineGap: 4
    });

    y = y - boxH - 18;

    // Section 2: Chart (bigger)
    if (chartImage) {
      const chartW = Math.min(380, PW - margin*2);
      const chartH = chartW; // square
      page.drawText('Your chart looks like this', { x: margin, y, size: 10, font: fontBold, color: GREY_700 });
      y -= 12 + chartH;

      page.drawImage(chartImage, {
        x: margin, y,
        width: chartW, height: chartH
      });
      y -= 24;
    }

    // Section 3: Pattern + theme (boxed)
    boxH = 140;
    drawRoundedRect(page, { x: margin, y: y - boxH, w: PW - margin*2, h: boxH, fill: MAUVE_100 });

    cursor = y - secPad;
    page.drawText('What the pattern suggests', { x: margin + secPad, y: cursor, size: 10, font: fontBold, color: GREY_700 });
    cursor -= 16;

    // Direction
    if (directionLabel) {
      cursor = drawParagraph(page, `Direction — ${directionLabel}`, {
        x: margin + secPad, y: cursor, width: PW - (margin + secPad)*2,
        font: fontBold, size: 12, color: GREY_900, lineGap: 3
      });
      cursor = drawParagraph(page, directionMeaning, {
        x: margin + secPad, y: cursor - 2, width: PW - (margin + secPad)*2,
        font: fontRegular, size: 11, color: GREY_900, lineGap: 4
      });
      cursor -= 8;
    }

    // Theme
    if (themeLabel) {
      cursor = drawParagraph(page, `Theme — ${themeLabel}`, {
        x: margin + secPad, y: cursor, width: PW - (margin + secPad)*2,
        font: fontBold, size: 12, color: GREY_900, lineGap: 3
      });
      cursor = drawParagraph(page, themeMeaning, {
        x: margin + secPad, y: cursor - 2, width: PW - (margin + secPad)*2,
        font: fontRegular, size: 11, color: GREY_900, lineGap: 4
      });
    }

    y = y - boxH - 18;

    // Section 4: More signals (bullets)
    if (journeyLines.length) {
      page.drawText('More signals from your five moments', {
        x: margin, y, size: 10, font: fontBold, color: GREY_700
      });
      y -= 16;
      const bulletWidth = PW - margin*2 - 14;
      for (const line of journeyLines) {
        // bullet
        page.drawText('•', { x: margin, y, size: 11, font: fontBold, color: GREY_900 });
        y = drawParagraph(page, line, {
          x: margin + 14, y, width: bulletWidth,
          font: fontRegular, size: 11, color: GREY_900, lineGap: 3
        }) - 4;
      }
      y -= 4;
    }

    // Section 5: Raw (small)
    if (rawSeq || rawCounts) {
      const rawText = [
        rawSeq ? `Sequence: ${rawSeq}` : '',
        rawCounts ? `Counts: ${rawCounts}` : ''
      ].filter(Boolean).join('   •   ');
      y = drawParagraph(page, rawText, {
        x: margin, y, width: PW - margin*2,
        font: fontRegular, size: 9, color: GREY_700, lineGap: 2
      }) - 10;
    }

    // Section 6: Tips — two prominent boxes at the bottom
    const tipBoxH = 58;
    const tipGap  = 14;
    const tipW = (PW - margin*2 - tipGap) / 2;
    const tipY = Math.max(60, y - tipBoxH - 10); // don’t collide with footer

    // Left tip: Try this
    drawRoundedRect(page, { x: margin, y: tipY, w: tipW, h: tipBoxH, fill: MAUVE_100 });
    page.drawText('Try this', { x: margin + 12, y: tipY + tipBoxH - 18, size: 10, font: fontBold, color: MAUVE_500 });
    drawParagraph(page, tip1 || 'Take one slow breath before you speak.', {
      x: margin + 12, y: tipY + tipBoxH - 34, width: tipW - 24,
      font: fontRegular, size: 11, color: GREY_900, lineGap: 3
    });

    // Right tip: Try this next time
    const tipX2 = margin + tipW + tipGap;
    drawRoundedRect(page, { x: tipX2, y: tipY, w: tipW, h: tipBoxH, fill: MAUVE_100 });
    page.drawText('Try this next time', { x: tipX2 + 12, y: tipY + tipBoxH - 18, size: 10, font: fontBold, color: MAUVE_500 });
    drawParagraph(page, tip2 || 'Add a brief check-in between moments.', {
      x: tipX2 + 12, y: tipY + tipBoxH - 34, width: tipW - 24,
      font: fontRegular, size: 11, color: GREY_900, lineGap: 3
    });

    // 6) Output
    const name = String(url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[fill-template] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
