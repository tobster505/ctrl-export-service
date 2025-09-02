// ctrl-export-service/api/fill-template.js
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

// Wrap/align text into a box (y = distance from TOP edge)
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
  // NOTE: point to your actual template filename in /public
  const url   = `${proto}://${host}/CTRL_Perspective_Assessment_Profile_template.pdf`;
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

const pickFullName = (data) => norm(
  (data?.person?.fullName) ??
  data?.fullName ??
  data?.summary?.user?.fullName ??
  ''
);

// Format "DD/MMM/YYYY" (MMM uppercase)
function fmtDateLbl(isoOrLbl) {
  // If already looks like DD/XXX/YYYY just return
  if (typeof isoOrLbl === 'string' && /^\d{2}\/[A-Z]{3}\/\d{4}$/.test(isoOrLbl)) return isoOrLbl;

  const d = isoOrLbl ? new Date(isoOrLbl) : new Date();
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  return `${dd}/${MMM}/${yyyy}`;
}

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
      flowLabel: 'Perspective',
      person:   { coverName: 'Toby New', fullName: 'Toby New', preferredName: 'Toby', initials: 'TN' },
      coverName:'Toby New',
      fullName: 'Toby New',
      dateISO:  new Date().toISOString(),
      directionLabel:  'Steady',
      directionMeaning:'You started and ended in similar zones—steady overall.',
      themeLabel:      'Emotion regulation',
      themeMeaning:    'Settling yourself when feelings spike.',
      tip1: 'Take one breath and name it: "I am on edge."',
      tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
      chartUrl: 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify({
        type: 'radar',
        data: { labels: ['Concealed','Triggered','Regulated','Lead'],
          datasets:[{
            label:'Frequency', data:[0,2,3,0], fill:true,
            backgroundColor:'rgba(115,72,199,0.18)',
            borderColor:'#7348C7', borderWidth:2,
            pointRadius:[0,3,6,0], pointHoverRadius:[0,4,7,0],
            pointBackgroundColor:['#9D7BE0','#9D7BE0','#7348C7','#9D7BE0'],
            pointBorderColor:    ['#9D7BE0','#9D7BE0','#7348C7','#9D7BE0'],
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
        { title:'Coverage & edges',  body:'You touched 2 states and saw little of Lead or Concealed. Solid range with two areas to explore when useful.' },
      ],
      themeNarrative: 'You steady yourself when feelings spike, you read the room, and you notice how your words land — together that points to clear intent and cleaner repair when needed.',
      // Headline
      stateWord: isPair ? undefined : 'Regulated',
      stateWords: isPair ? ['Triggered','Lead'] : undefined,
      how: 'Steady presence; keep clarity alive.',
      howPair: isPair ? 'Energy arrives quickly and you can channel it into calm direction when you pause first.' : undefined,
    };
    data = common;
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

  /* ---- POSITIONS & TUNERS ----
     - y is measured from TOP edge downwards
     - You can tune via URL for quick trials
  */
  const POS = {
    // Page 1 — Headline
    headlineSingle: { x:90, y:650, w:860, size:72, lineGap:4, color:rgb(0.12,0.11,0.2) },
    headlinePair:   { x:90, y:650, w:860, size:56, lineGap:4, color:rgb(0.12,0.11,0.2) },

    // Page 1 — “How it shows up”
    howSingle:    { x:85, y:818, w:890, size:25, lineGap:6, color:rgb(0.24,0.23,0.35), align:'center' },
    howPairBlend: { x:55, y:830, w:950, size:24, lineGap:5, color:rgb(0.24,0.23,0.35), align:'center' },

    // Page 1 — Cover Name (large, near bottom)
    nameCover: { x:600, y:100, w:860, size:60, lineGap:3, color:rgb(0.12,0.11,0.2), align:'center' },

    // Page 1 — Date label (DD/MMM/YYYY)
    p1Date: { x:90, y:120, w:400, size:16, lineGap:2, color:rgb(0.24,0.23,0.35), align:'left' },

    // Page 1 — Chart
    chart: { x:1030, y:620, w:720, h:420 },

    // Page 2 — Patterns (left)
    p2Patterns: { x:120, y:520, w:1260, hSize:14, bSize:20, align:'left', titleGap:6, blockGap:20, maxBodyLines:6 },

    // Page 2 — Themes (right)
    p2ThemePara: { x:1280, y:620, w:630, size:30, lineGap:4, align:'left', color: rgb(0.24,0.23,0.35), maxLines:14 },

    // NEW: Flow labels (“Perspective/Observe/Reflective”) on pages 1–8
    p1Flow: { x:90,  y:60,  w:400, size:20, align:'left',  color: rgb(0.12,0.11,0.2) },
    p2Flow: { x:90,  y:60,  w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p3Flow: { x:90,  y:60,  w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p4Flow: { x:90,  y:60,  w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p5Flow: { x:90,  y:60,  w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p6Flow: { x:90,  y:60,  w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p7Flow: { x:90,  y:60,  w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p8Flow: { x:90,  y:60,  w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },

    // NEW: Full-name headers on pages 2–8
    p2Name: { x:460, y:60,  w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p3Name: { x:460, y:60,  w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p4Name: { x:460, y:60,  w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p5Name: { x:460, y:60,  w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p6Name: { x:460, y:60,  w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p7Name: { x:460, y:60,  w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p8Name: { x:460, y:60,  w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
  };

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
  // NAME cover tuners (Page 1 big name)
  POS.nameCover = {
    ...POS.nameCover,
    x: qnum(url,'nx',POS.nameCover.x),
    y: qnum(url,'ny',POS.nameCover.y),
    w: qnum(url,'nw',POS.nameCover.w),
    size: qnum(url,'ns',POS.nameCover.size),
    align: qstr(url,'nalign',POS.nameCover.align),
  };
  // DATE on page 1
  POS.p1Date = {
    ...POS.p1Date,
    x: qnum(url,'d1x',POS.p1Date.x),
    y: qnum(url,'d1y',POS.p1Date.y),
    w: qnum(url,'d1w',POS.p1Date.w || 400),
    size: qnum(url,'d1s',POS.p1Date.size),
    align: qstr(url,'d1align',POS.p1Date.align),
  };
  // Chart tuners
  POS.chart = { ...POS.chart,
    x: qnum(url,'cx',POS.chart.x), y: qnum(url,'cy',POS.chart.y),
    w: qnum(url,'cw',POS.chart.w), h: qnum(url,'ch',POS.chart.h),
  };
  // Flow label tuners per page (f{n}x, f{n}y, f{n}w, f{n}s, f{n}align)
  for (let n = 1; n <= 8; n++) {
    const key = `p${n}Flow`;
    POS[key] = {
      ...POS[key],
      x: qnum(url, `f${n}x`, POS[key].x),
      y: qnum(url, `f${n}y`, POS[key].y),
      w: qnum(url, `f${n}w`, POS[key].w || 400),
      size: qnum(url, `f${n}s`, POS[key].size),
      align: qstr(url, `f${n}align`, POS[key].align),
    };
  }
  // Full-name tuners per page (n{n}x, n{n}y, n{n}w, n{n}s, n{n}align) for pages 2–8
  for (let n = 2; n <= 8; n++) {
    const key = `p${n}Name`;
    POS[key] = {
      ...POS[key],
      x: qnum(url, `n${n}x`, POS[key].x),
      y: qnum(url, `n${n}y`, POS[key].y),
      w: qnum(url, `n${n}w`, POS[key].w || 800),
      size: qnum(url, `n${n}s`, POS[key].size),
      align: qstr(url, `n${n}align`, POS[key].align),
    };
  }

  // Optional: allow overriding the flow label via URL during tuning
  const flowLbl =
    qstr(url, 'flow', '') ||
    (data?.flowLabel) ||
    (data?.summary?.flow?.label) ||
    'Perspective';

  const fullName = pickFullName(data) || pickCoverName(data, url);
  const dateLbl = fmtDateLbl(data?.dateLbl || data?.summary?.flow?.dateISO || data?.dateISO);

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok:true,
      hint:'Add &preview=1 to view inline',
      flowLbl, fullName, dateLbl,
      pos:POS,
      urlParams:Object.fromEntries(url.searchParams.entries()),
      pagesNote: 'y is measured from the TOP edge of the page',
    }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageCount = pdf.getPageCount();
    const getPage = (i) => (i < pageCount ? pdf.getPage(i) : null);

    /* ---------------- Page 1 ---------------- */
    const page1 = getPage(0);
    if (page1) {
      // Headline (single vs pair)
      const two = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
      const headline = two
        ? `${norm((data.stateWords||[])[0]||'—')} & ${norm((data.stateWords||[])[1]||'—')}`
        : norm(data.stateWord || '—');
      drawTextBox(page1, HelvB, headline,
        { ...(two ? POS.headlinePair : POS.headlineSingle), align:'center' },
        { maxLines:1, ellipsis:true }
      );

      // Cover Name (big, near bottom)
      const coverName = pickCoverName(data, url);
      if (coverName) drawTextBox(page1, HelvB, coverName, POS.nameCover, { maxLines: 1, ellipsis: true });

      // HOW / WHAT — single vs pair
      if (two) {
        const t = data.howPair || data.how || '';
        if (t) drawTextBox(page1, Helv, t, POS.howPairBlend, { maxLines:3, ellipsis:true });
      } else {
        if (data.how) drawTextBox(page1, Helv, data.how, POS.howSingle, { maxLines:3, ellipsis:true });
      }

      // Date label
      if (dateLbl) drawTextBox(page1, Helv, dateLbl, POS.p1Date, { maxLines: 1, ellipsis: true });

      // Chart
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

      // Flow label (Page 1)
      drawTextBox(page1, HelvB, norm(flowLbl), POS.p1Flow, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 2 ---------------- */
    const page2 = getPage(1);
    if (page2) {
      // Flow label + full name
      drawTextBox(page2, HelvB, norm(flowLbl), POS.p2Flow, { maxLines: 1, ellipsis: true });
      if (fullName) drawTextBox(page2, Helv, fullName, POS.p2Name, { maxLines: 1, ellipsis: true });

      // Left: Patterns (two blocks)
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
            page2, HelvB, b.title,
            { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.hSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
            { maxLines: 1, ellipsis: true }
          );
          curY += (POS.p2Patterns.hSize + 3) + POS.p2Patterns.titleGap;
        }
        if (b.body) {
          const r = drawTextBox(
            page2, Helv, b.body,
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
        const bits = data.page2Themes
          .map(t => [t?.title, t?.body].filter(Boolean).join(': '))
          .filter(Boolean);
        themeNarr = norm(bits.join('  '));
      } else if (typeof data.themesExplainer === 'string' && data.themesExplainer.trim()) {
        themeNarr = norm(data.themesExplainer.replace(/\n+/g, ' ').replace(/•\s*/g, '').trim());
      }
      if (themeNarr) {
        drawTextBox(
          page2, Helv, themeNarr,
          { x: POS.p2ThemePara.x, y: POS.p2ThemePara.y, w: POS.p2ThemePara.w, size: POS.p2ThemePara.size, align: POS.p2ThemePara.align, color: POS.p2ThemePara.color, lineGap: POS.p2ThemePara.lineGap },
          { maxLines: POS.p2ThemePara.maxLines, ellipsis: true }
        );
      }
    }

    /* ---------------- Pages 3–8: add flow label + full name headers ---------------- */
    const pagesToHeader = [3,4,5,6,7,8]; // human-friendly page numbers
    for (const n of pagesToHeader) {
      const p = getPage(n-1);
      if (!p) continue;
      const flowKey = `p${n}Flow`;
      const nameKey = `p${n}Name`;
      drawTextBox(p, HelvB, norm(flowLbl), POS[flowKey], { maxLines: 1, ellipsis: true });
      if (fullName) drawTextBox(p, Helv, fullName, POS[nameKey], { maxLines: 1, ellipsis: true });
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
