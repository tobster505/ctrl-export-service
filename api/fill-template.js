// /api/fill-template.js
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
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

// allow left | center | right | justify
const alignNorm = (a) => {
  const v = String(a || "").toLowerCase();
  if (v === "centre") return "center";
  if (["left", "right", "center", "justify"].includes(v)) return v;
  return "left";
};

// remove headings/labels from p7 pattern bodies so paragraph starts correctly
const dropLeadingLabel = (t) => {
  const s = norm(t || "");
  if (!s) return s;
  if (/^\s*(It looks like|You )/i.test(s)) return s;
  const lines = s.split(/\n+/);
  if (!lines.length) return s;

  const first = lines[0];
  const looksLikeLabel =
    /general\s+analysis/i.test(first) ||
    /Explorer|Balancer|Presence|Guide|Retreater|Light|Voice|Seeker|Beacon|Waters|Returner|Unsettled/i.test(first) ||
    /\(.*\)/.test(first);

  if (looksLikeLabel && lines.length > 1) {
    return lines.slice(1).join("\n").trim();
  }
  return s;
};

// Remove "Tip:" / "Action:" / leading bullets if they sneak in
const stripBulletLabel = (s) =>
  norm(s || "")
    .replace(/^[\s•\-\u2022]*\b(Tips?|Actions?)\s*:\s*/i, "")
    .trim();

/* ----------------------- text & bullet rendering ----------------------- */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const clean = norm(text);
  if (!clean) return { height: 0, linesDrawn: 0, lastY: page.getHeight() - y };

  // simple wrapping by approx char width
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
          const advance = widthOf(word) + (wi < gaps ? (spaceW + gapAdd) : 0);
          xCursor += advance;
        }
        yCursor -= lineH;
        drawn++;
        continue;
      }
    }

    let xDraw = x;
    if (align === "center") xDraw = x + (w - widthOf(line)) / 2;
    else if (align === "right") xDraw = x + (w - widthOf(line));
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

  for (const raw of items) {
    const text = stripBulletLabel(raw);
    if (!text) continue;

    // bullet position
    const firstLineBaseline = pageH - curY;
    const cy = firstLineBaseline + (size * 0.33);
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
  const h = (req && req.headers) || {};
  const host  = S(h.host, "ctrl-export-service.vercel.app");
  const proto = S(h["x-forwarded-proto"], "https");
  const tplParam = url?.searchParams?.get("tpl");
  const filename = tplParam && tplParam.trim()
    ? tplParam.trim()
    : "CTRL_Perspective_Assessment_Profile_template_v7.pdf";
  const full = `${proto}://${host}/${filename}`;
  const r = await fetch(full);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

/* ----------------------------- URL tuners ---------------------------- */
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

/* ------------------------- name/path helpers ------------------------- */
const pickCoverName = (data, url) => norm(
  data?.person?.coverName ??
  data?.person?.fullName ??
  data?.fullName ??
  url?.searchParams?.get("cover") ??
  ""
);

const normPathLabel = (raw) => {
  const v = (raw || "").toString().toLowerCase();
  const map = { perspective:"Perspective", observe:"Observe", reflective:"Reflective", mirrored:"Mirrored", mirror:"Mirrored" };
  return map[v] || "Perspective";
};

const todayLbl = () => {
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${MMM[d.getMonth()]}/${d.getFullYear()}`;
};

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
    const pageCount = pdf.getPageCount();

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
        f9: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n9: { x: 250, y: 64, w: 400, size: 12, align: "center" },
      },

      // ---------- PAGE 6 (LOCKED TO YOUR SPEC) ----------
      dom6:     { x: 55,  y: 280, w: 900, size: 33, align: "left" },
      dom6desc: { x: 25,  y: 360, w: 265, size: 15, align: "left", max: 8 },
      how6:     { x: 30,  y: 600, w: 660, size: 17, align: "left", max: 12 },
      chart6:   { x: 213, y: 250, w: 410, h: 230 },

      // ---------- PAGE 7 (LOCKED BASELINES) ----------
      // pattern/theme bodies
      p7Patterns:  { x: 30,  y: 175, w: 660, hSize: 7,  bSize: 16, align:"left", titleGap: 10, blockGap: 20, maxBodyLines: 20 },
      // (theme paragraph coords kept for future but not drawn)
      p7ThemePara: { x: 140, y: 380, w: 650, size: 7,  align:"justify", maxLines: 10 },

      // tips / actions (your stored defaults)
      p7Tips: { x: 30,  y: 530, w: 300, size: 17, align: "left", maxLines: 12 },
      p7Acts: { x: 320, y: 530, w: 300, size: 17, align: "left", maxLines: 12 },
    };

    // Tuners (URL can still override if needed)
    const tuneBox = (spec, pfx) => ({
      x: qnum(url,`${pfx}x`,spec.x), y: qnum(url,`${pfx}y`,spec.y),
      w: qnum(url,`${pfx}w`,spec.w), size: qnum(url,`${pfx}s`,spec.size),
      align: alignNorm(qstr(url,`${pfx}align`,spec.align))
    });

    POS.f1 = tuneBox(POS.f1, "f1");
    POS.n1 = tuneBox(POS.n1, "n1");
    POS.d1 = tuneBox(POS.d1, "d1");

    for (let i=2;i<=9;i++){
      const f=`f${i}`, n=`n${i}`;
      POS.footer[f] = tuneBox(POS.footer[f], f);
      POS.footer[n] = tuneBox(POS.footer[n], n);
    }

    // Page 6 tunables
    POS.dom6     = tuneBox(POS.dom6, "dom6");
    POS.dom6desc = tuneBox(POS.dom6desc, "dom6desc");
    POS.dom6desc.max = qnum(url,"dom6descmax",POS.dom6desc.max);
    POS.how6     = tuneBox(POS.how6,"how6");
    POS.how6.max = qnum(url,"how6max",POS.how6.max);
    POS.chart6 = {
      x: qnum(url,"c6x",POS.chart6.x), y: qnum(url,"c6y",POS.chart6.y),
      w: qnum(url,"c6w",POS.chart6.w), h: qnum(url,"c6h",POS.chart6.h)
    };

    // Page 7 tunables
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

    // bullet visuals + columns (your stored defaults)
    const bulletIndent = qnum(url, "bulleti", 14);
    const bulletGap    = qnum(url, "bulletgap", 2);
    const taCols       = Math.max(1, Math.min(2, qnum(url, "taCols", 1)));

    /* -------------------- PAGE 1: Path / Name / Date -------------------- */
    const coverName = pickCoverName(data, url);
    const fullName  = norm(data?.person?.fullName || coverName || "");
    const flowRaw   = (typeof data?.flow === "string" && data.flow) || qstr(url, "flow", "Perspective");
    const pathName  = norm(normPathLabel(flowRaw));
    const dateLbl   = norm(data?.dateLbl || todayLbl());

    const drawFooter = (page, fSpec, nSpec) => {
      drawTextBox(page, Helv, pathName, { ...fSpec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
      drawTextBox(page, Helv, fullName, { ...nSpec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    };

    drawTextBox(page1, HelvB, pathName, { ...POS.f1, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, HelvB, fullName, { ...POS.n1, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, Helv,  dateLbl,  { ...POS.d1, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    // footers pages 2..9 (if exist)
    const p2 = pdf.getPage(1), p3 = pdf.getPage(2), p4 = pdf.getPage(3), p5 = pdf.getPage(4);
    drawFooter(p2, POS.footer.f2, POS.footer.n2);
    drawFooter(p3, POS.footer.f3, POS.footer.n3);
    drawFooter(p4, POS.footer.f4, POS.footer.n4);
    drawFooter(p5, POS.footer.f5, POS.footer.n5);
    drawFooter(page6, POS.footer.f6, POS.footer.n6);
    drawFooter(page7, POS.footer.f7, POS.footer.n7);
    if (pdf.getPageCount() >= 8) {
      const p8 = pdf.getPage(7); drawFooter(p8, POS.footer.f8, POS.footer.n8);
    }
    if (pageCount >= 9) {
      const p9 = pdf.getPage(8); drawFooter(p9, POS.footer.f9, POS.footer.n9);
    }

    /* -------------------------- PAGE 6 ---------------------------------- */
    const domLabel = norm(data?.dom6Label || data?.dom6 || "");
    const domDesc  = norm(data?.dominantDesc || data?.dom6Desc || "");
    const how6Text = norm(data?.how6 || data?.how6Text || data?.chartParagraph || "");

    if (domLabel) drawTextBox(page6, HelvB, domLabel, { ...POS.dom6, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    if (domDesc)  drawTextBox(page6, Helv,  domDesc,  { ...POS.dom6desc, color: rgb(0.24,0.23,0.35), align: POS.dom6desc.align }, { maxLines: POS.dom6desc.max, ellipsis: true });
    if (how6Text) drawTextBox(page6, Helv,  how6Text, { ...POS.how6,     color: rgb(0.24,0.23,0.35), align: POS.how6.align     }, { maxLines: POS.how6.max,   ellipsis: true });

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
    // Left column (pattern + theme bodies). Titles removed, bodies cleaned.
    const blocksSrc = Array.isArray(data?.page7Blocks) ? data.page7Blocks
                    : Array.isArray(data?.p7Blocks)     ? data.p7Blocks
                    : [];
    const blocks = blocksSrc
      .map(b => ({ title: norm(b?.title||""), body: dropLeadingLabel(b?.body||"") }))
      .filter(b => b.title || b.body)
      .slice(0, 3);

    let curY = POS.p7Patterns.y;
    for (const b of blocks) {
      if (b.body) {
        const r = drawTextBox(
          page7,
          Helv,
          b.body,
          { x: POS.p7Patterns.x, y: curY, w: POS.p7Patterns.w, size: POS.p7Patterns.bSize, align: POS.p7Patterns.align, color: rgb(0.24,0.23,0.35) },
          { maxLines: POS.p7Patterns.maxBodyLines, ellipsis: true }
        );
        curY += r.height + POS.p7Patterns.blockGap;
      }
    }

    // -------- Tips & Actions (bulleted) --------
    const uniqPush = (arr, s) => {
      const v = stripBulletLabel(s);
      if (!v) return;
      const key = v.toLowerCase().trim();
      if (!arr._seen) arr._seen = new Set();
      if (!arr._seen.has(key)) { arr._seen.add(key); arr.push(v); }
    };

    const tips = [];
    const tipCands = [
      data?.dominantTip,
      data?.spiderChartTip,
      data?.patternTip, data?.tipFromPattern,
      ...(Array.isArray(data?.tips2) ? data.tips2 : []),
      ...(Array.isArray(data?.tips) ? data.tips : []),
      ...(Array.isArray(data?.patternTips) ? data.patternTips : []),
      ...(Array.isArray(data?.dominantTips) ? data.dominantTips : []),
    ];
    for (const t of tipCands) {
      if (Array.isArray(t)) t.forEach(x => uniqPush(tips, x));
      else uniqPush(tips, t);
    }

    const actions = [];
    const patternActionCands = [
      data?.patternAction,
      data?.patternShapeAction,
      data?.actionFromPattern,
      data?.actionsFromPattern,
      data?.p7PatternAction,
      ...(Array.isArray(data?.patternActions) ? data.patternActions : []),
      data?.pattern?.action,
      data?.patternShape?.action,
    ];
    const actionCands = [
      ...(Array.isArray(data?.actions2) ? data.actions2 : []),
      ...(Array.isArray(data?.actions) ? data.actions : []),
      ...patternActionCands,
    ];
    for (const a of actionCands) {
      if (Array.isArray(a)) a.forEach(x => uniqPush(actions, x));
      else uniqPush(actions, a);
    }

    // bullet specs (use your stored defaults, still URL-overridable)
    const bulletSpecTips = { ...POS.p7Tips, indent: bulletIndent, gap: bulletGap, bulletRadius: 1.8, align: POS.p7Tips.align, color: rgb(0.24,0.23,0.35) };
    const bulletSpecActs = { ...POS.p7Acts, indent: bulletIndent, gap: bulletGap, bulletRadius: 1.8, align: POS.p7Acts.align, color: rgb(0.24,0.23,0.35) };

    if (taCols === 2) {
      // honor your explicit boxes for each column (no auto mid calc)
      drawBulleted(page7, Helv, tips,    bulletSpecTips, { maxLines: POS.p7Tips.maxLines,  blockGap: 6 });
      drawBulleted(page7, Helv, actions, bulletSpecActs, { maxLines: POS.p7Acts.maxLines,  blockGap: 6 });
    } else {
      // one column each, stacked (tips first, then actions) using your exact boxes
      drawBulleted(page7, Helv, tips,    bulletSpecTips, { maxLines: POS.p7Tips.maxLines,  blockGap: 6 });
      drawBulleted(page7, Helv, actions, bulletSpecActs, { maxLines: POS.p7Acts.maxLines,  blockGap: 6 });
    }

    /* ------------------------------ SAVE ------------------------------ */
    const bytes = await pdf.save();
    const coverName = pickCoverName(data, url);
    const fname = qstr(url, "name", defaultFileName(coverName || data?.person?.fullName));

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
