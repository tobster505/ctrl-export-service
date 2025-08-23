// Render styled HTML → PDF via headless Chrome on Vercel
// ESM
export const config = { runtime: 'nodejs20.x' };

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

function squash(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}
const countsLine = (c={}) => `C:${c.C??0}  T:${c.T??0}  R:${c.R??0}  L:${c.L??0}`;

function renderHTML(p) {
  const title = squash(p.title ?? 'CTRL — Snapshot');
  const intro = squash(p.intro ?? '');
  const headline = squash(p.headline ?? '');
  const meaning = squash(p.meaning ?? '');
  const chartUrl = String(p.chartUrl || '');
  const dirLabel = squash(p.directionLabel ?? '');
  const dirMeaning = squash(p.directionMeaning ?? '');
  const themeLabel = squash(p.themeLabel ?? '');
  const themeMeaning = squash(p.themeMeaning ?? '');
  const patternNote = squash(p.patternNote ?? '');
  const tip1 = squash(p.tips?.primary ?? '');
  const tip2 = squash(p.tips?.next ?? '');
  const seq = squash(p.raw?.sequence ?? '');
  const counts = p.raw?.counts ? countsLine(p.raw.counts) : squash(p.raw?.counts ?? '');

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
:root{
  --ink:#2E2A36; --muted:#5C566C; --accent:#7348C7; --accent2:#9D7BE0;
  --box:#F5F2FB; --box-stroke:#E2DAF6; --tip:#EFE7FF; --tip-stroke:#D7C7FB;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;color:var(--ink);font:11px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Helvetica,Arial,sans-serif}
.page{padding:16mm 14mm 14mm}
h1{font-size:18px;margin:0 0 6mm;font-weight:700}
.intro{margin:0 0 8mm}
.card{background:var(--box);border:1px solid var(--box-stroke);border-radius:12px;padding:12px 14px;margin-bottom:8mm}
.card h3{font-size:12px;margin:0 0 4px;color:var(--accent);font-weight:700}
.state p:first-of-type{font-weight:700;margin:0 0 4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-bottom:8mm}
.chart{background:#fff;border:1px solid var(--box-stroke)}
.chart h3{margin-bottom:6px}
.chart .imgwrap{display:flex;align-items:center;justify-content:center;width:100%;height:280px;padding:10px}
.chart img{max-width:100%;max-height:100%;display:block}
.stack{display:grid;grid-template-rows:auto auto;gap:8mm}
.tips{display:grid;grid-template-columns:1fr 1fr;gap:8mm}
.tip{background:var(--tip);border:1px solid var(--tip-stroke);border-radius:12px;padding:12px 14px}
.tip h4{margin:0 0 6px;font-size:12px;color:var(--accent)}
.tip p{font-size:12px;margin:0;font-weight:600}
.foot{color:var(--muted);font-size:9px;margin-top:10mm}
@page{size:A4;margin:0}
</style>
</head>
<body><div class="page">
  <h1>${title}</h1>
  <p class="intro">${intro}</p>

  <section class="card state">
    <h3>Your current state</h3>
    <p>${headline}</p>
    <p>${meaning}</p>
  </section>

  <div class="grid">
    <section class="card chart">
      <h3>CTRL Radar</h3>
      <div class="imgwrap">
        ${chartUrl ? `<img src="${chartUrl}" alt="radar">` : `<div style="color:var(--muted);">Chart unavailable</div>`}
      </div>
    </section>
    <div class="stack">
      <section class="card">
        <h3>Direction of travel</h3>
        <p style="font-weight:700;margin:0 0 2px">${dirLabel}</p>
        <p style="margin:0">${dirMeaning}</p>
      </section>
      <section class="card">
        <h3>Theme in focus</h3>
        <p style="font-weight:700;margin:0 0 2px">${themeLabel}</p>
        <p style="margin:0">${themeMeaning}</p>
      </section>
    </div>
  </div>

  <section class="card">
    <h3>What the pattern suggests</h3>
    <p style="margin:0">${patternNote}</p>
  </section>

  <div class="tips">
    <section class="tip"><h4>Try this</h4><p>${tip1}</p></section>
    <section class="tip"><h4>Try this next time</h4><p>${tip2}</p></section>
  </div>

  <div class="foot">Sequence: ${seq} &nbsp;&nbsp; Counts: ${counts}</div>
</div></body></html>`;
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const isTest = url.searchParams.has('test');
    const b64 = url.searchParams.get('data');

    let payload;
    if (isTest && !b64) {
      const chartSpec = {
        type:'radar',
        data:{ labels:['Concealed','Triggered','Regulated','Lead'],
          datasets:[{ label:'Frequency', data:[1,3,1,0], fill:true,
            backgroundColor:'rgba(115,72,199,0.18)', borderColor:'#7348C7', borderWidth:2,
            pointRadius:[3,6,3,0], pointBackgroundColor:['#9D7BE0','#7348C7','#9D7BE0','#9D7BE0'] }]},
        options:{ plugins:{legend:{display:false}}, scales:{ r:{ min:0,max:5,
          ticks:{display:true,stepSize:1,backdropColor:'rgba(0,0,0,0)'},
          grid:{circular:true}, angleLines:{display:true}, pointLabels:{color:'#4A4458',font:{size:12}}}}};
      const chartUrl = 'https://quickchart.io/chart?v=4&c=' + encodeURIComponent(JSON.stringify(chartSpec));
      payload = {
        name:'ctrl_report.pdf',
        title:'CTRL — Your Snapshot',
        intro:'A big thank you for answering honestly. Treat this as a starting point — a quick indication of your current awareness across four states.',
        headline:'You sit mostly in Triggered.',
        meaning:"Feelings and energy arrive fast and show up visibly. Upside: drive. Watch-out: narrow focus or over-defending.",
        chartUrl,
        directionLabel:'Steady',
        directionMeaning:'You started and ended in similar zones — steady overall.',
        themeLabel:'Emotion regulation',
        themeMeaning:'Settling yourself when feelings spike.',
        patternNote:'A mix of moves without a single rhythm. You changed state 2 times; longest run: Triggered × 2.',
        tips:{ primary:'Take one breath and name it: “I’m on edge.”', next:'Choose your gear on purpose: protect, steady, or lead — say it in one line.' },
        raw:{ sequence:'T T C R T', counts:{ C:1,T:3,R:1,L:0 } }
      };
    } else {
      if (!b64) { res.status(400).send('Missing data'); return; }
      try { payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }
      catch { res.status(400).send('Invalid data'); return; }
    }

    const html = renderHTML(payload);

    const execPath = await chromium.executablePath();
    if (!execPath) throw new Error('Chromium executablePath is empty');

    const browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    await browser.close();

    const name = String(payload.name || 'ctrl_report.pdf').replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(pdf);
  } catch (e) {
    console.error('[pdf-html] error:', e);
    res.status(500).send('Error generating PDF: ' + (e?.message || String(e)));
  }
}
