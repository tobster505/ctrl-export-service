export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ---------- helpers ---------- */

function toStr(x, fb = '') {
  if (x == null) return String(fb);
  try { return String(x); } catch { return String(fb); }
}

function normText(v, fb = '') {
  const s = toStr(v, fb);
  // Always operate on a string
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function drawTextBox(page, font, text, spec, opts = {}) {
  const {
    x = 40, y = 40, w = 520, size = 12, color = rgb(0, 0, 0),
    align = 'left', lineGap = 3,
  } = spec || {};
  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const clean = normText(text);
  const lines = clean.split('\n');

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
  let drawn = 0;
  for (const line of out) {
    let drawX = x;
    if (align === 'center')       drawX = x + (w - widthOf(line)) / 2;
    else if (align === 'right')   drawX = x + (w - widthOf(line));
    page.drawText(line, { x: drawX, y: yCursor, size, font, color });
    yCursor -= lineHeight;
    drawn++;
  }
  const totalHeight = drawn * lineHeight;
  return { height: totalHeight, linesDrawn: drawn, lastY: yCursor };
}

async function loadTemplateBytes(req) {
  const headers = (req && req.headers) || {};
  const host  = toStr(headers.host, 'ctrl-export-service.vercel.app');
  const proto = toStr(headers['x-forwarded-proto'], 'https');
  const url   = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

const num = (url, key, def) => {
  const v = url.searchParams.get(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/* ---------- handler ---------- */

export default async function handler(req, res) {
  // Safe URL parsing even if req.url is missing
  const rawUrl = (req && typeof req.url === 'string') ? req.url : '';
  let url;
  try { url = new URL(rawUrl || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const modeTest  = url.searchParams.get('test');
  const isTest    = modeTest === '1';
  const isPair    = modeTest === 'pair';
  const debug     = url.searchParams.get('debug') === '1';
  const noGraph   = url.searchParams.get('nograph') === '1';
  const preview   = url.searchParams.get('preview') === '1';

  // --- demo payloads for quick checks ---
  let data;
  if (isTest || isPair) {
    const common = {
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones - steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: 'Take one breath and name it: "I am on edge."',
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
            pointBackgroundColor: ['#9D7BE0','#7348C7','#9D7BE0','#9D7BE0'],
            pointBorderColor:     ['#9D7BE0','#7348C7','#9D7BE0','#9D7BE0'],
          }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { r: {
            min: 0, max: 5,
            ticks: { display: true, stepSize: 1, backdropColor: 'rgba(0,0,0,0)' },
            grid: { circular: true },
            angleLines: { display: true },
            pointLabels: { color: '#4A4458', font: { size: 12 } },
          } }
        }
      })),
      // LEFT column (patterns)
      page2Patterns: [
        { title: 'Most & least seen',       body: 'Most seen: Triggered. Least seen: Lead. That is your current centre of gravity - keep its strengths and add one tiny counter-balance.' },
        { title: 'Start → Finish',          body: 'Started in Triggered, finished in Triggered — steady. You started and ended in similar zones - steady overall.' },
        { title: 'Pattern shape',           body: 'Varied responses without one rhythm. Reflect briefly to spot what flipped you.' },
        { title: 'Switching & volatility',  body: 'You switched 3 of 4 steps (volatility ≈ 0.75). High volatility - helpful if chosen; draining if automatic.' },
        { title: 'Streaks / clusters',      body: 'Longest run: Triggered × 2. Pairs showed up. Brief runs; small anchors help keep direction.' },
        { title: 'Momentum',                body: 'Steady. You started and ended in similar zones - steady overall.' },
        { title: 'Resilience & retreat',    body: 'Moved up after C/T: 1. Slipped down after R/L: 1. Even balance - keep the resets that help you recover.' },
        { title: 'Early vs late',           body: 'Slightly steadier later on (gentle rise). (Δ ≈ 0.83 on a 1–4 scale).' },
      ],
      // RIGHT column (themes)
      page2Themes: [
        { title: 'Emotion regulation', body: 'Settling yourself when feelings spike.' },
        { title: 'Social navigation',  body: 'Reading the room and adjusting to people and context.' },
        { title: 'Awareness of impact', body: 'Noticing how your words and actions land.' },
      ],
    };
    data = isPair
      ? { ...common,
          stateWords: ['Triggered', 'Lead'],
          howPair: 'Charged direction. Energy arrives fast and you point it at outcomes. That can rally a room or outrun it. Pivot from urgency to service: micro-pause, then turn intensity into clear invites and next steps.',
        }
      : { ...common,
          stateWord: 'Triggered',
          how: 'Feelings and energy arrive fast and show up visibly. A brief pause or naming the wobble ("I am on edge") often settles it.',
        };
  } else {
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      const raw = Buffer.from(toStr(b64, ''), 'base64').toString('utf8');
      data = JSON.parse(raw);
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e && e.message || e)); return;
    }
  }

  // ---------- LOCKED DEFAULTS (your URL baked in) ----------
  const POS = {
    headlineSingle: { x: 90,  y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },
    headlinePair:   { x: 90,  y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

    howSingle:      { x: 160, y: 850, w: 700, size: 30, lineGap: 6, color: rgb(0.24,0.23,0.35), align: 'center' },
    howPairBlend:   { x: 55,  y: 830, w: 950, size: 24, lineGap: 5, color: rgb(0.24,0.23,0.35), align: 'center' },

    tip1Body:       { x: 120, y: 1015, w: 410, size: 23, lineGap: 3, color: rgb(0.24,0.23,0.35), align: 'center' },
    tip2Body:       { x: 500, y: 1015, w: 460, size: 23, lineGap: 3, color: rgb(0.24,0.23,0.35), align: 'center' },

    chart:          { x: 1030, y: 620, w: 720, h: 420 },

    // Page 2 — Patterns (LEFT)
    p2Patterns: {
      x: 120, y: 520, w: 1260,
      hSize: 14, bSize: 20, align: 'left',
      titleGap: 6, blockGap: 12, maxBodyLines: 4,
    },
    // Page 2 — Themes (RIGHT)
    p2Themes: {
      x: 1280, y: 620, w: 630,
      hSize: 34, bSize: 30, align: 'left',
      titleGap: 6, blockGap: 30, maxBodyLines: 4,
    },
  };

  // Optional tuners (still supported)
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
  POS.chart = {
    x: num(url, 'cx', POS.chart.x),
    y: num(url, 'cy', POS.chart.y),
    w: num(url, 'cw', POS.chart.w),
    h: num(url, 'ch', POS.chart.h),
  };
  POS.p2Patterns = {
    ...POS.p2Patterns,
    x: num(url, 'p2x', POS.p2Patterns.x),
    y: num(url, 'p2y', POS.p2Patterns.y),
    w: num(url, 'p2w', POS.p2Patterns.w),
    hSize:  num(url, 'p2hs', POS.p2Patterns.hSize),
    bSize:  num(url, 'p2bs', POS.p2Patterns.bSize),
    align:  url.searchParams.get('p2align') || POS.p2Patterns.align,
    titleGap:   num(url, 'p2hgap', POS.p2Patterns.titleGap),
    blockGap:   num(url, 'p2gap',  POS.p2Patterns.blockGap),
    maxBodyLines: num(url, 'p2max', POS.p2Patterns.maxBodyLines),
  };
  POS.p2Themes = {
    ...POS.p2Themes,
    x: num(url, 'p2tx', POS.p2Themes.x),
    y: num(url, 'p2ty', POS.p2Themes.y),
    w: num(url, 'p2tw', POS.p2Themes.w),
    hSize:  num(url, 'p2ths', POS.p2Themes.hSize),
    bSize:  num(url, 'p2tbs', POS.p2Themes.bSize),
    align:  url.searchParams.get('p2talign') || POS.p2Themes.align,
    titleGap:   num(url, 'p2thgap', POS.p2Themes.titleGap),
    blockGap:   num(url, 'p2tgap',  POS.p2Themes.blockGap),
    maxBodyLines: num(url, 'p2tmax', POS.p2Themes.maxBodyLines),
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      hint: 'Add &preview=1 to view inline',
      data,
      pos: POS,
      urlParams: Object.fromEntries(url.searchParams.entries()),
    }, null, 2));
    return;
  }

  try {
    const templateBytes = await loadTemplateBytes(req);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page1  = pdfDoc.getPage(0);
    const page2  = pdfDoc.getPage(1);
    const helv     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Headline
    const twoStates = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
    const headlineText = twoStates
      ? `${normText((data.stateWords || [])[0])} & ${normText((data.stateWords || [])[1])}`
      : normText(data.stateWord || '—');

    drawTextBox(
      page1, helvBold, headlineText,
      { ...(twoStates ? POS.headlinePair : POS.headlineSingle), align: 'center' },
      { maxLines: 1, ellipsis: true }
    );

    // HOW / WHAT
    if (!twoStates) {
      if (data.how) drawTextBox(page1, helv, data.how, POS.howSingle, { maxLines: 3, ellipsis: true });
    } else {
      const tBlend = data.howPair || data.how || '';
      if (tBlend) drawTextBox(page1, helv, tBlend, POS.howPairBlend, { maxLines: 3, ellipsis: true });
    }

    // Tips
    if (data.tip1) drawTextBox(page1, helv, data.tip1, POS.tip1Body, { maxLines: 2, ellipsis: true });
    if (data.tip2) drawTextBox(page1, helv, data.tip2, POS.tip2Body, { maxLines: 2, ellipsis: true });

    // Chart
    if (!noGraph && data.chartUrl) {
      try {
        const r = await fetch(toStr(data.chartUrl, ''));
        if (r.ok) {
          const png = await pdfDoc.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart;
          const pageH = page1.getHeight();
          page1.drawImage(png, { x, y: pageH - y - h, width: w, height: h });
        }
      } catch { /* ignore */ }
    }

    // PAGE 2 content
    const patterns = Array.isArray(data.page2Patterns)
      ? data.page2Patterns
      : Array.isArray(data.page2Blocks) ? data.page2Blocks : [];

    // themes: either explicit blocks, or parse "themesExplainer"
    let themes = [];
    if (Array.isArray(data.page2Themes)) {
      themes = data.page2Themes.map(b => ({
        title: normText(b.title || ''),
        body:  normText(b.body  || ''),
      }));
    } else if (typeof data.themesExplainer === 'string') {
      const rows = data.themesExplainer.split('\n').map(s => toStr(s, ''));
      themes = rows
        .map((t) => {
          const clean = t.replace(/^•\s*/, '');
          const parts = clean.split(' - ');
          const title = normText(parts.shift() || '');
          const body  = normText(parts.join(' - ') || '');
          // Title Case
          const titled = title.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
          return { title: titled, body };
        })
        .filter(b => b.title || b.body)
        .slice(0, 3);
    }

    function drawColumn(page, blocks, fonts, spec) {
      const list = Array.isArray(blocks) ? blocks : [];
      const { font, fontBold } = fonts;
      const { x, y, w, hSize, bSize, align, titleGap, blockGap, maxBodyLines } = spec;
      let curY = y;

      for (const raw of list) {
        const title = normText(raw && raw.title);
        const body  = normText(raw && raw.body);

        if (title) {
          drawTextBox(page, fontBold, title,
            { x, y: curY, w, size: hSize, align, color: rgb(0.24,0.23,0.35), lineGap: 3 },
            { maxLines: 1, ellipsis: true }
          );
          curY += (hSize + 3) + titleGap;
        }
        if (body) {
          const bRes = drawTextBox(page, font,
            body,
            { x, y: curY, w, size: bSize, align, color: rgb(0.24,0.23,0.35), lineGap: 3 },
            { maxLines: maxBodyLines, ellipsis: true }
          );
          curY += bRes.height + blockGap;
        }
      }
    }

    drawColumn(page2, patterns, { font: helv, fontBold: helvBold }, POS.p2Patterns);
    drawColumn(page2, themes,   { font: helv, fontBold: helvBold }, POS.p2Themes);

    // No dynamic copyright (you’ve hard-coded it).

    const bytes = await pdfDoc.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="ctrl_profile.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e && e.message || e));
  }
}
