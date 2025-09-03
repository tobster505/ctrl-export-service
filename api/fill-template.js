export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ------------------------- small helpers ------------------------- */

const S = (v, fb = '') => (v == null ? String(fb) : String(v));
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
  // NEW: allow ?tpl=… override, default to V3
  const tplName = url?.searchParams?.get('tpl') || 'CTRL_Perspective_Assessment_Profile_templateV3.pdf';
  const full = `${proto}://${host}/${tplName}`;
  const r = await fetch(full);
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
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const flow     = (url.searchParams.get('flow') || '').trim() || 'Perspective';

  // ---- Demo payload (test=1) ----
  let data;
  if (isTest) {
    data = {
      person:   { coverName: 'Avery Example', fullName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },
      stateWord: 'Regulated',
      dominantParagraph: 'You connect the most with Mika - measured, fair, steady under pressure.',
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
      // Page-6 text sources
      chartParagraph: 'A clear Regulated centre runs through your responses. You prefer steadiness, balance and reflection before you act. You take time to consider what is happening, which helps you respond fairly and with proportion. …',
      page6Blocks: [
        { title:'How the pattern moved', body:'(will be replaced by chartParagraph in code)' },
        { title:'Range & gaps', body:'You touched Triggered and Regulated most; Concealed and Lead were less visible this time.' },
      ],
      page6ThemeNarrative: 'Emotion regulation with Feedback handling and Awareness of impact shaped how you responded.',
      flowLabel: flow
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
    data.flowLabel = data.flowLabel || flow;
  }

  /* ---- COORDS ---- */
  const POS = {
    // PAGE 1 header items
    f1: { x:290, y:170, w:400, size:40, align:'left' },   // Full name
    n1: { x:10,  y:573, w:500, size:30, align:'center' }, // Path name
    d1: { x:130, y:630, w:500, size:20, align:'left' },   // Date (DD/MMM/YYYY)

    // Footer-ish title line (name/path) on pages 2..8
    f2: { x:200, y:64, w:400, size:13, align:'left' },
    n2: { x:250, y:64, w:400, size:12, align:'center' },
    f3: { x:200, y:64, w:400, size:13, align:'left' },
    n3: { x:250, y:64, w:400, size:12, align:'center' },
    f4: { x:200, y:64, w:400, size:13, align:'left' },
    n4: { x:250, y:64, w:400, size:12, align:'center' },
    f5: { x:200, y:64, w:400, size:13, align:'left' },
    n5: { x:250, y:64, w:400, size:12, align:'center' },
    f6: { x:200, y:64, w:400, size:13, align:'left' },
    n6: { x:250, y:64, w:400, size:12, align:'center' },
    f7: { x:200, y:64, w:400, size:13, align:'left' },
    n7: { x:250, y:64, w:400, size:12, align:'center' },
    f8: { x:200, y:64, w:400, size:13, align:'left' },
    n8: { x:250, y:64, w:400, size:12, align:'center' },

    // PAGE 6 specific
    dom6:     { x:55,  y:280, w:900, size:33, align:'left' },  // Dominant state word
    dom6desc: { x:40,  y:380, w:250, size:15, align:'left', max:8 }, // Character blurb
    // how6 REMOVED (no longer drawn)
    chart6:   { x:203, y:230, w:420, h:220 },             // Spider chart

    // Page 6 left blocks (“How this shows up is…”) — we keep two blocks
    p6p: { x:120, y:520, w:1260, hSize:14, bSize:20, align:'left', titleGap:6, blockGap:20, maxBodyLines:6 },
    // Page 6 right narrative (themes)
    p6t: { x:1280, y:620, w:630, size:30, lineGap:4, align:'left', maxLines:14 },
  };

  // Allow URL tuning for everything above
  const apply = (base, prefix) => ({
    ...base,
    x: qnum(url, `${prefix}x`, base.x),
    y: qnum(url, `${prefix}y`, base.y),
    w: qnum(url, `${prefix}w`, base.w),
    size: qnum(url, `${prefix}s`, base.size),
    align: qstr(url, `${prefix}align`, base.align),
  });
  const applyBlock = (base, prefix) => ({
    ...base,
    x: qnum(url, `${prefix}x`, base.x),
    y: qnum(url, `${prefix}y`, base.y),
    w: qnum(url, `${prefix}w`, base.w),
    hSize: qnum(url, `${prefix}hsize`, base.hSize),
    bSize: qnum(url, `${prefix}bsize`, base.bSize),
    align: qstr(url, `${prefix}align`, base.align),
    titleGap: qnum(url, `${prefix}titlegap`, base.titleGap),
    blockGap: qnum(url, `${prefix}blockgap`, base.blockGap),
    maxBodyLines: qnum(url, `${prefix}max`, base.maxBodyLines),
  });
  const applyChart = (base, prefix) => ({
    ...base,
    x: qnum(url, `${prefix}x`, base.x),
    y: qnum(url, `${prefix}y`, base.y),
    w: qnum(url, `${prefix}w`, base.w),
    h: qnum(url, `${prefix}h`, base.h),
  });

  POS.f1 = apply(POS.f1,'f1'); POS.n1 = apply(POS.n1,'n1'); POS.d1 = apply(POS.d1,'d1');
  for (let i=2;i<=8;i++){ POS[`f${i}`]=apply(POS[`f${i}`],`f${i}`); POS[`n${i}`]=apply(POS[`n${i}`],`n${i}`); }
  POS.dom6 = apply(POS.dom6,'dom6');
  POS.dom6desc = {
    ...POS.dom6desc,
    x: qnum(url,'dom6descx', POS.dom6desc.x),
    y: qnum(url,'dom6descy', POS.dom6desc.y),
    w: qnum(url,'dom6descw', POS.dom6desc.w),
    size: qnum(url,'dom6descs', POS.dom6desc.size),
    align: qstr(url,'dom6descalign', POS.dom6desc.align),
    max: qnum(url,'dom6descmax', POS.dom6desc.max),
  };
  POS.chart6 = applyChart(POS.chart6,'c6');
  POS.p6p = applyBlock(POS.p6p,'p6p');
  POS.p6t = {
    ...POS.p6t,
    x: qnum(url,'p6tx',POS.p6t.x), y: qnum(url,'p6ty',POS.p6t.y), w: qnum(url,'p6tw',POS.p6t.w),
    size: qnum(url,'p6ts',POS.p6t.size), align: qstr(url,'p6talign',POS.p6t.align),
    maxLines: qnum(url,'p6tmax',POS.p6t.maxLines), lineGap: POS.p6t.lineGap
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok:true, pos:POS, data, urlParams:Object.fromEntries(url.searchParams.entries()) }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);

    // Pages (template expected ≥ 8)
    const pages = pdf.getPages(); // 0-based
    const page1 = pages[0];
    const page2 = pages[1];
    const page3 = pages[2];
    const page4 = pages[3];
    const page5 = pages[4];
    const page6 = pages[5];
    const page7 = pages[6];
    const page8 = pages[7];

    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const fullName = norm(data?.person?.fullName || data?.fullName || pickCoverName(data, url) || '');
    const coverName = pickCoverName(data, url);
    const pathName = norm(data?.flowLabel || 'Perspective');
    const today = new Date();
    const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][today.getMonth()];
    const dateLbl = `${String(today.getDate()).padStart(2,"0")}/${MMM}/${today.getFullYear()}`;

    /* ---------------- Page 1 ---------------- */
    if (pathName) drawTextBox(page1, HelvB, pathName, POS.n1, { maxLines: 1, ellipsis: true });
    if (fullName) drawTextBox(page1, HelvB, fullName, POS.f1, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, Helv, dateLbl, POS.d1, { maxLines: 1, ellipsis: true });

    /* ---------------- Footer name/path on 2..8 ---------------- */
    const drawNP = (pg, fpos, npos) => {
      if (fullName) drawTextBox(pg, Helv, fullName, fpos, { maxLines:1, ellipsis:true });
      if (pathName) drawTextBox(pg, Helv, pathName, npos, { maxLines:1, ellipsis:true });
    };
    drawNP(page2, POS.f2, POS.n2); drawNP(page3, POS.f3, POS.n3); drawNP(page4, POS.f4, POS.n4);
    drawNP(page5, POS.f5, POS.n5); drawNP(page6, POS.f6, POS.n6); drawNP(page7, POS.f7, POS.n7); drawNP(page8, POS.f8, POS.n8);

    /* ---------------- Page 6 ---------------- */

    // Dominant state word
    if (data.stateWord) drawTextBox(page6, HelvB, norm(data.stateWord), POS.dom6, { maxLines: 1, ellipsis: true });

    // Character blurb (dominant description) — left card
    const domDesc = norm(data.dominantParagraph || '');
    if (domDesc) drawTextBox(
      page6, Helv, domDesc,
      { x: POS.dom6desc.x, y: POS.dom6desc.y, w: POS.dom6desc.w, size: POS.dom6desc.size, align: POS.dom6desc.align, color: rgb(0.24,0.23,0.35) },
      { maxLines: POS.dom6desc.max, ellipsis: true }
    );

    // Chart image
    if (data.chartUrl) {
      try {
        const r = await fetch(S(data.chartUrl,''));
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart6;
          const ph = page6.getHeight();
          page6.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore chart errors */ }
    }

    // “How this shows up is…” LEFT two blocks
    const blocks = Array.isArray(data.page6Blocks) ? data.page6Blocks.slice(0, 2) : [];
    // Force Block 1 body to the chart paragraph (new rule)
    const chartPara = norm(data.chartParagraph || '');
    if (blocks[0]) blocks[0].body = chartPara || blocks[0].body;
    else if (chartPara) blocks.push({ title:'How the pattern moved', body: chartPara });

    let curY = POS.p6p.y;
    for (const b of blocks) {
      const title = norm(b?.title || '');
      const body  = norm(b?.body || '');
      if (title) {
        drawTextBox(page6, HelvB, title,
          { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.hSize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: 1, ellipsis: true }
        );
        curY += (POS.p6p.hSize + 3) + POS.p6p.titleGap;
      }
      if (body) {
        const r = drawTextBox(page6, Helv, body,
          { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.bSize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: POS.p6p.maxBodyLines, ellipsis: true }
        );
        curY += r.height + POS.p6p.blockGap;
      }
    }

    // RIGHT paragraph (themes narrative on page 6)
    const themeNarr = norm(data.page6ThemeNarrative || data.themeNarrative || '');
    if (themeNarr) {
      drawTextBox(
        page6, Helv, themeNarr,
        { x: POS.p6t.x, y: POS.p6t.y, w: POS.p6t.w, size: POS.p6t.size, align: POS.p6t.align, color: rgb(0.24,0.23,0.35), lineGap: POS.p6t.lineGap },
        { maxLines: POS.p6t.maxLines, ellipsis: true }
      );
    }

    // Save
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    const outName = url.searchParams.get('name') || 'ctrl_profile.pdf';
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${outName}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
