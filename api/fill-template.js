/** **********************************************************************
 * CTRL Export Service · fill-template (Perspective flow)
 * Template: /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
 *
 * Pages:
 *  p1  cover                     (name/date are locked by template design)
 *  p3  dominant + description + state highlight  (exporter-style geometry)
 *  p4  spider copy + chart image
 *  p5  sequence/pattern copy
 *  p6  theme pair copy
 *  p7  LOOK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].look)
 *  p8  WORK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].work)
 *  p9  LOOK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].look)
 *  p10 WORK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].work)
 *  p11 Tips & Actions      (two bulleted columns)
 *  p12 (no body)           (footer only)
 *
 * URL tuners (examples):
 *  ?p7_col0_x=60&y=140&w=300&h=120   (C box on p7)   · p7_col1..col3 for T,R,L
 *  ?p8_col2_x=60&y=270&w=300&h=120   (R box on p8)
 *  ?p9_ldr1_x=410&y=140&w=300&h=120  (T box on p9)   · p9_ldr0..ldr3 for C,T,R,L
 *  ?p10_ldr3_x=410&y=270&w=300&h=120 (L box on p10)
 *  ?p11_tipsHdr_x=30&y=500&w=300&size=17
 *  ?p11_tipsBox_x=30&y=530&w=300&size=11
 *  ?p11_actsHdr_x=320&y=500&w=300&size=17
 *  ?p11_actsBox_x=320&y=530&w=300&size=11
 *  ?n11_x=205&y=49.5&size=15&align=center  · same for n12
 *
 * WinAnsi crash fix (Option 1):
 *  - Strip surrogate pairs + Private Use + VS-16/FE0F / zero-width
 *  - Normalize quotes/dashes; collapse weird whitespace
 *
 * Strictly local template:
 *  - tpl must be a filename present in /public (no http(s): accepted)
 *********************************************************************** */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────────────────────── Utilities ───────────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);

/** WinAnsi “Option 1” sanitizer (remove/replace non-encodable glyphs) */
const norm = (v, fb = "") =>
  S(v, fb)
    // normal punctuation first (keep WinAnsi-friendly typographic chars)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")             // ellipsis
    .replace(/\u00A0/g, " ")               // nbsp → space
    // kill troublesome glyphs that break WinAnsi (emoji, PUA, VS, ZW)
    .replace(/[\uD800-\uDFFF]/g, "")       // surrogate pairs (all emoji)
    .replace(/[\uE000-\uF8FF]/g, "")       // private use area
    .replace(/[\uFE0E\uFE0F]/g, "")        // variation selectors 15/16
    .replace(/[\u200B-\u200D\u2060]/g, "") // zero-width chars
    // tidy whitespace
    .replace(/\t/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    // ASCII control cleanup (keep \n, \r stripped earlier)
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "")
    .trim();

const todayLbl = () => {
  const now = new Date();
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
  return `${String(now.getDate()).padStart(2,"0")}/${MMM}/${now.getFullYear()}`;
};

const ensureArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** base64url → JSON (accepts base64 or base64url) */
function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try {
    const raw = Buffer.from(s, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch { return {}; }
}

/* ─────────────────────────── Drawing helpers ───────────────────────── */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const hard = S(text || "");
  const lines = hard.split(/\n/).map((s) => s.trim());
  const wrapped = [];

  const widthOf = (s) => font.widthOfTextAtSize(s, Math.max(1, size));
  const wrapLine = (ln) => {
    const words = ln.split(/\s+/);
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const nxt = cur ? `${cur} ${words[i]}` : words[i];
      if (widthOf(nxt) <= w || !cur) {
        cur = nxt;
      } else {
        wrapped.push(cur);
        cur = words[i];
      }
    }
    wrapped.push(cur);
  };

  for (const ln of lines) wrapLine(ln);

  const out = wrapped.length > maxLines
    ? wrapped.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, "…") : s))
    : wrapped;

  const pageH   = page.getHeight();
  const yTop    = pageH - y; // TL → BL
  const lineH   = Math.max(1, size) + lineGap;

  let yCursor = yTop;
  let drawn = 0;

  for (let i = 0; i < out.length; i++) {
    const ln = out[i] ?? "";
    if (!ln && i !== out.length - 1) { yCursor -= lineH; drawn++; continue; }
    let xDraw = x;
    const wLn = widthOf(ln);
    if (align === "center") xDraw = x + (w - wLn) / 2;
    else if (align === "right") xDraw = x + (w - wLn);
    page.drawText(ln, { x: xDraw, y: yCursor - size, size: Math.max(1, size), font, color });
    yCursor -= lineH;
    drawn++;
  }
  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

function drawBulleted(page, font, items, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 11, lineGap = 3,
    bullet = "•", gap = 6, align = "left",
    color = rgb(0, 0, 0),
  } = spec;

  const maxLines = opts.maxLines ?? 12;

  const arr = ensureArray(items).map(s => norm(s));
  const pageH = page.getHeight();
  let yCursor = pageH - y;
  const lineH = Math.max(1, size) + lineGap;

  for (const raw of arr) {
    if (!raw) continue;
    const lines = raw.split(/\n/).filter(Boolean);
    const head = `${bullet} ${lines.shift()}`;
    drawTextBox(page, font, head, { x, y: pageH - yCursor, w, size, lineGap, align, color }, { maxLines: 1 });
    yCursor -= lineH;
    for (const cont of lines) {
      drawTextBox(page, font, `   ${cont}`, { x, y: pageH - yCursor, w, size, lineGap, align, color }, { maxLines: 1 });
      yCursor -= lineH;
    }
    if ((pageH - yCursor) / lineH > maxLines) break;
  }
}

function drawTextInBox(page, font, text, box, size = 10, align = "left", opts = {}) {
  const spec = { x: N(box.x), y: N(box.y), w: N(box.w), size: N(size), align };
  return drawTextBox(page, font, S(text), spec, opts);
}

/* State highlight (p3). Uses absolute rects by default; tunable via URL) */
function paintStateHighlight(page3, dom, cfg = {}) {
  const b = (cfg.absBoxes && cfg.absBoxes[dom]) || null;
  if (!b) return;

  const radius   = Number.isFinite(+((cfg.styleByState||{})[dom]?.radius)) ? +((cfg.styleByState||{})[dom].radius) : N(cfg.highlightRadius, 28);
  const inset    = Number.isFinite(+((cfg.styleByState||{})[dom]?.inset))   ? +((cfg.styleByState||{})[dom].inset)   : N(cfg.highlightInset, 6);
  const opacity  = Number.isFinite(+cfg.fillOpacity) ? +cfg.fillOpacity : 0.45;
  const blX      = N(b.x) + inset;
  const blY      = N(b.y) + inset;
  const ww       = N(b.w) - inset * 2;
  const hh       = N(b.h) - inset * 2;

  const shade = rgb(251/255, 236/255, 250/255);

  page3.drawRectangle({
    x: blX, y: blY, width: ww, height: hh,
    borderRadius: radius, color: shade, opacity
  });

  // Label
  const perState = (cfg.labelByState && cfg.labelByState[dom]) || null;
  const offX = N(cfg.labelOffsetX, 0);
  const offY = N(cfg.labelOffsetY, 0);
  let lx, ly;
  if (perState && Number.isFinite(+perState.x) && Number.isFinite(+perState.y)) {
    lx = +perState.x; ly = +perState.y;
  } else {
    // reasonable fallback to center-top/bottom depending on quadrant
    const cx = b.x + b.w / 2;
    const py = (dom === "C" || dom === "T") ? (b.y + b.h - N(cfg.labelPadTop, 12)) : (b.y + N(cfg.labelPadBottom, 12));
    lx = cx; ly = py;
  }
  return { labelX: lx + offX, labelY: ly + offY };
}

/* Resolve dominant key from text/labels/chars */
function resolveDomKey(...candidates) {
  const mapLabel = { concealed: "C", triggered: "T", regulated: "R", lead: "L" };
  const mapChar  = { art: "C", fal: "T", mika: "R", sam: "L" };
  const cand = candidates.flat().map(x => String(x || "").trim());
  for (const c of cand) {
    if (!c) continue;
    const u = c.toUpperCase();
    if (["C","T","R","L"].includes(u)) return u;
    const l = c.toLowerCase();
    if (mapLabel[l]) return mapLabel[l];
    if (mapChar[l])  return mapChar[l];
  }
  return "";
}

/* ─────────────────────────── Input normalisation ─────────────────────────── */
function normaliseInput(d = {}) {
  const P = {};
  P.flow      = norm(d.f || d.flow || "Perspective");
  P.name      = norm(d.n || d.name);
  P.dateLbl   = norm(d.d || d.date || todayLbl());
  P.dom       = resolveDomKey(d.dom, d.dom6Key, d.dom6Label, d.domchar, d.domdesc);
  P.domChar   = norm(d.domchar || d.domChar || d.character || "");
  P.domDesc   = norm(d.domdesc || d.domDesc || d.dominantDesc || "");

  P.spiderTxt = norm(d.spiderdesc || d.spiderdesc || d.spider || "");
  P.chartUrl  = S(d.spiderfreq || d.chart || "");

  P.seqpat    = norm(d.seqpat || d.pattern || "");
  P.theme     = norm(d.theme || "");

  P.workwcol  = ensureArray(d.workwcol).map(x => ({
    mine:  norm(x?.mine),  their: norm(x?.their),
    look:  norm(x?.look),  work:  norm(x?.work)
  }));
  P.workwlead = ensureArray(d.workwlead).map(x => ({
    mine:  norm(x?.mine),  their: norm(x?.their),
    look:  norm(x?.look),  work:  norm(x?.work)
  }));

  P.tips      = ensureArray(d.tips).map(norm);
  P.actions   = ensureArray(d.actions).map(norm);

  return P;
}

/* ───────────────────────── Default coordinates (safe, tunable) ───────────── */

const LOCKED = {
  p1: {
    name: { x: 7,   y: 473,  w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600,  w: 500, size: 25, align: "left"   }
  },
  footer: (() => {
    // Same baseline for 2–9, 11–12; p10 uses different default
    const one = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
    return {
      n2:{...one}, n3:{...one}, n4:{...one}, n5:{...one}, n6:{...one},
      n7:{...one}, n8:{...one}, n9:{...one},
      n10: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      n11:{...one}, n12:{...one}
    };
  })()
};

const DEFAULT_COORDS = {
  meta:  { units: "pt", origin: "TL", pages: "1-based" },

  // PAGE 3 — text + state highlight
  p3: {
    domChar: { x:  60, y: 170, w: 650, size: 11, align: "left"  },
    domDesc: { x:  60, y: 200, w: 650, size: 11, align: "left"  },
    state: {
      useAbsolute: true,
      shape: "round",
      highlightRadius: 28,
      highlightInset: 6,
      fillOpacity: 0.45,
      styleByState: {
        C: { radius: 28,   inset: 6  },
        T: { radius: 28,   inset: 6  },
        R: { radius: 1000, inset: 1  }, // pill
        L: { radius: 28,   inset: 6  }
      },
      labelByState: {
        C: { x: 150, y: 245 },
        T: { x: 390, y: 244 },
        R: { x: 150, y: 612 },
        L: { x: 390, y: 605 }
      },
      labelText: "YOU ARE HERE",
      labelSize: 10,
      labelColor: { r: 0.20, g: 0.20, b: 0.20 },
      labelOffsetX: 0, labelOffsetY: 0,
      labelPadTop: 12, labelPadBottom: 12,
      absBoxes: {
        R: { x:  60, y: 433, w: 188, h: 158 },
        C: { x:  58, y: 258, w: 188, h: 156 },
        T: { x: 299, y: 258, w: 188, h: 156 },
        L: { x: 298, y: 440, w: 188, h: 156 }
      },
      grid: { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 }
    }
  },

  // PAGE 4
  p4: { spider: { x:  60, y: 320, w: 280, size: 11, align: "left" },
        chart:  { x: 360, y: 320, w: 260, h: 260 } },

  // PAGE 5
  p5: { seqpat: { x:  60, y: 160, w: 650, size: 11, align: "left" } },

  // PAGE 6
  p6: { theme:  { x:  60, y: 160, w: 650, size: 11, align: "left" } },

  // PAGE 7 — LOOK · colleagues
  p7: {
    header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
    colBoxes: [
      { x:  60, y: 140, w: 300, h: 120 },  // C
      { x: 410, y: 140, w: 300, h: 120 },  // T
      { x:  60, y: 270, w: 300, h: 120 },  // R
      { x: 410, y: 270, w: 300, h: 120 }   // L
    ],
    bodySize: 10, maxLines: 9
  },

  // PAGE 8 — WORK · colleagues
  p8: {
    header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
    colBoxes: [
      { x:  60, y: 140, w: 300, h: 120 },
      { x: 410, y: 140, w: 300, h: 120 },
      { x:  60, y: 270, w: 300, h: 120 },
      { x: 410, y: 270, w: 300, h: 120 }
    ],
    bodySize: 10, maxLines: 9
  },

  // PAGE 9 — LOOK · leaders
  p9: {
    header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
    ldrBoxes: [
      { x:  60, y: 140, w: 300, h: 120 },  // C
      { x: 410, y: 140, w: 300, h: 120 },  // T
      { x:  60, y: 270, w: 300, h: 120 },  // R
      { x: 410, y: 270, w: 300, h: 120 }   // L
    ],
    bodySize: 10, maxLines: 9
  },

  // PAGE 10 — WORK · leaders
  p10: {
    header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
    ldrBoxes: [
      { x:  60, y: 140, w: 300, h: 120 },
      { x: 410, y: 140, w: 300, h: 120 },
      { x:  60, y: 270, w: 300, h: 120 },
      { x: 410, y: 270, w: 300, h: 120 }
    ],
    bodySize: 10, maxLines: 9
  },

  // PAGE 11 — Tips + Actions
  p11: {
    tipsHdr: { x:  30, y: 500, w: 300, size: 17, align: "left" },
    actsHdr: { x: 320, y: 500, w: 300, size: 17, align: "left" },
    tipsBox: { x:  30, y: 530, w: 300, size: 11, align: "left" },
    actsBox: { x: 320, y: 530, w: 300, size: 11, align: "left" },
    maxLines: 12
  }
};

/* Merge defaults + optional payload layout + URL tuners */
function buildLayout(base) {
  const L = JSON.parse(JSON.stringify(DEFAULT_COORDS));
  if (base && typeof base === "object") {
    for (const k of Object.keys(base)) {
      if (k === "meta") continue;
      L[k] = { ...(L[k] || {}), ...(base[k] || {}) };
    }
  }
  L.footer = { ...(LOCKED.footer), ...((base && base.footer) || {}) };
  return L;
}

function applyUrlTuners(q, L) {
  const pick = (obj, keys) => keys.reduce((o, k) => (q[k] != null ? (o[k] = q[k], o) : o), {});

  // Footers n2..n12
  for (const pn of ["n2","n3","n4","n5","n6","n7","n8","n9","n10","n11","n12"]) {
    const spec = pick(q, [`${pn}_x`, `${pn}_y`, `${pn}_w`, `${pn}_size`, `${pn}_align`]);
    if (Object.keys(spec).length) {
      L.footer[pn] = { ...(L.footer[pn]||{}),
        x:N(spec[`${pn}_x`],L.footer[pn]?.x), y:N(spec[`${pn}_y`],L.footer[pn]?.y),
        w:N(spec[`${pn}_w`],L.footer[pn]?.w), size:N(spec[`${pn}_size`],L.footer[pn]?.size),
        align:S(spec[`${pn}_align`],L.footer[pn]?.align)
      };
    }
  }

  // p3 domChar/domDesc
  for (const f of ["domChar","domDesc"]) {
    const P = pick(q, [`p3_${f}_x`,`p3_${f}_y`,`p3_${f}_w`,`p3_${f}_size`,`p3_${f}_align`]);
    if (Object.keys(P).length) L.p3[f] = { ...(L.p3[f]||{}),
      x:N(P[`p3_${f}_x`],L.p3[f]?.x), y:N(P[`p3_${f}_y`],L.p3[f]?.y),
      w:N(P[`p3_${f}_w`],L.p3[f]?.w), size:N(P[`p3_${f}_size`],L.p3[f]?.size),
      align:S(P[`p3_${f}_align`],L.p3[f]?.align)
    };
  }

  // p7/p8 colleagues boxes
  for (const p of ["p7","p8"]) {
    for (let i=0;i<4;i++) {
      const key = `${p}_col${i}`;
      const P = pick(q, [`${key}_x`,`${key}_y`,`${key}_w`,`${key}_h`]);
      if (Object.keys(P).length) {
        L[p].colBoxes[i] = { ...(L[p].colBoxes[i]||{}),
          x:N(P[`${key}_x`],L[p].colBoxes[i]?.x),
          y:N(P[`${key}_y`],L[p].colBoxes[i]?.y),
          w:N(P[`${key}_w`],L[p].colBoxes[i]?.w),
          h:N(P[`${key}_h`],L[p].colBoxes[i]?.h)
        };
      }
    }
  }

  // p9/p10 leader boxes
  for (const p of ["p9","p10"]) {
    for (let i=0;i<4;i++) {
      const key = `${p}_ldr${i}`;
      const P = pick(q, [`${key}_x`,`${key}_y`,`${key}_w`,`${key}_h`]);
      if (Object.keys(P).length) {
        L[p].ldrBoxes[i] = { ...(L[p].ldrBoxes[i]||{}),
          x:N(P[`${key}_x`],L[p].ldrBoxes[i]?.x),
          y:N(P[`${key}_y`],L[p].ldrBoxes[i]?.y),
          w:N(P[`${key}_w`],L[p].ldrBoxes[i]?.w),
          h:N(P[`${key}_h`],L[p].ldrBoxes[i]?.h)
        };
      }
    }
  }

  // p11 tips/actions
  for (const f of ["tipsHdr","actsHdr","tipsBox","actsBox"]) {
    const P = pick(q, [`p11_${f}_x`,`p11_${f}_y`,`p11_${f}_w`,`p11_${f}_size`,`p11_${f}_align`]);
    if (Object.keys(P).length) {
      L.p11[f] = { ...(L.p11[f]||{}),
        x:N(P[`p11_${f}_x`],L.p11[f]?.x), y:N(P[`p11_${f}_y`],L.p11[f]?.y),
        w:N(P[`p11_${f}_w`],L.p11[f]?.w), size:N(P[`p11_${f}_size`],L.p11[f]?.size),
        align:S(P[`p11_${f}_align`],L.p11[f]?.align)
      };
    }
  }

  return L;
}

/* ───────────────────────────── Template loader ───────────────────────────── */
async function loadTemplateBytes(tplParam) {
  const raw = S(tplParam || "CTRL_Perspective_Assessment_Profile_template_slim.pdf").trim();
  if (/^https?:/i.test(raw)) {
    throw new Error("Remote templates are not allowed. Put the PDF in /public and pass its filename.");
  }
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "");
  if (!safe || !/\.pdf$/i.test(safe)) {
    throw new Error("Invalid tpl. Provide a .pdf filename that exists in /public.");
  }
  const full = path.resolve(process.cwd(), "public", safe);
  try {
    return await fs.readFile(full);
  } catch {
    throw new Error(`Template not found at ${full}`);
  }
}

/* ───────────────────────────────── Handler ───────────────────────────────── */
export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const tpl = q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim.pdf";

    // Parse & sanitize payload
    const rawData = parseDataParam(q.data);
    const P = normaliseInput(rawData);

    // Build layout (defaults + optional overrides + URL tuners)
    let L = buildLayout(rawData.layoutV6);
    L.footer = { ...(LOCKED.footer), ...(rawData?.layoutV6?.footer || {}), ...(L.footer || {}) };
    L = applyUrlTuners(q, L);

    // Load template
    const tplBytes = await loadTemplateBytes(tpl);
    const pdfDoc   = await PDFDocument.load(tplBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Page helpers (1-based in comments, 0-based indexing)
    const p  = (n) => pdfDoc.getPages()[n];

    const page1  = p(0);
    const page3  = p(2);
    const page4  = p(3);
    const page5  = p(4);
    const page6  = p(5);
    const page7  = p(6);
    const page8  = p(7);
    const page9  = p(8);
    const page10 = p(9);
    const page11 = p(10);
    const page12 = p(11); // exists as footer-only

    /* ----------------------------- PAGE 1 ----------------------------- */
    // (Name/Date are typically pre-rendered in the template. Only write if present.)
    if (L.p1?.name && P.name)  drawTextBox(page1, font, norm(P.name),  L.p1.name);
    if (L.p1?.date && P.dateLbl) drawTextBox(page1, font, norm(P.dateLbl), L.p1.date);

    /* ----------------------------- PAGE 3 ----------------------------- */
    if (P.domChar) drawTextBox(page3, font, P.domChar, L.p3.domChar);
    if (P.domDesc) drawTextBox(page3, font, P.domDesc, L.p3.domDesc);

    const dom = resolveDomKey(P.dom, P.domChar, P.domDesc);
    if (dom) {
      const anchor = paintStateHighlight(page3, dom, L.p3.state || {});
      if (anchor && (L.p3.state?.labelText || "").trim()) {
        const spec = {
          x: anchor.labelX, y: anchor.labelY, w: 180,
          size: N(L.p3.state.labelSize, 10),
          align: "center",
        };
        drawTextBox(page3, font, S(L.p3.state.labelText), spec, { maxLines: 1 });
      }
    }

    /* ----------------------------- PAGE 4 ----------------------------- */
    if (P.spiderTxt) drawTextBox(page4, font, P.spiderTxt, L.p4.spider);
    if (P.chartUrl) {
      // (Leave chart embedding to your upstream if you render images externally)
      // You can optionally draw a placeholder label.
      drawTextBox(page4, font, "", L.p4.chart);
    }

    /* ----------------------------- PAGE 5 ----------------------------- */
    if (P.seqpat) drawTextBox(page5, font, P.seqpat, L.p5.seqpat);

    /* ----------------------------- PAGE 6 ----------------------------- */
    if (P.theme) drawTextBox(page6, font, P.theme, L.p6.theme);

    /* ----------------------------- PAGE 7 ----------------------------- *
       LOOK — colleagues                                                  */
    if (L.p7?.colBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p7.colBoxes[i];
        // source: P.workwcol (pick .look)
        const item = P.workwcol.find(x => S(x?.mine).toUpperCase() === "R" ? (k==="R")
                      : S(x?.mine).toUpperCase() === k || S(x?.their).toUpperCase() === k) || P.workwcol[i] || {};
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page7, font, txt, bx, L.p7.bodySize || 10, "left", { maxLines: N(L.p7.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 8 ----------------------------- *
       WORK — colleagues                                                  */
    if (L.p8?.colBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p8.colBoxes[i];
        const item = P.workwcol.find(x => S(x?.mine).toUpperCase() === "R" ? (k==="R")
                      : S(x?.mine).toUpperCase() === k || S(x?.their).toUpperCase() === k) || P.workwcol[i] || {};
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page8, font, txt, bx, L.p8.bodySize || 10, "left", { maxLines: N(L.p8.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 9 ----------------------------- *
       LOOK — leaders                                                     */
    if (L.p9?.ldrBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p9.ldrBoxes[i];
        const item = P.workwlead.find(x => S(x?.mine).toUpperCase() === "R" ? (k==="R")
                      : S(x?.mine).toUpperCase() === k || S(x?.their).toUpperCase() === k) || P.workwlead[i] || {};
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page9,  font, txt, bx, L.p9.bodySize || 10, "left", { maxLines: N(L.p9.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 10 ---------------------------- *
       WORK — leaders                                                     */
    if (L.p10?.ldrBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p10.ldrBoxes[i];
        const item = P.workwlead.find(x => S(x?.mine).toUpperCase() === "R" ? (k==="R")
                      : S(x?.mine).toUpperCase() === k || S(x?.their).toUpperCase() === k) || P.workwlead[i] || {};
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page10, font, txt, bx, L.p10.bodySize || 10, "left", { maxLines: N(L.p10.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 11 ---------------------------- *
       Tips & Actions (bulleted)                                          */
    if (P.tips?.length || P.actions?.length) {
      if (L.p11?.tipsHdr) drawTextBox(page11, font, "Tips",    L.p11.tipsHdr, { maxLines: 1 });
      if (L.p11?.actsHdr) drawTextBox(page11, font, "Actions", L.p11.actsHdr, { maxLines: 1 });
      if (L.p11?.tipsBox && P.tips?.length) {
        drawBulleted(page11, font, P.tips,    L.p11.tipsBox, { maxLines: N(L.p11.maxLines, 12) });
      }
      if (L.p11?.actsBox && P.actions?.length) {
        drawBulleted(page11, font, P.actions, L.p11.actsBox, { maxLines: N(L.p11.maxLines, 12) });
      }
    }

    /* ------------------------------ FOOTERS --------------------------- */
    const pages = pdfDoc.getPages();
    const footerSpec = L.footer || LOCKED.footer;
    const putN = (idx, key) => {
      const spec = footerSpec[key];
      if (!spec) return;
      const pn = String(idx + 1); // human 1-based
      drawTextBox(pages[idx], font, pn, spec, { maxLines: 1 });
    };
    putN(1,  "n2");   putN(2,  "n3");  putN(3,  "n4");  putN(4,  "n5");
    putN(5,  "n6");   putN(6,  "n7");  putN(7,  "n8");  putN(8,  "n9");
    putN(9,  "n10");  putN(10, "n11"); putN(11, "n12");

    // Save output
    const bytes = await pdfDoc.save();
    const outName = S(q.name || `CTRL_${P.name || "Perspective"}_${P.dateLbl || todayLbl()}.pdf`).replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.status(400).json({ ok:false, error: `fill-template error: ${err.message || String(err)}` });
  }
}
