// End-to-end self test: starts the server on a temporary database with demo data and checks the rules that matter.
//   npm test        (or)        node server/selftest.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avantro-test-'));
import { DEMO_PASSWORD as PASSWORD } from './demo-config.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); } };

class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, { raw, headers = {}, csrf = true } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (csrf) h['x-requested-with'] = 'avantro';
    let b;
    if (raw) { b = raw; h['content-type'] = 'application/octet-stream'; } else if (body !== undefined) { b = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetch(BASE + url, { method, headers: h, body: b });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  get = (u) => this.call('GET', u);
  post = (u, b, o) => this.call('POST', u, b ?? {}, o);
  put = (u, b) => this.call('PUT', u, b ?? {});
  async login(u, p = PASSWORD) { const r = await this.post('/api/login', { username: u, password: p }); return r; }
}

const server = spawn(process.execPath, [path.join(here, 'index.js')], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AVANTRO_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const stop = () => { server.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ } };

try {
  for (let i = 0; i < 120; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  console.log('Avantro self-test on ' + BASE);

  console.log('\nAuthentication and access control');
  const anon = new Client();
  ok((await anon.get('/api/dashboard')).status === 401, 'unauthenticated dashboard request is refused (401)');
  ok((await anon.login('pm.demo', 'wrong-password')).status === 401, 'wrong password is refused');
  const pm = new Client();
  ok((await pm.login('pm.demo')).status === 200, 'project manager can sign in');
  const noCsrf = await pm.call('POST', '/api/updates/1/approve', {}, { csrf: false });
  ok(noCsrf.status === 403, 'state-changing request without the CSRF header is blocked', noCsrf.status);
  const eng = new Client();
  await eng.login('eng.a.arch');
  const eng2 = new Client();
  await eng2.login('eng.b.me');
  const admin = new Client();
  await admin.login('admin.demo');
  ok((await eng.get('/api/dashboard')).status === 403, 'site engineer cannot open the PM dashboard');
  ok((await eng.get('/api/admin/users')).status === 403, 'site engineer cannot open administration');
  ok((await eng.get('/api/report?type=daily')).status === 403, 'site engineer cannot generate reports');
  ok((await pm.get('/api/admin/users')).status === 403, 'project manager cannot change setup (admin only)');
  ok((await admin.get('/api/admin/users')).status === 200, 'administrator can open user administration');
  ok((await eng.post('/api/admin/reset', { confirm: 'RESET' })).status === 403, 'site engineer cannot reset the project');

  console.log('\nScope of visibility');
  const mine = (await eng.get('/api/activities?limit=3000')).data;
  const all = (await pm.get('/api/activities?limit=3000')).data;
  ok(mine.total > 0 && mine.total < all.total, `engineer sees only assigned activities (${mine.total} of ${all.total})`);
  const foreign = all.rows.find((a) => a.engineer_id !== (mine.rows[0]?.engineer_id) && a.tower !== mine.rows[0].tower);
  ok((await eng.get('/api/activities/' + foreign.id)).status === 404, 'engineer cannot open an activity assigned to someone else');

  console.log('\nProgress updates: validation, workflow and calculations');
  const target = mine.rows.find((a) => a.method === 'quantity' && a.scope_qty > 0 && a.status === 'in_progress' && a.remaining > 20 && !a.last_update?.startsWith(new Date().toISOString().slice(0, 4) + '-99'));
  const today = new Date(); const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const usedDates = new Set((await eng.get(`/api/updates?activity_id=${target.id}&limit=500`)).data.rows.map((u) => u.report_date));
  const fmtD = (n) => { const y = new Date(today.getTime() - n * 864e5); return `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`; };
  const day5 = [5, 6, 7, 8, 9, 10, 11, 12, 13].map(fmtD).find((d) => !usedDates.has(d));
  const before = (await pm.get('/api/activities/' + target.id)).data.activity;
  const body = { activity_id: target.id, report_date: day5, qty_today: 10, status: 'in_progress', manpower: 8, engineer_id: target.engineer_id, supervisor_id: target.supervisor_id, contractor: target.contractor, remarks: 'test', action: 'draft' };
  const other = (await eng2.post('/api/updates', { ...body })).status;
  ok(other === 403, 'engineer cannot report on an activity they are not assigned to', other);
  ok((await pm.post('/api/updates', body)).status === 403, 'project manager cannot enter site updates');
  const d1 = await eng.post('/api/updates', body);
  ok(d1.status === 200 && d1.data.update.state === 'draft', 'draft update saved', JSON.stringify(d1.data));
  const dup = await eng.post('/api/updates', body);
  ok(dup.status === 409, 'duplicate entry for the same activity and date is refused (409)');
  const over = await eng.put('/api/updates/' + d1.data.update.id, { ...body, qty_today: before.remaining + 500, action: 'submit' });
  ok(over.status === 422 && over.data.fields?.qty_today, 'quantity above defined scope cannot be submitted', JSON.stringify(over.data));
  const badNum = await eng.put('/api/updates/' + d1.data.update.id, { ...body, qty_today: -5, action: 'submit' });
  ok(badNum.status === 422, 'negative quantity is refused');
  const sub = await eng.put('/api/updates/' + d1.data.update.id, { ...body, action: 'submit' });
  ok(sub.status === 200 && sub.data.update.state === 'submitted', 'valid update submitted');
  const mid = (await pm.get('/api/activities/' + target.id)).data.activity;
  ok(Math.abs(mid.approved_qty - before.approved_qty) < 1e-9 && Math.abs(mid.pending_qty - before.pending_qty - 10) < 1e-9, 'submitted quantity is pending and NOT counted as approved progress');
  ok(mid.pct === before.pct, 'activity progress unchanged until approval');
  const edit = await eng.put('/api/updates/' + d1.data.update.id, { ...body, qty_today: 11, action: 'draft' });
  ok(edit.status === 409, 'a submitted update cannot be edited without recalling it');
  const appr = await pm.post(`/api/updates/${d1.data.update.id}/approve`, { note: 'ok' });
  ok(appr.status === 200 && appr.data.update.state === 'approved', 'project manager approves');
  const after = (await pm.get('/api/activities/' + target.id)).data.activity;
  ok(Math.abs(after.approved_qty - before.approved_qty - 10) < 1e-9 && after.pct > before.pct, `approved quantity now counts (${before.pct?.toFixed(2)}% -> ${after.pct?.toFixed(2)}%)`);
  ok((await pm.post(`/api/updates/${d1.data.update.id}/reject`, { note: 'x' })).status === 409, 'an approved update cannot be rejected directly');
  ok((await eng.post(`/api/updates/${d1.data.update.id}/reopen`, { note: 'x' })).status === 403, 'engineer cannot withdraw an approval');
  const reo = await pm.post(`/api/updates/${d1.data.update.id}/reopen`, { note: 'test withdrawal' });
  const back = (await pm.get('/api/activities/' + target.id)).data.activity;
  ok(reo.status === 200 && Math.abs(back.approved_qty - before.approved_qty) < 1e-9, 'withdrawing approval removes the quantity from progress');
  const rej = await pm.post(`/api/updates/${d1.data.update.id}/reject`, { note: '' });
  ok(rej.status === 400, 'rejection requires a reason');
  const rej2 = await pm.post(`/api/updates/${d1.data.update.id}/reject`, { note: 'Photos missing' });
  ok(rej2.status === 200 && rej2.data.update.state === 'rejected', 'rejection with a reason works');
  const fix = await eng.put('/api/updates/' + d1.data.update.id, { ...body, qty_today: 9, action: 'submit' });
  ok(fix.status === 200 && fix.data.update.state === 'submitted', 'rejected update can be corrected and resubmitted');
  const aud = (await pm.get(`/api/updates/${d1.data.update.id}`)).data.audit.map((a) => a.action);
  ok(['create', 'submit', 'approve', 'reopen', 'reject'].every((a) => aud.includes(a)), 'audit trail records create, submit, approve, withdraw and reject', aud.join(','));

  console.log('\nCopy previous day / batch');
  const cp1 = await eng.post('/api/updates/copy', { date: ds });
  ok(cp1.status === 200, 'copy previous day works');
  if (cp1.data.created.length) {
    const copied = (await eng.get(`/api/updates/${cp1.data.created[0].id}`)).data;
    ok(copied.update.qty_today === 0 && copied.photos.length === 0 && copied.issues.length === 0 && copied.update.state === 'draft', 'copied entry has zero quantity, no photos, no issues (nothing duplicated)');
    const cp2 = await eng.post('/api/updates/copy', { date: ds });
    ok(cp2.data.created.length === 0, 'copying again does not create duplicates');
  } else ok(true, 'copy previous day: nothing to copy (skipped)');
  const bt = await eng.post('/api/updates/batch', { action: 'draft', items: [{ activity_id: target.id, report_date: ds, qty_today: 3, manpower: 5, status: 'in_progress' }, { activity_id: foreign.id, report_date: ds, qty_today: 3 }] });
  ok(bt.data.ok === 1 && bt.data.failed === 1, 'batch saves valid rows and rejects rows outside the user\'s assignment', JSON.stringify(bt.data));

  console.log('\nNot configured / baseline changes');
  const nc = all.rows.find((a) => a.name === 'Roof waterproofing' && a.tower === 'SAMM');
  ok(nc && nc.pct === null && nc.eff_weight === null && nc.health === 'nc', 'unconfigured activity reports null progress (UI shows "Not configured")');
  const dash = (await pm.get('/api/dashboard')).data;
  ok(dash.project.excluded >= 2 && dash.project.reasons.some((r) => /unweighted/.test(r)), 'roll-up reports excluded unweighted activities');
  const act = all.rows.find((a) => a.weight > 0 && a.scope_qty > 0);
  const noReason = await admin.post('/api/admin/activities/batch-edit', { rows: [{ id: act.id, weight: act.weight + 1 }] });
  ok(noReason.status === 422, 'changing an agreed weight without a reason is refused');
  const withReason = await admin.post('/api/admin/activities/batch-edit', { rows: [{ id: act.id, weight: act.weight + 1 }], reason: 'test re-weighting' });
  ok(withReason.status === 200, 'weight change with a reason is accepted');
  const au = (await pm.get('/api/audit?action=baseline_change&limit=5')).data;
  ok(au.rows.some((r) => /weight/.test(r.summary) && /test re-weighting/.test(r.summary)), 'baseline change (with reason) is in the audit trail');
  await admin.post('/api/admin/activities/batch-edit', { rows: [{ id: act.id, weight: act.weight }], reason: 'restore' });
  const tooLow = await admin.post('/api/admin/activities/batch-edit', { rows: [{ id: act.id, scope_qty: 0.5 }], reason: 'test' });
  ok(tooLow.status === 409 || act.approved_qty + act.pending_qty < 0.5, 'scope cannot be reduced below quantity already reported');

  console.log('\nIssues and photos');
  const iss = await eng.post('/api/issues', { activity_id: target.id, title: 'Test blocker: access blocked', priority: 'high', is_blocker: 1, owner_id: pm.cookie ? (await pm.get('/api/me')).data.user.id : 1, target_date: ds, required_action: 'Clear access' });
  ok(iss.status === 200, 'engineer raises an issue linked to an activity');
  ok((await eng.post(`/api/issues/${iss.data.id}/status`, { status: 'closed' })).status === 403, 'only the Project Manager can close an issue');
  ok((await eng.post(`/api/issues/${iss.data.id}/status`, { status: 'resolved', note: '' })).status === 422, 'resolving needs a resolution note');
  ok((await eng.post(`/api/issues/${iss.data.id}/status`, { status: 'resolved', note: 'Access cleared' })).status === 200, 'engineer marks issue resolved');
  ok((await pm.post(`/api/issues/${iss.data.id}/status`, { status: 'closed', note: 'verified' })).status === 200, 'PM closes the issue');
  const notImg = await eng.call('POST', `/api/photos?activity_id=${target.id}`, undefined, { raw: Buffer.from('not an image at all') });
  ok(notImg.status === 400, 'non-image upload is rejected');
  const png = fs.readFileSync(path.join(dataDir, 'uploads', 'demo', 'demo-1.png'));
  const up = await eng.call('POST', `/api/photos?activity_id=${target.id}&caption=test`, undefined, { raw: png });
  ok(up.status === 200 && up.data.id, 'PNG photo upload accepted (content sniffed, not trusted from the name)');
  ok((await eng.get(`/api/photos/${up.data.id}/file`)).status === 200, 'uploader can view the photo');
  ok((await eng2.get(`/api/photos/${up.data.id}/file`)).status === 404, 'another engineer cannot view it');
  ok((await pm.get(`/api/photos/${up.data.id}/file`)).status === 200, 'project manager can view it');

  console.log('\nReports');
  const pdf = await pm.get('/api/report/export?type=weekly&format=pdf');
  ok(pdf.status === 200 && pdf.data.subarray(0, 5).toString() === '%PDF-' && pdf.data.length > 5000, `PDF export (${pdf.data.length} bytes)`);
  ok(pdf.data.toString('latin1').includes('%%EOF'), 'PDF is complete');
  const xl = await pm.get('/api/report/export?type=monthly&format=xlsx');
  ok(xl.status === 200 && xl.data.subarray(0, 2).toString() === 'PK', `Excel export (${xl.data.length} bytes)`);
  // verify the zip central directory lists the workbook and every entry inflates cleanly
  const b = xl.data;
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16), good = 0, names = [];
  for (let i = 0; i < n; i++) {
    const csize = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), off = b.readUInt32LE(p + 42);
    names.push(b.toString('utf8', p + 46, p + 46 + nl));
    const lnl = b.readUInt16LE(off + 26), ll = b.readUInt16LE(off + 28);
    try { const raw = zlib.inflateRawSync(b.subarray(off + 30 + lnl + ll, off + 30 + lnl + ll + csize)); if (zlib.crc32(raw) === b.readUInt32LE(p + 16)) good++; } catch { /* bad entry */ }
    p += 46 + nl + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  ok(good === n && names.includes('xl/workbook.xml') && names.filter((x) => x.startsWith('xl/worksheets/')).length >= 5, `Excel file is a valid package (${n} parts, CRC ok)`);
  ok((await eng.get('/api/report/export?type=daily&format=pdf')).status === 403, 'reports are not available to site staff');

  console.log('\nLogin throttling');
  const th = new Client();
  let last = 0;
  for (let i = 0; i < 7; i++) last = (await th.login('sup.a.arch', 'bad-password-' + i)).status;
  ok(last === 429, 'repeated failed sign-ins are throttled (429)');
} catch (e) {
  fail++;
  console.log('  FAIL unexpected error: ' + (e.stack || e));
  console.log(log.slice(-1500));
} finally {
  stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
