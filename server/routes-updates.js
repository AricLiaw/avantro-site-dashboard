// Daily progress updates: draft -> submitted -> approved / rejected. Only APPROVED quantities count as progress.
import fs from 'node:fs';
import path from 'node:path';
import { get, post, put, del, ALL, STAFF, MGMT } from './router.js';
import { q, q1, insert, update as dbUpdate, run, tx, audit, getSettings, now, UPLOAD_DIR } from './db.js';
import { snapshot, pubAct } from './calc.js';
import { today, addDays, isDate, num, str, int01, HttpError, bad, forbidden, notFound } from './util.js';
import { canSee } from './routes-dashboard.js';

const STATUSES = ['not_started', 'in_progress', 'completed', 'on_hold'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const EPS = 1e-6;

const getAct = (id) => q1('SELECT * FROM activities WHERE id=? AND active=1', +id);
const canEditAct = (user, a) => STAFF.includes(user.role) && (a.engineer_id === user.id || a.supervisor_id === user.id);

function amounts(actId, exceptId = 0) {
  const approved = q1("SELECT COALESCE(SUM(qty_today),0) s FROM updates WHERE activity_id=? AND state='approved' AND id<>?", actId, exceptId).s;
  const pending = q1("SELECT COALESCE(SUM(qty_today),0) s FROM updates WHERE activity_id=? AND state='submitted' AND id<>?", actId, exceptId).s;
  return { approved, pending };
}
const msIds = (u) => { try { return JSON.parse(u.milestone_ids || '[]'); } catch { return []; } };

// Re-derive status / actual dates of an activity from its approved updates (used after approve / reopen / reject).
export function recomputeActivity(actId) {
  const a = q1('SELECT * FROM activities WHERE id=?', actId);
  if (!a) return;
  const ups = q("SELECT * FROM updates WHERE activity_id=? AND state='approved' ORDER BY report_date, id", actId);
  let cum = 0, start = null, finish = null, pct = null;
  if (a.method === 'milestone') {
    const ms = q('SELECT * FROM activity_milestones WHERE activity_id=?', actId);
    const tot = ms.reduce((s, m) => s + m.weight, 0);
    const done = ms.filter((m) => m.achieved_date);
    pct = tot > 0 ? (done.reduce((s, m) => s + m.weight, 0) / tot) * 100 : null;
    start = done.map((m) => m.achieved_date).sort()[0] || null;
    if (tot > 0 && done.length === ms.length) finish = done.map((m) => m.achieved_date).sort().pop();
  } else {
    for (const u of ups) {
      cum += u.qty_today;
      if (!start && u.qty_today > 0) start = u.report_date;
      if (!finish && a.scope_qty > 0 && cum >= a.scope_qty - EPS) finish = u.report_date;
    }
    pct = a.scope_qty > 0 ? Math.min(100, (cum / a.scope_qty) * 100) : null;
  }
  const last = ups[ups.length - 1];
  let status = 'not_started';
  if (pct != null && pct >= 99.99) status = 'completed';
  else if (last?.status === 'on_hold') status = 'on_hold';
  else if ((pct ?? 0) > 0 || last?.status === 'in_progress' || (last && last.qty_today > 0)) status = 'in_progress';
  dbUpdate('activities', actId, {
    status, actual_start: start, actual_finish: status === 'completed' ? finish : null,
    status_note: status === 'on_hold' ? last.remarks || last.next_plan || 'On hold' : null,
  });
}

function loadFull(id) {
  return q1(`SELECT u.*, a.name activity_name, a.tower_id, a.level_id, a.zone_id, a.trade_id, a.method, a.scope_qty, a.category,
      us.name author, rv.name reviewer, en.name engineer, su.name supervisor
    FROM updates u JOIN activities a ON a.id=u.activity_id LEFT JOIN users us ON us.id=u.author_id LEFT JOIN users rv ON rv.id=u.review_by
    LEFT JOIN users en ON en.id=u.engineer_id LEFT JOIN users su ON su.id=u.supervisor_id WHERE u.id=?`, id);
}

// ---------------------------------------------------------------- save / submit
export function saveUpdate(user, p, action) {
  const a = getAct(p.activity_id);
  if (!a) throw bad('Choose a work activity');
  if (!canEditAct(user, a)) throw forbidden('You are not assigned to this activity');
  const S = getSettings();
  const errors = {};
  const T = today();
  if (a.status === 'completed' && !p.id) throw new HttpError(409, 'This activity is already completed. No further updates are needed (ask the Project Manager to withdraw an approval if it was a mistake).');
  const date = p.report_date;
  if (!isDate(date)) errors.report_date = 'Choose a date';
  else if (date > T) errors.report_date = 'Date cannot be in the future';
  else if (date < addDays(T, -S.backdate_days)) errors.report_date = `Updates can only be dated up to ${S.backdate_days} days back. Ask the Project Manager.`;

  let cur = null;
  if (p.id) {
    cur = q1('SELECT * FROM updates WHERE id=?', +p.id);
    if (!cur || cur.activity_id !== a.id) throw notFound('Update not found');
    if (!(cur.author_id === user.id || canEditAct(user, a))) throw forbidden();
    if (!['draft', 'rejected'].includes(cur.state)) throw new HttpError(409, `This update is ${cur.state} and cannot be edited${cur.state === 'submitted' ? ' (recall it first)' : ''}`);
  }
  if (isDate(date)) {
    const dup = q1('SELECT id,state FROM updates WHERE activity_id=? AND report_date=?', a.id, date);
    if (dup && (!cur || dup.id !== cur.id)) throw new HttpError(409, `An update for this activity on ${date} already exists (${dup.state}).`, { existing_id: dup.id });
  }

  let qty = 0;
  let mids = [];
  const { approved, pending } = amounts(a.id, cur?.id || 0);
  if (a.method === 'quantity') {
    qty = num(p.qty_today) ?? 0;
    if (Number.isNaN(qty)) errors.qty_today = 'Enter a number';
    else if (qty < 0) errors.qty_today = 'Quantity cannot be negative';
    qty = Math.round(qty * 1000) / 1000;
  } else {
    const ms = q('SELECT * FROM activity_milestones WHERE activity_id=?', a.id);
    const other = new Set(q("SELECT milestone_ids FROM updates WHERE activity_id=? AND state='submitted' AND id<>?", a.id, cur?.id || 0).flatMap(msIds));
    mids = [...new Set((Array.isArray(p.milestone_ids) ? p.milestone_ids : []).map(Number))];
    for (const id of mids) {
      const m = ms.find((x) => x.id === id);
      if (!m) errors.milestone_ids = 'Unknown milestone';
      else if (m.achieved_date) errors.milestone_ids = `"${m.name}" is already approved as achieved`;
      else if (other.has(id)) errors.milestone_ids = `"${m.name}" is already in a submitted update`;
    }
  }
  const projected = approved + pending + qty;
  const over = a.method === 'quantity' && a.scope_qty > 0 && projected > a.scope_qty + EPS ? 1 : 0;

  const manpower = num(p.manpower);
  if (Number.isNaN(manpower) || (manpower != null && (manpower < 0 || manpower > 5000 || !Number.isInteger(manpower)))) errors.manpower = 'Enter a whole number of workers';
  let status = p.status || null;
  if (status && !STATUSES.includes(status)) errors.status = 'Invalid status';
  const checkUser = (id, roles, field) => {
    if (id == null || id === '') return null;
    const u = q1('SELECT id,role FROM users WHERE id=? AND active=1', +id);
    if (!u || !roles.includes(u.role)) errors[field] = 'Choose a valid person';
    return u ? u.id : null;
  };
  const engineer_id = checkUser(p.engineer_id ?? a.engineer_id, ['engineer', 'supervisor'], 'engineer_id');
  const supervisor_id = checkUser(p.supervisor_id ?? a.supervisor_id, ['engineer', 'supervisor'], 'supervisor_id');
  const remarks = str(p.remarks, 3000);

  if (action === 'submit') {
    if (a.method === 'quantity' && !(a.scope_qty > 0)) errors.qty_today = 'Scope quantity is not configured for this activity. Ask the Administrator.';
    if (a.method === 'milestone' && !q1('SELECT 1 x FROM activity_milestones WHERE activity_id=?', a.id)) errors.milestone_ids = 'Milestones are not configured for this activity.';
    if (!status) errors.status = 'Choose the activity status';
    if (manpower == null) errors.manpower = 'Enter manpower on site (0 if none)';
    if (!engineer_id && !supervisor_id) errors.engineer_id = 'Choose the responsible engineer or supervisor';
    if (!(qty > 0) && !mids.length && status !== 'on_hold' && !remarks) errors.remarks = 'No quantity reported: add a remark explaining why (or set status On Hold)';
    if (over) errors.qty_today = `Exceeds scope: ${fmt(projected)} > ${fmt(a.scope_qty)} ${a.uom || ''}. Check the quantity (approved ${fmt(approved)}${pending ? `, awaiting approval ${fmt(pending)}` : ''}).`;
    if (status === 'completed') {
      const ok = a.method === 'quantity' ? a.scope_qty > 0 && projected >= a.scope_qty - EPS
        : q('SELECT id,achieved_date FROM activity_milestones WHERE activity_id=?', a.id).every((m) => m.achieved_date || mids.includes(m.id));
      if (!ok) errors.status = 'Cannot mark Completed: quantity/milestones are not yet 100%';
    }
    if (status === 'not_started' && (qty > 0 || mids.length)) errors.status = 'Work was reported, so the status cannot be Not Started';
  }

  // issues to raise from this update
  const issues = Array.isArray(p.issues) ? p.issues : null;
  const issueErrs = [];
  if (issues) issues.forEach((i, idx) => {
    const e = {};
    if (!str(i.title, 200) || str(i.title, 200).length < 3) e.title = 'Describe the issue';
    if (i.priority && !PRIORITIES.includes(i.priority)) e.priority = 'Invalid priority';
    if (i.target_date && !isDate(i.target_date)) e.target_date = 'Invalid date';
    if (action === 'submit') {
      if (!i.owner_id) e.owner_id = 'Choose an action owner';
      if (!i.target_date) e.target_date = 'Set a target resolution date';
    }
    if (Object.keys(e).length) issueErrs[idx] = e;
  });
  if (issueErrs.some(Boolean)) errors.issues = issueErrs;
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', { fields: errors });

  const warnings = [];
  if (over) warnings.push(`Quantity exceeds scope (${fmt(projected)} of ${fmt(a.scope_qty)} ${a.uom || ''}).`);
  const prev = q1("SELECT qty_today FROM updates WHERE activity_id=? AND report_date<? AND id<>? AND state<>'rejected' ORDER BY report_date DESC LIMIT 1", a.id, date, cur?.id || 0);
  if (qty > 0 && prev && prev.qty_today === qty) warnings.push('Same quantity as the previous entry - please confirm it is not a copy.');

  const row = {
    activity_id: a.id, report_date: date, engineer_id, supervisor_id,
    contractor: str(p.contractor, 200) ?? a.contractor, location_note: str(p.location_note, 300),
    qty_today: qty, planned_qty: a.scope_qty, uom: a.uom, manpower, status,
    milestone_ids: mids.length ? JSON.stringify(mids) : null, remarks, next_plan: str(p.next_plan, 2000),
    over_scope: over, updated_at: now(),
  };
  return tx(() => {
    let id;
    if (cur) {
      id = cur.id;
      dbUpdate('updates', id, { ...row, state: action === 'submit' ? 'submitted' : 'draft', submitted_at: action === 'submit' ? now() : null });
      audit(user, action === 'submit' ? 'submit' : 'edit', 'update', id, `${action === 'submit' ? 'Submitted' : 'Saved draft of'} update: ${a.name} (${date}), qty ${qty}`,
        { before: { qty: cur.qty_today, status: cur.status, manpower: cur.manpower, state: cur.state }, after: { qty, status, manpower } });
    } else {
      id = insert('updates', { ...row, author_id: user.id, state: action === 'submit' ? 'submitted' : 'draft', submitted_at: action === 'submit' ? now() : null, created_at: now() });
      audit(user, action === 'submit' ? 'submit' : 'create', 'update', id, `${action === 'submit' ? 'Created and submitted' : 'Created draft'} update: ${a.name} (${date}), qty ${qty}`, { qty, status, manpower });
    }
    syncPhotos(user, id, a, date, p.photos);
    if (issues) syncIssues(user, id, a, date, issues);
    return { update: loadFull(id), warnings };
  });
}
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US');

function syncPhotos(user, updateId, a, date, list) {
  if (!Array.isArray(list)) return;
  const keep = new Set();
  for (const ph of list) {
    const row = q1('SELECT * FROM photos WHERE id=?', +ph.id);
    if (!row || row.uploader_id !== user.id || (row.update_id && row.update_id !== updateId)) continue;
    keep.add(row.id);
    dbUpdate('photos', row.id, {
      update_id: updateId, activity_id: a.id, tower_id: a.tower_id, level_id: a.level_id, zone_id: a.zone_id, trade_id: a.trade_id,
      taken_date: date, kind: 'progress', caption: str(ph.caption, 300),
    });
  }
  for (const old of q('SELECT * FROM photos WHERE update_id=?', updateId)) if (!keep.has(old.id)) removePhoto(old);
}
export function removePhoto(row) {
  run('DELETE FROM photos WHERE id=?', row.id);
  if (!q1('SELECT 1 x FROM photos WHERE file=?', row.file)) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, row.file)); } catch { /* already gone */ }
  }
}

function syncIssues(user, updateId, a, date, list) {
  const keep = new Set();
  for (const i of list) {
    const f = {
      title: str(i.title, 200), description: str(i.description), required_action: str(i.required_action),
      priority: PRIORITIES.includes(i.priority) ? i.priority : 'medium', owner_id: i.owner_id ? +i.owner_id : null,
      target_date: i.target_date || null, is_blocker: int01(i.is_blocker), needs_decision: int01(i.needs_decision), updated_at: now(),
    };
    const ex = i.id ? q1('SELECT * FROM issues WHERE id=? AND update_id=?', +i.id, updateId) : null;
    if (ex) {
      keep.add(ex.id);
      if (ex.status === 'open') dbUpdate('issues', ex.id, f);
    } else {
      const id = insert('issues', { ...f, tower_id: a.tower_id, level_id: a.level_id, zone_id: a.zone_id, trade_id: a.trade_id, activity_id: a.id, status: 'open', raised_by: user.id, raised_date: date, update_id: updateId, created_at: now() });
      run('UPDATE issues SET code=? WHERE id=?', 'ISS-' + String(id).padStart(4, '0'), id);
      keep.add(id);
      audit(user, 'create', 'issue', id, `Raised issue from daily update: ${f.title}`);
    }
  }
  for (const old of q("SELECT id FROM issues WHERE update_id=? AND status='open' AND raised_by=?", updateId, user.id)) {
    if (!keep.has(old.id) && !q1('SELECT 1 x FROM issue_comments WHERE issue_id=?', old.id)) run('DELETE FROM issues WHERE id=?', old.id);
  }
}

// ---------------------------------------------------------------- review
export function review(user, id, action, note) {
  return tx(() => {
    const u = q1('SELECT * FROM updates WHERE id=?', id);
    if (!u) throw notFound('Update not found');
    const a = q1('SELECT * FROM activities WHERE id=?', u.activity_id);
    if (action === 'approve') {
      if (u.state !== 'submitted') throw new HttpError(409, `Only submitted updates can be approved (this one is ${u.state})`);
      const { approved } = amounts(a.id, u.id);
      if (a.method === 'quantity') {
        if (!(a.scope_qty > 0)) throw new HttpError(409, 'Scope quantity is not configured. Configure it before approving.');
        if (approved + u.qty_today > a.scope_qty + EPS) throw new HttpError(409, `Approving would exceed scope (${fmt(approved + u.qty_today)} > ${fmt(a.scope_qty)} ${a.uom || ''}). Reject the update, or revise the scope first (audited).`);
      } else {
        for (const mid of msIds(u)) {
          const m = q1('SELECT * FROM activity_milestones WHERE id=? AND activity_id=?', mid, a.id);
          if (!m || m.achieved_date) throw new HttpError(409, 'A milestone in this update is already achieved or no longer exists');
        }
      }
      dbUpdate('updates', u.id, { state: 'approved', review_by: user.id, review_at: now(), review_note: str(note) });
      for (const mid of msIds(u)) run('UPDATE activity_milestones SET achieved_date=?, achieved_update_id=? WHERE id=? AND achieved_date IS NULL', u.report_date, u.id, mid);
      recomputeActivity(a.id);
      audit(user, 'approve', 'update', u.id, `Approved update: ${a.name} (${u.report_date}), qty ${u.qty_today}`, { note });
    } else if (action === 'reject') {
      if (!str(note)) throw bad('Give a reason for rejecting so the site team can correct it');
      if (u.state !== 'submitted') throw new HttpError(409, `Only submitted updates can be rejected (this one is ${u.state})`);
      dbUpdate('updates', u.id, { state: 'rejected', review_by: user.id, review_at: now(), review_note: str(note) });
      audit(user, 'reject', 'update', u.id, `Rejected update: ${a.name} (${u.report_date}) - ${str(note)}`, { note });
    } else if (action === 'reopen') {
      if (u.state !== 'approved') throw new HttpError(409, 'Only approved updates can be re-opened');
      if (!str(note)) throw bad('Give a reason for withdrawing the approval');
      run('UPDATE activity_milestones SET achieved_date=NULL, achieved_update_id=NULL WHERE achieved_update_id=?', u.id);
      dbUpdate('updates', u.id, { state: 'submitted', review_by: user.id, review_at: now(), review_note: 'Approval withdrawn: ' + str(note) });
      recomputeActivity(a.id);
      audit(user, 'reopen', 'update', u.id, `Withdrew approval: ${a.name} (${u.report_date}) - ${str(note)}`, { note });
    }
    return loadFull(u.id);
  });
}

// ---------------------------------------------------------------- routes
function visibleUpdate(user, u) {
  if (!u) return false;
  if (MGMT.includes(user.role)) return true;
  const a = q1('SELECT engineer_id,supervisor_id FROM activities WHERE id=?', u.activity_id);
  return !!a && canSee(user, a);
}

get('/api/updates/context', { roles: STAFF }, ({ user, query }) => {
  const snap = snapshot();
  const r = snap.byId.get(+query.activity_id);
  if (!r || !canEditAct(user, r.a)) throw notFound('Activity not found');
  const date = isDate(query.date) ? query.date : today();
  const cols = 'id,report_date,state,qty_today,manpower,status,engineer_id,supervisor_id,contractor,location_note,remarks,next_plan,milestone_ids';
  return {
    activity: pubAct(r, snap.M),
    milestones: r.ms.map((m) => ({ id: m.id, name: m.name, weight: m.weight, achieved_date: m.achieved_date })),
    approved: r.approvedQty, pending: r.pendingQty,
    planned_to_date_qty: r.a.scope_qty > 0 && r.planned != null ? (r.a.scope_qty * r.planned) / 100 : null,
    existing: q1(`SELECT ${cols} FROM updates WHERE activity_id=? AND report_date=?`, r.id, date),
    previous: q1(`SELECT ${cols} FROM updates WHERE activity_id=? AND report_date<? AND state<>'rejected' ORDER BY report_date DESC LIMIT 1`, r.id, date),
  };
});

get('/api/updates', { roles: ALL }, ({ user, query }) => {
  const w = ['1=1'];
  const p = [];
  if (STAFF.includes(user.role)) { w.push('(a.engineer_id=? OR a.supervisor_id=?)'); p.push(user.id, user.id); }
  if (query.state) { w.push(`u.state IN (${query.state.split(',').map(() => '?').join(',')})`); p.push(...query.state.split(',')); }
  if (query.mine === '1') { w.push('u.author_id=?'); p.push(user.id); }
  if (query.activity_id) { w.push('u.activity_id=?'); p.push(+query.activity_id); }
  for (const k of ['tower', 'trade']) if (query[k]) { w.push(`a.${k}_id=?`); p.push(+query[k]); }
  if (query.level_id) { w.push('a.level_id=?'); p.push(+query.level_id); }
  if (query.person) { w.push('(a.engineer_id=? OR a.supervisor_id=? OR u.author_id=?)'); p.push(+query.person, +query.person, +query.person); }
  if (isDate(query.from)) { w.push('u.report_date>=?'); p.push(query.from); }
  if (isDate(query.to)) { w.push('u.report_date<=?'); p.push(query.to); }
  if (isDate(query.date)) { w.push('u.report_date=?'); p.push(query.date); }
  if (query.over_scope === '1') w.push('u.over_scope=1');
  if (query.q) { w.push('(a.name LIKE ? OR a.category LIKE ?)'); p.push(`%${query.q}%`, `%${query.q}%`); }
  const limit = Math.min(+query.limit || 100, 500);
  const from = `FROM updates u JOIN activities a ON a.id=u.activity_id JOIN towers t ON t.id=a.tower_id LEFT JOIN levels l ON l.id=a.level_id
    LEFT JOIN zones z ON z.id=a.zone_id JOIN trades tr ON tr.id=a.trade_id LEFT JOIN users us ON us.id=u.author_id LEFT JOIN users en ON en.id=u.engineer_id
    LEFT JOIN users su ON su.id=u.supervisor_id WHERE ${w.join(' AND ')}`;
  const total = q1(`SELECT COUNT(*) n ${from}`, ...p).n;
  const rows = q(`SELECT u.id,u.activity_id,u.report_date,u.state,u.qty_today,u.uom,u.manpower,u.status,u.over_scope,u.remarks,u.review_note,u.updated_at,u.author_id,
      a.name activity,a.category,a.scope_qty,a.method,a.tower_id,t.name tower,l.name level,z.name zone,tr.name trade,us.name author,en.name engineer,su.name supervisor,
      (SELECT COALESCE(SUM(u2.qty_today),0) FROM updates u2 WHERE u2.activity_id=u.activity_id AND u2.state='approved' AND (u2.report_date<u.report_date OR (u2.report_date=u.report_date AND u2.id<=u.id))) cum_approved,
      (SELECT COUNT(*) FROM photos p WHERE p.update_id=u.id) photos, (SELECT COUNT(*) FROM issues i WHERE i.update_id=u.id) issues
      ${from} ORDER BY ${query.sort === 'oldest' ? 'u.report_date, u.id' : 'u.report_date DESC, u.id DESC'} LIMIT ? OFFSET ?`, ...p, limit, +query.offset || 0);
  const counts = Object.fromEntries(q(`SELECT u.state, COUNT(*) n ${from} GROUP BY u.state`, ...p).map((r) => [r.state, r.n]));
  return { total, rows, counts };
});

get('/api/updates/:id', { roles: ALL }, ({ user, params }) => {
  const u = loadFull(+params.id);
  if (!visibleUpdate(user, u)) throw notFound('Update not found');
  const { approved, pending } = amounts(u.activity_id, u.id);
  return {
    update: { ...u, milestone_ids: msIds(u) },
    photos: q('SELECT id,caption,kind,taken_date,uploader_id,is_demo FROM photos WHERE update_id=? ORDER BY id', u.id),
    issues: q(`SELECT i.*, o.name owner FROM issues i LEFT JOIN users o ON o.id=i.owner_id WHERE i.update_id=? ORDER BY i.id`, u.id),
    approved, pending_others: pending,
    audit: q("SELECT ts,user_name,action,summary FROM audit WHERE entity='update' AND entity_id=? ORDER BY id DESC", u.id),
    can_edit: canEditAct(user, q1('SELECT engineer_id,supervisor_id FROM activities WHERE id=?', u.activity_id)) && ['draft', 'rejected'].includes(u.state),
  };
});

post('/api/updates', { roles: STAFF }, ({ user, body }) => saveUpdate(user, body, body.action === 'submit' ? 'submit' : 'draft'));
put('/api/updates/:id', { roles: STAFF }, ({ user, params, body }) => saveUpdate(user, { ...body, id: +params.id }, body.action === 'submit' ? 'submit' : 'draft'));

post('/api/updates/:id/submit', { roles: STAFF }, ({ user, params }) => {
  const u = q1('SELECT * FROM updates WHERE id=?', +params.id);
  if (!u) throw notFound();
  return saveUpdate(user, { ...u, id: u.id, milestone_ids: msIds(u) }, 'submit');
});

post('/api/updates/:id/recall', { roles: STAFF }, ({ user, params }) => {
  const u = q1('SELECT * FROM updates WHERE id=?', +params.id);
  const a = u && getAct(u.activity_id);
  if (!a || !canEditAct(user, a)) throw notFound();
  if (u.state !== 'submitted') throw new HttpError(409, 'Only submitted updates can be recalled');
  dbUpdate('updates', u.id, { state: 'draft', submitted_at: null, updated_at: now() });
  audit(user, 'recall', 'update', u.id, `Recalled submitted update to draft: ${a.name} (${u.report_date})`);
  return { update: loadFull(u.id) };
});

del('/api/updates/:id', { roles: STAFF }, ({ user, params }) => {
  const u = q1('SELECT * FROM updates WHERE id=?', +params.id);
  const a = u && getAct(u.activity_id);
  if (!a || !canEditAct(user, a) || u.author_id !== user.id) throw notFound();
  if (u.state !== 'draft') throw new HttpError(409, 'Only drafts can be deleted');
  tx(() => {
    for (const ph of q('SELECT * FROM photos WHERE update_id=?', u.id)) removePhoto(ph);
    run("DELETE FROM issues WHERE update_id=? AND status='open' AND raised_by=?", u.id, user.id);
    run('DELETE FROM updates WHERE id=?', u.id);
    audit(user, 'delete', 'update', u.id, `Deleted draft update: ${a.name} (${u.report_date})`);
  });
  return { ok: true };
});

// Copy a previous day's entries as NEW drafts. People / manpower / status are copied; quantities, photos and issues are NOT.
post('/api/updates/copy', { roles: STAFF }, ({ user, body }) => {
  const date = isDate(body.date) ? body.date : today();
  const S = getSettings();
  if (date > today() || date < addDays(today(), -S.backdate_days)) throw bad('That date is outside the allowed range');
  let from = isDate(body.from_date) ? body.from_date : null;
  if (!from) {
    const r = q1('SELECT MAX(u.report_date) d FROM updates u JOIN activities a ON a.id=u.activity_id WHERE (a.engineer_id=? OR a.supervisor_id=?) AND u.report_date<?', user.id, user.id, date);
    from = r?.d;
  }
  if (!from) return { from: null, created: [], skipped: [], message: 'No earlier updates found to copy' };
  const src = q(`SELECT u.* FROM updates u JOIN activities a ON a.id=u.activity_id WHERE u.report_date=? AND a.active=1 AND (a.engineer_id=? OR a.supervisor_id=?)`, from, user.id, user.id)
    .filter((u) => !body.activity_ids || body.activity_ids.includes(u.activity_id));
  const created = [], skipped = [];
  tx(() => {
    for (const u of src) {
      const a = getAct(u.activity_id);
      const why = !a ? 'Activity inactive' : a.status === 'completed' ? 'Activity already completed'
        : q1('SELECT 1 x FROM updates WHERE activity_id=? AND report_date=?', a.id, date) ? 'Already has an entry for that date' : null;
      if (why) { skipped.push({ activity_id: u.activity_id, name: a?.name, reason: why }); continue; }
      const id = insert('updates', {
        activity_id: a.id, report_date: date, author_id: user.id, engineer_id: u.engineer_id, supervisor_id: u.supervisor_id,
        contractor: u.contractor, location_note: u.location_note, qty_today: 0, planned_qty: a.scope_qty, uom: a.uom, manpower: u.manpower,
        status: u.status === 'completed' ? 'in_progress' : u.status, next_plan: u.next_plan, state: 'draft', copied_from: u.id, created_at: now(), updated_at: now(),
      });
      audit(user, 'copy', 'update', id, `Copied details from ${from} (quantity NOT copied): ${a.name}`, { from_update: u.id });
      created.push({ id, activity_id: a.id, name: a.name });
    }
  });
  return { from, created, skipped };
});

// Save / submit many rows at once (each row validated and saved independently).
post('/api/updates/batch', { roles: STAFF }, ({ user, body }) => {
  const action = body.action === 'submit' ? 'submit' : 'draft';
  const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
  const results = items.map((it) => {
    try {
      const existing = it.id ? { id: it.id } : q1('SELECT id,state FROM updates WHERE activity_id=? AND report_date=?', +it.activity_id, it.report_date);
      const r = saveUpdate(user, { ...it, id: existing?.id }, action);
      return { activity_id: it.activity_id, ok: true, id: r.update.id, state: r.update.state, warnings: r.warnings };
    } catch (e) {
      if (e instanceof HttpError) return { activity_id: it.activity_id, ok: false, error: e.message, fields: e.extra?.fields };
      throw e;
    }
  });
  return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
});

post('/api/updates/:id/approve', { roles: ['pm'] }, ({ user, params, body }) => ({ update: review(user, +params.id, 'approve', body.note) }));
post('/api/updates/:id/reject', { roles: ['pm'] }, ({ user, params, body }) => ({ update: review(user, +params.id, 'reject', body.note) }));
post('/api/updates/:id/reopen', { roles: ['pm'] }, ({ user, params, body }) => ({ update: review(user, +params.id, 'reopen', body.note) }));
post('/api/updates/review', { roles: ['pm'] }, ({ user, body }) => {
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
  if (!['approve', 'reject'].includes(body.action)) throw bad('Unknown action');
  const results = ids.map((id) => {
    try { review(user, +id, body.action, body.note); return { id, ok: true }; }
    catch (e) { if (e instanceof HttpError) return { id, ok: false, error: e.message }; throw e; }
  });
  return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
});
