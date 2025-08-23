// /api/fill-template.js
// Serverless (Vercel) — fills CTRL_Perspective_template.pdf with dynamic text
// Requires: "pdf-lib" in package.json, template at /public/CTRL_Perspective_template.pdf

export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// -----------------------------
// Small helpers
// -----------------------------
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function normText(v, fallback = '') {
  return String(v ?? fallback)
    // keep ASCII to avoid odd glyphs in standard fonts
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// Draw text into a rectangular area, with alignment
function drawTextBox(page, font, text, spec, opts = {}) {
  const {
    x = 40,
    y = 40,           // y from TOP of page (easier to think about)
    w = 520,          // box width
    size = 12,
    color = rgb(0, 0, 0),
    align = 'left',   // 'left' | 'center' | 'right'
    lineGap = 3
  } = spec || {};

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const pageH = page.getHeight();
  const textTopY = pageH - y; // convert "from top" to PDF y

  const lines = normText(text).split('\n');

  // simple line wrapping: break long lines at ~chars per line based on width/size
  const avgCharW = size * 0.55; // rough average
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];
  for (const line of lines) {
    let rem = line.trim();
    while (rem.length > maxChars) {
      // find last space within window
      let cut = rem.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      wrapped.push(rem.slice(0, cut).trim());
      rem = rem.slice(cut).trim();
    }
    if (rem) wrapped.push(rem);
  }

  let out = wrapped;
  if (wrapped.length > maxLines) {
    out = wrapped.slice(0, maxLines);
    if (ellipsis) out[out.length - 1] = out[out.length - 1].replace(/\.*$/, '…');
  }

  const textWidth = (line) => font.widthOfTextAtSize(line, size);
  const lineHeight = size + lineGap;

  let cursorY = textTopY;
  for (const line of out) {
    let drawX = x;
    if (align === 'center') {
      drawX = x + (w - textWidth(line)) / 2;
    } else if (align === 'right') {
      drawX = x + (w - textWidth(line));
    }
    page.drawText(line, { x: drawX, y: cursorY, size, font, color });
    cursorY -= lineHeight;
  }
}

// Load template bytes from /public via HTTP (works in prod & preview)
async function loadTemplateBytes(req) {
  const host = req.headers.host || 'ctrl-export-service.vercel.app';
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const url = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// -----------------------------
// Main handler
// -----------------------------
export default async function handler(req, res) {
  try {
    // ----------------- parse input -----------------
    const url = new URL(req.url, 'http://localhost');
    const isTest = url.searchParams.get('test') === '1';

    // Minimal payload (your Botpress step should send these)
    let data;
    if (isTest) {
      data = {
        // headline state word
        stateWord: 'Triggered',
        // direction label + meaning
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones - steady overall.',
        // theme label + meaning
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        // two tips
        tip1: 'Take one breath and name it: "I’m on edge."',
        tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
        // chart (optional) — QuickChart PNG
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
                    data: [1, 3, 1, 0],
                    fill: true,
                    backgroundColor: 'rgba(115,72,199,0.18)',
                    borderColor: '#7348C7',
                    borderWidth: 2,
                    pointRadius: [3, 6, 3, 0],
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
      // Expect base64 JSON in ?data=...
      const b64 = url.searchParams.get('data');
      if (!b64) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Missing ?data param (base64-encoded JSON)');
        return;
      }
      try {
        data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Invalid ?data (not base64 JSON): ' + (e?.message || e));
        return;
      }
    }

    // ----------------- load template -----------------
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1 = pdfDoc.getPage(0);

    // fonts
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // ----------------- positions (all y are "from top") -----------------
    const POS = {
      // Big headline inside the mauve box
      headlineState: {
        x: 90,         // left margin within the mauve panel
        y: 425,        // tweak to sit vertically centered in your template
        w: 860,        // wide box so we can center text
        size: 72,
        lineGap: 4,
        color: rgb(0.12, 0.11, 0.2),
      },

      // Direction block (left of radar in your template)
      directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

      // Theme block
      themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

      // Tips row (two mauve boxes). Positions assume template boxes already exist.
      tip1Header:      { x: 80,  y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip1Body:        { x: 80,  y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },
      tip2Header:      { x: 540, y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip2Body:        { x: 540, y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },

      // Radar chart image (left side)
      chart:           { x: 90,  y: 245, w: 200, h: 200 }, // y here is top of image box
    };

    // ----------------- paint values -----------------
    const stateWord = normText(data.stateWord || '—');
    drawTextBox(
      page1,
      helvBold,
      stateWord,
      { ...POS.headlineState, align: 'center' }, // center within the wide box
      { maxLines: 1, ellipsis: true }
    );

    if (data.directionLabel) {
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    }
    if (data.directionMeaning) {
      drawTextBox(page1, helv, normText(data.directionMeaning), POS.directionBody, { maxLines: 3, ellipsis: true });
    }

    if (data.themeLabel) {
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…', POS.themeHeader, { maxLines: 1, ellipsis: true });
    }
    if (data.themeMeaning) {
      drawTextBox(page1, helv, normText(data.themeMeaning), POS.themeBody, { maxLines: 2, ellipsis: true });
    }

    // Tips first (so they’re on page 1 above any long sections)
    drawTextBox(page1, helvBold, 'Try this…', POS.tip1Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv, normText(data.tip1 || ''), POS.tip1Body, { maxLines: 2, ellipsis: true });

    drawTextBox(page1, helvBold, 'Try this next time…', POS.tip2Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv, normText(data.tip2 || ''), POS.tip2Body, { maxLines: 2, ellipsis: true });

    // Optional radar chart
    if (data.chartUrl) {
      try {
        const r = await fetch(String(data.chartUrl));
        if (r.ok) {
          const imgBytes = await r.arrayBuffer();
          const png = await pdfDoc.embedPng(imgBytes);
          const { x, y, w, h } = POS.chart;
          const pageH = page1.getHeight();
          page1.drawImage(png, {
            x,
            y: pageH - y - h, // convert top-based y to pdf-lib y
            width: w,
            height: h,
          });
        }
      } catch { /* ignore chart failures */ }
    }

    // Copyright footer (static)
    const footer = '© CTRL Model by Toby Newman. All rights reserved. “Orientate, don’t rank.”';
    const pageW = page1.getWidth();
    const footerSize = 9;
    const footerFont = helv;
    const footerWidth = footerFont.widthOfTextAtSize(footer, footerSize);
    page1.drawText(footer, {
      size: footerSize,
      font: footerFont,
      color: rgb(0.36, 0.34, 0.5),
      x: (pageW - footerWidth) / 2,
      y: 20,
    });

    // ----------------- output PDF -----------------
    const pdfBytes = await pdfDoc.save();
    const name = 'ctrl_profile.pdf';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.end(Buffer.from(pdfBytes));
  } catch (e) {
    // Helpful error text instead of a blank 500
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || String(e)));
  }
}
