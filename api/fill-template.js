/** **********************************************************************
 * CTRL Export Service · fill-template (Perspective flow)
 * Template: /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
 *
 * Pages:
 *  p1  cover (name/date)
 *  p3  dominant + description + state highlight (absolute geometry)
 *  p4  spider copy + chart image
 *  p5  sequence/pattern copy
 *  p6  theme pair copy
 *  p7  LOOK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].look)
 *  p8  WORK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].work)
 *  p9  LOOK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].look)
 *  p10 WORK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].work)
 *  p11 Tips & Actions      (two bulleted columns; NO headers)
 *  p12 (footer only)
 *
 * Tuners (highlights):
 *  • p1:  p1_name_*  / p1_date_*    (x,y,w,size,align)
 *  • p3 text: p3_domChar_* + p3_domChar_maxLines
 *              p3_domDesc_* + p3_domDesc_maxLines
 *  • p3 state (aliases you asked for):
 *        state_useAbs=1&state_shape=round&state_radius=28&state_inset=6&state_opacity=0.45
 *        abs_R_x/y/w/h  · abs_C_*  · abs_T_*  · abs_L_*
 *        labelRLx/labelRLy  (R & L)    ·   labelCTx/labelCTy (C & T)
 *        labelText=YOU%20ARE%20HERE&labelSize=10
 *        (legacy p3_state_* also supported)
 *  • p4 spider text:  p4_spider_* + p4_spider_maxLines
 *     chart img box:  p4_chart_x/y/w/h
 *  • p5 seq/pattern:  p5_seqpat_* + p5_seqpat_maxLines
 *  • p6 theme:        p6_theme_* (+ p6_theme_maxLines)
 *  • p7/p8:           p7_bodySize, p7_maxLines, p7_col0..3_(x|y|w|h)
 *                     p8_bodySize, p8_maxLines, p8_col0..3_(x|y|w|h)
 *  • p9/p10:          p9_bodySize, p9_maxLines, p9_ldr0..3_(x|y|w|h)
 *                     p10_bodySize, p10_maxLines, p10_ldr0..3_(x|y|w|h)
 *  • p11 columns:     p11_tipsBox_* + p11_tipsBox_maxLines
 *                     p11_actsBox_* + p11_actsBox_maxLines
 *  • Footers (name only; no page numbers): f2..f12 _(x|y|w|size|align)
 *
 * Strict local template: tpl must be a filename in /public (no http(s)).
 *********************************************************************** */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────────────────────── Utilities ───────────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);

/** WinAnsi “Option 1” sanitizer */
const norm = (v, fb = "") =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/\t/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "")
    .trim();

const todayLbl = () => {
  const now = new Date();
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
  return `${String(now.getDate()).padStart(2,"0")}/${MMM}/${now.getFullYear()}`;
};

const ensureArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** base64url → JSON */
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
  const yTop    = pageH - y; // TL → BL baseline
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
    yCursor -= lineH; drawn++;
  }
  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

function drawBulleted(page, font, items, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 11, lineGap = 3,
    bullet = "•", align = "left", color = rgb(0, 0, 0)
  } = spec;

  const maxLines = opts.maxLines ?? 12;
  const arr = ensureArray(items).map(s => norm(s));
  const pageH = page.getHeight();
  const lineH = Math.max(1, size) + lineGap;
  let used = 0;
  let yCursor = pageH - y;

  for (const raw of arr) {
    if (!raw) continue;
    const lines = raw.split(/\n/).filter(Boolean);
    const head = `${bullet} ${lines.shift()}`;
    drawTextBox(page, font, head, { x, y: pageH - yCursor, w, size, lineGap, align, color }, { maxLines: 1 });
    yCursor -= lineH; used++;
    for (const cont of lines) {
      drawTextBox(page, font, `   ${cont}`, { x, y: pageH - yCursor, w, size, lineGap, align, color }, { maxLines: 1 });
      yCursor -= lineH; used++;
      if (used >= maxLines) return;
    }
    if (used >= maxLines) return;
  }
}

function drawTextInBox(page, font, text, box, size = 10, align = "left", opts = {}) {
  const spec = { x: N(box.x), y: N(box.y), w: N(box.w), size: N(size), align };
  return drawTextBox(page, font, S(text), spec, opts);
}

const rectTLtoBL = (page, box, inset = 0) => {
  const pageH = page.getHeight();
  const x = N(box.x) + inset;
  const w = Math.max(0, N(box.w) - inset * 2);
  const h = Math.max(0, N(box.h) - inset * 2);
  const y = pageH - N(box.y) - N(box.h) + inset;
  return { x, y, w, h };
};

/* State highlight (p3) */
function paintStateHighlight(page3, dom, cfg = {}) {
  const box = (cfg.absBoxes && cfg.absBoxes[dom]) || null;
  if (!box) return;

  const radius  = Number.isFinite(+((cfg.styleByState||{})[dom]?.radius)) ? +((cfg.styleByState||{})[dom].radius) : N(cfg.highlightRadius, 28);
  const inset   = Number.isFinite(+((cfg.styleByState||{})[dom]?.inset))   ? +((cfg.styleByState||{})[dom].inset)   : N(cfg.highlightInset, 6);
  const opacity = Number.isFinite(+cfg.fillOpacity) ? +cfg.fillOpacity : 0.45;

  const boxBL = rectTLtoBL(page3, box, inset);
  const shade = rgb(251/255, 236/255, 250/255);

  page3.drawRectangle({
    x: boxBL.x, y: boxBL.y, width: boxBL.w, height: boxBL.h,
    // pdf-lib doesn't natively round corners; keeping 'radius' as a hint; rectangle stays rectangular in most builds.
    color: shade, opacity
  });

  const perState = (cfg.labelByState && cfg.labelByState[dom]) || null;
  const offX = N(cfg.labelOffsetX, 0);
  const offY = N(cfg.labelOffsetY, 0);

  let lx, ly;
  if (perState && Number.isFinite(+perState.x) && Number.isFinite(+perState.y)) {
    lx = +perState.x; ly = +perState.y;
  } else {
    const cx = box.x + box.w / 2;
    const py = (dom === "C" || dom === "T")
      ? (box.y + box.h - N(cfg.labelPadTop, 12))
      : (box.y + N(cfg.labelPadBottom, 12));
    lx = cx; ly = py;
  }
  return { labelX: lx + offX, labelY: ly + offY };
}

/* Resolve dominant key from text/labels/chars */
function resolveDomKey(...cands) {
  const mapLabel = { concealed: "C", triggered: "T", regulated: "R", lead: "L" };
  const mapChar  = { art: "C", fal: "T", mika: "R", sam: "L" };
  const cand = cands.flat().map(x => String(x || "").trim());
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

  P.spiderTxt = norm(d.spiderdesc || d.spider || "");
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

/* ───────────────────────── Locked defaults (as requested) ────────────────── */

const LOCKED = {
  // p1 defaults (locked)
  p1: {
    name: { x:  7,  y: 473, w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600, w: 500, size: 25, align: "left"   },
  },

  // Footers: NAME ONLY (no flow/date, no page numbers)
  footer: (() => {
    const f = { x: 380, y: 51, w: 400, size: 13, align: "left" };
    return {
      f2:{...f}, f3:{...f}, f4:{...f}, f5:{...f}, f6:{...f}, f7:{...f},
      f8:{...f}, f9:{...f}, f10:{...f}, f11:{...f}, f12:{...f}
    };
  })()
};

const DEFAULT_COORDS = {
  meta:  { units: "pt", origin: "TL", pages: "1-based" },

  // PAGE 1
  p1: { ...LOCKED.p1 },

  // PAGE 3 — text + state highlight
  p3: {
    domChar:  { x: 272, y: 640, w: 630, size: 23, align: "left" },
    domDesc:  { x:  25, y: 685, w: 550, size: 18, align: "left" },
    domCharMaxLines: 6,
    domDescMaxLines: 12,
    state: {
      useAbsolute: true,
      shape: "round",
      highlightRadius: 28,
      highlightInset: 6,
      fillOpacity: 0.45,
      styleByState: {
        C: { radius: 28,   inset: 6  },
        T: { radius: 28,   inset: 6  },
        R: { radius: 1000, inset: 1  },
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
      }
    }
  },

  // PAGE 4
  p4: {
    spider: { x:  30, y: 585, w: 550, size: 18, align: "left" },
    spiderMaxLines: 10,
    chart:  { x:  20, y: 225, w: 570, h: 280 }
  },

  // PAGE 5
  p5: {
    seqpat: { x:  25, y: 250, w: 550, size: 18, align: "left" },
    seqpatMaxLines: 12
  },

  // PAGE 6
  p6: {
    theme:  { x:  25, y: 350, w: 550, size: 18, align: "left" },
    themeMaxLines: 12
  },

  // PAGE 7 — LOOK · colleagues
  p7: {
    header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
    colBoxes: [
      { x:  40, y: 240, w: 300, h: 120 },  // C
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
      { x:  60, y: 140, w: 300, h: 120 },  // C
      { x: 410, y: 140, w: 300, h: 120 },  // T
      { x:  60, y: 270, w: 300, h: 120 },  // R
      { x: 410, y: 270, w: 300, h: 120 }   // L
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
      { x:  60, y: 140, w: 300, h: 120 },  // C
      { x: 410, y: 140, w: 300, h: 120 },  // T
      { x:  60, y: 270, w: 300, h: 120 },  // R
      { x: 410, y: 270, w: 300, h: 120 }   // L
    ],
    bodySize: 10, maxLines: 9
  },

  // PAGE 11 — Tips + Actions (no headers)
  p11: {
    tipsBox: { x:  40, y: 175, w: 315, size: 18, align: "left" },
    actsBox: { x:  40, y: 355, w: 315, size: 18, align: "left" },
    tipsMaxLines: 12, actsMaxLines: 12
  },

  // footer defaults
  footer: { ...LOCKED.footer }
};

/* Merge defaults + optional payload layout + tuners */
function buildLayout(base) {
  const L = JSON.parse(JSON.stringify(DEFAULT_COORDS));
  if (base && typeof base === "object") {
    for (const k of Object.keys(base)) {
      if (k === "meta") continue;
      if (k === "footer") continue; // start from LOCKED footer
      L[k] = { ...(L[k] || {}), ...(base[k] || {}) };
    }
  }
  L.footer = { ...(LOCKED.footer), ...((base && base.footer) || {}) };
  return L;
}

/* URL tuner application (supports legacy + new aliases) */
function applyUrlTuners(q, L) {
  const pick = (obj, keys) => keys.reduce((o, k) => (obj[k] != null ? (o[k] = obj[k], o) : o), {});

  // p1 name/date
  for (const fld of ["name","date"]) {
    const P = pick(q, [`p1_${fld}_x`,`p1_${fld}_y`,`p1_${fld}_w`,`p1_${fld}_size`,`p1_${fld}_align`]);
    if (Object.keys(P).length) {
      L.p1[fld] = { ...(L.p1[fld]||{}),
        x:N(P[`p1_${fld}_x`],L.p1[fld]?.x), y:N(P[`p1_${fld}_y`],L.p1[fld]?.y),
        w:N(P[`p1_${fld}_w`],L.p1[fld]?.w), size:N(P[`p1_${fld}_size`],L.p1[fld]?.size),
        align:S(P[`p1_${fld}_align`],L.p1[fld]?.align)
      };
    }
  }

  // Footers f2..f12  (FIXED: removed stray bracket)
  for (const pn of ["f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12"]) {
    const spec = pick(q, [`${pn}_x`, `${pn}_y`, `${pn}_w`, `${pn}_size`, `${pn}_align`]);
    if (Object.keys(spec).length) {
      L.footer[pn] = { ...(L.footer[pn]||{}),
        x:N(spec[`${pn}_x`],L.footer[pn]?.x),
        y:N(spec[`${pn}_y`],L.footer[pn]?.y),
        w:N(spec[`${pn}_w`],L.footer[pn]?.w),
        size:N(spec[`${pn}_size`],L.footer[pn]?.size),
        align:S(spec[`${pn}_align`],L.footer[pn]?.align)
      };
    }
  }

  // p3 domChar/domDesc + maxLines
  for (const f of ["domChar","domDesc"]) {
    const P = pick(q, [`p3_${f}_x`,`p3_${f}_y`,`p3_${f}_w`,`p3_${f}_size`,`p3_${f}_align`,`p3_${f}_maxLines`]);
    if (Object.keys(P).length) {
      L.p3[f] = { ...(L.p3[f]||{}),
        x:N(P[`p3_${f}_x`],L.p3[f]?.x), y:N(P[`p3_${f}_y`],L.p3[f]?.y),
        w:N(P[`p3_${f}_w`],L.p3[f]?.w), size:N(P[`p3_${f}_size`],L.p3[f]?.size),
        align:S(P[`p3_${f}_align`],L.p3[f]?.align)
      };
      if (P[`p3_${f}_maxLines`] != null) {
        L.p3[`${f}MaxLines`] = N(P[`p3_${f}_maxLines`], L.p3[`${f}MaxLines`]);
      }
    }
  }

  // p3 state (aliases)
  if (q.state_useAbs != null) L.p3.state.useAbsolute = String(q.state_useAbs) === "1" || String(q.state_useAbs).toLowerCase() === "true";
  if (q.state_shape != null)  L.p3.state.shape = S(q.state_shape);
  if (q.state_radius != null) L.p3.state.highlightRadius = N(q.state_radius, L.p3.state.highlightRadius);
  if (q.state_inset  != null) L.p3.state.highlightInset  = N(q.state_inset,  L.p3.state.highlightInset);
  if (q.state_opacity!= null) L.p3.state.fillOpacity     = N(q.state_opacity, L.p3.state.fillOpacity);
  if (q.labelText    != null) L.p3.state.labelText       = S(q.labelText);
  if (q.labelSize    != null) L.p3.state.labelSize       = N(q.labelSize, L.p3.state.labelSize);

  if (q.labelRLx != null) { L.p3.state.labelByState.R = { ...(L.p3.state.labelByState.R||{}), x:N(q.labelRLx) };
                            L.p3.state.labelByState.L = { ...(L.p3.state.labelByState.L||{}), x:N(q.labelRLx) }; }
  if (q.labelRLy != null) { L.p3.state.labelByState.R = { ...(L.p3.state.labelByState.R||{}), y:N(q.labelRLy) };
                            L.p3.state.labelByState.L = { ...(L.p3.state.labelByState.L||{}), y:N(q.labelRLy) }; }
  if (q.labelCTx != null) { L.p3.state.labelByState.C = { ...(L.p3.state.labelByState.C||{}), x:N(q.labelCTx) };
                            L.p3.state.labelByState.T = { ...(L.p3.state.labelByState.T||{}), x:N(q.labelCTx) }; }
  if (q.labelCTy != null) { L.p3.state.labelByState.C = { ...(L.p3.state.labelByState.C||{}), y:N(q.labelCTy) };
                            L.p3.state.labelByState.T = { ...(L.p3.state.labelByState.T||{}), y:N(q.labelCTy) }; }

  for (const K of ["R","C","T","L"]) {
    const base = `abs_${K}_`;
    const P = pick(q, [`${base}x`,`${base}y`,`${base}w`,`${base}h`]);
    if (Object.keys(P).length) {
      L.p3.state.absBoxes[K] = { ...(L.p3.state.absBoxes[K]||{}),
        x:N(P[`${base}x`],L.p3.state.absBoxes[K]?.x),
        y:N(P[`${base}y`],L.p3.state.absBoxes[K]?.y),
        w:N(P[`${base}w`],L.p3.state.absBoxes[K]?.w),
        h:N(P[`${base}h`],L.p3.state.absBoxes[K]?.h)
      };
    }
  }
  if (q.p3_state_labelOffsetX != null) L.p3.state.labelOffsetX = N(q.p3_state_labelOffsetX, L.p3.state.labelOffsetX);
  if (q.p3_state_labelOffsetY != null) L.p3.state.labelOffsetY = N(q.p3_state_labelOffsetY, L.p3.state.labelOffsetY);
  for (const K of ["R","C","T","L"]) {
    const key = `p3_state_abs_${K}`;
    const P = pick(q, [`${key}_x`,`${key}_y`,`${key}_w`,`${key}_h`]);
    if (Object.keys(P).length) {
      L.p3.state.absBoxes[K] = { ...(L.p3.state.absBoxes[K]||{}),
        x:N(P[`${key}_x`],L.p3.state.absBoxes[K]?.x),
        y:N(P[`${key}_y`],L.p3.state.absBoxes[K]?.y),
        w:N(P[`${key}_w`],L.p3.state.absBoxes[K]?.w),
        h:N(P[`${key}_h`],L.p3.state.absBoxes[K]?.h)
      };
    }
    const lk = `p3_state_label_${K}`;
    const LP = pick(q, [`${lk}_x`,`${lk}_y`]);
    if (Object.keys(LP).length) {
      L.p3.state.labelByState[K] = { ...(L.p3.state.labelByState[K]||{}),
        x:N(LP[`${lk}_x`],L.p3.state.labelByState[K]?.x),
        y:N(LP[`${lk}_y`],L.p3.state.labelByState[K]?.y)
      };
    }
  }

  // p4 spider + chart
  const s4 = pick(q, ["p4_spider_x","p4_spider_y","p4_spider_w","p4_spider_size","p4_spider_align","p4_spider_maxLines"]);
  if (Object.keys(s4).length) {
    L.p4.spider = { ...(L.p4.spider||{}),
      x:N(s4.p4_spider_x,L.p4.spider?.x), y:N(s4.p4_spider_y,L.p4.spider?.y),
      w:N(s4.p4_spider_w,L.p4.spider?.w), size:N(s4.p4_spider_size,L.p4.spider?.size),
      align:S(s4.p4_spider_align,L.p4.spider?.align)
    };
    if (s4.p4_spider_maxLines != null) L.p4.spiderMaxLines = N(s4.p4_spider_maxLines, L.p4.spiderMaxLines);
  }
  const c4 = pick(q, ["p4_chart_x","p4_chart_y","p4_chart_w","p4_chart_h"]);
  if (Object.keys(c4).length) {
    L.p4.chart = { ...(L.p4.chart||{}),
      x:N(c4.p4_chart_x,L.p4.chart?.x), y:N(c4.p4_chart_y,L.p4.chart?.y),
      w:N(c4.p4_chart_w,L.p4.chart?.w), h:N(c4.p4_chart_h,L.p4.chart?.h)
    };
  }

  // p5 seqpat + maxLines
  const s5 = pick(q, ["p5_seqpat_x","p5_seqpat_y","p5_seqpat_w","p5_seqpat_size","p5_seqpat_align","p5_seqpat_maxLines"]);
  if (Object.keys(s5).length) {
    L.p5.seqpat = { ...(L.p5.seqpat||{}),
      x:N(s5.p5_seqpat_x,L.p5.seqpat?.x), y:N(s5.p5_seqpat_y,L.p5.seqpat?.y),
      w:N(s5.p5_seqpat_w,L.p5.seqpat?.w), size:N(s5.p5_seqpat_size,L.p5.seqpat?.size),
      align:S(s5.p5_seqpat_align,L.p5.seqpat?.align)
    };
    if (s5.p5_seqpat_maxLines != null) L.p5.seqpatMaxLines = N(s5.p5_seqpat_maxLines, L.p5.seqpatMaxLines);
  }

  // p6 theme (+ optional maxLines)
  const s6 = pick(q, ["p6_theme_x","p6_theme_y","p6_theme_w","p6_theme_size","p6_theme_align","p6_theme_maxLines"]);
  if (Object.keys(s6).length) {
    L.p6.theme = { ...(L.p6.theme||{}),
      x:N(s6.p6_theme_x,L.p6.theme?.x), y:N(s6.p6_theme_y,L.p6.theme?.y),
      w:N(s6.p6_theme_w,L.p6.theme?.w), size:N(s6.p6_theme_size,L.p6.theme?.size),
      align:S(s6.p6_theme_align,L.p6.theme?.align)
    };
    if (s6.p6_theme_maxLines != null) L.p6.themeMaxLines = N(s6.p6_theme_maxLines, L.p6.themeMaxLines);
  }

  // p7/p8 colleagues
  for (const p of ["p7","p8"]) {
    if (q[`${p}_bodySize`] != null) L[p].bodySize = N(q[`${p}_bodySize`], L[p].bodySize);
    if (q[`${p}_maxLines`] != null) L[p].maxLines = N(q[`${p}_maxLines`], L[p].maxLines);
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

  // p9/p10 leaders
  for (const p of ["p9","p10"]) {
    if (q[`${p}_bodySize`] != null) L[p].bodySize = N(q[`${p}_bodySize`], L[p].bodySize);
    if (q[`${p}_maxLines`] != null) L[p].maxLines = N(q[`${p}_maxLines`], L[p].maxLines);
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

  // p11 tips/actions (no headers)
  for (const f of ["tipsBox","actsBox"]) {
    const P = pick(q, [`p11_${f}_x`,`p11_${f}_y`,`p11_${f}_w`,`p11_${f}_size`,`p11_${f}_align`,`p11_${f}_maxLines`]);
    if (Object.keys(P).length) {
      L.p11[f] = { ...(L.p11[f]||{}),
        x:N(P[`p11_${f}_x`],L.p11[f]?.x), y:N(P[`p11_${f}_y`],L.p11[f]?.y),
        w:N(P[`p11_${f}_w`],L.p11[f]?.w), size:N(P[`p11_${f}_size`],L.p11[f]?.size),
        align:S(P[`p11_${f}_align`],L.p11[f]?.align)
      };
      if (P[`p11_${f}_maxLines`] != null) {
        const key = f === "tipsBox" ? "tipsMaxLines" : "actsMaxLines";
        L.p11[key] = N(P[`p11_${f}_maxLines`], L.p11[key]);
      }
    }
  }

  return L;
}

/* ──────────────────────── Remote image embedding ─────────────────────── */
async function embedRemoteImage(pdfDoc, url) {
  if (!/^https?:/i.test(url)) return null;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const ab = await resp.arrayBuffer();
  const bytes = new Uint8Array(ab);
  try {
    if (bytes[0] === 0x89 && String.fromCharCode(bytes[1],bytes[2],bytes[3]) === "PNG") {
      return await pdfDoc.embedPng(bytes);
    }
  } catch {}
  try {
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      return await pdfDoc.embedJpg(bytes);
    }
  } catch {}
  try { return await pdfDoc.embedPng(bytes); } catch {}
  try { return await pdfDoc.embedJpg(bytes); } catch {}
  return null;
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

    // Parse + sanitize payload
    const rawData = parseDataParam(q.data);
    const P = normaliseInput(rawData);

    // Layout (defaults + optional overrides + URL tuners)
    let L = buildLayout(rawData.layoutV6);
    L = applyUrlTuners(q, L);

    // Load template + font
    const tplBytes = await loadTemplateBytes(tpl);
    const pdfDoc   = await PDFDocument.load(tplBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const p  = (n) => pages[n];

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
    const page12 = p(11); // may be undefined if template has only 11 pages

    /* ----------------------------- PAGE 1 ----------------------------- */
    if (L.p1?.name && P.name)     drawTextBox(page1, font, norm(P.name),    L.p1.name, { maxLines: 1 });
    if (L.p1?.date && P.dateLbl)  drawTextBox(page1, font, norm(P.dateLbl), L.p1.date, { maxLines: 1 });

    /* ----------------------------- PAGE 3 ----------------------------- */
    if (P.domChar) drawTextBox(page3, font, P.domChar, L.p3.domChar, { maxLines: N(L.p3.domCharMaxLines,6) });
    if (P.domDesc) drawTextBox(page3, font, P.domDesc, L.p3.domDesc, { maxLines: N(L.p3.domDescMaxLines,12) });

    const dom = resolveDomKey(P.dom, P.domChar, P.domDesc);
    if (dom) {
      const anchor = paintStateHighlight(page3, dom, L.p3.state || {});
      const labelTxt = S(L.p3.state.labelText || "").trim();
      if (anchor && labelTxt) {
        const spec = {
          x: anchor.labelX, y: anchor.labelY, w: 200,
          size: N(L.p3.state.labelSize, 10),
          align: "center",
        };
        drawTextBox(page3, font, labelTxt, spec, { maxLines: 1 });
      }
    }

    /* ----------------------------- PAGE 4 ----------------------------- */
    if (P.spiderTxt) drawTextBox(page4, font, P.spiderTxt, L.p4.spider, { maxLines: N(L.p4.spiderMaxLines,10) });
    if (P.chartUrl) {
      const img = await embedRemoteImage(pdfDoc, P.chartUrl);
      if (img) {
        const ph = page4.getHeight();
        const x = N(L.p4.chart.x), y = N(L.p4.chart.y), w = N(L.p4.chart.w), h = N(L.p4.chart.h);
        page4.drawImage(img, { x, y: ph - y - h, width: w, height: h });
      }
    }

    /* ----------------------------- PAGE 5 ----------------------------- */
    if (P.seqpat) drawTextBox(page5, font, P.seqpat, L.p5.seqpat, { maxLines: N(L.p5.seqpatMaxLines,12) });

    /* ----------------------------- PAGE 6 ----------------------------- */
    if (P.theme) drawTextBox(page6, font, P.theme, L.p6.theme, { maxLines: N(L.p6.themeMaxLines,12) });

    /* ----------------------------- PAGE 7 ----------------------------- */
    if (L.p7?.colBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      const pickItem = (arr, k, idx) =>
        arr.find(x => S(x?.their).toUpperCase() === k) ||
        arr.find(x => S(x?.mine).toUpperCase()  === k) ||
        arr[idx] || {};
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p7.colBoxes[i];
        const item = pickItem(P.workwcol, k, i);
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page7, font, txt, bx, L.p7.bodySize || 10, "left", { maxLines: N(L.p7.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 8 ----------------------------- */
    if (L.p8?.colBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      const pickItem = (arr, k, idx) =>
        arr.find(x => S(x?.their).toUpperCase() === k) ||
        arr.find(x => S(x?.mine).toUpperCase()  === k) ||
        arr[idx] || {};
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p8.colBoxes[i];
        const item = pickItem(P.workwcol, k, i);
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page8, font, txt, bx, L.p8.bodySize || 10, "left", { maxLines: N(L.p8.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 9 ----------------------------- */
    if (L.p9?.ldrBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      const pickItem = (arr, k, idx) =>
        arr.find(x => S(x?.their).toUpperCase() === k) ||
        arr.find(x => S(x?.mine).toUpperCase()  === k) ||
        arr[idx] || {};
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p9.ldrBoxes[i];
        const item = pickItem(P.workwlead, k, i);
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page9,  font, txt, bx, L.p9.bodySize || 10, "left", { maxLines: N(L.p9.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 10 ---------------------------- */
    if (L.p10?.ldrBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      const pickItem = (arr, k, idx) =>
        arr.find(x => S(x?.their).toUpperCase() === k) ||
        arr.find(x => S(x?.mine).toUpperCase()  === k) ||
        arr[idx] || {};
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p10.ldrBoxes[i];
        const item = pickItem(P.workwlead, k, i);
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page10, font, txt, bx, L.p10.bodySize || 10, "left", { maxLines: N(L.p10.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 11 ---------------------------- */
    if (L.p11?.tipsBox && P.tips?.length) {
      drawBulleted(page11, font, P.tips,  L.p11.tipsBox, { maxLines: N(L.p11.tipsMaxLines, 12) });
    }
    if (L.p11?.actsBox && P.actions?.length) {
      drawBulleted(page11, font, P.actions, L.p11.actsBox, { maxLines: N(L.p11.actsMaxLines, 12) });
    }

    /* ------------------------------ FOOTERS --------------------------- */
    const footerSpec = L.footer || LOCKED.footer;
    const footerName = norm(P.name || "");
    const putName = (idx, key) => {
      const spec = footerSpec[key];
      if (!spec || !footerName || !pages[idx]) return;
      drawTextBox(pages[idx], font, footerName, spec, { maxLines: 1 });
    };
    // Pages 2..12 (guard for shorter templates)
    putName(1,  "f2");
    putName(2,  "f3");
    putName(3,  "f4");
    putName(4,  "f5");
    putName(5,  "f6");
    putName(6,  "f7");
    putName(7,  "f8");
    putName(8,  "f9");
    putName(9,  "f10");
    putName(10, "f11");
    putName(11, "f12");

    // Save
    const bytes = await pdfDoc.save();
    const outName = S(q.name || `CTRL_${P.name || "Perspective"}_${P.dateLbl || todayLbl()}.pdf`).replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.status(400).json({ ok:false, error: `fill-template error: ${err.message || String(err)}` });
  }
}
