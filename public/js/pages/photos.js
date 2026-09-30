// Photo library: filter by tower, floor, trade, type and date; open in a viewer; upload site photos.
import { html, raw, api, qs, S, icon, dt, photoUrl, lightbox, pickOne, errText, loading, toast, uploadPhoto, isStaff, isMgmt, debounce, todayStr, addDays, selBtn, field, modal } from '../core.js';
import { showActivity, showIssue, showUpdate, getActs, changed } from './drill.js';

const st = { tower: null, trade: null, kind: null, from: null, to: null, q: '' };

export async function photosPage(el) {
  el.innerHTML = String(html`<div class="page-head"><div><h1>Photos</h1></div></div>${loading(3)}`);
  let r;
  try { r = await api('/api/photos' + qs({ ...st, limit: 120 })); } catch (e) { el.innerHTML = `<div class="banner bad">${errText(e)}</div>`; return; }
  const chip = (k, label, val) => html`<button class="chip ${st[k] ? 'on' : ''}" data-f="${k}">${label}: <b>${val}</b></button>`;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Photos</h1><p>${r.total} photo${r.total === 1 ? '' : 's'} · progress photos, issue evidence and resolution proof.</p></div>${isStaff() ? html`<button class="btn btn-primary" id="add">${icon('camera')} Add site photos</button>` : ''}</div>
    <div class="filters">${chip('tower', 'Tower', st.tower ? S.meta.towers.find((t) => t.id === +st.tower)?.name : 'All')}${chip('trade', 'Trade', st.trade ? S.meta.trades.find((t) => t.id === +st.trade)?.name : 'All')}${chip('kind', 'Type', { progress: 'Progress', issue: 'Issue', resolution: 'Resolution' }[st.kind] || 'All')}
      <label class="chip">From <input type="date" class="chip-date" data-d="from" value="${st.from || ''}"></label><label class="chip">To <input type="date" class="chip-date" data-d="to" value="${st.to || ''}"></label>
      <input type="search" id="q" placeholder="Search captions…" value="${st.q}" style="width:190px;min-height:36px;border-radius:999px" aria-label="Search captions">${Object.values(st).some(Boolean) ? html`<button class="chip x" data-f="clear">Clear</button>` : ''}</div>
    ${r.rows.length ? html`<div class="thumbs" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${r.rows.map((p, i) => html`<button class="thumb" data-p="${i}">${p.is_demo ? html`<span class="demo">DEMO</span>` : ''}<img loading="lazy" src="${photoUrl(p.id)}" alt="${p.caption || 'Site photo'}"><span class="cap"><b>${p.caption || p.activity || 'Site photo'}</b><span class="muted">${[p.tower, p.level, p.zone].filter(Boolean).join(' › ')}</span><br><span class="muted">${dt(p.taken_date)} · ${p.kind === 'issue' ? 'Issue ' + (p.issue_code || '') : p.kind === 'resolution' ? 'Resolution' : p.uploader || ''}</span></span></button>`)}</div>` : html`<div class="card empty">No photos match the filters.</div>`}`);
  el.onclick = async (e) => {
    const t = (s) => e.target.closest(s);
    let b;
    if ((b = t('[data-p]'))) return lightbox(r.rows, +b.dataset.p, (p) => html`<span class="row gap wrap">${p.activity_id ? html`<button class="btn btn-sm" data-go="a" data-id="${p.activity_id}">Activity</button>` : ''}${p.update_id ? html`<button class="btn btn-sm" data-go="u" data-id="${p.update_id}">Update</button>` : ''}${p.issue_id ? html`<button class="btn btn-sm" data-go="i" data-id="${p.issue_id}">Issue</button>` : ''}${(isMgmt() || p.uploader_id === S.user.id) && !p.update_id && !p.issue_id ? html`<button class="btn btn-sm btn-danger" data-go="d" data-id="${p.id}">Delete</button>` : ''}</span>`);
    if (t('#add')) return addPhotos(el);
    if ((b = t('[data-f]'))) {
      const k = b.dataset.f;
      if (k === 'clear') { Object.assign(st, { tower: null, trade: null, kind: null, from: null, to: null, q: '' }); return photosPage(el); }
      const opts = { tower: S.meta.towers.map((x) => ({ value: x.id, label: x.name })), trade: S.meta.trades.map((x) => ({ value: x.id, label: x.name })), kind: [['progress', 'Progress photos'], ['issue', 'Issue photos'], ['resolution', 'Resolution evidence']].map(([v, l]) => ({ value: v, label: l })) }[k];
      const p = await pickOne({ title: k, options: opts, value: st[k], clearLabel: 'All' });
      if (p) { st[k] = p.value; photosPage(el); }
    }
  };
  document.getElementById('overlay').onclick = async (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const id = +b.dataset.id;
    if (b.dataset.go === 'a') return showActivity(id);
    if (b.dataset.go === 'u') return showUpdate(id);
    if (b.dataset.go === 'i') return showIssue(id);
    if (b.dataset.go === 'd') { try { await api('/api/photos/' + id, { method: 'DELETE' }); toast('Photo deleted'); photosPage(el); } catch (er) { toast(errText(er), 'bad'); } }
  };
  el.onchange = (e) => { const d = e.target.dataset.d; if (d) { st[d] = e.target.value || null; photosPage(el); } };
  el.oninput = debounce((e) => { if (e.target.id === 'q') { st.q = e.target.value; photosPage(el).then(() => { const i = el.querySelector('#q'); i.focus(); i.setSelectionRange(999, 999); }); } }, 450);
}

async function addPhotos(el) {
  const acts = await getActs();
  const s = { activity: null, files: [], caption: '' };
  const m = modal({ title: 'Add site photos', body: '' });
  const paint = () => {
    const a = acts.find((x) => x.id === s.activity);
    m.body(html`${field('Work activity *', selBtn('act', 'Activity', a ? a.name : '', { ph: 'Search and choose the activity…' }))}${field('Caption', html`<input id="cap" value="${s.caption}" maxlength="300" placeholder="What does the photo show?">`)}<label class="btn" style="width:100%">${icon('camera')} Take or choose photos<input type="file" accept="image/*" multiple hidden id="files"></label><p class="small muted" id="fmsg">${s.files.length ? s.files.length + ' photo(s) selected' : 'Photos are resized on your device before upload.'}</p>`);
    m.footer(html`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="up" ${raw(s.activity && s.files.length ? '' : 'disabled')}>Upload</button>`);
  };
  paint();
  m.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pick=act]')) { s.caption = m.$('#cap').value; const r = await pickOne({ title: 'Work activity', options: acts.map((a) => ({ value: a.id, label: a.name, sub: `${[a.tower, a.level, a.zone].filter(Boolean).join(' › ')} · ${a.trade}` })), value: s.activity, searchable: true }); if (r) { s.activity = +r.value; paint(); } }
    if (e.target.closest('#up')) {
      const b = e.target.closest('#up'); b.disabled = true; s.caption = m.$('#cap').value; let n = 0;
      for (const f of s.files) { try { await uploadPhoto(f, { activity_id: s.activity, caption: s.caption, standalone: 1, taken_date: todayStr() }); n++; m.$('#fmsg').textContent = `Uploaded ${n} of ${s.files.length}…`; } catch (er) { toast(errText(er), 'bad'); } }
      m.close(); toast(`${n} photo(s) added`, 'ok'); photosPage(el);
    }
  });
  m.el.addEventListener('change', (e) => { if (e.target.id === 'files') { s.caption = m.$('#cap').value; s.files = [...e.target.files]; paint(); } });
}
