export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ------------------------- small helpers ------------------------- */

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

// Wrap/align text into a box (y = distance from TOP, not bottom)
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

function getOrAddPage(pdf, index) {
  const pages = pdf.getPages();
  if (pages[index]) return pages[index];
  // Add pages up to index
  while (pdf.getPages().length <= index) pdf.addPage();
  return pdf.getPages()[index];
}

async function fetchTemplate(req) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');
  // 👇 use your template path
  const url   = `${proto}://${host}/CTRL_Perspective_Assessment_Profile_template.pdf`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Tuners: missing params fall back to defaults (not zero)
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

/* ---------- robust field pickers from payload ---------- */

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

const pickFullName = (data) => norm(
  (data?.person?.fullName) ??
  data?.fullName ??
  data?.summary?.user?.fullName ??
  data?.summary?.user?.reportCoverName ??
  ''
);

function normFlowLabel(v) {
  const s = S(v).toLowerCase();
  const map = {
    perspective: 'Perspective',
    observe: 'Observe',
    observer: 'Observe',
    mirrored: 'Observe',
    reflective: 'Reflective',
    reflection: 'Reflective',
  };
  return map[s] || 'Perspective';
}

const pickFlowLabel = (data) =>
  normFlowLabel(
    data?.flowLabel ??
    data?.flowLbl ??
    data?.PathName ??
    data?.summary?.flow?.label ??
    'Perspective'
  );

function monthMMM(m) {
  return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Math.max(0, Math.min(11, m))];
}
function formatDateLblFromISO(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw 0;
    const dd = String(d.getUTCDate()).padStart(2,'0');
    const MMM = monthMMM(d.getUTCMonth());
    const yyyy = d.getUTCFullYear();
    return `${dd}/${MMM}/${yyyy}`;
  } catch {
    return '';
  }
}
function pickDateLbl(data) {
  const lbl =
    data?.dateLbl ??
    data?.summary?.flow?.dateLbl ??
    null;
  if (lbl) return S(lbl);

  const iso =
    data?.dateISO ??
    data?.summary?.flow?.dateISO ??
    null;
  if (iso) return formatDateLblFromISO(iso);

  // last fallback: now (UTC) — still DD/MMM/YYYY
  const now = new Date();
  const dd = String(now.getUTCDate()).padStart(2,'0');
  const MMM = monthMMM(now.getUTCMonth());
  const yyyy = now.getUTCFullYear();
  return `${dd}/${MMM}/${yyyy}`;
}

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  // Safe URL parse
  let url;
  try { url = new URL(req?.url || '/', 'http://localhost'); }
  catch { url = new URL('/', 'http://localhost'); }

  const isTest   = url.searchParams.get('test') === '1';
  const isPair   = url.searchParams.get('test') === 'pair';
  const preview  = url.searchParams.get('preview') === '1';
  const debug    = url.searchParams.get('debug') === '1';
  const noGraph  = url.searchParams.get('nograph') === '1';

  // ---- Demo payloads (still handy for visual tuning) ----
  let data;
  if (isTest || isPair) {
    const common = {
      flowLabel: 'Perspective',
      person:   { coverName: 'Avery Example', fullName: 'Avery Example', preferredName: 'Avery', initials: 'AE' },
      dateISO: new Date().toISOString(),
      // headlines / how
      stateWord: 'Regulated',
      how: 'Steady presence; keep clarity alive.',
      // chart
      chartUrl: 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify({
        type: 'radar',
        data: { labels: ['Concealed','Triggered','Regulated','Lead'],
          datasets:[{
            label:'Frequency', data:[0,2,3,0], fill:true,
            backgroundColor:'rgba(115,72,199,0.18)',
            borderColor:'#7348C7', borderWidth:2,
            pointRadius:[0,3,6,0], pointHoverRadius:[0,4,7,0],
            pointBackgroundColor:['#9D7BE0','#9D7BE0','#7348C7','#9D7BE0'],
            pointBorderColor:    ['#9D7BE0','#9D7BE0','#7348C7','#9D7BE0'],
          }]
        },
        options:{
          plugins:{ legend:{ display:false } },
          scales:{ r:{
            min:0,max:5,
            ticks:{ display:true, stepSize:1, backdropColor:'rgba(0,0,0,0)' },
            grid:{ circular:true }, angleLines:{ display:true },
            pointLabels:{ color:'#4A4458', font:{ size:12 } }
          } }
        }
      })),
      // page 2
      page2Patterns: [
        { title:'How the pattern moved', body:'Mixed shifts across your five answers; the middle held steady.' },
        { title:'Range & gaps', body:'You saw less of Concealed and Lead this time. Range of 2 states.' }
      ],
      themeNarrative: 'What stood out here was Emotion regulation with Feedback handling and Awareness of impact.',
      // page 6
      dominantParagraph: 'You connect the most with Mika: grounded and steady under pressure.',
      chartParagraph: 'This radar shows how often each state appeared. Your dominant is Regulated; Triggered was next, with no instances of Concealed or Lead.',
      // page 7
      patternParagraph: 'Shape+coverage: Mixed pattern with steady middle, coverage of 2/4 states.',
      missingParagraph: 'Missing states: Concealed and Lead did not appear here.',
      themeTop3Keys: ['emotion_regulation','feedback_handling','awareness_impact'],
      themePairParagraph: 'Emotion regulation paired with Feedback handling often points to clean intent after resets.',
      tip1: 'Take one slow breath before you speak.',
      tip2: 'Add a brief check-in between moments.',
      actionsTop2: ['Notice when you shift gears; name it.', 'Ask one clarifying question before you answer.']
    };
    data = isPair
      ? { ...common, stateWords: ['Regulated','Lead'], howPair: 'You can move from steadiness into light direction.' }
      : common;
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

  /* ---------------- Coordinates / Style ----------------
     Adjust these numbers in GitHub as needed.
     All y values are distance from TOP (thanks to drawTextBox).
  ------------------------------------------------------ */
  const POS = {
    // Common header (all pages)
    header: {
      flow:   { x: 40,  y: 36,  w: 250, size: 12, color: rgb(0.15,0.14,0.24) },
      name:   { x: 300, y: 36,  w: 450, size: 12, color: rgb(0.15,0.14,0.24), align: 'right' },
      date:   { x: 760, y: 36,  w: 140, size: 12, color: rgb(0.15,0.14,0.24), align: 'right' }, // page 1 only
    },

    // Page 1 — big headline + how + cover name + chart + tips
    headlineSingle: { x: 90,  y: 650, w: 860, size: 72, lineGap: 4, color: rgb(0.12,0.11,0.2), align:'center' },
    headlinePair:   { x: 90,  y: 650, w: 860, size: 56, lineGap: 4, color: rgb(0.12,0.11,0.2), align:'center' },
    howSingle:      { x: 85,  y: 818, w: 890, size: 25, lineGap: 6, color: rgb(0.24,0.23,0.35), align:'center' },
    howPairBlend:   { x: 55,  y: 830, w: 950, size: 24, lineGap: 5, color: rgb(0.24,0.23,0.35), align:'center' },
    nameCover:      { x: 600, y: 100, w: 860, size: 60, lineGap: 3, color: rgb(0.12,0.11,0.2), align:'center' },
    tip1Body:       { x: 120, y: 1015, w: 410, size: 23, lineGap: 3, color: rgb(0.24,0.23,0.35), align:'center' },
    tip2Body:       { x: 500, y: 1015, w: 460, size: 23, lineGap: 3, color: rgb(0.24,0.23,0.35), align:'center' },
    chart:          { x: 1030, y: 620,  w: 720, h: 420 },

    // Page 2 — left blocks + right theme para
    p2Patterns:   { x:120, y:520, w:1260, hSize:14, bSize:20, align:'left', titleGap:6, blockGap:20, maxBodyLines:6 },
    p2ThemePara:  { x:1280, y:620, w:630,  size:30, lineGap:4, color: rgb(0.24,0.23,0.35), align:'left', maxLines:14 },

    // Page 6 — Dominant/character + chart + explainer
    p6: {
      domTitle:  { x: 120, y: 180, w: 800, size: 36, lineGap: 6, color: rgb(0.12,0.11,0.2) },
      domBlurb:  { x: 120, y: 230, w: 1000, size: 20, lineGap: 4, color: rgb(0.24,0.23,0.35) },
      chart:     { x: 120, y: 360, w: 600,  h: 420 },
      chartNote: { x: 760, y: 360, w: 580,  size: 18, lineGap: 4, color: rgb(0.24,0.23,0.35) },
    },

    // Page 7 — Five blocks (titles + bodies)
    p7: {
      blockTitleSize: 18,
      blockBodySize:  18,
      titleGap: 6,
      blockGap: 20,
      x: 120,
      w: 1220,
      startY: 220,
      maxBodyLines: 6
    },
  };

  // Quick tuners via query (optional)
  POS.howSingle = {
    ...POS.howSingle,
    x: qnum(url,'hx', POS.howSingle.x),
    y: qnum(url,'hy', POS.howSingle.y),
    w: qnum(url,'hw', POS.howSingle.w),
    size: qnum(url,'hs', POS.howSingle.size),
    align: qstr(url,'halign', POS.howSingle.align),
  };
  POS.nameCover = {
    ...POS.nameCover,
    x: qnum(url,'nx',POS.nameCover.x),
    y: qnum(url,'ny',POS.nameCover.y),
    w: qnum(url,'nw',POS.nameCover.w),
    size: qnum(url,'ns',POS.nameCover.size),
    align: qstr(url,'nalign',POS.nameCover.align),
  };
  POS.chart = { ...POS.chart,
    x: qnum(url,'cx',POS.chart.x), y: qnum(url,'cy',POS.chart.y),
    w: qnum(url,'cw',POS.chart.w), h: qnum(url,'ch',POS.chart.h),
  };

  if (debug) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok:true,
      hint:'Add &preview=1 to view inline',
      pos:POS,
      data,
      urlParams:Object.fromEntries(url.searchParams.entries())
    }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req);
    const pdf = await PDFDocument.load(tplBytes);

    // Ensure we have at least 8 pages available (template may already have them)
    for (let i = 0; i < 8; i++) getOrAddPage(pdf, i);

    const pages = pdf.getPages();
    const page1 = pages[0];
    const page2 = pages[1];
    const page3 = pages[2];
    const page4 = pages[3];
    const page5 = pages[4];
    const page6 = pages[5];
    const page7 = pages[6];
    const page8 = pages[7];

    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    /* ---------------- Values for headers ---------------- */

    const flowLabel = pickFlowLabel(data);          // Perspective / Observe / Reflective
    const fullName  = pickFullName(data) || pickCoverName(data, url) || '';
    const dateLbl   = pickDateLbl(data);            // DD/MMM/YYYY

    function drawHeader(page, withDate = false) {
      drawTextBox(page, HelvB, flowLabel, POS.header.flow, { maxLines: 1, ellipsis: true });
      if (fullName) drawTextBox(page, Helv, fullName, POS.header.name, { maxLines: 1, ellipsis: true });
      if (withDate && dateLbl) drawTextBox(page, Helv, dateLbl, POS.header.date, { maxLines: 1, ellipsis: true });
    }

    /* ---------------- Page 1 ---------------- */
    drawHeader(page1, /*withDate=*/true);

    // Headline (single vs pair)
    const two = Array.isArray(data.stateWords) && data.stateWords.filter(Boolean).length >= 2;
    const headline = two
      ? `${norm((data.stateWords||[])[0])} & ${norm((data.stateWords||[])[1])}`
      : norm(data.stateWord || '—');
    drawTextBox(page1, HelvB, headline,
      { ...(two ? POS.headlinePair : POS.headlineSingle) },
      { maxLines: 1, ellipsis: true }
    );

    // Cover Name (big)
    const coverName = pickCoverName(data, url);
    if (coverName) drawTextBox(page1, HelvB, coverName, POS.nameCover, { maxLines: 1, ellipsis: true });

    // HOW
    if (two) {
      const t = data.howPair || data.how || '';
      if (t) drawTextBox(page1, Helv, t, POS.howPairBlend, { maxLines: 3, ellipsis: true });
    } else {
      if (data.how) drawTextBox(page1, Helv, data.how, POS.howSingle, { maxLines: 3, ellipsis: true });
    }

    // Tips
    if (data.tip1) drawTextBox(page1, Helv, data.tip1, POS.tip1Body, { maxLines: 2, ellipsis: true });
    if (data.tip2) drawTextBox(page1, Helv, data.tip2, POS.tip2Body, { maxLines: 2, ellipsis: true });

    // Chart on page 1 (optional)
    if (!noGraph && data.chartUrl) {
      try {
        const r = await fetch(S(data.chartUrl,''));
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart;
          const ph = page1.getHeight();
          page1.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore chart errors */ }
    }

    /* ---------------- Page 2 ---------------- */
    drawHeader(page2);

    // Left: up to TWO blocks (pattern/coverage etc)
    const rawBlocks = Array.isArray(data.page2Patterns)
      ? data.page2Patterns
      : Array.isArray(data.page2Blocks) ? data.page2Blocks : [];
    const twoBlocks = rawBlocks
      .map(b => ({ title: norm(b?.title||''), body: norm(b?.body||'') }))
      .filter(b => b.title || b.body)
      .slice(0, 2);

    let curY = POS.p2Patterns.y;
    for (const b of twoBlocks) {
      if (b.title) {
        drawTextBox(
          page2, HelvB, b.title,
          { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.hSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: 1, ellipsis: true }
        );
        curY += (POS.p2Patterns.hSize + 3) + POS.p2Patterns.titleGap;
      }
      if (b.body) {
        const r = drawTextBox(
          page2, Helv, b.body,
          { x: POS.p2Patterns.x, y: curY, w: POS.p2Patterns.w, size: POS.p2Patterns.bSize, align: POS.p2Patterns.align, color: rgb(0.24,0.23,0.35), lineGap:3 },
          { maxLines: POS.p2Patterns.maxBodyLines, ellipsis: true }
        );
        curY += r.height + POS.p2Patterns.blockGap;
      }
    }

    // Right: theme narrative
    const themeNarr = (()=>{
      if (typeof data.themeNarrative === 'string' && data.themeNarrative.trim())
        return norm(data.themeNarrative.trim());
      if (Array.isArray(data.page2Themes) && data.page2Themes.length) {
        const bits = data.page2Themes
          .map(t => [t?.title, t?.body].filter(Boolean).join(': '))
          .filter(Boolean);
        return norm(bits.join('  '));
      }
      if (typeof data.themesExplainer === 'string' && data.themesExplainer.trim())
        return norm(data.themesExplainer.replace(/\n+/g, ' ').replace(/•\s*/g, '').trim());
      return '';
    })();

    if (themeNarr) {
      drawTextBox(
        page2,
        Helv,
        themeNarr,
        { x: POS.p2ThemePara.x, y: POS.p2ThemePara.y, w: POS.p2ThemePara.w, size: POS.p2ThemePara.size, align: POS.p2ThemePara.align, color: POS.p2ThemePara.color, lineGap: POS.p2ThemePara.lineGap },
        { maxLines: POS.p2ThemePara.maxLines, ellipsis: true }
      );
    }

    /* ---------------- Pages 3,4,5,8: header only ---------------- */
    [page3, page4, page5, page8].forEach(p => drawHeader(p));

    /* ---------------- Page 6 ---------------- */
    drawHeader(page6);

    // Dominant state title
    const dominantLabel =
      S(data.dominantLabel) ||
      S(data.stateWord) ||
      (Array.isArray(data.stateWords) && data.stateWords[0]) ||
      '—';
    drawTextBox(page6, HelvB, dominantLabel, POS.p6.domTitle, { maxLines: 1, ellipsis: true });

    // Character blurb
    const domBlurb =
      S(data.dominantParagraph) ||
      S(data.characterBlurb) ||
      S(data.ctrlCard?.dominantParagraph) ||
      '';
    if (domBlurb) drawTextBox(page6, Helv, domBlurb, POS.p6.domBlurb, { maxLines: 6, ellipsis: true });

    // Spider chart (repeat here)
    if (!noGraph && data.chartUrl) {
      try {
        const r = await fetch(S(data.chartUrl,''));
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.p6.chart;
          const ph = page6.getHeight();
          page6.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore chart errors */ }
    }

    // Chart explainer
    const chartExplain =
      S(data.chartParagraph) ||
      S(data.ctrlCard?.chartParagraph) ||
      'This radar shows how often each state appeared across your five choices.';
    if (chartExplain) drawTextBox(page6, Helv, chartExplain, POS.p6.chartNote, { maxLines: 16, ellipsis: true });

    /* ---------------- Page 7 ---------------- */
    drawHeader(page7);

    // Build five blocks of content
    const shapeCoverage =
      S(data.patternParagraph) ||
      S(data.block1_text) ||
      S((data.page2Patterns?.[0]?.body)) ||
      '';
    const missingBlock =
      S(data.missingParagraph) ||
      (Array.isArray(data.missingStates)
        ? `Missing states: ${data.missingStates.join(', ')}`
        : data.missingKey
          ? (data.missingKey === 'none' ? 'No states were missing in this short run.' : `Missing states: ${data.missingKey}`)
          : '');
    const themeTop2Para =
      S(data.themePairParagraph) ||
      (Array.isArray(data.themeTop3Keys) && data.themeTop3Keys.length >= 2
        ? `Top themes: ${data.themeTop3Keys.slice(0,2).join(' + ')}`
        : S(data.themeNarrative));
    const tipsPara = (() => {
      const t1 = S(data.tip1) || S(data.tips?.[0]) || '';
      const t2 = S(data.tip2) || S(data.tips?.[1]) || '';
      const parts = [t1, t2].filter(Boolean);
      return parts.length ? 'Tips: • ' + parts.join('  • ') : '';
    })();
    const actionsPara = (() => {
      const arr = Array.isArray(data.actionsTop2) ? data.actionsTop2
        : [S(data.action1), S(data.action2)].filter(Boolean);
      return arr && arr.length ? 'Actions: • ' + arr.join('  • ') : '';
    })();

    const blocksP7 = [
      { title: 'Shape + Coverage', body: shapeCoverage },
      { title: 'Missing State(s)', body: missingBlock },
      { title: 'Theme Pair',       body: themeTop2Para },
      { title: 'Top Tips',         body: tipsPara },
      { title: 'Top Actions',      body: actionsPara },
    ].filter(b => b.title && b.body);

    let y7 = POS.p7.startY;
    for (const b of blocksP7) {
      // title
      drawTextBox(page7, HelvB, b.title,
        { x: POS.p7.x, y: y7, w: POS.p7.w, size: POS.p7.blockTitleSize, color: rgb(0.24,0.23,0.35), lineGap: 3 },
        { maxLines: 1, ellipsis: true }
      );
      y7 += POS.p7.blockTitleSize + POS.p7.titleGap;

      // body
      const r = drawTextBox(page7, Helv,
        b.body,
        { x: POS.p7.x, y: y7, w: POS.p7.w, size: POS.p7.blockBodySize, color: rgb(0.24,0.23,0.35), lineGap: 4 },
        { maxLines: POS.p7.maxBodyLines, ellipsis: true }
      );
      y7 += r.height + POS.p7.blockGap;
      if (y7 > (page7.getHeight() - 80)) break; // prevent overflow if template is tight
    }

    /* ---------------- Save ---------------- */
    const outName = `CTRL_${(fullName||'there').replace(/\s+/g,'_')}_${dateLbl.replace(/\//g,'')}.pdf`;
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${outName}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
