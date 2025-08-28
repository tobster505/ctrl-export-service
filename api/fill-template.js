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

// Tuners: missing params fall back to defaults (not zero)
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
      // Page 2 content — demo
      page2Patterns: [
        { title:'Direction & shape', body:'Steady line with mixed steps. You kept to a similar zone overall; keep the little habits that held you there.' },
        { title:'Coverage & edges',  body:'You touched 3 states and saw little of Lead. Solid range with one area to explore when useful.' },
      ],
      themeNarrative: 'You steady yourself when feelings spike, you read the room, and you notice how your words land — together that points to clear intent and cleaner repair when needed.',
      person:   { coverName: 'Avery Example', fullName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },
      coverName:'Avery Example',
      // Headline
      stateWord: 'Triggered',
      how: 'Feelings and energy arrive fast and show up visibly. A brief pause or naming the wobble ("I am on edge") often settles it.'
    };
    data = isPair
      ? { ...common,
          stateWord: undefined,
          stateWords: ['Triggered','Lead'],
          howPair: 'Energy arrives quickly and you can channel it into calm direction when you pause first. That shift turns urgency into service.',
        }
      : common;
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

  /* ---- LOCKED DEFAULTS (exact coordinates) ---- */
  const POS = {
    // Page 1 — Headline (unchanged)
    headlineSingle: { x:90, y:650, w:860, size:72, lineGap:4, color:rgb(0.12,0.11,0.2) },
    headlinePair:   { x:90, y:650, w:860, size:56, lineGap:4, color:rgb(0.12,0.11,0.2) },

    // Page 1 — “How it shows up” (single) — LOCKED
    howSingle:    { x:85, y:818, w:890, size:25, lineGap:6, color:rgb(0.24,0.23,0.35), align:'center' },
    // Page 1 — “How” (pair blend) — unchanged
    howPairBlend: { x:55, y:830, w:950, size:24, lineGap:5, color:rgb(0.24,0.23,0.35), align:'center' },

    // Page 1 — Cover Name — LOCKED
    nameCover: { x:600, y:100, w:860, size:60, lineGap:3, color:rgb(0.12,0.11,0.2), align:'center' },

    // Page 1 — Tips / Action (unchanged)
    tip1Body: { x:120, y:1015, w:410, size:23, lineGap:3, color:rgb(0.24,0.23,0.35), align:'center' },
    tip2Body: { x:500, y:1015, w:460, size:23, lineGap:3, color:rgb(0.24,0.23,0.35), align:'center' },

    // Page 1 — Chart (unchanged)
    chart: { x:1030, y:620, w:720, h:420 },

    // Page 2 — Patterns (left) — now exactly TWO blocks, coordinates re-locked
    p2Patterns: { x:120, y:520, w:1260, hSize:14, bSize:20, align:'left', titleGap:6, blockGap:20, maxBodyLines:6 },

    // Page 2 — Themes (right) — one paragraph, coordinates re-locked
    p2ThemePara: { x:1280, y:620, w:630, size:30, lineGap:4, align:'left', color: rgb(0.24,0.23,0.35), maxLines:14 },
  };

  // Tuners kept only for name + how + chart (as before)
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
  // Chart tuners (unchanged)
  POS.chart = { ...POS.chart,
    x: qnum(url,'cx',POS.chart.x), y: qnum(url,'cy',POS.chart.y),
    w: qnum(url,'cw',POS.chart.w), h: qnum(url,'ch',POS.chart.h),
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok:true,
      hint:'Add &preview=1 to view inline',
      pos:POS,
      data,
      urlParams:Object.fromEntries(url.searchParams.entries())
    }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req);
    const pdf = await PDFDocument.load(tplBytes);
    const page1 = pdf.getPage(0);
    const page2 = pdf.getPage(1);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    /* ---------------- Page 1 ---------------- */

    // Headline (single vs pair) — unchanged logic
    const two = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
    const headline = two
      ? `${norm((data.stateWords||[])[0])} & ${norm((data.stateWords||[])[1])}`
      : norm(data.stateWord || '—');
    drawTextBox(page1, HelvB, headline,
      { ...(two ? POS.headlinePair : POS.headlineSingle), align:'center' },
      { maxLines:1, ellipsis:true }
    );

    // Cover Name — locked coords
    const coverName = pickCoverName(data, url);
    if (coverName) {
      drawTextBox(page1, HelvB, coverName, POS.nameCover, { maxLines: 1, ellipsis: true });
    }

    // HOW / WHAT — single vs pair
    if (two) {
      const t = data.howPair || data.how || '';
      if (t) drawTextBox(page1, Helv, t, POS.howPairBlend, { maxLines:3, ellipsis:true });
    } else {
      if (data.how) drawTextBox(page1, Helv, data.how, POS.howSingle, { maxLines:3, ellipsis:true });
    }

    // Tip & Action — same coords, content pulled from data.tip1 / data.tip2
    if (data.tip1) drawTextBox(page1, Helv, data.tip1, POS.tip1Body, { maxLines:2, ellipsis:true });
    if (data.tip2) drawTextBox(page1, Helv, data.tip2, POS.tip2Body, { maxLines:2, ellipsis:true });

    // Chart — unchanged
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

    /* ---------------- Page 2 ---------------- */

    // Left: Patterns (now exactly TWO blocks)
    const rawBlocks = Array.isArray(data.page2Patterns)
      ? data.page2Patterns
      : Array.isArray(data.page2Blocks) ? data.page2Blocks : [];
    const twoBlocks = rawBlocks
      .map(b => ({ title: norm(b?.title||''), body: norm(b?.body||'') }))
      .filter(b => b.title || b.body)
      .slice(0, 2);

    let curY = POS.p2Patterns.y;
    for (const b of twoBlocks) {
      if (b.title) {
        drawTextBox(
          page2,
          HelvB,
          b.title,
          { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.hSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: 1, ellipsis: true }
        );
        curY += (POS.p2Patterns.hSize + 3) + POS.p2Patterns.titleGap;
      }
      if (b.body) {
        const r = drawTextBox(
          page2,
          Helv,
          b.body,
          { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.bSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: POS.p2Patterns.maxBodyLines, ellipsis: true }
        );
        curY += r.height + POS.p2Patterns.blockGap;
      }
    }

    // Right: Themes — single paragraph narrative
    let themeNarr = '';
    if (typeof data.themeNarrative === 'string' && data.themeNarrative.trim()) {
      themeNarr = norm(data.themeNarrative.trim());
    } else if (Array.isArray(data.page2Themes) && data.page2Themes.length) {
      // Fallback: flatten any provided theme blocks into one paragraph
      const bits = data.page2Themes
        .map(t => [t?.title, t?.body].filter(Boolean).join(': '))
        .filter(Boolean);
      themeNarr = norm(bits.join('  '));
    } else if (typeof data.themesExplainer === 'string' && data.themesExplainer.trim()) {
      themeNarr = norm(data.themesExplainer.replace(/\n+/g, ' ').replace(/•\s*/g, '').trim());
    }
    if (themeNarr) {
      drawTextBox(
        page2,
        Helv,
        themeNarr,
        { x: POS.p2ThemePara.x, y: POS.p2ThemePara.y, w: POS.p2ThemePara.w, size: POS.p2ThemePara.size, align: POS.p2ThemePara.align, color: POS.p2ThemePara.color, lineGap: POS.p2ThemePara.lineGap },
        { maxLines: POS.p2ThemePara.maxLines, ellipsis: true }
      );
    }

    // Save
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
