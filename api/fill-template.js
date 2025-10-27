// /api/fill-template.js — Vercel (Node runtime), robust & lazy-loaded

export const config = { runtime: "nodejs" };

// ---------- tiny utils ----------
const S  = (v, fb = "") => (v == null ? String(fb) : String(v));
const N  = (v, fb = 0)  => (Number.isFinite(+v) ? +v : +fb);
const okObj = (o) => o && typeof o === "object" && !Array.isArray(o);
const norm = (t) => String(t || "").replace(/\r/g, "").trim();

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
  // POST JSON body (Node)
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

async function loadTemplateBytesLocal(filename) {
  // Read from /public
  const path = (await import("path")).default;
  const fs = (await import("fs/promises")).default;
  const p = path.join(process.cwd(), "public", filename);
  try {
    return await fs.readFile(p);
  } catch {
    throw new Error(`Template not found in /public: ${filename}`);
  }
}

function okResNode(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

function okResWeb(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

// ---------- core drawing helpers (no width variable shadowing) ----------
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const { rgb } = spec.__pdf;
  const {
    x=40, y=40, w=540, size=12, lineGap=3,
    align="left", color=rgb(0,0,0), maxLines=6
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
  const baselineY = pageH - y;
  const lineH = Math.max(1, size) + lineGap;

  let yCursor = baselineY;
  for (const ln of lines) {
    let xDraw = x;
    const wLn = widthOf(ln);
    if (align === "center") xDraw = x + (boxW - wLn) / 2;
    else if (align === "right") xDraw = x + (boxW - wLn);

    page.drawText(ln, { x: xDraw, y: yCursor - size, size: Math.max(1, size), font, color });
    yCursor -= lineH;
    if (yCursor < 0) break;
  }
}

async function renderPdf(payload) {
  // Lazy-import pdf-lib
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  // Fields
  const tpl = S(process.env.PDF_TPL_FILENAME || payload.template || "CTRL_Perspective_Assessment_Profile_template.pdf");
  const bytes = await loadTemplateBytesLocal(tpl);
  const pdf = await PDFDocument.load(bytes);

  const fontName = S(process.env.PDF_DEFAULT_FONT || "Helvetica");
  const font = await pdf.embedFont(StandardFonts[fontName] || StandardFonts.Helvetica);

  const name         = S(payload.name || payload["p1:n"], "Perspective");
  const date         = S(payload.date || payload["p1:d"], new Date().toLocaleDateString("en-GB"));
  const dominant     = S(payload.dominant || payload["p3:dom"]);
  const dominantName = S(payload.dominantName || payload["p3:domchar"]);
  const distribution = S(payload.distribution || payload["p3:freq"]);
  const sequence     = S(payload.sequence || payload["p4:seq"]);
  const theme        = S(payload.theme || payload["p6:theme"]);
  const themeExpl    = S(payload.themeExpl || payload["p6:themeExpl"]);

  const DEFAULTS = {
    name:         { page: 1, x: 90,  y: 140, w: 440, size: 22, align: "left", __pdf: { rgb } },
    date:         { page: 1, x: 90,  y: 170, w: 440, size: 14, align: "left", __pdf: { rgb } },
    dominant:     { page: 2, x: 55,  y: 140, w: 520, size: 21, align: "left", maxLines: 2,  __pdf: { rgb } },
    distribution: { page: 2, x: 55,  y: 180, w: 520, size: 14, align: "left", maxLines: 1,  __pdf: { rgb } },
    sequence:     { page: 2, x: 55,  y: 205, w: 520, size: 14, align: "left", maxLines: 1,  __pdf: { rgb } },
    theme:        { page: 6, x: 55,  y: 520, w: 520, size: 18, align: "left", maxLines: 2,  __pdf: { rgb } },
    themeExpl:    { page: 6, x: 55,  y: 555, w: 520, size: 14, align: "left", maxLines: 10, __pdf: { rgb } },
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

  // Optional tiny footer in debug mode
  const isDebug = !!payload?.meta?.debug;
  if (isDebug) {
    const p = pdf.getPage(pdf.getPageCount()-1);
    drawTextBox(p, font, `[debug] tpl=${tpl}`, { x: 40, y: 820, w: 540, size: 10, align: "left", __pdf: { rgb } }, { maxLines: 1 });
  }

  return Buffer.from(await pdf.save());
}

// ---------- dual-mode handler ----------
async function realHandler(universalReq) {
  const payload = await readRequestPayload(universalReq);

  const tpl = S(process.env.PDF_TPL_FILENAME || payload.template || "CTRL_Perspective_Assessment_Profile_template.pdf");
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

// Export for Node-style (req, res)
export default async function nodeHandler(req, res) {
  // If res is missing (Web runtime), return Web Response
  if (!res || typeof res.writeHead !== "function") {
    const out = await realHandler(req);
    return okResWeb(out.status, out.body, out.headers);
  }
  const out = await realHandler(req);
  okResNode(res, out.status, out.body, out.headers);
}

// Also support explicit Web handlers if your framework calls them:
export async function GET(req)  { const out = await realHandler(req); return okResWeb(out.status, out.body, out.headers); }
export async function POST(req) { const out = await realHandler(req); return okResWeb(out.status, out.body, out.headers); }
