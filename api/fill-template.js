// /api/fill-template.js — CTRL V3 Slim Exporter (Pages 1–9, short-key aware)
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ------------------------- tiny helpers (pure) ------------------------- */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (v, fb = "") =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

const alignNorm = (a) => {
  const v = String(a || "").toLowerCase();
  if (v === "centre") return "center";
  return ["left", "right", "center", "justify"].includes(v) ? v : "left";
};

const todayLbl = () => {
  const now = new Date();
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
  return `${String(now.getDate()).padStart(2,"0")}/${MMM}/${now.getFullYear()}`;
};

const ucFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const normPathLabel = (v) => {
  const s = String(v || "Perspective").trim();
  return s.toLowerCase() === "perspective" ? "Perspective" : ucFirst(s);
};

const ensureArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);

/* ----------------------- text & bullet rendering ----------------------- */
// Draw text with y measured from TOP of page (Keynote-style)
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const clean = norm(text);
  if (!clean) return { height: 0, linesDrawn: 0, lastY: page.getHeight() - y };

  // naive wrapping by width using avg char width (good enough for paragraphs)
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
    if (t) wrapped.push(t);
    if (raw.trim() === "") wrapped.push("");
  }

  const out = wrapped.length > maxLines
    ? wrapped.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, "…") : s))
    : wrapped;

  const pageH   = page.getHeight();
  const yTop    = pageH - y;
  const widthOf = (s) => font.widthOfTextAtSize(s, size);
  const spaceW  = widthOf(" ");
  const lineH   = size + lineGap;

  let yCursor = yTop;
  let drawn = 0;

  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    const isLast = i === out.length - 1;

    if (align === "justify" && !isLast) {
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        const wordsW = words.reduce((s, w) => s + widthOf(w), 0);
        const gaps   = words.length - 1;
        const natural = wordsW + gaps * spaceW;
        const extra   = Math.max(0, w - natural);
        const gapAdd  = extra / gaps;

        let xCursor = x;
        for (let wi = 0; wi < words.length; wi++) {
          const word = words[wi];
          page.drawText(word, { x: xCursor, y: yCursor, size, font, color });
          const advance = font.widthOfTextAtSize(word, size) + (wi < gaps ? (spaceW + gapAdd) : 0);
          xCursor += advance;
        }
        yCursor -= lineH;
        drawn++;
        continue;
      }
    }

    let xDraw = x;
    if (align === "center") xDraw = x + (w - widthOf(line)) / 2;
    else if (align === "right")  xDraw = x + (w - widthOf(line));
    page.drawText(line, { x: xDraw, y: yCursor, size, font, color });
    yCursor -= lineH;
    drawn++;
  }
  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

function drawBulleted(page, font, items, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
    indent = 18, gap = 4, bulletRadius = 1.8,
  } = spec;

  let curY = y; // distance from TOP
  const pageH = page.getHeight();
  const blockGap = N(opts.blockGap, 6);

  const strip = (s) =>
    norm(s || "")
      .replace(/^[\s•\-\u2022]*\b(Tips?|Actions?)\s*:\s*/i, "")
      .trim();

  for (const raw of ensureArray(items)) {
    const text = strip(raw);
    if (!text) continue;

    // bullet position
    const baseline = pageH - curY;
    const cy = baseline + (size * 0.33);
    if (page.drawCircle) {
      page.drawCircle({ x: x + bulletRadius, y: cy, size: bulletRadius, color });
    } else {
      page.drawRectangle({ x, y: cy - bulletRadius, width: bulletRadius * 2, height: bulletRadius * 2, color });
    }

    const r = drawTextBox(
      page,
      font,
      text,
      { x: x + indent + gap, y: curY, w: w - indent - gap, size, lineGap, color, align },
      opts
    );
    curY += r.height + blockGap;
  }
  return { height: curY - y };
}

/* --------------------------- template fetch --------------------------- */
async function fetchTemplate(req, url) {
  // Prefer absolute ?tpl=; otherwise default to the public slim template on current host
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

/* ----------------------------- handler ----------------------------- */
export default async function handler(req, res) {
  let url;
  try { url = new URL(req?.url || "/", "http://localhost"); }
  catch { url = new URL("/", "http://localhost"); }

  const preview = url.searchParams.get("preview") === "1";
  const dataB64 = url.searchParams.get("data");
  if (!dataB64) { res.statusCode = 400; res.end("Missing ?data"); return; }

  let data;
  try {
    const raw = Buffer.from(String(dataB64), "base64").toString("utf8");
    data = JSON.parse(raw);
  } catch (e) {
    res.statusCode = 400; res.end("Invalid ?data: " + (e?.message || e)); return;
  }

  try {
    // Normalise short keys from legacy (non-destructive)
    const normData = normaliseInput(data);

    // Fetch template & prepare fonts
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Page handles (0-based indices for 9 pages)
    const p1 = pdf.getPage(0);
    const p2 = pdf.getPage(1);
    const p3 = pdf.getPage(2);
    const p4 = pdf.getPage(3);
    const p5 = pdf.getPage(4);
    const p6 = pdf.getPage(5);
    const p7 = pdf.getPage(6);
    const p8 = pdf.getPage(7);
    const p9 = pdf.getPage(8);

    // Layout (payload may provide layoutV6 overrides)
    const L = buildLayout(normData.layoutV6);

    // Footer helper for pages 2..9
    const drawFooter = (page, idx) => {
      drawTextBox(page, Helv, normData.f, { ...L.footer[`f${idx}`], color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
      drawTextBox(page, Helv, normData.n, { ...L.footer[`n${idx}`], color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    };

    /* ---------------------------- PAGE 1 ---------------------------- */
    drawTextBox(p1, HelvB, normData.f, { ...L.p1.path, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p1, HelvB, normData.n, { ...L.p1.name, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p1, Helv,  normData.d, { ...L.p1.date, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    /* ---------------------------- PAGE 2 ---------------------------- */
    drawFooter(p2, 2);

    /* ---------------------------- PAGE 3 ---------------------------- */
    drawFooter(p3, 3);
    // headings are path/name in the footer; draw dominant header + char + desc
    const domHdr = normData.dom ? `Your current state is: ${normData.dom}` : "";
    if (domHdr) drawTextBox(p3, HelvB, domHdr,  { ...L.p3.domHdr,  color: rgb(0.15,0.14,0.22) }, { maxLines: 1, ellipsis: true });
    if (normData.domchar)
      drawTextBox(p3, Helv,  `Representing the character: ${normData.domchar}`, { ...L.p3.domChar, color: rgb(0.15,0.14,0.22) }, { maxLines: 1, ellipsis: true });
    drawTextBox(p3, Helv, normData.domdesc, { ...L.p3.domDesc, color: rgb(0.15,0.14,0.22) }, { maxLines: 16, ellipsis: true });

    /* ---------------------------- PAGE 4 ---------------------------- */
    drawFooter(p4, 4);
    // spider paragraph
    drawTextBox(p4, Helv, normData.spiderdesc, { ...L.p4.spider, color: rgb(0.15,0.14,0.22) }, { maxLines: 18, ellipsis: true });
    // spider chart image
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
      } catch { /* ignore image failure */ }
    }

    /* ---------------------------- PAGE 5 ---------------------------- */
    drawFooter(p5, 5);
    drawTextBox(p5, Helv, normData.seqpat, { ...L.p5.seqpat, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });

    /* ---------------------------- PAGE 6 ---------------------------- */
    drawFooter(p6, 6);
    drawTextBox(p6, Helv, normData.theme, { ...L.p6.theme, color: rgb(0.15,0.14,0.22) }, { maxLines: 24, ellipsis: true });

    /* ---------------------------- PAGE 7 ---------------------------- */
    drawFooter(p7, 7);

    // Section headers
    drawTextBox(p7, HelvB, "What to look out for / How to work with colleagues", { ...L.p7.hCol, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
    drawTextBox(p7, HelvB, "What to look out for / How to work with a leader",  { ...L.p7.hLdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });

    const order = ["C","T","R","L"];
    const makeTxt = (e) => {
      const look = norm(e?.look || "");
      const work = norm(e?.work || "");
      return (look || work) ? `What to look out for:\n${look}\n\nHow to work with them:\n${work}` : "";
    };

    // Colleagues 2×2
    order.forEach((k, i) => {
      const e = (normData.workwcol || []).find(v => v?.their === k);
      const box = L.p7.colBoxes[i] || L.p7.colBoxes[0];
      const txt = makeTxt(e);
      if (txt) drawTextBox(p7, Helv, txt, { x: box.x, y: box.y, w: box.w, size: L.p7.bodySize, align: "left", color: rgb(0.15,0.14,0.22) }, { maxLines: L.p7.maxLines, ellipsis: true });
    });

    // Leaders 2×2
    order.forEach((k, i) => {
      const e = (normData.workwlead || []).find(v => v?.their === k);
      const box = L.p7.ldrBoxes[i] || L.p7.ldrBoxes[0];
      const txt = makeTxt(e);
      if (txt) drawTextBox(p7, Helv, txt, { x: box.x, y: box.y, w: box.w, size: L.p7.bodySize, align: "left", color: rgb(0.15,0.14,0.22) }, { maxLines: L.p7.maxLines, ellipsis: true });
    });

    /* ---------------------------- PAGE 8 ---------------------------- */
    drawFooter(p8, 8);

    const tips    = ensureArray(normData.tips);
    const actions = ensureArray(normData.actions);

    drawTextBox(p8, HelvB, "Tips",    { ...L.p8.tipsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
    drawTextBox(p8, HelvB, "Actions", { ...L.p8.actsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });

    drawBulleted(p8, Helv, tips,    { ...L.p8.tipsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 }, { maxLines: 26, blockGap: 6 });
    drawBulleted(p8, Helv, actions, { ...L.p8.actsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 }, { maxLines: 26, blockGap: 6 });

    /* ---------------------------- PAGE 9 ---------------------------- */
    drawFooter(p9, 9);

    /* ---------------------------- SAVE ---------------------------- */
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

/* ----------------------- normalisation & layout ----------------------- */
function normaliseInput(data) {
  const d = { ...(data || {}) };

  // Short keys first
  d.f = d.f || d.flow || "Perspective";
  d.n = d.n || (d.person && (d.person.preferredName || d.person.fullName)) || "";
  d.d = d.d || d.dateLbl || todayLbl();

  d.dom     = d.dom     || d.dom6Label || "";
  d.domchar = d.domchar || d.character || "";
  d.domdesc = d.domdesc || d.dominantDesc || "";

  d.spiderfreq = d.spiderfreq || d.chartUrl || "";
  d.spiderdesc = d.spiderdesc || d.how6 || "";

  if (!d.seqpat || !d.theme) {
    const b = Array.isArray(d.page7Blocks) ? d.page7Blocks : [];
    d.seqpat = d.seqpat || (b[0] && b[0].body) || "";
    d.theme  = d.theme  || (b[1] && b[1].body) || "";
  }

  d.workwcol  = Array.isArray(d.workwcol)  ? d.workwcol  : (d.workWith && d.workWith.colleagues) || [];
  d.workwlead = Array.isArray(d.workwlead) ? d.workwlead : (d.workWith && d.workWith.leaders)    || [];

  d.tips    = ensureArray(d.tips && d.tips.length ? d.tips : (d.tips2 || []));
  d.actions = ensureArray(d.actions && d.actions.length ? d.actions : (d.actions2 || []));

  // Normalise f to pretty path label
  d.f = normPathLabel(d.f);

  return d;
}

function buildLayout(layoutV6) {
  // Defaults (top-left origin; 1-based pages noted in comments, but we pass to actual pages)
  const L = {
    meta: { units: "pt", origin: "TL", pages: "1-based" },

    // PAGE 1
    p1: {
      path: { x: 290, y: 170, w: 400, size: 40, align: "left"  },
      name: { x:  10, y: 573, w: 500, size: 30, align: "center"},
      date: { x: 130, y: 630, w: 500, size: 20, align: "left"  }
    },

    // Footer for pages 2..9
    footer: {
      f2: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n2: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      f3: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n3: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      f4: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n4: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      f5: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n5: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      f6: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n6: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      f7: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n7: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      f8: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n8: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      f9: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n9: { x: 250, y: 64, w: 400, size: 12, align: "center" }
    },

    // PAGE 3 (dominant)
    p3: {
      domHdr:  { x:  60, y: 150, w: 650, size: 13, align: "left"  },
      domChar: { x:  60, y: 180, w: 650, size: 11, align: "left"  },
      domDesc: { x:  60, y: 210, w: 650, size: 11, align: "left"  }
    },

    // PAGE 4 (spider)
    p4: {
      spider: { x:  60, y: 320, w: 280, size: 11, align: "left" },
      chart:  { x: 360, y: 320, w: 260, h: 260 }
    },

    // PAGE 5 (sequence)
    p5: { seqpat: { x:  60, y: 160, w: 650, size: 11, align: "left" } },

    // PAGE 6 (theme)
    p6: { theme:  { x:  60, y: 160, w: 650, size: 11, align: "left" } },

    // PAGE 7 (work with colleagues/leaders)
    p7: {
      hCol: { x: 60, y: 110, w: 650, size: 12, align: "left" },
      hLdr: { x: 60, y: 360, w: 650, size: 12, align: "left" },
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

    // PAGE 8 (tips + actions)
    p8: {
      tipsHdr: { x:  60, y: 120, w: 320, size: 12, align: "left" },
      actsHdr: { x: 390, y: 120, w: 320, size: 12, align: "left" },
      tipsBox: { x:  60, y: 150, w: 320, size: 11, align: "left" },
      actsBox: { x: 390, y: 150, w: 320, size: 11, align: "left" }
    }
  };

  // If payload provided layoutV6 overrides, merge the relevant parts
  if (layoutV6 && typeof layoutV6 === "object") {
    try {
      // p3/p4/p5/p6/p7/p8 overrides if present (we only override fields that exist)
      ["p3","p4","p5","p6","p7","p8","footer","p1"].forEach(key => {
        if (layoutV6[key]) L[key] = deepMerge(L[key], layoutV6[key]);
      });
    } catch { /* ignore bad overrides */ }
  }
  return L;
}

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

function safeFileName(url, fullName) {
  const who = S(fullName || "report").replace(/[^A-Za-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"");
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const d = new Date();
  const name = `CTRL_${who}_${String(d.getDate()).padStart(2,"0")}${MMM[d.getMonth()]}${d.getFullYear()}.pdf`;
  const qName = url.searchParams.get("name");
  return qName ? String(qName) : name;
}
