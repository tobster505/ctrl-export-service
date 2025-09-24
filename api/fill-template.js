// pages/api/fill-template.js
// Next.js API Route (Node runtime only)
//
// What this does for you:
// - Locks in your latest coordinates for p3..p11
// - Splits 'look/work' exactly as requested:
//     p7: LOOK - colleagues
//     p8: WORK - colleagues
//     p9: LOOK - leaders
//     p10: WORK - leaders
// - Moves Tips & Actions to page 11 (with bullet alignment)
// - Adds footers n2..n12 (including tuners for n11 & n12)
// - Robust template resolution: local /public, /public/templates, /templates, same-host static, ENV base URL, or full URL
// - Defensive rendering (no crash if a page/asset is missing)
// - Safe external fetches with timeout

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

// Force Node runtime (avoid Edge crashes when using fs)
export const config = { api: { bodyParser: false } };

// ---------- utilities ----------
const ensureArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

const toBool = (v) =>
  typeof v === "string" ? v === "1" || v.toLowerCase() === "true" : !!v;

function tryJSON(s) { try { return JSON.parse(s); } catch { return null; } }

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

function decodeDataParam(raw) {
  if (!raw) return {};
  const j1 = tryJSON(raw);                 if (j1) return j1;
  const j2 = tryJSON(decodeURIComponentSafe(raw)); if (j2) return j2;
  try { const s = Buffer.from(raw, "base64").toString("utf8"); const j3 = tryJSON(s); if (j3) return j3; } catch {}
  try { const s = decodeURIComponentSafe(Buffer.from(raw, "base64").toString("utf8")); const j4 = tryJSON(s); if (j4) return j4; } catch {}
  return {};
}

function splitLinesToWidth(text, font, size, maxWidth) {
  const words = (text || "").replace(/\r/g, "").split(/\s+/g);
  const lines = [];
  let cur = "";
  const w = (t) => font.widthOfTextAtSize(t, size);
  words.forEach((word, idx) => {
    const test = cur ? cur + " " + word : word;
    if (w(test) <= maxWidth) cur = test;
    else { if (cur) lines.push(cur); cur = word; }
    if (idx === words.length - 1 && cur) lines.push(cur);
  });
  return lines.length ? lines : [""];
}

function bulletize(text) {
  if (!text) return "";
  const lines = text.replace(/\r/g, "").split("\n");
  return lines
    .map((ln) => (/^\s*(•|-|–|—|·|●|\u{1F4A1}|\u{1F539}|\u{1F538})\s+/u.test(ln) ? ln : ln))
    .join("\n");
}

function drawTextBox(page, font, text, box) {
  if (text == null || !page || !box) return;
  const {
    x = 0, y = 0, w = 200, h = undefined, size = 12, align = "left",
    maxLines = undefined, lineHeight = 1.32, color = rgb(0, 0, 0),
  } = box;

  const pageH = page.getHeight();
  const startY = pageH - y;
  const lineGap = size * lineHeight;

  const paragraphs = String(text).replace(/\r/g, "").split(/\n{2,}/g);
  let cursorY = startY;

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const normalized = paragraphs[pi].replace(/\n/g, " ").trim();
    const lines = splitLinesToWidth(normalized, font, size, w);
    for (let i = 0; i < lines.length; i++) {
      if (maxLines !== undefined && maxLines <= 0) return;

      const ln = lines[i];
      const lnWidth = font.widthOfTextAtSize(ln, size);
      let dx = x;
      if (align === "center") dx = x + (w - lnWidth) / 2;
      else if (align === "right") dx = x + (w - lnWidth);

      if (h && startY - (cursorY - lineGap) > h) return; // respect height box

      page.drawText(ln, { x: dx, y: cursorY - size, size, font, color });
      cursorY -= lineGap;
      if (maxLines !== undefined) box.maxLines = --box.maxLines;
      if (maxLines !== undefined && box.maxLines <= 0) return;
    }
    cursorY -= lineGap * 0.4; // paragraph spacing
  }
}

async function fetchWithTimeout(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function drawImageFromUrl(pdfDoc, page, url, rect) {
  if (!url || !page || !pdfDoc || !rect) return;
  try {
    const resp = await fetchWithTimeout(url, 10000);
    if (!resp.ok) return;
    const buf = await resp.arrayBuffer();
    let img;
    try { img = await pdfDoc.embedPng(buf); } catch { img = await pdfDoc.embedJpg(buf); }
    const { x = 0, y = 0, w = img.width, h = img.height } = rect;
    const pageH = page.getHeight();
    page.drawImage(img, { x, y: pageH - (y + h), width: w, height: h });
  } catch {
    // swallow fetch/embed errors to avoid crashing the function
  }
}

function deepMerge(base, override) {
  if (!override) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override)) {
    const bv = base?.[k], ov = override[k];
    out[k] = (bv && typeof bv === "object" && !Array.isArray(bv) && typeof ov === "object" && !Array.isArray(ov))
      ? deepMerge(bv, ov)
      : ov;
  }
  return out;
}

// ---------- template resolving ----------
async function resolveTemplateBytes(tpl, req) {
  // Full URL -> fetch
  if (/^https?:\/\//i.test(tpl)) {
    const r = await fetchWithTimeout(tpl, 10000);
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching template URL`);
    return await r.arrayBuffer();
  }

  // Try local filesystem (bundled file)
  const candidates = [
    path.join(process.cwd(), "public", tpl),
    path.join(process.cwd(), "public", "templates", tpl),
    path.join(process.cwd(), "templates", tpl),
    path.join(process.cwd(), tpl),
  ];
  for (const pth of candidates) {
    try {
      const b = await fs.readFile(pth);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    } catch {}
  }

  // Try same-host static /templates/<tpl>
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    if (host) {
      const sameHost = `${proto}://${host}/templates/${encodeURIComponent(tpl)}`;
      const r = await fetchWithTimeout(sameHost, 8000);
      if (r.ok) return await r.arrayBuffer();
    }
  } catch {}

  // Try ENV base URL (set TEMPLATE_BASE_URL=https://your.domain/templates)
  if (process.env.TEMPLATE_BASE_URL) {
    try {
      const u = `${process.env.TEMPLATE_BASE_URL.replace(/\/+$/,"")}/${encodeURIComponent(tpl)}`;
      const r = await fetchWithTimeout(u, 8000);
      if (r.ok) return await r.arrayBuffer();
    } catch {}
  }

  // Last-resort guess (adjust/remove if not valid in your project)
  try {
    const guess = `https://ctrl-export-service.vercel.app/templates/${encodeURIComponent(tpl)}`;
    const r = await fetchWithTimeout(guess, 8000);
    if (r.ok) return await r.arrayBuffer();
  } catch {}

  throw new Error(`Failed to locate template: ${tpl}`);
}

// ---------- locked defaults ----------
const LOCKED = (() => {
  const foot = { x: 200, y: 64, w: 400, size: 13, align: "left" };
  return {
    p1: {
      name: { x: 10, y: 573, w: 500, size: 30, align: "center" },
      date: { x: 130, y: 630, w: 500, size: 20, align: "left" },
    },
    footer: {
      f2: { ...foot }, n2: { ...foot, x: 250, size: 12, align: "center" },
      f3: { ...foot }, n3: { ...foot, x: 250, size: 12, align: "center" },
      f4: { ...foot }, n4: { ...foot, x: 250, size: 12, align: "center" },
      f5: { ...foot }, n5: { ...foot, x: 250, size: 12, align: "center" },
      f6: { ...foot }, n6: { ...foot, x: 250, size: 12, align: "center" },
      f7: { ...foot }, n7: { ...foot, x: 250, size: 12, align: "center" },
      f8: { ...foot }, n8: { ...foot, x: 250, size: 12, align: "center" },
      f9: { ...foot }, n9: { ...foot, x: 250, size: 12, align: "center" },
      f10:{ ...foot }, n10:{ x: 250, y: 64, w: 400, size: 12, align: "center" },
      n11:{ x: 250, y: 64, w: 400, size: 12, align: "center" }, // new
      n12:{ x: 250, y: 64, w: 400, size: 12, align: "center" }, // new
    },
  };
})();

// ---------- base layout (locked to your latest working URL) ----------
function buildLayout(layoutV6) {
  const L = {
    meta: { units: "pt", origin: "TL", pages: "1-based" },

    // PAGE 1
    p1: { name: LOCKED.p1.name, date: LOCKED.p1.date },

    // FOOTERS (2–12)
    footer: {
      f2: LOCKED.footer.f2, n2: LOCKED.footer.n2,
      f3: LOCKED.footer.f3, n3: LOCKED.footer.n3,
      f4: LOCKED.footer.f4, n4: LOCKED.footer.n4,
      f5: LOCKED.footer.f5, n5: LOCKED.footer.n5,
      f6: LOCKED.footer.f6, n6: LOCKED.footer.n6,
      f7: LOCKED.footer.f7, n7: LOCKED.footer.n7,
      f8: LOCKED.footer.f8, n8: LOCKED.footer.n8,
      f9: LOCKED.footer.f9, n9: LOCKED.footer.n9,
      f10: LOCKED.footer.f10, n10: LOCKED.footer.n10,
      n11: LOCKED.footer.n11, n12: LOCKED.footer.n12,
    },

    // PAGE 3
    p3: {
      state: {
        useAbsolute: true, shape: "round", highlightInset: 6, highlightRadius: 28,
        fillOpacity: 0.45,
        styleByState: { C: { radius: 28, inset: 6 }, T: { radius: 28, inset: 6 }, R: { radius: 1000, inset: 1 }, L: { radius: 28, inset: 6 } },
        labelByState: { C: { x: 150, y: 245 }, T: { x: 390, y: 244 }, R: { x: 150, y: 612 }, L: { x: 390, y: 605 } },
        labelText: "YOU ARE HERE", labelSize: 10, labelColor: { r: .2, g: .2, b: .2 },
        labelOffsetX: 0, labelOffsetY: 0, labelPadTop: 12, labelPadBottom: 12,
        absBoxes: {
          R: { x: 60, y: 433, w: 188, h: 158 },
          C: { x: 58, y: 258, w: 188, h: 156 },
          T: { x: 299, y: 258, w: 188, h: 156 },
          L: { x: 298, y: 440, w: 188, h: 156 },
        },
        grid: { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 },
      },
      // lock to your provided coords (still tunable via URL)
      domChar: { x: 305, y: 640, w: 630, size: 25, align: "left" },
      domDesc: { x: 25,  y: 685, w: 630, size: 18, align: "left" },
    },

    // PAGE 4
    p4: {
      spider: { x: 30, y: 585, w: 670, size: 18, align: "left" },
      chart:  { x: 20, y: 225, w: 570, h: 280 },
    },

    // PAGE 5
    p5: { seqpat: { x: 25, y: 260, w: 650, size: 18, align: "left" } },

    // PAGE 6
    p6: { theme: { x: 25, y: 335, w: 630, size: 18, align: "left" } },

    // PAGE 7 — LOOK (colleagues)
    p7: {
      hCol: { x: 30, y: 135, w: 640, size: 0 },
      hLdr: { x: 30, y: 370, w: 640, size: 0 },
      bodySize: 10, maxLines: 25,
      colBoxes: [
        { x: 25,  y: 265, w: 300, h: 210 }, // C
        { x: 320, y: 265, w: 300, h: 210 }, // T
        { x: 25,  y: 525, w: 300, h: 210 }, // R
        { x: 320, y: 525, w: 300, h: 210 }, // L
      ],
    },

    // PAGE 8 — WORK (colleagues)
    p8: {
      hCol: { x: 30, y: 135, w: 640, size: 0 },
      bodySize: 10, maxLines: 25,
      colBoxes: [
        { x: 25,  y: 265, w: 300, h: 210 }, // C
        { x: 320, y: 265, w: 300, h: 210 }, // T
        { x: 25,  y: 525, w: 300, h: 210 }, // R
        { x: 320, y: 525, w: 300, h: 210 }, // L
      ],
    },

    // PAGE 9 — LOOK (leaders)
    p9: {
      hLdr: { x: 30, y: 115, w: 640, size: 0 },
      ldrC:  { x: 25,  y: 265, w: 300, h: 95,  size: 16, max: 18 },
      ldrT:  { x: 320, y: 265, w: 300, h: 95,  size: 16, max: 18 },
      ldrR:  { x: 25,  y: 525, w: 300, h: 95,  size: 16, max: 18 },
      ldrL:  { x: 320, y: 525, w: 300, h: 95,  size: 16, max: 18 },
    },

    // PAGE 10 — WORK (leaders)
    p10: {
      hLdr: { x: 30, y: 115, w: 640, size: 0 },
      ldrC:  { x: 25,  y: 265, w: 300, h: 210, size: 10, max: 25 },
      ldrT:  { x: 320, y: 265, w: 300, h: 210, size: 10, max: 25 },
      ldrR:  { x: 25,  y: 525, w: 300, h: 210, size: 10, max: 25 },
      ldrL:  { x: 320, y: 525, w: 300, h: 210, size: 10, max: 25 },
    },

    // PAGE 11 — TIPS & ACTIONS (moved here)
    p11: {
      tipsHdr: { x: 70,  y: 122, w: 320, size: 12, align: "left"  },
      actsHdr: { x: 400, y: 122, w: 320, size: 12, align: "left"  },
      tipsBox: { x: 70,  y: 155, w: 315, size: 11, align: "left"  },
      actsBox: { x: 400, y: 155, w: 315, size: 11, align: "left"  },
    },
  };

  return layoutV6 ? deepMerge(L, layoutV6) : L;
}

// ---------- URL tuners (underscore or short alias) ----------
function applyUrlTuners(url, L) {
  if (!url) return L;
  const qp = new URL(url, "https://x").searchParams;

  const num = (keys, d) => { for (const k of keys) { if (qp.has(k)) { const v = Number(qp.get(k)); if (!Number.isNaN(v)) return v; } } return d; };
  const str = (keys, d) => { for (const k of keys) { if (qp.has(k)) return qp.get(k); } return d; };

  function setBox(prefix, box) {
    if (!box) return;
    box.x = num([`${prefix}_x`, `${prefix}x`], box.x);
    box.y = num([`${prefix}_y`, `${prefix}y`], box.y);
    if ("w" in box) box.w = num([`${prefix}_w`, `${prefix}w`], box.w);
    if ("h" in box) box.h = num([`${prefix}_h`, `${prefix}h`], box.h);
    if ("size" in box) box.size = num([`${prefix}_size`, `${prefix}s`], box.size);
    if ("align" in box) box.align = str([`${prefix}_align`, `${prefix}align`], box.align);
    if ("max" in box) box.max = num([`${prefix}_max`, `${prefix}max`], box.max);
  }
  function setRect(prefix, rect) { setBox(prefix, rect); }

  // p3..p6
  setBox("p3_domChar", L.p3.domChar);
  setBox("p3_domDesc", L.p3.domDesc);
  setBox("p4_spider",  L.p4.spider);
  setRect("p4_chart",  L.p4.chart);
  setBox("p5_seqpat",  L.p5.seqpat);
  setBox("p6_theme",   L.p6.theme);

  // p7 — colleagues LOOK
  setBox("p7_hCol", L.p7.hCol);
  setBox("p7_hLdr", L.p7.hLdr);
  ["C","T","R","L"].forEach((k,i)=> setRect("p7_col"+k, L.p7.colBoxes[i]));

  // p8 — colleagues WORK
  setBox("p8_hCol", L.p8.hCol);
  ["C","T","R","L"].forEach((k,i)=> setRect("p8_col"+k, L.p8.colBoxes[i]));

  // p9 — leaders LOOK
  setBox("p9_hLdr", L.p9.hLdr);
  ["C","T","R","L"].forEach((k)=> setRect("p9_ldr"+k, L.p9["ldr"+k]));

  // p10 — leaders WORK
  setBox("p10_hLdr", L.p10.hLdr);
  ["C","T","R","L"].forEach((k)=> setRect("p10_ldr"+k, L.p10["ldr"+k]));

  // p11 — tips/actions
  setBox("p11_tipsHdr", L.p11.tipsHdr);
  setBox("p11_actsHdr", L.p11.actsHdr);
  setBox("p11_tipsBox", L.p11.tipsBox);
  setBox("p11_actsBox", L.p11.actsBox);

  // Footers n2..n12 (also accepts n11x/n11align, etc.)
  ["2","3","4","5","6","7","8","9","10","11","12"].forEach((n)=>{
    if (L.footer["f"+n]) setBox("f"+n,  L.footer["f"+n]);
    if (L.footer["n"+n]) setBox("n"+n,  L.footer["n"+n]);
  });

  return L;
}

// ---------- API handler ----------
export default async function handler(req, res) {
  try {
    const url = req.url || "";
    const qp = new URL(url, "https://x").searchParams;

    const tpl = qp.get("tpl");
    if (!tpl) { res.status(400).json({ error: "Missing ?tpl=<template.pdf or URL>" }); return; }

    const D = decodeDataParam(qp.get("data"));

    const outNameParam = qp.get("name");
    const personName =
      D.n ||
      (D.person && (D.person.preferredName || D.person.fullName || D.person.name)) ||
      "";

    const P = {
      flow: qp.get("flow") || D.f || "Perspective",
      personName,
      dateLbl: D.dateLbl || qp.get("d") || D.d || D.date || "",
      safe:   toBool(qp.get("safe")   ?? "1"),
      strict: toBool(qp.get("strict") ?? "1"),
      preview:toBool(qp.get("preview")?? "0"),
    };

    // Build + tune layout
    let L = buildLayout(D.layoutV6 || D.layoutV || null);
    L = applyUrlTuners(url, L);

    // Load template
    const tplBytes = await resolveTemplateBytes(tpl, req);

    // Build PDF
    const pdfDoc = await PDFDocument.load(tplBytes);
    const pages  = pdfDoc.getPages();
    const Helv   = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const HelvB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const p = (i) => pages[i] || null;
    const p1  = p(0),  p3  = p(2),  p4  = p(3),  p5  = p(4),  p6  = p(5);
    const p7  = p(6),  p8  = p(7),  p9  = p(8),  p10 = p(9),  p11 = p(10), p12 = p(11);

    // PAGE 1
    if (p1) {
      if (P.personName) drawTextBox(p1, HelvB, P.personName, L.p1.name);
      if (P.dateLbl)    drawTextBox(p1, Helv,  P.dateLbl,    L.p1.date);
    }

    // PAGE 3
    if (p3) {
      const domChar = D.dom6Label || D.dom6 || D.dom || D.dom6Key || "";
      const domDesc = D.dom6Desc  || D.domDesc || D.domDescription || D.dom6description || "";
      if (domChar) drawTextBox(p3, HelvB, domChar, L.p3.domChar);
      if (domDesc) drawTextBox(p3, Helv,  domDesc, L.p3.domDesc);
    }

    // PAGE 4
    if (p4) {
      const spiderTxt = D.spiderdesc || D.spiderDesc || D.how6 || D.how || "";
      if (spiderTxt) drawTextBox(p4, Helv, spiderTxt, L.p4.spider);
      const chartUrl  = qp.get("chart") || D.chartUrl || D.chart || D.spiderfreq || "";
      if (chartUrl) await drawImageFromUrl(pdfDoc, p4, chartUrl, L.p4.chart);
    }

    // PAGE 5
    if (p5) {
      const seq = D.seqpat || D.sequent || "";
      if (seq) drawTextBox(p5, Helv, seq, L.p5.seqpat);
    }

    // PAGE 6
    if (p6) {
      const theme = D.theme || D.theme6 || "";
      if (theme) drawTextBox(p6, Helv, theme, L.p6.theme);
    }

    // PAGE 7 — LOOK (colleagues)
    if (p7) {
      drawTextBox(p7, HelvB, "Colleagues — What to look out for", { ...L.p7.hCol, size: 12 });
      const view = ensureArray(D.workwcol).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      ["C","T","R","L"].forEach((k,i)=>{
        const v = byTheir(k);
        const msg = v.look || (v.look && v.look.look) || "";
        drawTextBox(p7, Helv, msg, { ...L.p7.colBoxes[i], size: L.p7.bodySize, maxLines: L.p7.maxLines });
      });
      if (L.footer?.n7 && P.personName) drawTextBox(p7, Helv, P.personName, L.footer.n7);
    }

    // PAGE 8 — WORK (colleagues)
    if (p8) {
      drawTextBox(p8, HelvB, "Colleagues — How to work with you", { ...L.p8.hCol, size: 12 });
      const view = ensureArray(D.workwcol).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      ["C","T","R","L"].forEach((k,i)=>{
        const v = byTheir(k);
        const msg = v.work || (v.work && v.work.work) || "";
        drawTextBox(p8, Helv, msg, { ...L.p8.colBoxes[i], size: L.p8.bodySize, maxLines: L.p8.maxLines });
      });
      if (L.footer?.n8 && P.personName) drawTextBox(p8, Helv, P.personName, L.footer.n8);
    }

    // PAGE 9 — LOOK (leaders)
    if (p9) {
      drawTextBox(p9, HelvB, "Leaders — What to look out for", { ...L.p9.hLdr, size: 12 });
      const view = ensureArray(D.workwlead).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      ["C","T","R","L"].forEach((k)=>{
        const v = byTheir(k);
        const msg = v.look || (v.look && v.look.look) || "";
        const box = L.p9["ldr"+k];
        drawTextBox(p9, Helv, msg, { ...box, size: box.size, maxLines: box.max });
      });
      if (L.footer?.n9 && P.personName) drawTextBox(p9, Helv, P.personName, L.footer.n9);
    }

    // PAGE 10 — WORK (leaders)
    if (p10) {
      drawTextBox(p10, HelvB, "Leaders — How to work with you", { ...L.p10.hLdr, size: 12 });
      const view = ensureArray(D.workwlead).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      ["C","T","R","L"].forEach((k)=>{
        const v = byTheir(k);
        const msg = v.work || (v.work && v.work.work) || "";
        const box = L.p10["ldr"+k];
        drawTextBox(p10, Helv, msg, { ...box, size: box.size, maxLines: box.max });
      });
      if (L.footer?.n10 && P.personName) drawTextBox(p10, Helv, P.personName, L.footer.n10);
    }

    // PAGE 11 — Tips & Actions (moved here)
    if (p11) {
      const tipsObj = (ensureArray(D.tips2)[0] || ensureArray(D.tips)[0] || {}) || {};
      const actsObj = (ensureArray(D.actions2)[0] || ensureArray(D.actions)[0] || {}) || {};

      const tipsHdr  = tipsObj.title || "Tips";
      const actsHdr  = actsObj.title || "Actions";
      const tipsBody = bulletize(tipsObj.body || tipsObj.text || "");
      const actsBody = bulletize(actsObj.body || actsObj.text || "");

      drawTextBox(p11, Helv, tipsHdr,  L.p11.tipsHdr);
      drawTextBox(p11, Helv, actsHdr,  L.p11.actsHdr);
      drawTextBox(p11, Helv, tipsBody, L.p11.tipsBox);
      drawTextBox(p11, Helv, actsBody, L.p11.actsBox);

      if (L.footer?.n11 && P.personName) drawTextBox(p11, Helv, P.personName, L.footer.n11);
    }

    // PAGE 12 — footer only (tunable)
    if (p12 && L.footer?.n12 && P.personName) {
      drawTextBox(p12, Helv, P.personName, L.footer.n12);
    }

    // Output
    const outName =
      qp.get("name") ||
      D.outputName ||
      `CTRL_${P.personName ? P.personName.replace(/\s+/g, "_") : "output"}.pdf`;

    const bytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName.replace(/"/g, "")}"`);
    res.status(200).send(Buffer.from(bytes));
  } catch (err) {
    console.error("fill-template error:", err);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: String(err?.message || err) });
  }
}
