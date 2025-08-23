// /api/fill-template.js
// Node (ESM) serverless function for Vercel
// Uses pdf-lib to render either:
//  - a smoke-test, layout-from-code PDF (?test=1)
//  - or your template PDF from /public/CTRL_Perspective_template.pdf overlaid with data (?data=base64json)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- Utilities ----------
const squash = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return rgb(0, 0, 0);
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  return rgb(r, g, b);
}

// Rounded box helper — only sets border if provided (fix for pdf-lib borderColor=null error)
function drawRoundedRect(page, { x, y, w, h, r = 8, fill, stroke, opacity = 1 }) {
  const opts = { x, y, width: w, height: h, opacity };
  if (fill) opts.color = fill;
  if (stroke) {
    opts.borderColor = stroke;
    opts.borderWidth = 1;
    opts.borderOpacity = opacity;
  }
  page.drawRectangle(opts);
}

// Text wrapping helper
function wrapText({ text, font, size, maxWidth }) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Place a titled section box (fills + title + body)
function drawSection({
  page,
  title,
  body,
  x,
  y,
  w,
  h,
  fonts,
  colors,
  withFrame = true,
}) {
  const { reg, bold } = fonts;
  const { ink, boxFill, boxStroke, accent } = colors;

  if (withFrame) {
    drawRoundedRect(page, {
      x,
      y,
      w,
      h,
      r: 10,
      fill: boxFill,
      stroke: boxStroke,
      opacity: 1,
    });
  }

  const pad = 14;
  const titleY = y + h - pad - 4;
  page.drawText(squash(title || ''), {
    x: x + pad,
    y: titleY,
    size: 12,
    font: bold,
    color: accent,
  });

  const bodyTop = titleY - 18;
  const bodyWidth = w - pad * 2;
  const lines = wrapText({
    text: squash(body || ''),
    font: reg,
    size: 10.5,
    maxWidth: bodyWidth,
  });

  let cursorY = bodyTop;
  for (const ln of lines) {
    if (cursorY < y + pad) break; // safety: don’t overflow the box
    page.drawText(ln, {
      x: x + pad,
      y: cursorY,
      size: 10.5,
      font: reg,
      color: ink,
    });
    cursorY -= 14;
  }
}

// Try to embed a PNG; if not, fallback to JPG
async function embedChartImage(doc, imgBytes) {
  try {
    return await doc.embedPng(imgBytes);
  } catch {
    return await doc.embedJpg(imgBytes);
  }
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const isSmoke = url.searchParams.has('test');
    const b64 = url.searchParams.get('data');

    // Colors (single-hue mauve)
    const COLORS = {
      ink: hexToRgb('#2E2A36'),
      accent: hexToRgb('#7348C7'),   // mauve-500
      accentLight: hexToRgb('#9D7BE0'), // mauve-400
      boxFill: hexToRgb('#F5F2FB'),  // very light mauve background
      boxStroke: hexToRgb('#E2DAF6') // subtle line
    };

    // -------- Build payload --------
    let payload;
    if (isSmoke && !b64) {
      // Sample payload for quick testing
      const sampleChartSpec = {
        type: 'radar',
        data: {
          labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
          datasets: [
            {
              label: 'Frequency',
              data: [1, 3, 1, 0],
              fill: true,
              backgroundColor: 'rgba(115,72,199,0.18)',
              borderColor: '#7348C7',
              borderWidth: 2,
              pointRadius: [3, 6, 3, 0],
              pointBackgroundColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
            },
          ],
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
      const chartUrl =
        'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));

      payload = {
        name: 'ctrl_report.pdf',
        title: 'CTRL — Your Snapshot',
        intro:
          'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states.',
        headline: 'You sit mostly in Triggered.',
        meaning:
          "Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.",
        chartUrl,
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones — steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        tips: {
          primary: 'Take one breath and name it: “I’m on edge.”',
          next: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
        },
        patternNote:
          'A mix of moves without a single rhythm. You changed state 2 times; longest run: Triggered × 2.',
        raw: {
          sequence: 'T T C R T',
          counts: { C: 1, T: 3, R: 1, L: 0 },
        },
      };
    } else {
      if (!b64) {
        res.status(400).send('Missing data');
        return;
      }
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        res.status(400).send('Invalid data');
        return;
      }
    }

    // -------- Fetch assets --------
    const name = String(payload.name || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    const chartUrl = String(payload.chartUrl || '');
    let chartBytes = null;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) chartBytes = await r.arrayBuffer();
      } catch { /* ignore chart errors */ }
    }

    // Try to load your template from /public
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || 'ctrl-export-service.vercel.app';
    const templateUrl = `${proto}://${host}/CTRL_Perspective_template.pdf`;

    let useTemplate = false;
    let templateBytes = null;
    try {
      const tr = await fetch(templateUrl, { cache: 'no-store' });
      if (tr.ok) {
        templateBytes = await tr.arrayBuffer();
        useTemplate = true;
      }
    } catch {
      useTemplate = false;
    }

    // -------- Create the PDF --------
    let doc, page;
    let reg, bold;

    if (useTemplate) {
      doc = await PDFDocument.load(templateBytes);
      reg = await doc.embedFont(StandardFonts.Helvetica);
      bold = await doc.embedFont(StandardFonts.HelveticaBold);
      page = doc.getPages()[0];
    } else {
      // Layout-from-code (smoke or fallback)
      doc = await PDFDocument.create();
      reg = await doc.embedFont(StandardFonts.Helvetica);
      bold = await doc.embedFont(StandardFonts.HelveticaBold);
      page = doc.addPage([595.28, 841.89]); // A4 portrait in points
      // light background frame
      drawRoundedRect(page, {
        x: 24,
        y: 24,
        w: 595.28 - 48,
        h: 841.89 - 48,
        r: 12,
        fill: hexToRgb('#FFFFFF'),
        stroke: hexToRgb('#F0EEF8'),
        opacity: 1,
      });
    }

    const fonts = { reg, bold };
    const colors = {
      ink: COLORS.ink,
      accent: COLORS.accent,
      boxFill: COLORS.boxFill,
      boxStroke: COLORS.boxStroke,
    };

    // -------- Coordinates (tweak as you like) --------
    const marginX = 40;
    const pageW = page.getWidth();
    const pageH = page.getHeight();

    // Title
    page.drawText(squash(payload.title || 'CTRL — Snapshot'), {
      x: marginX,
      y: pageH - 60,
      size: 18,
      font: bold,
      color: colors.ink,
    });

    // Intro
    const introY = pageH - 90;
    const introLines = wrapText({
      text: squash(payload.intro || ''),
      font: reg,
      size: 11,
      maxWidth: pageW - marginX * 2,
    });
    let cursorY = introY;
    for (const ln of introLines) {
      page.drawText(ln, {
        x: marginX,
        y: cursorY,
        size: 11,
        font: reg,
        color: colors.ink,
      });
      cursorY -= 14;
    }

    // Headline Box (meaning)
    drawSection({
      page,
      title: 'Your current state',
      body: `${squash(payload.headline || '')}\n\n${squash(payload.meaning || '')}`,
      x: marginX,
      y: cursorY - 110,
      w: pageW - marginX * 2,
      h: 100,
      fonts,
      colors,
    });

    // Chart + Side facts row
    const chartTop = cursorY - 130 - 250; // chart area height 250
    const chartX = marginX;
    const chartW = 280;
    const chartH = 250;

    // Chart container
    drawRoundedRect(page, {
      x: chartX,
      y: chartTop,
      w: chartW,
      h: chartH,
      r: 10,
      fill: hexToRgb('#FFFFFF'),
      stroke: colors.boxStroke,
      opacity: 1,
    });
    page.drawText('CTRL Radar', {
      x: chartX + 12,
      y: chartTop + chartH - 20,
      size: 12,
      font: bold,
      color: colors.accent,
    });

    if (chartBytes) {
      const img = await embedChartImage(doc, chartBytes);
      const dims = img.scaleToFit(chartW - 24, chartH - 36);
      page.drawImage(img, {
        x: chartX + (chartW - dims.width) / 2,
        y: chartTop + 12,
        width: dims.width,
        height: dims.height,
        opacity: 1,
      });
    } else {
      // Placeholder
      page.drawText('Chart unavailable', {
        x: chartX + 12,
        y: chartTop + chartH / 2,
        size: 10,
        font: reg,
        color: colors.ink,
      });
    }

    // Right column boxes (Direction, Theme)
    const rightX = chartX + chartW + 16;
    const rightW = pageW - marginX - rightX;

    drawSection({
      page,
      title: 'Direction of travel',
      body: `${squash(payload.directionLabel || '')}\n${squash(payload.directionMeaning || '')}`,
      x: rightX,
      y: chartTop + chartH - 110,
      w: rightW,
      h: 100,
      fonts,
      colors,
    });

    drawSection({
      page,
      title: 'Theme in focus',
      body: `${squash(payload.themeLabel || '')}\n${squash(payload.themeMeaning || '')}`,
      x: rightX,
      y: chartTop + chartH - 230,
      w: rightW,
      h: 110,
      fonts,
      colors,
    });

    // Pattern / Journey notes (wide box)
    drawSection({
      page,
      title: 'What the pattern suggests',
      body: squash(payload.patternNote || ''),
      x: marginX,
      y: chartTop - 90,
      w: pageW - marginX * 2,
      h: 80,
      fonts,
      colors,
    });

    // Two Tips (prominent)
    const tipsBoxH = 96;
    drawSection({
      page,
      title: 'Try this',
      body: squash(payload.tips?.primary || ''),
      x: marginX,
      y: chartTop - 90 - 16 - tipsBoxH,
      w: (pageW - marginX * 2 - 12) / 2,
      h: tipsBoxH,
      fonts,
      colors: {
        ...colors,
        boxFill: hexToRgb('#EFE7FF'),
        boxStroke: hexToRgb('#D7C7FB'),
        accent: colors.accent,
      },
    });

    drawSection({
      page,
      title: "Try this next time",
      body: squash(payload.tips?.next || ''),
      x: marginX + (pageW - marginX * 2 - 12) / 2 + 12,
      y: chartTop - 90 - 16 - tipsBoxH,
      w: (pageW - marginX * 2 - 12) / 2,
      h: tipsBoxH,
      fonts,
      colors: {
        ...colors,
        boxFill: hexToRgb('#EFE7FF'),
        boxStroke: hexToRgb('#D7C7FB'),
        accent: colors.accent,
      },
    });

    // (Optional) Raw footer
    const raw = payload.raw || {};
    const rawLine =
      'Sequence: ' +
      squash(raw.sequence || '-') +
      '   Counts: ' +
      (typeof raw.counts === 'object'
        ? `C:${raw.counts?.C ?? 0} T:${raw.counts?.T ?? 0} R:${raw.counts?.R ?? 0} L:${raw.counts?.L ?? 0}`
        : squash(String(raw.counts || '')));
    page.drawText(rawLine, {
      x: marginX,
      y: 36,
      size: 9,
      font: reg,
      color: hexToRgb('#5C566C'),
    });

    // -------- Send PDF --------
    const pdfBytes = await doc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[fill-template] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
