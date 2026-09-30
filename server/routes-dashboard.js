// Read-side analytics: dashboard, heat-map, towers, activities, schedule, milestones.
import { get, post, put, del, ALL, MGMT } from './router.js';
import { q, q1, insert, update as dbUpdate, run, audit, getSettings } from './db.js';
import { snapshot, rollup, matchActivity, curve, groupBy, pubAct } from './calc.js';
import { today, addDays, diffDays, isDate, bad, forbidden, notFound, str } from './util.js';

const FILTER_KEYS = ['tower', 'trade', 'level', 'level_id', 'zone', 'zone_id', 'category', 'contractor', 'person', 'status', 'health', 'overdue', 'needs_update', 'pending', 'q'];
export const parseFilters = (qs) => Object.fromEntries(FILTER_KEYS.filter((k) => qs[k] !== undefined && qs[k] !== '').map((k) => [k, qs[k]]));
export const asOfOf = (qs) => (isDate(qs.date) ? qs.date : today());
export const canSee = (user, a) => user.role === 'pm' || user.role === 'admin' || a.engineer_id === user.id || a.supervisor_id === user.id;
const PRIO = { critical: 0, high: 1, medium: 2, low: 3 };

// issues share the location columns, so the same filters apply
export function issueRows(f, extra = '', params = []) {
  const w = ["i.status IN ('open','in_progress')"];
  const p = [...params];
  if (f.tower) (w.push('i.tower_id=?'), p.push(+f.tower));
  if (f.trade) (w.push('i.trade_id=?'), p.push(+f.trade));
  if (f.level_id) (w.push('i.level_id=?'), p.push(+f.level_id));
  if (f.zone_id) (w.push('i.zone_id=?'), p.push(+f.zone_id));
  if (f.person) (w.push('(i.owner_id=? OR i.raised_by=?)'), p.push(+f.person, +f.person));
  return q(`SELECT i.*, t.name tower, l.name level, tr.name trade, o.name owner, a.name activity
            FROM issues i JOIN towers t ON t.id=i.tower_id LEFT JOIN levels l ON l.id=i.level_id
            LEFT JOIN trades tr ON tr.id=i.trade_id LEFT JOIN users o ON o.id=i.owner_id LEFT JOIN activities a ON a.id=i.activity_id
            WHERE ${w.join(' AND ')} ${extra}`, ...p);
}

get('/api/dashboard', { roles: MGMT }, ({ query }) => {
  const asOf = asOfOf(query);
  const f = parseFilters(query);
  const snap = snapshot(asOf);
  const { S, M } = snap;
  const rs = snap.list.filter((r) => matchActivity(r, f));
  const ids = new Set(rs.map((r) => r.id));
  const project = rollup(rs, S);

  const towers = M.towers
    .filter((t) => t.active && rs.some((r) => r.a.tower_id === t.id))
    .map((t) => {
      const trs = rs.filter((r) => r.a.tower_id === t.id);
      return {
        id: t.id, code: t.code, name: t.name, weight: t.weight, ...rollup(trs, S),
        trades: M.trades.filter((tr) => trs.some((r) => r.a.trade_id === tr.id)).map((tr) => ({ id: tr.id, code: tr.code, name: tr.name, ...rollup(trs.filter((r) => r.a.trade_id === tr.id), S) })),
      };
    });
  const trades = M.trades.filter((tr) => rs.some((r) => r.a.trade_id === tr.id)).map((tr) => ({ id: tr.id, code: tr.code, name: tr.name, ...rollup(rs.filter((r) => r.a.trade_id === tr.id), S) }));

  const issues = issueRows(f);
  const blockers = issues.filter((i) => i.is_blocker).sort((a, b) => (a.target_date || '9') < (b.target_date || '9') ? -1 : 1).slice(0, 8);
  const overdueIssues = issues.filter((i) => i.target_date && i.target_date < asOf).length;
  const submitted = q(`SELECT u.*, a.name activity_name, a.tower_id, us.name author FROM updates u JOIN activities a ON a.id=u.activity_id
                       LEFT JOIN users us ON us.id=u.author_id WHERE u.state='submitted' ORDER BY u.report_date, u.id`).filter((u) => ids.has(u.activity_id));

  const overdue = rs.filter((r) => r.overdue)
    .sort((a, b) => a.a.plan_finish.localeCompare(b.a.plan_finish)).slice(0, 10)
    .map((r) => ({ ...pubAct(r, M), days_overdue: diffDays(asOf, r.a.plan_finish) }));
  const milestones = q(`SELECT m.*, t.name tower FROM project_milestones m LEFT JOIN towers t ON t.id=m.tower_id
                        WHERE m.achieved_date IS NULL ORDER BY m.due_date LIMIT 60`)
    .filter((m) => (!f.tower || !m.tower_id || m.tower_id === +f.tower) && m.due_date <= addDays(asOf, 60))
    .slice(0, 8).map((m) => ({ ...m, days: diffDays(m.due_date, asOf) }));
  const stale = rs.filter((r) => r.needsUpdate);
  const staleByTower = [...groupBy(stale, (r) => r.a.tower_id)].map(([tid, list]) => ({
    tower_id: tid, tower: M.towerMap.get(tid).name, count: list.length,
    worst: list.sort((a, b) => (b.daysSinceUpdate ?? 999) - (a.daysSinceUpdate ?? 999)).slice(0, 5).map((r) => pubAct(r, M)),
  }));
  const recent = q(`SELECT u.id,u.report_date,u.qty_today,u.state,u.manpower,u.uom,u.activity_id,u.updated_at,a.name activity,a.tower_id,us.name author
                    FROM updates u JOIN activities a ON a.id=u.activity_id LEFT JOIN users us ON us.id=u.author_id
                    WHERE u.state IN ('submitted','approved') ORDER BY u.report_date DESC, u.id DESC LIMIT 80`)
    .filter((u) => ids.has(u.activity_id)).slice(0, 8).map((u) => ({ ...u, label: snap.byId.get(u.activity_id)?.label }));
  const photos = q(`SELECT p.id,p.caption,p.taken_date,p.is_demo,p.activity_id,p.tower_id,t.name tower FROM photos p LEFT JOIN towers t ON t.id=p.tower_id
                    ORDER BY p.taken_date DESC, p.id DESC LIMIT 40`).filter((p) => !p.activity_id || ids.has(p.activity_id)).slice(0, 8);

  return {
    asOf, filters: f, project, towers, trades,
    attention: {
      pending_approvals: submitted.length,
      delayed: rs.filter((r) => r.health === 'delayed').length,
      blockers: issues.filter((i) => i.is_blocker).length,
      overdue_issues: overdueIssues,
      needs_update: stale.length,
      overdue_activities: project.overdue,
      decisions: issues.filter((i) => i.needs_decision).length,
    },
    overdue, milestones, blockers,
    pending: submitted.slice(0, 8).map((u) => ({ id: u.id, report_date: u.report_date, qty_today: u.qty_today, uom: u.uom, activity: u.activity_name, author: u.author, over_scope: u.over_scope, label: snap.byId.get(u.activity_id)?.label })),
    stale: staleByTower, recent, photos,
    curves: { project: curve(rs, asOf), towers: Object.fromEntries(towers.map((t) => [t.id, curve(rs.filter((r) => r.a.tower_id === t.id), asOf)])) },
  };
});

get('/api/heatmap', { roles: MGMT }, ({ query }) => {
  const asOf = asOfOf(query);
  const f = parseFilters(query);
  const { S, M, list } = snapshot(asOf);
  const rs = list.filter((r) => matchActivity(r, f));
  const out = [];
  for (const t of M.towers.filter((t) => t.active && (!f.tower || t.id === +f.tower))) {
    const trs = rs.filter((r) => r.a.tower_id === t.id);
    if (!trs.length) continue;
    const cols = f.trade
      ? [...new Set(trs.map((r) => r.a.category || 'General'))].map((c) => ({ key: c, label: c }))
      : M.trades.filter((tr) => trs.some((r) => r.a.trade_id === tr.id)).map((tr) => ({ key: String(tr.id), label: tr.name, trade_id: tr.id }));
    const colOf = (r) => (f.trade ? r.a.category || 'General' : String(r.a.trade_id));
    const rows = M.levels.filter((l) => l.tower_id === t.id && trs.some((r) => r.a.level_id === l.id)).reverse().map((l) => {
      const lrs = trs.filter((r) => r.a.level_id === l.id);
      return {
        level: { id: l.id, name: l.name }, total: rollup(lrs, S),
        cells: cols.map((c) => {
          const cell = lrs.filter((r) => colOf(r) === c.key);
          return cell.length ? { key: c.key, ...rollup(cell, S) } : { key: c.key, n: 0 };
        }),
      };
    });
    out.push({ tower: { id: t.id, name: t.name, code: t.code }, cols, rows });
  }
  return { asOf, towers: out };
});

get('/api/towers/:id', { roles: MGMT }, ({ params, query }) => {
  const asOf = asOfOf(query);
  const snap = snapshot(asOf);
  const { S, M } = snap;
  const tower = M.towerMap.get(+params.id);
  if (!tower) throw notFound('Tower not found');
  const f = parseFilters(query);
  const rs = snap.list.filter((r) => r.a.tower_id === tower.id && matchActivity(r, { ...f, tower: undefined }));
  const levels = M.levels.filter((l) => l.tower_id === tower.id).reverse().map((l) => {
    const lrs = rs.filter((r) => r.a.level_id === l.id);
    return {
      id: l.id, name: l.name, ...rollup(lrs, S),
      trades: M.trades.map((tr) => ({ id: tr.id, ...rollup(lrs.filter((r) => r.a.trade_id === tr.id), S) })),
      zones: M.zones.filter((z) => z.level_id === l.id).map((z) => ({ id: z.id, name: z.name, ...rollup(lrs.filter((r) => r.a.zone_id === z.id), S) })),
    };
  }).filter((l) => l.n > 0);
  const categories = [...groupBy(rs, (r) => r.a.trade_id + '|' + (r.a.category || 'General'))].map(([k, list]) => ({
    trade_id: list[0].a.trade_id, category: list[0].a.category || 'General', ...rollup(list, S),
  }));
  return {
    asOf, tower: { id: tower.id, code: tower.code, name: tower.name, weight: tower.weight, notes: tower.notes },
    summary: rollup(rs, S),
    trades: M.trades.map((tr) => ({ id: tr.id, code: tr.code, name: tr.name, ...rollup(rs.filter((r) => r.a.trade_id === tr.id), S) })),
    levels, categories, curve: curve(rs, asOf),
    milestones: q('SELECT * FROM project_milestones WHERE tower_id=? ORDER BY due_date', tower.id),
    issues: issueRows({ tower: tower.id }).length,
  };
});

get('/api/activities', { roles: ALL }, ({ user, query }) => {
  const asOf = asOfOf(query);
  const f = parseFilters(query);
  const snap = snapshot(asOf);
  const { S, M } = snap;
  let rs = snap.list.filter((r) => canSee(user, r.a) && matchActivity(r, f));
  const summary = MGMT.includes(user.role) ? rollup(rs, S) : undefined;
  const key = {
    variance: (r) => r.variance ?? 999, finish: (r) => r.a.plan_finish || '9999', progress: (r) => r.pct ?? -1,
    stale: (r) => -(r.daysSinceUpdate ?? 9999),
  }[query.sort];
  if (key) rs = rs.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  else {
    const lv = new Map(M.levels.map((l) => [l.id, l.sort]));
    rs = rs.sort((a, b) => a.tower.sort - b.tower.sort || (lv.get(a.a.level_id) ?? -1) - (lv.get(b.a.level_id) ?? -1) || a.a.trade_id - b.a.trade_id || a.id - b.id);
  }
  const total = rs.length;
  const limit = Math.min(+query.limit || 300, 3000);
  const offset = +query.offset || 0;
  return { asOf, total, summary, rows: rs.slice(offset, offset + limit).map((r) => pubAct(r, M)) };
});

get('/api/activities/:id', { roles: ALL }, ({ user, params }) => {
  const snap = snapshot();
  const r = snap.byId.get(+params.id);
  if (!r || !canSee(user, r.a)) throw notFound('Activity not found');
  const { M } = snap;
  const ups = q(`SELECT u.*, us.name author, rv.name reviewer,
      (SELECT COUNT(*) FROM photos p WHERE p.update_id=u.id) photos
      FROM updates u LEFT JOIN users us ON us.id=u.author_id LEFT JOIN users rv ON rv.id=u.review_by
      WHERE u.activity_id=? ORDER BY u.report_date DESC, u.id DESC LIMIT 60`, r.id);
  let cum = 0;
  for (const u of [...ups].reverse()) { if (u.state === 'approved') cum += u.qty_today; u.cum_approved = cum; }
  return {
    activity: pubAct(r, M),
    milestones: r.ms.map((m) => ({ ...m, pending: false })),
    updates: ups,
    issues: q(`SELECT i.id,i.code,i.title,i.priority,i.status,i.is_blocker,i.target_date,o.name owner FROM issues i LEFT JOIN users o ON o.id=i.owner_id
               WHERE i.activity_id=? ORDER BY i.id DESC`, r.id),
    photos: q('SELECT id,caption,taken_date,kind,is_demo FROM photos WHERE activity_id=? ORDER BY taken_date DESC,id DESC LIMIT 24', r.id),
    audit: q(`SELECT ts,user_name,action,summary FROM audit WHERE (entity='activity' AND entity_id=?) OR
              (entity='update' AND entity_id IN (SELECT id FROM updates WHERE activity_id=?)) ORDER BY id DESC LIMIT 40`, r.id, r.id),
    can_edit: user.role === 'engineer' || user.role === 'supervisor',
  };
});

// Schedule: rows grouped tower -> trade -> category (with the individual activities inside).
get('/api/schedule', { roles: ALL }, ({ user, query }) => {
  const asOf = asOfOf(query);
  const f = parseFilters(query);
  const snap = snapshot(asOf);
  const { S, M } = snap;
  const rs = snap.list.filter((r) => canSee(user, r.a) && matchActivity(r, f));
  const groups = [...groupBy(rs, (r) => `${r.a.tower_id}|${r.a.trade_id}|${r.a.category || 'General'}`)].map(([, list]) => {
    const starts = list.map((r) => r.a.plan_start).filter(Boolean).sort();
    const fins = list.map((r) => r.a.plan_finish).filter(Boolean).sort();
    const acts = list.map((r) => r.a.actual_start).filter(Boolean).sort();
    const done = list.every((r) => r.done);
    const fin = done ? list.map((r) => r.a.actual_finish).filter(Boolean).sort().pop() : null;
    return {
      tower_id: list[0].a.tower_id, tower: list[0].tower.name, trade_id: list[0].a.trade_id, trade: list[0].trade.name,
      category: list[0].a.category || 'General', ...rollup(list, S),
      start: starts[0] || null, finish: fins[fins.length - 1] || null, actual_start: acts[0] || null, actual_finish: fin,
      items: list.map((r) => ({
        id: r.id, name: r.a.name, level: r.level?.name, zone: r.zone?.name, start: r.a.plan_start, finish: r.a.plan_finish,
        actual_start: r.a.actual_start, actual_finish: r.a.actual_finish, pct: r.pct, planned: r.planned, health: r.health, status: r.a.status,
      })),
    };
  }).sort((a, b) => a.tower_id - b.tower_id || a.trade_id - b.trade_id || (a.start || '9') .localeCompare(b.start || '9'));
  const all = rs.flatMap((r) => [r.a.plan_start, r.a.plan_finish]).filter(Boolean).sort();
  const milestones = q(`SELECT m.*, t.name tower FROM project_milestones m LEFT JOIN towers t ON t.id=m.tower_id ORDER BY m.due_date`)
    .filter((m) => !f.tower || !m.tower_id || m.tower_id === +f.tower).map((m) => ({ ...m, days: diffDays(m.due_date, asOf) }));
  const upcoming = rs.filter((r) => !r.done && r.a.plan_start && r.a.plan_start > asOf && r.a.plan_start <= addDays(asOf, 21))
    .sort((a, b) => a.a.plan_start.localeCompare(b.a.plan_start)).slice(0, 40).map((r) => pubAct(r, M));
  return { asOf, range: [all[0] || null, all[all.length - 1] || null], groups, milestones, upcoming };
});

// ---- project milestones (PM / admin) ----
const msBody = (b) => {
  const name = str(b.name, 200);
  if (!name) throw bad('Milestone name is required');
  if (!isDate(b.due_date)) throw bad('Due date is required');
  if (b.achieved_date && !isDate(b.achieved_date)) throw bad('Achieved date is invalid');
  return { name, due_date: b.due_date, achieved_date: b.achieved_date || null, tower_id: b.tower_id ? +b.tower_id : null, note: str(b.note) };
};
post('/api/milestones', { roles: MGMT }, ({ user, body }) => {
  const id = insert('project_milestones', msBody(body));
  audit(user, 'create', 'milestone', id, `Milestone "${body.name}" due ${body.due_date}`);
  return { id };
});
put('/api/milestones/:id', { roles: MGMT }, ({ user, params, body }) => {
  const old = q1('SELECT * FROM project_milestones WHERE id=?', +params.id);
  if (!old) throw notFound();
  const n = msBody(body);
  dbUpdate('project_milestones', old.id, n);
  audit(user, n.due_date !== old.due_date ? 'baseline_change' : 'edit', 'milestone', old.id, `Milestone "${n.name}"${n.due_date !== old.due_date ? ` due date ${old.due_date} -> ${n.due_date}` : ''}`, { old, new: n });
  return { ok: true };
});
del('/api/milestones/:id', { roles: MGMT }, ({ user, params }) => {
  const old = q1('SELECT * FROM project_milestones WHERE id=?', +params.id);
  if (!old) throw notFound();
  run('DELETE FROM project_milestones WHERE id=?', old.id);
  audit(user, 'delete', 'milestone', old.id, `Deleted milestone "${old.name}"`, old);
  return { ok: true };
});

get('/api/audit', { roles: MGMT }, ({ query }) => {
  const w = ['1=1'];
  const p = [];
  if (query.entity) (w.push('entity=?'), p.push(query.entity));
  if (query.action) (w.push('action=?'), p.push(query.action));
  if (query.entity_id) (w.push('entity_id=?'), p.push(+query.entity_id));
  if (query.q) (w.push('(summary LIKE ? OR user_name LIKE ?)'), p.push(`%${query.q}%`, `%${query.q}%`));
  const limit = Math.min(+query.limit || 100, 500);
  const total = q1(`SELECT COUNT(*) n FROM audit WHERE ${w.join(' AND ')}`, ...p).n;
  return { total, rows: q(`SELECT * FROM audit WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, limit, +query.offset || 0) };
});
