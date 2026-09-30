// Administration: users, project structure, activities, baselines & weights, settings. Admin-only (enforced by the router).
import { get, post, put, del } from './router.js';
import { q, q1, insert, update as dbUpdate, run, tx, audit, now, setSetting, getSettings } from './db.js';
import { hashPassword, randomPassword, passwordProblem, destroyUserSessions } from './auth.js';
import { wipeProject } from './seed.js';
import { addDays, isDate, num, str, int01, HttpError, bad, notFound } from './util.js';

const A = { roles: ['admin'] };
const ROLES = ['pm', 'engineer', 'supervisor', 'admin'];
const fail = (fields, msg = 'Please fix the highlighted fields') => new HttpError(422, msg, { fields });

// ---------------------------------------------------------------- users
get('/api/admin/users', A, () => ({
  users: q(`SELECT id,username,name,role,company,phone,active,must_change,is_demo,
    (SELECT COUNT(*) FROM activities a WHERE a.engineer_id=users.id OR a.supervisor_id=users.id) assigned FROM users ORDER BY active DESC, role, name`),
}));

post('/api/admin/users', A, ({ user, body }) => {
  const e = {};
  const username = str(body.username, 40);
  if (!username || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) e.username = '3-40 letters, numbers, . _ -';
  else if (q1('SELECT 1 x FROM users WHERE username=?', username)) e.username = 'Username already exists';
  if (!str(body.name, 100)) e.name = 'Enter the full name';
  if (!ROLES.includes(body.role)) e.role = 'Choose a role';
  if (body.password) { const p = passwordProblem(body.password); if (p) e.password = p; }
  if (Object.keys(e).length) throw fail(e);
  const temp = body.password || randomPassword();
  const id = insert('users', { username, name: str(body.name, 100), role: body.role, company: str(body.company, 100), phone: str(body.phone, 40), pw_hash: hashPassword(temp), must_change: 1, created_at: now() });
  audit(user, 'create', 'user', id, `Created user ${username} (${body.role})`);
  return { id, temp_password: temp };
});

put('/api/admin/users/:id', A, ({ user, params, body }) => {
  const u = q1('SELECT * FROM users WHERE id=?', +params.id);
  if (!u) throw notFound();
  const f = {};
  if (body.name !== undefined) { f.name = str(body.name, 100); if (!f.name) throw fail({ name: 'Enter the full name' }); }
  if (body.role !== undefined) { if (!ROLES.includes(body.role)) throw fail({ role: 'Choose a role' }); f.role = body.role; }
  if (body.company !== undefined) f.company = str(body.company, 100);
  if (body.phone !== undefined) f.phone = str(body.phone, 40);
  if (body.active !== undefined) f.active = int01(body.active);
  const stillAdmin = (f.role ?? u.role) === 'admin' && (f.active ?? u.active);
  if (u.role === 'admin' && u.active && !stillAdmin && q1("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?", u.id).n === 0) throw new HttpError(409, 'There must be at least one active Administrator');
  if (u.id === user.id && f.active === 0) throw new HttpError(409, 'You cannot deactivate your own account');
  dbUpdate('users', u.id, f);
  if (f.active === 0 || (f.role && f.role !== u.role)) destroyUserSessions(u.id);
  audit(user, 'edit', 'user', u.id, `Edited user ${u.username}`, { before: Object.fromEntries(Object.keys(f).map((k) => [k, u[k]])), after: f });
  return { ok: true };
});

post('/api/admin/users/:id/reset', A, ({ user, params }) => {
  const u = q1('SELECT * FROM users WHERE id=?', +params.id);
  if (!u) throw notFound();
  const temp = randomPassword();
  dbUpdate('users', u.id, { pw_hash: hashPassword(temp), must_change: 1 });
  destroyUserSessions(u.id);
  audit(user, 'password_reset', 'user', u.id, `Reset password for ${u.username}`);
  return { temp_password: temp };
});

// ---------------------------------------------------------------- structure
get('/api/admin/structure', A, () => {
  const towers = q('SELECT * FROM towers ORDER BY sort,id');
  const trades = q('SELECT id,code,name FROM trades ORDER BY sort,id');
  const tt = q('SELECT * FROM tower_trades');
  const zones = q('SELECT * FROM zones ORDER BY sort,id');
  const counts = Object.fromEntries(q('SELECT level_id, COUNT(*) n FROM activities GROUP BY level_id').map((r) => [r.level_id, r.n]));
  const tcounts = Object.fromEntries(q('SELECT tower_id, COUNT(*) n FROM activities GROUP BY tower_id').map((r) => [r.tower_id, r.n]));
  return {
    trades,
    towers: towers.map((t) => ({
      ...t, activities: tcounts[t.id] || 0,
      trade_weights: Object.fromEntries(trades.map((tr) => [tr.id, tt.find((x) => x.tower_id === t.id && x.trade_id === tr.id)?.weight ?? null])),
      levels: q('SELECT * FROM levels WHERE tower_id=? ORDER BY sort,id', t.id).map((l) => ({ ...l, activities: counts[l.id] || 0, zones: zones.filter((z) => z.level_id === l.id) })),
    })),
  };
});

const weightOrNull = (v, field) => {
  const n = num(v);
  if (Number.isNaN(n) || (n != null && n < 0)) throw fail({ [field]: 'Enter a positive number' });
  return n > 0 ? n : null;
};

post('/api/admin/towers', A, ({ user, body }) => {
  const code = str(body.code, 20), name = str(body.name, 80);
  const e = {};
  if (!code) e.code = 'Enter a short code'; else if (q1('SELECT 1 x FROM towers WHERE code=?', code)) e.code = 'Code already used';
  if (!name) e.name = 'Enter the tower name';
  if (Object.keys(e).length) throw fail(e);
  const id = tx(() => {
    const id = insert('towers', { code, name, weight: weightOrNull(body.weight, 'weight'), sort: (q1('SELECT MAX(sort) m FROM towers').m ?? 0) + 1, notes: str(body.notes) });
    for (const tr of q('SELECT id FROM trades')) run('INSERT INTO tower_trades (tower_id,trade_id,weight) VALUES (?,?,NULL)', id, tr.id);
    return id;
  });
  audit(user, 'create', 'tower', id, `Created tower ${name}`);
  return { id };
});

put('/api/admin/towers/:id', A, ({ user, params, body }) => {
  const t = q1('SELECT * FROM towers WHERE id=?', +params.id);
  if (!t) throw notFound();
  const f = {};
  if (body.name !== undefined) { f.name = str(body.name, 80); if (!f.name) throw fail({ name: 'Enter the tower name' }); }
  if (body.code !== undefined) {
    f.code = str(body.code, 20);
    if (!f.code) throw fail({ code: 'Enter a short code' });
    if (q1('SELECT 1 x FROM towers WHERE code=? AND id<>?', f.code, t.id)) throw fail({ code: 'Code already used' });
  }
  if (body.weight !== undefined) f.weight = weightOrNull(body.weight, 'weight');
  if (body.notes !== undefined) f.notes = str(body.notes);
  if (body.active !== undefined) f.active = int01(body.active);
  dbUpdate('towers', t.id, f);
  const isW = 'weight' in f && f.weight !== t.weight;
  audit(user, isW ? 'baseline_change' : 'edit', 'tower', t.id, `Edited tower ${t.name}${isW ? ` (weight ${t.weight ?? 'not set'} -> ${f.weight ?? 'not set'})` : ''}`, { before: t, after: f });
  return { ok: true };
});

del('/api/admin/towers/:id', A, ({ user, params }) => {
  const t = q1('SELECT * FROM towers WHERE id=?', +params.id);
  if (!t) throw notFound();
  if (q1('SELECT 1 x FROM activities WHERE tower_id=?', t.id)) throw new HttpError(409, 'This tower has activities. Deactivate it instead (uncheck Active), or reset the project.');
  run('DELETE FROM towers WHERE id=?', t.id);
  audit(user, 'delete', 'tower', t.id, `Deleted tower ${t.name}`);
  return { ok: true };
});

put('/api/admin/towers/:id/trade-weights', A, ({ user, params, body }) => {
  const t = q1('SELECT * FROM towers WHERE id=?', +params.id);
  if (!t) throw notFound();
  const before = Object.fromEntries(q('SELECT trade_id,weight FROM tower_trades WHERE tower_id=?', t.id).map((r) => [r.trade_id, r.weight]));
  const after = {};
  tx(() => {
    for (const tr of q('SELECT id FROM trades')) {
      if (!(tr.id in (body.weights || {}))) continue;
      const w = weightOrNull(body.weights[tr.id], 'weight');
      after[tr.id] = w;
      run('INSERT INTO tower_trades (tower_id,trade_id,weight) VALUES (?,?,?) ON CONFLICT(tower_id,trade_id) DO UPDATE SET weight=excluded.weight', t.id, tr.id, w);
    }
  });
  audit(user, 'baseline_change', 'tower', t.id, `Trade weights changed for ${t.name}`, { before, after });
  return { ok: true };
});

const nameList = (v) => [...new Set((Array.isArray(v) ? v : []).map((s) => str(s, 60)).filter(Boolean))];

post('/api/admin/towers/:id/levels', A, ({ user, params, body }) => {
  const t = q1('SELECT * FROM towers WHERE id=?', +params.id);
  if (!t) throw notFound();
  const names = nameList(body.names);
  if (!names.length) throw fail({ names: 'Enter at least one floor / level' });
  const zones = nameList(body.zones);
  const added = [], skipped = [];
  tx(() => {
    let sort = (q1('SELECT MAX(sort) m FROM levels WHERE tower_id=?', t.id).m ?? -1) + 1;
    for (const n of names) {
      if (q1('SELECT 1 x FROM levels WHERE tower_id=? AND name=?', t.id, n)) { skipped.push(n); continue; }
      const id = insert('levels', { tower_id: t.id, name: n, sort: sort++ });
      zones.forEach((z, i) => insert('zones', { level_id: id, name: z, sort: i }));
      added.push(n);
    }
  });
  audit(user, 'create', 'level', null, `Added ${added.length} level(s) to ${t.name}: ${added.join(', ')}`);
  return { added, skipped };
});

put('/api/admin/levels/:id', A, ({ user, params, body }) => {
  const l = q1('SELECT * FROM levels WHERE id=?', +params.id);
  if (!l) throw notFound();
  const f = {};
  if (body.name !== undefined) {
    f.name = str(body.name, 60);
    if (!f.name) throw fail({ name: 'Enter a name' });
    if (q1('SELECT 1 x FROM levels WHERE tower_id=? AND name=? AND id<>?', l.tower_id, f.name, l.id)) throw fail({ name: 'Name already used in this tower' });
  }
  if (body.sort !== undefined) f.sort = Math.trunc(num(body.sort) ?? l.sort);
  dbUpdate('levels', l.id, f);
  audit(user, 'edit', 'level', l.id, `Edited level ${l.name}`, { before: l, after: f });
  return { ok: true };
});
del('/api/admin/levels/:id', A, ({ user, params }) => {
  const l = q1('SELECT * FROM levels WHERE id=?', +params.id);
  if (!l) throw notFound();
  if (q1('SELECT 1 x FROM activities WHERE level_id=?', l.id)) throw new HttpError(409, 'This level has activities and cannot be deleted');
  run('DELETE FROM levels WHERE id=?', l.id);
  audit(user, 'delete', 'level', l.id, `Deleted level ${l.name}`);
  return { ok: true };
});

post('/api/admin/levels/:id/zones', A, ({ user, params, body }) => {
  const l = q1('SELECT * FROM levels WHERE id=?', +params.id);
  if (!l) throw notFound();
  const names = nameList(body.names);
  if (!names.length) throw fail({ names: 'Enter at least one zone / unit' });
  // optionally apply to every level of the tower
  const levels = body.all_levels ? q('SELECT * FROM levels WHERE tower_id=?', l.tower_id) : [l];
  let n = 0;
  tx(() => {
    for (const lv of levels) {
      let sort = (q1('SELECT MAX(sort) m FROM zones WHERE level_id=?', lv.id).m ?? -1) + 1;
      for (const z of names) if (!q1('SELECT 1 x FROM zones WHERE level_id=? AND name=?', lv.id, z)) { insert('zones', { level_id: lv.id, name: z, sort: sort++ }); n++; }
    }
  });
  audit(user, 'create', 'zone', null, `Added ${n} zone(s): ${names.join(', ')}`);
  return { added: n };
});
put('/api/admin/zones/:id', A, ({ user, params, body }) => {
  const z = q1('SELECT * FROM zones WHERE id=?', +params.id);
  if (!z) throw notFound();
  const name = str(body.name, 60);
  if (!name) throw fail({ name: 'Enter a name' });
  if (q1('SELECT 1 x FROM zones WHERE level_id=? AND name=? AND id<>?', z.level_id, name, z.id)) throw fail({ name: 'Name already used on this level' });
  dbUpdate('zones', z.id, { name });
  audit(user, 'edit', 'zone', z.id, `Renamed zone ${z.name} -> ${name}`);
  return { ok: true };
});
del('/api/admin/zones/:id', A, ({ user, params }) => {
  const z = q1('SELECT * FROM zones WHERE id=?', +params.id);
  if (!z) throw notFound();
  if (q1('SELECT 1 x FROM activities WHERE zone_id=?', z.id)) throw new HttpError(409, 'This zone has activities and cannot be deleted');
  run('DELETE FROM zones WHERE id=?', z.id);
  audit(user, 'delete', 'zone', z.id, `Deleted zone ${z.name}`);
  return { ok: true };
});

// ---------------------------------------------------------------- catalog & settings
const catBody = (b) => {
  const e = {};
  if (!q1('SELECT 1 x FROM trades WHERE id=?', +b.trade_id)) e.trade_id = 'Choose a trade';
  if (!str(b.name, 120)) e.name = 'Enter the activity name';
  const method = b.method === 'milestone' ? 'milestone' : 'quantity';
  if (method === 'quantity' && !str(b.uom, 12)) e.uom = 'Enter a unit (m2, m3, nos ...)';
  if (Object.keys(e).length) throw fail(e);
  let ms = null;
  if (method === 'milestone') {
    const list = nameList(String(b.milestones || '').split(/\n|;/));
    if (!list.length) throw fail({ milestones: 'List the milestones (one per line)' });
    ms = JSON.stringify(list);
  }
  return { trade_id: +b.trade_id, category: str(b.category, 60) || 'General', name: str(b.name, 120), uom: method === 'milestone' ? null : str(b.uom, 12), method, milestones: ms };
};
get('/api/admin/catalog', A, () => ({ rows: q('SELECT * FROM catalog ORDER BY trade_id, id') }));
post('/api/admin/catalog', A, ({ user, body }) => { const id = insert('catalog', catBody(body)); audit(user, 'create', 'catalog', id, `Added catalog activity ${body.name}`); return { id }; });
put('/api/admin/catalog/:id', A, ({ user, params, body }) => { dbUpdate('catalog', +params.id, catBody(body)); audit(user, 'edit', 'catalog', +params.id, `Edited catalog activity ${body.name}`); return { ok: true }; });
del('/api/admin/catalog/:id', A, ({ user, params }) => { run('DELETE FROM catalog WHERE id=?', +params.id); audit(user, 'delete', 'catalog', +params.id, 'Removed catalog activity'); return { ok: true }; });

put('/api/admin/settings', A, ({ user, body }) => {
  const before = getSettings();
  const out = {};
  const numIn = (k, lo, hi) => {
    if (body[k] === undefined) return;
    const n = num(body[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) throw fail({ [k]: `Enter a number between ${lo} and ${hi}` });
    out[k] = n;
  };
  if (body.project_name !== undefined) { const n = str(body.project_name, 100); if (!n) throw fail({ project_name: 'Enter a project name' }); out.project_name = n; }
  numIn('at_risk_pp', 0, 100); numIn('delayed_pp', 0, 100); numIn('stale_days', 1, 60); numIn('backdate_days', 0, 60);
  if ((out.at_risk_pp ?? before.at_risk_pp) > (out.delayed_pp ?? before.delayed_pp)) throw fail({ delayed_pp: 'Delayed threshold must be at least the At Risk threshold' });
  for (const [k, v] of Object.entries(out)) setSetting(k, v);
  audit(user, 'baseline_change', 'settings', null, `Settings changed: ${Object.keys(out).join(', ')}`, { before, after: out });
  return { ok: true };
});

// ---------------------------------------------------------------- activities
function actFields(b, tower_id, partial) {
  const f = {};
  const e = {};
  if (!partial || b.name !== undefined) { f.name = str(b.name, 160); if (!f.name) e.name = 'Enter the activity name'; }
  if (b.category !== undefined) f.category = str(b.category, 60) || 'General';
  if (b.method !== undefined) f.method = b.method === 'milestone' ? 'milestone' : 'quantity';
  if (b.uom !== undefined) f.uom = str(b.uom, 12);
  if (b.scope_qty !== undefined) { const n = num(b.scope_qty); if (Number.isNaN(n) || (n != null && n < 0)) e.scope_qty = 'Enter a positive number'; else f.scope_qty = n > 0 ? n : null; }
  if (b.weight !== undefined) { const n = num(b.weight); if (Number.isNaN(n) || (n != null && n < 0)) e.weight = 'Enter a positive number'; else f.weight = n > 0 ? n : null; }
  for (const k of ['plan_start', 'plan_finish']) if (b[k] !== undefined) { f[k] = b[k] || null; if (f[k] && !isDate(f[k])) e[k] = 'Invalid date'; }
  if (b.contractor !== undefined) f.contractor = str(b.contractor, 120);
  for (const k of ['engineer_id', 'supervisor_id']) if (b[k] !== undefined) {
    f[k] = b[k] ? +b[k] : null;
    if (f[k] && !q1("SELECT 1 x FROM users WHERE id=? AND active=1 AND role IN ('engineer','supervisor')", f[k])) e[k] = 'Choose a site engineer / supervisor';
  }
  if (b.active !== undefined) f.active = int01(b.active);
  if (b.trade_id !== undefined) { f.trade_id = +b.trade_id; if (!q1('SELECT 1 x FROM trades WHERE id=?', f.trade_id)) e.trade_id = 'Choose a trade'; }
  if (b.level_id !== undefined) {
    f.level_id = b.level_id ? +b.level_id : null;
    if (f.level_id && !q1('SELECT 1 x FROM levels WHERE id=? AND tower_id=?', f.level_id, tower_id)) e.level_id = 'Level does not belong to this tower';
  }
  if (b.zone_id !== undefined) {
    f.zone_id = b.zone_id ? +b.zone_id : null;
    if (f.zone_id && !q1('SELECT 1 x FROM zones WHERE id=? AND level_id=?', f.zone_id, f.level_id ?? b.level_id)) e.zone_id = 'Zone does not belong to that level';
  }
  return { f, e };
}
const BASELINE_KEYS = ['scope_qty', 'weight', 'plan_start', 'plan_finish'];

function applyActivityPatch(user, a, f, reason) {
  const changes = BASELINE_KEYS.filter((k) => k in f && (f[k] ?? null) !== (a[k] ?? null));
  const revised = changes.filter((k) => a[k] != null); // changing an already-agreed value needs a reason
  if (revised.length && !str(reason)) throw fail({ reason: 'A reason is required when changing agreed baseline values' }, `Reason required to change ${revised.join(', ')} on "${a.name}"`);
  if (f.plan_start !== undefined || f.plan_finish !== undefined) {
    const s = f.plan_start !== undefined ? f.plan_start : a.plan_start;
    const e = f.plan_finish !== undefined ? f.plan_finish : a.plan_finish;
    if (s && e && e < s) throw fail({ plan_finish: 'Finish is before start' }, `Finish date is before start on "${a.name}"`);
  }
  if (f.scope_qty != null) {
    const done = q1("SELECT COALESCE(SUM(qty_today),0) s FROM updates WHERE activity_id=? AND state IN ('approved','submitted')", a.id).s;
    if (f.scope_qty < done - 1e-6) throw new HttpError(409, `Scope of "${a.name}" cannot be below quantity already reported (${done})`);
  }
  dbUpdate('activities', a.id, f);
  if (changes.length) {
    audit(user, 'baseline_change', 'activity', a.id, `Baseline changed: ${a.name} - ${changes.map((k) => `${k} ${a[k] ?? 'not set'} -> ${f[k] ?? 'not set'}`).join('; ')}${str(reason) ? ` (Reason: ${str(reason)})` : ''}`,
      { reason: str(reason), before: Object.fromEntries(changes.map((k) => [k, a[k]])), after: Object.fromEntries(changes.map((k) => [k, f[k]])) });
  }
  const others = Object.keys(f).filter((k) => !BASELINE_KEYS.includes(k) && f[k] !== a[k]);
  if (others.length) audit(user, 'edit', 'activity', a.id, `Edited activity ${a.name}: ${others.join(', ')}`, { before: Object.fromEntries(others.map((k) => [k, a[k]])), after: Object.fromEntries(others.map((k) => [k, f[k]])) });
}

function saveMilestones(actId, list) {
  const old = q('SELECT * FROM activity_milestones WHERE activity_id=?', actId);
  const keep = new Set();
  let sort = 0;
  for (const m of list) {
    const name = str(m.name, 120);
    const weight = num(m.weight) ?? 1;
    if (!name || !(weight > 0)) throw fail({ milestones: 'Each milestone needs a name and positive weight' });
    const ex = m.id ? old.find((o) => o.id === +m.id) : null;
    if (ex) { keep.add(ex.id); dbUpdate('activity_milestones', ex.id, { name, weight, sort: sort++ }); }
    else keep.add(insert('activity_milestones', { activity_id: actId, name, weight, sort: sort++ }));
  }
  for (const o of old) if (!keep.has(o.id)) {
    if (o.achieved_date) throw new HttpError(409, `Milestone "${o.name}" is already achieved and cannot be removed`);
    run('DELETE FROM activity_milestones WHERE id=?', o.id);
  }
}

post('/api/admin/activities', A, ({ user, body }) => {
  const tower = q1('SELECT * FROM towers WHERE id=?', +body.tower_id);
  if (!tower) throw fail({ tower_id: 'Choose a tower' });
  const { f, e } = actFields({ method: 'quantity', ...body }, tower.id, false);
  if (!f.trade_id) e.trade_id = 'Choose a trade';
  if (f.method === 'quantity' && !f.uom && body.uom === undefined) e.uom = 'Enter a unit';
  if (Object.keys(e).length) throw fail(e);
  const id = tx(() => {
    const id = insert('activities', { category: 'General', ...f, tower_id: tower.id, status: 'not_started', created_at: now() });
    if (f.method === 'milestone' && Array.isArray(body.milestones)) saveMilestones(id, body.milestones);
    audit(user, 'create', 'activity', id, `Created activity ${f.name} (${tower.name})`);
    return id;
  });
  return { id };
});

put('/api/admin/activities/:id', A, ({ user, params, body }) => {
  const a = q1('SELECT * FROM activities WHERE id=?', +params.id);
  if (!a) throw notFound();
  const { f, e } = actFields(body, a.tower_id, true);
  if (Object.keys(e).length) throw fail(e);
  if (f.method && f.method !== a.method && q1('SELECT 1 x FROM updates WHERE activity_id=?', a.id)) throw new HttpError(409, 'Measurement method cannot change after updates exist');
  tx(() => {
    applyActivityPatch(user, a, f, body.reason);
    if (Array.isArray(body.milestones)) saveMilestones(a.id, body.milestones);
  });
  return { ok: true };
});

// Per-row edits from the weights / scope / schedule grid (and bulk shifts)
post('/api/admin/activities/batch-edit', A, ({ user, body }) => {
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : [];
  const shift = body.shift_days ? Math.trunc(num(body.shift_days)) : 0;
  let n = 0;
  tx(() => {
    for (const r of rows) {
      const a = q1('SELECT * FROM activities WHERE id=?', +r.id);
      if (!a) continue;
      const { f, e } = actFields(r, a.tower_id, true);
      if (Object.keys(e).length) throw fail(e, `"${a.name}": ${Object.values(e)[0]}`);
      if (shift) for (const k of ['plan_start', 'plan_finish']) { const cur = f[k] !== undefined ? f[k] : a[k]; if (cur) f[k] = addDays(cur, shift); }
      delete f.name; // names are edited one at a time
      applyActivityPatch(user, a, f, body.reason);
      n++;
    }
  });
  return { updated: n };
});

put('/api/admin/activities/:id/milestones', A, ({ user, params, body }) => {
  const a = q1('SELECT * FROM activities WHERE id=?', +params.id);
  if (!a) throw notFound();
  tx(() => { saveMilestones(a.id, Array.isArray(body.milestones) ? body.milestones : []); audit(user, 'baseline_change', 'activity', a.id, `Milestones changed: ${a.name}`, { reason: str(body.reason) }); });
  return { ok: true };
});

del('/api/admin/activities/:id', A, ({ user, params }) => {
  const a = q1('SELECT * FROM activities WHERE id=?', +params.id);
  if (!a) throw notFound();
  if (q1('SELECT 1 x FROM updates WHERE activity_id=?', a.id)) throw new HttpError(409, 'This activity has progress updates. Deactivate it instead to keep the record.');
  run('DELETE FROM activities WHERE id=?', a.id);
  audit(user, 'delete', 'activity', a.id, `Deleted activity ${a.name}`);
  return { ok: true };
});

// Create activities from the catalog for selected levels (optionally one per zone).
post('/api/admin/activities/generate', A, ({ user, body }) => {
  const tower = q1('SELECT * FROM towers WHERE id=?', +body.tower_id);
  const trade = q1('SELECT * FROM trades WHERE id=?', +body.trade_id);
  if (!tower || !trade) throw fail({ tower_id: 'Choose a tower and trade' });
  const levelIds = (body.level_ids || []).map(Number);
  const cat = q('SELECT * FROM catalog WHERE trade_id=?', trade.id).filter((c) => (body.catalog_ids || []).map(Number).includes(c.id));
  if (!cat.length) throw fail({ catalog_ids: 'Select at least one activity' });
  if (!levelIds.length) throw fail({ level_ids: 'Select at least one level' });
  const start = body.plan_start || null, fin = body.plan_finish || null;
  if ((start && !isDate(start)) || (fin && !isDate(fin)) || (start && fin && fin < start)) throw fail({ plan_finish: 'Check the baseline dates' });
  const eng = body.engineer_id ? +body.engineer_id : null, sup = body.supervisor_id ? +body.supervisor_id : null;
  let created = 0, skipped = 0;
  tx(() => {
    for (const lid of levelIds) {
      const lv = q1('SELECT * FROM levels WHERE id=? AND tower_id=?', lid, tower.id);
      if (!lv) continue;
      const zs = body.zone_mode === 'zone' ? q('SELECT * FROM zones WHERE level_id=? ORDER BY sort,id', lv.id) : [];
      for (const c of cat) for (const z of zs.length ? zs : [null]) {
        if (q1('SELECT 1 x FROM activities WHERE tower_id=? AND level_id=? AND COALESCE(zone_id,0)=? AND trade_id=? AND name=?', tower.id, lv.id, z?.id ?? 0, trade.id, c.name)) { skipped++; continue; }
        const id = insert('activities', {
          tower_id: tower.id, level_id: lv.id, zone_id: z?.id ?? null, trade_id: trade.id, category: c.category, name: c.name, method: c.method, uom: c.uom,
          scope_qty: c.method === 'quantity' && num(body.scope_qty) > 0 ? num(body.scope_qty) : null, weight: num(body.weight) > 0 ? num(body.weight) : null,
          plan_start: start, plan_finish: fin, contractor: str(body.contractor, 120), engineer_id: eng, supervisor_id: sup, status: 'not_started', created_at: now(),
        });
        if (c.method === 'milestone' && c.milestones) JSON.parse(c.milestones).forEach((m, i) => insert('activity_milestones', { activity_id: id, name: m, weight: 1, sort: i }));
        created++;
      }
    }
    audit(user, 'create', 'activity', null, `Generated ${created} activities for ${tower.name} / ${trade.name} (${skipped} already existed)`);
  });
  return { created, skipped };
});

get('/api/admin/config-status', { roles: ['pm', 'admin'] }, () => {
  const towers = q('SELECT * FROM towers WHERE active=1 ORDER BY sort');
  const trades = q('SELECT * FROM trades ORDER BY sort');
  const tt = q('SELECT * FROM tower_trades');
  const acts = q(`SELECT a.*, l.name level, z.name zone FROM activities a LEFT JOIN levels l ON l.id=a.level_id LEFT JOIN zones z ON z.id=a.zone_id WHERE a.active=1`);
  const msTot = Object.fromEntries(q('SELECT activity_id, COUNT(*) n FROM activity_milestones GROUP BY activity_id').map((r) => [r.activity_id, r.n]));
  const gaps = (a) => {
    const g = [];
    if (!(a.weight > 0)) g.push('weight');
    if (a.method === 'quantity' ? !(a.scope_qty > 0) : !msTot[a.id]) g.push(a.method === 'quantity' ? 'scope' : 'milestones');
    if (!a.plan_start || !a.plan_finish) g.push('baseline dates');
    if (!a.engineer_id && !a.supervisor_id) g.push('responsible person');
    return g;
  };
  const list = acts.map((a) => ({ id: a.id, tower_id: a.tower_id, name: a.name, level: a.level, zone: a.zone, gaps: gaps(a) })).filter((a) => a.gaps.length);
  const total = { weight: 0, scope: 0, baseline: 0, responsible: 0 };
  for (const a of list) {
    if (a.gaps.includes('weight')) total.weight++;
    if (a.gaps.includes('scope') || a.gaps.includes('milestones')) total.scope++;
    if (a.gaps.includes('baseline dates')) total.baseline++;
    if (a.gaps.includes('responsible person')) total.responsible++;
  }
  return {
    total_activities: acts.length, total_gaps: total,
    towers: towers.map((t) => ({
      id: t.id, name: t.name, tower_weight: t.weight > 0, activities: acts.filter((a) => a.tower_id === t.id).length,
      gaps: list.filter((a) => a.tower_id === t.id).length,
      trades: trades.map((tr) => ({ id: tr.id, name: tr.name, weight: tt.find((x) => x.tower_id === t.id && x.trade_id === tr.id)?.weight > 0, activities: acts.filter((a) => a.tower_id === t.id && a.trade_id === tr.id).length })),
    })),
    list: list.slice(0, 300),
  };
});

post('/api/admin/reset', A, ({ user, body }) => {
  if (body.confirm !== 'RESET') throw bad('Type RESET to confirm');
  wipeProject(user.id);
  audit(user, 'reset', 'project', null, 'Project data cleared - all towers, activities, updates, issues, photos and demonstration users removed');
  return { ok: true };
});
