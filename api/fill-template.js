// /api/fill-template.js
// Vercel serverless (ESM). User PDF ONLY.
// Loads template strictly from /public and fills fields without touching any coach flow.
//
// Notes:
// - Safe against missing fields; skips gracefully.
// - Draws Page 4 chart from counts or spiderfreq text (no external fetch).
// - Omits any "Theme pair" title; prints the pair and explanation only.
// - Renders workWith, tips, actions from multiple possible keys.

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- util: __dirname (ESM) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- tiny helpers ----------
const S  = (v, fb = '') => (v == null ? String(fb) : String(v));
const N  = (v, fb = 0)  => (Number.isFinite(+v) ? +v : +fb);
const A  = (v) => (Array.isArray(v) ? v : []);
const G  = (o, k, fb = '') => S((o && o[k]) ?? fb, fb);
const okObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- DEFAULT COORDS (from your stored baseline) ----------
const CHART = { x: 1030, y: 620, w: 720, h: 420 }; // Page 4 chart area
// Page 6 (theme pair) – we only print pair + expl (no label)
const P6    = {
  themeX:  90, themeY: 1030, themeW: 820, themeSize: 26, themeMax: 1,
  explX:   90, explY:  980,  explW: 820, explSize: 18, explMax: 8
};
// Page 7 Tips/Actions defaults (from your “Page 7” memory)
const P7 = {
  tips:   { x: 30,  y: 530, w: 300, size: 17, align: 'left', max: 12 },
  acts:   { x: 320, y: 530, w: 300, size: 17, align: 'left', max: 12 },
  bullet: { indent: 14, gap: 2 }
};

// Simple text block writer with wrapping
function drawWrappedText(page, text, x, y, w, size, font, color = rgb(0,0,0), lineGap = 4, maxLines = Infinity) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  if (!words.length) return y;
  let line = '', yy = y, lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(test, size);
    if (width > w && line) {
      page.drawText(line, { x, y: yy, size, font, color });
      lines++; if (lines >= maxLines) return yy;
      yy -= size + lineGap;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: yy, size, font, color });
    yy -= size + lineGap;
  }
  return yy;
}

// Bullet list writer
function drawBullets(page, items, x, y, w, size, font, opts = {}) {
  const gap = opts.gap ?? 2;
  const indent = opts.indent ?? 14;
  let yy = y;
  for (const it of items) {
    const bullet = '• ';
    page.drawText(bullet, { x, y: yy, size, font });
    yy = drawWrappedText(page, it, x + indent, yy, w - indent, size, font, rgb(0,0,0), gap);
  }
  return yy;
}

// Parse counts from data.counts or from spiderfreq string "C:1 · T:3 · R:0 · L:1"
function getCounts(data) {
  const counts = okObj(data.counts) ? data.counts : {};
  let C = N(counts.C, NaN);
  let T = N(counts.T, NaN);
  let R = N(counts.R, NaN);
  let L = N(counts.L, NaN);

  if ([C,T,R,L].some(isNaN)) {
    const raw = S(data['p4:spiderfreq'] || data.spiderfreq || data.spiderFreq || '');
    const mC = raw.match(/C\s*:\s*(\d+)/i);
    const mT = raw.match(/T\s*:\s*(\d+)/i);
    const mR = raw.match(/R\s*:\s*(\d+)/i);
    const mL = raw.match(/L\s*:\s*(\d+)/i);
    C = N(mC && mC[1], 0);
    T = N(mT && mT[1], 0);
    R = N(mR && mR[1], 0);
    L = N(mL && mL[1], 0);
  }
  return { C, T, R, L };
}

// Draw a simple 4-bar chart (C, T, R, L) in the reserved area
function drawCTRLBars(page, font, counts, area = CHART) {
  const vals = [counts.C, counts.T, counts.R, counts.L];
  const labels = ['C','T','R','L'];
  const maxVal = Math.max(1, ...vals);
  const pad = 30;
  const innerW = area.w - 2*pad;
  const innerH = area.h - 2*pad;
  const barW = innerW / (vals.length * 2);
  const baseX = area.x + pad;
  const baseY = area.y + pad;

  // Axes
  page.drawLine({
    start: { x: baseX, y: baseY },
    end:   { x: baseX, y: baseY + innerH },
    thickness: 1, color: rgb(0,0,0)
  });
  page.drawLine({
    start: { x: baseX, y: baseY },
    end:   { x: baseX + innerW, y: baseY },
    thickness: 1, color: rgb(0,0,0)
  });

  // Bars + labels
  vals.forEach((v, i) => {
    const x = baseX + (i*2 + 0.5)*barW;
    const h = innerH * (v / maxVal);
    page.drawRectangle({
      x, y: baseY, width: barW, height: h, color: rgb(0.2,0.2,0.2)
    });
    // value
    const valStr = String(v);
    page.drawText(valStr, {
      x: x + barW/2 - font.widthOfTextAtSize(valStr, 12)/2,
      y: baseY + h + 6, size: 12, font, color: rgb(0,0,0)
    });
    // label
    page.drawText(labels[i], {
      x: x + barW/2 - font.widthOfTextAtSize(labels[i], 12)/2,
      y: baseY - 18, size: 12, font, color: rgb(0,0,0)
    });
  });
}

// Extract workWith blocks in a robust way.
// Returns an array of { title, look, work } strings to render.
function getWorkWith(data) {
  // Preferred: data.workWith = { C:[{look,work}], T:[], R:[], L:[] } (or .col)
  const out = [];

  const maybePush = (title, arr) => {
    A(arr).forEach((o) => {
      if (okObj(o)) {
        const look = S(o.look).trim();
        const work = S(o.work).trim();
        if (look || work) out.push({ title, look, work });
      }
    });
  };

  if (okObj(data.workWith)) {
    const W = data.workWith;
    maybePush('Concealed', W.C ?? W.col);
    maybePush('Triggered', W.T ?? W.t);
    maybePush('Regulated', W.R ?? W.r);
    maybePush('Lead',      W.L ?? W.l);
  }

  // Legacy keys: workwcol, workwt, workwr, workwl
  if (!out.length) {
    maybePush('Concealed', data.workwcol);
    maybePush('Triggered', data.workwt);
    maybePush('Regulated', data.workwr);
    maybePush('Lead',      data.workwl);
  }

  // Ultra-legacy: top-level array of {look,work}
  if (!out.length && Array.isArray(data.workWith)) {
    data.workWith.forEach((o, idx) => {
      if (okObj(o) && (o.look || o.work)) {
        out.push({ title: `Block ${idx+1}`, look: S(o.look), work: S(o.work) });
      }
    });
  }

  return out;
}

// Extract tips/actions arrays (strings).
function getTipsActions(data) {
  const tips = A(data.tips).map(S).filter(Boolean);
  const actions = A(data.actions).map(S).filter(Boolean);
  return { tips, actions };
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    // Inputs
    const tplFile = S(req.query.tpl, 'CTRL_Perspective_Assessment_Profile_template_slim.pdf').trim();
    const outName = S(req.query.out, '').trim();
    const dataParam = req.query.data;

    // Decode data (supports raw JSON or base64 JSON)
    let data = {};
    if (typeof dataParam === 'string' && dataParam.length) {
      try {
        data = JSON.parse(dataParam);
      } catch {
        const buf = Buffer.from(dataParam, 'base64');
        data = JSON.parse(buf.toString('utf8'));
      }
    }

    // Enforce /public
    const publicDir = path.join(__dirname, '..', 'public');
    const absTpl = path.join(publicDir, tplFile);
    // Security: ensure resolved path stays inside /public
    if (!absTpl.startsWith(publicDir)) {
      return res.status(400).json({ ok: false, error: 'Invalid template path.' });
    }

    // Load template
    let tplBytes;
    try {
      tplBytes = await fs.readFile(absTpl);
    } catch {
      return res.status(404).json({ ok: false, error: `Template not found in /public: ${tplFile}` });
    }

    const pdf = await PDFDocument.load(tplBytes);
    const pages = pdf.getPages();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // ------- PAGE 1: Name & Date (kept as-is) -------
    // Fields used commonly in your flow:
    // p1:n (name), p1:d (date label) or dateLbl, person.fullName
    {
      const p1 = pages[0];
      const fullName = S(data['p1:n'] || data?.person?.fullName || data.FullName || data.fullName).trim();
      const dateLbl  = S(data['p1:d'] || data.dateLbl || data.dateLabel || '').trim();

      if (fullName) p1.drawText(fullName, { x: 100, y: 1030, size: 28, font: bold });
      if (dateLbl)  p1.drawText(dateLbl,   { x: 100, y:  995, size: 16, font });
    }

    // ------- PAGE 3: Dominant (kept as-is) -------
    // p3:dom (Triggered), p3:domchar (Fal), p3:domdesc
    if (pages[2]) {
      const p3 = pages[2];
      const dom     = S(data['p3:dom'] || data.dom).trim();
      const domchar = S(data['p3:domchar'] || data.domchar || data.domChar).trim();
      const domdesc = S(data['p3:domdesc'] || data.domdesc || data.domDesc).trim();

      if (dom)     p3.drawText(dom,     { x: 100, y: 1030, size: 26, font: bold });
      if (domchar) p3.drawText(domchar, { x: 100, y:  995, size: 18, font });
      if (domdesc) drawWrappedText(p3, domdesc, 100, 960, 820, 16, font, rgb(0,0,0), 4, 14);
    }

    // ------- PAGE 4: Spider freq + chart (FIXED) -------
    // p4:spiderdesc, p4:spiderfreq, p4:spiderkey
    if (pages[3]) {
      const p4 = pages[3];
      const spiderDesc = S(data['p4:spiderdesc'] || data.spiderdesc || data.spiderDesc);
      const spiderFreq = S(data['p4:spiderfreq'] || data.spiderfreq || data.spiderFreq);
      const counts     = getCounts(data);

      if (spiderDesc) drawWrappedText(p4, spiderDesc, 100, 1030, 820, 16, font, rgb(0,0,0), 4, 12);
      if (spiderFreq) p4.drawText(spiderFreq, { x: 100, y: 830, size: 14, font });

      // Chart (always attempt to draw; ignores incoming chart:false)
      drawCTRLBars(p4, font, counts, CHART);
    }

    // ------- PAGE 5: Sequence pattern (kept as-is) -------
    // p5:seqpat
    if (pages[4]) {
      const p5 = pages[4];
      const seqpat = S(data['p5:seqpat'] || data.seqpat || data.seqPat);
      if (seqpat) drawWrappedText(p5, seqpat, 100, 1030, 820, 16, font, rgb(0,0,0), 4, 14);
    }

    // ------- PAGE 6: Theme Pair (NO title printed) -------
    // p6:theme  + p6:themeExpl
    if (pages[5]) {
      const p6 = pages[5];
      const theme    = S(data['p6:theme'] || data['p6:pair'] || data.theme || data.themeKey);
      const themeExp = S(data['p6:themeExpl'] || data.themeExpl || data['p6:expl'] || data['p6:pairExpl']);

      // Do NOT draw any label like "Theme pair" — per your request.
      if (theme) {
        // Larger, single line
        p6.drawText(theme, { x: P6.themeX, y: P6.themeY, size: P6.themeSize, font: bold });
      }
      if (themeExp) {
        drawWrappedText(p6, themeExp, P6.explX, P6.explY, P6.explW, P6.explSize, font, rgb(0,0,0), 4, P6.explMax);
      }
    }

    // ------- PAGE 7: Tips & Actions (robust) -------
    // tips:[], actions:[]
    if (pages[6]) {
      const p7 = pages[6];
      const { tips, actions } = getTipsActions(data);

      if (tips.length) {
        p7.drawText('Tips', { x: P7.tips.x, y: P7.tips.y + 32, size: 18, font: bold });
        drawBullets(p7, tips, P7.tips.x, P7.tips.y, P7.tips.w, P7.tips.size, font, P7.bullet);
      }
      if (actions.length) {
        p7.drawText('Actions', { x: P7.acts.x, y: P7.acts.y + 32, size: 18, font: bold });
        drawBullets(p7, actions, P7.acts.x, P7.acts.y, P7.acts.w, P7.acts.size, font, P7.bullet);
      }
    }

    // ------- PAGE 8+: Work With Me (robust) -------
    // Renders up to 4 blocks of {title, look, work}, 2 per page if present.
    const workWith = getWorkWith(data);
    if (workWith.length) {
      // Start on page 8 if available
      let idx = 0;
      let pageIdx = 7; // 0-based (page 8 visually)
      while (idx < workWith.length && pages[pageIdx]) {
        const pg = pages[pageIdx];
        const leftY  = 1030;
        const rightY = 600;

        for (let col = 0; col < 2 && idx < workWith.length; col++, idx++) {
          const blk = workWith[idx];
          const baseX = col === 0 ? 90 : 480;
          let y = col === 0 ? leftY : rightY;

          // Title (e.g., "Triggered")
          if (blk.title) pg.drawText(blk.title, { x: baseX, y, size: 18, font: bold });
          y -= 26;

          if (blk.look) {
            pg.drawText('What to look for', { x: baseX, y, size: 14, font: bold });
            y -= 20;
            y = drawWrappedText(pg, blk.look, baseX, y, 320, 14, font, rgb(0,0,0), 3, 8);
            y -= 10;
          }
          if (blk.work) {
            pg.drawText('How to work with me', { x: baseX, y, size: 14, font: bold });
            y -= 20;
            y = drawWrappedText(pg, blk.work, baseX, y, 320, 14, font, rgb(0,0,0), 3, 10);
            y -= 6;
          }
        }
        pageIdx++;
      }
    }

    // ------- Output -------
    const bytes = await pdf.save();
    const filename = outName || 'CTRL_Perspective_Profile.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.status(200).send(Buffer.from(bytes));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: 'FUNCTION_INVOCATION_FAILED',
      detail: String(err && err.message || err)
    });
  }
}
