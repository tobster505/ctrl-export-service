// api/fill-template.js
// CTRL Coach Export Service · URL-tunable coordinates (TL origin, 1-based pages)
// Works with ?tpl=...&data=<base64 json>[&raw=1] and optional QS overrides:
//   &p3_domDesc_x=72&p3_domDesc_y=700&p3_domDesc_w=630&p3_domDesc_size=11
//
// Also supports injecting a full layout object via data.layoutV6.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ───────────── ESM __dirname ─────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ───────────── utilities ─────────────
const S = (v, fb='') => (v == null ? String(fb) : String(v));
const N = (v, fb=0)  => (Number.isFinite(+v) ? +v : +fb);
const A = (v)        => (Array.isArray(v) ? v : []);

const norm = (v, fb='') =>
  String(v ?? fb)
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ').replace(/[•·]/g, '-')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '').replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\t/g, ' ').replace(/\r\n?/g, '\n')
    .replace(/[ \f\v]+/g, ' ').replace(/[ \t]+\n/g, '\n')
    .trim();

function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try { return JSON.parse(Buffer.from(s, 'base64').toString('utf8')); }
  catch { return {}; }
}

/** Top-left (TL) coordinates, 1-based pages; wrap + draw text. */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x=40, y=40, w=540, size=12, lineGap=3,
    color=rgb(0,0,0), align='left'
  } = spec;
  const maxLines = (opts.maxLines ?? spec.maxLines ?? 6);
  const hard = norm(text || '');
  if (!hard) return;

  const linesIn = hard.split(/\n/).map(s => s.trim());
  const wrapped = [];
  const widthOf = (s) => font.widthOfTextAtSize(s, Math.max(1, size));

  const wrap = (ln) => {
    const words = ln.split(/\s+/);
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (widthOf(next) <= w || !cur) cur = next;
      else { wrapped.push(cur); cur = w; }
    }
    if (cur) wrapped.push(cur);
  };
  for (const ln of linesIn) wrap(ln);

  const lines = wrapped.slice(0, maxLines);
  const pageH = page.getHeight();
  const baselineY = pageH - y;  // TL → BL
  const lineH = Math.max(1, size) + lineGap;

  let yCursor = baselineY;
  for (const ln of lines) {
    let xDraw = x;
    const wLn = widthOf(ln);
    if (align === 'center') xDraw = x + (w - wLn) / 2;
    else if (align === 'right') xDraw = x + (w - wLn);

    page.drawText(ln, { x: xDraw, y: yCursor - size, size: Math.max(1, size), font, color });
    yCursor -= lineH;
    if (yCursor < 0) break;
  }
}

/** Remote PNG/JPG with transparency preserved when possible. */
async function embedRemoteImage(pdfDoc, url) {
  try {
    if (!url || !/^https?:/i.test(url)) return null;
    if (typeof fetch === 'undefined') return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdfDoc.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdfDoc.embedJpg(bytes);
    try { return await pdfDoc.embedPng(bytes); } catch { return await pdfDoc.embedJpg(bytes); }
  } catch { return null; }
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** GET /public template bytes */
async function loadTemplateBytes(tplName) {
  const abs = path.resolve(__dirname, '..', 'public', String(tplName).replace(/[^A-Za-z0-9._-]/g, ''));
  return await fs.readFile(abs);
}

/** Resolve C/T/R/L from any of (dom, domChar, domDesc). */
function resolveDomKey(...cands) {
  const mapLabel = { concealed:'C', triggered:'T', regulated:'R', lead:'L' };
  const mapChar  = { art:'C', fal:'T', mika:'R', sam:'L' };
  for (const c0 of cands.flat()) {
    const c = String(c0 || '').trim(); if (!c) continue;
    const u = c.toUpperCase(); if (['C','T','R','L'].includes(u)) return u;
    const l = c.toLowerCase();
    if (mapLabel[l]) return mapLabel[l];
    if (mapChar[l])  return mapChar[l];
  }
  return '';
}

// ───────────── LOCKED defaults (TL coords; 1-based pages) ─────────────
// Coach template sections – these keys are also used to form QS override names.
const LOCKED = {
  meta: { units: 'pt', origin: 'TL', pages: '1-based' },

  // Page 1
  p1: {
    name: { x: 60, y: 760, w: 470, size: 22, align: 'left',  maxLines: 1 },
    date: { x: 430, y: 785, w: 140, size: 12, align: 'left',  maxLines: 1 }
  },

  // Page 3: dominant description
  p3: {
    domDesc: { x: 30, y: 685, w: 550, size: 13, align: 'left', maxLines: 20 }
  },

  // Page 4: spider explanation + chart (optional)
  p4: {
    spider: { x: 30, y: 585, w: 550, size: 13, align: 'left', maxLines: 18 },
    chart:  { x: 32, y: 260, w: 560, h: 280 } // TL: will convert to BL internally for image
  },

  // Page 5: sequence paragraph
  p5: {
    seqpat: { x: 25, y: 520, w: 550, size: 13, align: 'left', maxLines: 18 }
  },

  // Page 6: theme & explanation
  p6: {
    theme:     { x: 25, y: 540, w: 550, size: 12, align: 'left', maxLines: 1 },
    themeExpl: { x: 25, y: 520, w: 550, size: 13, align: 'left', maxLines: 18 }
  },

  // Page 7–8: work with colleagues / leaders (pairs of look/work; 2 columns)
  p7: {
    // workwcol LOOK/WORK – top Y is applied in code
    lookCol: { x: 30,  y: 440, w: 240, size: 12, align: 'left', lineGap: 4, maxLines: 5 },
    workCol: { x: 320, y: 440, w: 240, size: 12, align: 'left', lineGap: 4, maxLines: 5 },
    rowGap: 80
  },
  p8: {
    // workwlead LOOK/WORK
    lookCol: { x: 30,  y: 440, w: 240, size: 12, align: 'left', lineGap: 4, maxLines: 5 },
    workCol: { x: 320, y: 440, w: 240, size: 12, align: 'left', lineGap: 4, maxLines: 5 },
    rowGap: 80
  },

  // Page 9: tips (left) + actions (right) lists
  p9: {
    tips:    { x: 30,  y: 450, w: 250, size: 12, align: 'left', lineGap: 4, maxLines: 24 },
    actions: { x: 320, y: 450, w: 250, size: 12, align: 'left', lineGap: 4, maxLines: 24 }
  }
};

// ───────────── read layout overrides from QS ─────────────
/**
 * Builds a partial layout object from QS like:
 *  &p3_domDesc_x=72&p3_domDesc_y=700&p3_domDesc_w=630&p3_domDesc_size=11
 *  &p4_chart_x=355&p4_chart_y=315&p4_chart_w=270&p4_chart_h=250
 */
function layoutFromQuery(qs) {
  const out = {};
  const numericKeys = new Set(['x','y','w','h','size','lineGap','maxLines']);
  const re = /^p(\d+)_(\w+)_(x|y|w|h|size|lineGap|maxLines)$/; // page_field_prop

  for (const [k, v] of Object.entries(qs || {})) {
    const m = k.match(re);
    if (!m) continue;
    const page = `p${m[1]}`;
    const field = m[2];
    const prop = m[3];
    out[page] = out[page] || {};
    out[page][field] = out[page][field] || {};
    out[page][field][prop] = numericKeys.has(prop) ? N(v) : S(v);
  }
  return out;
}

/** Deep merge: RHS overrides LHS objects. */
function deepMerge(a, b) {
  if (!b) return a;
  const out = JSON.parse(JSON.stringify(a || {}));
  for (const k of Object.keys(b)) {
    const bv = b[k], av = out[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(av && typeof av === 'object' ? av : {}, bv);
    } else {
      out[k] = bv;
    }
  }
  return out;
}

// ───────────── input normalisation ─────────────
function normaliseInput(d = {}) {
  const nameCand =
    (d.person && d.person.fullName) ||
    d.fullName || d.preferredName || d.name;

  return {
    name:      norm(nameCand || 'Perspective'),
    email:     S(d?.person?.email || d.email || ''),
    dateLbl:   norm(d.dateLbl || ''),
    dom:       S(d.dom || ''),
    domChar:   S(d.domchar || d.domChar || ''),
    domDesc:   norm(d.domdesc || d.domDesc || ''),
    spiderdesc:norm(d.spiderdesc || ''),
    seqpat:    norm(d.seqpat || ''),
    theme:     norm(d.theme || ''),
    themeExpl: norm(d.themeExpl || ''),
    workwcol:  A(d.workwcol).map(x => ({ look: norm(x?.look || ''), work: norm(x?.work || '') })),
    workwlead: A(d.workwlead).map(x => ({ look: norm(x?.look || ''), work: norm(x?.work || '') })),
    tips:      A(d.tips).map(norm),
    actions:   A(d.actions).map(norm),
    chartUrl:  S(d.chartUrl || d.chart || ''),
    layoutV6:  (d.layoutV6 && typeof d.layoutV6 === 'object') ? d.layoutV6 : null
  };
}

// ───────────── handler ─────────────
export default async function handler(req, res) {
  try {
    const method = req.method || 'GET';
    const isPost = method === 'POST';
    const q = isPost ? (req.body || {}) : (req.query || {});

    const tpl = S(isPost ? q.tpl : q.tpl, 'CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf').trim();
    if (!tpl) {
      res.statusCode = 400;
      return res.end('Missing tpl');
    }

    const raw = Boolean(isPost ? q.raw : q.raw);

    // decode payload
    const dataB64 = S(isPost ? q.data : q.data).trim();
    const src = parseDataParam(dataB64);
    const P   = normaliseInput(src);

    // build layout: defaults → layoutV6 from data → QS overrides
    const L_fromQS = layoutFromQuery(q);
    const L = deepMerge(deepMerge(LOCKED, P.layoutV6 || {}), L_fromQS || {});

    // serve raw template if requested
    const tplBytes = await loadTemplateBytes(tpl);
    if (raw) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 200;
      return res.end(tplBytes);
    }

    // paint
    let outBytes = null;
    try {
      const pdfDoc = await PDFDocument.load(tplBytes);
      const pages  = pdfDoc.getPages();
      const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const p = (i) => pages[i]; // 0-based accessor

      // p1 — name/date
      if (p(0)) {
        if (L.p1?.name && P.name)  drawTextBox(p(0), font, P.name,  L.p1.name,  { maxLines: L.p1.name.maxLines  });
        if (L.p1?.date && P.dateLbl) drawTextBox(p(0), font, P.dateLbl, L.p1.date, { maxLines: L.p1.date.maxLines });
      }

      // p3 — dominant description
      if (p(2) && L.p3?.domDesc && P.domDesc) {
        drawTextBox(p(2), font, P.domDesc, L.p3.domDesc, { maxLines: L.p3.domDesc.maxLines });
      }

      // p4 — spiderdesc + chart
      if (p(3)) {
        if (L.p4?.spider && P.spiderdesc) {
          drawTextBox(p(3), font, P.spiderdesc, L.p4.spider, { maxLines: L.p4.spider.maxLines });
        }
        if (L.p4?.chart && (P.chartUrl || q.chart)) {
          const chartUrl = S(P.chartUrl || q.chart);
          const img = await embedRemoteImage(pdfDoc, chartUrl);
          if (img) {
            const H = p(3).getHeight();
            const { x, y, w, h } = L.p4.chart;
            // TL → BL for images
            p(3).drawImage(img, { x, y: H - y - h, width: clamp(w, 10, 1000), height: clamp(h, 10, 1000) });
          }
        }
      }

      // p5 — sequence
      if (p(4) && L.p5?.seqpat && P.seqpat) {
        drawTextBox(p(4), font, P.seqpat, L.p5.seqpat, { maxLines: L.p5.seqpat.maxLines });
      }

      // p6 — theme + explanation
      if (p(5)) {
        if (L.p6?.theme && P.theme) {
          drawTextBox(p(5), font, P.theme, L.p6.theme, { maxLines: L.p6.theme.maxLines });
        }
        if (L.p6?.themeExpl && P.themeExpl) {
          drawTextBox(p(5), font, P.themeExpl, L.p6.themeExpl, { maxLines: L.p6.themeExpl.maxLines });
        }
      }

      // p7 — work with colleagues (pairs as rows; LOOK left / WORK right)
      if (p(6) && P.workwcol && (P.workwcol.length || 0) > 0) {
        let y = N(L.p7?.lookCol?.y, 440);
        const gap = N(L.p7?.rowGap, 80);
        for (const pair of P.workwcol) {
          const look = norm(pair?.look || '');
          const work = norm(pair?.work || '');
          if (!look && !work) continue;
          if (look) drawTextBox(p(6), font, look, { ...L.p7.lookCol, y }, { maxLines: L.p7.lookCol.maxLines });
          if (work) drawTextBox(p(6), font, work, { ...L.p7.workCol, y }, { maxLines: L.p7.workCol.maxLines });
          y -= gap;
          if (y < 70) break;
        }
      }

      // p8 — work with leaders (pairs)
      if (p(7) && P.workwlead && (P.workwlead.length || 0) > 0) {
        let y = N(L.p8?.lookCol?.y, 440);
        const gap = N(L.p8?.rowGap, 80);
        for (const pair of P.workwlead) {
          const look = norm(pair?.look || '');
          const work = norm(pair?.work || '');
          if (!look && !work) continue;
          if (look) drawTextBox(p(7), font, look, { ...L.p8.lookCol, y }, { maxLines: L.p8.lookCol.maxLines });
          if (work) drawTextBox(p(7), font, work, { ...L.p8.workCol, y }, { maxLines: L.p8.workCol.maxLines });
          y -= gap;
          if (y < 70) break;
        }
      }

      // p9 — tips (left) + actions (right)
      if (p(8)) {
        const drawList = (arr, spec) => {
          const items = A(arr).map(norm).filter(Boolean);
          let y = N(spec.y, 450);
          const gap = N(spec.lineGap, 4) + N(spec.size, 12) * 1.2;
          for (const it of items) {
            drawTextBox(p(8), font, it, { ...spec, y }, { maxLines: spec.maxLines ?? 24 });
            y -= gap;
            if (y < 60) break;
          }
        };
        if (L.p9?.tips && P.tips)    drawList(P.tips,    L.p9.tips);
        if (L.p9?.actions && P.actions) drawList(P.actions, L.p9.actions);
      }

      outBytes = await pdfDoc.save();
    } catch (paintErr) {
      console.error('fill-template: paint error', paintErr);
      outBytes = tplBytes; // fail-soft: return raw template
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    return res.end(outBytes);
  } catch (e) {
    console.error('fill-template: fatal', e);
    try {
      const tpl = S(req.method === 'POST' ? req.body?.tpl : req.query?.tpl).trim();
      if (tpl) {
        const tplBytes = await loadTemplateBytes(tpl);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 200;
        return res.end(tplBytes);
      }
    } catch {}
    res.statusCode = 500;
    return res.end('fill-template failed');
  }
}
