// Schedule: baseline timeline with actual progress, project milestones, upcoming starts.
import { html, raw, api, qs, S, icon, filterBar, filterParams, healthPill, statusPill, pct, pctTxt, variance, table, dt, diffDays, addDays, todayStr, relDay, go, loading, errText, toast, modal, field, selBtn, pickOne, confirmBox, isMgmt, clamp, NC, esc, uom } from '../core.js';
import { showActivity, showActivities, changed } from './drill.js';

const SHORT = { ARCH: 'Architectural', CS: 'C&S', ME: 'M&E' };
const open = new Set();

export async function schedulePage(el) {
  const bar = filterBar(['tower', 'trade', 'contractor', 'person', 'date'], () => schedulePage(el));
  el.innerHTML = String(html`<div class="page-head"><div><h1>Schedule</h1></div></div>${bar.html}${loading(3)}`);
  bar.bind(el);
  let d;
  try { d = await api('/api/schedule' + qs(filterParams())); } catch (e) { el.insertAdjacentHTML('beforeend', `<div class="banner bad">${errText(e)}</div>`); return; }
  const today = todayStr();
  let [from, to] = d.range;
  const msDates = d.milestones.map((m) => m.due_date);
  if (from) from = [from, ...msDates, today].sort()[0]; if (to) to = [to, ...msDates, today].sort().pop();
  const span = from ? Math.max(1, diffDays(to, from)) : 1;
  const x = (dd) => clamp((diffDays(dd, from) / span) * 100, 0, 100);
  const months = [];
  if (from) { const f = new Date(from + 'T00:00:00Z'); const step = span > 700 ? 3 : span > 330 ? 2 : 1; for (let m = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1)); m.toISOString().slice(0, 10) <= to; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + step, 1))) months.push(m.toISOString().slice(0, 10)); }
  const track = (inner) => html`<div class="g-track">${months.map((m) => html`<span class="m" style="left:${x(m)}%"></span>`)}${inner}<span class="g-today" style="left:${x(today)}%"></span></div>`;
  const rowsHtml = [];
  let lastT = null, lastTr = null;
  for (const g of d.groups) {
    const key = `${g.tower_id}|${g.trade_id}|${g.category}`;
    if (g.tower_id !== lastT) { rowsHtml.push(html`<div class="g-row grp" style="background:var(--navy-5)"><div class="lab"><b>${g.tower}</b></div>${track('')}</div>`); lastT = g.tower_id; lastTr = null; }
    if (g.trade_id !== lastTr) { rowsHtml.push(html`<div class="g-row grp"><div class="lab muted" style="padding-left:16px"><b>${g.trade}</b></div>${track('')}</div>`); lastTr = g.trade_id; }
    const isOpen = open.has(key);
    rowsHtml.push(html`<div class="g-row grp"><div class="lab" style="padding-left:28px"><button class="btn btn-ghost btn-sm" data-tg="${key}" aria-expanded="${isOpen}" style="padding:0 6px;min-height:24px" aria-label="Toggle ${g.category}">${isOpen ? '▾' : '▸'}</button><span style="overflow:hidden;text-overflow:ellipsis" title="${g.category}">${g.category}</span> <span class="xs muted">(${g.n})</span></div>
      ${track(g.start ? html`<div class="g-bar clk" data-grp='${JSON.stringify({ tower: g.tower_id, trade: g.trade_id, category: g.category })}' style="left:${x(g.start)}%;width:${Math.max(0.8, x(g.finish) - x(g.start))}%" title="${g.tower} · ${g.category}: planned ${dt(g.start)} – ${dt(g.finish)}; actual ${pctTxt(g.actual)}; planned to date ${pctTxt(g.planned)}"><i style="width:${g.actual ?? 0}%"></i></div><span class="xs" style="position:absolute;top:6px;left:calc(${x(g.finish)}% + 6px);white-space:nowrap">${g.actual == null ? 'n/c' : g.actual.toFixed(0) + '%'} ${g.health === 'delayed' ? '· Delayed' : g.health === 'at_risk' ? '· At risk' : ''}</span>` : html`<span class="xs nc" style="padding:6px">Baseline dates not configured</span>`)}</div>`);
    if (isOpen) for (const it of g.items) rowsHtml.push(html`<div class="g-row item"><div class="lab clk" data-act="${it.id}" title="${it.name}"><span class="small" style="overflow:hidden;text-overflow:ellipsis">${[it.level, it.zone].filter(Boolean).join(' · ') || it.name}</span></div>${track(it.start ? html`<div class="g-bar item clk" data-act="${it.id}" style="left:${x(it.start)}%;width:${Math.max(0.6, x(it.finish) - x(it.start))}%" title="${it.name}: ${dt(it.start)} – ${dt(it.finish)} · ${it.pct == null ? 'n/c' : it.pct.toFixed(0) + '%'}"><i style="width:${it.pct ?? 0}%"></i></div>` : html`<span class="xs nc" style="padding:4px">Not configured</span>`)}</div>`);
  }
  const canEdit = isMgmt();
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Schedule</h1><p>Bars show the baseline plan; the dark fill is approved actual progress. The red line is today (${dt(today)}).</p></div>
      <div class="row gap wrap"><button class="btn" id="exp-all">Expand all</button><button class="btn" id="col-all">Collapse all</button></div></div>
    ${bar.html}
    <div class="card mb" style="padding:0"><div class="tbl-wrap" style="max-height:70vh;overflow:auto">${from ? html`<div class="gantt">
      <div class="g-row head"><div class="lab">Tower · trade · category</div><div class="g-track">${months.map((m) => html`<span class="m" style="left:${x(m)}%"><span style="white-space:nowrap">${new Date(m + 'T00:00:00Z').toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</span></span>`)}</div></div>
      <div class="g-row"><div class="lab"><b>Milestones</b></div>${track(d.milestones.map((m) => html`<span class="g-ms" style="left:${x(m.due_date)}%;${m.achieved_date ? 'background:#12b76a;border-color:#067647' : m.due_date < today ? 'background:#f04438;border-color:#b42318' : ''}" title="${m.name}: ${dt(m.due_date)}${m.achieved_date ? ' (achieved)' : ''}"></span>`))}</div>
      ${rowsHtml}</div>` : html`<div class="empty">No baseline dates configured for the selected activities.</div>`}</div></div>
    <div class="legend" style="margin:-4px 0 16px"><span><i style="background:var(--navy-5);border:1.5px solid var(--navy-3)"></i>Planned window</span><span><i style="background:var(--navy)"></i>Actual progress (approved)</span><span><i style="background:#f79009;transform:rotate(45deg);width:10px;height:10px"></i>Milestone (green = achieved, red = overdue)</span></div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Project milestones</h2>${canEdit ? html`<button class="btn btn-sm" id="ms-add">${icon('plus')} Add</button>` : ''}</div>
        ${table([{ h: 'Milestone', first: true, r: (m) => html`<b>${m.name}</b><span class="sub">${m.tower || 'Project'}</span>` }, { h: 'Due', r: (m) => dt(m.due_date) }, { h: 'Status', r: (m) => m.achieved_date ? html`<span class="pill p-approved">${icon('checkc')}Achieved ${dt(m.achieved_date, false)}</span>` : m.days < 0 ? html`<span class="pill p-delayed">${icon('x')}Overdue ${-m.days}d</span>` : m.days <= 14 ? html`<span class="pill p-at_risk">${icon('clock')}In ${m.days}d</span>` : html`<span class="pill p-nc">In ${m.days}d</span>` }, ...(canEdit ? [{ h: '', r: (m) => html`<span class="row gap"><button class="btn btn-sm" data-msedit="${m.id}">Edit</button>${m.achieved_date ? '' : html`<button class="btn btn-sm btn-ok" data-msdone="${m.id}">Achieved</button>`}</span>` }] : [])], d.milestones, { empty: 'No milestones yet.' })}</div>
      <div class="card"><div class="card-h"><h2>Starting in the next 3 weeks</h2><button class="btn btn-sm" data-ov>Overdue activities</button></div>
        ${table([{ h: 'Activity', first: true, r: (a) => html`<b>${a.name}</b><span class="sub">${[a.tower, a.level, a.zone].filter(Boolean).join(' › ')} · ${a.trade}</span>` }, { h: 'Starts', r: (a) => html`${dt(a.plan_start)}<span class="sub">${relDay(a.plan_start)}</span>` }, { h: 'Responsible', r: (a) => a.engineer || a.supervisor || 'Unassigned' }], d.upcoming, { rowAttrs: (a) => `class="clk" data-act="${a.id}"`, empty: 'Nothing scheduled to start in the next 3 weeks.' })}</div></div>`);
  bar.bind(el);

  const msForm = (m) => {
    const st = { name: m?.name || '', due_date: m?.due_date || addDays(today, 30), tower_id: m?.tower_id || null, note: m?.note || '', achieved_date: m?.achieved_date || null };
    const mm = modal({ title: m ? 'Edit milestone' : 'Add milestone', body: '' });
    const paint = () => { mm.body(html`${field('Milestone name *', html`<input id="m-n" value="${st.name}" maxlength="200">`, { id: 'm-n' })}${field('Tower', selBtn('tw', 'Tower', st.tower_id ? S.meta.towers.find((t) => t.id === st.tower_id)?.name : 'Whole project'))}${field('Due date *', html`<input type="date" id="m-d" value="${st.due_date}">`, { id: 'm-d' })}${field('Achieved date', html`<input type="date" id="m-a" value="${st.achieved_date || ''}">`, { hint: 'Leave empty until achieved.' })}${field('Note', html`<input id="m-o" value="${st.note}">`)}<div class="err" id="m-e" hidden></div>${m ? html`<button class="btn btn-danger btn-sm" id="m-del">Delete milestone</button>` : ''}`); mm.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="m-save">Save</button>`); };
    const rd = () => { st.name = mm.$('#m-n').value; st.due_date = mm.$('#m-d').value; st.achieved_date = mm.$('#m-a').value || null; st.note = mm.$('#m-o').value; };
    paint();
    mm.el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-pick="tw"]')) { rd(); const r = await pickOne({ title: 'Tower', options: S.meta.towers.map((t) => ({ value: t.id, label: t.name })), value: st.tower_id, clearLabel: 'Whole project' }); if (r) { st.tower_id = r.value; paint(); } }
      if (e.target.closest('#m-save')) { rd(); try { await api(m ? `/api/milestones/${m.id}` : '/api/milestones', { method: m ? 'PUT' : 'POST', body: st }); mm.close(); toast('Milestone saved', 'ok'); changed(); } catch (er) { const x = mm.$('#m-e'); x.hidden = false; x.textContent = errText(er); } }
      if (e.target.closest('#m-del')) { const c = await confirmBox({ title: 'Delete milestone', message: `Delete "${m.name}"? This is recorded in the audit trail.`, confirm: 'Delete', danger: true }); if (c) { await api(`/api/milestones/${m.id}`, { method: 'DELETE' }); mm.close(); changed(); } }
    });
  };
  el.onclick = async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if ((b = t('[data-tg]'))) { open.has(b.dataset.tg) ? open.delete(b.dataset.tg) : open.add(b.dataset.tg); return schedulePage(el); }
    if (t('#exp-all')) { d.groups.forEach((g) => open.add(`${g.tower_id}|${g.trade_id}|${g.category}`)); return schedulePage(el); }
    if (t('#col-all')) { open.clear(); return schedulePage(el); }
    if ((b = t('[data-act]'))) return showActivity(+b.dataset.act);
    if ((b = t('[data-grp]'))) { const g = JSON.parse(b.dataset.grp); return showActivities(`${S.meta.towers.find((x) => x.id === g.tower).name} · ${g.category}`, { ...filterParams(), ...g, sort: 'finish' }); }
    if (t('[data-ov]')) return showActivities('Overdue activities', { ...filterParams(), overdue: '1', sort: 'finish' });
    if (t('#ms-add')) return msForm(null);
    if ((b = t('[data-msedit]'))) return msForm(d.milestones.find((m) => m.id === +b.dataset.msedit));
    if ((b = t('[data-msdone]'))) { const m = d.milestones.find((x) => x.id === +b.dataset.msdone); const c = await confirmBox({ title: 'Mark achieved', message: `Mark "${m.name}" as achieved today?`, confirm: 'Achieved', tone: 'ok' }); if (c) { try { await api(`/api/milestones/${m.id}`, { method: 'PUT', body: { ...m, achieved_date: today } }); toast('Milestone achieved', 'ok'); changed(); } catch (er) { toast(errText(er), 'bad'); } } }
  };
}
