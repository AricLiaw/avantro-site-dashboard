// Minimal PDF report writer (A4 landscape, Helvetica, tables, progress bars, JPEG/PNG photos). No dependencies.
import zlib from 'node:zlib';

const W = 841.89, H = 595.28, M = 34;
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const NAVY = '#0B2545', GREY = '#667085', LINE = '#D0D5DD', PALE = '#F2F4F7';

const clean = (s) => String(s ?? '')
  .replace(/[›»]/g, '>').replace(/→/g, '->').replace(/[–—−]/g, '-').replace(/[•·]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/…/g, '...').replace(/✓/g, 'v').replace(/[\r\t]/g, ' ')
  .replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?');
const width = (s, size, bold) => {
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; }
  return (w / 1000) * size * (bold ? 1.06 : 1);
};
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((x) => x.toFixed(3)).join(' '); };
const hexStr = (s) => '<' + Buffer.from(s, 'latin1').toString('hex') + '>';

function wrap(text, maxW, size, bold) {
  const out = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      let w = word;
      while (width(w, size, bold) > maxW && w.length > 1) { // hard-break very long tokens
        let k = w.length - 1;
        while (k > 1 && width(w.slice(0, k), size, bold) > maxW) k--;
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      const t = line ? line + ' ' + w : w;
      if (width(t, size, bold) <= maxW) line = t;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

function imageInfo(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        const comps = buf[i + 9];
        if (comps === 4) return null;
        return { kind: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], ct = buf[25], inter = buf[28];
    if (depth !== 8 || inter !== 0 || (ct !== 2 && ct !== 0)) return null;
    const idat = [];
    let p = 8;
    while (p < buf.length) {
      const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
      if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
      p += 12 + len;
    }
    return { kind: 'png', w, h, comps: ct === 2 ? 3 : 1, data: Buffer.concat(idat) };
  }
  return null;
}

class Doc {
  constructor(headerLeft, headerRight) {
    this.pages = [];
    this.images = [];
    this.headerLeft = headerLeft;
    this.headerRight = headerRight;
    this.newPage();
  }
  get ops() { return this.pages[this.pages.length - 1].ops; }
  newPage() {
    this.pages.push({ ops: [], imgs: new Set() });
    this.rect(0, 0, W, 26, { fill: NAVY });
    this.text(M, 17, this.headerLeft, { size: 10, bold: true, color: '#FFFFFF' });
    this.text(W - M - width(clean(this.headerRight), 8, false), 17, this.headerRight, { size: 8, color: '#D0D5DD' });
    this.y = 44;
  }
  text(x, y, s, { size = 9, bold = false, color = '#101828' } = {}) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${(H - y).toFixed(2)} Td ${hexStr(clean(s))} Tj ET`);
  }
  rect(x, y, w, h, { fill, stroke } = {}) {
    const o = [];
    if (fill) o.push(`${rgb(fill)} rg`);
    if (stroke) o.push(`${rgb(stroke)} RG 0.6 w`);
    o.push(`${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.ops.push(o.join(' '));
  }
  hline(x1, x2, y, color = LINE) { this.ops.push(`${rgb(color)} RG 0.5 w ${x1.toFixed(2)} ${(H - y).toFixed(2)} m ${x2.toFixed(2)} ${(H - y).toFixed(2)} l S`); }
  image(idx, x, y, w, h) {
    this.pages[this.pages.length - 1].imgs.add(idx);
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(H - y - h).toFixed(2)} cm /Im${idx} Do Q`);
  }
  need(h) { if (this.y + h > H - 34) this.newPage(); }

  build(footer) {
    const objs = [];
    const add = (body) => (objs.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')), objs.length);
    add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
    add('PLACEHOLDER'); // 2
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'); // 4
    const imgIds = this.images.map((im) => {
      const cs = im.comps === 1 ? '/DeviceGray' : '/DeviceRGB';
      const head = `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace ${cs} /BitsPerComponent 8 ` +
        (im.kind === 'jpeg' ? '/Filter /DCTDecode ' : `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${im.comps} /BitsPerComponent 8 /Columns ${im.w} >> `) + `/Length ${im.data.length} >>\nstream\n`;
      return add(Buffer.concat([Buffer.from(head), im.data, Buffer.from('\nendstream')]));
    });
    const pageIds = [];
    const total = this.pages.length;
    this.pages.forEach((pg, i) => {
      const ops = [...pg.ops, `BT /F1 8 Tf ${rgb(GREY)} rg ${M} ${H - (H - 16)} Td ${hexStr(clean(footer))} Tj ET`,
        `BT /F1 8 Tf ${rgb(GREY)} rg ${(W - M - 60).toFixed(2)} ${H - (H - 16)} Td ${hexStr(`Page ${i + 1} of ${total}`)} Tj ET`];
      const stream = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const cid = add(Buffer.concat([Buffer.from(`<< /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]));
      const xo = [...pg.imgs].map((k) => `/Im${k} ${imgIds[k]} 0 R`).join(' ');
      pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cid} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xo} >> >> >>`));
    });
    objs[1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`);
    const out = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offs = [];
    let pos = out[0].length;
    objs.forEach((b, i) => {
      offs.push(pos);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), b, Buffer.from('\nendobj\n')]);
      out.push(chunk);
      pos += chunk.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`));
    return Buffer.concat(out);
  }
}

const fmtCell = (c) => {
  if (c == null) return { s: '' };
  if (typeof c !== 'object') return { s: typeof c === 'number' ? (Number.isInteger(c) ? String(c) : c.toFixed(1)) : String(c) };
  let s = c.v;
  if (typeof s === 'number') {
    s = c.t === 'pct' ? s.toFixed(1) + '%' : c.t === 'pp' ? (s >= 0 ? '+' : '') + s.toFixed(1) + ' pp' : Number.isInteger(s) ? String(s) : s.toFixed(1);
  }
  return { s: s ?? '', color: c.color, bold: c.bold, bar: c.bar };
};

// model: { title, subtitle, meta:[[k,v]], footer, sections:[{heading, note?, kind:'table'|'text'|'photos', columns, rows, text, photos}] }
export function buildPdf(model) {
  const doc = new Doc(model.project || 'Avantro Project', model.title);
  doc.text(M, doc.y + 16, model.title, { size: 20, bold: true, color: NAVY });
  doc.y += 26;
  if (model.subtitle) { doc.text(M, doc.y + 8, model.subtitle, { size: 10, color: GREY }); doc.y += 16; }
  if (model.meta?.length) {
    let x = M;
    for (const [k, v] of model.meta) {
      doc.text(x, doc.y + 8, k.toUpperCase(), { size: 7, color: GREY, bold: true });
      doc.text(x, doc.y + 19, String(v), { size: 10, bold: true });
      x += Math.max(width(clean(String(v)), 10, true), width(clean(k), 7, true)) + 28;
    }
    doc.y += 30;
  }
  for (const sec of model.sections) {
    doc.need(60);
    doc.y += 8;
    doc.text(M, doc.y + 10, sec.heading, { size: 12, bold: true, color: NAVY });
    doc.y += 16;
    doc.hline(M, W - M, doc.y + 2, NAVY);
    doc.y += 8;
    if (sec.note) { for (const l of wrap(sec.note, W - 2 * M, 8, false)) { doc.need(12); doc.text(M, doc.y + 8, l, { size: 8, color: GREY }); doc.y += 11; } doc.y += 3; }
    if (sec.kind === 'text') {
      for (const l of wrap(sec.text, W - 2 * M, 9, false)) { doc.need(13); doc.text(M, doc.y + 9, l); doc.y += 12; }
    } else if (sec.kind === 'photos') {
      photos(doc, sec.photos);
    } else if (sec.rows?.length) {
      table(doc, sec);
    } else {
      doc.text(M, doc.y + 9, sec.empty || 'Nothing to report for this period.', { size: 9, color: GREY });
      doc.y += 14;
    }
  }
  return doc.build(model.footer || '');
}

function table(doc, sec) {
  const cols = sec.columns;
  const avail = W - 2 * M;
  const tot = cols.reduce((s, c) => s + (c.w || 1), 0);
  const cw = cols.map((c) => ((c.w || 1) / tot) * avail);
  const size = 8, lh = 10, padX = 4, padY = 3.5;
  const head = () => {
    const lines = cols.map((c, i) => wrap(c.label, cw[i] - 2 * padX, size, true));
    const h = Math.max(...lines.map((l) => l.length)) * lh + 2 * padY;
    doc.need(h + 20);
    doc.rect(M, doc.y, avail, h, { fill: NAVY });
    let x = M;
    cols.forEach((c, i) => {
      lines[i].forEach((l, k) => doc.text(c.align === 'r' ? x + cw[i] - padX - width(l, size, true) : x + padX, doc.y + padY + 7 + k * lh, l, { size, bold: true, color: '#FFFFFF' }));
      x += cw[i];
    });
    doc.y += h;
  };
  head();
  sec.rows.forEach((row, ri) => {
    const cells = row.map(fmtCell);
    const lines = cells.map((c, i) => wrap(c.s, cw[i] - 2 * padX - (c.bar != null ? 34 : 0), size, !!c.bold));
    const h = Math.max(1, ...lines.map((l) => l.length)) * lh + 2 * padY;
    if (doc.y + h > H - 34) { doc.newPage(); head(); }
    if (ri % 2) doc.rect(M, doc.y, avail, h, { fill: '#F9FAFB' });
    let x = M;
    cells.forEach((c, i) => {
      const align = cols[i].align;
      if (c.bar != null) {
        doc.rect(x + padX, doc.y + padY + 1, 28, 6, { fill: '#E4E7EC' });
        doc.rect(x + padX, doc.y + padY + 1, 28 * Math.max(0, Math.min(100, c.bar)) / 100, 6, { fill: NAVY });
      }
      lines[i].forEach((l, k) => {
        const tx = align === 'r' ? x + cw[i] - padX - width(l, size, !!c.bold) : x + padX + (c.bar != null ? 34 : 0);
        doc.text(tx, doc.y + padY + 7 + k * lh, l, { size, bold: !!c.bold, color: c.color || '#101828' });
      });
      x += cw[i];
    });
    doc.y += h;
    doc.hline(M, W - M, doc.y);
  });
  doc.y += 6;
}

function photos(doc, list) {
  if (!list?.length) { doc.text(M, doc.y + 9, 'No photos in this period.', { size: 9, color: GREY }); doc.y += 14; return; }
  const per = 4, gap = 10, bw = (W - 2 * M - gap * (per - 1)) / per, bh = bw * 0.68, capH = 30;
  for (let i = 0; i < list.length; i += per) {
    doc.need(bh + capH + 6);
    list.slice(i, i + per).forEach((p, k) => {
      const x = M + k * (bw + gap);
      doc.rect(x, doc.y, bw, bh, { fill: PALE, stroke: LINE });
      const info = p.buffer ? imageInfo(p.buffer) : null;
      if (info) {
        const s = Math.min(bw / info.w, bh / info.h);
        const w = info.w * s, h = info.h * s;
        doc.images.push({ ...info, data: info.kind === 'jpeg' ? p.buffer : info.data });
        doc.image(doc.images.length - 1, x + (bw - w) / 2, doc.y + (bh - h) / 2, w, h);
      } else doc.text(x + 8, doc.y + bh / 2, 'Photo not available', { size: 8, color: GREY });
      wrap(p.caption || '', bw, 7, false).slice(0, 2).forEach((l, n) => doc.text(x, doc.y + bh + 9 + n * 8, l, { size: 7 }));
      if (p.meta) doc.text(x, doc.y + bh + 26, wrap(p.meta, bw, 6.5, false)[0], { size: 6.5, color: GREY });
    });
    doc.y += bh + capH + 4;
  }
}
