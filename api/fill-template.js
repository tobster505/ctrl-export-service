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

// Wrap/align text into a box (y = distance from TOP)
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  if (!page || !font || !text) return { height: 0, linesDrawn: 0, lastY: 0 };

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

function monthMMM(idx) {
  const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return MMM[Math.max(0, Math.min(11, idx))];
}
function formatDateLbl(isoOrDate) {
  try {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const MMM = monthMMM(d.getUTCMonth());
    const yyyy = d.getUTCFullYear();
    return `${dd}/${MMM}/${yyyy}`;
  } catch {
    const d = new Date();
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const MMM = monthMMM(d.getUTCMonth());
    const yyyy = d.getUTCFullYear();
    return `${dd}/${MMM}/${yyyy}`;
  }
}

async function fetchTemplate(req) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');
  // Use your Perspective template file in /public
  const url   = `${proto}://${host}/CTRL_Perspective_Assessment_Profile_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Query helpers (with fallbacks)
function qnum(url, key, fb) { const s = url.searchParams.get(key); if (s === null || s === '') return fb; const n = Number(s); return Number.isFinite(n) ? n : fb; }
function qstr(url, key, fb) { const v = url.searchParams.get(key); return v == null || v === '' ? fb : v; }

// Robustly choose a cover name
const pickCoverName = (data, url) => norm(
  (data?.person?.coverName) ??
  data?.coverName ??
  data?.person?.fullName ??
  data?.fullName ??
  data?.summary?.user?.reportCoverName ?? // legacy
  data?.summary?.user?.fullName ??        // legacy
  url?.searchParams?.get('cover') ??      // manual override
  ''
);

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  // Safe URL parse
  let url;
  try { url = new URL(req?.url || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const isTest   = url.searchParams.get('test') === '1';
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const noGraph  = url.searchParams.get('nograph') === '1';

  // Demo payloads for &test=1
  let data;
  if (isTest) {
    data = {
      flowLabel: qstr(url, 'flow', 'Perspective'),
      person: { fullName: 'Avery Example', coverName: 'Avery Example' },
      assessmentDateISO: new Date().toISOString(),
      // Page 5 dominant/how/chart
      stateWord: 'Regulated',
      dominantParagraph: 'You connect the most with Mika — grounded, steady, and fair under pressure.',
      how: 'Steady presence; keep clarity alive.',
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
      // (formerly Page 2) — now DRAWN ON PAGE 5
      page2Patterns: [
        { title:'Direction & shape', body:'Steady line with mixed steps. You kept to a similar zone overall.' },
        { title:'Coverage & edges',  body:'You touched 2 states strongly with some room to explore the others.' },
      ],
      themeNarrative: 'Emotion regulation with Feedback handling and Awareness of impact led this short run.',
      // Page 6 blocks
      block1: { title:'Shape + Coverage', body:'Mixed shape with medium switches. Coverage: 2/4.' },
      block2: { title:'Missing State', body:'No Lead present in this snapshot — optional edge to explore.' },
      block3: { title:'Themes', body:'Emotion regulation & Feedback handling showed up the most.' },
      block4: { title:'Tips', body:'1) One breath before speaking. 2) Invite a micro check-in.' },
      block5: { title:'Actions', body:'Try a 2-line boundary; do a 90-sec reset before key moments.' },
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

  /* ------------------ POS (moveable coordinates) ------------------ */
  // LOCKED defaults requested by you
  const POS = {
    // PAGE 1 — FullName + PathName + Date (locked)
    f1: { x: 285, y: 165, w: 400, size: 40, align: 'left' },   // FullName
    n1: { x: -10, y: 570, w: 600, size: 32, align: 'center' }, // PathName (flow label)
    d1: { x: 120, y: 630, w: 500, size: 25, align: 'left' },   // Date label

    // PAGE 2 — PathName + FullName (LOCK IN per your request)
    f2: { x: 200, y:  64, w: 400, size: 13, align: 'left' },   // PathName (flow label)
    n2: { x:  25, y:  64, w: 800, size: 12, align: 'center' }, // FullName

    // (Formerly Page 2) Patterns/Themes — now DRAWN ON PAGE 5
    p2Patterns: { x:120, y:520, w:1260, hSize:14, bSize:20, align:'left', titleGap:6, blockGap:20, maxBodyLines:6 },
    p2ThemePara:{ x:1280, y:620, w:630, size:30, lineGap:4,  align:'left', color: rgb(0.24,0.23,0.35), maxLines:14 },

    // PAGE 5 — Dominant, description, how, chart
    dom5:     { x:120, y:250, w:900, size:36, align:'left' },          // Dominant state label
    dom5desc: { x:120, y:300, w:900, size:22, align:'left', max:6 },   // Dominant description paragraph
    how5:     { x:120, y:360, w:900, size:22, align:'left', max:4 },   // "How this shows up"
    c5:       { x:1100, y:300, w:650, h:420 },                         // Spider chart image

    // HEADERS — Pages 3–8 (defaults; tunable via URL if needed)
    f3: { x: 90, y: 60,  w: 400, size: 18, align: 'left' }, n3: { x:460, y:60,  w:800, size:18, align:'center' },
    f4: { x: 90, y: 60,  w: 400, size: 18, align: 'left' }, n4: { x:460, y:60,  w:800, size:18, align:'center' },
    f5: { x: 90, y: 60,  w: 400, size: 18, align: 'left' }, n5: { x:460, y:60,  w:800, size:18, align:'center' },
    f6: { x: 90, y: 60,  w: 400, size: 18, align: 'left' }, n6: { x:460, y:60,  w:800, size:18, align:'center' },
    f7: { x: 90, y: 60,  w: 400, size: 18, align: 'left' }, n7: { x:460, y:60,  w:800, size:18, align:'center' },
    f8: { x: 90, y: 60,  w: 400, size: 18, align: 'left' }, n8: { x:460, y:60,  w:800, size:18, align:'center' },

    // PAGE 6 — Five blocks (shape/missing/themes/tips/actions)
    b61: { x:120, y:260, w:1500, hSize:16, bSize:22, align:'left', max:5 },
    b62: { x:120, y:410, w:1500, hSize:16, bSize:22, align:'left', max:5 },
    b63: { x:120, y:560, w:1500, hSize:16, bSize:22, align:'left', max:6 },
    b64: { x:120, y:740, w:1500, hSize:16, bSize:22, align:'left', max:5 },
    b65: { x:120, y:890, w:1500, hSize:16, bSize:22, align:'left', max:5 },
  };

  // Minimal tuners (you asked to REMOVE old hx/hx2/nx/cx sets):
  POS.f1 = { ...POS.f1,
    x: qnum(url,'f1x',POS.f1.x), y: qnum(url,'f1y',POS.f1.y),
    w: qnum(url,'f1w',POS.f1.w), size: qnum(url,'f1s',POS.f1.size),
    align: qstr(url,'f1align',POS.f1.align),
  };
  POS.n1 = { ...POS.n1,
    x: qnum(url,'n1x',POS.n1.x), y: qnum(url,'n1y',POS.n1.y),
    w: qnum(url,'n1w',POS.n1.w), size: qnum(url,'n1s',POS.n1.size),
    align: qstr(url,'n1align',POS.n1.align),
  };
  POS.d1 = { ...POS.d1,
    x: qnum(url,'d1x',POS.d1.x), y: qnum(url,'d1y',POS.d1.y),
    w: qnum(url,'d1w',POS.d1.w ?? 500), size: qnum(url,'d1s',POS.d1.size),
    align: qstr(url,'d1align',POS.d1.align),
  };

  POS.f2 = { ...POS.f2,
    x: qnum(url,'f2x',POS.f2.x), y: qnum(url,'f2y',POS.f2.y),
    w: qnum(url,'f2w',POS.f2.w), size: qnum(url,'f2s',POS.f2.size),
    align: qstr(url,'f2align',POS.f2.align),
  };
  POS.n2 = { ...POS.n2,
    x: qnum(url,'n2x',POS.n2.x), y: qnum(url,'n2y',POS.n2.y),
    w: qnum(url,'n2w',POS.n2.w), size: qnum(url,'n2s',POS.n2.size),
    align: qstr(url,'n2align',POS.n2.align),
  };

  // (Keep tuners for headers on other pages)
  for (const p of [3,4,5,6,7,8]) {
    POS[`f${p}`] = {
      ...POS[`f${p}`],
      x: qnum(url,`f${p}x`,POS[`f${p}`].x), y: qnum(url,`f${p}y`,POS[`f${p}`].y),
      w: qnum(url,`f${p}w`,POS[`f${p}`].w), size: qnum(url,`f${p}s`,POS[`f${p}`].size),
      align: qstr(url,`f${p}align`,POS[`f${p}`].align),
    };
    POS[`n${p}`] = {
      ...POS[`n${p}`],
      x: qnum(url,`n${p}x`,POS[`n${p}`].x), y: qnum(url,`n${p}y`,POS[`n${p}`].y),
      w: qnum(url,`n${p}w`,POS[`n${p}`].w), size: qnum(url,`n${p}s`,POS[`n${p}`].size),
      align: qstr(url,`n${p}align`,POS[`n${p}`].align),
    };
  }

  // Dominant/how/chart tuners (page 5)
  POS.dom5     = { ...POS.dom5,     x: qnum(url,'dom5x',POS.dom5.x),     y: qnum(url,'dom5y',POS.dom5.y),     w: qnum(url,'dom5w',POS.dom5.w),     size: qnum(url,'dom5s',POS.dom5.size),     align: qstr(url,'dom5align',POS.dom5.align) };
  POS.dom5desc = { ...POS.dom5desc, x: qnum(url,'dom5descx',POS.dom5desc.x), y: qnum(url,'dom5descy',POS.dom5desc.y), w: qnum(url,'dom5descw',POS.dom5desc.w), size: qnum(url,'dom5descs',POS.dom5desc.size), align: qstr(url,'dom5descalign',POS.dom5desc.align), max: qnum(url,'dom5descmax',POS.dom5desc.max) };
  POS.how5     = { ...POS.how5,     x: qnum(url,'how5x',POS.how5.x),     y: qnum(url,'how5y',POS.how5.y),     w: qnum(url,'how5w',POS.how5.w),     size: qnum(url,'how5s',POS.how5.size),     align: qstr(url,'how5align',POS.how5.align), max: qnum(url,'how5max',POS.how5.max) };
  POS.c5       = { ...POS.c5,       x: qnum(url,'c5x',POS.c5.x),         y: qnum(url,'c5y',POS.c5.y),         w: qnum(url,'c5w',POS.c5.w),         h: qnum(url,'c5h',POS.c5.h) };

  // (Formerly Page 2) Patterns/Themes tuners — NOW USED ON PAGE 5
  POS.p2Patterns = {
    ...POS.p2Patterns,
    x: qnum(url,'p2px',POS.p2Patterns.x), y: qnum(url,'p2py',POS.p2Patterns.y), w: qnum(url,'p2pw',POS.p2Patterns.w),
    hSize: qnum(url,'p2phsize',POS.p2Patterns.hSize), bSize: qnum(url,'p2pbsize',POS.p2Patterns.bSize),
    align: qstr(url,'p2palign',POS.p2Patterns.align), titleGap: qnum(url,'p2ptitlegap',POS.p2Patterns.titleGap),
    blockGap: qnum(url,'p2pblockgap',POS.p2Patterns.blockGap), maxBodyLines: qnum(url,'p2pmax',POS.p2Patterns.maxBodyLines),
  };
  POS.p2ThemePara = {
    ...POS.p2ThemePara,
    x: qnum(url,'p2tx',POS.p2ThemePara.x), y: qnum(url,'p2ty',POS.p2ThemePara.y), w: qnum(url,'p2tw',POS.p2ThemePara.w),
    size: qnum(url,'p2ts',POS.p2ThemePara.size), align: qstr(url,'p2talign',POS.p2ThemePara.align),
    maxLines: qnum(url,'p2tmax',POS.p2ThemePara.maxLines),
  };

  // Page 6 blocks tuners
  for (const i of [1,2,3,4,5]) {
    const key = `b6${i}`;
    POS[key] = {
      ...POS[key],
      x: qnum(url,`${key}x`,POS[key].x), y: qnum(url,`${key}y`,POS[key].y), w: qnum(url,`${key}w`,POS[key].w),
      hSize: qnum(url,`${key}hsize`,POS[key].hSize), bSize: qnum(url,`${key}bsize`,POS[key].bSize),
      align: qstr(url,`${key}align`,POS[key].align), max: qnum(url,`${key}max`,POS[key].max),
    };
  }

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
    const pageCount = pdf.getPageCount();

    const get = (i) => (i < pageCount ? pdf.getPage(i) : null);
    const page1 = get(0);
    const page2 = get(1);
    const page3 = get(2);
    const page4 = get(3);
    const page5 = get(4);
    const page6 = get(5);
    const page7 = get(6);
    const page8 = get(7);

    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const fullName = norm(pickCoverName(data, url) || data?.person?.fullName || data?.FullName || '');
    const pathLabel = norm(S(url.searchParams.get('flow'), '') || data?.flowLabel || 'Perspective');
    const dateLbl = norm(
      data?.assessmentDateLbl ||
      data?.summary?.flow?.dateLbl ||
      formatDateLbl(data?.assessmentDateISO || data?.dateISO || new Date())
    );

    /* ---------------- Page 1 ---------------- */
    drawTextBox(page1, HelvB, pathLabel, POS.n1, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, HelvB, fullName,  POS.f1, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, Helv,  dateLbl,   POS.d1, { maxLines: 1, ellipsis: true });

    /* ---------------- Page 2 ---------------- */
    drawTextBox(page2, HelvB, pathLabel, POS.f2, { maxLines: 1, ellipsis: true }); // PathName (flow) — locked
    drawTextBox(page2, Helv,  fullName,  POS.n2, { maxLines: 1, ellipsis: true }); // FullName — locked

    /* ---------------- Page 3 ---------------- */
    drawTextBox(page3, HelvB, pathLabel, POS.f3, { maxLines: 1, ellipsis: true });
    drawTextBox(page3, Helv,  fullName,  POS.n3, { maxLines: 1, ellipsis: true });

    /* ---------------- Page 4 ---------------- */
    drawTextBox(page4, HelvB, pathLabel, POS.f4, { maxLines: 1, ellipsis: true });
    drawTextBox(page4, Helv,  fullName,  POS.n4, { maxLines: 1, ellipsis: true });

    /* ---------------- Page 5 ---------------- */
    // Header
    drawTextBox(page5, HelvB, pathLabel, POS.f5, { maxLines: 1, ellipsis: true });
    drawTextBox(page5, Helv,  fullName,  POS.n5, { maxLines: 1, ellipsis: true });

    // Dominant state + description + how
    const dom = norm(data?.stateWord || '');
    if (dom) drawTextBox(page5, HelvB, dom, POS.dom5, { maxLines: 1, ellipsis: true });

    const domPara = norm(data?.dominantParagraph || '');
    if (domPara) drawTextBox(page5, Helv, domPara,
      { x: POS.dom5desc.x, y: POS.dom5desc.y, w: POS.dom5desc.w, size: POS.dom5desc.size, align: POS.dom5desc.align, color: rgb(0.24,0.23,0.35) },
      { maxLines: POS.dom5desc.max, ellipsis: true }
    );

    const how = norm(data?.how || '');
    if (how) drawTextBox(page5, Helv, how,
      { x: POS.how5.x, y: POS.how5.y, w: POS.how5.w, size: POS.how5.size, align: POS.how5.align, color: rgb(0.24,0.23,0.35) },
      { maxLines: POS.how5.max, ellipsis: true }
    );

    // Chart
    if (!noGraph && data?.chartUrl) {
      try {
        const r = await fetch(S(data.chartUrl,''));
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.c5;
          const ph = page5.getHeight();
          page5.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore chart errors */ }
    }

    // (MOVED from Page 2) — Patterns (left) NOW ON PAGE 5
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
          page5,
          HelvB,
          b.title,
          { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.hSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: 1, ellipsis: true }
        );
        curY += (POS.p2Patterns.hSize + 3) + POS.p2Patterns.titleGap;
      }
      if (b.body) {
        const r2 = drawTextBox(
          page5,
          Helv,
          b.body,
          { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.bSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: POS.p2Patterns.maxBodyLines, ellipsis: true }
        );
        curY += r2.height + POS.p2Patterns.blockGap;
      }
    }

    // (MOVED from Page 2) — Themes narrative NOW ON PAGE 5 (right column)
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
        page5,
        Helv,
        themeNarr,
        { x: POS.p2ThemePara.x, y: POS.p2ThemePara.y, w: POS.p2ThemePara.w, size: POS.p2ThemePara.size, align: POS.p2ThemePara.align, color: POS.p2ThemePara.color, lineGap: POS.p2ThemePara.lineGap },
        { maxLines: POS.p2ThemePara.maxLines, ellipsis: true }
      );
    }

    /* ---------------- Page 6 ---------------- */
    drawTextBox(page6, HelvB, pathLabel, POS.f6, { maxLines: 1, ellipsis: true });
    drawTextBox(page6, Helv,  fullName,  POS.n6, { maxLines: 1, ellipsis: true });

    const blocks = [
      data.block1 && { pos: POS.b61, ...data.block1 },
      data.block2 && { pos: POS.b62, ...data.block2 },
      data.block3 && { pos: POS.b63, ...data.block3 },
      data.block4 && { pos: POS.b64, ...data.block4 },
      data.block5 && { pos: POS.b65, ...data.block5 },
    ].filter(Boolean);

    for (const b of blocks) {
      if (b?.title) drawTextBox(page6, HelvB, norm(b.title), { x:b.pos.x, y:b.pos.y, w:b.pos.w, size:b.pos.hSize, align:b.pos.align, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
      if (b?.body)  drawTextBox(page6, Helv,  norm(b.body),  { x:b.pos.x, y:b.pos.y + (b.pos.hSize + 6), w:b.pos.w, size:b.pos.bSize, align:b.pos.align, color: rgb(0.24,0.23,0.35) }, { maxLines: b.pos.max, ellipsis: true });
    }

    /* ---------------- Page 7 ---------------- */
    drawTextBox(page7, HelvB, pathLabel, POS.f7, { maxLines: 1, ellipsis: true });
    drawTextBox(page7, Helv,  fullName,  POS.n7, { maxLines: 1, ellipsis: true });

    /* ---------------- Page 8 ---------------- */
    drawTextBox(page8, HelvB, pathLabel, POS.f8, { maxLines: 1, ellipsis: true });
    drawTextBox(page8, Helv,  fullName,  POS.n8, { maxLines: 1, ellipsis: true });

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
