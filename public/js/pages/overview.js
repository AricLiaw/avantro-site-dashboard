// Overview: the Project Manager's 30-second dashboard, and "My work today" for site staff.
import { html, raw, api, qs, S, F, filterBar, filterParams, icon, pct, pctTxt, varTxt, variance, healthPill, statusPill, statePill, progress, progressLegend, table, dt, relDay, num, uom, go, todayStr, photoUrl, lightbox, toast, errText, loading, isMgmt, pickOne, by, NC, HEALTH_LABEL, STATUS_LABEL, prioPill, addDays, dtime } from '../core.js';
import { groupedBars, bindBars, lineChart, bindLine, heatStyle, segBar, SERIES_COLORS } from '../charts.js';
import { showActivities, showActivity, showUpdate, showUpdates, showIssue, getActs, changed } from './drill.js';

const SHORT = { ARCH: 'Architectural', CS: 'C&S', ME: 'M&E' };
const short = (t) => SHORT[t.code] || t.name;
let heatSel = { tower: null, trade: null };
let curveSel = 'project';

export async function overview(el) {
  return S.user.role === 'engineer' || S.user.role === 'supervisor' ? staffHome(el) : pmDashboard(el);
}

// ------------------------------------------------------------------ PM dashboard
async function pmDashboard(el) {
  const fp = filterParams();
  const bar = filterBar(['tower', 'level', 'zone', 'trade', 'contractor', 'person', 'date'], () => overview(el));
  el.innerHTML = String(html`<div class="page-head"><div><h1>Project overview</h1><p>What is completed, what is behind, where the blockers are and what needs your attention today.</p></div></div>${bar.html}${loading(4)}`);
  bar.bind(el);
  let d;
  try { d = await api('/api/dashboard' + qs(fp)); } catch (e) { el.insertAdjacentHTML('beforeend', `<div class="banner bad">${errText(e)}</div>`); return; }
  const P = d.project, A = d.attention, asOf = d.asOf;
  const fpNoDate = { ...fp, date: fp.date };
  const tile = (n, t, s, cls, act) => html`<button class="tile ${n === 0 ? 'zero' : cls} clk" data-tile="${act}"><div class="n">${n}</div><div class="t">${t}</div><div class="s">${n === 0 ? 'All clear' : s}</div></button>`;

  const towerCard = (t) => html`<div class="card clk" data-tower="${t.id}" tabindex="0" role="link" aria-label="Open ${t.name}">
    <div class="card-h"><h3>${t.name}</h3>${healthPill(t.health)}</div>
    <div class="row gap mt-s" style="align-items:baseline"><span class="big" style="font-size:2.2rem">${t.actual == null ? NC : html`${t.actual.toFixed(1)}<small>%</small>`}</span><span class="muted small">actual</span><span class="grow"></span><div class="right small"><div>Planned <b>${pctTxt(t.planned)}</b></div><div>${variance(t.variance)}</div></div></div>
    <div class="mt-s">${progress(t.actual, t.planned, { size: 'lg' })}</div>
    <div class="mt">${t.trades.map((tr) => html`<button class="li" data-tower="${t.id}" data-trade="${tr.id}" style="display:block;padding:7px 2px" aria-label="${t.name} ${tr.name}"><span class="row between small" style="margin-bottom:3px"><b>${short(tr)}</b><span>${variance(tr.variance)}</span></span>${progress(tr.actual, tr.planned, { size: 'sm' })}</button>`)}</div>
    ${t.reasons.length ? html`<div class="xs muted mt-s">${t.reasons.join(' · ')}</div>` : ''}</div>`;

  const statusItems = [['not_started', '#98a2b3'], ['in_progress', '#3b6db3'], ['completed', '#175cd3'], ['on_hold', '#7a5af8']].map(([k, c]) => ({ key: k, label: STATUS_LABEL[k], n: P.status[k] || 0, color: c }));
  const healthItems = [['on_track', 'var(--ok)'], ['at_risk', '#f79009'], ['delayed', 'var(--bad)'], ['complete', 'var(--done)'], ['nc', '#98a2b3']].map(([k, c]) => ({ key: k, label: HEALTH_LABEL[k], n: P.healthCounts[k] || 0, color: c }));

  const groups = d.towers.map((t) => ({ label: t.name, values: [{ key: 'planned', v: t.planned }, { key: 'actual', v: t.actual }], id: t.id }));
  const tradeGroups = d.trades.map((tr) => ({ label: short(tr), id: tr.id, values: d.towers.map((t) => { const x = t.trades.find((y) => y.id === tr.id); return { key: 't' + t.id, v: x?.actual ?? null, planned: x?.planned ?? null, tower: t.id }; }) }));
  const curveTabs = [{ id: 'project', label: 'Whole project' }, ...d.towers.map((t) => ({ id: String(t.id), label: t.name }))];
  if (!curveTabs.find((c) => c.id === curveSel)) curveSel = 'project';
  const curveOf = () => (curveSel === 'project' ? d.curves.project : d.curves.towers[curveSel]);

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Project overview</h1><p>As at <b>${dt(asOf)}</b>${fp.date ? '' : ' (today)'} · progress counts <b>approved</b> quantities only${S.demo ? ' · demonstration data' : ''}</p></div>
      <div class="row gap wrap"><a class="btn" href="#/reports">${icon('reports')} Reports</a><button class="btn" id="refresh">Refresh</button></div></div>
    ${bar.html}
    <section aria-label="Needs attention today"><h2 class="mb" style="margin-bottom:8px">Needs your attention today</h2>
      <div class="tiles">
        ${tile(A.pending_approvals, 'Updates to approve', 'Submitted by site', 'warn', 'pending')}
        ${tile(A.delayed, 'Delayed activities', 'Behind schedule', 'bad', 'delayed')}
        ${tile(A.blockers, 'Critical blockers', 'Stopping work', 'bad', 'blockers')}
        ${tile(A.overdue_issues, 'Overdue issues', 'Past target date', 'bad', 'overdue_issues')}
        ${tile(A.needs_update, 'Missing / outdated updates', `No update in ${S.meta.settings.stale_days}+ days`, 'warn', 'stale')}
        ${tile(A.overdue_activities, 'Overdue activities', 'Past planned finish', 'bad', 'overdue_acts')}
        ${tile(A.decisions, 'Decisions required', 'Issues waiting on you', 'warn', 'decisions')}
      </div></section>

    <section class="mt"><div class="hero">
      <div class="card"><div class="card-h"><h3>Overall project completion</h3>${healthPill(P.health)}</div>
        <div class="mt-s big">${P.actual == null ? NC : html`${P.actual.toFixed(1)}<small>%</small>`}</div>
        <div class="mt-s">${progress(P.actual, P.planned, { size: 'lg' })}</div>${progressLegend}
        <dl class="kv mt"><dt>Planned to date</dt><dd><b>${pct(P.planned)}</b></dd><dt>Variance</dt><dd><b>${variance(P.variance)}</b></dd><dt>Activities</dt><dd>${P.n}${P.excluded ? html` <span class="muted small">(${P.excluded} unweighted, excluded)</span>` : ''}</dd></dl>
        ${P.reasons.length ? html`<div class="banner warn mt">${icon('warn')}<div class="small">${P.reasons.join('. ')}. <a href="#/admin/status">Review configuration</a></div></div>` : ''}</div>
      <div class="grid g3 keep2 tower-cards" style="align-content:start">${d.towers.map(towerCard)}</div></div></section>

    <section class="grid g2 mt">
      <div class="card"><div class="card-h"><h3>Tower comparison</h3><span class="muted small">Planned vs actual · click a bar</span></div><div id="ch-tower">${groupedBars({ groups, series: [{ key: 'planned', label: 'Planned', fill: '#e4e7ec', stroke: '#667085', dash: true }, { key: 'actual', label: 'Actual (approved)', fill: '#0b2545' }] })}</div></div>
      <div class="card"><div class="card-h"><h3>Trade progress by tower</h3><span class="muted small">Orange tick = planned</span></div><div id="ch-trade">${groupedBars({ groups: tradeGroups, series: d.towers.map((t, i) => ({ key: 't' + t.id, label: t.name, fill: SERIES_COLORS[i % 3] })) })}</div></div>
    </section>

    <section class="card mt"><div class="card-h"><h3>Planned vs actual progress curve</h3><div class="tabs" role="tablist" style="margin:0;border:0">${curveTabs.map((c) => html`<button role="tab" aria-selected="${c.id === curveSel}" data-curve="${c.id}">${c.label}</button>`)}</div></div>
      <div id="ch-curve"></div></section>

    <section class="card mt"><div class="card-h"><h3>Floor-by-floor progress heat map</h3><div class="row gap wrap"><button class="chip ${heatSel.tower ? 'on' : ''}" id="ht-tower">Tower: <b>${heatSel.tower ? S.meta.towers.find((t) => t.id === +heatSel.tower)?.name : fp.tower ? S.meta.towers.find((t) => t.id === +fp.tower)?.name : 'All'}</b></button><button class="chip ${heatSel.trade ? 'on' : ''}" id="ht-trade">Trade: <b>${heatSel.trade ? short(S.meta.trades.find((t) => t.id === +heatSel.trade)) : fp.trade ? short(S.meta.trades.find((t) => t.id === +fp.trade)) : 'All'}</b></button></div></div>
      <div id="heat">${loading(1)}</div><div class="scale mt-s"><span>0%</span><i></i><span>100%</span><span class="muted">· approved progress; the number in each cell is the exact value · click a cell for its activities</span></div></section>

    <section class="grid g2 mt">
      <div class="card"><h3>Activity status</h3><div class="mt-s">${segBar(statusItems)}</div><div class="row wrap gap mt-s">${statusItems.map((i) => html`<button class="chip" data-status="${i.key}">${statusPill(i.key)} <b>${i.n}</b></button>`)}</div></div>
      <div class="card"><h3>Schedule health</h3><div class="mt-s">${segBar(healthItems)}</div><div class="row wrap gap mt-s">${healthItems.map((i) => html`<button class="chip" data-health="${i.key}">${healthPill(i.key)} <b>${i.n}</b></button>`)}</div>
        <p class="xs muted mt-s">At Risk: variance ≤ −${S.meta.settings.at_risk_pp} pp. Delayed: variance ≤ −${S.meta.settings.delayed_pp} pp or past planned finish and not complete.</p></div>
    </section>

    <section class="grid g2 mt">
      <div class="card"><div class="card-h"><h3>Overdue activities</h3><button class="btn btn-sm btn-ghost" data-tile="overdue_acts">View all (${A.overdue_activities})</button></div>
        ${d.overdue.length ? d.overdue.map((a) => html`<button class="li" data-act="${a.id}"><span><b>${a.name}</b><span class="sub">${[a.tower, a.level, a.zone].filter(Boolean).join(' › ')} · ${a.trade} · ${a.engineer || 'Unassigned'}</span></span><span class="right nowrap"><span class="var-neg">${a.days_overdue}d overdue</span><span class="sub">${pctTxt(a.pct, 0)} done</span></span></button>`) : html`<div class="empty">No overdue activities.</div>`}</div>
      <div class="card"><div class="card-h"><h3>Upcoming milestones</h3></div>
        ${d.milestones.length ? d.milestones.map((m) => html`<div class="li"><span><b>${m.name}</b><span class="sub">${m.tower || 'Project'} · due ${dt(m.due_date)}</span></span>${m.days < 0 ? html`<span class="pill p-delayed">${-m.days}d overdue</span>` : m.days <= 14 ? html`<span class="pill p-at_risk">In ${m.days}d</span>` : html`<span class="pill p-nc">In ${m.days}d</span>`}</div>`) : html`<div class="empty">No milestones due soon.</div>`}<a class="small" href="#/schedule">Open schedule →</a></div>
      <div class="card"><div class="card-h"><h3>Critical blockers</h3><a class="small" href="#/issues?blocker=1">All blockers →</a></div>
        ${d.blockers.length ? d.blockers.map((i) => html`<button class="li" data-iss="${i.id}"><span><b>${i.code}</b> ${i.title}<span class="sub">${[i.tower, i.level].filter(Boolean).join(' › ')} · ${i.trade || ''} · Owner: <b>${i.owner || 'Unassigned'}</b></span></span><span class="right nowrap">${prioPill(i.priority)}<span class="sub ${i.target_date < asOf ? 'var-neg' : ''}">${i.target_date < asOf ? 'Overdue · ' : 'Target '}${dt(i.target_date, false)}</span></span></button>`) : html`<div class="empty">No open blockers.</div>`}</div>
      <div class="card"><div class="card-h"><h3>Pending approvals</h3><a class="small" href="#/updates">Review all (${A.pending_approvals}) →</a></div>
        ${d.pending.length ? d.pending.map((u) => html`<button class="li" data-upd="${u.id}"><span><b>${u.activity}</b><span class="sub">${u.label} · ${dt(u.report_date)} · ${u.author || ''}</span></span><span class="right nowrap">${u.qty_today ? num(u.qty_today) + ' ' + uom(u.uom) : ''}${u.over_scope ? html`<span class="sub var-neg">Exceeds scope</span>` : ''}</span></button>`) : html`<div class="empty">Nothing waiting for approval.</div>`}</div>
      <div class="card"><div class="card-h"><h3>Missing or outdated updates</h3><button class="btn btn-sm btn-ghost" data-tile="stale">View all (${A.needs_update})</button></div>
        ${d.stale.length ? d.stale.map((s) => html`<div style="padding:8px 0;border-bottom:1px solid var(--line-2)"><div class="row between"><b>${s.tower}</b><button class="btn btn-sm" data-tile="stale" data-tower="${s.tower_id}">${s.count} activities</button></div>${s.worst.map((a) => html`<button class="li" data-act="${a.id}" style="padding:4px 2px"><span class="small">${a.name} <span class="muted">· ${[a.level, a.zone].filter(Boolean).join(' ')} · ${a.engineer || 'Unassigned'}</span></span><span class="small var-warn nowrap">${a.missing_kind === 'missing' ? 'never updated' : a.days_since_update + 'd ago'}</span></button>`)}</div>`) : html`<div class="empty">All active areas are up to date.</div>`}</div>
      <div class="card"><div class="card-h"><h3>Recent progress updates</h3><a class="small" href="#/updates?tab=all">All updates →</a></div>
        ${d.recent.map((u) => html`<button class="li" data-upd="${u.id}"><span><b>${u.activity}</b><span class="sub">${u.label || ''} · ${dt(u.report_date)} · ${u.author || ''}</span></span><span class="right nowrap">${statePill(u.state)}</span></button>`)}</div>
    </section>
    <section class="card mt"><div class="card-h"><h3>Latest site photos</h3><a class="small" href="#/photos">Photo library →</a></div>${d.photos.length ? html`<div class="thumbs">${d.photos.map((p, i) => html`<button class="thumb" data-ph="${i}">${p.is_demo ? html`<span class="demo">DEMO</span>` : ''}<img loading="lazy" src="${photoUrl(p.id)}" alt="${p.caption || 'Site photo'}"><span class="cap"><b>${p.caption || 'Site photo'}</b>${p.tower || ''} · ${dt(p.taken_date, false)}</span></button>`)}</div>` : html`<div class="empty">No photos yet.</div>`}</section>`);
  bar.bind(el);

  // ---- interactions
  const base = { ...fpNoDate };
  const A2 = (t, p) => showActivities(t, { ...base, ...p });
  const tiles = {
    pending: () => go('/updates'), delayed: () => A2('Delayed activities', { health: 'delayed', sort: 'variance' }), blockers: () => go('/issues?blocker=1'),
    overdue_issues: () => go('/issues?overdue=1'), stale: (e) => A2('Missing or outdated site updates', { needs_update: '1', sort: 'stale', tower: e?.dataset.tower || base.tower }),
    overdue_acts: () => A2('Overdue activities', { overdue: '1', sort: 'finish' }), decisions: () => go('/issues?decision=1'),
  };
  el.onclick = (e) => {
    const t = e.target.closest('[data-tile]'); if (t) return tiles[t.dataset.tile](t);
    const tr = e.target.closest('[data-trade]'); if (tr) return A2(`${S.meta.towers.find((x) => x.id === +tr.dataset.tower).name} · ${short(S.meta.trades.find((x) => x.id === +tr.dataset.trade))}`, { tower: tr.dataset.tower, trade: tr.dataset.trade, sort: 'variance' });
    const tw = e.target.closest('[data-tower]'); if (tw && tw.closest('.tower-cards')) return go('/towers/' + tw.dataset.tower);
    const st = e.target.closest('[data-status]'); if (st) return A2(STATUS_LABEL[st.dataset.status] + ' activities', { status: st.dataset.status });
    const h = e.target.closest('[data-health]'); if (h) return A2(HEALTH_LABEL[h.dataset.health] + ' activities', { health: h.dataset.health, sort: 'variance' });
    const a = e.target.closest('[data-act]'); if (a) return showActivity(+a.dataset.act);
    const u = e.target.closest('[data-upd]'); if (u) return showUpdate(+u.dataset.upd);
    const i = e.target.closest('[data-iss]'); if (i) return showIssue(+i.dataset.iss);
    const p = e.target.closest('[data-ph]'); if (p) return lightbox(d.photos, +p.dataset.ph);
    const c = e.target.closest('[data-curve]'); if (c) { curveSel = c.dataset.curve; el.querySelectorAll('[data-curve]').forEach((b) => b.setAttribute('aria-selected', b === c)); drawCurve(); }
    if (e.target.closest('#refresh')) overview(el);
  };
  el.onkeydown = (e) => { if (e.key === 'Enter') { const tw = e.target.closest('.card[data-tower]'); if (tw && e.target === tw) go('/towers/' + tw.dataset.tower); } };

  bindBars(el.querySelector('#ch-tower'), groups, (g) => A2(`${g.label}`, { tower: g.id, sort: 'variance' }));
  bindBars(el.querySelector('#ch-trade'), tradeGroups, (g, k) => A2(`${g.label} · ${S.meta.towers.find((t) => 't' + t.id === k)?.name}`, { trade: g.id, tower: k.slice(1), sort: 'variance' }));
  function drawCurve() {
    const c = curveOf(), box = el.querySelector('#ch-curve');
    if (!c) { box.innerHTML = '<div class="empty">Curve not available: configure weights and baseline dates.</div>'; return; }
    const notes = [!c.planOK && 'Planned curve hidden: some weighted activities have no baseline dates.', !c.actOK && 'Actual curve hidden: some weighted activities have no scope configured.'].filter(Boolean);
    box.innerHTML = String(html`${notes.map((n) => html`<div class="banner warn mb">${icon('warn')}<div class="small">${n}</div></div>`)}${lineChart({ points: c.points, asOf: c.asOf })}`);
    bindLine(box, c.points, (p, prev) => showUpdates(`Work approved ${dt(prev.date)} – ${dt(p.date)}`, { state: 'approved', from: prev.date === p.date ? p.date : addDays(prev.date, 1), to: p.date, tower: curveSel === 'project' ? base.tower : curveSel, sort: 'oldest' }));
  }
  drawCurve();

  const heatEl = el.querySelector('#heat');
  const drawHeat = async () => {
    heatEl.innerHTML = String(loading(1));
    try {
      const h = await api('/api/heatmap' + qs({ ...base, tower: heatSel.tower || base.tower, trade: heatSel.trade || base.trade }));
      if (!h.towers.length) { heatEl.innerHTML = '<div class="empty">No activities for this selection.</div>'; return; }
      heatEl.innerHTML = String(html`<div class="grid" style="align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))">${h.towers.map((t) => html`<div class="tbl-wrap"><h4 style="margin:0 0 4px">${t.tower.name}</h4><table class="heat" aria-label="${t.tower.name} progress by floor"><thead><tr><th></th>${t.cols.map((c) => html`<th title="${c.label}">${c.label.length > 12 ? c.label.slice(0, 11) + '…' : c.label}</th>`)}<th>All</th></tr></thead><tbody>${t.rows.map((r) => html`<tr><th class="rowh">${r.level.name}</th>${r.cells.map((c) => c.n ? html`<td><button style="${raw(heatStyle(c.actual))}" data-hl="${r.level.id}" data-hk="${c.key}" data-ht="${t.tower.id}" aria-label="${t.tower.name} ${r.level.name} ${c.key}: ${pctTxt(c.actual)}">${c.actual == null ? 'n/c' : c.actual.toFixed(0) + '%'}</button></td>` : html`<td class="none" aria-label="No activities">·</td>`)}<td><button style="${raw(heatStyle(r.total.actual))}" data-hl="${r.level.id}" data-hk="" data-ht="${t.tower.id}">${r.total.actual == null ? 'n/c' : r.total.actual.toFixed(0) + '%'}</button></td></tr>`)}</tbody></table></div>`)}</div>`);
    } catch (er) { heatEl.innerHTML = `<div class="banner bad">${errText(er)}</div>`; }
  };
  heatEl.onclick = (e) => {
    const b = e.target.closest('[data-hl]'); if (!b) return;
    const tw = S.meta.towers.find((t) => t.id === +b.dataset.ht), lv = S.meta.levels.find((l) => l.id === +b.dataset.hl);
    const trade = heatSel.trade || base.trade;
    const isCat = !!trade && b.dataset.hk;
    A2(`${tw.name} · ${lv.name}${b.dataset.hk ? ' · ' + (isCat ? b.dataset.hk : short(S.meta.trades.find((t) => t.id === +b.dataset.hk))) : ''}`, { tower: tw.id, level_id: lv.id, trade: isCat ? trade : b.dataset.hk || trade, category: isCat ? b.dataset.hk : undefined, sort: 'variance', level: undefined, zone: base.zone });
  };
  el.querySelector('#ht-tower').onclick = async () => { const r = await pickOne({ title: 'Heat map tower', options: S.meta.towers.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name })), value: heatSel.tower, clearLabel: 'All towers' }); if (r) { heatSel.tower = r.value; overview(el); } };
  el.querySelector('#ht-trade').onclick = async () => { const r = await pickOne({ title: 'Heat map trade', options: S.meta.trades.map((t) => ({ value: t.id, label: t.name })), value: heatSel.trade, clearLabel: 'All trades (columns = trades)' }); if (r) { heatSel.trade = r.value; overview(el); } };
  drawHeat();
}

// ------------------------------------------------------------------ site staff home
async function staffHome(el) {
  const today = todayStr();
  el.innerHTML = String(html`<div class="page-head"><div><h1>My work today</h1><p>${dt(today)} · ${S.user.name}</p></div></div>${loading(3)}`);
  try {
    const [acts, todays, rej, issues, sub] = await Promise.all([getActs(true), api('/api/updates' + qs({ date: today, limit: 500 })), api('/api/updates' + qs({ state: 'rejected', mine: 1, limit: 20 })), api('/api/issues?mine=1&limit=20'), api('/api/updates' + qs({ state: 'submitted', mine: 1, limit: 5 }))]);
    const done = by(todays.rows, 'activity_id');
    const due = acts.filter((a) => a.status !== 'completed' && (a.status === 'in_progress' || (a.status === 'not_started' && a.plan_start && a.plan_start <= addDays(today, 3)))).filter((a) => !done.has(a.id))
      .sort((a, b) => (b.needs_update ? 1 : 0) - (a.needs_update ? 1 : 0) || (a.status === 'in_progress' ? -1 : 1));
    const drafts = todays.rows.filter((u) => u.state === 'draft');
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>My work today</h1><p>${dt(today)} · ${S.user.name}</p></div></div>
      <div class="grid g3 mb">
        <a class="btn btn-primary btn-lg" href="#/updates/new">${icon('plus')} New progress update</a>
        <a class="btn btn-lg" href="#/updates/batch">${icon('list')} Enter several activities</a>
        <button class="btn btn-lg" id="copy-prev">${icon('copy')} Copy yesterday's entries</button>
      </div>
      <div class="tiles mb">
        <button class="tile clk ${due.length ? 'warn' : 'zero'}" data-go="/updates/batch"><div class="n">${due.length}</div><div class="t">Due for update today</div><div class="s">No entry yet</div></button>
        <button class="tile clk ${drafts.length ? 'warn' : 'zero'}" data-go="/updates"><div class="n">${drafts.length}</div><div class="t">Drafts to submit</div><div class="s">Saved, not sent</div></button>
        <button class="tile clk ${rej.rows.length ? 'bad' : 'zero'}" data-go="/updates"><div class="n">${rej.rows.length}</div><div class="t">Rejected — fix</div><div class="s">PM returned them</div></button>
        <button class="tile clk zero" data-go="/updates"><div class="n">${sub.counts.submitted || 0}</div><div class="t">Awaiting approval</div><div class="s">Submitted</div></button>
        <button class="tile clk ${issues.total ? 'warn' : 'zero'}" data-go="/issues?mine=1"><div class="n">${issues.total}</div><div class="t">My open issues</div><div class="s">Owned or raised</div></button>
      </div>
      ${rej.rows.length ? html`<div class="card mb" style="border-color:#fecdca"><h2>Returned by the Project Manager</h2><div class="mt-s">${rej.rows.map((u) => html`<button class="act-card" style="margin-bottom:8px" data-edit="${u.id}"><span class="grow"><b>${u.activity}</b><span class="small muted">${[u.tower, u.level, u.zone].filter(Boolean).join(' › ')} · ${dt(u.report_date)}</span><span class="small var-neg">${u.review_note || 'Rejected'}</span></span>${statePill('rejected')}</button>`)}</div></div>` : ''}
      <div class="card mb"><div class="card-h"><h2>Due for an update today</h2><a class="small" href="#/updates/batch">Enter several at once →</a></div>
        <div class="grid g2 mt-s">${due.slice(0, 12).map((a) => html`<button class="act-card" data-new="${a.id}"><span class="grow"><b>${a.name}</b><span class="small muted">${[a.tower, a.level, a.zone].filter(Boolean).join(' › ')} · ${a.trade}</span>${progress(a.pct, a.planned, { size: 'sm' })}${a.needs_update ? html`<span class="xs var-warn">${a.missing_kind === 'missing' ? 'No update yet' : 'Last update ' + a.days_since_update + ' days ago'}</span>` : ''}</span>${statusPill(a.status)}</button>`)}</div>
        ${due.length > 12 ? html`<p class="muted small">+ ${due.length - 12} more. <a href="#/updates/batch">Open the quick-entry list</a></p>` : ''}${due.length ? '' : html`<div class="empty">You're up to date. Nothing else is due today.</div>`}</div>
      ${issues.rows.length ? html`<div class="card"><h2>My open issues</h2>${issues.rows.slice(0, 6).map((i) => html`<button class="li" data-iss="${i.id}"><span><b>${i.code}</b> ${i.title}<span class="sub">${[i.tower, i.level].filter(Boolean).join(' › ')} · target ${dt(i.target_date)}</span></span><span class="row gap">${i.overdue ? html`<span class="pill p-delayed">Overdue</span>` : ''}${prioPill(i.priority)}</span></button>`)}</div>` : ''}`);
    el.onclick = async (e) => {
      const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
      const n = e.target.closest('[data-new]'); if (n) return go(`/updates/new?activity=${n.dataset.new}`);
      const ed = e.target.closest('[data-edit]'); if (ed) return go(`/updates/${ed.dataset.edit}`);
      const i = e.target.closest('[data-iss]'); if (i) return showIssue(+i.dataset.iss);
      if (e.target.closest('#copy-prev')) {
        try { const r = await api('/api/updates/copy', { method: 'POST', body: { date: today } }); toast(r.from ? `Copied ${r.created.length} entr${r.created.length === 1 ? 'y' : 'ies'} from ${dt(r.from)} — quantities left blank` : r.message, r.created.length ? 'ok' : ''); if (r.created.length) go('/updates/batch'); } catch (er) { toast(errText(er), 'bad'); }
      }
    };
  } catch (e) { el.insertAdjacentHTML('beforeend', `<div class="banner bad">${errText(e)}</div>`); }
}
