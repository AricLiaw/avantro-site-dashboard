// Daily / weekly / monthly reports: on-screen preview + PDF and Excel export.
import { html, raw, api, qs, S, icon, dt, todayStr, pickOne, errText, loading, photoUrl, esc, lightbox, addDays, dtime } from '../core.js';

const st = { type: 'daily', date: todayStr(), tower: null };

const cell = (c) => {
  if (c == null || c === '') return '';
  if (typeof c !== 'object') return typeof c === 'number' ? (Number.isInteger(c) ? c : c.toFixed(1)) : c;
  let v = c.v;
  if (typeof v === 'number') v = c.t === 'pct' ? v.toFixed(1) + '%' : c.t === 'pp' ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' pp' : Number.isInteger(v) ? String(v) : v.toFixed(1);
  const style = [c.color ? `color:${c.color}` : '', c.bold ? 'font-weight:700' : ''].filter(Boolean).join(';');
  return html`${c.bar != null ? html`<span class="pb sm" style="display:inline-block;width:46px;vertical-align:middle;margin-right:6px"><i style="width:${Math.min(100, Math.max(0, c.bar))}%"></i></span>` : ''}<span style="${style}">${v}</span>`;
};

export async function reportsPage(el) {
  el.innerHTML = String(html`<div class="page-head"><div><h1>Reports</h1></div></div>${loading(3)}`);
  const link = (fmt) => `/api/report/export${qs({ type: st.type, date: st.date, tower: st.tower, format: fmt })}`;
  let r;
  try { r = await api('/api/report' + qs({ type: st.type, date: st.date, tower: st.tower })); } catch (e) { el.innerHTML = `<div class="banner bad">${errText(e)}</div>`; return; }
  const h = r.headline;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Reports</h1><p>Daily, weekly and monthly progress reports. Only approved quantities are counted.</p></div>
      <div class="row gap wrap"><a class="btn btn-primary" href="${link('pdf')}" id="pdf">${icon('download')} PDF</a><a class="btn btn-primary" href="${link('xlsx')}" id="xlsx">${icon('download')} Excel</a><button class="btn" id="print">Print</button></div></div>
    <div class="card mb"><div class="row gap wrap">
      <div class="tabs" role="tablist" style="margin:0;border:0">${['daily', 'weekly', 'monthly'].map((t) => html`<button role="tab" aria-selected="${st.type === t}" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)}</div>
      <label class="row gap"><span class="small bold">Date</span><input type="date" id="d" value="${st.date}" style="width:auto" max="${addDays(todayStr(), 366)}"></label>
      <button class="chip ${st.tower ? 'on' : ''}" id="tw">Tower: <b>${st.tower ? S.meta.towers.find((t) => t.id === +st.tower).name : 'All towers'}</b></button></div></div>
    <div class="card mb"><div class="card-h"><div><h2>${r.period.label}</h2><span class="muted small">${r.tower} · progress as at ${dt(r.asOf)} · generated ${dtime(r.generated)}</span></div></div>
      <div class="tiles mt-s"><div class="tile"><div class="n">${h.actual == null ? 'n/c' : h.actual.toFixed(1) + '%'}</div><div class="t">Actual</div></div><div class="tile"><div class="n">${h.planned == null ? 'n/c' : h.planned.toFixed(1) + '%'}</div><div class="t">Planned</div></div><div class="tile ${h.variance != null && h.variance < -S.meta.settings.at_risk_pp ? 'bad' : ''}"><div class="n">${h.variance == null ? 'n/c' : (h.variance >= 0 ? '+' : '−') + Math.abs(h.variance).toFixed(1)}</div><div class="t">Variance (pp)</div></div><div class="tile ${h.delayed ? 'bad' : 'zero'}"><div class="n">${h.delayed}</div><div class="t">Delayed activities</div></div><div class="tile ${h.blockers ? 'bad' : 'zero'}"><div class="n">${h.blockers}</div><div class="t">Blockers</div></div><div class="tile ${h.pending ? 'warn' : 'zero'}"><div class="n">${h.pending}</div><div class="t">Awaiting approval</div></div></div></div>
    ${r.sections.map((s) => html`<div class="card mb"><h2>${s.heading}</h2>${s.note ? html`<p class="small muted" style="margin:4px 0 8px">${s.note}</p>` : ''}
      ${s.kind === 'photos' ? (s.photos.length ? html`<div class="thumbs">${s.photos.map((p, i) => html`<button class="thumb" data-p="${i}"><img loading="lazy" src="${photoUrl(p.id)}" alt="${p.caption}"><span class="cap"><b>${p.caption}</b>${p.meta}</span></button>`)}</div>` : html`<div class="empty">No photos in this period.</div>`)
      : s.rows.length ? html`<div class="tbl-wrap"><table class="tbl stack"><thead><tr>${s.columns.map((c) => html`<th class="${c.align === 'r' ? 'num' : ''}">${c.label}</th>`)}</tr></thead><tbody>${s.rows.map((row) => html`<tr>${row.map((c, i) => html`<td data-l="${s.columns[i].label}" class="${s.columns[i].align === 'r' ? 'num' : ''} ${i === 0 ? 'first' : ''}">${cell(c)}</td>`)}</tr>`)}</tbody></table></div>` : html`<div class="empty">${s.empty || 'Nothing to report for this period.'}</div>`}</div>`)}`);
  el.onclick = async (e) => {
    const t = e.target.closest('[data-t]'); if (t) { st.type = t.dataset.t; return reportsPage(el); }
    if (e.target.closest('#tw')) { const p = await pickOne({ title: 'Tower', options: S.meta.towers.map((x) => ({ value: x.id, label: x.name })), value: st.tower, clearLabel: 'All towers' }); if (p) { st.tower = p.value; reportsPage(el); } return; }
    if (e.target.closest('#print')) return window.print();
    const p = e.target.closest('[data-p]'); if (p) { const ph = r.sections.find((s) => s.kind === 'photos').photos; lightbox(ph.map((x) => ({ ...x, taken_date: x.meta.split(' - ')[0] })), +p.dataset.p); }
  };
  el.onchange = (e) => { if (e.target.id === 'd' && e.target.value) { st.date = e.target.value; reportsPage(el); } };
}
