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

// Wrap/align text into a box (y = distance from TOP, not bottom)
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

// Robust cover name picker (legacy-safe)
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

// Template fetcher — now respects ?tpl= and defaults to V2
async function fetchTemplate(req, url) {
  const tplParam = url.searchParams.get('tpl');
  const templateName = tplParam && tplParam.trim()
    ? tplParam.trim()
    : 'CTRL_Perspective_Assessment_Profile_templateV2.pdf'; // <-- default to V2

  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');

  // IMPORTANT: use the exact filename under /public
  const templateUrl = `${proto}://${host}/${encodeURI(templateName)}`;

  const r = await fetch(templateUrl, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText} (${templateUrl})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { bytes, templateName, templateUrl };
}

// Quick query readers for tuner coords
const qnum = (url, key, fb) => {
  const s = url.searchParams.get(key);
  if (s === null || s === '') return fb;
  const n = Number(s);
  return Number.isFinite(n) ? n : fb;
};
const qstr = (url, key, fb) => {
  const v = url.searchParams.get(key);
  return v == null || v === '' ? fb : v;
};

export default async function handler(req, res) {
  // Parse URL safely
  let url;
  try { url = new URL(req?.url || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const isTest   = url.searchParams.get('test') === '1';
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';

  // Minimal demo payload for test previewing
  let data = null;
  if (isTest) {
    data = {
      person: { coverName: 'Avery Example', fullName: 'Avery Example' },
      flow: qstr(url, 'flow', 'Perspective'),
      dateLbl: qstr(url, 'date', '02/SEP/2025'),
      stateWord: 'Regulated',
      how: 'Steady presence; keep clarity alive.',
    };
  } else {
    // Expect ?data=<base64>
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      const raw = Buffer.from(S(b64,''), 'base64').toString('utf8');
      data = JSON.parse(raw);
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
    }
  }

  // Resolve the template (default V2 or ?tpl= override)
  let tpl;
  try {
    tpl = await fetchTemplate(req, url);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Template load error: ' + (e?.message || e));
    return;
  }

  // Optional JSON debug (to confirm which template is in play)
  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({
      ok: true,
      usingTemplate: tpl.templateName,
      templateUrl: tpl.templateUrl,
      urlParams: Object.fromEntries(url.searchParams.entries()),
      sampleName: pickCoverName(data, url),
      sampleFlow: data?.flow || 'Perspective',
      sampleDateLbl: data?.dateLbl || ''
    }, null, 2));
    return;
  }

  try {
    // Load the template PDF
    const pdf = await PDFDocument.load(tpl.bytes);

    // Safely get pages even if the design changes
    const pages = pdf.getPages();
    const get = (idx) => {
      if (idx < 0 || idx >= pages.length) throw new Error('Page index out of range for current template.');
      return pages[idx];
    };

    // Coords (TUNERS) — bare minimum for “back to basics”
    // Page 1 top path name & full name & date
    const POS = {
      // Page 1: path name (label)
      p1_flow: {
        x: qnum(url, 'f1x', 140),
        y: qnum(url, 'f1y', 573),
        w: qnum(url, 'f1w', 600),
        size: qnum(url, 'f1s', 32),
        align: qstr(url, 'f1align', 'left'),
        color: rgb(0.12, 0.11, 0.2),
      },
      // Page 1: full name
      p1_name: {
        x: qnum(url, 'n1x', 205),
        y: qnum(url, 'n1y', 165),
        w: qnum(url, 'n1w', 400),
        size: qnum(url, 'n1s', 40),
        align: qstr(url, 'n1align', 'center'),
        color: rgb(0.12, 0.11, 0.2),
      },
      // Page 1: date
      p1_date: {
        x: qnum(url, 'd1x', 120),
        y: qnum(url, 'd1y', 630),
        w: qnum(url, 'd1w', 500),
        size: qnum(url, 'd1s', 25),
        align: qstr(url, 'd1align', 'left'),
        color: rgb(0.24, 0.23, 0.35),
      },

      // Repeaters for pages 2..7 (flow + name) — keep simple for now
      p2_flow: { x: qnum(url,'f2x',400), y:qnum(url,'f2y',64), w:qnum(url,'f2w',800), size:qnum(url,'f2s',12), align:qstr(url,'f2align','left'), color: rgb(0.12,0.11,0.2) },
      p2_name: { x: qnum(url,'n2x',35),  y:qnum(url,'n2y',64),  w:qnum(url,'n2w',400), size:qnum(url,'n2s',13), align:qstr(url,'n2align','center'), color: rgb(0.12,0.11,0.2) },

      p3_flow: { x: qnum(url,'f3x',400), y:qnum(url,'f3y',64), w:qnum(url,'f3w',800), size:qnum(url,'f3s',12), align:qstr(url,'f3align','left'), color: rgb(0.12,0.11,0.2) },
      p3_name: { x: qnum(url,'n3x',35),  y:qnum(url,'n3y',64),  w:qnum(url,'n3w',400), size:qnum(url,'n3s',13), align:qstr(url,'n3align','center'), color: rgb(0.12,0.11,0.2) },

      p4_flow: { x: qnum(url,'f4x',400), y:qnum(url,'f4y',64), w:qnum(url,'f4w',800), size:qnum(url,'f4s',12), align:qstr(url,'f4align','left'), color: rgb(0.12,0.11,0.2) },
      p4_name: { x: qnum(url,'n4x',35),  y:qnum(url,'n4y',64),  w:qnum(url,'n4w',400), size:qnum(url,'n4s',13), align:qstr(url,'n4align','center'), color: rgb(0.12,0.11,0.2) },

      p5_flow: { x: qnum(url,'f5x',400), y:qnum(url,'f5y',64), w:qnum(url,'f5w',800), size:qnum(url,'f5s',12), align:qstr(url,'f5align','left'), color: rgb(0.12,0.11,0.2) },
      p5_name: { x: qnum(url,'n5x',35),  y:qnum(url,'n5y',64),  w:qnum(url,'n5w',400), size:qnum(url,'n5s',13), align:qstr(url,'n5align','center'), color: rgb(0.12,0.11,0.2) },

      p6_flow: { x: qnum(url,'f6x',400), y:qnum(url,'f6y',64), w:qnum(url,'f6w',800), size:qnum(url,'f6s',12), align:qstr(url,'f6align','left'), color: rgb(0.12,0.11,0.2) },
      p6_name: { x: qnum(url,'n6x',35),  y:qnum(url,'n6y',64),  w:qnum(url,'n6w',400), size:qnum(url,'n6s',13), align:qstr(url,'n6align','center'), color: rgb(0.12,0.11,0.2) },

      p7_flow: { x: qnum(url,'f7x',400), y:qnum(url,'f7y',64), w:qnum(url,'f7w',800), size:qnum(url,'f7s',12), align:qstr(url,'f7align','left'), color: rgb(0.12,0.11,0.2) },
      p7_name: { x: qnum(url,'n7x',35),  y:qnum(url,'n7y',64),  w:qnum(url,'n7w',400), size:qnum(url,'n7s',13), align:qstr(url,'n7align','center'), color: rgb(0.12,0.11,0.2) },
    };

    // Fonts
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const flowLabel = norm(data?.flow || 'Perspective');
    const fullName  = pickCoverName(data, url) || norm(data?.person?.fullName || '');
    const dateLbl   = norm(data?.dateLbl || '');

    // PAGE MAPPING (assume V2 is at least 7 pages; adjust if needed)
    const P1 = get(0), P2 = get(1), P3 = get(2), P4 = get(3), P5 = get(4), P6 = get(5), P7 = get(6);

    // Page 1
    if (flowLabel) drawTextBox(P1, HelvB, flowLabel, POS.p1_flow, { maxLines: 1, ellipsis: true });
    if (fullName)  drawTextBox(P1, HelvB, fullName,  POS.p1_name, { maxLines: 1, ellipsis: true });
    if (dateLbl)   drawTextBox(P1, Helv,  dateLbl,   POS.p1_date, { maxLines: 1, ellipsis: true });

    // Pages 2..7 — simple header/footer chips (flow + name)
    const pairs = [
      [P2, POS.p2_flow, POS.p2_name],
      [P3, POS.p3_flow, POS.p3_name],
      [P4, POS.p4_flow, POS.p4_name],
      [P5, POS.p5_flow, POS.p5_name],
      [P6, POS.p6_flow, POS.p6_name],
      [P7, POS.p7_flow, POS.p7_name],
    ];
    for (const [pg, pf, pn] of pairs) {
      if (flowLabel) drawTextBox(pg, HelvB, flowLabel, pf, { maxLines: 1, ellipsis: true });
      if (fullName)  drawTextBox(pg, Helv,  fullName,  pn, { maxLines: 1, ellipsis: true });
    }

    // Output PDF
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store'); // prevent stale caching of API response
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="ctrl_profile.pdf"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
