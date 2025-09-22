// /api/fill-template.js — CTRL V3 Slim Exporter (HARD-LOCK Page-3 Current State)
//
// WHAT’S NEW IN THIS DROP
// - Robust domKey resolution (C/T/R/L) so “Triggered” never falls back to “Regulated”.
// - Page-3 Current State is HARD-LOCKED to your exact coordinates + label anchors.
//   Payload (data.layoutV6) cannot override the highlight; only URL tuners can.
// - Template path fixed to: /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
//
// COORDINATES LOCKED BY DEFAULT (exactly as you provided)
//   R: x=60  y=433  w=188 h=158  radius=1000 inset=1  label (150,612)
//   C: x=58  y=258  w=188 h=156  radius=28   inset=6  label (150,245)
//   T: x=299 y=258  w=188 h=156  radius=28   inset=6  label (390,244)
//   L: x=298 y=440  w=188 h=156  radius=28   inset=6  label (390,605)
//
// You can still override per render via URL tuners (e.g. state_useAbs=0, abs_*,
// label*, state_shape). Page 3 text boxes (domChar/domDesc) and Pages 4–8 tuners
// remain fully supported.

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────────────────────── Utilities ───────────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (v, fb = "") =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

const todayLbl = () => {
  const now = new Date();
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
  return `${String(now.getDate()).padStart(2,"0")}/${MMM}/${now.getFullYear()}`;
};
const ensureArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Base64url → JSON (accepts base64 *or* base64url)
function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try {
    const raw = Buffer.from(s, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/* ─────────────────────────── Drawing helpers ───────────────────────── */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;
  const clean = norm(text);
  if (!clean) return { height: 0, linesDrawn: 0, lastY: page.getHeight() - y };

  const lines = clean.split("\n");
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];

  for (const raw of lines) {
    let t = raw.trim();
    while (t.length > maxChars) {
      let cut = t.lastIndexOf(" ", maxChars);
      if (cut <= 0) cut = maxChars;
      wrapped.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    wrapped.push(t);
    if (raw.trim() === "") wrapped.push("");
  }

  const out = wrapped.length > maxLines
    ? wrapped.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, "…") : s))
    : wrapped;

  const pageH   = page.getHeight();
  const yTop    = pageH - y; // convert TL to BL
  const widthOf = (s) => font.widthOfTextAtSize(s, size);
  const lineH   = size + lineGap;

  let yCursor = yTop;
  let drawn = 0;

  for (let i = 0; i < out.length; i++) {
    const ln = out[i] ?? "";
    let xDraw = x;
    const wLn = widthOf(ln);
    if (align === "center") xDraw = x + (w - wLn) / 2;
    else if (align === "right") xDraw = x + (w - wLn);
    page.drawText(ln, { x: xDraw, y: yCursor - size, size, font, color });
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

  let curY = y;
  const pageH = page.getHeight();
  const blockGap = N(opts.blockGap, 6);

  const strip = (s) =>
    norm(s || "")
      .replace(/^[\s•\-\u2022]*\b(Tips?|Actions?)\s*:\s*/i, "")
      .trim();

  for (const raw of ensureArray(items)) {
    const text = strip(raw);
    if (!text) continue;

    const baseline = pageH - curY; // BL coords for shapes
    const cy = baseline + (size * 0.33);
    if (page.drawCircle) {
      page.drawCircle({ x: x + bulletRadius, y: cy, size: bulletRadius, color });
    } else {
      page.drawRectangle({ x, y: cy - bulletRadius, width: bulletRadius * 2, height: bulletRadius * 2, color });
    }

    const r = drawTextBox(
      page, font, text,
      { x: x + indent + gap, y: curY, w: w - indent - gap, size, lineGap, color, align },
      opts
    );
    curY += r.height + blockGap;
  }
  return { height: curY - y };
}

/* ─────────────── Superellipse (squircle) helpers ─────────────── */
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

  // Validate incoming key; DO NOT silently default to "R" unless invalid
  const upper = String(dominantKey || "").toUpperCase();
  const dom = ["C","T","R","L"].includes(upper) ? upper : "R";

  // Per-state style overrides (radius/inset)
  const styleByState = cfg.styleByState || {};
  const dStyle = styleByState[dom] || {};

  const useAbs = !!cfg.useAbsolute;
  const inset  = Number.isFinite(+dStyle.inset)  ? +dStyle.inset  : N(cfg.highlightInset, 4);
  const radius = Number.isFinite(+dStyle.radius) ? +dStyle.radius : N(cfg.highlightRadius, 16);

  const labelText  = S(cfg.labelText || "YOU ARE HERE");
  const labelSize  = N(cfg.labelSize, 10);
  const labelColor = cfg.labelColor || rgb(0.20, 0.20, 0.20);
  const shade      = cfg.fillColor || rgb(251/255, 236/255, 250/255); // #FBECFA
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

  // Label anchoring — prefer per-state; else grouped CT/RL; else auto
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
  return ""; // caller will guard / fallback
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

  // Robust domKey resolution (no accidental default to "R")
  const resKey = resolveDomKey(d);
  d.domkey = resKey || d.domkey || d.dom6Key || d.domKey || "";

  if (!d.seqpat || !d.theme) {
    const b = Array.isArray(d.page7Blocks) ? d.page7Blocks : [];
    d.seqpat = d.seqpat || (b[0] && b[0].body) || "";
    d.theme  = d.theme  || (b[1] && b[1].body) || "";
  }

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

// 🔒 LOCKED positions for Page 1 + footer n2..n9
const LOCKED = {
  p1: {
    name: { x: 7,   y: 473,  w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600,  w: 500, size: 25, align: "left"   }
  },
  footer: (() => {
    const one = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
    return { n2:{...one}, n3:{...one}, n4:{...one}, n5:{...one}, n6:{...one}, n7:{...one}, n8:{...one}, n9:{...one} };
  })()
};

function buildLayout(layoutV6) {
  const L = {
    meta: { units: "pt", origin: "TL", pages: "1-based" },

    // PAGE 1 (locked)
    p1: { name: LOCKED.p1.name, date: LOCKED.p1.date },

    // FOOTERS 2–9 (locked)
    footer: LOCKED.footer,

    // PAGE 3 — text + state highlight (locked defaults, tunable via URL)
    p3: {
      domChar: { x:  60, y: 170, w: 650, size: 11, align: "left"  },
      domDesc: { x:  60, y: 200, w: 650, size: 11, align: "left"  },

      state: {
        // ✅ absolute rectangles by default
        useAbsolute: true,

        // Global defaults
        shape: "round",
        highlightRadius: 28,
        highlightInset: 6,
        fillOpacity: 0.45,
        fillColor: rgb(251/255, 236/255, 250/255),

        // ✅ Per-state style (Regulated special)
        styleByState: {
          C: { radius: 28,   inset: 6  },
          T: { radius: 28,   inset: 6  },
          R: { radius: 1000, inset: 1  }, // big rounded pill
          L: { radius: 28,   inset: 6  }
        },

        // ✅ Per-state label anchors (TL coords)
        labelByState: {
          C: { x: 150, y: 245 },
          T: { x: 390, y: 244 },
          R: { x: 150, y: 612 },
          L: { x: 390, y: 605 }
        },

        // Fallback anchors if grouped CT/RL ever used
        labelCT: { x: 180, y: 655 }, // for C/T (top)
        labelRL: { x: 180, y: 365 }, // for R/L (bottom)
        labelText: "YOU ARE HERE",
        labelSize: 10,
        labelColor: rgb(0.20, 0.20, 0.20),
        labelOffsetX: 0,
        labelOffsetY: 0,
        labelPadTop: 12,
        labelPadBottom: 12,

        // ✅ Locked absolute rectangles (TL coords)
        absBoxes: {
          R: { x:  60, y: 433, w: 188, h: 158 },
          C: { x:  58, y: 258, w: 188, h: 156 },
          T: { x: 299, y: 258, w: 188, h: 156 },
          L: { x: 298, y: 440, w: 188, h: 156 }
        },

        // Grid still available if you pass ?state_useAbs=0
        grid: { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 },

        // Squircle params (if you switch ?state_shape=squircle)
        n: 4,
        steps: 128
      }
    },

    // PAGE 4
    p4: {
      spider: { x:  60, y: 320, w: 280, size: 11, align: "left" },
      chart:  { x: 360, y: 320, w: 260, h: 260 }
    },

    // PAGE 5
    p5: { seqpat: { x:  60, y: 160, w: 650, size: 11, align: "left" } },

    // PAGE 6
    p6: { theme:  { x:  60, y: 160, w: 650, size: 11, align: "left" } },

    // PAGE 7
    p7: {
      hCol: { x:  60, y: 110, w: 650, size: 12, align: "left" },
      hLdr: { x:  60, y: 360, w: 650, size: 12, align: "left" },
      colBoxes: [
        { x:  60, y: 140, w: 300, h: 90 },  // C
        { x: 410, y: 140, w: 300, h: 90 },  // T
        { x:  60, y: 240, w: 300, h: 90 },  // R
        { x: 410, y: 240, w: 300, h: 90 }   // L
      ],
      ldrBoxes: [
        { x:  60, y: 390, w: 300, h: 90 },  // C
        { x: 410, y: 390, w: 300, h: 90 },  // T
        { x:  60, y: 490, w: 300, h: 90 },  // R
        { x: 410, y: 490, w: 300, h: 90 }   // L
      ],
      bodySize: 10,
      maxLines: 9
    },

    // PAGE 8
    p8: {
      tipsHdr: { x:  60, y: 120, w: 320, size: 12, align: "left" },
      actsHdr: { x: 390, y: 120, w: 320, size: 12, align: "left" },
      tipsBox: { x:  60, y: 150, w: 320, size: 11, align: "left" },
      actsBox: { x: 390, y: 150, w: 320, size: 11, align: "left" }
    }
  };

  // ── Merge payload overrides, but HARD-LOCK Page-3 state; only URL tuners may change it
  if (layoutV6 && typeof layoutV6 === "object") {
    try {
      const merged = deepMerge(L, layoutV6);

      // Always keep Page 1 + footers locked
      merged.p1     = { ...merged.p1, name: LOCKED.p1.name, date: LOCKED.p1.date };
      merged.footer = { ...merged.footer, ...LOCKED.footer };

      // 🔒 HARD-LOCK Page-3 Current State (geometry + style + labels)
      merged.p3 = merged.p3 || {};
      merged.p3.state = { ...L.p3.state };

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

  // Page 3 text
  setBox(L.p3?.domChar, "p3_domChar");
  if (q["p3_dokdesc_size"] != null) q["p3_domDesc_size"] = q["p3_dokdesc_size"]; // accept typo
  setBox(L.p3?.domDesc, "p3_domDesc");

  // Page 3 state highlight + labels (URL can override the hard lock)
  L.p3 = L.p3 || {};
  L.p3.state = L.p3.state || {};
  const S3 = L.p3.state;

  if (q.state_useAbs === "1") S3.useAbsolute = true;
  if (q.state_useAbs === "0") S3.useAbsolute = false;

  if (q.state_inset   != null) S3.highlightInset  = +q.state_inset;
  if (q.state_radius  != null) S3.highlightRadius = +q.state_radius;
  if (q.state_opacity != null) S3.fillOpacity     = +q.state_opacity;

  if (q.state_shape)    S3.shape = String(q.state_shape); // "round" | "squircle"
  if (q.state_n     != null) S3.n     = +q.state_n;
  if (q.state_steps != null) S3.steps = +q.state_steps;

  if (q.labelText)    S3.labelText  = String(q.labelText);
  if (q.labelSize)    S3.labelSize  = +q.labelSize;
  if (q.labelCTx || q.labelCTy) S3.labelCT = {
    x: +q.labelCTx || (S3.labelCT?.x ?? 180),
    y: +q.labelCTy || (S3.labelCT?.y ?? 655)
  };
  if (q.labelRLx || q.labelRLy) S3.labelRL = {
    x: +q.labelRLx || (S3.labelRL?.x ?? 180),
    y: +q.labelRLy || (S3.labelRL?.y ?? 365)
  };
  if (q.labelOffsetX != null) S3.labelOffsetX = +q.labelOffsetX;
  if (q.labelOffsetY != null) S3.labelOffsetY = +q.labelOffsetY;
  if (q.labelPadTop  != null) S3.labelPadTop  = +q.labelPadTop;
  if (q.labelPadBottom != null) S3.labelPadBottom = +q.labelPadBottom;

  // Per-state label anchors via URL (optional)
  const psl = {};
  const setLS = (k, X, Y) => {
    if (X != null || Y != null) psl[k] = { x: X != null ? +X : undefined, y: Y != null ? +Y : undefined };
  };
  setLS("C", q.labelC_x, q.labelC_y);
  setLS("T", q.labelT_x, q.labelT_y);
  setLS("R", q.labelR_x, q.labelR_y);
  setLS("L", q.labelL_x, q.labelL_y);
  if (Object.keys(psl).length) {
    S3.labelByState = S3.labelByState || {};
    for (const k of Object.keys(psl)) {
      S3.labelByState[k] = { ...(S3.labelByState[k] || {}), ...psl[k] };
    }
  }

  // Grid tuners (if not using abs)
  if (q.gridX || q.gridY || q.gridW || q.gridH || q.gridGap) {
    const g = S3.grid || {};
    S3.grid = {
      marginX: +q.gridX   || g.marginX || 45,
      marginY: +q.gridY   || g.marginY || 520,
      boxW:    +q.gridW   || g.boxW    || 255,
      boxH:    +q.gridH   || g.boxH    || 160,
      gap:     +q.gridGap || g.gap     || 24,
    };
  }

  // Abs rectangles per state (URL can still override)
  if (S3.useAbsolute || q.state_useAbs === "1") {
    const setAbs = (key) => {
      S3.absBoxes = S3.absBoxes || {};
      const b = S3.absBoxes[key] || {};
      if (q[`abs_${key}_x`] != null) b.x = +q[`abs_${key}_x`];
      if (q[`abs_${key}_y`] != null) b.y = +q[`abs_${key}_y`];
      if (q[`abs_${key}_w`] != null) b.w = +q[`abs_${key}_w`];
      if (q[`abs_${key}_h`] != null) b.h = +q[`abs_${key}_h`];
      S3.absBoxes[key] = b;
    };
    ["C","T","R","L"].forEach(setAbs);
  }

  // Page 4
  setBox(L.p4?.spider, "p4_spider");
  setBox(L.p4?.chart,  "p4_chart", true);

  // Page 5
  setBox(L.p5?.seqpat, "p5_seqpat");

  // Page 6
  setBox(L.p6?.theme,  "p6_theme");

  // Page 7
  setBox(L.p7?.hCol, "p7_hCol");
  setBox(L.p7?.hLdr, "p7_hLdr");
  if (q.p7_bodySize != null) L.p7.bodySize = +q.p7_bodySize;
  if (q.p7_maxLines != null) L.p7.maxLines = +q.p7_maxLines;
  const order = ["C","T","R","L"];
  order.forEach((k, i) => setBox(L.p7?.colBoxes?.[i], `p7_col${k}`, true));
  order.forEach((k, i) => setBox(L.p7?.ldrBoxes?.[i], `p7_ldr${k}`, true));

  // Page 8
  setBox(L.p8?.tipsHdr, "p8_tipsHdr");
  setBox(L.p8?.actsHdr, "p8_actsHdr");
  setBox(L.p8?.tipsBox, "p8_tipsBox");
  setBox(L.p8?.actsBox, "p8_actsBox");

  return L;
}

/* ───────────────────────────── Template load ───────────────────────────── */
// Reads: /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
async function loadTemplateBytes(url) {
  const tplParam = (url && url.searchParams && url.searchParams.get("tpl")) || "CTRL_Perspective_Assessment_Profile_template_slim.pdf";
  const safeTpl  = String(tplParam).replace(/[^A-Za-z0-9._-]/g, "");
  const fullPath = path.join(process.cwd(), "public", safeTpl);
  try {
    return await fs.readFile(fullPath);
  } catch (e) {
    throw new Error(`Template not found at /public/${safeTpl}`);
  }
}

/* ─────────────────────────────── HTTP handler ─────────────────────────────── */
export default async function handler(req, res) {
  let url;
  try { url = new URL(req?.url || "/", "http://localhost"); }
  catch { url = new URL("/", "http://localhost"); }

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

    // pages (expect 9 pages)
    const p1 = pdf.getPage(0);
    const p2 = pdf.getPage(1);
    const p3 = pdf.getPage(2);
    const p4 = pdf.getPage(3);
    const p5 = pdf.getPage(4);
    const p6 = pdf.getPage(5);
    const p7 = pdf.getPage(6);
    const p8 = pdf.getPage(7);
    const p9 = pdf.getPage(8);

    // layout + URL tuners (Page-3 state hard-locked during build)
    let L = buildLayout(P.layoutV6);
    L = applyUrlTuners(url, L);

    // Resolve dominant key robustly (C/T/R/L)
    const resolvedDomKey = resolveDomKey(P) || "R";

    /* ---------------------------- PAGE 1 (locked) ---------------------------- */
    drawTextBox(p1, HelvB, P.n, { ...L.p1.name, color: rgb(0.12,0.11,0.20) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p1, Helv,  P.d, { ...L.p1.date, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    /* ---------------------------- PAGE 2 ---------------------------- */
    drawTextBox(p2, Helv, P.n, { ...(L.footer.n2||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    /* ---------------------------- PAGE 3 ---------------------------- */
    drawTextBox(p3, Helv, P.n, { ...(L.footer.n3||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    if (P.domchar) {
      drawTextBox(p3, Helv, `Representing the character: ${P.domchar}`,
        { ...L.p3.domChar, color: rgb(0.15,0.14,0.22) }, { maxLines: 1, ellipsis: true });
    }
    drawTextBox(p3, Helv, P.domdesc,
      { ...L.p3.domDesc, color: rgb(0.15,0.14,0.22) }, { maxLines: 16, ellipsis: true });

    await paintStateHighlight(pdf, p3, resolvedDomKey, L);

    /* ---------------------------- PAGE 4 ---------------------------- */
    drawTextBox(p4, Helv, P.n, { ...(L.footer.n4||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p4, Helv, P.spiderdesc,
      { ...L.p4.spider, color: rgb(0.15,0.14,0.22) }, { maxLines: 18, ellipsis: true });

    if (P.spiderfreq) {
      try {
        const imgRes = await fetch(P.spiderfreq);
        if (imgRes.ok) {
          const buff = await imgRes.arrayBuffer();
          const mime = String(imgRes.headers.get("content-type") || "");
          let img = null;
          if (mime.includes("png")) img = await pdf.embedPng(buff);
          else img = await pdf.embedJpg(buff);
          const ph = p4.getHeight();
          p4.drawImage(img, {
            x: L.p4.chart.x, y: ph - L.p4.chart.y - L.p4.chart.h,
            width: L.p4.chart.w, height: L.p4.chart.h
          });
        }
      } catch { /* ignore */ }
    }

    /* ---------------------------- PAGE 5 ---------------------------- */
    drawTextBox(p5, Helv, P.n, { ...(L.footer.n5||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p5, Helv, P.seqpat,
      { ...L.p5.seqpat, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });

    /* ---------------------------- PAGE 6 ---------------------------- */
    drawTextBox(p6, Helv, P.n, { ...(L.footer.n6||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p6, Helv, P.theme,
      { ...L.p6.theme, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });

    /* ---------------------------- PAGE 7 ---------------------------- */
    drawTextBox(p7, Helv, P.n, { ...(L.footer.n7||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    drawTextBox(p7, HelvB, "What to look out for / How to work with colleagues",
      { ...L.p7.hCol, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });

    drawTextBox(p7, HelvB, "What to look out for / How to work with a leader",
      { ...L.p7.hLdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });

    const order = ["C","T","R","L"];
    const makeTxt = (e) => {
      const look = norm(e?.look || "");
      const work = norm(e?.work || "");
      return (look || work) ? `What to look out for:\n${look}\n\nHow to work with them:\n${work}` : "";
    };

    order.forEach((k, i) => {
      const e = (P.workwcol || []).find(v => v?.their === k);
      const box = L.p7.colBoxes[i] || L.p7.colBoxes[0];
      const txt = makeTxt(e);
      if (txt) drawTextBox(p7, Helv, txt,
        { x: box.x, y: box.y, w: box.w, size: L.p7.bodySize, align: "left", color: rgb(0.15,0.14,0.22) },
        { maxLines: L.p7.maxLines, ellipsis: true });
    });

    order.forEach((k, i) => {
      const e = (P.workwlead || []).find(v => v?.their === k);
      const box = L.p7.ldrBoxes[i] || L.p7.ldrBoxes[0];
      const txt = makeTxt(e);
      if (txt) drawTextBox(p7, Helv, txt,
        { x: box.x, y: box.y, w: box.w, size: L.p7.bodySize, align: "left", color: rgb(0.15,0.14,0.22) },
        { maxLines: L.p7.maxLines, ellipsis: true });
    });

    /* ---------------------------- PAGE 8 ---------------------------- */
    drawTextBox(p8, Helv, P.n, { ...(L.footer.n8||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    drawTextBox(p8, HelvB, "Tips",    { ...L.p8.tipsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
    drawTextBox(p8, HelvB, "Actions", { ...L.p8.actsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });

    drawBulleted(p8, Helv, ensureArray(P.tips),
      { ...L.p8.tipsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
      { maxLines: 26, blockGap: 6 });

    drawBulleted(p8, Helv, ensureArray(P.actions),
      { ...L.p8.actsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
      { maxLines: 26, blockGap: 6 });

    /* ---------------------------- PAGE 9 ---------------------------- */
    drawTextBox(p9, Helv, P.n, { ...(L.footer.n9||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

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
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const d = new Date();
  const name = `CTRL_${who}_${String(d.getDate()).padStart(2,"0")}${MMM[d.getMonth()]}${d.getFullYear()}.pdf`;
  const qName = url.searchParams.get("name");
  return qName ? String(qName) : name;
}
