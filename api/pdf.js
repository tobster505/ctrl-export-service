// /api/pdf/index.js  (or /api/pdf.js)
// Node.js Serverless Function for Vercel
// Robustly accepts PDF data via GET ?data=BASE64 or POST JSON.
// Renders a simple A4 PDF with title, intro, headline, chart image, body copy, and raw data.

const PDFDocument = require("pdfkit");

// Remove characters that PDFKit's WinAnsi can't encode (emojis, arrows, etc.)
function sanitize(txt) {
  if (!txt) return "";
  return String(txt)
    // strip emojis and symbols outside BMP and Latin-1
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[^\u0000-\u00FF]/g, "");
}

async function fetchImageBuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Chart fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function decodePayload(req) {
  // Accept:
  //  - GET ?data=<base64 of JSON>
  //  - GET ?payload=<base64 of JSON>
  //  - POST { data: "<base64 of JSON>" }
  //  - POST full JSON payload directly (already parsed)
  const q = req.query || {};
  const b = req.body || {};

  let rawObj = null;

  if (typeof q.data === "string") {
    try {
      rawObj = JSON.parse(Buffer.from(q.data, "base64").toString("utf8"));
    } catch { /* fall through */ }
  }
  if (!rawObj && typeof q.payload === "string") {
    try {
      rawObj = JSON.parse(Buffer.from(q.payload, "base64").toString("utf8"));
    } catch { /* fall through */ }
  }
  if (!rawObj && typeof b?.data === "string") {
    try {
      rawObj = JSON.parse(Buffer.from(b.data, "base64").toString("utf8"));
    } catch { /* fall through */ }
  }
  if (!rawObj && typeof b === "object" && Object.keys(b).length) {
    rawObj = b;
  }
  return rawObj;
}

module.exports = async (req, res) => {
  try {
    const name = (req.query.name || "ctrl_report.pdf").toString();
    const payload = decodePayload(req);

    if (!payload) {
      res.status(400).send("Missing data");
      return;
    }

    // Support both verbose keys and compact keys
    const title   = sanitize(payload.title   ?? payload.t ?? "CTRL — Your Snapshot");
    const intro   = sanitize(payload.intro   ?? payload.i ?? "");
    const headline= sanitize(payload.headline?? payload.h ?? "");
    const how     = sanitize(payload.how     ?? payload.w ?? "");
    const journey = sanitize(payload.journey ?? payload.j ?? "");
    const themes  = sanitize(payload.themesExplainer ?? payload.e ?? "");
    const chartUrl= String(payload.chartUrl  ?? payload.c ?? "");
    const raw     = payload.raw ?? payload.r ?? null;

    // Start PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    // Title
    doc.font("Helvetica-Bold").fontSize(18).text(title);
    doc.moveDown(0.5);

    // Intro
    if (intro) {
      doc.font("Helvetica").fontSize(11).text(intro);
      doc.moveDown(0.5);
    }

    // Headline
    if (headline) {
      doc.font("Helvetica-Bold").fontSize(14).text(headline);
      doc.moveDown(0.4);
    }

    // Chart (if available)
    if (chartUrl) {
      const imgBuf = await fetchImageBuffer(chartUrl);
      if (imgBuf) {
        doc.image(imgBuf, { fit: [440, 280], align: "center" });
        doc.moveDown(0.4);
      }
    }

    // How this tends to show up
    if (how) {
      doc.font("Helvetica-Bold").fontSize(12).text("How this tends to show up");
      doc.moveDown(0.15);
      doc.font("Helvetica").fontSize(11).text(how);
      doc.moveDown(0.4);
    }

    // Where the journey points (render bullets if user supplied them with "• ")
    if (journey) {
      doc.font("Helvetica-Bold").fontSize(12).text("Where the journey points");
      doc.moveDown(0.15);
      doc.font("Helvetica").fontSize(11);
      const lines = journey.split("\n").filter(Boolean);
      for (const ln of lines) doc.text(sanitize(ln));
      doc.moveDown(0.4);
    }

    // Themes
    if (themes) {
      doc.font("Helvetica-Bold").fontSize(12).text("Themes that kept popping up");
      doc.moveDown(0.15);
      doc.font("Helvetica").fontSize(11);
      const tlines = themes.split("\n").filter(Boolean);
      for (const ln of tlines) doc.text(sanitize(ln));
      doc.moveDown(0.4);
    }

    // Raw data
    if (raw) {
      doc.font("Helvetica-Bold").fontSize(12).text("Raw data");
      doc.moveDown(0.15);
      doc.font("Helvetica").fontSize(10);
      if (raw.sequence) doc.text(`sequence: ${sanitize(raw.sequence)}`);
      if (raw.counts)   doc.text(`counts:   ${sanitize(typeof raw.counts === "string" ? raw.counts : JSON.stringify(raw.counts))}`);
      if (raw.perQuestion) {
        if (Array.isArray(raw.perQuestion)) {
          for (const row of raw.perQuestion) {
            doc.text(sanitize(JSON.stringify(row)));
          }
        } else {
          doc.text(sanitize(raw.perQuestion));
        }
      }
    }

    doc.end();
  } catch (err) {
    res.status(500).send("PDF generation error");
  }
};
