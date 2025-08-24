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
//  • Tuner for the radar (draws a guide box; uses your baked-in chart coords):
//    https://ctrl-export-service.vercel.app/api/fill-template?test=pair&preview=1&cx=1030&cy=620&cw=720&ch=420&box=1
//
// Query params you can pass anytime while tuning (blended only):
//  - preview=1     → show inline (otherwise downloads)
//  - debug=1       → JSON with data + positions (no PDF)
//  - nograph=1     → skip the chart
//  - cx,cy,cw,ch   → override radar x/y/width/height (guide with &box=1)
//  - hx,hy,hw,hs,halign   → override SINGLE-state "how this shows up" body
//  - hx2,hy2,hw2,hs2,h2align → override BLENDED TWO-state "what this means" body
//  - pair=TR|CT|RL|CR|CL|TL → choose which 2-state pair to demo (default TR)

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

// parse & normalise a pair key from query
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
  const pairKey  = getPairKey(url); // for pair test mode

  // --- Demo payloads (no Botpress needed) ---
  let data;
  if (isTest || isPair) {
    // Balanced copy + micro-tips for ALL 6 pair combos (blended)
    const PAIRS = {
      C_T: {
        words: ['Concealed', 'Triggered'],
        what:  "You swing between holding back and reacting fast. That usually means safety and pressure signals are both active. The goal is not to pick one; it is to install a small buffer so you can choose how much to share and when.",
        tips:  [
          "10-second buffer: name it privately, then choose to speak or pause.",
          "Share a headline, not the whole story: one sentence, then a question."
        ]
      },
      T_R: {
        words: ['Triggered', 'Regulated'],
        what:  "You feel things quickly and can settle yourself. That is a strong self-regulation muscle: energy plus adjustment. The opportunity is to shorten the time from spike to steady.",
        tips:  [
          "Use a cue sequence: breathe -> label -> ask.",
          "Have a micro-reset ready (one breath plus one sentence)."
        ]
      },
      R_L: {
        words: ['Regulated', 'Lead'],
        what:  "You move from steady to guiding. People likely anchor around you. The nudge is to keep inviting contributions so leading does not become carrying.",
        tips:  [
          "Name the purpose; ask 'Who sees it differently?'",
          "Hand the pen: let someone else summarise the decision."
        ]
      },
      C_R: {
        words: ['Concealed', 'Regulated'],
        what:  "Calm cover. You often hold back until you have steadied, then engage. It reads as thoughtful and low-drama, but can drift into distance. Aim for calm disclosure: share a small, clear line once you are steady so people are not left guessing.",
        tips:  [
          "Two-sentence rule: 1) 'I notice...' 2) 'So my view is...'",
          "Name a small feeling up-front: 'I am a bit uneasy - here is why...'"
        ]
      },
      C_L: {
        words: ['Concealed', 'Lead'],
        what:  "Quiet leadership. You prefer to think first and steer without fanfare. Safe and efficient, but it can feel opaque. Go for transparent intent: reveal a sliver of your thinking while you guide.",
        tips:  [
          "Open with why plus boundary: 'Our aim is X; I want Y to stay intact.'",
          "Invite a counterpoint early: 'What risk are we not seeing?'"
        ]
      },
      T_L: {
        words: ['Triggered', 'Lead'],
        what:  "Charged direction. Energy arrives fast and you point it at outcomes. That can rally a room or outrun it. Pivot from urgency to service: micro-pause, then turn intensity into clear invites and next steps.",
        tips:  [
          "Three-beat check: breathe -> label ('I am fired up') -> quick temperature check.",
          "Split your line: 'Intent is X. What would make this workable for you?'"
        ]
      }
    };

    const pick = PAIRS[pairKey] || PAIRS.T_R;

    const common = {
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones - steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: pick.tips[0],
      tip2: pick.tips[1],
      chartUrl: 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify({
        type: 'radar',
        data: {
          labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
          datasets: [{
            label: 'Frequency',
            data: [2, 2, 1, 0], // demo only; for placement testing
            fill: true,
            backgroundColor: 'rgba(115,72,199,0.18)',
            borderColor: '#7348C7',
            borderWidth: 2,
            pointRadius: [6, 6, 3, 0],
            pointHoverRadius: [7, 7, 4, 0],
            pointBackgroundColor: ['#7348C7','#7348C7','#9D7BE0','#9D7BE0'],
            pointBorderColor: ['#7348C7','#7348C7','#9D7BE0','#9D7BE0']
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
    };

    data = isPair
      ? {
          ...common,
          stateWords: pick.words, // headline: e.g., 'Triggered & Regulated'
          howPair: pick.what,     // blended pair body
          how: pick.what          // also set 'how' so blended mode works even if howPair not used
        }
      : {
          ...common,
          stateWord: 'Triggered', // single-state demo
          how: 'You feel things fast and show it. A brief pause or naming the wobble ("I am on edge") often settles it.'
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
    // headline (single vs pair)
    headlineSingle: { x: 90,  y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
    headlinePair:   { x: 90,  y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

    // SINGLE-state: "how this shows up" (BODY ONLY; no title)
    howSingle: {
      x: 160, y: 850, w: 700, size: 30, lineGap: 6, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },

    // TWO-state: BLENDED single paragraph (your defaults baked in)
    howPairBlend: {
      x: 160, y: 880, w: 700, size: 24, lineGap: 5, color: rgb(0.24, 0.23, 0.35), align: 'center'
    },

    // Tips row — bodies only
    tip1Body:        { x: 80,  y: 535, w: 430, size: 11, lineGap: 3, color: rgb(0.24, 0.23, 0.35) },
    tip2Body:        { x: 540, y: 535, w: 430, size: 11, lineGap: 3, color: rgb(0.24, 0.23, 0.35) },

    // Direction + Theme (right column)
    directionHeader: { x: 320, y: 245, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    directionBody:   { x: 320, y: 265, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },
    themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: rgb(0.24, 0.23, 0.35) },
    themeBody:       { x: 320, y: 320, w: 360, size: 11, color: rgb(0.24, 0.23, 0.35) },

    // Radar chart — DEFAULTS baked in from your last step
    chart: { x: 1030, y: 620, w: 720, h: 420 },

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
      // TWO-state: BLENDED paragraph only (split mode removed)
      const tBlend = normText(data.howPair || data.how || '');
      if (tBlend) {
        drawTextBox(page1, helv, tBlend, POS.howPairBlend, { maxLines: 4, ellipsis: true });
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
