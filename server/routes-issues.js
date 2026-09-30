// Issue register, comments and photo storage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, post, put, del, ALL, STAFF, MGMT } from './router.js';
import { q, q1, insert, update as dbUpdate, run, tx, audit, now, UPLOAD_DIR } from './db.js';
import { today, isDate, str, int01, HttpError, bad, forbidden, notFound } from './util.js';
import { removePhoto } from './routes-updates.js';

const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const PRIO_ORDER = "CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

function canSeeIssue(user, i) {
  if (MGMT.includes(user.role)) return true;
  if (i.owner_id === user.id || i.raised_by === user.id) return true;
  if (i.activity_id) {
    const a = q1('SELECT engineer_id,supervisor_id FROM activities WHERE id=?', i.activity_id);
    return !!a && (a.engineer_id === user.id || a.supervisor_id === user.id);
  }
  return false;
}
const SEL = `SELECT i.*, t.name tower, l.name level, z.name zone, tr.name trade, o.name owner, rb.name raised_by_name, a.name activity,
    CASE WHEN i.status IN ('open','in_progress') AND i.target_date IS NOT NULL AND i.target_date < ? THEN 1 ELSE 0 END overdue,
    (SELECT COUNT(*) FROM photos p WHERE p.issue_id=i.id) photos, (SELECT COUNT(*) FROM issue_comments c WHERE c.issue_id=i.id) comments
  FROM issues i JOIN towers t ON t.id=i.tower_id LEFT JOIN levels l ON l.id=i.level_id LEFT JOIN zones z ON z.id=i.zone_id
  LEFT JOIN trades tr ON tr.id=i.trade_id LEFT JOIN users o ON o.id=i.owner_id LEFT JOIN users rb ON rb.id=i.raised_by
  LEFT JOIN activities a ON a.id=i.activity_id`;

get('/api/issues', { roles: ALL }, ({ user, query }) => {
  const w = ['1=1'];
  const p = [today()];
  if (!MGMT.includes(user.role)) {
    w.push('(i.owner_id=? OR i.raised_by=? OR a.engineer_id=? OR a.supervisor_id=?)');
    p.push(user.id, user.id, user.id, user.id);
  }
  const st = query.status === 'unresolved' || !query.status ? ['open', 'in_progress'] : query.status === 'all' ? null : query.status.split(',');
  if (st) { w.push(`i.status IN (${st.map(() => '?').join(',')})`); p.push(...st); }
  for (const [k, col] of [['tower', 'i.tower_id'], ['trade', 'i.trade_id'], ['level_id', 'i.level_id'], ['zone_id', 'i.zone_id'], ['owner', 'i.owner_id'], ['activity_id', 'i.activity_id']])
    if (query[k]) { w.push(`${col}=?`); p.push(+query[k]); }
  if (query.priority) { w.push('i.priority=?'); p.push(query.priority); }
  if (query.blocker === '1') w.push('i.is_blocker=1');
  if (query.decision === '1') w.push('i.needs_decision=1');
  if (query.overdue === '1') { w.push("i.status IN ('open','in_progress') AND i.target_date < ?"); p.push(today()); }
  if (query.mine === '1') { w.push('(i.owner_id=? OR i.raised_by=?)'); p.push(user.id, user.id); }
  if (query.q) { w.push('(i.title LIKE ? OR i.description LIKE ? OR i.code LIKE ?)'); p.push(...Array(3).fill(`%${query.q}%`)); }
  const where = `WHERE ${w.join(' AND ')}`;
  const rows = q(`${SEL} ${where} ORDER BY overdue DESC, i.is_blocker DESC, ${PRIO_ORDER}, i.target_date IS NULL, i.target_date LIMIT ? OFFSET ?`, ...p, Math.min(+query.limit || 200, 1000), +query.offset || 0);
  const total = q1(`SELECT COUNT(*) n FROM issues i LEFT JOIN activities a ON a.id=i.activity_id ${where}`, ...p.slice(1)).n;
  return { total, rows };
});

get('/api/issues/:id', { roles: ALL }, ({ user, params }) => {
  const i = q1(`${SEL} WHERE i.id=?`, today(), +params.id);
  if (!i || !canSeeIssue(user, i)) throw notFound('Issue not found');
  return {
    issue: i,
    comments: q('SELECT c.*, u.name user_name, u.role user_role FROM issue_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.issue_id=? ORDER BY c.id', i.id),
    photos: q('SELECT id,caption,kind,taken_date,is_demo,uploader_id FROM photos WHERE issue_id=? ORDER BY id', i.id),
    audit: q("SELECT ts,user_name,action,summary FROM audit WHERE entity='issue' AND entity_id=? ORDER BY id DESC", i.id),
  };
});

function issueFields(b, partial) {
  const f = {};
  const e = {};
  if (!partial || b.title !== undefined) { f.title = str(b.title, 200); if (!f.title || f.title.length < 3) e.title = 'Describe the issue'; }
  if (b.description !== undefined) f.description = str(b.description);
  if (b.required_action !== undefined) f.required_action = str(b.required_action);
  if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) e.priority = 'Invalid priority'; f.priority = b.priority; }
  if (b.owner_id !== undefined) {
    f.owner_id = b.owner_id ? +b.owner_id : null;
    if (f.owner_id && !q1('SELECT 1 x FROM users WHERE id=? AND active=1', f.owner_id)) e.owner_id = 'Choose a valid owner';
  }
  if (b.target_date !== undefined) { f.target_date = b.target_date || null; if (f.target_date && !isDate(f.target_date)) e.target_date = 'Invalid date'; }
  if (b.is_blocker !== undefined) f.is_blocker = int01(b.is_blocker);
  if (b.needs_decision !== undefined) f.needs_decision = int01(b.needs_decision);
  if (Object.keys(e).length) throw new HttpError(422, 'Please fix the highlighted fields', { fields: e });
  return f;
}

post('/api/issues', { roles: ALL }, ({ user, body }) => {
  let loc = {};
  if (body.activity_id) {
    const a = q1('SELECT * FROM activities WHERE id=?', +body.activity_id);
    if (!a) throw bad('Activity not found');
    if (STAFF.includes(user.role) && a.engineer_id !== user.id && a.supervisor_id !== user.id) throw forbidden('You are not assigned to this activity');
    loc = { tower_id: a.tower_id, level_id: a.level_id, zone_id: a.zone_id, trade_id: a.trade_id, activity_id: a.id };
  } else {
    if (!body.tower_id || !q1('SELECT 1 x FROM towers WHERE id=?', +body.tower_id)) throw new HttpError(422, 'Choose the tower', { fields: { tower_id: 'Choose the tower' } });
    loc = { tower_id: +body.tower_id, level_id: body.level_id ? +body.level_id : null, zone_id: body.zone_id ? +body.zone_id : null, trade_id: body.trade_id ? +body.trade_id : null, activity_id: null };
  }
  const f = issueFields(body, false);
  if (!f.owner_id) throw new HttpError(422, 'Choose an action owner', { fields: { owner_id: 'Choose an action owner' } });
  if (!f.target_date) throw new HttpError(422, 'Set a target resolution date', { fields: { target_date: 'Set a target date' } });
  return tx(() => {
    const id = insert('issues', { priority: 'medium', ...f, ...loc, status: 'open', raised_by: user.id, raised_date: today(), created_at: now(), updated_at: now() });
    run('UPDATE issues SET code=? WHERE id=?', 'ISS-' + String(id).padStart(4, '0'), id);
    audit(user, 'create', 'issue', id, `Raised issue: ${f.title}`, f);
    return { id };
  });
});

put('/api/issues/:id', { roles: ALL }, ({ user, params, body }) => {
  const i = q1('SELECT * FROM issues WHERE id=?', +params.id);
  if (!i || !canSeeIssue(user, i)) throw notFound();
  if (!MGMT.includes(user.role) && !(i.raised_by === user.id && ['open', 'in_progress'].includes(i.status))) throw forbidden('Only the person who raised the issue or the Project Manager can edit it');
  const f = issueFields(body, true);
  dbUpdate('issues', i.id, { ...f, updated_at: now() });
  const changed = Object.keys(f).filter((k) => f[k] !== i[k]);
  audit(user, 'edit', 'issue', i.id, `Edited issue ${i.code}: ${changed.join(', ') || 'no changes'}`, { before: Object.fromEntries(changed.map((k) => [k, i[k]])), after: Object.fromEntries(changed.map((k) => [k, f[k]])) });
  return { ok: true };
});

post('/api/issues/:id/status', { roles: ALL }, ({ user, params, body }) => {
  const i = q1('SELECT * FROM issues WHERE id=?', +params.id);
  if (!i || !canSeeIssue(user, i)) throw notFound();
  const to = body.status;
  if (!STATUSES.includes(to)) throw bad('Unknown status');
  const mgmt = MGMT.includes(user.role);
  if (to === 'closed' && !mgmt) throw forbidden('Only the Project Manager can close an issue');
  if (['resolved', 'in_progress'].includes(to) && !mgmt && i.owner_id !== user.id && i.raised_by !== user.id && !canSeeIssue(user, i)) throw forbidden();
  if (to === 'open' && !mgmt && i.status === 'closed') throw forbidden('Only the Project Manager can re-open a closed issue');
  const note = str(body.note);
  if (to === 'resolved' && !note) throw new HttpError(422, 'Describe how it was resolved', { fields: { note: 'Describe how it was resolved' } });
  const patch = { status: to, updated_at: now() };
  if (to === 'resolved') Object.assign(patch, { resolved_date: today(), resolution_note: note });
  if (to === 'closed') Object.assign(patch, { closed_by: user.id, closed_date: today(), resolution_note: note || i.resolution_note });
  if (to === 'open' || to === 'in_progress') Object.assign(patch, { resolved_date: null, closed_by: null, closed_date: null });
  tx(() => {
    dbUpdate('issues', i.id, patch);
    if (note) insert('issue_comments', { issue_id: i.id, user_id: user.id, body: `[${i.status} → ${to}] ${note}`, created_at: now() });
    audit(user, 'status', 'issue', i.id, `${i.code}: ${i.status} → ${to}${note ? ' - ' + note : ''}`);
  });
  return { ok: true };
});

post('/api/issues/:id/comments', { roles: ALL }, ({ user, params, body }) => {
  const i = q1('SELECT * FROM issues WHERE id=?', +params.id);
  if (!i || !canSeeIssue(user, i)) throw notFound();
  const text = str(body.body, 3000);
  if (!text) throw new HttpError(422, 'Write a comment', { fields: { body: 'Write a comment' } });
  const id = insert('issue_comments', { issue_id: i.id, user_id: user.id, body: text, created_at: now() });
  dbUpdate('issues', i.id, { updated_at: now() });
  audit(user, 'comment', 'issue', i.id, `Comment on ${i.code}`);
  return { id };
});

// ---------------------------------------------------------------- photos
const MIME = [
  [Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', 'jpg'],
  [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'png'],
];
function sniff(buf) {
  for (const [sig, mime, ext] of MIME) if (buf.length > sig.length && buf.subarray(0, sig.length).equals(sig)) return { mime, ext };
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

post('/api/photos', { roles: ALL, raw: true }, ({ user, query, body }) => {
  if (!Buffer.isBuffer(body) || !body.length) throw bad('No image received');
  const t = sniff(body);
  if (!t) throw bad('Only JPEG, PNG or WebP photos are accepted');
  const row = { mime: t.mime, size: body.length, caption: str(query.caption, 300), uploader_id: user.id, kind: 'pending', taken_date: isDate(query.taken_date) ? query.taken_date : today(), created_at: now() };
  if (query.issue_id) {
    const i = q1('SELECT * FROM issues WHERE id=?', +query.issue_id);
    if (!i || !canSeeIssue(user, i)) throw notFound('Issue not found');
    Object.assign(row, { issue_id: i.id, activity_id: i.activity_id, tower_id: i.tower_id, level_id: i.level_id, zone_id: i.zone_id, trade_id: i.trade_id, kind: query.kind === 'resolution' ? 'resolution' : 'issue' });
  } else if (query.activity_id) {
    const a = q1('SELECT * FROM activities WHERE id=?', +query.activity_id);
    if (!a || (STAFF.includes(user.role) && a.engineer_id !== user.id && a.supervisor_id !== user.id)) throw notFound('Activity not found');
    Object.assign(row, { activity_id: a.id, tower_id: a.tower_id, level_id: a.level_id, zone_id: a.zone_id, trade_id: a.trade_id, kind: query.standalone === '1' ? 'progress' : 'pending' });
  } else throw bad('Photo must be linked to an activity or an issue');
  const d = new Date();
  const rel = path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
  fs.mkdirSync(path.join(UPLOAD_DIR, rel), { recursive: true });
  const file = path.join(rel, crypto.randomBytes(12).toString('hex') + '.' + t.ext).replaceAll('\\', '/');
  fs.writeFileSync(path.join(UPLOAD_DIR, file), body);
  const id = insert('photos', { ...row, file });
  audit(user, 'upload', 'photo', id, `Uploaded photo (${Math.round(body.length / 1024)} KB)`);
  return { id, kind: row.kind };
});

function loadPhoto(user, id) {
  const p = q1('SELECT * FROM photos WHERE id=?', id);
  if (!p) return null;
  if (MGMT.includes(user.role) || p.uploader_id === user.id) return p;
  if (p.activity_id) {
    const a = q1('SELECT engineer_id,supervisor_id FROM activities WHERE id=?', p.activity_id);
    if (a && (a.engineer_id === user.id || a.supervisor_id === user.id)) return p;
  }
  return null;
}

get('/api/photos/:id/file', { roles: ALL }, ({ user, params }) => {
  const p = loadPhoto(user, +params.id);
  if (!p) throw notFound();
  let buf;
  try { buf = fs.readFileSync(path.join(UPLOAD_DIR, p.file)); } catch { throw notFound('File missing'); }
  return { __file: true, buffer: buf, contentType: p.mime, headers: { 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } };
});

get('/api/photos', { roles: ALL }, ({ user, query }) => {
  const w = ["p.kind<>'pending'"];
  const p = [];
  if (!MGMT.includes(user.role)) { w.push('(p.uploader_id=? OR a.engineer_id=? OR a.supervisor_id=?)'); p.push(user.id, user.id, user.id); }
  for (const [k, col] of [['tower', 'p.tower_id'], ['trade', 'p.trade_id'], ['level_id', 'p.level_id'], ['activity_id', 'p.activity_id'], ['issue_id', 'p.issue_id'], ['uploader', 'p.uploader_id']])
    if (query[k]) { w.push(`${col}=?`); p.push(+query[k]); }
  if (query.kind) { w.push('p.kind=?'); p.push(query.kind); }
  if (isDate(query.from)) { w.push('p.taken_date>=?'); p.push(query.from); }
  if (isDate(query.to)) { w.push('p.taken_date<=?'); p.push(query.to); }
  if (query.q) { w.push('(p.caption LIKE ? OR a.name LIKE ?)'); p.push(`%${query.q}%`, `%${query.q}%`); }
  const from = `FROM photos p LEFT JOIN activities a ON a.id=p.activity_id LEFT JOIN towers t ON t.id=p.tower_id LEFT JOIN levels l ON l.id=p.level_id
    LEFT JOIN zones z ON z.id=p.zone_id LEFT JOIN trades tr ON tr.id=p.trade_id LEFT JOIN users u ON u.id=p.uploader_id LEFT JOIN issues i ON i.id=p.issue_id WHERE ${w.join(' AND ')}`;
  return {
    total: q1(`SELECT COUNT(*) n ${from}`, ...p).n,
    rows: q(`SELECT p.id,p.caption,p.kind,p.taken_date,p.is_demo,p.uploader_id,p.update_id,p.issue_id,p.activity_id,t.name tower,l.name level,z.name zone,tr.name trade,
      a.name activity,u.name uploader,i.code issue_code ${from} ORDER BY p.taken_date DESC, p.id DESC LIMIT ? OFFSET ?`, ...p, Math.min(+query.limit || 60, 300), +query.offset || 0),
  };
});

put('/api/photos/:id', { roles: ALL }, ({ user, params, body }) => {
  const p = loadPhoto(user, +params.id);
  if (!p || !(MGMT.includes(user.role) || p.uploader_id === user.id)) throw notFound();
  dbUpdate('photos', p.id, { caption: str(body.caption, 300) });
  return { ok: true };
});

del('/api/photos/:id', { roles: ALL }, ({ user, params }) => {
  const p = loadPhoto(user, +params.id);
  if (!p) throw notFound();
  if (user.role !== 'admin') {
    if (p.uploader_id !== user.id) throw forbidden('Only the uploader can delete a photo');
    if (p.update_id) {
      const u = q1('SELECT state FROM updates WHERE id=?', p.update_id);
      if (u && !['draft', 'rejected'].includes(u.state)) throw new HttpError(409, 'This photo belongs to a submitted/approved update and is part of the record');
    }
  }
  removePhoto(p);
  audit(user, 'delete', 'photo', p.id, 'Deleted photo');
  return { ok: true };
});
