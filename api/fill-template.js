// api/fill-template.js
//
// CTRL Export Service — Perspective Flow
// - Coordinates are locked to our agreed defaults, but every position/size can be tuned via URL params.
// - Pages 7–10 are split as requested:
//     p7: "Look — Colleagues"
//     p8: "Work — Colleagues"
//     p9: "Look — Leaders"
//    p10: "Work — Leaders"
// - Tips & Actions moved to page 11 (p11_* params).
// - Footer label coords (n*) extended through page 12 (n11*, n12*).
//
// Example (shortened):
//   /api/fill-template?flow=Perspective&tpl=CTRL_Perspective_Assessment_Profile_template_slim.pdf
//     &data=<base64 or json-string>
//     &p3_domChar_x=305&...&p11_tipsHdr_x=70&...&n11x=250&n11y=64&n11w=400&n11s=12&n11align=center
//
// NOTE: This function is intentionally defensive: clearer error messages for template fetch / data shape,
//       graceful text-wrapping, and bounds checks on page indexes.
//

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- tiny utils ----------
const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const pick = (o, k, d) => (o && o[k] !== undefined ? o[k] : d);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const alignX = (x, w, textWidth, align = 'left') => {
  if (align === 'center') return x + (w - textWidth) / 2;
  if (align === 'right') return x + (w - textWidth);
  return x;
};

// Decode ?data= (base64 or plain JSON)
function decodeDataParam(raw) {
  if (!raw) return {};
  try {
    // base64?
    const txt = Buffer.from(decodeURIComponent(raw), 'base64').toString('utf8');
    return JSON.parse(txt);
  } catch {
    // plain JSON string?
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      return {};
    }
  }
}

function getHostBaseUrl(req) {
  // Try to build an absolute base URL for fetching public assets on Vercel
  const proto =
    (req.headers['x-forwarded-proto'] && String(req.headers['x-forwarded-proto'])) ||
    'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return null;
  return `${proto}://${host}`;
}

// ---------- coordinates (defaults) ----------
// All tunable via URL, but these are the locked defaults we agreed on.
function coordDefaults(query) {
  // p3
  const p3_domChar = {
    x: num(query.p3_domChar_x, 305),
    y: num(query.p3_domChar_y, 640),
    w: num(query.p3_domChar_w, 630),
    size: num(query.p3_domChar_size, 25),
  };
  const p3_domDesc = {
    x: num(query.p3_domDesc_x, 25),
    y: num(query.p3_domDesc_y, 685),
    w: num(query.p3_domDesc_w, 630),
    size: num(query.p3_domDesc_size, 18),
  };

  // p4
  const p4_spider = {
    x: num(query.p4_spider_x, 30),
    y: num(query.p4_spider_y, 585),
    w: num(query.p4_spider_w, 670),
    size: num(query.p4_spider_size, 18),
  };
  const p4_chart = {
    x: num(query.p4_chart_x, 20),
    y: num(query.p4_chart_y, 225),
    w: num(query.p4_chart_w, 570),
    h: num(query.p4_chart_h, 280),
  };

  // p5
  const p5_seqpat = {
    x: num(query.p5_seqpat_x, 25),
    y: num(query.p5_seqpat_y, 260),
    w: num(query.p5_seqpat_w, 650),
    size: num(query.p5_seqpat_size, 18),
  };

  // p6
  const p6_theme = {
    x: num(query.p6_theme_x, 25),
    y: num(query.p6_theme_y, 335),
    w: num(query.p6_theme_w, 630),
    size: num(query.p6_theme_size, 18),
  };

  // p7 — LOOK — COLLEAGUES
  const p7_hCol = {
    x: num(query.p7_hCol_x, 30),
    y: num(query.p7_hCol_y, 135),
    w: num(query.p7_hCol_w, 640),
    size: num(query.p7_hCol_size, 0), // 0 => do not render header by default
    align: String(query.p7_hCol_align || 'left'),
  };
  const p7_col = {
    C: { x: num(query.p7_colC_x, 25),  y: num(query.p7_colC_y, 265), w: num(query.p7_colC_w, 300), h: num(query.p7_colC_h, 210), size: num(query.p7_colC_size, 10), max: num(query.p7_colC_max, 25) },
    T: { x: num(query.p7_colT_x, 320), y: num(query.p7_colT_y, 265), w: num(query.p7_colT_w, 300), h: num(query.p7_colT_h, 210), size: num(query.p7_colT_size, 10), max: num(query.p7_colT_max, 25) },
    R: { x: num(query.p7_colR_x, 25),  y: num(query.p7_colR_y, 525), w: num(query.p7_colR_w, 300), h: num(query.p7_colR_h, 210), size: num(query.p7_colR_size, 10), max: num(query.p7_colR_max, 25) },
    L: { x: num(query.p7_colL_x, 320), y: num(query.p7_colL_y, 525), w: num(query.p7_colL_w, 300), h: num(query.p7_colL_h, 210), size: num(query.p7_colL_size, 10), max: num(query.p7_colL_max, 25) },
  };

  // p8 — WORK — COLLEAGUES
  // Support either p8_col* (preferred) OR p8_ldr* override names if someone still uses the old ones.
  const p8_hCol = {
    x: num(query.p8_hCol_x ?? query.p8_hLdr_x, 30),
    y: num(query.p8_hCol_y ?? query.p8_hLdr_y, 115),
    w: num(query.p8_hCol_w ?? query.p8_hLdr_w, 640),
    size: num(query.p8_hCol_size ?? query.p8_hLdr_size, 0),
    align: String(query.p8_hCol_align || query.p8_hLdr_align || 'left'),
  };
  const p8_col = {
    C: { x: num(query.p8_colC_x ?? query.p8_ldrC_x, 25),  y: num(query.p8_colC_y ?? query.p8_ldrC_y, 265), w: num(query.p8_colC_w ?? query.p8_ldrC_w, 300), h: num(query.p8_colC_h ?? query.p8_ldrC_h, 210), size: num(query.p8_colC_size ?? query.p8_ldrC_size, 10), max: num(query.p8_colC_max ?? query.p8_ldrC_max, 25) },
    T: { x: num(query.p8_colT_x ?? query.p8_ldrT_x, 320), y: num(query.p8_colT_y ?? query.p8_ldrT_y, 265), w: num(query.p8_colT_w ?? query.p8_ldrT_w, 300), h: num(query.p8_colT_h ?? query.p8_ldrT_h, 210), size: num(query.p8_colT_size ?? query.p8_ldrT_size, 10), max: num(query.p8_colT_max ?? query.p8_ldrT_max, 25) },
    R: { x: num(query.p8_colR_x ?? query.p8_ldrR_x, 25),  y: num(query.p8_colR_y ?? query.p8_ldrR_y, 525), w: num(query.p8_colR_w ?? query.p8_ldrR_w, 300), h: num(query.p8_colR_h ?? query.p8_ldrR_h, 210), size: num(query.p8_colR_size ?? query.p8_ldrR_size, 10), max: num(query.p8_colR_max ?? query.p8_ldrR_max, 25) },
    L: { x: num(query.p8_colL_x ?? query.p8_ldrL_x, 320), y: num(query.p8_colL_y ?? query.p8_ldrL_y, 525), w: num(query.p8_colL_w ?? query.p8_ldrL_w, 300), h: num(query.p8_colL_h ?? query.p8_ldrL_h, 210), size: num(query.p8_colL_size ?? query.p8_ldrL_size, 10), max: num(query.p8_colL_max ?? query.p8_ldrL_max, 25) },
  };

  // p9 — LOOK — LEADERS
  const p9_hLdr = {
    x: num(query.p9_hLdr_x, 30),
    y: num(query.p9_hLdr_y, 115),
    w: num(query.p9_hLdr_w, 640),
    size: num(query.p9_hLdr_size, 0),
    align: String(query.p9_hLdr_align || 'left'),
  };
  const p9_ldr = {
    C: { x: num(query.p9_ldrC_x, 25),  y: num(query.p9_ldrC_y, 265), w: num(query.p9_ldrC_w, 300), h: num(query.p9_ldrC_h, 95), size: num(query.p9_ldrC_size, 16), max: num(query.p9_ldrC_max, 18) },
    T: { x: num(query.p9_ldrT_x, 320), y: num(query.p9_ldrT_y, 265), w: num(query.p9_ldrT_w, 300), h: num(query.p9_ldrT_h, 95), size: num(query.p9_ldrT_size, 16), max: num(query.p9_ldrT_max, 18) },
    R: { x: num(query.p9_ldrR_x, 25),  y: num(query.p9_ldrR_y, 525), w: num(query.p9_ldrR_w, 300), h: num(query.p9_ldrR_h, 95), size: num(query.p9_ldrR_size, 16), max: num(query.p9_ldrR_max, 18) },
    L: { x: num(query.p9_ldrL_x, 320), y: num(query.p9_ldrL_y, 525), w: num(query.p9_ldrL_w, 300), h: num(query.p9_ldrL_h, 95), size: num(query.p9_ldrL_size, 16), max: num(query.p9_ldrL_max, 18) },
  };

  // p10 — WORK — LEADERS
  const p10_hLdr = {
    x: num(query.p10_hLdr_x, 30),
    y: num(query.p10_hLdr_y, 115),
    w: num(query.p10_hLdr_w, 640),
    size: num(query.p10_hLdr_size, 0),
    align: String(query.p10_hLdr_align || 'left'),
  };
  const p10_ldr = {
    C: { x: num(query.p10_ldrC_x, 25),  y: num(query.p10_ldrC_y, 265), w: num(query.p10_ldrC_w, 300), h: num(query.p10_ldrC_h, 210), size: num(query.p10_ldrC_size, 10), max: num(query.p10_ldrC_max, 25) },
    T: { x: num(query.p10_ldrT_x, 320), y: num(query.p10_ldrT_y, 265), w: num(query.p10_ldrT_w, 300), h: num(query.p10_ldrT_h, 210), size: num(query.p10_ldrT_size, 10), max: num(query.p10_ldrT_max, 25) },
    R: { x: num(query.p10_ldrR_x, 25),  y: num(query.p10_ldrR_y, 525), w: num(query.p10_ldrR_w, 300), h: num(query.p10_ldrR_h, 210), size: num(query.p10_ldrR_size, 10), max: num(query.p10_ldrR_max, 25) },
    L: { x: num(query.p10_ldrL_x, 320), y: num(query.p10_ldrL_y, 525), w: num(query.p10_ldrL_w, 300), h: num(query.p10_ldrL_h, 210), size: num(query.p10_ldrL_size, 10), max: num(query.p10_ldrL_max, 25) },
  };

  // p11 — Tips & Actions (moved here)
  const p11_tipsHdr = {
    x: num(query.p11_tipsHdr_x, 70),
    y: num(query.p11_tipsHdr_y, 122),
    w: num(query.p11_tipsHdr_w, 320),
    size: num(query.p11_tipsHdr_size, 12),
  };
  const p11_actsHdr = {
    x: num(query.p11_actsHdr_x, 400),
    y: num(query.p11_actsHdr_y, 122),
    w: num(query.p11_actsHdr_w, 320),
    size: num(query.p11_actsHdr_size, 12),
  };
  const p11_tipsBox = {
    x: num(query.p11_tipsBox_x, 70),
    y: num(query.p11_tipsBox_y, 155),
    w: num(query.p11_tipsBox_w, 315),
    size: num(query.p11_tipsBox_size, 11),
  };
  const p11_actsBox = {
    x: num(query.p11_actsBox_x, 400),
    y: num(query.p11_actsBox_y, 155),
    w: num(query.p11_actsBox_w, 315),
    size: num(query.p11_actsBox_size, 11),
  };

  // Footer labels (n2..n12)
  const n = {};
  for (let i = 2; i <= 12; i++) {
    n[i] = {
      x: num(query[`n${i}x`], 250),
      y: num(query[`n${i}y`], 64),
      w: num(query[`n${i}w`], 400),
      s: num(query[`n${i}s`], 12),
      align: String(query[`n${i}align`] || 'center'),
    };
  }

  return {
    p3_domChar, p3_domDesc,
    p4_spider, p4_chart,
    p5_seqpat, p6_theme,
    p7_hCol, p7_col,
    p8_hCol, p8_col,
    p9_hLdr, p9_ldr,
    p10_hLdr, p10_ldr,
    p11_tipsHdr, p11_actsHdr, p11_tipsBox, p11_actsBox,
    n,
  };
}

// ---------- text + bullets ----------
async function drawWrapped(page, font, text, { x, y, w, size, lineGap = 4, align = 'left', maxLines, color = rgb(0,0,0) }) {
  if (!text) return y;
  const words = String(text).split(/\s+/g);
  let line = '';
  let lines = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(test, size);
    if (width > w && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    // Add ellipsis to the last line if truncated.
    const last = lines[lines.length - 1];
    const ell = '…';
    let lastWidth = font.widthOfTextAtSize(last + ell, size);
    while (lastWidth > w && last.length > 1) {
      lines[lines.length - 1] = last.slice(0, -1);
      lastWidth = font.widthOfTextAtSize(lines[lines.length - 1] + ell, size);
    }
    lines[lines.length - 1] += ell;
  }

  let cursorY = y;
  for (const ln of lines) {
    const txtWidth = font.widthOfTextAtSize(ln, size);
    const drawX = alignX(x, w, txtWidth, align);
    page.drawText(ln, { x: drawX, y: cursorY, size, font, color });
    cursorY -= size + lineGap;
  }
  return cursorY;
}

async function drawBulletList(page, font, list, { x, y, w, size, lineGap = 4, bulletGap = 8, maxItems = 12 }) {
  if (!Array.isArray(list) || !list.length) return y;
  const bullet = '•';
  const indent = font.widthOfTextAtSize(bullet + '  ', size) + bulletGap;
  let cy = y;
  let count = 0;

  for (const raw of list) {
    if (count >= maxItems) break;
    const text = String(raw || '').trim();
    if (!text) continue;

    // First line with bullet
    const firstLineWidth = w - indent;
    cy = drawWrappedWithPrefix(page, font, text, {
      x, y: cy, w,
      size, lineGap,
      prefix: bullet,
      prefixWidth: font.widthOfTextAtSize(bullet + ' ', size),
      firstLineExtraIndent: indent,
    });
    count++;
  }
  return cy;
}

function drawWrappedWithPrefix(page, font, text, { x, y, w, size, lineGap = 4, prefix = '•', prefixWidth = 0, firstLineExtraIndent = 0 }) {
  const words = text.split(/\s+/g);
  let line = '';
  let lines = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(test, size);
    const avail = lines.length === 0 ? (w - firstLineExtraIndent) : (w - prefixWidth);
    if (width > avail && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  let cy = y;

  lines.forEach((ln, idx) => {
    const isFirst = idx === 0;
    if (isFirst) {
      // bullet
      page.drawText(prefix, { x, y: cy, size, font });
      page.drawText(ln, { x: x + firstLineExtraIndent, y: cy, size, font });
    } else {
      // hanging indent
      page.drawText('', { x, y: cy, size, font }); // noop for clarity
      page.drawText(ln, { x: x + prefixWidth, y: cy, size, font });
    }
    cy -= size + lineGap;
  });

  return cy;
}

// ---------- data massaging ----------
function normalizeData(d) {
  const out = { ...(d || {}) };

  // Person fields
  out.f = out.f || 'Perspective';
  out.n = out.n || (out.person?.fullName || out.person?.preferredName || '');
  out.d = out.d || out.dateLbl || '';
  out.dom = out.dom || out.dom6Label || out.domchar || '';
  out.domchar = out.domchar || out.dom6Label || out.dom || '';
  out.domdesc = out.domdesc || out.dom6Desc || out.domDesc || out.dominationDesc || '';
  out.dom6Key = out.dom6Key || out.domKey || 'R';

  // Spider/Chart URLs (optional text placement titles)
  out.spiderdesc = out.spiderdesc || out.spiderDesc || '';
  out.seqpat = out.seqpatt || out.seqpAt || out.seqp || out.seqpDesc || out.seqp || out.seqp || '';
  out.theme = out.theme || out.themeDesc || '';

  // Work-with maps
  out.workwcol = out.workwcol || out.workWith?.colleagues || [];
  out.workwlead = out.workwlead || out.workWith?.leaders || [];

  // Tips/Actions
  out.tips = out.tips || out.tips2 || [];
  out.actions = out.actions || out.actions2 || [];

  return out;
}

// Select statements for a given "mine" key => maps {C,T,R,L} from array of {mine,their,look,work}
function mapByTheir(arr, mineKey, which = 'look') {
  const map = { C: '', T: '', R: '', L: '' };
  if (!Array.isArray(arr)) return map;
  for (const it of arr) {
    if (String(it.mine || '').toUpperCase() !== String(mineKey || '').toUpperCase()) continue;
    const key = String(it.their || '').toUpperCase();
    if (has(map, key)) map[key] = String(it[which] || '');
  }
  return map;
}

// Draw 4-quadrant blocks (C,T,R,L)
async function drawQuads(page, font, contentMap, rects) {
  const order = ['C', 'T', 'R', 'L'];
  for (const k of order) {
    const box = rects[k];
    const txt = contentMap[k] || '';
    await drawWrapped(page, font, txt, {
      x: box.x, y: box.y, w: box.w,
      size: box.size, lineGap: 4, maxLines: box.max,
      align: 'left',
    });
  }
}

// ---------- template fetch ----------
async function fetchTemplateBuffer(req, tplParam) {
  if (!tplParam) throw new Error('Missing ?tpl= (template filename or URL)');
  const tpl = decodeURIComponent(String(tplParam));

  // If user passed an absolute URL, fetch that.
  if (/^https?:\/\//i.test(tpl)) {
    const r = await fetch(tpl);
    if (!r.ok) throw new Error(`Failed to fetch template via absolute URL: ${tpl}`);
    return Buffer.from(await r.arrayBuffer());
  }

  // Try to fetch from this deployment's /public (Vercel) as /<tpl> or /templates/<tpl>
  const base = getHostBaseUrl(req);
  const candidates = [];
  if (base) {
    candidates.push(`${base}/${tpl}`);
    candidates.push(`${base}/templates/${tpl}`);
    candidates.push(`${base}/public/${tpl}`);
  }

  // Final fallback: known canonical host (customize if you use a different domain)
  candidates.push(`https://ctrl-export-service.vercel.app/templates/${tpl}`);
  candidates.push(`https://ctrl-export-service.vercel.app/${tpl}`);

  let lastErr;
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      lastErr = new Error(`HTTP ${r.status} for ${url}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Failed to fetch template: ${tpl} (${lastErr?.message || 'no details'})`);
}

// ---------- main handler ----------
export default async function handler(req, res) {
  try {
    const { query } = req;

    // Validate flow
    const flow = String(query.flow || 'Perspective');
    if (flow !== 'Perspective') {
      return res.status(400).json({ error: `Unsupported flow: ${flow}` });
    }

    // Template
    const tplBuf = await fetchTemplateBuffer(req, query.tpl);

    // Data
    const data = normalizeData(decodeDataParam(query.data));

    // Coords (defaults + URL tuning)
    const coords = coordDefaults(query);

    // Build PDF
    const pdfDoc = await PDFDocument.load(tplBuf);
    const pages = pdfDoc.getPages();
    const pageCount = pages.length;

    // Guard: we expect at least 12 pages
    if (pageCount < 12) {
      // Don’t crash — just warn in output doc (page 1 top-left tiny text)
      const p = pages[0];
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      p.drawText(`TEMPLATE WARNING: expected ≥12 pages, found ${pageCount}.`, {
        x: 36, y: p.getHeight() - 24, size: 8, font, color: rgb(1, 0, 0),
      });
    }

    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Helper to get page safely (1-based index)
    const pg = (n) => pages[clamp(n - 1, 0, pages.length - 1)];

    // ---- Page 3: Dominant (label + description)
    {
      const p = pg(3);
      await drawWrapped(p, helvBold, data.domchar || '', {
        x: coords.p3_domChar.x, y: coords.p3_domChar.y, w: coords.p3_domChar.w,
        size: coords.p3_domChar.size, lineGap: 4, align: 'left',
      });
      await drawWrapped(p, helv, data.domdesc || '', {
        x: coords.p3_domDesc.x, y: coords.p3_domDesc.y, w: coords.p3_domDesc.w,
        size: coords.p3_domDesc.size, lineGap: 4, align: 'left',
      });
    }

    // ---- Page 4: (labels only; spider/chart are usually images in the template)
    {
      const p = pg(4);
      if (data.spiderdesc) {
        await drawWrapped(p, helv, data.spiderdesc, {
          x: coords.p4_spider.x, y: coords.p4_spider.y, w: coords.p4_spider.w,
          size: coords.p4_spider.size, lineGap: 3,
        });
      }
      // If you want to draw a "chart" label or caption
      // await drawWrapped(p, helv, ' ', { x: coords.p4_chart.x, y: coords.p4_chart.y, w: coords.p4_chart.w, size: 10 });
    }

    // ---- Page 5: Sequence/Pattern
    {
      const p = pg(5);
      if (data.seqp || data.seqpDesc || data.seqpAt || data.seqpat) {
        await drawWrapped(p, helv, (data.seqpat || data.seqp || data.seqpDesc || data.seqpAt), {
          x: coords.p5_seqpat.x, y: coords.p5_seqpat.y, w: coords.p5_seqpat.w,
          size: coords.p5_seqpat.size, lineGap: 4,
        });
      }
    }

    // ---- Page 6: Theme
    {
      const p = pg(6);
      if (data.theme) {
        await drawWrapped(p, helv, data.theme, {
          x: coords.p6_theme.x, y: coords.p6_theme.y, w: coords.p6_theme.w,
          size: coords.p6_theme.size, lineGap: 4,
        });
      }
    }

    // Prepare maps for pages 7–10
    const mineKey = (data.dom6Key || 'R').toUpperCase();

    const colLook = mapByTheir(data.workwcol, mineKey, 'look');
    const colWork = mapByTheir(data.workwcol, mineKey, 'work');

    const ldrLook = mapByTheir(data.workwlead, mineKey, 'look');
    const ldrWork = mapByTheir(data.workwlead, mineKey, 'work');

    // ---- Page 7: LOOK — Colleagues
    {
      const p = pg(7);
      if (coords.p7_hCol.size > 0) {
        await drawWrapped(p, helvBold, 'What to look out for — Colleagues', {
          x: coords.p7_hCol.x, y: coords.p7_hCol.y, w: coords.p7_hCol.w,
          size: coords.p7_hCol.size, align: coords.p7_hCol.align,
        });
      }
      await drawQuads(p, helv, colLook, coords.p7_col);
    }

    // ---- Page 8: WORK — Colleagues
    {
      const p = pg(8);
      if (coords.p8_hCol.size > 0) {
        await drawWrapped(p, helvBold, 'How to work with — Colleagues', {
          x: coords.p8_hCol.x, y: coords.p8_hCol.y, w: coords.p8_hCol.w,
          size: coords.p8_hCol.size, align: coords.p8_hCol.align,
        });
      }
      await drawQuads(p, helv, colWork, coords.p8_col);
    }

    // ---- Page 9: LOOK — Leaders
    {
      const p = pg(9);
      if (coords.p9_hLdr.size > 0) {
        await drawWrapped(p, helvBold, 'What to look out for — Leaders', {
          x: coords.p9_hLdr.x, y: coords.p9_hLdr.y, w: coords.p9_hLdr.w,
          size: coords.p9_hLdr.size, align: coords.p9_hLdr.align,
        });
      }
      await drawQuads(p, helv, ldrLook, coords.p9_ldr);
    }

    // ---- Page 10: WORK — Leaders
    {
      const p = pg(10);
      if (coords.p10_hLdr.size > 0) {
        await drawWrapped(p, helvBold, 'How to work with — Leaders', {
          x: coords.p10_hLdr.x, y: coords.p10_hLdr.y, w: coords.p10_hLdr.w,
          size: coords.p10_hLdr.size, align: coords.p10_hLdr.align,
        });
      }
      await drawQuads(p, helv, ldrWork, coords.p10_ldr);
    }

    // ---- Page 11: Tips & Actions (moved here)
    {
      const p = pg(11);
      // Headers
      await drawWrapped(p, helvBold, 'Tips', {
        x: coords.p11_tipsHdr.x, y: coords.p11_tipsHdr.y, w: coords.p11_tipsHdr.w,
        size: coords.p11_tipsHdr.size,
      });
      await drawWrapped(p, helvBold, 'Actions', {
        x: coords.p11_actsHdr.x, y: coords.p11_actsHdr.y, w: coords.p11_actsHdr.w,
        size: coords.p11_actsHdr.size,
      });
      // Bulleted lists
      const leftY = coords.p11_tipsBox.y;
      const rightY = coords.p11_actsBox.y;
      await drawBulletList(p, helv, Array.isArray(data.tips) ? data.tips : [], {
        x: coords.p11_tipsBox.x,
        y: leftY,
        w: coords.p11_tipsBox.w,
        size: coords.p11_tipsBox.size,
      });
      await drawBulletList(p, helv, Array.isArray(data.actions) ? data.actions : [], {
        x: coords.p11_actsBox.x,
        y: rightY,
        w: coords.p11_actsBox.w,
        size: coords.p11_actsBox.size,
      });
    }

    // ---- Footers (labels) n2..n12 — optional
    const nameLbl = String(query.name || data.n || data.person?.fullName || '').trim();
    const dateLbl = String(data.d || data.dateLbl || '').trim();
    const footerText = nameLbl && dateLbl ? `${nameLbl} — ${dateLbl}` : (nameLbl || dateLbl || '');

    for (let i = 2; i <= Math.min(12, pageCount); i++) {
      const p = pg(i);
      const n = coords.n[i];
      if (!n) continue;
      if (!footerText) continue;

      const font = helv;
      const size = n.s;
      const width = font.widthOfTextAtSize(footerText, size);
      const dx = alignX(n.x, n.w, width, n.align);
      p.drawText(footerText, { x: dx, y: n.y, size, font, color: rgb(0, 0, 0) });
    }

    // Output
    const pdfBytes = await pdfDoc.save();
    const filename = String(query.name || 'CTRL_Perspective.pdf');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    // Clear, actionable error instead of a generic 500
    return res.status(400).json({
      error: err?.message || 'Unknown error',
      hint:
        'Check that ?tpl= points to a reachable PDF (public file or absolute URL), and that ?data= is valid JSON/base64. All coordinates are tunable via query params.',
    });
  }
}
