/** **********************************************************************
 * CTRL Export Service · fill-template (Perspective flow)
 * Template: /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
 *
 * Pages:
 *  p1  cover                     (name/date via tuners)
 *  p3  dominant + description + state highlight (absolute geometry)
 *  p4  spider copy + chart image
 *  p5  sequence/pattern copy
 *  p6  theme pair copy
 *  p7  LOOK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].look)
 *  p8  WORK — colleagues   (C/T/R/L, 4 boxes; from workwcol[*].work)
 *  p9  LOOK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].look)
 *  p10 WORK — leaders      (C/T/R/L, 4 boxes; from workwlead[*].work)
 *  p11 Tips & Actions      (two bulleted columns, no titles)
 *  p12 (footer only)
 *
 * URL tuners (examples; TL-origin coordinates):
 *  • PAGE 1:
 *      ?p1_name_x=7&p1_name_y=473&p1_name_w=500&p1_name_size=30&p1_name_align=center
 *      ?p1_date_x=210&p1_date_y=600&p1_date_w=500&p1_date_size=25&p1_date_align=left
 *
 *  • Footers (pages 2–12, label = Full Name only):
 *      ?f2_x=380&f2_y=51&f2_size=13&f2_align=left  (same for f3..f12)
 *
 *  • PAGE 3 (dominant text):
 *      ?p3_domChar_x=272&p3_domChar_y=640&p3_domChar_w=630&p3_domChar_size=23&p3_domChar_maxLines=6
 *      ?p3_domDesc_x=25&p3_domDesc_y=685&p3_domDesc_w=550&p3_domDesc_size=18&p3_domDesc_maxLines=12
 *
 *  • PAGE 3 (state shading + label) — both prefixes supported:
 *      (A) Short aliases:
 *        ?state_useAbs=1&state_shape=round&state_radius=28&state_inset=6&state_opacity=0.45
 *        ?abs_C_x=58&abs_C_y=258&abs_C_w=188&abs_C_h=156&p3_state_label_C_x=60&p3_state_label_C_y=245
 *        ?abs_T_x=299&abs_T_y=258&abs_T_w=188&abs_T_h=156&p3_state_label_T_x=290&p3_state_label_T_y=244
 *        ?abs_R_x=60&abs_R_y=433&abs_R_w=188&abs_R_h=158&p3_state_label_R_x=60&p3_state_label_R_y=605
 *        ?abs_L_x=298&abs_L_y=430&abs_L_w=195&abs_L_h=173&p3_state_label_L_x=290&p3_state_label_L_y=605
 *        ?labelText=YOU%20ARE%20HERE&labelSize=10
 *      (B) Verbose:
 *        ?p3_state_abs_C_x=... (same fields)   · ?p3_state_label_C_x=... (same for T,R,L)
 *      Offsets:
 *        ?p3_state_labelOffsetX=0&p3_state_labelOffsetY=0
 *
 *  • PAGE 4:
 *      ?p4_spider_x=30&p4_spider_y=585&p4_spider_w=550&p4_spider_size=18&p4_spider_maxLines=10
 *      ?p4_chart_x=20&p4_chart_y=225&p4_chart_w=570&p4_chart_h=280
 *
 *  • PAGE 5:
 *      ?p5_seqpat_x=25&p5_seqpat_y=250&p5_seqpat_w=550&p5_seqpat_size=18&p5_seqpat_maxLines=12
 *
 *  • PAGE 6:
 *      ?p6_theme_x=25&p6_theme_y=350&p6_theme_w=550&p6_theme_size=18&p6_theme_maxLines=12
 *
 *  • P7/P8 (colleagues) & P9/P10 (leaders) — individual box tuning:
 *      P7: ?p7_col0_x=40&p7_col0_y=240&p7_col0_w=300&p7_col0_h=120  (C)
 *          ?p7_col1_x=410&...  (T) · ?p7_col2_* (R) · ?p7_col3_* (L)
 *          ?p7_bodySize=10&p7_maxLines=9
 *      P9: ?p9_ldr2_x=60&p9_ldr2_y=270&p9_ldr2_w=300&p9_ldr2_h=120  (R)
 *          (…ldr0 C, ldr1 T, ldr2 R, ldr3 L)
 *
 *  • PAGE 11 (no “Tips/Actions” headers):
 *      ?p11_tipsBox_x=40&p11_tipsBox_y=175&p11_tipsBox_w=315&p11_tipsBox_size=18&p11_tipsBox_maxLines=12
 *      ?p11_actsBox_x=40&p11_actsBox_y=355&p11_actsBox_w=315&p11_actsBox_size=18&p11_actsBox_maxLines=12
 *
 * Debug:
 *  • Append &debug=1 to log the resolved Page-3 state anchor (safe, no throw).
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
    // typographic punctuation → WinAnsi-friendly
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    // kill troublesome glyphs that break WinAnsi (emoji, PUA, VS, ZW)
    .replace(/[\uD800-\uDFFF]/g, "")       // surrogate pairs (all emoji)
    .replace(/[\uE000-\uF8FF]/g, "")       // private use area
    .replace(/[\uFE0E\uFE0F]/g, "")        // variation selectors 15/16
    .replace(/[\u200B-\u200D\u2060]/g, "") // zero-width chars
    // whitespace tidy
    .replace(/\t/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    // ASCII control cleanup (keep \n)
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "")
    .trim();

const todayLbl = () => {
  const now = new Date();
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
  return `${String(now.getDate()).padStart(2,"0")}/${MMM}/${now.getFullYear()}`;
};

const ensureArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** base64url → JSON (accepts base64 or base64url, optionally URL-encoded) */
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
  const yTop    = pageH - y; // TL → BL conversion baseline
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

// Convert a TL-spec rectangle {x,y,w,h} to BL for pdf-lib drawing
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

  // Label anchor (kept in TL space so drawTextBox() can convert)
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

/* ───────────────────────── Default coordinates (safe, tunable) ───────────── */

const LOCKED = {
  p1: {
    name: { x: 7,   y: 473,  w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600,  w: 500, size: 25, align: "left"   }
  },
  footer: (() => {
    // Left footer text defaults (f2..f12)
    const f = { x: 380, y: 51, w: 400, size: 13, align: "left" };
    // We no longer render page numbers; keep n* for backward layout compatibility.
    const n = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
    return {
      f2:{...f}, f3:{...f}, f4:{...f}, f5:{...f}, f6:{...f}, f7:{...f}, f8:{...f}, f9:{...f}, f10:{...f}, f11:{...f}, f12:{...f},
      n2:{...n}, n3:{...n}, n4:{...n}, n5:{...n}, n6:{...n}, n7:{...n}, n8:{...n}, n9:{...n}, n10:{...n}, n11:{...n}, n12:{...n}
    };
  })()
};

const DEFAULT_COORDS = {
  meta:  { units: "pt", origin: "TL", pages: "1-based" },

  // PAGE 1 — cover (overridable by URL tuners)
  p1: {
    name: { x: 7, y: 473, w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600, w: 500, size: 25, align: "left" }
  },

  // PAGE 3 — text + state highlight
  p3: {
    domChar: { x:  272, y: 640, w: 630, size: 23, align: "left"  },
    domDesc: { x:   25, y: 685, w: 550, size: 18, align: "left"  },
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
        R: { radius: 1000, inset: 1  }, // pill
        L: { radius: 28,   inset: 6  }
      },
      labelByState: {
        C: { x:  60, y: 245 },
        T: { x: 290, y: 244 },
        R: { x:  60, y: 605 },
        L: { x: 290, y: 605 }
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
        L: { x: 298, y: 430, w: 195, h: 173 }
      },
      grid: { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 }
    }
  },

  // PAGE 4
  p4: {
    spider: { x:  30, y: 585, w: 550, size: 18, align: "left" },
    spiderMaxLines: 10,
    chart:  { x:  20, y: 225, w: 570, h: 280 }
  },

  // PAGE 5
  p5: { seqpat: { x: 25, y: 250, w: 550, size: 18, align: "left" }, seqpatMaxLines: 12 },

  // PAGE 6
  p6: { theme:  { x: 25, y: 350, w: 550, size: 18, align: "left" }, themeMaxLines: 12 },

  // PAGE 7 — LOOK · colleagues
  p7: {
    header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
    colBoxes: [
      { x:  40, y: 240, w: 300, h: 120 },  // C
      { x: 410, y: 140, w: 300, h: 120 },  // T
      { x:  60, y: 270, w: 300, h: 120 },  // R (default; tune via URL)
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

  // PAGE 11 — Tips + Actions (NO HEADERS)
  p11: {
    // headers kept in layout for backward compat but not drawn
    tipsHdr: { x:  30, y: 500, w: 300, size: 17, align: "left" },
    actsHdr: { x: 320, y: 500, w: 300, size: 17, align: "left" },
    tipsBox: { x:  40, y: 175, w: 315, size: 18, align: "left" },
    actsBox: { x:  40, y: 355, w: 315, size: 18, align: "left" },
    tipsMaxLines: 12,
    actsMaxLines: 12
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
    // deep merges for nested page-3 state
    if (base?.p3?.state) {
      L.p3.state = { ...(L.p3.state || {}), ...(base.p3.state || {}) };
      if (base.p3.state.absBoxes) {
        L.p3.state.absBoxes = { ...(L.p3.state.absBoxes || {}), ...(base.p3.state.absBoxes || {}) };
      }
      if (base.p3.state.labelByState) {
        L.p3.state.labelByState = { ...(L.p3.state.labelByState || {}), ...(base.p3.state.labelByState || {}) };
      }
      if (base.p3.state.styleByState) {
        L.p3.state.styleByState = { ...(L.p3.state.styleByState || {}), ...(base.p3.state.styleByState || {}) };
      }
    }
  }
  // Footers always start from LOCKED defaults
  L.footer = { ...(LOCKED.footer), ...((base && base.footer) || {}) };
  return L;
}

function truthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function applyUrlTuners(q, L) {
  const pick = (obj, keys) => keys.reduce((o, k) => (obj[k] != null ? (o[k] = obj[k], o) : o), {});

  // PAGE 1 — name/date
  for (const f of ["name","date"]) {
    const P = pick(q, [`p1_${f}_x`,`p1_${f}_y`,`p1_${f}_w`,`p1_${f}_size`,`p1_${f}_align`]);
    if (Object.keys(P).length) {
      L.p1[f] = { ...(L.p1[f]||{}),
        x:N(P[`p1_${f}_x`],L.p1[f]?.x), y:N(P[`p1_${f}_y`],L.p1[f]?.y),
        w:N(P[`p1_${f}_w`],L.p1[f]?.w), size:N(P[`p1_${f}_size`],L.p1[f]?.size),
        align:S(P[`p1_${f}_align`],L.p1[f]?.align)
      };
    }
  }

  // Footers f*/n* (we draw f* only; n* kept for compat)
  for (const pn of ["f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12","n2","n3","n4","n5","n6","n7","n8","n9","n10","n11","n12"]) {
    const spec = pick(q, [`${pn}_x`, `${pn}_y`, `${pn}_w`, `${pn}_size`, `${pn}_align`]);
    if (Object.keys(spec).length) {
      L.footer[pn] = { ...(L.footer[pn]||{}),
        x:N(spec[`${pn}_x`],L.footer[pn]?.x), y:N(spec[`${pn}_y`],L.footer[pn]?.y),
        w:N(spec[`${pn}_w`],L.footer[pn]?.w), size:N(spec[`${pn}_size`],L.footer[pn]?.size),
        align:S(spec[`${pn}_align`],L.footer[pn]?.align)
      };
    }
  }

  // p3 domChar/domDesc + maxLines
  for (const f of ["domChar","domDesc"]) {
    const P = pick(q, [`p3_${f}_x`,`p3_${f}_y`,`p3_${f}_w`,`p3_${f}_size`,`p3_${f}_align`]);
    if (Object.keys(P).length) L.p3[f] = { ...(L.p3[f]||{}),
      x:N(P[`p3_${f}_x`],L.p3[f]?.x), y:N(P[`p3_${f}_y`],L.p3[f]?.y),
      w:N(P[`p3_${f}_w`],L.p3[f]?.w), size:N(P[`p3_${f}_size`],L.p3[f]?.size),
      align:S(P[`p3_${f}_align`],L.p3[f]?.align)
    };
    if (q[`p3_${f}_maxLines`] != null) L.p3[`${f}MaxLines`] = N(q[`p3_${f}_maxLines`], L.p3[`${f}MaxLines`]);
  }

  // p3 state (abs boxes + label offsets + per-state label overrides)
  // Global flags (aliases)
  if (q.state_useAbs != null) L.p3.state.useAbsolute = truthy(q.state_useAbs);
  if (q.state_shape != null)  L.p3.state.shape = String(q.state_shape || "round");
  if (q.state_radius != null) L.p3.state.highlightRadius = N(q.state_radius, L.p3.state.highlightRadius);
  if (q.state_inset  != null) L.p3.state.highlightInset  = N(q.state_inset,  L.p3.state.highlightInset);
  if (q.state_opacity!= null) L.p3.state.fillOpacity     = N(q.state_opacity, L.p3.state.fillOpacity);
  if (q.labelText     != null) L.p3.state.labelText      = S(q.labelText, L.p3.state.labelText);
  if (q.labelSize     != null) L.p3.state.labelSize      = N(q.labelSize, L.p3.state.labelSize);

  for (const k of ["C","T","R","L"]) {
    // Verbose abs:* tuners
    const keyV = `p3_state_abs_${k}`;
    const PV = pick(q, [`${keyV}_x`,`${keyV}_y`,`${keyV}_w`,`${keyV}_h`]);
    if (Object.keys(PV).length) {
      L.p3.state.absBoxes[k] = { ...(L.p3.state.absBoxes[k]||{}),
        x:N(PV[`${keyV}_x`],L.p3.state.absBoxes[k]?.x),
        y:N(PV[`${keyV}_y`],L.p3.state.absBoxes[k]?.y),
        w:N(PV[`${keyV}_w`],L.p3.state.absBoxes[k]?.w),
        h:N(PV[`${keyV}_h`],L.p3.state.absBoxes[k]?.h)
      };
    }
    // Short abs:* tuners
    const keyS = `abs_${k}`;
    const PS = pick(q, [`${keyS}_x`,`${keyS}_y`,`${keyS}_w`,`${keyS}_h`]);
    if (Object.keys(PS).length) {
      L.p3.state.absBoxes[k] = { ...(L.p3.state.absBoxes[k]||{}),
        x:N(PS[`${keyS}_x`],L.p3.state.absBoxes[k]?.x),
        y:N(PS[`${keyS}_y`],L.p3.state.absBoxes[k]?.y),
        w:N(PS[`${keyS}_w`],L.p3.state.absBoxes[k]?.w),
        h:N(PS[`${keyS}_h`],L.p3.state.absBoxes[k]?.h)
      };
    }
    // Per-state label overrides (verbose)
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

  // Legacy paired label tuners (optional): labelCTx/labelCTy apply to C & T; labelRLx/labelRLy apply to R & L
  if (q.labelCTx != null) { L.p3.state.labelByState.C = { ...(L.p3.state.labelByState.C||{}), x:N(q.labelCTx, L.p3.state.labelByState.C?.x) };
                            L.p3.state.labelByState.T = { ...(L.p3.state.labelByState.T||{}), x:N(q.labelCTx, L.p3.state.labelByState.T?.x) }; }
  if (q.labelCTy != null) { L.p3.state.labelByState.C = { ...(L.p3.state.labelByState.C||{}), y:N(q.labelCTy, L.p3.state.labelByState.C?.y) };
                            L.p3.state.labelByState.T = { ...(L.p3.state.labelByState.T||{}), y:N(q.labelCTy, L.p3.state.labelByState.T?.y) }; }
  if (q.labelRLx != null) { L.p3.state.labelByState.R = { ...(L.p3.state.labelByState.R||{}), x:N(q.labelRLx, L.p3.state.labelByState.R?.x) };
                            L.p3.state.labelByState.L = { ...(L.p3.state.labelByState.L||{}), x:N(q.labelRLx, L.p3.state.labelByState.L?.x) }; }
  if (q.labelRLy != null) { L.p3.state.labelByState.R = { ...(L.p3.state.labelByState.R||{}), y:N(q.labelRLy, L.p3.state.labelByState.R?.y) };
                            L.p3.state.labelByState.L = { ...(L.p3.state.labelByState.L||{}), y:N(q.labelRLy, L.p3.state.labelByState.L?.y) }; }

  // p4 spider + chart (+ maxLines for spider)
  const s4 = pick(q, ["p4_spider_x","p4_spider_y","p4_spider_w","p4_spider_size","p4_spider_align"]);
  if (Object.keys(s4).length) {
    L.p4.spider = { ...(L.p4.spider||{}),
      x:N(s4.p4_spider_x,L.p4.spider?.x), y:N(s4.p4_spider_y,L.p4.spider?.y),
      w:N(s4.p4_spider_w,L.p4.spider?.w), size:N(s4.p4_spider_size,L.p4.spider?.size),
      align:S(s4.p4_spider_align,L.p4.spider?.align)
    };
  }
  if (q.p4_spider_maxLines != null) L.p4.spiderMaxLines = N(q.p4_spider_maxLines, L.p4.spiderMaxLines);
  const c4 = pick(q, ["p4_chart_x","p4_chart_y","p4_chart_w","p4_chart_h"]);
  if (Object.keys(c4).length) {
    L.p4.chart = { ...(L.p4.chart||{}),
      x:N(c4.p4_chart_x,L.p4.chart?.x), y:N(c4.p4_chart_y,L.p4.chart?.y),
      w:N(c4.p4_chart_w,L.p4.chart?.w), h:N(c4.p4_chart_h,L.p4.chart?.h)
    };
  }

  // p5 seqpat (+ maxLines)
  const p5 = pick(q, ["p5_seqpat_x","p5_seqpat_y","p5_seqpat_w","p5_seqpat_size","p5_seqpat_align"]);
  if (Object.keys(p5).length) {
    L.p5.seqpat = { ...(L.p5.seqpat||{}),
      x:N(p5.p5_seqpat_x,L.p5.seqpat?.x), y:N(p5.p5_seqpat_y,L.p5.seqpat?.y),
      w:N(p5.p5_seqpat_w,L.p5.seqpat?.w), size:N(p5.p5_seqpat_size,L.p5.seqpat?.size),
      align:S(p5.p5_seqpat_align,L.p5.seqpat?.align)
    };
  }
  if (q.p5_seqpat_maxLines != null) L.p5.seqpatMaxLines = N(q.p5_seqpat_maxLines, L.p5.seqpatMaxLines);

  // p6 theme (+ maxLines)
  const p6 = pick(q, ["p6_theme_x","p6_theme_y","p6_theme_w","p6_theme_size","p6_theme_align"]);
  if (Object.keys(p6).length) {
    L.p6.theme = { ...(L.p6.theme||{}),
      x:N(p6.p6_theme_x,L.p6.theme?.x), y:N(p6.p6_theme_y,L.p6.theme?.y),
      w:N(p6.p6_theme_w,L.p6.theme?.w), size:N(p6.p6_theme_size,L.p6.theme?.size),
      align:S(p6.p6_theme_align,L.p6.theme?.align)
    };
  }
  if (q.p6_theme_maxLines != null) L.p6.themeMaxLines = N(q.p6_theme_maxLines, L.p6.themeMaxLines);

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
    if (q[`${p}_bodySize`] != null) L[p].bodySize = N(q[`${p}_bodySize`], L[p].bodySize);
    if (q[`${p}_maxLines`] != null) L[p].maxLines = N(q[`${p}_maxLines`], L[p].maxLines);
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
    if (q[`${p}_bodySize`] != null) L[p].bodySize = N(q[`${p}_bodySize`], L[p].bodySize);
    if (q[`${p}_maxLines`] != null) L[p].maxLines = N(q[`${p}_maxLines`], L[p].maxLines);
  }

  // p11 tips/actions (no titles) + per-box maxLines
  for (const f of ["tipsBox","actsBox"]) {
    const P = pick(q, [`p11_${f}_x`,`p11_${f}_y`,`p11_${f}_w`,`p11_${f}_size`,`p11_${f}_align`]);
    if (Object.keys(P).length) {
      L.p11[f] = { ...(L.p11[f]||{}),
        x:N(P[`p11_${f}_x`],L.p11[f]?.x), y:N(P[`p11_${f}_y`],L.p11[f]?.y),
        w:N(P[`p11_${f}_w`],L.p11[f]?.w), size:N(P[`p11_${f}_size`],L.p11[f]?.size),
        align:S(P[`p11_${f}_align`],L.p11[f]?.align)
      };
    }
  }
  if (q.p11_tipsBox_maxLines != null) L.p11.tipsMaxLines = N(q.p11_tipsBox_maxLines, L.p11.tipsMaxLines);
  if (q.p11_actsBox_maxLines != null) L.p11.actsMaxLines = N(q.p11_actsBox_maxLines, L.p11.actsMaxLines);

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
  // Fallback attempts
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

    // NEW: gate logs behind ?debug=1 (or true)
    const DBG = String(q.debug || "").toLowerCase() === "1" || String(q.debug || "").toLowerCase() === "true";

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

    // Page helpers (1-based in comments, 0-based indexing)
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
    if (L.p1?.name && P.name)     drawTextBox(page1, font, norm(P.name),    L.p1.name, { maxLines: 1 });
    if (L.p1?.date && P.dateLbl)  drawTextBox(page1, font, norm(P.dateLbl), L.p1.date, { maxLines: 1 });

    /* ----------------------------- PAGE 3 ----------------------------- */
    if (P.domChar) drawTextBox(page3, font, P.domChar, L.p3.domChar, { maxLines: N(L.p3.domCharMaxLines,6) });
    if (P.domDesc) drawTextBox(page3, font, P.domDesc, L.p3.domDesc, { maxLines: N(L.p3.domDescMaxLines,12) });

    const dom = resolveDomKey(P.dom, P.domChar, P.domDesc);
    if (dom) {
      const anchor = paintStateHighlight(page3, dom, L.p3.state || {});

      // DEBUG (safe): show resolved positions if &debug=1
      if (DBG) {
        const lab = (L.p3?.state?.labelByState?.[dom]) || {};
        const box = (L.p3?.state?.absBoxes?.[dom]) || {};
        console.log(
          `[PDF] p3 · dom=${dom} · labelByState=(${lab.x},${lab.y}) · absBox=(${box.x},${box.y},${box.w},${box.h}) · anchor=${anchor ? `(${anchor.labelX},${anchor.labelY})` : "<none>"}`
        );
      }

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
        const pageH = page4.getHeight();
        const x = N(L.p4.chart.x), y = N(L.p4.chart.y), w = N(L.p4.chart.w), h = N(L.p4.chart.h);
        page4.drawImage(img, { x, y: pageH - y - h, width: w, height: h });
      }
    }

    /* ----------------------------- PAGE 5 ----------------------------- */
    if (P.seqpat) drawTextBox(page5, font, P.seqpat, L.p5.seqpat, { maxLines: N(L.p5.seqpatMaxLines,12) });

    /* ----------------------------- PAGE 6 ----------------------------- */
    if (P.theme) drawTextBox(page6, font, P.theme, L.p6.theme, { maxLines: N(L.p6.themeMaxLines,12) });

    /* ----------------------------- PAGE 7 ----------------------------- *
       LOOK — colleagues                                                  */
    if (L.p7?.colBoxes?.length) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p7.colBoxes[i];
        const item = P.workwcol.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwcol[i] || {};
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
        const item = P.workwcol.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwcol[i] || {};
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
        const item = P.workwlead.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwlead[i] || {};
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
        const item = P.workwlead.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwlead[i] || {};
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page10, font, txt, bx, L.p10.bodySize || 10, "left", { maxLines: N(L.p10.maxLines, 9), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 11 ---------------------------- *
       Tips & Actions (bulleted, no headers)                              */
    if (P.tips?.length || P.actions?.length) {
      // Intentionally NOT drawing titles per spec
      if (L.p11?.tipsBox && P.tips?.length) {
        drawBulleted(page11, font, P.tips,    L.p11.tipsBox, { maxLines: N(L.p11.tipsMaxLines, 12) });
      }
      if (L.p11?.actsBox && P.actions?.length) {
        drawBulleted(page11, font, P.actions, L.p11.actsBox, { maxLines: N(L.p11.actsMaxLines, 12) });
      }
    }

    /* ------------------------------ FOOTERS --------------------------- */
    const footerSpec = L.footer || LOCKED.footer;
    const footerLabel = norm(P.name || ""); // NAME ONLY
    const put = (idx, key, text) => {
      const spec = footerSpec[key];
      if (!spec || !text) return;
      drawTextBox(pages[idx], font, text, spec, { maxLines: 1 });
    };
    // 1-based page indices we draw on: 2..12 (array is 0-based)
    put(1,  "f2",  footerLabel);
    put(2,  "f3",  footerLabel);
    put(3,  "f4",  footerLabel);
    put(4,  "f5",  footerLabel);
    put(5,  "f6",  footerLabel);
    put(6,  "f7",  footerLabel);
    put(7,  "f8",  footerLabel);
    put(8,  "f9",  footerLabel);
    put(9,  "f10", footerLabel);
    put(10, "f11", footerLabel);
    put(11, "f12", footerLabel);
    // Page numbers intentionally not rendered.

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
