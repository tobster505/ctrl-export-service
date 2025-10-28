// /api/fill-template.js — USER EXPORTER (Node runtime, robust /public loader + DEBUG panel)
// Loads templates ONLY from /public. Default = CTRL_Perspective_Assessment_Profile_template_slim.pdf
export const config = { runtime: "nodejs" };

// ---------- tiny utils ----------
const S  = (v, fb = "") => (v == null ? String(fb) : String(v));
const N  = (v, fb = 0)  => (Number.isFinite(+v) ? +v : +fb);
const okObj = (o) => o && typeof o === "object" && !Array.isArray(o);
const norm = (t) => String(t || "").replace(/\r/g, "").trim();

// ---------- request payload reader (GET ?data= or POST JSON) ----------
async function readRequestPayload(universalReq) {
  // GET ?data=<base64 JSON>
  try {
    const url = new URL(typeof universalReq.url === "string" ? universalReq.url : `http://x${universalReq.url}`);
    const b64 = url.searchParams.get("data");
    if (b64) {
      const json = Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(json);
    }
  } catch {}
  // POST JSON body (Web Request)
  if (typeof universalReq.json === "function") {
    try {
      const body = await universalReq.json();
      if (okObj(body)) return body;
    } catch {}
  }
  // POST JSON body (Node streams)
  const req = universalReq;
  if (req?.headers && typeof req.on === "function") {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw) {
        const body = JSON.parse(raw);
        if (okObj(body)) return body;
      }
    } catch {}
  }
  return {};
}

// ---------- robust /public loader (multi-path resolver for Vercel layouts) ----------
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";

async function loadTemplateBytesLocal(filename) {
  const fname = String(filename || "").trim();
  if (!fname.endsWith(".pdf")) throw new Error(`Invalid template filename: ${fname}`);

  const __file = fileURLToPath(import.meta.url);
  const __dir  = path.dirname(__file);

  const candidates = [
    path.join(__dir, "..", "..", "public", fname),
    path.join(__dir, "..", "public", fname),
    path.join(__dir, "public", fname),
    path.join(process.cwd(), "public", fname),
    path.join(__dir, fname),
  ];

  let lastErr;
  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p);
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Template not found in any known path for /public: ${fname}`);
}

// ---------- response helpers ----------
function okResNode(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}
function okResWeb(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

// ---------- core drawing helper (no width shadowing) ----------
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const { rgb } = spec.__pdf;
  const {
    x=40, y=40, w=540, size=12, lineGap=3,
    align="left", color=rgb(0,0,0), maxLines=6, coord="TL"
  } = { ...spec, ...opts };

  const boxW = w;
  const hard = norm(text || "");
  if (!hard) return;

  const widthOf = (s) => font.widthOfTextAtSize(String(s), Math.max(1, size));
  const linesIn = hard.split(/\n/).map(s => s.trim());
  const wrapped = [];

  const wrap = (ln) => {
    const words = ln.split(/\s+/);
    let cur = "";
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (widthOf(next) <= boxW) cur = next;
      else { if (cur) wrapped.push(cur); cur = word; }
    }
    if (cur) wrapped.push(cur);
  };
  for (const ln of linesIn) wrap(ln);

  const lim = opts.maxLines ?? spec.maxLines ?? maxLines;
  const lines = wrapped.slice(0, lim);

  const pageH = page.getHeight();
  const yOrigin = coord === "BL" ? y : (pageH - y); // TL->baseline vs BL direct
  const lineH = Math.max(1, size) + lineGap;

  let yCursor = yOrigin;
  for (const ln of lines) {
    let xDraw = x;
    const wLn = widthOf(ln);
    if (align === "center") xDraw = x + (boxW - wLn) / 2;
    else if (align === "right") xDraw = x + (boxW - wLn);

    const yText = coord === "BL" ? (yCursor) : (yCursor - size);
    page.drawText(ln, { x: xDraw, y: yText, size: Math.max(1, size), font, color });
    yCursor -= lineH;
    if (yCursor < 0) break;
  }
}

// ---------- renderer ----------
async function renderPdf(payload) {
  // Lazy-import pdf-lib
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  // coord system: TL (default) or BL (set via env or payload.meta.coord)
  const coordMode = (process.env.PDF_COORD || payload?.meta?.coord || "TL").toUpperCase(); // "TL" or "BL"
  const coord = (coordMode === "BL") ? "BL" : "TL";

  // Hard default to USER slim template if none provided via env/body
  const tpl = S(process.env.PDF_TPL_FILENAME || payload.template || "CTRL_Perspective_Assessment_Profile_template_slim.pdf");
  const bytes = await loadTemplateBytesLocal(tpl);
  const pdf = await PDFDocument.load(bytes);

  const fontName = S(process.env.PDF_DEFAULT_FONT || "Helvetica");
  const font = await pdf.embedFont(StandardFonts[fontName] || StandardFonts.Helvetica);

  // Accept both slim keys and human keys; fallback with visible "(missing)" in debug
  const dbg = !!payload?.meta?.debug;
  const missing = dbg ? " (missing)" : "";

  const name         = S(payload.name || payload["p1:n"])         || (dbg ? "Perspective" + missing : "Perspective");
  const date         = S(payload.date || payload["p1:d"])         || new Date().toLocaleDateString("en-GB");
  const dominant     = S(payload.dominant || payload["p3:dom"])   || (dbg ? "(missing)" : "");
  const dominantName = S(payload.dominantName || payload["p3:domchar"]) || (dbg ? "(missing)" : "");
  const distribution = S(payload.distribution || payload["p3:freq"])    || (dbg ? "(missing)" : "");
  const sequence     = S(payload.sequence || payload["p4:seq"])         || (dbg ? "(missing)" : "");
  const theme        = S(payload.theme || payload["p6:theme"])          || (dbg ? "(missing)" : "");
  const themeExpl    = S(payload.themeExpl || payload["p6:themeExpl"])  || (dbg ? "(missing)" : "");

  // Default coords (TL input by design; switchable with coord)
  const DEFAULTS = {
    name:         { page: 1, x: 90,  y: 140, w: 440, size: 22, align: "left", __pdf: { rgb }, coord },
    date:         { page: 1, x: 90,  y: 170, w: 440, size: 14, align: "left", __pdf: { rgb }, coord },
    dominant:     { page: 2, x: 55,  y: 140, w: 520, size: 21, align: "left", maxLines: 2,  __pdf: { rgb }, coord },
    distribution: { page: 2, x: 55,  y: 180, w: 520, size: 14, align: "left", maxLines: 1,  __pdf: { rgb }, coord },
    sequence:     { page: 2, x: 55,  y: 205, w: 520, size: 14, align: "left", maxLines: 1,  __pdf: { rgb }, coord },
    theme:        { page: 6, x: 55,  y: 520, w: 520, size: 18, align: "left", maxLines: 2,  __pdf: { rgb }, coord },
    themeExpl:    { page: 6, x: 55,  y: 555, w: 520, size: 14, align: "left", maxLines: 10, __pdf: { rgb }, coord },
  };

  const coords = okObj(payload.coords) ? payload.coords : {};
  const pick = (k) => ({ ...DEFAULTS[k], ...(okObj(coords[k]) ? coords[k] : {}) });
  const pageOf = (n) => pdf.getPage(Math.min(Math.max(N(n,1)-1,0), pdf.getPageCount()-1));

  // Page 1
  drawTextBox(pageOf(pick("name").page), font, name, pick("name"));
  drawTextBox(pageOf(pick("date").page), font, date, pick("date"), { maxLines: 1 });

  // Page 2
  const domText = dominantName && !dominant.includes(dominantName) ? `${dominant} — ${dominantName}` : dominant;
  drawTextBox(pageOf(pick("dominant").page), font, domText, pick("dominant"));
  drawTextBox(pageOf(pick("distribution").page), font, distribution, pick("distribution"), { maxLines: 1 });
  drawTextBox(pageOf(pick("sequence").page),     font, sequence.replace(/\s*,\s*/g, ", "), pick("sequence"), { maxLines: 1 });

  // Page 6
  if (theme)     drawTextBox(pageOf(pick("theme").page),     font, theme,     pick("theme"));
  if (themeExpl) drawTextBox(pageOf(pick("themeExpl").page), font, themeExpl, pick("themeExpl"));

  // ===== DEBUG PANEL (always on page 1 when debug=true) =====
  if (dbg) {
    const p1 = pageOf(1);
    const grey = rgb(0.95, 0.95, 0.95);
    // light panel bar
    p1.drawRectangle({ x: 30, y: p1.getHeight() - 60, width: p1.getWidth() - 60, height: 40, color: grey, opacity: 1 });
    // debug text (force BL coord for this banner so it appears at the top regardless)
    const banner = [
      `[debug] tpl=${tpl} | pages=${pdf.getPageCount()} | coord=${coord}`,
      `name=${name} | date=${date}`,
      `dom=${domText} | freq=${distribution} | seq=${sequence}`,
      `theme=${theme}`
    ].join("  ·  ");
    drawTextBox(p1, font, banner, { x: 36, y: 38, w: p1.getWidth() - 72, size: 10, align: "left", __pdf: { rgb }, coord: "BL" }, { maxLines: 1 });
  }

  return Buffer.from(await pdf.save());
}

// ---------- dual-mode handler ----------
async function realHandler(universalReq) {
  const payload = await readRequestPayload(universalReq);

  // Hard default to SLIM template if none passed via env/body
  const tpl = S(process.env.PDF_TPL_FILENAME || payload.template || "CTRL_Perspective_Assessment_Profile_template_slim.pdf");
  if (!/\.pdf$/i.test(tpl)) {
    return { status: 400, body: JSON.stringify({ ok: false, error: "Invalid template filename" }), headers: { "Content-Type": "application/json" } };
  }

  try {
    const pdf = await renderPdf(payload);
    return { status: 200, body: pdf, headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } };
  } catch (err) {
    return { status: 500, body: JSON.stringify({ ok: false, error: String(err?.message || err) }), headers: { "Content-Type": "application/json" } };
  }
}

// Default export (Node style) with Web fallback
export default async function nodeHandler(req, res) {
  if (!res || typeof res.writeHead !== "function") {
    const out = await realHandler(req);
    return okResWeb(out.status, out.body, out.headers);
  }
  const out = await realHandler(req);
  okResNode(res, out.status, out.body, out.headers);
}

// Explicit Web handlers (if your framework prefers them)
export async function GET(req)  { const out = await realHandler(req); return okResWeb(out.status, out.body, out.headers); }
export async function POST(req) { const out = await realHandler(req); return okResWeb(out.status, out.body, out.headers); }
