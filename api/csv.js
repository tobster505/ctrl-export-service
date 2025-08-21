// /api/pdf.js — Structured PDF generator (pdf-lib)
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export default async function handler(req, res){
  try{
    const b64 = String(req.query.d || '');
    if (!b64){ res.status(400).send('Missing data'); return; }
    const data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

    // Fetch chart image (PNG)
    let chartBytes = null;
    try{
      const r = await fetch(data.chartUrl);
      chartBytes = await r.arrayBuffer();
    }catch(e){ /* ignore */ }

    const pdf = await PDFDocument.create();
    const A4 = [595.28, 841.89];
    let curPage = pdf.addPage(A4);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const margin = 48;
    let x = margin, y = curPage.getHeight() - margin;
    const lh = 14;

    function newPage(){
      curPage = pdf.addPage(A4);
      x = margin; y = curPage.getHeight() - margin;
    }
    function line(txt, f=font, size=12, color=rgb(0,0,0)){
      curPage.drawText(String(txt||''), { x, y, size, font:f, color }); y -= lh;
      if (y < margin) newPage();
    }
    function wrap(txt, f=font, size=12){
      const maxW = curPage.getWidth() - margin*2;
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
    function heading(txt){ line(String(txt||''), bold, 16); y -= 4; }
    function subheading(txt){ y -= 6; line(String(txt||''), bold, 12); y -= 2; }
    function bullet(txt){
      const size=12, bulletChar='• ';
      const maxW = curPage.getWidth() - margin*2 - 16;
      const spaceW = font.widthOfTextAtSize(' ', size);
      let words = String(txt||'').split(/\s+/), buf='', first=true;
      while(words.length){
        const w = words.shift();
        const wW = font.widthOfTextAtSize(w, size);
        const bufW = font.widthOfTextAtSize(buf, size);
        const prefix = first ? bulletChar : '  ';
        const prefixW = font.widthOfTextAtSize(prefix, size);
        if (buf && (prefixW + bufW + spaceW + wW) > maxW){
          curPage.drawText(prefix + buf, { x, y, size, font }); y -= lh; first=false; buf=w;
          if (y<margin) newPage();
        } else { buf = buf ? (buf + ' ' + w) : w; }
      }
      if (buf){ curPage.drawText((first?bulletChar:'  ') + buf, { x, y, size, font }); y -= lh; if (y<margin) newPage(); }
    }

    // Title
    heading(data.title || 'CTRL — Your Snapshot');

    // Overview
    subheading('Overview');
    wrap(data.overview || '');

    // Chart image
    if (chartBytes){
      const img = await pdf.embedPng(chartBytes).catch(()=>null);
      if (img){
        y -= 10;
        const maxW = curPage.getWidth() - margin*2;
        const scale = img.scaleToFit(maxW, 240);
        curPage.drawImage(img, { x, y: y - scale.height, width: scale.width, height: scale.height });
        y -= (scale.height + 8);
      }
    }

    // About the chart
    if (Array.isArray(data.aboutChart) && data.aboutChart.length){
      subheading('About the chart');
      for(const t of data.aboutChart) bullet(t);
    }

    // Journey / How
    subheading('Where the journey points');
    wrap(data.journey || '');
    subheading('How this tends to show up');
    wrap(data.how || '');

    // Themes
    if (Array.isArray(data.themes) && data.themes.length){
      subheading('Themes that kept popping up');
      for (const t of data.themes) bullet(t.text || '');
    }

    // Raw data
    subheading('Raw data');
    if (Array.isArray(data.seq)) wrap(`Sequence: ${data.seq.join(' ')}`);
    if (data.counts){
      const c = data.counts; wrap(`Counts — C:${c.C} T:${c.T} R:${c.R} L:${c.L}`);
    }

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
