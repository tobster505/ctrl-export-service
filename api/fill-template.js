// api/fill-template.js
export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ------------------------- helpers ------------------------- */

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

function alignFix(v) {
  const a = String(v || '').toLowerCase();
  return a === 'centre' ? 'center' : (a || 'left');
}

// y = distance from TOP (we convert internally)
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
    const al = alignFix(align);
    if (al === 'center') xDraw = x + (w - widthOf(line)) / 2;
    else if (al === 'right') xDraw = x + (w - widthOf(line));
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
  const tpl   = url?.searchParams?.get('tpl') || 'CTRL_Perspective_Assessment_Profile_templateV3.pdf';
  const full  = `${proto}://${host}/${tpl}`;
  const r = await fetch(full);
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

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  // Safe URL parse
  let url;
  try { url = new URL(req?.url || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const isTest  = url.searchParams.get('test') === '1';
  const preview = url.searchParams.get('preview') === '1';
  const debug   = url.searchParams.get('debug') === '1';

  // ---- Demo payload (so you can tune coords quickly) ----
  let data;
  if (isTest) {
    data = {
      flow: qstr(url, 'flow', 'Perspective'),
      person: { fullName: 'Avery Example', coverName: 'Avery Example', preferredName: 'Avery' },
      coverName: 'Avery Example',
      stateWord: 'Regulated',
      how: 'You connect the most with Mika - measured, fair, steady under pressure.',
      chartUrl:
        'https://quickchart.io/chart?v=4&c=' +
        encodeURIComponent(JSON.stringify({
          type: 'radar',
          data: {
            labels: ['Concealed','Triggered','Regulated','Lead'],
            datasets:[{
              label:'Frequency', data:[0,2,3,0], fill:true,
              backgroundColor:'rgba(115,72,199,0.18)',
              borderColor:'#7348C7', borderWidth:2,
              pointRadius:[0,3,6,0], pointHoverRadius:[0,4,7,0]
            }]
          },
          options:{ plugins:{ legend:{ display:false } }, scales:{ r:{ min:0,max:5 } } }
        })),
      // Page 6 content (moved here)
      dominantLabel: 'Regulated',
      dominantDesc: 'You connect the most with Mika — measured, fair and steady under pressure.',
      page6Patterns: [
        { title: 'How the pattern moved', body: 'A clear Regulated centre runs through your responses. You prefer steadiness, balance and reflection before you act.' },
        { title: 'Range & gaps', body: 'You touched Triggered and Regulated most; Concealed and Lead were less visible this time.' }
      ],
      themeNarrative: 'Emotion regulation with Feedback handling and Awareness of impact shaped how you responded.',
      dateLbl: null // allow server to render date if needed elsewhere
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

  const flowLabel = norm(data?.flow || 'Perspective');
  const fullName  = norm(data?.person?.fullName || data?.fullName || pickCoverName(data, url) || '');
  const coverName = pickCoverName(data, url);

  /* ---------- DEFAULT COORDS (locked to your values) ---------- */
  const POS = {
    // Page 1 top trio
    f1: { x:290, y:170, w:400, s:40, align:'left' },
    n1: { x:10,  y:573, w:500, s:30, align:'center' },
    d1: { x:130, y:630, w:500, s:20, align:'left' },

    // Pages 2..8 flow+name bars
    f2: { x:200, y:64, w:400, s:13, align:'left' }, n2: { x:250, y:64, w:400, s:12, align:'center' },
    f3: { x:200, y:64, w:400, s:13, align:'left' }, n3: { x:250, y:64, w:400, s:12, align:'center' },
    f4: { x:200, y:64, w:400, s:13, align:'left' }, n4: { x:250, y:64, w:400, s:12, align:'center' },
    f5: { x:200, y:64, w:400, s:13, align:'left' }, n5: { x:250, y:64, w:400, s:12, align:'center' },
    f6: { x:200, y:64, w:400, s:13, align:'left' }, n6: { x:250, y:64, w:400, s:12, align:'center' },
    f7: { x:200, y:64, w:400, s:13, align:'left' }, n7: { x:250, y:64, w:400, s:12, align:'center' },
    f8: { x:200, y:64, w:400, s:13, align:'left' }, n8: { x:250, y:64, w:400, s:12, align:'center' },

    // Page 6 (snapshot)
    dom6:   { x:55,  y:280, w:900, s:33, align:'left' },      // Dominant label (e.g., Regulated)
    dom6d:  { x:40,  y:380, w:250, s:15, align:'left', max:8 }, // Character / description
    chart6: { x:203, y:230, w:420, h:220 },                   // Radar chart
    p6p:    { x:120, y:520, w:1260, hsize:14, bsize:20, align:'left', titleGap:6, blockGap:20, maxBody:6 }, // left blocks
    p6t:    { x:1280,y:620, w:630,  s:30,  align:'left', max:14 }, // right narrative
  };

  // Allow tuning via URL (kept simple)
  for (let i=1;i<=8;i++){
    ['f','n'].forEach(k=>{
      const base = POS[`${k}${i}`];
      POS[`${k}${i}`] = {
        x: qnum(url, `${k}${i}x`, base.x),
        y: qnum(url, `${k}${i}y`, base.y),
        w: qnum(url, `${k}${i}w`, base.w),
        s: qnum(url, `${k}${i}s`, base.s),
        align: qstr(url, `${k}${i}align`, base.align),
      };
    });
  }
  POS.d1 = {
    x: qnum(url,'d1x',POS.d1.x), y: qnum(url,'d1y',POS.d1.y),
    w: qnum(url,'d1w',POS.d1.w), s: qnum(url,'d1s',POS.d1.s),
    align: qstr(url,'d1align',POS.d1.align),
  };
  POS.dom6 = {
    x:qnum(url,'dom6x',POS.dom6.x), y:qnum(url,'dom6y',POS.dom6.y),
    w:qnum(url,'dom6w',POS.dom6.w), s:qnum(url,'dom6s',POS.dom6.s),
    align:qstr(url,'dom6align',POS.dom6.align),
  };
  POS.dom6d = {
    x:qnum(url,'dom6descx',POS.dom6d.x), y:qnum(url,'dom6descy',POS.dom6d.y),
    w:qnum(url,'dom6descw',POS.dom6d.w), s:qnum(url,'dom6descs',POS.dom6d.s),
    align:qstr(url,'dom6descalign',POS.dom6d.align),
    max:qnum(url,'dom6descmax',POS.dom6d.max),
  };
  POS.chart6 = {
    x:qnum(url,'c6x',POS.chart6.x), y:qnum(url,'c6y',POS.chart6.y),
    w:qnum(url,'c6w',POS.chart6.w), h:qnum(url,'c6h',POS.chart6.h),
  };
  POS.p6p = {
    x:qnum(url,'p6px',POS.p6p.x), y:qnum(url,'p6py',POS.p6p.y), w:qnum(url,'p6pw',POS.p6p.w),
    hsize:qnum(url,'p6phsize',POS.p6p.hsize), bsize:qnum(url,'p6pbsize',POS.p6p.bsize),
    align:qstr(url,'p6palign',POS.p6p.align), titleGap:qnum(url,'p6ptitlegap',POS.p6p.titleGap),
    blockGap:qnum(url,'p6pblockgap',POS.p6p.blockGap), maxBody:qnum(url,'p6pmax',POS.p6p.maxBody),
  };
  POS.p6t = {
    x:qnum(url,'p6tx',POS.p6t.x), y:qnum(url,'p6ty',POS.p6t.y), w:qnum(url,'p6tw',POS.p6t.w),
    s:qnum(url,'p6ts',POS.p6t.s), align:qstr(url,'p6talign',POS.p6t.align), max:qnum(url,'p6tmax',POS.p6t.max),
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok:true, pos:POS, data, url: Object.fromEntries(url.searchParams.entries()) }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageCount = pdf.getPageCount();
    const pages = Array.from({length: pageCount}, (_,i)=>pdf.getPage(i));

    // Helper to stamp FLOW then NAME (fixed order)
    const stampFlowAndName = (page, idx) => {
      const f = POS[`f${idx}`], n = POS[`n${idx}`];
      if (f) drawTextBox(page, HelvB, flowLabel, { x:f.x, y:f.y, w:f.w, size:f.s, align:f.align, color:rgb(0.12,0.11,0.2) }, { maxLines:1, ellipsis:true });
      if (n) drawTextBox(page, Helv,   fullName,  { x:n.x, y:n.y, w:n.w, size:n.s, align:n.align, color:rgb(0.12,0.11,0.2) }, { maxLines:1, ellipsis:true });
    };

    // ---------- Page 1 ----------
    if (pages[0]) {
      const p1 = pages[0];
      stampFlowAndName(p1, 1);
      // Date on page 1 if you want it shown
      const d = POS.d1;
      const dateLbl = norm(data?.dateLbl || '');
      if (dateLbl) drawTextBox(p1, Helv, dateLbl, { x:d.x, y:d.y, w:d.w, size:d.s, align:d.align, color:rgb(0.12,0.11,0.2) }, { maxLines:1, ellipsis:true });
    }

    // ---------- Pages 2..5 ----------
    for (let i=2;i<=5;i++){
      const page = pages[i-1];
      if (!page) continue;
      stampFlowAndName(page, i);
    }

    // ---------- Page 6 (snapshot) ----------
    if (pages[5]) {
      const p6 = pages[5];
      stampFlowAndName(p6, 6);

      // Dominant label
      const dom = norm(data?.dominantLabel || data?.stateWord || '');
      if (dom) drawTextBox(p6, HelvB, dom, { x:POS.dom6.x, y:POS.dom6.y, w:POS.dom6.w, size:POS.dom6.s, align:POS.dom6.align, color:rgb(0.12,0.11,0.2) }, { maxLines:1, ellipsis:true });

      // Character blurb (dominant description) — limited lines
      const domDesc = norm(data?.dominantDesc || data?.dominantCharacterBlurb || '');
      if (domDesc) drawTextBox(p6, Helv, domDesc, { x:POS.dom6d.x, y:POS.dom6d.y, w:POS.dom6d.w, size:POS.dom6d.s, align:POS.dom6d.align, color:rgb(0.24,0.23,0.35) }, { maxLines:POS.dom6d.max, ellipsis:true });

      // Radar chart
      const c = POS.chart6;
      const chartUrl = S(data?.chartUrl, '');
      if (chartUrl) {
        try {
          const r = await fetch(chartUrl);
          if (r.ok) {
            const png = await pdf.embedPng(await r.arrayBuffer());
            const ph = p6.getHeight();
            p6.drawImage(png, { x:c.x, y: ph - c.y - c.h, width: c.w, height: c.h });
          }
        } catch {/* ignore */}
      }

      // Left column: exactly two blocks from page6Patterns (fallback to page2Patterns)
      const rawBlocks = Array.isArray(data?.page6Patterns) && data.page6Patterns.length
        ? data.page6Patterns
        : (Array.isArray(data?.page2Patterns) ? data.page2Patterns : []);
      const blocks = rawBlocks
        .map(b => ({ title: norm(b?.title||''), body: norm(b?.body||'') }))
        .filter(b => b.title || b.body)
        .slice(0, 2);

      let curY = POS.p6p.y;
      for (const b of blocks) {
        if (b.title) {
          drawTextBox(
            p6, HelvB, b.title,
            { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.hsize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
            { maxLines: 1, ellipsis: true }
          );
          curY += (POS.p6p.hsize + 3) + POS.p6p.titleGap;
        }
        if (b.body) {
          const r = drawTextBox(
            p6, Helv, b.body,
            { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.bsize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
            { maxLines: POS.p6p.maxBody, ellipsis: true }
          );
          curY += r.height + POS.p6p.blockGap;
        }
      }

      // Right paragraph: themes narrative
      const tn = norm(
        (typeof data?.themeNarrative === 'string' ? data.themeNarrative : '') ||
        ''
      );
      if (tn) {
        drawTextBox(
          p6, Helv, tn,
          { x: POS.p6t.x, y: POS.p6t.y, w: POS.p6t.w, size: POS.p6t.s, align: POS.p6t.align, color: rgb(0.24,0.23,0.35), lineGap:4 },
          { maxLines: POS.p6t.max, ellipsis: true }
        );
      }
    }

    // ---------- Page 7 & 8 headers ----------
    if (pages[6]) stampFlowAndName(pages[6], 7);
    if (pages[7]) stampFlowAndName(pages[7], 8);

    // Save
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    const name = url.searchParams.get('name') || 'ctrl_profile.pdf';
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${name}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
