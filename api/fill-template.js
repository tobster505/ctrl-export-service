// /api/fill-template.js
// Fills your static PDF template (public/CTRL_Perspective_template.pdf)
// with the results from Botpress. Uses pdf-lib (no headless browser).
//
// QUICK TEST URLS (no Botpress needed):
//  - Single-state headline:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1
//
//  - Two-state headline on ONE line (smaller type):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair
//
//  - While tuning the radar position, you can override from the URL:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1&cx=120&cy=320&cw=280&ch=280&box=1
//      cx = x (moves right as it increases)
//      cy = y from TOP (moves down as it increases)
//      cw/ch = width/height
//      box=1 draws a thin guide box where the chart will be

export const config = { runtime: 'nodejs' }; // <- Vercel Node runtime

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* -------------------------------------------------------
   SECTION 1 — SMALL HELPERS (safe text, line wrapping, etc.)
   ------------------------------------------------------- */

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Keep text ASCII-only so standard fonts never choke
function normText(v, fallback = '') {
  return String(v ?? fallback)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// Draw simple wrapped text in a rectangular area.
// y is specified "from the TOP of the page" (easier to think about).
function drawTextBox(page, font, text, spec, opts = {}) {
  const {
    x = 40,             // left edge of the box
    y = 40,             // distance from TOP of the page
    w = 520,            // box width
    size = 12,
    color = rgb(0, 0, 0),
    align = 'left',     // 'left' | 'center' | 'right'
    lineGap = 3,
  } = spec || {};

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const pageH = page.getHeight();
  const cursorTopY = pageH - y; // convert from-top to PDF coords

  const lines = normText(text).split('\n');

  // Soft-wrap: approximate chars per line from font size and box width
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];
  for (const line of lines) {
    let rem = line.trim();
    while (rem.length > maxChars) {
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

  const widthOf = (s) => font.widthOfTextAtSize(s, size);
  const lineHeight = size + lineGap;

  let yCursor = cursorTopY;
  for (const line of out) {
    let drawX = x;
    if (align === 'center')       drawX = x + (w - widthOf(line)) / 2;
    else if (align === 'right')   drawX = x + (w - widthOf(line));
    page.drawText(line, { x: drawX, y: yCursor, size, font, color });
    yCursor -= lineHeight;
  }
}

// Load the static template bytes from /public (works on Vercel)
async function loadTemplateBytes(req) {
  const host  = req.headers.host || 'ctrl-export-service.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url   = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Helper to read number overrides from URL (?cx=... etc.)
const parseNum = (url, key, def) => {
  const n = Number(url.searchParams.get(key));
  return Number.isFinite(n) ? n : def;
};

/* -------------------------------------------------------
   SECTION 2 — MAIN HANDLER
   ------------------------------------------------------- */

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const isTest  = url.searchParams.get('test') === '1';
    const isPairT = url.searchParams.get('test') === 'pair'; // demo two-state headline

    // --------- 2A. INPUT PAYLOAD (real or demo) ---------
    // In production you’ll base64-encode JSON and pass via ?data=...
    let data;
    if (isTest || isPairT) {
      // Demo payloads you can tweak without Botpress
      const common = {
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones - steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        tip1: 'Take one breath and name it: "I’m on edge."',
        tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
        chartUrl:
          'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify({
            type: 'radar',
            data: {
              labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
              datasets: [{
                label: 'Frequency',
                data: [1, 3, 1, 0],
                fill: true,
                backgroundColor: 'rgba(115,72,199,0.18)',
                borderColor: '#7348C7',
                borderWidth: 2,
                pointRadius: [3, 6, 3, 0],
              }],
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
                }
              }
            }
          })),
      };
      data = isPairT
        ? { ...common, stateWords: ['Triggered', 'Regulated'] }  // two-state demo
        : { ...common, stateWord: 'Triggered' };                 // single-state demo
    } else {
      // Production: expect base64 JSON in ?data=...
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

    // --------- 2B. LOAD TEMPLATE + FONTS ---------
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1  = pdfDoc.getPage(0);

    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    /* -------------------------------------------------------
       SECTION 3 — POSITIONS YOU CAN TUNE
       All y values are “distance from the TOP of the page”.
       Higher y => moves lower on the page.
       ------------------------------------------------------- */
    const POS = {
      /* HEADLINE IN THE LARGE MAUVE PANEL
         - We keep two presets:
           - headlineSingle: for one state (e.g., "Triggered")
           - headlinePair  : for two states on ONE line (e.g., "Triggered & Regulated")
         HOW TO TUNE:
         - Move right/left: change x
         - Move up/down   : change y (higher y = lower on the page)
         - Make bigger    : increase size
      */
      headlineSingle: { x: 90, y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
      headlinePair:   { x: 90, y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

      /* DIRECTION + THEME BLOCKS (to the right of the radar) */
      directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
      themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

      /* TIPS ROW (two mauve boxes at the top of page 1) */
      tip1Header:      { x: 80,  y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip1Body:        { x: 80,  y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },
      tip2Header:      { x: 540, y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip2Body:        { x: 540, y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },

      /* RADAR CHART IMAGE (left side) — defaults are sensible
         You can override these from the URL while tuning:
           ?cx=120&cy=320&cw=280&ch=280&box=1
      */
      chart: { x: 110, y: 300, w: 260, h: 260 },

      /* COPYRIGHT FOOTER */
      footerY: 20, // distance from BOTTOM edge is handled automatically below
    };

    // URL overrides for radar chart while tuning (optional)
    POS.chart = {
      x: parseNum(url, 'cx', POS.chart.x),
      y: parseNum(url, 'cy', POS.chart.y),
      w: parseNum(url, 'cw', POS.chart.w),
      h: parseNum(url, 'ch', POS.chart.h),
    };
    const showChartBox = url.searchParams.get('box') === '1';

    /* -------------------------------------------------------
       SECTION 4 — DRAW CONTENT INTO THE TEMPLATE
       ------------------------------------------------------- */

    // 4A. Headline (single state OR two states on one line)
    const twoStates = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
    const headlineText = twoStates
      ? `${normText(data.stateWords[0])} & ${normText(data.stateWords[1])}`
      : normText(data.stateWord || '—');

    drawTextBox(
      page1,
      helvBold,
      headlineText,
      { ...(twoStates ? POS.headlinePair : POS.headlineSingle), align: 'center' },
      { maxLines: 1, ellipsis: true }
    );

    // 4B. Tips — we place these high on page 1 so users see actions immediately
    drawTextBox(page1, helvBold, 'Try this…',            POS.tip1Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv,     normText(data.tip1||''),POS.tip1Body,   { maxLines: 2, ellipsis: true });

    drawTextBox(page1, helvBold, 'Try this next time…',  POS.tip2Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv,     normText(data.tip2||''),POS.tip2Body,   { maxLines: 2, ellipsis: true });

    // 4C. Direction + Theme (to the right of the radar)
    if (data.directionLabel)
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    if (data.directionMeaning)
      drawTextBox(page1, helv,     normText(data.directionMeaning),      POS.directionBody,   { maxLines: 3, ellipsis: true });

    if (data.themeLabel)
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…',      POS.themeHeader,     { maxLines: 1, ellipsis: true });
    if (data.themeMeaning)
      drawTextBox(page1, helv,     normText(data.themeMeaning),          POS.themeBody,       { maxLines: 2, ellipsis: true });

    // 4D. Radar chart (PNG from QuickChart)
    if (data.chartUrl) {
      // Optional thin guide box so you can see the target area while tuning
      if (showChartBox) {
        const { x, y, w, h } = POS.chart;
        const pageH = page1.getHeight();
        page1.drawRectangle({
          x, y: pageH - y - h, width: w, height: h,
          borderColor: rgb(0.45, 0.35, 0.6), borderWidth: 1,
        });
      }
      try {
        const r = await fetch(String(data.chartUrl));
        if (r.ok) {
          const imgBytes = await r.arrayBuffer();
          const png = await pdfDoc.embedPng(imgBytes);
          const { x, y, w, h } = POS.chart;
          const pageH = page1.getHeight();
          page1.drawImage(png, { x, y: pageH - y - h, width: w, height: h });
        }
      } catch { /* ignore chart failures so PDF still renders */ }
    }

    // 4E. Copyright footer (centered)
    const footer = '© CTRL Model by Toby Newman. All rights reserved. “Orientate, don’t rank.”';
    const pageW = page1.getWidth();
    const footerSize = 9;
    const footerWidth = helv.widthOfTextAtSize(footer, footerSize);
    page1.drawText(footer, {
      x: (pageW - footerWidth) / 2,
      y: POS.footerY,   // this is already from the BOTTOM in pdf-lib coords
      size: footerSize,
      font: helv,
      color: rgb(0.36, 0.34, 0.50),
    });

    /* -------------------------------------------------------
       SECTION 5 — SEND THE PDF BYTES
       ------------------------------------------------------- */
    const pdfBytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="ctrl_profile.pdf"');
    res.end(Buffer.from(pdfBytes));

  } catch (e) {
    // Friendly error message instead of a blank 500
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || String(e)));
  }
}
