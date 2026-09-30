// Authentication: scrypt password hashes, server-side sessions (HttpOnly cookie), login throttling.
import crypto from 'node:crypto';
import { q1, run, now } from './db.js';

const COOKIE = 'avantro_sid';
const IDLE_MS = 12 * 3600e3;
const ABS_MS = 7 * 24 * 3600e3;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [, s, h] = stored.split('$');
    const calc = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'base64'));
  } catch {
    return false;
  }
}
export const randomPassword = () => crypto.randomBytes(9).toString('base64url');
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 200) return 'Password is too long';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password needs at least one letter and one number';
  return null;
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  run('INSERT INTO sessions (id_hash,user_id,created_at,last_seen,expires_at,ip,ua) VALUES (?,?,?,?,?,?,?)',
    sha(token), userId, t, t, new Date(Date.now() + IDLE_MS).toISOString(), req.socket.remoteAddress, String(req.headers['user-agent'] || '').slice(0, 200));
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ABS_MS / 1000}${secure}`);
}
export function destroySession(req, res) {
  const tok = parseCookies(req)[COOKIE];
  if (tok) run('DELETE FROM sessions WHERE id_hash=?', sha(tok));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}
export function destroyUserSessions(userId, exceptReq) {
  const keep = exceptReq ? parseCookies(exceptReq)[COOKIE] : null;
  run('DELETE FROM sessions WHERE user_id=? AND id_hash<>?', userId, keep ? sha(keep) : '');
}

export function currentUser(req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok) return null;
  const s = q1('SELECT * FROM sessions WHERE id_hash=?', sha(tok));
  if (!s) return null;
  const t = Date.now();
  if (new Date(s.expires_at).getTime() < t || new Date(s.created_at).getTime() + ABS_MS < t) {
    run('DELETE FROM sessions WHERE id_hash=?', s.id_hash);
    return null;
  }
  const u = q1('SELECT id,username,name,role,company,phone,must_change,active FROM users WHERE id=?', s.user_id);
  if (!u || !u.active) return null;
  if (t - new Date(s.last_seen).getTime() > 60e3)
    run('UPDATE sessions SET last_seen=?, expires_at=? WHERE id_hash=?', now(), new Date(t + IDLE_MS).toISOString(), s.id_hash);
  return u;
}

// ---- login throttling (in memory): 6 failures per 15 min per ip+username ----
const fails = new Map();
export function throttled(key) {
  const f = fails.get(key);
  return !!f && f.count >= 6 && Date.now() - f.first < 15 * 60e3;
}
export function noteFail(key) {
  const f = fails.get(key);
  if (!f || Date.now() - f.first > 15 * 60e3) fails.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
export const clearFails = (key) => fails.delete(key);

export function login(username, password, ip) {
  const key = `${ip}|${String(username).toLowerCase()}`;
  if (throttled(key)) return { error: 'Too many failed attempts. Try again in 15 minutes.', status: 429 };
  const u = q1('SELECT * FROM users WHERE username=?', username);
  // constant-ish work even for unknown users
  const ok = u ? verifyPassword(password, u.pw_hash) : (verifyPassword(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'), false);
  if (!ok || !u.active) {
    noteFail(key);
    return { error: 'Incorrect username or password', status: 401 };
  }
  clearFails(key);
  return { user: u };
}
