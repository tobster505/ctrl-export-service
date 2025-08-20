// /api/pdf.js — Structured PDF generator (pdf-lib)
// Expects GET ?d=<base64(JSON)>
// JSON shape:
// {
//   title, overview, journey, how, themes:[{key,text}], chartUrl, chartCaption,
//   aboutChart:[string], seq:["R","T","..."], counts:{C,T,R,L},
//   perQuestion:[{q:"Q1", outcome:"R", stateName:"Regulated", themes:[...] }]
// }
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export default async function handler(req, res){
  try{
    const b64 = String(req.query.d || '');
    if (!b64){ res.status(400).send('Missing data'); return; }
    const data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

    // Fetch chart image
    let chartBytes = null;
    try{
      const r = await fetch(data.chartUrl);
      chartBytes = await r.arrayBuffer();
    }catch(e){ /* ignore, no chart */ }

    // PDF setup
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4 portrait (pt)
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Layout helpers
    const margin = 48;
    let x = margin, y = page.getHeight() - margin;
    const lh = 14; // line height
    function line(txt, f=font, size=12, color=rgb(0,0,0)){
      page.drawText(txt, { x, y, size, font: f, color }); y -= lh;
      if (y < margin) newPage();
    }
    function wrap(txt, f=font, size=12){
      const maxW = page.getWidth() - margin*2;
      const words = String(txt||'').split(/\s+/);
      let buf = '';
      const spaceW = f.widthOfTextAtSize(' ', size);
      for(const w of words){
        const wW = f.widthOfTextAtSize(w, size);
        const bufW = f.widthOfTextAtSize(buf, size);
        if (buf && (bufW + spaceW + wW) > maxW){
          line(buf, f, size); buf = w;
        } else {
          buf = buf ? (buf + ' ' + w) : w;
        }
      }
      if (buf) line(buf, f, size);
    }
    function heading(txt){
      line(String(txt||''), bold, 16);
      y -= 4;
    }
    function subheading(txt){
      y -= 6; line(String(txt||''), bold, 12); y -= 2;
    }
    function bullet(txt){
      const bulletChar = '• ';
      const maxW = page.getWidth() - margin*2 - 16;
      const size=12;
      let words = String(txt||'').split(/\s+/);
      let buf = '';
      let first = true;
      const spaceW = font.widthOfTextAtSize(' ', size);
      while(words.length){
        const w = words.shift();
        const wW = font.widthOfTextAtSize(w, size);
        const bufW = font.widthOfTextAtSize(buf, size);
        const prefix = first ? bulletChar : '  ';
        const prefixW = font.widthOfTextAtSize(prefix, size);
        if (buf && (prefixW + bufW + spaceW + wW) > maxW){
          page.drawText(prefix + buf, { x, y, size, font });
          y -= lh; first = false; buf = w;
          if (y < margin) newPage();
        } else {
          buf = buf ? (buf + ' ' + w) : w;
        }
      }
      if (buf){
        page.drawText((first?bulletChar:'  ') + buf, { x, y, size, font });
        y -= lh;
        if (y < margin) newPage();
      }
    }
    function newPage(){
      const p = pdf.addPage([595.28, 841.89]);
      x = margin; y = p.getHeight() - margin;
      // switch drawing to new page
      Object.assign(page, p);
    }

    // Title
    heading(data.title || 'CTRL — Your Snapshot');

    // Overview (headline)
    subheading('Overview');
    wrap(data.overview || '');

    // Chart image
    if (chartBytes){
      const img = await pdf.embedPng(chartBytes).catch(()=>null);
      if (img){
        y -= 10;
        const maxW = page.getWidth() - margin*2;
        const scaled = img.scaleToFit(maxW, 240);
        page.drawImage(img, { x, y: y - scaled.height, width: scaled.width, height: scaled.height });
        y -= (scaled.height + 6);
        if (data.chartCaption) line(String(data.chartCaption), font, 10, rgb(0.2,0.2,0.2));
        y -= 8;
      }
    }

    // About the chart
    subheading('About the chart');
    (data.aboutChart||[]).forEach(t => bullet(t));

    // Journey / How
    subheading('Where the journey points');
    wrap(data.journey || '');
    subheading('How this tends to show up');
    wrap(data.how || '');

    // Themes
    if (Array.isArray(data.themes) && data.themes.length){
      subheading('Themes that kept popping up');
      for (const t of data.themes){ bullet(`${t.text}`); }
    }

    // Raw data
    subheading('Raw data');
    wrap(`Sequence: ${data.seq.join(' ')}`);
    const c = data.counts || {C:0,T:0,R:0,L:0};
    wrap(`Counts — C:${c.C} T:${c.T} R:${c.R} L:${c.L}`);

    // Per question
    if (Array.isArray(data.perQuestion) && data.perQuestion.length){
      subheading('Per question');
      for (const pq of data.perQuestion){
        wrap(`${pq.q}: ${pq.stateName} (${pq.outcome})`);
        if (Array.isArray(pq.themes) && pq.themes.length){
          wrap(`Themes: ${pq.themes.join(', ')}`);
        }
      }
    }

    const bytes = await pdf.save();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="ctrl_report.pdf"');
    res.status(200).send(Buffer.from(bytes));
  }catch(e){
    res.status(500).send('Error generating PDF');
  }
}
