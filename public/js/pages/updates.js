// Progress updates: approvals (PM), my updates (site), the quick mobile form, and multi-activity quick entry.
import { html, raw, api, qs, S, icon, table, statePill, statusPill, progress, progressLegend, healthPill, dt, relDay, num, uom, go, todayStr, addDays, toast, errText, loading, isMgmt, isStaff, pickOne, selBtn, field, confirmBox, modal, photoUrl, uploadPhoto, resizeImage, by, debounce, ApiError, esc, clamp, pctTxt, STATUS_LABEL, prioPill } from '../core.js';
import { showUpdate, showActivity, showUpdates, getActs, changed, updateCols, actCell } from './drill.js';

const where = (a) => [a.tower, a.level, a.zone].filter(Boolean).join(' › ');
let tabState = { pm: 'pending', filters: {} };

// =============================================================== list page
export async function updatesPage(el, q = {}) {
  return isMgmt() ? approvalsPage(el, q) : staffUpdates(el, q);
}

async function approvalsPage(el, q) {
  const tab = q.tab || tabState.pm;
  tabState.pm = tab;
  const f = tabState.filters;
  const pm = S.user.role === 'pm';
  el.innerHTML = String(html`<div class="page-head"><div><h1>Progress updates</h1><p>Only approved quantities count towards progress. Submitted updates wait here for your decision.</p></div></div>${loading(3)}`);
  const params = tab === 'pending' ? { state: 'submitted', sort: 'oldest', limit: 400 } : { limit: 200, state: f.state };
  Object.assign(params, { tower: f.tower, trade: f.trade, from: f.from, to: f.to, q: f.q });
  let r;
  try { r = await api('/api/updates' + qs(params)); } catch (e) { el.innerHTML = `<div class="banner bad">${errText(e)}</div>`; return; }
  const sel = new Set();
  const selectable = (u) => u.state === 'submitted' && !u.over_scope;
  const draw = () => {
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Progress updates</h1><p>Only <b>approved</b> quantities count towards progress. Submitted updates wait here for a decision.</p></div></div>
      <div class="tabs" role="tablist"><button role="tab" aria-selected="${tab === 'pending'}" data-tab="pending">Awaiting approval ${tab === 'pending' ? html`<span class="badge">${r.total}</span>` : ''}</button><button role="tab" aria-selected="${tab === 'all'}" data-tab="all">All updates</button></div>
      <div class="filters"><button class="chip ${f.tower ? 'on' : ''}" data-f="tower">Tower: <b>${f.tower ? S.meta.towers.find((t) => t.id === +f.tower).name : 'All'}</b></button><button class="chip ${f.trade ? 'on' : ''}" data-f="trade">Trade: <b>${f.trade ? S.meta.trades.find((t) => t.id === +f.trade).name : 'All'}</b></button>
        ${tab === 'all' ? html`<button class="chip ${f.state ? 'on' : ''}" data-f="state">State: <b>${f.state ? f.state[0].toUpperCase() + f.state.slice(1) : 'All'}</b></button>` : ''}
        <label class="chip">From <input type="date" class="chip-date" data-d="from" value="${f.from || ''}"></label><label class="chip">To <input type="date" class="chip-date" data-d="to" value="${f.to || ''}"></label>
        <input type="search" placeholder="Search activity…" data-q value="${f.q || ''}" style="width:200px;min-height:36px;border-radius:999px" aria-label="Search activity"></div>
      <div class="card">${tab === 'pending' && pm ? html`<div class="row between wrap gap mb"><label class="row gap"><input type="checkbox" id="all" aria-label="Select all"> <span class="bold">Select all approvable (${r.rows.filter(selectable).length})</span></label><div class="row gap"><button class="btn btn-danger" id="bulk-rej" disabled>Reject selected…</button><button class="btn btn-ok" id="bulk-ok" disabled>${icon('check')} Approve selected</button></div></div>` : ''}
      ${table([
        ...(tab === 'pending' && pm ? [{ h: '', r: (u) => (selectable(u) ? html`<input type="checkbox" data-sel="${u.id}" aria-label="Select update">` : html`<span class="xs muted" title="Exceeds scope: correct or reject">!</span>`) }] : []),
        { h: 'Date', first: true, r: (u) => html`${dt(u.report_date)}<span class="sub">${relDay(u.report_date)}</span>` },
        { h: 'Activity', r: (u) => html`<b>${u.activity}</b><span class="sub">${where(u)} · ${u.trade}</span>` },
        { h: 'Qty today', num: true, r: (u) => (u.method === 'quantity' ? html`<b>${num(u.qty_today)}</b> ${uom(u.uom)}${u.over_scope ? html`<span class="sub var-neg">Exceeds scope</span>` : ''}` : 'Milestone') },
        { h: 'Cumulative', num: true, r: (u) => (u.method === 'quantity' ? html`${num(u.cum_approved)}<span class="sub">${u.scope_qty ? ((u.cum_approved / u.scope_qty) * 100).toFixed(0) + '% of scope' : 'scope n/c'}</span>` : '—') },
        { h: 'Manpower', num: true, r: (u) => u.manpower ?? '—' },
        { h: 'Reported by', r: (u) => html`${u.author || '—'}<span class="sub">${u.photos ? u.photos + ' photo' + (u.photos > 1 ? 's' : '') : 'no photos'}${u.issues ? ` · ${u.issues} issue${u.issues > 1 ? 's' : ''}` : ''}</span>` },
        { h: 'State', r: (u) => statePill(u.state) },
        ...(tab === 'pending' && pm ? [{ h: '', r: (u) => html`<span class="row gap"><button class="btn btn-sm btn-ok" data-ok="${u.id}" ${raw(u.over_scope ? 'disabled' : '')}>Approve</button><button class="btn btn-sm" data-rej="${u.id}">Reject</button></span>` }] : []),
      ], r.rows, { rowAttrs: (u) => `class="clk" data-row="${u.id}"`, empty: tab === 'pending' ? 'Nothing is waiting for approval. 🎉' : 'No updates match the filters.' })}
      ${r.total > r.rows.length ? html`<p class="muted small">Showing ${r.rows.length} of ${r.total}.</p>` : ''}</div>`);
    bulkState();
  };
  const bulkState = () => { const ok = el.querySelector('#bulk-ok'), rej = el.querySelector('#bulk-rej'); if (ok) { ok.disabled = rej.disabled = !sel.size; ok.lastChild.textContent = ` Approve selected${sel.size ? ' (' + sel.size + ')' : ''}`; } };
  const reload = () => approvalsPage(el, {});
  draw();
  el.onclick = async (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tabState.pm = t.dataset.tab; return approvalsPage(el, {}); }
    const fb = e.target.closest('[data-f]');
    if (fb) {
      const k = fb.dataset.f;
      const opts = { tower: S.meta.towers.map((x) => ({ value: x.id, label: x.name })), trade: S.meta.trades.map((x) => ({ value: x.id, label: x.name })), state: ['draft', 'submitted', 'approved', 'rejected'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) }[k];
      const p = await pickOne({ title: k[0].toUpperCase() + k.slice(1), options: opts, value: f[k], clearLabel: 'All' });
      if (p) { if (p.value == null) delete f[k]; else f[k] = p.value; reload(); } return;
    }
    if (e.target.closest('[data-sel],#all')) { if (e.target.id === 'all') { el.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; }); } sel.clear(); el.querySelectorAll('[data-sel]:checked').forEach((c) => sel.add(+c.dataset.sel)); return bulkState(); }
    const ok = e.target.closest('[data-ok]'); if (ok) return review([+ok.dataset.ok], 'approve');
    const rj = e.target.closest('[data-rej]'); if (rj) return review([+rj.dataset.rej], 'reject');
    if (e.target.closest('#bulk-ok')) return review([...sel], 'approve');
    if (e.target.closest('#bulk-rej')) return review([...sel], 'reject');
    const row = e.target.closest('[data-row]'); if (row && !e.target.closest('button,input,label')) showUpdate(+row.dataset.row);
  };
  el.onchange = (e) => { const d = e.target.dataset.d; if (d) { f[d] = e.target.value || undefined; reload(); } };
  el.oninput = debounce((e) => { if (e.target.matches('[data-q]')) { f.q = e.target.value || undefined; reload(); } }, 400);
  async function review(ids, action) {
    if (!ids.length) return;
    const c = await confirmBox(action === 'approve'
      ? { title: `Approve ${ids.length} update${ids.length > 1 ? 's' : ''}`, message: 'Their quantities will count towards progress.', confirm: 'Approve', tone: 'ok', reason: { label: 'Note (optional)' } }
      : { title: `Reject ${ids.length} update${ids.length > 1 ? 's' : ''}`, message: 'The site team will see your reason and can correct and resubmit.', confirm: 'Reject', danger: true, reason: { label: 'Reason', required: true, placeholder: 'What needs to be corrected?' } });
    if (!c) return;
    try {
      const res = await api('/api/updates/review', { method: 'POST', body: { ids, action, note: c.reason } });
      toast(`${res.ok} ${action === 'approve' ? 'approved' : 'rejected'}${res.failed ? `, ${res.failed} could not be processed` : ''}`, res.failed ? 'bad' : 'ok');
      res.results.filter((x) => !x.ok).slice(0, 3).forEach((x) => toast(x.error, 'bad'));
      changed();
    } catch (er) { toast(errText(er), 'bad'); }
  }
}

// ------------------------------------------------------------------ site staff list
async function staffUpdates(el, q) {
  const date = q.date || todayStr();
  el.innerHTML = String(html`<div class="page-head"><div><h1>Progress updates</h1></div></div>${loading(3)}`);
  try {
    const [acts, day, mine] = await Promise.all([getActs(true), api('/api/updates' + qs({ date, limit: 500 })), api('/api/updates' + qs({ mine: 1, limit: 30 }))]);
    const done = by(day.rows, 'activity_id');
    const due = acts.filter((a) => a.status !== 'completed' && (a.status === 'in_progress' || a.status === 'on_hold' || (a.status === 'not_started' && a.plan_start && a.plan_start <= addDays(date, 3)))).filter((a) => !done.has(a.id));
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Progress updates</h1><p>Quantities you submit are approved by the Project Manager before they count.</p></div>
        <label class="row gap"><span class="small bold">Date</span><input type="date" id="d" value="${date}" max="${todayStr()}" style="width:auto"></label></div>
      <div class="grid g3 mb"><a class="btn btn-primary btn-lg" href="#/updates/new?date=${date}">${icon('plus')} New update</a><a class="btn btn-lg" href="#/updates/batch?date=${date}">${icon('list')} Quick entry (several)</a><button class="btn btn-lg" id="copy">${icon('copy')} Copy previous day</button></div>
      <div class="card mb"><h2>Entries for ${dt(date)} <span class="badge">${day.rows.length}</span></h2>
        <div class="mt-s grid g2">${day.rows.length ? day.rows.map((u) => html`<button class="act-card" data-u="${u.id}" data-st="${u.state}"><span class="grow"><b>${u.activity}</b><span class="small muted">${where(u)} · ${u.trade}</span><span class="small">${u.method === 'quantity' ? html`<b>${num(u.qty_today)} ${uom(u.uom)}</b> today · ${u.scope_qty ? ((u.cum_approved / u.scope_qty) * 100).toFixed(0) + '% approved' : ''}` : 'Milestone update'}${u.manpower != null ? ` · ${u.manpower} workers` : ''}</span>${u.review_note && u.state === 'rejected' ? html`<span class="small var-neg">${u.review_note}</span>` : ''}</span>${statePill(u.state)}</button>`) : html`<div class="empty" style="grid-column:1/-1">No entries yet for this date.</div>`}</div></div>
      <div class="card mb"><div class="card-h"><h2>Not yet reported <span class="badge">${due.length}</span></h2><a class="small" href="#/updates/batch?date=${date}">Enter several at once →</a></div>
        <div class="mt-s grid g2">${due.slice(0, 16).map((a) => html`<button class="act-card" data-new="${a.id}"><span class="grow"><b>${a.name}</b><span class="small muted">${where(a)} · ${a.trade}</span>${progress(a.pct, a.planned, { size: 'sm' })}</span>${statusPill(a.status)}</button>`)}${due.length ? '' : html`<div class="empty" style="grid-column:1/-1">Everything assigned to you has an entry.</div>`}</div>${due.length > 16 ? html`<p class="muted small">+ ${due.length - 16} more in Quick entry.</p>` : ''}</div>
      <div class="card"><h2>My recent updates</h2>${table([{ h: 'Date', first: true, r: (u) => dt(u.report_date) }, { h: 'Activity', r: (u) => html`<b>${u.activity}</b><span class="sub">${where(u)}</span>` }, { h: 'Qty', num: true, r: (u) => (u.method === 'quantity' ? `${num(u.qty_today)} ${uom(u.uom)}` : 'Milestone') }, { h: 'State', r: (u) => statePill(u.state) }], mine.rows, { rowAttrs: (u) => `class="clk" data-u="${u.id}" data-st="${u.state}"` })}</div>`);
    el.onclick = async (e) => {
      const u = e.target.closest('[data-u]'); if (u) return ['draft', 'rejected'].includes(u.dataset.st) ? go(`/updates/${u.dataset.u}`) : showUpdate(+u.dataset.u);
      const n = e.target.closest('[data-new]'); if (n) return go(`/updates/new?activity=${n.dataset.new}&date=${date}`);
      if (e.target.closest('#copy')) {
        try { const r = await api('/api/updates/copy', { method: 'POST', body: { date } }); toast(r.from ? `Copied ${r.created.length} from ${dt(r.from)} (quantities left blank)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}` : r.message, r.created.length ? 'ok' : ''); if (r.created.length) go(`/updates/batch?date=${date}`); } catch (er) { toast(errText(er), 'bad'); }
      }
    };
    el.onchange = (e) => { if (e.target.id === 'd') go(`/updates?date=${e.target.value || todayStr()}`); };
  } catch (e) { el.innerHTML = `<div class="banner bad">${errText(e)}</div>`; }
}

// =============================================================== the update form
const blankIssue = () => ({ title: '', description: '', required_action: '', priority: 'medium', owner_id: S.user.id, target_date: addDays(todayStr(), 3), is_blocker: 0, needs_decision: 0 });

export async function updateForm(el, { id, activity, date }) {
  if (!isStaff()) { el.innerHTML = String(html`<div class="banner info">Progress updates are entered by site engineers and supervisors. Use <a href="#/updates">Progress updates</a> to review and approve them.</div>`); if (id) showUpdate(id); return; }
  el.innerHTML = String(loading(3));
  const acts = await getActs();
  const st = { id: id || null, activity_id: activity ? +activity : null, report_date: date || todayStr(), qty: '', mids: [], status: '', statusTouched: false, manpower: '', engineer_id: null, supervisor_id: null, contractor: '', location_note: '', remarks: '', next_plan: '', photos: [], issues: [], state: 'new', review_note: null };
  const pk = { tower: null, level: null, zone: null, trade: null };
  let ctx = null, errs = {}, busy = false, dupe = null;

  if (id) {
    const r = await api('/api/updates/' + id);
    const u = r.update;
    if (!['draft', 'rejected'].includes(u.state)) { history.replaceState(null, '', '#/updates'); el.innerHTML = ''; go('/updates'); return showUpdate(id); }
    Object.assign(st, { activity_id: u.activity_id, report_date: u.report_date, qty: u.qty_today || '', mids: u.milestone_ids || [], status: u.status || '', statusTouched: !!u.status, manpower: u.manpower ?? '', engineer_id: u.engineer_id, supervisor_id: u.supervisor_id, contractor: u.contractor || '', location_note: u.location_note || '', remarks: u.remarks || '', next_plan: u.next_plan || '', photos: r.photos.map((p) => ({ id: p.id, caption: p.caption || '' })), issues: r.issues.map((i) => ({ ...i })), state: u.state, review_note: u.review_note });
  }
  const actById = () => acts.find((a) => a.id === st.activity_id);
  const syncPk = () => { const a = actById(); if (a) Object.assign(pk, { tower: a.tower_id, level: a.level_id, zone: a.zone_id ?? 0, trade: a.trade_id }); };
  syncPk();

  async function loadCtx() {
    ctx = null; dupe = null;
    if (!st.activity_id) return;
    ctx = await api('/api/updates/context' + qs({ activity_id: st.activity_id, date: st.report_date }));
    const a = ctx.activity;
    if (ctx.existing && ctx.existing.id !== st.id) dupe = ctx.existing;
    if (!st.id && !st.engineer_id && !st.supervisor_id) { st.engineer_id = a.engineer_id; st.supervisor_id = a.supervisor_id; }
    if (!st.contractor) st.contractor = a.contractor || '';
    if (!st.statusTouched && !st.status) st.status = a.status === 'not_started' ? '' : a.status;
  }

  const calc = () => {
    const a = ctx?.activity; if (!a) return null;
    const q = parseFloat(st.qty) || 0;
    const cum = ctx.approved + ctx.pending + q;
    const scope = a.scope_qty;
    return { q, cum, scope, over: a.method === 'quantity' && scope > 0 && cum > scope + 1e-6, pctAfter: scope > 0 ? (cum / scope) * 100 : null, remaining: scope > 0 ? Math.max(0, scope - cum) : null };
  };
  const autoStatus = () => {
    if (st.statusTouched || !ctx) return;
    const a = ctx.activity, c = calc();
    if (a.method === 'quantity' && c.scope > 0) st.status = c.cum >= c.scope - 1e-6 ? 'completed' : c.q > 0 || ctx.approved > 0 || st.status === 'in_progress' ? 'in_progress' : st.status;
    else if (a.method === 'milestone') { const left = ctx.milestones.filter((m) => !m.achieved_date && !st.mids.includes(m.id)); st.status = !ctx.milestones.length ? st.status : left.length === 0 ? 'completed' : st.mids.length || ctx.milestones.some((m) => m.achieved_date) ? 'in_progress' : st.status; }
  };

  const optsFor = {
    tower: () => [...new Map(acts.map((a) => [a.tower_id, a.tower])).entries()].map(([v, l]) => ({ value: v, label: l })),
    level: () => [...new Map(acts.filter((a) => a.tower_id === pk.tower).map((a) => [a.level_id, a.level || 'Whole tower'])).entries()].map(([v, l]) => ({ value: v ?? 0, label: l })),
    zone: () => [...new Map(acts.filter((a) => a.tower_id === pk.tower && a.level_id === pk.level).map((a) => [a.zone_id ?? 0, a.zone || 'Whole floor (no zone)'])).entries()].map(([v, l]) => ({ value: v, label: l })),
    trade: () => [...new Map(acts.filter((a) => a.tower_id === pk.tower && a.level_id === pk.level && (pk.zone == null || (a.zone_id ?? 0) === pk.zone)).map((a) => [a.trade_id, a.trade])).entries()].map(([v, l]) => ({ value: v, label: l })),
    activity: () => acts.filter((a) => (!pk.tower || a.tower_id === pk.tower) && (pk.level == null || (a.level_id ?? 0) === (pk.level ?? 0)) && (pk.zone == null || (a.zone_id ?? 0) === pk.zone) && (!pk.trade || a.trade_id === pk.trade))
      .sort((a, b) => (a.status === 'completed') - (b.status === 'completed')).map((a) => ({ value: a.id, label: a.name, sub: `${where(a)} · ${a.trade}`, right: a.pct == null ? 'n/c' : a.pct.toFixed(0) + '%' })),
  };
  const lbl = { tower: () => actById()?.tower || (pk.tower && optsFor.tower().find((o) => o.value === pk.tower)?.label), level: () => (pk.level != null && optsFor.level().find((o) => o.value === (pk.level ?? 0))?.label), zone: () => (pk.zone != null && optsFor.zone().find((o) => o.value === pk.zone)?.label), trade: () => pk.trade && optsFor.trade().find((o) => o.value === pk.trade)?.label };
  const people = () => S.meta.users.filter((u) => ['engineer', 'supervisor'].includes(u.role)).map((u) => ({ value: u.id, label: u.name, sub: `${u.role === 'engineer' ? 'Site Engineer' : 'Supervisor'}${u.company ? ' · ' + u.company : ''}` }));
  const uname = (i) => S.meta.users.find((u) => u.id === +i)?.name;
  const E = (k) => errs[k];

  function draw() {
    const a = ctx?.activity;
    const editable = true;
    const stateLine = st.state === 'new' ? html`<span class="pill p-nc">${icon('save')}New — not saved yet</span>` : statePill(st.state);
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>${st.id ? 'Edit progress update' : 'New progress update'}</h1><p>${a ? html`${where(a)} · ${a.trade}` : 'Choose the work area and activity'}</p></div><div class="row gap wrap">${stateLine}</div></div>
      ${st.state === 'rejected' && st.review_note ? html`<div class="banner bad mb">${icon('x')}<div><b>Rejected by the Project Manager:</b> ${st.review_note}<br><span class="small">Correct the update below and submit again.</span></div></div>` : ''}
      ${dupe ? html`<div class="banner warn mb">${icon('warn')}<div>An update for this activity on ${dt(st.report_date)} already exists (${dupe.state}). <a href="#/updates/${dupe.id}" id="open-dupe">Open it</a> instead of creating a duplicate.</div></div>` : ''}
      <div class="card mb"><h2>1 · Date and work location</h2><div class="mt-s"></div>
        <div class="grid2">${field('Date *', html`<input type="date" id="f-date" value="${st.report_date}" max="${todayStr()}" min="${addDays(todayStr(), -S.meta.settings.backdate_days)}">`, { err: E('report_date'), id: 'f-date' })}
        ${st.id ? '' : html`<div class="field"><label>Previous entry</label><button type="button" class="btn" id="copy-prev" ${raw(ctx?.previous ? '' : 'disabled')}>${icon('copy')} Copy details from ${ctx?.previous ? dt(ctx.previous.report_date, false) : 'previous entry'}</button><div class="hint">Copies people, manpower, status and next plan. Never copies quantities.</div></div>`}</div>
        ${field('Work activity *', selBtn('activity', 'Activity', a?.name, { ph: 'Search and choose the activity…' }), { err: E('activity_id'), hint: a ? undefined : 'Type part of the name or location. Or narrow the list below first.' })}
        <details ${raw(pk.tower && !a ? 'open' : '')}><summary class="small bold" style="cursor:pointer;margin-bottom:10px">Narrow by tower, floor, zone and trade</summary>
        <div class="grid3">${field('Tower', selBtn('tower', 'Tower', lbl.tower()), {})}${field('Floor / level', selBtn('level', 'Floor', lbl.level(), { disabled: !pk.tower }))}${field('Zone / unit', selBtn('zone', 'Zone', lbl.zone(), { disabled: pk.level == null }))}</div>
        ${field('Trade', selBtn('trade', 'Trade', lbl.trade(), { disabled: pk.level == null }))}</details>
        ${a ? html`<div class="row wrap gap small"><span class="tag">${a.category || 'General'}</span>${statusPill(a.status)}${healthPill(a.health)}<span class="muted">${a.pct == null ? 'Progress not configured' : `Approved progress ${a.pct.toFixed(1)}%`}</span></div>` : ''}
      </div>
      ${a ? html`
      <div class="card mb"><h2>2 · Progress</h2><div id="calc" class="mt-s"></div></div>
      <div class="card mb"><h2>3 · Activity status</h2><div class="seg mt-s" role="group" aria-label="Activity status">${['not_started', 'in_progress', 'completed', 'on_hold'].map((s) => html`<button type="button" data-status="${s}" aria-pressed="${st.status === s}">${STATUS_LABEL[s]}</button>`)}</div>${E('status') ? html`<div class="err mt-s">${E('status')}</div>` : ''}${st.status === 'on_hold' ? html`<div class="hint mt-s">Explain why it is on hold in Remarks below (and raise a blocker if it needs action).</div>` : ''}</div>
      <div class="card mb"><h2>4 · Manpower and people</h2><div class="mt-s"></div>
        ${field('Manpower on site today *', html`<div class="stepper"><button type="button" data-mp="-1" aria-label="One less worker">−</button><input id="f-mp" inputmode="numeric" value="${st.manpower}" placeholder="0" aria-label="Manpower"><button type="button" data-mp="1" aria-label="One more worker">+</button></div>`, { err: E('manpower') })}
        <div class="grid3">${field('Responsible engineer', selBtn('engineer', 'Engineer', uname(st.engineer_id)), { err: E('engineer_id') })}${field('Supervisor', selBtn('supervisor', 'Supervisor', uname(st.supervisor_id)))}${field('Subcontractor', html`<input id="f-con" list="contractors" value="${st.contractor}" placeholder="Subcontractor" autocomplete="off"><datalist id="contractors">${S.meta.contractors.map((c) => html`<option value="${c}">`)}</datalist>`)}</div></div>
      <div class="card mb"><div class="card-h"><h2>5 · Site photos</h2><div class="row gap wrap"><label class="btn">${icon('camera')} Take photo<input type="file" accept="image/*" capture="environment" hidden id="f-cam"></label><label class="btn">${icon('photos')} From gallery<input type="file" accept="image/*" multiple hidden id="f-gal"></label></div></div>
        <div class="thumbs mt-s" id="photos">${st.photos.length ? st.photos.map((p, i) => html`<div class="ph-edit"><div class="thumb" style="cursor:default"><img src="${photoUrl(p.id)}" alt="Site photo ${i + 1}"><button class="rm" data-rmph="${i}" aria-label="Remove photo">×</button></div><input data-cap="${i}" value="${p.caption}" placeholder="Caption (what does it show?)" maxlength="300" aria-label="Photo caption"></div>`) : html`<div class="muted small" style="grid-column:1/-1">No photos yet. Photos help the PM approve faster.</div>`}${st.uploading ? html`<div class="skeleton" style="min-height:110px"></div>` : ''}</div></div>
      <div class="card mb"><div class="card-h"><h2>6 · Issues and blockers</h2><button class="btn" id="add-issue">${icon('plus')} Report an issue</button></div>
        ${st.issues.length ? st.issues.map((i, k) => issueBlock(i, k)) : html`<div class="muted small mt-s">Nothing blocking work? Leave this empty.</div>`}</div>
      <div class="card mb"><h2>7 · Remarks and next steps</h2><div class="mt-s"></div>${field('Remarks', html`<textarea id="f-rem" placeholder="Anything the PM should know?">${st.remarks}</textarea>`, { err: E('remarks'), id: 'f-rem' })}${field('Next planned activities', html`<textarea id="f-next" rows="2" placeholder="What happens next?">${st.next_plan}</textarea>`)}${field('Location note (optional)', html`<input id="f-loc" value="${st.location_note}" maxlength="300" placeholder="e.g. Grid B–D, near core wall">`)}</div>
      <div class="sticky-bar"><span class="muted small grow">${errsCount() ? html`<span class="var-neg bold">Please fix ${errsCount()} highlighted item${errsCount() > 1 ? 's' : ''}.</span>` : 'A saved draft is not sent to the Project Manager until you submit it.'}</span><button class="btn btn-lg" id="save" ${raw(busy ? 'disabled' : '')}>${icon('save')} Save draft</button><button class="btn btn-primary btn-lg" id="submit" ${raw(busy || dupe ? 'disabled' : '')}>${icon('send')} Submit for approval</button></div>` : ''}`);
    if (a) paintCalc();
  }
  const errsCount = () => Object.keys(errs).length;
  function issueBlock(i, k) {
    const ie = (errs.issues || [])[k] || {};
    const locked = i.id && i.status && i.status !== 'open';
    return html`<div class="card mt" style="background:var(--bg)" data-ik="${k}"><div class="row between"><b>${i.code ? i.code + ' · ' : ''}Issue ${k + 1}${locked ? html` <span class="muted small">(${i.status} — edit in Issues)</span>` : ''}</b>${locked ? '' : html`<button class="btn btn-sm btn-danger" data-rmi="${k}">Remove</button>`}</div>
      ${field('What is the issue? *', html`<input data-i="title" value="${i.title}" maxlength="200" ${raw(locked ? 'disabled' : '')}>`, { err: ie.title })}
      <div class="field"><label>Priority</label><div class="seg">${['low', 'medium', 'high', 'critical'].map((p) => html`<button type="button" data-ip="${p}" aria-pressed="${i.priority === p}" ${raw(locked ? 'disabled' : '')}>${p[0].toUpperCase() + p.slice(1)}</button>`)}</div></div>
      <div class="row gap wrap mb"><label class="row gap"><input type="checkbox" data-i="is_blocker" ${raw(i.is_blocker ? 'checked' : '')} ${raw(locked ? 'disabled' : '')}> <span><b>Blocker</b> — stops work</span></label><label class="row gap"><input type="checkbox" data-i="needs_decision" ${raw(i.needs_decision ? 'checked' : '')} ${raw(locked ? 'disabled' : '')}> <span>Needs a PM decision</span></label></div>
      ${field('Required action', html`<textarea data-i="required_action" rows="2" ${raw(locked ? 'disabled' : '')}>${i.required_action || ''}</textarea>`)}
      <div class="grid2">${field('Action owner *', selBtn('iowner:' + k, 'Action owner', uname(i.owner_id), { disabled: locked }), { err: ie.owner_id })}${field('Target resolution date *', html`<input type="date" data-i="target_date" value="${i.target_date || ''}" ${raw(locked ? 'disabled' : '')}>`, { err: ie.target_date })}</div></div>`;
  }

  function paintCalc() {
    const box = el.querySelector('#calc'); if (!box || !ctx) return;
    const a = ctx.activity, c = calc();
    if (a.method === 'milestone') {
      box.innerHTML = String(html`${ctx.milestones.length ? html`<p class="small muted" style="margin-top:0">Tick the milestones completed. They count once the PM approves.</p><div class="list">${ctx.milestones.map((m) => html`<label class="row gap" style="padding:10px 0"><input type="checkbox" data-ms="${m.id}" ${raw(m.achieved_date || st.mids.includes(m.id) ? 'checked' : '')} ${raw(m.achieved_date ? 'disabled' : '')}> <span class="grow"><b>${m.name}</b></span>${m.achieved_date ? html`<span class="pill p-approved">Approved ${dt(m.achieved_date, false)}</span>` : ''}</label>`)}</div>` : html`<div class="banner warn">${icon('warn')}<div>Milestones are not configured for this activity. Ask the Administrator.</div></div>`}${E('milestone_ids') ? html`<div class="err">${E('milestone_ids')}</div>` : ''}`);
      return;
    }
    const nc = !(a.scope_qty > 0);
    const w = (v) => (a.scope_qty > 0 ? clamp((v / a.scope_qty) * 100) : 0);
    box.innerHTML = String(html`
      ${nc ? html`<div class="banner warn mb">${icon('warn')}<div><b>Scope quantity not configured</b> for this activity. You can save a draft, but it cannot be submitted until the Administrator sets the scope.</div></div>` : ''}
      <dl class="kv mb"><dt>Total scope</dt><dd>${nc ? html`<span class="nc">Not configured</span>` : html`<b>${num(a.scope_qty)} ${uom(a.uom)}</b>`}</dd><dt>Planned to date</dt><dd>${ctx.planned_to_date_qty != null ? `${num(ctx.planned_to_date_qty)} ${uom(a.uom)} (${a.planned.toFixed(0)}%)` : html`<span class="nc">Not configured</span>`}</dd>
        <dt>Approved to date</dt><dd><b>${num(ctx.approved)} ${uom(a.uom)}</b></dd><dt>Awaiting approval (other entries)</dt><dd>${ctx.pending ? num(ctx.pending) + ' ' + uom(a.uom) : '—'}</dd></dl>
      ${field(`Quantity completed today (${uom(a.uom) || 'units'}) *`, html`<input class="qty" id="f-qty" inputmode="decimal" value="${st.qty}" placeholder="0" autocomplete="off" aria-label="Quantity completed today">`, { err: E('qty_today'), id: 'f-qty', hint: c.remaining != null && c.remaining > 0 ? html`Up to <b>${num(c.remaining + c.q)} ${uom(a.uom)}</b> can still be reported. <button type="button" class="btn btn-sm" id="use-rem">Use remaining</button>` : undefined })}
      ${nc ? '' : html`<div class="pb lg"><i style="width:${w(ctx.approved)}%"></i><i class="pend" style="left:${w(ctx.approved)}%;width:${Math.min(w(ctx.pending), 100 - w(ctx.approved))}%"></i><i class="today" style="left:${Math.min(100, w(ctx.approved + ctx.pending))}%;width:${Math.min(w(c.q), 100 - w(ctx.approved + ctx.pending))}%"></i>${a.planned != null ? html`<b style="left:calc(${clamp(a.planned)}% - 1px)"></b>` : ''}</div>
      <div class="legend"><span><i style="background:var(--navy)"></i>Approved</span><span><i style="background:repeating-linear-gradient(45deg,#7d9cc9,#7d9cc9 3px,#b6c9e6 3px,#b6c9e6 6px)"></i>Awaiting approval</span><span><i style="background:#2e90fa"></i>Today</span><span><i style="background:#f79009;width:3px;height:12px"></i>Planned to date</span></div>
      <dl class="kv mt"><dt>Cumulative quantity completed</dt><dd><b>${num(c.cum)} ${uom(a.uom)}</b></dd><dt>Progress if approved</dt><dd><b>${c.pctAfter == null ? '—' : c.pctAfter.toFixed(1) + '%'}</b></dd><dt>Remaining</dt><dd>${num(c.remaining)} ${uom(a.uom)}</dd></dl>
      ${c.over ? html`<div class="banner bad mt">${icon('x')}<div><b>Exceeds the defined scope</b> by ${num(c.cum - c.scope)} ${uom(a.uom)}. Check the quantity. It cannot be submitted while it exceeds scope.</div></div>` : ''}`}`);
  }

  function collect() {
    const g = (s) => el.querySelector(s);
    if (!g('#f-mp')) return;
    st.manpower = g('#f-mp').value.trim(); st.contractor = g('#f-con').value; st.remarks = g('#f-rem').value; st.next_plan = g('#f-next').value; st.location_note = g('#f-loc').value;
    st.issues.forEach((i, k) => { const b = el.querySelector(`[data-ik="${k}"]`); if (!b) return; b.querySelectorAll('[data-i]').forEach((x) => { i[x.dataset.i] = x.type === 'checkbox' ? (x.checked ? 1 : 0) : x.value; }); });
    st.photos.forEach((p, i) => { const c = el.querySelector(`[data-cap="${i}"]`); if (c) p.caption = c.value; });
  }

  async function save(action) {
    collect(); errs = {}; busy = true; draw();
    const body = { activity_id: st.activity_id, report_date: st.report_date, qty_today: st.qty === '' ? 0 : st.qty, milestone_ids: st.mids, status: st.status || null, manpower: st.manpower === '' ? null : st.manpower, engineer_id: st.engineer_id, supervisor_id: st.supervisor_id, contractor: st.contractor, location_note: st.location_note, remarks: st.remarks, next_plan: st.next_plan, photos: st.photos, issues: st.issues.map((i) => ({ ...i })), action };
    try {
      const r = await api(st.id ? `/api/updates/${st.id}` : '/api/updates', { method: st.id ? 'PUT' : 'POST', body });
      busy = false;
      r.warnings?.forEach((w) => toast(w));
      if (action === 'submit') { toast('Submitted for approval', 'ok'); changed(); return go('/updates'); }
      st.id = r.update.id; st.state = r.update.state; st.review_note = null;
      history.replaceState(null, '', `#/updates/${st.id}`);
      const full = await api('/api/updates/' + st.id); st.issues = full.issues.map((i) => ({ ...i })); st.photos = full.photos.map((p) => ({ id: p.id, caption: p.caption || '' }));
      toast('Draft saved — you can come back and finish later', 'ok'); draw();
    } catch (e) {
      busy = false;
      if (e instanceof ApiError && e.status === 409 && e.data?.existing_id) { dupe = { id: e.data.existing_id, state: 'saved' }; toast(e.message, 'bad'); }
      else if (e.fields) { errs = e.fields; toast(e.message, 'bad'); } else toast(errText(e), 'bad');
      draw();
      el.querySelector('.field.bad, .err')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  async function choose(which) {
    collect();
    const titles = { tower: 'Tower', level: 'Floor / level', zone: 'Zone / unit', trade: 'Trade', activity: 'Work activity' };
    const opts = optsFor[which]();
    const cur = which === 'activity' ? st.activity_id : pk[which];
    const r = await pickOne({ title: titles[which], options: opts, value: cur, searchable: true });
    if (!r) return;
    const v = r.value === null ? null : +r.value;
    if (which === 'tower') Object.assign(pk, { tower: v, level: null, zone: null, trade: null });
    if (which === 'level') Object.assign(pk, { level: v, zone: null, trade: null });
    if (which === 'zone') Object.assign(pk, { zone: v, trade: null });
    if (which === 'trade') pk.trade = v;
    if (which !== 'activity') { const list = optsFor.activity(); if (list.length === 1 && which === 'trade') st.activity_id = list[0].value; else if (st.activity_id && !list.some((o) => o.value === st.activity_id)) st.activity_id = null; }
    else { st.activity_id = v; syncPk(); }
    if (st.activity_id) { st.status = ''; st.statusTouched = false; st.mids = []; st.qty = ''; await loadCtx(); }
    else ctx = null;
    draw();
  }

  async function personPick(which, k) {
    const r = await pickOne({ title: which === 'engineer' ? 'Responsible engineer' : which === 'supervisor' ? 'Supervisor' : 'Action owner', options: people(), value: which === 'engineer' ? st.engineer_id : which === 'supervisor' ? st.supervisor_id : st.issues[k].owner_id, clearLabel: which === 'iowner' ? null : 'None' });
    if (!r) return;
    collect();
    if (which === 'engineer') st.engineer_id = r.value; else if (which === 'supervisor') st.supervisor_id = r.value; else st.issues[k].owner_id = r.value;
    draw();
  }
  async function addPhotos(files) {
    if (!files.length) return;
    collect(); st.uploading = true; draw();
    for (const f of files) {
      try { const r = await uploadPhoto(f, { activity_id: st.activity_id, taken_date: st.report_date }); st.photos.push({ id: r.id, caption: '' }); }
      catch (e) { toast(errText(e), 'bad'); }
    }
    st.uploading = false; draw();
  }

  el.onclick = async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if ((b = t('[data-pick]'))) { const w = b.dataset.pick; return w.startsWith('iowner:') ? personPick('iowner', +w.split(':')[1]) : ['engineer', 'supervisor'].includes(w) ? personPick(w) : choose(w); }
    if ((b = t('[data-status]'))) { collect(); st.status = b.dataset.status; st.statusTouched = true; return draw(); }
    if ((b = t('[data-mp]'))) { collect(); st.manpower = Math.max(0, (parseInt(st.manpower) || 0) + +b.dataset.mp); el.querySelector('#f-mp').value = st.manpower; return; }
    if ((b = t('[data-rmph]'))) { collect(); const p = st.photos.splice(+b.dataset.rmph, 1)[0]; try { await api('/api/photos/' + p.id, { method: 'DELETE' }); } catch { /* removed on save */ } return draw(); }
    if ((b = t('[data-rmi]'))) { collect(); st.issues.splice(+b.dataset.rmi, 1); return draw(); }
    if ((b = t('[data-ip]'))) { collect(); st.issues[+b.closest('[data-ik]').dataset.ik].priority = b.dataset.ip; return draw(); }
    if (t('#add-issue')) { collect(); st.issues.push(blankIssue()); draw(); return el.querySelector(`[data-ik="${st.issues.length - 1}"] input`)?.focus(); }
    if (t('#use-rem')) { const c = calc(); st.qty = String(Math.round((c.remaining + c.q) * 1000) / 1000); autoStatus(); el.querySelector('#f-qty').value = st.qty; paintCalc(); return draw(); }
    if (t('#save')) return save('draft');
    if (t('#submit')) return save('submit');
    if (t('#copy-prev')) {
      const p = ctx.previous; collect();
      Object.assign(st, { manpower: p.manpower ?? '', engineer_id: p.engineer_id || st.engineer_id, supervisor_id: p.supervisor_id || st.supervisor_id, contractor: p.contractor || st.contractor, next_plan: p.next_plan || '', location_note: p.location_note || '', status: p.status === 'completed' ? 'in_progress' : p.status || st.status, statusTouched: true });
      toast(`Copied details from ${dt(p.report_date)}. Quantity, photos and issues were not copied.`); return draw();
    }
  };
  el.oninput = (e) => {
    if (e.target.id === 'f-qty') { st.qty = e.target.value.replace(/[^0-9.]/g, ''); if (st.qty !== e.target.value) e.target.value = st.qty; autoStatus(); paintCalcKeepFocus(); }
  };
  function paintCalcKeepFocus() {
    const pos = el.querySelector('#f-qty')?.selectionStart;
    paintCalc();
    const i = el.querySelector('#f-qty'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* not supported */ } }
    el.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.status === st.status));
  }
  el.onchange = async (e) => {
    const t = e.target;
    if (t.id === 'f-date') { collect(); st.report_date = t.value; errs = {}; if (st.activity_id) { await loadCtx(); } return draw(); }
    if (t.id === 'f-cam' || t.id === 'f-gal') return addPhotos([...t.files]);
    if (t.matches('[data-ms]')) { st.mids = [...el.querySelectorAll('[data-ms]:checked:not(:disabled)')].map((c) => +c.dataset.ms); autoStatus(); return draw(); }
  };

  if (st.activity_id) await loadCtx();
  draw();
  if (!st.activity_id) el.querySelector('[data-pick="tower"]')?.focus();
}

// =============================================================== quick entry for several activities
export async function batchPage(el, q = {}) {
  if (!isStaff()) { el.innerHTML = '<div class="banner info">Quick entry is for site engineers and supervisors.</div>'; return; }
  const date = q.date || todayStr();
  const flt = { tower: null, level: null, trade: null, q: '' };
  el.innerHTML = String(loading(3));
  let acts, existing;
  const load = async () => { [acts, existing] = await Promise.all([getActs(true), api('/api/updates' + qs({ date, limit: 500 })).then((r) => by(r.rows, 'activity_id'))]); };
  await load();
  const rowsData = new Map(); // activity_id -> {qty, manpower, status, remarks, touched}
  const results = new Map();

  const candidates = () => acts.filter((a) => a.status !== 'completed' && (a.status === 'in_progress' || a.status === 'on_hold' || existing.has(a.id) || (a.status === 'not_started' && a.plan_start && a.plan_start <= addDays(date, 3)))
    && (!flt.tower || a.tower_id === flt.tower) && (!flt.level || a.level_id === flt.level) && (!flt.trade || a.trade_id === flt.trade) && (!flt.q || `${a.name} ${where(a)}`.toLowerCase().includes(flt.q.toLowerCase())));
  const dataFor = (a) => {
    if (!rowsData.has(a.id)) { const u = existing.get(a.id); rowsData.set(a.id, { qty: u && u.qty_today ? String(u.qty_today) : '', manpower: u?.manpower != null ? String(u.manpower) : '', status: u?.status || (a.status === 'not_started' ? '' : a.status), remarks: u?.remarks || '', touched: false, id: u?.id }); }
    return rowsData.get(a.id);
  };
  const locked = (a) => { const u = existing.get(a.id); return u && !['draft', 'rejected'].includes(u.state); };

  const draw = () => {
    const list = candidates();
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Quick entry</h1><p>Enter today's quantities for several activities. Quantities are per day, never cumulative.</p></div><a class="btn" href="#/updates">← Back</a></div>
      <div class="card mb"><div class="filters" style="margin:0"><label class="chip">Date <input type="date" class="chip-date" id="b-date" value="${date}" max="${todayStr()}"></label>
        <button class="chip ${flt.tower ? 'on' : ''}" data-bf="tower">Tower: <b>${flt.tower ? S.meta.towers.find((t) => t.id === flt.tower).name : 'All'}</b></button>
        <button class="chip ${flt.level ? 'on' : ''}" data-bf="level">Floor: <b>${flt.level ? S.meta.levels.find((l) => l.id === flt.level).name : 'All'}</b></button>
        <button class="chip ${flt.trade ? 'on' : ''}" data-bf="trade">Trade: <b>${flt.trade ? S.meta.trades.find((t) => t.id === flt.trade).name : 'All'}</b></button>
        <input type="search" id="b-q" placeholder="Search…" value="${flt.q}" style="width:170px;min-height:36px;border-radius:999px" aria-label="Search activities"><button class="btn btn-sm" id="b-copy">${icon('copy')} Copy previous day</button></div></div>
      <div id="rows">${list.length ? list.slice(0, 80).map((a) => rowHtml(a)) : html`<div class="empty">No activities match. Adjust the filters.</div>`}</div>${list.length > 80 ? html`<p class="muted small">Showing 80 of ${list.length}. Use the filters to narrow the list.</p>` : ''}
      <div class="sticky-bar"><span class="muted small grow" id="b-sum"></span><button class="btn btn-lg" id="b-save">${icon('save')} Save drafts</button><button class="btn btn-primary btn-lg" id="b-submit">${icon('send')} Submit all filled</button></div>`);
    sum();
  };
  const rowHtml = (a) => {
    const d = dataFor(a), u = existing.get(a.id), lk = locked(a), res = results.get(a.id);
    const rem = a.remaining;
    return html`<div class="card mb" data-r="${a.id}" style="padding:12px"><div class="row between gap wrap"><div class="grow"><b>${a.name}</b><div class="small muted">${where(a)} · ${a.trade}</div></div><div class="row gap">${u ? statePill(u.state) : ''}<button class="btn btn-sm btn-ghost" data-full="${a.id}">Full form</button></div></div>
      <div class="small muted mt-s">${a.method === 'quantity' ? `Scope ${a.scope_qty ? num(a.scope_qty) : 'not configured'} ${uom(a.uom)} · approved ${num(a.approved_qty)}${a.pending_qty ? ' · awaiting ' + num(a.pending_qty) : ''} · remaining ${rem != null ? num(rem) : '—'}` : 'Milestone-based: use the full form'}</div>
      ${lk ? html`<div class="small mt-s">Already ${u.state}: ${u.method === 'quantity' ? `${num(u.qty_today)} ${uom(u.uom)}` : 'milestone'} — no changes here.</div>` : a.method === 'quantity' ? html`<div class="grid3 mt-s" style="gap:8px">
        <div class="field" style="margin:0"><label class="xs">Qty today (${uom(a.uom)})</label><input data-b="qty" inputmode="decimal" value="${d.qty}" placeholder="0" aria-label="Quantity today for ${a.name}"></div>
        <div class="field" style="margin:0"><label class="xs">Manpower</label><input data-b="manpower" inputmode="numeric" value="${d.manpower}" placeholder="0" aria-label="Manpower for ${a.name}"></div>
        <div class="field" style="margin:0"><label class="xs">Status</label><select data-b="status" aria-label="Status for ${a.name}"><option value="">Select…</option>${['not_started', 'in_progress', 'completed', 'on_hold'].map((s) => html`<option value="${s}" ${raw(d.status === s ? 'selected' : '')}>${STATUS_LABEL[s]}</option>`)}</select></div></div>
        <input class="mt-s" data-b="remarks" value="${d.remarks}" placeholder="Remark (optional)" maxlength="300" aria-label="Remark for ${a.name}">` : ''}
      <div class="small mt-s" data-msg>${res ? (res.ok ? html`<span class="var-pos bold">${icon('check')} ${res.state === 'submitted' ? 'Submitted' : 'Saved as draft'}</span>` : html`<span class="var-neg bold">${res.error}${res.fields ? ' — ' + Object.values(res.fields).filter((x) => typeof x === 'string').join('; ') : ''}</span>`) : ''}</div></div>`;
  };
  const filled = () => candidates().filter((a) => !locked(a) && a.method === 'quantity').filter((a) => { const d = dataFor(a); return d.touched && (parseFloat(d.qty) > 0 || d.status === 'on_hold' || d.remarks); });
  const sum = () => { const n = filled().length; const s = el.querySelector('#b-sum'); if (s) s.textContent = n ? `${n} row${n > 1 ? 's' : ''} filled in` : 'Enter a quantity in one or more rows.'; };

  const send = async (action) => {
    const items = filled().map((a) => { const d = dataFor(a); return { activity_id: a.id, report_date: date, qty_today: d.qty === '' ? 0 : d.qty, manpower: d.manpower === '' ? null : d.manpower, status: d.status || (parseFloat(d.qty) > 0 ? 'in_progress' : null), remarks: d.remarks, id: d.id || undefined }; });
    if (!items.length) return toast('Nothing filled in yet');
    try {
      const r = await api('/api/updates/batch', { method: 'POST', body: { action, items } });
      results.clear(); r.results.forEach((x) => results.set(x.activity_id, x));
      toast(`${r.ok} ${action === 'submit' ? 'submitted' : 'saved'}${r.failed ? `, ${r.failed} need attention` : ''}`, r.failed ? 'bad' : 'ok');
      r.results.filter((x) => x.ok).forEach((x) => { const d = rowsData.get(x.activity_id); if (d) { d.id = x.id; } });
      await load(); rowsData.forEach((d, id) => { if (results.get(id)?.ok) d.touched = false; });
      draw();
      if (!r.failed && action === 'submit') go('/updates'); else el.querySelector('[data-msg] .var-neg')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) { toast(errText(e), 'bad'); }
  };

  el.onclick = async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if ((b = t('[data-bf]'))) {
      const k = b.dataset.bf;
      const opts = { tower: () => [...new Map(acts.map((a) => [a.tower_id, a.tower])).entries()].map(([v, l]) => ({ value: v, label: l })), level: () => [...new Map(acts.filter((a) => (!flt.tower || a.tower_id === flt.tower) && a.level_id).map((a) => [a.level_id, `${a.tower} · ${a.level}`])).entries()].map(([v, l]) => ({ value: v, label: l })), trade: () => [...new Map(acts.map((a) => [a.trade_id, a.trade])).entries()].map(([v, l]) => ({ value: v, label: l })) }[k]();
      const r = await pickOne({ title: k, options: opts, value: flt[k], clearLabel: 'All', searchable: true });
      if (r) { flt[k] = r.value == null ? null : +r.value; if (k === 'tower') flt.level = null; draw(); } return;
    }
    if ((b = t('[data-full]'))) return go(`/updates/${existing.get(+b.dataset.full)?.id || 'new?activity=' + b.dataset.full + '&date=' + date}`);
    if (t('#b-save')) return send('draft');
    if (t('#b-submit')) { const c = await confirmBox({ title: 'Submit all filled rows', message: `Submit ${filled().length} update(s) for approval? Each is checked for scope and required fields.`, confirm: 'Submit' }); if (c) send('submit'); return; }
    if (t('#b-copy')) { try { const r = await api('/api/updates/copy', { method: 'POST', body: { date } }); toast(r.from ? `Copied ${r.created.length} from ${dt(r.from)}; quantities left blank` : r.message, r.created.length ? 'ok' : ''); rowsData.clear(); await load(); draw(); } catch (er) { toast(errText(er), 'bad'); } }
  };
  el.oninput = (e) => {
    const inp = e.target.closest('[data-b]'); if (!inp) { if (e.target.id === 'b-q') { flt.q = e.target.value; clearTimeout(draw.t); draw.t = setTimeout(() => { draw(); const i = el.querySelector('#b-q'); i.focus(); i.setSelectionRange(9999, 9999); }, 300); } return; }
    const card = inp.closest('[data-r]'), a = acts.find((x) => x.id === +card.dataset.r), d = dataFor(a), k = inp.dataset.b;
    if (k === 'qty' || k === 'manpower') { const v = inp.value.replace(k === 'qty' ? /[^0-9.]/g : /[^0-9]/g, ''); if (v !== inp.value) inp.value = v; d[k] = v; } else d[k] = inp.value;
    d.touched = true;
    if (k === 'qty' && !d.statusTouched) { const q = parseFloat(d.qty) || 0; const reaches = a.scope_qty > 0 && a.approved_qty + a.pending_qty + q >= a.scope_qty - 1e-6; d.status = q > 0 ? (reaches ? 'completed' : 'in_progress') : d.status; card.querySelector('[data-b=status]').value = d.status; }
    if (k === 'status') d.statusTouched = true;
    const q = parseFloat(d.qty) || 0, over = a.scope_qty > 0 && q > (a.remaining ?? Infinity) + 1e-6;
    card.querySelector('[data-msg]').innerHTML = over ? `<span class="var-neg bold">Exceeds remaining scope (${num(a.remaining)} ${uom(a.uom)} left) — cannot be submitted.</span>` : '';
    results.delete(a.id); sum();
  };
  el.onchange = (e) => { if (e.target.id === 'b-date') go(`/updates/batch?date=${e.target.value || todayStr()}`); };
  draw();
}
