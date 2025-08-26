// /api/fill-template.js
// Fills your static PDF template (public/CTRL_Perspective_template.pdf)
// with results (from Botpress payload ?data=BASE64 or built-in test).
//
// TEST LINKS (safe; no Botpress payload):
//  • Single-state headline + HOW + tips + chart + page2 blocks:
//    /api/fill-template?test=1&preview=1
//
//  • Two-state headline (one line) + BLENDED "what this means" + tips + chart + page2 blocks:
//    /api/fill-template?test=pair&pair=TL&blend=1&preview=1
//
//  • With your locked chart coords and HOW-blended coords:
//    /api/fill-template?test=pair&pair=TL&blend=1&preview=1&hx2=55&hy2=830&hw2=950&hs2=24&h2align=center&cx=1030&cy=620&cw=720&ch=420
//
//  • Add &debug=1 to inspect positions/data without rendering a PDF.
//  • Tuning params you can pass anytime (examples above):
//      Chart:    cx,cy,cw,ch
//      HOW pair: hx2,hy2,hw2,hs2,h2align
//      Tips:     t1x,t1y,t1w,t1s,t1align,t2x,t2y,t2w,t2s,t2align
//      Page 2:   p2x,p2y,p2w,p2hsize,p2bsize,p2gap,p2cols,p2colgap,p2max,p2tmax
//
// Runtime for Vercel:
//   node (NOT nodejs18.x)
export const config = { runtime: 'nodejs' };

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

  // return how far we drew (approx height)
  return out.length * lineHeight;
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
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const noGraph  = url.searchParams.get('nograph') === '1';
  const wantBlend= url.searchParams.get('blend') === '1';

  // --- Demo payloads (no Botpress needed) ---
  let data;
  if (isTest || isPair) {
    const common = {
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones - steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: 'Take one breath and name it: \'I am on edge.\'',
      tip2: 'Choose your gear on purpose: protect, steady, or lead - say it in one line.',
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
            pointHoverRadius: [4, 7, 4, 0],
            pointBackgroundColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
            pointBorderColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
          }]
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
      // Default page-2 blocks (patterns)
      page2Blocks: [
        { title: 'Most & least seen',    body: 'Most seen: Triggered. Least seen: Lead. That is your current centre of gravity - keep its strengths and add one tiny counter-balance.' },
        { title: 'Start → Finish',       body: 'Started in Triggered, finished in Triggered — steady. You started and ended in similar zones - steady overall.' },
        { title: 'Pattern shape',         body: 'Varied responses without one rhythm. Reflect briefly to spot what flipped you.' },
        { title: 'Switching & volatility',body: 'You switched 3 of 4 steps (volatility ≈ 0.75). High volatility — helpful if chosen; draining if automatic.' },
        { title: 'Streaks / clusters',    body: 'Longest run: Triggered × 2. Pairs showed up. Brief runs; small anchors help keep direction.' },
        { title: 'Momentum',              body: 'Steady. You started and ended in similar zones — steady overall.' },
        { title: 'Resilience & retreat',  body: 'Moved up after C/T: 1. Slipped down after R/L: 1. Even balance — keep the resets that help you recover.' },
        { title: 'Early vs late',         body: 'Slightly steadier later on (gentle rise). (Δ ≈ 0.83 on a 1–4 scale).' },
      ],
      // Optional page-2 themes group (top 3, etc.)
      page2Themes: [
        { title: 'Theme — Emotion regulation', body: 'Settling yourself when feelings spike.' },
        { title: 'Theme — Social navigation',  body: 'Reading the room and adjusting to people and context.' },
        { title: 'Theme — Awareness of impact',body: 'Noticing how your words and actions land.' },
      ]
    };

    data = isPair
      ? {
          ...common,
          stateWords: ['Triggered', 'Lead'], // headline (one line, already centered)
          // blended pair body
          howPair: 'Charged direction. Energy arrives fast and you point it at outcomes. That can rally a room or outrun it. Pivot from urgency to service: micro-pause, then turn intensity into clear invites and next steps.',
        }
      : {
          ...common,
          stateWord: 'Triggered',
          how: 'Feelings and energy arrive fast and show up visibly. That drive can push things forward, but it can also narrow your focus or make you over-defend. The work is adding a micro-pause so the energy helps rather than hijacks.',
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
    // headline (single vs pair) — your single/pair positions (unchanged)
    headlineSingle: { x: 90,  y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
    headlinePair:   { x: 90,  y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

    // SINGLE-state: HOW (BODY ONLY; you liked centered/bigger)
    howSingle: {
      x: 160, y: 850, w: 700, size: 30, lineGap: 6, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },

    // TWO-state: blended "what this means" (single body line/para)
    howPairBlend: {
      x: 55, y: 830, w: 950, size: 24, lineGap: 5, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },

    // Tips row — bodies only (no titles)
    tip1Body:  { x: 120, y: 1015, w: 410, size: 23, lineGap: 3, color: rgb(0.24, 0.23, 0.35), align: 'center' },
    tip2Body:  { x: 500, y: 1015, w: 460, size: 23, lineGap: 3, color: rgb(0.24, 0.23, 0.35), align: 'center' },

    // Direction + Theme (right column on page 1)
    directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
    themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // Radar chart — your locked defaults (overridable via cx/cy/cw/ch)
    chart: { x: 1030, y: 620, w: 720, h: 420 },

    // Page 2 grid defaults (you can tune with p2* params)
    p2: {
      x: 90,     // left margin of the grid area
      y: 230,    // start (from top) — bigger number = lower on page
      w: 860,    // total width reserved for columns
      cols: 2,   // number of columns (2 by default)
      colGap: 24,// gap between columns
      hSize: 13, // title size
      bSize: 11, // body size
      gap: 10,   // vertical gap between blocks
      max: 8,    // max pattern blocks
      tmax: 6,   // max theme blocks
    },

    footerY: 20,
  };

  // === TUNERS ===
  // Chart tuner
  POS.chart = {
    x: num(url, 'cx', POS.chart.x),
    y: num(url, 'cy', POS.chart.y),
    w: num(url, 'cw', POS.chart.w),
    h: num(url, 'ch', POS.chart.h),
  };

  // HOW blended tuner
  POS.howPairBlend = {
    ...POS.howPairBlend,
    x: num(url, 'hx2', POS.howPairBlend.x),
    y: num(url, 'hy2', POS.howPairBlend.y),
    w: num(url, 'hw2', POS.howPairBlend.w),
    size: num(url, 'hs2', POS.howPairBlend.size),
    align: url.searchParams.get('h2align') || POS.howPairBlend.align,
  };

  // Single HOW tuner (kept for completeness; you usually use blended pair)
  POS.howSingle = {
    ...POS.howSingle,
    x: num(url, 'hx', POS.howSingle.x),
    y: num(url, 'hy', POS.howSingle.y),
    w: num(url, 'hw', POS.howSingle.w),
    size: num(url, 'hs', POS.howSingle.size),
    align: url.searchParams.get('halign') || POS.howSingle.align,
  };

  // Tips tuner
  POS.tip1Body = {
    ...POS.tip1Body,
    x: num(url, 't1x', POS.tip1Body.x),
    y: num(url, 't1y', POS.tip1Body.y),
    w: num(url, 't1w', POS.tip1Body.w),
    size: num(url, 't1s', POS.tip1Body.size),
    align: url.searchParams.get('t1align') || POS.tip1Body.align,
  };
  POS.tip2Body = {
    ...POS.tip2Body,
    x: num(url, 't2x', POS.tip2Body.x),
    y: num(url, 't2y', POS.tip2Body.y),
    w: num(url, 't2w', POS.tip2Body.w),
    size: num(url, 't2s', POS.tip2Body.size),
    align: url.searchParams.get('t2align') || POS.tip2Body.align,
  };

  // Page 2 tuner
  POS.p2 = {
    ...POS.p2,
    x:     num(url, 'p2x', POS.p2.x),
    y:     num(url, 'p2y', POS.p2.y),
    w:     num(url, 'p2w', POS.p2.w),
    hSize: num(url, 'p2hsize', POS.p2.hSize),
    bSize: num(url, 'p2bsize', POS.p2.bSize),
    gap:   num(url, 'p2gap', POS.p2.gap),
    cols:  num(url, 'p2cols', POS.p2.cols),
    colGap:num(url, 'p2colgap', POS.p2.colGap),
    max:   num(url, 'p2max', POS.p2.max),
    tmax:  num(url, 'p2tmax', POS.p2.tmax),
  };

  // Optional debug JSON
  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      hint: 'Add &preview=1 to view inline, &nograph=1 to skip chart',
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
    const pages = pdfDoc.getPages();
    const page1  = pages[0];                 // ALWAYS draw page-1 on template page 1
    const page2  = pages[1] || pages[0];     // ALWAYS draw page-2 on template page 2 (fallback page1 if single-page template)
    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // ---------- Headline (single or pair on one line) ----------
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

    // ---------- HOW / WHAT BODY ----------
    if (!twoStates) {
      // SINGLE-state body
      if (data.how) {
        drawTextBox(page1, helv, normText(data.how), POS.howSingle, { maxLines: 3, ellipsis: true });
      }
    } else {
      // TWO-state blended body (preferred)
      const blendedText = normText(data.howPair || data.how || '');
      if (wantBlend || blendedText) {
        drawTextBox(page1, helv, blendedText, POS.howPairBlend, { maxLines: 3, ellipsis: true });
      }
    }

    // ---------- Tips (bodies only) ----------
    if (data.tip1) drawTextBox(page1, helv, normText(data.tip1), POS.tip1Body, { maxLines: 2, ellipsis: true });
    if (data.tip2) drawTextBox(page1, helv, normText(data.tip2), POS.tip2Body, { maxLines: 2, ellipsis: true });

    // ---------- Direction + Theme (page 1 right column) ----------
    if (data.directionLabel)
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    if (data.directionMeaning)
      drawTextBox(page1, helv,     normText(data.directionMeaning),      POS.directionBody,   { maxLines: 3, ellipsis: true });

    if (data.themeLabel)
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…',      POS.themeHeader,     { maxLines: 1, ellipsis: true });
    if (data.themeMeaning)
      drawTextBox(page1, helv,     normText(data.themeMeaning),          POS.themeBody,       { maxLines: 2, ellipsis: true });

    // ---------- Radar chart (page 1) ----------
    if (!noGraph && data.chartUrl) {
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

    // ---------- PAGE 2: Patterns & Themes ----------
    const patternBlocks = Array.isArray(data.page2Blocks) ? data.page2Blocks.slice(0, POS.p2.max) : [];
    const themeBlocks   = Array.isArray(data.page2Themes) ? data.page2Themes.slice(0, POS.p2.tmax) : [];

    // Simple two-column block renderer (title bold, body regular)
    function drawBlocksGrid(pg, blocks, startY) {
      if (!blocks.length) return;

      const colCount = Math.max(1, POS.p2.cols | 0);
      const colGap   = POS.p2.colGap;
      const colW     = Math.floor((POS.p2.w - (colGap * (colCount - 1))) / colCount);
      const left     = POS.p2.x;
      const pageH    = pg.getHeight();

      let cursors = new Array(colCount).fill(startY);
      const makeSpecTitle = (colIdx) => ({
        x: left + colIdx * (colW + colGap),
        y: cursors[colIdx],
        w: colW,
        size: POS.p2.hSize,
        lineGap: 3,
        color: rgb(0.24, 0.23, 0.35),
        align: 'left'
      });
      const makeSpecBody = (colIdx) => ({
        x: left + colIdx * (colW + colGap),
        y: cursors[colIdx] + POS.p2.hSize + 6, // body sits just below the title
        w: colW,
        size: POS.p2.bSize,
        lineGap: 3,
        color: rgb(0.24, 0.23, 0.35),
        align: 'left'
      });

      blocks.forEach(b => {
        // find the column with the smallest cursor (fills top-down, left-right-ish)
        let colIdx = 0;
        for (let i = 1; i < colCount; i++) {
          if (cursors[i] < cursors[colIdx]) colIdx = i;
        }
        // Title
        const usedH1 = drawTextBox(pg, helvBold, normText(b.title || ''), makeSpecTitle(colIdx), { maxLines: 1, ellipsis: true });
        // Body
        const usedH2 = drawTextBox(pg, helv, normText(b.body || ''), makeSpecBody(colIdx), { maxLines: 3, ellipsis: true });
        // advance cursor with vertical gap
        const added = Math.max(usedH1 + usedH2 + POS.p2.gap, POS.p2.hSize + POS.p2.bSize + POS.p2.gap + 4);
        cursors[colIdx] += added;
      });
    }

    // We draw Patterns first, then Themes below them with a little extra spacing
    const startY = POS.p2.y;
    drawBlocksGrid(page2, patternBlocks, startY);
    // if we also have themes, start them a bit lower than patterns' start
    if (themeBlocks.length) {
      drawBlocksGrid(page2, themeBlocks, startY + 220); // small fixed offset; tune with p2y if needed
    }

    // ---------- Send PDF ----------
    const bytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    const name = url.searchParams.get('name') || 'ctrl_profile.pdf';
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    // readable error instead of blank 500
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
