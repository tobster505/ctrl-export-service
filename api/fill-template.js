/** **********************************************************************
 * CTRL Export Service · fill-template (Perspective flow)
 * Template: /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
 *
 * Pages:
 *  p1  cover
 *  p3  dominant + description + state highlight (absolute geometry)
 *  p4  spider copy + chart image
 *  p5  sequence/pattern copy
 *  p6  theme pair copy
 *  p7  LOOK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].look)
 *  p8  WORK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].work)
 *  p9  LOOK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].look)
 *  p10 WORK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].work)
 *  p11 Tips & Actions      (two bulleted columns; NO titles in this version)
 *  p12 footer only
 *
 * Locked defaults (TL coords unless noted):
 *  • P1 name/date
 *      name: x=7 y=473 w=500 size=30 align=center
 *      date: x=210 y=600 w=500 size=25 align=left
 *  • Footers (pages 2–12): name only at x=380 y=51 size=13 align=left
 *  • P4 chart: x=20 y=225 w=570 h=280
 *  • P3 state abs boxes + labels:
 *      R: box(60,433,188,158), label(150,612), radius=1000, inset=1, opacity=0.45
 *      C: box(58,258,188,156), label(150,245), radius=28,   inset=6, opacity=0.45
 *      T: box(299,258,188,156),label(390,244), radius=28,   inset=6, opacity=0.45
 *      L: box(298,440,188,156),label(390,605), radius=28,   inset=6, opacity=0.45
 *
 * URL tuners (highlights):
 *  • P1:  p1_name_{x|y|w|size|align}   · p1_date_{…}
 *  • Footers: f{2..12}_{x|y|w|size|align}
 *  • P3 text blocks: p3_domChar_{x|y|w|size|align|maxLines}
 *                    p3_domDesc_{x|y|w|size|align|maxLines}
 *    State (verbose): p3_state_abs_[C|T|R|L]_{x|y|w|h}
 *                      p3_state_label_[C|T|R|L]_{x|y}
 *                      p3_state_label{Text|Size|labelOffsetX|labelOffsetY|fillOpacity|highlightRadius|highlightInset}
 *    State (your short aliases, mapped internally):
 *        state_useAbs=1
 *        abs_[C|T|R|L]_{x|y|w|h}
 *        state_shape=round&state_radius=28&state_inset=6&state_opacity=0.45
 *        labelText=YOU+ARE+HERE&labelSize=10
 *        labelRLx=390&labelRLy=605 (applies to R & L)
 *        labelCTx=150&labelCTy=245 (applies to C & T)
 *  • P4:  p4_spider_{x|y|w|size|align|maxLines}
 *         p4_chart_{x|y|w|h}
 *  • P5:  p5_seqpat_{x|y|w|size|align|maxLines}
 *  • P6:  p6_theme_{x|y|w|size|align}
 *  • P7/P8 (col0..3 = C,T,R,L):
 *         p7_bodySize, p7_maxLines (page-level defaults)
 *         p7_col{i}_{x|y|w|h|size|maxLines}  (per paragraph)
 *         same for p8_col{i}_…
 *  • P9/P10 (ldr0..3 = C,T,R,L):
 *         p9_bodySize, p9_maxLines (page-level defaults)
 *         p9_ldr{i}_{x|y|w|h|size|maxLines}  (per paragraph)
 *         same for p10_ldr{i}_…
 *  • P11: p11_tipsBox_{x|y|w|size|align|maxLines}
 *         p11_actsBox_{x|y|w|size|align|maxLines}
 *
 * Template must be local (/public). Remote tpl URLs are not accepted.
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

  const maxLines = opts.maxLines ?? spec.maxLines ?? 6;
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

  const maxLines = opts.maxLines ?? spec.maxLines ?? 12;

  const arr = ensureArray(items).map(s => norm(s));
  const pageH = page.getHeight();
  let yCursor = pageH - y;
  const lineH = Math.max(1, size) + lineGap;

  for (const raw of arr) {
    if (!raw) continue;
    const lines = raw.split(/\n/).filter(Boolean);
    const head = `${bullet} ${lines.shift()}`;
    drawTextBox(page, font, head, { x, y: pageH - yCursor, w, size, lineGap, align, color, maxLines: 1 }, { maxLines: 1 });
    yCursor -= lineH;
    for (const cont of lines) {
      drawTextBox(page, font, `   ${cont}`, { x, y: pageH - yCursor, w, size, lineGap, align, color, maxLines: 1 }, { maxLines: 1 });
      yCursor -= lineH;
    }
    if ((pageH - yCursor) / lineH > maxLines) break;
  }
}

function drawTextInBox(page, font, text, box, size = 10, align = "left", opts = {}) {
  const spec = { x: N(box.x), y: N(box.y), w: N(box.w), size: N(size), align, maxLines: N(box.maxLines, undefined) };
  return drawTextBox(page, font, S(text), spec, opts);
}

// Convert TL {x,y,w,h} to BL for pdf-lib drawing
const rectTLtoBL = (page, box, inset = 0) => {
  const pageH = page.getHeight();
  const x = N(box.x) + inset;
  const w = Math.max(0, N(box.w) - inset * 2);
  const h = Math.max(0, N(box.h) - inset * 2);
  const y = pageH - N(box.y) - N(box.h) + inset; // TL → BL
  return { x, y, w, h };
};

/* State highlight (p3). Uses absolute TL rects; returns TL label anchor */
function paintStateHighlight(page3, dom, cfg = {}) {
  const b = (cfg.absBoxes && cfg.absBoxes[dom]) || null;
  if (!b) return;

  const radius   = Number.isFinite(+((cfg.styleByState||{})[dom]?.radius)) ? +((cfg.styleByState||{})[dom].radius) : N(cfg.highlightRadius, 28);
  const inset    = Number.isFinite(+((cfg.styleByState||{})[dom]?.inset))   ? +((cfg.styleByState||{})[dom].inset)   : N(cfg.highlightInset, 6);
  const opacity  = Number.isFinite(+cfg.fillOpacity) ? +cfg.fillOpacity : 0.45;

  const boxBL = rectTLtoBL(page3, b, inset);
  const shade = rgb(251/255, 236/255, 250/255);

  page3.drawRectangle({
    x: boxBL.x, y: boxBL.y, width: boxBL.w, height: boxBL.h,
    borderRadius: radius, color: shade, opacity
  });

  // Label anchor (kept in TL space)
  const perState = (cfg.labelByState && cfg.labelByState[dom]) || null;
  const offX = N(cfg.labelOffsetX, 0);
  const offY = N(cfg.labelOffsetY, 0);
  let lx, ly;
  if (perState && Number.isFinite(+perState.x) && Number.isFinite(+perState.y)) {
    lx = +perState.x; ly = +perState.y;
  } else {
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

  P.spiderTxt = norm(d.spiderdesc || d.spider || "");
  P.chartUrl  = S(d.spiderfreq || d.chart || ""); // QuickChart or similar

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

/* ───────────────────────── Default coordinates (tunable) ───────────── */

const LOCKED = {
  p1: {
    name: { x: 7,   y: 473,  w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600,  w: 500, size: 25, align: "left"   }
  },
  footer: (() => {
    const f = { x: 380, y: 51, w: 400, size: 13, align: "left" }; // name only
    return { f2:{...f}, f3:{...f}, f4:{...f}, f5:{...f}, f6:{...f},
             f7:{...f}, f8:{...f}, f9:{...f}, f10:{...f}, f11:{...f}, f12:{...f} };
  })()
};

const DEFAULT_COORDS = {
  meta:  { units: "pt", origin: "TL", pages: "1-based" },

  // PAGE 3 — text + state highlight
  p3: {
    domChar: { x:  72, y: 182, w: 630, size: 12, align: "left", maxLines: 6 },
    domDesc: { x:  72, y: 214, w: 630, size: 11, align: "left", maxLines: 8 },
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
    spider: { x:  60, y: 320, w: 280, size: 11, align: "left", maxLines: 10 },
    chart:  { x:  20, y: 225, w: 570, h: 280 }
  },

  // PAGE 5
  p5: { seqpat: { x:  60, y: 160, w: 650, size: 11, align: "left", maxLines: 12 } },

  // PAGE 6
  p6: { theme:  { x:  60, y: 160, w: 650, size: 11, align: "left" } },

  // PAGE 7 — LOOK · colleagues
  p7: {
    header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
    colBoxes: [
      { x:  60, y: 140, w: 300, h: 120 },  // C (col0)
      { x: 410, y: 140, w: 300, h: 120 },  // T (col1)
      { x:  60, y: 270, w: 300, h: 120 },  // R (col2)
      { x: 410, y: 270, w: 300, h: 120 }   // L (col3)
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
      { x:  60, y: 140, w: 300, h: 120 },  // C (ldr0)
      { x: 410, y: 140, w: 300, h: 120 },  // T (ldr1)
      { x:  60, y: 270, w: 300, h: 120 },  // R (ldr2)
      { x: 410, y: 270, w: 300, h: 120 }   // L (ldr3)
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

  // PAGE 11 — Tips + Actions (NO headers)
  p11: {
    tipsBox: { x:  30, y: 530, w: 300, size: 11, align: "left", maxLines: 12 },
    actsBox: { x: 320, y: 530, w: 300, size: 11, align: "left", maxLines: 12 }
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
  // Footers & p1 use locked defaults as base
  L.footer = { ...(LOCKED.footer), ...((base && base.footer) || {}) };
  L.p1     = { ...(LOCKED.p1),     ...((base && base.p1)     || {}) };
  return L;
}

function applyUrlTuners(q, L) {
  const pick = (obj, keys) => keys.reduce((o, k) => (q[k] != null ? (o[k] = q[k], o) : o), {});

  /* P1 — name & date */
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

  /* Footers f* (name only) */
  for (const pn of ["f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12"]) {
    const spec = pick(q, [`${pn}_x`, `${pn}_y`, `${pn}_w`, `${pn}_size`, `${pn}_align`]);
    if (Object.keys(spec).length) {
      L.footer[pn] = { ...(L.footer[pn]||{}),
        x:N(spec[`${pn}_x`],L.footer[pn]?.x), y:N(spec[`${pn}_y`],L.footer[pn]?.y),
        w:N(spec[`${pn}_w`],L.footer[pn]?.w), size:N(spec[`${pn}_size`],L.footer[pn]?.size),
        align:S(spec[`${pn}_align`],L.footer[pn]?.align)
      };
    }
  }

  /* p3 domChar/domDesc (with maxLines) */
  for (const f of ["domChar","domDesc"]) {
    const P = pick(q, [`p3_${f}_x`,`p3_${f}_y`,`p3_${f}_w`,`p3_${f}_size`,`p3_${f}_align`,`p3_${f}_maxLines`]);
    if (Object.keys(P).length) L.p3[f] = { ...(L.p3[f]||{}),
      x:N(P[`p3_${f}_x`],L.p3[f]?.x), y:N(P[`p3_${f}_y`],L.p3[f]?.y),
      w:N(P[`p3_${f}_w`],L.p3[f]?.w), size:N(P[`p3_${f}_size`],L.p3[f]?.size),
      align:S(P[`p3_${f}_align`],L.p3[f]?.align),
      maxLines: N(P[`p3_${f}_maxLines`], L.p3[f]?.maxLines)
    };
  }

  /* p3 state (verbose path) */
  for (const k of ["C","T","R","L"]) {
    const key = `p3_state_abs_${k}`;
    const P = pick(q, [`${key}_x`,`${key}_y`,`${key}_w`,`${key}_h`]);
    if (Object.keys(P).length) {
      L.p3.state.absBoxes[k] = { ...(L.p3.state.absBoxes[k]||{}),
        x:N(P[`${key}_x`],L.p3.state.absBoxes[k]?.x),
        y:N(P[`${key}_y`],L.p3.state.absBoxes[k]?.y),
        w:N(P[`${key}_w`],L.p3.state.absBoxes[k]?.w),
        h:N(P[`${key}_h`],L.p3.state.absBoxes[k]?.h)
      };
    }
    const lk = `p3_state_label_${k}`;
    const LP = pick(q, [`${lk}_x`,`${lk}_y`]);
    if (Object.keys(LP).length) {
      L.p3.state.labelByState[k] = { ...(L.p3.state.labelByState[k]||{}),
        x:N(LP[`${lk}_x`],L.p3.state.labelByState[k]?.x),
        y:N(LP[`${lk}_y`],L.p3.state.labelByState[k]?.y)
      };
    }
  }
  if (q.p3_state_labelOffsetX != null) L.p3.state.labelOffsetX = N(q.p3_state_labelOffsetX, L.p3.state.labelOffsetX);
  if (q.p3_state_labelOffsetY != null) L.p3.state.labelOffsetY = N(q.p3_state_labelOffsetY, L.p3.state.labelOffsetY);
  if (q.p3_state_labelText     != null) L.p3.state.labelText     = S(q.p3_state_labelText, L.p3.state.labelText);
  if (q.p3_state_labelSize     != null) L.p3.state.labelSize     = N(q.p3_state_labelSize, L.p3.state.labelSize);
  if (q.p3_state_fillOpacity   != null) L.p3.state.fillOpacity   = N(q.p3_state_fillOpacity, L.p3.state.fillOpacity);
  if (q.p3_state_highlightRadius!=null) L.p3.state.highlightRadius= N(q.p3_state_highlightRadius, L.p3.state.highlightRadius);
  if (q.p3_state_highlightInset !=null) L.p3.state.highlightInset = N(q.p3_state_highlightInset, L.p3.state.highlightInset);

  /* p3 state — short alias mapping you provided */
  if (q.state_useAbs != null) L.p3.state.useAbsolute = !!(+q.state_useAbs || /^true$/i.test(String(q.state_useAbs)));
  for (const k of ["C","T","R","L"]) {
    const P = pick(q, [`abs_${k}_x`,`abs_${k}_y`,`abs_${k}_w`,`abs_${k}_h`]);
    if (Object.keys(P).length) {
      L.p3.state.absBoxes[k] = { ...(L.p3.state.absBoxes[k]||{}),
        x:N(P[`abs_${k}_x`],L.p3.state.absBoxes[k]?.x),
        y:N(P[`abs_${k}_y`],L.p3.state.absBoxes[k]?.y),
        w:N(P[`abs_${k}_w`],L.p3.state.absBoxes[k]?.w),
        h:N(P[`abs_${k}_h`],L.p3.state.absBoxes[k]?.h)
      };
    }
  }
  if (q.state_shape        != null) L.p3.state.shape           = S(q.state_shape, L.p3.state.shape);
  if (q.state_radius       != null) L.p3.state.highlightRadius = N(q.state_radius, L.p3.state.highlightRadius);
  if (q.state_inset        != null) L.p3.state.highlightInset  = N(q.state_inset,  L.p3.state.highlightInset);
  if (q.state_opacity      != null) L.p3.state.fillOpacity     = N(q.state_opacity, L.p3.state.fillOpacity);
  if (q.labelText          != null) L.p3.state.labelText       = S(q.labelText, L.p3.state.labelText);
  if (q.labelSize          != null) L.p3.state.labelSize       = N(q.labelSize, L.p3.state.labelSize);
  if (q.labelRLx != null || q.labelRLy != null) {
    for (const k of ["R","L"]) {
      L.p3.state.labelByState[k] = { ...(L.p3.state.labelByState[k]||{}),
        x: N(q.labelRLx, L.p3.state.labelByState[k]?.x),
        y: N(q.labelRLy, L.p3.state.labelByState[k]?.y)
      };
    }
  }
  if (q.labelCTx != null || q.labelCTy != null) {
    for (const k of ["C","T"]) {
      L.p3.state.labelByState[k] = { ...(L.p3.state.labelByState[k]||{}),
        x: N(q.labelCTx, L.p3.state.labelByState[k]?.x),
        y: N(q.labelCTy, L.p3.state.labelByState[k]?.y)
      };
    }
  }

  /* p4 spider + chart (with maxLines) */
  const s4 = pick(q, ["p4_spider_x","p4_spider_y","p4_spider_w","p4_spider_size","p4_spider_align","p4_spider_maxLines"]);
  if (Object.keys(s4).length) {
    L.p4.spider = { ...(L.p4.spider||{}),
      x:N(s4.p4_spider_x,L.p4.spider?.x), y:N(s4.p4_spider_y,L.p4.spider?.y),
      w:N(s4.p4_spider_w,L.p4.spider?.w), size:N(s4.p4_spider_size,L.p4.spider?.size),
      align:S(s4.p4_spider_align,L.p4.spider?.align),
      maxLines:N(s4.p4_spider_maxLines,L.p4.spider?.maxLines)
    };
  }
  const c4 = pick(q, ["p4_chart_x","p4_chart_y","p4_chart_w","p4_chart_h"]);
  if (Object.keys(c4).length) {
    L.p4.chart = { ...(L.p4.chart||{}),
      x:N(c4.p4_chart_x,L.p4.chart?.x), y:N(c4.p4_chart_y,L.p4.chart?.y),
      w:N(c4.p4_chart_w,L.p4.chart?.w), h:N(c4.p4_chart_h,L.p4.chart?.h)
    };
  }

  /* p5 / p6 blocks (with maxLines for p5) */
  const p5 = pick(q, ["p5_seqpat_x","p5_seqpat_y","p5_seqpat_w","p5_seqpat_size","p5_seqpat_align","p5_seqpat_maxLines"]);
  if (Object.keys(p5).length) {
    L.p5.seqpat = { ...(L.p5.seqpat||{}),
      x:N(p5.p5_seqpat_x,L.p5.seqpat?.x), y:N(p5.p5_seqpat_y,L.p5.seqpat?.y),
      w:N(p5.p5_seqpat_w,L.p5.seqpat?.w), size:N(p5.p5_seqpat_size,L.p5.seqpat?.size),
      align:S(p5.p5_seqpat_align,L.p5.seqpat?.align),
      maxLines:N(p5.p5_seqpat_maxLines,L.p5.seqpat?.maxLines)
    };
  }
  const p6 = pick(q, ["p6_theme_x","p6_theme_y","p6_theme_w","p6_theme_size","p6_theme_align"]);
  if (Object.keys(p6).length) {
    L.p6.theme = { ...(L.p6.theme||{}),
      x:N(p6.p6_theme_x,L.p6.theme?.x), y:N(p6.p6_theme_y,L.p6.theme?.y),
      w:N(p6.p6_theme_w,L.p6.theme?.w), size:N(p6.p6_theme_size,L.p6.theme?.size),
      align:S(p6.p6_theme_align,L.p6.theme?.align)
    };
  }

  /* p7/p8 colleagues — per box tuners including size/maxLines */
  for (const p of ["p7","p8"]) {
    if (q[`${p}_bodySize`] != null) L[p].bodySize = N(q[`${p}_bodySize`], L[p].bodySize);
    if (q[`${p}_maxLines`] != null) L[p].maxLines = N(q[`${p}_maxLines`], L[p].maxLines);
    for (let i=0;i<4;i++) {
      const key = `${p}_col${i}`;
      const P = pick(q, [`${key}_x`,`${key}_y`,`${key}_w`,`${key}_h`,`${key}_size`,`${key}_maxLines`]);
      if (Object.keys(P).length) {
        L[p].colBoxes[i] = { ...(L[p].colBoxes[i]||{}),
          x:N(P[`${key}_x`],L[p].colBoxes[i]?.x),
          y:N(P[`${key}_y`],L[p].colBoxes[i]?.y),
          w:N(P[`${key}_w`],L[p].colBoxes[i]?.w),
          h:N(P[`${key}_h`],L[p].colBoxes[i]?.h),
          size:N(P[`${key}_size`],L[p].colBoxes[i]?.size),
          maxLines:N(P[`${key}_maxLines`],L[p].colBoxes[i]?.maxLines)
        };
      }
    }
  }

  /* p9/p10 leaders — per box tuners including size/maxLines */
  for (const p of ["p9","p10"]) {
    if (q[`${p}_bodySize`] != null) L[p].bodySize = N(q[`${p}_bodySize`], L[p].bodySize);
    if (q[`${p}_maxLines`] != null) L[p].maxLines = N(q[`${p}_maxLines`], L[p].maxLines);
    for (let i=0;i<4;i++) {
      const key = `${p}_ldr${i}`;
      const P = pick(q, [`${key}_x`,`${key}_y`,`${key}_w`,`${key}_h`,`${key}_size`,`${key}_maxLines`]);
      if (Object.keys(P).length) {
        L[p].ldrBoxes[i] = { ...(L[p].ldrBoxes[i]||{}),
          x:N(P[`${key}_x`],L[p].ldrBoxes[i]?.x),
          y:N(P[`${key}_y`],L[p].ldrBoxes[i]?.y),
          w:N(P[`${key}_w`],L[p].ldrBoxes[i]?.w),
          h:N(P[`${key}_h`],L[p].ldrBoxes[i]?.h),
          size:N(P[`${key}_size`],L[p].ldrBoxes[i]?.size),
          maxLines:N(P[`${key}_maxLines`],L[p].ldrBoxes[i]?.maxLines)
        };
      }
    }
  }

  /* p11 tips/actions — NO headers; with maxLines per box */
  const t11 = pick(q, ["p11_tipsBox_x","p11_tipsBox_y","p11_tipsBox_w","p11_tipsBox_size","p11_tipsBox_align","p11_tipsBox_maxLines"]);
  if (Object.keys(t11).length) {
    L.p11.tipsBox = { ...(L.p11.tipsBox||{}),
      x:N(t11.p11_tipsBox_x,L.p11.tipsBox?.x), y:N(t11.p11_tipsBox_y,L.p11.tipsBox?.y),
      w:N(t11.p11_tipsBox_w,L.p11.tipsBox?.w), size:N(t11.p11_tipsBox_size,L.p11.tipsBox?.size),
      align:S(t11.p11_tipsBox_align,L.p11.tipsBox?.align),
      maxLines:N(t11.p11_tipsBox_maxLines,L.p11.tipsBox?.maxLines)
    };
  }
  const a11 = pick(q, ["p11_actsBox_x","p11_actsBox_y","p11_actsBox_w","p11_actsBox_size","p11_actsBox_align","p11_actsBox_maxLines"]);
  if (Object.keys(a11).length) {
    L.p11.actsBox = { ...(L.p11.actsBox||{}),
      x:N(a11.p11_actsBox_x,L.p11.actsBox?.x), y:N(a11.p11_actsBox_y,L.p11.actsBox?.y),
      w:N(a11.p11_actsBox_w,L.p11.actsBox?.w), size:N(a11.p11_actsBox_size,L.p11.actsBox?.size),
      align:S(a11.p11_actsBox_align,L.p11.actsBox?.align),
      maxLines:N(a11.p11_actsBox_maxLines,L.p11.actsBox?.maxLines)
    };
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
  try { if (bytes[0] === 0x89 && String.fromCharCode(bytes[1],bytes[2],bytes[3]) === "PNG") return await pdfDoc.embedPng(bytes); } catch {}
  try { if (bytes[0] === 0xFF && bytes[1] === 0xD8) return await pdfDoc.embedJpg(bytes); } catch {}
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

    // Parse & sanitize payload
    const rawData = parseDataParam(q.data);
    const P = normaliseInput(rawData);

    // Build layout (defaults + optional overrides + URL tuners)
    let L = buildLayout(rawData.layoutV6);
    L = applyUrlTuners(q, L);

    // Load template
    const tplBytes = await loadTemplateBytes(tpl);
    const pdfDoc   = await PDFDocument.load(tplBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Page helpers (0-based)
    const p  = (n) => pdfDoc.getPages()[n];
    const pages = pdfDoc.getPages();

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
    const page12 = p(11); // footer only

    /* ----------------------------- PAGE 1 ----------------------------- */
    if (L.p1?.name && P.name)     drawTextBox(page1, font, norm(P.name),    L.p1.name);
    if (L.p1?.date && P.dateLbl)  drawTextBox(page1, font, norm(P.dateLbl), L.p1.date);

    /* ----------------------------- PAGE 3 ----------------------------- */
    if (P.domChar) drawTextBox(page3, font, P.domChar, L.p3.domChar, { maxLines: N(L.p3.domChar.maxLines, 6) });
    if (P.domDesc) drawTextBox(page3, font, P.domDesc, L.p3.domDesc, { maxLines: N(L.p3.domDesc.maxLines, 8) });

    const dom = resolveDomKey(P.dom, P.domChar, P.domDesc);
    if (dom) {
      const anchor = paintStateHighlight(page3, dom, L.p3.state || {});
      if (anchor && (L.p3.state?.labelText || "").trim()) {
        drawTextBox(page3, font, S(L.p3.state.labelText), {
          x: anchor.labelX, y: anchor.labelY, w: 180,
          size: N(L.p3.state.labelSize, 10), align: "center"
        }, { maxLines: 1 });
      }
    }

    /* ----------------------------- PAGE 4 ----------------------------- */
    if (P.spiderTxt) drawTextBox(page4, font, P.spiderTxt, L.p4.spider, { maxLines: N(L.p4.spider.maxLines, 10) });
    if (P.chartUrl) {
      const img = await embedRemoteImage(pdfDoc, P.chartUrl);
      if (img) {
        const pageH = page4.getHeight();
        const x = N(L.p4.chart.x), y = N(L.p4.chart.y), w = N(L.p4.chart.w), h = N(L.p4.chart.h);
        page4.drawImage(img, { x, y: pageH - y - h, width: w, height: h });
      }
    }

    /* ----------------------------- PAGE 5 ----------------------------- */
    if (P.seqpat) drawTextBox(page5, font, P.seqpat, L.p5.seqpat, { maxLines: N(L.p5.seqpat.maxLines, 12) });

    /* ----------------------------- PAGE 6 ----------------------------- */
    if (P.theme) drawTextBox(page6, font, P.theme, L.p6.theme);

    /* ----------------------------- PAGE 7 ----------------------------- */
    if (L.p7?.colBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p7.colBoxes[i];
        const item = P.workwcol.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwcol[i] || {};
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page7, font, txt, bx, N(bx.size, L.p7.bodySize || 10), "left",
          { maxLines: N(bx.maxLines, L.p7.maxLines || 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 8 ----------------------------- */
    if (L.p8?.colBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p8.colBoxes[i];
        const item = P.workwcol.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwcol[i] || {};
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page8, font, txt, bx, N(bx.size, L.p8.bodySize || 10), "left",
          { maxLines: N(bx.maxLines, L.p8.maxLines || 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 9 ----------------------------- */
    if (L.p9?.ldrBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p9.ldrBoxes[i];
        const item = P.workwlead.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwlead[i] || {};
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page9,  font, txt, bx, N(bx.size, L.p9.bodySize || 10), "left",
          { maxLines: N(bx.maxLines, L.p9.maxLines || 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 10 ---------------------------- */
    if (L.p10?.ldrBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p10.ldrBoxes[i];
        const item = P.workwlead.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwlead[i] || {};
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page10, font, txt, bx, N(bx.size, L.p10.bodySize || 10), "left",
          { maxLines: N(bx.maxLines, L.p10.maxLines || 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 11 ---------------------------- *
       Tips & Actions — NO titles                                         */
    if (L.p11?.tipsBox && P.tips?.length) {
      drawBulleted(page11, font, P.tips,  L.p11.tipsBox, { maxLines: N(L.p11.tipsBox.maxLines, 12) });
    }
    if (L.p11?.actsBox && P.actions?.length) {
      drawBulleted(page11, font, P.actions, L.p11.actsBox, { maxLines: N(L.p11.actsBox.maxLines, 12) });
    }

    /* ------------------------------ FOOTERS --------------------------- *
       Name only (no page numbers, no flow/date)                          */
    const footerSpec = L.footer || LOCKED.footer;
    const footerName = norm(P.name || "");
    const put = (idx, key, text) => {
      const spec = footerSpec[key];
      if (!spec || !text) return;
      drawTextBox(pages[idx], font, text, spec, { maxLines: 1 });
    };
    put(1,  "f2",  footerName);
    put(2,  "f3",  footerName);
    put(3,  "f4",  footerName);
    put(4,  "f5",  footerName);
    put(5,  "f6",  footerName);
    put(6,  "f7",  footerName);
    put(7,  "f8",  footerName);
    put(8,  "f9",  footerName);
    put(9,  "f10", footerName);
    put(10, "f11", footerName);
    put(11, "f12", footerName);

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
