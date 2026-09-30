// Detail records opened from any summary, chart, list or notification: activities, activity, update, issue.
import { html, raw, api, qs, S, drawer, modal, confirmBox, pickOne, selBtn, field, toast, errText, icon, table, progress, progressLegend, pct, variance, healthPill, statusPill, statePill, issueStatusPill, prioPill, dt, dtime, num, uom, relDay, todayStr, lightbox, photoUrl, uploadPhoto, isMgmt, isStaff, go, loading, NC, pctTxt, varTxt, ApiError, esc, addDays, diffDays } from '../core.js';

export const changed = () => window.dispatchEvent(new Event('avantro:changed'));

let actCache = null;
export async function getActs(force) {
  if (!actCache || force) actCache = api('/api/activities?limit=3000');
  return (await actCache).rows;
}
window.addEventListener('avantro:changed', () => { actCache = null; });

const where = (a) => [a.tower, a.level, a.zone].filter(Boolean).join(' › ') || a.tower;
export const actCell = (a) => html`<b>${a.name}</b><span class="sub">${where(a)} · ${a.trade}</span>`;

// ------------------------------------------------------------ activity list drawer
export async function showActivities(title, params = {}) {
  const d = drawer({ title, wide: true, body: loading(4) });
  try {
    const r = await api('/api/activities' + qs({ limit: 600, ...params }));
    const s = r.summary;
    d.body(html`
      ${s ? html`<div class="card mb"><div class="row wrap gap between"><div><span class="muted small">Actual</span> <b>${pctTxt(s.actual)}</b> &nbsp; <span class="muted small">Planned</span> <b>${pctTxt(s.planned)}</b> &nbsp; <span class="muted small">Variance</span> <b>${variance(s.variance)}</b></div><div class="row gap wrap">${healthPill(s.health)}<a class="btn btn-sm" href="/api/export/activities${qs({ tower: params.tower, date: params.date })}">${icon('download')} Excel</a></div></div>${s.reasons.length ? html`<div class="small muted mt-s">${s.reasons.join(' · ')}</div>` : ''}</div>` : ''}
      <div class="card"><div class="card-h"><h3>${r.total} ${r.total === 1 ? 'activity' : 'activities'}</h3>${progressLegend}</div>
      <div id="al">${activityTable(r.rows)}</div>${r.total > r.rows.length ? html`<p class="muted small">Showing the first ${r.rows.length} of ${r.total}. Narrow the filters to see the rest.</p>` : ''}</div>`);
    d.b.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) showActivity(+tr.dataset.id); });
  } catch (e) { d.body(html`<div class="banner bad">${errText(e)}</div>`); }
}
export const activityTable = (rows) => table([
  { h: 'Activity', first: true, r: actCell },
  { h: 'Progress', r: (a) => progress(a.pct, a.planned, { pending: a.pending_qty && a.scope_qty ? (a.pending_qty / a.scope_qty) * 100 : 0 }) },
  { h: 'Variance', r: (a) => variance(a.variance) },
  { h: 'Health', r: (a) => healthPill(a.health) },
  { h: 'Status', r: (a) => statusPill(a.status) },
  { h: 'Finish', r: (a) => html`${dt(a.plan_finish)}${a.overdue ? html`<span class="sub var-neg">Overdue</span>` : ''}` },
  { h: 'Responsible', r: (a) => html`${a.engineer || a.supervisor || 'Unassigned'}${a.needs_update ? html`<span class="sub var-warn">${a.missing_kind === 'missing' ? 'No update yet' : `No update ${a.days_since_update}d`}</span>` : ''}` },
], rows, { rowAttrs: (a) => `class="clk" data-id="${a.id}"`, empty: 'No activities match.' });

// ------------------------------------------------------------ single activity
export async function showActivity(id) {
  const d = drawer({ title: 'Activity', wide: true, body: loading(3) });
  try {
    const r = await api('/api/activities/' + id);
    const a = r.activity;
    d.title(a.name);
    const gaps = [];
    if (!a.weight) gaps.push('progress weight');
    if (a.method === 'quantity' && !a.scope_qty) gaps.push('scope quantity');
    if (a.method === 'milestone' && !a.ms_total) gaps.push('milestones');
    if (!a.plan_start || !a.plan_finish) gaps.push('baseline dates');
    d.body(html`
      <div class="row wrap gap mb"><span class="tag">${where(a)}</span><span class="tag">${a.trade}</span>${a.category ? html`<span class="tag">${a.category}</span>` : ''}${healthPill(a.health)}${statusPill(a.status)}${a.overdue ? html`<span class="pill p-delayed">Overdue</span>` : ''}</div>
      ${gaps.length ? html`<div class="banner warn mb">${icon('warn')}<div><b>Not configured:</b> ${gaps.join(', ')}. Figures that depend on these are shown as "Not configured" until the Administrator sets them.</div></div>` : ''}
      ${a.status === 'on_hold' && a.status_note ? html`<div class="banner warn mb">${icon('warn')}<div><b>On hold:</b> ${a.status_note}</div></div>` : ''}
      <div class="grid g2 mb">
        <div class="card"><h3>Progress</h3><div class="mt-s">${progress(a.pct, a.planned, { size: 'lg', pending: a.pending_qty && a.scope_qty ? (a.pending_qty / a.scope_qty) * 100 : 0 })}</div>${progressLegend}
          <dl class="kv mt">
            <dt>Planned to date</dt><dd>${pct(a.planned)}</dd><dt>Variance</dt><dd>${variance(a.variance)}</dd>
            ${a.method === 'quantity' ? html`<dt>Scope</dt><dd>${a.scope_qty ? num(a.scope_qty) + ' ' + uom(a.uom) : NC}</dd><dt>Approved to date</dt><dd>${num(a.approved_qty)} ${uom(a.uom)}</dd>
            <dt>Awaiting approval</dt><dd>${a.pending_qty ? html`<b class="var-warn">${num(a.pending_qty)} ${uom(a.uom)}</b> <span class="muted small">(not counted in progress)</span>` : '—'}</dd><dt>Remaining</dt><dd>${a.remaining != null ? num(a.remaining) + ' ' + uom(a.uom) : '—'}</dd>` : html`<dt>Method</dt><dd>Milestone-based</dd>`}
            <dt>Weight</dt><dd>${a.weight ?? NC}${a.eff_weight ? html` <span class="muted small">(${(a.eff_weight * 100).toFixed(2)}% of project)</span>` : ''}</dd></dl></div>
        <div class="card"><h3>Schedule &amp; people</h3><dl class="kv mt-s">
          <dt>Planned start</dt><dd>${a.plan_start ? dt(a.plan_start) : NC}</dd><dt>Planned finish</dt><dd>${a.plan_finish ? dt(a.plan_finish) : NC}</dd>
          <dt>Actual start</dt><dd>${dt(a.actual_start)}</dd><dt>Actual finish</dt><dd>${dt(a.actual_finish)}</dd>
          <dt>Engineer</dt><dd>${a.engineer || 'Unassigned'}</dd><dt>Supervisor</dt><dd>${a.supervisor || 'Unassigned'}</dd><dt>Subcontractor</dt><dd>${a.contractor || '—'}</dd>
          <dt>Last site update</dt><dd>${a.last_update ? html`${dt(a.last_update)} <span class="muted small">(${relDay(a.last_update)})</span>` : 'None yet'}${a.needs_update ? html` <span class="pill p-at_risk">Outdated</span>` : ''}</dd></dl></div>
      </div>
      ${r.milestones.length ? html`<div class="card mb"><h3>Milestones</h3><div class="list mt-s">${r.milestones.map((m) => html`<div class="row between"><span>${m.achieved_date ? icon('checkc') : icon('circle')} ${m.name}</span><span class="small ${m.achieved_date ? 'var-pos' : 'muted'}">${m.achieved_date ? 'Approved ' + dt(m.achieved_date) : 'Not yet achieved'}</span></div>`)}</div></div>` : ''}
      <div class="card mb"><h3>Update history</h3>${table([
        { h: 'Date', first: true, r: (u) => dt(u.report_date) },
        { h: 'Qty', num: true, r: (u) => (a.method === 'quantity' ? `${num(u.qty_today)} ${uom(a.uom)}` : u.milestone_ids ? 'Milestone' : '—') },
        { h: 'Cumulative (approved)', num: true, r: (u) => (a.method === 'quantity' ? num(u.cum_approved) : '—') },
        { h: 'Manpower', num: true, r: (u) => u.manpower ?? '—' },
        { h: 'State', r: (u) => statePill(u.state) },
        { h: 'By', r: (u) => u.author || '—' },
        { h: 'Remarks', r: (u) => html`<span class="small">${(u.remarks || '').slice(0, 90)}</span>` },
      ], r.updates, { rowAttrs: (u) => `class="clk" data-upd="${u.id}"`, empty: 'No updates recorded yet.' })}</div>
      ${r.issues.length ? html`<div class="card mb"><h3>Issues</h3><div class="mt-s">${r.issues.map((i) => html`<button class="li" data-iss="${i.id}"><span><b>${i.code}</b> ${i.title}<span class="sub">${i.owner || 'Unassigned'} · target ${dt(i.target_date)}</span></span><span class="row gap">${i.is_blocker ? html`<span class="pill p-bad">Blocker</span>` : ''}${issueStatusPill(i.status)}</span></button>`)}</div></div>` : ''}
      ${r.photos.length ? html`<div class="card mb"><h3>Photos</h3><div class="thumbs mt-s">${r.photos.map((p, i) => html`<button class="thumb" data-ph="${i}">${p.is_demo ? html`<span class="demo">DEMO</span>` : ''}<img loading="lazy" src="${photoUrl(p.id)}" alt="${p.caption || 'Site photo'}"><span class="cap"><b>${p.caption || 'Site photo'}</b>${dt(p.taken_date)}</span></button>`)}</div></div>` : ''}
      <details class="card"><summary class="bold" style="cursor:pointer">Audit trail (${r.audit.length})</summary>${table([{ h: 'When', first: true, r: (x) => dtime(x.ts) }, { h: 'Who', r: (x) => x.user_name }, { h: 'What', r: (x) => x.summary }], r.audit, { empty: 'No audit entries.' })}</details>`);
    d.footer(r.can_edit ? html`<button class="btn btn-primary" id="add-upd">${icon('plus')} Add progress update</button>` : '');
    d.$('#add-upd')?.addEventListener('click', () => { d.close(); go(`/updates/new?activity=${id}`); });
    d.b.addEventListener('click', (e) => {
      const u = e.target.closest('[data-upd]'); if (u) return showUpdate(+u.dataset.upd);
      const i = e.target.closest('[data-iss]'); if (i) return showIssue(+i.dataset.iss);
      const p = e.target.closest('[data-ph]'); if (p) lightbox(r.photos.map((x) => ({ ...x, tower: a.tower, level: a.level, zone: a.zone, trade: a.trade })), +p.dataset.ph);
    });
  } catch (e) { d.body(html`<div class="banner bad">${errText(e)}</div>`); }
}

// ------------------------------------------------------------ single update
export async function showUpdate(id) {
  const d = drawer({ title: 'Progress update', wide: true, body: loading(3) });
  const load = async () => {
    const r = await api('/api/updates/' + id);
    const u = r.update;
    d.title(`${u.activity_name} · ${dt(u.report_date)}`);
    const isQty = u.method === 'quantity';
    const cumIfApproved = r.approved + r.pending_others + (u.state === 'approved' ? 0 : u.qty_today);
    d.body(html`
      <div class="row wrap gap mb">${statePill(u.state)}${statusPill(u.status || 'not_started')}${u.over_scope ? html`<span class="pill p-bad">${icon('warn')}Exceeds scope</span>` : ''}<span class="muted small">Reported by ${u.author || '—'}${u.submitted_at ? ' · submitted ' + dtime(u.submitted_at) : ''}</span></div>
      ${u.state === 'rejected' ? html`<div class="banner bad mb">${icon('x')}<div><b>Rejected${u.reviewer ? ' by ' + u.reviewer : ''}:</b> ${u.review_note || 'No reason recorded.'}<br><span class="small">Edit the update to correct it, then submit again.</span></div></div>` : ''}
      ${u.state === 'approved' ? html`<div class="banner ok mb">${icon('checkc')}<div>Approved${u.reviewer ? ' by ' + u.reviewer : ''} ${dtime(u.review_at)}. Only approved quantities count towards progress.${u.review_note ? ' Note: ' + u.review_note : ''}</div></div>` : ''}
      ${u.state === 'submitted' ? html`<div class="banner info mb">${icon('clock')}<div>Awaiting Project Manager approval. This quantity is <b>not yet counted</b> in progress.</div></div>` : ''}
      ${u.over_scope && u.state !== 'approved' ? html`<div class="banner warn mb">${icon('warn')}<div>This quantity would take the cumulative total above the defined scope (${num(cumIfApproved)} vs ${num(u.scope_qty)} ${uom(u.uom)}). It cannot be approved unless the scope is revised or the quantity corrected.</div></div>` : ''}
      <div class="grid g2 mb">
        <div class="card"><h3>Work</h3><dl class="kv mt-s"><dt>Location</dt><dd>${[u.tower_id && S.meta.towers.find((t) => t.id === u.tower_id)?.name, u.level_id && S.meta.levels.find((l) => l.id === u.level_id)?.name, u.zone_id && S.meta.zones.find((z) => z.id === u.zone_id)?.name].filter(Boolean).join(' › ')}</dd>
          <dt>Activity</dt><dd><button class="btn btn-ghost btn-sm" data-act="${u.activity_id}" style="padding:0;min-height:0">${u.activity_name}</button></dd>
          ${isQty ? html`<dt>Quantity today</dt><dd><b>${num(u.qty_today)} ${uom(u.uom)}</b></dd><dt>Approved before this</dt><dd>${num(r.approved)} ${uom(u.uom)}</dd><dt>Awaiting approval (others)</dt><dd>${num(r.pending_others)}</dd><dt>Cumulative if approved</dt><dd>${num(cumIfApproved)} of ${u.scope_qty ? num(u.scope_qty) : 'Not configured'} ${uom(u.uom)}</dd><dt>Progress after approval</dt><dd>${u.scope_qty ? ((cumIfApproved / u.scope_qty) * 100).toFixed(1) + '%' : NC}</dd>` : html`<dt>Milestones</dt><dd>${u.milestone_ids.length ? u.milestone_ids.length + ' reported' : '—'}</dd>`}
          <dt>Manpower</dt><dd>${u.manpower ?? '—'}</dd></dl></div>
        <div class="card"><h3>People</h3><dl class="kv mt-s"><dt>Engineer</dt><dd>${u.engineer || '—'}</dd><dt>Supervisor</dt><dd>${u.supervisor || '—'}</dd><dt>Subcontractor</dt><dd>${u.contractor || '—'}</dd>${u.location_note ? html`<dt>Location note</dt><dd>${u.location_note}</dd>` : ''}</dl>
          ${u.remarks ? html`<h4 class="mt">Remarks</h4><p class="small" style="white-space:pre-wrap;margin:4px 0">${u.remarks}</p>` : ''}${u.next_plan ? html`<h4 class="mt-s">Next planned</h4><p class="small" style="white-space:pre-wrap;margin:4px 0">${u.next_plan}</p>` : ''}</div>
      </div>
      ${r.photos.length ? html`<div class="card mb"><h3>Photos</h3><div class="thumbs mt-s">${r.photos.map((p, i) => html`<button class="thumb" data-ph="${i}">${p.is_demo ? html`<span class="demo">DEMO</span>` : ''}<img loading="lazy" src="${photoUrl(p.id)}" alt="${p.caption || 'Site photo'}"><span class="cap"><b>${p.caption || 'Site photo'}</b></span></button>`)}</div></div>` : ''}
      ${r.issues.length ? html`<div class="card mb"><h3>Issues raised in this update</h3>${r.issues.map((i) => html`<button class="li" data-iss="${i.id}"><span><b>${i.code}</b> ${i.title}<span class="sub">${i.owner || 'Unassigned'} · target ${dt(i.target_date)}</span></span><span class="row gap">${i.is_blocker ? html`<span class="pill p-bad">Blocker</span>` : ''}${prioPill(i.priority)}</span></button>`)}</div>` : ''}
      <details class="card"><summary class="bold" style="cursor:pointer">Audit trail (${r.audit.length})</summary>${table([{ h: 'When', first: true, r: (x) => dtime(x.ts) }, { h: 'Who', r: (x) => x.user_name }, { h: 'What', r: (x) => x.summary }], r.audit)}</details>`);
    const pm = S.user.role === 'pm';
    d.footer(html`
      ${pm && u.state === 'submitted' ? html`<button class="btn btn-danger" data-do="reject">Reject…</button><button class="btn btn-ok" data-do="approve">${icon('check')} Approve</button>` : ''}
      ${pm && u.state === 'approved' ? html`<button class="btn" data-do="reopen">Withdraw approval…</button>` : ''}
      ${r.can_edit ? html`${u.state === 'draft' ? html`<button class="btn btn-danger btn-sm" data-do="delete">Delete draft</button>` : ''}<button class="btn" data-do="edit">Edit</button><button class="btn btn-primary" data-do="submit">${icon('send')} Submit</button>` : ''}
      ${isStaff() && u.state === 'submitted' ? html`<button class="btn" data-do="recall">Recall to draft</button>` : ''}`);
    d.b.onclick = (e) => {
      const a = e.target.closest('[data-act]'); if (a) return showActivity(+a.dataset.act);
      const i = e.target.closest('[data-iss]'); if (i) return showIssue(+i.dataset.iss);
      const p = e.target.closest('[data-ph]'); if (p) lightbox(r.photos.map((x) => ({ ...x })), +p.dataset.ph);
    };
    d.f.onclick = async (e) => {
      const b = e.target.closest('[data-do]'); if (!b) return;
      const act = b.dataset.do;
      try {
        if (act === 'edit') { d.close(); return go(`/updates/${id}`); }
        if (act === 'approve') { const c = await confirmBox({ title: 'Approve update', message: `Approve ${num(u.qty_today)} ${uom(u.uom)} for "${u.activity_name}" (${dt(u.report_date)})? It will count towards progress.`, confirm: 'Approve', tone: 'ok', reason: { label: 'Note (optional)' } }); if (!c) return; await api(`/api/updates/${id}/approve`, { method: 'POST', body: { note: c.reason } }); toast('Approved', 'ok'); }
        if (act === 'reject') { const c = await confirmBox({ title: 'Reject update', message: 'The site team will see your reason and can correct and resubmit.', confirm: 'Reject', danger: true, reason: { label: 'Reason', required: true, placeholder: 'What needs to be corrected?' } }); if (!c) return; await api(`/api/updates/${id}/reject`, { method: 'POST', body: { note: c.reason } }); toast('Rejected'); }
        if (act === 'reopen') { const c = await confirmBox({ title: 'Withdraw approval', message: 'The update returns to Submitted and its quantity is removed from progress until approved again.', confirm: 'Withdraw', danger: true, reason: { label: 'Reason', required: true } }); if (!c) return; await api(`/api/updates/${id}/reopen`, { method: 'POST', body: { note: c.reason } }); toast('Approval withdrawn'); }
        if (act === 'submit') { const r2 = await api(`/api/updates/${id}/submit`, { method: 'POST' }); toast('Submitted for approval', 'ok'); r2.warnings?.forEach((w) => toast(w)); }
        if (act === 'recall') { await api(`/api/updates/${id}/recall`, { method: 'POST' }); toast('Recalled to draft'); }
        if (act === 'delete') { const c = await confirmBox({ title: 'Delete draft', message: 'Delete this draft update and its photos?', confirm: 'Delete', danger: true }); if (!c) return; await api(`/api/updates/${id}`, { method: 'DELETE' }); toast('Draft deleted'); d.close(); return changed(); }
        changed(); await load();
      } catch (er) {
        if (er.fields) { toast('Cannot submit: ' + Object.values(er.fields).flat().filter((x) => typeof x === 'string').join(' · ') || er.message, 'bad'); go(`/updates/${id}`); d.close(); } else toast(errText(er), 'bad');
      }
    };
  };
  try { await load(); } catch (e) { d.body(html`<div class="banner bad">${errText(e)}</div>`); }
}

// generic list of updates (from chart clicks, approvals etc.)
export async function showUpdates(title, params) {
  const d = drawer({ title, wide: true, body: loading(3) });
  try {
    const r = await api('/api/updates' + qs({ limit: 300, ...params }));
    d.body(html`<div class="card">${table(updateCols(), r.rows, { rowAttrs: (u) => `class="clk" data-upd="${u.id}"`, empty: 'No updates in this period.' })}</div>`);
    d.b.addEventListener('click', (e) => { const t = e.target.closest('[data-upd]'); if (t) showUpdate(+t.dataset.upd); });
  } catch (e) { d.body(html`<div class="banner bad">${errText(e)}</div>`); }
}
export const updateCols = () => [
  { h: 'Date', first: true, r: (u) => dt(u.report_date) },
  { h: 'Activity', r: (u) => html`<b>${u.activity}</b><span class="sub">${[u.tower, u.level, u.zone].filter(Boolean).join(' › ')} · ${u.trade}</span>` },
  { h: 'Qty', num: true, r: (u) => (u.method === 'quantity' ? html`${num(u.qty_today)} ${uom(u.uom)}${u.over_scope ? html`<span class="sub var-neg">Exceeds scope</span>` : ''}` : 'Milestone') },
  { h: 'Cumulative', num: true, r: (u) => (u.method === 'quantity' ? html`${num(u.cum_approved)}<span class="sub">${u.scope_qty ? ((u.cum_approved / u.scope_qty) * 100).toFixed(0) + '% of scope' : 'scope n/c'}</span>` : '—') },
  { h: 'Manpower', num: true, r: (u) => u.manpower ?? '—' },
  { h: 'State', r: (u) => statePill(u.state) },
  { h: 'By', r: (u) => u.author || '—' },
];

// ------------------------------------------------------------ issues
export async function showIssue(id) {
  const d = drawer({ title: 'Issue', wide: true, body: loading(3) });
  const load = async () => {
    const r = await api('/api/issues/' + id);
    const i = r.issue;
    d.title(`${i.code} · ${i.title}`);
    const mgmt = isMgmt(), open = ['open', 'in_progress'].includes(i.status);
    d.body(html`
      <div class="row wrap gap mb">${prioPill(i.priority)}${issueStatusPill(i.status)}${i.is_blocker ? html`<span class="pill p-bad">${icon('warn')}Blocker</span>` : ''}${i.needs_decision ? html`<span class="pill p-at_risk">Decision required</span>` : ''}${i.overdue ? html`<span class="pill p-delayed">Overdue ${diffDays(todayStr(), i.target_date)} days</span>` : ''}</div>
      <div class="grid g2 mb">
        <div class="card"><h3>Details</h3><dl class="kv mt-s"><dt>Location</dt><dd>${[i.tower, i.level, i.zone].filter(Boolean).join(' › ')}</dd><dt>Trade</dt><dd>${i.trade || '—'}</dd>
          <dt>Affected activity</dt><dd>${i.activity_id ? html`<button class="btn btn-ghost btn-sm" data-act="${i.activity_id}" style="padding:0;min-height:0">${i.activity}</button>` : '—'}</dd>
          <dt>Responsible</dt><dd><b>${i.owner || 'Unassigned'}</b></dd><dt>Raised</dt><dd>${dt(i.raised_date)} by ${i.raised_by_name || '—'}</dd><dt>Target date</dt><dd class="${i.overdue ? 'var-neg' : ''}">${dt(i.target_date)}</dd>${i.resolved_date ? html`<dt>Resolved</dt><dd>${dt(i.resolved_date)}</dd>` : ''}</dl></div>
        <div class="card"><h3>Description</h3><p class="small" style="white-space:pre-wrap">${i.description || '—'}</p><h4>Required action</h4><p class="small" style="white-space:pre-wrap;margin:4px 0">${i.required_action || '—'}</p>${i.resolution_note ? html`<h4 class="mt-s">Resolution</h4><p class="small" style="white-space:pre-wrap;margin:4px 0">${i.resolution_note}</p>` : ''}</div>
      </div>
      <div class="card mb"><div class="card-h"><h3>Photos &amp; evidence</h3><label class="btn btn-sm">${icon('camera')} Add photo<input type="file" accept="image/*" multiple hidden id="iph"></label></div>
        ${r.photos.length ? html`<div class="thumbs mt-s">${r.photos.map((p, k) => html`<button class="thumb" data-ph="${k}">${p.is_demo ? html`<span class="demo">DEMO</span>` : ''}<img loading="lazy" src="${photoUrl(p.id)}" alt="${p.caption || 'Issue photo'}"><span class="cap"><b>${p.kind === 'resolution' ? 'Resolution evidence' : p.caption || 'Issue photo'}</b>${dt(p.taken_date)}</span></button>`)}</div>` : html`<div class="empty small">No photos yet.</div>`}</div>
      <div class="card mb"><h3>Comments</h3><div class="list mt-s">${r.comments.length ? r.comments.map((c) => html`<div><b>${c.user_name || 'User'}</b> <span class="muted xs">${dtime(c.created_at)}</span><div class="small" style="white-space:pre-wrap">${c.body}</div></div>`) : html`<div class="muted small">No comments yet.</div>`}</div>
        <div class="row gap mt"><input id="cmt" placeholder="Add a comment…" aria-label="Comment"><button class="btn btn-primary" id="cmt-go">Post</button></div></div>
      <details class="card"><summary class="bold" style="cursor:pointer">History (${r.audit.length})</summary>${table([{ h: 'When', first: true, r: (x) => dtime(x.ts) }, { h: 'Who', r: (x) => x.user_name }, { h: 'What', r: (x) => x.summary }], r.audit)}</details>`);
    d.footer(html`${open || mgmt ? html`<button class="btn" data-st="edit">Edit</button>` : ''}
      ${i.status === 'open' ? html`<button class="btn" data-st="in_progress">Start work</button>` : ''}${open ? html`<button class="btn btn-ok" data-st="resolved">${icon('check')} Mark resolved…</button>` : ''}
      ${mgmt && i.status === 'resolved' ? html`<button class="btn btn-primary" data-st="closed">Close issue</button>` : ''}${(i.status === 'resolved' || i.status === 'closed') ? html`<button class="btn" data-st="open">Re-open…</button>` : ''}`);
    d.b.onclick = (e) => {
      const a = e.target.closest('[data-act]'); if (a) return showActivity(+a.dataset.act);
      const p = e.target.closest('[data-ph]'); if (p) lightbox(r.photos.map((x) => ({ ...x, tower: i.tower, level: i.level, trade: i.trade })), +p.dataset.ph);
    };
    d.$('#cmt-go').onclick = async () => { const b = d.$('#cmt').value.trim(); if (!b) return; try { await api(`/api/issues/${id}/comments`, { method: 'POST', body: { body: b } }); await load(); } catch (er) { toast(errText(er), 'bad'); } };
    d.$('#iph').onchange = async (e) => {
      try { for (const f of e.target.files) await uploadPhoto(f, { issue_id: id, kind: i.status === 'resolved' || i.status === 'closed' ? 'resolution' : undefined, caption: '' }); toast('Photo added', 'ok'); await load(); } catch (er) { toast(errText(er), 'bad'); }
    };
    d.f.onclick = async (e) => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      const st = b.dataset.st;
      try {
        if (st === 'edit') { const ok = await openIssueForm({ issue: i }); if (ok) { changed(); await load(); } return; }
        let note = '';
        if (st === 'resolved') { const c = await confirmBox({ title: 'Mark resolved', message: 'Describe what was done. Add a photo as evidence first if you can (use "Add photo" above).', confirm: 'Mark resolved', tone: 'ok', reason: { label: 'How was it resolved?', required: true } }); if (!c) return; note = c.reason; }
        if (st === 'closed') { const c = await confirmBox({ title: 'Close issue', message: 'Confirm the resolution is verified and close this issue.', confirm: 'Close issue', reason: { label: 'Closing note (optional)' } }); if (!c) return; note = c.reason; }
        if (st === 'open') { const c = await confirmBox({ title: 'Re-open issue', message: 'This returns the issue to Open.', confirm: 'Re-open', reason: { label: 'Reason', required: true } }); if (!c) return; note = c.reason; }
        await api(`/api/issues/${id}/status`, { method: 'POST', body: { status: st, note } });
        toast('Issue updated', 'ok'); changed(); await load();
      } catch (er) { toast(errText(er), 'bad'); }
    };
  };
  try { await load(); } catch (e) { d.body(html`<div class="banner bad">${errText(e)}</div>`); }
}

// create / edit an issue. Resolves true if saved.
export function openIssueForm({ issue, activity, defaults = {} } = {}) {
  return new Promise(async (resolve) => {
    const M = S.meta;
    const st = { title: '', description: '', required_action: '', priority: 'medium', is_blocker: 0, needs_decision: 0, owner_id: null, target_date: addDays(todayStr(), 7), tower_id: null, level_id: null, trade_id: null, activity_id: null, ...defaults, ...(issue || {}) };
    let acts = [];
    if (!issue) { try { acts = await getActs(); } catch { /* ignore */ } }
    if (activity) { Object.assign(st, { activity_id: activity.id, tower_id: activity.tower_id, level_id: activity.level_id, trade_id: activity.trade_id }); }
    let errs = {}, done = false;
    const m = modal({ title: issue ? `Edit ${issue.code}` : 'Report an issue', wide: true, onClose: () => { if (!done) resolve(false); }, body: '' });
    const owners = M.users.filter((u) => u.active !== 0);
    const draw = () => {
      const tower = M.towers.find((t) => t.id === +st.tower_id), level = M.levels.find((l) => l.id === +st.level_id), trade = M.trades.find((t) => t.id === +st.trade_id), act = acts.find((a) => a.id === +st.activity_id);
      m.body(html`
        ${issue ? '' : html`<div class="grid3">${field('Tower *', selBtn('tower', 'Tower', act?.tower || tower?.name, { disabled: !!act }), { err: errs.tower_id })}${field('Floor', selBtn('level', 'Floor', act?.level || level?.name, { disabled: !!act || !tower }))}${field('Trade', selBtn('trade', 'Trade', act?.trade || trade?.name, { disabled: !!act }))}</div>
          ${field('Affected activity (optional)', selBtn('activity', 'Activity', act ? `${act.name} — ${where(act)}` : '', { ph: 'Choose the activity affected…' }))}`}
        ${field('What is the issue? *', html`<input id="f-title" value="${st.title}" maxlength="200" placeholder="Short description">`, { err: errs.title, id: 'f-title' })}
        ${field('More detail', html`<textarea id="f-desc">${st.description || ''}</textarea>`)}
        <div class="field"><label>Priority</label><div class="seg">${['low', 'medium', 'high', 'critical'].map((p) => html`<button type="button" data-prio="${p}" aria-pressed="${st.priority === p}">${p[0].toUpperCase() + p.slice(1)}</button>`)}</div></div>
        <div class="row gap wrap mb"><label class="row gap"><input type="checkbox" id="f-block" ${raw(st.is_blocker ? 'checked' : '')}> <span><b>Blocker</b> — stops work</span></label><label class="row gap"><input type="checkbox" id="f-dec" ${raw(st.needs_decision ? 'checked' : '')}> <span>Needs a decision from the PM</span></label></div>
        ${field('Required action', html`<textarea id="f-act" rows="2">${st.required_action || ''}</textarea>`)}
        <div class="grid2">${field('Action owner *', selBtn('owner', 'Action owner', owners.find((u) => u.id === +st.owner_id)?.name), { err: errs.owner_id })}${field('Target resolution date *', html`<input type="date" id="f-date" value="${st.target_date || ''}">`, { err: errs.target_date, id: 'f-date' })}</div>`);
      m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="f-save">${issue ? 'Save changes' : 'Raise issue'}</button>`);
    };
    const sync = () => { const g = (s) => m.$(s); if (g('#f-title')) { st.title = g('#f-title').value; st.description = g('#f-desc').value; st.required_action = g('#f-act').value; st.is_blocker = g('#f-block').checked ? 1 : 0; st.needs_decision = g('#f-dec').checked ? 1 : 0; st.target_date = g('#f-date').value; } };
    draw();
    m.el.addEventListener('click', async (e) => {
      const pr = e.target.closest('[data-prio]'); if (pr) { sync(); st.priority = pr.dataset.prio; return draw(); }
      const pk = e.target.closest('[data-pick]');
      if (pk) {
        sync();
        const w = pk.dataset.pick;
        const opts = { tower: () => M.towers.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name })), level: () => M.levels.filter((l) => l.tower_id === +st.tower_id).map((l) => ({ value: l.id, label: l.name })).reverse(), trade: () => M.trades.map((t) => ({ value: t.id, label: t.name })), owner: () => owners.map((u) => ({ value: u.id, label: u.name, sub: u.company })), activity: () => acts.filter((a) => (!st.tower_id || a.tower_id === +st.tower_id) && (!st.level_id || a.level_id === +st.level_id) && (!st.trade_id || a.trade_id === +st.trade_id)).slice(0, 600).map((a) => ({ value: a.id, label: a.name, sub: `${where(a)} · ${a.trade}` })) }[w]();
        const r = await pickOne({ title: { tower: 'Tower', level: 'Floor', trade: 'Trade', owner: 'Action owner', activity: 'Affected activity' }[w], options: opts, value: { tower: st.tower_id, level: st.level_id, trade: st.trade_id, owner: st.owner_id, activity: st.activity_id }[w], clearLabel: w === 'owner' || w === 'tower' ? null : 'None', searchable: true });
        if (!r) return;
        if (w === 'tower') Object.assign(st, { tower_id: r.value, level_id: null, activity_id: null });
        else if (w === 'level') Object.assign(st, { level_id: r.value, activity_id: null });
        else if (w === 'trade') Object.assign(st, { trade_id: r.value, activity_id: null });
        else if (w === 'owner') st.owner_id = r.value;
        else if (w === 'activity') { const a = acts.find((x) => x.id === +r.value); Object.assign(st, { activity_id: r.value, tower_id: a?.tower_id ?? st.tower_id, level_id: a?.level_id ?? null, trade_id: a?.trade_id ?? null }); }
        return draw();
      }
      if (e.target.closest('#f-save')) {
        sync(); errs = {};
        const body = { title: st.title, description: st.description, required_action: st.required_action, priority: st.priority, is_blocker: st.is_blocker, needs_decision: st.needs_decision, owner_id: st.owner_id, target_date: st.target_date };
        if (!issue) Object.assign(body, st.activity_id ? { activity_id: st.activity_id } : { tower_id: st.tower_id, level_id: st.level_id, trade_id: st.trade_id });
        try {
          await api(issue ? `/api/issues/${issue.id}` : '/api/issues', { method: issue ? 'PUT' : 'POST', body });
          done = true; m.close(); toast(issue ? 'Issue updated' : 'Issue raised', 'ok'); changed(); resolve(true);
        } catch (er) { errs = er.fields || {}; draw(); if (!er.fields) toast(errText(er), 'bad'); else m.b.scrollTop = 0; }
      }
    });
  });
}
