export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ------------------------- tiny helpers ------------------------- */

const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (v, fb = "") =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ""); // strip odd control chars

const alignNorm = (a) => {
  const v = String(a || "").toLowerCase();
  if (v === "centre") return "center";
  return ["left", "right", "center", "justify"].includes(v) ? v : "left";
};

/** Word-wrap by pixel width; returns array of lines (each = array of words). */
function wrapWordsToWidth(text, font, size, maxWidth) {
  const baseSpaceW = font.widthOfTextAtSize(" ", size);
  const out = [];
  const paras = norm(text).split("\n");
  for (const para of paras) {
    const words = para.trim().length ? para.trim().split(/\s+/) : [""];
    let line = [];
    let lineW = 0;
    for (const w of words) {
      const ww = font.widthOfTextAtSize(w, size);
      const addW = line.length ? baseSpaceW + ww : ww;
      if (line.length && lineW + addW > maxWidth) {
        out.push(line);
        line = [w];
        lineW = ww;
      } else {
        line.push(w);
        lineW += addW;
      }
    }
    out.push(line);
  }
  return out;
}

// Draw/align/justify text into a box (y = distance from TOP)
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const clean = norm(text);
  if (!clean) return { height: 0, linesDrawn: 0, lastY: page.getHeight() - y };

  const pageH = page.getHeight();
  const yTop = pageH - y;
  const lineH = size + lineGap;

  const wrappedWordLines = wrapWordsToWidth(clean, font, size, w);

  let lines = wrappedWordLines;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    if (ellipsis && lines.length) {
      const last = lines[lines.length - 1];
      const ell = "…";
      while (last.length && font.widthOfTextAtSize(last.join(" ") + ell, size) > w) last.pop();
      if (last.length) last.push(ell);
    }
  }

  let yCursor = yTop;
  let drawn = 0;

  for (let i = 0; i < lines.length; i++) {
    const words = lines[i];
    const isLastLine = i === lines.length - 1;
    const joined = words.join(" ");
    const textW = font.widthOfTextAtSize(joined, size);

    if (align === "center") {
      const xDraw = x + (w - textW) / 2;
      page.drawText(joined, { x: xDraw, y: yCursor, size, font, color });
    } else if (align === "right") {
      const xDraw = x + (w - textW);
      page.drawText(joined, { x: xDraw, y: yCursor, size, font, color });
    } else if (align === "justify" && !isLastLine && words.length > 1) {
      const wordsW = words.reduce((acc, wd) => acc + font.widthOfTextAtSize(wd, size), 0);
      const gaps = words.length - 1;
      const extra = Math.max(0, w - wordsW);
      const gapW = extra / gaps;
      let xPos = x;
      for (let g = 0; g < words.length; g++) {
        const wd = words[g];
        page.drawText(wd, { x: xPos, y: yCursor, size, font, color });
        const wdw = font.widthOfTextAtSize(wd, size);
        if (g < words.length - 1) xPos += wdw + gapW;
      }
    } else {
      page.drawText(joined, { x, y: yCursor, size, font, color });
    }

    yCursor -= lineH;
    drawn++;
  }

  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

async function fetchTemplate(req, url) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, "ctrl-export-service.vercel.app");
  const proto = S(h["x-forwarded-proto"], "https");
  const tplParam = url?.searchParams?.get("tpl");
  const filename = tplParam && tplParam.trim()
    ? tplParam.trim()
    : "CTRL_Perspective_Assessment_Profile_templateV6.pdf";
  const full = `${proto}://${host}/${filename}`;
  const r = await fetch(full);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// URL tuners
const qnum = (url, key, fb) => {
  const s = url.searchParams.get(key);
  if (s == null || s === "") return fb;
  const n = Number(s);
  return Number.isFinite(n) ? n : fb;
};
const qstr = (url, key, fb) => {
  const v = url.searchParams.get(key);
  return v == null || v === "" ? fb : v;
};

// Robust cover/name
const pickCoverName = (data, url) => norm(
  data?.person?.coverName ??
  data?.person?.fullName ??
  data?.fullName ??
  url?.searchParams?.get("cover") ??
  ""
);

// Flow/Path label normaliser
const normPathLabel = (raw) => {
  const v = (raw || "").toString().toLowerCase();
  const map = { perspective:"Perspective", observe:"Observe", reflective:"Reflective", mirrored:"Mirrored", mirror:"Mirrored" };
  return map[v] || "Perspective";
};

// Simple DD/MMM/YYYY (today) for fallback
const todayLbl = () => {
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${MMM[d.getMonth()]}/${d.getFullYear()}`;
};

// Default filename
const defaultFileName = (fullName) => {
  const who = S(fullName || "report").replace(/[^A-Za-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"");
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const d = new Date();
  return `CTRL_${who}_${String(d.getDate()).padStart(2,"0")}${MMM[d.getMonth()]}${d.getFullYear()}.pdf`;
};

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  let url;
  try { url = new URL(req?.url || "/", "http://localhost"); }
  catch { url = new URL("/", "http://localhost"); }

  const preview = url.searchParams.get("preview") === "1";

  const hasData = !!url.searchParams.get("data");
  if (!hasData) { res.statusCode = 400; res.end("Missing ?data"); return; }

  let data;
  try {
    const raw = Buffer.from(String(url.searchParams.get("data") || ""), "base64").toString("utf8");
    data = JSON.parse(raw);
  } catch (e) {
    res.statusCode = 400; res.end("Invalid ?data: " + (e?.message || e)); return;
  }

  try {
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Pages (0-index)
    const page1 = pdf.getPage(0);
    const page6 = pdf.getPage(5);
    const page7 = pdf.getPage(6);

    /* --------------------- DEFAULT (LOCKED) POSITIONS --------------------- */
    const POS = {
      f1: { x: 290, y: 170, w: 400, size: 40, align: "left" },
      n1: { x: 10,  y: 573, w: 500, size: 30, align: "center" },
      d1: { x: 130, y: 630, w: 500, size: 20, align: "left" },
      footer: {
        f2: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n2: { x: 250, y: 64, w: 400, size: 12, align: "center" },
        f3: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n3: { x: 250, y: 64, w: 400, size: 12, align: "center" },
        f4: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n4: { x: 250, y: 64, w: 400, size: 12, align: "center" },
        f5: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n5: { x: 250, y: 64, w: 400, size: 12, align: "center" },
        f6: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n6: { x: 250, y: 64, w: 400, size: 12, align: "center" },
        f7: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n7: { x: 250, y: 64, w: 400, size: 12, align: "center" },
        f8: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n8: { x: 250, y: 64, w: 400, size: 12, align: "center" },
        // Page 9 footer defaults (same as page 6)
        f9: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n9: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      },
      // Page 6 — Dominant + explanations + chart
      dom6:     { x: 55,  y: 280, w: 900, size: 33, align: "left" },
      // LOCKED Dominant Description (ignore URL); requested values:
      dom6desc: { x: 23,  y: 380, w: 215, size: 12, align: "justify", max: 12 },
      how6:     { x: 40,  y: 560, w: 500, size: 20, align: "left", max: 10 },
      chart6:   { x: 203, y: 230, w: 420, h: 220 },
      // Page 7 — analysis blocks + theme + tips + actions
      p7Patterns:  { x: 40,  y: 180, w: 460, hSize: 14, bSize: 20, align:"left", titleGap: 8, blockGap: 25, maxBodyLines: 6 },
      p7ThemePara: { x: 40,  y: 380, w: 460, size: 20, align:"left", maxLines: 10 },
      p7Tips:      { x: 40,  y: 595, w: 630, size: 20, align:"left", maxLines: 8 },
      p7Acts:      { x: 40,  y: 695, w: 630, size: 20, align:"left", maxLines: 8 },
    };

    // Tuners...
    const tuneBox = (spec, pfx) => ({
      x: qnum(url,`${pfx}x`,spec.x), y: qnum(url,`${pfx}y`,spec.y),
      w: qnum(url,`${pfx}w`,spec.w), size: qnum(url,`${pfx}s`,spec.size),
      align: alignNorm(qstr(url,`${pfx}align`,spec.align))
    });

    POS.f1 = tuneBox(POS.f1, "f1");
    POS.n1 = tuneBox(POS.n1, "n1");
    POS.d1 = tuneBox(POS.d1, "d1");

    // Footer tuners, including page 9
    for (let i=2;i<=9;i++){
      const f=`f${i}`, n=`n${i}`;
      POS.footer[f] = tuneBox(POS.footer[f], f);
      POS.footer[n] = tuneBox(POS.footer[n], n);
    }

    // Page 6 tuners (dom6desc is LOCKED — no tuner here)
    POS.dom6     = tuneBox(POS.dom6, "dom6");
    POS.how6     = tuneBox(POS.how6,"how6");
    POS.how6.max = qnum(url,"how6max",POS.how6.max);
    POS.chart6 = {
      x: qnum(url,"c6x",POS.chart6.x), y: qnum(url,"c6y",POS.chart6.y),
      w: qnum(url,"c6w",POS.chart6.w), h: qnum(url,"c6h",POS.chart6.h)
    };

    // Page 7 tuners
    POS.p7Patterns = {
      ...POS.p7Patterns,
      x: qnum(url,"p7px",POS.p7Patterns.x), y: qnum(url,"p7py",POS.p7Patterns.y),
      w: qnum(url,"p7pw",POS.p7Patterns.w),
      hSize: qnum(url,"p7phsize",POS.p7Patterns.hSize),
      bSize: qnum(url,"p7pbsize",POS.p7Patterns.bSize),
      align: alignNorm(qstr(url,"p7palign",POS.p7Patterns.align)),
      titleGap: qnum(url,"p7ptitlegap",POS.p7Patterns.titleGap),
      blockGap: qnum(url,"p7pblockgap",POS.p7Patterns.blockGap),
      maxBodyLines: qnum(url,"p7pmax",POS.p7Patterns.maxBodyLines),
    };
    POS.p7ThemePara = {
      ...POS.p7ThemePara,
      x: qnum(url,"p7tx",POS.p7ThemePara.x), y: qnum(url,"p7ty",POS.p7ThemePara.y),
      w: qnum(url,"p7tw",POS.p7ThemePara.w), size: qnum(url,"p7ts",POS.p7ThemePara.size),
      align: alignNorm(qstr(url,"p7talign",POS.p7ThemePara.align)),
    };
    POS.p7ThemePara.maxLines = qnum(url,"p7tmax",POS.p7ThemePara.maxLines);
    POS.p7Tips = {
      ...POS.p7Tips,
      x: qnum(url,"p7tipsx",POS.p7Tips.x), y: qnum(url,"p7tipsy",POS.p7Tips.y),
      w: qnum(url,"p7tipsw",POS.p7Tips.w), size: qnum(url,"p7tipss",POS.p7Tips.size),
      align: alignNorm(qstr(url,"p7tipsalign",POS.p7Tips.align)),
    };
    POS.p7Tips.maxLines = qnum(url,"p7tipsmax",POS.p7Tips.maxLines);
    POS.p7Acts = {
      ...POS.p7Acts,
      x: qnum(url,"p7actsx",POS.p7Acts.x), y: qnum(url,"p7actsy",POS.p7Acts.y),
      w: qnum(url,"p7actsw",POS.p7Acts.w), size: qnum(url,"p7actss",POS.p7Acts.size),
      align: alignNorm(qstr(url,"p7actsalign",POS.p7Acts.align)),
    };
    POS.p7Acts.maxLines = qnum(url,"p7actsmax",POS.p7Acts.maxLines);

    /* -------------------- PAGE 1: Path / Name / Date -------------------- */
    const coverName = pickCoverName(data, url);
    const fullName  = norm(data?.person?.fullName || coverName || "");
    const flowRaw   = (typeof data?.flow === "string" && data.flow) || qstr(url, "flow", "Perspective");
    const pathName  = norm(normPathLabel(flowRaw));
    const dateLbl   = norm(data?.dateLbl || todayLbl());

    drawTextBox(page1, HelvB, pathName, { ...POS.f1, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, HelvB, fullName, { ...POS.n1, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, Helv,  dateLbl,  { ...POS.d1, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    /* -------------------- FOOTERS: pages 2..9 --------------------------- */
    const drawFooter = (page, fSpec, nSpec) => {
      drawTextBox(page, Helv, pathName, { ...fSpec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
      drawTextBox(page, Helv, fullName, { ...nSpec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    };

    const pageCount = pdf.getPageCount();
    const p2 = pageCount >= 2 ? pdf.getPage(1) : null;
    const p3 = pageCount >= 3 ? pdf.getPage(2) : null;
    const p4 = pageCount >= 4 ? pdf.getPage(3) : null;
    const p5 = pageCount >= 5 ? pdf.getPage(4) : null;
    const p8 = pageCount >= 8 ? pdf.getPage(7) : null;
    const p9 = pageCount >= 9 ? pdf.getPage(8) : null;

    if (p2) drawFooter(p2, POS.footer.f2, POS.footer.n2);
    if (p3) drawFooter(p3, POS.footer.f3, POS.footer.n3);
    if (p4) drawFooter(p4, POS.footer.f4, POS.footer.n4);
    if (p5) drawFooter(p5, POS.footer.f5, POS.footer.n5);
    if (page6) drawFooter(page6, POS.footer.f6, POS.footer.n6);
    if (page7) drawFooter(page7, POS.footer.f7, POS.footer.n7);
    if (p8) drawFooter(p8, POS.footer.f8, POS.footer.n8);
    if (p9) drawFooter(p9, POS.footer.f9, POS.footer.n9);

    /* -------------------------- PAGE 6 ---------------------------------- */
    const domLabel = norm(data?.dom6Label || data?.dom6 || "");
    const domDesc  = norm(data?.dominantDesc || data?.dom6Desc || "");
    const how6Text = norm(data?.how6 || data?.how6Text || data?.chartParagraph || "");

    if (domLabel) drawTextBox(page6, HelvB, domLabel, { ...POS.dom6, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    if (domDesc)  drawTextBox(page6, Helv,  domDesc,  { x: POS.dom6desc.x, y: POS.dom6desc.y, w: POS.dom6desc.w, size: POS.dom6desc.size, align: POS.dom6desc.align, color: rgb(0.24,0.23,0.35) }, { maxLines: POS.dom6desc.max, ellipsis: true });
    if (how6Text) drawTextBox(page6, Helv,  how6Text, { ...POS.how6,     color: rgb(0.24,0.23,0.35) }, { maxLines: POS.how6.max, ellipsis: true });

    // Chart: accept chartUrl OR spiderChartUrl
    const chartURL = S(data?.chartUrl || data?.spiderChartUrl || "", "");
    if (chartURL) {
      try {
        const r = await fetch(chartURL);
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart6;
          const ph = page6.getHeight();
          page6.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore image failure */ }
    }

    /* -------------------------- PAGE 7 ---------------------------------- */
    const blocksSrc = Array.isArray(data?.page7Blocks) ? data.page7Blocks
                    : Array.isArray(data?.p7Blocks)     ? data.p7Blocks
                    : [];
    const blocks = blocksSrc
      .map(b => ({ title: norm(b?.title||""), body: norm(b?.body||"") }))
      .filter(b => b.title || b.body)
      .slice(0, 3);

    let curY = POS.p7Patterns.y;
    for (const b of blocks) {
      if (b.title) {
        drawTextBox(page7, HelvB, b.title,
          { x: POS.p7Patterns.x, y: curY, w: POS.p7Patterns.w, size: POS.p7Patterns.hSize, align: POS.p7Patterns.align, color: rgb(0.24,0.23,0.35) },
          { maxLines: 1, ellipsis: true }
        );
        curY += (POS.p7Patterns.hSize + 3) + POS.p7Patterns.titleGap;
      }
      if (b.body) {
        const r = drawTextBox(page7, Helv, b.body,
          { x: POS.p7Patterns.x, y: curY, w: POS.p7Patterns.w, size: POS.p7Patterns.bSize, align: POS.p7Patterns.align, color: rgb(0.24,0.23,0.35) },
          { maxLines: POS.p7Patterns.maxBodyLines, ellipsis: true }
        );
        curY += r.height + POS.p7Patterns.blockGap;
      }
    }

    const themeNarr7 = norm(
      (typeof data?.p7ThemeNarr === "string" && data.p7ThemeNarr) ||
      (typeof data?.themePairParagraph === "string" && data.themePairParagraph) || ""
    );
    if (themeNarr7) {
      drawTextBox(page7, Helv, themeNarr7,
        { ...POS.p7ThemePara, color: rgb(0.24,0.23,0.35) },
        { maxLines: POS.p7ThemePara.maxLines, ellipsis: true }
      );
    }

    const tipsArr = Array.isArray(data?.tips2) ? data.tips2 : [];
    const tips2 = tipsArr.length ? tipsArr.map(t => `• ${norm(t)}`).join("\n") : "";
    if (tips2) {
      drawTextBox(page7, Helv, tips2,
        { ...POS.p7Tips, color: rgb(0.24,0.23,0.35) },
        { maxLines: POS.p7Tips.maxLines, ellipsis: true }
      );
    }

    const actsArr = Array.isArray(data?.actions2) ? data.actions2 : [];
    const acts2 = actsArr.length ? actsArr.map(t => `• ${norm(t)}`).join("\n") : "";
    if (acts2) {
      drawTextBox(page7, Helv, acts2,
        { ...POS.p7Acts, color: rgb(0.24,0.23,0.35) },
        { maxLines: POS.p7Acts.maxLines, ellipsis: true }
      );
    }

    /* ------------------------------ SAVE ------------------------------ */
    const bytes = await pdf.save();
    const fname = qstr(url, "name", defaultFileName(fullName));

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${preview ? "inline" : "attachment"}; filename="${fname}"`
    );
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("fill-template error: " + (e?.message || e));
  }
}
