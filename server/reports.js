// Daily / weekly / monthly reports as a generic section model, rendered on screen, to PDF and to Excel.
import fs from 'node:fs';
import path from 'node:path';
import { get, MGMT, sendFile } from './router.js';
import { q, UPLOAD_DIR, getSettings } from './db.js';
import { snapshot, rollup, curve } from './calc.js';
import { today, addDays, diffDays, isDate, startOfWeek, monthRange, bad } from './util.js';
import { buildPdf } from './pdf.js';
import { buildXlsx } from './xlsx.js';

const HEALTH = { on_track: ['On Track', '#067647'], at_risk: ['At Risk', '#B54708'], delayed: ['Delayed', '#B42318'], complete: ['Completed', '#175CD3'], nc: ['Not configured', '#667085'] };
const hc = (h) => ({ v: HEALTH[h][0], color: HEALTH[h][1], bold: true });
const pct = (v) => (v == null ? { v: 'Not configured', color: '#667085' } : { v, t: 'pct', bar: v });
const pp = (v, S) => (v == null ? { v: 'Not configured', color: '#667085' } : { v, t: 'pp', color: v <= -S.delayed_pp ? '#B42318' : v <= -S.at_risk_pp ? '#B54708' : '#067647', bold: true });
const PRIO = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export function period(type, date) {
  if (type === 'daily') return { from: date, to: date, label: `Daily report - ${date}` };
  if (type === 'weekly') { const from = startOfWeek(date); return { from, to: addDays(from, 6), label: `Weekly report - ${from} to ${addDays(from, 6)}` }; }
  const [from, to] = monthRange(date);
  return { from, to, label: `Monthly report - ${date.slice(0, 7)}` };
}

export function buildReport({ type, date, tower }) {
  const per = period(type, date);
  const T = today();
  const asOf = per.to < T ? per.to : T;
  const snap = snapshot(asOf);
  const { S, M } = snap;
  const f = tower ? +tower : null;
  const rs = snap.list.filter((r) => !f || r.a.tower_id === f);
  const ids = new Set(rs.map((r) => r.id));
  const towerName = f ? M.towerMap.get(f)?.name : 'All towers';
  const sections = [];

  // 1. progress summary
  const proj = rollup(rs, S);
  const towers = M.towers.filter((t) => t.active && rs.some((r) => r.a.tower_id === t.id));
  const sum = (label, ro) => [{ v: label, bold: true }, pct(ro.actual), pct(ro.planned), pp(ro.variance, S), hc(ro.health), ro.healthCounts.delayed, ro.overdue, ro.pending];
  sections.push({
    id: 'summary', heading: 'Project and tower progress', kind: 'table', sheet: 'Summary',
    note: `Progress as at ${asOf}. Actual = approved quantities only, weighted by the agreed progress weights. Planned = baseline schedule.`,
    columns: [{ label: 'Scope', w: 2.2, width: 26 }, { label: 'Actual', w: 1.6, width: 12, type: 'pct' }, { label: 'Planned', w: 1.6, width: 12, type: 'pct' }, { label: 'Variance', w: 1.4, width: 12, type: 'pp' }, { label: 'Schedule health', w: 1.5, width: 16 }, { label: 'Delayed activities', w: 1.2, align: 'r', width: 12 }, { label: 'Overdue activities', w: 1.2, align: 'r', width: 12 }, { label: 'Updates awaiting approval', w: 1.3, align: 'r', width: 14 }],
    rows: [sum(f ? towerName : 'Overall project', proj), ...(f ? [] : towers.map((t) => sum(t.name, rollup(rs.filter((r) => r.a.tower_id === t.id), S))))],
  });

  // 2. trades
  const trRows = [];
  for (const t of towers) for (const tr of M.trades) {
    const l = rs.filter((r) => r.a.tower_id === t.id && r.a.trade_id === tr.id);
    if (!l.length) continue;
    const ro = rollup(l, S);
    trRows.push([t.name, tr.name, pct(ro.actual), pct(ro.planned), pp(ro.variance, S), hc(ro.health), ro.n]);
  }
  sections.push({
    id: 'trades', heading: 'Trade progress: planned vs actual', kind: 'table', sheet: 'Trades',
    columns: [{ label: 'Tower', w: 1.4, width: 14 }, { label: 'Trade', w: 2, width: 22 }, { label: 'Actual', w: 1.5, type: 'pct', width: 12 }, { label: 'Planned', w: 1.5, type: 'pct', width: 12 }, { label: 'Variance', w: 1.3, type: 'pp', width: 12 }, { label: 'Schedule health', w: 1.5, width: 16 }, { label: 'Activities', w: 1, align: 'r', width: 10 }],
    rows: trRows,
  });

  // 3. work completed (approved in period)
  const done = q(`SELECT u.activity_id, SUM(u.qty_today) qty, COUNT(*) n, MAX(u.uom) uom FROM updates u
    WHERE u.state='approved' AND u.report_date BETWEEN ? AND ? GROUP BY u.activity_id`, per.from, per.to).filter((r) => ids.has(r.activity_id));
  const pend = q("SELECT COUNT(*) n, COALESCE(SUM(qty_today),0) s FROM updates WHERE state='submitted' AND report_date BETWEEN ? AND ?", per.from, per.to);
  const msDone = q("SELECT m.activity_id, m.name FROM activity_milestones m WHERE m.achieved_date BETWEEN ? AND ?", per.from, per.to).filter((m) => ids.has(m.activity_id));
  const workRows = done.map((d) => {
    const r = snap.byId.get(d.activity_id);
    return { r, row: [r.tower.name, [r.level?.name, r.zone?.name].filter(Boolean).join(' / ') || 'Tower-wide', r.trade.name, r.a.name, r.a.method === 'quantity' ? { v: Math.round(d.qty * 100) / 100, t: 'num' } : `${msDone.filter((m) => m.activity_id === r.id).map((m) => m.name).join(', ') || 'milestone'}`, r.a.uom || 'milestone', pct(r.pct), d.n] };
  }).sort((a, b) => a.r.a.tower_id - b.r.a.tower_id || a.r.a.trade_id - b.r.a.trade_id || a.r.a.id - b.r.a.id);
  sections.push({
    id: 'work', heading: 'Work completed during the period', kind: 'table', sheet: 'Work completed',
    note: `${workRows.length} activities progressed (approved quantities only). ${pend[0].n} submitted update(s) in this period are still awaiting approval and are not included.`,
    columns: [{ label: 'Tower', w: 1.1, width: 12 }, { label: 'Location', w: 1.9, width: 22 }, { label: 'Trade', w: 1.5, width: 18 }, { label: 'Activity', w: 3, width: 34 }, { label: 'Qty done in period', w: 1.4, align: 'r', width: 14, type: 'num' }, { label: 'UoM', w: 0.7, width: 8 }, { label: 'Cumulative progress', w: 1.6, type: 'pct', width: 14 }, { label: 'Entries', w: 0.8, align: 'r', width: 8 }],
    rows: workRows.slice(0, 400).map((w) => w.row), empty: 'No approved progress was recorded in this period.',
  });

  // 4. delays, blockers, decisions
  const delayed = rs.filter((r) => r.health === 'delayed').sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0));
  sections.push({
    id: 'delays', heading: 'Delayed activities', kind: 'table', sheet: 'Delays',
    note: `${delayed.length} delayed activities (variance at or below -${S.delayed_pp} pp, or past planned finish and not complete). Worst 40 shown.`,
    columns: [{ label: 'Tower', w: 1, width: 12 }, { label: 'Location', w: 1.7, width: 22 }, { label: 'Trade', w: 1.3, width: 16 }, { label: 'Activity', w: 2.6, width: 32 }, { label: 'Actual', w: 1.3, type: 'pct', width: 10 }, { label: 'Planned', w: 1.3, type: 'pct', width: 10 }, { label: 'Variance', w: 1.2, type: 'pp', width: 12 }, { label: 'Planned finish', w: 1.2, width: 13 }, { label: 'Responsible', w: 1.6, width: 20 }],
    rows: delayed.slice(0, 40).map((r) => [r.tower.name, [r.level?.name, r.zone?.name].filter(Boolean).join(' / ') || 'Tower-wide', r.trade.name, r.a.name, pct(r.pct), pct(r.planned), pp(r.variance, S), r.a.plan_finish || 'Not configured', M.userMap.get(r.a.engineer_id)?.name || M.userMap.get(r.a.supervisor_id)?.name || 'Unassigned']),
    empty: 'No delayed activities.',
  });
  const issues = q(`SELECT i.*, t.name tower, l.name level, tr.name trade, o.name owner FROM issues i JOIN towers t ON t.id=i.tower_id LEFT JOIN levels l ON l.id=i.level_id
    LEFT JOIN trades tr ON tr.id=i.trade_id LEFT JOIN users o ON o.id=i.owner_id WHERE i.status IN ('open','in_progress') ORDER BY i.is_blocker DESC,
    CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.target_date`).filter((i) => !f || i.tower_id === f);
  const issueRow = (i) => [i.code, i.title, `${i.tower}${i.level ? ' / ' + i.level : ''}`, i.trade || '', { v: PRIO[i.priority], bold: i.priority === 'critical' || i.priority === 'high', color: i.priority === 'critical' ? '#B42318' : undefined }, i.is_blocker ? 'BLOCKER' : '', i.owner || 'Unassigned', i.target_date || '', i.target_date && i.target_date < T ? { v: `Overdue ${diffDays(T, i.target_date)}d`, color: '#B42318', bold: true } : ''];
  const issueCols = [{ label: 'Ref', w: 0.9, width: 10 }, { label: 'Issue', w: 3.4, width: 44 }, { label: 'Location', w: 1.5, width: 20 }, { label: 'Trade', w: 1.3, width: 16 }, { label: 'Priority', w: 0.9, width: 10 }, { label: 'Blocker', w: 0.9, width: 10 }, { label: 'Owner', w: 1.4, width: 18 }, { label: 'Target date', w: 1.1, width: 12 }, { label: 'Status', w: 1.1, width: 14 }];
  sections.push({ id: 'issues', heading: 'Open issues and blockers', kind: 'table', sheet: 'Issues', note: `${issues.length} unresolved issues, ${issues.filter((i) => i.is_blocker).length} blockers, ${issues.filter((i) => i.target_date && i.target_date < T).length} overdue.`, columns: issueCols, rows: issues.slice(0, 60).map(issueRow), empty: 'No open issues.' });

  const pendingAll = q("SELECT COUNT(*) n FROM updates WHERE state='submitted'")[0].n;
  const overScope = q("SELECT COUNT(*) n FROM updates WHERE over_scope=1 AND state IN ('submitted','draft')")[0].n;
  const dec = issues.filter((i) => i.needs_decision);
  sections.push({
    id: 'decisions', heading: 'Decisions and actions required from the Project Manager', kind: 'table', sheet: 'Decisions',
    columns: [{ label: 'Item', w: 4 }, { label: 'Detail', w: 5 }],
    rows: [
      ['Progress updates awaiting approval', `${pendingAll} submitted update(s)${overScope ? `, ${overScope} flagged as exceeding scope` : ''}`],
      ['Issues requiring a decision', dec.length ? dec.map((i) => `${i.code} ${i.title}`).join('; ') : 'None'],
      ['Overdue issues', `${issues.filter((i) => i.target_date && i.target_date < T).length}`],
      ['Activities with missing / outdated site updates', `${rs.filter((r) => r.needsUpdate).length}`],
    ],
  });

  // 5. manpower (submitted + approved updates)
  const mp = q(`SELECT u.report_date d, u.manpower m, a.tower_id, a.trade_id FROM updates u JOIN activities a ON a.id=u.activity_id
    WHERE u.state IN ('submitted','approved') AND u.manpower IS NOT NULL AND u.report_date BETWEEN ? AND ?`, per.from, per.to).filter((r) => !f || r.tower_id === f);
  const days = new Set(mp.map((r) => r.d)).size || 1;
  const mpRows = [];
  for (const t of towers) for (const tr of M.trades) {
    const l = mp.filter((r) => r.tower_id === t.id && r.trade_id === tr.id);
    if (!l.length) continue;
    const total = l.reduce((s, r) => s + r.m, 0);
    const byDay = new Map();
    for (const r of l) byDay.set(r.d, (byDay.get(r.d) || 0) + r.m);
    mpRows.push([t.name, tr.name, total, { v: total / (new Set(l.map((r) => r.d)).size || 1), t: 'num' }, Math.max(...byDay.values())]);
  }
  sections.push({
    id: 'manpower', heading: 'Manpower summary', kind: 'table', sheet: 'Manpower',
    note: `Man-days = sum of daily manpower in submitted and approved updates (${days} reporting day${days > 1 ? 's' : ''} in period).`,
    columns: [{ label: 'Tower', w: 1.5, width: 14 }, { label: 'Trade', w: 2, width: 22 }, { label: 'Total man-days', w: 1.4, align: 'r', width: 14, type: 'num' }, { label: 'Average per day', w: 1.4, align: 'r', width: 14, type: 'num' }, { label: 'Peak day', w: 1.2, align: 'r', width: 10, type: 'num' }],
    rows: mpRows, empty: 'No manpower recorded in this period.',
  });

  // 6. photos
  const photos = q(`SELECT p.id,p.caption,p.file,p.taken_date,p.activity_id,t.name tower,l.name level,a.name activity FROM photos p LEFT JOIN towers t ON t.id=p.tower_id
    LEFT JOIN levels l ON l.id=p.level_id LEFT JOIN activities a ON a.id=p.activity_id WHERE p.kind<>'pending' AND p.taken_date BETWEEN ? AND ? ORDER BY p.taken_date DESC, p.id DESC LIMIT 60`, per.from, per.to)
    .filter((p) => !f || !p.activity_id || ids.has(p.activity_id)).slice(0, 12);
  sections.push({ id: 'photos', heading: 'Progress photos', kind: 'photos', photos: photos.map((p) => ({ id: p.id, file: p.file, caption: p.caption || p.activity || 'Site photo', meta: `${p.taken_date} - ${[p.tower, p.level].filter(Boolean).join(' / ')}` })) });

  // 7. upcoming
  const horizon = addDays(per.to, 14);
  const ms = q("SELECT m.*, t.name tower FROM project_milestones m LEFT JOIN towers t ON t.id=m.tower_id WHERE m.achieved_date IS NULL ORDER BY m.due_date")
    .filter((m) => (!f || !m.tower_id || m.tower_id === f) && m.due_date <= addDays(per.to, 45));
  sections.push({
    id: 'milestones', heading: 'Upcoming milestones', kind: 'table', sheet: 'Milestones',
    columns: [{ label: 'Milestone', w: 4, width: 40 }, { label: 'Tower', w: 1.5, width: 14 }, { label: 'Due date', w: 1.3, width: 13 }, { label: 'Status', w: 1.6, width: 18 }],
    rows: ms.map((m) => [m.name, m.tower || 'Project', m.due_date, m.due_date < T ? { v: `Overdue ${diffDays(T, m.due_date)}d`, color: '#B42318', bold: true } : `In ${diffDays(m.due_date, T)} days`]),
    empty: 'No open milestones due in the next 45 days.',
  });
  const upcoming = rs.filter((r) => !r.done && ((r.a.plan_start > per.to && r.a.plan_start <= horizon) || (r.a.plan_finish > per.to && r.a.plan_finish <= horizon && r.a.status !== 'not_started')))
    .sort((a, b) => (a.a.plan_start || '').localeCompare(b.a.plan_start || '')).slice(0, 60);
  sections.push({
    id: 'upcoming', heading: 'Upcoming activities (next 14 days)', kind: 'table', sheet: 'Upcoming',
    columns: [{ label: 'Tower', w: 1, width: 12 }, { label: 'Location', w: 1.8, width: 22 }, { label: 'Trade', w: 1.4, width: 16 }, { label: 'Activity', w: 3, width: 34 }, { label: 'Starts', w: 1.1, width: 12 }, { label: 'Finishes', w: 1.1, width: 12 }, { label: 'Progress', w: 1.4, type: 'pct', width: 12 }, { label: 'Responsible', w: 1.6, width: 20 }],
    rows: upcoming.map((r) => [r.tower.name, [r.level?.name, r.zone?.name].filter(Boolean).join(' / ') || 'Tower-wide', r.trade.name, r.a.name, r.a.plan_start, r.a.plan_finish, pct(r.pct), M.userMap.get(r.a.engineer_id)?.name || M.userMap.get(r.a.supervisor_id)?.name || 'Unassigned']),
    empty: 'No activities scheduled to start or finish in the next 14 days.',
  });

  const st = proj.status;
  return {
    type, period: per, asOf, tower: towerName, project: getSettings().project_name, generated: new Date().toISOString(),
    headline: { actual: proj.actual, planned: proj.planned, variance: proj.variance, health: proj.health, status: st, pending: pendingAll, blockers: issues.filter((i) => i.is_blocker).length, delayed: delayed.length },
    sections,
    curve: curve(rs, asOf, 40),
  };
}

function params(query) {
  const type = ['daily', 'weekly', 'monthly'].includes(query.type) ? query.type : 'daily';
  const date = isDate(query.date) ? query.date : today();
  return { type, date, tower: query.tower ? +query.tower : null };
}

get('/api/report', { roles: MGMT }, ({ query }) => buildReport(params(query)));

get('/api/report/export', { roles: MGMT }, ({ query, user }) => {
  const rep = buildReport(params(query));
  const base = `Avantro-${rep.type}-report-${rep.period.from}${rep.period.to !== rep.period.from ? '_to_' + rep.period.to : ''}${query.tower ? '-' + rep.tower.replace(/\W+/g, '') : ''}`;
  if (query.format === 'xlsx') {
    const sheets = rep.sections.filter((s) => s.kind === 'table').map((s) => ({
      name: s.sheet || s.heading, title: s.heading, subtitle: `${rep.project} - ${rep.period.label} - ${rep.tower}${s.note ? ' - ' + s.note : ''}`,
      columns: s.columns.map((c) => ({ label: c.label, width: c.width || 16, type: c.type, wrap: true })),
      rows: s.rows.map((r) => r.map((c) => (c && typeof c === 'object' ? (typeof c.v === 'number' ? { v: c.v, t: c.t } : c.v) : c))),
    }));
    sheets.push({ name: 'Photos', title: 'Progress photos (list)', subtitle: 'Photos are included in the PDF export.', columns: [{ label: 'Date', width: 12 }, { label: 'Caption', width: 50 }, { label: 'Location', width: 30 }], rows: rep.sections.find((s) => s.kind === 'photos').photos.map((p) => [p.meta.split(' - ')[0], p.caption, p.meta.split(' - ')[1] || '']) });
    return sendFile(buildXlsx(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base + '.xlsx');
  }
  if (query.format === 'pdf') {
    const h = rep.headline;
    const model = {
      project: rep.project, title: rep.period.label, subtitle: `${rep.tower}  |  Progress as at ${rep.asOf}  |  Generated ${new Date().toLocaleString('en-GB')} by ${user.name}`,
      meta: [['Overall actual', h.actual == null ? 'Not configured' : h.actual.toFixed(1) + '%'], ['Planned', h.planned == null ? 'Not configured' : h.planned.toFixed(1) + '%'], ['Variance', h.variance == null ? 'Not configured' : (h.variance >= 0 ? '+' : '') + h.variance.toFixed(1) + ' pp'], ['Schedule health', HEALTH[h.health][0]], ['Awaiting approval', String(h.pending)], ['Blockers', String(h.blockers)]],
      footer: `${rep.project} - ${rep.period.label}` + (getSettings().demo_mode ? ' - DEMONSTRATION DATA' : ''),
      sections: rep.sections.map((s) => s.kind === 'photos' ? { ...s, photos: s.photos.map((p) => { let buffer = null; try { buffer = fs.readFileSync(path.join(UPLOAD_DIR, p.file)); } catch { /* missing */ } return { ...p, buffer }; }) } : s),
    };
    return sendFile(buildPdf(model), 'application/pdf', base + '.pdf');
  }
  throw bad('format must be pdf or xlsx');
});

// Excel export of the activity register (used by Administration and Schedule)
get('/api/export/activities', { roles: MGMT }, ({ query }) => {
  const snap = snapshot(isDate(query.date) ? query.date : today());
  const { M } = snap;
  const rows = snap.list.filter((r) => !query.tower || r.a.tower_id === +query.tower).map((r) => [r.id, r.tower.name, r.level?.name || '', r.zone?.name || '', r.trade.name, r.a.category, r.a.name, r.a.uom || 'milestone', r.a.scope_qty ?? 'Not configured', { v: r.approvedQty, t: 'num' }, { v: r.pendingQty, t: 'num' }, r.pct == null ? 'Not configured' : { v: r.pct, t: 'pct' }, r.planned == null ? 'Not configured' : { v: r.planned, t: 'pct' }, r.variance == null ? 'Not configured' : { v: r.variance, t: 'pp' }, HEALTH[r.health][0], r.a.status, r.a.weight ?? 'Not configured', r.a.plan_start || 'Not configured', r.a.plan_finish || 'Not configured', r.a.contractor || '', M.userMap.get(r.a.engineer_id)?.name || '', M.userMap.get(r.a.supervisor_id)?.name || '']);
  const cols = ['ID', 'Tower', 'Level', 'Zone', 'Trade', 'Category', 'Activity', 'UoM', 'Scope qty', 'Approved qty', 'Pending qty', 'Actual %', 'Planned %', 'Variance', 'Health', 'Status', 'Weight', 'Plan start', 'Plan finish', 'Contractor', 'Engineer', 'Supervisor'];
  return sendFile(buildXlsx([{ name: 'Activities', title: 'Activity register', subtitle: `Progress as at ${snap.asOf}`, columns: cols.map((label, i) => ({ label, width: [6, 10, 12, 12, 16, 14, 34, 8, 11, 11, 11, 10, 10, 10, 12, 12, 8, 12, 12, 20, 20, 20][i], type: ['num', 'pct', 'pp'][[11, 12, 13].indexOf(i)] })), rows }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `Avantro-activities-${snap.asOf}.xlsx`);
});
