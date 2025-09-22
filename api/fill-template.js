// /api/fill-template.js — CTRL V3 Slim Exporter (with squircle + wide tuners)
// Locked: p1_name / p1_date / footer_n2..n9 (URL tuners are ignored for these)
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────────────────────────── Utilities ───────────────────────────────── */
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
const ensureArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);

/* ────────────────────────────── Drawing helpers ───────────────────────────── */
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
  const yTop    = pageH - y;
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

    const baseline = pageH - curY;
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

/* ───────────────────────── Squircle path generator ───────────────────────── */
function makeSuperellipsePath(x, y, w, h, n = 4, steps = 96) {
  const a = w / 2;
  const b = h / 2;
  const cx = x + a;
  const cy = y + b;
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

/* ───────────────────── Page 3 highlight painter (round/squircle) ───────────────────── */
async function paintStateHighlight(pdf, page3, dominantKey, L) {
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cfg  = L.p3.state || {};
  const useAbs = !!cfg.useAbsolute;
  const inset  = N(cfg.highlightInset, 4);
  const radius = N(cfg.highlightRadius, 16);
  const labelText = S(cfg.labelText || "YOU ARE HERE");
  const labelSize = N(cfg.labelSize, 10);
  const labelColor = cfg.labelColor || rgb(0.20, 0.20, 0.20);
  const shade = cfg.fillColor || rgb(251/255, 236/255, 250/255); // #FBECFA
  const opacity = N(cfg.fillOpacity, 0.45);

  const BOXES = useAbs
    ? (cfg.absBoxes || {})
    : computeBoxesFromGrid(cfg.grid || defaultP3Grid());

  const dom = String(dominantKey || "R").toUpperCase();
  const b = BOXES[dom];
  if (!b) return;

  // draw shaded highlight: rounded rectangle OR squircle
  const shape = (cfg.shape || cfg.state_shape || "round").toLowerCase();
  const xx = b.x + inset, yy = b.y + inset;
  const ww = b.w - inset * 2, hh = b.h - inset * 2;

  if (shape === "squircle" && page3.drawSvgPath) {
    const Nexp  = Number.isFinite(+cfg.n)     ? +cfg.n     : 4;
    const steps = Number.isFinite(+cfg.steps) ? +cfg.steps : 96;
    const dPath = makeSuperellipsePath(xx, yy, ww, hh, Nexp, steps);
    page3.drawSvgPath(dPath, { color: shade, opacity });
  } else {
    page3.drawRectangle({ x: xx, y: yy, width: ww, height: hh, color: shade, opacity, borderRadius: radius });
  }

  // label placement
  const isTop = (dom === "C" || dom === "T");
  const abs = isTop ? (cfg.labelCT || null) : (cfg.labelRL || null);
  const offX = N(cfg.labelOffsetX, 0);
  const offY = N(cfg.labelOffsetY, 0);

  let lx, ly;
  if (abs && Number.isFinite(abs.x) && Number.isFinite(abs.y)) {
    lx = abs.x; ly = abs.y;
  } else {
    const cx = b.x + b.w / 2;
    const py = isTop ? (b.y + b.h - N(cfg.labelPadTop, 12))
                     : (b.y + N(cfg.labelPadBottom, 12));
    lx = cx; ly = py;
  }

  const textW = bold.widthOfTextAtSize(labelText, labelSize);
  page3.drawText(labelText, { x: lx - textW / 2 + offX, y: ly + offY, size: labelSize, font: bold, color: labelColor });
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

/* ───────────────────────────── Template fetch ───────────────────────────── */
async function fetchTemplate(req, url) {
  const tplParam = url?.searchParams?.get("tpl");
  if (tplParam && /^https?:\/\//i.test(tplParam)) {
    const r = await fetch(tplParam);
    if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  const host  = S((req && req.headers && req.headers.host) || "ctrl-export-service.vercel.app");
  const proto = S((req && req.headers && req.headers["x-forwarded-proto"]) || "https");
  const filename = tplParam && tplParam.trim()
    ? tplParam.trim()
    : "CTRL_Perspective_Assessment_Profile_template_slim.pdf";
  const full = `${proto}://${host}/${filename}`;
  const r = await fetch(full);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

/* ───────────────────────── Input normalisation ───────────────────────── */
function normaliseInput(data) {
  const d = { ...(data || {}) };
  d.f = d.f || d.flow || "Perspective"; // not drawn
  d.n = d.n || (d.person && (d.person.preferredName || d.person.fullName)) || "";
  d.d = d.d || d.dateLbl || todayLbl();

  d.dom     = d.dom     || d.dom6Label || "";
  d.domchar = d.domchar || d.character || "";
  d.domdesc = d.domdesc || d.dominantDesc || "";

  d.spiderfreq = d.spiderfreq || d.chartUrl || "";
  d.spiderdesc = d.spiderdesc || d.how6 || "";

  d.domkey = d.domkey || d.dom6Key || "";

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

/* ───────────────────────────── Layout defaults ───────────────────────────── */
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

// 🔒 LOCKED positions for p1 + footer (URL tuners will be ignored)
const LOCKED = {
  p1: {
    name: { x: 7,   y: 473,  w: 500, size: 30, align: "center" },
    date: { x: 210, y: 600,  w: 500, size: 25, align: "left"   }
  },
  footer: (() => {
    const one = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
    return { n2: {...one}, n3:{...one}, n4:{...one}, n5:{...one}, n6:{...one}, n7:{...one}, n8:{...one}, n9:{...one} };
  })()
};

function buildLayout(layoutV6) {
  const L = {
    meta: { units: "pt", origin: "TL", pages: "1-based" },

    // PAGE 1 (locked)
    p1: {
      name: LOCKED.p1.name,
      date: LOCKED.p1.date
    },

    // FOOTERS 2–9 (locked: only the name centre line)
    footer: LOCKED.footer,

    // PAGE 3
    p3: {
      domChar: { x:  60, y: 170, w: 650, size: 11, align: "left"  },
      domDesc: { x:  60, y: 200, w: 650, size: 11, align: "left"  },

      state: {
        useAbsolute: false,
        highlightInset: 4,
        highlightRadius: 16,
        fillOpacity: 0.45,
        fillColor: rgb(251/255, 236/255, 250/255),  // #FBECFA
        labelText: "YOU ARE HERE",
        labelSize: 10,
        labelColor: rgb(0.20, 0.20, 0.20),
        labelCT: { x: 180, y: 655 },
        labelRL: { x: 180, y: 365 },
        labelOffsetX: 0,
        labelOffsetY: 0,
        labelPadTop: 12,
        labelPadBottom: 12,
        grid:  { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 },
        absBoxes: {
          T: { x:  45, y: 520, w: 255, h: 160 },
          C: { x: 324, y: 520, w: 255, h: 160 },
          R: { x:  45, y: 320, w: 255, h: 160 },
          L: { x: 324, y: 320, w: 255, h: 160 }
        }
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

  // Merge Botpress overrides (but keep p1 + footer locked)
  if (layoutV6 && typeof layoutV6 === "object") {
    try {
      const merged = deepMerge(L, layoutV6);
      // overwrite any attempted changes to locked blocks
      merged.p1 = { ...merged.p1, name: LOCKED.p1.name, date: LOCKED.p1.date };
      merged.footer = { ...merged.footer, ...LOCKED.footer };
      return merged;
    } catch { /* ignore */ }
  }
  return L;
}

/* ───────────────────────────── URL Tuners ───────────────────────────── */
// Note: we intentionally DO NOT allow URL to modify p1.* or footer.n* (locked)
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
  // accept both domDesc_size (correct) and dokdesc_size (legacy typo)
  if (q["p3_dokdesc_size"] != null) q["p3_domDesc_size"] = q["p3_dokdesc_size"];
  setBox(L.p3?.domDesc, "p3_domDesc");

  // Page 3 state highlight + label
  L.p3 = L.p3 || {};
  L.p3.state = L.p3.state || {};
  const S3 = L.p3.state;

  if (q.state_useAbs === "1") S3.useAbsolute = true;
  if (q.state_useAbs === "0") S3.useAbsolute = false;

  if (q.state_inset   != null) S3.highlightInset  = +q.state_inset;
  if (q.state_radius  != null) S3.highlightRadius = +q.state_radius;
  if (q.state_opacity != null) S3.fillOpacity     = +q.state_opacity;

  if (q.state_shape)    S3.shape = String(q.state_shape); // "round" | "squircle"
  if (q.state_n != null)     S3.n     = +q.state_n;
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

/* ───────────────────────────────── HTTP handler ───────────────────────────────── */
export default async function handler(req, res) {
  let url;
  try { url = new URL(req?.url || "/", "http://localhost"); }
  catch { url = new URL("/", "http://localhost"); }

  const preview = url.searchParams.get("preview") === "1";
  const dataB64 = url.searchParams.get("data");
  if (!dataB64) { res.statusCode = 400; res.end("Missing ?data"); return; }

  // payload
  let data;
  try {
    const raw = Buffer.from(String(dataB64), "base64").toString("utf8");
    data = JSON.parse(raw);
  } catch (e) {
    res.statusCode = 400; res.end("Invalid ?data: " + (e?.message || e)); return;
  }

  try {
    const normData = normaliseInput(data);

    // template + fonts
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // pages
    const p1 = pdf.getPage(0);
    const p2 = pdf.getPage(1);
    const p3 = pdf.getPage(2);
    const p4 = pdf.getPage(3);
    const p5 = pdf.getPage(4);
    const p6 = pdf.getPage(5);
    const p7 = pdf.getPage(6);
    const p8 = pdf.getPage(7);
    const p9 = pdf.getPage(8);

    // layout (defaults + payload overrides), then apply URL tuners (respecting locks)
    let L = buildLayout(normData.layoutV6);
    L = applyUrlTuners(url, L);

    /* ---------------------------- PAGE 1 (locked) ---------------------------- */
    drawTextBox(p1, HelvB, normData.n, { ...L.p1.name, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p1, Helv,  normData.d, { ...L.p1.date, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    /* ---------------------------- PAGE 2 ---------------------------- */
    drawTextBox(p2, Helv, normData.n, { ...(L.footer.n2||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    /* ---------------------------- PAGE 3 ---------------------------- */
    drawTextBox(p3, Helv, normData.n, { ...(L.footer.n3||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    if (normData.domchar)
      drawTextBox(p3, Helv, `Representing the character: ${normData.domchar}`,
        { ...L.p3.domChar, color: rgb(0.15,0.14,0.22) }, { maxLines: 1, ellipsis: true });

    drawTextBox(p3, Helv, normData.domdesc,
      { ...L.p3.domDesc, color: rgb(0.15,0.14,0.22) }, { maxLines: 16, ellipsis: true });

    await paintStateHighlight(pdf, p3, normData.domkey || normData.dom6Key || "", L);

    /* ---------------------------- PAGE 4 ---------------------------- */
    drawTextBox(p4, Helv, normData.n, { ...(L.footer.n4||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p4, Helv, normData.spiderdesc,
      { ...L.p4.spider, color: rgb(0.15,0.14,0.22) }, { maxLines: 18, ellipsis: true });

    if (normData.spiderfreq) {
      try {
        const imgRes = await fetch(normData.spiderfreq);
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
    drawTextBox(p5, Helv, normData.n, { ...(L.footer.n5||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p5, Helv, normData.seqpat,
      { ...L.p5.seqpat, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });

    /* ---------------------------- PAGE 6 ---------------------------- */
    drawTextBox(p6, Helv, normData.n, { ...(L.footer.n6||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p6, Helv, normData.theme,
      { ...L.p6.theme, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });

    /* ---------------------------- PAGE 7 ---------------------------- */
    drawTextBox(p7, Helv, normData.n, { ...(L.footer.n7||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

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
      const e = (normData.workwcol || []).find(v => v?.their === k);
      const box = L.p7.colBoxes[i] || L.p7.colBoxes[0];
      const txt = makeTxt(e);
      if (txt) drawTextBox(p7, Helv, txt,
        { x: box.x, y: box.y, w: box.w, size: L.p7.bodySize, align: "left", color: rgb(0.15,0.14,0.22) },
        { maxLines: L.p7.maxLines, ellipsis: true });
    });

    order.forEach((k, i) => {
      const e = (normData.workwlead || []).find(v => v?.their === k);
      const box = L.p7.ldrBoxes[i] || L.p7.ldrBoxes[0];
      const txt = makeTxt(e);
      if (txt) drawTextBox(p7, Helv, txt,
        { x: box.x, y: box.y, w: box.w, size: L.p7.bodySize, align: "left", color: rgb(0.15,0.14,0.22) },
        { maxLines: L.p7.maxLines, ellipsis: true });
    });

    /* ---------------------------- PAGE 8 ---------------------------- */
    drawTextBox(p8, Helv, normData.n, { ...(L.footer.n8||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    drawTextBox(p8, HelvB, "Tips",    { ...L.p8.tipsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
    drawTextBox(p8, HelvB, "Actions", { ...L.p8.actsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });

    drawBulleted(p8, Helv, ensureArray(normData.tips),
      { ...L.p8.tipsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
      { maxLines: 26, blockGap: 6 });

    drawBulleted(p8, Helv, ensureArray(normData.actions),
      { ...L.p8.actsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
      { maxLines: 26, blockGap: 6 });

    /* ---------------------------- PAGE 9 ---------------------------- */
    drawTextBox(p9, Helv, normData.n, { ...(L.footer.n9||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    // save
    const bytes = await pdf.save();
    const fname = safeFileName(url, normData.n);
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
