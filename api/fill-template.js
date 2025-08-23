// /api/fill-template.js
// Serverless (Vercel) — fills /public/CTRL_Perspective_template.pdf with dynamic text
// package.json:  "type": "module", deps: { "pdf-lib": "^1.x" }

export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// -----------------------------
// Helpers
// -----------------------------
function normText(v, fallback = '') {
  return String(v ?? fallback)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// Simple single-line/short-paragraph drawer (supports centering)
function drawTextBox(page, font, text, spec, opts = {}) {
  const {
    x = 40,
    y = 40,              // from TOP of page
    w = 520,
    size = 12,
    color = rgb(0, 0, 0),
    align = 'left',
    lineGap = 3
  } = spec || {};

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const pageH = page.getHeight();
  const textTopY = pageH - y;

  const srcLines = normText(text).split('\n');
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];
  for (const raw of srcLines) {
    let rem = raw.trim();
    while (rem.length > maxChars) {
      let cut = rem.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      wrapped.push(rem.slice(0, cut).trim());
      rem = rem.slice(cut).trim();
    }
    if (rem) wrapped.push(rem);
  }

  const lines = wrapped.slice(0, maxLines);
  if (ellipsis && wrapped.length > maxLines) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\.*$/, '…');
  }

  const lineHeight = size + lineGap;
  let cy = textTopY;
  for (const line of lines) {
    let dx = x;
    if (align === 'center') {
      dx = x + (w - font.widthOfTextAtSize(line, size)) / 2;
    } else if (align === 'right') {
      dx = x + (w - font.widthOfTextAtSize(line, size));
    }
    page.drawText(line, { x: dx, y: cy, size, font, color });
    cy -= lineHeight;
  }
}

// Load the static template from /public
async function loadTemplateBytes(req) {
  const host = req.headers.host || 'ctrl-export-service.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// -----------------------------
// Handler
// -----------------------------
export default async function handler(req, res) {
  try {
    // Parse ?test=1 or ?data=<b64>
    const url = new URL(req.url, 'http://localhost');
    const isTest = url.searchParams.get('test') === '1';

    let data;
    if (isTest) {
      data = {
        // SINGLE-STATE test:
        // stateWord: 'Triggered',

        // TWO-STATE test (uses one-line layout, smaller, with "&"):
        stateWords: ['Triggered', 'Regulated'],

        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones - steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        tip1: 'Take one breath and name it: "I’m on edge."',
        tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
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
                    min: 0, max: 5,
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
        res.setHeader('Content-Type', 'text/plain');
        res.end('Missing ?data (base64 JSON)');
        return;
      }
      try {
        data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Invalid ?data: ' + (e?.message || e));
        return;
      }
    }

    // Load template
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1 = pdfDoc.getPage(0);

    // Fonts
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Positions (y are from top of page)
    const POS = {
      headlineState: {
        x: 90,
        y: 650,
        w: 860,
        size: 72, // single-state size (do not change)
        lineGap: 4,
        color: rgb(0.12, 0.11, 0.2),
      },
      directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
      themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
      tip1Header:      { x: 80,  y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip1Body:        { x: 80,  y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },
      tip2Header:      { x: 540, y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip2Body:        { x: 540, y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },
      chart:           { x: 90,  y: 245, w: 200, h: 200 },
    };

    // ----------------- HEADLINE -----------------
    const two = Array.isArray(data.stateWords) && data.stateWords.length === 2;
    if (two) {
      // One-line, smaller, centered: "A & B"
      const line = `${normText(data.stateWords[0])} & ${normText(data.stateWords[1])}`;

      // Start a bit smaller than single-state and autoshrink to fit width
      let size = 56;                                 // target for two-state
      const maxWidth = POS.headlineState.w * 0.9;    // keep a little margin
      while (helvBold.widthOfTextAtSize(line, size) > maxWidth && size > 38) size -= 2;

      drawTextBox(
        page1,
        helvBold,
        line,
        { ...POS.headlineState, size, align: 'center' },
        { maxLines: 1 }
      );
    } else {
      const stateWord = normText(data.stateWord || '—');
      drawTextBox(
        page1,
        helvBold,
        stateWord,
        { ...POS.headlineState, align: 'center' },   // unchanged single-state placement
        { maxLines: 1 }
      );
    }

    // ----------------- Direction -----------------
    if (data.directionLabel) {
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1 });
    }
    if (data.directionMeaning) {
      drawTextBox(page1, helv, normText(data.directionMeaning), POS.directionBody, { maxLines: 3, ellipsis: true });
    }

    // ----------------- Theme -----------------
    if (data.themeLabel) {
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…', POS.themeHeader, { maxLines: 1 });
    }
    if (data.themeMeaning) {
      drawTextBox(page1, helv, normText(data.themeMeaning), POS.themeBody, { maxLines: 2, ellipsis: true });
    }

    // ----------------- Tips -----------------
    drawTextBox(page1, helvBold, 'Try this…', POS.tip1Header, { maxLines: 1 });
    drawTextBox(page1, helv, normText(data.tip1 || ''), POS.tip1Body, { maxLines: 2, ellipsis: true });

    drawTextBox(page1, helvBold, 'Try this next time…', POS.tip2Header, { maxLines: 1 });
    drawTextBox(page1, helv, normText(data.tip2 || ''), POS.tip2Body, { maxLines: 2, ellipsis: true });

    // ----------------- Radar chart (optional) -----------------
    if (data.chartUrl) {
      try {
        const r = await fetch(String(data.chartUrl));
        if (r.ok) {
          const imgBytes = await r.arrayBuffer();
          const png = await pdfDoc.embedPng(imgBytes);
          const { x, y, w, h } = POS.chart;
          const pageH = page1.getHeight();
          page1.drawImage(png, { x, y: pageH - y - h, width: w, height: h });
        }
      } catch { /* ignore */ }
    }

    // ----------------- Footer -----------------
    const footer = '© CTRL Model by Toby Newman. All rights reserved. “Orientate, don’t rank.”';
    const pageW = page1.getWidth();
    const fSize = 9;
    const fWidth = helv.widthOfTextAtSize(footer, fSize);
    page1.drawText(footer, {
      x: (pageW - fWidth) / 2,
      y: 20,
      size: fSize,
      font: helv,
      color: rgb(0.36, 0.34, 0.5)
    });

    // Output
    const pdfBytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="ctrl_profile.pdf"');
    res.end(Buffer.from(pdfBytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || String(e)));
  }
}
