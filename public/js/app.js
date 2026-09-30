// App shell: sign-in, navigation (sidebar on desktop, tab bar on phones), routing.
import { html, raw, api, S, icon, route, parseHash, matchRoute, go, isMgmt, isStaff, ROLE_LABEL, errText, toast, modal, field, loading, esc, closeAll, view } from './core.js';
import { overview } from './pages/overview.js';
import { towersPage, towerPage } from './pages/towers.js';
import { updatesPage, updateForm, batchPage } from './pages/updates.js';
import { schedulePage } from './pages/schedule.js';
import { issuesPage } from './pages/issues.js';
import { photosPage } from './pages/photos.js';
import { reportsPage } from './pages/reports.js';
import { adminPage } from './pages/admin.js';

const root = document.getElementById('app');
let navBadge = 0;

route('/', (el) => overview(el));
route('/overview', (el) => overview(el));
route('/towers', (el) => towersPage(el));
route('/towers/:id', (el, p) => towerPage(el, p));
route('/updates', (el, p, q) => updatesPage(el, q));
route('/updates/new', (el, p, q) => updateForm(el, { activity: q.activity, date: q.date }));
route('/updates/batch', (el, p, q) => batchPage(el, q));
route('/updates/:id', (el, p) => updateForm(el, { id: +p.id }));
route('/schedule', (el) => schedulePage(el));
route('/issues', (el, p, q) => issuesPage(el, q));
route('/photos', (el) => photosPage(el));
route('/reports', (el) => reportsPage(el));
route('/admin', (el, p, q) => adminPage(el, 'structure'));
route('/admin/:tab', (el, p) => adminPage(el, p.tab));

const NAV = [
  ['/overview', 'overview', 'Overview', ['pm', 'admin', 'engineer', 'supervisor'], 'My Work'],
  ['/towers', 'towers', 'Towers', ['pm', 'admin']],
  ['/updates', 'updates', 'Progress Updates', ['pm', 'admin', 'engineer', 'supervisor']],
  ['/schedule', 'schedule', 'Schedule', ['pm', 'admin', 'engineer', 'supervisor']],
  ['/issues', 'issues', 'Issues', ['pm', 'admin', 'engineer', 'supervisor']],
  ['/photos', 'photos', 'Photos', ['pm', 'admin', 'engineer', 'supervisor']],
  ['/reports', 'reports', 'Reports', ['pm', 'admin']],
  ['/admin', 'admin', 'Administration', ['pm', 'admin']],
];
const navFor = () => NAV.filter((n) => n[3].includes(S.user.role)).map((n) => ({ href: n[0], ic: n[1], label: isStaff() && n[4] ? n[4] : n[2] }));

function shell() {
  const items = navFor();
  const tab = isMgmt() ? ['/overview', '/updates', '/issues', '/schedule'] : ['/overview', '/updates', '/issues', '/photos'];
  const path = '/' + (parseHash().path.split('/')[1] || 'overview');
  const cur = (h) => (path === h || (path === '/' && h === '/overview') ? 'on' : '');
  root.innerHTML = String(html`
    <aside class="side" aria-label="Main navigation"><div class="brand"><b>${S.project}</b><span>Construction progress</span></div>
      <nav class="nav">${items.map((n) => html`<a href="#${n.href}" class="${cur(n.href)}" data-nav="${n.href}">${icon(n.ic)}<span>${n.label}</span>${n.href === '/updates' && navBadge ? html`<span class="badge">${navBadge}</span>` : ''}</a>`)}</nav>
      <div class="user"><b>${S.user.name}</b>${ROLE_LABEL[S.user.role]}<br><button class="btn btn-sm" id="pw">Change password</button> <button class="btn btn-sm" id="logout">${icon('logout')} Sign out</button></div></aside>
    <div class="main"><header class="top"><span class="title" id="page-title">${S.project}</span>${S.demo ? html`<span class="demo-badge" title="All towers, users, quantities, photos and progress shown are sample data">DEMONSTRATION DATA</span>` : ''}<span class="spacer"></span><span class="muted small" style="display:none" id="clock"></span><button class="btn btn-sm hide-d" id="logout2" aria-label="Sign out" style="display:none">${icon('logout')}</button></header>
      <main id="view" tabindex="-1" aria-live="polite"></main></div>
    <nav class="tabbar" aria-label="Main navigation">${tab.map((h) => { const n = items.find((x) => x.href === h); return n ? html`<a href="#${h}" class="${cur(h)}">${icon(n.ic)}<span>${n.label.replace('Progress Updates', 'Updates')}</span>${h === '/updates' && navBadge ? html`<span class="badge">${navBadge}</span>` : ''}</a>` : ''; })}<button id="more">${icon('more')}<span>More</span></button></nav>`);
  document.getElementById('logout').onclick = logout;
  document.getElementById('pw').onclick = changePassword;
  document.getElementById('more').onclick = () => {
    const m = modal({ title: 'Menu', body: html`<div class="list">${items.map((n) => html`<a class="li" href="#${n.href}" data-close style="text-decoration:none;color:inherit;align-items:center;justify-content:flex-start;gap:12px">${icon(n.ic)} ${n.label}</a>`)}<button class="li" id="m-pw" style="align-items:center;justify-content:flex-start;gap:12px">${icon('admin')} Change password</button><button class="li" id="m-out" style="align-items:center;justify-content:flex-start;gap:12px">${icon('logout')} Sign out (${S.user.name})</button></div>` });
    m.$('#m-out').onclick = () => { m.close(); logout(); };
    m.$('#m-pw').onclick = () => { m.close(); changePassword(); };
  };
}

async function logout() { try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ } S.user = null; S.meta = null; closeAll(); renderLogin(); }

function changePassword(forced) {
  const m = modal({ title: forced ? 'Choose a new password' : 'Change password', onClose: () => { if (forced && S.user?.must_change) logout(); },
    body: html`${forced ? html`<div class="banner info mb">Your account uses a temporary password. Choose your own to continue.</div>` : ''}${field('Current password', html`<input type="password" id="p0" autocomplete="current-password">`)}${field('New password', html`<input type="password" id="p1" autocomplete="new-password">`, { hint: 'At least 8 characters with a letter and a number.' })}${field('Repeat new password', html`<input type="password" id="p2" autocomplete="new-password">`)}<div class="err" id="perr" hidden></div>`,
    footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="psave">Save password</button>` });
  m.$('#psave').onclick = async () => {
    const e = m.$('#perr'); e.hidden = true;
    if (m.$('#p1').value !== m.$('#p2').value) { e.hidden = false; e.textContent = 'The new passwords do not match'; return; }
    try { await api('/api/password', { method: 'POST', body: { current: m.$('#p0').value, next: m.$('#p1').value } }); S.user.must_change = false; m.close(); toast('Password changed', 'ok'); if (forced) start(); }
    catch (er) { e.hidden = false; e.textContent = errText(er); }
  };
}

async function renderLogin() {
  let demo = { accounts: [] };
  try { demo = await api('/api/demo-accounts'); } catch { /* ignore */ }
  root.innerHTML = String(html`<div class="login"><div class="card"><h1>${S.project}</h1><p class="muted" style="margin-top:0">Construction progress dashboard · Tower A · Tower B · SAMM</p>
    <form id="lf" autocomplete="on">${field('Username', html`<input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>`, { id: 'u' })}${field('Password', html`<input id="p" name="password" type="password" autocomplete="current-password" required>`, { id: 'p' })}
    <div class="err" id="lerr" hidden></div><button class="btn btn-primary btn-lg" style="width:100%;margin-top:8px" type="submit">Sign in</button></form>
    ${demo.accounts.length ? html`<hr style="border:0;border-top:1px solid var(--line-2);margin:18px 0 10px"><div class="banner warn">${icon('info')}<div class="small"><b>Demonstration mode.</b> Sample data only. Tap an account to fill the sign-in form; the shared demo password is listed in the README.</div></div><div class="demo-list">${demo.accounts.map((a) => html`<button type="button" data-u="${a.username}"><span><b>${a.name}</b><br><span class="xs muted">${a.username}</span></span><span class="muted small">${ROLE_LABEL[a.role]}</span></button>`)}</div>` : ''}</div></div>`);
  const f = document.getElementById('lf');
  root.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => { document.getElementById('u').value = b.dataset.u; document.getElementById('p').focus(); }));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('lerr'); err.hidden = true;
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try { const r = await api('/api/login', { method: 'POST', body: { username: f.username.value.trim(), password: f.password.value } }); S.user = r.user; await start(); }
    catch (er) { err.hidden = false; err.textContent = errText(er); btn.disabled = false; f.password.select(); }
  };
  document.getElementById('u').focus();
}

async function refreshBadge() {
  if (S.user?.role !== 'pm') { navBadge = 0; return; }
  try { const r = await api('/api/updates?state=submitted&limit=1'); navBadge = r.total; } catch { navBadge = 0; }
  document.querySelectorAll('.nav a[data-nav="/updates"] .badge, .tabbar a[href="#/updates"] .badge').forEach((b) => (b.textContent = navBadge));
}

let seq = 0;
export async function render() {
  if (!S.user || !S.meta) return;
  const my = ++seq;
  const { path, query } = parseHash();
  const m = matchRoute(path === '/' ? '/overview' : path);
  const seg = '/' + (path.split('/')[1] || 'overview');
  document.querySelectorAll('.nav a, .tabbar a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + seg));
  const el = view();
  if (!el) return;
  if (!m) { el.innerHTML = '<div class="empty">Page not found. <a href="#/overview">Go to overview</a></div>'; return; }
  el.onclick = el.onkeydown = null;
  try { await m.handler(el, m.params, query); } catch (e) { if (my === seq) el.innerHTML = String(html`<div class="banner bad">${errText(e)}</div>`); console.error(e); }
  if (my === seq) { document.getElementById('page-title').textContent = document.title = `${S.project} · ${document.querySelector('.nav a.on span')?.textContent || 'Progress'}`; }
}

async function start() {
  if (S.user.must_change) { root.innerHTML = ''; return changePassword(true); }
  S.meta = await api('/api/meta');
  S.project = S.meta.settings.project_name;
  S.demo = S.meta.settings.demo_mode;
  shell();
  if (!location.hash || location.hash === '#/' || location.hash === '#') history.replaceState(null, '', '#/overview');
  refreshBadge();
  render();
}

window.addEventListener('hashchange', () => { closeAll(); if (S.user && S.meta) render(); });
window.addEventListener('avantro:changed', async () => {
  try { S.meta = await api('/api/meta'); } catch { /* ignore */ }
  refreshBadge();
  if (S.user && S.meta) render();
});
window.addEventListener('signedout', () => { toast('Your session ended. Please sign in again.', 'bad'); closeAll(); renderLogin(); });

(async () => {
  try {
    const me = await api('/api/me');
    S.project = me.project; S.demo = me.demo;
    if (me.user) { S.user = me.user; await start(); } else renderLogin();
  } catch (e) {
    root.innerHTML = `<div class="login"><div class="card"><h1>Cannot reach the server</h1><p class="muted">${esc(errText(e))}</p><button class="btn btn-primary" id="retry">Retry</button></div></div>`;
    document.getElementById('retry').onclick = () => location.reload();
  }
})();
