// Progress engine.
//
// Activity progress  = APPROVED cumulative qty / scope qty  (or approved milestone weights / total milestone weights).
// Effective weight   = tower weight x trade weight (within tower) x activity weight (within tower+trade), each normalised.
//                      => every roll-up (trade, level, tower, project, any filter) is ONE weighted mean of activity %.
// Never-configured inputs (scope, weights, baseline dates) yield null => the UI prints "Not configured".
// Submitted-but-unapproved quantities are tracked separately (pendingQty) and never enter progress.
import { q, getSettings } from './db.js';
import { today, addDays, diffDays, clamp } from './util.js';

export function loadModel() {
  const towers = q('SELECT * FROM towers ORDER BY sort,id');
  const trades = q('SELECT * FROM trades ORDER BY sort,id');
  const levels = q('SELECT * FROM levels ORDER BY tower_id, sort, id');
  const zones = q('SELECT * FROM zones ORDER BY level_id, sort, id');
  const tt = q('SELECT * FROM tower_trades');
  const users = q('SELECT id,name,role,company FROM users');
  const by = (arr) => new Map(arr.map((x) => [x.id, x]));
  return { towers, trades, levels, zones, tt, users, towerMap: by(towers), tradeMap: by(trades), levelMap: by(levels), zoneMap: by(zones), userMap: by(users) };
}

export function plannedPct(a, d) {
  if (!a.plan_start || !a.plan_finish) return null;
  const len = diffDays(a.plan_finish, a.plan_start) + 1;
  if (len <= 0) return null;
  return clamp(((diffDays(d, a.plan_start) + 1) / len) * 100, 0, 100);
}

export function pctAt(r, d) {
  if (r.a.method === 'milestone') {
    if (!(r.msTotal > 0)) return null;
    let w = 0;
    for (const m of r.ms) if (m.achieved_date && m.achieved_date <= d) w += m.weight;
    return (w / r.msTotal) * 100;
  }
  if (!(r.a.scope_qty > 0)) return null;
  let cum = 0;
  for (const [date, c] of r.cum) {
    if (date > d) break;
    cum = c;
  }
  return Math.min(100, (cum / r.a.scope_qty) * 100);
}

export function snapshot(asOf = today()) {
  const S = getSettings();
  const M = loadModel();
  const acts = q('SELECT * FROM activities WHERE active=1');

  // ---- normalised weights ----
  const activeTowers = M.towers.filter((t) => t.active && t.weight > 0);
  const sumT = activeTowers.reduce((s, t) => s + t.weight, 0);
  const ttw = new Map(M.tt.filter((x) => x.weight > 0).map((x) => [x.tower_id + '|' + x.trade_id, x.weight]));
  const sumTT = new Map();
  for (const [k, w] of ttw) {
    const tid = k.split('|')[0];
    sumTT.set(tid, (sumTT.get(tid) || 0) + w);
  }
  const sumA = new Map();
  for (const a of acts) if (a.weight > 0) {
    const k = a.tower_id + '|' + a.trade_id;
    sumA.set(k, (sumA.get(k) || 0) + a.weight);
  }

  const R = new Map();
  for (const a of acts) {
    const tower = M.towerMap.get(a.tower_id);
    const level = M.levelMap.get(a.level_id) || null;
    const zone = M.zoneMap.get(a.zone_id) || null;
    const trade = M.tradeMap.get(a.trade_id);
    const k = a.tower_id + '|' + a.trade_id;
    let w = null;
    if (tower?.active && tower.weight > 0 && ttw.has(k) && a.weight > 0) {
      w = (tower.weight / sumT) * (ttw.get(k) / sumTT.get(String(a.tower_id))) * (a.weight / sumA.get(k));
    }
    R.set(a.id, {
      id: a.id, a, tower, level, zone, trade, w,
      label: [tower?.name, level?.name, zone?.name].filter(Boolean).join(' › '),
      approvedQty: 0, pendingQty: 0, pendingCount: 0, cum: [], ms: [], msTotal: 0, pendingMs: 0,
      lastUpdate: null, lastApproved: null,
    });
  }

  for (const m of q('SELECT * FROM activity_milestones ORDER BY activity_id, sort, id')) {
    const r = R.get(m.activity_id);
    if (!r) continue;
    r.ms.push(m);
    r.msTotal += m.weight;
  }
  const upd = q(`SELECT activity_id, report_date, qty_today, state, milestone_ids FROM updates
                 WHERE state IN ('approved','submitted') AND report_date <= ? ORDER BY report_date, id`, asOf);
  for (const u of upd) {
    const r = R.get(u.activity_id);
    if (!r) continue;
    if (u.state === 'approved') {
      r.approvedQty += u.qty_today;
      r.cum.push([u.report_date, r.approvedQty]);
      r.lastApproved = u.report_date;
    } else {
      r.pendingQty += u.qty_today;
      r.pendingCount++;
      if (u.milestone_ids) try { r.pendingMs += JSON.parse(u.milestone_ids).length; } catch { /* ignore */ }
    }
    if (!r.lastUpdate || u.report_date > r.lastUpdate) r.lastUpdate = u.report_date;
  }

  for (const r of R.values()) {
    const a = r.a;
    r.pct = pctAt(r, asOf);
    r.planned = plannedPct(a, asOf);
    r.variance = r.pct != null && r.planned != null ? r.pct - r.planned : null;
    r.done = a.status === 'completed' || (r.pct != null && r.pct >= 99.99);
    r.overdue = !!a.plan_finish && a.plan_finish < asOf && !r.done;
    r.health = activityHealth(r, S);
    r.remaining = a.method === 'quantity' && a.scope_qty > 0 ? Math.max(0, a.scope_qty - r.approvedQty - r.pendingQty) : null;
    // outdated / missing site update
    const live = !r.done && a.status !== 'on_hold' && (a.status === 'in_progress' || (a.plan_start && a.plan_start <= asOf));
    const since = r.lastUpdate || a.plan_start;
    r.needsUpdate = live && since ? diffDays(asOf, since) > S.stale_days : false;
    r.daysSinceUpdate = r.lastUpdate ? diffDays(asOf, r.lastUpdate) : null;
    r.missingKind = r.needsUpdate ? (r.lastUpdate ? 'outdated' : 'missing') : null;
  }
  return { asOf, S, M, list: [...R.values()], byId: R };
}

export function activityHealth(r, S) {
  if (r.done && r.pct != null) return 'complete';
  if (r.pct == null || r.planned == null) return 'nc';
  if (r.overdue || r.variance <= -S.delayed_pp) return 'delayed';
  if (r.variance <= -S.at_risk_pp || r.a.status === 'on_hold') return 'at_risk';
  return 'on_track';
}

export function groupHealth(actual, planned, done, S) {
  if (done) return 'complete';
  if (actual == null || planned == null) return 'nc';
  const v = actual - planned;
  return v <= -S.delayed_pp ? 'delayed' : v <= -S.at_risk_pp ? 'at_risk' : 'on_track';
}

// Weighted roll-up of a set of activity records.
export function rollup(rs, S) {
  const weighted = rs.filter((r) => r.w != null);
  const out = {
    n: rs.length, weighted: weighted.length, excluded: rs.length - weighted.length,
    actual: null, planned: null, variance: null, health: 'nc', reasons: [],
    status: { not_started: 0, in_progress: 0, completed: 0, on_hold: 0 },
    healthCounts: { on_track: 0, at_risk: 0, delayed: 0, complete: 0, nc: 0 },
    overdue: 0, pending: 0, needsUpdate: 0,
  };
  for (const r of rs) {
    out.status[r.a.status] = (out.status[r.a.status] || 0) + 1;
    out.healthCounts[r.health]++;
    if (r.overdue) out.overdue++;
    if (r.pendingCount) out.pending += r.pendingCount;
    if (r.needsUpdate) out.needsUpdate++;
  }
  if (!rs.length) { out.reasons.push('No activities defined'); return out; }
  if (!weighted.length) { out.reasons.push('No progress weights configured'); return out; }
  const sw = weighted.reduce((s, r) => s + r.w, 0);
  const noScope = weighted.filter((r) => r.pct == null).length;
  const noPlan = weighted.filter((r) => r.planned == null).length;
  if (noScope) out.reasons.push(`Scope/milestones not configured for ${noScope} weighted ${noScope === 1 ? 'activity' : 'activities'}`);
  else out.actual = weighted.reduce((s, r) => s + r.w * r.pct, 0) / sw;
  if (noPlan) out.reasons.push(`Baseline dates not configured for ${noPlan} weighted ${noPlan === 1 ? 'activity' : 'activities'}`);
  else out.planned = weighted.reduce((s, r) => s + r.w * r.planned, 0) / sw;
  if (out.actual != null && out.planned != null) out.variance = out.actual - out.planned;
  out.health = groupHealth(out.actual, out.planned, rs.every((r) => r.done), S);
  if (out.excluded) out.reasons.push(`${out.excluded} unweighted ${out.excluded === 1 ? 'activity is' : 'activities are'} excluded`);
  return out;
}

export function matchActivity(r, f) {
  const a = r.a;
  if (f.tower && a.tower_id !== +f.tower) return false;
  if (f.trade && a.trade_id !== +f.trade) return false;
  if (f.level_id && a.level_id !== +f.level_id) return false;
  if (f.level && r.level?.name !== f.level) return false;
  if (f.zone_id && a.zone_id !== +f.zone_id) return false;
  if (f.zone && r.zone?.name !== f.zone) return false;
  if (f.category && a.category !== f.category) return false;
  if (f.contractor && a.contractor !== f.contractor) return false;
  if (f.person && a.engineer_id !== +f.person && a.supervisor_id !== +f.person) return false;
  if (f.status && a.status !== f.status) return false;
  if (f.health && r.health !== f.health) return false;
  if (f.overdue === '1' && !r.overdue) return false;
  if (f.needs_update === '1' && !r.needsUpdate) return false;
  if (f.pending === '1' && !r.pendingCount) return false;
  if (f.q) {
    const t = `${a.name} ${a.category} ${r.label} ${r.trade?.name} ${a.contractor || ''}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => t.includes(w))) return false;
  }
  return true;
}

// Planned vs actual S-curve for a set of activities.
export function curve(rs, asOf, maxPoints = 70) {
  const ws = rs.filter((r) => r.w != null);
  if (!ws.length) return null;
  const planOK = ws.every((r) => r.a.plan_start && r.a.plan_finish);
  const actOK = ws.every((r) => r.pct != null);
  const starts = ws.map((r) => r.a.plan_start).filter(Boolean).sort();
  const fins = ws.map((r) => r.a.plan_finish).filter(Boolean).sort();
  if (!starts.length) return null;
  const from = starts[0];
  const to = [fins[fins.length - 1] || asOf, asOf].sort().pop();
  const span = diffDays(to, from) + 1;
  const step = Math.max(7, Math.ceil(span / maxPoints));
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, step)) dates.push(d);
  if (dates[dates.length - 1] !== to) dates.push(to);
  if (asOf > from && asOf < to && !dates.includes(asOf)) dates.push(asOf), dates.sort();
  const sw = ws.reduce((s, r) => s + r.w, 0);
  return {
    asOf, planOK, actOK,
    points: dates.map((d) => ({
      date: d,
      planned: planOK ? ws.reduce((s, r) => s + r.w * plannedPct(r.a, d), 0) / sw : null,
      actual: actOK && d <= asOf ? ws.reduce((s, r) => s + r.w * pctAt(r, d), 0) / sw : null,
    })),
  };
}

export const groupBy = (arr, fn) => {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

// Compact public shape of an activity record (list rows, drawers, exports).
export function pubAct(r, M) {
  const a = r.a;
  const u = (id) => (id ? M.userMap.get(id)?.name || null : null);
  return {
    id: a.id, name: a.name, category: a.category, method: a.method, uom: a.uom,
    tower_id: a.tower_id, tower: r.tower?.name, level_id: a.level_id, level: r.level?.name || null,
    zone_id: a.zone_id, zone: r.zone?.name || null, trade_id: a.trade_id, trade: r.trade?.name, trade_code: r.trade?.code,
    scope_qty: a.scope_qty, weight: a.weight, eff_weight: r.w, plan_start: a.plan_start, plan_finish: a.plan_finish,
    contractor: a.contractor, engineer_id: a.engineer_id, engineer: u(a.engineer_id), supervisor_id: a.supervisor_id,
    supervisor: u(a.supervisor_id), status: a.status, status_note: a.status_note, actual_start: a.actual_start,
    actual_finish: a.actual_finish, approved_qty: r.approvedQty, pending_qty: r.pendingQty, pending_count: r.pendingCount,
    pct: r.pct, planned: r.planned, variance: r.variance, health: r.health, overdue: r.overdue,
    needs_update: r.needsUpdate, missing_kind: r.missingKind, last_update: r.lastUpdate, days_since_update: r.daysSinceUpdate,
    remaining: r.remaining, ms_total: r.msTotal, label: r.label,
  };
}
