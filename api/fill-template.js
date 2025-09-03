export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────── helpers ───────────── */

const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const norm = (v, fb = "") =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 4;
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
    if (t) wrapped.push(t);
  }

  const out =
    wrapped.length > maxLines
      ? wrapped
          .slice(0, maxLines)
          .map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, "…") : s))
      : wrapped;

  const pageH = page.getHeight();
  const yTop = pageH - y;
  const widthOf = (s) => font.widthOfTextAtSize(s, size);
  const lineH = size + lineGap;

  let yCursor = yTop;
  let drawn = 0;
  for (const line of out) {
    let xDraw = x;
    if (align === "center") xDraw = x + (w - widthOf(line)) / 2;
    else if (align === "right") xDraw = x + (w - widthOf(line));
    page.drawText(line, { x: xDraw, y: yCursor, size, font, color });
    yCursor -= lineH;
    drawn++;
  }
  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

const qnum = (url, key, fb) => {
  const s = url.searchParams.get(key);
  if (s === null || s === "") return fb;
  const n = Number(s);
  return Number.isFinite(n) ? n : fb;
};
const qstr = (url, key, fb) => {
  const v = url.searchParams.get(key);
  return v == null || v === "" ? fb : v;
};

const labelFromFlow = (raw) => {
  const v = (raw || "").toString().toLowerCase();
  if (v.startsWith("pers")) return "Perspective";
  if (v.startsWith("obs"))  return "Perspective"; // keep single label family (change if you add other templates)
  if (v.startsWith("refl")) return "Perspective";
  return "Perspective";
};

async function fetchTemplate(req, url) {
  // default to the new V3 template, allow override via ?tpl=
  const tplName =
    url.searchParams.get("tpl") ||
    "CTRL_Perspective_Assessment_Profile_templateV3.pdf";
  const h = (req && req.headers) || {};
  const host = S(h.host, "ctrl-export-service.vercel.app");
  const proto = S(h["x-forwarded-proto"], "https");
  const tplUrl = `${proto}://${host}/${tplName}`;
  const r = await fetch(tplUrl, { cache: "no-store" });
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

/* ───────────── handler ───────────── */

export default async function handler(req, res) {
  // Safe URL parse
  let url;
  try { url = new URL(req?.url || "/", "http://localhost"); }
  catch { url = new URL("/", "http://localhost"); }

  const isTest  = url.searchParams.get("test") === "1";
  const preview = url.searchParams.get("preview") === "1";
  const debug   = url.searchParams.get("debug") === "1";
  const noGraph = url.searchParams.get("nograph") === "1";

  // Inbound data
  let data;
  if (isTest) {
    data = {
      flow: labelFromFlow(url.searchParams.get("flow") || "Perspective"),
      dateLbl: "02/SEP/2025",
      person: { fullName: "Avery Example", coverName: "Avery Example" },
      stateWord: "Regulated",
      domDesc: "You connect the most with Mika — measured, fair, steady under pressure.",
      how: "Steady presence; keep clarity alive.",
      tip1: "Take one slow breath and name it.",
      tip2: "Insert a two-line check-in.",
      chartUrl:
        "https://quickchart.io/chart?v=4&c=" +
        encodeURIComponent(
          JSON.stringify({
            type: "radar",
            data: {
              labels: ["Concealed", "Triggered", "Regulated", "Lead"],
              datasets: [
                {
                  label: "Frequency",
                  data: [0, 2, 3, 0],
                  fill: true,
                  backgroundColor: "rgba(115,72,199,0.18)",
                  borderColor: "#7348C7",
                  borderWidth: 2,
                  pointRadius: [0, 3, 6, 0],
                  pointHoverRadius: [0, 4, 7, 0],
                  pointBackgroundColor: ["#9D7BE0", "#9D7BE0", "#7348C7", "#9D7BE0"],
                  pointBorderColor: ["#9D7BE0", "#9D7BE0", "#7348C7", "#9D7BE0"],
                },
              ],
            },
            options: {
              plugins: { legend: { display: false } },
              scales: {
                r: {
                  min: 0,
                  max: 5,
                  ticks: { display: true, stepSize: 1, backdropColor: "rgba(0,0,0,0)" },
                  grid: { circular: true },
                  angleLines: { display: true },
                  pointLabels: { color: "#4A4458", font: { size: 12 } },
                },
              },
            },
          })
        ),
      // Page 6 narrative content (moved from old p5)
      page6Patterns: [
        { title: "Direction & shape", body: "Steady line with mixed steps." },
        { title: "Coverage & edges", body: "You touched 2 states; little of Lead/Concealed." },
      ],
      themeNarrative:
        "Emotion regulation with Feedback handling and Awareness of impact stood out.",
    };
  } else {
    const b64 = url.searchParams.get("data");
    if (!b64) { res.statusCode = 400; res.end("Missing ?data"); return; }
    try {
      const raw = Buffer.from(S(b64, ""), "base64").toString("utf8");
      data = JSON.parse(raw);
    } catch (e) {
      res.statusCode = 400; res.end("Invalid ?data: " + (e?.message || e)); return;
    }
  }

  const flowLbl = labelFromFlow(data?.flow || url.searchParams.get("flow") || "Perspective");
  const fullName = norm(data?.person?.fullName || data?.fullName || "");
  const dateLbl  = norm(data?.dateLbl || "");

  /* ───────────── locked positions + URL tuners ───────────── */

  const POS = {
    // Page 1 (locked to your spec)
    f1: { x: 290, y: 170, w: 400, size: 40, align: "left" },
    n1: { x: 10,  y: 573, w: 500, size: 30, align: "center" },
    d1: { x: 130, y: 630, w: 500, size: 20, align: "left" },

    // Pages 2..8 ribbons (locked defaults)
    f2: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n2: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f3: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n3: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f4: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n4: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f5: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n5: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f6: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n6: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f7: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n7: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f8: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n8: { x: 250, y: 64, w: 400, size: 12, align: "center" },

    // Page 6 snapshot (moved from old page 5)
    dom6:     { x: 120, y: 250, w: 900, size: 36, align: "left" },           // Dominant state word
    dom6desc: { x: 120, y: 300, w: 900, size: 22, align: "left", max: 6 },   // Dominant description
    how6:     { x: 120, y: 360, w: 900, size: 22, align: "left", max: 4 },   // “How this shows up…”
    chart6:   { x: 1100, y: 300, w: 650, h: 420 },                           // Spider chart

    // Page 6 – left blocks (shape/coverage + range/gaps)
    p6p: { x: 120, y: 520, w: 1260, hSize: 14, bSize: 20, align: "left", titleGap: 6, blockGap: 20, maxBodyLines: 6 },
    // Page 6 – themes narrative
    p6t: { x: 1280, y: 620, w: 630, size: 30, align: "left", lineGap: 4, maxLines: 14, color: rgb(0.24, 0.23, 0.35) },
  };

  // apply URL tuners
  function tune(prefix, obj) {
    obj.x     = qnum(url, `${prefix}x`,     obj.x);
    obj.y     = qnum(url, `${prefix}y`,     obj.y);
    obj.w     = qnum(url, `${prefix}w`,     obj.w);
    obj.size  = qnum(url, `${prefix}s`,     obj.size);
    obj.align = qstr(url, `${prefix}align`, obj.align);
  }
  ["f1","n1","d1","f2","n2","f3","n3","f4","n4","f5","n5","f6","n6","f7","n7","f8","n8"].forEach(k => tune(k, POS[k]));

  // page 6 specific tuners (+ legacy aliases from old page-5 keys)
  function tune6Block(key, aliases = []) {
    const obj = POS[key];
    const keys = [key, ...aliases];
    // scalar fields
    for (const base of keys) {
      obj.x     = qnum(url, `${base}x`,     obj.x);
      obj.y     = qnum(url, `${base}y`,     obj.y);
      obj.w     = qnum(url, `${base}w`,     obj.w);
      obj.size  = qnum(url, `${base}s`,     obj.size);
      obj.align = qstr(url, `${base}align`, obj.align);
      if (obj.max != null) obj.max = qnum(url, `${base}max`, obj.max);
    }
  }
  tune6Block("dom6", ["dom5"]); // allow dom5* to map to dom6*
  tune6Block("dom6desc", []);
  tune6Block("how6", []);
  // chart
  POS.chart6 = {
    x: qnum(url, "c6x", POS.chart6.x),
    y: qnum(url, "c6y", POS.chart6.y),
    w: qnum(url, "c6w", POS.chart6.w),
    h: qnum(url, "c6h", POS.chart6.h),
  };
  // page 6 blocks (also accept legacy p2* mapping)
  const P6 = POS.p6p;
  P6.x = qnum(url, "p6px", qnum(url, "p2px", P6.x));
  P6.y = qnum(url, "p6py", qnum(url, "p2py", P6.y));
  P6.w = qnum(url, "p6pw", qnum(url, "p2pw", P6.w));
  P6.hSize      = qnum(url, "p6phsize", qnum(url, "p2phsize", P6.hSize));
  P6.bSize      = qnum(url, "p6pbsize", qnum(url, "p2pbsize", P6.bSize));
  P6.align      = qstr(url, "p6palign", qstr(url, "p2palign", P6.align));
  P6.titleGap   = qnum(url, "p6ptitlegap", qnum(url, "p2ptitlegap", P6.titleGap));
  P6.blockGap   = qnum(url, "p6pblockgap", qnum(url, "p2pblockgap", P6.blockGap));
  P6.maxBodyLines = qnum(url, "p6pmax", qnum(url, "p2pmax", P6.maxBodyLines));

  const T6 = POS.p6t;
  T6.x = qnum(url, "p6tx", qnum(url, "p2tx", T6.x));
  T6.y = qnum(url, "p6ty", qnum(url, "p2ty", T6.y));
  T6.w = qnum(url, "p6tw", qnum(url, "p2tw", T6.w));
  T6.size  = qnum(url, "p6ts", qnum(url, "p2ts", T6.size));
  T6.align = qstr(url, "p6talign", qstr(url, "p2talign", T6.align));
  T6.maxLines = qnum(url, "p6tmax", qnum(url, "p2tmax", T6.maxLines));

  if (debug) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok:true, pos:POS, data, urlParams:Object.fromEntries(url.searchParams.entries()) }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageCount = pdf.getPageCount();
    const get = (i) => (i < pageCount ? pdf.getPage(i) : null);

    /* ── Page 1 header ── */
    const p1 = get(0);
    if (p1) {
      drawTextBox(p1, HelvB, labelFromFlow(flowLbl), POS.f1, { maxLines: 1, ellipsis: true });
      if (fullName) drawTextBox(p1, HelvB, fullName, POS.n1, { maxLines: 1, ellipsis: true });
      if (dateLbl)  drawTextBox(p1, Helv,  dateLbl,  POS.d1, { maxLines: 1, ellipsis: true });
    }

    /* ── Pages 2..8 ribbons ── */
    const ribbons = [
      { page: get(1), f: POS.f2, n: POS.n2 },
      { page: get(2), f: POS.f3, n: POS.n3 },
      { page: get(3), f: POS.f4, n: POS.n4 },
      { page: get(4), f: POS.f5, n: POS.n5 }, // Page 5: header only (content moved)
      { page: get(5), f: POS.f6, n: POS.n6 }, // Page 6: header + snapshot content
      { page: get(6), f: POS.f7, n: POS.n7 },
      { page: get(7), f: POS.f8, n: POS.n8 },
    ];
    for (const r of ribbons) {
      if (!r.page) continue;
      drawTextBox(r.page, HelvB, labelFromFlow(flowLbl), r.f, { maxLines: 1, ellipsis: true });
      if (fullName) drawTextBox(r.page, Helv, fullName, r.n, { maxLines: 1, ellipsis: true });
    }

    /* ── Page 6 snapshot (index 5) ── */
    const p6 = get(5);
    if (p6) {
      const stateWord = norm(data?.stateWord || "");
      const domDesc   = norm(data?.domDesc   || data?.dominantParagraph || "");
      const how       = norm(data?.how       || "");

      if (stateWord) drawTextBox(p6, HelvB, stateWord, POS.dom6, { maxLines: 1, ellipsis: true });
      if (domDesc)   drawTextBox(p6, Helv,   domDesc,   POS.dom6desc, { maxLines: POS.dom6desc.max, ellipsis: true });
      if (how)       drawTextBox(p6, Helv,   how,       POS.how6,     { maxLines: POS.how6.max, ellipsis: true });

      // Chart
      if (!noGraph && data?.chartUrl) {
        try {
          const r = await fetch(S(data.chartUrl, ""));
          if (r.ok) {
            const png = await pdf.embedPng(await r.arrayBuffer());
            const { x, y, w, h } = POS.chart6;
            const ph = p6.getHeight();
            p6.drawImage(png, { x, y: ph - y - h, width: w, height: h });
          }
        } catch { /* ignore chart errors */ }
      }

      // Left two blocks
      const rawBlocks = Array.isArray(data.page6Patterns)
        ? data.page6Patterns
        : Array.isArray(data.page5Patterns)
        ? data.page5Patterns
        : Array.isArray(data.page2Patterns)
        ? data.page2Patterns
        : [];
      const blocks = rawBlocks
        .map((b) => ({ title: norm(b?.title || ""), body: norm(b?.body || "") }))
        .filter((b) => b.title || b.body)
        .slice(0, 2);

      let curY = POS.p6p.y;
      for (const b of blocks) {
        if (b.title) {
          drawTextBox(
            p6, HelvB, b.title,
            { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.hSize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap: 3 },
            { maxLines: 1, ellipsis: true }
          );
          curY += POS.p6p.hSize + 3 + POS.p6p.titleGap;
        }
        if (b.body) {
          const r = drawTextBox(
            p6, Helv, b.body,
            { x: POS.p6p.x, y: curY, w: POS.p6p.w, size: POS.p6p.bSize, align: POS.p6p.align, color: rgb(0.24,0.23,0.35), lineGap: 3 },
            { maxLines: POS.p6p.maxBodyLines, ellipsis: true }
          );
          curY += r.height + POS.p6p.blockGap;
        }
      }

      // Themes narrative
      let themeNarr = "";
      if (typeof data.themeNarrative === "string" && data.themeNarrative.trim()) {
        themeNarr = norm(data.themeNarrative.trim());
      }
      if (themeNarr) {
        drawTextBox(
          p6, Helv, themeNarr,
          { x: POS.p6t.x, y: POS.p6t.y, w: POS.p6t.w, size: POS.p6t.size, align: POS.p6t.align, color: POS.p6t.color, lineGap: POS.p6t.lineGap },
          { maxLines: POS.p6t.maxLines, ellipsis: true }
        );
      }
    }

    // Output
    const bytes = await pdf.save();
    const name =
      url.searchParams.get("name") ||
      `ctrl_profile_${String(Date.now()).slice(-6)}.pdf`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename="${name}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("fill-template error: " + (e?.message || e));
  }
}
