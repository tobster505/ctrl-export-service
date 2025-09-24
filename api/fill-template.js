// /api/fill-template.js
// Next.js (Node runtime) serverless function
// - Locks default coordinates to your latest URL
// - Allows tuning via URL params (p3_*, p4_*, p5_*, p6_*, p7_*, p8_*, p9_*, p10_*, p11_* and n2..n12)
// - Splits look/work content across pages 7–10
// - Moves Tips & Actions to page 11
// - Adds tunable footers for pages 11 & 12

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ----------------------------- helpers -----------------------------

const ensureArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

const toBool = (v) =>
  typeof v === "string" ? v === "1" || v.toLowerCase() === "true" : !!v;

function bufferFromBase64(b64) {
  return Buffer.from(b64, "base64");
}

function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function decodeDataParam(raw) {
  if (!raw) return {};
  // 1) try direct JSON
  const j1 = tryParseJSON(raw);
  if (j1) return j1;

  // 2) try decodeURIComponent then JSON
  const maybeUri = tryParseJSON(decodeURIComponentSafe(raw));
  if (maybeUri) return maybeUri;

  // 3) try base64 -> string -> JSON
  try {
    const s = Buffer.from(raw, "base64").toString("utf8");
    const j3 = tryParseJSON(s);
    if (j3) return j3;
  } catch {}

  // 4) try base64 + decodeURIComponent
  try {
    const s = decodeURIComponentSafe(
      Buffer.from(raw, "base64").toString("utf8")
    );
    const j4 = tryParseJSON(s);
    if (j4) return j4;
  } catch {}

  return {};
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// text wrapping and drawing (Top-Left coordinate system)
function splitLinesToWidth(text, font, size, maxWidth) {
  const words = (text || "").replace(/\r/g, "").split(/\s+/g);
  const lines = [];
  let cur = "";

  const width = (t) => font.widthOfTextAtSize(t, size);

  words.forEach((w, idx) => {
    const test = cur ? cur + " " + w : w;
    if (width(test) <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
    if (idx === words.length - 1 && cur) lines.push(cur);
  });

  return lines.length ? lines : [""];
}

function bulletize(text) {
  if (!text) return "";
  // Keep existing bullets; if line starts with emoji bullet, dash, or •, preserve it.
  const lines = text.replace(/\r/g, "").split("\n");
  return lines
    .map((ln) => {
      if (/^\s*(•|-|–|—|·|●|\u{1F4A1}|\u{1F539}|\u{1F538})\s+/u.test(ln)) {
        return ln;
      }
      return ln;
    })
    .join("\n");
}

function drawTextBox(page, font, text, box) {
  if (!text && text !== 0) return;
  const {
    x = 0,
    y = 0,
    w = 200,
    h = undefined,
    size = 12,
    align = "left",
    maxLines = undefined,
    lineHeight = 1.32,
    color = rgb(0, 0, 0),
  } = box || {};

  const pageH = page.getHeight();
  const startY = pageH - y; // convert TL to BL baseline top
  const lineGap = size * lineHeight;

  const paragraphs = String(text).replace(/\r/g, "").split(/\n{2,}/g);
  let cursorY = startY;

  paragraphs.forEach((para, pi) => {
    const normalized = para.replace(/\n/g, " ").trim();
    const lines = splitLinesToWidth(normalized, font, size, w);
    for (let i = 0; i < lines.length; i++) {
      if (maxLines && maxLines <= 0) return; // cut off if maxLines consumed
      const ln = lines[i];
      const lnWidth = font.widthOfTextAtSize(ln, size);
      let dx = x;
      if (align === "center") dx = x + (w - lnWidth) / 2;
      else if (align === "right") dx = x + (w - lnWidth);

      // if an explicit height is set, abort if next line would overflow box
      if (h && startY - (cursorY - lineGap) > h) return;

      page.drawText(ln, {
        x: dx,
        y: cursorY - size, // text draws from baseline
        size,
        font,
        color,
      });

      cursorY -= lineGap;
      if (maxLines) maxLines -= 1;
      if (maxLines === 0) return;
    }
    // paragraph gap
    cursorY -= lineGap * 0.4;
  });
}

async function drawImageFromUrl(page, url, rect) {
  if (!url) return;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const buf = await resp.arrayBuffer();
    // try png, then jpg
    let img;
    try {
      img = await page.doc.embedPng(buf);
    } catch {
      img = await page.doc.embedJpg(buf);
    }
    const { x = 0, y = 0, w = img.width, h = img.height } = rect || {};
    const pageH = page.getHeight();
    page.drawImage(img, {
      x,
      y: pageH - (y + h), // TL -> BL
      width: w,
      height: h,
    });
  } catch {
    // ignore missing images
  }
}

function deepMerge(base, override) {
  if (!override) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override)) {
    const bv = base?.[k],
      ov = override[k];
    out[k] =
      bv && typeof bv === "object" && !Array.isArray(bv) && typeof ov === "object" && !Array.isArray(ov)
        ? deepMerge(bv, ov)
        : ov;
  }
  return out;
}

// ----------------------------- LOCKED defaults -----------------------------

const LOCKED = (() => {
  const foot = { x: 200, y: 64, w: 400, size: 13, align: "left" };
  return {
    p1: {
      name: { x: 10, y: 573, w: 500, size: 30, align: "center" },
      date: { x: 130, y: 630, w: 500, size: 20, align: "left" },
    },
    footer: {
      f2: { ...foot },
      n2: { ...foot, x: 250, size: 12, align: "center" },
      f3: { ...foot },
      n3: { ...foot, x: 250, size: 12, align: "center" },
      f4: { ...foot },
      n4: { ...foot, x: 250, size: 12, align: "center" },
      f5: { ...foot },
      n5: { ...foot, x: 250, size: 12, align: "center" },
      f6: { ...foot },
      n6: { ...foot, x: 250, size: 12, align: "center" },
      f7: { ...foot },
      n7: { ...foot, x: 250, size: 12, align: "center" },
      f8: { ...foot },
      n8: { ...foot, x: 250, size: 12, align: "center" },
      f9: { ...foot },
      n9: { ...foot, x: 250, size: 12, align: "center" },
      f10: { ...foot },
      n10: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      // NEW: extended to pages 11 & 12
      n11: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      n12: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    },
  };
})();

// ----------------------------- layout (locked to your URL) -----------------------------

function buildLayout(layoutV6) {
  const L = {
    meta: { units: "pt", origin: "TL", pages: "1-based" },

    // PAGE 1
    p1: { name: LOCKED.p1.name, date: LOCKED.p1.date },

    // FOOTERS (2–12)
    footer: {
      f2: LOCKED.footer.f2,
      n2: LOCKED.footer.n2,
      f3: LOCKED.footer.f3,
      n3: LOCKED.footer.n3,
      f4: LOCKED.footer.f4,
      n4: LOCKED.footer.n4,
      f5: LOCKED.footer.f5,
      n5: LOCKED.footer.n5,
      f6: LOCKED.footer.f6,
      n6: LOCKED.footer.n6,
      f7: LOCKED.footer.f7,
      n7: LOCKED.footer.n7,
      f8: LOCKED.footer.f8,
      n8: LOCKED.footer.n8,
      f9: LOCKED.footer.f9,
      n9: LOCKED.footer.n9,
      f10: LOCKED.footer.f10,
      n10: LOCKED.footer.n10,
      n11: LOCKED.footer.n11,
      n12: LOCKED.footer.n12,
    },

    // PAGE 3 (locked to your latest URL)
    p3: {
      state: {
        useAbsolute: true,
        shape: "round",
        highlightInset: 6,
        highlightRadius: 28,
        fillOpacity: 0.45,
        styleByState: {
          C: { radius: 28, inset: 6 },
          T: { radius: 28, inset: 6 },
          R: { radius: 1000, inset: 1 },
          L: { radius: 28, inset: 6 },
        },
        labelByState: {
          C: { x: 150, y: 245 },
          T: { x: 390, y: 244 },
          R: { x: 150, y: 612 },
          L: { x: 390, y: 605 },
        },
        labelText: "YOU ARE HERE",
        labelSize: 10,
        labelColor: { r: 0.2, g: 0.2, b: 0.2 },
        labelOffsetX: 0,
        labelOffsetY: 0,
        labelPadTop: 12,
        labelPadBottom: 12,
        absBoxes: {
          R: { x: 60, y: 433, w: 188, h: 158 },
          C: { x: 58, y: 258, w: 188, h: 156 },
          T: { x: 299, y: 258, w: 188, h: 156 },
          L: { x: 298, y: 440, w: 188, h: 156 },
        },
        grid: { marginX: 45, marginY: 520, gap: 24, boxW: 255, boxH: 160 },
      },
      domChar: { x: 305, y: 640, w: 630, size: 25, align: "left" },
      domDesc: { x: 25, y: 685, w: 630, size: 18, align: "left" },
    },

    // PAGE 4
    p4: {
      spider: { x: 30, y: 585, w: 670, size: 18, align: "left" },
      chart: { x: 20, y: 225, w: 570, h: 280 },
    },

    // PAGE 5
    p5: { seqpat: { x: 25, y: 260, w: 650, size: 18, align: "left" } },

    // PAGE 6
    p6: { theme: { x: 25, y: 335, w: 630, size: 18, align: "left" } },

    // PAGE 7 (Colleagues — LOOK)
    p7: {
      hCol: { x: 30, y: 135, w: 640, size: 0 },
      hLdr: { x: 30, y: 370, w: 640, size: 0 },
      bodySize: 10,
      maxLines: 25,
      colBoxes: [
        { x: 25, y: 265, w: 300, h: 210 }, // C
        { x: 320, y: 265, w: 300, h: 210 }, // T
        { x: 25, y: 525, w: 300, h: 210 }, // R
        { x: 320, y: 525, w: 300, h: 210 }, // L
      ],
    },

    // PAGE 8 (Colleagues — WORK)
    p8: {
      hCol: { x: 30, y: 135, w: 640, size: 0 },
      bodySize: 10,
      maxLines: 25,
      colBoxes: [
        { x: 25, y: 265, w: 300, h: 210 }, // C
        { x: 320, y: 265, w: 300, h: 210 }, // T
        { x: 25, y: 525, w: 300, h: 210 }, // R
        { x: 320, y: 525, w: 300, h: 210 }, // L
      ],
    },

    // PAGE 9 (Leaders — LOOK)
    p9: {
      hLdr: { x: 30, y: 115, w: 640, size: 0 },
      ldrC: { x: 25, y: 265, w: 300, h: 95, size: 16, max: 18 },
      ldrT: { x: 320, y: 265, w: 300, h: 95, size: 16, max: 18 },
      ldrR: { x: 25, y: 525, w: 300, h: 95, size: 16, max: 18 },
      ldrL: { x: 320, y: 525, w: 300, h: 95, size: 16, max: 18 },
    },

    // PAGE 10 (Leaders — WORK)
    p10: {
      hLdr: { x: 30, y: 115, w: 640, size: 0 },
      ldrC: { x: 25, y: 265, w: 300, h: 210, size: 10, max: 25 },
      ldrT: { x: 320, y: 265, w: 300, h: 210, size: 10, max: 25 },
      ldrR: { x: 25, y: 525, w: 300, h: 210, size: 10, max: 25 },
      ldrL: { x: 320, y: 525, w: 300, h: 210, size: 10, max: 25 },
    },

    // PAGE 11 (Tips & Actions)
    p11: {
      tipsHdr: { x: 70, y: 122, w: 320, size: 12, align: "left" },
      actsHdr: { x: 400, y: 122, w: 320, size: 12, align: "left" },
      tipsBox: { x: 70, y: 155, w: 315, size: 11, align: "left" },
      actsBox: { x: 400, y: 155, w: 315, size: 11, align: "left" },
    },
  };

  return layoutV6 ? deepMerge(L, layoutV6) : L;
}

// ----------------------------- URL tuners -----------------------------

function applyUrlTuners(url, L) {
  if (!url) return L;
  const qp = new URL(url, "https://x").searchParams;
  const t = (k, d) => (qp.has(k) ? Number(qp.get(k)) : d);
  const s = (k, d) => (qp.has(k) ? qp.get(k) : d);

  function setBox(prefix, box) {
    if (!box) return;
    box.x = t(prefix + "_x", box.x);
    box.y = t(prefix + "_y", box.y);
    box.w = t(prefix + "_w", box.w);
    if ("h" in box) box.h = t(prefix + "_h", box.h);
    if ("size" in box) box.size = t(prefix + "_size", box.size);
    if ("align" in box) box.align = s(prefix + "_align", box.align || "left");
    if ("max" in box) box.max = t(prefix + "_max", box.max);
  }
  function setRect(prefix, rect) {
    if (!rect) return;
    rect.x = t(prefix + "_x", rect.x);
    rect.y = t(prefix + "_y", rect.y);
    rect.w = t(prefix + "_w", rect.w);
    rect.h = t(prefix + "_h", rect.h);
    if ("size" in rect) rect.size = t(prefix + "_size", rect.size);
    if ("align" in rect) rect.align = s(prefix + "_align", rect.align || "left");
    if ("max" in rect) rect.max = t(prefix + "_max", rect.max);
  }

  // p3–p6
  setBox("p3_domChar", L.p3.domChar);
  setBox("p3_domDesc", L.p3.domDesc);
  setBox("p4_spider", L.p4.spider);
  setRect("p4_chart", L.p4.chart);
  setBox("p5_seqpat", L.p5.seqpat);
  setBox("p6_theme", L.p6.theme);

  // p7 (Colleagues — LOOK)
  setBox("p7_hCol", L.p7.hCol);
  setBox("p7_hLdr", L.p7.hLdr);
  ["C", "T", "R", "L"].forEach((k, i) => setRect("p7_col" + k, L.p7.colBoxes[i]));

  // p8 (Colleagues — WORK)
  setBox("p8_hCol", L.p8.hCol);
  ["C", "T", "R", "L"].forEach((k, i) => setRect("p8_col" + k, L.p8.colBoxes[i]));

  // p9 (Leaders — LOOK)
  setBox("p9_hLdr", L.p9.hLdr);
  ["C", "T", "R", "L"].forEach((k) => setRect("p9_ldr" + k, L.p9["ldr" + k]));

  // p10 (Leaders — WORK)
  setBox("p10_hLdr", L.p10.hLdr);
  ["C", "T", "R", "L"].forEach((k) => setRect("p10_ldr" + k, L.p10["ldr" + k]));

  // p11 (Tips & Actions)
  setBox("p11_tipsHdr", L.p11.tipsHdr);
  setBox("p11_actsHdr", L.p11.actsHdr);
  setBox("p11_tipsBox", L.p11.tipsBox);
  setBox("p11_actsBox", L.p11.actsBox);

  // Footers n2..n12 (+ f2..f10 pass-through)
  ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].forEach((n) => {
    const fx = "f" + n,
      nx = "n" + n;
    if (L.footer[fx]) setBox(fx, L.footer[fx]);
    if (L.footer[nx]) setBox(nx, L.footer[nx]);
  });

  return L;
}

// ----------------------------- API route -----------------------------

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    const url = req.url || "";
    const qp = new URL(url, "https://x").searchParams;

    const tpl = qp.get("tpl"); // template PDF (URL or path your infra resolves)
    if (!tpl) {
      res.status(400).json({ error: "Missing ?tpl=<template.pdf>" });
      return;
    }

    const dataParam = qp.get("data");
    const D = decodeDataParam(dataParam);
    const P = {
      flow: qp.get("flow") || D.f || "Perspective",
      name: qp.get("name") || D.n || (D.person && (D.person.fullName || D.person.preferredName)) || "",
      dateLbl: D.dateLbl || D.dateLbl || D.dateLbl || "",
      n: D.n || qp.get("name") || "",
      safe: toBool(qp.get("safe") ?? "1"),
      strict: toBool(qp.get("strict") ?? "1"),
      preview: toBool(qp.get("preview") ?? "0"),
    };

    // Build + tune layout
    let L = buildLayout(D.layoutV6 || D.layouTV6 || D.layoutV || null);
    L = applyUrlTuners(url, L);

    // fetch template
    const tplResp = await fetch(
      /^https?:\/\//i.test(tpl)
        ? tpl
        : `https://ctrl-export-service.vercel.app/templates/${tpl}`
    );
    if (!tplResp.ok) {
      res.status(400).json({ error: `Failed to fetch template: ${tpl}` });
      return;
    }
    const tplBytes = await tplResp.arrayBuffer();

    const pdfDoc = await PDFDocument.load(tplBytes);
    const pages = pdfDoc.getPages();
    const Helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // give page helper (1-based in comments)
    const p = (i) => pages[i] || null;
    const p1 = p(0),
      p2 = p(1),
      p3 = p(2),
      p4 = p(3),
      p5 = p(4),
      p6 = p(5),
      p7 = p(6),
      p8 = p(7),
      p9 = p(8),
      p10 = p(9),
      p11 = p(10),
      p12 = p(11);

    // inject backrefs for image embedders
    pages.forEach((pg) => (pg.doc = pdfDoc));

    // ---------------------- PAGE 1 ----------------------
    if (p1) {
      if (P.name) drawTextBox(p1, HelvB, P.name, L.p1.name);
      const dateLabel =
        D.dateLbl ||
        D.dateLabel ||
        qp.get("d") ||
        D.d ||
        D.date ||
        D.dateLbl ||
        "";
      if (dateLabel) drawTextBox(p1, Helv, dateLabel, L.p1.date);
    }

    // ---------------------- PAGES 2–6 (only touched where specified) ----------------------

    // PAGE 3: Dominant trait & description
    if (p3) {
      const domChar = D.dom6Label || D.dom6 || D.dom || D.dom6Key || "";
      const domDesc =
        D.dom6Desc || D.domDesc || D.domDescription || D.dom6description || "";
      if (domChar) drawTextBox(p3, HelvB, domChar, L.p3.domChar);
      if (domDesc) drawTextBox(p3, Helv, domDesc, L.p3.domDesc);
    }

    // PAGE 4: Spider desc + chart
    if (p4) {
      const spiderTxt = D.spiderdesc || D.spiderDesc || D.how6 || D.how || "";
      if (spiderTxt) drawTextBox(p4, Helv, spiderTxt, L.p4.spider);
      const chartUrl =
        qp.get("chart") || D.chartUrl || D.chart || D.spiderfreq || "";
      if (chartUrl) await drawImageFromUrl(p4, chartUrl, L.p4.chart);
    }

    // PAGE 5: Sequence pattern
    if (p5) {
      const seq = D.seqpat || D.sequent || "";
      if (seq) drawTextBox(p5, Helv, seq, L.p5.seqpat);
    }

    // PAGE 6: Theme
    if (p6) {
      const theme = D.theme || D.theme6 || "";
      if (theme) drawTextBox(p6, Helv, theme, L.p6.theme);
    }

    // ---------------------- PAGE 7 — Colleagues (LOOK) ----------------------
    if (p7) {
      drawTextBox(p7, HelvB, "Colleagues — What to look out for", {
        ...L.p7.hCol,
        size: 12,
      });

      const view = ensureArray(D.workwcol).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      const keys = ["C", "T", "R", "L"];
      keys.forEach((k, i) => {
        const v = byTheir(k);
        const msg = v.look || (v.look && v.look.look) || "";
        drawTextBox(p7, Helv, msg, {
          ...L.p7.colBoxes[i],
          size: L.p7.bodySize,
          maxLines: L.p7.maxLines,
        });
      });

      if (P.n) drawTextBox(p7, Helv, P.n, L.footer.n7);
    }

    // ---------------------- PAGE 8 — Colleagues (WORK) ----------------------
    if (p8) {
      drawTextBox(p8, HelvB, "Colleagues — How to work with you", {
        ...L.p8.hCol,
        size: 12,
      });

      const view = ensureArray(D.workwcol).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      const keys = ["C", "T", "R", "L"];
      keys.forEach((k, i) => {
        const v = byTheir(k);
        const msg = v.work || (v.work && v.work.work) || "";
        drawTextBox(p8, Helv, msg, {
          ...L.p8.colBoxes[i],
          size: L.p8.bodySize,
          maxLines: L.p8.maxLines,
        });
      });

      if (P.n) drawTextBox(p8, Helv, P.n, L.footer.n8);
    }

    // ---------------------- PAGE 9 — Leaders (LOOK) ----------------------
    if (p9) {
      drawTextBox(p9, HelvB, "Leaders — What to look out for", {
        ...L.p9.hLdr,
        size: 12,
      });

      const view = ensureArray(D.workwlead).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      const keys = ["C", "T", "R", "L"];
      keys.forEach((k) => {
        const v = byTheir(k);
        const msg = v.look || (v.look && v.look.look) || "";
        const box = L.p9["ldr" + k];
        drawTextBox(p9, Helv, msg, {
          ...box,
          size: box.size,
          maxLines: box.max,
        });
      });

      if (P.n) drawTextBox(p9, Helv, P.n, L.footer.n9);
    }

    // ---------------------- PAGE 10 — Leaders (WORK) ----------------------
    if (p10) {
      drawTextBox(p10, HelvB, "Leaders — How to work with you", {
        ...L.p10.hLdr,
        size: 12,
      });

      const view = ensureArray(D.workwlead).map((x) => x || {});
      const byTheir = (k) => view.find((o) => (o || {}).their === k) || {};
      const keys = ["C", "T", "R", "L"];
      keys.forEach((k) => {
        const v = byTheir(k);
        const msg = v.work || (v.work && v.work.work) || "";
        const box = L.p10["ldr" + k];
        drawTextBox(p10, Helv, msg, {
          ...box,
          size: box.size,
          maxLines: box.max,
        });
      });

      if (P.n) drawTextBox(p10, Helv, P.n, L.footer.n10);
    }

    // ---------------------- PAGE 11 — Tips & Actions (moved here) ----------------------
    if (p11) {
      const tipsObj =
        (ensureArray(D.tips2)[0] || ensureArray(D.tips)[0] || {}) || {};
      const actsObj =
        (ensureArray(D.actions2)[0] || ensureArray(D.actions)[0] || {}) || {};

      const tipsHdr = tipsObj.title || "Tips";
      const actsHdr = actsObj.title || "Actions";
      const tipsBody = bulletize(tipsObj.body || tipsObj.text || "");
      const actsBody = bulletize(actsObj.body || actsObj.text || "");

      drawTextBox(p11, Helv, tipsHdr, L.p11.tipsHdr);
      drawTextBox(p11, Helv, actsHdr, L.p11.actsHdr);
      drawTextBox(p11, Helv, tipsBody, L.p11.tipsBox);
      drawTextBox(p11, Helv, actsBody, L.p11.actsBox);

      if (P.n) drawTextBox(p11, Helv, P.n, L.footer.n11);
    }

    // ---------------------- Optional PAGE 12 — footer only ----------------------
    if (p12 && P.n) {
      drawTextBox(p12, Helv, P.n, L.footer.n12);
    }

    // ---------------------- send pdf ----------------------
    const pdfBytes = await pdfDoc.save();
    const outName =
      qp.get("name") ||
      D.outputName ||
      `CTRL_${P.name ? P.name.replace(/\s+/g, "_") : "output"}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${outName.replace(/"/g, "")}"`
    );
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("fill-template error:", err);
    res
      .status(500)
      .json({ error: "INTERNAL_SERVER_ERROR", message: String(err?.message || err) });
  }
}
