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

const N = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const A = (s) => {
  const v = (s || '').toLowerCase().trim();
  return v === 'centre' ? 'center' : (v === 'right' ? 'right' : 'center' === v ? 'center' : (v === 'left' ? 'left' : 'left'));
};

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

  // allow override via ?tpl=
  const tpl = url?.searchParams?.get('tpl') || 'CTRL_Perspective_Assessment_Profile_templateV3.pdf';
  const full = `${proto}://${host}/${tpl}`;
  const r = await fetch(full);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// query helpers
function qnum(url, key, fb) { return N(url.searchParams.get(key), fb); }
function qstr(url, key, fb) { const v = url.searchParams.get(key); return v == null || v === '' ? fb : v; }

// Robustly choose a cover name
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

  const isTest   = url.searchParams.get('test') === '1';
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';

  // ---- Demo payloads for test mode ----
  let data;
  if (isTest) {
    const flow = qstr(url, 'flow', 'Perspective');
    data = {
      flow,
      person:   { coverName: 'Avery Example', fullName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },
      coverName:'Avery Example',
      // Page 6 content (snapshot)
      stateWord: 'Regulated',
      dominantParagraph: 'You connect the most with Mika — measured, fair, steady under pressure.',
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
      page6Patterns: [
        { title:'How the pattern moved', body:'Mixed steps with a steady finish — small habits held the line.' },
        { title:'Range & gaps', body:'You touched Triggered and Regulated most; Concealed and Lead were quiet here.' },
      ],
      themeNarrative: 'Emotion regulation with feedback handling and awareness of impact together point to clear intent and cleaner repair when needed.',
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

  /* ---------------- LOCKED DEFAULTS (your coordinates) ---------------- */

  const POS = {
    // Page 1 — header chips
    f1: { x: 290, y: 170, w: 400, size: 40, align: 'left'  },   // PathName
    n1: { x: 10,  y: 573, w: 500, size: 30, align: 'center'},   // FullName
    d1: { x: 130, y: 630, w: 500, size: 20, align: 'left'  },   // Date (DD/MMM/YYYY)

    // Pages 2..8 — PathName (f*) and FullName (n*)
    f2: { x: 200, y: 64, w: 400, size: 13, align: 'left'   },
    n2: { x: 250, y: 64, w: 400, size: 12, align: 'center' },

    f3: { x: 200, y: 64, w: 400, size: 13, align: 'left'   },
    n3: { x: 250, y: 64, w: 400, size: 12, align: 'center' },

    f4: { x: 200, y: 64, w: 400, size: 13, align: 'left'   },
    n4: { x: 250, y: 64, w: 400, size: 12, align: 'center' },

    f5: { x: 200, y: 64, w: 400, size: 13, align: 'left'   },
    n5: { x: 250, y: 64, w: 400, size: 12, align: 'center' },

    f6: { x: 200, y: 64, w: 400, size: 13, align: 'left'   },
    n6: { x: 250, y: 64, w: 400, size: 12, align: 'center' },

    f7: { x: 200, y: 64, w: 400, size: 13, align: 'left'   },
    n7: { x: 250, y: 64, w: 400, size: 12, align: 'center' },

    f8: { x: 200, y: 64, w: 400, size: 13, align: 'left'   },
    n8: { x: 250, y: 64, w: 400, size: 12, align: 'center' },

    // Page 6 — snapshot (dominant, desc, how, chart)
    dom6:     { x: 55,  y: 280, w: 900, size: 33, align: 'left' },
    dom6desc: { x: 40,  y: 380, w: 250, size: 15, align: 'left', maxLines: 8 },
    how6:     { x: 420, y: 360, w: 300, size: 22, align: 'left', maxLines: 4 },
    chart6:   { x: 203, y: 230, w: 420, h: 220 },

    // Page 6 — left patterns (2 blocks) + right themes paragraph
    p6p: { x: 120, y: 520, w: 1260, hSize: 14, bSize: 20, align: 'left', titleGap: 6, blockGap: 20, maxBodyLines: 6 },
    p6t: { x: 1280, y: 620, w: 630,  size: 30, align: 'left', maxLines: 14 },
  };

  /* ---------------- tuners (URL can override any of the above) ---------------- */

  function tuneHeader(idx) {
    const keyf = `f${idx}`, keyn = `n${idx}`;
    POS[keyf] = {
      ...POS[keyf],
      x: qnum(url, `${keyf}x`, POS[keyf].x),
      y: qnum(url, `${keyf}y`, POS[keyf].y),
      w: qnum(url, `${keyf}w`, POS[keyf].w),
      size: qnum(url, `${keyf}s`, POS[keyf].size),
      align: A(qstr(url, `${keyf}align`, POS[keyf].align)),
    };
    POS[keyn] = {
      ...POS[keyn],
      x: qnum(url, `${keyn}x`, POS[keyn].x),
      y: qnum(url, `${keyn}y`, POS[keyn].y),
      w: qnum(url, `${keyn}w`, POS[keyn].w),
      size: qnum(url, `${keyn}s`, POS[keyn].size),
      align: A(qstr(url, `${keyn}align`, POS[keyn].align)),
    };
  }

  // Page 1 date
  POS.d1 = {
    ...POS.d1,
    x: qnum(url, 'd1x', POS.d1.x),
    y: qnum(url, 'd1y', POS.d1.y),
    w: qnum(url, 'd1w', POS.d1.w),
    size: qnum(url, 'd1s', POS.d1.size),
    align: A(qstr(url, 'd1align', POS.d1.align)),
  };

  // Apply tuners for headers across pages 1..8
  for (let i = 1; i <= 8; i++) tuneHeader(i);

  // Page 6 tuners
  POS.dom6 =     { ...POS.dom6,
    x: qnum(url, 'dom6x', POS.dom6.x), y: qnum(url, 'dom6y', POS.dom6.y),
    w: qnum(url, 'dom6w', POS.dom6.w), size: qnum(url, 'dom6s', POS.dom6.size),
    align: A(qstr(url, 'dom6align', POS.dom6.align))
  };
  POS.dom6desc = { ...POS.dom6desc,
    x: qnum(url, 'dom6descx', POS.dom6desc.x), y: qnum(url, 'dom6descy', POS.dom6desc.y),
    w: qnum(url, 'dom6descw', POS.dom6desc.w), size: qnum(url, 'dom6descs', POS.dom6desc.size),
    align: A(qstr(url, 'dom6descalign', POS.dom6desc.align)), maxLines: qnum(url, 'dom6descmax', POS.dom6desc.maxLines)
  };
  POS.how6 =     { ...POS.how6,
    x: qnum(url, 'how6x', POS.how6.x), y: qnum(url, 'how6y', POS.how6.y),
    w: qnum(url, 'how6w', POS.how6.w), size: qnum(url, 'how6s', POS.how6.size),
    align: A(qstr(url, 'how6align', POS.how6.align)), maxLines: qnum(url, 'how6max', POS.how6.maxLines)
  };
  POS.chart6 =   { ...POS.chart6,
    x: qnum(url, 'c6x', POS.chart6.x), y: qnum(url, 'c6y', POS.chart6.y),
    w: qnum(url, 'c6w', POS.chart6.w), h: qnum(url, 'c6h', POS.chart6.h)
  };

  POS.p6p = { ...POS.p6p,
    x: qnum(url, 'p6px', POS.p6p.x), y: qnum(url, 'p6py', POS.p6p.y), w: qnum(url, 'p6pw', POS.p6p.w),
    hSize: qnum(url, 'p6phsize', POS.p6p.hSize), bSize: qnum(url, 'p6pbsize', POS.p6p.bSize),
    align: A(qstr(url, 'p6palign', POS.p6p.align)), titleGap: qnum(url, 'p6ptitlegap', POS.p6p.titleGap),
    blockGap: qnum(url, 'p6pblockgap', POS.p6p.blockGap), maxBodyLines: qnum(url, 'p6pmax', POS.p6p.maxBodyLines)
  };
  POS.p6t = { ...POS.p6t,
    x: qnum(url, 'p6tx', POS.p6t.x), y: qnum(url, 'p6ty', POS.p6t.y), w: qnum(url, 'p6tw', POS.p6t.w),
    size: qnum(url, 'p6ts', POS.p6t.size), align: A(qstr(url, 'p6talign', POS.p6t.align)),
    maxLines: qnum(url, 'p6tmax', POS.p6t.maxLines)
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok:true, pos:POS, urlParams:Object.fromEntries(url.searchParams.entries()), data }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageCount = pdf.getPageCount();

    // helper to draw a small header line pair (PathName + FullName)
    function drawHeader(pageIndex, flowText, fullNameText) {
      if (pageIndex < 0 || pageIndex >= pageCount) return;
      const page = pdf.getPage(pageIndex);
      const fKey = `f${pageIndex+1}`, nKey = `n${pageIndex+1}`;
      const fPos = POS[fKey], nPos = POS[nKey];
      if (fPos) drawTextBox(page, HelvB, norm(flowText), fPos, { maxLines: 1, ellipsis: true });
      if (nPos) drawTextBox(page, Helv,   norm(fullNameText), nPos, { maxLines: 1, ellipsis: true });
    }

    // identity
    const flowLabel = norm(data.flow || 'Perspective');
    const coverName = pickCoverName(data, url);
    const fullName  = norm((data.person && data.person.fullName) || coverName || '');

    // Page 1 header + date
    if (pageCount >= 1) {
      const page1 = pdf.getPage(0);
      drawHeader(0, flowLabel, fullName);

      // date label (DD/MMM/YYYY)
      const dt = new Date();
      const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][dt.getUTCMonth()];
      const dd  = String(dt.getUTCDate()).padStart(2,'0');
      const yyyy= dt.getUTCFullYear();
      const dateLbl = `${dd}/${MMM}/${yyyy}`;
      drawTextBox(page1, Helv, dateLbl, POS.d1, { maxLines: 1, ellipsis: true });
    }

    // Pages 2..8 header lines
    for (let i = 1; i < Math.min(8, pageCount); i++) drawHeader(i, flowLabel, fullName);

    /* ---------------- Page 6: Snapshot ---------------- */
    // Note: PDF pages are 0-indexed; Page 6 => index 5
    if (pageCount >= 6) {
      const p6 = pdf.getPage(5);

      // Dominant word (large)
      if (data.stateWord) {
        drawTextBox(p6, HelvB, norm(data.stateWord), POS.dom6, { maxLines: 1, ellipsis: true });
      }

      // Dominant description (left column)
      if (data.dominantParagraph) {
        drawTextBox(
          p6, Helv, norm(data.dominantParagraph),
          { x: POS.dom6desc.x, y: POS.dom6desc.y, w: POS.dom6desc.w, size: POS.dom6desc.size, align: POS.dom6desc.align, color: rgb(0.24,0.23,0.35) },
          { maxLines: POS.dom6desc.maxLines, ellipsis: true }
        );
      }

      // How (right of desc)
      if (data.how) {
        drawTextBox(
          p6, Helv, norm(data.how),
          { x: POS.how6.x, y: POS.how6.y, w: POS.how6.w, size: POS.how6.size, align: POS.how6.align, color: rgb(0.24,0.23,0.35) },
          { maxLines: POS.how6.maxLines, ellipsis: true }
        );
      }

      // Chart
      if (data.chartUrl) {
        try {
          const r = await fetch(S(data.chartUrl,''));
          if (r.ok) {
            const png = await pdf.embedPng(await r.arrayBuffer());
            const ph = p6.getHeight();
            const { x, y, w, h } = POS.chart6;
            p6.drawImage(png, { x, y: ph - y - h, width: w, height: h });
          }
        } catch { /* ignore chart errors */ }
      }

      // Patterns (left) – exactly two blocks
      const blocks = Array.isArray(data.page6Patterns) && data.page6Patterns.length
        ? data.page6Patterns
        : (Array.isArray(data.page2Patterns) ? data.page2Patterns : []);
      const two = blocks
        .map(b => ({ title: norm(b?.title||''), body: norm(b?.body||'') }))
        .filter(b => b.title || b.body)
        .slice(0, 2);

      let curY = POS.p6p.y;
      for (const b of two) {
        if (b.title) {
          drawTextBox(
            p6, HelvB, b.title,
            { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.hSize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap: 3 },
            { maxLines: 1, ellipsis: true }
          );
          curY += (POS.p6p.hSize + 3) + POS.p6p.titleGap;
        }
        if (b.body) {
          const r = drawTextBox(
            p6, Helv, b.body,
            { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.bSize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap: 3 },
            { maxLines: POS.p6p.maxBodyLines, ellipsis: true }
          );
          curY += r.height + POS.p6p.blockGap;
        }
      }

      // Themes paragraph (right)
      let themeNarr = '';
      if (typeof data.themeNarrative === 'string' && data.themeNarrative.trim()) {
        themeNarr = norm(data.themeNarrative.trim());
      }
      if (themeNarr) {
        drawTextBox(
          p6, Helv, themeNarr,
          { x: POS.p6t.x, y: POS.p6t.y, w: POS.p6t.w, size: POS.p6t.size, align: POS.p6t.align, color: rgb(0.24,0.23,0.35), lineGap: 4 },
          { maxLines: POS.p6t.maxLines, ellipsis: true }
        );
      }
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
