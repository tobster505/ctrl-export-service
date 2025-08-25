// /api/fill-template.js
// Draws your CTRL profile onto the static template using pdf-lib.
// Safer version: lazy imports, early debug return, tolerant fetches.

export const config = { runtime: 'nodejs18.x' }; // safe on Vercel; omit if you prefer project default

/* --------------------------
   Helpers (no heavy deps)
--------------------------- */

// ASCII normaliser so standard fonts render reliably
function normText(v, fallback = '') {
  return String(v ?? fallback)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// parse numeric query param with default
const num = (url, key, def) => {
  const n = Number(url.searchParams.get(key));
  return Number.isFinite(n) ? n : def;
};

// load template from /public (with a fallback guard)
async function loadTemplateBytes(req) {
  const host  = req.headers.host || 'ctrl-export-service.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url   = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`template fetch failed: ${r.status} ${r.statusText} @ ${url}`);
  }
  return new Uint8Array(await r.arrayBuffer());
}

// simple line-wrapper + box-draw (y measured from TOP of page)
// pdf-lib specifics are injected via args to avoid hard imports.
function drawTextBox(page, font, text, spec, opts = {}, pdfRgb) {
  const {
    x = 40, y = 40, w = 520, size = 12, color = pdfRgb(0, 0, 0),
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

/* --------------------------
   Main handler
--------------------------- */

export default async function handler(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.statusCode = 400;
    res.end('Bad URL');
    return;
  }

  const isTest   = url.searchParams.get('test') === '1';
  const isPair   = url.searchParams.get('test') === 'pair';
  const debug    = url.searchParams.get('debug') === '1';
  const noGraph  = url.searchParams.get('nograph') === '1';
  const preview  = url.searchParams.get('preview') === '1';

  // --- Build data (NO pdf-lib yet) ---
  let data;
  try {
    if (isTest || isPair) {
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
        ? {
            ...common,
            stateWords: ['Triggered', 'Lead'],
            howPair: 'Charged direction. Energy arrives fast and you point it at outcomes. That can rally a room or outrun it. Pivot from urgency to service: micro-pause, then turn intensity into clear invites and next steps.',
            how: 'Charged direction. Energy arrives fast and you point it at outcomes. That can rally a room or outrun it. Pivot from urgency to service: micro-pause, then turn intensity into clear invites and next steps.'
          }
        : {
            ...common,
            stateWord: 'Triggered',
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
  } catch (e) {
    res.statusCode = 500;
    res.end('payload build error: ' + (e?.message || e));
    return;
  }

  // ======= POSITIONS (increase y to move text DOWN the page) =======
  const POS = {
    // headline (single vs pair)
    headlineSingle: { x: 90,  y: 650, w: 860, size: 72, lineGap: 4, color: [0.12, 0.11, 0.2] },
    headlinePair:   { x: 90,  y: 650, w: 860, size: 56, lineGap: 4, color: [0.12, 0.11, 0.2] },

    // SINGLE-state body (you said you’ve already tuned these elsewhere)
    howSingle: {
      x: num(url, 'hx', 160), y: num(url, 'hy', 850), w: num(url, 'hw', 700),
      size: num(url, 'hs', 30), lineGap: 6, color: [0.24, 0.23, 0.35],
      align: url.searchParams.get('halign') || 'center'
    },

    // BLENDED two-state body (locked by you)
    howPairBlend: {
      x: num(url, 'hx2', 55), y: num(url, 'hy2', 830), w: num(url, 'hw2', 950),
      size: num(url, 'hs2', 24), lineGap: 5, color: [0.24, 0.23, 0.35],
      align: url.searchParams.get('h2align') || 'center'
    },

    // Tips (“tip” and “next”) — tunable
    tip1Body: {
      x: num(url, 't1x', 90), y: num(url, 't1y', 1015), w: num(url, 't1w', 460),
      size: num(url, 't1s', 23), lineGap: 3, color: [0.24, 0.23, 0.35],
      align: url.searchParams.get('t1align') || 'center'
    },
    tip2Body: {
      x: num(url, 't2x', 500), y: num(url, 't2y', 1015), w: num(url, 't2w', 460),
      size: num(url, 't2s', 23), lineGap: 3, color: [0.24, 0.23, 0.35],
      align: url.searchParams.get('t2align') || 'center'
    },

    // Right column (page 1)
    directionHeader: { x: 320, y: 245, w: 360, size: 12, color: [0.24, 0.23, 0.35] },
    directionBody:   { x: 320, y: 265, w: 360, size: 11, color: [0.24, 0.23, 0.35] },
    themeHeader:     { x: 320, y: 300, w: 360, size: 12, color: [0.24, 0.23, 0.35] },
    themeBody:       { x: 320, y: 320, w: 360, size: 11, color: [0.24, 0.23, 0.35] },

    // Radar chart (locked by you; tunable via URL)
    chart: {
      x: num(url, 'cx', 1030),
      y: num(url, 'cy', 620),
      w: num(url, 'cw', 720),
      h: num(url, 'ch', 420),
    },

    // Page 2 supporting blocks (tunable)
    p2: {
      x: num(url, 'p2x', 90),
      y: num(url, 'p2y', 160),
      w: num(url, 'p2w', 850),
      hSize: num(url, 'p2hs', 14), // header size
      bSize: num(url, 'p2bs', 12), // body size
      gap: num(url, 'p2gap', 28),  // vertical gap between blocks
      max: num(url, 'p2max', 3)    // max lines per body
    },

    // footer (you’re hard-coding this in template now; we won’t draw)
    footerY: 20,
  };

  // ===== Early DEBUG short-circuit (no pdf-lib, no fetch) =====
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
    // Lazy import pdf-lib so we don’t crash before debug returns
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

    // load template
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1  = pdfDoc.getPage(0);

    // fonts
    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // util to translate RGB arrays into pdf-lib rgb()
    const pdfRgb = (r, g, b) => rgb(r, g, b);
    const useColor = (arr) => pdfRgb(arr[0], arr[1], arr[2]);

    // headline (single or pair on one line)
    const twoStates = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
    const headlineText = twoStates
      ? `${normText(data.stateWords[0])} & ${normText(data.stateWords[1])}`
      : normText(data.stateWord || '—');

    const headSpec = twoStates ? POS.headlinePair : POS.headlineSingle;
    drawTextBox(
      page1, helvBold, headlineText,
      { ...headSpec, color: useColor(headSpec.color), align: 'center' },
      { maxLines: 1, ellipsis: true },
      pdfRgb
    );

    // ===== HOW/WHAT BODY =====
    if (!twoStates) {
      // SINGLE-state body
      if (data.how) {
        const s = POS.howSingle;
        drawTextBox(page1, helv, normText(data.how), { ...s, color: useColor(s.color) }, { maxLines: 3, ellipsis: true }, pdfRgb);
      }
    } else {
      // BLENDED two-state body (one paragraph)
      const t = normText(data.howPair || data.how || '');
      if (t) {
        const s = POS.howPairBlend;
        drawTextBox(page1, helv, t, { ...s, color: useColor(s.color) }, { maxLines: 3, ellipsis: true }, pdfRgb);
      }
    }

    // tips (bodies only)
    if (data.tip1) {
      const s = POS.tip1Body;
      drawTextBox(page1, helv, normText(data.tip1), { ...s, color: useColor(s.color) }, { maxLines: 2, ellipsis: true }, pdfRgb);
    }
    if (data.tip2) {
      const s = POS.tip2Body;
      drawTextBox(page1, helv, normText(data.tip2), { ...s, color: useColor(s.color) }, { maxLines: 2, ellipsis: true }, pdfRgb);
    }

    // direction + theme (right column)
    if (data.directionLabel) {
      const s = POS.directionHeader;
      drawTextBox(page1, helvBold, normText(data.directionLabel) + '…', { ...s, color: useColor(s.color) }, { maxLines: 1, ellipsis: true }, pdfRgb);
    }
    if (data.directionMeaning) {
      const s = POS.directionBody;
      drawTextBox(page1, helv, normText(data.directionMeaning), { ...s, color: useColor(s.color) }, { maxLines: 3, ellipsis: true }, pdfRgb);
    }
    if (data.themeLabel) {
      const s = POS.themeHeader;
      drawTextBox(page1, helvBold, normText(data.themeLabel) + '…', { ...s, color: useColor(s.color) }, { maxLines: 1, ellipsis: true }, pdfRgb);
    }
    if (data.themeMeaning) {
      const s = POS.themeBody;
      drawTextBox(page1, helv, normText(data.themeMeaning), { ...s, color: useColor(s.color) }, { maxLines: 2, ellipsis: true }, pdfRgb);
    }

    // radar chart (skip quietly if fetch fails or nograph=1)
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

    // -------- (Optional) Page 2 supporting blocks ----------
    // If you later add a second page to the template, uncomment to render:
    /*
    const page2 = pdfDoc.addPage();
    const p2 = POS.p2;
    const hColor = pdfRgb(0.24, 0.23, 0.35);
    const bColor = pdfRgb(0.24, 0.23, 0.35);
    const blocks = Array.isArray(data.page2Blocks) ? data.page2Blocks : []; // [{title, body}, ...]
    let y = p2.y;
    for (const blk of blocks) {
      drawTextBox(page2, helvBold, normText(blk.title||''), { x:p2.x, y, w:p2.w, size:p2.hSize, color:hColor }, { maxLines: 1, ellipsis: true }, pdfRgb);
      y += p2.hSize + 6;
      drawTextBox(page2, helv, normText(blk.body||''), { x:p2.x, y, w:p2.w, size:p2.bSize, color:bColor }, { maxLines: p2.max, ellipsis: true }, pdfRgb);
      y += (p2.bSize + 3) * Math.min(p2.max, 3) + p2.gap;
    }
    */

    // send PDF
    const bytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${url.searchParams.get('name') || 'ctrl_profile.pdf'}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
