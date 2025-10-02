/**
 * CTRL Export Service · fill-template (Perspective flow)
 * Place at: /pages/api/fill-template.js
 * TL-origin coordinates (pt), pages are 1-based.
 */
export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
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

/* word wrap draw helper (TL → BL conversion inside) */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const { x=40, y=40, w=540, size=12, lineGap=3, color=rgb(0,0,0), align="left" } = spec;
  const maxLines = (opts.maxLines ?? spec.maxLines ?? 6);
  const hard = norm(text || "");
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
  if (!perState || cfg.labelText == null || cfg.labelSize == null) return;
  return { labelX: perState.x, labelY: perState.y };
}

/* robust resolver for C/T/R/L from label/char */
function resolveDomKey(...candidates) {
  const mapLabel = { concealed:"C", triggered:"T", regulated:"R", lead:"L" };
  const mapChar  = { art:"C", fal:"T", mika:"R", sam:"L" };
  for (const c0 of candidates.flat()) {
    const c = String(c0 || "").trim();
    if (!c) continue;
    const u = c.toUpperCase();
    if (["C","T","R","L"].includes(u)) return u;
    const l = c.toLowerCase();
    if (mapLabel[l]) return mapLabel[l];
    if (mapChar[l])  return mapChar[l];
  }
  return "";
}

/* locked coordinates (TL, 1-based) */
const LOCKED = {
  meta: { units: "pt", origin: "TL", pages: "1-based" },
  p1: { name: { x:7, y:473, w:500, size:30, align:"center" }, date: { x:210, y:600, w:500, size:25, align:"left" } },
  p3: {
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
  p4: { spider:{ x:30,y:585,w:550,size:18,align:"left", maxLines:10 }, chart:{ x:20,y:225,w:570,h:280 } },
  p5: { seqpat:{ x:25,y:250,w:550,size:18,align:"left", maxLines:12 } },
  p6: { theme: { x:25,y:350,w:550,size:18,align:"left", maxLines:12 } },
  p7: { colBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p8: { colBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p9: { ldrBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p10:{ ldrBoxes:[ {x:25,y:330,w:260,h:120}, {x:320,y:330,w:260,h:120}, {x:25,y:595,w:260,h:120}, {x:320,y:595,w:260,h:120} ], bodySize:13, maxLines:15 },
  p11: {
    lineGap:6, itemGap:6, bulletIndent:18, split:true,
    tips1:{x:30,y:175,w:530,h:80,size:18,align:"left",maxLines:4},
    tips2:{x:30,y:265,w:530,h:80,size:18,align:"left",maxLines:4},
    acts1:{x:30,y:405,w:530,h:80,size:18,align:"left",maxLines:4},
    acts2:{x:30,y:495,w:530,h:80,size:18,align:"left",maxLines:4}
  },
  footer:(()=>{ const f={x:380,y:51,w:400,size:13,align:"left"}; return {f2:{...f},f3:{...f},f4:{...f},f5:{...f},f6:{...f},f7:{...f},f8:{...f},f9:{...f},f10:{...f},f11:{...f},f12:{...f}} })()
};

/* remote chart (PNG/JPG), keeps transparency */
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

/* ───────────── QuickChart tuner (shape-based scale + rounded radar) ───────────── */
function tuneQuickChartUrl(originalUrl) {
  try {
    if (!originalUrl || !/^https?:/i.test(originalUrl)) return originalUrl;
    const u = new URL(originalUrl);
    let cParam = u.searchParams.get("c");
    if (!cParam) return originalUrl;

    // Parse possible encoded config
    let cfg = null;
    try { cfg = JSON.parse(cParam); }
    catch { try { cfg = JSON.parse(decodeURIComponent(cParam)); } catch { return originalUrl; } }

    if (!cfg || String(cfg.type).toLowerCase() !== "radar") return originalUrl;

    // Dataset values
    const d = Array.isArray(cfg?.data?.datasets?.[0]?.data)
      ? cfg.data.datasets[0].data.map(n => Number(n) || 0)
      : [];

    // Infer shape by sorted counts (desc); normalize 5 → "5.0"
    const shape = (() => {
      const s = d.slice().sort((a,b)=>b-a).join(".");
      return s === "5" ? "5.0" : s;
    })();

    // Round the polygon
    cfg.options = cfg.options || {};
    cfg.options.elements = cfg.options.elements || {};
    cfg.options.elements.line = { ...(cfg.options.elements.line || {}), tension: 0.35 };
    if (cfg.data && Array.isArray(cfg.data.datasets)) {
      cfg.data.datasets = cfg.data.datasets.map(ds => ({ ...ds, tension: 0.35 }));
    }

    // Apply requested scale per shape
    cfg.options.scales = cfg.options.scales || {};
    const r = {};
    if (shape === "2.1.1.1") {
      Object.assign(r, { min: 0, max: 3, ticks: { stepSize: 1 }, grid: { circular: true } });
    } else if (shape === "3.2") {
      Object.assign(r, { min: 0, max: 4, ticks: { stepSize: 1 }, grid: { circular: true } });
    } else if (shape === "4.1" || shape === "5.0" || shape === "5") {
      Object.assign(r, { min: 0, max: 5, ticks: { stepSize: 1 }, grid: { circular: true } });
    } else {
      const maxVal = Math.max(4, ...d);
      Object.assign(r, { beginAtZero: true, suggestedMax: maxVal, ticks: { stepSize: 1 }, grid: { circular: true } });
    }
    cfg.options.scales.r = r;

    u.searchParams.set("c", JSON.stringify(cfg));
    return u.toString();
  } catch {
    return originalUrl;
  }
}

function normaliseInput(d = {}) {
  const wcol = Array.isArray(d.workwcol) ? d.workwcol.map(x => ({ look: norm(x?.look||""), work: norm(x?.work||"") })) : [];
  const wldr = Array.isArray(d.workwlead)? d.workwlead.map(x => ({ look: norm(x?.look||""), work: norm(x?.work||"") })) : [];
  const tips = Array.isArray(d.tips)? d.tips.map(norm) : [];
  const actions = Array.isArray(d.actions)? d.actions.map(norm) : [];

  // >>> Fix: prefer person.fullName, then short key "p1:n", then others; avoid defaulting to the path label unless truly empty.
  const nameCand =
    (d.person && d.person.fullName) ||
    d["p1:n"] ||
    d.fullName ||
    (d.person && d.person.preferredName) ||
    d.preferredName ||
    d.name;

  return {
    name:    norm(nameCand || "Perspective"),
    // >>> Small robustness: also accept short key "p1:d" if present (non-breaking).
    dateLbl: norm(d.dateLbl || d["p1:d"] || d.d || ""),
    dom:     String(d.dom || d.domLabel || ""),
    domChar: norm(d.domchar || d.domChar || d.character || ""),
    domDesc: norm(d.domdesc || d.domDesc || d.dominantDesc || ""),
    spiderdesc: norm(d.spiderdesc || d.spider || ""),
    spiderfreq: norm(d.spiderfreq || ""),
    seqpat:  norm(d.seqpat || d.pattern || d.seqat || ""),
    theme:   norm(d.theme || ""),
    workwcol: wcol,
    workwlead: wldr,
    tips,
    actions,
    chartUrl: String(d.chart || d.chartUrl || ""),
    layoutV6: d.layoutV6 && typeof d.layoutV6 === "object" ? d.layoutV6 : null
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
    const q = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const tpl = q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim.pdf";

    const src = parseDataParam(q.data);
    const P   = normaliseInput(src);
    const L   = layoutFromPayload(src.layoutV6);

    const tplPath = path.resolve(process.cwd(), "public", String(tpl).replace(/[^A-Za-z0-9._-]/g, ""));
    const pdfBytes = await fs.readFile(tplPath);
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
        drawTextBox(p(2), font, String(L.p3.state.labelText), {
          x: anchor.labelX, y: anchor.labelY, w: 180,
          size: L.p3.state.labelSize || 10, align: "center"
        }, { maxLines: 1 });
      }
    }

    // p4 (spider explanation + transparent chart)
    if (L.p4?.spider) {
      // accept either key: "p4:spiderdesc" (colon) or "spiderdesc" (dot)
      const rawSpiderDesc =
        (P && P["p4:spiderdesc"]) ??
        (P && P.spiderdesc) ??
        "";

      const desc = S(rawSpiderDesc).trim();
      if (desc) {
        const maxLines = (L.p4.spider?.maxLines ?? L.p4.spiderMaxLines ?? 10);
        drawTextBox(p(3), font, desc, { ...L.p4.spider, maxLines }, { maxLines });
      }
    }

    if (L.p4?.chart && (P?.chartUrl || q.chart)) {
      let chartUrl = String(P?.chartUrl || q.chart || "");

      // Enforce shape-based scale + rounded radar even when caller passed &chart=
      chartUrl = tuneQuickChartUrl(chartUrl);

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

    // p6
    if (L.p6?.theme && P.theme) {
      const maxLines = (L.p6.theme.maxLines ?? L.p6.themeMaxLines ?? 12);
      drawTextBox(p(5), font, P.theme, { ...L.p6.theme, maxLines }, { maxLines });
    }

    // p7–p10
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

    // p11 (hanging-indent bullets + strip "Tip:" prefix)
    if (L.p11?.split) {
      const clean = s =>
        norm(String(s || ""))
          .replace(/^(?:[-–—•·]\s*)?(?:tip\s*:?\s*)/i, "") // remove leading bullet + "Tip:"
          .trim();

      const pairs = [
        { txt: clean(P.tips?.[0]),    box: L.p11.tips1 },
        { txt: clean(P.tips?.[1]),    box: L.p11.tips2 },
        { txt: clean(P.actions?.[0]), box: L.p11.acts1 },
        { txt: clean(P.actions?.[1]), box: L.p11.acts2 }
      ];

      for (const { txt, box } of pairs) {
        if (!txt) continue;
        const indent = N(L.p11.bulletIndent, 18);
        const size   = box.size || 18;
        const maxL   = box.maxLines || 4;

        // draw the dash in a narrow gutter (so wrapped lines align)
        const dashX = box.x + Math.max(2, indent - 10); // 10pt gutter; tweak if needed
        drawTextBox(p(10), font, "-", { x: dashX, y: box.y, w: 8, size, align: "left" }, { maxLines: 1 });

        // draw the text block starting at the indent
        drawTextBox(
          p(10), font, txt,
          { x: box.x + indent, y: box.y, w: box.w - indent, size, align: box.align || "left" },
          { maxLines: maxL }
        );
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
