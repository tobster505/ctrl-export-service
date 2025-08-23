// /api/fill-template.js
// Fills your static template PDF with text + radar image using pdf-lib.
// Usage:
//   1) Smoke test with sample data:
//      https://ctrl-export-service.vercel.app/api/fill-template?test=1
//   2) Real data from Botpress:
//      https://ctrl-export-service.vercel.app/api/fill-template?name=ctrl_report.pdf&data=<base64-json>
//
// JSON payload shape (base64):
// {
//   "title": "CTRL — Assessment: Your Snapshot",
//   "intro": "...",
//   "headline": "You sit mostly in Triggered.",
//   "how": "…",
//   "directionLabel": "Steady",
//   "directionMeaning": "You started and ended in similar zones — steady overall.",
//   "themeLabel": "Emotion regulation",
//   "themeMeaning": "Settling yourself when feelings spike.",
//   "patternLine": "A mix of moves without a single rhythm.",
//   "patternDetail": "You changed state 2 times; longest run: Triggered × 2.",
//   "tip1Title": "Try this",
//   "tip1": "Take one breath and name it: “I’m on edge.”",
//   "tip2Title": "Try this next time",
//   "tip2": "Choose your gear on purpose…",
//   "chartUrl": "https://quickchart.io/chart?..."
// }

import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- helpers ----------
function squash(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}
// naive word-wrap into lines that fit width using the font metrics
function wrapText(text, font, fontSize, maxWidth) {
  const words = squash(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const isTest = url.searchParams.has('test');
    const name = (url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    let payload;

    if (isTest) {
      // --- sample dataset for quick check ---
      payload = {
        title: 'CTRL — Assessment: Your Snapshot',
        intro: 'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states.',
        headline: 'You sit mostly in Triggered.',
        how: 'Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.',
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones — steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        patternLine: 'A mix of moves without a single rhythm.',
        patternDetail: 'You changed state 2 times; longest run: Triggered × 2.',
        tip1Title: 'Try this',
        tip1: 'Take one breath and name it: "I’m on edge."',
        tip2Title: 'Try this next time',
        tip2: 'Choose your gear on purpose — protect, steady, or lead — say it in one line.',
        chartUrl:
          'https://quickchart.io/chart?v=4&c=' +
          encodeURIComponent(
            JSON.stringify({
              type: 'radar',
              data: {
                labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
                datasets: [
                  {
                    label: 'Frequency',
                    data: [2, 3, 0, 0],
                    fill: true,
                    backgroundColor: 'rgba(115,72,199,0.18)',
                    borderColor: '#7348C7',
                    borderWidth: 2,
                    pointRadius: [3, 6, 0, 0],
                    pointBackgroundColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
                    pointBorderColor:   ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
                  },
                ],
              },
              options: {
                plugins: { legend: { display: false } },
                scales: {
                  r: {
                    min: 0,
                    max: 5,
                    ticks: { display: true, stepSize: 1, backdropColor: 'rgba(0,0,0,0)' },
                    grid: { circular: true },
                    angleLines: { display: true },
                    pointLabels: { color: '#4A4458', font: { size: 12 } },
                  },
                },
              },
            })
          ),
      };
    } else {
      const b64 = url.searchParams.get('data');
      if (!b64) {
        res.statusCode = 400;
        res.end('Missing data');
        return;
      }
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        res.statusCode = 400;
        res.end('Invalid data');
        return;
      }
    }

    // ---------- load template ----------
    const templateBytes = await readFile('public/CTRL_Perspective_template.pdf');
    const pdfDoc = await PDFDocument.load(templateBytes);

    // fonts
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const page = pdfDoc.getPage(0);
    const pageH = page.getHeight();

    // ---------- layout map (tweak here) ----------
    // All Y values below are from the TOP edge down (easier to reason about).
    // We convert to PDF coordinates (bottom-left) when drawing.
    const BOX = {
      // header block
      title:           { x: 38,  top: 48,  w: 520, size: 20, bold: true },
      intro:           { x: 38,  top: 78,  w: 520, size: 10.5, lh: 13.5 },

      // "Your current state" box
      headline:        { x: 38,  top: 128, w: 520, size: 12.5, bold: true },
      how:             { x: 38,  top: 145, w: 520, size: 10.5, lh: 13.5 },

      // middle row
      radar:           { x: 44,  top: 210, w: 250, h: 250 }, // make bigger by increasing w/h
      directionTitle:  { x: 320, top: 210, w: 230, size: 12, bold: true },
      directionBody:   { x: 320, top: 228, w: 230, size: 10.5, lh: 13.5 },
      themeTitle:      { x: 320, top: 268, w: 230, size: 12, bold: true },
      themeBody:       { x: 320, top: 286, w: 230, size: 10.5, lh: 13.5 },

      // pattern section
      patternTitle:    { x: 38,  top: 350, w: 520, size: 12, bold: true },
      patternLine:     { x: 38,  top: 368, w: 520, size: 10.5, lh: 13.5 },
      patternDetail:   { x: 38,  top: 386, w: 520, size: 10.5, lh: 13.5 },

      // tips row
      tip1Title:       { x: 38,  top: 430, w: 360, size: 12, bold: true },
      tip1:            { x: 38,  top: 448, w: 360, size: 11.5, lh: 15 },
      tip2Title:       { x: 418, top: 430, w: 200, size: 12, bold: true },
      tip2:            { x: 418, top: 448, w: 200, size: 11.5, lh: 15 },
    };

    // convert "top-down" Y to pdf-lib coordinate
    const Y = (top) => pageH - top;

    // draw paragraph helper
    function drawPara(txt, box, bold = false) {
      if (!txt) return;
      const f = bold ? fontBold : fontReg;
      const size = box.size || 11;
      const lh = box.lh || (size * 1.25);
      const lines = wrapText(txt, f, size, box.w);
      let y = Y(box.top);
      for (const line of lines) {
        page.drawText(line, { x: box.x, y, size, font: f, color: rgb(0.11, 0.1, 0.13) });
        y -= lh;
      }
    }

    // ---------- draw content ----------
    drawPara(payload.title, BOX.title, true);
    drawPara(payload.intro, BOX.intro);

    drawPara(payload.headline, BOX.headline, true);
    drawPara(payload.how, BOX.how);

    drawPara(payload.directionLabel, BOX.directionTitle, true);
    drawPara(payload.directionMeaning, BOX.directionBody);
    drawPara(payload.themeLabel, BOX.themeTitle, true);
    drawPara(payload.themeMeaning, BOX.themeBody);

    drawPara('What the pattern suggests', BOX.patternTitle, true);
    drawPara(payload.patternLine || '', BOX.patternLine);
    drawPara(payload.patternDetail || '', BOX.patternDetail);

    drawPara(payload.tip1Title || 'Try this', BOX.tip1Title, true);
    drawPara(payload.tip1 || '', BOX.tip1, false);
    drawPara(payload.tip2Title || 'Try this next time', BOX.tip2Title, true);
    drawPara(payload.tip2 || '', BOX.tip2, false);

    // ---------- embed radar image (if provided) ----------
    if (payload.chartUrl) {
      try {
        const r = await fetch(String(payload.chartUrl));
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          let img;
          try {
            img = await pdfDoc.embedPng(buf);
          } catch {
            img = await pdfDoc.embedJpg(buf);
          }
          const { width, height } = img.scale(1);
          // fit into box while keeping aspect ratio
          const s = Math.min(BOX.radar.w / width, BOX.radar.h / height);
          const w = width * s;
          const h = height * s;
          page.drawImage(img, { x: BOX.radar.x, y: Y(BOX.radar.top) - h, width: w, height: h });
        }
      } catch (e) {
        console.warn('[fill-template] chart fetch failed:', e?.message || e);
      }
    }

    // ---------- send PDF ----------
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.end(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[fill-template] error:', e);
    res.statusCode = 500;
    res.end('Error generating PDF: ' + (e?.message || String(e)));
  }
}
