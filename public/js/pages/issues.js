// Issue register: unresolved blockers by tower / trade / owner, overdue highlighting, follow-up.
import { html, raw, api, qs, S, icon, table, prioPill, issueStatusPill, dt, diffDays, todayStr, pickOne, errText, loading, isMgmt, debounce } from '../core.js';
import { showIssue, openIssueForm } from './drill.js';

const st = { status: 'unresolved', tower: null, trade: null, owner: null, priority: null, blocker: false, overdue: false, decision: false, mine: false, q: '' };

export async function issuesPage(el, q = {}) {
  // deep links from the dashboard tiles
  if (q.blocker || q.overdue || q.decision || q.mine || q.tower) {
    Object.assign(st, { status: 'unresolved', blocker: !!q.blocker, overdue: !!q.overdue, decision: !!q.decision, mine: !!q.mine, tower: q.tower || null, trade: null, owner: null, priority: null, q: '' });
    history.replaceState(null, '', '#/issues');
  }
  el.innerHTML = String(html`<div class="page-head"><div><h1>Issues</h1></div></div>${loading(3)}`);
  const params = { status: st.status, tower: st.tower, trade: st.trade, owner: st.owner, priority: st.priority, blocker: st.blocker ? 1 : undefined, overdue: st.overdue ? 1 : undefined, decision: st.decision ? 1 : undefined, mine: st.mine ? 1 : undefined, q: st.q, limit: 300 };
  let r, all;
  try {
    [r, all] = await Promise.all([api('/api/issues' + qs(params)), st.status === 'unresolved' ? null : api('/api/issues?status=unresolved&limit=1000')]);
  } catch (e) { el.innerHTML = `<div class="banner bad">${errText(e)}</div>`; return; }
  const unres = st.status === 'unresolved' ? r : all;
  const rows = r.rows, today = todayStr();
  const pool = unres.rows;
  const cnt = { total: unres.total, blockers: pool.filter((i) => i.is_blocker).length, overdue: pool.filter((i) => i.overdue).length, decision: pool.filter((i) => i.needs_decision).length, critical: pool.filter((i) => i.priority === 'critical').length };
  const owners = [...new Map(pool.map((i) => [i.owner_id, i.owner])).entries()].filter(([id]) => id);
  const chip = (k, label, val, on) => html`<button class="chip ${on ? 'on' : ''}" data-f="${k}">${label}: <b>${val}</b></button>`;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Issues</h1><p>Blockers and follow-ups, with owner, target date and evidence.</p></div><button class="btn btn-primary" id="new">${icon('plus')} Report an issue</button></div>
    <div class="tiles mb">
      <button class="tile clk ${cnt.total ? '' : 'zero'}" data-t="unres"><div class="n">${cnt.total}</div><div class="t">Unresolved</div></button>
      <button class="tile clk ${cnt.blockers ? 'bad' : 'zero'}" data-t="blocker"><div class="n">${cnt.blockers}</div><div class="t">Blockers</div><div class="s">Stopping work</div></button>
      <button class="tile clk ${cnt.overdue ? 'bad' : 'zero'}" data-t="overdue"><div class="n">${cnt.overdue}</div><div class="t">Overdue</div><div class="s">Past target date</div></button>
      <button class="tile clk ${cnt.decision ? 'warn' : 'zero'}" data-t="decision"><div class="n">${cnt.decision}</div><div class="t">Need a decision</div></button>
      <button class="tile clk ${cnt.critical ? 'bad' : 'zero'}" data-t="critical"><div class="n">${cnt.critical}</div><div class="t">Critical priority</div></button></div>
    <div class="tabs" role="tablist">${[['unresolved', 'Unresolved'], ['resolved', 'Resolved (to close)'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => html`<button role="tab" aria-selected="${st.status === k}" data-s="${k}">${l}</button>`)}</div>
    <div class="filters">${chip('tower', 'Tower', st.tower ? S.meta.towers.find((t) => t.id === +st.tower)?.name : 'All', st.tower)}${chip('trade', 'Trade', st.trade ? S.meta.trades.find((t) => t.id === +st.trade)?.name : 'All', st.trade)}${chip('owner', 'Owner', st.owner ? S.meta.users.find((u) => u.id === +st.owner)?.name : 'All', st.owner)}${chip('priority', 'Priority', st.priority || 'All', st.priority)}
      <label class="chip ${st.blocker ? 'on' : ''}"><input type="checkbox" data-c="blocker" ${raw(st.blocker ? 'checked' : '')}> Blockers only</label><label class="chip ${st.overdue ? 'on' : ''}"><input type="checkbox" data-c="overdue" ${raw(st.overdue ? 'checked' : '')}> Overdue only</label>${isMgmt() ? '' : html`<label class="chip ${st.mine ? 'on' : ''}"><input type="checkbox" data-c="mine" ${raw(st.mine ? 'checked' : '')}> Mine</label>`}
      <input type="search" placeholder="Search issues…" id="q" value="${st.q}" style="width:190px;min-height:36px;border-radius:999px" aria-label="Search issues"></div>
    <div class="card">${table([
      { h: 'Issue', first: true, r: (i) => html`<b>${i.code}</b> ${i.title}<span class="sub">${i.activity ? i.activity + ' · ' : ''}${[i.tower, i.level, i.zone].filter(Boolean).join(' › ')}</span>` },
      { h: 'Trade', r: (i) => i.trade || '—' },
      { h: 'Priority', r: (i) => html`${prioPill(i.priority)}${i.is_blocker ? html` <span class="pill p-bad">${icon('warn')}Blocker</span>` : ''}${i.needs_decision ? html` <span class="pill p-at_risk">Decision</span>` : ''}` },
      { h: 'Status', r: (i) => issueStatusPill(i.status) },
      { h: 'Responsible', r: (i) => html`<b>${i.owner || 'Unassigned'}</b><span class="sub">Raised ${dt(i.raised_date, false)} by ${i.raised_by_name || '—'}</span>` },
      { h: 'Target', r: (i) => html`<span class="${i.overdue ? 'var-neg' : ''}">${dt(i.target_date)}</span>${i.overdue ? html`<span class="sub var-neg">${icon('warn')} Overdue ${diffDays(today, i.target_date)} days</span>` : ''}` },
      { h: 'Evidence', r: (i) => html`<span class="small">${i.photos} photo${i.photos === 1 ? '' : 's'} · ${i.comments} comment${i.comments === 1 ? '' : 's'}</span>` },
    ], rows, { rowAttrs: (i) => `class="clk" data-i="${i.id}"`, empty: 'No issues match. 🎉' })}${r.total > rows.length ? html`<p class="muted small">Showing ${rows.length} of ${r.total}.</p>` : ''}</div>`);

  el.onclick = async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if (t('#new')) { if (await openIssueForm({})) issuesPage(el); return; }
    if ((b = t('[data-i]')) && !t('input')) return showIssue(+b.dataset.i);
    if ((b = t('[data-s]'))) { st.status = b.dataset.s; return issuesPage(el); }
    if ((b = t('[data-t]'))) { const k = b.dataset.t; Object.assign(st, { status: 'unresolved', blocker: k === 'blocker', overdue: k === 'overdue', decision: k === 'decision', priority: k === 'critical' ? 'critical' : null }); return issuesPage(el); }
    if ((b = t('[data-f]'))) {
      const k = b.dataset.f;
      const opts = { tower: S.meta.towers.map((x) => ({ value: x.id, label: x.name })), trade: S.meta.trades.map((x) => ({ value: x.id, label: x.name })), owner: (isMgmt() ? S.meta.users : S.meta.users).map((u) => ({ value: u.id, label: u.name, sub: u.company })), priority: ['critical', 'high', 'medium', 'low'].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) }[k];
      const r2 = await pickOne({ title: k[0].toUpperCase() + k.slice(1), options: opts, value: st[k], clearLabel: 'All', searchable: k === 'owner' });
      if (r2) { st[k] = r2.value; issuesPage(el); }
    }
  };
  el.onchange = (e) => { const c = e.target.dataset.c; if (c) { st[c] = e.target.checked; issuesPage(el); } };
  el.oninput = debounce((e) => { if (e.target.id === 'q') { st.q = e.target.value; issuesPage(el).then(() => { const i = el.querySelector('#q'); i.focus(); i.setSelectionRange(999, 999); }); } }, 450);
}
