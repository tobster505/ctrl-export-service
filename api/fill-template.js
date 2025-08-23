// /api/fill-template.js
// Fills the CTRL Perspective Profile (single page) using pdf-lib.
// Works with or without a background template at /public/CTRL_Perspective_template.pdf
// GET params:
//   - data=<base64 JSON payload>   (from Botpress)
//   - name=<filename.pdf>          (optional)
//   - test=1                       (renders a self-contained sample to smoke-test)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- tiny utils ----------
const squash = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

const mm = (n) => (n * 72) / 25.4; // millimetres → PDF points

const HEX = (hex) => {
  const s = hex.replace('#', '');
  const r = parseInt(s.substring(0, 2), 16) / 255;
  const g = parseInt(s.substring(2, 4), 16) / 255;
  const b = parseInt(s.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
};

// Mauve single-hue palette (no good/bad signalling)
const COLORS = {
  ink: HEX('#2B2635'),
  sub: HEX('#4A4458'),
  accent: HEX('#7348C7'),
  accentLight: HEX('#9D7BE0'),
  wash: HEX('#F2EFFA'),
  box: HEX('#F5F5F7'),
  line: HEX('#E6E4EC'),
};

// default sample payload for ?test=1
function samplePayload(origin) {
  const chartSpec = {
    type: 'radar',
    data: {
      labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
      datasets: [
        {
          label: 'Frequency',
          data: [1, 3, 1, 0],
          fill: true,
          backgroundColor: 'rgba(115,72,199,0.18)',
          borderColor: '#7348C7',
          borderWidth: 2,
          pointRadius: [3, 6, 3, 0],
          pointBackgroundColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
          pointBorderColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0']
        },
        {
          label: '',
          data: [0, 3, 0, 0],
          fill: false,
          borderWidth: 0,
          pointRadius: [0, 9, 0, 0],
          pointStyle: 'rectRot',
          pointBackgroundColor: '#7348C7',
          pointBorderColor: '#7348C7'
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 5,
          ticks: { display: true, stepSize: 1, backdropColor: 'rgba(0,0,0,0)' },
          grid: { circular: true },
          angleLines: { display: true },
          pointLabels: { color: '#4A4458', font: { size: 12 } }
        }
      }
    }
  };

  return {
    title: 'CTRL — Perspective Profile',
    intro:
      'A quick snapshot of how your responses clustered across four states. Treat it as orientation, not a verdict.',
    headline: 'You sit mostly in Triggered.',
    how:
      "You feel things fast and show it. Energy rises quickly. A brief pause or naming the wobble ('I’m on edge') often settles it.",
    directionLabel: 'Steady',
    directionMeaning: 'You started and ended in similar zones — steady overall.',
    themeLabel: 'Emotion regulation',
    themeMeaning: 'Settling yourself when feelings spike.',
    tip1: 'Take one breath and name it: “I’m on edge.”',
    tip2: 'Choose your gear on purpose: protect, steady, or lead—say it in one line.',
    journey: [
      'Most seen: Triggered. Least seen: Lead.',
      'Lead didn’t show up in this snapshot.',
      'You started in Triggered and ended in Triggered — a steady line.',
      'You changed state 3 time(s) out of 4; longest run: Triggered × 2.'
    ],
    themesExplainer: [
      'emotion regulation — Settling yourself when feelings spike.',
      'social navigation — Reading the room and adjusting to people and context.',
      'awareness of impact — Noticing how your words and actions land.'
    ],
    chartUrl:
      'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(chartSpec)),
    raw: {
      sequence: 'T T C R T',
      counts: { C: 1, T: 3, R: 1, L: 0 }
    }
  };
}

// word-wrap into a box
function drawWrappedText(page, text, opts) {
  const {
    x, y, w, h,
    font, size = 11,
    color = COLORS.ink,
    lineGap = 3,
    align = 'left'
  } = opts;

  const words = squash(text).split(/\s+/);
  const lh = size + lineGap;
  let cx = x, cy = y;
  let line = '';
  const lines = [];

  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    const width = font.widthOfTextAtSize(test, size);
    if (width <= w) {
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  let used = 0;
  for (const ln of lines) {
    if (used + lh > h) break;
    let tx = cx;
    const lw = font.widthOfTextAtSize(ln, size);
    if (align === 'center') tx = x + (w - lw) / 2;
    if (align === 'right') tx = x + (w - lw);
    page.drawText(ln, { x: tx, y: cy, size, font, color });
    cy -= lh;
    used += lh;
  }
}

// draw a titled box section (light grey background), then body text
function drawSection(page, fonts, title, body, rect, options = {}) {
  const { bold, regular } = fonts;
  const { titleSize = 12, bodySize = 11, pad = 10 } = options;
  // background box
  page.drawRectangle({
    x: rect.x, y: rect.y, width: rect.w, height: rect.h,
    color: COLORS.box, borderWidth: 0
  });
  // title
  page.drawText(squash(title), {
    x: rect.x + pad,
    y: rect.y + rect.h - pad - titleSize,
    size: titleSize,
    font: bold,
    color: COLORS.sub
  });
  // body
  drawWrappedText(page, body, {
    x: rect.x + pad,
    y: rect.y + rect.h - pad - titleSize - 6,
    w: rect.w - pad * 2,
    h: rect.h - (titleSize + pad * 2 + 6),
    font: regular,
    size: bodySize,
    color: COLORS.ink,
    lineGap: 3
  });
}

// --- convert "top-left" box to pdf-lib coords (origin = bottom-left)
function fromTop(pageHeight, left, top, width, height) {
  return { x: left, y: pageHeight - top - height, w: width, h: height };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const wantTest = url.searchParams.get('test') === '1';
    const name = String(url.searchParams.get('name') || 'ctrl_profile.pdf').replace(/[^\w.\-]+/g, '_');

    // ----- 1) Build payload -----
    let payload;
    if (wantTest) {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const origin = `${proto}://${req.headers.host}`;
      payload = samplePayload(origin);
    } else {
      const b64 = url.searchParams.get('data');
      if (!b64) {
        res.statusCode = 400; res.end('Missing data'); return;
      }
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        res.statusCode = 400; res.end('Invalid data'); return;
      }
    }

    // unpack fields
    const title = squash(payload.title ?? 'CTRL — Perspective Profile');
    const intro = squash(payload.intro ?? '');
    const headline = squash(payload.headline ?? '');
    const how = squash(payload.how ?? '');

    const directionLabel = squash(payload.directionLabel ?? '');
    const directionMeaning = squash(payload.directionMeaning ?? '');

    const themeLabel = squash(payload.themeLabel ?? '');
    const themeMeaning = squash(payload.themeMeaning ?? '');

    const tip1 = squash(payload.tip1 ?? '');
    const tip2 = squash(payload.tip2 ?? '');

    const journeyLines = Array.isArray(payload.journey) ? payload.journey.map(squash) : [];
    const chartUrl = String(payload.chartUrl || '');
    const rawSeq = squash(payload?.raw?.sequence ?? '');
    const rawCounts = payload?.raw?.counts ? `C:${payload.raw.counts.C ?? 0}  T:${payload.raw.counts.T ?? 0}  R:${payload.raw.counts.R ?? 0}  L:${payload.raw.counts.L ?? 0}` : '';

    // ----- 2) Load background template (if present) -----
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const origin = `${proto}://${req.headers.host}`;
    const templateUrl = `${origin}/CTRL_Perspective_template.pdf`;

    let tplBytes = null;
    try {
      const r = await fetch(templateUrl);
      if (r.ok) tplBytes = await r.arrayBuffer();
    } catch (_) { /* ignore */ }

    let pdf;
    if (tplBytes) {
      pdf = await PDFDocument.load(tplBytes);
    } else {
      pdf = await PDFDocument.create(); // blank fallback
      pdf.addPage([mm(210), mm(297)]);  // A4
    }

    const page = pdf.getPage(0);
    const { width: pw, height: ph } = page.getSize();

    // ----- 3) Fonts -----
    const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const FONTS = { regular: fontRegular, bold: fontBold };

    // ----- 4) Chart fetch (big) -----
    let chartImg = null;
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) {
          const buf = await r.arrayBuffer();
          // QuickChart returns PNG by default
          try { chartImg = await pdf.embedPng(buf); }
          catch { /* some charts might be jpeg */ chartImg = await pdf.embedJpg(buf); }
        }
      } catch (_) { /* ignore */ }
    }

    // ----- 5) Layout (adjust these numbers to line up with your template) -----
    // All coordinates are "from top-left" for easier thinking,
    // then converted to pdf-lib's bottom-left origin via fromTop().

    // Header & intro (left column)
    const R_TITLE   = fromTop(ph, mm(18),  mm(16), mm(120), mm(9));
    const R_INTRO   = fromTop(ph, mm(18),  mm(28), mm(120), mm(23));

    // Headline & how (left column)
    const R_HEAD    = fromTop(ph, mm(18),  mm(55), mm(120), mm(12));
    const R_HOW     = fromTop(ph, mm(18),  mm(69), mm(120), mm(26));

    // Big chart (right column)
    const R_CHART   = fromTop(ph, mm(145), mm(24), mm(60),  mm(60)); // ~60mm square

    // Journey bullets (full width)
    const R_JOURNEY = fromTop(ph, mm(18),  mm(100), mm(187), mm(28));

    // Middle boxes: Direction (left), Theme (right)
    const R_DIR     = fromTop(ph, mm(18),  mm(132), mm(90),  mm(32));
    const R_THEME   = fromTop(ph, mm(115), mm(132), mm(90),  mm(32));

    // Bottom tip boxes (prominent)
    const R_TIP1    = fromTop(ph, mm(18),  mm(168), mm(90),  mm(36));
    const R_TIP2    = fromTop(ph, mm(115), mm(168), mm(90),  mm(36));

    // Footer raw
    const R_FOOT    = fromTop(ph, mm(18),  mm(207), mm(187), mm(8));

    // ----- 6) Draw content -----

    // Title
    page.drawText(title, {
      x: R_TITLE.x,
      y: R_TITLE.y + R_TITLE.h - 12,
      size: 14,
      font: fontBold,
      color: COLORS.accent
    });

    // Intro
    drawWrappedText(page, intro, {
      x: R_INTRO.x, y: R_INTRO.y + R_INTRO.h - 11,
      w: R_INTRO.w, h: R_INTRO.h,
      font: fontRegular, size: 10.5, color: COLORS.sub, lineGap: 3
    });

    // Headline (larger)
    drawWrappedText(page, headline, {
      x: R_HEAD.x, y: R_HEAD.y + R_HEAD.h - 14,
      w: R_HEAD.w, h: R_HEAD.h,
      font: fontBold, size: 13, color: COLORS.ink, lineGap: 2
    });

    // How it tends to show up
    drawWrappedText(page, how, {
      x: R_HOW.x, y: R_HOW.y + R_HOW.h - 11,
      w: R_HOW.w, h: R_HOW.h,
      font: fontRegular, size: 11, color: COLORS.ink, lineGap: 3
    });

    // Chart
    if (chartImg) {
      const iw = R_CHART.w, ih = R_CHART.h;
      page.drawImage(chartImg, { x: R_CHART.x, y: R_CHART.y, width: iw, height: ih });
    } else {
      // placeholder
      page.drawRectangle({
        x: R_CHART.x, y: R_CHART.y, width: R_CHART.w, height: R_CHART.h,
        borderColor: COLORS.line, borderWidth: 1
      });
      page.drawText('chart unavailable', {
        x: R_CHART.x + 8, y: R_CHART.y + R_CHART.h / 2 - 5, size: 9,
        font: fontRegular, color: COLORS.sub
      });
    }

    // Journey (bullets)
    if (journeyLines.length) {
      page.drawText('Where the journey points', {
        x: R_JOURNEY.x, y: R_JOURNEY.y + R_JOURNEY.h - 12,
        size: 12, font: fontBold, color: COLORS.sub
      });

      const bodyRect = { x: R_JOURNEY.x, y: R_JOURNEY.y, w: R_JOURNEY.w, h: R_JOURNEY.h - 16 };
      let cursorY = bodyRect.y + bodyRect.h - 11;
      const lh = 13.5;

      for (const line of journeyLines) {
        if (cursorY < bodyRect.y + 4) break;
        page.drawText('• ' + squash(line), {
          x: bodyRect.x, y: cursorY, size: 11, font: fontRegular, color: COLORS.ink
        });
        cursorY -= lh;
      }
    }

    // Direction box
    drawSection(
      page,
      FONTS,
      `Direction — ${directionLabel || '—'}`,
      directionMeaning || '',
      R_DIR,
      { titleSize: 12, bodySize: 10.8, pad: 10 }
    );

    // Theme box
    drawSection(
      page,
      FONTS,
      `Theme — ${themeLabel || '—'}`,
      themeMeaning || '',
      R_THEME,
      { titleSize: 12, bodySize: 10.8, pad: 10 }
    );

    // Tip boxes (prominent)
    drawSection(
      page,
      FONTS,
      'Try this',
      tip1 || '',
      R_TIP1,
      { titleSize: 12, bodySize: 11.2, pad: 12 }
    );
    drawSection(
      page,
      FONTS,
      'Try this next time',
      tip2 || '',
      R_TIP2,
      { titleSize: 12, bodySize: 11.2, pad: 12 }
    );

    // Footer raw
    const foot = [rawSeq ? `Sequence: ${rawSeq}` : '', rawCounts ? `Counts: ${rawCounts}` : '']
      .filter(Boolean)
      .join('   •   ');

    if (foot) {
      page.drawText(foot, {
        x: R_FOOT.x, y: R_FOOT.y + 2,
        size: 9, font: fontRegular, color: COLORS.sub
      });
    }

    // ----- 7) send PDF -----
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(Buffer.from(out));
  } catch (e) {
    console.error('[fill-template] error:', e);
    res.statusCode = 500;
    res.end('Failed to generate PDF: ' + (e?.message || String(e)));
  }
}

