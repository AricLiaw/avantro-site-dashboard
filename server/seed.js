// Seed data: trades + activity catalog (always) and clearly labelled DEMONSTRATION data (towers, users, updates, issues, photos).
// All demo rows carry is_demo=1. Dates are generated relative to "today" so the demo always looks current.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { q, q1, insert, run, tx, audit, now, setSetting, UPLOAD_DIR } from './db.js';
import { hashPassword, randomPassword } from './auth.js';
import { today, addDays, diffDays } from './util.js';
import { plannedPct } from './calc.js';
import { recomputeActivity } from './routes-updates.js';

import { DEMO_PASSWORD } from './demo-config.js';
export { DEMO_PASSWORD };

// ------------------------------------------------------------------ base data
const TRADES = [['ARCH', 'Architectural'], ['CS', 'C&S (Civil & Structural)'], ['ME', 'M&E (Mechanical & Electrical)']];
// [trade, category, name, uom, milestones?]
const CATALOG = [
  ['ARCH', 'Masonry', 'Blockwork', 'm2'], ['ARCH', 'Plastering', 'Internal plastering', 'm2'], ['ARCH', 'Waterproofing', 'Wet-area waterproofing', 'm2'],
  ['ARCH', 'Screeding', 'Floor screed', 'm2'], ['ARCH', 'Tiling', 'Floor & wall tiling', 'm2'], ['ARCH', 'Ceilings', 'Ceiling installation', 'm2'],
  ['ARCH', 'Painting', 'Internal painting', 'm2'], ['ARCH', 'Doors & Windows', 'Doors & windows installation', 'nos'], ['ARCH', 'Façade', 'Façade cladding', 'm2'],
  ['ARCH', 'Finishes', 'Handover snagging & finishes', null, ['Defect list issued', 'Rectification 50%', 'Rectification complete', 'Client inspection passed']],
  ['CS', 'Earthworks', 'Excavation & earthworks', 'm3'], ['CS', 'Foundations', 'Foundation concrete', 'm3'], ['CS', 'Reinforcement', 'Reinforcement fixing', 'ton'],
  ['CS', 'Formwork', 'Formwork erection', 'm2'], ['CS', 'Columns & Walls', 'Columns & shear walls concrete', 'm3'], ['CS', 'Beams & Slabs', 'Beams & slab concrete', 'm3'],
  ['CS', 'Staircases', 'Staircase construction', 'nos'],
  ['ME', 'Electrical', 'Electrical first fix (conduit & trays)', 'm'], ['ME', 'Electrical', 'Electrical second fix (DBs & fittings)', 'nos'],
  ['ME', 'Plumbing & Sanitary', 'Plumbing & sanitary pipework', 'm'], ['ME', 'Plumbing & Sanitary', 'Sanitary fixtures', 'nos'],
  ['ME', 'ACMV', 'ACMV ductwork & piping', 'm'], ['ME', 'Fire Protection', 'Fire protection pipework', 'm'], ['ME', 'ELV', 'ELV cabling', 'm'],
  ['ME', 'Lifts', 'Lift installation', null, ['Guide rails installed', 'Car & doors installed', 'Machine & controller installed', 'Testing & certification']],
  ['ME', 'Equipment', 'Equipment installation', 'nos'],
  ['ME', 'Testing & Commissioning', 'Testing & commissioning', null, ['Pre-commissioning checks', 'System testing', 'Integrated testing', 'Handover documentation']],
];

export function seedBase() {
  if (q1('SELECT 1 x FROM trades')) return;
  tx(() => {
    TRADES.forEach(([code, name], i) => insert('trades', { code, name, sort: i }));
    const tid = Object.fromEntries(q('SELECT id,code FROM trades').map((t) => [t.code, t.id]));
    for (const [tr, category, name, uom, ms] of CATALOG)
      insert('catalog', { trade_id: tid[tr], category, name, uom: uom || null, method: ms ? 'milestone' : 'quantity', milestones: ms ? JSON.stringify(ms) : null });
  });
}

export function seedEmpty() {
  seedBase();
  const pw = randomPassword();
  insert('users', { username: 'admin', name: 'Administrator', role: 'admin', pw_hash: hashPassword(pw), must_change: 1, created_at: now() });
  audit(null, 'seed', 'system', null, 'Created empty project with administrator account');
  return { username: 'admin', password: pw };
}

export function wipeProject(keepUserId) {
  tx(() => {
    for (const t of ['issue_comments', 'issues', 'photos', 'updates', 'activity_milestones', 'activities', 'project_milestones', 'zones', 'levels', 'tower_trades', 'towers']) run(`DELETE FROM ${t}`);
    run('DELETE FROM sessions WHERE user_id<>?', keepUserId ?? -1);
    run('UPDATE activities SET engineer_id=NULL, supervisor_id=NULL');
    run('DELETE FROM users WHERE id<>?', keepUserId ?? -1);
    setSetting('demo_mode', '0');
  });
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ------------------------------------------------------------------ demo generator
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECS = [
  { code: 'A', name: 'Tower A', weight: 45, S: -400, basement: true, typical: Array.from({ length: 12 }, (_, i) => `Level ${i + 1}`), zones: ['East Wing', 'West Wing'], found: 90, s0: 100, cycle: 18, finLag: 45, finDur: 260, lag: 3, scale: 1.0, tw: { ARCH: 30, CS: 40, ME: 30 }, tag: 'a', notes: 'Residential tower, 12 typical floors + 1 basement. DEMO' },
  { code: 'B', name: 'Tower B', weight: 35, S: -220, basement: false, typical: Array.from({ length: 8 }, (_, i) => `Level ${i + 1}`), zones: ['North Block', 'South Block'], found: 80, s0: 90, cycle: 16, finLag: 40, finDur: 240, lag: 10, scale: 0.9, tw: { ARCH: 30, CS: 35, ME: 35 }, tag: 'b', notes: 'Commercial tower, 8 floors. DEMO' },
  { code: 'SAMM', name: 'SAMM', weight: 20, S: -140, basement: false, typical: ['Ground Floor', 'Level 1', 'Level 2', 'Level 3', 'Level 4'], zones: ['Zone 1', 'Zone 2', 'Zone 3'], found: 70, s0: 80, cycle: 20, finLag: 15, finDur: 200, lag: 2, scale: 1.2, tw: { ARCH: 35, CS: 30, ME: 35 }, tag: 'samm', notes: 'SAMM building - different floor count and layout (3 zones per floor). DEMO' },
];
const ENG = ['Daniel Tan', 'Priya Nair', 'Hafiz Rahman', 'Grace Lim', 'Arjun Mehta', 'Nur Aisyah', 'Marcus Ong', 'Elena Petrova', 'Samuel Wong'];
const SUP = ['Kumar Raj', 'Ahmad Faiz', 'Lee Wei Ming', 'Rajesh Pillai', 'Tommy Chua', 'Ismail Yusof', 'Vincent Goh', 'Ravi Shankar', 'Zulkifli Hamid'];
const SUBS = { masonry: 'Northstar Masonry & Plaster', finish: 'Meridian Finishes', cs: 'Granite Structures', elec: 'Volt Electrical Works', mech: 'Aeon Mechanical Systems' };
// base scope per catalog name (per level / zone) and value rate used for demo weights
const BASE = {
  'Blockwork': [320, 30], 'Internal plastering': [760, 12], 'Wet-area waterproofing': [180, 25], 'Floor screed': [1450, 10], 'Floor & wall tiling': [420, 45],
  'Ceiling installation': [1200, 28], 'Internal painting': [900, 8], 'Doors & windows installation': [64, 300], 'Façade cladding': [9800, 220],
  'Excavation & earthworks': [24000, 15], 'Foundation concrete': [5200, 190], 'Reinforcement fixing': [46, 1300], 'Formwork erection': [1650, 22],
  'Columns & shear walls concrete': [95, 210], 'Beams & slab concrete': [310, 190], 'Staircase construction': [2, 6000],
  'Electrical first fix (conduit & trays)': [5200, 14], 'Electrical second fix (DBs & fittings)': [180, 260], 'Plumbing & sanitary pipework': [1100, 60],
  'Sanitary fixtures': [46, 350], 'ACMV ductwork & piping': [900, 95], 'Fire protection pipework': [1300, 55], 'ELV cabling': [3600, 12], 'Equipment installation': [12, 9000],
  'Handover snagging & finishes': [0, 15000], 'Lift installation': [0, 90000], 'Testing & commissioning': [0, 60000],
};
const ZONED = new Set(['Blockwork', 'Internal plastering', 'Floor & wall tiling', 'Internal painting']);
// windows as fractions of a base duration [start, end]
const ARCH_WIN = { 'Blockwork': [0, .18], 'Wet-area waterproofing': [.12, .28], 'Internal plastering': [.18, .42], 'Floor screed': [.28, .48], 'Ceiling installation': [.4, .62], 'Floor & wall tiling': [.48, .78], 'Doors & windows installation': [.58, .85], 'Internal painting': [.72, 1] };
const CS_WIN = { 'Reinforcement fixing': [0, .6], 'Formwork erection': [.1, .7], 'Columns & shear walls concrete': [.3, .8], 'Beams & slab concrete': [.5, 1], 'Staircase construction': [.6, 1.2] };
const ME_WIN = { 'Electrical first fix (conduit & trays)': [0, .35], 'Plumbing & sanitary pipework': [.05, .4], 'ACMV ductwork & piping': [.1, .5], 'Fire protection pipework': [.25, .55], 'ELV cabling': [.45, .8], 'Electrical second fix (DBs & fittings)': [.55, .85], 'Sanitary fixtures': [.6, .9] };

const REMARKS = ['Work progressing as planned.', 'Slight delay due to material delivery in the morning.', 'Good progress, inspection passed.', 'Rework required on one section, completed.', 'Manpower reduced due to rain in the afternoon.', 'Waiting for inspection by consultant before closing up.', 'Coordination with other trades caused some standby time.'];
const NEXT = ['Continue same activity in adjacent zone.', 'Prepare for inspection request.', 'Start next floor once area is cleared.', 'Mobilise additional labour.', 'Complete outstanding sections and clean up.'];
const HOLD = ['Awaiting material approval from consultant.', 'Waiting for preceding trade to complete and hand over area.', 'Access blocked - hoist unavailable.', 'Drawing revision pending from designer.'];

function png(w, h, seed) {
  const r = mulberry32(seed);
  const buf = Buffer.alloc(h * (1 + w * 3));
  const px = (x, y, c) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = y * (1 + w * 3) + 1 + x * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1 | 0); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1 | 0); x++) px(x, y, c); };
  const warm = r() * 40;
  for (let y = 0; y < h; y++) rect(0, y, w, y + 1, [120 + warm + (y / h) * 90, 170 + (y / h) * 60, 225 + (y / h) * 25].map((v) => Math.min(255, v)));
  rect(0, h * .82, w, h, [110, 104, 92]);
  const floors = 3 + Math.floor(r() * 7), bw = w * (.32 + r() * .2), bx = w * (.15 + r() * .35), fh = (h * .74) / 10;
  for (let f = 0; f < floors; f++) {
    const y1 = h * .82 - f * fh;
    rect(bx, y1 - fh, bx + bw, y1, f % 2 ? [176, 178, 182] : [160, 163, 168]);
    for (let c = 0; c <= 4; c++) rect(bx + c * (bw / 4) - 3, y1 - fh, bx + c * (bw / 4) + 3, y1, [128, 130, 136]);
    rect(bx, y1 - 3, bx + bw, y1, [96, 98, 104]);
  }
  if (r() > .3) {
    const cx = bx + bw + 20 + r() * 30, top = h * .82 - 10 * fh - 12;
    rect(cx, top, cx + 5, h * .82, [232, 170, 20]);
    rect(cx - bw * .8, top, cx + 60, top + 5, [232, 170, 20]);
    rect(cx - bw * .5, top + 5, cx - bw * .5 + 2, top + 40, [60, 60, 60]);
  }
  for (let i = 0; i < 25; i++) rect(r() * w, h * .84 + r() * h * .14, r() * w * .05 + 6, h * .84 + r() * h * .14 + 4, [90 + r() * 40, 84 + r() * 30, 70]);
  for (let y = 0; y < h; y++) buf[y * (1 + w * 3)] = 0;
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(buf)), chunk('IEND', Buffer.alloc(0))]);
}

export function seedDemo() {
  seedBase();
  const T = today();
  const d = (n) => addDays(T, n);
  const rnd = mulberry32(20260930);
  const R = (a, b) => a + rnd() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const trade = Object.fromEntries(q('SELECT id,code FROM trades').map((t) => [t.code, t.id]));
  const catalog = Object.fromEntries(q('SELECT * FROM catalog').map((c) => [c.name, c]));
  const pwHash = hashPassword(DEMO_PASSWORD);

  tx(() => {
    setSetting('project_name', 'Avantro Project');
    setSetting('demo_mode', '1');
    const mkUser = (username, name, role, company) => insert('users', { username, name, role, company, pw_hash: pwHash, is_demo: 1, created_at: now() });
    const pm = mkUser('pm.demo', 'Project Manager (Demo)', 'pm', 'Avantro Development');
    mkUser('admin.demo', 'Administrator (Demo)', 'admin', 'Avantro Development');
    const staff = {}; // tag|tradeCode -> {eng, sup}
    let ui = 0;
    for (const s of SPECS) for (const tr of ['ARCH', 'CS', 'ME']) {
      const e = mkUser(`eng.${s.tag}.${tr.toLowerCase()}`, ENG[ui], 'engineer', 'Main Contractor');
      const su = mkUser(`sup.${s.tag}.${tr.toLowerCase()}`, SUP[ui], 'supervisor', 'Main Contractor');
      staff[s.tag + '|' + tr] = { eng: e, sup: su };
      ui++;
    }
    const subFor = (tr, cat) => tr === 'CS' ? SUBS.cs : tr === 'ARCH' ? (['Masonry', 'Plastering', 'Waterproofing', 'Screeding'].includes(cat) ? SUBS.masonry : SUBS.finish)
      : (['Electrical', 'ELV', 'Lifts'].includes(cat) ? SUBS.elec : SUBS.mech);

    const allActs = [];
    for (const [si, s] of SPECS.entries()) {
      const towerId = insert('towers', { code: s.code, name: s.name, weight: s.weight, sort: si, notes: s.notes, is_demo: 1 });
      for (const [tr, w] of Object.entries(s.tw)) run('INSERT INTO tower_trades (tower_id,trade_id,weight) VALUES (?,?,?)', towerId, trade[tr], w);
      // levels
      const defs = [{ name: 'Foundation', type: 'found' }];
      if (s.basement) defs.push({ name: 'Basement 1', type: 'basement', k: 0 });
      s.typical.forEach((n, i) => defs.push({ name: n, type: 'typical', k: i + (s.basement ? 1 : 0) }));
      defs.push({ name: 'Roof', type: 'roof', k: defs.filter((x) => x.k !== undefined).length });
      defs.push({ name: s.code === 'SAMM' ? 'Building-wide' : 'Tower-wide', type: 'common' });
      defs.forEach((l, i) => {
        l.id = insert('levels', { tower_id: towerId, name: l.name, sort: i });
        l.zones = ['typical', 'basement'].includes(l.type) ? s.zones.map((z, zi) => ({ name: z, id: insert('zones', { level_id: l.id, name: z, sort: zi }) })) : [];
      });
      const ks = defs.filter((x) => x.k !== undefined);
      const structStart = (k) => s.S + s.s0 + s.cycle * k;
      const finBase = (k) => structStart(k) + s.cycle + s.finLag;
      const lastFinEnd = finBase(ks[ks.length - 1].k) + s.finDur;

      const add = (lvl, zone, name, win, base, dur, extra = {}) => {
        const c = catalog[name];
        const fs_ = Math.round(win[0] * dur), fe = Math.max(Math.round(win[1] * dur), fs_ + 4);
        const trCode = q1('SELECT code FROM trades WHERE id=?', c.trade_id).code;
        const [bs, rate] = BASE[name] || [0, 10000];
        const f = s.scale * (zone && s.code === 'SAMM' ? 0.7 : 1) * R(0.88, 1.12);
        const dec = c.uom === 'nos' ? 0 : c.uom === 'ton' ? 1 : 0;
        const scope = c.method === 'milestone' ? null : Math.max(1, +(bs * f * (extra.scopeMul || 1)).toFixed(dec));
        const weight = c.method === 'milestone' ? +(rate * (extra.scopeMul || 1) / 1000).toFixed(1) : +((scope * rate) / 1000).toFixed(1);
        const a = {
          tower_id: towerId, level_id: lvl.id, zone_id: zone?.id ?? null, trade_id: c.trade_id, category: c.category, name: extra.name || c.name, method: c.method, uom: c.uom,
          scope_qty: scope, weight, plan_start: d(base + fs_), plan_finish: d(base + fe), contractor: subFor(trCode, c.category),
          engineer_id: staff[s.tag + '|' + trCode].eng, supervisor_id: staff[s.tag + '|' + trCode].sup, status: 'not_started', created_at: now(), is_demo: 1,
        };
        const id = insert('activities', a);
        if (c.method === 'milestone') JSON.parse(c.milestones).forEach((m, i) => insert('activity_milestones', { activity_id: id, name: m, weight: 1, sort: i }));
        allActs.push({ id, ...a, s, lvl, trCode, towerCode: s.code });
        return id;
      };

      for (const l of defs) {
        if (l.type === 'found') {
          for (const [n, w] of [['Excavation & earthworks', [0, .4]], ['Foundation concrete', [.3, .9]], ['Reinforcement fixing', [.2, .8]], ['Formwork erection', [.2, .85]]]) add(l, null, n, w, s.S, s.found);
        } else if (l.type === 'typical' || l.type === 'basement') {
          const ss = structStart(l.k), fb = finBase(l.k);
          const cs = l.type === 'basement' ? ['Reinforcement fixing', 'Formwork erection', 'Columns & shear walls concrete', 'Beams & slab concrete'] : Object.keys(CS_WIN);
          for (const n of cs) add(l, null, n, CS_WIN[n], ss, s.cycle, { scopeMul: l.type === 'basement' ? 1.3 : 1 });
          const arch = l.type === 'basement' ? ['Blockwork', 'Wet-area waterproofing', 'Internal painting'] : Object.keys(ARCH_WIN);
          for (const n of arch) {
            if (ZONED.has(n)) for (const z of l.zones) add(l, z, n, ARCH_WIN[n], fb, s.finDur);
            else add(l, null, n, ARCH_WIN[n], fb, s.finDur, l.type === 'basement' ? { scopeMul: 1.6 } : {});
          }
          const me = l.type === 'basement' ? ['Electrical first fix (conduit & trays)', 'Plumbing & sanitary pipework', 'ACMV ductwork & piping', 'Fire protection pipework'] : Object.keys(ME_WIN);
          for (const n of me) add(l, null, n, ME_WIN[n], fb - 15, Math.round(s.finDur * 0.9));
        } else if (l.type === 'roof') {
          const ss = structStart(l.k), fb = finBase(l.k);
          for (const n of ['Reinforcement fixing', 'Formwork erection', 'Beams & slab concrete']) add(l, null, n, CS_WIN[n], ss, s.cycle, { scopeMul: 0.8 });
          add(l, null, 'Wet-area waterproofing', [.1, .4], fb, s.finDur, { name: 'Roof waterproofing', scopeMul: 5 });
          add(l, null, 'Floor screed', [.35, .6], fb, s.finDur, { name: 'Roof screed', scopeMul: 0.9 });
          add(l, null, 'Equipment installation', [.5, .95], fb, s.finDur, { name: 'Plant & equipment installation (roof)' });
          add(l, null, 'ACMV ductwork & piping', [.3, .8], fb, s.finDur, { name: 'ACMV plant pipework (roof)', scopeMul: 0.6 });
        } else {
          add(l, null, 'Façade cladding', [0, 1], s.S + s.s0 + s.cycle * 5, lastFinEnd - 60 - (s.S + s.s0 + s.cycle * 5), { scopeMul: s.code === 'A' ? 1 : s.code === 'B' ? 0.9 : 0.7 });
          for (const n of s.code === 'B' ? ['Lift 1'] : ['Lift 1', 'Lift 2']) add(l, null, 'Lift installation', [0, 1], structStart(ks[ks.length - 1].k) + 20, lastFinEnd - 40 - (structStart(ks[ks.length - 1].k) + 20), { name: `Lift installation - ${n}` });
          add(l, null, 'Testing & commissioning', [0, 1], lastFinEnd - 90, 110);
          add(l, null, 'Handover snagging & finishes', [0, 1], lastFinEnd - 30, 70);
        }
      }
    }

    // configuration gaps (deliberate, so "Not configured" and the config panel can be demonstrated)
    const samm = allActs.filter((a) => a.towerCode === 'SAMM');
    const roofWp = samm.find((a) => a.name === 'Roof waterproofing');
    run('UPDATE activities SET scope_qty=NULL, weight=NULL WHERE id=?', roofWp.id);
    roofWp.scope_qty = null; roofWp.weight = null;
    const lift = samm.find((a) => a.name.startsWith('Lift installation'));
    run('UPDATE activities SET plan_start=NULL, plan_finish=NULL, weight=NULL WHERE id=?', lift.id);
    lift.plan_start = lift.plan_finish = null; lift.weight = null;

    // ---- simulate site progress ----
    const lagOf = (a) => {
      let lag = a.s.lag + (a.trCode === 'ME' ? 3 : a.trCode === 'CS' ? 1 : 0) + R(-3, 3);
      const k = a.lvl.k ?? 0;
      if (a.towerCode === 'A' && a.category === 'Tiling' && k >= 6 && k <= 9) lag += 28;
      if (a.towerCode === 'B' && a.category === 'ACMV' && k >= 2 && k <= 4) lag += 38;
      if (a.towerCode === 'SAMM' && a.category === 'Waterproofing') lag += 25;
      if (a.towerCode === 'B' && a.trCode === 'CS' && k >= 5) lag += 12;
      return Math.round(lag);
    };
    const active = [];
    const stateFor = (date) => {
      const age = diffDays(T, date);
      if (age > 2) return 'approved';
      const r = rnd();
      return r < 0.5 ? 'submitted' : r < 0.94 ? 'approved' : 'rejected';
    };
    const mkUpd = (a, date, qty, extra = {}) => {
      const state = extra.state || stateFor(date);
      const ms = extra.milestone_ids ? JSON.stringify(extra.milestone_ids) : null;
      const author = rnd() < 0.6 ? a.engineer_id : a.supervisor_id;
      const id = insert('updates', {
        activity_id: a.id, report_date: date, author_id: author, engineer_id: a.engineer_id, supervisor_id: a.supervisor_id, contractor: a.contractor,
        qty_today: qty, planned_qty: a.scope_qty, uom: a.uom, manpower: extra.manpower ?? (a.trCode === 'CS' ? RI(12, 45) : a.trCode === 'ARCH' ? RI(6, 22) : RI(4, 16)),
        status: extra.status || 'in_progress', milestone_ids: ms, remarks: extra.remarks ?? (rnd() < 0.4 ? pick(REMARKS) : null), next_plan: rnd() < 0.5 ? pick(NEXT) : null,
        state, submitted_at: date + 'T17:30:00.000Z', review_by: state === 'approved' || state === 'rejected' ? pm : null,
        review_at: state === 'approved' || state === 'rejected' ? addDays(date, 1) + 'T08:30:00.000Z' : null,
        review_note: state === 'rejected' ? pick(['Quantity does not match the inspection record. Please verify and resubmit.', 'Photos missing for the reported quantity. Please attach and resubmit.', 'Zone reported does not match work location. Correct and resubmit.']) : null,
        created_at: date + 'T16:00:00.000Z', updated_at: date + 'T17:30:00.000Z', is_demo: 1,
      });
      if (state !== 'approved' || diffDays(T, date) <= 5) {
        audit({ id: author, name: q1('SELECT name FROM users WHERE id=?', author).name }, 'submit', 'update', id, `Submitted update: ${a.name} (${date}), qty ${qty}`);
        if (state !== 'submitted') audit({ id: pm, name: 'Project Manager (Demo)' }, state === 'approved' ? 'approve' : 'reject', 'update', id, `${state === 'approved' ? 'Approved' : 'Rejected'} update: ${a.name} (${date}), qty ${qty}`);
      }
      return { id, state };
    };
    const skipSunday = (dt) => (new Date(dt + 'T00:00:00Z').getUTCDay() === 0 ? addDays(dt, 1) : dt);
    const updates = [];

    for (const a of allActs) {
      if (!a.plan_start || !a.plan_finish) continue;
      const lag = lagOf(a);
      const pctAtDay = (day) => plannedPct(a, addDays(day, -lag)) / 100;
      if (pctAtDay(T) <= 0) continue;
      const dStart = skipSunday(addDays(a.plan_start, lag));
      const fin = addDays(a.plan_finish, lag);
      const stale = rnd() < 0.09;
      const dEnd = fin <= T ? fin : d(-(stale ? RI(5, 12) : RI(0, 2)));
      if (dStart > dEnd) continue;
      const ms = q('SELECT * FROM activity_milestones WHERE activity_id=? ORDER BY sort', a.id);
      if (ms.length) {
        ms.forEach((m, i) => {
          const at = skipSunday(addDays(a.plan_start, Math.ceil(((i + 1) / ms.length) * (diffDays(a.plan_finish, a.plan_start) + 1)) - 1 + lag));
          if (at > T) return;
          const { id, state } = mkUpd(a, at, 0, { milestone_ids: [m.id], remarks: `${m.name}.`, status: i === ms.length - 1 ? 'completed' : 'in_progress' });
          updates.push(id);
          if (state === 'approved') run('UPDATE activity_milestones SET achieved_date=?, achieved_update_id=? WHERE id=?', at, id, m.id);
        });
        active.push(a);
        continue;
      }
      const dec = a.uom === 'nos' ? 0 : a.uom === 'ton' ? 1 : 0;
      const rd = (v) => +v.toFixed(dec);
      let cum = 0, day = dStart;
      const dates = [];
      while (day < dEnd) { dates.push(day); day = skipSunday(addDays(day, RI(3, 5))); }
      dates.push(dEnd);
      dates.forEach((dt, i) => {
        const done = fin <= T && i === dates.length - 1;
        const target = done ? a.scope_qty : rd(a.scope_qty * Math.min(1, pctAtDay(dt)));
        let qty = rd(target - cum);
        if (qty <= 0) return;
        if (cum + qty > a.scope_qty) qty = rd(a.scope_qty - cum);
        cum = rd(cum + qty);
        const { id } = mkUpd(a, dt, qty, { status: done ? 'completed' : 'in_progress' });
        updates.push(id);
      });
      active.push(a);
    }
    // on-hold activities (latest approved update says so)
    const candidates = active.filter((a) => a.method === 'quantity' && q1("SELECT 1 x FROM updates WHERE activity_id=? AND state='approved' AND report_date<?", a.id, d(-4)) && (q1('SELECT SUM(qty_today) s FROM updates WHERE activity_id=?', a.id).s ?? 0) < a.scope_qty * 0.9);
    for (let i = 0; i < 9 && candidates.length; i++) {
      const a = candidates.splice(Math.floor(rnd() * candidates.length), 1)[0];
      const date = d(-RI(1, 3));
      if (q1('SELECT 1 x FROM updates WHERE activity_id=? AND report_date=?', a.id, date)) continue;
      mkUpd(a, date, 0, { status: 'on_hold', state: 'approved', remarks: pick(HOLD), manpower: 0 });
    }
    // today's drafts
    let drafts = 0;
    for (const a of active.filter((x) => x.method === 'quantity').sort(() => rnd() - 0.5)) {
      if (drafts >= 14) break;
      if (q1('SELECT 1 x FROM updates WHERE activity_id=? AND report_date>=?', a.id, d(-1))) continue;
      if (((q1('SELECT SUM(qty_today) s FROM updates WHERE activity_id=?', a.id).s ?? 0) >= a.scope_qty * 0.85)) continue;
      mkUpd(a, T, +(a.scope_qty * R(0.01, 0.04)).toFixed(a.uom === 'nos' ? 0 : 1) || 1, { state: 'draft' });
      drafts++;
    }
    for (const a of allActs) recomputeActivity(a.id);

    // ---- milestones ----
    const ms = [
      [null, 'Practical completion - all towers', 300], ['A', 'Tower A - structure topping out', -45], ['A', 'Tower A - MEP first-fix complete', 35], ['A', 'Tower A - façade completion', 150],
      ['A', 'Tower A - TOP application', 240], ['B', 'Tower B - Level 4 structure handover', -12], ['B', 'Tower B - structure topping out', 35], ['B', 'Tower B - façade start', 25],
      ['B', 'Tower B - TOP application', 200], ['SAMM', 'SAMM - podium slab complete', 18], ['SAMM', 'SAMM - building watertight', 70], ['SAMM', 'SAMM - lifts commissioned', 180],
    ];
    const tid = Object.fromEntries(q('SELECT id,code FROM towers').map((t) => [t.code, t.id]));
    for (const [tc, name, off] of ms) insert('project_milestones', { tower_id: tc ? tid[tc] : null, name, due_date: d(off), achieved_date: off < -30 ? d(off + 3) : null, note: 'Demonstration milestone', is_demo: 1 });

    // ---- issues ----
    const first = (tc, cat, pred = () => true) => {
      const list = allActs.filter((a) => a.towerCode === tc && a.category === cat && pred(a));
      const act = list.filter((a) => q1("SELECT status FROM activities WHERE id=?", a.id).status === 'in_progress');
      return (act.length ? act : list)[Math.floor(rnd() * (act.length || list.length))];
    };
    const userOf = (a, kind) => (kind === 'pm' ? pm : kind === 'sup' ? a.supervisor_id : a.engineer_id);
    const ISS = [
      ['B', 'ACMV', 'Chilled water pipe clashes with beam at gridline 4/C', 'Pipe route conflicts with structural beam; sleeve not provided in slab.', 'Issue revised sleeve drawing and coordinate with C&S.', 'critical', 1, 'open', 9, -3, 1, 'pm'],
      ['B', 'ACMV', 'AHU delivery delayed by supplier - 3 weeks', 'Supplier advised delay in AHU shipment; affects ductwork sequence.', 'Approve alternative supplier or accept delay.', 'high', 1, 'open', 14, -6, 1, 'pm'],
      ['A', 'Tiling', 'Tile shade mismatch on approved sample', 'Delivered tiles differ from approved sample. Installation stopped in affected units.', 'Consultant to re-inspect and confirm accepted batch.', 'high', 1, 'in_progress', 7, -2, 1, 'eng'],
      ['A', 'Tiling', 'Floor screed not cured - tiling cannot start', 'Screed moisture content above limit on two levels.', 'Extend curing and re-test before tiling.', 'medium', 0, 'open', 5, 3, 0, 'eng'],
      ['A', 'Painting', 'Painting rework due to plaster cracks', 'Cracks appearing on plaster; paint on hold for affected zones.', 'Crack repair and re-inspection.', 'medium', 0, 'in_progress', 10, -1, 0, 'sup'],
      ['SAMM', 'Waterproofing', 'Waterproofing membrane failed ponding test at podium', 'Leak found at drain outlet detail during ponding test.', 'Rectify detail and re-test in 48 hours.', 'critical', 1, 'open', 6, -2, 0, 'eng'],
      ['SAMM', 'Waterproofing', 'Waterproofing material approval outstanding', 'Consultant has not approved alternative membrane submission.', 'Chase approval; decision required by PM.', 'high', 1, 'open', 12, 2, 1, 'pm'],
      ['B', 'Columns & Walls', 'Concrete cube test result below spec at Level 5 columns', '7-day cube results lower than expected.', 'Await 28-day results; core testing if still low.', 'critical', 1, 'in_progress', 4, 1, 1, 'pm'],
      ['B', 'Formwork', 'Formwork panels shortage', 'Insufficient panels to keep 16-day cycle.', 'Order additional panels.', 'medium', 0, 'open', 8, -4, 0, 'eng'],
      ['A', 'Electrical', 'DB room not accessible - waiting for civil handover', 'Cannot install DBs; room still has scaffolding.', 'Remove scaffolding and hand over.', 'medium', 0, 'open', 3, 4, 0, 'eng'],
      ['A', 'Fire Protection', 'Sprinkler head layout to be updated after ceiling change', 'Ceiling grid changed by architect; sprinkler heads clash.', 'Revised layout to be issued.', 'medium', 0, 'in_progress', 11, 5, 0, 'eng'],
      ['SAMM', 'Blockwork', 'Late delivery of blocks', 'Two deliveries missed this week.', 'Supplier expediting; consider alternative supplier.', 'medium', 0, 'in_progress', 6, 2, 0, 'sup'],
      ['B', 'Ceilings', 'Ceiling height conflict with ductwork at corridor', 'Ductwork lower than ceiling design level.', 'Design team to confirm ceiling drop.', 'high', 0, 'open', 5, 6, 1, 'pm'],
      ['A', 'Doors & Windows', 'Fire door frames not certified', 'Certificates missing for delivered frames.', 'Supplier to provide certification before install.', 'high', 1, 'open', 13, -5, 0, 'eng'],
      ['SAMM', 'Reinforcement', 'Rebar delivery short by 6 tons', 'Mill delivered less than ordered.', 'Supplier to top up; delays slab pour.', 'high', 0, 'resolved', 20, -8, 0, 'eng'],
      ['A', 'Plastering', 'Scaffolding access unsafe', 'Scaffold tags missing at facade lift.', 'Re-inspect and tag scaffolding.', 'high', 0, 'resolved', 18, -12, 0, 'sup'],
      ['B', 'Beams & Slabs', 'Pour delayed by pump breakdown', 'Concrete pump failed; pour postponed a day.', 'Replacement pump arranged.', 'low', 0, 'closed', 25, -18, 0, 'eng'],
      ['SAMM', 'Formwork', 'Drawing revision for transfer beam', 'Revised drawing issued late.', 'Formwork updated to revision C.', 'medium', 0, 'closed', 30, -20, 0, 'eng'],
      ['A', 'ACMV', 'Insulation supply shortage', 'Duct insulation stock exhausted.', 'Supplier re-stocked.', 'low', 0, 'closed', 28, -15, 0, 'eng'],
      ['B', 'Electrical', 'Cable tray supports clash with sprinkler pipe', 'Support spacing conflicts with fire pipework.', 'Coordinate revised support locations.', 'medium', 0, 'in_progress', 4, 3, 0, 'sup'],
      ['SAMM', 'Electrical', 'Temporary power outage affecting works', 'Repeated tripping of temporary supply.', 'Electrician to rebalance loads.', 'low', 0, 'open', 2, 5, 0, 'eng'],
      ['A', 'Lifts', 'Lift shaft dimension deviation at Level 9', 'Shaft 25 mm narrower than drawing.', 'Survey and confirm with lift vendor.', 'high', 1, 'open', 8, -1, 1, 'pm'],
    ];
    for (const [tc, cat, title, desc, action, priority, blocker, status, ago, targetOff, decision, ownerKind] of ISS) {
      const a = first(tc, cat);
      if (!a) continue;
      const raised = d(-ago);
      const id = insert('issues', {
        title, description: desc, required_action: action, tower_id: a.tower_id, level_id: a.level_id, zone_id: a.zone_id, trade_id: a.trade_id, activity_id: a.id, priority,
        status, is_blocker: blocker, needs_decision: decision, owner_id: userOf(a, ownerKind), raised_by: rnd() < 0.5 ? a.engineer_id : a.supervisor_id, raised_date: raised,
        target_date: d(targetOff), resolved_date: ['resolved', 'closed'].includes(status) ? addDays(raised, RI(3, 7)) : null,
        resolution_note: ['resolved', 'closed'].includes(status) ? 'Rectified and confirmed on site. See attached evidence.' : null,
        closed_by: status === 'closed' ? pm : null, closed_date: status === 'closed' ? addDays(raised, 9) : null, created_at: raised + 'T09:00:00.000Z', updated_at: raised + 'T09:00:00.000Z', is_demo: 1,
      });
      run('UPDATE issues SET code=? WHERE id=?', 'ISS-' + String(id).padStart(4, '0'), id);
      insert('issue_comments', { issue_id: id, user_id: pm, body: pick(['Please prioritise - this is on the critical path.', 'Update required by end of week.', 'Noted. Discuss at Monday coordination meeting.']), created_at: addDays(raised, 1) + 'T10:00:00.000Z' });
      audit({ id: a.engineer_id, name: 'Site Engineer (Demo)' }, 'create', 'issue', id, `Raised issue: ${title}`);
    }

    // ---- photos ----
    const dir = path.join(UPLOAD_DIR, 'demo');
    fs.mkdirSync(dir, { recursive: true });
    const files = Array.from({ length: 10 }, (_, i) => { const f = `demo/demo-${i + 1}.png`; fs.writeFileSync(path.join(UPLOAD_DIR, f), png(480, 320, 1000 + i * 37)); return f; });
    const recent = q(`SELECT u.id,u.activity_id,u.report_date,u.author_id FROM updates u WHERE u.state IN ('approved','submitted') AND u.report_date>=? ORDER BY u.id DESC LIMIT 400`, d(-20));
    const byId = new Map(allActs.map((a) => [a.id, a]));
    let n = 0;
    for (const u of recent.sort(() => rnd() - 0.5).slice(0, 44)) {
      const a = byId.get(u.activity_id);
      const zone = a.zone_id ? q1('SELECT name FROM zones WHERE id=?', a.zone_id).name : '';
      insert('photos', {
        file: files[n % files.length], mime: 'image/png', size: 24000, uploader_id: u.author_id, tower_id: a.tower_id, level_id: a.level_id, zone_id: a.zone_id, trade_id: a.trade_id,
        activity_id: a.id, update_id: u.id, kind: 'progress', taken_date: u.report_date, created_at: u.report_date + 'T15:00:00.000Z', is_demo: 1,
        caption: `${a.name} - ${a.lvl.name}${zone ? ' ' + zone : ''} (demo photo)`,
      });
      n++;
    }
    for (const i of q('SELECT id,tower_id,level_id,zone_id,trade_id,activity_id,raised_by,raised_date FROM issues LIMIT 8')) {
      insert('photos', { file: files[(n++) % files.length], mime: 'image/png', size: 24000, uploader_id: i.raised_by, tower_id: i.tower_id, level_id: i.level_id, zone_id: i.zone_id, trade_id: i.trade_id, activity_id: i.activity_id, issue_id: i.id, kind: 'issue', taken_date: i.raised_date, caption: 'Issue evidence (demo photo)', created_at: i.raised_date + 'T09:30:00.000Z', is_demo: 1 });
    }
    audit(null, 'seed', 'system', null, `Demonstration data generated: 3 towers, ${allActs.length} activities, ${updates.length}+ progress updates`);
  });
}


