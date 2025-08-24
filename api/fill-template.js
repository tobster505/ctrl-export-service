// /api/fill-template.js
// Fills your static PDF template (public/CTRL_Perspective_template.pdf)
// with results from Botpress, using pdf-lib (no headless browser).
//
// TEST LINKS (safe to click; no Botpress payload required):
//  • Single-state headline + HOW body + tips + chart:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1&preview=1
//
//  • Two-state headline (one line) + BLENDED "what this means" body + chart:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&blend=1&preview=1
//
//  • Two-state headline (one line) + TWO "what this means" bodies + chart:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&preview=1
//
//  • Tuner for the radar (draws a guide box):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&preview=1&cx=1050&cy=620&cw=700&ch=400&box=1
//
// Query params you can pass anytime while tuning:
//  - preview=1     → show inline (otherwise downloads)
//  - debug=1       → JSON with data + positions (no PDF)
//  - nograph=1     → skip the chart
//  - cx,cy,cw,ch   → override radar x/y/width/height
//  - box=1         → draw a thin guide rectangle around the radar
//  - hx,hy,hw,hs,halign       → override SINGLE-state "how this shows up" body
//  - mx2,my2,mw2,ms2,malign2  → override TWO-state "what this means" split bodies
//  - hx2,hy2,hw2,hs2,h2align  → override BLENDED TWO-state "what this means" body
//  - blend=1       → force pair preview to use the blended body (for tuning)

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
  const wantBlendParam = url.searchParams.get('blend') === '1';

  // --- Demo payloads (no Botpress needed) ---
  let data;
  if (isTest || isPair) {
    const common = {
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones - steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: 'Take one breath and name it: "I’m on edge."', // titles dropped; body only
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
      ? {
          ...common,
          stateWords: ['Triggered', 'Regulated'], // headline: A & B (one line)
          // Provide both modes for testing; 'blend=1' will pick the blended version
          how1: 'Feelings and energy arrive fast and show up visibly. Add a micro-pause so the energy helps rather than hijacks.',
          how2: 'You’re steady and present. You notice what’s happening and adjust without losing yourself.',
          howPair: 'Energy arrives fast but you settle it into useful motion. Add one micro-pause, then turn intensity into clarity and a simple invite.'
        }
      : {
          ...common,
          stateWord: 'Triggered',                  // headline: single state
          // single-state HOW body
          how: 'You feel things fast and show it. A brief pause or naming the wobble ("I’m on edge") often settles it.'
        };
  } else {
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
    }
  }

  // ======= POSITIONS (increase y to move text DOWN the page) =======
  const POS = {
    // headline (single vs pair) — keep as you set them
    headlineSingle: { x: 90,  y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
    headlinePair:   { x: 90,  y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

    // SINGLE-state: "how this shows up" (BODY ONLY; no title) — keep your preferred coords
    howSingle: {
      x: 160, y: 850, w: 700, size: 30, lineGap: 6, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },

    // TWO-state: split bodies (keep as-is)
    howPairA: {
      x: 150, y: 880, w: 720, size: 20, lineGap: 5, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },
    howPairB: {
      x: 150, y: 920, w: 720, size: 20, lineGap: 5, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },

    // NEW — TWO-state: blended single paragraph (centre by default; you will tune)
    howPairBlend: {
      x: 150, y: 870, w: 720, size: 22, lineGap: 5, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },

    // Tips row — titles removed; bodies only
    tip1Body:        { x: 80,  y: 535, w: 430, size: 11, lineGap: 3, color: rgb(0.24, 0.23, 0.35) },
    tip2Body:        { x: 540, y: 535, w: 430, size: 11, lineGap: 3, color: rgb(0.24, 0.23, 0.35) },

    // Direction + Theme (right column)
    directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
    themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // Radar chart — **BAKED-IN** with your chosen coords
    chart: { x: 1050, y: 620, w: 700, h: 400 },

    // footer
    footerY: 20,
  };

  // tuner overrides
  POS.chart = {
    x: num(url, 'cx', POS.chart.x),
    y: num(url, 'cy', POS.chart.y),
    w: num(url, 'cw', POS.chart.w),
    h: num(url, 'ch', POS.chart.h),
  };
  // allow tuning of single HOW
  POS.howSingle = {
    ...POS.howSingle,
    x: num(url, 'hx', POS.howSingle.x),
    y: num(url, 'hy', POS.howSingle.y),
    w: num(url, 'hw', POS.howSingle.w),
    size: num(url, 'hs', POS.howSingle.size),
    align: url.searchParams.get('halign') || POS.howSingle.align,
  };
  // allow tuning of two-state WHAT bodies as a pair (split mode)
  POS.howPairA = {
    ...POS.howPairA,
    x: num(url, 'mx2', POS.howPairA.x),
    y: num(url, 'my2', POS.howPairA.y),
    w: num(url, 'mw2', POS.howPairA.w),
    size: num(url, 'ms2', POS.howPairA.size),
    align: url.searchParams.get('malign2') || POS.howPairA.align,
  };
  // keep B relative to A unless explicitly overridden
  POS.howPairB = {
    ...POS.howPairB,
    x: num(url, 'mx2', POS.howPairB.x),
    y: num(url, 'my2b', POS.howPairB.y),
    w: num(url, 'mw2', POS.howPairB.w),
    size: num(url, 'ms2', POS.howPairB.size),
    align: url.searchParams.get('malign2') || POS.howPairB.align,
  };
  // allow tuning of BLENDED two-state body
  POS.howPairBlend = {
    ...POS.howPairBlend,
    x:   num(url, 'hx2', POS.howPairBlend.x),
    y:   num(url, 'hy2', POS.howPairBlend.y),
    w:   num(url, 'hw2', POS.howPairBlend.w),
    size:num(url, 'hs2', POS.howPairBlend.size),
    align: url.searchParams.get('h2align') || POS.howPairBlend.align,
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

    // ===== HOW/WHAT BODY =====
    if (!twoStates) {
      // SINGLE-state body ("how this shows up") — body only
      if (data.how) {
        drawTextBox(page1, helv, normText(data.how), POS.howSingle, { maxLines: 3, ellipsis: true });
      }
    } else {
      // TWO-state: prefer BLENDED paragraph when present or explicitly requested
      const wantBlend = wantBlendParam === true;
      const tBlend = normText(
        (data.howPair)
          || ((wantBlend || (!data.how1 && !data.how2)) ? (data.how || '') : '')
      );

      if (tBlend) {
        // single blended paragraph
        drawTextBox(page1, helv, tBlend, POS.howPairBlend, { maxLines: 4, ellipsis: true });
      } else {
        // fallback: two separate bodies
        const t1 = normText(data.how1 || '');
        const t2 = normText(data.how2 || '');
        if (t1) drawTextBox(page1, helv, t1, POS.howPairA, { maxLines: 2, ellipsis: true });
        if (t2) drawTextBox(page1, helv, t2, POS.howPairB, { maxLines: 2, ellipsis: true });
      }
    }

    // tips (titles removed; bodies only)
    if (data.tip1) drawTextBox(page1, helv, normText(data.tip1), POS.tip1Body, { maxLines: 2, ellipsis: true });
    if (data.tip2) drawTextBox(page1, helv, normText(data.tip2), POS.tip2Body, { maxLines: 2, ellipsis: true });

    // direction + theme
    if (data.directionLabel)
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    if (data.directionMeaning)
      drawTextBox(page1, helv,     normText(data.directionMeaning),      POS.directionBody,   { maxLines: 3, ellipsis: true });

    if (data.themeLabel)
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…',      POS.themeHeader,     { maxLines: 1, ellipsis: true });
    if (data.themeMeaning)
      drawTextBox(page1, helv,     normText(data.themeMeaning),          POS.themeBody,       { maxLines: 2, ellipsis: true });

    // radar chart (always attempted unless ?nograph=1)
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
    res.end('fill-template error: ' + (e?.message || e));
  }
}
