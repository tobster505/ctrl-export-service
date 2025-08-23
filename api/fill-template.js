// /api/fill-template.js
// Fills your static PDF template (public/CTRL_Perspective_template.pdf)
// with results from Botpress, using pdf-lib (no headless browser).
//
// QUICK TEST URLS (no Botpress needed):
//  - Single-state headline:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1
//
//  - Two-state headline on ONE line (smaller type):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair
//
//  - While tuning the radar position, override via URL:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1&cx=120&cy=320&cw=280&ch=280&box=1
//      cx = x  (right as it increases)      cy = y-from-TOP (down as it increases)
//      cw/ch = width/height                 box=1 draws a thin guide box

export const config = { runtime: 'nodejs' }; // Vercel Node runtime

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* -------------------------------------------------------
   SECTION 1 — SMALL HELPERS (safe text, wrapping, etc.)
   ------------------------------------------------------- */

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Keep to ASCII so standard fonts never choke
function normText(v, fallback = '') {
  return String(v ?? fallback)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// Draw wrapped text in a rectangular area.
// y is “from the TOP of the page” (easier to reason with).
function drawTextBox(page, font, text, spec, opts = {}) {
  const {
    x = 40,
    y = 40,          // distance from TOP
    w = 520,
    size = 12,
    color = rgb(0, 0, 0),
    align = 'left',  // 'left' | 'center' | 'right'
    lineGap = 3,
  } = spec || {};

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const pageH = page.getHeight();
  const topY = pageH - y; // convert to pdf-lib coords

  const lines = normText(text).split('\n');
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];
  for (const raw of lines) {
    let rem = raw.trim();
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

  let yCursor = topY;
  for (const line of out) {
    let drawX = x;
    if (align === 'center')       drawX = x + (w - widthOf(line)) / 2;
    else if (align === 'right')   drawX = x + (w - widthOf(line));
    page.drawText(line, { x: drawX, y: yCursor, size, font, color });
    yCursor -= lineHeight;
  }
}

// Load the static template from /public (works on Vercel & preview)
async function loadTemplateBytes(req) {
  const host  = req.headers.host || 'ctrl-export-service.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url   = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Read numeric URL overrides (for quick tuning)
const parseNum = (url, key, def) => {
  const n = Number(url.searchParams.get(key));
  return Number.isFinite(n) ? n : def;
};

/* -------------------------------------------------------
   SECTION 2 — MAIN HANDLER
   ------------------------------------------------------- */

export default async function handler(req, res) {
  try {
    const url    = new URL(req.url, 'http://localhost');
    const isTest = url.searchParams.get('test') === '1';
    const isPair = url.searchParams.get('test') === 'pair'; // demo two-state headline

    // ---------- 2A. INPUT (real or demo) ----------
    let data;
    if (isTest || isPair) {
      // Demo content (safe to tweak)
      const common = {
        directionLabel:  'Steady',
        directionMeaning:'You started and ended in similar zones - steady overall.',
        themeLabel:      'Emotion regulation',
        themeMeaning:    'Settling yourself when feelings spike.',
        tip1: 'Take one breath and name it: "I’m on edge."',
        tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
        chartUrl: 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify({
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
      data = isPair
        ? { ...common, stateWords: ['Triggered', 'Regulated'] } // two-state demo
        : { ...common, stateWord: 'Triggered' };                // single-state demo
    } else {
      // Production: expect base64 JSON in ?data=...
      const b64 = url.searchParams.get('data');
      if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
      try {
        data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch (e) {
        res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
      }
    }

    // ---------- 2B. TEMPLATE + FONTS ----------
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1  = pdfDoc.getPage(0);

    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    /* -------------------------------------------------------
       SECTION 3 — POSITIONS YOU’LL TUNE
       All y are “distance from TOP”.
       Increase y to move things LOWER on the page.
       ------------------------------------------------------- */
    const POS = {
      // HEADLINE inside the big mauve panel
      // NOTE: these match your “single state” placement you liked
      headlineSingle: { x: 90, y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
      // Two states (“A & B”) on ONE LINE with smaller type
      headlinePair:   { x: 90, y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

      // Direction + Theme (right of the radar)
      directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
      themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
      themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

      // Tips row (top of page 1)
      tip1Header:      { x: 80,  y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip1Body:        { x: 80,  y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },
      tip2Header:      { x: 540, y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
      tip2Body:        { x: 540, y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },

      // Radar chart image — defaults; override via URL when tuning
      chart: { x: 90, y: 320, w: 260, h: 260 },

      // Footer
      footerY: 20,
    };

    // Optional chart tuning from URL (?cx, cy, cw, ch, box)
    POS.chart = {
      x: parseNum(url, 'cx', POS.chart.x),
      y: parseNum(url, 'cy', POS.chart.y),
      w: parseNum(url, 'cw', POS.chart.w),
      h: parseNum(url, 'ch', POS.chart.h),
    };
    const showChartBox = url.searchParams.get('box') === '1';

    /* -------------------------------------------------------
       SECTION 4 — DRAW INTO THE TEMPLATE
       ------------------------------------------------------- */

    // Headline: single OR two states on one line
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

    // Tips first (prominent actions)
    drawTextBox(page1, helvBold, 'Try this…',             POS.tip1Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv,     normText(data.tip1 || ''),POS.tip1Body,   { maxLines: 2, ellipsis: true });
    drawTextBox(page1, helvBold, 'Try this next time…',   POS.tip2Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv,     normText(data.tip2 || ''),POS.tip2Body,   { maxLines: 2, ellipsis: true });

    // Direction + Theme (right of the radar)
    if (data.directionLabel)
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    if (data.directionMeaning)
      drawTextBox(page1, helv,     normText(data.directionMeaning),      POS.directionBody,   { maxLines: 3, ellipsis: true });

    if (data.themeLabel)
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…',      POS.themeHeader,     { maxLines: 1, ellipsis: true });
    if (data.themeMeaning)
      drawTextBox(page1, helv,     normText(data.themeMeaning),          POS.themeBody,       { maxLines: 2, ellipsis: true });

    // Radar chart (PNG)
    if (data.chartUrl) {
  if (showChartBox) {
    const { x, y, w, h } = POS.chart;
    const pageH = page1.getHeight();
    // draw guide box using safe coords
    const topY = Math.min(y, pageH - h - 1);
    page1.drawRectangle({
      x, y: pageH - topY - h, width: w, height: h,
      borderColor: rgb(0.45, 0.35, 0.6), borderWidth: 1,
    });
  }
  try {
    const r = await fetch(String(data.chartUrl));
    if (r.ok) {
      const png = await pdfDoc.embedPng(await r.arrayBuffer());
      const { x, y, w, h } = POS.chart;
      const pageH = page1.getHeight();
      // clamp top-based y to keep image on-page
      const topY = Math.min(Math.max(0, y), pageH - h - 1);
      page1.drawImage(png, { x, y: pageH - topY - h, width: w, height: h });
    }
  } catch {/* ignore so PDF still renders */}
}

    // Footer
    const footer = '© CTRL Model by Toby Newman. All rights reserved. “Orientate, don’t rank.”';
    const pageW = page1.getWidth();
    const fSize = 9;
    const fW = helv.widthOfTextAtSize(footer, fSize);
    page1.drawText(footer, {
      x: (pageW - fW) / 2,
      y: POS.footerY, // already a bottom-based y in pdf-lib coords
      size: fSize, font: helv, color: rgb(0.36, 0.34, 0.50),
    });

/* -------------------------------------------------------
   SECTION 5 — SEND PDF
   ------------------------------------------------------- */
const pdfBytes = await pdfDoc.save();
const preview = new URL(req.url, 'http://localhost').searchParams.get('preview') === '1';

res.statusCode = 200;
res.setHeader('Content-Type', 'application/pdf');
// Inline when previewing (opens in browser tab), attachment otherwise (downloads)
res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="ctrl_profile.pdf"`);
// Avoid caching while you’re tuning positions
res.setHeader('Cache-Control', 'no-store');

res.end(Buffer.from(pdfBytes));
}
