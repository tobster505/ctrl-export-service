// /api/fill-template.js
// Vercel serverless (ESM). Manual, top-left placement with grid + debug toggles.
// Requires: "pdf-lib" in package.json

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- Utilities ----------
const squash = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

// Convert top-left coords to PDF bottom-left coords
function TL(page, x, yTop, h) {
  return { x, y: page.getHeight() - yTop - h };
}

function drawRectTL(page, { x, y, w, h, r = 8, fill, stroke, opacity = 1 }) {
  const { x: bx, y: by } = TL(page, x, y, h);
  const opts = { x: bx, y: by, width: w, height: h, borderRadius: r, opacity };
  if (fill) opts.color = fill;
  if (stroke) { opts.borderColor = stroke; opts.borderWidth = 1; }
  page.drawRectangle(opts);
}

function wrapText({ text, font, size, maxWidth }) {
  const words = String(text || "").split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) line = t;
    else { if (line) out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

// Draw multi-line text with top-left origin and line spacing
function textBlockTL(page, { x, y, w, text, font, size, color, lineGap = 4 }) {
  const lines = wrapText({ text, font, size, maxWidth: w });
  let cursor = y;
  for (const ln of lines) {
    const { x: tx, y: ty } = TL(page, x, cursor, size);
    page.drawText(ln, { x: tx, y: ty, size, font, color });
    cursor += size + lineGap;
  }
  return cursor; // returns next y (top-left space consumed)
}

async function embedChart(doc, bytes) {
  try { return await doc.embedPng(bytes); } catch {}
  try { return await doc.embedJpg(bytes); } catch {}
  return null;
}

// Optional overlay grid (for calibration)
function drawGrid(page, step = 20, boldStep = 100, color = rgb(0.8, 0.8, 0.85)) {
  const w = page.getWidth(), h = page.getHeight();
  for (let x = 0; x <= w; x += step) {
    const bold = (x % boldStep) === 0;
    page.drawLine({
      start: { x, y: 0 }, end: { x, y: h },
      thickness: bold ? 0.8 : 0.3, color
    });
  }
  for (let y = 0; y <= h; y += step) {
    const bold = (y % boldStep) === 0;
    page.drawLine({
      start: { x: 0, y }, end: { x: w, y },
      thickness: bold ? 0.8 : 0.3, color
    });
  }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const isTest = url.searchParams.has("test");
    const showGrid = url.searchParams.has("grid");
    const showDebug = url.searchParams.has("debug");

    // Colors
    const COLORS = {
      ink: hexToRgb("#2E2A36"),
      accent: hexToRgb("#7348C7"),       // mauve-500
      accent2: hexToRgb("#9D7BE0"),      // mauve-400
      boxFill: hexToRgb("#F5F2FB"),      // light section
      boxStroke: hexToRgb("#E2DAF6"),
      tipFill: hexToRgb("#EFE7FF"),
      tipStroke: hexToRgb("#D7C7FB"),
      mute: hexToRgb("#5C566C"),
    };

    // Payload (test or from ?data=base64)
    let payload;
    const b64 = url.searchParams.get("data");
    if (isTest && !b64) {
      const sampleChart = {
        type: "radar",
        data: {
          labels: ["Concealed","Triggered","Regulated","Lead"],
          datasets: [{
            label: "Frequency",
            data: [1,3,1,0],
            fill: true,
            backgroundColor: "rgba(115,72,199,0.18)",
            borderColor: "#7348C7",
            borderWidth: 2,
            pointRadius: [3,6,3,0],
            pointBackgroundColor: ["#9D7BE0","#7348C7","#9D7BE0","#9D7BE0"]
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            r: {
              min: 0, max: 5,
              ticks: { display: true, stepSize: 1, backdropColor: "rgba(0,0,0,0)" },
              grid: { circular: true },
              angleLines: { display: true },
              pointLabels: { color: "#4A4458", font: { size: 12 } }
            }
          }
        }
      };
      const chartUrl = "https://quickchart.io/chart?v=4&c=" + encodeURIComponent(JSON.stringify(sampleChart));
      payload = {
        name: "ctrl_report.pdf",
        title: "CTRL — Your Snapshot",
        intro: "A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states.",
        headline: "You sit mostly in Triggered.",
        meaning: "Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.",
        chartUrl,
        directionLabel: "Steady",
        directionMeaning: "You started and ended in similar zones — steady overall.",
        themeLabel: "Emotion regulation",
        themeMeaning: "Settling yourself when feelings spike.",
        patternNote: "A mix of moves without a single rhythm. You changed state 2 times; longest run: Triggered × 2.",
        tips: {
          primary: "Take one breath and name it: “I’m on edge.”",
          next: "Choose your gear on purpose: protect, steady, or lead — say it in one line."
        },
        raw: { sequence: "T T C R T", counts: { C:1, T:3, R:1, L:0 } }
      };
    } else {
      if (!b64) { res.status(400).send("Missing data"); return; }
      try { payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
      catch { res.status(400).send("Invalid data"); return; }
    }

    // Pull template
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "ctrl-export-service.vercel.app";
    const templateUrl = `${proto}://${host}/CTRL_Perspective_template.pdf`;

    let doc, page, reg, bold;
    try {
      const tr = await fetch(templateUrl, { cache: "no-store" });
      if (!tr.ok) throw new Error("template fetch failed");
      const ab = await tr.arrayBuffer();
      doc = await PDFDocument.load(ab);
      page = doc.getPages()[0];
    } catch {
      // Fallback — blank A4 so you can still calibrate
      doc = await PDFDocument.create();
      page = doc.addPage([595.28, 841.89]);
    }
    reg = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const pageW = page.getWidth();
    const pageH = page.getHeight();

    // Optional grid overlay for calibration
    if (showGrid) drawGrid(page);

    // ---------- MANUAL COORDS (Top-Left) ----------
    // Tweak these numbers until boxes sit perfectly over your template.
    // (All y values are measured from the TOP edge of the page.)
    const COORDS = {
      title:         { x: 40,  y: 50,  w: pageW - 80 }, // single-line title
      intro:         { x: 40,  y: 80,  w: pageW - 80 },

      boxState:      { x: 40,  y: 140, w: pageW - 80, h: 100 },  // "Your current state" section
      boxChart:      { x: 40,  y: 260, w: 300,          h: 260 }, // chart box
      boxDirection:  { x: 352, y: 260, w: pageW - 392, h: 120 },
      boxTheme:      { x: 352, y: 390, w: pageW - 392, h: 130 },

      boxPattern:    { x: 40,  y: 540, w: pageW - 80,  h: 90 },

      boxTip1:       { x: 40,  y: 650, w: (pageW - 92) / 2, h: 96 },
      boxTip2:       { x: 40 + (pageW - 92) / 2 + 12, y: 650, w: (pageW - 92) / 2, h: 96 },

      footer:        { x: 40,  y: pageH - 40, w: pageW - 80 }
    };

    // Debug frames to see placement
    if (showDebug) {
      const S = hexToRgb("#FFB3B3");
      [COORDS.boxState, COORDS.boxChart, COORDS.boxDirection, COORDS.boxTheme, COORDS.boxPattern, COORDS.boxTip1, COORDS.boxTip2].forEach(b =>
        drawRectTL(page, { ...b, r: 10, stroke: S })
      );
    }

    // ---------- Draw content ----------

    // Title
    page.drawText(squash(payload.title || "CTRL — Snapshot"), {
      ...TL(page, COORDS.title.x, COORDS.title.y, 18),
      size: 18, font: bold, color: COLORS.ink
    });

    // Intro (wrapped)
    textBlockTL(page, {
      x: COORDS.intro.x, y: COORDS.intro.y,
      w: COORDS.intro.w,
      text: squash(payload.intro || ""),
      font: reg, size: 11, color: COLORS.ink, lineGap: 3
    });

    // Box: current state
    drawRectTL(page, { ...COORDS.boxState, r: 10, fill: COLORS.boxFill, stroke: COLORS.boxStroke });
    page.drawText("Your current state", {
      ...TL(page, COORDS.boxState.x + 14, COORDS.boxState.y + 14, 12),
      size: 12, font: bold, color: COLORS.accent
    });
    const stateBody = `${squash(payload.headline || "")}\n\n${squash(payload.meaning || "")}`;
    textBlockTL(page, {
      x: COORDS.boxState.x + 14,
      y: COORDS.boxState.y + 34,
      w: COORDS.boxState.w - 28,
      text: stateBody,
      font: reg, size: 10.5, color: COLORS.ink, lineGap: 4
    });

    // Box: radar chart
    drawRectTL(page, { ...COORDS.boxChart, r: 10, fill: rgb(1,1,1), stroke: COLORS.boxStroke });
    page.drawText("CTRL Radar", {
      ...TL(page, COORDS.boxChart.x + 12, COORDS.boxChart.y + 12, 12),
      size: 12, font: bold, color: COLORS.accent
    });

    // Fetch and embed chart
    const chartUrl = String(payload.chartUrl || "");
    if (chartUrl) {
      try {
        const r = await fetch(chartUrl);
        if (r.ok) {
          const buf = await r.arrayBuffer();
          const img = await embedChart(doc, buf);
          if (img) {
            const padX = 12, padY = 26;
            const fitW = COORDS.boxChart.w - padX * 2;
            const fitH = COORDS.boxChart.h - padY * 2;
            const dims = img.scaleToFit(fitW, fitH);
            const pos = TL(page,
              COORDS.boxChart.x + padX + (fitW - dims.width) / 2,
              COORDS.boxChart.y + padY + (fitH - dims.height) / 2,
              dims.height
            );
            page.drawImage(img, { x: pos.x, y: pos.y, width: dims.width, height: dims.height, opacity: 1 });
          }
        }
      } catch {}
    } else {
      page.drawText("Chart unavailable", {
        ...TL(page, COORDS.boxChart.x + 12, COORDS.boxChart.y + 44, 10),
        size: 10, font: reg, color: COLORS.mute
      });
    }

    // Box: direction
    drawRectTL(page, { ...COORDS.boxDirection, r: 10, fill: COLORS.boxFill, stroke: COLORS.boxStroke });
    page.drawText("Direction of travel", {
      ...TL(page, COORDS.boxDirection.x + 14, COORDS.boxDirection.y + 14, 12),
      size: 12, font: bold, color: COLORS.accent
    });
    const directionText = `${squash(payload.directionLabel || "")}\n${squash(payload.directionMeaning || "")}`;
    textBlockTL(page, {
      x: COORDS.boxDirection.x + 14,
      y: COORDS.boxDirection.y + 34,
      w: COORDS.boxDirection.w - 28,
      text: directionText,
      font: reg, size: 10.5, color: COLORS.ink, lineGap: 4
    });

    // Box: theme
    drawRectTL(page, { ...COORDS.boxTheme, r: 10, fill: COLORS.boxFill, stroke: COLORS.boxStroke });
    page.drawText("Theme in focus", {
      ...TL(page, COORDS.boxTheme.x + 14, COORDS.boxTheme.y + 14, 12),
      size: 12, font: bold, color: COLORS.accent
    });
    const themeText = `${squash(payload.themeLabel || "")}\n${squash(payload.themeMeaning || "")}`;
    textBlockTL(page, {
      x: COORDS.boxTheme.x + 14,
      y: COORDS.boxTheme.y + 34,
      w: COORDS.boxTheme.w - 28,
      text: themeText,
      font: reg, size: 10.5, color: COLORS.ink, lineGap: 4
    });

    // Box: pattern
    drawRectTL(page, { ...COORDS.boxPattern, r: 10, fill: COLORS.boxFill, stroke: COLORS.boxStroke });
    page.drawText("What the pattern suggests", {
      ...TL(page, COORDS.boxPattern.x + 14, COORDS.boxPattern.y + 14, 12),
      size: 12, font: bold, color: COLORS.accent
    });
    textBlockTL(page, {
      x: COORDS.boxPattern.x + 14,
      y: COORDS.boxPattern.y + 34,
      w: COORDS.boxPattern.w - 28,
      text: squash(payload.patternNote || ""),
      font: reg, size: 10.5, color: COLORS.ink, lineGap: 4
    });

    // Tips (prominent)
    drawRectTL(page, { ...COORDS.boxTip1, r: 10, fill: COLORS.tipFill, stroke: COLORS.tipStroke });
    page.drawText("Try this", {
      ...TL(page, COORDS.boxTip1.x + 14, COORDS.boxTip1.y + 14, 12),
      size: 12, font: bold, color: COLORS.accent
    });
    textBlockTL(page, {
      x: COORDS.boxTip1.x + 14,
      y: COORDS.boxTip1.y + 34,
      w: COORDS.boxTip1.w - 28,
      text: squash(payload.tips?.primary || ""),
      font: reg, size: 11, color: COLORS.ink, lineGap: 5
    });

    drawRectTL(page, { ...COORDS.boxTip2, r: 10, fill: COLORS.tipFill, stroke: COLORS.tipStroke });
    page.drawText("Try this next time", {
      ...TL(page, COORDS.boxTip2.x + 14, COORDS.boxTip2.y + 14, 12),
      size: 12, font: bold, color: COLORS.accent
    });
    textBlockTL(page, {
      x: COORDS.boxTip2.x + 14,
      y: COORDS.boxTip2.y + 34,
      w: COORDS.boxTip2.w - 28,
      text: squash(payload.tips?.next || ""),
      font: reg, size: 11, color: COLORS.ink, lineGap: 5
    });

    // Footer raw line (optional)
    const raw = payload.raw || {};
    const counts = (raw && typeof raw.counts === "object")
      ? `C:${raw.counts?.C ?? 0} T:${raw.counts?.T ?? 0} R:${raw.counts?.R ?? 0} L:${raw.counts?.L ?? 0}`
      : squash(String(raw?.counts || ""));
    const footerText = `Sequence: ${squash(raw.sequence || "-")}    Counts: ${counts}`;
    page.drawText(footerText, {
      ...TL(page, COORDS.footer.x, COORDS.footer.y, 9),
      size: 9, font: reg, color: COLORS.mute
    });

    // Output
    const bytes = await doc.save();
    const name = String(payload.name || "ctrl_report.pdf").replace(/[^\w.\-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    console.error("[fill-template] error:", e);
    res.status(500).send("Error generating PDF: " + (e?.message || String(e)));
  }
}
