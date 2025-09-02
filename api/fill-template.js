// api/fill-template.js
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

const N = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const alignFix = (a, fb = 'left') => {
  const v = String(a || fb).toLowerCase();
  if (v === 'centre') return 'center';
  if (v === 'right' || v === 'center' || v === 'left') return v;
  return fb;
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
  if (!clean) return { height: 0, linesDrawn: 0, lastY: 0 };

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

// Read a coordinate set from the URL into a {x,y,w,size,align} spec
function readSpec(url, prefix, defaults) {
  const g = (k, fb) => url.searchParams.get(`${prefix}${k}`) ?? fb;
  return {
    x: N(g('x', defaults.x), defaults.x),
    y: N(g('y', defaults.y), defaults.y),
    w: N(g('w', defaults.w), defaults.w),
    size: N(g('s', defaults.size), defaults.size),
    align: alignFix(g('align', defaults.align), defaults.align),
    color: defaults.color || rgb(0, 0, 0),
    lineGap: defaults.lineGap ?? 3,
  };
}

// Robustly choose a full/cover name with legacy + URL override support
const pickFullName = (data, url) => norm(
  data?.person?.fullName ??
  data?.fullName ??
  data?.summary?.user?.fullName ??        // legacy
  url?.searchParams?.get('name') ??       // manual override
  ''
);

const pickFlowLabel = (data, url) => {
  const q = (url?.searchParams?.get('flow') || '').trim();
  const v = q || data?.flowLabel || data?.summary?.flow?.label || 'Perspective';
  // Normalise a few common variants
  const map = { perspective: 'Perspective', observe: 'Observe', reflective: 'Reflective', reflection: 'Reflective' };
  return map[String(v).toLowerCase()] || v;
};

const pickDateLbl = (data, url) => {
  // Prefer explicit override (?date=DD/MMM/YYYY), else data.summary.flow.dateLbl, fallback to today in DD/MMM/YYYY
  const q = (url?.searchParams?.get('date') || '').trim();
  if (q) return q;
  const fromData = data?.dateLbl || data?.summary?.flow?.dateLbl;
  if (fromData) return fromData;

  // Build DD/MMM/YYYY in Europe/Amsterdam
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam',
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).formatToParts(now);
    const dd = parts.find(p => p.type === 'day').value;
    const mm = Number(parts.find(p => p.type === 'month').value);
    const yyyy = parts.find(p => p.type === 'year').value;
    const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Math.max(0, mm-1)];
    return `${dd}/${MMM}/${yyyy}`;
  } catch {
    const dd = String(now.getUTCDate()).padStart(2,'0');
    const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][now.getUTCMonth()];
    const yyyy = now.getUTCFullYear();
    return `${dd}/${MMM}/${yyyy}`;
  }
};

/* ------------------------- template fetcher ------------------------- */

async function fetchTemplate(req, urlObj) {
  const url = urlObj instanceof URL ? urlObj : new URL(req?.url || '/', 'http://localhost');
  // default to the correct PDF in /public, allow override via ?tpl=
  const tplFile = url.searchParams.get('tpl') || 'CTRL_Perspective_Assessment_Profile_template.pdf';

  const h = (req && req.headers) || {};
  const host  = String(h.host || 'ctrl-export-service.vercel.app');
  const proto = String(h['x-forwarded-proto'] || 'https');

  const tplUrl = new URL(`${proto}://${host}/${tplFile}`);
  tplUrl.searchParams.set('v', Date.now().toString()); // cache bust
  const r = await fetch(tplUrl.toString(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText} @ ${tplUrl.pathname}`);
  return new Uint8Array(await r.arrayBuffer());
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

  // Demo payload so you can tune visually
  let data;
  if (isTest) {
    data = {
      flowLabel: pickFlowLabel({}, url), // honour ?flow=
      person: { fullName: 'Avery Example' },
      dateLbl: pickDateLbl({}, url),
    };
  } else {
    // Expect base64 ?data=... (kept minimal here)
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      data = JSON.parse(Buffer.from(S(b64,''), 'base64').toString('utf8'));
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
    }
  }

  // ---- Resolve text values ----
  const flowLabel = pickFlowLabel(data, url);
  const fullName  = pickFullName(data, url);
  const dateLbl   = pickDateLbl(data, url);

  // ---- Default coordinate presets (exactly as you provided) ----
  const DEFAULTS = {
    // Page 1
    f1: { x:140, y:573, w:600, size:32, align:'left'   }, // PathName
    n1: { x:205, y:165, w:400, size:40, align:'center' }, // FullName
    d1: { x:120, y:630, w:500, size:25, align:'left'   }, // Date (DD/MMM/YYYY)

    // Page 2
    f2: { x:400, y:64, w:800, size:12, align:'left'    },
    n2: { x:35,  y:64, w:400, size:13, align:'center'  },

    // Page 3
    f3: { x:400, y:64, w:800, size:12, align:'left'    },
    n3: { x:35,  y:64, w:400, size:13, align:'center'  },

    // Page 4
    f4: { x:400, y:64, w:800, size:12, align:'left'    },
    n4: { x:35,  y:64, w:400, size:13, align:'center'  },

    // Page 5
    f5: { x:400, y:64, w:800, size:12, align:'left'    },
    n5: { x:35,  y:64, w:400, size:13, align:'center'  },

    // Page 6
    f6: { x:400, y:64, w:800, size:12, align:'left'    },
    n6: { x:35,  y:64, w:400, size:13, align:'center'  },

    // Page 7
    f7: { x:400, y:64, w:800, size:12, align:'left'    },
    n7: { x:35,  y:64, w:400, size:13, align:'center'  },
  };

  // Read specs from URL (allows you to continue tuning)
  const POS = {
    f1: readSpec(url, 'f1', DEFAULTS.f1),
    n1: readSpec(url, 'n1', DEFAULTS.n1),
    d1: readSpec(url, 'd1', DEFAULTS.d1),

    f2: readSpec(url, 'f2', DEFAULTS.f2),
    n2: readSpec(url, 'n2', DEFAULTS.n2),

    f3: readSpec(url, 'f3', DEFAULTS.f3),
    n3: readSpec(url, 'n3', DEFAULTS.n3),

    f4: readSpec(url, 'f4', DEFAULTS.f4),
    n4: readSpec(url, 'n4', DEFAULTS.n4),

    f5: readSpec(url, 'f5', DEFAULTS.f5),
    n5: readSpec(url, 'n5', DEFAULTS.n5),

    f6: readSpec(url, 'f6', DEFAULTS.f6),
    n6: readSpec(url, 'n6', DEFAULTS.n6),

    f7: readSpec(url, 'f7', DEFAULTS.f7),
    n7: readSpec(url, 'n7', DEFAULTS.n7),
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      pagesYouCanTune: ['1','2','3','4','5','6','7'],
      pos: POS,
      values: { flowLabel, fullName, dateLbl },
      hint: 'Use &preview=1 to render inline; continue to tweak f1/n1/d1 etc.',
    }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const pageCount = pdf.getPageCount();
    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Helper: safely get a page (1-based index as in your spec)
    const P = (idx1) => {
      const idx0 = idx1 - 1;
      if (idx0 < 0 || idx0 >= pageCount) return null;
      return pdf.getPage(idx0);
    };

    /* ---------------- Page 1 ---------------- */
    const p1 = P(1);
    if (p1) {
      drawTextBox(p1, HelvB, flowLabel, POS.f1, { maxLines: 1, ellipsis: true });
      drawTextBox(p1, HelvB, fullName,  POS.n1, { maxLines: 1, ellipsis: true });
      drawTextBox(p1, Helv,  dateLbl,   POS.d1, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 2 ---------------- */
    const p2 = P(2);
    if (p2) {
      drawTextBox(p2, HelvB, flowLabel, POS.f2, { maxLines: 1, ellipsis: true });
      drawTextBox(p2, Helv,  fullName,  POS.n2, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 3 ---------------- */
    const p3 = P(3);
    if (p3) {
      drawTextBox(p3, HelvB, flowLabel, POS.f3, { maxLines: 1, ellipsis: true });
      drawTextBox(p3, Helv,  fullName,  POS.n3, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 4 ---------------- */
    const p4 = P(4);
    if (p4) {
      drawTextBox(p4, HelvB, flowLabel, POS.f4, { maxLines: 1, ellipsis: true });
      drawTextBox(p4, Helv,  fullName,  POS.n4, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 5 ---------------- */
    const p5 = P(5);
    if (p5) {
      drawTextBox(p5, HelvB, flowLabel, POS.f5, { maxLines: 1, ellipsis: true });
      drawTextBox(p5, Helv,  fullName,  POS.n5, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 6 ---------------- */
    const p6 = P(6);
    if (p6) {
      drawTextBox(p6, HelvB, flowLabel, POS.f6, { maxLines: 1, ellipsis: true });
      drawTextBox(p6, Helv,  fullName,  POS.n6, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 7 ---------------- */
    const p7 = P(7);
    if (p7) {
      drawTextBox(p7, HelvB, flowLabel, POS.f7, { maxLines: 1, ellipsis: true });
      drawTextBox(p7, Helv,  fullName,  POS.n7, { maxLines: 1, ellipsis: true });
    }

    // Output
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="CTRL_Perspective_profile.pdf"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
