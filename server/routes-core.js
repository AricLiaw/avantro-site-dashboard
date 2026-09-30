// Auth, session and shared metadata routes.
import { get, post, ALL, MGMT } from './router.js';
import { q, q1, run, audit, getSettings, update } from './db.js';
import { login, createSession, destroySession, hashPassword, verifyPassword, passwordProblem, destroyUserSessions } from './auth.js';
import { bad, HttpError, str } from './util.js';

const pubUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, company: u.company, must_change: !!u.must_change });

post('/api/login', { public: true }, ({ req, res, body }) => {
  const r = login(String(body.username || ''), String(body.password || ''), req.socket.remoteAddress);
  if (r.error) throw new HttpError(r.status, r.error);
  createSession(req, res, r.user.id);
  audit(r.user, 'login', 'user', r.user.id, 'Signed in');
  return { user: pubUser(r.user) };
});

post('/api/logout', { public: true }, ({ req, res, user }) => {
  if (user) audit(user, 'logout', 'user', user.id, 'Signed out');
  destroySession(req, res);
  return { ok: true };
});

get('/api/demo-accounts', { public: true }, () => {
  if (!getSettings().demo_mode) return { accounts: [] };
  return {
    accounts: q(`SELECT username,name,role FROM users WHERE is_demo=1 AND active=1 ORDER BY
      CASE role WHEN 'pm' THEN 0 WHEN 'admin' THEN 1 WHEN 'engineer' THEN 2 ELSE 3 END, username LIMIT 8`),
    note: 'Demonstration mode: accounts and data are sample data only.',
  };
});

get('/api/me', { public: true }, ({ user }) => ({ user: user ? pubUser(user) : null, project: getSettings().project_name, demo: getSettings().demo_mode }));

post('/api/password', { allowMustChange: true }, ({ req, user, body }) => {
  const u = q1('SELECT * FROM users WHERE id=?', user.id);
  if (!verifyPassword(String(body.current || ''), u.pw_hash)) throw bad('Current password is incorrect');
  const p = passwordProblem(body.next);
  if (p) throw bad(p);
  if (body.next === body.current) throw bad('Choose a different password');
  update('users', user.id, { pw_hash: hashPassword(body.next), must_change: 0 });
  destroyUserSessions(user.id, req);
  audit(user, 'password_change', 'user', user.id, 'Changed own password');
  return { ok: true };
});

// Structure + dropdown data. Same for every signed-in user (contains no progress figures).
get('/api/meta', { roles: ALL }, ({ user }) => {
  const S = getSettings();
  const towers = q('SELECT id,code,name,weight,active,notes FROM towers ORDER BY sort,id');
  const levels = q('SELECT id,tower_id,name,sort FROM levels ORDER BY tower_id, sort, id');
  const zones = q('SELECT z.id,z.level_id,z.name,l.tower_id FROM zones z JOIN levels l ON l.id=z.level_id ORDER BY z.sort,z.id');
  const isMgmt = MGMT.includes(user.role);
  return {
    settings: { project_name: S.project_name, at_risk_pp: S.at_risk_pp, delayed_pp: S.delayed_pp, stale_days: S.stale_days, backdate_days: S.backdate_days, demo_mode: S.demo_mode },
    trades: q('SELECT id,code,name FROM trades ORDER BY sort,id'),
    towers, levels, zones,
    users: q(`SELECT id,name,role,company${isMgmt ? ',username,active' : ''} FROM users WHERE active=1 ORDER BY name`),
    contractors: q("SELECT DISTINCT contractor FROM activities WHERE contractor IS NOT NULL AND contractor<>'' ORDER BY contractor").map((r) => r.contractor),
    catalog: q('SELECT id,trade_id,category,name,uom,method FROM catalog ORDER BY trade_id,id'),
  };
});
