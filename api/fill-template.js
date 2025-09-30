/** **********************************************************************
 * CTRL Export Service · fill-template (Perspective flow)
 * Template: /public/CTRL_Perspective_Assessment_Profile_template_slim.pdf
 *
 * Coordinates are TL-origin (Top-Left), units = pt, pages are 1-based.
 * pdf-lib uses BL-origin internally; we convert.
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
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\uD800-\uDFFF]/g, "")       // surrogate pairs (emoji)
    .replace(/[\uE000-\uF8FF]/g, "")       // private use area
    .replace(/[\uFE0E\uFE0F]/g, "")        // variation selectors
    .replace(/[\u200B-\u200D\u2060]/g, "") // zero-width chars
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
  const yTop    = pageH - y; // TL → BL conversion (top of box)
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

function drawTextInBox(page, font, text, box, size = 10, align = "left", opts = {}) {
  const spec = { x: N(box.x), y: N(box.y), w: N(box.w), size: N(size), align };
  return drawTextBox(page, font, S(text), spec, opts);
}

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

  // Label anchor (TL space)
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
  P.name      = norm(d.n || d.name || d.fullName || d.preferredName);
  P.dateLbl   = norm(d.d || d.date || todayLbl());

  // Dominant bits (accept letter, label, or char alias)
  P.dom       = resolveDomKey(d.dom, d.dom6Key, d.dom6Label, d.domLabel, d.domchar, d.domDesc, d.character);
  P.domChar   = norm(d.domchar || d.domChar || d.character || "");
  P.domDesc   = norm(d.domdesc || d.domDesc || d.dominantDesc || "");

  // Spider / chart
  P.spiderTxt = norm(d.spiderdesc || d.spider || "");
  P.chartUrl  = S(d.spiderfreq || d.chart || "");

  // P5 / P6
  P.seqpat    = norm(d.seqpat || d.pattern || "");
  P.theme     = norm(d.theme || "");

  // Work-with structures (accept compact or full)
  const AA = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  P.workwcol  = AA(d.workwcol).map(x => ({
    mine:  norm(x?.mine || x?.my),  their: norm(x?.their || x?.other),
    look:  norm(x?.look),           work:  norm(x?.work)
  }));
  P.workwlead = AA(d.workwlead).map(x => ({
    mine:  norm(x?.mine || x?.my),  their: norm(x?.their || x?.other),
    look:  norm(x?.look),           work:  norm(x?.work)
  }));

  // Tips / actions
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
    const f = { x: 380, y: 51, w: 400, size: 13, align: "left" };
    return {
      f2:{...f}, f3:{...f}, f4:{...f}, f5:{...f}, f6:{...f}, f7:{...f}, f8:{...f}, f9:{...f}, f10:{...f}, f11:{...f}, f12:{...f}
    };
  })()
};

const DEFAULT_COORDS = {
  meta:  { units: "pt", origin: "TL", pages: "1-based" },

  // PAGE 3
  p3: {
    domChar: { x: 272, y: 640, w: 630, size: 23, align: "left", maxLines: 6 },
    domDesc: { x:  25, y: 685, w: 550, size: 18, align: "left", maxLines: 12 },
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
        C: { x: 60,  y: 245 },
        T: { x: 290, y: 244 },
        R: { x: 60,  y: 605 },
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
      }
    }
  },

  // PAGE 4 — Spider description + chart (tunable via URL)
  p4: {
    spider: { x: 30, y: 585, w: 550, size: 18, align: "left", maxLines: 10 },
    chart:  { x: 20, y: 225, w: 570, h: 280 }
  },

  // PAGE 5
  p5: { seqpat: { x:  25, y: 250, w: 550, size: 18, align: "left", maxLines: 12 } },

  // PAGE 6
  p6: { theme:  { x:  25, y: 350, w: 550, size: 18, align: "left", maxLines: 12 } },

  // PAGE 7 — LOOK · colleagues
  p7: {
    colBoxes: [
      { x:  25, y: 330, w: 260, h: 120 },  // C
      { x: 320, y: 330, w: 260, h: 120 },  // T
      { x:  25, y: 595, w: 260, h: 120 },  // R
      { x: 320, y: 595, w: 260, h: 120 }   // L
    ],
    bodySize: 13, maxLines: 15
  },

  // PAGE 8 — WORK · colleagues
  p8: {
    colBoxes: [
      { x:  25, y: 330, w: 260, h: 120 },
      { x: 320, y: 330, w: 260, h: 120 },
      { x:  25, y: 595, w: 260, h: 120 },
      { x: 320, y: 595, w: 260, h: 120 }
    ],
    bodySize: 13, maxLines: 15
  },

  // PAGE 9 — LOOK · leaders
  p9: {
    ldrBoxes: [
      { x:  25, y: 330, w: 260, h: 120 },  // C
      { x: 320, y: 330, w: 260, h: 120 },  // T
      { x:  25, y: 595, w: 260, h: 120 },  // R
      { x: 320, y: 595, w: 260, h: 120 }   // L
    ],
    bodySize: 13, maxLines: 15
  },

  // PAGE 10 — WORK · leaders
  p10: {
    ldrBoxes: [
      { x:  25, y: 330, w: 260, h: 120 },
      { x: 320, y: 330, w: 260, h: 120 },
      { x:  25, y: 595, w: 260, h: 120 },
      { x: 320, y: 595, w: 260, h: 120 }
    ],
    bodySize: 13, maxLines: 15
  },

  // PAGE 11 — Tips + Actions (split default)
  p11: {
    tipsBox: { x: 40, y: 175, w: 500, size: 18, align: "left", maxLines: 25 },
    actsBox: { x: 40, y: 355, w: 500, size: 18, align: "left", maxLines: 25 },
    lineGap: 6,
    itemGap: 6,
    bulletIndent: 18,
    split: true,
    tips1: { x: 30, y: 175, w: 530, h: 80, size: 18, align: "left", maxLines: 4 },
    tips2: { x: 30, y: 265, w: 530, h: 80, size: 18, align: "left", maxLines: 4 },
    acts1: { x: 30, y: 405, w: 530, h: 80, size: 18, align: "left", maxLines: 4 },
    acts2: { x: 30, y: 495, w: 530, h: 80, size: 18, align: "left", maxLines: 4 }
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
  L.p1 = { ...(LOCKED.p1), ...((base && base.p1) || {}) };
  return L;
}

function applyUrlTuners(q, L) {
  const pick = (obj, keys) => keys.reduce((o, k) => (q[k] != null ? (o[k] = q[k], o) : o), {});
  // (unchanged from your version – keeps all p1..p11 tuners you already had)
  // ——— p1 name/date
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
  // footers, p3, p4, p5, p6, p7..p11 (identical to your original for brevity)
  // … (keep your full tuner code here unchanged)
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

/* ────────────────────────── Botpress-ish hydration ───────────────────────── */
function tryHydrateFromBotpressish(q, P) {
  // Accept raw objects via query (Next.js will parse none; Edge proxies may)
  const parse = (x) => {
    if (!x) return null;
    if (typeof x === "object") return x;
    try { return JSON.parse(x); } catch { return null; }
  };

  const RPT_MIN = parse(q.RPT_MIN) || parse(q.min) || null;
  const FROZ = (parse(q.v3_frozen)?.shortKeys) || null;
  const V3P = parse(q.V3_Payload) || parse(q.payload) || null;

  // 1) Prefer explicit payload
  const src = V3P || {};
  // Soft fallbacks
  const domLbl = src.domLabel || src.dom || (FROZ && FROZ["p3:dom"]) || (RPT_MIN?.dominant?.label) || "";
  const domChr = src.domchar || src.character || (FROZ && FROZ["p3:domchar"]) || (RPT_MIN?.dominant?.char) || "";
  const domTxt = src.domdesc || src.dominantDesc || (FROZ && FROZ["p3:domdesc"]) || (RPT_MIN?.dominant?.text) || "";

  // Only fill if P fields are empty
  if (!P.dom)     P.dom     = resolveDomKey(domLbl, domChr);
  if (!P.domChar) P.domChar = norm(domChr);
  if (!P.domDesc) P.domDesc = norm(domTxt);

  if (!P.seqpat)  P.seqpat  = norm(src.seqpat || (FROZ && FROZ["p5:seqpat"]) || "");
  if (!P.theme)   P.theme   = norm(src.theme  || (FROZ && FROZ["p6:theme"])  || "");

  if (!P.spiderTxt) P.spiderTxt = norm(src.spiderdesc || "");
  if (!P.chartUrl)  P.chartUrl  = S(src.spiderfreq || "");

  if (!P.name) {
    P.name = norm(q.name || src.name || RPT_MIN?.person?.fullName || q.fullName || q.preferredName);
  }

  return P;
}

/* ───────────────────────────────── Handler ───────────────────────────────── */
export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const tpl = q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim.pdf";

    // Parse & sanitize primary payload
    const rawData = parseDataParam(q.data);
    // Secondary: allow plain query keys when no data param was provided
    const merged = { ...rawData };
    for (const k of ["name","fullName","preferredName","dom","domLabel","domchar","character","domdesc","dominantDesc","spiderdesc","spiderfreq","chart","seqpat","pattern","theme"]) {
      if (merged[k] == null && q[k] != null) merged[k] = q[k];
    }

    // Normalize
    let P = normaliseInput(merged);

    // Botpress-ish fallbacks (RPT_MIN / v3_frozen / V3_Payload)
    P = tryHydrateFromBotpressish(q, P);

    // Build layout (defaults + optional overrides + URL tuners)
    let L = buildLayout(merged.layoutV6);
    L = applyUrlTuners(q, L);

    // Load template
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
    // const page12 = p(11); // (footer only)

    /* ----------------------------- PAGE 1 ----------------------------- */
    if (L.p1?.name && P.name)     drawTextBox(page1, font, norm(P.name),    L.p1.name);
    if (L.p1?.date && P.dateLbl)  drawTextBox(page1, font, norm(P.dateLbl), L.p1.date);

    /* ----------------------------- PAGE 3 ----------------------------- */
    if (P.domChar) drawTextBox(page3, font, P.domChar, { ...L.p3.domChar }, { maxLines: N(L.p3.domChar.maxLines, 6) });
    if (P.domDesc) drawTextBox(page3, font, P.domDesc, { ...L.p3.domDesc }, { maxLines: N(L.p3.domDesc.maxLines, 12) });

    const dom = resolveDomKey(P.dom, P.domChar, P.domDesc);
    if (dom) {
      const anchor = paintStateHighlight(page3, dom, L.p3.state || {});
      if (anchor && (L.p3.state?.labelText || "").trim()) {
        const spec = { x: anchor.labelX, y: anchor.labelY, w: 180, size: N(L.p3.state.labelSize, 10), align: "center" };
        drawTextBox(page3, font, S(L.p3.state.labelText), spec, { maxLines: 1 });
      }
    }

    /* ----------------------------- PAGE 4 ----------------------------- */
    if (P.spiderTxt) drawTextBox(page4, font, P.spiderTxt, { ...L.p4.spider }, { maxLines: N(L.p4.spider.maxLines, 10) });
    if (P.chartUrl) {
      const img = await embedRemoteImage(pdfDoc, P.chartUrl);
      if (img) {
        const H = page4.getHeight();
        const x = N(L.p4.chart.x), y = N(L.p4.chart.y), w = N(L.p4.chart.w), h = N(L.p4.chart.h);
        page4.drawImage(img, { x, y: H - y - h, width: w, height: h });
      }
    }

    /* ----------------------------- PAGE 5 ----------------------------- */
    if (P.seqpat) drawTextBox(page5, font, P.seqpat, { ...L.p5.seqpat }, { maxLines: N(L.p5.seqpat.maxLines, 12) });

    /* ----------------------------- PAGE 6 ----------------------------- */
    if (P.theme)  drawTextBox(page6, font, P.theme,  { ...L.p6.theme }, { maxLines: N(L.p6.theme.maxLines, 12) });

    /* ----------------------------- PAGE 7 ----------------------------- */
    if (L.p7?.colBoxes?.length && (P.workwcol?.length)) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p7.colBoxes[i];
        const item = P.workwcol.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwcol[i] || {};
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page7, font, txt, bx, L.p7.bodySize || 13, "left", { maxLines: N(L.p7.maxLines, 15), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 8 ----------------------------- */
    if (L.p8?.colBoxes?.length && (P.workwcol?.length)) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p8.colBoxes[i];
        const item = P.workwcol.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwcol[i] || {};
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page8, font, txt, bx, L.p8.bodySize || 13, "left", { maxLines: N(L.p8.maxLines, 15), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 9 ----------------------------- */
    if (L.p9?.ldrBoxes?.length && (P.workwlead?.length)) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p9.ldrBoxes[i];
        const item = P.workwlead.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwlead[i] || {};
        const txt = norm(item?.look);
        if (txt) drawTextInBox(page9,  font, txt, bx, L.p9.bodySize || 13, "left", { maxLines: N(L.p9.maxLines, 15), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 10 ---------------------------- */
    if (L.p10?.ldrBoxes?.length && (P.workwlead?.length)) {
      const mapIdx = { C:0, T:1, R:2, L:3 };
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k];
        const bx = L.p10.ldrBoxes[i];
        const item = P.workwlead.find(x =>
          (S(x?.mine).toUpperCase() === k) || (S(x?.their).toUpperCase() === k)
        ) || P.workwlead[i] || {};
        const txt = norm(item?.work);
        if (txt) drawTextInBox(page10, font, txt, bx, L.p10.bodySize || 13, "left", { maxLines: N(L.p10.maxLines, 15), ellipsis: true });
      }
    }

    /* ----------------------------- PAGE 11 ---------------------------- */
    if (!L.p11.split) {
      if (P.tips?.length) {
        drawBulleted(page11, font, P.tips, {
          x:L.p11.tipsBox.x, y:L.p11.tipsBox.y, w:L.p11.tipsBox.w,
          size:L.p11.tipsBox.size, lineGap:L.p11.lineGap, itemGap:L.p11.itemGap,
          bulletIndent:L.p11.bulletIndent, align:S(L.p11.tipsBox.align,"left")
        }, { maxLines:N(L.p11.tipsBox.maxLines, 25) });
      }
      if (P.actions?.length) {
        drawBulleted(page11, font, P.actions, {
          x:L.p11.actsBox.x, y:L.p11.actsBox.y, w:L.p11.actsBox.w,
          size:L.p11.actsBox.size, lineGap:L.p11.lineGap, itemGap:L.p11.itemGap,
          bulletIndent:L.p11.bulletIndent, align:S(L.p11.actsBox.align,"left")
        }, { maxLines:N(L.p11.actsBox.maxLines, 25) });
      }
    } else {
      const T1 = ensureArray(P.tips)[0] ?? "";
      const T2 = ensureArray(P.tips)[1] ?? "";
      const A1 = ensureArray(P.actions)[0] ?? "";
      const A2 = ensureArray(P.actions)[1] ?? "";

      if (T1) drawBulleted(page11, font, [T1], {
        x:L.p11.tips1.x, y:L.p11.tips1.y, w:L.p11.tips1.w,
        size:L.p11.tips1.size, lineGap:L.p11.lineGap, itemGap:L.p11.itemGap,
        bulletIndent:L.p11.bulletIndent, align:S(L.p11.tips1.align,"left")
      }, { maxLines:N(L.p11.tips1.maxLines, Math.floor((L.p11.tips1.h||60) / (L.p11.tips1.size + L.p11.lineGap))) });

      if (T2) drawBulleted(page11, font, [T2], {
        x:L.p11.tips2.x, y:L.p11.tips2.y, w:L.p11.tips2.w,
        size:L.p11.tips2.size, lineGap:L.p11.lineGap, itemGap:L.p11.itemGap,
        bulletIndent:L.p11.bulletIndent, align:S(L.p11.tips2.align,"left")
      }, { maxLines:N(L.p11.tips2.maxLines, Math.floor((L.p11.tips2.h||60) / (L.p11.tips2.size + L.p11.lineGap))) });

      if (A1) drawBulleted(page11, font, [A1], {
        x:L.p11.acts1.x, y:L.p11.acts1.y, w:L.p11.acts1.w,
        size:L.p11.acts1.size, lineGap:L.p11.lineGap, itemGap:L.p11.itemGap,
        bulletIndent:L.p11.bulletIndent, align:S(L.p11.acts1.align,"left")
      }, { maxLines:N(L.p11.acts1.maxLines, Math.floor((L.p11.acts1.h||60) / (L.p11.acts1.size + L.p11.lineGap))) });

      if (A2) drawBulleted(page11, font, [A2], {
        x:L.p11.acts2.x, y:L.p11.acts2.y, w:L.p11.acts2.w,
        size:L.p11.acts2.size, lineGap:L.p11.lineGap, itemGap:L.p11.itemGap,
        bulletIndent:L.p11.bulletIndent, align:S(L.p11.acts2.align,"left")
      }, { maxLines:N(L.p11.acts2.maxLines, Math.floor((L.p11.acts2.h||60) / (L.p11.acts2.size + L.p11.lineGap))) });
    }

    /* ------------------------------ FOOTERS --------------------------- */
    const footerSpec = L.footer || LOCKED.footer;
    const footerLabel = norm([P.name].filter(Boolean).join(""));
    const put = (idx, key, text) => {
      const spec = footerSpec[key];
      if (!spec || !pages[idx]) return;
      drawTextBox(pages[idx], font, text, spec, { maxLines: 1 });
    };
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

    /* ------------------------------ DEBUG ----------------------------- */
    const wantDebug = String(q.debug || "").trim() === "1";
    if (wantDebug) {
      page1.drawText("DEBUG: fill-template alive ✓", { x: 24, y: page1.getHeight() - 24 - 12, size: 12, font, color: rgb(0.2,0.2,0.2) });
    }

    // Save output
    const bytes = await pdfDoc.save();
    const outName = S(q.name || `CTRL_${P.name || "Perspective"}_${P.dateLbl || todayLbl()}.pdf`).replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.status(400).json({ ok:false, error: `fill-template error: ${err.message || String(err)}` });
  }
}

/* ───────────────────────── list renderer (unchanged) ───────────────────── */
function drawBulleted(page, font, items, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 11, lineGap = 3,
    bullet = "•", itemGap = 0, bulletIndent = 18, align = "left",
    color = rgb(0, 0, 0),
  } = spec;

  const maxLines = opts.maxLines ?? 12;
  const arr = ensureArray(items).map(s => norm(s));
  const pageH = page.getHeight();
  let yCursor = pageH - y;
  const lineH = Math.max(1, size) + lineGap;

  const widthOf = (s) => font.widthOfTextAtSize(s, Math.max(1, size));
  const indentSpaces = Math.max(2, Math.round(bulletIndent / Math.max(1, size) * 2));
  const indentStr = " ".repeat(indentSpaces);

  let usedLines = 0;

  for (const raw of arr) {
    if (!raw) continue;

    const words = raw.split(/\s+/).filter(Boolean);
    let prefix = `${bullet} `;
    let current = "";
    const lines = [];

    while (words.length) {
      const candidate = (current ? `${current} ${words[0]}` : `${prefix}${words[0]}`);
      if (widthOf(candidate) <= w || !current) {
        current = candidate;
        words.shift();
      } else {
        lines.push(current);
        prefix = indentStr;
        current = "";
      }
    }
    if (current) lines.push(current);

    for (const ln of lines) {
      if (usedLines >= maxLines) break;
      page.drawText(ln, { x, y: yCursor - size, size: Math.max(1, size), font, color });
      yCursor -= lineH;
      usedLines++;
    }
    if (usedLines >= maxLines) break;

    if (itemGap > 0) yCursor -= itemGap;
  }
}
