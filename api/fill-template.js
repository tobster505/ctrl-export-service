// /api/fill-template.js
// Fills the static template PDF with your dynamic fields.
// Assumes the template file lives at /public/CTRL_Perspective_template.pdf

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- small helpers ----------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const squash = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // pure ASCII (pdfkit/pdf-lib safe)

function absUrl(req, path) {
  const host = req?.headers?.host || 'ctrl-export-service.vercel.app';
  return `https://${host}${path.startsWith('/') ? path : '/' + path}`;
}

// Extract just the state word if the caller still sends a sentence like
// "You sit mostly in Triggered 🔥."
function extractState(headline) {
  const s = String(headline || '');
  const hit = /(Concealed|Triggered|Regulated|Lead)/i.exec(s);
  return hit ? hit[1][0].toUpperCase() + hit[1].slice(1).toLowerCase() : s;
}

// Simple wrapper with width + lines + ellipsis control
function drawTextBox(page, font, text, box, opts = {}) {
  const {
    x, y, w, size = 12, lineGap = 2, color = rgb(0, 0, 0), align = 'left',
  } = box;

  const maxLines = clamp(opts.maxLines ?? 4, 1, 20);
  const ellipsis = !!opts.ellipsis;

  const words = squash(text).split(/\s+/);
  const lines = [];
  let cur = '';

  const measure = (t) => font.widthOfTextAtSize(t, size);

  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (measure(test) <= w) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);

  if (ellipsis && lines.length === maxLines) {
    // Ensure last line fits with "…"
    let last = lines.pop() || '';
    const dot = '…';
    while (measure(last + dot) > w && last.length) last = last.slice(0, -1);
    lines.push(last + dot);
  }

  // draw
  let yy = y; // baseline of first line
  for (const ln of lines) {
    let xx = x;
    if (align === 'center') {
      xx = x + (w - measure(ln)) / 2;
    } else if (align === 'right') {
      xx = x + (w - measure(ln));
    }
    page.drawText(ln, { x: xx, y: yy, size, font, color });
    yy -= size + lineGap;
  }
}

// Build a QuickChart radar if none provided (counts optional)
function radarUrl(counts = { C: 0, T: 0, R: 0, L: 0 }) {
  const spec = {
    type: 'radar',
    data: {
      labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
      datasets: [
        {
          label: 'Frequency',
          data: [counts.C || 0, counts.T || 0, counts.R || 0, counts.L || 0],
          fill: true,
          backgroundColor: 'rgba(115,72,199,0.18)',
          borderColor: '#7348C7',
          borderWidth: 2,
          pointRadius: 3,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0,
          max: 5,
          ticks: { display: true, stepSize: 1, backdropColor: 'rgba(0,0,0,0)' },
          grid: { circular: true },
          angleLines: { display: true },
          pointLabels: { color: '#4A4458', font: { size: 12 } },
        },
      },
    },
  };
  return `https://quickchart.io/chart?v=4&c=${encodeURIComponent(JSON.stringify(spec))}`;
}

// ---------- absolute positions on your template ----------
// All units are PDF points (1pt = 1/72 inch). (0,0) is bottom-left.
// These numbers are tuned to your latest screenshot/template.
// Adjust here to fine-tune placement.
const POS = {
  // Big headline word inside “Your current state is …” box (page 1)
  headlineState: { x: 90, y: 370, w: 860, size: 72, lineGap: 4, color: rgb(0.12, 0.11, 0.2) },

  // “Direction of travel” (page 1, right of radar)
  directionLabel:   { x: 330, y: 410, w: 230, size: 14, color: rgb(0.2, 0.16, 0.35) },
  directionMeaning: { x: 330, y: 392, w: 330, size: 11, color: rgb(0.21, 0.21, 0.29), lineGap: 2 },

  // “Theme in focus” (page 1, under direction)
  themeLabel:       { x: 330, y: 360, w: 230, size: 14, color: rgb(0.2, 0.16, 0.35) },
  themeMeaning:     { x: 330, y: 342, w: 330, size: 11, color: rgb(0.21, 0.21, 0.29), lineGap: 2 },

  // Tips (page 1) — left and right cards
  tip1:             { x: 64,  y: 190, w: 500, size: 11, color: rgb(0.21, 0.21, 0.29), lineGap: 2 },
  tip2:             { x: 590, y: 190, w: 500, size: 11, color: rgb(0.21, 0.21, 0.29), lineGap: 2 },

  // Pattern (page 1) — below the radar band
  patternLabel:     { x: 64,  y: 240, w: 300, size: 12, color: rgb(0.2, 0.16, 0.35) },
  patternMeaning:   { x: 64,  y: 222, w: 860, size: 11, color: rgb(0.21, 0.21, 0.29), lineGap: 2 },

  // Radar chart image (page 1, left)
  radar:            { x: 96,  y: 340, w: 180, h: 180 },

  // Copyright (tiny, bottom)
  copyright:        { x: 64,  y: 48,  w: 820, size: 8,  color: rgb(0.35, 0.33, 0.45) },
};

// ---------- main handler ----------
export default async function handler(req, res) {
  try {
    // 1) decode payload
    const url = new URL(req.url, 'http://localhost');
    const test = url.searchParams.has('test');
    const b64  = url.searchParams.get('data');

    let payload;
    if (test && !b64) {
      // a tiny sample so you can open /api/fill-template?test=1
      payload = {
        headline: 'You sit mostly in Triggered.',
        headlineMeaning:
          "Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.",
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones — steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        tip1: 'Take one breath and name it: “I’m on edge.”',
        tip2: 'Choose your gear on purpose: protect, steady, or lead — say it in one line.',
        patternLabel: 'What the pattern suggests',
        patternMeaning: 'A mix of moves without a single rhythm. You changed state 2 times; longest run: Triggered × 2.',
        counts: { C: 1, T: 3, R: 1, L: 0 },
      };
    } else {
      if (!b64) { res.status(400).send('Missing data'); return; }
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        res.status(400).send('Invalid data'); return;
      }
    }

    // 2) load template
    const templateUrl = absUrl(req, '/CTRL_Perspective_template.pdf');
    const tr = await fetch(templateUrl);
    if (!tr.ok) { res.status(500).send('Template fetch failed'); return; }
    const templateBytes = await tr.arrayBuffer();

    // 3) prepare doc + fonts
    const pdf = await PDFDocument.load(templateBytes);
    const helv     = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const page1 = pdf.getPages()[0];

    // 4) radar image
    const chartUrl = payload.chartUrl || radarUrl(payload.counts);
    try {
      const cr = await fetch(chartUrl);
      if (cr.ok) {
        const png = await cr.arrayBuffer();
        const img = await pdf.embedPng(png);
        const r = POS.radar;
        page1.drawImage(img, {
          x: r.x,
          y: r.y,
          width: r.w,
          height: r.h,
        });
      }
    } catch {
      // ignore chart failure; continue
    }

    // 5) HEADLINE (just the state word)
    const stateWord = extractState(payload.headline);
    drawTextBox(page1, helvBold, stateWord, POS.headlineState, align: 'center', { maxLines: 1, ellipsis: true });

    // 6) DIRECTION (label + meaning)
    if (payload.directionLabel) {
      drawTextBox(page1, helvBold, payload.directionLabel, POS.directionLabel, { maxLines: 1, ellipsis: true });
    }
    if (payload.directionMeaning) {
      drawTextBox(page1, helv, payload.directionMeaning, POS.directionMeaning, { maxLines: 3, ellipsis: true });
    }

    // 7) THEME (label + meaning)
    if (payload.themeLabel) {
      drawTextBox(page1, helvBold, payload.themeLabel, POS.themeLabel, { maxLines: 1, ellipsis: true });
    }
    if (payload.themeMeaning) {
      drawTextBox(page1, helv, payload.themeMeaning, POS.themeMeaning, { maxLines: 3, ellipsis: true });
    }

    // 8) TIPS (come early on the page)
    if (payload.tip1) drawTextBox(page1, helv, payload.tip1, POS.tip1, { maxLines: 3, ellipsis: true });
    if (payload.tip2) drawTextBox(page1, helv, payload.tip2, POS.tip2, { maxLines: 3, ellipsis: true });

    // 9) PATTERN (after tips)
    if (payload.patternLabel) {
      drawTextBox(page1, helvBold, payload.patternLabel, POS.patternLabel, { maxLines: 1, ellipsis: true });
    }
    if (payload.patternMeaning) {
      drawTextBox(page1, helv, payload.patternMeaning, POS.patternMeaning, { maxLines: 3, ellipsis: true });
    }

    // 10) Copyright footer (static text; tweak freely)
    const copyright =
      '© 2025 Toby Newman (CTRL Model). All rights reserved. This report is for personal use only and may not be reproduced, distributed, or used commercially without written permission.';
    drawTextBox(page1, helv, copyright, POS.copyright, { maxLines: 2, ellipsis: true });

    // 11) stream PDF
    const bytes = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="ctrl_profile.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    console.error('[fill-template] error', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
