// Force Node runtime (NOT Edge)
export const config = { runtime: 'nodejs' };

// /api/pdf.js — CTRL report (overview + radar + chart explainer + raw data)
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---- ANSI sanitiser (arrows, dashes, bullets, quotes, emojis) ----
function toAnsi(s) {
  if (!s) return '';
  return String(s)
    .replace(/→|⇒|➔|➜|⟶/g, '->')
    .replace(/←|⇐|⟵/g, '<-')
    .replace(/↔|⇔/g, '<->')
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, '*')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\x7F]/g, '');
}
function wrapAnsi(text, maxChars) {
  const words = toAnsi(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (next.length > maxChars) { if (line) lines.push(line); line = w; }
    else { line = next; }
  }
  if (line) lines.push(line);
  return lines;
}
function drawHeading(page, fontB, x, y, text) {
  page.drawText(toAnsi(text), { x, y, size: 13, font: fontB, color: rgb(0,0,0) });
  return y - 18;
}
function drawPara(page, font, x, y, text, lineLen=98) {
  for (const ln of wrapAnsi(text, lineLen)) {
    page.drawText(ln, { x, y, size: 11, font, color: rgb(0,0,0) }); y -= 14;
  }
  return y - 4;
}
function drawBullets(page, font, x, y, arr, lineLen=94) {
  for (const raw of arr || []) {
    const lines = wrapAnsi('* ' + raw, lineLen);
    for (const ln of lines) { page.drawText(ln, { x, y, size: 11, font }); y -= 14; }
  }
  return y - 4;
}

export default async function handler(req, res) {
  try {
    const name = String(req.query.name || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');

    // Payload format (all optional; sensible defaults below)
    // {
    //   title: "CTRL — Your Snapshot",
    //   overview: "plain text",                     // full user copy
    //   chartUrl: "https://quickchart.io/chart?c=...",
    //   chartExplainer: ["line 1", "line 2"],       // 2–3 short lines
    //   raw: {
    //     sequence: "R T C T R",
    //     counts: {C:1,T:2,R:2,L:0},
    //     perQuestion: [ {q:"Q1", state:"R", stateName:"Regulated", themes:["..."]}, ... ],
    //     themes: ["awareness_impact","social_navigation"]
    //   }
    // }

    let payload = null;
    if (req.query.data) {
      try {
        const json = Buffer.from(String(req.query.data), 'base64').toString('utf8');
        payload = JSON.parse(json);
      } catch (e) {
        console.error('Bad payload:', e);
      }
    }

    const p = Object.assign({
      title: "CTRL — Your Snapshot",
      overview: "A short reflection of how you showed up across five moments.",
      chartUrl: null,
      chartExplainer: [],
      raw: {
        sequence: "R T C T R",
        counts: { C:1, T:2, R:2, L:0 },
        perQuestion: [],
        themes: []
      }
    }, payload || {});

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4 portrait
    const { width, height } = page.getSize();
    const margin = 40;
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
    let y = height - margin;

    // Title
    page.drawText(toAnsi(p.title || "CTRL — Your Snapshot"), {
      x: margin, y, size: 18, font: fontB, color: rgb(0,0,0)
    });
    y -= 26;

    // 1) Overview
    y = drawHeading(page, fontB, margin, y, "Overview");
    y = drawPara(page, font, margin, y, p.overview || "");

    // 2) Radar (if provided)
    if (p.chartUrl && y > 260) {
      try {
        const resp = await fetch(p.chartUrl);
        const buf = new Uint8Array(await resp.arrayBuffer());
        let img; try { img = await pdf.embedPng(buf); } catch { img = await pdf.embedJpg(buf); }
        const maxW = width - margin * 2;
        const w = Math.min(maxW, 440);
        const h = w * (img.height / img.width);
        y = drawHeading(page, fontB, margin, y, "CTRL Radar (frequency across five moments)");
        page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
        y -= (h + 12);
      } catch (e) { console.error('Chart fetch failed:', e); }
    }

    // 3) About the chart
    if (Array.isArray(p.chartExplainer) && p.chartExplainer.length) {
      y = drawHeading(page, fontB, margin, y, "About the chart");
      y = drawBullets(page, font, margin, y, p.chartExplainer);
    }

    // 4) Raw data
    y = drawHeading(page, fontB, margin, y, "Raw data");
    // Sequence
    if (p.raw && p.raw.sequence) {
      y = drawPara(page, font, margin, y, `Sequence: ${p.raw.sequence}`);
    }
    // Counts
    if (p.raw && p.raw.counts) {
      const c = p.raw.counts;
      y = drawPara(page, font, margin, y, `Counts - C:${c.C||0}  T:${c.T||0}  R:${c.R||0}  L:${c.L||0}`);
    }
    // Per-question
    if (Array.isArray(p.raw?.perQuestion) && p.raw.perQuestion.length) {
      y = drawHeading(page, fontB, margin, y, "Per question");
      for (const row of p.raw.perQuestion) {
        const line = `${row.q}: ${row.state || ''}${row.stateName ? ` (${row.stateName})` : ''}`.trim();
        y = drawPara(page, font, margin, y, line);
        if (Array.isArray(row.themes) && row.themes.length) {
          y = drawPara(page, font, margin, y, `  Themes: ${row.themes.join(', ')}`);
        }
        y -= 4;
        if (y < 120) { // new page if needed
          const newPage = pdf.addPage([595.28, 841.89]);
          y = 841.89 - margin;
          page.drawText(" ", {x:0,y:0,size:1,font}); // quiet linter
        }
      }
    }
    // Themes list
    if (Array.isArray(p.raw?.themes) && p.raw.themes.length) {
      y = drawHeading(page, fontB, margin, y, "Themes seen");
      y = drawBullets(page, font, margin, y, p.raw.themes);
    }

    // Footer
    page.drawText(toAnsi("CTRL - Generated by /api/pdf"), {
      x: margin, y: 30, size: 9, font, color: rgb(0.4,0.4,0.4)
    });

    const bytes = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    console.error('PDF error:', e);
    const debug = String(req.query.debug||'')==='1';
    res.status(500).send(debug ? `Error generating PDF: ${String(e && e.message || e)}` : 'Error generating PDF');
  }
}
