// Administration: structure, activities & baselines, users, catalog, settings, configuration status, audit trail.
// (Non-ASCII characters are written as \u escapes on purpose so the file survives any tooling.)
import { html, raw, api, qs, S, icon, table, dt, dtime, uom, go, loading, errText, toast, modal, field, selBtn, pickOne, confirmBox, ROLE_LABEL, debounce } from '../core.js';
import { showActivity, changed } from './drill.js';

const DOT = '·', ELL = '…', MINUS = '−';
const TABS = [['structure', 'Structure & weights'], ['activities', 'Activities & baseline'], ['users', 'Users'], ['catalog', 'Activity catalog'], ['settings', 'Settings'], ['status', 'Configuration status'], ['audit', 'Audit trail'], ['data', 'Project data']];
const PM_TABS = ['status', 'audit'];
const isAdmin = () => S.user.role === 'admin';
const errs = (e) => e.fields || {};

export async function adminPage(el, tab = 'structure') {
  const allowed = TABS.filter(([k]) => isAdmin() || PM_TABS.includes(k));
  if (!allowed.some(([k]) => k === tab)) tab = allowed[0][0];
  el.innerHTML = String(html`<div class="page-head"><div><h1>Administration</h1><p>${isAdmin() ? 'Set up towers, floors, zones, activities, weights and users. Changes to agreed baselines are logged.' : 'Read-only view of configuration status and the audit trail. Setup is done by the Administrator.'}</p></div></div>
    <div class="tabs" role="tablist">${allowed.map(([k, l]) => html`<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`)}</div><div id="tab">${loading(2)}</div>`);
  el.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) go('/admin/' + b.dataset.tab); };
  const box = el.querySelector('#tab');
  try { await ({ structure, activities, users, catalog, settings, status, audit, data }[tab])(box, el); } catch (e) { box.innerHTML = `<div class="banner bad">${errText(e)}</div>`; console.error(e); }
}

const rangeNames = (text) => {
  const out = [];
  for (const tok of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(.*?)(\d+)\s*-\s*(\d+)$/.exec(tok);
    if (m && +m[3] >= +m[2] && +m[3] - +m[2] < 200) for (let i = +m[2]; i <= +m[3]; i++) out.push(`${m[1]}${i}`); else out.push(tok);
  }
  return out;
};
const relW = (vals, v) => { const s = vals.reduce((a, b) => a + (b > 0 ? b : 0), 0); return v > 0 && s ? ((v / s) * 100).toFixed(1) + '%' : 'Not configured'; };
const staffOpts = () => S.meta.users.filter((u) => ['engineer', 'supervisor'].includes(u.role)).map((u) => ({ value: u.id, label: u.name, sub: u.company }));

// ================================================================ structure
async function structure(box) {
  const d = await api('/api/admin/structure');
  const paint = () => {
    const tw = d.towers.map((t) => t.weight);
    box.innerHTML = String(html`
      <div class="row between wrap gap mb"><p class="muted small" style="margin:0">Floors, zones and weights are set per tower. Towers do not need the same number of floors or layout. Weights are relative numbers, normalised automatically.</p><button class="btn btn-primary" id="add-tower">${icon('plus')} Add tower / building</button></div>
      ${d.towers.map((t) => html`<div class="card mb" data-tower="${t.id}"><div class="card-h"><div><h2>${t.name} <span class="tag">${t.code}</span> ${t.active ? '' : html`<span class="pill p-nc">Inactive</span>`}</h2><span class="muted small">${t.levels.length} floors/levels ${DOT} ${t.activities} activities${t.notes ? ` ${DOT} ${t.notes}` : ''}</span></div>
        <div class="row gap wrap"><button class="btn btn-sm" data-edit-tower="${t.id}">Edit tower</button></div></div>
        <div class="grid g2 mt-s"><div><h3>Progress weights</h3><div class="small muted mb">Tower weight: <b>${relW(tw, t.weight)}</b> of project${t.weight ? ` (relative value ${t.weight})` : ''}. Trade weights within ${t.name}:</div>
          <div class="grid g3 keep2">${d.trades.map((tr) => html`<div class="field" style="margin:0"><label class="xs" for="tw-${t.id}-${tr.id}">${tr.name.split(' (')[0]}</label><input id="tw-${t.id}-${tr.id}" data-tw="${t.id}|${tr.id}" inputmode="decimal" value="${t.trade_weights[tr.id] ?? ''}" placeholder="Not configured"><span class="xs muted">${relW(Object.values(t.trade_weights), t.trade_weights[tr.id])}</span></div>`)}</div><button class="btn btn-sm mt-s" data-save-tw="${t.id}">Save trade weights</button></div>
        <div><h3>Add floors / levels</h3><div class="field" style="margin:8px 0"><input data-lv-names="${t.id}" placeholder="e.g. Basement 1, Level 1-12, Roof" aria-label="Level names"><span class="hint">Use ranges like "Level 1-12". Order = bottom to top.</span></div><div class="field" style="margin:0 0 8px"><input data-lv-zones="${t.id}" placeholder="Zones / units for each new level (optional): East Wing, West Wing" aria-label="Zone names"></div><button class="btn btn-sm" data-add-levels="${t.id}">Add levels</button></div></div>
        <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Floor / level</th><th>Zones / units</th><th class="num">Activities</th><th></th></tr></thead><tbody>${[...t.levels].reverse().map((l) => html`<tr><td><b>${l.name}</b></td><td>${l.zones.map((z) => html`<span class="chip" style="min-height:26px;padding:1px 4px 1px 10px;margin:0 4px 4px 0">${z.name}<button class="btn btn-ghost btn-sm" style="min-height:22px;padding:0 6px" data-rename-zone="${z.id}" aria-label="Rename ${z.name}">✎</button><button class="btn btn-ghost btn-sm" style="min-height:22px;padding:0 6px;color:var(--bad)" data-del-zone="${z.id}" aria-label="Delete ${z.name}">×</button></span>`)}<button class="btn btn-ghost btn-sm" data-add-zone="${l.id}">+ zone</button></td><td class="num">${l.activities}</td><td class="right nowrap"><button class="btn btn-sm" data-rename-level="${l.id}">Rename</button> <button class="btn btn-sm btn-danger" data-del-level="${l.id}" ${raw(l.activities ? 'disabled title="Has activities"' : '')}>Delete</button></td></tr>`)}</tbody></table></div></div>`)}
      ${d.towers.length ? '' : html`<div class="card empty">No towers yet. Add your first tower or building.</div>`}`);
  };
  paint();
  const reload = async () => { Object.assign(d, await api('/api/admin/structure')); paint(); };
  const towerForm = (t) => {
    const s = { code: t?.code || '', name: t?.name || '', weight: t?.weight ?? '', notes: t?.notes || '', active: t ? !!t.active : true };
    const m = modal({ title: t ? `Edit ${t.name}` : 'Add tower / building', body: '' });
    const paint2 = (e = {}) => {
      m.body(html`${field('Name *', html`<input id="t-n" value="${s.name}" placeholder="e.g. Tower C" maxlength="80">`, { err: e.name, id: 't-n' })}${field('Short code *', html`<input id="t-c" value="${s.code}" placeholder="e.g. C" maxlength="20">`, { err: e.code, id: 't-c' })}${field('Tower weight (relative)', html`<input id="t-w" inputmode="decimal" value="${s.weight}" placeholder="Not configured">`, { hint: 'Share of project progress. Example: 45, 35, 20 for three towers.', err: e.weight })}${field('Notes', html`<input id="t-o" value="${s.notes}">`)}${t ? html`<label class="row gap"><input type="checkbox" id="t-a" ${raw(s.active ? 'checked' : '')}> Active</label>` : ''}${t && !t.activities ? html`<button class="btn btn-danger btn-sm mt" id="t-del">Delete tower</button>` : ''}`);
      m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="t-save">Save</button>`);
    };
    paint2();
    m.el.addEventListener('click', async (e) => {
      if (e.target.closest('#t-del')) { const c = await confirmBox({ title: 'Delete tower', message: `Delete ${t.name}?`, confirm: 'Delete', danger: true }); if (c) { try { await api('/api/admin/towers/' + t.id, { method: 'DELETE' }); m.close(); toast('Tower deleted'); reload(); changed(); } catch (er) { toast(errText(er), 'bad'); } } }
      if (e.target.closest('#t-save')) {
        const body = { name: m.$('#t-n').value, code: m.$('#t-c').value, weight: m.$('#t-w').value, notes: m.$('#t-o').value, active: t ? m.$('#t-a').checked : true };
        Object.assign(s, body);
        try { await api(t ? '/api/admin/towers/' + t.id : '/api/admin/towers', { method: t ? 'PUT' : 'POST', body }); m.close(); toast('Saved', 'ok'); await reload(); changed(); } catch (er) { paint2(errs(er)); if (!er.fields) toast(errText(er), 'bad'); }
      }
    });
  };
  const one = (title, label, value = '') => new Promise((res) => {
    const m = modal({ title, body: field(label, html`<input id="v" value="${value}" maxlength="80">`, { id: 'v' }), footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ok">Save</button>`, onClose: () => res(null) });
    m.$('#v').focus();
    m.$('#ok').onclick = () => { const v = m.$('#v').value; res(v); m.close(); };
    m.$('#v').onkeydown = (e) => e.key === 'Enter' && m.$('#ok').click();
  });
  box.onclick = async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    try {
      if (t('#add-tower')) return towerForm(null);
      if ((b = t('[data-edit-tower]'))) return towerForm(d.towers.find((x) => x.id === +b.dataset.editTower));
      if ((b = t('[data-save-tw]'))) { const id = +b.dataset.saveTw; const weights = {}; box.querySelectorAll(`[data-tw^="${id}|"]`).forEach((i) => { weights[i.dataset.tw.split('|')[1]] = i.value; }); await api(`/api/admin/towers/${id}/trade-weights`, { method: 'PUT', body: { weights } }); toast('Trade weights saved', 'ok'); await reload(); return changed(); }
      if ((b = t('[data-add-levels]'))) { const id = +b.dataset.addLevels; const names = rangeNames(box.querySelector(`[data-lv-names="${id}"]`).value); const zones = rangeNames(box.querySelector(`[data-lv-zones="${id}"]`).value); const r = await api(`/api/admin/towers/${id}/levels`, { method: 'POST', body: { names, zones } }); toast(`Added ${r.added.length} level(s)${r.skipped.length ? `, ${r.skipped.length} already existed` : ''}`, 'ok'); await reload(); return changed(); }
      if ((b = t('[data-add-zone]'))) { const v = await one('Add zones / units', 'Names (comma separated, ranges allowed)'); if (v) { const all = await confirmBox({ title: 'Apply to all floors?', message: 'Add these zones to every floor of the tower? (Cancel adds them to this floor only.)', confirm: 'All floors' }); await api(`/api/admin/levels/${b.dataset.addZone}/zones`, { method: 'POST', body: { names: rangeNames(v), all_levels: !!all } }); await reload(); changed(); } return; }
      if ((b = t('[data-rename-zone]'))) { const z = d.towers.flatMap((x) => x.levels).flatMap((l) => l.zones).find((z) => z.id === +b.dataset.renameZone); const v = await one('Rename zone', 'Zone / unit name', z.name); if (v) { await api('/api/admin/zones/' + z.id, { method: 'PUT', body: { name: v } }); await reload(); changed(); } return; }
      if ((b = t('[data-del-zone]'))) { const c = await confirmBox({ title: 'Delete zone', message: 'Delete this zone?', confirm: 'Delete', danger: true }); if (c) { await api('/api/admin/zones/' + b.dataset.delZone, { method: 'DELETE' }); await reload(); changed(); } return; }
      if ((b = t('[data-rename-level]'))) { const l = d.towers.flatMap((x) => x.levels).find((l) => l.id === +b.dataset.renameLevel); const v = await one('Rename level', 'Floor / level name', l.name); if (v) { await api('/api/admin/levels/' + l.id, { method: 'PUT', body: { name: v } }); await reload(); changed(); } return; }
      if ((b = t('[data-del-level]'))) { const c = await confirmBox({ title: 'Delete level', message: 'Delete this floor/level and its zones?', confirm: 'Delete', danger: true }); if (c) { await api('/api/admin/levels/' + b.dataset.delLevel, { method: 'DELETE' }); await reload(); changed(); } return; }
    } catch (er) { toast(errText(er), 'bad'); }
  };
  box.oninput = (e) => {
    if (!e.target.dataset.tw) return;
    const id = e.target.dataset.tw.split('|')[0];
    const ins = [...box.querySelectorAll(`[data-tw^="${id}|"]`)];
    const vals = ins.map((i) => parseFloat(i.value) || 0);
    ins.forEach((i, k) => { i.nextElementSibling.textContent = relW(vals, vals[k]); });
  };
}

// ================================================================ activities & baselines
const aFilter = { tower: null, trade: null, level: null, q: '' };
async function activities(box) {
  const towers = S.meta.towers;
  if (!aFilter.tower || !towers.some((t) => t.id === +aFilter.tower)) aFilter.tower = towers[0]?.id || null;
  if (!aFilter.tower) { box.innerHTML = '<div class="card empty">Add a tower first (Structure &amp; weights).</div>'; return; }
  box.innerHTML = String(loading(2));
  const r = await api('/api/activities' + qs({ tower: aFilter.tower, trade: aFilter.trade, level_id: aFilter.level, q: aFilter.q, limit: 3000 }));
  const rows = r.rows.slice(0, 150);
  const dirty = new Map();
  const staff = S.meta.users.filter((u) => ['engineer', 'supervisor'].includes(u.role));
  const orig = new Map(r.rows.map((a) => [a.id, a]));
  const sel = new Set();
  const opt = (id) => html`<option value="">Unassigned</option>${staff.map((u) => html`<option value="${u.id}" ${raw(u.id === id ? 'selected' : '')}>${u.name}</option>`)}`;
  box.innerHTML = String(html`
    <div class="filters"><button class="chip on" data-af="tower">Tower: <b>${towers.find((t) => t.id === +aFilter.tower).name}</b></button><button class="chip ${aFilter.trade ? 'on' : ''}" data-af="trade">Trade: <b>${aFilter.trade ? S.meta.trades.find((t) => t.id === +aFilter.trade).name : 'All'}</b></button><button class="chip ${aFilter.level ? 'on' : ''}" data-af="level">Floor: <b>${aFilter.level ? S.meta.levels.find((l) => l.id === +aFilter.level)?.name : 'All'}</b></button><input type="search" id="aq" placeholder="Search${ELL}" value="${aFilter.q}" style="width:170px;min-height:36px;border-radius:999px" aria-label="Search activities">
      <span class="grow"></span><button class="btn" id="gen">${icon('plus')} Generate from catalog</button><button class="btn" id="add1">${icon('plus')} Add one</button><a class="btn" href="/api/export/activities${qs({ tower: aFilter.tower })}">${icon('download')} Excel</a></div>
    <div class="card"><div class="card-h"><h3>${r.total} activities${r.total > rows.length ? ` (first ${rows.length} shown)` : ''}</h3><div class="row gap wrap"><button class="btn btn-sm" id="bulk" disabled>Bulk edit selected${ELL}</button><button class="btn btn-primary btn-sm" id="save" disabled>Save changes</button></div></div>
      <p class="small muted">Edit scope, weight, dates and people directly in the grid. Blank = <b>Not configured</b>. Changing an agreed value asks for a reason and is written to the audit trail.</p>
      <div class="tbl-wrap"><table class="tbl" style="min-width:1100px"><thead><tr><th><input type="checkbox" id="sel-all" aria-label="Select all"></th><th>Activity</th><th>Unit</th><th>Scope</th><th>Weight</th><th>Start</th><th>Finish</th><th>Engineer</th><th>Supervisor</th><th>Subcontractor</th><th></th></tr></thead><tbody>${rows.map((a) => html`<tr data-id="${a.id}"><td><input type="checkbox" data-sel aria-label="Select ${a.name}"></td><td style="min-width:200px"><b>${a.name}</b><span class="sub">${[a.level, a.zone].filter(Boolean).join(' › ') || 'Tower-wide'} ${DOT} ${a.trade}</span></td><td>${a.method === 'milestone' ? 'milestones' : uom(a.uom) || '—'}</td>
        <td>${a.method === 'milestone' ? html`<span class="muted small">${a.ms_total ? a.ms_total + ' milestones' : 'none set'}</span>` : html`<input data-k="scope_qty" inputmode="decimal" value="${a.scope_qty ?? ''}" placeholder="n/c" style="width:96px" aria-label="Scope">`}</td>
        <td><input data-k="weight" inputmode="decimal" value="${a.weight ?? ''}" placeholder="n/c" style="width:84px" aria-label="Weight"></td><td><input type="date" data-k="plan_start" value="${a.plan_start || ''}" style="width:136px" aria-label="Start"></td><td><input type="date" data-k="plan_finish" value="${a.plan_finish || ''}" style="width:136px" aria-label="Finish"></td>
        <td><select data-k="engineer_id" style="width:130px" aria-label="Engineer">${opt(a.engineer_id)}</select></td><td><select data-k="supervisor_id" style="width:130px" aria-label="Supervisor">${opt(a.supervisor_id)}</select></td><td><input data-k="contractor" value="${a.contractor || ''}" style="width:140px" list="cons" aria-label="Subcontractor"></td><td><button class="btn btn-sm" data-edit="${a.id}">Edit</button></td></tr>`)}</tbody></table><datalist id="cons">${S.meta.contractors.map((c) => html`<option value="${c}">`)}</datalist></div></div>`);
  const upd = () => { box.querySelector('#save').disabled = !dirty.size; box.querySelector('#bulk').disabled = !sel.size; box.querySelector('#save').textContent = dirty.size ? `Save changes (${dirty.size})` : 'Save changes'; };
  box.oninput = box.onchange = (e) => {
    const k = e.target.dataset.k;
    if (k) { const id = +e.target.closest('tr').dataset.id; const p = dirty.get(id) || { id }; p[k] = e.target.value; dirty.set(id, p); e.target.style.background = '#fffaeb'; upd(); }
    if (e.target.id === 'aq' && e.type === 'input') { clearTimeout(box.qt); box.qt = setTimeout(() => { aFilter.q = e.target.value; activities(box).then(() => { const i = box.querySelector('#aq'); i.focus(); i.setSelectionRange(99, 99); }); }, 450); }
    if (e.target.id === 'sel-all') { box.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; const id = +c.closest('tr').dataset.id; if (e.target.checked) sel.add(id); else sel.delete(id); }); upd(); }
    if (e.target.matches('[data-sel]')) { const id = +e.target.closest('tr').dataset.id; if (e.target.checked) sel.add(id); else sel.delete(id); upd(); }
  };
  const needsReason = (patches) => patches.some((p) => { const o = orig.get(p.id); return ['scope_qty', 'weight', 'plan_start', 'plan_finish'].some((k) => k in p && o[k] != null && String(o[k]) !== String(p[k])); });
  const saveRows = async (patches, shift) => {
    let reason = '';
    if (shift || needsReason(patches)) {
      const c = await confirmBox({ title: 'Reason for baseline change', message: 'You are changing agreed scope, weights or dates. This is recorded in the audit trail.', confirm: 'Save changes', reason: { label: 'Reason', required: true, placeholder: 'e.g. Approved variation VO-12 / re-baselined after design change' } });
      if (!c) return;
      reason = c.reason;
    }
    try { const r2 = await api('/api/admin/activities/batch-edit', { method: 'POST', body: { rows: patches, reason, shift_days: shift } }); toast(`${r2.updated} activities updated`, 'ok'); changed(); await activities(box); } catch (er) { toast(errText(er), 'bad'); }
  };
  box.onclick = async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if ((b = t('[data-af]'))) {
      const k = b.dataset.af;
      const opts = { tower: towers.map((x) => ({ value: x.id, label: x.name })), trade: S.meta.trades.map((x) => ({ value: x.id, label: x.name })), level: S.meta.levels.filter((l) => l.tower_id === +aFilter.tower).map((l) => ({ value: l.id, label: l.name })).reverse() }[k];
      const p = await pickOne({ title: k, options: opts, value: aFilter[k], clearLabel: k === 'tower' ? null : 'All' });
      if (p) { aFilter[k] = p.value; if (k === 'tower') aFilter.level = null; activities(box); }
      return;
    }
    if (t('#save')) return saveRows([...dirty.values()]);
    if (t('#gen')) return generateForm(box);
    if (t('#add1')) return addForm(box);
    if ((b = t('[data-edit]'))) return editForm(box, orig.get(+b.dataset.edit));
    if (t('#bulk')) return bulkForm([...sel], saveRows);
  };
  upd();
}

function bulkForm(ids, saveRows) {
  const s = { engineer_id: undefined, supervisor_id: undefined };
  const m = modal({ title: `Bulk edit ${ids.length} activities`, body: '' });
  const paint = () => {
    const u = (id) => S.meta.users.find((x) => x.id === id)?.name;
    m.body(html`<p class="small muted" style="margin-top:0">Only fields you fill in are changed.</p><div class="grid2">${field('Weight (same value for all)', html`<input id="b-w" inputmode="decimal" placeholder="leave blank to keep">`)}${field('Shift baseline dates by (days)', html`<input id="b-s" inputmode="numeric" placeholder="e.g. 14 or -7">`, { hint: 'Positive = later. Requires a reason.' })}${field('Set engineer', selBtn('eng', 'Engineer', s.engineer_id === null ? 'Unassigned' : u(s.engineer_id), { ph: 'Keep current' }))}${field('Set supervisor', selBtn('sup', 'Supervisor', s.supervisor_id === null ? 'Unassigned' : u(s.supervisor_id), { ph: 'Keep current' }))}${field('Set subcontractor', html`<input id="b-c" list="cons" placeholder="leave blank to keep">`)}</div>`);
    m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="b-ok">Apply</button>`);
  };
  paint();
  m.el.addEventListener('click', async (e) => {
    const pk = e.target.closest('[data-pick]');
    if (pk) { const w = pk.dataset.pick; const p = await pickOne({ title: w === 'eng' ? 'Engineer' : 'Supervisor', options: staffOpts(), clearLabel: 'Unassigned' }); if (p) { s[w === 'eng' ? 'engineer_id' : 'supervisor_id'] = p.value; paint(); } }
    if (e.target.closest('#b-ok')) {
      const patch = {};
      const w = m.$('#b-w').value.trim(), c = m.$('#b-c').value.trim(), sh = parseInt(m.$('#b-s').value) || 0;
      if (w) patch.weight = w;
      if (c) patch.contractor = c;
      if (s.engineer_id !== undefined) patch.engineer_id = s.engineer_id ?? '';
      if (s.supervisor_id !== undefined) patch.supervisor_id = s.supervisor_id ?? '';
      if (!Object.keys(patch).length && !sh) return toast('Nothing to change');
      m.close();
      saveRows(ids.map((id) => ({ id, ...patch })), sh);
    }
  });
}

function generateForm(box) {
  const tower = S.meta.towers.find((t) => t.id === +aFilter.tower);
  const s = { trade_id: aFilter.trade || S.meta.trades[0].id, levels: new Set(), cat: new Set(), zone_mode: 'level', engineer_id: null, supervisor_id: null };
  const lvls = S.meta.levels.filter((l) => l.tower_id === tower.id);
  const m = modal({ title: `Generate activities ${DOT} ${tower.name}`, wide: true, body: '' });
  const paint = () => {
    const cat = S.meta.catalog.filter((c) => c.trade_id === +s.trade_id);
    m.body(html`<p class="small muted" style="margin-top:0">Creates one activity per selected level (or per zone) for each catalog item. Scope and weight can be entered afterwards in the grid. Existing identical activities are skipped.</p>
      <div class="grid2">${field('Trade', selBtn('trade', 'Trade', S.meta.trades.find((t) => t.id === +s.trade_id).name))}<div class="field"><label>Create</label><div class="seg"><button type="button" data-zm="level" aria-pressed="${s.zone_mode === 'level'}">One per floor</button><button type="button" data-zm="zone" aria-pressed="${s.zone_mode === 'zone'}">One per zone/unit</button></div></div></div>
      <div class="grid2"><div class="field"><label>Floors / levels * <button type="button" class="btn btn-ghost btn-sm" data-all="lv">all</button> <button type="button" class="btn btn-ghost btn-sm" data-none="lv">none</button></label><div style="max-height:190px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">${[...lvls].reverse().map((l) => html`<label class="row gap" style="padding:5px"><input type="checkbox" data-lv="${l.id}" ${raw(s.levels.has(l.id) ? 'checked' : '')}> ${l.name}</label>`)}</div></div>
      <div class="field"><label>Activities from catalog * <button type="button" class="btn btn-ghost btn-sm" data-all="cat">all</button> <button type="button" class="btn btn-ghost btn-sm" data-none="cat">none</button></label><div style="max-height:190px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">${cat.map((c) => html`<label class="row gap" style="padding:5px"><input type="checkbox" data-cat="${c.id}" ${raw(s.cat.has(c.id) ? 'checked' : '')}> <span>${c.name}<span class="sub">${c.category} ${DOT} ${c.method === 'milestone' ? 'milestones' : uom(c.uom)}</span></span></label>`)}</div></div></div>
      <div class="grid3">${field('Planned start', html`<input type="date" id="g-s" value="${s.start || ''}">`)}${field('Planned finish', html`<input type="date" id="g-f" value="${s.fin || ''}">`)}${field('Subcontractor', html`<input id="g-c" list="cons" value="${s.con || ''}">`)}${field('Engineer', selBtn('eng', 'Engineer', S.meta.users.find((u) => u.id === s.engineer_id)?.name, { ph: 'Unassigned' }))}${field('Supervisor', selBtn('sup', 'Supervisor', S.meta.users.find((u) => u.id === s.supervisor_id)?.name, { ph: 'Unassigned' }))}</div><div class="err" id="g-e" hidden></div>`);
    m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="g-ok">Generate</button>`);
  };
  const keep = () => { s.start = m.$('#g-s')?.value; s.fin = m.$('#g-f')?.value; s.con = m.$('#g-c')?.value; };
  paint();
  m.el.addEventListener('change', (e) => { const t = e.target; if (t.dataset.lv) { if (t.checked) s.levels.add(+t.dataset.lv); else s.levels.delete(+t.dataset.lv); } if (t.dataset.cat) { if (t.checked) s.cat.add(+t.dataset.cat); else s.cat.delete(+t.dataset.cat); } });
  m.el.addEventListener('click', async (e) => {
    const t = (x) => e.target.closest(x);
    let b;
    if ((b = t('[data-zm]'))) { keep(); s.zone_mode = b.dataset.zm; return paint(); }
    if ((b = t('[data-all]'))) { keep(); if (b.dataset.all === 'lv') lvls.forEach((l) => s.levels.add(l.id)); else S.meta.catalog.filter((c) => c.trade_id === +s.trade_id).forEach((c) => s.cat.add(c.id)); return paint(); }
    if ((b = t('[data-none]'))) { keep(); (b.dataset.none === 'lv' ? s.levels : s.cat).clear(); return paint(); }
    if ((b = t('[data-pick]'))) {
      keep();
      const w = b.dataset.pick;
      if (w === 'trade') { const p = await pickOne({ title: 'Trade', options: S.meta.trades.map((x) => ({ value: x.id, label: x.name })), value: s.trade_id }); if (p) { s.trade_id = +p.value; s.cat.clear(); paint(); } }
      else { const p = await pickOne({ title: w === 'eng' ? 'Engineer' : 'Supervisor', options: staffOpts(), clearLabel: 'Unassigned' }); if (p) { s[w === 'eng' ? 'engineer_id' : 'supervisor_id'] = p.value; paint(); } }
      return;
    }
    if (t('#g-ok')) {
      keep();
      try {
        const r = await api('/api/admin/activities/generate', { method: 'POST', body: { tower_id: tower.id, trade_id: s.trade_id, level_ids: [...s.levels], catalog_ids: [...s.cat], zone_mode: s.zone_mode, plan_start: s.start, plan_finish: s.fin, contractor: s.con, engineer_id: s.engineer_id, supervisor_id: s.supervisor_id } });
        m.close(); toast(`Created ${r.created} activities${r.skipped ? ` (${r.skipped} already existed)` : ''}. Now enter scope and weights.`, 'ok'); changed(); activities(box);
      } catch (er) { const x = m.$('#g-e'); x.hidden = false; x.textContent = errText(er) + (er.fields ? ': ' + Object.values(er.fields).join(', ') : ''); }
    }
  });
}

function addForm(box) {
  const tower = S.meta.towers.find((t) => t.id === +aFilter.tower);
  const s = { name: '', category: 'General', method: 'quantity', uom: 'm2', trade_id: aFilter.trade || S.meta.trades[0].id, level_id: null, zone_id: null, scope_qty: '', weight: '', plan_start: '', plan_finish: '', contractor: '', ms: '' };
  const m = modal({ title: `Add activity ${DOT} ${tower.name}`, wide: true, body: '' });
  const lv = S.meta.levels.filter((l) => l.tower_id === tower.id);
  const paint = (e = {}) => {
    m.body(html`<div class="grid2">${field('Trade *', selBtn('trade', 'Trade', S.meta.trades.find((t) => t.id === +s.trade_id).name), { err: e.trade_id })}${field('Template from catalog', selBtn('tpl', 'Template', '', { ph: 'Optional: prefill from catalog' }))}
      ${field('Floor / level', selBtn('level', 'Floor', lv.find((l) => l.id === s.level_id)?.name, { ph: 'Tower-wide (no floor)' }), { err: e.level_id })}${field('Zone / unit', selBtn('zone', 'Zone', S.meta.zones.find((z) => z.id === s.zone_id)?.name, { disabled: !s.level_id, ph: 'Whole floor' }), { err: e.zone_id })}</div>
      ${field('Activity name *', html`<input id="a-n" value="${s.name}" maxlength="160">`, { err: e.name, id: 'a-n' })}
      <div class="grid3">${field('Category', html`<input id="a-c" value="${s.category}">`)}<div class="field"><label>Measured by</label><div class="seg"><button type="button" data-meth="quantity" aria-pressed="${s.method === 'quantity'}">Quantity</button><button type="button" data-meth="milestone" aria-pressed="${s.method === 'milestone'}">Milestones</button></div></div>${s.method === 'quantity' ? field('Unit', html`<input id="a-u" value="${s.uom}" maxlength="12">`, { err: e.uom }) : ''}</div>
      ${s.method === 'quantity' ? html`<div class="grid2">${field('Scope quantity', html`<input id="a-q" inputmode="decimal" value="${s.scope_qty}" placeholder="Not configured">`, { err: e.scope_qty })}${field('Weight', html`<input id="a-w" inputmode="decimal" value="${s.weight}" placeholder="Not configured">`, { err: e.weight })}</div>` : html`${field('Milestones (one per line, equal weight)', html`<textarea id="a-ms" rows="4" placeholder="Guide rails installed&#10;Car installed&#10;Testing">${s.ms}</textarea>`)}${field('Weight', html`<input id="a-w" inputmode="decimal" value="${s.weight}" placeholder="Not configured">`, { err: e.weight })}`}
      <div class="grid3">${field('Planned start', html`<input type="date" id="a-s" value="${s.plan_start}">`, { err: e.plan_start })}${field('Planned finish', html`<input type="date" id="a-f" value="${s.plan_finish}">`, { err: e.plan_finish })}${field('Subcontractor', html`<input id="a-k" list="cons" value="${s.contractor}">`)}</div>`);
    m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="a-ok">Add activity</button>`);
  };
  const keep = () => { const g = (x) => m.$(x)?.value; Object.assign(s, { name: g('#a-n') ?? s.name, category: g('#a-c') ?? s.category, uom: g('#a-u') ?? s.uom, scope_qty: g('#a-q') ?? s.scope_qty, weight: g('#a-w') ?? s.weight, plan_start: g('#a-s') ?? s.plan_start, plan_finish: g('#a-f') ?? s.plan_finish, contractor: g('#a-k') ?? s.contractor, ms: g('#a-ms') ?? s.ms }); };
  paint();
  m.el.addEventListener('click', async (e) => {
    const t = (x) => e.target.closest(x);
    let b;
    if ((b = t('[data-meth]'))) { keep(); s.method = b.dataset.meth; return paint(); }
    if ((b = t('[data-pick]'))) {
      keep();
      const w = b.dataset.pick;
      const cfg = { trade: () => [S.meta.trades.map((x) => ({ value: x.id, label: x.name })), s.trade_id], tpl: () => [S.meta.catalog.filter((c) => c.trade_id === +s.trade_id).map((c) => ({ value: c.id, label: c.name, sub: c.category })), null], level: () => [lv.map((l) => ({ value: l.id, label: l.name })).reverse(), s.level_id], zone: () => [S.meta.zones.filter((z) => z.level_id === s.level_id).map((z) => ({ value: z.id, label: z.name })), s.zone_id] }[w]();
      const p = await pickOne({ title: w, options: cfg[0], value: cfg[1], clearLabel: w === 'level' || w === 'zone' ? 'None' : null });
      if (p) {
        if (w === 'trade') s.trade_id = +p.value;
        if (w === 'level') { s.level_id = p.value ? +p.value : null; s.zone_id = null; }
        if (w === 'zone') s.zone_id = p.value ? +p.value : null;
        if (w === 'tpl') { const c = S.meta.catalog.find((x) => x.id === +p.value); Object.assign(s, { name: c.name, category: c.category, method: c.method, uom: c.uom || '' }); }
        paint();
      }
      return;
    }
    if (t('#a-ok')) {
      keep();
      const body = { tower_id: tower.id, ...s, milestones: s.method === 'milestone' ? s.ms.split('\n').map((x) => x.trim()).filter(Boolean).map((name) => ({ name, weight: 1 })) : undefined };
      try { await api('/api/admin/activities', { method: 'POST', body }); m.close(); toast('Activity added', 'ok'); changed(); activities(box); } catch (er) { paint(errs(er)); if (!er.fields) toast(errText(er), 'bad'); }
    }
  });
}

async function editForm(box, a) {
  const det = await api('/api/activities/' + a.id);
  const s = { name: a.name, category: a.category || '', uom: a.uom || '', active: true, ms: det.milestones.map((x) => ({ ...x })) };
  const m = modal({ title: 'Edit activity', wide: true, body: '' });
  const paint = () => {
    m.body(html`${field('Name *', html`<input id="e-n" value="${s.name}" maxlength="160">`, { id: 'e-n' })}<div class="grid3">${field('Category', html`<input id="e-c" value="${s.category}">`)}${a.method === 'quantity' ? field('Unit', html`<input id="e-u" value="${s.uom}" maxlength="12">`) : ''}<div class="field"><label>Status</label><label class="row gap"><input type="checkbox" id="e-a" ${raw(s.active ? 'checked' : '')}> Active (included in progress)</label></div></div>
      ${a.method === 'milestone' ? html`<h4>Milestones</h4><p class="small muted">Weights are relative. Achieved milestones cannot be removed.</p>${s.ms.map((x, i) => html`<div class="row gap mb"><input data-mn="${i}" value="${x.name}" aria-label="Milestone name"><input data-mw="${i}" value="${x.weight}" style="width:80px" inputmode="decimal" aria-label="Weight"><button class="btn btn-sm btn-danger" data-mdel="${i}" ${raw(x.achieved_date ? 'disabled' : '')}>×</button></div>`)}<button class="btn btn-sm" id="e-madd">+ milestone</button>` : ''}
      <div class="mt"><button class="btn btn-danger btn-sm" id="e-del">Delete activity${ELL}</button></div><div class="err mt-s" id="e-e" hidden></div>`);
    m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="e-ok">Save</button>`);
  };
  const keep = () => { s.name = m.$('#e-n').value; s.category = m.$('#e-c').value; if (m.$('#e-u')) s.uom = m.$('#e-u').value; s.active = m.$('#e-a').checked; m.$$('[data-mn]').forEach((i) => { s.ms[+i.dataset.mn].name = i.value; }); m.$$('[data-mw]').forEach((i) => { s.ms[+i.dataset.mw].weight = i.value; }); };
  paint();
  m.el.addEventListener('click', async (e) => {
    const t = (x) => e.target.closest(x);
    let b;
    if (t('#e-madd')) { keep(); s.ms.push({ name: '', weight: 1 }); return paint(); }
    if ((b = t('[data-mdel]'))) { keep(); s.ms.splice(+b.dataset.mdel, 1); return paint(); }
    if (t('#e-del')) { const c = await confirmBox({ title: 'Delete activity', message: 'Delete this activity? If it has progress updates it can only be deactivated.', confirm: 'Delete', danger: true }); if (c) { try { await api('/api/admin/activities/' + a.id, { method: 'DELETE' }); m.close(); toast('Deleted'); changed(); activities(box); } catch (er) { const x = m.$('#e-e'); x.hidden = false; x.textContent = errText(er); } } return; }
    if (t('#e-ok')) {
      keep();
      try { await api('/api/admin/activities/' + a.id, { method: 'PUT', body: { name: s.name, category: s.category, uom: s.uom, active: s.active, milestones: a.method === 'milestone' ? s.ms : undefined, reason: 'Milestones edited' } }); m.close(); toast('Saved', 'ok'); changed(); activities(box); }
      catch (er) { const x = m.$('#e-e'); x.hidden = false; x.textContent = errText(er) + (er.fields ? ': ' + Object.values(er.fields).join(', ') : ''); }
    }
  });
}

// ================================================================ users
async function users(box) {
  const d = await api('/api/admin/users');
  box.innerHTML = String(html`<div class="row between wrap gap mb"><p class="muted small" style="margin:0">Roles: Project Manager (approves, reviews, reports) ${DOT} Site Engineer and Supervisor (update assigned areas only) ${DOT} Administrator (setup). Assign people to activities in <a href="#/admin/activities">Activities &amp; baseline</a>.</p><button class="btn btn-primary" id="add">${icon('plus')} Add user</button></div>
    <div class="card">${table([{ h: 'Name', first: true, r: (u) => html`<b>${u.name}</b><span class="sub">${u.username}${u.is_demo ? ` ${DOT} demo` : ''}</span>` }, { h: 'Role', r: (u) => ROLE_LABEL[u.role] }, { h: 'Company', r: (u) => u.company || '—' }, { h: 'Assigned', num: true, r: (u) => (['engineer', 'supervisor'].includes(u.role) ? u.assigned + ' activities' : '—') }, { h: 'Status', r: (u) => html`${u.active ? html`<span class="pill p-approved">Active</span>` : html`<span class="pill p-nc">Inactive</span>`}${u.must_change ? ' must change password' : ''}` }, { h: '', r: (u) => html`<span class="row gap"><button class="btn btn-sm" data-edit="${u.id}">Edit</button><button class="btn btn-sm" data-reset="${u.id}">Reset password</button></span>` }], d.users)}</div>`);
  const form = (u) => {
    const s = { username: u?.username || '', name: u?.name || '', role: u?.role || 'engineer', company: u?.company || '', phone: u?.phone || '', active: u ? !!u.active : true, password: '' };
    const m = modal({ title: u ? `Edit ${u.name}` : 'Add user', body: '' });
    const paint = (e = {}) => {
      m.body(html`${u ? '' : field('Username *', html`<input id="u-u" value="${s.username}" autocapitalize="none" maxlength="40">`, { err: e.username, id: 'u-u' })}${field('Full name *', html`<input id="u-n" value="${s.name}" maxlength="100">`, { err: e.name, id: 'u-n' })}<div class="field"><label>Role *</label><div class="seg" style="grid-auto-flow:row;grid-template-columns:1fr 1fr">${['engineer', 'supervisor', 'pm', 'admin'].map((r) => html`<button type="button" data-role="${r}" aria-pressed="${s.role === r}">${ROLE_LABEL[r]}</button>`)}</div></div>${field('Company', html`<input id="u-c" value="${s.company}">`)}${field('Phone', html`<input id="u-p" value="${s.phone}">`)}${u ? html`<label class="row gap"><input type="checkbox" id="u-a" ${raw(s.active ? 'checked' : '')}> Active</label>` : field('Temporary password (optional)', html`<input id="u-w" value="${s.password}" autocomplete="off">`, { hint: 'Leave blank to generate one. The user must change it at first sign-in.', err: e.password })}`);
      m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="u-ok">Save</button>`);
    };
    const keep = () => Object.assign(s, { username: m.$('#u-u')?.value ?? s.username, name: m.$('#u-n').value, company: m.$('#u-c').value, phone: m.$('#u-p').value, active: m.$('#u-a') ? m.$('#u-a').checked : true, password: m.$('#u-w')?.value ?? '' });
    paint();
    m.el.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-role]');
      if (r) { keep(); s.role = r.dataset.role; return paint(); }
      if (e.target.closest('#u-ok')) {
        keep();
        try { const res = await api(u ? '/api/admin/users/' + u.id : '/api/admin/users', { method: u ? 'PUT' : 'POST', body: s }); m.close(); changed(); if (res.temp_password) showTemp(s.name, res.temp_password); else toast('User saved', 'ok'); users(box); }
        catch (er) { paint(errs(er)); if (!er.fields) toast(errText(er), 'bad'); }
      }
    });
  };
  const showTemp = (name, pw) => {
    const m = modal({ title: 'Temporary password', body: html`<p style="margin-top:0">Give this temporary password to <b>${name}</b>. It is shown <b>only once</b> and must be changed at first sign-in.</p><input readonly value="${pw}" id="tp" style="font-family:monospace;font-size:1.2rem;text-align:center" aria-label="Temporary password">`, footer: html`<button class="btn" id="cp">Copy</button><button class="btn btn-primary" data-close>Done</button>` });
    m.$('#tp').select();
    m.$('#cp').onclick = () => { navigator.clipboard?.writeText(pw); toast('Copied'); };
  };
  box.onclick = async (e) => {
    if (e.target.closest('#add')) return form(null);
    let b;
    if ((b = e.target.closest('[data-edit]'))) return form(d.users.find((u) => u.id === +b.dataset.edit));
    if ((b = e.target.closest('[data-reset]'))) {
      const u = d.users.find((x) => x.id === +b.dataset.reset);
      const c = await confirmBox({ title: 'Reset password', message: `Generate a new temporary password for ${u.name}? They will be signed out.`, confirm: 'Reset' });
      if (c) { try { const r = await api(`/api/admin/users/${u.id}/reset`, { method: 'POST' }); showTemp(u.name, r.temp_password); } catch (er) { toast(errText(er), 'bad'); } }
    }
  };
}

// ================================================================ catalog
async function catalog(box) {
  const d = await api('/api/admin/catalog');
  box.innerHTML = String(html`<div class="row between wrap gap mb"><p class="muted small" style="margin:0">The catalog lists standard work activities per trade. Use it to generate activities for many floors at once.</p><button class="btn btn-primary" id="add">${icon('plus')} Add catalog activity</button></div>
    ${S.meta.trades.map((tr) => html`<div class="card mb"><h2>${tr.name}</h2>${table([{ h: 'Category', first: true, r: (c) => c.category }, { h: 'Activity', r: (c) => c.name }, { h: 'Measured by', r: (c) => (c.method === 'milestone' ? `Milestones: ${JSON.parse(c.milestones || '[]').join(' → ')}` : uom(c.uom)) }, { h: '', r: (c) => html`<span class="row gap"><button class="btn btn-sm" data-edit="${c.id}">Edit</button><button class="btn btn-sm btn-danger" data-del="${c.id}">Remove</button></span>` }], d.rows.filter((c) => c.trade_id === tr.id))}</div>`)}`);
  const form = (c) => {
    const s = { trade_id: c?.trade_id || S.meta.trades[0].id, category: c?.category || '', name: c?.name || '', uom: c?.uom || 'm2', method: c?.method || 'quantity', milestones: c?.milestones ? JSON.parse(c.milestones).join('\n') : '' };
    const m = modal({ title: c ? 'Edit catalog activity' : 'Add catalog activity', body: '' });
    const paint = (e = {}) => {
      m.body(html`${field('Trade', selBtn('trade', 'Trade', S.meta.trades.find((t) => t.id === +s.trade_id).name), { err: e.trade_id })}${field('Category', html`<input id="c-c" value="${s.category}" placeholder="e.g. Masonry">`)}${field('Activity name *', html`<input id="c-n" value="${s.name}">`, { err: e.name, id: 'c-n' })}<div class="field"><label>Measured by</label><div class="seg"><button type="button" data-meth="quantity" aria-pressed="${s.method === 'quantity'}">Quantity</button><button type="button" data-meth="milestone" aria-pressed="${s.method === 'milestone'}">Milestones</button></div></div>${s.method === 'quantity' ? field('Unit *', html`<input id="c-u" value="${s.uom}" maxlength="12">`, { err: e.uom }) : field('Milestones (one per line) *', html`<textarea id="c-m" rows="4">${s.milestones}</textarea>`, { err: e.milestones })}`);
      m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="c-ok">Save</button>`);
    };
    const keep = () => Object.assign(s, { category: m.$('#c-c').value, name: m.$('#c-n').value, uom: m.$('#c-u')?.value ?? s.uom, milestones: m.$('#c-m')?.value ?? s.milestones });
    paint();
    m.el.addEventListener('click', async (e) => {
      const t = (x) => e.target.closest(x);
      if (t('[data-meth]')) { keep(); s.method = t('[data-meth]').dataset.meth; return paint(); }
      if (t('[data-pick=trade]')) { keep(); const p = await pickOne({ title: 'Trade', options: S.meta.trades.map((x) => ({ value: x.id, label: x.name })), value: s.trade_id }); if (p) { s.trade_id = +p.value; paint(); } return; }
      if (t('#c-ok')) { keep(); try { await api(c ? '/api/admin/catalog/' + c.id : '/api/admin/catalog', { method: c ? 'PUT' : 'POST', body: s }); m.close(); changed(); catalog(box); } catch (er) { paint(errs(er)); if (!er.fields) toast(errText(er), 'bad'); } }
    });
  };
  box.onclick = async (e) => {
    let b;
    if (e.target.closest('#add')) return form(null);
    if ((b = e.target.closest('[data-edit]'))) return form(d.rows.find((c) => c.id === +b.dataset.edit));
    if ((b = e.target.closest('[data-del]'))) { const c = await confirmBox({ title: 'Remove from catalog', message: 'Existing activities are not affected.', confirm: 'Remove', danger: true }); if (c) { await api('/api/admin/catalog/' + b.dataset.del, { method: 'DELETE' }); changed(); catalog(box); } }
  };
}

// ================================================================ settings
async function settings(box) {
  const s = S.meta.settings;
  box.innerHTML = String(html`<div class="card" style="max-width:640px"><h2>Project settings</h2><div class="mt-s"></div>
    ${field('Project name', html`<input id="s-n" value="${s.project_name}" maxlength="100">`, { id: 's-n' })}
    <div class="grid2">${field('At Risk when variance is at or below (pp)', html`<input id="s-r" inputmode="decimal" value="${s.at_risk_pp}">`, { hint: `Variance = actual ${MINUS} planned, in percentage points.` })}${field('Delayed when variance is at or below (pp)', html`<input id="s-d" inputmode="decimal" value="${s.delayed_pp}">`, { hint: 'Also Delayed when past planned finish and not complete.' })}
    ${field('Outdated update after (days)', html`<input id="s-s" inputmode="numeric" value="${s.stale_days}">`, { hint: 'Active activities with no submitted update for this long are flagged.' })}${field('Back-dating limit (days)', html`<input id="s-b" inputmode="numeric" value="${s.backdate_days}">`, { hint: 'How far back site staff may date an update.' })}</div>
    <div class="err" id="s-e" hidden></div><button class="btn btn-primary" id="s-ok">Save settings</button></div>`);
  box.querySelector('#s-ok').onclick = async () => {
    const g = (i) => box.querySelector(i).value;
    try { await api('/api/admin/settings', { method: 'PUT', body: { project_name: g('#s-n'), at_risk_pp: g('#s-r'), delayed_pp: g('#s-d'), stale_days: g('#s-s'), backdate_days: g('#s-b') } }); toast('Settings saved', 'ok'); changed(); }
    catch (er) { const x = box.querySelector('#s-e'); x.hidden = false; x.textContent = errText(er) + (er.fields ? ': ' + Object.values(er.fields).join(', ') : ''); }
  };
}

// ================================================================ configuration status
async function status(box) {
  const d = await api('/api/admin/config-status');
  const T = d.total_gaps;
  const set = html`<span class="pill p-approved">${icon('check')}Set</span>`;
  const notSet = html`<span class="pill p-at_risk">${icon('warn')}Not configured</span>`;
  box.innerHTML = String(html`
    <div class="tiles mb"><div class="tile ${T.weight ? 'warn' : 'ok'}"><div class="n">${T.weight}</div><div class="t">Activities without a weight</div><div class="s">Excluded from roll-ups</div></div><div class="tile ${T.scope ? 'warn' : 'ok'}"><div class="n">${T.scope}</div><div class="t">Without scope / milestones</div><div class="s">Progress "Not configured"</div></div><div class="tile ${T.baseline ? 'warn' : 'ok'}"><div class="n">${T.baseline}</div><div class="t">Without baseline dates</div><div class="s">Planned "Not configured"</div></div><div class="tile ${T.responsible ? 'warn' : 'ok'}"><div class="n">${T.responsible}</div><div class="t">Without responsible person</div><div class="s">Nobody can update them</div></div></div>
    <div class="card mb"><h2>Weights by tower</h2>${table([{ h: 'Tower', first: true, r: (t) => html`<b>${t.name}</b><span class="sub">${t.activities} activities ${DOT} ${t.gaps} with gaps</span>` }, { h: 'Tower weight', r: (t) => (t.tower_weight ? set : notSet) }, ...S.meta.trades.map((tr) => ({ h: tr.name.split(' (')[0], r: (t) => { const x = t.trades.find((y) => y.id === tr.id); return x?.activities ? (x.weight ? set : notSet) : html`<span class="muted">—</span>`; } }))], d.towers)}<p class="small muted">Progress is shown as "Not configured" wherever weights, scope quantities or baseline dates are missing, rather than showing a misleading figure.</p></div>
    <div class="card"><h2>Activities with configuration gaps ${d.list.length ? html`<span class="badge">${d.list.length}${d.list.length >= 300 ? '+' : ''}</span>` : ''}</h2>${table([{ h: 'Activity', first: true, r: (a) => html`<b>${a.name}</b><span class="sub">${S.meta.towers.find((t) => t.id === a.tower_id)?.name} › ${[a.level, a.zone].filter(Boolean).join(' › ') || 'Tower-wide'}</span>` }, { h: 'Missing', r: (a) => a.gaps.map((g) => html`<span class="pill p-at_risk" style="margin:0 4px 4px 0">${g}</span>`) }], d.list, { rowAttrs: (a) => `class="clk" data-a="${a.id}"`, empty: 'Everything is configured.' })}</div>`);
  box.onclick = (e) => { const a = e.target.closest('[data-a]'); if (a) showActivity(+a.dataset.a); };
}

// ================================================================ audit
const au = { entity: '', action: '', q: '', limit: 100 };
async function audit(box) {
  const d = await api('/api/audit' + qs(au));
  box.innerHTML = String(html`<div class="filters"><button class="chip ${au.entity ? 'on' : ''}" data-f="entity">Record: <b>${au.entity || 'All'}</b></button><button class="chip ${au.action ? 'on' : ''}" data-f="action">Action: <b>${au.action || 'All'}</b></button><input type="search" id="aq" placeholder="Search${ELL}" value="${au.q}" style="width:200px;min-height:36px;border-radius:999px" aria-label="Search audit trail"></div>
    <div class="card"><h3>${d.total} entries</h3><p class="small muted">Edits, submissions, approvals, rejections, baseline changes and user actions are recorded and cannot be edited.</p>${table([{ h: 'When', first: true, r: (x) => dtime(x.ts) }, { h: 'Who', r: (x) => x.user_name }, { h: 'Action', r: (x) => html`<span class="tag">${x.action}</span>` }, { h: 'Record', r: (x) => (x.entity ? `${x.entity}${x.entity_id ? ' #' + x.entity_id : ''}` : '') }, { h: 'Details', r: (x) => x.summary }], d.rows)}${d.total > d.rows.length ? html`<button class="btn mt" id="more">Load more</button>` : ''}</div>`);
  box.onclick = async (e) => {
    const b = e.target.closest('[data-f]');
    if (b) {
      const k = b.dataset.f;
      const opts = { entity: ['update', 'issue', 'activity', 'tower', 'level', 'zone', 'user', 'milestone', 'photo', 'catalog', 'settings', 'project', 'system'], action: ['create', 'edit', 'submit', 'approve', 'reject', 'reopen', 'recall', 'copy', 'baseline_change', 'status', 'comment', 'delete', 'login', 'logout', 'upload', 'password_change', 'password_reset', 'reset', 'seed'] }[k].map((v) => ({ value: v, label: v }));
      const p = await pickOne({ title: k, options: opts, value: au[k], clearLabel: 'All' });
      if (p) { au[k] = p.value || ''; audit(box); }
    }
    if (e.target.closest('#more')) { au.limit += 200; audit(box); }
  };
  box.oninput = debounce((e) => { if (e.target.id === 'aq') { au.q = e.target.value; audit(box).then(() => { const i = box.querySelector('#aq'); i.focus(); i.setSelectionRange(99, 99); }); } }, 450);
}

// ================================================================ project data
async function data(box) {
  box.innerHTML = String(html`<div class="card" style="max-width:720px"><h2>Project data</h2>
    ${S.demo ? html`<div class="banner warn mt-s">${icon('warn')}<div><b>Demonstration data is loaded.</b> All towers, users, quantities, photos and progress currently shown are sample data. Clear it before real use.</div></div>` : html`<p class="muted">No demonstration data is loaded.</p>`}
    <h3 class="mt">Clear all project data</h3><p class="small muted">Removes every tower, floor, zone, activity, progress update, issue, photo and all users except you. Trades and the activity catalog stay. The audit trail keeps a record that this was done. <b>This cannot be undone.</b></p>
    <div class="field"><label for="rs">Type RESET to confirm</label><input id="rs" autocomplete="off" style="max-width:220px"></div><button class="btn btn-danger" id="go" disabled>Clear project data</button>
    <hr style="border:0;border-top:1px solid var(--line-2);margin:20px 0"><h3>Backups</h3><p class="small muted">All data lives in <code>data/avantro.db</code> (SQLite) and uploaded photos in <code>data/uploads/</code>. Stop the server and copy the <code>data</code> folder to back up.</p></div>`);
  box.querySelector('#rs').oninput = (e) => { box.querySelector('#go').disabled = e.target.value !== 'RESET'; };
  box.querySelector('#go').onclick = async () => { try { await api('/api/admin/reset', { method: 'POST', body: { confirm: 'RESET' } }); toast('Project data cleared', 'ok'); changed(); go('/admin/structure'); } catch (er) { toast(errText(er), 'bad'); } };
}
