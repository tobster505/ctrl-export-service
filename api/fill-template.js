export const config = { runtime: 'nodejs' };

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ------------------------- tiny utils ------------------------- */
const S = (v, fb = '') => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const norm = (v, fb = '') =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); // strip control chars

// Wrap into a top-left specified box (y measured from top)
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = 'left'
  } = spec;
  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;
  const clean = norm(text);
  if (!clean) return { height: 0, linesDrawn: 0, lastY: page.getHeight() - y };

  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const lines = [];
  for (const rawLine of clean.split('\n')) {
    let t = rawLine.trim();
    while (t.length > maxChars) {
      let cut = t.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      lines.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    if (t) lines.push(t);
  }
  const out = lines.length > maxLines
    ? lines.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, '…') : s))
    : lines;

  const pageH = page.getHeight();
  const yTop = pageH - y;
  const lineH = size + lineGap;
  const widthOf = (s) => font.widthOfTextAtSize(s, size);

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

// AMS date label
function dateLabelAMS(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam', day: '2-digit', month: 'short', year: 'numeric'
    }).formatToParts(date);
    const dd = parts.find(p => p.type === 'day')?.value || '01';
    const MMM = (parts.find(p => p.type === 'month')?.value || 'Jan').toUpperCase();
    const yyyy = parts.find(p => p.type === 'year')?.value || '1970';
    return `${dd}/${MMM}/${yyyy}`;
  } catch {
    const MMM_MAP = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const d = new Date();
    return `${String(d.getUTCDate()).padStart(2,'0')}/${MMM_MAP[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
  }
}

function qnum(url, key, fb) { const s = url.searchParams.get(key); return s === null || s === '' ? fb : N(s, fb); }
function qstr(url, key, fb) { const s = url.searchParams.get(key); return s == null || s === '' ? fb : s; }

async function fetchTemplate(req, url) {
  const h = (req && req.headers) || {};
  const host  = S(h.host, 'ctrl-export-service.vercel.app');
  const proto = S(h['x-forwarded-proto'], 'https');
  const tplName = qstr(url, 'tpl', 'CTRL_Perspective_Assessment_Profile_templateV3.pdf');
  const full = `${proto}://${host}/${tplName}`;
  const r = await fetch(full);
  if (!r.ok) throw new Error(`template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

/* --------------------- chart helpers & selection --------------------- */

// Build a circular radar quickchart from counts {C,T,R,L}
function makeChartUrl(counts = { C:0, T:0, R:0, L:0 }) {
  const data = [counts.C||0, counts.T||0, counts.R||0, counts.L||0];
  const cfg = {
    type: 'radar',
    data: {
      labels: ['Concealed','Triggered','Regulated','Lead'],
      datasets: [{
        label: 'Frequency',
        data, fill: true,
        backgroundColor: 'rgba(115,72,199,0.18)',
        borderColor: '#7348C7', borderWidth: 2,
        pointRadius: [3,3,3,3], pointHoverRadius: [4,4,4,4],
        pointBackgroundColor: ['#9D7BE0','#9D7BE0','#9D7BE0','#9D7BE0'],
        pointBorderColor:     ['#9D7BE0','#9D7BE0','#9D7BE0','#9D7BE0']
      }]
    },
    options: {
      plugins:{ legend:{ display:false } },
      scales:{ r:{
        min:0, max:5,
        ticks:{ display:true, stepSize:1, backdropColor:'rgba(0,0,0,0)' },
        grid:{ circular:true },       // <— circular grid lines (compass feel)
        angleLines:{ display:true },
        pointLabels:{ color:'#4A4458', font:{ size:12 } }
      } }
    }
  };
  return 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(cfg));
}

// decide dominant letter from counts
function dominantLetter(counts) {
  const order = ['L','R','T','C']; // tie-break prefer higher level
  const entries = Object.entries(counts || {}).filter(([k]) => 'CRTL'.includes(k));
  const max = Math.max(...entries.map(([,v]) => v||0), 0);
  const tied = entries.filter(([,v]) => (v||0) === max).map(([k]) => k);
  if (!tied.length) return 'R';
  // prefer higher level by order above
  for (const k of order) if (tied.includes(k)) return k;
  return tied[0];
}

// decide secondary letter (for 4+1, 3+2…)
function secondLetter(counts, primary) {
  const entries = Object.entries(counts || {}).filter(([k]) => 'CRTL'.includes(k) && k !== primary);
  const max = Math.max(...entries.map(([,v]) => v||0), 0);
  const tied = entries.filter(([,v]) => (v||0) === max).map(([k]) => k);
  const order = ['L','R','T','C'];
  for (const k of order) if (tied.includes(k)) return k;
  return tied[0] || null;
}

// choose COPY.chart key like "chart.3.2.R.T" / "chart.5.R" / "chart.2.1.1.1.R.C.L.T"
function pickChartKey(counts) {
  const a = ['C','T','R','L'].map(k => counts[k]||0);
  const sorted = [...a].sort((x,y)=>y-x);
  if (sorted[0] === 5) {
    // 5-of-a-kind
    const dom = dominantLetter(counts);
    return `chart.5.${dom}`;
  }
  if (sorted[0] === 4 && sorted[1] === 1) {
    const dom = dominantLetter(counts);
    const sec = secondLetter(counts, dom);
    return `chart.4.1.${dom}.${sec}`;
  }
  if (sorted[0] === 3 && sorted[1] === 2) {
    const major = dominantLetter(counts);
    const minor = secondLetter(counts, major);
    return `chart.3.2.${major}.${minor}`;
  }
  if (sorted[0] === 3 && sorted[1] === 1 && sorted[2] === 1) {
    // need two letters: primary + whichever is next highest, prefer level order
    const major = dominantLetter(counts);
    const rest = { ...counts }; delete rest[major];
    const sec = secondLetter(rest, null);
    // put remaining 1 as tertiary (we don't encode 3.1.1.*.*.* fully; pick the best available narrative)
    return `chart.3.1.1.${major}.${sec}.` + (['C','T','R','L'].find(k => k!==major && k!==sec && (counts[k]||0)>0) || 'R');
  }
  if (sorted[0] === 2 && sorted[1] === 2 && sorted[2] === 1) {
    // 2+2+1
    // pick top two by level order; then the 1
    const toPairs = Object.entries(counts).sort((a,b) => (b[1]-a[1]) || (['L','R','T','C'].indexOf(a[0]) - ['L','R','T','C'].indexOf(b[0])));
    const [k1,k2,k3] = toPairs.slice(0,3).map(x=>x[0]);
    return `chart.2.2.1.${k1}.${k2}.${k3}`;
  }
  // fallback full-equal
  if (sorted[0] === 1) return 'chart.1.1.1.1';
  // final fallback
  const dom = dominantLetter(counts);
  return `chart.5.${dom}`;
}

/* --------------------------- handler --------------------------- */
export default async function handler(req, res) {
  // Safe URL parse
  let url; try { url = new URL(req?.url || '/', 'http://localhost'); } catch { url = new URL('/', 'http://localhost'); }

  // Accept ?data= (base64 JSON) or ?test=1 demos
  const isTest = url.searchParams.get('test') === '1';
  const preview = url.searchParams.get('preview') === '1';

  // test/demo payload
  let data;
  if (isTest) {
    data = {
      person: { fullName: 'Toby New', preferredName: 'Toby', coverName: 'Toby New' },
      flow: qstr(url,'flow','Perspective'),
      // counts from your example T2 R3
      counts: { C:0, T:2, R:3, L:0 },
      outcomes: ['T','R','R','R','T'],
      COPY: {}, // allow override if you pass debug text loaders later
      // When Botpress doesn’t send these, we’ll derive them:
      chartUrl: makeChartUrl({ C:0, T:2, R:3, L:0 })
    };
  } else {
    const b64 = url.searchParams.get('data');
    if (!b64) { res.statusCode = 400; res.end('Missing ?data'); return; }
    try { data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }
    catch (e) { res.statusCode = 400; res.end('Invalid ?data: ' + (e?.message || e)); return; }
  }

  // Pull fields with resilience
  const flow = norm(data.flow || data.pathName || 'Perspective');
  const person = data.person || {};
  const fullName = norm(person.fullName || data.fullName || data.coverName || '');
  const preferred = norm(person.preferredName || (fullName ? fullName.split(' ')[0] : ''));
  const coverName = norm(person.coverName || fullName || preferred);

  // Counts, outcomes
  const counts = {
    C: N(data?.counts?.C, 0),
    T: N(data?.counts?.T, 0),
    R: N(data?.counts?.R, 0),
    L: N(data?.counts?.L, 0),
  };
  const outcomes = Array.isArray(data?.outcomes) ? data.outcomes.map(S) : [];

  // Dominant selection & labels
  const domLetter = (S(data.domLetter) || dominantLetter(counts));
  const charNames = { C:'Art', T:'Fal', R:'Mika', L:'Sam' };
  const stateNames = { C:'Concealed', T:'Triggered', R:'Regulated', L:'Lead' };
  const domLabel = stateNames[domLetter] || 'Regulated';

  // COPY fallback (if caller doesn’t ship Workflow.COPY in payload)
  const COPY = data.COPY || {}; // expected structure per your loader

  // Dominant description (from COPY.dominant)
  const domDesc =
    norm(data.domDesc) ||
    norm(COPY?.dominant?.[domLetter]) ||
    `You connect the most with ${charNames[domLetter] || 'Mika'}.`;

  // “How this shows up…” — pick chart matrix text
  const chartKey = pickChartKey(counts);
  const howText =
    norm(data.howText) ||
    norm(COPY?.chart?.[chartKey]) ||
    'You combine steadiness with clear movement; your pattern shows constructive balance.';

  // Chart URL (circular radar)
  const chartUrl = S(data.chartUrl) || makeChartUrl(counts);

  // Page 7: Pattern + Missing + Themes
  // patternKey: use caller’s, else infer “pattern.mixed.<coverage>”
  const coverage = ['C','T','R','L'].reduce((acc, k) => acc + ((counts[k]||0) > 0 ? 1 : 0), 0);
  const patternKey = S(data.patternKey) || `pattern.mixed.${coverage}`;
  const patternText = norm(COPY?.pattern?.[patternKey]) || norm(data.patternText) || '';

  const missingLetters = ['C','T','R','L'].filter(k => (counts[k]||0) === 0);
  const missingKey = missingLetters.length ? missingLetters.join(',') : 'none';
  const missingText = norm(COPY?.missing?.[missingKey]) || norm(data.missingText) || '';

  // themes narrative (either provided as prose OR derive top2 pair key if present)
  let themeNarr = '';
  if (typeof data.themeNarrative === 'string' && data.themeNarrative.trim()) {
    themeNarr = norm(data.themeNarrative.trim());
  } else if (Array.isArray(data.themePairKeys) && data.themePairKeys.length) {
    // Take the first pair and try COPY.theme[pair]
    const k = data.themePairKeys[0];
    themeNarr = norm(COPY?.theme?.[k] || '');
  } else if (Array.isArray(data.page2Themes) && data.page2Themes.length) {
    // flatten legacy
    themeNarr = data.page2Themes
      .map(t => [t?.title, t?.body].filter(Boolean).join(': '))
      .filter(Boolean).join('  ');
  }

  // Date
  const dateLbl = norm(data.dateLbl) || dateLabelAMS();

  // Path/Name placements for pages 1..8
  const HEAD_DEF = {
    // Page 1
    1: { f: { x:290, y:170, w:400, s:40, align:'left'  },
         n: { x:10,  y:573, w:500, s:30, align:'center'},
         d: { x:130, y:630, w:500, s:20, align:'left'  } },
    // Pages 2..8 – your locked coords
    2: { f: { x:200, y:64, w:400, s:13, align:'left'  }, n: { x:250, y:64, w:400, s:12, align:'center' } },
    3: { f: { x:200, y:64, w:400, s:13, align:'left'  }, n: { x:250, y:64, w:400, s:12, align:'center' } },
    4: { f: { x:200, y:64, w:400, s:13, align:'left'  }, n: { x:250, y:64, w:400, s:12, align:'center' } },
    5: { f: { x:200, y:64, w:400, s:13, align:'left'  }, n: { x:250, y:64, w:400, s:12, align:'center' } },
    6: { f: { x:200, y:64, w:400, s:13, align:'left'  }, n: { x:250, y:64, w:400, s:12, align:'center' } },
    7: { f: { x:200, y:64, w:400, s:13, align:'left'  }, n: { x:250, y:64, w:400, s:12, align:'center' } },
    8: { f: { x:200, y:64, w:400, s:13, align:'left'  }, n: { x:250, y:64, w:400, s:12, align:'center' } },
  };

  // Allow URL tuners (your locked defaults above)
  function headFromUrl(url, pageIdx, def) {
    const f = { ...def.f };
    const n = { ...def.n };
    if (pageIdx === 1) {
      f.x = qnum(url,'f1x',f.x); f.y = qnum(url,'f1y',f.y); f.w = qnum(url,'f1w',f.w); f.s = qnum(url,'f1s',f.s); f.align = qstr(url,'f1align',f.align);
      n.x = qnum(url,'n1x',n.x); n.y = qnum(url,'n1y',n.y); n.w = qnum(url,'n1w',n.w); n.s = qnum(url,'n1s',n.s); n.align = qstr(url,'n1align',n.align);
      var d = { x: qnum(url,'d1x',HEAD_DEF[1].d.x), y: qnum(url,'d1y',HEAD_DEF[1].d.y), w: qnum(url,'d1w',HEAD_DEF[1].d.w), s: qnum(url,'d1s',HEAD_DEF[1].d.s), align: qstr(url,'d1align',HEAD_DEF[1].d.align) };
      return { f, n, d };
    } else {
      const i = pageIdx;
      f.x = qnum(url,`f${i}x`,f.x); f.y = qnum(url,`f${i}y`,f.y); f.w = qnum(url,`f${i}w`,f.w); f.s = qnum(url,`f${i}s`,f.s); f.align = qstr(url,`f${i}align`,f.align);
      n.x = qnum(url,`n${i}x`,n.x); n.y = qnum(url,`n${i}y`,n.y); n.w = qnum(url,`n${i}w`,n.w); n.s = qnum(url,`n${i}s`,n.s); n.align = qstr(url,`n${i}align`,n.align);
      return { f, n };
    }
  }

  // Page-6 (dominant block) & Page-7 (patterns/themes) placements
  const POS6 = {
    dom:   { x: qnum(url,'dom6x',55),  y: qnum(url,'dom6y',280), w: qnum(url,'dom6w',900), s: qnum(url,'dom6s',33), align: qstr(url,'dom6align','left') },
    desc:  { x: qnum(url,'dom6descx',40), y: qnum(url,'dom6descy',380), w: qnum(url,'dom6descw',250), s: qnum(url,'dom6descs',15), align: qstr(url,'dom6descalign','left'), max: qnum(url,'dom6descmax',8) },
    how:   { x: qnum(url,'how6x',420),   y: qnum(url,'how6y',360),  w: qnum(url,'how6w',300),  s: qnum(url,'how6s',22),  align: qstr(url,'how6align','left'), max: qnum(url,'how6max',4) },
    chart: { x: qnum(url,'c6x',203),     y: qnum(url,'c6y',230),    w: qnum(url,'c6w',420),    h: qnum(url,'c6h',220) }
  };
  const POS7 = {
    pat: { x: qnum(url,'p6px',120), y: qnum(url,'p6py',520), w: qnum(url,'p6pw',1260), hSize: qnum(url,'p6phsize',14), bSize: qnum(url,'p6pbsize',20), align: qstr(url,'p6palign','left'), titleGap: qnum(url,'p6ptitlegap',6), blockGap: qnum(url,'p6pblockgap',20), maxBody: qnum(url,'p6pmax',6) },
    thm: { x: qnum(url,'p6tx',1280), y: qnum(url,'p6ty',620), w: qnum(url,'p6tw',630), s: qnum(url,'p6ts',30), align: qstr(url,'p6talign','left'), max: qnum(url,'p6tmax',14) }
  };

  // Optionally show debug JSON instead of PDF
  if (url.searchParams.get('debug') === '1') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true, flow, fullName, counts, domLetter, domLabel, chartKey,
      chartUrl, dateLbl, POS6, POS7
    }, null, 2));
    return;
  }

  try {
    const tplBytes = await fetchTemplate(req, url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageCount = pdf.getPageCount();

    // Guard: function to get page by 1-based index if exists
    const getPage1 = (i) => (i >= 1 && i <= pageCount) ? pdf.getPage(i - 1) : null;

    /* -------------------- PAGE HEADERS -------------------- */
    for (let i = 1; i <= 8; i++) {
      const p = getPage1(i);
      if (!p) continue;
      const def = HEAD_DEF[i] || HEAD_DEF[2];
      const H = headFromUrl(url, i, def);
      // Flow label
      if (H.f) drawTextBox(p, Helv, flow, { x:H.f.x, y:H.f.y, w:H.f.w, size:H.f.s, align:H.f.align, color: rgb(0.24,0.23,0.35) }, { maxLines:1, ellipsis:true });
      // Name
      if (H.n) drawTextBox(p, Helv, fullName || coverName || preferred, { x:H.n.x, y:H.n.y, w:H.n.w, size:H.n.s, align:H.n.align, color: rgb(0.24,0.23,0.35) }, { maxLines:1, ellipsis:true });
      // Date on page 1 only
      if (i === 1 && H.d) drawTextBox(p, Helv, dateLbl, { x:H.d.x, y:H.d.y, w:H.d.w, size:H.d.s, align:H.d.align, color: rgb(0.24,0.23,0.35) }, { maxLines:1, ellipsis:true });
    }

    /* -------------------- PAGE 6 (dominant + chart + how) -------------------- */
    const page6 = getPage1(6);
    if (page6) {
      // Dominant state heading
      drawTextBox(page6, HelvB, domLabel, { x:POS6.dom.x, y:POS6.dom.y, w:POS6.dom.w, size:POS6.dom.s, align:POS6.dom.align, color: rgb(0.12,0.11,0.2) }, { maxLines:1, ellipsis:true });
      // Dominant description (left column)
      drawTextBox(page6, Helv, domDesc, { x:POS6.desc.x, y:POS6.desc.y, w:POS6.desc.w, size:POS6.desc.s, align:POS6.desc.align, color: rgb(0.24,0.23,0.35) }, { maxLines:POS6.desc.max, ellipsis:true });
      // “How this shows up…” (right column)
      drawTextBox(page6, Helv, howText, { x:POS6.how.x, y:POS6.how.y, w:POS6.how.w, size:POS6.how.s, align:POS6.how.align, color: rgb(0.24,0.23,0.35) }, { maxLines:POS6.how.max, ellipsis:true });
      // Spider chart
      if (chartUrl) {
        try {
          const r = await fetch(chartUrl);
          if (r.ok) {
            const png = await pdf.embedPng(await r.arrayBuffer());
            const ph = page6.getHeight();
            page6.drawImage(png, { x: POS6.chart.x, y: ph - POS6.chart.y - POS6.chart.h, width: POS6.chart.w, height: POS6.chart.h });
          }
        } catch { /* ignore chart errors */ }
      }
    }

    /* -------------------- PAGE 7 (general analysis) -------------------- */
    const page7 = getPage1(7);
    if (page7) {
      // Left column blocks: (1) shape+coverage, (2) missing
      const blocks = [];
      if (patternText) blocks.push({ title: 'Shape & Coverage', body: patternText });
      if (missingText) blocks.push({ title: 'Missing state(s)', body: missingText });

      let curY = POS7.pat.y;
      for (const b of blocks.slice(0, 3)) {
        // title
        drawTextBox(page7, HelvB, b.title, { x:POS7.pat.x, y:curY, w:POS7.pat.w, size:POS7.pat.hSize, align:POS7.pat.align, color: rgb(0.24,0.23,0.35) }, { maxLines:1, ellipsis:true });
        curY += (POS7.pat.hSize + 3) + POS7.pat.titleGap;
        // body
        const r = drawTextBox(page7, Helv, b.body, { x:POS7.pat.x, y:curY, w:POS7.pat.w, size:POS7.pat.bSize, align:POS7.pat.align, color: rgb(0.24,0.23,0.35) }, { maxLines:POS7.pat.maxBody, ellipsis:true });
        curY += r.height + POS7.pat.blockGap;
      }

      // Right column: themes narrative
      if (themeNarr) {
        drawTextBox(page7, Helv, themeNarr, { x:POS7.thm.x, y:POS7.thm.y, w:POS7.thm.w, size:POS7.thm.s, align:POS7.thm.align, color: rgb(0.24,0.23,0.35) }, { maxLines:POS7.thm.max, ellipsis:true });
      }
    }

    // Save / send
    const fileName = S(url.searchParams.get('name')) || 'ctrl_profile.pdf';
    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${fileName}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('fill-template error: ' + (e?.message || e));
  }
}
