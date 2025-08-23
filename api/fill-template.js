// /api/fill-template.js
// ESM on Vercel (package.json has "type": "module")
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';

// -----------------------------
// 0) Tweakable layout constants
//    A4 page ~ 595 x 842 pts, origin bottom-left
//    Adjust these numbers to fine-tune placement.
// -----------------------------
const POS = {
  // Header cluster (top-left block)
  headlineState:   { x: 120, y: 460, w: 350, lineGap: 18, size: 28, color: rgb(0.18, 0.16, 0.31) },
  headlineMeaning: { x: 64, y: 674, w: 300, lineGap: 13, size: 10.5, color: rgb(0.29, 0.27, 0.35) },

  // Radar chart area (top-right)
  chartBox: { x: 330, y: 505, w: 220, h: 220 }, // image will scale to fit square

  // Direction (left column, mid)
  directionLabel:   { x: 64,  y: 600, w: 300, lineGap: 14, size: 11.5, color: rgb(0.18, 0.16, 0.31) },
  directionMeaning: { x: 64,  y: 578, w: 300, lineGap: 13, size: 10.5, color: rgb(0.29, 0.27, 0.35) },

  // Theme (left column, below direction)
  themeLabel:   { x: 64,  y: 540, w: 300, lineGap: 14, size: 11.5, color: rgb(0.18, 0.16, 0.31) },
  themeMeaning: { x: 64,  y: 518, w: 300, lineGap: 13, size: 10.5, color: rgb(0.29, 0.27, 0.35) },

  // Tips (two boxes on first page)
  tip1Title: { x: 64,  y: 292, w: 220, lineGap: 14, size: 11.5, color: rgb(0.18, 0.16, 0.31) }, // "Try this"
  tip1Body:  { x: 64,  y: 270, w: 220, lineGap: 13, size: 10.5, color: rgb(0.29, 0.27, 0.35) },

  tip2Title: { x: 311, y: 292, w: 220, lineGap: 14, size: 11.5, color: rgb(0.18, 0.16, 0.31) }, // "Next time"
  tip2Body:  { x: 311, y: 270, w: 220, lineGap: 13, size: 10.5, color: rgb(0.29, 0.27, 0.35) },

  // Optional "pattern" & "themes" paragraphs (page 2 top)
  patternPara: { x: 64, y: 740, w: 470, lineGap: 14, size: 11, color: rgb(0.22, 0.2, 0.28) },
  themesPara:  { x: 64, y: 702, w: 470, lineGap: 14, size: 11, color: rgb(0.22, 0.2, 0.28) },

  // Footer (page 1)
  footer: { margin: 36, y: 28, size: 8, color: rgb(0.38, 0.38, 0.42), lineGap: 10 },
};

// -----------------------------
// 1) Helpers
// -----------------------------
const ascii = (s) =>
  String(s ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2013|\u2014/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // keep ASCII to avoid font-glyph issues

function wrapLines(font, text, maxWidth, fontSize) {
  const words = ascii(text).split(/\s+/);
  const lines = [];
  let line = '';

  for (const w of words) {
    const tryLine = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(tryLine, fontSize) <= maxWidth) {
      line = tryLine;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextBox(page, font, text, cfg, opts = {}) {
  const { x, y, w, lineGap, size, color } = cfg;
  const maxLines = opts.maxLines || 8;
  const lines = wrapLines(font, text, w, size);
  let cursorY = y;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    page.drawText(lines[i], { x, y: cursorY, size, font, color });
    cursorY -= lineGap;
  }
  if (lines.length > maxLines && opts.ellipsis) {
    page.drawText('…', { x, y: cursorY, size, font, color });
  }
}

function drawWrappedCenter(page, font, text, x, y, maxWidth, lineGap, size, color) {
  const lines = wrapLines(font, text, maxWidth, size);
  let cursorY = y;
  for (const ln of lines) {
    const width = font.widthOfTextAtSize(ln, size);
    const startX = x + (maxWidth - width) / 2;
    page.drawText(ln, { x: startX, y: cursorY, size, font, color });
    cursorY -= lineGap;
  }
}

async function fetchArrayBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  const buf = await r.arrayBuffer();
  return buf;
}

async function loadTemplateBytes(req) {
  // 1) Try local FS (public/CTRL_Perspective_template.pdf)
  try {
    const fsBytes = await fs.readFile(process.cwd() + '/public/CTRL_Perspective_template.pdf');
    if (fsBytes?.length) return fsBytes;
  } catch { /* ignore; fall back to HTTP */ }

  // 2) HTTP fallback (uses deployed URL)
  const host =
    req.headers['x-forwarded-host'] ||
    req.headers.host ||
    'ctrl-export-service.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  return await fetchArrayBuffer(url);
}

function decodeB64Json(b64) {
  const s = Buffer.from(String(b64), 'base64').toString('utf8');
  return JSON.parse(s);
}

// -----------------------------
// 2) Route handler
// -----------------------------
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const isTest = url.searchParams.has('test');
    const name = String(url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    let payload;

    if (isTest) {
      // --- Sample payload that matches your Botpress fields ---
      const sampleChartSpec = {
        type: 'radar',
        data: {
          labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
          datasets: [
            {
              label: 'Frequency',
              data: [1, 3, 1, 0],
              fill: true,
              backgroundColor: 'rgba(115, 72, 199, 0.18)',
              borderColor: '#7348C7',
              borderWidth: 2,
              pointRadius: [3, 6, 3, 0],
              pointHoverRadius: [4, 7, 4, 0],
              pointBackgroundColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
              pointBorderColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
            },
            {
              label: '',
              data: [0, 3, 0, 0],
              fill: false,
              borderWidth: 0,
              pointRadius: [0, 9, 0, 0],
              pointStyle: 'rectRot',
              pointBackgroundColor: '#7348C7',
              pointBorderColor: '#7348C7',
            }
          ]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            r: {
              min: 0, max: 5,
              ticks: { display: true, stepSize: 1, backdropColor: 'rgba(0,0,0,0)' },
              grid: { circular: true },
              angleLines: { display: true },
              pointLabels: { color: '#4A4458', font: { size: 12 } }
            }
          }
        }
      };
      const chartUrl = 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));

      payload = {
        // page-1 core
        headline: 'Triggered',
        headlineMeaning: 'Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.',
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones — steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        tip1Title: 'Try this',
        tip1: 'Take one breath and name it: "I\'m on edge."',
        tip2Title: 'Next time',
        tip2: 'Choose your gear on purpose: protect, steady, or lead — say it in one line.',
        chartUrl,

        // optional page-2 paragraphs
        patternPara: 'Overall you used a mix of moves without a single rhythm. That’s fine—use a tiny pause between moments to choose your next response.',
        themesPara: 'Most frequent themes: emotion regulation, social navigation, awareness of impact.',

        // raw (not drawn here unless you add more)
        raw: { sequence: 'T T C R T', counts: 'C:1  T:3  R:1  L:0' },
      };
    } else {
      const b64 = url.searchParams.get('data');
      if (!b64) { res.status(400).send('Missing data'); return; }
      try {
        payload = decodeB64Json(b64);
      } catch {
        res.status(400).send('Invalid data'); return;
      }
    }

    // -----------------------------
    // 3) Load template + fonts
    // -----------------------------
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });

    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // -----------------------------
    // 4) Page 1 (draw dynamic bits)
    // -----------------------------
    const page1 = pdfDoc.getPages()[0];

    // Headline (state) + meaning
    if (payload.headline) {
      drawTextBox(page1, helvBold, payload.headline, POS.headlineState, { maxLines: 1, ellipsis: true });
    }
    if (payload.headlineMeaning) {
      drawTextBox(page1, helv, payload.headlineMeaning, POS.headlineMeaning, { maxLines: 5, ellipsis: true });
    }

    // Direction label + meaning
    if (payload.directionLabel) {
      drawTextBox(page1, helvBold, payload.directionLabel, POS.directionLabel, { maxLines: 1, ellipsis: true });
    }
    if (payload.directionMeaning) {
      drawTextBox(page1, helv, payload.directionMeaning, POS.directionMeaning, { maxLines: 3, ellipsis: true });
    }

    // Theme label + meaning
    if (payload.themeLabel) {
      drawTextBox(page1, helvBold, payload.themeLabel, POS.themeLabel, { maxLines: 1, ellipsis: true });
    }
    if (payload.themeMeaning) {
      drawTextBox(page1, helv, payload.themeMeaning, POS.themeMeaning, { maxLines: 3, ellipsis: true });
    }

    // Radar chart (PNG) – optional
    if (payload.chartUrl) {
      try {
        const arr = await fetchArrayBuffer(payload.chartUrl);
        // Try PNG first, fallback to JPEG if needed
        let img;
        try { img = await pdfDoc.embedPng(arr); }
        catch { img = await pdfDoc.embedJpg(arr); }
        const { x, y, w, h } = POS.chartBox;
        const imgW = img.width;
        const imgH = img.height;
        // scale to fit square box preserving aspect
        const scale = Math.min(w / imgW, h / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const offsetX = x + (w - drawW) / 2;
        const offsetY = y + (h - drawH) / 2;
        page1.drawImage(img, { x: offsetX, y: offsetY, width: drawW, height: drawH });
      } catch (e) {
        // ignore chart failure – rest of PDF still renders
        // console.warn('chart fetch/embed failed:', e?.message || e);
      }
    }

    // Tips (first page boxes)
    const tip1Title = payload.tip1Title || 'Try this';
    const tip2Title = payload.tip2Title || 'Next time';

    if (payload.tip1) {
      drawTextBox(page1, helvBold, tip1Title, POS.tip1Title, { maxLines: 1, ellipsis: true });
      drawTextBox(page1, helv, payload.tip1, POS.tip1Body, { maxLines: 4, ellipsis: true });
    }
    if (payload.tip2) {
      drawTextBox(page1, helvBold, tip2Title, POS.tip2Title, { maxLines: 1, ellipsis: true });
      drawTextBox(page1, helv, payload.tip2, POS.tip2Body, { maxLines: 4, ellipsis: true });
    }

    // Copyright footer (centered)
    {
      const m = POS.footer.margin;
      const footerText =
        '© 2025 CTRL (Toby Newman). All rights reserved. "CTRL" and the state names Concealed, Triggered, Regulated, Lead are trademarks of CTRL. ' +
        'This profile is for coaching/educational use only. Orientate, don\'t rank.';
      const maxW = page1.getWidth() - m * 2;
      drawWrappedCenter(page1, helv, footerText, m, POS.footer.y, maxW, POS.footer.lineGap, POS.footer.size, POS.footer.color);
    }

    // -----------------------------
    // 5) Page 2 (optional paragraphs)
    // -----------------------------
    if (pdfDoc.getPages().length >= 2) {
      const page2 = pdfDoc.getPages()[1];
      if (payload.patternPara) {
        drawTextBox(page2, helv, payload.patternPara, POS.patternPara, { maxLines: 8, ellipsis: true });
      }
      if (payload.themesPara) {
        drawTextBox(page2, helv, payload.themesPara, POS.themesPara, { maxLines: 8, ellipsis: true });
      }
    }

    // -----------------------------
    // 6) Output
    // -----------------------------
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[fill-template] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
