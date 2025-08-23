// /api/fill-template.js
// Fill the static template (public/CTRL_Perspective_template.pdf) using pdf-lib.
// Test:
//   • Peek JSON (no PDF):  /api/fill-template?test=1&peek=1
//   • Debug boxes overlay: /api/fill-template?test=1&debug=1
//   • Normal smoke PDF:    /api/fill-template?test=1

import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- utilities ----------
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

// Try reading from FS; if not, fetch via public URL.
async function getTemplateBytes(req) {
  const debug = { triedFS: false, triedHTTP: false, fsOk: false, httpOk: false, bytes: 0, url: '' };
  try {
    debug.triedFS = true;
    const buf = await readFile('public/CTRL_Perspective_template.pdf');
    debug.fsOk = true;
    debug.bytes = buf.byteLength;
    return { buf, debug };
  } catch (_) {
    // fall back to HTTP
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
  const peek   = url.searchParams.get('peek') === '1';
  const debug  = url.searchParams.get('debug') === '1';
  const name   = (url.searchParams.get('name') || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');

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
          encodeURIComponent(JSON.stringify({
            type: 'radar',
            data: {
              labels: ['Concealed','Triggered','Regulated','Lead'],
              datasets: [{
                label: 'Frequency',
                data: [2,3,0,0],
                fill: true,
                backgroundColor: 'rgba(115,72,199,0.18)',
                borderColor: '#7348C7',
                borderWidth: 2,
                pointRadius: [3,6,0,0],
                pointBackgroundColor: ['#9D7BE0','#7348C7','#9D7BE0','#9D7BE0'],
                pointBorderColor:   ['#9D7BE0','#7348C7','#9D7BE0','#9D7BE0'],
              }]
            },
            options: {
              plugins: { legend: { display:false } },
              scales: {
                r: {
                  min:0, max:5,
                  ticks: { display:true, stepSize:1, backdropColor:'rgba(0,0,0,0)' },
                  grid: { circular:true },
                  angleLines: { display:true },
                  pointLabels: { color:'#4A4458', font:{ size:12 } }
                }
              }
            }
          }))
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

    // ---------- load template ----------
    const { buf: tmplBuf, debug: tmplDbg } = await getTemplateBytes(req);
    diag.template = tmplDbg;
    diag.stage = 'template-loaded';

    if (peek) {
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({ ok:true, diag }));
      return;
    }

    const pdfDoc = await PDFDocument.load(tmplBuf);
    diag.stage = 'pdf-loaded';
    const page = pdfDoc.getPage(0);
    const pageH = page.getHeight();
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold= await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // ---------- positions (tweak here) ----------
    // All positions use { x, top } where "top" is distance from the top edge.
    // Increase 'top' to move DOWN; decrease to move UP. Increase 'x' to move RIGHT.
    const BOX = {
      title:           { x: 42,  top: 40,  w: 520, size: 20, bold: true },
      intro:           { x: 42,  top: 68,  w: 520, size: 11.5, lh: 16 },

      headline:        { x: 42,  top: 118, w: 520, size: 13.5, bold: true },
      how:             { x: 42,  top: 140, w: 520, size: 11.5, lh: 16 },

      radar:           { x: 48,  top: 205, w: 320, h: 320 },  // bigger chart box

      directionTitle:  { x: 390, top: 205, w: 180, size: 12.5, bold: true },
      directionBody:   { x: 390, top: 225, w: 180, size: 11.5, lh: 16 },
      themeTitle:      { x: 390, top: 270, w: 180, size: 12.5, bold: true },
      themeBody:       { x: 390, top: 290, w: 180, size: 11.5, lh: 16 },

      patternTitle:    { x: 42,  top: 345, w: 520, size: 12.5, bold: true },
      patternLine:     { x: 42,  top: 365, w: 520, size: 11.5, lh: 16 },
      patternDetail:   { x: 42,  top: 385, w: 520, size: 11.5, lh: 16 },

      tip1Title:       { x: 42,  top: 435, w: 340, size: 13.5, bold: true },
      tip1:            { x: 42,  top: 458, w: 340, size: 12.5, lh: 18 },  // roomier lines
      tip2Title:       { x: 402, top: 435, w: 180, size: 13.5, bold: true },
      tip2:            { x: 402, top: 458, w: 180, size: 12.5, lh: 18 },
    };
    const P = (top) => pageH - top;

    // Draw paragraph inside a box
    function drawPara(txt, box, useBold = false, color = rgb(0.11,0.10,0.13)) {
      if (!txt) return;
      const f = useBold ? fontBold : fontReg;
      const size = box.size || 11.5;
      const lh = box.lh || size * 1.35;
      const lines = wrapText(txt, f, size, box.w);
      let y = P(box.top);
      for (const line of lines) {
        page.drawText(line, { x: box.x, y, size, font: f, color });
        y -= lh;
      }
    }

    // Optional: lightly outline boxes for alignment
    function drawBoxOutline(box, label) {
      const h = (box.lh || (box.size || 12) * 1.35) * 2.2; // 2 lines worth (approx)
      page.drawRectangle({
        x: box.x - 4, y: P(box.top) - h - 2, width: box.w + 8, height: h + 4,
        borderColor: rgb(0.45,0.38,0.78), borderWidth: 0.8, color: undefined
      });
      page.drawText(label, { x: box.x - 3, y: P(box.top) + 3, size: 8, font: fontReg, color: rgb(0.45,0.38,0.78) });
    }

    // ---------- write content ----------
    if (debug) {
      drawBoxOutline(BOX.title,'title');
      drawBoxOutline(BOX.intro,'intro');
      drawBoxOutline(BOX.headline,'headline');
      drawBoxOutline(BOX.how,'how');
      drawBoxOutline(BOX.directionTitle,'directionTitle');
      drawBoxOutline(BOX.directionBody,'directionBody');
      drawBoxOutline(BOX.themeTitle,'themeTitle');
      drawBoxOutline(BOX.themeBody,'themeBody');
      drawBoxOutline(BOX.patternTitle,'patternTitle');
      drawBoxOutline(BOX.patternLine,'patternLine');
      drawBoxOutline(BOX.patternDetail,'patternDetail');
      drawBoxOutline(BOX.tip1Title,'tip1Title');
      drawBoxOutline(BOX.tip1,'tip1');
      drawBoxOutline(BOX.tip2Title,'tip2Title');
      drawBoxOutline(BOX.tip2,'tip2');
      // radar box outline
      page.drawRectangle({
        x: BOX.radar.x - 4, y: P(BOX.radar.top) - BOX.radar.h - 4,
        width: BOX.radar.w + 8, height: BOX.radar.h + 8,
        borderColor: rgb(0.7,0.65,0.85), borderWidth: 0.8
      });
      page.drawText('radar', { x: BOX.radar.x - 3, y: P(BOX.radar.top) + 3, size: 8, font: fontReg, color: rgb(0.7,0.65,0.85) });
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

    drawPara(payload.tip1Title || 'Try this', BOX.tip1Title, true, rgb(0.15,0.12,0.18));
    drawPara(payload.tip1 || '', BOX.tip1);
    drawPara(payload.tip2Title || 'Try this next time', BOX.tip2Title, true, rgb(0.15,0.12,0.18));
    drawPara(payload.tip2 || '', BOX.tip2);

    // ---------- radar image ----------
    if (payload.chartUrl) {
      try {
        const r = await fetch(String(payload.chartUrl));
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          let img;
          try { img = await pdfDoc.embedPng(buf); }
          catch { img = await pdfDoc.embedJpg(buf); }
          const s = Math.min(BOX.radar.w / img.width, BOX.radar.h / img.height);
          const w = img.width * s;
          const h = img.height * s;
          page.drawImage(img, { x: BOX.radar.x, y: P(BOX.radar.top) - h, width: w, height: h });
        }
      } catch (_) { /* ignore chart fetch error in smoke */ }
    }

    const bytes = await pdfDoc.save();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ ok:false, error: e?.message || String(e), diag }));
  }
}
