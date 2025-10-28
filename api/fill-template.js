/**
 * CTRL Export Service · fill-template (Perspective flow, USER-ONLY)
 * Place at: /pages/api/fill-template.js
 * TL-origin coordinates (pt), pages are 1-based.
 */
export const config = { runtime: "nodejs" };

/* ───────────── imports ───────────── */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────── utilities ───────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);

const norm = (v, fb = "") =>
  String(v ?? fb)
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[•·]/g, "-")
    // arrows → WinAnsi-safe
    .replace(/\u2194/g, "<->").replace(/\u2192/g, "->").replace(/\u2190/g, "<-")
    .replace(/\u2191/g, "^").replace(/\u2193/g, "v").replace(/[\u2196-\u2199]/g, "->")
    .replace(/\u21A9/g, "<-").replace(/\u21AA/g, "->")
    .replace(/\u00D7/g, "x")
    // zero-width, emoji/PUA
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    // tidy
    .replace(/\t/g, " ").replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ").replace(/[ \t]+\n/g, "\n").trim();

function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
  catch { return {}; }
}

/* GET/POST payload reader (supports ?data= and JSON body) */
async function readPayload(req) {
  const q = req.method === "POST" ? (req.body || {}) : (req.query || {});
  if (q.data) return parseDataParam(q.data);
  if (req.method === "POST" && !q.data) {
    try { return typeof req.json === "function" ? await req.json() : (req.body || {}); }
    catch { /* fallthrough */ }
  }
  return {};
}

/* TL → draw helper (does internal TL->BL conv for baseline) */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const { x=40, y=40, w=540, size=12, lineGap=3, color=rgb(0,0,0), align="left" } = spec;
  const maxLines = (opts.maxLines ?? spec.maxLines ?? 6);
  const hard = norm(text || "");
  if (!hard) return;

  const lines = hard.split(/\n/).map(s=>s.trim());
  const wrapped = [];
  const widthOf = (s) => font.widthOfTextAtSize(s, Math.max(1, size));

  const wrapLine = (ln) => {
    const words = ln.split(/\s+/); let cur="";
    for (let i=0;i<words.length;i++){
      const nxt = cur ? `${cur} ${words[i]}` : words[i];
      if (widthOf(nxt) <= w || !cur) cur = nxt;
      else { wrapped.push(cur); cur = words[i]; }
    }
    wrapped.push(cur);
  };
  for (const ln of lines) wrapLine(ln);

  const out = wrapped.slice(0, maxLines);
  const pageH = page.getHeight();
  const baselineY = pageH - y;
  const lineH = Math.max(1,size) + lineGap;

  let yCursor = baselineY;
  for (const ln of out) {
    let xDraw = x; const wLn = widthOf(ln);
    if (align === "center") xDraw = x + (w - wLn) / 2;
    else if (align === "right") xDraw = x + (w - wLn);
    page.drawText(ln, { x: xDraw, y: yCursor - size, size: Math.max(1,size), font, color });
    yCursor -= lineH;
  }
}

const rectTLtoBL = (page, box, inset = 0) => {
  const pageH = page.getHeight();
  const x = N(box.x) + inset;
  const w = Math.max(0, N(box.w) - inset * 2);
  const h = Math.max(0, N(box.h) - inset * 2);
  const y = pageH - N(box.y) - N(box.h) + inset;
  return { x, y, w, h };
};

function paintStateHighlight(page3, dom, cfg = {}) {
  const b = (cfg.absBoxes && cfg.absBoxes[dom]) || null;
  if (!b) return;
  const radius  = Number.isFinite(+((cfg.styleByState||{})[dom]?.radius)) ? +((cfg.styleByState||{})[dom].radius) : (cfg.highlightRadius ?? 28);
  const inset   = Number.isFinite(+((cfg.styleByState||{})[dom]?.inset))  ? +((cfg.styleByState||{})[dom].inset)  : (cfg.highlightInset  ?? 6);
  const opacity = Number.isFinite(+cfg.fillOpacity) ? +cfg.fillOpacity : 0.45;
  const boxBL = rectTLtoBL(page3, b, inset);
  const shade = rgb(251/255, 236/255, 250/255);
  page3.drawRectangle({ x: boxBL.x, y: boxBL.y, width: boxBL.w, height: boxBL.h, borderRadius: radius, color: shade, opacity });
  const perState = (cfg.labelByState && cfg.labelByState[dom]) || null;
  if (perState && cfg.labelText && cfg.labelSize) {
    return { labelX: perState.x, labelY: perState.y };
  }
  return null;
}

/* robust resolver for C/T/R/L from label/char */
function resolveDomKey(...candidates) {
  const mapLabel = { concealed:"C", triggered:"T", regulated:"R", lead:"L" };
  const mapChar  = { art:"C", fal:"T", mika:"R", sam:"L" };
  for (const c0 of candidates.flat()) {
    const c = String(c0 || "").trim(); if (!c) continue;
    const u = c.toUpperCase();
    if (["C","T","R","L"].includes(u)) return u;
    const l = c.toLowerCase();
    if (mapLabel[l]) return mapLabel[l];
    if (mapChar[l])  return mapChar[l];
  }
  return "";
}

/* ─────────── Radar colour theme (overrideable via payload.chartTheme) ─────────── */
const RADAR_THEME = {
  stroke: "#4B2E83",                 // polygon outline + points
  fill:   "rgba(75,46,131,0.22)",    // polygon fill
  point:  "#4B2E83",                 // point fill
  grid:   "rgba(0,0,0,0.14)",        // rings & spokes
  labels: "#555555"                  // axis labels & ticks
};

/* ───────── locked layout (TL, 1-based) ───────── */
const LOCKED = {
  meta: { units: "pt", origin: "TL", pages: "1-based" },
  p1:  { name: { x:7, y:473, w:500, size:30, align:"center" }, date: { x:210, y:600, w:500, size:25, align:"left" } },
  p3:  {
    domChar:{ x:272,y:640,w:630,size:23,align:"left", maxLines:6 },
    domDesc:{ x: 25,y:685,w:550,size:18,align:"left", maxLines:12 },
    state: {
      useAbsolute:true, shape:"round", highlightInset:6, highlightRadius:28, fillOpacity:0.45,
      styleByState:{ C:{radius:28,inset:6}, T:{radius:28,inset:6}, R:{radius:1000,inset:1}, L:{radius:28,inset:6} },
      labelByState:{ C:{x:60,y:245}, T:{x:290,y:244}, R:{x:60,y:605}, L:{x:290,y:605} },
      labelText:"YOU ARE HERE", labelSize:10, labelColor:{r:0.20,g:0.20,b:0.20}, labelOffsetX:0, labelOffsetY:0, labelPadTop:12, labelPadBottom:12,
      absBoxes:{ C:{x:58,y:258,w:188,h:156}, T:{x:299,y:258,w:188,h:156}, R:{x:60,y:433,w:188,h:158}, L:{x:298,y:430,w:195,h:173} }
    }
  },
  p4:  { 
    spider:{ x:30,y:585,w:550,size:16,align:"left", maxLines:15 },
    chart:{  x:35, y:235, w:540, h:260 }   // final requested size
  },
  p5:  { seqpat:{ x:25,y:250,w:550,size:18,align:"left", maxLines:12 } },
  p6:  { theme: null, themeExpl:{ x:25,y:560,w:550,size:18,align:"left", maxLines:12 } },
  p7:  { colBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p8:  { colBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p9:  { ldrBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p10: { ldrBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p11: {
    lineGap:6, itemGap:6, bulletIndent:18, split:true,
    tips1:{x:30,y:175,w:530,h:80,size:18,align:"left",maxLines:4},
    tips2:{x:30,y:265,w:530,h:80,size:18,align:"left",maxLines:4},
    acts1:{x:30,y:405,w:530,h:80,size:18,align:"left",maxLines:4},
    acts2:{x:30,y:495,w:530,h:80,size:18,align:"left",maxLines:4}
  },
  footer:(()=>{ const f={x:380,y:51,w:400,size:13,align:"left"}; return {f2:{...f},f3:{...f},f4:{...f},f5:{...f},f6:{...f},f7:{...f},f8:{...f},f9:{...f},f10:{...f},f11:{...f},f12:{...f}} })()
};

/* ───────── robust /public template loader ───────── */
async function loadTemplateBytesLocal(filename) {
  const fname = String(filename || "").trim();
  if (!fname.endsWith(".pdf")) throw new Error(`Invalid template filename: ${fname}`);

  const __file = fileURLToPath(import.meta.url);
  const __dir  = path.dirname(__file);

  const candidates = [
    path.join(__dir, "..", "..", "public", fname),
    path.join(__dir, "..", "public", fname),
    path.join(__dir, "public", fname),
    path.join(process.cwd(), "public", fname),
    path.join(__dir, fname),
  ];

  let lastErr;
  for (const pth of candidates) {
    try { return await fs.readFile(pth); }
    catch (err) { lastErr = err; }
  }
  throw new Error(`Template not found in any known path for /public: ${fname} (${lastErr?.message||"no detail"})`);
}

/* ───────── image + QuickChart helpers ───────── */
async function embedRemoteImage(pdfDoc, url) {
  try {
    if (!url || !/^https?:/i.test(url)) return null;
    if (typeof fetch === "undefined") return null;
    const res = await fetch(url); if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdfDoc.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdfDoc.embedJpg(bytes);
    try { return await pdfDoc.embedPng(bytes); } catch { return await pdfDoc.embedJpg(bytes); }
  } catch { return null; }
}

/* === Radar scale rules === */
function radarScaleFromCounts(counts) {
  const vals = [N(counts.C,0), N(counts.T,0), N(counts.R,0), N(counts.L,0)];
  const maxVal = Math.max(...vals);
  const nonZero = vals.filter(v => v > 0);
  if (maxVal <= 0 || nonZero.length === 0) {
    return { min: 0, max: 4, ticks: { stepSize: 1 }, grid: { circular: true } };
  }
  if (maxVal === 5 && nonZero.length === 1) {
    return { min: 0, max: 5, ticks: { stepSize: 1 }, grid: { circular: true }, _fiveOnly: true };
  }
  const lowestNZ = Math.min(...nonZero);
  const min = Math.max(0, lowestNZ - 1);
  const max = Math.min(5, maxVal + 1);
  return { min, max, ticks: { stepSize: 1 }, grid: { circular: true } };
}

/* Build a QuickChart radar URL from counts with dynamic scale + brand colours */
function buildSpiderQuickChartUrlFromCounts(counts, themeOverride=null) {
  const data = [N(counts.C,0), N(counts.T,0), N(counts.R,0), N(counts.L,0)];
  const rScale = radarScaleFromCounts(counts);
  const isFiveOnly = !!rScale._fiveOnly;

  const C = { ...RADAR_THEME, ...(themeOverride || {}) };

  const cfg = {
    type: "radar",
    data: {
      labels: ["Concealed","Triggered","Regulated","Lead"],
      datasets: [{
        label: "CTRL",
        data,
        fill: true,
        borderColor: C.stroke,
        backgroundColor: C.fill,
        pointBackgroundColor: C.point,
        pointBorderColor: "#FFFFFF",
        borderWidth: isFiveOnly ? 5 : 4,
        pointRadius: isFiveOnly ? 6 : 4,
        pointBorderWidth: 2,
        pointHoverRadius: isFiveOnly ? 8 : 5
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: rScale.min,
          max: rScale.max,
          ticks: { ...rScale.ticks, color: C.labels, font: { size: 12 } },
          grid:  { ...rScale.grid, color: C.grid, lineWidth: 2, circular: true },
          angleLines: { display: true, color: C.grid, lineWidth: 2 },
          pointLabels: { font: { size: 18, weight: "700" }, color: C.labels }
        }
      },
      elements: { line: { tension: 0.60, borderWidth: isFiveOnly ? 5 : 4 } }
    }
  };

  const u = new URL("https://quickchart.io/chart");
  u.searchParams.set("c", JSON.stringify(cfg));
  u.searchParams.set("backgroundColor", "transparent");
  u.searchParams.set("width", "700");
  u.searchParams.set("height", "700");
  u.searchParams.set("v", Date.now().toString(36)); // cache-bust
  return u.toString();
}

/* ───────── spiderdesc + counts helpers ───────── */
function parseCountsFromFreq(freqStr = "", fb = {C:0,T:0,R:0,L:0}) {
  const out = { C:0, T:0, R:0, L:0 };
  const s = String(freqStr || "");
  const re = /([CTRL]):\s*([0-9]+)/gi;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toUpperCase();
    out[k] = Number(m[2]) || 0;
  }
  for (const k of ["C","T","R","L"]) if (!out[k] && Number(fb[k])) out[k] = Number(fb[k]);
  return out;
}

function scaleMaxForShape(shape) {
  if (shape === "2.1.1.1") return 3;
  if (shape === "3.2")     return 4;
  if (shape === "4.1")     return 5;
  if (shape === "5.0" || shape === "5") return 5;
  return 4;
}

function canonicalFromCounts(cnt) {
  const CTRL = ["C","T","R","L"];
  const orderIdx = k => CTRL.indexOf(k);
  const arr = CTRL.map(k => ({ k, n: Number(cnt[k]||0) }))
    .filter(x => x.n > 0)
    .sort((a,b) => (b.n - a.n) || (orderIdx(a.k) - orderIdx(b.k)));
  if (!arr.length) return { shape: "", states: [] };
  const pos = arr.map(x => x.n);
  let shape = pos.join(".");
  if (pos[0] === 5) shape = "5.0";
  else if (pos[0] === 4 && pos[1] === 1) shape = "4.1";
  else if (pos[0] === 3 && pos[1] === 2) shape = "3.2";
  else if (pos[0] === 3 && pos[1] === 1 && pos[2] === 1) shape = "3.1.1";
  else if (pos[0] === 2 && pos[1] === 2 && pos[2] === 1) shape = "2.2.1";
  else if (pos[0] === 2 && pos[1] === 1 && pos[2] === 1 && pos[3] === 1) shape = "2.1.1.1";

  let states = [];
  if (shape === "5.0")               states = [arr[0].k];
  else if (shape === "4.1" || shape === "3.2") states = [arr[0].k, arr[1].k];
  else if (shape === "3.1.1" || shape === "2.2.1") states = [arr[0].k, arr[1].k, arr[2].k];
  else if (shape === "2.1.1.1")      states = [arr[0].k, arr[1].k, arr[2].k, arr[3].k];
  else                               states = arr.map(x=>x.k);

  return { shape, states };
}

function tuneSpiderDesc(rawDesc, q, P) {
  let base = q && typeof q.spiderdesc === "string" && q.spiderdesc.trim().length ? q.spiderdesc : (rawDesc || "");
  if (!base) return "";

  const counts = P.counts ?? parseCountsFromFreq(P?.spiderfreq);
  const { shape, states } = canonicalFromCounts(counts);
  const orderArrow = states.join(" \u2192 ");
  const max = scaleMaxForShape(shape);
  const countsStr = String(P?.spiderfreq || "");

  base = String(base).replace(/\{\{\s*(shape|states|order|counts|max)\s*\}\}/gi, (_, key) => {
    const k = key.toLowerCase();
    if (k === "shape")  return shape || "";
    if (k === "states" || k === "order") return orderArrow || "";
    if (k === "counts") return countsStr || "";
    if (k === "max")    return String(max);
    return "";
  });

  if (q && typeof q.spiderdesc_prefix === "string") base = String(q.spiderdesc_prefix) + base;
  if (q && typeof q.spiderdesc_suffix === "string") base = base + String(q.spiderdesc_suffix);
  if (q && typeof q.spiderdesc_append === "string") base = base + String(q.spiderdesc_append);

  return base;
}

/* ───────── Tips & Actions helpers ───────── */
function splitToList(v) {
  // Accept array directly; or split string on common separators
  if (Array.isArray(v)) return v.map(s => String(s ?? "")).filter(Boolean);
  const s = String(v || "");
  if (!s) return [];
  // Split on newlines OR "||" OR semicolons. Keep order.
  return s
    .split(/\n+|\s*\|\|\s*|;\s*/g)
    .map(x => x.trim())
    .filter(Boolean);
}
function cleanBullet(s) {
  return norm(String(s || ""))
    .replace(/^(?:[-–—•·]\s*)/i, "")     // strip leading bullet glyph
    .replace(/^tip\s*:?\s*/i, "")        // strip "Tip:" prefix
    .replace(/^action\s*:?\s*/i, "")     // strip "Action:" prefix
    .trim();
}

/* normalize inbound payload to canonical */
function normaliseInput(d = {}) {
  const wcol = Array.isArray(d.workwcol) ? d.workwcol.map(x => ({ look: norm(x?.look||""), work: norm(x?.work||"") })) : [];
  const wldr = Array.isArray(d.workwlead)? d.workwlead.map(x => ({ look: norm(x?.look||""), work: norm(x?.work||"") })) : [];

  // Tips / actions can arrive as arrays OR as a single string with separators
  const tipsIn    = d.tips ?? d.tipsText ?? (d.clientTipsActions && d.clientTipsActions.tips);
  const actsIn    = d.actions ?? d.actionsText ?? (d.clientTipsActions && d.clientTipsActions.actions);
  const tipsList  = splitToList(tipsIn).map(cleanBullet).filter(Boolean);
  const actsList  = splitToList(actsIn).map(cleanBullet).filter(Boolean);

  const nameCand =
    (d.person && d.person.fullName) ||
    d["p1:n"] ||
    d.fullName ||
    (d.person && d.person.preferredName) ||
    d.preferredName ||
    d.name;

  return {
    name:      norm(nameCand || "Perspective"),
    dateLbl:   norm(d.dateLbl || d["p1:d"] || d.d || ""),
    dom:       String(d.dom || d.domLabel || ""),
    domChar:   norm(d.domchar || d.domChar || d.character || ""),
    domDesc:   norm(d.domdesc || d.domDesc || d.dominantDesc || ""),
    spiderdesc:norm(d.spiderdesc || d.spider || ""),
    spiderfreq:norm(d.spiderfreq || d["p3:freq"] || ""),
    seqpat:    norm(d.seqpat || d.pattern || d.seqat || d["p4:seq"] || ""),
    theme:     norm(d.theme || d["p6:theme"] || ""),
    themeExpl: norm(d.themeExpl || d["p6:themeExpl"] || ""),
    workwcol:  wcol,
    workwlead: wldr,
    tips:      tipsList,                      // ← canonical tips array
    actions:   actsList,                      // ← canonical actions array
    chartUrl:  String(d.chart || d["p4:chart"] || d.chartUrl || ""),
    counts:    (d.counts && typeof d.counts === "object") ? d.counts : null,
    chartTheme:(d.chartTheme && typeof d.chartTheme === "object") ? d.chartTheme : null,
    layoutV6:  d.layoutV6 && typeof d.layoutV6 === "object" ? d.layoutV6 : null,
    maskThemeLabel: d.maskThemeLabel !== false // default true
  };
}

function layoutFromPayload(payloadLayout) {
  const L = JSON.parse(JSON.stringify(LOCKED));
  if (!payloadLayout) return L;
  for (const k of Object.keys(payloadLayout)) {
    if (!L[k]) { L[k] = payloadLayout[k]; continue; }
    if (typeof payloadLayout[k] === "object" && !Array.isArray(payloadLayout[k])) L[k] = { ...L[k], ...payloadLayout[k] };
    else L[k] = payloadLayout[k];
  }
  return L;
}

/* ───────────── handler ───────────── */
export default async function handler(req, res) {
  try {
    const q    = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const tpl  = q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim.pdf";
    const src  = await readPayload(req);
    const P    = normaliseInput(src);

    // IMPORTANT: ignore remote layout to stop Botpress overrides while stabilising
    const ALLOW_REMOTE_LAYOUT = false;
    const L    = layoutFromPayload(ALLOW_REMOTE_LAYOUT ? src.layoutV6 : null);

    // robust local /public loader
    const pdfBytes = await loadTemplateBytesLocal(String(tpl).replace(/[^A-Za-z0-9._-]/g, ""));
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const p = (i) => pages[i];

    // p1
    if (L.p1?.name && P.name)    drawTextBox(p(0), font, P.name,    L.p1.name);
    if (L.p1?.date && P.dateLbl) drawTextBox(p(0), font, P.dateLbl, L.p1.date);

    // p3 (dominant highlight + label)
    if (L.p3?.domChar && P.domChar) drawTextBox(p(2), font, P.domChar, L.p3.domChar, { maxLines: L.p3.domChar.maxLines });
    if (L.p3?.domDesc && P.domDesc) drawTextBox(p(2), font, P.domDesc, L.p3.domDesc, { maxLines: L.p3.domDesc.maxLines });

    const domKey = resolveDomKey(P.dom, P.domChar, P.domDesc);
    if (domKey && L.p3?.state?.useAbsolute) {
      const anchor = paintStateHighlight(p(2), domKey, L.p3.state);
      if (anchor && L.p3.state.labelText) {
        drawTextBox(p(2), font, String(L.p3.state.labelText),
          { x: anchor.labelX, y: anchor.labelY, w: 180, size: L.p3.state.labelSize || 10, align: "center" },
          { maxLines: 1 });
      }
    }

    // p4 (spider explanation)
    if (L.p4?.spider) {
      const tuned = tuneSpiderDesc(P.spiderdesc, q, P).trim();
      if (tuned) {
        const maxLines = (L.p4.spider?.maxLines ?? L.p4.spiderMaxLines ?? 10);
        drawTextBox(p(3), font, tuned, { ...L.p4.spider, maxLines }, { maxLines });
      }
    }

    // p4 chart — prefer explicit counts; dynamic scale; theme; cache-bust
    if (L.p4?.chart) {
      let chartUrl = String(P?.chartUrl || q.chart || "");
      let counts = P.counts ? { C:N(P.counts.C,0), T:N(P.counts.T,0), R:N(P.counts.R,0), L:N(P.counts.L,0) }
                            : parseCountsFromFreq(P.spiderfreq || "");

      if (!chartUrl) {
        const sum = N(counts.C,0)+N(counts.T,0)+N(counts.R,0)+N(counts.L,0);
        if (sum > 0) chartUrl = buildSpiderQuickChartUrlFromCounts(counts, P.chartTheme);
      } else {
        try { const u = new URL(chartUrl); u.searchParams.set("v", Date.now().toString(36)); chartUrl = u.toString(); } catch {}
      }

      if (chartUrl) {
        const img = await embedRemoteImage(pdfDoc, chartUrl);
        if (img) {
          const H = p(3).getHeight();
          const { x, y, w, h } = L.p4.chart;
          p(3).drawImage(img, { x, y: H - y - h, width: w, height: h });
        }
      }
    }

    // p5
    if (L.p5?.seqpat && P.seqpat) {
      const maxLines = (L.p5.seqpat.maxLines ?? L.p5.seqpatMaxLines ?? 12);
      drawTextBox(p(4), font, P.seqpat, { ...L.p5.seqpat, maxLines }, { maxLines });
    }

    // p6 — THEME (mask baked label; render paragraph only)
    if (P.maskThemeLabel !== false) {
      try {
        const white = rgb(1,1,1);
        const w = p(5).getWidth() - 90, h = 18;
        const xTL = 55, yTL = 500;
        const yBL = p(5).getHeight() - yTL - h;
        p(5).drawRectangle({ x: xTL, y: yBL, width: w, height: h, color: white, opacity: 1 });
      } catch {}
    }
    if (L.p6?.theme && P.theme) {
      const maxLines = (L.p6.theme.maxLines ?? L.p6.themeMaxLines ?? 2);
      drawTextBox(p(5), font, P.theme, { ...L.p6.theme, maxLines }, { maxLines });
    }
    if (L.p6?.themeExpl && P.themeExpl) {
      const maxLines = (L.p6.themeExpl.maxLines ?? L.p6.themeExplMaxLines ?? 12);
      drawTextBox(p(5), font, P.themeExpl, { ...L.p6.themeExpl, maxLines }, { maxLines });
    }

    // p7–p10 WorkWith
    const mapIdx = { C:0, T:1, R:2, L:3 };
    if (L.p7?.colBoxes?.length && Array.isArray(P.workwcol)) {
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k], bx = L.p7.colBoxes[i], item = P.workwcol[i] || {};
        const txt = norm(item?.look || ""); if (!txt) continue;
        drawTextBox(p(6), font, txt, { x:bx.x, y:bx.y, w:bx.w, size:L.p7.bodySize||13, align:"left" }, { maxLines: L.p7.maxLines||15 });
      }
    }
    if (L.p8?.colBoxes?.length && Array.isArray(P.workwcol)) {
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k], bx = L.p8.colBoxes[i], item = P.workwcol[i] || {};
        const txt = norm(item?.work || ""); if (!txt) continue;
        drawTextBox(p(7), font, txt, { x:bx.x, y:bx.y, w:bx.w, size:L.p8.bodySize||13, align:"left" }, { maxLines: L.p8.maxLines||15 });
      }
    }
    if (L.p9?.ldrBoxes?.length && Array.isArray(P.workwlead)) {
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k], bx = L.p9.ldrBoxes[i], item = P.workwlead[i] || {};
        const txt = norm(item?.look || ""); if (!txt) continue;
        drawTextBox(p(8), font, txt, { x:bx.x, y:bx.y, w:bx.w, size:L.p9.bodySize||13, align:"left" }, { maxLines: L.p9.maxLines||15 });
      }
    }
    if (L.p10?.ldrBoxes?.length && Array.isArray(P.workwlead)) {
      for (const k of ["C","T","R","L"]) {
        const i = mapIdx[k], bx = L.p10.ldrBoxes[i], item = P.workwlead[i] || {};
        const txt = norm(item?.work || ""); if (!txt) continue;
        drawTextBox(p(9), font, txt, { x:bx.x, y:bx.y, w:bx.w, size:L.p10.bodySize||13, align:"left" }, { maxLines: L.p10.maxLines||15 });
      }
    }

 // p11 Tips & Actions — pack non-empty items into the two slots
if (L.p11?.split) {
  // 1) normalise & clean
  const tidy = s =>
    norm(String(s || ""))
      .replace(/^(?:[-–—•·]\s*)/i, "")                 // strip bullet glyphs
      .replace(/^\s*(tip|tips)\s*:?\s*/i, "")          // strip leading "tip:" / "tips:"
      .replace(/^\s*(action|next action|actions)\s*:?\s*/i, "")
      .trim();

  const tipsRaw    = Array.isArray(P.tips)    ? P.tips    : [];
  const actionsRaw = Array.isArray(P.actions) ? P.actions : [];

  // 2) keep order, drop empties *after* cleaning
  const tipsPacked    = tipsRaw.map(tidy).filter(Boolean).slice(0, 2);
  const actionsPacked = actionsRaw.map(tidy).filter(Boolean).slice(0, 2);

  // 3) helper to draw a single bullet line into a target box
  const drawBullet = (pageIdx, box, text) => {
    if (!box || !text) return;
    const indent = N(L.p11.bulletIndent, 18);
    const size   = box.size || 18;
    const maxL   = box.maxLines || 4;

    // small dash “bullet”
    const dashX = box.x + Math.max(2, indent - 10);
    drawTextBox(p(pageIdx), font, "-", { x: dashX, y: box.y, w: 8, size, align: "left" }, { maxLines: 1 });

    // the text, indented
    drawTextBox(
      p(pageIdx), font, text,
      { x: box.x + indent, y: box.y, w: Math.max(0, box.w - indent), size, align: box.align || "left" },
      { maxLines: maxL }
    );
  };

  // 4) place Tips (first non-empty → tips1, second → tips2)
  drawBullet(10, L.p11.tips1, tipsPacked[0] || "");
  drawBullet(10, L.p11.tips2, tipsPacked[1] || "");

  // 5) place Actions (first non-empty → acts1, second → acts2)
  drawBullet(10, L.p11.acts1, actionsPacked[0] || "");
  drawBullet(10, L.p11.acts2, actionsPacked[1] || "");
}

    }

    // footers
    const footerLabel = norm(P.name);
    const putFooter = (pageIdx, key) => { const spec = L.footer?.[key]; if (!spec) return; drawTextBox(p(pageIdx), font, footerLabel, spec, { maxLines: 1 }); };
    putFooter(1,"f2"); putFooter(2,"f3"); putFooter(3,"f4"); putFooter(4,"f5"); putFooter(5,"f6");
    putFooter(6,"f7"); putFooter(7,"f8"); putFooter(8,"f9"); putFooter(9,"f10"); putFooter(10,"f11"); putFooter(11,"f12");

    const bytes = await pdfDoc.save();
    const nameOut = S(q.out || `CTRL_${P.name || "Perspective"}_${P.dateLbl || ""}.pdf`).replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nameOut}"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.status(400).json({ ok:false, error:`fill-template error: ${err.message || String(err)}` });
  }
}
