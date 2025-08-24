// /api/fill-template.js
// Fills your static PDF template (public/CTRL_Perspective_template.pdf)
// with results from Botpress, using pdf-lib (no headless browser).
//
// TEST LINKS (safe to click; no Botpress payload required):
//  • Single-state headline (+ tips/theme/direction):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1&preview=1
//  • Two-state headline on ONE line (smaller type):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&preview=1
//  • Tuner for the radar position (draws a guide box):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1&preview=1&cx=1050&cy=620&cw=700&ch=400&box=1
//
// Query params you can pass anytime:
//  - preview=1     → show inline in browser (otherwise downloads)
//  - nograph=1     → skip the chart (helps isolate text issues)
//  - debug=1       → return JSON with positions & data (no PDF)
//  - cx,cy,cw,ch   → override radar x/y/width/height while tuning
//  - box=1         → draw a thin guide rectangle around the radar box

export const config = { runtime: 'nodejs' }; // Vercel Node runtime

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* --------------------------
   Helpers
--------------------------- */

// keep ASCII so standard fonts render reliably
function normText(v, fallback = '') {
  return String(v ?? fallback)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// simple line-wrapper + box-draw (y measured from TOP of page)
function drawTextBox(page, font, text, spec, opts = {}) {
  const {
    x = 40, y = 40, w = 520, size = 12, color = rgb(0, 0, 0),
    align = 'left', lineGap = 3,
  } = spec || {};
  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

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

  const pageH = page.getHeight();
  const topY = pageH - y; // convert to pdf-lib coords
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

// load template from /public (works on Vercel preview & prod)
async function loadTemplateBytes(req) {
  const host  = req.headers.host || 'ctrl-export-service.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url   = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// parse numeric query param with default
const num = (url, key, def) => {
  const n = Number(url.searchParams.get(key));
  return Number.isFinite(n) ? n : def;
};

/* --------------------------
   Main handler
--------------------------- */

export default async function handler(req, res) {
  const url      = new URL(req.url, 'http://localhost');
  const isTest   = url.searchParams.get('test') === '1';
  const isPair   = url.searchParams.get('test') === 'pair';
  const debug    = url.searchParams.get('debug') === '1';
  const noGraph  = url.searchParams.get('nograph') === '1';
  const preview  = url.searchParams.get('preview') === '1';

  // --- Demo payloads (no Botpress needed) ---
  let data;
  if (isTest || isPair) {
    const sampleChartSpec = {
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
    };
    const chartUrl = 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(sampleChartSpec));

    const common = {
      // Optional “how this shows up” BODY (no dynamic heading; your template has it)
      how: 'You feel things fast and show it. Energy rises quickly. A brief pause or naming the wobble ("I’m on edge") often settles it.',
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones - steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: 'Take one breath and name it: "I’m on edge."',
      tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
      chartUrl,
    };
    data = isPair
      ? { ...common, stateWords: ['Triggered', 'Regulated'] } // two-state headline (one line)
      : { ...common, stateWord: 'Triggered' };                // single-state headline
  } else {
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
    }
  }

  // Defaults for positions (increase y to move text DOWN the page)
  const POS = {
    // headline (single vs pair) — keep single-state position unchanged
    headlineSingle: { x: 90, y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
    headlinePair:   { x: 90, y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

    // tips row
    tip1Header:      { x: 80,  y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
    tip1Body:        { x: 80,  y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },
    tip2Header:      { x: 540, y: 515, w: 430, size: 12, color: rgb(0.24, 0.23, 0.35) },
    tip2Body:        { x: 540, y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // “How this shows up” BODY ONLY (no dynamic heading)
    howBody:         { x: 80,  y: 490, w: 430, size: 11.5, color: rgb(0.20, 0.19, 0.30), lineGap: 4 },

    // direction + theme (right column)
    directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
    themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // radar chart (you can override with URL tuner)
    chart: { x: 1050, y: 620, w: 700, h: 400 },

    // footer
    footerY: 20,
  };

  // tuner overrides (?cx,cy,cw,ch,box)
  POS.chart = {
    x: num(url, 'cx', POS.chart.x),
    y: num(url, 'cy', POS.chart.y),
    w: num(url, 'cw', POS.chart.w),
    h: num(url, 'ch', POS.chart.h),
  };
  const showBox = url.searchParams.get('box') === '1';

  // Optional debug JSON
  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      hint: 'Add &preview=1 to view inline, &box=1 to draw chart guide, &nograph=1 to skip chart',
      data,
      pos: POS,
      urlParams: Object.fromEntries(url.searchParams.entries())
    }, null, 2));
    return;
  }

  try {
    // load template + fonts
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1  = pdfDoc.getPage(0);
    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // headline (single or pair on one line)
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

    // tips row
    drawTextBox(page1, helvBold, 'Try this…',               POS.tip1Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv,     normText(data.tip1 || ''), POS.tip1Body,   { maxLines: 2, ellipsis: true });
    drawTextBox(page1, helvBold, 'Try this next time…',     POS.tip2Header, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, helv,     normText(data.tip2 || ''), POS.tip2Body,   { maxLines: 2, ellipsis: true });

    // “How this shows up” BODY ONLY (no dynamic title — your template already has it)
    if (data.how) {
      drawTextBox(page1, helv, normText(data.how), POS.howBody, { maxLines: 4, ellipsis: true });
    }

    // direction + theme
    if (data.directionLabel)
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    if (data.directionMeaning)
      drawTextBox(page1, helv,     normText(data.directionMeaning),      POS.directionBody,   { maxLines: 3, ellipsis: true });

    if (data.themeLabel)
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…',      POS.themeHeader,     { maxLines: 1, ellipsis: true });
    if (data.themeMeaning)
      drawTextBox(page1, helv,     normText(data.themeMeaning),          POS.themeBody,       { maxLines: 2, ellipsis: true });

    // radar chart (optional)
    if (!noGraph && data.chartUrl) {
      if (showBox) {
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
          const png = await pdfDoc.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart;
          const pageH = page1.getHeight();
          page1.drawImage(png, { x, y: pageH - y - h, width: w, height: h });
        }
      } catch {
        // ignore chart failures so PDF still renders
      }
    }

    // footer (static)
    const footer = '© CTRL Model by Toby Newman. All rights reserved. “Orientate, don’t rank.”';
    const pageW = page1.getWidth();
    const fSize = 9;
    const fW = helv.widthOfTextAtSize(footer, fSize);
    page1.drawText(footer, { x: (pageW - fW) / 2, y: POS.footerY, size: fSize, font: helv, color: rgb(0.36, 0.34, 0.50) });

    // send PDF
    const bytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="ctrl_profile.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    // readable error instead of blank 500
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || String(e)));
  }
}
