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

async function fetchTemplate(req, url) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');
  // Allow override via ?tpl=..., else use V3 by default
  const tplName = url?.searchParams?.get('tpl') || 'CTRL_Perspective_Assessment_Profile_templateV3.pdf';
  const full = `${proto}://${host}/${tplName}`;
  const r = await fetch(full);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText} for ${tplName}`);
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
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const flowLbl  = qstr(url, 'flow', 'Perspective'); // header label (“Perspective/Observe/Reflective”)

  // ---- Demo payloads for quick placement ----
  let data;
  if (isTest) {
    data = {
      person:   { coverName: 'Avery Example', fullName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },
      coverName:'Avery Example',
      stateWord:'Regulated',
      how: 'You connect the most with Mika, which looks like staying grounded and adapting in the moment. Calm, intentional progress.',
      // Page 7 blocks (patterns + themes) — simple demo
      page2Patterns: [
        { title:'Direction & shape', body:'Steady line with mixed steps — you stayed in a similar zone overall.' },
        { title:'Coverage & edges',  body:'Touched 2 states; consider exploring the quieter corners next.' },
      ],
      themeNarrative: 'Emotion regulation with Awareness of impact stood out together.',
      // Tips/Actions demo
      tipsTop2:    ['Take one breath and name it.', 'Choose your gear on purpose.'],
      actionsTop2: ['Share one boundary early.', 'Ask one “what would help?” question.'],
      // Chart (radar) — compass-like
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
      }))
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

  /* --------------------- POSITIONS / TUNERS --------------------- */
  // Defaults for headers (you can keep tuning these via ?f1x=... etc.)
  const POS = {
    // Page 1 header
    f1: { x: 290, y: 170, w: 400, size: 40, align:'left'  }, // PathName
    n1: { x: 10,  y: 573, w: 500, size: 30, align:'center'}, // FullName
    d1: { x: 130, y: 630, w: 500, size: 20, align:'left'  }, // Date (DD/MMM/YYYY)

    // Page 2–8 small headers (PathName/FullName; keep tunable)
    f2: { x: 200, y: 64, w: 400, size: 13, align:'left'  }, n2: { x: 250, y: 64, w: 400, size: 12, align:'center' },
    f3: { x: 200, y: 64, w: 400, size: 13, align:'left'  }, n3: { x: 250, y: 64, w: 400, size: 12, align:'center' },
    f4: { x: 200, y: 64, w: 400, size: 13, align:'left'  }, n4: { x: 250, y: 64, w: 400, size: 12, align:'center' },
    f5: { x: 200, y: 64, w: 400, size: 13, align:'left'  }, n5: { x: 250, y: 64, w: 400, size: 12, align:'center' },
    f6: { x: 200, y: 64, w: 400, size: 13, align:'left'  }, n6: { x: 250, y: 64, w: 400, size: 12, align:'center' },
    f7: { x: 200, y: 64, w: 400, size: 13, align:'left'  }, n7: { x: 250, y: 64, w: 400, size: 12, align:'center' },
    f8: { x: 200, y: 64, w: 400, size: 13, align:'left'  }, n8: { x: 250, y: 64, w: 400, size: 12, align:'center' },

    /* ---------------- Page 6 body (kept on page 6) ---------------- */
    // Dominant header & description (page 6)
    dom6:     { x: 55, y: 280, w: 900, size: 33, align:'left' },
    dom6desc: { x: 40, y: 380, w: 250, size: 15, align:'left', max: 8 },

    // HOW THIS SHOWS UP — **LOCKED** to your requested defaults
    how6:     { x: 40, y: 560, w: 500, size: 20, align:'left', max: 10 },

    // Radar chart (page 6)
    c6:       { x: 203, y: 230, w: 420, h: 220 },

    /* ---------------- Page 7 body (patterns / themes / tips / actions) ---------------- */
    // Pattern blocks (LEFT column) — now the ONLY page for these (moved from page 6)
    p7p: {
      x: 120, y: 520, w: 1260,
      hSize: 14, bSize: 20, align: 'left',
      titleGap: 6, blockGap: 20, maxBodyLines: 6
    },
    // Themes narrative (RIGHT or wherever you place it on p7)
    p7t: {
      x: 120, y: 320, w: 1260,
      size: 20, align: 'left', maxLines: 10
    },
    // Tips (top-2) block
    p7tips: { x: 120, y: 720, w: 630, size: 20, align:'left', maxLines: 8 },
    // Actions (top-2) block
    p7acts: { x: 780, y: 720, w: 630, size: 20, align:'left', maxLines: 8 },
  };

  // ---- Apply header tuners (pages 1–8)
  for (let i = 1; i <= 8; i++) {
    const f = POS[`f${i}`];
    const n = POS[`n${i}`];
    if (f) {
      f.x = qnum(url, `f${i}x`, f.x);
      f.y = qnum(url, `f${i}y`, f.y);
      f.w = qnum(url, `f${i}w`, f.w);
      f.size = qnum(url, `f${i}s`, f.size);
      f.align = qstr(url, `f${i}align`, f.align);
    }
    if (n) {
      n.x = qnum(url, `n${i}x`, n.x);
      n.y = qnum(url, `n${i}y`, n.y);
      n.w = qnum(url, `n${i}w`, n.w);
      n.size = qnum(url, `n${i}s`, n.size);
      n.align = qstr(url, `n${i}align`, n.align);
    }
  }
  // Page 1 date
  POS.d1.x = qnum(url,'d1x',POS.d1.x);
  POS.d1.y = qnum(url,'d1y',POS.d1.y);
  POS.d1.w = qnum(url,'d1w',POS.d1.w);
  POS.d1.size = qnum(url,'d1s',POS.d1.size);
  POS.d1.align = qstr(url,'d1align',POS.d1.align);

  // Page 6 body tuners (dominant + desc + chart) — how6 is LOCKED by default but still tunable via query
  for (const key of ['dom6','c6']) {
    const obj = POS[key];
    obj.x = qnum(url, `${key}x`, obj.x);
    obj.y = qnum(url, `${key}y`, obj.y);
    obj.w = qnum(url, `${key}w`, obj.w);
    if (obj.h != null) obj.h = qnum(url, `${key}h`, obj.h);
    if (obj.size != null) obj.size = qnum(url, `${key}s`, obj.size);
    if (obj.align) obj.align = qstr(url, `${key}align`, obj.align);
  }
  POS.dom6desc.x = qnum(url, 'dom6descx', POS.dom6desc.x);
  POS.dom6desc.y = qnum(url, 'dom6descy', POS.dom6desc.y);
  POS.dom6desc.w = qnum(url, 'dom6descw', POS.dom6desc.w);
  POS.dom6desc.size = qnum(url, 'dom6descs', POS.dom6desc.size);
  POS.dom6desc.align = qstr(url, 'dom6descalign', POS.dom6desc.align);
  POS.dom6desc.max = qnum(url, 'dom6descmax', POS.dom6desc.max);

  // how6 (LOCKED defaults already set; still allow query override if provided)
  POS.how6.x = qnum(url, 'how6x', POS.how6.x);
  POS.how6.y = qnum(url, 'how6y', POS.how6.y);
  POS.how6.w = qnum(url, 'how6w', POS.how6.w);
  POS.how6.size = qnum(url, 'how6s', POS.how6.size);
  POS.how6.align = qstr(url, 'how6align', POS.how6.align);
  POS.how6.max = qnum(url, 'how6max', POS.how6.max);

  // ---------------- PAGE 7: patterns/themes/tips/actions ----------------
  // Primary p7* tuners:
  const P7 = POS.p7p; // shorthand
  P7.x = qnum(url,'p7px',P7.x);
  P7.y = qnum(url,'p7py',P7.y);
  P7.w = qnum(url,'p7pw',P7.w);
  P7.hSize = qnum(url,'p7phsize',P7.hSize);
  P7.bSize = qnum(url,'p7pbsize',P7.bSize);
  P7.align = qstr(url,'p7palign',P7.align);
  P7.titleGap = qnum(url,'p7ptitlegap',P7.titleGap);
  P7.blockGap = qnum(url,'p7pblockgap',P7.blockGap);
  P7.maxBodyLines = qnum(url,'p7pmax',P7.maxBodyLines);

  POS.p7t.x = qnum(url,'p7tx',POS.p7t.x);
  POS.p7t.y = qnum(url,'p7ty',POS.p7t.y);
  POS.p7t.w = qnum(url,'p7tw',POS.p7t.w);
  POS.p7t.size = qnum(url,'p7ts',POS.p7t.size);
  POS.p7t.align = qstr(url,'p7talign',POS.p7t.align);
  POS.p7t.maxLines = qnum(url,'p7tmax',POS.p7t.maxLines);

  POS.p7tips.x = qnum(url,'p7tipsx',POS.p7tips.x);
  POS.p7tips.y = qnum(url,'p7tipsy',POS.p7tips.y);
  POS.p7tips.w = qnum(url,'p7tipsw',POS.p7tips.w);
  POS.p7tips.size = qnum(url,'p7tipss',POS.p7tips.size);
  POS.p7tips.align = qstr(url,'p7tipsalign',POS.p7tips.align);
  POS.p7tips.maxLines = qnum(url,'p7tipsmax',POS.p7tips.maxLines);

  POS.p7acts.x = qnum(url,'p7actsx',POS.p7acts.x);
  POS.p7acts.y = qnum(url,'p7actsy',POS.p7acts.y);
  POS.p7acts.w = qnum(url,'p7actsw',POS.p7acts.w);
  POS.p7acts.size = qnum(url,'p7actss',POS.p7acts.size);
  POS.p7acts.align = qstr(url,'p7actsalign',POS.p7acts.align);
  POS.p7acts.maxLines = qnum(url,'p7actsmax',POS.p7acts.maxLines);

  // ---- Back-compat: treat any legacy p6p* / p6t* params as synonyms for p7* ----
  // If a p7* param was NOT provided, but a p6* was, copy it into p7.
  const fallbackParam = (primary, legacy) => {
    if (url.searchParams.get(primary) == null && url.searchParams.get(legacy) != null) {
      url.searchParams.set(primary, url.searchParams.get(legacy));
    }
  };
  // pattern block group
  fallbackParam('p7px','p6px');           fallbackParam('p7py','p6py');
  fallbackParam('p7pw','p6pw');           fallbackParam('p7phsize','p6phsize');
  fallbackParam('p7pbsize','p6pbsize');   fallbackParam('p7palign','p6palign');
  fallbackParam('p7ptitlegap','p6ptitlegap');
  fallbackParam('p7pblockgap','p6pblockgap');
  fallbackParam('p7pmax','p6pmax');
  // theme narrative paragraph
  fallbackParam('p7tx','p6tx');           fallbackParam('p7ty','p6ty');
  fallbackParam('p7tw','p6tw');           fallbackParam('p7ts','p6ts');
  fallbackParam('p7talign','p6talign');   fallbackParam('p7tmax','p6tmax');
  // Re-apply p7 with potential legacy overrides
  P7.x = qnum(url,'p7px',P7.x);
  P7.y = qnum(url,'p7py',P7.y);
  P7.w = qnum(url,'p7pw',P7.w);
  P7.hSize = qnum(url,'p7phsize',P7.hSize);
  P7.bSize = qnum(url,'p7pbsize',P7.bSize);
  P7.align = qstr(url,'p7palign',P7.align);
  P7.titleGap = qnum(url,'p7ptitlegap',P7.titleGap);
  P7.blockGap = qnum(url,'p7pblockgap',P7.blockGap);
  P7.maxBodyLines = qnum(url,'p7pmax',P7.maxBodyLines);

  POS.p7t.x = qnum(url,'p7tx',POS.p7t.x);
  POS.p7t.y = qnum(url,'p7ty',POS.p7t.y);
  POS.p7t.w = qnum(url,'p7tw',POS.p7t.w);
  POS.p7t.size = qnum(url,'p7ts',POS.p7t.size);
  POS.p7t.align = qstr(url,'p7talign',POS.p7t.align);
  POS.p7t.maxLines = qnum(url,'p7tmax',POS.p7t.maxLines);

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
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);

    // Ensure at least 8 pages exist (0..7)
    const pageCount = pdf.getPageCount();
    if (pageCount < 7) throw new Error(`Template has ${pageCount} pages; need at least 7.`);

    const page1 = pdf.getPage(0);
    const page2 = pdf.getPage(1);
    const page3 = pdf.getPage(2);
    const page4 = pdf.getPage(3);
    const page5 = pdf.getPage(4);
    const page6 = pdf.getPage(5);
    const page7 = pdf.getPage(6);
    // (optional) const page8 = pageCount >= 8 ? pdf.getPage(7) : null;

    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    /* -------------------- HEADERS (pages 1–7) -------------------- */
    const coverName = pickCoverName(data, url);
    const fullName = norm(data?.person?.fullName || data?.fullName || coverName || '');
    const headerPath = norm(flowLbl || 'Perspective');

    const MMM_MAP = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const now = new Date();
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const MMM = MMM_MAP[now.getUTCMonth()];
    const yyyy = now.getUTCFullYear();
    const dateLbl = `${dd}/${MMM}/${yyyy}`;

    // Page 1
    drawTextBox(page1, HelvB, headerPath, POS.f1, { maxLines:1, ellipsis:true });
    if (fullName) drawTextBox(page1, HelvB, fullName, POS.n1, { maxLines:1, ellipsis:true });
    drawTextBox(page1, Helv,   dateLbl,   POS.d1, { maxLines:1, ellipsis:true });

    // Pages 2–7 uniform small headers
    const drawHeader = (pg, fi, ni) => {
      drawTextBox(pg, HelvB, headerPath, fi, { maxLines:1, ellipsis:true });
      if (fullName) drawTextBox(pg, Helv, fullName, ni, { maxLines:1, ellipsis:true });
    };
    drawHeader(page2, POS.f2, POS.n2);
    drawHeader(page3, POS.f3, POS.n3);
    drawHeader(page4, POS.f4, POS.n4);
    drawHeader(page5, POS.f5, POS.n5);
    drawHeader(page6, POS.f6, POS.n6);
    drawHeader(page7, POS.f7, POS.n7);

    /* -------------------- PAGE 6 CONTENT -------------------- */
    // Dominant state label
    const dominantLabel = norm(data?.stateWord || (Array.isArray(data?.stateWords) && data.stateWords[0]) || '');
    if (dominantLabel) {
      drawTextBox(page6, HelvB, dominantLabel, POS.dom6, { maxLines:1, ellipsis:true });
    }

    // Dominant description (short paragraph) — you can feed this via payload.dominantBlurb
    const dominantBlurb = norm(
      data?.dominantBlurb ||
      data?.dominantDescription ||
      data?.how || '' // fallback if nothing else provided
    );
    if (dominantBlurb) {
      drawTextBox(page6, Helv, dominantBlurb, {
        x: POS.dom6desc.x, y: POS.dom6desc.y, w: POS.dom6desc.w,
        size: POS.dom6desc.size, align: POS.dom6desc.align, color: rgb(0.24,0.23,0.35), lineGap:3
      }, { maxLines: POS.dom6desc.max, ellipsis: true });
    }

    // HOW THIS SHOWS UP — locked defaults (still overridable via query)
    const howText = norm(data?.how || '');
    if (howText) {
      drawTextBox(page6, Helv, howText, {
        x: POS.how6.x, y: POS.how6.y, w: POS.how6.w,
        size: POS.how6.size, align: POS.how6.align, color: rgb(0.24,0.23,0.35), lineGap:3
      }, { maxLines: POS.how6.max, ellipsis: true });
    }

    // Radar chart (page 6)
    if (data.chartUrl) {
      try {
        const r = await fetch(S(data.chartUrl,''));
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.c6;
          const ph = page6.getHeight();
          page6.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore chart errors */ }
    }

    /* -------------------- PAGE 7 CONTENT (patterns/themes/tips/actions) -------------------- */
    // Patterns: use data.page2Patterns (legacy name) or data.page7Patterns
    const blocksSrc = Array.isArray(data.page7Patterns) && data.page7Patterns.length
      ? data.page7Patterns
      : (Array.isArray(data.page2Patterns) ? data.page2Patterns : []);
    const twoBlocks = blocksSrc
      .map(b => ({ title: norm(b?.title||''), body: norm(b?.body||'') }))
      .filter(b => b.title || b.body);

    let curY = POS.p7p.y;
    const pSpec = POS.p7p;

    for (const b of twoBlocks) {
      if (b.title) {
        drawTextBox(
          page7,
          HelvB,
          b.title,
          { x: pSpec.x, y: curY, w: pSpec.w, size: pSpec.hSize, align: pSpec.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: 1, ellipsis: true }
        );
        curY += (pSpec.hSize + 3) + pSpec.titleGap;
      }
      if (b.body) {
        const r = drawTextBox(
          page7,
          Helv,
          b.body,
          { x: pSpec.x, y: curY, w: pSpec.w, size: pSpec.bSize, align: pSpec.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: pSpec.maxBodyLines, ellipsis: true }
        );
        curY += r.height + pSpec.blockGap;
      }
    }

    // Themes narrative (page 7)
    const themeNarr =
      norm(data?.page7ThemeNarrative) ||
      norm(data?.themeNarrative || '');
    if (themeNarr) {
      drawTextBox(
        page7,
        Helv,
        themeNarr,
        { x: POS.p7t.x, y: POS.p7t.y, w: POS.p7t.w, size: POS.p7t.size, align: POS.p7t.align, color: rgb(0.24,0.23,0.35), lineGap:4 },
        { maxLines: POS.p7t.maxLines, ellipsis: true }
      );
    }

    // Tips (top-2)
    const tipsList = Array.isArray(data?.tipsTop2) ? data.tipsTop2 : [];
    if (tipsList.length) {
      drawTextBox(
        page7,
        HelvB, 'Tips (top two)',
        { x: POS.p7tips.x, y: POS.p7tips.y, w: POS.p7tips.w, size: POS.p7tips.size, align: POS.p7tips.align, color: rgb(0.12,0.11,0.2), lineGap:3 },
        { maxLines: 1, ellipsis: true }
      );
      const body = '• ' + tipsList.slice(0,2).map(norm).join('\n• ');
      drawTextBox(
        page7,
        Helv,
        body,
        { x: POS.p7tips.x, y: POS.p7tips.y + POS.p7tips.size + 8, w: POS.p7tips.w, size: POS.p7tips.size, align: POS.p7tips.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
        { maxLines: POS.p7tips.maxLines, ellipsis: true }
      );
    }

    // Actions (top-2)
    const actsList = Array.isArray(data?.actionsTop2) ? data.actionsTop2 : [];
    if (actsList.length) {
      drawTextBox(
        page7,
        HelvB, 'Actions (top two)',
        { x: POS.p7acts.x, y: POS.p7acts.y, w: POS.p7acts.w, size: POS.p7acts.size, align: POS.p7acts.align, color: rgb(0.12,0.11,0.2), lineGap:3 },
        { maxLines: 1, ellipsis: true }
      );
      const body = '• ' + actsList.slice(0,2).map(norm).join('\n• ');
      drawTextBox(
        page7,
        Helv,
        body,
        { x: POS.p7acts.x, y: POS.p7acts.y + POS.p7acts.size + 8, w: POS.p7acts.w, size: POS.p7acts.size, align: POS.p7acts.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
        { maxLines: POS.p7acts.maxLines, ellipsis: true }
      );
    }

    // Save
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    const fileNameArg = url.searchParams.get('name') || 'ctrl_profile.pdf';
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${fileNameArg}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
