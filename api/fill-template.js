/**
 * CTRL Export Service · /api/fill-template  (Pages Router)
 * - Supports ?diag=1 for quick health checks.
 * - Loads template from /public with a safe fallback.
 * - Guards fetch() for Node < 18 (chart image optional).
 * - Separates printed person name (payload) from HTTP filename (?out=).
 * - Adds a tiny "alive ✓" overlay when ?debug=1 (does not affect layout).
 */

export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import path from "path";
import fs from "fs/promises";

/* ───────────────────────────── Utilities ───────────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const norm = (s) => S(s).trim();
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);

function todayLbl(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, "0");
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getMonth()];
  const yyyy = d.getFullYear();
  return `${dd}${MMM}${yyyy}`;
}

function decodeBase64Json(b64) {
  try {
    if (!b64) return {};
    // base64 → binary → percent-escaped → JSON
    const bin = Buffer.from(String(b64), "base64").toString("binary");
    const json = decodeURIComponent(Array.prototype.map.call(bin, c => {
      return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(""));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/* ───────────────────── Template loader (with fallback) ─────────────── */
async function loadTemplateBytes(tplParam) {
  const raw = S(tplParam || "CTRL_Perspective_Assessment_Profile_template_slim.pdf").trim();
  if (/^https?:/i.test(raw)) {
    throw new Error("Remote templates are not allowed. Put the PDF in /public and pass only the filename.");
  }
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "");
  if (!safe || !/\.pdf$/i.test(safe)) {
    throw new Error("Invalid 'tpl' value. Provide a .pdf filename that exists in /public.");
  }

  const primary = path.resolve(process.cwd(), "public", safe);
  const fallback = path.resolve(process.cwd(), "public", "CTRL_Perspective_Assessment_Profile_template.pdf");

  for (const p of [primary, fallback]) {
    try {
      const bytes = await fs.readFile(p);
      return { bytes, used: p };
    } catch { /* try next */ }
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

    // Quick sniff for PNG/JPG
    const isPNG = buf[0] === 0x89 && buf[1] === 0x50;
    const isJPG = buf[0] === 0xff && buf[1] === 0xd8;

    if (isPNG) return await pdfDoc.embedPng(buf);
    if (isJPG) return await pdfDoc.embedJpg(buf);
    return null;
  } catch {
    return null;
  }
}

/* ───────────── Hydration from Botpress-ish payload/query ───────────── */
function tryHydrateFromBotpressish(q = {}, src = {}, RPT_MIN = {}) {
  const P = {};

  // Merge source object first (authoritative)
  if (src && typeof src === "object") {
    for (const [k, v] of Object.entries(src)) P[k] = v;
  }

  // Person name: DO NOT pull from q.name (reserved for legacy filenames)
  if (!P.name) {
    P.name = norm(
      src.name || src.fullName || src.preferredName ||
      RPT_MIN?.person?.fullName ||
      q.fullName || q.preferredName || ""
    ) || "Perspective";
  }

  // Date label
  if (!P.dateLbl) {
    P.dateLbl = norm(src.d || src.dateLbl || q.dateLbl || q.d) || todayLbl();
  }

  // Common text fields (accept from src first, then query)
  const keys = [
    "dom","domLabel","domchar","character","domdesc","dominantDesc",
    "spiderdesc","spiderfreq","seqpat","pattern","theme","chart","chartUrl"
  ];
  for (const k of keys) if (P[k] == null && src[k] != null) P[k] = src[k];
  for (const k of keys) if (P[k] == null && q[k]   != null) P[k] = q[k];

  return P;
}

/* ───────────────────────── Simple debug overlay ────────────────────── */
async function drawDebugAlive(pdfDoc, label = "alive ✓") {
  try {
    const pages = pdfDoc.getPages();
    if (!pages.length) return;
    const first = pages[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    first.drawText(label, {
      x: 24, y: first.getHeight() - 24,
      size: 9, color: rgb(0.25,0.25,0.25), font
    });
  } catch { /* best effort only */ }
}

/* ─────────────────────────── Finalize & send ───────────────────────── */
async function finalizeAndSendPdf(res, pdfDoc, P, q) {
  const bytes = await pdfDoc.save();

  // HTTP download filename: prefer ?out, then legacy ?name, then built from content
  const outName = S(
    q.out || q.name || `CTRL_${P.name || "Perspective"}_${P.dateLbl || todayLbl()}.pdf`
  ).replace(/[^\w.-]+/g, "_");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
  res.status(200).send(Buffer.from(bytes));
}

/* ────────────────────────────── Handler ────────────────────────────── */
export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? (req.body || {}) : (req.query || {});

    // --- DIAG: quick health check (no PDF work) ---
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

    // Decode base64 JSON payload object
    const src = decodeBase64Json(q.data);
    const RPT_MIN = {}; // reserved for future; keep empty
    const P = tryHydrateFromBotpressish(q, src, RPT_MIN);

    // Load template (with fallback)
    const { bytes: tplBytes } = await loadTemplateBytes(q.tpl);
    const pdfDoc = await PDFDocument.load(tplBytes);

    // Optional chart image embed (only if you want; coords depend on your template)
    const chartUrl = P.chart || P.chartUrl || q.chart;
    if (chartUrl) {
      const img = await embedRemoteImage(pdfDoc, chartUrl);
      if (img) {
        // Default placement (adjust to your template if you want to draw it)
        const page = pdfDoc.getPages()[0];
        const w = Math.min(img.width, 260);
        const h = img.height * (w / img.width);
        page.drawImage(img, { x: 320, y: page.getHeight() - 320 - h, width: w, height: h });
      }
    }

    // Optional: draw a tiny "alive ✓" when debug=1 (non-invasive)
    if (String(q.debug) === "1") {
      await drawDebugAlive(pdfDoc, "alive ✓");
    }

    // TODO: draw your actual report content here using P.* fields
    // e.g., P.name, P.dateLbl, P.domchar, P.domdesc, P.spiderdesc, P.seqpat, P.theme, etc.
    // (Leaving your existing drawing functions intact is fine — this wrapper just adds robustness.)

    await finalizeAndSendPdf(res, pdfDoc, P, q);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
}
