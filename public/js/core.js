// Shared front-end toolkit: safe HTML templating, API client, formatting, pills, overlays, pickers, filters, photo upload.

// ---------------------------------------------------------------- safe html
export class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Safe(s);
const val = (v) => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += val(vals[i]); });
  return new Safe(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- icons
const P = {
  overview: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  towers: '<path d="M4 21V8l6-3v16M10 21V3l10 4v14M2 21h20M14 10h2M14 14h2M14 18h2"/>',
  updates: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  schedule: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  issues: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  reports: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h8"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>', checkc: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>', warn: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>', flag: '<path d="M5 21V4M5 4h13l-2 4 2 4H5"/>', dash: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', pause: '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>', circle: '<circle cx="12" cy="12" r="8"/>',
  half: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor"/>', chev: '<path d="M6 9l6 6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>', send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  save: '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8"/>', download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};
export const icon = (n) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`);

// ---------------------------------------------------------------- state + api
export const S = { user: null, meta: null, demo: false, project: 'Avantro Project' };
export class ApiError extends Error { constructor(status, message, data) { super(message); this.status = status; this.data = data; this.fields = data?.fields; } }
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
export async function api(path, { method = 'GET', body, raw: rawBody, headers } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'avantro', ...headers } };
  if (rawBody) { opts.body = rawBody; opts.headers['Content-Type'] = rawBody.type || 'application/octet-stream'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, opts); } catch { throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.'); }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && S.user) { S.user = null; window.dispatchEvent(new Event('signedout')); }
    throw new ApiError(res.status, data?.error || res.statusText || 'Request failed', data);
  }
  return data;
}

// ---------------------------------------------------------------- formatting
export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
export const NC = html`<span class="nc">Not configured</span>`;
export const pctTxt = (v, d = 1) => (v == null ? 'Not configured' : v.toFixed(d) + '%');
export const pct = (v, d = 1) => (v == null ? NC : html`${v.toFixed(d)}%`);
export function varTxt(v) { return v == null ? 'Not configured' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' pp'; }
export function variance(v) {
  if (v == null) return NC;
  const s = S.meta?.settings || { at_risk_pp: 5, delayed_pp: 15 };
  const c = v <= -s.at_risk_pp ? 'var-neg' : v < -1 ? 'var-warn' : 'var-pos';
  return html`<span class="${c}">${varTxt(v)}</span>`;
}
export const num = (v, d = 2) => (v == null ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: d }));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dt = (d, withYear = true) => { if (!d) return '—'; const [y, m, day] = d.slice(0, 10).split('-'); return `${+day} ${MON[+m - 1]}${withYear ? ' ' + y : ''}`; };
export const dtime = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : `${dt(iso.slice(0, 10))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const pad = (n) => String(n).padStart(2, '0');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export const diffDays = (a, b) => { const f = (s) => Date.UTC(...s.split('-').map((x, i) => (i === 1 ? x - 1 : +x))); return Math.round((f(a) - f(b)) / 864e5); };
export const relDay = (d) => { if (!d) return ''; const n = diffDays(d, todayStr()); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`; };
export const uom = (u) => (u ? u.replace('m2', 'm²').replace('m3', 'm³') : '');
export const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const by = (arr, key = 'id') => new Map(arr.map((x) => [x[key], x]));

// ---------------------------------------------------------------- pills
const HEALTH = { on_track: ['On Track', 'check'], at_risk: ['At Risk', 'warn'], delayed: ['Delayed', 'x'], complete: ['Completed', 'flag'], nc: ['Not configured', 'dash'] };
const STATUS = { not_started: ['Not Started', 'circle'], in_progress: ['In Progress', 'half'], completed: ['Completed', 'checkc'], on_hold: ['On Hold', 'pause'] };
const STATE = { draft: ['Draft (saved)', 'save'], submitted: ['Submitted', 'clock'], approved: ['Approved', 'checkc'], rejected: ['Rejected', 'x'] };
const ISTATUS = { open: ['Open', 'circle'], in_progress: ['In Progress', 'half'], resolved: ['Resolved', 'checkc'], closed: ['Closed', 'check'] };
const PRIO = { critical: ['Critical', 'warn'], high: ['High', 'warn'], medium: ['Medium', 'info'], low: ['Low', 'info'] };
const mk = (map, cls) => (k) => { const [t, i] = map[k] || [k, 'info']; return html`<span class="pill ${cls}${k}">${icon(i)}${t}</span>`; };
export const healthPill = mk(HEALTH, 'p-'); export const statusPill = mk(STATUS, 'p-'); export const statePill = mk(STATE, 'p-'); export const issueStatusPill = mk(ISTATUS, 'p-'); export const prioPill = mk(PRIO, 'p-');
export const STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[0]]));
export const HEALTH_LABEL = Object.fromEntries(Object.entries(HEALTH).map(([k, v]) => [k, v[0]]));
export const STATE_LABEL = Object.fromEntries(Object.entries(STATE).map(([k, v]) => [k, v[0]]));

export function progress(actual, planned, { size = '', pending } = {}) {
  if (actual == null) return NC;
  const tip = `Actual ${actual.toFixed(1)}%${planned != null ? ` · Planned ${planned.toFixed(1)}%` : ''}`;
  return html`<div class="pbl" title="${tip}"><div class="pb ${size}"><i style="width:${clamp(actual)}%"></i>${pending ? html`<i class="pend" style="left:${clamp(actual)}%;width:${clamp(pending, 0, 100 - clamp(actual))}%"></i>` : ''}${planned != null ? html`<b style="left:calc(${clamp(planned)}% - 1px)"></b>` : ''}</div><span>${actual.toFixed(1)}%</span></div>`;
}
export const progressLegend = html`<div class="legend"><span><i style="background:var(--navy)"></i>Actual (approved)</span><span><i style="background:#f79009;width:3px;height:12px"></i>Planned to date</span></div>`;

// generic responsive table: cols [{h, r(row), cls, num, first}] rows [obj]; rowAttrs(row) -> string of attributes
export function table(cols, rows, { rowAttrs, empty = 'Nothing to show.', stack = true } = {}) {
  if (!rows.length) return html`<div class="empty">${empty}</div>`;
  return html`<div class="tbl-wrap"><table class="tbl ${stack ? 'stack' : ''}"><thead><tr>${cols.map((c) => html`<th class="${c.num ? 'num' : ''}">${c.h}</th>`)}</tr></thead><tbody>${rows.map((row, i) => html`<tr ${raw(rowAttrs ? rowAttrs(row, i) : '')}>${cols.map((c) => html`<td data-l="${c.h}" class="${c.num ? 'num' : ''} ${c.first ? 'first' : ''}">${c.r(row, i)}</td>`)}</tr>`)}</tbody></table></div>`;
}
export const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');

// ---------------------------------------------------------------- overlays
const stack = [];
const root = () => document.getElementById('overlay');
function lock() { document.body.style.overflow = stack.length ? 'hidden' : ''; }
function create(kind, { title, body, footer, wide, onClose }) {
  const ov = document.createElement('div');
  ov.className = 'ov' + (kind === 'modal' ? ' center' : '');
  ov.innerHTML = `<div class="${kind === 'modal' ? 'modal' : 'drawer'} ${wide ? (kind === 'modal' ? 'w-md' : 'w-lg') : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dr-h"><h2></h2><button class="btn btn-ghost btn-sm" data-close aria-label="Close" style="font-size:1.4rem;line-height:1">×</button></div><div class="dr-b"></div><div class="dr-f" hidden></div></div>`;
  const ctrl = {
    el: ov, b: ov.querySelector('.dr-b'), f: ov.querySelector('.dr-f'),
    title(t) { ov.querySelector('h2').textContent = t; },
    body(h) { ctrl.b.innerHTML = String(h); },
    footer(h) { ctrl.f.hidden = !h; ctrl.f.innerHTML = h ? String(h) : ''; },
    close(result) { const i = stack.indexOf(ctrl); if (i >= 0) stack.splice(i, 1); ov.remove(); lock(); onClose?.(result); },
    $: (s) => ov.querySelector(s), $$: (s) => [...ov.querySelectorAll(s)],
  };
  ctrl.title(title); ctrl.body(body || ''); ctrl.footer(footer);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) ctrl.close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) ctrl.close(); });
  root().appendChild(ov); stack.push(ctrl); lock();
  setTimeout(() => ov.querySelector('[data-close]')?.focus?.(), 30);
  return ctrl;
}
export const drawer = (o) => create('drawer', o);
export const modal = (o) => create('modal', o);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });
export const closeAll = () => [...stack].reverse().forEach((c) => c.close());

export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3500);
}

export function confirmBox({ title, message, confirm = 'Confirm', danger = false, reason = null, tone } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, onClose: () => { if (!done) resolve(null); },
      body: html`<p style="margin-top:0">${message}</p>${reason ? html`<div class="field"><label for="cb-reason">${reason.label}${reason.required ? ' *' : ''}</label><textarea id="cb-reason" rows="3" placeholder="${reason.placeholder || ''}"></textarea><div class="err" id="cb-err" hidden></div></div>` : ''}`,
      footer: html`<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : tone === 'ok' ? 'btn-ok' : 'btn-primary'}" id="cb-ok">${confirm}</button>`,
    });
    m.$('#cb-ok').onclick = () => {
      const r = m.$('#cb-reason')?.value.trim() || '';
      if (reason?.required && r.length < 3) { const e = m.$('#cb-err'); e.hidden = false; e.textContent = 'Please enter a reason'; m.$('#cb-reason').focus(); return; }
      done = true; m.close(); resolve({ reason: r });
    };
    m.$('#cb-reason')?.focus();
  });
}

// searchable single-choice sheet. Resolves {value} or null if dismissed.
export function pickOne({ title, options, value, clearLabel, searchable = options.length > 7 }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, onClose: () => { if (!done) resolve(null); },
      body: html`${searchable ? html`<div class="field"><input type="search" id="pk-q" placeholder="Type to search…" autocomplete="off" aria-label="Search"></div>` : ''}<div class="picker-list" id="pk-list"></div>`,
    });
    const draw = (term = '') => {
      const words = term.toLowerCase().split(/\s+/).filter(Boolean);
      const list = options.filter((o) => { const hay = `${o.label} ${o.sub || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
      m.$('#pk-list').innerHTML = String(html`${clearLabel ? html`<button data-v="" ${raw(value == null ? 'aria-current="true"' : '')}><span>${clearLabel}</span></button>` : ''}${list.map((o, i) => html`<button data-v="${o.value}" ${raw(String(o.value) === String(value) ? 'aria-current="true"' : '')}><span>${o.label}${o.sub ? html`<span class="sub">${o.sub}</span>` : ''}</span>${o.right ? html`<span class="muted small">${o.right}</span>` : ''}</button>`)}${list.length || clearLabel ? '' : html`<div class="empty">No matches</div>`}`);
    };
    draw();
    m.$('#pk-q')?.addEventListener('input', (e) => draw(e.target.value));
    m.$('#pk-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      done = true; m.close();
      const o = options.find((x) => String(x.value) === b.dataset.v);
      resolve({ value: b.dataset.v === '' ? null : o ? o.value : b.dataset.v });
    });
    m.$('#pk-q')?.focus();
  });
}
export const selBtn = (name, label, current, { disabled = false, ph = 'Select…' } = {}) =>
  html`<button type="button" class="sel ${current ? '' : 'ph'}" data-pick="${name}" ${raw(disabled ? 'disabled' : '')} aria-label="${label}: ${current || 'not selected'}"><span>${current || ph}</span>${icon('chev')}</button>`;

export const field = (label, control, { err, hint, id } = {}) => html`<div class="field ${err ? 'bad' : ''}">${label ? html`<label ${id ? raw(`for="${esc(id)}"`) : ''}>${label}</label>` : ''}${control}${hint ? html`<div class="hint">${hint}</div>` : ''}${err ? html`<div class="err">${err}</div>` : ''}</div>`;

// ---------------------------------------------------------------- photos
export async function resizeImage(file, max = 1600, quality = 0.82) {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) throw new Error('That file is not an image');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This photo format is not supported by your browser. Use JPEG or PNG.'); }
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', quality));
}
export async function uploadPhoto(file, params) {
  const blob = await resizeImage(file);
  return api('/api/photos' + qs(params), { method: 'POST', raw: blob });
}
export const photoUrl = (id) => `/api/photos/${id}/file`;

export function lightbox(photos, index = 0, extra) {
  let i = index;
  const m = modal({ title: 'Photo', wide: true, body: '' });
  const draw = () => {
    const p = photos[i];
    m.title(p.caption || 'Site photo');
    m.body(html`<div style="text-align:center"><img src="${photoUrl(p.id)}" alt="${p.caption || 'Site photo'}" style="max-width:100%;max-height:60vh;border-radius:8px;background:var(--line-2)"></div>
      <div class="row between wrap mt-s"><div class="small">${[p.tower, p.level, p.zone, p.trade].filter(Boolean).join(' › ')}<br><span class="muted">${dt(p.taken_date)}${p.uploader ? ' · ' + p.uploader : ''}${p.is_demo ? ' · DEMO photo' : ''}</span></div>${extra ? extra(p) : ''}</div>
      ${photos.length > 1 ? html`<div class="row between mt"><button class="btn" data-nav="-1">‹ Previous</button><span class="muted small">${i + 1} / ${photos.length}</span><button class="btn" data-nav="1">Next ›</button></div>` : ''}`);
  };
  draw();
  m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) { i = (i + +b.dataset.nav + photos.length) % photos.length; draw(); } });
  return m;
}

// ---------------------------------------------------------------- filters (Overview, Schedule, ...)
const FKEY = 'avantro.filters';
export const F = (() => { try { return JSON.parse(sessionStorage.getItem(FKEY)) || {}; } catch { return {}; } })();
export const saveFilters = () => { try { sessionStorage.setItem(FKEY, JSON.stringify(F)); } catch { /* private mode */ } };
export const resetFilters = () => { for (const k of Object.keys(F)) delete F[k]; saveFilters(); };
export const filterParams = () => ({ tower: F.tower, level: F.level, zone: F.zone, trade: F.trade, contractor: F.contractor, person: F.person, date: F.date });

export function filterBar(fields, onChange) {
  const m = S.meta;
  const optionsFor = {
    tower: () => m.towers.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name })),
    level: () => [...new Set(m.levels.filter((l) => !F.tower || l.tower_id === +F.tower).map((l) => l.name))].map((n) => ({ value: n, label: n })),
    zone: () => [...new Set(m.zones.filter((z) => !F.tower || z.tower_id === +F.tower).map((z) => z.name))].map((n) => ({ value: n, label: n })),
    trade: () => m.trades.map((t) => ({ value: t.id, label: t.name })),
    contractor: () => m.contractors.map((c) => ({ value: c, label: c })),
    person: () => m.users.filter((u) => ['engineer', 'supervisor'].includes(u.role)).map((u) => ({ value: u.id, label: u.name, sub: u.company })),
  };
  const LBL = { tower: 'Tower', level: 'Floor', zone: 'Zone', trade: 'Trade', contractor: 'Contractor', person: 'Responsible' };
  const shown = (k) => { if (F[k] == null) return null; const o = optionsFor[k]().find((x) => String(x.value) === String(F[k])); return o?.label || F[k]; };
  const any = () => fields.some((k) => F[k]);
  const render = () => html`<div class="filters" role="group" aria-label="Filters">${fields.map((k) => k === 'date'
    ? html`<label class="chip ${F.date ? 'on' : ''}">Date <input type="date" class="chip-date" data-f="date" value="${F.date || ''}" max="${todayStr()}" aria-label="As-at date"></label>`
    : html`<button class="chip ${F[k] ? 'on' : ''}" data-f="${k}">${LBL[k]}: <b>${shown(k) || 'All'}</b></button>`)}${any() ? html`<button class="chip x" data-f="clear">Clear filters</button>` : ''}</div>`;
  return {
    html: render(),
    bind(rootEl) {
      rootEl.querySelectorAll('[data-f]').forEach((el) => {
        const k = el.dataset.f;
        if (k === 'date') el.addEventListener('change', () => { F.date = el.value || undefined; saveFilters(); onChange(); });
        else el.addEventListener('click', async () => {
          if (k === 'clear') { for (const f of fields) delete F[f]; saveFilters(); return onChange(); }
          const r = await pickOne({ title: LBL[k], options: optionsFor[k](), value: F[k], clearLabel: `All (${LBL[k].toLowerCase()})` });
          if (!r) return;
          if (r.value == null) delete F[k]; else F[k] = r.value;
          if (k === 'tower') { delete F.level; delete F.zone; }
          saveFilters(); onChange();
        });
      });
    },
  };
}

// ---------------------------------------------------------------- router
const routes = [];
export const route = (pattern, handler) => {
  const keys = [];
  routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'), keys, handler });
};
export const parseHash = () => {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
};
export const go = (hash) => { if (location.hash === '#' + hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };
export function matchRoute(path) {
  for (const r of routes) { const m = r.re.exec(path); if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
  return null;
}
export const isMgmt = () => ['pm', 'admin'].includes(S.user?.role);
export const isStaff = () => ['engineer', 'supervisor'].includes(S.user?.role);
export const ROLE_LABEL = { pm: 'Project Manager', engineer: 'Site Engineer', supervisor: 'Supervisor', admin: 'Administrator' };
export const towerName = (id) => S.meta.towers.find((t) => t.id === +id)?.name || '';
export const userName = (id) => S.meta.users.find((u) => u.id === +id)?.name || '';
export const errText = (e) => (e?.message || 'Something went wrong');
export function view() { return document.getElementById('view'); }
export const loading = (n = 3) => html`<div class="grid">${Array.from({ length: n }, () => html`<div class="skeleton"></div>`)}</div>`;
