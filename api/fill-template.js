export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ------------------------- small helpers ------------------------- */

const S = (v, fb = '') => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const norm = (v, fb = '') =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // strip odd control chars

// Wrap/align text into a box (y = distance from top, not bottom)
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = 'left',
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const clean = norm(text);
  const lines = clean.split('\n');
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];

  for (const raw of lines) {
    let t = raw.trim();
    while (t.length > maxChars) {
      let cut = t.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      wrapped.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    if (t) wrapped.push(t);
  }

  const out = wrapped.length > maxLines
    ? wrapped.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, '…') : s))
    : wrapped;

  const pageH = page.getHeight();
  const yTop = pageH - y;
  const widthOf = (s) => font.widthOfTextAtSize(s, size);
  const lineH = size + lineGap;

  let yCursor = yTop;
  let drawn = 0;
  for (const line of out) {
    let xDraw = x;
    if (align === 'center') xDraw = x + (w - widthOf(line)) / 2;
    else if (align === 'right') xDraw = x + (w - widthOf(line));
    page.drawText(line, { x: xDraw, y: yCursor, size, font, color });
    yCursor -= lineH;
    drawn++;
  }
  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

async function fetchTemplate(req) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');
  const url   = `${proto}://${host}/CTRL_Perspective_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// FIXED: missing tuner params should fall back to defaults (not zero)
function qnum(url, key, fb) {
  const s = url.searchParams.get(key);
  if (s === null || s === '') return fb;
  const n = Number(s);
  return Number.isFinite(n) ? n : fb;
}
function qstr(url, key, fb) {
  const v = url.searchParams.get(key);
  return v == null || v === '' ? fb : v;
}

// Robustly choose a cover name (with legacy + URL override support)
const pickCoverName = (data, url) => norm(
  (data?.person?.coverName) ??
  data?.coverName ??
  data?.person?.fullName ??
  data?.fullName ??
  data?.summary?.user?.reportCoverName ?? // legacy
  data?.summary?.user?.fullName ??        // legacy
  url?.searchParams?.get('cover') ??      // manual override for quick tests
  ''
);

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  // Safe URL parse
  let url;
  try { url = new URL(req?.url || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const isTest   = url.searchParams.get('test') === '1';
  const isPair   = url.searchParams.get('test') === 'pair';
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const noGraph  = url.searchParams.get('nograph') === '1';

  // ---- Demo payloads (include demo name so you can preview placement) ----
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
        data: { labels: ['Concealed','Triggered','Regulated','Lead'],
          datasets:[{
            label:'Frequency', data:[1,3,1,0], fill:true,
            backgroundColor:'rgba(115,72,199,0.18)',
            borderColor:'#7348C7', borderWidth:2,
            pointRadius:[3,6,3,0], pointHoverRadius:[4,7,4,0],
            pointBackgroundColor:['#9D7BE0','#7348C7','#9D7BE0','#9D7BE0'],
            pointBorderColor:    ['#9D7BE0','#7348C7','#9D7BE0','#9D7BE0'],
          }]
        },
        options:{
          plugins:{ legend:{ display:false } },
          scales:{ r:{
            min:0,max:5,
            ticks:{ display:true, stepSize:1, backdropColor:'rgba(0,0,0,0)' },
            grid:{ circular:true }, angleLines:{ display:true },
            pointLabels:{ color:'#4A4458', font:{ size:12 } }
          } }
        }
      })),
      page2Patterns: [
        { title:'Most & least seen',      body:'Most seen: Triggered. Least seen: Lead. That is your current centre of gravity - keep its strengths and add one tiny counter-balance.' },
        { title:'Start → Finish',         body:'Started in Triggered, finished in Triggered — steady. You started and ended in similar zones - steady overall.' },
        { title:'Pattern shape',          body:'Varied responses without one rhythm. Reflect briefly to spot what flipped you.' },
        { title:'Switching & volatility', body:'You switched 3 of 4 steps (volatility ≈ 0.75). High volatility - helpful if chosen; draining if automatic.' },
        { title:'Streaks / clusters',     body:'Longest run: Triggered × 2. Pairs showed up. Brief runs; small anchors help keep direction.' },
        { title:'Momentum',               body:'Steady. You started and ended in similar zones - steady overall.' },
        { title:'Resilience & retreat',   body:'Moved up after C/T: 1. Slipped down after R/L: 1. Even balance - keep the resets that help you recover.' },
        { title:'Early vs late',          body:'Slightly steadier later on (gentle rise). (Δ ≈ 0.83 on a 1–4 scale).' },
      ],
      page2Themes: [
        { title:'Emotion regulation', body:'Settling yourself when feelings spike.' },
        { title:'Social navigation',  body:'Reading the room and adjusting to people and context.' },
        { title:'Awareness of impact',body:'Noticing how your words and actions land.' },
      ],
      person:   { coverName: 'Avery Example', fullName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },
      coverName:'Avery Example'
    };
    data = isPair
      ? { ...common,
          stateWords: ['Triggered','Lead'],
          howPair: 'Charged direction. Energy arrives fast and you point it at outcomes. That can rally a room or outrun it. Pivot from urgency to service: micro-pause, then turn intensity into clear invites and next steps.',
        }
      : { ...common,
          stateWord:'Triggered',
          how:'Feelings and energy arrive fast and show up visibly. A brief pause or naming the wobble ("I am on edge") often settles it.',
        };
  } else {
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      const raw = Buffer.from(S(b64,''), 'base64').toString('utf8');
      data = JSON.parse(raw);
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
    }
  }

  /* ---- LOCKED DEFAULTS (your chosen coordinates) ---- */
  const POS = {
    headlineSingle: { x:90, y:650, w:860, size:72, lineGap:4, color:rgb(0.12,0.11,0.2) },
    headlinePair:   { x:90, y:650, w:860, size:56, lineGap:4, color:rgb(0.12,0.11,0.2) },

    // SINGLE-STATE "how it shows up" (locked as requested; tunable via hx,hy,hw,hs,halign)
    howSingle:    { x:85, y:818, w:890, size:25, lineGap:6, color:rgb(0.24,0.23,0.35), align:'center' },
    // PAIR "how" blend (tunable via hx2,hy2,hw2,hs2,h2align)
    howPairBlend: { x:55, y:830, w:950, size:24, lineGap:5, color:rgb(0.24,0.23,0.35), align:'center' },

    // Page 1 — Cover Name (locked defaults; still tunable)
    nameCover: { x:600, y:100, w:860, size:60, lineGap:3, color:rgb(0.12,0.11,0.2), align:'center' },

    tip1Body: { x:120, y:1015, w:410, size:23, lineGap:3, color:rgb(0.24,0.23,0.35), align:'center' },
    tip2Body: { x:500, y:1015, w:460, size:23, lineGap:3, color:rgb(0.24,0.23,0.35), align:'center' },

    chart: { x:1030, y:620, w:720, h:420 },

    // PAGE 2 — Patterns (left)
    p2Patterns: { x:120, y:520, w:1260, hSize:14, bSize:20, align:'left', titleGap:6, blockGap:12, maxBodyLines:4 },
    // PAGE 2 — Themes (right)
    p2Themes:   { x:1280, y:620, w:630, hSize:34, bSize:30, align:'left', titleGap:6, blockGap:30, maxBodyLines:4 },
  };

  // Optional tuners (fallback to defaults)

  // SINGLE-STATE how tuners
  POS.howSingle = {
    ...POS.howSingle,
    x: qnum(url,'hx', POS.howSingle.x),
    y: qnum(url,'hy', POS.howSingle.y),
    w: qnum(url,'hw', POS.howSingle.w),
    size: qnum(url,'hs', POS.howSingle.size),
    align: qstr(url,'halign', POS.howSingle.align),
  };

  // PAIR how tuners
  POS.howPairBlend = {
    ...POS.howPairBlend,
    x: qnum(url,'hx2',POS.howPairBlend.x),
    y: qnum(url,'hy2',POS.howPairBlend.y),
    w: qnum(url,'hw2',POS.howPairBlend.w),
    size: qnum(url,'hs2',POS.howPairBlend.size),
    align: qstr(url,'h2align',POS.howPairBlend.align),
  };

  // NAME cover tuners
  POS.nameCover = {
    ...POS.nameCover,
    x: qnum(url,'nx',POS.nameCover.x),
    y: qnum(url,'ny',POS.nameCover.y),
    w: qnum(url,'nw',POS.nameCover.w),
    size: qnum(url,'ns',POS.nameCover.size),
    align: qstr(url,'nalign',POS.nameCover.align),
  };

  POS.tip1Body = { ...POS.tip1Body,
    x: qnum(url,'t1x',POS.tip1Body.x), y: qnum(url,'t1y',POS.tip1Body.y),
    w: qnum(url,'t1w',POS.tip1Body.w), size: qnum(url,'t1s',POS.tip1Body.size),
    align: qstr(url,'t1align',POS.tip1Body.align),
  };
  POS.tip2Body = { ...POS.tip2Body,
    x: qnum(url,'t2x',POS.tip2Body.x), y: qnum(url,'t2y',POS.tip2Body.y),
    w: qnum(url,'t2w',POS.tip2Body.w), size: qnum(url,'t2s',POS.tip2Body.size),
    align: qstr(url,'t2align',POS.tip2Body.align),
  };
  POS.chart = { ...POS.chart,
    x: qnum(url,'cx',POS.chart.x), y: qnum(url,'cy',POS.chart.y),
    w: qnum(url,'cw',POS.chart.w), h: qnum(url,'ch',POS.chart.h),
  };
  POS.p2Patterns = { ...POS.p2Patterns,
    x: qnum(url,'p2x',POS.p2Patterns.x), y: qnum(url,'p2y',POS.p2Patterns.y),
    w: qnum(url,'p2w',POS.p2Patterns.w),
    hSize: qnum(url,'p2hs',POS.p2Patterns.hSize), bSize: qnum(url,'p2bs',POS.p2Patterns.bSize),
    align: qstr(url,'p2align',POS.p2Patterns.align),
    titleGap: qnum(url,'p2hgap',POS.p2Patterns.titleGap),
    blockGap: qnum(url,'p2gap', POS.p2Patterns.blockGap),
    maxBodyLines: qnum(url,'p2max',POS.p2Patterns.maxBodyLines),
  };
  POS.p2Themes = { ...POS.p2Themes,
    x: qnum(url,'p2tx',POS.p2Themes.x), y: qnum(url,'p2ty',POS.p2Themes.y),
    w: qnum(url,'p2tw',POS.p2Themes.w),
    hSize: qnum(url,'p2ths',POS.p2Themes.hSize), bSize: qnum(url,'p2tbs',POS.p2Themes.bSize),
    align: qstr(url,'p2talign',POS.p2Themes.align),
    titleGap: qnum(url,'p2thgap',POS.p2Themes.titleGap),
    blockGap: qnum(url,'p2tgap', POS.p2Themes.blockGap),
    maxBodyLines: qnum(url,'p2tmax',POS.p2Themes.maxBodyLines),
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok:true, hint:'Add &preview=1 to view inline', data, pos:POS, urlParams:Object.fromEntries(url.searchParams.entries()) }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req);
    const pdf = await PDFDocument.load(tplBytes);
    const page1 = pdf.getPage(0);
    const page2 = pdf.getPage(1);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // --- Headline (single vs pair) ---
    const two = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
    const headline = two
      ? `${norm((data.stateWords||[])[0])} & ${norm((data.stateWords||[])[1])}`
      : norm(data.stateWord || '—');
    drawTextBox(page1, HelvB, headline,
      { ...(two ? POS.headlinePair : POS.headlineSingle), align:'center' },
      { maxLines:1, ellipsis:true }
    );

    // --- Cover Name — user's name on page 1 (optional) ---
    const coverName = pickCoverName(data, url);
    if (coverName) {
      drawTextBox(page1, HelvB, coverName, POS.nameCover, { maxLines: 1, ellipsis: true });
    }

    // --- HOW / WHAT (blended for pair or single) ---
    if (two) {
      const t = data.howPair || data.how || '';
      if (t) drawTextBox(page1, Helv, t, POS.howPairBlend, { maxLines:3, ellipsis:true });
    } else {
      if (data.how) drawTextBox(page1, Helv, data.how, POS.howSingle, { maxLines:3, ellipsis:true });
    }

    // --- Tips ---
    if (data.tip1) drawTextBox(page1, Helv, data.tip1, POS.tip1Body, { maxLines:2, ellipsis:true });
    if (data.tip2) drawTextBox(page1, Helv, data.tip2, POS.tip2Body, { maxLines:2, ellipsis:true });

    // --- Chart ---
    if (!noGraph && data.chartUrl) {
      try {
        const r = await fetch(S(data.chartUrl,''));
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart;
          const ph = page1.getHeight();
          page1.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore chart errors */ }
    }

    // --- Page 2: columns ---
    const patterns = Array.isArray(data.page2Patterns)
      ? data.page2Patterns
      : Array.isArray(data.page2Blocks) ? data.page2Blocks : [];

    let themes = [];
    if (Array.isArray(data.page2Themes)) {
      themes = data.page2Themes;
    } else if (typeof data.themesExplainer === 'string') {
      themes = data.themesExplainer
        .split('\n')
        .map(s => S(s,'').replace(/^•\s*/, ''))
        .filter(Boolean)
        .map(row => {
          const [titleRaw, ...rest] = row.split(' - ');
          const title = norm(titleRaw || '');
          const body  = norm(rest.join(' - ') || '');
          const titled = title.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
          return { title: titled, body };
        })
        .slice(0, 3);
    }

    function drawBlocks(page, blocks, fonts, spec) {
      const { font, bold } = fonts;
      const { x, y, w, hSize, bSize, align, titleGap, blockGap, maxBodyLines } = spec;
      let curY = y;
      for (const b of (blocks || [])) {
        const t = norm(b?.title || '');
        const body = norm(b?.body || '');
        if (t) {
          drawTextBox(page, bold, t, { x, y: curY, w, size: hSize, align, color: rgb(0.24,0.23,0.35), lineGap:3 }, { maxLines:1, ellipsis:true });
          curY += (hSize + 3) + titleGap;
        }
        if (body) {
          const r = drawTextBox(page, font, body, { x, y: curY, w, size: bSize, align, color: rgb(0.24,0.23,0.35), lineGap:3 }, { maxLines: maxBodyLines, ellipsis:true });
          curY += r.height + blockGap;
        }
      }
    }

    const HelvFonts = { font:Helv, bold:HelvB };
    drawBlocks(page2, patterns, HelvFonts, POS.p2Patterns);
    drawBlocks(page2, themes,   HelvFonts, POS.p2Themes);

    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="ctrl_profile.pdf"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
