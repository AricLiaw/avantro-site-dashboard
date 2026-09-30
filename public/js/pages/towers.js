// Towers: side-by-side summary, and a tower drill-down by floor, zone, trade and category.
import { html, raw, esc, api, qs, S, icon, pct, pctTxt, variance, healthPill, progress, progressLegend, table, dt, go, loading, errText, NC, F, filterBar, filterParams } from '../core.js';
import { lineChart, bindLine, heatStyle } from '../charts.js';
import { showActivities, showUpdates } from './drill.js';

const SHORT = { ARCH: 'Architectural', CS: 'C&S', ME: 'M&E' };
const short = (t) => SHORT[t.code] || t.name;

export async function towersPage(el) {
  el.innerHTML = String(html`<div class="page-head"><div><h1>Towers</h1></div></div>${loading(3)}`);
  try {
    const d = await api('/api/dashboard');
    const lv = (id) => S.meta.levels.filter((l) => l.tower_id === id).length;
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Towers</h1><p>Each tower has its own floors, zones, activities and weights. Select a tower for the floor-by-floor view.</p></div></div>
      <div class="grid g3 mb">${d.towers.map((t) => html`<div class="card clk" data-t="${t.id}" tabindex="0" role="link" aria-label="Open ${t.name}"><div class="card-h"><h2>${t.name}</h2>${healthPill(t.health)}</div>
        <div class="row gap mt-s" style="align-items:baseline"><span class="big" style="font-size:2.4rem">${t.actual == null ? NC : html`${t.actual.toFixed(1)}<small>%</small>`}</span><span class="muted small">complete</span></div>
        <div class="mt-s">${progress(t.actual, t.planned, { size: 'lg' })}</div>
        <div class="row between mt-s small"><span>Planned <b>${pctTxt(t.planned)}</b></span><span>${variance(t.variance)}</span></div>
        <div class="row between mt small muted"><span>${lv(t.id)} floors/levels · ${t.n} activities</span><span>${t.healthCounts.delayed} delayed · ${t.overdue} overdue</span></div>
        ${t.reasons.length ? html`<div class="xs muted mt-s">${t.reasons.join(' · ')}</div>` : ''}</div>`)}</div>
      <div class="card"><h2>Trades by tower</h2>${table([{ h: 'Tower', first: true, r: (t) => html`<b>${t.name}</b>` }, ...S.meta.trades.map((tr) => ({ h: short(tr), r: (t) => { const x = t.trades.find((y) => y.id === tr.id); return x ? html`<button class="li" data-tt="${t.id}|${tr.id}" style="padding:2px 0;align-items:center"><span class="grow">${progress(x.actual, x.planned, { size: 'sm' })}</span><span style="width:70px;text-align:right">${variance(x.variance)}</span></button>` : '—'; } })), { h: 'Overall', r: (t) => progress(t.actual, t.planned, { size: 'sm' }) }], d.towers)}${progressLegend}</div>`);
    el.onclick = (e) => {
      const tt = e.target.closest('[data-tt]'); if (tt) { const [a, b] = tt.dataset.tt.split('|'); return showActivities(`${S.meta.towers.find((t) => t.id === +a).name} · ${short(S.meta.trades.find((t) => t.id === +b))}`, { tower: a, trade: b, sort: 'variance' }); }
      const c = e.target.closest('[data-t]'); if (c) go('/towers/' + c.dataset.t);
    };
    el.onkeydown = (e) => { const c = e.target.closest('[data-t]'); if (c && e.key === 'Enter') go('/towers/' + c.dataset.t); };
  } catch (e) { el.innerHTML = `<div class="banner bad">${errText(e)}</div>`; }
}

export async function towerPage(el, { id }) {
  el.innerHTML = String(loading(4));
  const bar = filterBar(['trade', 'contractor', 'person', 'date'], () => towerPage(el, { id }));
  try {
    const p = filterParams();
    const d = await api(`/api/towers/${id}` + qs({ trade: p.trade, contractor: p.contractor, person: p.person, date: p.date }));
    const T = d.tower, s = d.summary;
    const base = { tower: T.id, contractor: p.contractor, person: p.person, date: p.date };
    el.innerHTML = String(html`
      <div class="page-head"><div><a class="small" href="#/towers">← All towers</a><h1>${T.name}</h1><p>${T.notes || ''} As at ${dt(d.asOf)}.</p></div><div class="row gap wrap">${healthPill(s.health)}</div></div>
      ${bar.html}
      <div class="grid g4 keep2 mb"><div class="tile"><div class="n">${s.actual == null ? 'n/c' : s.actual.toFixed(1) + '%'}</div><div class="t">Actual (approved)</div><div class="s">${s.actual == null ? 'Not configured' : ''}</div></div><div class="tile"><div class="n">${s.planned == null ? 'n/c' : s.planned.toFixed(1) + '%'}</div><div class="t">Planned to date</div></div><div class="tile ${s.variance != null && s.variance <= -S.meta.settings.at_risk_pp ? 'bad' : ''}"><div class="n">${s.variance == null ? 'n/c' : (s.variance >= 0 ? '+' : '−') + Math.abs(s.variance).toFixed(1)}</div><div class="t">Variance (pp)</div></div><button class="tile clk ${s.healthCounts.delayed ? 'bad' : 'zero'}" data-a='{"health":"delayed"}'><div class="n">${s.healthCounts.delayed}</div><div class="t">Delayed activities</div><div class="s">${s.overdue} overdue</div></button></div>
      ${s.reasons.length ? html`<div class="banner warn mb">${icon('warn')}<div class="small">${s.reasons.join('. ')}. <a href="#/admin/status">Review configuration</a></div></div>` : ''}
      <div class="grid g3 mb">${d.trades.filter((t) => t.n).map((t) => html`<div class="card clk" data-a='${JSON.stringify({ trade: t.id })}' tabindex="0"><div class="card-h"><h3>${t.name}</h3>${healthPill(t.health)}</div><div class="mt-s">${progress(t.actual, t.planned, { size: 'lg' })}</div><div class="row between small mt-s"><span>Planned <b>${pctTxt(t.planned)}</b></span><span>${variance(t.variance)}</span></div><div class="xs muted mt-s">${t.n} activities · ${t.healthCounts.delayed} delayed</div></div>`)}</div>
      <div class="card mb"><div class="card-h"><h2>Planned vs actual curve</h2></div><div id="cv">${d.curve ? lineChart({ points: d.curve.points, asOf: d.curve.asOf }) : html`<div class="empty">Curve not available (weights or baseline dates not configured).</div>`}</div></div>
      <div class="card mb"><div class="card-h"><h2>Floor-by-floor progress</h2><span class="muted small">Click a floor, zone or trade cell for its activities</span></div>
        <div class="tbl-wrap"><table class="tbl" style="min-width:640px"><thead><tr><th>Floor / level</th><th style="min-width:150px">Overall</th>${S.meta.trades.map((t) => html`<th>${short(t)}</th>`)}<th>Zones / units</th><th>Delayed</th></tr></thead><tbody>${d.levels.map((l) => html`<tr><td><button class="btn btn-ghost btn-sm" data-a='${JSON.stringify({ level_id: l.id })}' style="font-weight:700">${l.name}</button><span class="sub">${l.n} activities</span></td><td>${progress(l.actual, l.planned, { size: 'sm' })}</td>${l.trades.map((t) => html`<td>${t.n ? html`<button style="${raw(heatStyle(t.actual))};border:0;border-radius:6px;min-width:64px;min-height:32px;font-weight:700" data-a='${JSON.stringify({ level_id: l.id, trade: t.id })}'>${t.actual == null ? 'n/c' : t.actual.toFixed(0) + '%'}</button>` : html`<span class="muted">—</span>`}</td>`)}<td>${l.zones.filter((z) => z.n).map((z) => html`<button class="chip" style="min-height:28px;padding:2px 9px;margin:0 4px 4px 0" data-a='${JSON.stringify({ zone_id: z.id, level_id: l.id })}'>${z.name} <b>${z.actual == null ? 'n/c' : z.actual.toFixed(0) + '%'}</b></button>`)}${l.zones.some((z) => z.n) ? '' : html`<span class="muted small">Whole floor</span>`}</td><td>${l.healthCounts.delayed ? html`<span class="pill p-delayed">${l.healthCounts.delayed}</span>` : html`<span class="muted">0</span>`}</td></tr>`)}</tbody></table></div><div class="scale mt-s"><span>0%</span><i></i><span>100%</span></div></div>
      <div class="grid g2"><div class="card"><h2>By work category</h2>${table([{ h: 'Category', first: true, r: (c) => html`<b>${c.category}</b><span class="sub">${S.meta.trades.find((t) => t.id === c.trade_id)?.name}</span>` }, { h: 'Progress', r: (c) => progress(c.actual, c.planned, { size: 'sm' }) }, { h: 'Var.', r: (c) => variance(c.variance) }, { h: 'Activities', num: true, r: (c) => c.n }], d.categories, { rowAttrs: (c) => `class="clk" data-a="${esc(JSON.stringify({ trade: c.trade_id, category: c.category }))}"` })}</div>
      <div class="card"><h2>Milestones</h2>${d.milestones.length ? d.milestones.map((m) => html`<div class="li"><span><b>${m.name}</b><span class="sub">Due ${dt(m.due_date)}</span></span>${m.achieved_date ? html`<span class="pill p-approved">Achieved ${dt(m.achieved_date, false)}</span>` : m.due_date < d.asOf ? html`<span class="pill p-delayed">Overdue</span>` : html`<span class="pill p-nc">Open</span>`}</div>`) : html`<div class="empty">No milestones for this tower.</div>`}<p class="mt small"><a href="#/issues?tower=${T.id}">${d.issues} open issues in this tower →</a></p></div></div>`);
    bar.bind(el);
    el.onclick = (e) => { const a = e.target.closest('[data-a]'); if (a) showActivities(`${T.name}`, { ...base, ...JSON.parse(a.dataset.a), sort: 'variance' }); };
    el.onkeydown = (e) => { if (e.key === 'Enter') e.target.closest('[data-a]')?.click(); };
    if (d.curve) bindLine(el.querySelector('#cv'), d.curve.points, (pt, prev) => showUpdates(`Work approved ${dt(prev.date)} – ${dt(pt.date)}`, { state: 'approved', from: prev.date === pt.date ? pt.date : addD(prev.date), to: pt.date, tower: T.id, sort: 'oldest' }));
  } catch (e) { el.innerHTML = `<div class="banner bad">${errText(e)}</div>`; }
}
const addD = (s) => new Date(Date.parse(s) + 864e5).toISOString().slice(0, 10);
