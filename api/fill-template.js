// /api/fill-template.js — CTRL V3 Exporter (clean)
// - Pages 7–10 split (LOOK/WORK × Colleagues/Leaders)
// - Tips & Actions on page 11
// - Footer page numbers include n11 & n12
// - Robust WinAnsi sanitizer (Option 1)
// - All coordinates tunable via URL (safe defaults locked)
// - Template defaults to /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
//   and also supports tpl=<https URL> (e.g., GitHub raw)

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────────────────────── Utilities ───────────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const toRGB = (c, fb) =>
  (c && typeof c === "object" && "r" in c) ? rgb(c.r ?? 0, c.g ?? 0, c.b ?? 0) : (c || fb);

// WinAnsi-safe normaliser (Option 1)
function norm(input, fb = "") {
  let s = S(input, fb);
  s = s
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2022\u2043\u2219]/g, "•") // unify bullets (we render our own)
    .replace(/[\u279C\u27A1\u2192\u21AA\u21A9]/g, "->")
    .replace(/[\u2705\u2713\u2714]/g, "[check]")
    .replace(/[\u274C\u2716]/g, "[x]")
    .replace(/[\u26A0\u2757]/g, "[!]")
    .replace(/[\u{1F449}\u{1F448}\u{1F44D}\u{1F44E}]/gu, "->");
  s = s.replace(/[^\x09\x0A\x0D\x20-\xFF]/g, ""); // drop > Latin-1
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

const todayLbl = () => {
  const now = new Date();
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
  return `${String(now.getDate()).padStart(2,"0")}/${MMM}/${now.getFullYear()}`;
};
const ensureArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/* base64url → JSON (accepts base64 or base64url) */
function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
  catch { return {}; }
}

/* ─────────────────────────── Drawing helpers ───────────────────────── */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  if (!page || !font || w <= 0 || size <= 0) {
    const pageH = page?.getHeight?.() ?? 0;
    return { height: 0, linesDrawn: 0, lastY: pageH - y };
  }

  const clean = norm(text);
  if (!clean) {
    const pageH = page.getHeight();
    return { height: 0, linesDrawn: 0, lastY: pageH - y };
  }

  const lines = clean.split("\n");
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];

  for (const raw of lines) {
    let t = raw;
    while (t.length > maxChars) {
      let cut = t.lastIndexOf(" ", maxChars);
      if (cut <= 0) cut = maxChars;
      wrapped.push(t.slice(0, cut));
      t = t.slice(cut).trim();
    }
    wrapped.push(t);
    if (raw.trim() === "") wrapped.push("");
  }

  const out = wrapped.length > maxLines
    ? wrapped.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, "…") : s))
    : wrapped;

  const pageH   = page.getHeight();
  const yTop    = pageH - y; // TL → BL baseline
  const widthOf = (s) => font.widthOfTextAtSize(s, Math.max(1, size));
  const lineH   = Math.max(1, size) + (lineGap ?? 3);

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
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
    indent = 18, gap = 2, bulletRadius = 1.8,
  } = spec;

  if (!Array.isArray(items) || !items.length || w <= 0 || size <= 0) return { height: 0 };

  const pageH = page.getHeight();
  let curY = y;
  const blockGap = N(opts.blockGap, 6);
  const strip = (s) => norm(s || "").replace(/^[\s•\-\u2022]*\b(Tips?|Actions?)\s*:\s*/i, "").trim();

  for (const raw of items) {
    const text = strip(raw);
    if (!text) continue;

    const line = drawTextBox(
      page, font, text,
      { x: x + indent + gap, y: curY, w: w - indent - gap, size, lineGap, color, align },
      { maxLines: opts.maxLines ?? 26, ellipsis: false }
    );

    // Bullet anchored to first line baseline
    const baseline = (pageH - curY) - size * 0.2;
    if (typeof page.drawCircle === "function") {
      page.drawCircle({ x: x + bulletRadius, y: baseline, size: bulletRadius, color });
    } else {
      page.drawRectangle({ x, y: baseline - bulletRadius, width: bulletRadius * 2, height: bulletRadius * 2, color });
    }

    curY += (line.height || (size + lineGap)) + blockGap;
  }
  return { height: curY - y };
}

/* ───────────── Superellipse helpers for Page 3 highlight ───────────── */
function superellipseHalfWidth(a, b, yRel, n) {
  const t = Math.min(1, Math.max(0, Math.pow(Math.abs(yRel) / b, n)));
  const x = a * Math.pow(1 - t, 1 / n);
  return x;
}
function fillSuperellipseStrips(page, xBL, yBL, w, h, n = 4, step = 2, color = rgb(1,0,0), opacity = 0.45) {
  const a = w / 2, b = h / 2;
  const cx = xBL + a, cy = yBL + b;
  const dy = Math.max(1, Math.min(step, 6));
  for (let yy = -b; yy <= b; yy += dy) {
    const half = superellipseHalfWidth(a, b, yy, n);
    const x0 = cx - half;
    const y0 = cy + yy;
    const ww = half * 2;
    const hh = Math.min(dy, (b - yy));
    if (ww > 0 && hh > 0) {
      page.drawRectangle({ x: x0, y: y0, width: ww, height: hh, color, opacity });
    }
  }
}
function makeSuperellipsePath(xBL, yBL, w, h, n = 4, steps = 96) {
  const a = w / 2, b = h / 2;
  const cx = xBL + a, cy = yBL + b;
  const pow = (v, p) => Math.pow(Math.abs(v), 2 / p) * Math.sign(v);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const px = cx + a * pow(ct, n);
    const py = cy + b * pow(st, n);
    pts.push([px, py]);
  }
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  d += " Z";
  return d;
}

/* ─────────────── Page 3 highlight (round or squircle) ─────────────── */
async function paintStateHighlight(pdf, page3, dominantKey, L) {
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cfg  = L.p3.state || {};

  const upper = String(dominantKey || "").toUpperCase();
  const dom = ["C","T","R","L"].includes(upper) ? upper : "R";

  const styleByState = cfg.styleByState || {};
  const dStyle = styleByState[dom] || {};

  const useAbs = !!cfg.useAbsolute;
  const inset  = Number.isFinite(+dStyle.inset)  ? +dStyle.inset  : N(cfg.highlightInset, 6);
  const radius = Number.isFinite(+dStyle.radius) ? +dStyle.radius : N(cfg.highlightRadius, 28);

  const labelText  = S(cfg.labelText || "YOU ARE HERE");
  const labelSize  = N(cfg.labelSize, 10);
  const labelColor = toRGB(cfg.labelColor, rgb(0.20, 0.20, 0.20));
  const shade      = toRGB(cfg.fillColor,  rgb(251/255, 236/255, 250/255)); // #FBECFA
  const opacity    = N(cfg.fillOpacity, 0.45);

  const BOXES = useAbs ? (cfg.absBoxes || {}) : computeBoxesFromGrid(cfg.grid || defaultP3Grid());
  const b = BOXES[dom];
  if (!b) return;

  // TL → BL for pdf-lib
  const tlX = b.x + inset;
  const tlY = b.y + inset;
  const ww  = Math.max(0, b.w - inset * 2);
  const hh  = Math.max(0, b.h - inset * 2);
  const pageH = page3.getHeight();
  const blX = tlX;
  const blY = pageH - (tlY + hh);

  const shape = (cfg.shape || cfg.state_shape || "round").toLowerCase();

  if (shape === "squircle") {
    if (typeof page3.drawSvgPath === "function") {
      const Nexp  = Number.isFinite(+cfg.n)     ? +cfg.n     : 4;
      const steps = Number.isFinite(+cfg.steps) ? +cfg.steps : 96;
      const dPath = makeSuperellipsePath(blX, blY, ww, hh, Nexp, steps);
      page3.drawSvgPath(dPath, { color: shade, opacity });
    } else {
      const Nexp  = Number.isFinite(+cfg.n)     ? +cfg.n     : 4;
      const step  = Number.isFinite(+cfg.steps) ? Math.max(1, Math.round(+cfg.steps / 16)) : 2;
      fillSuperellipseStrips(page3, blX, blY, ww, hh, Nexp, step, shade, opacity);
    }
  } else {
    page3.drawRectangle({ x: blX, y: blY, width: ww, height: hh, color: shade, opacity, borderRadius: radius });
  }

  // Label anchoring
  const perState = (cfg.labelByState && cfg.labelByState[dom]) || null;
  const isCT = (dom === "C" || dom === "T");
  const groupAnchor = isCT ? (cfg.labelCT || null) : (cfg.labelRL || null);
  const offX = N(cfg.labelOffsetX, 0);
  const offY = N(cfg.labelOffsetY, 0);

  let lx, ly;
  if (perState && Number.isFinite(+perState.x) && Number.isFinite(+perState.y)) {
    lx = +perState.x; ly = +perState.y;
  } else if (groupAnchor && Number.isFinite(+groupAnchor.x) && Number.isFinite(+groupAnchor.y)) {
    lx = +groupAnchor.x; ly = +groupAnchor.y;
  } else {
    const cx = b.x + b.w / 2;
    const py = isCT ? (b.y + b.h - N(cfg.labelPadTop, 12)) : (b.y + N(cfg.labelPadBottom, 12));
    lx = cx; ly = py;
  }

  const textW = bold.widthOfTextAtSize(labelText, labelSize);
  page3.drawText(labelText, {
    x: lx - textW / 2 + offX,
    y: (pageH - ly) - labelSize + offY,
    size: labelSize,
    font: bold,
    color: labelColor
  });
}

function defaultP3Grid() {
  return { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 };
}
function computeBoxesFromGrid(g) {
  const { marginX, marginY, gap, boxW, boxH } = { ...defaultP3Grid(), ...(g || {}) };
  return {
    T: { x: marginX,              y: marginY,              w: boxW, h: boxH },
    C: { x: marginX + boxW + gap, y: marginY,              w: boxW, h: boxH },
    R: { x: marginX,              y: marginY - boxH - gap, w: boxW, h: boxH },
    L: { x: marginX + boxW + gap, y: marginY - boxH - gap, w: boxW, h: boxH }
  };
}

/* ────────────────────── domKey resolution (bulletproof) ───────────────────── */
function resolveDomKey(d) {
  const mapLabel = { concealed: "C", triggered: "T", regulated: "R", lead: "L" };
  const mapChar  = { art: "C", fal: "T", mika: "R", sam: "L" };

  const cand = [
    d.domkey, d.domKey, d.dom6Key, d.dom6key,
    d.dom, d.dom6Label, d.domlabel, d.domLabel,
    d.domchar, d.character
  ].map(x => String(x || "").trim());

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
function normaliseInput(data) {
  const d = { ...(data || {}) };
  d.f = d.f || d.flow || "Perspective";
  d.n = d.n || (d.person && (d.person.preferredName || d.person.fullName)) || "";
  d.d = d.d || d.dateLbl || todayLbl();

  d.dom     = d.dom     || d.dom6Label || "";
  d.domchar = d.domchar || d.character || "";
  d.domdesc = d.domdesc || d.dominantDesc || "";

  d.spiderfreq = d.spiderfreq || d.chartUrl || "";
  d.spiderdesc = d.spiderdesc || d.how6 || "";

  const resKey = resolveDomKey(d);
  d.domkey = resKey || d.domkey || d.dom6Key || d.domKey || "";

  if (!d.seqpat || !d.theme) {
    const b = Array.isArray(d.page7Blocks) ? d.page7Blocks : [];
    d.seqpat = d.seqpat || (b[0] && b[0].body) || "";
    d.theme  = d.theme  || (b[1] && b[1].body) || "";
  }

  // People pages: arrays of { their: 'C'|'T'|'R'|'L', look: string, work: string }
  d.workwcol  = Array.isArray(d.workwcol)  ? d.workwcol  : (d.workWith && d.workWith.colleagues) || [];
  d.workwlead = Array.isArray(d.workwlead) ? d.workwlead : (d.workWith && d.workWith.leaders)    || [];

  d.tips    = ensureArray(d.tips && d.tips.length ? d.tips : (d.tips2 || []));
  d.actions = ensureArray(d.actions && d.actions.length ? d.actions : (d.actions2 || []));

  return d;
}

/* ───────────────────────── Layout defaults + locks ───────────────────────── */
function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = Array.isArray(base) ? base.slice() : { ...(base || {}) };
  for (const k of Object.keys(patch)) {
    const pv = patch[k], bv = out[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv)) out[k] = deepMerge(bv || {}, pv);
    else out[k] = pv;
  }
  return out;
}

// LOCKED page-1 + footer coords (n2..n12). Tunable via URL; we keep locked defaults.
const LOCKED = {
  p1: {
    name: { x: 7,   y: 473,  w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600,  w: 500, size: 25, align: "left"   }
  },
  footer: (() => {
    const one = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
    return {
      n2:{...one}, n3:{...one}, n4:{...one}, n5:{...one}, n6:{...one},
      n7:{...one}, n8:{...one}, n9:{...one},
      n10:{ x: 250, y: 64, w: 400, size: 12, align: "center" },
      n11:{...one}, n12:{...one}
    };
  })()
};

function buildLayout(layoutV6) {
  const L = {
    meta: { units: "pt", origin: "TL", pages: "1-based" },

    // PAGE 1 (locked)
    p1: { name: LOCKED.p1.name, date: LOCKED.p1.date },

    // FOOTERS 2–12 (locked defaults; tunable via URL)
    footer: LOCKED.footer,

    // PAGE 3 — text + state highlight (hard-locked defaults, tunable via URL)
    p3: {
      domChar: { x:  60, y: 170, w: 650, size: 11, align: "left"  },
      domDesc: { x:  60, y: 200, w: 650, size: 11, align: "left"  },

      state: {
        useAbsolute: true,
        shape: "round",
        highlightRadius: 28,
        highlightInset: 6,
        fillOpacity: 0.45,
        fillColor: rgb(251/255, 236/255, 250/255), // #FBECFA
        styleByState: {
          C: { radius: 28,   inset: 6  },
          T: { radius: 28,   inset: 6  },
          R: { radius: 1000, inset: 1  }, // big rounded pill
          L: { radius: 28,   inset: 6  }
        },
        labelByState: {
          C: { x: 150, y: 245 },
          T: { x: 390, y: 244 },
          R: { x: 150, y: 612 },
          L: { x: 390, y: 605 }
        },
        labelCT: { x: 180, y: 655 },
        labelRL: { x: 180, y: 365 },
        labelText: "YOU ARE HERE",
        labelSize: 10,
        labelColor: rgb(0.20, 0.20, 0.20),
        labelOffsetX: 0,
        labelOffsetY: 0,
        labelPadTop: 12,
        labelPadBottom: 12,
        absBoxes: {
          R: { x:  60, y: 433, w: 188, h: 158 },
          C: { x:  58, y: 258, w: 188, h: 156 },
          T: { x: 299, y: 258, w: 188, h: 156 },
          L: { x: 298, y: 440, w: 188, h: 156 }
        },
        grid: { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 },
        n: 4, steps: 128
      }
    },

    // PAGE 4 — chart page
    p4: {
      spider: { x:  60, y: 320, w: 280, size: 11, align: "left" },
      chart:  { x: 360, y: 320, w: 260, h: 260 }
    },

    // PAGE 5 — sequence pattern
    p5: { seqpat: { x:  60, y: 160, w: 650, size: 11, align: "left" } },

    // PAGE 6 — theme
    p6: { theme:  { x:  60, y: 160, w: 650, size: 11, align: "left" } },

    // PAGE 7 — LOOK – colleagues
    p7: {
      header: { x: 60, y: 110, w: 650, size: 0, align: "left" }, // hidden by default
      colBoxes: [
        { x:  60, y: 140, w: 300, h: 120 },  // C
        { x: 410, y: 140, w: 300, h: 120 },  // T
        { x:  60, y: 270, w: 300, h: 120 },  // R
        { x: 410, y: 270, w: 300, h: 120 }   // L
      ],
      bodySize: 10,
      maxLines: 9
    },

    // PAGE 8 — WORK – colleagues
    p8: {
      header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
      colBoxes: [
        { x:  60, y: 140, w: 300, h: 120 },  // C
        { x: 410, y: 140, w: 300, h: 120 },  // T
        { x:  60, y: 270, w: 300, h: 120 },  // R
        { x: 410, y: 270, w: 300, h: 120 }   // L
      ],
      bodySize: 10,
      maxLines: 9
    },

    // PAGE 9 — LOOK – leaders
    p9: {
      header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
      ldrBoxes: [
        { x:  60, y: 140, w: 300, h: 120 },  // C
        { x: 410, y: 140, w: 300, h: 120 },  // T
        { x:  60, y: 270, w: 300, h: 120 },  // R
        { x: 410, y: 270, w: 300, h: 120 }   // L
      ],
      bodySize: 10,
      maxLines: 9
    },

    // PAGE 10 — WORK – leaders
    p10: {
      header: { x: 60, y: 110, w: 650, size: 0, align: "left" },
      ldrBoxes: [
        { x:  60, y: 140, w: 300, h: 120 },  // C
        { x: 410, y: 140, w: 300, h: 120 },  // T
        { x:  60, y: 270, w: 300, h: 120 },  // R
        { x: 410, y: 270, w: 300, h: 120 }   // L
      ],
      bodySize: 10,
      maxLines: 9
    },

    // PAGE 11 — Tips & Actions
    p11: {
      tipsHdr: { x:  30, y: 500, w: 300, size: 17, align: "left" },
      actsHdr: { x: 320, y: 500, w: 300, size: 17, align: "left" },
      tipsBox: { x:  30, y: 530, w: 300, size: 17, align: "left", indent: 14, gap: 2 },
      actsBox: { x: 320, y: 530, w: 300, size: 17, align: "left", indent: 14, gap: 2 },
      maxLines: 12
    }
  };

  // Merge payload overrides; re-lock p1 + footer + p3.state
  if (layoutV6 && typeof layoutV6 === "object") {
    try {
      const merged = deepMerge(L, layoutV6);
      merged.p1     = { ...merged.p1, name: LOCKED.p1.name, date: LOCKED.p1.date };
      merged.footer = { ...merged.footer, ...LOCKED.footer }; // keep n* safe defaults
      merged.p3     = merged.p3 || {};
      merged.p3.state = { ...L.p3.state }; // HARD LOCK
      return merged;
    } catch { /* ignore */ }
  }
  return L;
}

/* ───────────────────────────── URL Tuners ───────────────────────────── */
function applyUrlTuners(url, L) {
  const q = Object.fromEntries(url.searchParams.entries());

  const setBox = (box, prefix, withH = false) => {
    if (!box) return;
    if (q[`${prefix}_x`]    != null) box.x    = +q[`${prefix}_x`];
    if (q[`${prefix}_y`]    != null) box.y    = +q[`${prefix}_y`];
    if (q[`${prefix}_w`]    != null) box.w    = +q[`${prefix}_w`];
    if (withH && q[`${prefix}_h`] != null)    box.h    = +q[`${prefix}_h`];
    if (q[`${prefix}_size`] != null) box.size = +q[`${prefix}_size`];
    if (q[`${prefix}_align`])       box.align = String(q[`${prefix}_align`]);
  };
  const setBoxPlus = (box, prefix, withH = false) => {
    setBox(box, prefix, withH);
    if (!box) return;
    if (q[`${prefix}_s`]    != null) box.size     = +q[`${prefix}_s`];
    if (q[`${prefix}_max`]  != null) box.maxLines = +q[`${prefix}_max`];
  };

  // P3 text
  setBox(L.p3?.domChar, "p3_domChar");
  setBox(L.p3?.domDesc, "p3_domDesc");

  // P3 highlight + labels
  L.p3 = L.p3 || {}; L.p3.state = L.p3.state || {}; const S3 = L.p3.state;
  if (q.state_useAbs === "1") S3.useAbsolute = true;
  if (q.state_useAbs === "0") S3.useAbsolute = false;
  if (q.state_inset   != null) S3.highlightInset  = +q.state_inset;
  if (q.state_radius  != null) S3.highlightRadius = +q.state_radius;
  if (q.state_opacity != null) S3.fillOpacity     = +q.state_opacity;
  if (q.state_shape)    S3.shape = String(q.state_shape);
  if (q.state_n     != null) S3.n     = +q.state_n;
  if (q.state_steps != null) S3.steps = +q.state_steps;
  if (q.labelText)    S3.labelText  = String(q.labelText);
  if (q.labelSize)    S3.labelSize  = +q.labelSize;
  if (q.labelCTx || q.labelCTy) S3.labelCT = { x: +q.labelCTx || (S3.labelCT?.x ?? 180), y: +q.labelCTy || (S3.labelCT?.y ?? 655) };
  if (q.labelRLx || q.labelRLy) S3.labelRL = { x: +q.labelRLx || (S3.labelRL?.x ?? 180), y: +q.labelRLy || (S3.labelRL?.y ?? 365) };
  if (q.labelOffsetX != null) S3.labelOffsetX = +q.labelOffsetX;
  if (q.labelOffsetY != null) S3.labelOffsetY = +q.labelOffsetY;
  if (q.labelPadTop  != null) S3.labelPadTop  = +q.labelPadTop;
  if (q.labelPadBottom != null) S3.labelPadBottom = +q.labelPadBottom;
  const psl = {};
  const setLS = (k, X, Y) => { if (X != null || Y != null) psl[k] = { x: X != null ? +X : undefined, y: Y != null ? +Y : undefined }; };
  setLS("C", q.labelC_x, q.labelC_y); setLS("T", q.labelT_x, q.labelT_y); setLS("R", q.labelR_x, q.labelR_y); setLS("L", q.labelL_x, q.labelL_y);
  if (Object.keys(psl).length) { S3.labelByState = S3.labelByState || {}; for (const k of Object.keys(psl)) { S3.labelByState[k] = { ...(S3.labelByState[k] || {}), ...psl[k] }; } }
  if (S3.useAbsolute || q.state_useAbs === "1") {
    const setAbs = (key) => {
      S3.absBoxes = S3.absBoxes || {}; const b = S3.absBoxes[key] || {};
      if (q[`abs_${key}_x`] != null) b.x = +q[`abs_${key}_x`];
      if (q[`abs_${key}_y`] != null) b.y = +q[`abs_${key}_y`];
      if (q[`abs_${key}_w`] != null) b.w = +q[`abs_${key}_w`];
      if (q[`abs_${key}_h`] != null) b.h = +q[`abs_${key}_h`];
      S3.absBoxes[key] = b;
    };
    ["C","T","R","L"].forEach(setAbs);
  }

  // Page 4
  setBox(L.p4?.spider, "p4_spider"); setBox(L.p4?.chart,  "p4_chart", true);
  // Page 5/6
  setBox(L.p5?.seqpat, "p5_seqpat"); setBox(L.p6?.theme,  "p6_theme");

  // Page 7 (LOOK – colleagues)
  setBox(L.p7?.header, "p7_header");
  if (q.p7_bodySize != null)  L.p7.bodySize = +q.p7_bodySize; if (q.p7_s != null) L.p7.bodySize = +q.p7_s; if (q.p7_maxLines != null) L.p7.maxLines = +q.p7_maxLines;
  ["C","T","R","L"].forEach((k,i)=> setBoxPlus(L.p7?.colBoxes?.[i], `p7_col${k}`, true));

  // Page 8 (WORK – colleagues)
  setBox(L.p8?.header, "p8_header");
  if (q.p8_bodySize != null)  L.p8.bodySize = +q.p8_bodySize; if (q.p8_s != null) L.p8.bodySize = +q.p8_s; if (q.p8_maxLines != null) L.p8.maxLines = +q.p8_maxLines;
  ["C","T","R","L"].forEach((k,i)=> setBoxPlus(L.p8?.colBoxes?.[i], `p8_col${k}`, true));

  // Page 9 (LOOK – leaders)
  setBox(L.p9?.header, "p9_header");
  if (q.p9_bodySize != null)  L.p9.bodySize = +q.p9_bodySize; if (q.p9_s != null) L.p9.bodySize = +q.p9_s; if (q.p9_maxLines != null) L.p9.maxLines = +q.p9_maxLines;
  ["C","T","R","L"].forEach((k,i)=> setBoxPlus(L.p9?.ldrBoxes?.[i], `p9_ldr${k}`, true));

  // Page 10 (WORK – leaders)
  setBox(L.p10?.header, "p10_header");
  if (q.p10_bodySize != null)  L.p10.bodySize = +q.p10_bodySize; if (q.p10_s != null) L.p10.bodySize = +q.p10_s; if (q.p10_maxLines != null) L.p10.maxLines = +q.p10_maxLines;
  ["C","T","R","L"].forEach((k,i)=> setBoxPlus(L.p10?.ldrBoxes?.[i], `p10_ldr${k}`, true));

  // Page 11 (Tips & Actions)
  setBox(L.p11?.tipsHdr, "p11_tipsHdr"); setBox(L.p11?.actsHdr, "p11_actsHdr");
  setBox(L.p11?.tipsBox, "p11_tipsBox"); setBox(L.p11?.actsBox, "p11_actsBox");
  if (q.p11_maxLines != null) L.p11.maxLines = +q.p11_maxLines;

  // Footers n10, n11, n12
  L.footer = L.footer || {};
  const tuneN = (key) => {
    if (!L.footer[key]) L.footer[key] = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
    if (q[`${key}x`] != null)     L.footer[key].x    = +q[`${key}x`];
    if (q[`${key}y`] != null)     L.footer[key].y    = +q[`${key}y`];
    if (q[`${key}w`] != null)     L.footer[key].w    = +q[`${key}w`];
    if (q[`${key}s`] != null)     L.footer[key].size = +q[`${key}s`];
    if (q[`${key}align`])         L.footer[key].align = String(q[`${key}align`]);
  };
  ["n10","n11","n12"].forEach(tuneN);

  return L;
}

/* ───────────────────────────── Template load ───────────────────────────── */
// Supports tpl in /public (default) AND full https URL (e.g., GitHub raw)
async function loadTemplateBytes(url) {
  const DEFAULT_TPL = "CTRL_Perspective_Assessment_Profile_template_slim.pdf";

  // Get and decode ?tpl=
  let tplParam = "";
  try { tplParam = url?.searchParams?.get("tpl") || ""; } catch { tplParam = ""; }
  try { tplParam = decodeURIComponent(tplParam); } catch {}

  // Remote template (https)
  if (/^https?:\/\//i.test(tplParam)) {
    const resp = await fetch(tplParam);
    if (!resp.ok) throw new Error(`Template fetch failed: ${resp.status} ${resp.statusText}`);
    return await resp.arrayBuffer();
  }

  // Local from /public (allow optional subfolders, block traversal)
  const localTpl = (tplParam || DEFAULT_TPL)
    .replace(/\\/g, "/")          // normalize slashes
    .replace(/\0/g, "")           // strip NULs
    .replace(/^\//, "")           // no absolute path
    .replace(/\.\.(\/|\\)/g, ""); // block ../

  const fullPath = path.join(process.cwd(), "public", localTpl);
  try {
    return await fs.readFile(fullPath);
  } catch {
    throw new Error(`Template not found at /public/${localTpl}`);
  }
}

/* ───────────────────────────── Footer helpers ───────────────────────────── */
function drawPageNumber(page, font, spec, pageNumber) {
  if (!page || !spec || !Number.isFinite(+spec.size) || +spec.size <= 0) return;
  drawTextBox(page, font, String(pageNumber), { ...spec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
}
function drawFooterText(page, font, text, spec) {
  if (!page || !spec || !text) return;
  drawTextBox(page, font, norm(text), { ...spec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
}

/* ─────────────────────────────── HTTP handler ─────────────────────────────── */
export default async function handler(req, res) {
  let url;
  try { url = new URL(req?.url || "/", "http://localhost"); } catch { url = new URL("/", "http://localhost"); }

  const preview = url.searchParams.get("preview") === "1";
  const dataB64 = url.searchParams.get("data");
  if (!dataB64) { res.statusCode = 400; res.end("Missing ?data"); return; }

  const data = parseDataParam(dataB64);
  try {
    const P = normaliseInput(data);

    // template + fonts
    const tplBytes = await loadTemplateBytes(url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageCount = pdf.getPageCount();
    const p = (i) => (i < pageCount ? pdf.getPage(i) : null);
    const p1 = p(0), p2 = p(1), p3 = p(2), p4 = p(3), p5 = p(4),
          p6 = p(5), p7 = p(6), p8 = p(7), p9 = p(8), p10 = p(9),
          p11 = p(10), p12 = p(11);

    // layout + URL tuners (Page-3 state hard-locked during build)
    let L = buildLayout(P.layoutV6);
    L = applyUrlTuners(url, L);

    const resolvedDomKey = resolveDomKey(P) || "R";

    /* ---------------------------- PAGE 1 (locked) ---------------------------- */
    if (p1) {
      drawTextBox(p1, HelvB, P.n, { ...L.p1.name, color: rgb(0.12,0.11,0.20) }, { maxLines: 1, ellipsis: true });
      drawTextBox(p1, Helv,  P.d, { ...L.p1.date, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    }

    /* ---------------------------- PAGE 2 ---------------------------- */
    if (p2) {
      if (L.footer.f2) drawFooterText(p2, Helv, P.f || P.flow || "", L.footer.f2);
      drawPageNumber(p2, Helv, L.footer.n2, 2);
    }

    /* ---------------------------- PAGE 3 ---------------------------- */
    if (p3) {
      if (L.footer.f3) drawFooterText(p3, Helv, P.f || P.flow || "", L.footer.f3);
      drawPageNumber(p3, Helv, L.footer.n3, 3);

      if (P.domchar) drawTextBox(p3, Helv, P.domchar, { ...L.p3.domChar, color: rgb(0.15,0.14,0.22) }, { maxLines: 1, ellipsis: true });
      drawTextBox(p3, Helv, P.domdesc, { ...L.p3.domDesc, color: rgb(0.15,0.14,0.22) }, { maxLines: 16, ellipsis: true });
      await paintStateHighlight(pdf, p3, resolvedDomKey, L);
    }

    /* ---------------------------- PAGE 4 ---------------------------- */
    if (p4) {
      if (L.footer.f4) drawFooterText(p4, Helv, P.f || P.flow || "", L.footer.f4);
      drawPageNumber(p4, Helv, L.footer.n4, 4);

      drawTextBox(p4, Helv, P.spiderdesc, { ...L.p4.spider, color: rgb(0.15,0.14,0.22) }, { maxLines: 18, ellipsis: true });
      if (P.spiderfreq) {
        try {
          const imgRes = await fetch(P.spiderfreq);
          if (imgRes.ok) {
            const buff = await imgRes.arrayBuffer();
            const mime = String(imgRes.headers.get("content-type") || "").toLowerCase();
            let img = null;
            if (mime.includes("png")) img = await pdf.embedPng(buff); else img = await pdf.embedJpg(buff);
            const ph = p4.getHeight();
            p4.drawImage(img, { x: L.p4.chart.x, y: ph - L.p4.chart.y - L.p4.chart.h, width: L.p4.chart.w, height: L.p4.chart.h });
          }
        } catch { /* ignore image errors */ }
      }
    }

    /* ---------------------------- PAGE 5 ---------------------------- */
    if (p5) {
      if (L.footer.f5) drawFooterText(p5, Helv, P.f || P.flow || "", L.footer.f5);
      drawPageNumber(p5, Helv, L.footer.n5, 5);
      drawTextBox(p5, Helv, P.seqpat, { ...L.p5.seqpat, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });
    }

    /* ---------------------------- PAGE 6 ---------------------------- */
    if (p6) {
      if (L.footer.f6) drawFooterText(p6, Helv, P.f || P.flow || "", L.footer.f6);
      drawPageNumber(p6, Helv, L.footer.n6, 6);
      drawTextBox(p6, Helv, P.theme, { ...L.p6.theme, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });
    }

    const findBy = (arr, key) => (arr || []).find(v => (v?.their || v?.key || "").toUpperCase() === key);

    /* ---------------------------- PAGE 7 (LOOK – colleagues) ---------------------------- */
    if (p7) {
      if (L.footer.f7) drawFooterText(p7, Helv, P.f || P.flow || "", L.footer.f7);
      drawPageNumber(p7, Helv, L.footer.n7, 7);

      drawTextBox(p7, HelvB, "", { ...L.p7.header, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
      ["C","T","R","L"].forEach((k,i)=>{
        const entry = findBy(P.workwcol, k);
        const box = L.p7.colBoxes[i] || L.p7.colBoxes[0];
        const txt = norm(entry?.look || "");
        if (txt && box?.w > 0) {
          drawTextBox(p7, Helv, txt, { x: box.x, y: box.y, w: box.w, size: (box.size ?? L.p7.bodySize), align: box.align || "left", color: rgb(0.15,0.14,0.22) }, { maxLines: (box.maxLines ?? L.p7.maxLines), ellipsis: true });
        }
      });
    }

    /* ---------------------------- PAGE 8 (WORK – colleagues) ---------------------------- */
    if (p8) {
      if (L.footer.f8) drawFooterText(p8, Helv, P.f || P.flow || "", L.footer.f8);
      drawPageNumber(p8, Helv, L.footer.n8, 8);

      drawTextBox(p8, HelvB, "", { ...L.p8.header, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
      ["C","T","R","L"].forEach((k,i)=>{
        const entry = findBy(P.workwcol, k);
        const box = L.p8.colBoxes[i] || L.p8.colBoxes[0];
        const txt = norm(entry?.work || "");
        if (txt && box?.w > 0) {
          drawTextBox(p8, Helv, txt, { x: box.x, y: box.y, w: box.w, size: (box.size ?? L.p8.bodySize), align: box.align || "left", color: rgb(0.15,0.14,0.22) }, { maxLines: (box.maxLines ?? L.p8.maxLines), ellipsis: true });
        }
      });
    }

    /* ---------------------------- PAGE 9 (LOOK – leaders) ---------------------------- */
    if (p9) {
      if (L.footer.f9) drawFooterText(p9, Helv, P.f || P.flow || "", L.footer.f9);
      drawPageNumber(p9, Helv, L.footer.n9, 9);

      drawTextBox(p9, HelvB, "", { ...L.p9.header, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
      ["C","T","R","L"].forEach((k,i)=>{
        const entry = findBy(P.workwlead, k);
        const box = L.p9.ldrBoxes[i] || L.p9.ldrBoxes[0];
        const txt = norm(entry?.look || "");
        if (txt && box?.w > 0) {
          drawTextBox(p9, Helv, txt, { x: box.x, y: box.y, w: box.w, size: (box.size ?? L.p9.bodySize), align: box.align || "left", color: rgb(0.15,0.14,0.22) }, { maxLines: (box.maxLines ?? L.p9.maxLines), ellipsis: true });
        }
      });
    }

    /* ---------------------------- PAGE 10 (WORK – leaders) ---------------------------- */
    if (p10) {
      if (L.footer.f10) drawFooterText(p10, Helv, P.f || P.flow || "", L.footer.f10);
      drawPageNumber(p10, Helv, L.footer.n10, 10);

      drawTextBox(p10, HelvB, "", { ...L.p10.header, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
      ["C","T","R","L"].forEach((k,i)=>{
        const entry = findBy(P.workwlead, k);
        const box = L.p10.ldrBoxes[i] || L.p10.ldrBoxes[0];
        const txt = norm(entry?.work || "");
        if (txt && box?.w > 0) {
          drawTextBox(p10, Helv, txt, { x: box.x, y: box.y, w: box.w, size: (box.size ?? L.p10.bodySize), align: box.align || "left", color: rgb(0.15,0.14,0.22) }, { maxLines: (box.maxLines ?? L.p10.maxLines), ellipsis: true });
        }
      });
    }

    /* ---------------------------- PAGE 11 (Tips & Actions) ---------------------------- */
    if (p11) {
      if (L.footer.f11) drawFooterText(p11, Helv, P.f || P.flow || "", L.footer.f11);
      drawPageNumber(p11, Helv, L.footer.n11, 11);

      // Headers (set size=0 to hide)
      drawTextBox(p11, HelvB, "Tips",    { ...L.p11.tipsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
      drawTextBox(p11, HelvB, "Actions", { ...L.p11.actsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });

      drawBulleted(p11, Helv, ensureArray(P.tips),
        { ...L.p11.tipsBox, indent: (L.p11.tipsBox.indent ?? 14), gap: (L.p11.tipsBox.gap ?? 2), color: rgb(0.15,0.14,0.22) },
        { maxLines: L.p11.maxLines, blockGap: 6 });

      drawBulleted(p11, Helv, ensureArray(P.actions),
        { ...L.p11.actsBox, indent: (L.p11.actsBox.indent ?? 14), gap: (L.p11.actsBox.gap ?? 2), color: rgb(0.15,0.14,0.22) },
        { maxLines: L.p11.maxLines, blockGap: 6 });
    }

    /* ---------------------------- PAGE 12 (footer only by default) ---------------------------- */
    if (p12) {
      if (L.footer.f12) drawFooterText(p12, Helv, P.f || P.flow || "", L.footer.f12);
      drawPageNumber(p12, Helv, L.footer.n12, 12);
    }

    // save
    const bytes = await pdf.save();
    const fname = safeFileName(url, P.n);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename="${fname}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("fill-template error: " + (e?.message || e));
  }
}

function safeFileName(url, fullName) {
  const who = S(fullName || "report").replace(/[^A-Za-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"");
  const qName = url.searchParams.get("name");
  if (qName) return String(qName);
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]; 
  const d = new Date();
  return `CTRL_${who}_${String(d.getDate()).padStart(2,"0")}${MMM[d.getMonth()]}${d.getFullYear()}.pdf`;
}
