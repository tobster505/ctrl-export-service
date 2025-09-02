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

const alignFix = a => {
  const v = (a || '').toLowerCase().trim();
  return v === 'centre' ? 'center' : (v === 'left' || v === 'right' || v === 'center' ? v : 'left');
};

// Wrap/align text into a box (y = distance from top, not bottom)
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  if (!page || !text) return { height: 0, linesDrawn: 0, lastY: 0 };
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
    wrapped.push(t);
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

function formatDateLbl(d) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam',
      day: '2-digit', month: 'short', year: 'numeric'
    }).formatToParts(d);
    const dd = parts.find(p => p.type === 'day')?.value || '01';
    const mmm = (parts.find(p => p.type === 'month')?.value || 'Jan').toUpperCase();
    const yyyy = parts.find(p => p.type === 'year')?.value || '1970';
    return `${dd}/${mmm}/${yyyy}`;
  } catch {
    const dd = String(d.getUTCDate()).padStart(2,'0');
    const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()];
    const yyyy = d.getUTCFullYear();
    return `${dd}/${MMM}/${yyyy}`;
  }
}

async function fetchTemplate(req) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');
  const url   = `${proto}://${host}/CTRL_Perspective_Assessment_Profile_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Tuners: missing params fall back to defaults (not zero)
function qnum(url, key, fb) { const s = url.searchParams.get(key); if (s === null || s === '') return fb; const n = Number(s); return Number.isFinite(n) ? n : fb; }
function qstr(url, key, fb) { const v = url.searchParams.get(key); return v == null || v === '' ? fb : v; }

// Pickers
const pickFullName = (data, url) => norm(
  data?.person?.fullName ??
  data?.fullName ??
  data?.summary?.user?.fullName ??
  qstr(url, 'full', '') // optional override for quick tests
);

const pickCoverName = (data, url) => norm(
  data?.person?.coverName ??
  data?.coverName ??
  data?.summary?.user?.reportCoverName ??
  pickFullName(data, url)
);

function pickFlowLabel(data, url) {
  const raw = (
    data?.flowLabel ?? data?.PathName ?? data?.summary?.flow?.label ??
    qstr(url, 'flow', 'Perspective')
  ).toString().toLowerCase();
  const map = { perspective:'Perspective', observe:'Observe', reflective:'Reflective', mirrored:'Observe', mirror:'Observe', reflection:'Reflective' };
  return map[raw] || 'Perspective';
}

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

  // ---- Demo payload ----
  let data;
  if (isTest) {
    data = {
      stateWord: 'Regulated',
      how: 'Steady presence; keep clarity alive.',
      tip1: 'Take one breath and name it: “I am on edge.”',
      tip2: 'Insert a 10-second check-in before the next step.',
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
        options:{ plugins:{ legend:{ display:false } }, scales:{ r:{ min:0,max:5, ticks:{ display:true, stepSize:1, backdropColor:'rgba(0,0,0,0)' }, grid:{ circular:true }, angleLines:{ display:true }, pointLabels:{ color:'#4A4458', font:{ size:12 } } } } }
      })),
      page2Patterns: [
        { title:'How the pattern moved', body:'Stable core with a moderate spread; improvements held across the middle of the sequence.' },
        { title:'Range & gaps',          body:'You touched 2 states here; Lead and Concealed were not present in this short run.' },
      ],
      themeNarrative: 'What stood out was Emotion regulation with Feedback handling and Awareness of impact — together this points to calm intent and cleaner progress.',
      person:   { fullName: 'Avery Example', coverName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },
      dominantParagraph: 'You connect the most with Mika, which looks like staying grounded and adapting in the moment — measured, fair, and steady under pressure.'
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

  /* -------------------- POS defaults (with your locked coords) -------------------- */
  const POS = {
    // Page 1 — Path/Flow label (locked)
    n1: { x: -10, y: 570, w: 600, size: 32, align: 'center', color: rgb(0.12,0.11,0.2) },
    // Page 1 — Full name (locked)
    f1: { x: 285, y: 165, w: 400, size: 40, align: 'left', color: rgb(0.12,0.11,0.2) },
    // Page 1 — Date
    d1: { x: 120, y: 630, w: 500, size: 25, align: 'left', color: rgb(0.12,0.11,0.2) },

    // Page 2 header (locked)
    f2: { x: 200, y: 64, w: 400, size: 13, align: 'left', color: rgb(0.12,0.11,0.2) },    // full name
    n2: { x:  25, y: 64, w: 800, size: 12, align: 'center', color: rgb(0.12,0.11,0.2) },  // flow label

    // Pages 3..8 headers (defaults; can be overridden)
    f3: { x: 200, y: 64, w: 400, size: 13, align: 'left',   color: rgb(0.12,0.11,0.2) },
    n3: { x:  25, y: 64, w: 800, size: 12, align: 'center', color: rgb(0.12,0.11,0.2) },

    f4: { x: 200, y: 64, w: 400, size: 13, align: 'left',   color: rgb(0.12,0.11,0.2) },
    n4: { x:  25, y: 64, w: 800, size: 12, align: 'center', color: rgb(0.12,0.11,0.2) },

    f5: { x: 200, y: 64, w: 400, size: 13, align: 'left',   color: rgb(0.12,0.11,0.2) },
    n5: { x:  25, y: 64, w: 800, size: 12, align: 'center', color: rgb(0.12,0.11,0.2) },

    f6: { x: 200, y: 64, w: 400, size: 13, align: 'left',   color: rgb(0.12,0.11,0.2) },
    n6: { x:  25, y: 64, w: 800, size: 12, align: 'center', color: rgb(0.12,0.11,0.2) },

    f7: { x: 200, y: 64, w: 400, size: 13, align: 'left',   color: rgb(0.12,0.11,0.2) },
    n7: { x:  25, y: 64, w: 800, size: 12, align: 'center', color: rgb(0.12,0.11,0.2) },

    f8: { x: 200, y: 64, w: 400, size: 13, align: 'left',   color: rgb(0.12,0.11,0.2) },
    n8: { x:  25, y: 64, w: 800, size: 12, align: 'center', color: rgb(0.12,0.11,0.2) },

    // Page 5 — Dominant state & description & how
    dom5:     { x: 120, y: 250, w: 900, size: 36, align: 'left',  color: rgb(0.12,0.11,0.2) },
    dom5desc: { x: 120, y: 300, w: 900, size: 22, align: 'left',  color: rgb(0.24,0.23,0.35), max: 6 },
    how5:     { x: 120, y: 360, w: 900, size: 22, align: 'left',  color: rgb(0.24,0.23,0.35), max: 4 },

    // Page 5 — Chart
    c5: { x: 1100, y: 300, w: 650, h: 420 },

    // Page 5 — Patterns (left column — moved here from P2)
    p2p: { x: 120, y: 520, w: 1260, hSize: 14, bSize: 20, align: 'left', titleGap: 6, blockGap: 20, maxBodyLines: 6 },

    // Page 5 — Themes narrative (right column — moved here from P2)
    p2t: { x: 1280, y: 620, w: 630, size: 30, align: 'left', color: rgb(0.24,0.23,0.35), lineGap: 4, maxLines: 14 },
  };

  // URL tuners for all exposed fields
  // Page 1
  POS.f1 = { ...POS.f1, x:qnum(url,'f1x',POS.f1.x), y:qnum(url,'f1y',POS.f1.y), w:qnum(url,'f1w',POS.f1.w), size:qnum(url,'f1s',POS.f1.size), align:alignFix(qstr(url,'f1align',POS.f1.align)) };
  POS.n1 = { ...POS.n1, x:qnum(url,'n1x',POS.n1.x), y:qnum(url,'n1y',POS.n1.y), w:qnum(url,'n1w',POS.n1.w), size:qnum(url,'n1s',POS.n1.size), align:alignFix(qstr(url,'n1align',POS.n1.align)) };
  POS.d1 = { ...POS.d1, x:qnum(url,'d1x',POS.d1.x), y:qnum(url,'d1y',POS.d1.y), w:qnum(url,'d1w',POS.d1.w), size:qnum(url,'d1s',POS.d1.size), align:alignFix(qstr(url,'d1align',POS.d1.align)) };

  // Page 2
  POS.f2 = { ...POS.f2, x:qnum(url,'f2x',POS.f2.x), y:qnum(url,'f2y',POS.f2.y), w:qnum(url,'f2w',POS.f2.w), size:qnum(url,'f2s',POS.f2.size), align:alignFix(qstr(url,'f2align',POS.f2.align)) };
  POS.n2 = { ...POS.n2, x:qnum(url,'n2x',POS.n2.x), y:qnum(url,'n2y',POS.n2.y), w:qnum(url,'n2w',POS.n2.w), size:qnum(url,'n2s',POS.n2.size), align:alignFix(qstr(url,'n2align',POS.n2.align)) };

  // Pages 3..8 headers
  for (let p = 3; p <= 8; p++) {
    const fk = `f${p}`, nk = `n${p}`;
    POS[fk] = { ...POS[fk], x:qnum(url,`${fk}x`,POS[fk].x), y:qnum(url,`${fk}y`,POS[fk].y), w:qnum(url,`${fk}w`,POS[fk].w), size:qnum(url,`${fk}s`,POS[fk].size), align:alignFix(qstr(url,`${fk}align`,POS[fk].align)) };
    POS[nk] = { ...POS[nk], x:qnum(url,`${nk}x`,POS[nk].x), y:qnum(url,`${nk}y`,POS[nk].y), w:qnum(url,`${nk}w`,POS[nk].w), size:qnum(url,`${nk}s`,POS[nk].size), align:alignFix(qstr(url,`${nk}align`,POS[nk].align)) };
  }

  // Page 5 content tuners
  POS.dom5     = { ...POS.dom5,     x:qnum(url,'dom5x',POS.dom5.x), y:qnum(url,'dom5y',POS.dom5.y), w:qnum(url,'dom5w',POS.dom5.w), size:qnum(url,'dom5s',POS.dom5.size), align:alignFix(qstr(url,'dom5align',POS.dom5.align)) };
  POS.dom5desc = { ...POS.dom5desc, x:qnum(url,'dom5descx',POS.dom5desc.x), y:qnum(url,'dom5descy',POS.dom5desc.y), w:qnum(url,'dom5descw',POS.dom5desc.w), size:qnum(url,'dom5descs',POS.dom5desc.size), align:alignFix(qstr(url,'dom5descalign',POS.dom5desc.align)), max:qnum(url,'dom5descmax',POS.dom5desc.max) };
  POS.how5     = { ...POS.how5,     x:qnum(url,'how5x',POS.how5.x), y:qnum(url,'how5y',POS.how5.y), w:qnum(url,'how5w',POS.how5.w), size:qnum(url,'how5s',POS.how5.size), align:alignFix(qstr(url,'how5align',POS.how5.align)), max:qnum(url,'how5max',POS.how5.max) };
  POS.c5       = { ...POS.c5, x:qnum(url,'c5x',POS.c5.x), y:qnum(url,'c5y',POS.c5.y), w:qnum(url,'c5w',POS.c5.w), h:qnum(url,'c5h',POS.c5.h) };

  POS.p2p = {
    ...POS.p2p,
    x:qnum(url,'p2px',POS.p2p.x), y:qnum(url,'p2py',POS.p2p.y), w:qnum(url,'p2pw',POS.p2p.w),
    hSize:qnum(url,'p2phsize',POS.p2p.hSize), bSize:qnum(url,'p2pbsize',POS.p2p.bSize),
    align:alignFix(qstr(url,'p2palign',POS.p2p.align)),
    titleGap:qnum(url,'p2ptitlegap',POS.p2p.titleGap), blockGap:qnum(url,'p2pblockgap',POS.p2p.blockGap),
    maxBodyLines:qnum(url,'p2pmax',POS.p2p.maxBodyLines)
  };

  POS.p2t = {
    ...POS.p2t,
    x:qnum(url,'p2tx',POS.p2t.x), y:qnum(url,'p2ty',POS.p2t.y), w:qnum(url,'p2tw',POS.p2t.w),
    size:qnum(url,'p2ts',POS.p2t.size), align:alignFix(qstr(url,'p2talign',POS.p2t.align)),
    maxLines:qnum(url,'p2tmax',POS.p2t.maxLines)
  };

  if (debug) {
    // Return current positions + page count to help diagnose templates
    try {
      const tplBytes = await fetchTemplate(req);
      const tmpPdf = await PDFDocument.load(tplBytes);
      const numPages = tmpPdf.getPageCount();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        numPages,
        hint: 'Indexes are 0-based. If numPages=7, valid indexes are 0..6.',
        pos: POS,
        data,
        urlParams: Object.fromEntries(url.searchParams.entries())
      }, null, 2));
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok:false, error: String(e?.message || e), pos: POS }, null, 2));
    }
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req);
    const pdf = await PDFDocument.load(tplBytes);

    const pages = pdf.getPages();
    const numPages = pages.length;
    const P = (i) => (i >= 0 && i < numPages ? pages[i] : null);

    // Pages (guarded)
    const page1 = P(0);
    const page2 = P(1);
    const page3 = P(2);
    const page4 = P(3);
    const page5 = P(4);
    const page6 = P(5);
    const page7 = P(6);
    const page8 = P(7); // may be null if your template has only 7 pages

    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Common values
    const flowLabel = pickFlowLabel(data, url);
    const fullName  = pickFullName(data, url) || pickCoverName(data, url) || '';
    const dateLbl   = data?.summary?.flow?.dateLbl || formatDateLbl(new Date());

    /* ---------------- Page 1 ---------------- */
    if (page1) {
      if (flowLabel) drawTextBox(page1, HelvB, flowLabel, { ...POS.n1 });
      if (fullName)  drawTextBox(page1, HelvB, fullName, { ...POS.f1 }, { maxLines: 1, ellipsis: true });
      if (dateLbl)   drawTextBox(page1, Helv,  dateLbl,  { ...POS.d1 }, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 2 ---------------- */
    if (page2) {
      if (flowLabel) drawTextBox(page2, HelvB, flowLabel, { ...POS.n2 });
      if (fullName)  drawTextBox(page2, Helv,  fullName,  { ...POS.f2 }, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 3 ---------------- */
    if (page3) {
      if (flowLabel) drawTextBox(page3, HelvB, flowLabel, { ...POS.n3 });
      if (fullName)  drawTextBox(page3, Helv,  fullName,  { ...POS.f3 }, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 4 ---------------- */
    if (page4) {
      if (flowLabel) drawTextBox(page4, HelvB, flowLabel, { ...POS.n4 });
      if (fullName)  drawTextBox(page4, Helv,  fullName,  { ...POS.f4 }, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 5 ---------------- */
    if (page5) {
      if (flowLabel) drawTextBox(page5, HelvB, flowLabel, { ...POS.n5 });
      if (fullName)  drawTextBox(page5, Helv,  fullName,  { ...POS.f5 }, { maxLines: 1, ellipsis: true });

      // Dominant state label
      const domLabel = norm(data?.stateWord || '');
      if (domLabel) drawTextBox(page5, HelvB, domLabel, { ...POS.dom5 }, { maxLines: 1, ellipsis: true });

      // Dominant description
      const domDesc = norm(data?.dominantParagraph || '');
      if (domDesc) drawTextBox(page5, Helv, domDesc,
        { x: POS.dom5desc.x, y: POS.dom5desc.y, w: POS.dom5desc.w, size: POS.dom5desc.size, align: POS.dom5desc.align, color: POS.dom5desc.color },
        { maxLines: POS.dom5desc.max, ellipsis: true }
      );

      // “How this shows up”
      const howLine = norm(data?.how || '');
      if (howLine) drawTextBox(page5, Helv, howLine,
        { x: POS.how5.x, y: POS.how5.y, w: POS.how5.w, size: POS.how5.size, align: POS.how5.align, color: POS.how5.color },
        { maxLines: POS.how5.max, ellipsis: true }
      );

      // Chart on Page 5
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

      // Patterns (left column) — moved here from P2
      const rawBlocks = Array.isArray(data.page2Patterns)
        ? data.page2Patterns
        : Array.isArray(data.page2Blocks) ? data.page2Blocks : [];
      const twoBlocks = rawBlocks
        .map(b => ({ title: norm(b?.title||''), body: norm(b?.body||'') }))
        .filter(b => b.title || b.body)
        .slice(0, 2);
      let curY = POS.p2p.y;
      for (const b of twoBlocks) {
        if (b.title) {
          drawTextBox(
            page5, HelvB, b.title,
            { x: POS.p2p.x, y: curY, w: POS.p2p.w, size: POS.p2p.hSize, align: POS.p2p.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
            { maxLines: 1, ellipsis: true }
          );
          curY += (POS.p2p.hSize + 3) + POS.p2p.titleGap;
        }
        if (b.body) {
          const r = drawTextBox(
            page5, Helv,
            b.body,
            { x: POS.p2p.x, y: curY, w: POS.p2p.w, size: POS.p2p.bSize, align: POS.p2p.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
            { maxLines: POS.p2p.maxBodyLines, ellipsis: true }
          );
          curY += r.height + POS.p2p.blockGap;
        }
      }

      // Themes narrative (right)
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
          page5, Helv, themeNarr,
          { x: POS.p2t.x, y: POS.p2t.y, w: POS.p2t.w, size: POS.p2t.size, align: POS.p2t.align, color: POS.p2t.color, lineGap: POS.p2t.lineGap },
          { maxLines: POS.p2t.maxLines, ellipsis: true }
        );
      }
    }

    /* ---------------- Page 6 ---------------- */
    if (page6) {
      if (flowLabel) drawTextBox(page6, HelvB, flowLabel, { ...POS.n6 });
      if (fullName)  drawTextBox(page6, Helv,  fullName,  { ...POS.f6 }, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 7 ---------------- */
    if (page7) {
      if (flowLabel) drawTextBox(page7, HelvB, flowLabel, { ...POS.n7 });
      if (fullName)  drawTextBox(page7, Helv,  fullName,  { ...POS.f7 }, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 8 (optional) ---------------- */
    if (page8) {
      if (flowLabel) drawTextBox(page8, HelvB, flowLabel, { ...POS.n8 });
      if (fullName)  drawTextBox(page8, Helv,  fullName,  { ...POS.f8 }, { maxLines: 1, ellipsis: true });
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
