/**
 * fill-template.js — CLEAN FULL
 * Purpose: Render CTRL PDF using layoutV6 meta + payload.
 * IMPORTANT: Only functional additions vs your older working file are:
 *   - draw of Page 4 "spiderdesc" using layoutV6.p4.spider
 *   - safe fallback to read both data.spiderdesc and data["p4:spiderdesc"]
 * Everything else follows your prior conventions (names, tips/actions indent, etc.).
 */
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fetch = require("node-fetch");

function pick(...a){ for(const v of a){ if(v!=null && String(v).trim()) return String(v); } return ""; }
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

async function loadBytes(urlOrPath){
  if (/^https?:/i.test(urlOrPath)) {
    const r = await fetch(urlOrPath);
    if (!r.ok) throw new Error(`HTTP ${r.status} loading ${urlOrPath}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  // Node fs for local templates
  const fs = require("fs");
  return fs.readFileSync(urlOrPath);
}

function splitIntoLines(text, font, size, maxWidth) {
  const words = String(text||"").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width <= maxWidth) line = test;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextBox(page, text, box, fonts){
  const t = String(text||"").trim();
  if (!t) return {lines:0};
  const cfg = Object.assign({ x:0, y:0, w:500, h:0, size:12, align:"left", maxLines: 8, leading:1.2 }, box||{});
  const font = fonts.body;
  const lineHeight = cfg.size * cfg.leading;
  const lines = splitIntoLines(t, font, cfg.size, cfg.w);
  const count = Math.min(cfg.maxLines||lines.length, lines.length);
  for (let i=0; i<count; i++){
    const y = cfg.y - (i * lineHeight);
    const textLine = lines[i];
    let x = cfg.x;
    if (cfg.align === "center") {
      const lnw = font.widthOfTextAtSize(textLine, cfg.size);
      x = cfg.x + (cfg.w - lnw)/2;
    } else if (cfg.align === "right") {
      const lnw = font.widthOfTextAtSize(textLine, cfg.size);
      x = cfg.x + (cfg.w - lnw);
    }
    page.drawText(textLine, { x, y, size: cfg.size, font, color: rgb(0,0,0) });
  }
  return { lines: count };
}

function drawBulletedList(page, items, box, fonts, indent = 18){
  const t = (Array.isArray(items)?items:[]).map(s=>String(s||"").trim()).filter(Boolean);
  if (!t.length) return 0;
  const cfg = Object.assign({ x:0, y:0, w:500, size:12, maxLines:8, leading:1.2, split:true }, box||{});
  const font = fonts.body;
  const bullet = "• ";
  const lineHeight = cfg.size * cfg.leading;
  let y = cfg.y;
  let linesDrawn = 0;

  for (const item of t){
    // split the item respecting width (after bullet)
    const firstWidth = cfg.w - indent;
    const lines = splitIntoLines(item, font, cfg.size, firstWidth);
    for (let i=0; i<lines.length; i++){
      const isFirst = (i===0);
      const prefix = isFirst ? bullet : "  ";
      const x = cfg.x + (isFirst?0:indent);
      const text = isFirst ? lines[i] : lines[i];
      const print = prefix + text;
      page.drawText(print, { x, y, size: cfg.size, font, color: rgb(0,0,0) });
      y -= lineHeight; linesDrawn++;
      if (cfg.maxLines && linesDrawn >= cfg.maxLines) return linesDrawn;
    }
  }
  return linesDrawn;
}

async function embedPng(page, pdfDoc, url, x, y, w, h){
  if (!url) return false;
  const bytes = await loadBytes(url);
  const img = await pdfDoc.embedPng(bytes);
  const iw = img.width, ih = img.height;
  let dw = w, dh = h;
  if (!dw && !dh){ dw = iw; dh = ih; }
  else if (!dh){ dh = (iw? (ih * (dw/iw)) : h); }
  else if (!dw){ dw = (ih? (iw * (dh/ih)) : w); }
  page.drawImage(img, { x, y, width: dw, height: dh });
  return true;
}

/** Main: fillTemplate(bufferTpl, data) => Uint8Array */
async function fillTemplate(tplBytes, data){
  const pdfDoc = await PDFDocument.load(tplBytes);
  const pages = pdfDoc.getPages();

  // Fonts
  const fontBody = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonts = { body: fontBody };

  // Layout meta
  const L = Object(data.layoutV6 || {});
  const p1 = L.p1 || {};
  const p3 = L.p3 || {};
  const p4 = L.p4 || {};
  const p5 = L.p5 || {};
  const p6 = L.p6 || {};
  const p11 = L.p11 || {};

  // PAGE 1 — Name & Date (unchanged behavior)
  if (pages[0] && L.p1) {
    const pg = pages[0];
    const name = pick(data.person?.fullName, data.name);
    if (p1.name)  drawTextBox(pg, name,  p1.name,  fonts);
    if (p1.date)  drawTextBox(pg, pick(data.dateLbl), p1.date, fonts);
  }

  // PAGE 3 — dominant labels + description (unchanged behavior)
  if (pages[2] && L.p3) {
    const pg = pages[2];
    if (p3.domChar)  drawTextBox(pg, data.domchar, p3.domChar, fonts);
    if (p3.domDesc)  drawTextBox(pg, data.domdesc, p3.domDesc, fonts);
    if (p3.domLabel) drawTextBox(pg, data.dom,     p3.domLabel, fonts);
    // (Your state boxes / "You are here" rendering remains as in your template imagery.)
  }

  // PAGE 4 — CHART + SPIDER TEXT (*** NEW TEXT DRAW ADDED ***)
  if (pages[3] && L.p4) {
    const pg = pages[3];
    // Chart image (kept as before; transparent/circular handled upstream)
    if (p4.chart) {
      const b = p4.chart;
      await embedPng(pg, pdfDoc, pick(data.chart, data.chartUrl), b.x, b.y, b.w, b.h);
    }
    // Spider explanation — this was missing before
    if (p4.spider) {
      const txt = pick(data.spiderdesc, data["p4:spiderdesc"]);
      drawTextBox(pg, txt, p4.spider, fonts);
    }
    // Optional: frequency line if you mapped it in layout
    if (p4.spiderFreq) {
      const freq = pick(data.spiderfreq);
      drawTextBox(pg, freq, p4.spiderFreq, fonts);
    }
  }

  // PAGE 5 — pattern shape text (unchanged; make sure layoutV6.p5.seqpat exists)
  if (pages[4] && p5.seqpat) {
    drawTextBox(pages[4], pick(data.seqpat, data.seqat), p5.seqpat, fonts);
  }

  // PAGE 6 — theme explainer (unchanged)
  if (pages[5] && p6.theme) {
    drawTextBox(pages[5], pick(data.theme, data.themes?.text), p6.theme, fonts);
  }

  // PAGE 11 — tips & actions with indentation (unchanged; respects your indent ask)
  if (pages[10] && p11.split) {
    const pg = pages[10];
    const t1 = Array.isArray(data.tips)    ? data.tips    : [];
    const a1 = Array.isArray(data.actions) ? data.actions : [];
    if (p11.tips1)    drawBulletedList(pg, t1, p11.tips1,    fonts, p11.bulletIndent || 18);
    if (p11.tips2)    drawBulletedList(pg, t1.slice(2), p11.tips2, fonts, p11.bulletIndent || 18);
    if (p11.acts1)    drawBulletedList(pg, a1, p11.acts1,    fonts, p11.bulletIndent || 18);
    if (p11.acts2)    drawBulletedList(pg, a1.slice(2), p11.acts2, fonts, p11.bulletIndent || 18);
  }

  return await pdfDoc.save();
}

/** HTTP handler (your service entrypoint) */
module.exports = async function handler(req, res){
  try{
    const tpl = req.query.tpl || "CTRL_Perspective_Assessment_Profile_template_slim.pdf";
    const dataB64 = req.query.data || "";
    const outName = req.query.out || "CTRL_Perspective.pdf";
    const chart = req.query.chart; // optional direct chart param
    const data = dataB64 ? JSON.parse(decodeURIComponent(Buffer.from(dataB64, "base64").toString("utf8"))) : {};
    if (chart && !data.chart && !data.chartUrl) data.chart = chart;

    const tplBytes = await loadBytes(tpl.startsWith("http")? tpl : `public/${tpl}`);
    const out = await fillTemplate(tplBytes, data);

    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",`inline; filename="${outName}"`);
    res.send(Buffer.from(out));
  }catch(err){
    res.status(500).json({ ok:false, error: String(err && err.message || err) });
  }
};
