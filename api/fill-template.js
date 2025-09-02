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
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

const alignNorm = (a, fb = 'left') => {
  const s = (a || fb || '').toLowerCase();
  if (s === 'center' || s === 'centre' || s === 'middle') return 'center';
  if (s === 'right' || s === 'end') return 'right';
  return 'left';
};

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
  // Use your template filename
  const url   = `${proto}://${host}/CTRL_Perspective_Assessment_Profile_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

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

const pickCoverName = (data, url) => norm(
  (data?.person?.coverName) ??
  data?.coverName ??
  data?.person?.fullName ??
  data?.fullName ??
  data?.summary?.user?.reportCoverName ??
  data?.summary?.user?.fullName ??
  url?.searchParams?.get('cover') ??
  ''
);

const pickFullName = (data) => norm(
  (data?.person?.fullName) ??
  data?.fullName ??
  data?.summary?.user?.fullName ??
  ''
);

function fmtDateLbl(isoOrLbl) {
  if (typeof isoOrLbl === 'string' && /^\d{2}\/[A-Z]{3}\/\d{4}$/.test(isoOrLbl)) return isoOrLbl;
  const d = isoOrLbl ? new Date(isoOrLbl) : new Date();
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  return `${dd}/${MMM}/${yyyy}`;
}

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  let url;
  try { url = new URL(req?.url || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const isTest   = url.searchParams.get('test') === '1';
  const isPair   = url.searchParams.get('test') === 'pair';
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const noGraph  = url.searchParams.get('nograph') === '1';

  // Demo payload
  let data;
  if (isTest || isPair) {
    const common = {
      flowLabel: 'Perspective',
      person:   { coverName: 'Toby New', fullName: 'Toby New', preferredName: 'Toby', initials: 'TN' },
      coverName:'Toby New',
      fullName: 'Toby New',
      dateISO:  new Date().toISOString(),

      // Page 5 demo (dominant + how + chart)
      stateWord: 'Regulated',
      dominantParagraph: 'You connect the most with Mika—grounded, fair, steady under pressure.',
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

      // Page 2 demo content
      page2Patterns: [
        { title:'Direction & shape', body:'Steady line with mixed steps; keep the little habits that held you there.' },
        { title:'Coverage & edges',  body:'You touched 2 states and saw little of Lead or Concealed—two areas to explore.' },
      ],
      themeNarrative: 'You steady yourself when feelings spike and notice how your words land—clear intent and cleaner repair.',

      // Page 6 demo blocks
      blockShapeCoverage: 'Mixed shape with moderate coverage; stable centre of gravity with some flex.',
      blockMissingState:  'Least present: Concealed & Lead—consider when either could be useful.',
      blockThemes:        'Top themes: Emotion regulation, Feedback handling.',
      blockTips:          'Tip 1: Breathe before you speak.\nTip 2: Insert a brief check-in.',
      actions:            ['Try one “name the gear” moment tomorrow.', 'Ask for one micro-feedback after a meeting.'],
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

  /* ---------------- POSITIONS (defaults) ---------------- */
  const POS = {
    // ==== PAGE 1 (Locked per your request) ====
    // PathName (flow label) — LOCKED to your coords
    p1Flow: { x:285, y:165, w:400, size:40, align:'left',  color: rgb(0.12,0.11,0.2) },
    // FullName (small header) — LOCKED to your coords
    p1Name: { x:-10, y:570, w:600, size:32, align:'center', color: rgb(0.24,0.23,0.35) },
    // Date (DD/MMM/YYYY) — keep (you already liked this); still tunable if needed
    p1Date: { x:120, y:630, w:500, size:25, align:'left', color: rgb(0.24,0.23,0.35) },

    // ==== Removed on Page 1 ====
    // (no howSingle / howPair / nameCover / chart on Page 1)

    // ==== PAGE 2 ====
    p2Patterns: { x:120, y:520, w:1260, hSize:14, bSize:20, align:'left', titleGap:6, blockGap:20, maxBodyLines:6 },
    p2ThemePara:{ x:1280, y:620, w:630,  size:30, align:'left', color: rgb(0.24,0.23,0.35), lineGap:4, maxLines:14 },

    // Flow labels (pages 1–8)
    p2Flow: { x:90, y:60, w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p3Flow: { x:90, y:60, w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p4Flow: { x:90, y:60, w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p5Flow: { x:90, y:60, w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p6Flow: { x:90, y:60, w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p7Flow: { x:90, y:60, w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },
    p8Flow: { x:90, y:60, w:400, size:18, align:'left',  color: rgb(0.12,0.11,0.2) },

    // Full name headers (pages 2–8)
    p2Name: { x:460, y:60, w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p3Name: { x:460, y:60, w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p4Name: { x:460, y:60, w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p5Name: { x:460, y:60, w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p6Name: { x:460, y:60, w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p7Name: { x:460, y:60, w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },
    p8Name: { x:460, y:60, w:800, size:18, align:'center', color: rgb(0.24,0.23,0.35) },

    /* PAGE 5 content (dominant + how + chart) */
    dom5Title: { x:120, y:250, w:900, size:36, align:'left',  color: rgb(0.12,0.11,0.2) },
    dom5Desc:  { x:120, y:300, w:900, size:22, align:'left',  color: rgb(0.24,0.23,0.35), lineGap:4, maxLines:6 },
    how5:      { x:120, y:360, w:900, size:22, align:'left',  color: rgb(0.24,0.23,0.35), lineGap:4, maxLines:4 },
    chart5:    { x:1100, y:300, w:650, h:420 },

    /* PAGE 6 blocks */
    b61: { x:120,  y:260, w:1500, hSize:16, bSize:22, align:'left', titleGap:6, maxLines:5 }, // Shape + Coverage
    b62: { x:120,  y:410, w:1500, hSize:16, bSize:22, align:'left', titleGap:6, maxLines:5 }, // Missing State
    b63: { x:120,  y:560, w:1500, hSize:16, bSize:22, align:'left', titleGap:6, maxLines:6 }, // Themes
    b64: { x:120,  y:740, w:1500, hSize:16, bSize:22, align:'left', titleGap:6, maxLines:5 }, // Tips
    b65: { x:120,  y:890, w:1500, hSize:16, bSize:22, align:'left', titleGap:6, maxLines:5 }, // Actions
  };

  /* ---------------- tuners ---------------- */
  // Keep Page 1: PathName + FullName + Date tunable (defaults are your locked values)
  POS.p1Flow = { ...POS.p1Flow,
    x:qnum(url,'f1x',POS.p1Flow.x), y:qnum(url,'f1y',POS.p1Flow.y),
    w:qnum(url,'f1w',POS.p1Flow.w), size:qnum(url,'f1s',POS.p1Flow.size),
    align: alignNorm(qstr(url,'f1align',POS.p1Flow.align), POS.p1Flow.align)
  };
  POS.p1Name = { ...POS.p1Name,
    x:qnum(url,'n1x',POS.p1Name.x), y:qnum(url,'n1y',POS.p1Name.y),
    w:qnum(url,'n1w',POS.p1Name.w), size:qnum(url,'n1s',POS.p1Name.size),
    align: alignNorm(qstr(url,'n1align',POS.p1Name.align), POS.p1Name.align)
  };
  POS.p1Date = { ...POS.p1Date,
    x:qnum(url,'d1x',POS.p1Date.x), y:qnum(url,'d1y',POS.p1Date.y),
    w:qnum(url,'d1w',POS.p1Date.w), size:qnum(url,'d1s',POS.p1Date.size),
    align: alignNorm(qstr(url,'d1align',POS.p1Date.align), POS.p1Date.align)
  };

  // Flow & FullName for pages 2–8 (tunable)
  for (let n=2;n<=8;n++){
    const fk = `p${n}Flow`, nk = `p${n}Name`;
    POS[fk] = { ...POS[fk],
      x:qnum(url,`f${n}x`,POS[fk].x), y:qnum(url,`f${n}y`,POS[fk].y),
      w:qnum(url,`f${n}w`,POS[fk].w), size:qnum(url,`f${n}s`,POS[fk].size),
      align: alignNorm(qstr(url,`f${n}align`,POS[fk].align), POS[fk].align)
    };
    POS[nk] = { ...POS[nk],
      x:qnum(url,`n${n}x`,POS[nk].x), y:qnum(url,`n${n}y`,POS[nk].y),
      w:qnum(url,`n${n}w`,POS[nk].w), size:qnum(url,`n${n}s`,POS[nk].size),
      align: alignNorm(qstr(url,`n${n}align`,POS[nk].align), POS[nk].align)
    };
  }

  // Page 2 tuners (patterns + theme paragraph)
  POS.p2Patterns = { ...POS.p2Patterns,
    x:qnum(url,'p2px',POS.p2Patterns.x), y:qnum(url,'p2py',POS.p2Patterns.y),
    w:qnum(url,'p2pw',POS.p2Patterns.w),
    hSize:qnum(url,'p2phsize',POS.p2Patterns.hSize),
    bSize:qnum(url,'p2pbsize',POS.p2Patterns.bSize),
    align: alignNorm(qstr(url,'p2palign',POS.p2Patterns.align), POS.p2Patterns.align),
    titleGap:qnum(url,'p2ptitlegap',POS.p2Patterns.titleGap),
    blockGap:qnum(url,'p2pblockgap',POS.p2Patterns.blockGap),
    maxBodyLines:qnum(url,'p2pmax',POS.p2Patterns.maxBodyLines)
  };
  POS.p2ThemePara = { ...POS.p2ThemePara,
    x:qnum(url,'p2tx',POS.p2ThemePara.x), y:qnum(url,'p2ty',POS.p2ThemePara.y),
    w:qnum(url,'p2tw',POS.p2ThemePara.w), size:qnum(url,'p2ts',POS.p2ThemePara.size),
    align: alignNorm(qstr(url,'p2talign',POS.p2ThemePara.align), POS.p2ThemePara.align),
    maxLines:qnum(url,'p2tmax',POS.p2ThemePara.maxLines)
  };

  // Page 5 tuners (dominant, desc, how, chart)
  POS.dom5Title = { ...POS.dom5Title,
    x:qnum(url,'dom5x',POS.dom5Title.x), y:qnum(url,'dom5y',POS.dom5Title.y),
    w:qnum(url,'dom5w',POS.dom5Title.w), size:qnum(url,'dom5s',POS.dom5Title.size),
    align: alignNorm(qstr(url,'dom5align',POS.dom5Title.align), POS.dom5Title.align)
  };
  POS.dom5Desc = { ...POS.dom5Desc,
    x:qnum(url,'dom5descx',POS.dom5Desc.x), y:qnum(url,'dom5descy',POS.dom5Desc.y),
    w:qnum(url,'dom5descw',POS.dom5Desc.w), size:qnum(url,'dom5descs',POS.dom5Desc.size),
    align: alignNorm(qstr(url,'dom5descalign',POS.dom5Desc.align), POS.dom5Desc.align),
    lineGap: POS.dom5Desc.lineGap,
    maxLines: qnum(url,'dom5descmax',POS.dom5Desc.maxLines)
  };
  POS.how5 = { ...POS.how5,
    x:qnum(url,'how5x',POS.how5.x), y:qnum(url,'how5y',POS.how5.y),
    w:qnum(url,'how5w',POS.how5.w), size:qnum(url,'how5s',POS.how5.size),
    align: alignNorm(qstr(url,'how5align',POS.how5.align), POS.how5.align),
    maxLines: qnum(url,'how5max',POS.how5.maxLines)
  };
  POS.chart5 = { ...POS.chart5,
    x:qnum(url,'c5x',POS.chart5.x), y:qnum(url,'c5y',POS.chart5.y),
    w:qnum(url,'c5w',POS.chart5.w), h:qnum(url,'c5h',POS.chart5.h)
  };

  // Page 6 block tuners
  for (let i=1;i<=5;i++){
    const key = `b6${i}`;
    POS[key] = { ...POS[key],
      x:qnum(url,`b6${i}x`,POS[key].x), y:qnum(url,`b6${i}y`,POS[key].y),
      w:qnum(url,`b6${i}w`,POS[key].w),
      hSize:qnum(url,`b6${i}hsize`,POS[key].hSize),
      bSize:qnum(url,`b6${i}bsize`,POS[key].bSize),
      align: alignNorm(qstr(url,`b6${i}align`,POS[key].align), POS[key].align),
      titleGap: POS[key].titleGap ?? 6,
      maxLines: qnum(url,`b6${i}max`,POS[key].maxLines ?? 6),
    };
  }

  const flowLbl  = qstr(url,'flow','') || data?.flowLabel || data?.summary?.flow?.label || 'Perspective';
  const fullName = pickFullName(data) || pickCoverName(data, url);
  const dateLbl  = fmtDateLbl(data?.dateLbl || data?.summary?.flow?.dateISO || data?.dateISO);

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok:true, flowLbl, fullName, dateLbl, pos:POS, urlParams:Object.fromEntries(url.searchParams.entries()) }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageCount = pdf.getPageCount();
    const getPage = (i) => (i < pageCount ? pdf.getPage(i) : null);

    /* ---------------- Page 1 (only Flow, FullName, Date) ---------------- */
    const page1 = getPage(0);
    if (page1) {
      drawTextBox(page1, HelvB, norm(flowLbl), POS.p1Flow, { maxLines:1, ellipsis:true });
      if (fullName) drawTextBox(page1, Helv, fullName, POS.p1Name, { maxLines:1, ellipsis:true });
      if (dateLbl)  drawTextBox(page1, Helv, dateLbl, POS.p1Date, { maxLines:1, ellipsis:true });

      // Intentionally NO headline / NO how / NO big cover name / NO chart on Page 1
    }

    /* ---------------- Page 2 ---------------- */
    const page2 = getPage(1);
    if (page2) {
      drawTextBox(page2, HelvB, norm(flowLbl), POS.p2Flow, { maxLines:1, ellipsis:true });
      if (fullName) drawTextBox(page2, Helv, fullName, POS.p2Name, { maxLines:1, ellipsis:true });

      const rawBlocks = Array.isArray(data.page2Patterns)
        ? data.page2Patterns
        : Array.isArray(data.page2Blocks) ? data.page2Blocks : [];
      const twoBlocks = rawBlocks.map(b => ({ title: norm(b?.title||''), body: norm(b?.body||'') }))
                                 .filter(b => b.title || b.body)
                                 .slice(0, 2);

      let curY = POS.p2Patterns.y;
      for (const b of twoBlocks) {
        if (b.title) {
          drawTextBox(page2, HelvB, b.title,
            { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.hSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
            { maxLines:1, ellipsis:true }
          );
          curY += (POS.p2Patterns.hSize + 3) + POS.p2Patterns.titleGap;
        }
        if (b.body) {
          const r = drawTextBox(page2, Helv, b.body,
            { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.bSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
            { maxLines: POS.p2Patterns.maxBodyLines, ellipsis:true }
          );
          curY += r.height + POS.p2Patterns.blockGap;
        }
      }

      let themeNarr = '';
      if (typeof data.themeNarrative === 'string' && data.themeNarrative.trim()) {
        themeNarr = norm(data.themeNarrative.trim());
      } else if (Array.isArray(data.page2Themes) && data.page2Themes.length) {
        const bits = data.page2Themes.map(t => [t?.title, t?.body].filter(Boolean).join(': ')).filter(Boolean);
        themeNarr = norm(bits.join('  '));
      } else if (typeof data.themesExplainer === 'string' && data.themesExplainer.trim()) {
        themeNarr = norm(data.themesExplainer.replace(/\n+/g, ' ').replace(/•\s*/g, '').trim());
      }
      if (themeNarr) {
        drawTextBox(page2, Helv, themeNarr,
          { x: POS.p2ThemePara.x, y: POS.p2ThemePara.y, w: POS.p2ThemePara.w, size: POS.p2ThemePara.size, align: POS.p2ThemePara.align, color: POS.p2ThemePara.color, lineGap: POS.p2ThemePara.lineGap },
          { maxLines: POS.p2ThemePara.maxLines, ellipsis:true }
        );
      }
    }

    /* ---------------- Page 3–4 headers only ---------------- */
    for (const n of [3,4]) {
      const p = getPage(n-1); if (!p) continue;
      drawTextBox(p, HelvB, norm(flowLbl), POS[`p${n}Flow`], { maxLines:1, ellipsis:true });
      if (fullName) drawTextBox(p, Helv, fullName, POS[`p${n}Name`], { maxLines:1, ellipsis:true });
    }

    /* ---------------- Page 5 (Dominant + how + chart) ---------------- */
    const page5 = getPage(4);
    if (page5) {
      drawTextBox(page5, HelvB, norm(flowLbl), POS.p5Flow, { maxLines:1, ellipsis:true });
      if (fullName) drawTextBox(page5, Helv, fullName, POS.p5Name, { maxLines:1, ellipsis:true });

      const domWord = norm(
        data.stateWord ||
        (Array.isArray(data.stateWords) ? data.stateWords.join(' & ') : '') ||
        ''
      );
      if (domWord) drawTextBox(page5, HelvB, domWord, POS.dom5Title, { maxLines:1, ellipsis:true });

      const domDesc = norm(data.dominantParagraph || data.dominantDescription || '');
      if (domDesc) drawTextBox(page5, Helv, domDesc, POS.dom5Desc, { maxLines: POS.dom5Desc.maxLines, ellipsis:true });

      const how5 = norm(data.how || '');
      if (how5) drawTextBox(page5, Helv, how5, POS.how5, { maxLines: POS.how5.maxLines, ellipsis:true });

      if (!noGraph && data.chartUrl) {
        try {
          const r = await fetch(S(data.chartUrl,''));
          if (r.ok) {
            const png = await pdf.embedPng(await r.arrayBuffer());
            const { x, y, w, h } = POS.chart5;
            const ph = page5.getHeight();
            page5.drawImage(png, { x, y: ph - y - h, width: w, height: h });
          }
        } catch { /* ignore */ }
      }
    }

    /* ---------------- Page 6 (five blocks) ---------------- */
    const page6 = getPage(5);
    if (page6) {
      drawTextBox(page6, HelvB, norm(flowLbl), POS.p6Flow, { maxLines:1, ellipsis:true });
      if (fullName) drawTextBox(page6, Helv, fullName, POS.p6Name, { maxLines:1, ellipsis:true });

      const block1Title = 'Shape & Coverage';
      const block1Body  = norm(
        data.blockShapeCoverage ||
        (Array.isArray(data.page2Patterns) && data.page2Patterns[0]?.body) ||
        ''
      );

      const block2Title = 'Missing State(s)';
      const block2Body  = norm(
        data.blockMissingState ||
        (Array.isArray(data.page2Patterns) && data.page2Patterns[1]?.body) ||
        ''
      );

      const block3Title = 'Themes';
      const block3Body  = norm(
        data.blockThemes ||
        data.themeNarrative ||
        ''
      );

      const block4Title = 'Tips';
      const tipsTxt = (() => {
        if (data.blockTips) return data.blockTips;
        const t1 = data.tip1 ? `• ${data.tip1}` : '';
        const t2 = data.tip2 ? `\n• ${data.tip2}` : '';
        return (t1 + t2).trim();
      })();

      const block5Title = 'Actions';
      const actionsTxt = (() => {
        if (Array.isArray(data.actions) && data.actions.length) {
          return data.actions.map(a => `• ${a}`).join('\n');
        }
        return data.blockActions || '';
      })();

      const drawBlock = (page, title, body, spec) => {
        if (title) {
          drawTextBox(page, HelvB, title, { x: spec.x, y: spec.y, w: spec.w, size: spec.hSize, align: spec.align, color: rgb(0.12,0.11,0.2) }, { maxLines:1, ellipsis:true });
        }
        if (body) {
          drawTextBox(page, Helv, body, { x: spec.x, y: spec.y + (spec.hSize + (spec.titleGap ?? 6)), w: spec.w, size: spec.bSize, align: spec.align, color: rgb(0.24,0.23,0.35), lineGap:4 }, { maxLines: spec.maxLines ?? 6, ellipsis:true });
        }
      };

      drawBlock(page6, block1Title, block1Body, POS.b61);
      drawBlock(page6, block2Title, block2Body, POS.b62);
      drawBlock(page6, block3Title, block3Body, POS.b63);
      drawBlock(page6, block4Title, tipsTxt,     POS.b64);
      drawBlock(page6, block5Title, actionsTxt,  POS.b65);
    }

    /* ---------------- Page 7–8 headers only ---------------- */
    for (const n of [7,8]) {
      const p = getPage(n-1); if (!p) continue;
      drawTextBox(p, HelvB, norm(flowLbl), POS[`p${n}Flow`], { maxLines:1, ellipsis:true });
      if (fullName) drawTextBox(p, Helv, fullName, POS[`p${n}Name`], { maxLines:1, ellipsis:true });
    }

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
