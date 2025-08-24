// /api/fill-template.js
// Fills your static PDF template (public/CTRL_Perspective_template.pdf)
// with results from Botpress, using pdf-lib (no headless browser).
//
// TEST LINKS (chart included, no border):
//  • Single-state:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1&preview=1&hx=160&hy=850&hw=700&hs=30&halign=center&cx=1050&cy=620&cw=700&ch=400
//  • Two-state (“A & B”), two body lines:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&preview=1&hx2=150&hy2=870&hw2=720&hs2=22&h2align=center&cx=1050&cy=620&cw=700&ch=400
//
// Tuner params you can pass anytime:
//  - preview=1   → inline render (instead of download)
//  - debug=1     → return JSON (no PDF)
//  - nograph=1   → skip chart
//  - cx,cy,cw,ch → chart x/y/width/height (y is distance from TOP)
//  - hx,hy,hw,hs,halign  → single “how this shows up…”
//  - hx2,hy2,hw2,hs2,h2align → pair “how this shows up…”
//
// NOTE: We do NOT draw the “How this shows up…” title here because it’s static on your template.

export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* --------------------------
   Helpers
--------------------------- */

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

async function loadTemplateBytes(req) {
  const host  = req.headers.host || 'ctrl-export-service.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url   = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}
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

  // Demo payloads (safe to tweak for visual checks)
  let data;
  if (isTest || isPair) {
    const common = {
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones - steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: 'Take one breath and name it: "I’m on edge."',
      tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
      // Single-state “how” (used when test=1)
      how: 'You feel things fast and show it. A brief pause or naming the wobble ("I’m on edge") often settles it.',
      // Chart
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
      ? {
          ...common,
          stateWords: ['Triggered', 'Regulated'],
          // Show BOTH body lines in the pair block:
          howPair: [
            'You feel things fast and show it. A brief pause or naming the wobble often settles it.',
            'You steady yourself and read the room; a short recap or question keeps things clear.'
          ],
        }
      : { ...common, stateWord: 'Triggered' };
  } else {
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
    }
  }

  // Positions (increase y to move DOWN the page)
  const POS = {
    // headline (single vs pair) — single kept as you liked
    headlineSingle: { x: 90, y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
    headlinePair:   { x: 90, y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

    // tips (body only; titles are static on the template)
    tip1Body:        { x:  80, y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },
    tip2Body:        { x: 540, y: 535, w: 430, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // “How this shows up…” body — single
    howSingle:       { x: 160, y: 850, w: 700, size: 30, color: rgb(0.22, 0.22, 0.32), align: 'center', lineGap: 4 },
    // “How this shows up…” body — pair (separate block so you can tune it independently)
    howPair:         { x: 180, y: 870, w: 720, size: 22, color: rgb(0.22, 0.22, 0.32), align: 'center', lineGap: 4 },

    // direction + theme (right column)
    directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
    themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // radar chart (tuned to your preferred spot)
    chart: { x: 1050, y: 620, w: 700, h: 400 },

    footerY: 20,
  };

  // Allow runtime tuning via URL
  POS.howSingle = {
    x: num(url, 'hx',  POS.howSingle.x),
    y: num(url, 'hy',  POS.howSingle.y),
    w: num(url, 'hw',  POS.howSingle.w),
    size: num(url, 'hs', POS.howSingle.size),
    color: POS.howSingle.color,
    lineGap: POS.howSingle.lineGap,
    align: (url.searchParams.get('halign') || POS.howSingle.align)
  };
  POS.howPair = {
    x: num(url, 'hx2',  POS.howPair.x),
    y: num(url, 'hy2',  POS.howPair.y),
    w: num(url, 'hw2',  POS.howPair.w),
    size: num(url, 'hs2', POS.howPair.size),
    color: POS.howPair.color,
    lineGap: POS.howPair.lineGap,
    align: (url.searchParams.get('h2align') || POS.howPair.align)
  };
  POS.chart = {
    x: num(url, 'cx', POS.chart.x),
    y: num(url, 'cy', POS.chart.y),
    w: num(url, 'cw', POS.chart.w),
    h: num(url, 'ch', POS.chart.h),
  };

  // Optional debug JSON
  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true, data, pos: POS,
      hint: 'Use hx/hy/hw/hs/halign and hx2/... for pair; cx/cy/cw/ch for chart.'
    }, null, 2));
    return;
  }

  try {
    // Load template + fonts
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1  = pdfDoc.getPage(0);
    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Headline
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

    // Tips (body only)
    if (data.tip1) drawTextBox(page1, helv, normText(data.tip1), POS.tip1Body, { maxLines: 3, ellipsis: true });
    if (data.tip2) drawTextBox(page1, helv, normText(data.tip2), POS.tip2Body, { maxLines: 3, ellipsis: true });

    // Default “how” copy by state (fallback if caller doesn’t send how/howPair)
    const HOW_BY_STATE = {
      Concealed: 'You often keep things in and protect first. One clear sentence can open space.',
      Triggered: 'You feel things fast and show it. A brief pause or naming the wobble often settles it.',
      Regulated: 'You steady yourself and read the room; a short recap or question keeps things clear.',
      Lead:      'Calm focus that helps others move; name intent and invite input.',
    };

    // “How this shows up…” body
    if (twoStates) {
      // Prefer an explicit array of two lines
      let pairLines = [];
      if (Array.isArray(data.howPair) && data.howPair.length) {
        pairLines = data.howPair.filter(Boolean).map(normText);
      } else if (typeof data.howPair === 'string' && data.howPair.trim()) {
        pairLines = data.howPair.split('\n').map(s => normText(s)).filter(Boolean);
      } else if (Array.isArray(data.stateWords)) {
        // Fallback to our defaults if caller didn’t provide pair text
        const [a, b] = data.stateWords;
        if (a && HOW_BY_STATE[a]) pairLines.push(HOW_BY_STATE[a]);
        if (b && HOW_BY_STATE[b]) pairLines.push(HOW_BY_STATE[b]);
      }
      const pairText = pairLines.join('\n');
      if (pairText) {
        drawTextBox(page1, helv, pairText, POS.howPair, { maxLines: 4, ellipsis: true });
      }
    } else if (data.how) {
      drawTextBox(page1, helv, normText(data.how), POS.howSingle, { maxLines: 4, ellipsis: true });
    }

    // Direction + Theme
    if (data.directionLabel)
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    if (data.directionMeaning)
      drawTextBox(page1, helv,     normText(data.directionMeaning),      POS.directionBody,   { maxLines: 3, ellipsis: true });

    if (data.themeLabel)
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…',      POS.themeHeader,     { maxLines: 1, ellipsis: true });
    if (data.themeMeaning)
      drawTextBox(page1, helv,     normText(data.themeMeaning),          POS.themeBody,       { maxLines: 2, ellipsis: true });

    // Chart
    if (!noGraph && data.chartUrl) {
      try {
        const r = await fetch(String(data.chartUrl));
        if (r.ok) {
          const png = await pdfDoc.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart;
          const pageH = page1.getHeight();
          page1.drawImage(png, { x, y: pageH - y - h, width: w, height: h });
        }
      } catch {/* ignore chart errors */}
    }

    // Footer
    const footer = '© CTRL Model by Toby Newman. All rights reserved. “Orientate, don’t rank.”';
    const pageW = page1.getWidth();
    const fSize = 9;
    const fW = helv.widthOfTextAtSize(footer, fSize);
    page1.drawText(footer, { x: (pageW - fW) / 2, y: POS.footerY, size: fSize, font: helv, color: rgb(0.36, 0.34, 0.50) });

    // Send PDF
    const bytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="ctrl_profile.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || String(e)));
  }
}
