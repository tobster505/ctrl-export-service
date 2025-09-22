// /api/fill-template (Pages router: pages/api/fill-template.js)
// If you're using the App Router, ask me for the tiny GET() variant.
export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";

// Lazy-load pdf-lib to keep cold start small
async function getPdfLib() {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  return { PDFDocument, StandardFonts, rgb };
}

// ------------------------------
// Helpers
// ------------------------------
function b64urlToJson(b64u) {
  if (!b64u) return {};
  let s = String(b64u).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function n(v, fallback = undefined) {
  if (v === undefined || v === null || v === "") return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function bool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(s) ? true
       : ["0", "false", "no", "off"].includes(s) ? false
       : fallback;
}

function deepMerge(a, b) {
  if (!b || typeof b !== "object") return a;
  const out = Array.isArray(a) ? a.slice() : { ...(a || {}) };
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function mapDomStringToKey(s) {
  const t = String(s || "").trim().toLowerCase();
  if (t.startsWith("con")) return "C";
  if (t.startsWith("tri")) return "T";
  if (t.startsWith("reg")) return "R";
  if (t.startsWith("lea")) return "L";
  return undefined;
}

// Fallback grid (only used if you flip useAbsolute=false)
function defaultP3Grid() {
  return { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 };
}
function computeBoxesFromGrid(g) {
  const { marginX: mx, marginY: my, gap, boxW: w, boxH: h } = g || defaultP3Grid();
  return {
    C: { x: mx + 0 * (w + gap), y: my - 1 * (h + gap), w, h },
    T: { x: mx + 1 * (w + gap), y: my - 1 * (h + gap), w, h },
    R: { x: mx + 0 * (w + gap), y: my + 0 * (h + gap), w, h },
    L: { x: mx + 1 * (w + gap), y: my + 0 * (h + gap), w, h },
  };
}

// Superellipse ("squircle") SVG path for pdf-lib drawSvgPath
function makeSuperellipsePath(x, y, w, h, nExp = 4, steps = 128) {
  // x,y are bottom-left; path expects same space
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const m = 2 / nExp;

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const px = cx + Math.sign(ct) * Math.pow(Math.abs(ct), m) * rx;
    const py = cy + Math.sign(st) * Math.pow(Math.abs(st), m) * ry;
    pts.push([px, py]);
  }
  if (!pts.length) return "";
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  }
  return d + " Z";
}

// Fallback squircle fill using horizontal strips
function fillSuperellipseStrips(page, blX, blY, w, h, nExp = 4, step = 2, color, opacity) {
  const cx = blX + w / 2;
  const a = w / 2;
  const b = h / 2;
  const total = Math.max(1, Math.floor(h / step));
  for (let i = 0; i <= total; i++) {
    const y = -b + (i / total) * 2 * b;           // [-b, b]
    const yn = Math.abs(y / b);
    const term = Math.max(0, 1 - Math.pow(yn, nExp));
    const xr = a * Math.pow(term, 1 / nExp);      // half-width at this y
    const stripW = Math.max(0, xr * 2);
    const stripH = step;
    const stripX = cx - xr;
    const stripY = blY + (y + b);                 // convert back to page coords
    if (stripW > 0) {
      page.drawRectangle({
        x: stripX,
        y: stripY,
        width: stripW,
        height: stripH,
        color,
        opacity
      });
    }
  }
}

// ------------------------------
// Layout with your LOCKS
// ------------------------------
function buildLayout(layoutV6) {
  const L = {
    meta: { units: "pt", origin: "TL", pages: "1-based" },

    // PAGE 1 (kept for completeness)
    p1: {
      name: { x: 7,   y: 473, w: 500, size: 30, align: "center" },
      date: { x: 210, y: 600, w: 500, size: 25, align: "left"   }
    },

    // FOOTERS 2–9
    footer: (() => {
      const one = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
      return { n2:{...one}, n3:{...one}, n4:{...one}, n5:{...one}, n6:{...one}, n7:{...one}, n8:{...one}, n9:{...one} };
    })(),

    // PAGE 3 — LOCKED defaults
    p3: {
      domChar: { x:  60, y: 170, w: 650, size: 11, align: "left" },
      domDesc: { x:  60, y: 200, w: 650, size: 11, align: "left" },

      state: {
        // 🔒 Use your absolute rectangles by default
        useAbsolute: true,

        // Global defaults (can be overridden per-state)
        shape: "round",
        highlightRadius: 28,
        highlightInset: 6,
        fillOpacity: 0.45,
        fillColor: { r: 251/255, g: 236/255, b: 250/255 },

        // Per-state style overrides (Regulated special)
        styleByState: {
          C: { radius: 28,   inset: 6  },
          T: { radius: 28,   inset: 6  },
          R: { radius: 1000, inset: 1  }, // big rounded pill
          L: { radius: 28,   inset: 6  }
        },

        // Per-state label anchors (top-left coords)
        labelByState: {
          C: { x: 150, y: 245 },
          T: { x: 390, y: 244 },
          R: { x: 150, y: 612 },
          L: { x: 390, y: 605 }
        },

        // Fallback anchors if you prefer shared behaviour
        labelCT: { x: 180, y: 655 }, // for C/T (top)
        labelRL: { x: 180, y: 365 }, // for R/L (bottom)

        // Abs rectangles (top-left coords)
        absBoxes: {
          R: { x:  60, y: 433, w: 188, h: 158 },
          C: { x:  58, y: 258, w: 188, h: 156 },
          T: { x: 299, y: 258, w: 188, h: 156 },
          L: { x: 298, y: 440, w: 188, h: 156 }
        },

        // Grid available if you pass ?state_useAbs=0
        grid: defaultP3Grid(),

        // Label look
        labelText: "YOU ARE HERE",
        labelSize: 10,
        labelColor: { r: 0.20, g: 0.20, b: 0.20 },

        // Extra label paddings (used for auto-anchors)
        labelPadTop: 12,
        labelPadBottom: 12,

        // Squircle params retained for compatibility
        n: 4,
        steps: 128
      }
    },

    // (Optional) other pages for your layout — kept minimal here
    p4: { spider: { x: 60,  y: 320, w: 280, size: 11, align: "left" },
          chart:  { x: 360, y: 320, w: 260, h: 260 } },
    p5: { seqpat: { x: 60, y: 160, w: 650, size: 11, align: "left" } },
    p6: { theme:  { x: 60, y: 160, w: 650, size: 11, align: "left" } },
    p7: {
      hCol: { x: 60,  y: 110, w: 650, size: 12, align: "left" },
      hLdr: { x: 60,  y: 360, w: 650, size: 12, align: "left" },
      colBoxes: [
        { x:  60, y: 140, w: 300, h: 90 }, // C
        { x: 410, y: 140, w: 300, h: 90 }, // T
        { x:  60, y: 240, w: 300, h: 90 }, // R
        { x: 410, y: 240, w: 300, h: 90 }  // L
      ],
      ldrBoxes: [
        { x:  60, y: 390, w: 300, h: 90 }, // C
        { x: 410, y: 390, w: 300, h: 90 }, // T
        { x:  60, y: 490, w: 300, h: 90 }, // R
        { x: 410, y: 490, w: 300, h: 90 }  // L
      ],
      bodySize: 10,
      maxLines: 9
    },
    p8: {
      tipsHdr: { x: 60,  y: 120, w: 320, size: 12, align: "left" },
      actsHdr: { x: 390, y: 120, w: 320, size: 12, align: "left" },
      tipsBox: { x: 60,  y: 150, w: 320, size: 11, align: "left" },
      actsBox: { x: 390, y: 150, w: 320, size: 11, align: "left" }
    }
  };

  if (layoutV6 && typeof layoutV6 === "object") {
    const merged = deepMerge(L, layoutV6);
    merged.p1 = { ...merged.p1, ...L.p1 };
    merged.footer = { ...merged.footer, ...L.footer };
    return merged;
  }
  return L;
}

// ------------------------------
// Tuner: read ?abs_R_x=..., ?labelCTx=..., ?state_shape=..., etc.
// ------------------------------
function buildStateOverridesFromQuery(q) {
  const o = { };

  // shape + global style
  const shape = q.state_shape || q.shape;
  if (shape) o.shape = String(shape).toLowerCase();                 // "round" | "squircle"
  const nExp  = n(q.state_n);      if (nExp  !== undefined) o.n = nExp;
  const steps = n(q.state_steps);  if (steps !== undefined) o.steps = steps;
  const inset = n(q.state_inset);  if (inset !== undefined) o.highlightInset = inset;
  const rad   = n(q.state_radius); if (rad   !== undefined) o.highlightRadius = rad;
  const op    = n(q.state_opacity);if (op    !== undefined) o.fillOpacity = op;

  // absolute mode toggle
  const useAbs = q.state_useAbs ?? q.useAbs;
  if (useAbs !== undefined) o.useAbsolute = bool(useAbs, true);

  // label text/size/offsets
  if (q.labelText   !== undefined) o.labelText = String(q.labelText);
  if (q.labelSize   !== undefined) o.labelSize = n(q.labelSize, 10);
  const lOffX = n(q.labelOffsetX); if (lOffX !== undefined) o.labelOffsetX = lOffX;
  const lOffY = n(q.labelOffsetY); if (lOffY !== undefined) o.labelOffsetY = lOffY;

  // shared anchors for CT (top) & RL (bottom)
  const labelCTx = n(q.labelCTx); const labelCTy = n(q.labelCTy);
  const labelRLx = n(q.labelRLx); const labelRLy = n(q.labelRLy);
  if (labelCTx !== undefined || labelCTy !== undefined) {
    o.labelCT = { x: labelCTx, y: labelCTy };
  }
  if (labelRLx !== undefined || labelRLy !== undefined) {
    o.labelRL = { x: labelRLx, y: labelRLy };
  }

  // per-state label anchors (optional)
  const labelC_x = n(q.labelC_x), labelC_y = n(q.labelC_y);
  const labelT_x = n(q.labelT_x), labelT_y = n(q.labelT_y);
  const labelR_x = n(q.labelR_x), labelR_y = n(q.labelR_y);
  const labelL_x = n(q.labelL_x), labelL_y = n(q.labelL_y);
  const labelByState = {};
  if (labelC_x !== undefined || labelC_y !== undefined) labelByState.C = { x: labelC_x, y: labelC_y };
  if (labelT_x !== undefined || labelT_y !== undefined) labelByState.T = { x: labelT_x, y: labelT_y };
  if (labelR_x !== undefined || labelR_y !== undefined) labelByState.R = { x: labelR_x, y: labelR_y };
  if (labelL_x !== undefined || labelL_y !== undefined) labelByState.L = { x: labelL_x, y: labelL_y };
  if (Object.keys(labelByState).length) o.labelByState = labelByState;

  // absolute rectangles per state (top-left coords)
  const absBoxes = {};
  const states = ["C","T","R","L"];
  for (const s of states) {
    const x = n(q[`abs_${s}_x`]);
    const y = n(q[`abs_${s}_y`]);
    const w = n(q[`abs_${s}_w`]);
    const h = n(q[`abs_${s}_h`]);
    if ([x,y,w,h].some(v => v !== undefined)) absBoxes[s] = { x, y, w, h };
  }
  if (Object.keys(absBoxes).length) o.absBoxes = absBoxes;

  return o;
}

// ------------------------------
// Painter for the state highlight (Page 3)
// ------------------------------
async function paintStateHighlight(pdfDoc, page3, dominantKey, L, pdfLib) {
  const { StandardFonts, rgb } = pdfLib;
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cfg  = L.p3?.state || {};
  const dom  = String(dominantKey || "R").toUpperCase();

  const styleByState = cfg.styleByState || {};
  const dStyle = styleByState[dom] || {};

  const inset   = Number.isFinite(+dStyle.inset) ? +dStyle.inset :
                  Number.isFinite(+cfg.highlightInset) ? +cfg.highlightInset : 4;

  const radius  = Number.isFinite(+dStyle.radius) ? +dStyle.radius :
                  Number.isFinite(+cfg.highlightRadius) ? +cfg.highlightRadius : 16;

  const shade   = cfg.fillColor
    ? rgb(cfg.fillColor.r, cfg.fillColor.g, cfg.fillColor.b)
    : rgb(251/255, 236/255, 250/255);

  const opacity = Number.isFinite(+cfg.fillOpacity) ? +cfg.fillOpacity : 0.45;

  const useAbs  = !!cfg.useAbsolute;
  const BOXES   = useAbs ? (cfg.absBoxes || {}) : computeBoxesFromGrid(cfg.grid || defaultP3Grid());
  const b = BOXES[dom];
  if (!b || !Number.isFinite(+b.x) || !Number.isFinite(+b.y) || !Number.isFinite(+b.w) || !Number.isFinite(+b.h)) return;

  // Convert top-left (template coords) to bottom-left (pdf-lib coords)
  const tlX = b.x + inset, tlY = b.y + inset;
  const ww  = Math.max(0, b.w - inset * 2);
  const hh  = Math.max(0, b.h - inset * 2);
  const pageH = page3.getHeight();
  const blX = tlX;
  const blY = pageH - (tlY + hh);

  // Shape
  const shape = (cfg.shape || cfg.state_shape || "round").toLowerCase();
  if (shape === "squircle") {
    if (typeof page3.drawSvgPath === "function") {
      const Nexp  = Number.isFinite(+cfg.n)     ? +cfg.n     : 4;
      const steps = Number.isFinite(+cfg.steps) ? +cfg.steps : 128;
      const dPath = makeSuperellipsePath(blX, blY, ww, hh, Nexp, steps);
      if (dPath) page3.drawSvgPath(dPath, { color: shade, opacity });
    } else {
      const Nexp  = Number.isFinite(+cfg.n)     ? +cfg.n     : 4;
      const step  = Number.isFinite(+cfg.steps) ? Math.max(1, Math.round(+cfg.steps / 16)) : 2;
      fillSuperellipseStrips(page3, blX, blY, ww, hh, Nexp, step, shade, opacity);
    }
  } else {
    page3.drawRectangle({
      x: blX, y: blY, width: ww, height: hh,
      color: shade, opacity,
      borderRadius: radius
    });
  }

  // Label: prefer per-state anchor; fall back to CT/RL; finally auto-centre
  const perState = (cfg.labelByState && cfg.labelByState[dom]) || null;
  const isCT = (dom === "C" || dom === "T");
  const groupAnchor = isCT ? (cfg.labelCT || null) : (cfg.labelRL || null);

  const offX = Number.isFinite(+cfg.labelOffsetX) ? +cfg.labelOffsetX : 0;
  const offY = Number.isFinite(+cfg.labelOffsetY) ? +cfg.labelOffsetY : 0;

  let lx, ly;
  if (perState && Number.isFinite(+perState.x) && Number.isFinite(+perState.y)) {
    lx = +perState.x; ly = +perState.y;
  } else if (groupAnchor && Number.isFinite(+groupAnchor.x) && Number.isFinite(+groupAnchor.y)) {
    lx = +groupAnchor.x; ly = +groupAnchor.y;
  } else {
    const cx = b.x + b.w / 2;
    const py = isCT
      ? (b.y + b.h - (Number.isFinite(+cfg.labelPadTop) ? +cfg.labelPadTop : 12))
      : (b.y + (Number.isFinite(+cfg.labelPadBottom) ? +cfg.labelPadBottom : 12));
    lx = cx; ly = py;
  }

  const labelText = String(cfg.labelText || "YOU ARE HERE");
  const labelSize = Number.isFinite(+cfg.labelSize) ? +cfg.labelSize : 10;
  const labelClr  = cfg.labelColor ? rgb(cfg.labelColor.r, cfg.labelColor.g, cfg.labelColor.b) : rgb(0.20, 0.20, 0.20);
  const textW = (await pdfDoc.embedFont(StandardFonts.HelveticaBold)).widthOfTextAtSize(labelText, labelSize);

  page3.drawText(labelText, {
    x: lx - textW / 2 + offX,
    y: (pageH - ly) - labelSize + offY,
    size: labelSize,
    font: (await pdfDoc.embedFont(StandardFonts.HelveticaBold)),
    color: labelClr
  });
}

// ------------------------------
// Main handler
// ------------------------------
export default async function handler(req, res) {
  try {
    const { PDFDocument, StandardFonts, rgb } = await getPdfLib();

    // 1) Parse payload + tuners
    const q = req.query || {};
    const payload = b64urlToJson(q.data);

    // derive dominant key
    const domKey =
      payload.domkey || payload.domKey ||
      payload.domletter || payload.domLetter ||
      mapDomStringToKey(payload.dom) ||
      "R";

    // 2) Build locked layout + merge any tuners from query
    let L = buildLayout();
    const stateOverrides = buildStateOverridesFromQuery(q);
    L = deepMerge(L, { p3: { state: stateOverrides } });

    // 3) Resolve template path
    const tplName = String(q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim.pdf");
    const safeTpl = tplName.replace(/[^a-zA-Z0-9_\-.]/g, "");
    const tplPath = path.join(process.cwd(), "public", "templates", safeTpl);

    let bytes;
    try {
      bytes = await fs.readFile(tplPath);
    } catch {
      // Fallback to a non-slim name if present
      const fallback = path.join(process.cwd(), "public", "templates", "CTRL_Perspective_Assessment_Profile_template.pdf");
      bytes = await fs.readFile(fallback);
    }

    // 4) Load, render page 3 highlight
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();
    if (pages.length >= 3) {
      const page3 = pages[2]; // 0-based index => page 3
      await paintStateHighlight(doc, page3, domKey, L, { StandardFonts, rgb });
    }

    // 5) Output as attachment or inline
    const out = await doc.save();
    const filename = String(q.name || "CTRL_V3_TUNER.pdf");
    const inline = bool(q.preview, false);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${filename}"`
    );
    res.status(200).send(Buffer.from(out));
  } catch (err) {
    console.error("fill-template error:", err);
    res.status(500).json({ error: "Exporter failed", detail: String(err?.message || err) });
  }
}

/**
 * Minimal test URLs (no tuners needed — locks are baked in):
 *
 * R: /api/fill-template?data=eyJkb21rZXkiOiJSIn0&tpl=CTRL_Perspective_Assessment_Profile_template_slim.pdf&preview=1&name=CTRL_V3_TUNER.pdf
 * C: /api/fill-template?data=eyJkb21rZXkiOiJDIn0&tpl=CTRL_Perspective_Assessment_Profile_template_slim.pdf&preview=1&name=CTRL_V3_TUNER.pdf
 * T: /api/fill-template?data=eyJkb21rZXkiOiJUIn0&tpl=CTRL_Perspective_Assessment_Profile_template_slim.pdf&preview=1&name=CTRL_V3_TUNER.pdf
 * L: /api/fill-template?data=eyJkb21rZXkiOiJMIN0&tpl=CTRL_Perspective_Assessment_Profile_template_slim.pdf&preview=1&name=CTRL_V3_TUNER.pdf
 *
 * (The data= values above are tiny base64url JSON like { "domkey": "R" } etc.)
 *
 * Still supported as one-off overrides:
 * - state_useAbs, state_shape, state_radius, state_inset, state_opacity, state_n, state_steps
 * - abs_C_x/y/w/h, abs_T_x/y/w/h, abs_R_x/y/w/h, abs_L_x/y/w/h
 * - labelText, labelSize, labelOffsetX, labelOffsetY
 * - labelCTx/labelCTy, labelRLx/labelRLy
 * - labelC_x/y, labelT_x/y, labelR_x/y, labelL_x/y
 */
