export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ------------------------- helpers ------------------------- */

const S = (v, fb = '') => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const norm = (v, fb = '') =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // strip odd control chars

// Wrap/align text into a box (y = distance from TOP of page)
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = 'left',
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const clean = norm(text);
  const lines = clean.split('\n');
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];

  for (const raw of lines) {
    let t = raw.trim();
    while (t.length > maxChars) {
      let cut = t.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      wrapped.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    if (t) wrapped.push(t);
  }

  const out = wrapped.length > maxLines
    ? wrapped.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, '…') : s))
    : wrapped;

  const pageH = page.getHeight();
  const yTop = pageH - y;
  const widthOf = (s) => font.widthOfTextAtSize(s, size);
  const lineH = size + lineGap;

  let yCursor = yTop;
  let drawn = 0;
  for (const line of out) {
    let xDraw = x;
    if (align === 'center') xDraw = x + (w - widthOf(line)) / 2;
    else if (align === 'right') xDraw = x + (w - widthOf(line));
    page.drawText(line, { x: xDraw, y: yCursor, size, font, color });
    yCursor -= lineH;
    drawn++;
  }
  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

async function fetchTemplate(req, urlParam) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');

  // Default to your new V3 template unless overridden via ?tpl=
  const file = urlParam || 'CTRL_Perspective_Assessment_Profile_templateV3.pdf';
  const url  = `${proto}://${host}/${file}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// URL param readers
function qnum(url, key, fb) {
  const s = url.searchParams.get(key);
  if (s === null || s === '') return fb;
  const n = Number(s);
  return Number.isFinite(n) ? n : fb;
}
function qstr(url, key, fb) {
  const v = url.searchParams.get(key);
  return v == null || v === '' ? fb : v;
}

// Best-effort cover name
const pickCoverName = (data, url) => norm(
  (data?.person?.coverName) ??
  data?.coverName ??
  data?.person?.fullName ??
  data?.fullName ??
  data?.summary?.user?.reportCoverName ??
  data?.summary?.user?.fullName ??
  url?.searchParams?.get('cover') ??
  ''
);

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  // Safe URL parse
  let url;
  try { url = new URL(req?.url || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const isTest   = url.searchParams.get('test') === '1';
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const tplParam = qstr(url, 'tpl', 'CTRL_Perspective_Assessment_Profile_templateV3.pdf');

  // Demo payload
  let data;
  if (isTest) {
    data = {
      flow: qstr(url, 'flow', 'Perspective'),
      person: { coverName: 'Avery Example', fullName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },

      // Page 6 content — demo
      stateWord: 'Regulated',
      dominantParagraph: 'You connect most with Mika — steady and fair. When there’s heat, you keep proportion and make room for others’ voice.',
      chartParagraph: 'Your chart shows a Regulated centre, with Triggered also present. That means you bring calm, balanced tone, and add directness when clarity is needed. It’s a constructive mix: you lower heat, then move things on.',

      // A chart that already has circular gridlines; we’ll force square size later too
      chartUrl:
        'https://quickchart.io/chart?v=4&c=' +
        encodeURIComponent(JSON.stringify({
          type: 'radar',
          data: {
            labels: ['Concealed', 'Triggered', 'Regulated', 'Lead'],
            datasets: [{
              label: 'Frequency',
              data: [0, 2, 3, 0],
              fill: true,
              backgroundColor: 'rgba(115, 72, 199, 0.18)',
              borderColor: '#7348C7',
              borderWidth: 2,
              pointRadius: [0,3,6,0],
              pointHoverRadius: [0,4,7,0],
              pointBackgroundColor: ['#9D7BE0','#9D7BE0','#7348C7','#9D7BE0'],
              pointBorderColor:    ['#9D7BE0','#9D7BE0','#7348C7','#9D7BE0'],
            }]
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
        })),

      // Page 6 “left column blocks” & “right theme paragraph” (you can leave blank)
      page6Blocks: [
        { title:'Direction & shape', body:'Steady line with mixed steps. You kept to a similar zone overall; keep the little habits that held you there.' },
        { title:'Coverage & edges',  body:'You touched 2 states and saw little of Lead. Solid range with an area to explore when useful.' },
      ],
      themeNarrative: 'Emotion regulation shows up alongside Feedback handling and Awareness of impact — that trio makes your honesty land more cleanly.'
    };
  } else {
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try {
      const raw = Buffer.from(S(b64,''), 'base64').toString('utf8');
      data = JSON.parse(raw);
    } catch (e) {
      res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return;
    }
  }

  /* ----------------------- POSITIONS / TUNERS ----------------------- */
  // Locked defaults from your latest coordinates
  const POS = {
    // Page 1: Path (flow) + FullName + Date
    p1_flow: { x: qnum(url,'f1x',290), y: qnum(url,'f1y',170), w: qnum(url,'f1w',400), size: qnum(url,'f1s',40), align: qstr(url,'f1align','left'), color: rgb(0.12,0.11,0.2) },
    p1_name: { x: qnum(url,'n1x',10),  y: qnum(url,'n1y',573), w: qnum(url,'n1w',500), size: qnum(url,'n1s',30), align: qstr(url,'n1align','center'), color: rgb(0.12,0.11,0.2) },
    p1_date: { x: qnum(url,'d1x',130), y: qnum(url,'d1y',630), w: qnum(url,'d1w',500), size: qnum(url,'d1s',20), align: qstr(url,'d1align','left'), color: rgb(0.24,0.23,0.35) },

    // Pages 2..8: Path + Name footer-like labels
    p2_flow: { x: qnum(url,'f2x',200), y: qnum(url,'f2y',64), w: qnum(url,'f2w',400), size: qnum(url,'f2s',13), align: qstr(url,'f2align','left'),   color: rgb(0.12,0.11,0.2) },
    p2_name: { x: qnum(url,'n2x',250), y: qnum(url,'n2y',64), w: qnum(url,'n2w',400), size: qnum(url,'n2s',12), align: qstr(url,'n2align','center'), color: rgb(0.12,0.11,0.2) },

    p3_flow: { x: qnum(url,'f3x',200), y: qnum(url,'f3y',64), w: qnum(url,'f3w',400), size: qnum(url,'f3s',13), align: qstr(url,'f3align','left'),   color: rgb(0.12,0.11,0.2) },
    p3_name: { x: qnum(url,'n3x',250), y: qnum(url,'n3y',64), w: qnum(url,'n3w',400), size: qnum(url,'n3s',12), align: qstr(url,'n3align','center'), color: rgb(0.12,0.11,0.2) },

    p4_flow: { x: qnum(url,'f4x',200), y: qnum(url,'f4y',64), w: qnum(url,'f4w',400), size: qnum(url,'f4s',13), align: qstr(url,'f4align','left'),   color: rgb(0.12,0.11,0.2) },
    p4_name: { x: qnum(url,'n4x',250), y: qnum(url,'n4y',64), w: qnum(url,'n4w',400), size: qnum(url,'n4s',12), align: qstr(url,'n4align','center'), color: rgb(0.12,0.11,0.2) },

    p5_flow: { x: qnum(url,'f5x',200), y: qnum(url,'f5y',64), w: qnum(url,'f5w',400), size: qnum(url,'f5s',13), align: qstr(url,'f5align','left'),   color: rgb(0.12,0.11,0.2) },
    p5_name: { x: qnum(url,'n5x',250), y: qnum(url,'n5y',64), w: qnum(url,'n5w',400), size: qnum(url,'n5s',12), align: qstr(url,'n5align','center'), color: rgb(0.12,0.11,0.2) },

    p6_flow: { x: qnum(url,'f6x',200), y: qnum(url,'f6y',64), w: qnum(url,'f6w',400), size: qnum(url,'f6s',13), align: qstr(url,'f6align','left'),   color: rgb(0.12,0.11,0.2) },
    p6_name: { x: qnum(url,'n6x',250), y: qnum(url,'n6y',64), w: qnum(url,'n6w',400), size: qnum(url,'n6s',12), align: qstr(url,'n6align','center'), color: rgb(0.12,0.11,0.2) },

    p7_flow: { x: qnum(url,'f7x',200), y: qnum(url,'f7y',64), w: qnum(url,'f7w',400), size: qnum(url,'f7s',13), align: qstr(url,'f7align','left'),   color: rgb(0.12,0.11,0.2) },
    p7_name: { x: qnum(url,'n7x',250), y: qnum(url,'n7y',64), w: qnum(url,'n7w',400), size: qnum(url,'n7s',12), align: qstr(url,'n7align','center'), color: rgb(0.12,0.11,0.2) },

    p8_flow: { x: qnum(url,'f8x',200), y: qnum(url,'f8y',64), w: qnum(url,'f8w',400), size: qnum(url,'f8s',13), align: qstr(url,'f8align','left'),   color: rgb(0.12,0.11,0.2) },
    p8_name: { x: qnum(url,'n8x',250), y: qnum(url,'n8y',64), w: qnum(url,'n8w',400), size: qnum(url,'n8s',12), align: qstr(url,'n8align','center'), color: rgb(0.12,0.11,0.2) },

    // Page 6 — Dominant title, description, radar, and blocks/themes
    dom6:      { x: qnum(url,'dom6x',55),  y: qnum(url,'dom6y',280), w: qnum(url,'dom6w',900), size: qnum(url,'dom6s',33), align: qstr(url,'dom6align','left'), color: rgb(0.12,0.11,0.2) },
    dom6desc:  { x: qnum(url,'dom6descx',40), y: qnum(url,'dom6descy',380), w: qnum(url,'dom6descw',250), size: qnum(url,'dom6descs',15), align: qstr(url,'dom6descalign','left'), color: rgb(0.24,0.23,0.35), maxLines: qnum(url,'dom6descmax',8) },

    // “How this shows up” on Page 6 — now fed by data.chartParagraph
    how6:      { x: qnum(url,'how6x',420), y: qnum(url,'how6y',360), w: qnum(url,'how6w',300), size: qnum(url,'how6s',22), align: qstr(url,'how6align','left'), color: rgb(0.24,0.23,0.35), maxLines: qnum(url,'how6max',4) },

    // Radar chart on Page 6 (we’ll auto-square inside this box)
    c6: { x: qnum(url,'c6x',203), y: qnum(url,'c6y',230), w: qnum(url,'c6w',420), h: qnum(url,'c6h',220), square: qnum(url,'c6square',1) === 1 },

    // Page 6 — left column blocks (2 blocks)
    p6Blocks: { x: qnum(url,'p6px',120), y: qnum(url,'p6py',520), w: qnum(url,'p6pw',1260), hSize: qnum(url,'p6phsize',14), bSize: qnum(url,'p6pbsize',20), align: qstr(url,'p6palign','left'), titleGap: qnum(url,'p6ptitlegap',6), blockGap: qnum(url,'p6pblockgap',20), maxBodyLines: qnum(url,'p6pmax',6), color: rgb(0.24,0.23,0.35) },

    // Page 6 — right theme narrative
    p6Theme:  { x: qnum(url,'p6tx',1280), y: qnum(url,'p6ty',620), w: qnum(url,'p6tw',630), size: qnum(url,'p6ts',30), align: qstr(url,'p6talign','left'), maxLines: qnum(url,'p6tmax',14), color: rgb(0.24,0.23,0.35) },
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, tplParam, pos: POS, data, urlParams: Object.fromEntries(url.searchParams.entries()) }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req, tplParam);
    const pdf = await PDFDocument.load(tplBytes);

    // Ensure we have at least 8 pages
    const totalPages = pdf.getPageCount();
    if (totalPages < 8) throw new Error(`Template must have at least 8 pages, found ${totalPages}`);

    const pages = [...Array(8)].map((_, i) => pdf.getPage(i));
    const [p1,p2,p3,p4,p5,p6,p7,p8] = pages;

    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Basic values
    const flow      = norm(data.flow || 'Perspective');
    const fullName  = norm(data.person?.fullName || pickCoverName(data, url) || '');
    const coverName = pickCoverName(data, url);

    // --- Page 1: Path (flow), Name, Date (AMS format is pre-rendered in template; here we just place your label text) ---
    if (flow) drawTextBox(p1, HelvB, flow, POS.p1_flow, { maxLines: 1, ellipsis: true });
    if (coverName) drawTextBox(p1, HelvB, coverName, POS.p1_name, { maxLines: 1, ellipsis: true });

    // Date string: if provided in payload use that; otherwise leave empty (template shows static label)
    const dateLbl = norm(data.dateLabel || '');
    if (dateLbl) drawTextBox(p1, Helv, dateLbl, POS.p1_date, { maxLines: 1, ellipsis: true });

    // --- Pages 2..8: footer labels (flow + full name) ---
    const footerPairs = [
      [p2, POS.p2_flow, POS.p2_name],
      [p3, POS.p3_flow, POS.p3_name],
      [p4, POS.p4_flow, POS.p4_name],
      [p5, POS.p5_flow, POS.p5_name],
      [p6, POS.p6_flow, POS.p6_name],
      [p7, POS.p7_flow, POS.p7_name],
      [p8, POS.p8_flow, POS.p8_name],
    ];
    for (const [page, flowPos, namePos] of footerPairs) {
      if (flow) drawTextBox(page, Helv, flow, flowPos, { maxLines: 1, ellipsis: true });
      if (fullName) drawTextBox(page, Helv, fullName, namePos, { maxLines: 1, ellipsis: true });
    }

    // -------------------- Page 6 CONTENT --------------------

    // 6A) Dominant state title
    const domTitle = norm(data.stateWord || (Array.isArray(data.stateWords) ? data.stateWords[0] : '') || '');
    if (domTitle) drawTextBox(p6, HelvB, domTitle, POS.dom6, { maxLines: 1, ellipsis: true });

    // 6B) Dominant description — from payload.dominantParagraph
    const domDesc = norm(data.dominantParagraph || '');
    if (domDesc) {
      drawTextBox(p6, Helv, domDesc,
        { x: POS.dom6desc.x, y: POS.dom6desc.y, w: POS.dom6desc.w, size: POS.dom6desc.size, align: POS.dom6desc.align, color: POS.dom6desc.color },
        { maxLines: POS.dom6desc.maxLines, ellipsis: true }
      );
    }

    // 6C) “How this shows up” — now fed by payload.chartParagraph (NOT the old 'how')
    const chartPara = norm(data.chartParagraph || '');
    if (chartPara) {
      drawTextBox(p6, Helv, chartPara,
        { x: POS.how6.x, y: POS.how6.y, w: POS.how6.w, size: POS.how6.size, align: POS.how6.align, color: POS.how6.color },
        { maxLines: POS.how6.maxLines, ellipsis: true }
      );
    }

    // 6D) Radar chart — fetch, enforce square output, draw centered in c6 box
    let chartUrl = S(data.chartUrl, '');
    if (chartUrl) {
      // If width/height not provided, append square size + transparent background
      const hasW = /[?&]width=\d+/i.test(chartUrl);
      const hasH = /[?&]height=\d+/i.test(chartUrl);
      const hasBG = /[?&]backgroundColor=/i.test(chartUrl);
      if (!hasW || !hasH) {
        chartUrl += (chartUrl.includes('?') ? '&' : '?') + 'width=640&height=640';
      }
      if (!hasBG) {
        chartUrl += (chartUrl.includes('?') ? '&' : '?') + 'backgroundColor=transparent';
      }

      try {
        const r = await fetch(chartUrl);
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const ph = p6.getHeight();

          const box = POS.c6;
          const side = box.square ? Math.min(box.w, box.h) : null;
          const drawW = box.square ? side : box.w;
          const drawH = box.square ? side : box.h;

          // center inside the box
          const x = box.x + (box.w - drawW) / 2;
          const y = ph - box.y - drawH; // convert top-origin
          p6.drawImage(png, { x, y, width: drawW, height: drawH });
        }
      } catch { /* ignore chart errors */ }
    }

    // 6E) Left column pattern blocks (up to 2)
    const p6Blocks = Array.isArray(data.page6Blocks) ? data.page6Blocks
                    : Array.isArray(data.page2Patterns) ? data.page2Patterns : [];
    const blocks = p6Blocks
      .map(b => ({ title: norm(b?.title || ''), body: norm(b?.body || '') }))
      .filter(b => b.title || b.body)
      .slice(0, 2);

    let curY = POS.p6Blocks.y;
    for (const b of blocks) {
      if (b.title) {
        drawTextBox(p6, HelvB, b.title,
          { x: POS.p6Blocks.x, y: curY, w: POS.p6Blocks.w, size: POS.p6Blocks.hSize, align: POS.p6Blocks.align, color: POS.p6Blocks.color, lineGap: 3 },
          { maxLines: 1, ellipsis: true }
        );
        curY += (POS.p6Blocks.hSize + 3) + POS.p6Blocks.titleGap;
      }
      if (b.body) {
        const r = drawTextBox(p6, Helv, b.body,
          { x: POS.p6Blocks.x, y: curY, w: POS.p6Blocks.w, size: POS.p6Blocks.bSize, align: POS.p6Blocks.align, color: POS.p6Blocks.color, lineGap: 3 },
          { maxLines: POS.p6Blocks.maxBodyLines, ellipsis: true }
        );
        curY += r.height + POS.p6Blocks.blockGap;
      }
    }

    // 6F) Right theme narrative
    let themeNarr = '';
    if (typeof data.themeNarrative === 'string' && data.themeNarrative.trim()) {
      themeNarr = norm(data.themeNarrative.trim());
    }
    if (themeNarr) {
      drawTextBox(p6, Helv, themeNarr,
        { x: POS.p6Theme.x, y: POS.p6Theme.y, w: POS.p6Theme.w, size: POS.p6Theme.size, align: POS.p6Theme.align, color: POS.p6Theme.color, lineGap: 4 },
        { maxLines: POS.p6Theme.maxLines, ellipsis: true }
      );
    }

    // Save
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${S(url.searchParams.get('name'),'ctrl_profile.pdf')}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
