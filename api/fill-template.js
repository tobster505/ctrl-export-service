// /api/fill-template.js
// Fills your static template PDF with text + radar image using pdf-lib.
// Test URLs:
//  • Smoke PDF:  https://ctrl-export-service.vercel.app/api/fill-template?test=1
//  • Peek JSON:  https://ctrl-export-service.vercel.app/api/fill-template?test=1&peek=1

import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- helpers ----------
function squash(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}
function wrapText(text, font, fontSize, maxWidth) {
  const words = squash(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width <= maxWidth || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

// Try FS first; if missing, fetch from the deployed public URL.
async function getTemplateBytes(req) {
  const debug = { triedFS: false, triedHTTP: false, fsOk: false, httpOk: false, bytes: 0, url: '' };
  const FS_PATH = 'public/CTRL_Perspective_template.pdf';

  try {
    debug.triedFS = true;
    const buf = await readFile(FS_PATH);
    debug.fsOk = true;
    debug.bytes = buf.byteLength;
    return { buf, debug };
  } catch {
    // fall through to HTTP
  }
  const host =
    (req.headers['x-forwarded-host'] && `https://${req.headers['x-forwarded-host']}`) ||
    'https://ctrl-export-service.vercel.app';
  const url = `${host}/CTRL_Perspective_template.pdf`;
  debug.triedHTTP = true;
  debug.url = url;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Template fetch failed: ${r.status} ${r.statusText}`);
  const ab = await r.arrayBuffer();
  debug.httpOk = true;
  debug.bytes = ab.byteLength;
  return { buf: Buffer.from(ab), debug };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const isTest = url.searchParams.has('test');
  const peek = url.searchParams.get('peek') === '1';
  const name = (url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');

  const diag = { stage: 'start' };

  try {
    // ---------- payload ----------
    let payload;
    if (isTest) {
      payload = {
        title: 'CTRL — Assessment: Your Snapshot',
        intro:
          'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states.',
        headline: 'You sit mostly in Triggered.',
        how: 'Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.',
        directionLabel: 'Steady',
        directionMeaning: 'You started and ended in similar zones — steady overall.',
        themeLabel: 'Emotion regulation',
        themeMeaning: 'Settling yourself when feelings spike.',
        patternLine: 'A mix of moves without a single rhythm.',
        patternDetail: 'You changed state 2 times; longest run: Triggered × 2.',
        tip1Title: 'Try this',
        tip1: 'Take one breath and name it: "I’m on edge."',
        tip2Title: 'Try this next time',
        tip2: 'Choose your gear on purpose — protect, steady, or lead — say it in one line.',
        chartUrl:
          'https://quickchart.io/chart?v=4&c=' +
          encodeURIComponent(
            JSON.stringify({
              type: 'radar',
              data: {
                labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
                datasets: [
                  {
                    label: 'Frequency',
                    data: [2, 3, 0, 0],
                    fill: true,
                    backgroundColor: 'rgba(115,72,199,0.18)',
                    borderColor: '#7348C7',
                    borderWidth: 2,
                    pointRadius: [3, 6, 0, 0],
                    pointBackgroundColor: ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
                    pointBorderColor:   ['#9D7BE0', '#7348C7', '#9D7BE0', '#9D7BE0'],
                  },
                ],
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
            })
          ),
      };
    } else {
      const b64 = url.searchParams.get('data');
      if (!b64) { res.statusCode = 400; res.end('Missing data'); return; }
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        res.statusCode = 400; res.end('Invalid data'); return;
      }
    }

    // ---------- template ----------
    const { buf: tmplBuf, debug: tmplDebug } = await getTemplateBytes(req);
    diag.template = tmplDebug;
    diag.stage = 'template-loaded';

    // In peek mode, stop here and show diagnostics
    if (peek) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, diag }));
      return;
    }

    const pdfDoc = await PDFDocument.load(tmplBuf);
    diag.stage = 'pdf-loaded';

    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.getPage(0);
    const pageH = page.getHeight();

    const BOX = {
      title:           { x: 38,  top: 48,  w: 520, size: 20, bold: true },
      intro:           { x: 38,  top: 78,  w: 520, size: 11,  lh: 14 },

      headline:        { x: 38,  top: 128, w: 520, size: 13,  bold: true },
      how:             { x: 38,  top: 148, w: 520, size: 11,  lh: 14 },

      radar:           { x: 44,  top: 215, w: 270, h: 270 },

      directionTitle:  { x: 330, top: 215, w: 230, size: 12, bold: true },
      directionBody:   { x: 330, top: 233, w: 230, size: 11, lh: 14 },
      themeTitle:      { x: 330, top: 273, w: 230, size: 12, bold: true },
      themeBody:       { x: 330, top: 291, w: 230, size: 11, lh: 14 },

      patternTitle:    { x: 38,  top: 355, w: 520, size: 12, bold: true },
      patternLine:     { x: 38,  top: 373, w: 520, size: 11, lh: 14 },
      patternDetail:   { x: 38,  top: 391, w: 520, size: 11, lh: 14 },

      tip1Title:       { x: 38,  top: 435, w: 360, size: 12.5, bold: true },
      tip1:            { x: 38,  top: 455, w: 360, size: 12,   lh: 16 },
      tip2Title:       { x: 418, top: 435, w: 200, size: 12.5, bold: true },
      tip2:            { x: 418, top: 455, w: 200, size: 12,   lh: 16 },
    };
    const Y = (top) => pageH - top;
    function drawPara(txt, box, bold = false) {
      if (!txt) return;
      const f = bold ? fontBold : fontReg;
      const size = box.size || 11;
      const lh = box.lh || size * 1.25;
      const lines = wrapText(txt, f, size, box.w);
      let y = Y(box.top);
      for (const line of lines) {
        page.drawText(line, { x: box.x, y, size, font: f, color: rgb(0.11, 0.1, 0.13) });
        y -= lh;
      }
    }

    drawPara(payload.title, BOX.title, true);
    drawPara(payload.intro, BOX.intro);
    drawPara(payload.headline, BOX.headline, true);
    drawPara(payload.how, BOX.how);

    drawPara(payload.directionLabel, BOX.directionTitle, true);
    drawPara(payload.directionMeaning, BOX.directionBody);
    drawPara(payload.themeLabel, BOX.themeTitle, true);
    drawPara(payload.themeMeaning, BOX.themeBody);

    drawPara('What the pattern suggests', BOX.patternTitle, true);
    drawPara(payload.patternLine || '', BOX.patternLine);
    drawPara(payload.patternDetail || '', BOX.patternDetail);

    drawPara(payload.tip1Title || 'Try this', BOX.tip1Title, true);
    drawPara(payload.tip1 || '', BOX.tip1);
    drawPara(payload.tip2Title || 'Try this next time', BOX.tip2Title, true);
    drawPara(payload.tip2 || '', BOX.tip2);

    // radar image
    if (payload.chartUrl) {
      try {
        const r = await fetch(String(payload.chartUrl));
        diag.chartFetch = { ok: r.ok, status: r.status };
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          let img;
          try { img = await pdfDoc.embedPng(buf); }
          catch { img = await pdfDoc.embedJpg(buf); }
          const s = Math.min(BOX.radar.w / img.width, BOX.radar.h / img.height);
          const w = img.width * s;
          const h = img.height * s;
          page.drawImage(img, { x: BOX.radar.x, y: Y(BOX.radar.top) - h, width: w, height: h });
        }
      } catch (e) {
        diag.chartFetch = { ok: false, error: e?.message || String(e) };
      }
    }

    const pdfBytes = await PDFDocument.saveAsBase64 ? await pdfDoc.save() : await pdfDoc.save(); // ensure Node buffer
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.end(Buffer.from(pdfBytes));
  } catch (e) {
    // return a readable error (Vercel otherwise hides details)
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: e?.message || String(e), diag }));
  }
}
