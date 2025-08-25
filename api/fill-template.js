// /api/fill-template.js
// Fills your static PDF template (public/CTRL_Perspective_template.pdf)
// with results from Botpress, using pdf-lib (no headless browser).
//
// TEST LINKS (no Botpress payload required):
//  • Single-state headline + HOW body + chart:
//    https://ctrl-export-service.vercel.app/api/fill-template?test=1&preview=1
//
//  • Two-state headline (one line) + BLENDED "what this means" + chart
//    (pick which pair using &pair=TR | CT | RL | CR | CL | TL):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&pair=TR&preview=1
//
//  • Tuner for the radar (uses your baked-in chart coords; optional guide box):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&preview=1&cx=1030&cy=620&cw=720&ch=420&box=1
//
// Page-2 tuners:
//  - p2x, p2y, p2w      → left/top/width for the Page-2 stack of blocks
//  - p2hs, p2bs         → header font size, body font size
//  - p2gap              → vertical gap between blocks (px, baseline to baseline)
//  - p2max              → max wrapped lines for each body (default 3)
//
// Page-1 tuners retained (locked defaults):
//  - hx2,hy2,hw2,hs2,h2align  → BLENDED two-state "what this means"
//  - cx,cy,cw,ch              → radar chart
//  - t1x,t1y,t1s,t1w,t1align  → Tip (left)
//  - t2x,t2y,t2s,t2w,t2align  → Next (right)
//
// NOTE: No footer/copyright drawing here (you’re hard-coding it in the template).

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

// y measured from TOP; increase y → move text DOWN the page
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
  const topY = pageH - y;
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

function getPairKey(url) {
  const raw = String(url.searchParams.get('pair') || '').toUpperCase().replace(/[^A-Z]/g, '');
  const map = { CT: 'C_T', TC: 'C_T', TR: 'T_R', RT: 'T_R', RL: 'R_L', LR: 'R_L',
                CR: 'C_R', RC: 'C_R', CL: 'C_L', LC: 'C_L', TL: 'T_L', LT: 'T_L' };
  return map[raw] || 'T_R';
}

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
  const pairKey  = getPairKey(url);

  // --- Demo payloads (no Botpress needed) ---
  let data;
  if (isTest || isPair) {
    // Minimal pair catalogue so the link works without Botpress
    const PAIRS = {
      C_T: { words: ['Concealed','Triggered'],
             what: "You swing between holding back and reacting fast. The goal isn’t to pick one; add a small buffer so you can choose how much to share and when.",
             tips: ["10-second buffer: name it privately, then choose to speak or pause.",
                    "Share a headline, not the whole story: one sentence, then a question."] },
      T_R: { words: ['Triggered','Regulated'],
             what: "You feel things quickly and can settle yourself. Shorten the time from spike to steady.",
             tips: ["Use a cue sequence: breathe → label → ask.",
                    "Have a micro-reset ready (one breath plus one sentence)."] },
      R_L: { words: ['Regulated','Lead'],
             what: "You move from steady to guiding. Keep inviting contributions so leading doesn’t become carrying.",
             tips: ["Name the purpose; ask ‘Who sees it differently?’",
                    "Hand the pen: let someone else summarise the decision."] },
      C_R: { words: ['Concealed','Regulated'],
             what: "Calm cover: you hold back until steady, then engage. Aim for calm disclosure so people aren’t left guessing.",
             tips: ["Two-sentence rule: 1) ‘I notice…’ 2) ‘So my view is…’",
                    "Name a small feeling up-front: ‘I’m a bit uneasy—here’s why…’"] },
      C_L: { words: ['Concealed','Lead'],
             what: "Quiet leadership: think first, steer without fanfare. Reveal a sliver of your thinking while you guide.",
             tips: ["Open with why + boundary: ‘Our aim is X; I want Y to stay intact.’",
                    "Invite a counterpoint early: ‘What risk are we not seeing?’"] },
      T_L: { words: ['Triggered','Lead'],
             what: "Charged direction: energy arrives fast and you point it at outcomes. Pivot from urgency to service.",
             tips: ["Three-beat check: breathe → label (‘I’m fired up’) → quick temperature check.",
                    "Split your line: ‘Intent is X. What would make this workable for you?’"] }
    };
    const pick = PAIRS[pairKey] || PAIRS.T_R;

    // Simple demo page-2 blocks
    const page2Blocks = [
      { title: "Most & least seen (demo)", body: "Most seen: Triggered & Lead (tie). Least seen: Lead. Hovering between gears—use both on purpose." },
      { title: "Start → Finish (demo)",    body: "Started in Triggered, finished in Lead — gentle upward tilt. Slightly steadier by the end." },
      { title: "Pattern (demo)",           body: "Mixed pattern—varied responses without one rhythm." }
    ];

    data = {
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones - steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: pick.tips[0],
      tip2: pick.tips[1],
      chartUrl: 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify({
        type: 'radar',
        data: { labels: ['Concealed','Triggered','Regulated','Lead'],
                datasets: [{ label: 'Frequency', data: [2,2,1,0], fill: true,
                             backgroundColor: 'rgba(115,72,199,0.18)', borderColor: '#7348C7', borderWidth: 2,
                             pointRadius: [6,6,3,0], pointHoverRadius: [7,7,4,0],
                             pointBackgroundColor: ['#7348C7','#7348C7','#9D7BE0','#9D7BE0'],
                             pointBorderColor:     ['#7348C7','#7348C7','#9D7BE0','#9D7BE0'] }]},
        options: { plugins:{ legend:{ display:false }},
                   scales:{ r:{ min:0, max:5,
                                ticks:{ display:true, stepSize:1, backdropColor:'rgba(0,0,0,0)' },
                                grid:{ circular:true }, angleLines:{ display:true },
                                pointLabels:{ color:'#4A4458', font:{ size:12 } } } } })),
      stateWords: pick.words,
      how: pick.what,
      howPair: pick.what,

      // NEW
      page2Blocks
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

  // ======= POSITIONS (increase y to move text DOWN) =======
  const POS = {
    // Headline (single vs pair) – unchanged
    headlineSingle: { x: 90,  y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
    headlinePair:   { x: 90,  y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

    // Page 1 — BLENDED “what this means” (LOCKED)
    howSingle:   { x: 160, y: 850, w: 700, size: 30, lineGap: 6, color: rgb(0.24, 0.23, 0.35), align: 'center' },
    howPairBlend:{ x:  55, y: 830, w: 950, size: 24, lineGap: 5, color: rgb(0.24, 0.23, 0.35), align: 'center' },

    // Page 1 — Tips (LOCKED)
    tip1Body: { x:  90, y: 1015, w: 460, size: 23, lineGap: 3, color: rgb(0.24, 0.23, 0.35), align: 'center' },
    tip2Body: { x: 500, y: 1015, w: 460, size: 23, lineGap: 3, color: rgb(0.24, 0.23, 0.35), align: 'center' },

    // Page 1 — Direction + Theme (unchanged)
    directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
    themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // Page 1 — Radar chart (LOCKED)
    chart: { x: 1030, y: 620, w: 720, h: 420 },

    // NEW — Page 2 block stack defaults
    page2: {
      x: 90,     // left edge of the column
      y: 160,    // top offset from page top (increase to move down)
      w: 850,    // width of the column
      hs: 14,    // header font size
      bs: 12,    // body font size
      gap: 26,   // vertical gap between blocks (baseline-to-baseline)
      max: 3     // max wrapped lines for each body
    }
  };

  // Tuners (page 1 — keep working)
  POS.chart = { x: num(url, 'cx', POS.chart.x), y: num(url, 'cy', POS.chart.y),
                w: num(url, 'cw', POS.chart.w), h: num(url, 'ch', POS.chart.h) };
  POS.howPairBlend = {
    ...POS.howPairBlend,
    x: num(url, 'hx2', POS.howPairBlend.x),
    y: num(url, 'hy2', POS.howPairBlend.y),
    w: num(url, 'hw2', POS.howPairBlend.w),
    size: num(url, 'hs2', POS.howPairBlend.size),
    align: url.searchParams.get('h2align') || POS.howPairBlend.align,
  };
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

  // Tuners (page 2)
  POS.page2 = {
    ...POS.page2,
    x:  num(url, 'p2x',  POS.page2.x),
    y:  num(url, 'p2y',  POS.page2.y),
    w:  num(url, 'p2w',  POS.page2.w),
    hs: num(url, 'p2hs', POS.page2.hs),
    bs: num(url, 'p2bs', POS.page2.bs),
    gap:num(url, 'p2gap',POS.page2.gap),
    max:num(url, 'p2max',POS.page2.max),
  };

  const showBox = url.searchParams.get('box') === '1';

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      hint: 'Add &preview=1 to view inline, &box=1 for chart guide, &nograph=1 to skip chart',
      data,
      pos: POS,
      urlParams: Object.fromEntries(url.searchParams.entries())
    }, null, 2));
    return;
  }

  try {
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const pages = pdfDoc.getPages();
    const page1  = pages[0];
    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Headline
    const twoStates = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
    const headlineText = twoStates
      ? `${normText(data.stateWords[0])} & ${normText(data.stateWords[1])}`
      : normText(data.stateWord || '—');
    drawTextBox(page1, helvBold, headlineText,
      { ...(twoStates ? POS.headlinePair : POS.headlineSingle), align: 'center' },
      { maxLines: 1, ellipsis: true }
    );

    // Page 1 — HOW/WHAT
    if (!twoStates) {
      if (data.how) drawTextBox(page1, helv, normText(data.how), POS.howSingle, { maxLines: 3, ellipsis: true });
    } else {
      const tBlend = normText(data.howPair || data.how || '');
      if (tBlend) drawTextBox(page1, helv, tBlend, POS.howPairBlend, { maxLines: 4, ellipsis: true });
    }

    // Page 1 — Tips
    if (data.tip1) drawTextBox(page1, helv, normText(data.tip1), POS.tip1Body, { maxLines: 2, ellipsis: true });
    if (data.tip2) drawTextBox(page1, helv, normText(data.tip2), POS.tip2Body, { maxLines: 2, ellipsis: true });

    // Page 1 — Direction + Theme
    if (data.directionLabel)
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', POS.directionHeader, { maxLines: 1, ellipsis: true });
    if (data.directionMeaning)
      drawTextBox(page1, helv,     normText(data.directionMeaning),      POS.directionBody,   { maxLines: 3, ellipsis: true });

    if (data.themeLabel)
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…',      POS.themeHeader,     { maxLines: 1, ellipsis: true });
    if (data.themeMeaning)
      drawTextBox(page1, helv,     normText(data.themeMeaning),          POS.themeBody,       { maxLines: 2, ellipsis: true });

    // Page 1 — Radar
    if (!noGraph && data.chartUrl) {
      if (showBox) {
        const { x, y, w, h } = POS.chart;
        const pageH = page1.getHeight();
        page1.drawRectangle({ x, y: pageH - y - h, width: w, height: h,
                              borderColor: rgb(0.45, 0.35, 0.6), borderWidth: 1 });
      }
      try {
        const r = await fetch(String(data.chartUrl));
        if (r.ok) {
          const png = await pdfDoc.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart;
          const pageH = page1.getHeight();
          page1.drawImage(png, { x, y: pageH - y - h, width: w, height: h });
        }
      } catch { /* ignore chart failures */ }
    }

    // ===== Page 2 — Insights stack =====
    let page2 = pages[1];
    if (!page2) {
      // If your template already has page 2, this won't run.
      page2 = pdfDoc.addPage([page1.getWidth(), page1.getHeight()]);
    }

    const blocks = Array.isArray(data.page2Blocks) ? data.page2Blocks : [];
    if (blocks.length) {
      const col = POS.page2;
      let y = col.y;

      for (const b of blocks) {
        // Title
        if (b.title) {
          drawTextBox(page2, helvBold, normText(b.title), { x: col.x, y, w: col.w, size: col.hs, color: rgb(0.24,0.23,0.35) },
                      { maxLines: 1, ellipsis: true });
          y += col.hs + 4; // small gap title→body
        }
        // Body
        if (b.body) {
          drawTextBox(page2, helv, normText(b.body), { x: col.x, y, w: col.w, size: col.bs, color: rgb(0.24,0.23,0.35) },
                      { maxLines: col.max, ellipsis: true });
          y += col.bs * Math.min(col.max, 2) + col.gap; // advance roughly; tune with p2gap
        }
      }
    }

    // Finalise
    const bytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="ctrl_profile.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
