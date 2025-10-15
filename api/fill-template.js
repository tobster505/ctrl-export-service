/**
 * CTRL Export Service · fill-template (Perspective flow) — V3 (fixed)
 * Place at: /pages/api/fill-template.js
 * TL-origin coordinates (pt), pages are 1-based.
 */
export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ────────────────────────── utilities ────────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);

/** Normalise to WinAnsi-safe, printable text (no emoji/PUA/ZW chars). */
const norm = (v, fb = "") =>
  String(v ?? fb)
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[•·]/g, "-")
    // arrows → WinAnsi-safe
    .replace(/\u2194/g, "<->").replace(/\u2192/g, "->").replace(/\u2190/g, "<-")
    .replace(/\u2191/g, "^").replace(/\u2193/g, "v").replace(/[\u2196-\u2199]/g, "->")
    .replace(/\u21A9/g, "<-").replace(/\u21AA/g, "->")
    .replace(/\u00D7/g, "x")
    // zero-width, emoji/PUA
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    // tidy
    .replace(/\t/g, " ").replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ").replace(/[ \t]+\n/g, "\n").trim();

/** Decode ?data= (URL/base64 JSON) into an object. */
function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
  catch { return {}; }
}

/** Word-wrap draw helper. Positions are TL-based, pdf-lib uses BL; convert inside. */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left"
  } = spec;
  const maxLines = (opts.maxLines ?? spec.maxLines ?? 6);
  const hard = norm(text || "");
  const lines = hard.split(/\n/).map(s => s.trim());
  const wrapped = [];

  const breakLine = (s) => {
    if (!s) { wrapped.push(""); return; }
    const words = s.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? (line + " " + word) : word;
      const width = font.widthOfTextAtSize(test, size);
      if (width > w && line) {
        wrapped.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) wrapped.push(line);
  };

  for (const ln of lines) breakLine(ln);

  const pageHeight = page.getHeight();
  let cursor = pageHeight - y; // convert TL-y → BL-y baseline
  const lh = size + lineGap;

  const xFor = align === "center"
    ? (lx) => (x + (w - font.widthOfTextAtSize(lx, size)) / 2)
    : align === "right"
      ? (lx) => (x + (w - font.widthOfTextAtSize(lx, size)))
      : () => x;

  let used = 0;
  for (const ln of wrapped) {
    if (used >= maxLines) break;
    const tx = xFor(ln);
    page.drawText(ln, { x: tx, y: cursor - size, size, font, color });
    cursor -= lh;
    used++;
  }
}

/* ────────────────────────── SPIDER DESC TOKENS ────────────────────────── */
function tokenizeSpiderDesc(base, shape, orderArrow, countsStr, max, q) {
  base = String(base || "");

  base = String(base).replace(/\{\{\s*(shape|states|order|counts|max)\s*\}\}/gi, (_, key) => {
    const k = key.toLowerCase();
    if (k === "shape")  return shape || "";
    if (k === "states" || k === "order") return orderArrow || "";
    if (k === "counts") return countsStr || "";
    if (k === "max")    return String(max);
    return "";
  });

  if (q && typeof q.spiderdesc_prefix === "string") base = String(q.spiderdesc_prefix) + base;
  if (q && typeof q.spiderdesc_suffix === "string") base = base + String(q.spiderdesc_suffix);
  if (q && typeof q.spiderdesc_append === "string") base = base + String(q.spiderdesc_append);

  return base;
}

/* ────────────────────────── NORMALISE INPUT ────────────────────────── */
function normaliseInput(d = {}) {
  const wcol = Array.isArray(d.workwcol)
    ? d.workwcol.map(x => ({ look: norm(x?.look || ""), work: norm(x?.work || "") }))
    : [];
  const wldr = Array.isArray(d.workwlead)
    ? d.workwlead.map(x => ({ look: norm(x?.look || ""), work: norm(x?.work || "") }))
    : [];
  const tips = Array.isArray(d.tips) ? d.tips.map(norm) : [];
  const actions = Array.isArray(d.actions) ? d.actions.map(norm) : [];

  const nameCand =
    (d.person && d.person.fullName) ||
    d["p1:n"] ||
    d.fullName ||
    (d.person && d.person.preferredName) ||
    d.preferredName ||
    d.name;

  return {
    // identity
    name:    norm(nameCand || "Perspective"),
    dateLbl: norm(d.dateLbl || d["p1:d"] || d.d || ""),

    // p3 (dominant)
    dom:     String(d.dom || d.domLabel || ""),
    domChar: norm(d.domchar || d.domChar || d.character || ""),
    domDesc: norm(d.domdesc || d.domDesc || d.dominantDesc || ""),

    // p4 (spider)
    spiderdesc: norm(d.spiderdesc || d.spider || ""),
    spiderfreq: norm(d.spiderfreq || ""),
    chartUrl:   String(d.chart || d.chartUrl || ""),

    // p5–6 (pattern + theme)
    seqpat:    norm(d.seqpat || d.pattern || d.seqat || ""),
    theme:     norm(d.theme     || d["p6:theme"]     || ""),
    themeExpl: norm(d.themeExpl || d["p6:themeExpl"] || ""),

    // p10–11 (work-with, tips/actions)
    workwcol:  wcol,
    workwlead: wldr,
    tips,
    actions,

    // layout overrides passthrough
    layoutV6: d.layoutV6 && typeof d.layoutV6 === "object" ? d.layoutV6 : null
  };
}

/* ────────────────────────── LAYOUT (LOCKED + overrides) ────────────────────────── */
const LOCKED = {
  footer: {
    f2: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f3: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f4: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f5: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f6: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f7: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f8: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f9: { x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f10:{ x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f11:{ x: 40,  y: 785, w: 520, size: 9,  align: "right" },
    f12:{ x: 40,  y: 785, w: 520, size: 9,  align: "right" }
  },
  p1: {
    name: { x: 210, y: 78, w: 350, size: 14, align: "left" },
    date: { x: 480, y: 78, w: 120, size: 11, align: "right" }
  },
  p3: {
    domChar: { x: 60, y: 340, w: 520, size: 18, align: "left", maxLines: 2 },
    domDesc: { x: 60, y: 505, w: 520, size: 13, align: "left", maxLines: 8 }
  },
  p4: {
    spiderdesc: { x: 60, y: 185, w: 520, size: 12, align: "left", maxLines: 6 },
    spiderfreq: { x: 60, y: 230, w: 520, size: 12, align: "left", maxLines: 2 }
  },
  p5: {
    seqpat: { x: 60, y: 640, w: 520, size: 14, align: "left", maxLines: 5 }
  },
  p6: {
    theme:     { x: 60, y: 300, w: 520, size: 18, align: "left", maxLines: 2 },
    themeExpl: { x: 60, y: 330, w: 520, size: 13, align: "left", maxLines: 12 }
  },
  p10: {
    bodyPara: { x: 60, y: 240, w: 520, size: 13, align: "left", maxLines: 15 }
  },
  p11: {
    split: true,
    bulletIndent: 28,
    tips1:  { x: 60,  y: 590, w: 520, size: 18, align: "left", maxLines: 4 },
    tips2:  { x: 60,  y: 545, w: 520, size: 18, align: "left", maxLines: 4 },
    acts1:  { x: 60,  y: 470, w: 520, size: 18, align: "left", maxLines: 4 },
    acts2:  { x: 60,  y: 425, w: 520, size: 18, align: "left", maxLines: 4 }
  }
};

function layoutFromPayload(payloadLayout) {
  const L = JSON.parse(JSON.stringify(LOCKED));
  if (!payloadLayout) return L;
  for (const k of Object.keys(payloadLayout)) {
    if (!L[k]) { L[k] = payloadLayout[k]; continue; }
    if (typeof payloadLayout[k] === "object" && !Array.isArray(payloadLayout[k])) {
      L[k] = { ...L[k], ...payloadLayout[k] };
    } else {
      L[k] = payloadLayout[k];
    }
  }
  return L;
}

/* ────────────────────────── handler ────────────────────────── */
export default async function handler(req, res) {
  try {
    const q   = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const tpl = q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim.pdf";

    // inbound payload
    const src = parseDataParam(q.data);
    const P   = normaliseInput(src);
    const L   = layoutFromPayload(src.layoutV6);

    // load template + font
    const tplPath  = path.resolve(process.cwd(), "public", String(tpl).replace(/[^A-Za-z0-9._-]/g, ""));
    const pdfBytes = await fs.readFile(tplPath);
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const p = (i) => pages[i];

    /* ───── p1 ───── */
    if (L.p1?.name && P.name)    drawTextBox(p(0), font, P.name,    L.p1.name);
    if (L.p1?.date && P.dateLbl) drawTextBox(p(0), font, P.dateLbl, L.p1.date);

    /* ───── p3 (dominant) ───── */
    if (L.p3?.domChar && P.domChar) drawTextBox(p(2), font, P.domChar, L.p3.domChar, { maxLines: L.p3.domChar.maxLines });
    if (L.p3?.domDesc && P.domDesc) drawTextBox(p(2), font, P.domDesc, L.p3.domDesc, { maxLines: L.p3.domDesc.maxLines });

    /* ───── p4 (spider notes) ───── */
    if (L.p4?.spiderfreq && P.spiderfreq) drawTextBox(p(3), font, P.spiderfreq, L.p4.spiderfreq);
    if (L.p4?.spiderdesc && P.spiderdesc) {
      const base = P.spiderdesc;
      const desc = tokenizeSpiderDesc(base, q.shape, q.order, q.counts, q.max, q);
      drawTextBox(p(3), font, desc, L.p4.spiderdesc);
    }

    /* ───── p5 (sequence/pattern) ───── */
    if (L.p5?.seqpat && P.seqpat) drawTextBox(p(4), font, P.seqpat, L.p5.seqpat);

    /* ───── p6 (theme + explanation) ───── */
    if (L.p6?.theme && P.theme) {
      const maxLines = (L.p6.theme.maxLines ?? L.p6.themeMaxLines ?? 12);
      drawTextBox(p(5), font, P.theme, { ...L.p6.theme, maxLines }, { maxLines });
    }
    if (L.p6?.themeExpl && P.themeExpl) {
      const maxLines = (L.p6.themeExpl.maxLines ?? L.p6.themeExplMaxLines ?? 12);
      drawTextBox(p(5), font, P.themeExpl, { ...L.p6.themeExpl, maxLines }, { maxLines });
    }

    /* ───── p10 body (if used in your template) ───── */
    if (L.p10?.bodyPara && P.bodyPara) {
      const bx = L.p10.bodyPara;
      drawTextBox(p(9), font, P.bodyPara, { x: bx.x, y: bx.y, w: bx.w, size: L.p10.bodySize || 13, align: "left" }, { maxLines: L.p10.maxLines || 15 });
    }

    /* ───── p11 (tips + actions; hanging indents; strip 'Tip:' prefix) ───── */
    if (L.p11?.split) {
      const clean = s =>
        norm(String(s || ""))
          .replace(/^(?:[-–—•·]\s*)?(?:tip\s*:?\s*)/i, "")
          .trim();

      const pairs = [
        { txt: clean(P.tips?.[0]),    box: L.p11.tips1 },
        { txt: clean(P.tips?.[1]),    box: L.p11.tips2 },
        { txt: clean(P.actions?.[0]), box: L.p11.acts1 },
        { txt: clean(P.actions?.[1]), box: L.p11.acts2 }
      ];

      for (const { txt, box } of pairs) {
        if (!txt || !box) continue;
        const indent = N(L.p11.bulletIndent, 18);
        const size   = box.size || 18;
        const maxL   = box.maxLines || 4;

        const dashX = box.x + Math.max(2, indent - 10);
        drawTextBox(p(10), font, "-", { x: dashX, y: box.y, w: 8, size, align: "left" }, { maxLines: 1 });

        drawTextBox(
          p(10), font, txt,
          { x: box.x + indent, y: box.y, w: box.w - indent, size, align: box.align || "left" },
          { maxLines: maxL }
        );
      }
    }

    /* ───── footers (show participant name) ───── */
    const footerLabel = norm(P.name);
    const putFooter = (pageIdx, key) => {
      const spec = L.footer?.[key];
      if (!spec) return;
      drawTextBox(p(pageIdx), font, footerLabel, spec, { maxLines: 1 });
    };
    putFooter(1, "f2");  putFooter(2, "f3");  putFooter(3, "f4");
    putFooter(4, "f5");  putFooter(5, "f6");  putFooter(6, "f7");
    putFooter(7, "f8");  putFooter(8, "f9");  putFooter(9, "f10");
    putFooter(10,"f11"); putFooter(11,"f12");

    /* ───── output ───── */
    const bytes   = await pdfDoc.save();
    const nameOut = S(q.out || `CTRL_${P.name || "Perspective"}_${P.dateLbl || ""}.pdf`).replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nameOut}"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.status(400).json({ ok: false, error: `fill-template error: ${err.message || String(err)}` });
  }
}
