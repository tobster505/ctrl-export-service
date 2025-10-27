// /api/fill-template.js  (ESM, Vercel-ready)
// npm deps: pdf-lib
// ENV:
//   PDF_TPL_FILENAME (e.g., "CTRL_Perspective_Assessment_Profile_template.pdf")
//   PDF_DEFAULT_FONT  (optional, StandardFonts.Helvetica by default)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---- Node/Vercel utilities (ESM-safe) ----
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- util: __dirname (ESM) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- tiny helpers ----------
const S  = (v, fb = '') => (v == null ? String(fb) : String(v));
const N  = (v, fb = 0)  => (Number.isFinite(+v) ? +v : +fb);
const okObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const norm = (t) => String(t || '').replace(/\r/g, '').trim();

// ---------- default coords (safe fallbacks) ----------
// You can override any of these via req.coords.<key>
const DEFAULTS = {
  fontSize: 16,
  name:          { page: 1, x: 90,  y: 140, w: 440, size: 22, align: 'left' },
  date:          { page: 1, x: 90,  y: 170, w: 440, size: 14, align: 'left' },

  dominant:      { page: 2, x: 55,  y: 140, w: 520, size: 21, align: 'left', maxLines: 2 },
  distribution:  { page: 2, x: 55,  y: 180, w: 520, size: 14, align: 'left', maxLines: 1 },
  sequence:      { page: 2, x: 55,  y: 205, w: 520, size: 14, align: 'left', maxLines: 1 },

  theme:         { page: 6, x: 55,  y: 520, w: 520, size: 18, align: 'left', maxLines: 2 },
  themeExpl:     { page: 6, x: 55,  y: 555, w: 520, size: 14, align: 'left', maxLines: 10 },
};

// ---------- text box (FIXED: no shadowing of width variable) ----------
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x=40, y=40, w=540, size=12, lineGap=3,
    color=rgb(0,0,0), align='left', maxLines=6
  } = { ...spec, ...opts };

  const boxW = w; // capture width (prevents shadowing bugs)
  const hard = norm(text || '');
  if (!hard) return;

  const widthOf = (s) => font.widthOfTextAtSize(String(s), Math.max(1, size));

  const linesIn = hard.split(/\n/).map(s => s.trim());
  const wrapped = [];
  const wrap = (ln) => {
    const words = ln.split(/\s+/);
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (widthOf(next) <= boxW) cur = next;
      else { if (cur) wrapped.push(cur); cur = word; }
    }
    if (cur) wrapped.push(cur);
  };
  for (const ln of linesIn) wrap(ln);

  const lines = wrapped.slice(0, (opts.maxLines ?? spec.maxLines ?? maxLines));
  const pageH = page.getHeight();
  const baselineY = pageH - y;
  const lineH = Math.max(1, size) + lineGap;

  let yCursor = baselineY;
  for (const ln of lines) {
    let xDraw = x;
    const wLn = widthOf(ln);
    if (align === 'center') xDraw = x + (boxW - wLn) / 2;
    else if (align === 'right') xDraw = x + (boxW - wLn);

    page.drawText(ln, { x: xDraw, y: yCursor - size, size: Math.max(1, size), font, color });
    yCursor -= lineH;
    if (yCursor < 0) break;
  }
}

// ---------- read req payload from ?data= or POST JSON ----------
async function readRequestPayload(req) {
  try {
    // Try GET ?data=<base64 JSON>
    const url = new URL(req.url);
    const b64 = url.searchParams.get('data');
    if (b64) {
      const json = Buffer.from(b64, 'base64').toString('utf8');
      return JSON.parse(json);
    }
  } catch (_) {}

  // Fallback to POST body (JSON)
  try {
    const body = await req.json();
    if (okObj(body)) return body;
  } catch (_) {}

  return {};
}

// ---------- load template bytes ----------
async function loadTemplateBytes(filename) {
  // Try local "static" folder next to this file; fallback to project root
  const candidates = [
    path.join(__dirname, '..', '..', 'static', filename),
    path.join(__dirname, '..', filename),
    path.join(__dirname, filename),
  ];
  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p);
      return buf;
    } catch (_) {}
  }
  throw new Error(`Template not found: ${filename}`);
}

// ---------- main handler ----------
export default async function handler(req, res) {
  try {
    const payload = await readRequestPayload(req);
    const debug = !!payload?.meta?.debug || /[?&]debug=1/.test(req.url);

    const tplName = S(process.env.PDF_TPL_FILENAME || payload.template || 'CTRL_Perspective_Assessment_Profile_template.pdf');
    const bytes = await loadTemplateBytes(tplName);
    const pdfDoc = await PDFDocument.load(bytes);

    // Fonts
    const fontName = S(process.env.PDF_DEFAULT_FONT || 'Helvetica');
    const font = await pdfDoc.embedFont(StandardFonts[fontName] || StandardFonts.Helvetica);

    // Pull fields (with safe defaults)
    const name         = S(payload.name, 'Unknown Participant');
    const date         = S(payload.date, new Date().toLocaleDateString('en-GB'));
    const dominant     = S(payload.dominant);
    const dominantName = S(payload.dominantName);
    const distribution = S(payload.distribution);
    const sequence     = S(payload.sequence);
    const theme        = S(payload.theme || payload['p6:theme']);
    const themeExpl    = S(payload.themeExpl || payload['p6:themeExpl']);

    // Coords (override defaults where provided)
    const C = okObj(payload.coords) ? payload.coords : {};
    const coords = {
      name:         { ...DEFAULTS.name,        ...(okObj(C.name)        ? C.name        : {}) },
      date:         { ...DEFAULTS.date,        ...(okObj(C.date)        ? C.date        : {}) },
      dominant:     { ...DEFAULTS.dominant,    ...(okObj(C.dominant)    ? C.dominant    : {}) },
      distribution: { ...DEFAULTS.distribution,(okObj(C.distribution)  ? C.distribution: {}) },
      sequence:     { ...DEFAULTS.sequence,    ...(okObj(C.sequence)    ? C.sequence    : {}) },
      theme:        { ...DEFAULTS.theme,       ...(okObj(C.theme)       ? C.theme       : {}) },
      themeExpl:    { ...DEFAULTS.themeExpl,   ...(okObj(C.themeExpl)   ? C.themeExpl   : {}) },
    };

    // Helper to pick page by 1-based index safely
    const pageOf = (n) => {
      const p = clamp(N(n, 1) - 1, 0, pdfDoc.getPageCount() - 1);
      return pdfDoc.getPage(p);
    };

    // ---- Page 1: Name + Date
    {
      const p = pageOf(coords.name.page);
      drawTextBox(p, font, name, coords.name);
    }
    {
      const p = pageOf(coords.date.page);
      drawTextBox(p, font, date, coords.date, { maxLines: 1 });
    }

    // ---- Page 2: Dominant + Distribution + Sequence
    {
      const p = pageOf(coords.dominant.page);
      const domText = dominantName && !dominant.includes(dominantName)
        ? `${dominant} — ${dominantName}`
        : dominant;
      drawTextBox(p, font, domText, coords.dominant);
    }
    {
      const p = pageOf(coords.distribution.page);
      drawTextBox(p, font, distribution, coords.distribution, { maxLines: 1 });
    }
    {
      const p = pageOf(coords.sequence.page);
      // normalise commas
      const seq = sequence.replace(/\s*,\s*/g, ', ');
      drawTextBox(p, font, seq, coords.sequence, { maxLines: 1 });
    }

    // ---- Page 6: Theme Pair + Explanation
    if (theme || themeExpl) {
      const pT = pageOf(coords.theme.page);
      if (theme) drawTextBox(pT, font, theme, coords.theme);
      const pX = pageOf(coords.themeExpl.page);
      if (themeExpl) drawTextBox(pX, font, themeExpl, coords.themeExpl);
    }

    if (debug) {
      // add a small debug footer on last page
      const last = pdfDoc.getPageCount() - 1;
      const p = pdfDoc.getPage(last);
      drawTextBox(p, font, `[debug] tpl=${tplName}`, { x: 40, y: 820, w: 540, size: 10, align: 'left' }, { maxLines: 1 });
    }

    const out = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(Buffer.from(out));
  } catch (err) {
    const msg = `fill-template error: ${err?.message || err}`;
    // Return JSON error to help Botpress debugging
    res.status(500).json({ ok: false, error: msg });
  }
}

// Optional: allow local Node execution for quick tests
export async function GET(req, res) { return handler(req, res); }
export async function POST(req, res) { return handler(req, res); }
