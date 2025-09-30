/**
 * CTRL Export Service · /api/fill-template  (Pages Router)
 * Renders CTRL Perspective PDF using layoutV6 (TL-origin, pt, pages 1-based)
 */

export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import path from "path";
import fs from "fs/promises";

/* ───────────────────────────── Utilities ───────────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const norm = (s) => S(s).trim();

function todayLbl(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, "0");
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getMonth()];
  const yyyy = d.getFullYear();
  return `${dd}${MMM}${yyyy}`;
}

function decodeBase64Json(b64) {
  try {
    if (!b64) return {};
    const bin = Buffer.from(String(b64), "base64").toString("binary");
    const json = decodeURIComponent(Array.prototype.map.call(bin, c => {
      return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(""));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/* ───────────── Template loader (with fallback to non-slim) ─────────── */
async function loadTemplateBytes(tplParam) {
  const raw = S(tplParam || "CTRL_Perspective_Assessment_Profile_template_slim.pdf").trim();
  if (/^https?:/i.test(raw)) throw new Error("Remote templates are not allowed. Put the PDF in /public.");
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "");
  if (!safe || !/\.pdf$/i.test(safe)) throw new Error("Invalid 'tpl' (provide a .pdf filename in /public).");

  const primary = path.resolve(process.cwd(), "public", safe);
  const fallback = path.resolve(process.cwd(), "public", "CTRL_Perspective_Assessment_Profile_template.pdf");

  for (const p of [primary, fallback]) {
    try { return { bytes: await fs.readFile(p), used: p }; } catch {}
  }
  throw new Error(`Template not found. Tried: ${primary} and ${fallback}`);
}

/* ─────────── Optional: embed remote chart (guard fetch) ────────────── */
async function embedRemoteImage(pdfDoc, url) {
  try {
    if (!url || !/^https?:/i.test(url)) return null;
    if (typeof fetch === "undefined") return null; // Node < 18 guard
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const isPNG = buf[0] === 0x89 && buf[1] === 0x50;
    const isJPG = buf[0] === 0xff && buf[1] === 0xd8;
    if (isPNG) return await pdfDoc.embedPng(buf);
    if (isJPG) return await pdfDoc.embedJpg(buf);
    return null;
  } catch {
    return null;
  }
}

/* ─────── Hydration from Botpress-ish payload/query (no q.name leak) ─ */
function tryHydrate(q = {}, src = {}) {
  const P = {};

  // Source object first (authoritative)
  if (src && typeof src === "object") for (const [k, v] of Object.entries(src)) P[k] = v;

  // Name / Date (DO NOT accept q.name as person name)
  if (!P.name) {
    P.name = norm(src.name || src.fullName || src.preferredName || q.fullName || q.preferredName) || "Perspective";
  }
  if (!P.dateLbl) {
    P.dateLbl = norm(src.d || src.dateLbl || q.dateLbl || q.d) || todayLbl();
  }

  // Common text fields
  const keys = [
    "dom","domLabel","domchar","character","domdesc","dominantDesc",
    "spiderdesc","spiderfreq","seqpat","pattern","theme","chart","chartUrl"
  ];
  for (const k of keys) if (P[k] == null && src[k] != null) P[k] = src[k];
  for (const k of keys) if (P[k] == null && q[k]   != null) P[k] = q[k];

  // layoutV6 (coordinates passed by client)
  if (src.layoutV6) P.layoutV6 = src.layoutV6;

  return P;
}

/* ─────────────────────── Text layout helpers ──────────────────────── */
function TL(page, yTop) {
  // Convert Top-Left y to pdf-lib baseline y (Bottom-Left)
  const H = page.getHeight();
  return (yt, lineH = 0) => H - yt - lineH; // returns baseline y for first line
}

function lineWrap(font, text, size, maxWidth) {
  // Simple greedy wrapper (supports basic ASCII & spaces)
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let cur = "";
  const width = (s) => font.widthOfTextAtSize(s, size);
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (width(trial) <= maxWidth || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  // if a single word is too long, hard-break it
  const splitLong = [];
  for (const ln of lines) {
    if (width(ln) <= maxWidth) { splitLong.push(ln); continue; }
    let buf = "";
    for (const ch of ln) {
      const t = buf + ch;
      if (width(t) <= maxWidth) buf = t;
      else { splitLong.push(buf); buf = ch; }
    }
    if (buf) splitLong.push(buf);
  }
  return splitLong;
}

function drawTextBlock(page, font, text, box, opts = {}) {
  const {
    size = 12,
    color = rgb(0,0,0),
    align = "left",
    maxLines = 4,
    leading = 1.25,
    boldFont
  } = opts;

  const tx = Number(box.x)||0, ty = Number(box.y)||0, tw = Number(box.w)||300;
  const makeY = TL(page);
  const lineH = size * leading;

  let usedFont = font;
  if (opts.bold === true && boldFont) usedFont = boldFont;

  const lines = lineWrap(usedFont, text, size, tw).slice(0, maxLines);
  let y = makeY(ty, size); // baseline y for first line (TL origin)

  for (const ln of lines) {
    const w = usedFont.widthOfTextAtSize(ln, size);
    let x = tx;
    if (align === "center") x = tx + (tw - w) / 2;
    else if (align === "right") x = tx + tw - w;
    page.drawText(ln, { x, y, size, font: usedFont, color });
    y -= lineH;
  }
  return { lines, lineH };
}

/* ────────────────────────── V6 Renderer ───────────────────────────── */
async function renderV6(pdfDoc, P) {
  const pages = pdfDoc.getPages();
  const H = pages[0].getHeight(); // for quick reference
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const L = P.layoutV6 || {};
  const meta = L.meta || { units: "pt", origin: "TL", pages: "1-based" };

  // Page 1 — name + date
  if (L.p1 && pages[0]) {
    if (L.p1.name && P.name) {
      drawTextBlock(pages[0], bold, P.name, L.p1.name, {
        size: Number(L.p1.name.size || 24),
        align: String(L.p1.name.align || "left")
      });
    }
    if (L.p1.date && P.dateLbl) {
      drawTextBlock(pages[0], font, P.dateLbl, L.p1.date, {
        size: Number(L.p1.date.size || 14),
        align: String(L.p1.date.align || "left")
      });
    }
  }

  // Page 3 — dominant state character + description (your debug shows these are populated)
  // Assuming page index 2 (1-based "3")
  const p3 = L.p3;
  if (p3 && pages[2]) {
    if (p3.domChar && (P.domchar || P.character)) {
      drawTextBlock(pages[2], bold, P.domchar || P.character, p3.domChar, {
        size: Number(p3.domChar.size || 20),
        align: String(p3.domChar.align || "left")
      });
    }
    if (p3.domDesc && (P.domdesc || P.dominantDesc)) {
      drawTextBlock(pages[2], font, P.domdesc || P.dominantDesc, p3.domDesc, {
        size: Number(p3.domDesc.size || 12),
        align: String(p3.domDesc.align || "left"),
        maxLines: Number(p3.domDescMaxLines || p3.domDesc.maxLines || 12)
      });
    }
    // Optional: label the state in the quadrant, if layout provides labelByState
    if (p3.state && p3.labelByState && P.dom) {
      const key = String(P.dom).charAt(0).toUpperCase(); // C/T/R/L
      const labelBox = p3.labelByState[key];
      if (labelBox) {
        drawTextBlock(pages[2], bold, "YOU ARE HERE", labelBox, {
          size: Number(p3.labelSize || 10),
          align: "left"
        });
      }
    }
  }

  // Page 4 — spider chart + description/frequency
  const p4 = L.p4;
  if (p4 && pages[3]) {
    if (p4.spider && P.spiderdesc) {
      drawTextBlock(pages[3], font, P.spiderdesc, p4.spider, {
        size: Number(p4.spider.size || 12),
        align: String(p4.spider.align || "left"),
        maxLines: Number(p4.spiderMaxLines || 10)
      });
    }
    // Optional: print frequency line near spider block if you prefer
    if (p4.spider && P.spiderfreq) {
      const freqBox = { ...p4.spider, y: (Number(p4.spider.y) + 16) }; // small shift down under desc
      drawTextBlock(pages[3], bold, P.spiderfreq, freqBox, {
        size: Number(p4.spider.size || 12),
        align: String(p4.spider.align || "left"),
        maxLines: 1
      });
    }
    // Chart image
    if (p4.chart) {
      const chartUrl = P.chart || P.chartUrl;
      const img = await embedRemoteImage(pdfDoc, chartUrl);
      if (img) {
        const { x, y, w, h } = p4.chart;
        const Y = pages[3].getHeight() - Number(y) - Number(h); // TL to BL
        pages[3].drawImage(img, { x: Number(x), y: Y, width: Number(w), height: Number(h) });
      }
    }
  }

  // Page 5 — sequence pattern text
  const p5 = L.p5;
  if (p5 && p5.seqpat && pages[4] && P.seqpat) {
    drawTextBlock(pages[4], font, P.seqpat, p5.seqpAt || p5.seqpat, {
      size: Number((p5.seqpAt || p5.seqpat).size || 12),
      align: String((p5.seqpAt || p5.seqpat).align || "left"),
      maxLines: Number(p5.seqpatMaxLines || 12)
    });
  }

  // Page 6 — top theme
  const p6 = L.p6;
  if (p6 && p6.theme && pages[5] && P.theme) {
    drawTextBlock(pages[5], bold, P.theme, p6.theme, {
      size: Number(p6.theme.size || 12),
      align: String(p6.theme.align || "left"),
      maxLines: Number(p6.themeMaxLines || 12)
    });
  }

  // Page 7/8/9/10 — headers/boxes exist in your layout, but your current flow outputs
  // mainly p1/p3/p4/p5/p6 text. You can extend below when you begin sending
  // the detailed tips/actions blocks into the payload.
}

/* ───────────────────────── Simple debug overlay ────────────────────── */
async function drawDebugAlive(pdfDoc, label = "alive ✓") {
  try {
    const pages = pdfDoc.getPages();
    if (!pages.length) return;
    const first = pages[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    first.drawText(label, { x: 24, y: first.getHeight() - 24, size: 9, color: rgb(0.25,0.25,0.25), font });
  } catch { /* noop */ }
}

/* ─────────────────────────── Finalize & send ───────────────────────── */
async function finalizeAndSendPdf(res, pdfDoc, P, q) {
  const bytes = await pdfDoc.save();
  const outName = S(q.out || q.name || `CTRL_${P.name || "Perspective"}_${P.dateLbl || todayLbl()}.pdf`)
    .replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
  res.status(200).send(Buffer.from(bytes));
}

/* ────────────────────────────── Handler ────────────────────────────── */
export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? (req.body || {}) : (req.query || {});

    // Quick health check
    if (String(q.diag) === "1") {
      const rawTpl = String(q.tpl || "");
      const safe = rawTpl.replace(/[^A-Za-z0-9._-]/g, "");
      return res.status(200).json({
        ok: true,
        node: process.version,
        hasFetch: typeof fetch !== "undefined",
        tpl: safe,
        tplPath: path.resolve(process.cwd(), "public", safe)
      });
    }

    // Hydrate payload
    const src = decodeBase64Json(q.data);
    const P = tryHydrate(q, src);

    // Load template and render
    const { bytes: tplBytes } = await loadTemplateBytes(q.tpl);
    const pdfDoc = await PDFDocument.load(tplBytes);

    if (String(q.debug) === "1") await drawDebugAlive(pdfDoc, "alive ✓");

    // 🔴 Core: render with your layoutV6 and text values
    await renderV6(pdfDoc, P);

    await finalizeAndSendPdf(res, pdfDoc, P, q);
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
