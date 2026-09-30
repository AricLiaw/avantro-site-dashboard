// Dependency-free SVG/HTML charts. Every mark is also labelled with text so meaning never depends on colour alone.
import { html, raw, esc, clamp, dt, pctTxt, varTxt, S } from './core.js';

const NAVY = '#0b2545';
export const SERIES_COLORS = ['#0b2545', '#3b6db3', '#8fb0dd'];

// groups: [{label, sub?, values: [{key, v, planned?}]}]   series: [{key, label, fill, stroke?, dash?}]
export function groupedBars({ groups, series, height = 250 }) {
  const W = Math.max(520, groups.length * (series.length * 44 + 40) + 60), H = height, L = 34, B = 46, T = 14;
  const iw = W - L - 10, ih = H - B - T;
  const gw = iw / groups.length, bw = Math.min(46, (gw - 24) / series.length);
  const y = (v) => T + ih - (clamp(v) / 100) * ih;
  const grid = [0, 25, 50, 75, 100].map((t) => `<line class="gl" x1="${L}" x2="${W - 10}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`).join('');
  const bars = groups.map((g, gi) => {
    const x0 = L + gi * gw + (gw - bw * series.length) / 2;
    const cells = series.map((s, si) => {
      const val = g.values.find((v) => v.key === s.key);
      const x = x0 + si * bw;
      if (!val || val.v == null) return `<g><text x="${x + bw / 2}" y="${y(0) - 6}" text-anchor="middle" style="font-size:9px;fill:#667085">n/c</text></g>`;
      const h = (clamp(val.v) / 100) * ih;
      const label = `${g.label} – ${s.label}: ${val.v.toFixed(1)}%`;
      return `<g class="bar" data-g="${gi}" data-k="${esc(s.key)}" tabindex="0" role="button" aria-label="${esc(label)}"><title>${esc(label)}</title>
        <rect x="${x + 1}" y="${y(val.v)}" width="${bw - 2}" height="${Math.max(h, 1)}" rx="3" fill="${s.fill}" ${s.stroke ? `stroke="${s.stroke}" stroke-width="1.5" ${s.dash ? 'stroke-dasharray="4 3"' : ''}` : ''}/>
        <text x="${x + bw / 2}" y="${y(val.v) - 5}" text-anchor="middle" style="font-weight:700;font-size:${bw < 30 ? 9.5 : 11}px">${val.v.toFixed(bw < 30 ? 0 : 1)}%</text>
        ${val.planned != null ? `<line x1="${x - 2}" x2="${x + bw + 2}" y1="${y(val.planned)}" y2="${y(val.planned)}" stroke="#f79009" stroke-width="3"/>` : ''}</g>`;
    }).join('');
    return `${cells}<text x="${L + gi * gw + gw / 2}" y="${H - B + 16}" text-anchor="middle" style="font-weight:600">${esc(g.label)}</text>${g.sub ? `<text x="${L + gi * gw + gw / 2}" y="${H - B + 30}" text-anchor="middle" style="font-size:10px;fill:#667085">${esc(g.sub)}</text>` : ''}`;
  }).join('');
  const legend = `<div class="legend">${series.map((s) => `<span><i style="background:${s.fill};${s.stroke ? `border:1.5px ${s.dash ? 'dashed' : 'solid'} ${s.stroke}` : ''}"></i>${esc(s.label)}</span>`).join('')}${groups.some((g) => g.values.some((v) => v.planned != null)) ? '<span><i style="background:#f79009;height:4px;vertical-align:2px"></i>Planned to date</span>' : ''}</div>`;
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart of progress">${grid}${bars}</svg>${legend}`);
}

export function bindBars(el, groups, onClick) {
  const fire = (t) => { const g = t.closest('[data-g]'); if (g) onClick(groups[+g.dataset.g], g.dataset.k); };
  el.addEventListener('click', (e) => fire(e.target));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e.target); } });
}

// Planned vs actual S-curve
export function lineChart({ points, asOf, height = 300 }) {
  if (!points?.length) return raw('<div class="empty">No curve available</div>');
  const W = 760, H = height, L = 40, R = 14, T = 16, B = 34;
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date) || t0 + 1;
  const x = (d) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (H - T - B) * (1 - clamp(v) / 100);
  const path = (key) => {
    let d = '', pen = false;
    for (const p of points) { if (p[key] == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p[key]).toFixed(1)} `; pen = true; }
    return d;
  };
  const acts = points.filter((p) => p.actual != null);
  const area = acts.length > 1 ? `M${x(acts[0].date)},${y(0)} ` + acts.map((p) => `L${x(p.date).toFixed(1)},${y(p.actual).toFixed(1)}`).join(' ') + ` L${x(acts[acts.length - 1].date)},${y(0)} Z` : '';
  const grid = [0, 20, 40, 60, 80, 100].map((t) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`).join('');
  const months = [];
  const span = (t1 - t0) / 864e5, step = span > 500 ? 3 : span > 240 ? 2 : 1;
  const d0 = new Date(t0);
  for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); d.getTime() <= t1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1))) months.push(d.toISOString().slice(0, 10));
  const xt = months.map((m) => `<line class="gl" x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${H - B}"/><text x="${x(m)}" y="${H - B + 16}" text-anchor="middle">${new Date(m).toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>`).join('');
  const tx = asOf && Date.parse(asOf) >= t0 && Date.parse(asOf) <= t1 ? x(asOf) : null;
  const last = acts[acts.length - 1];
  const planAt = last ? points.find((p) => p.date === last.date)?.planned : null;
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Planned versus actual progress curve" data-line>
    ${grid}${xt}
    ${area ? `<path d="${area}" fill="${NAVY}" opacity=".08"/>` : ''}
    <path d="${path('planned')}" fill="none" stroke="#667085" stroke-width="2.5" stroke-dasharray="7 5"/>
    <path d="${path('actual')}" fill="none" stroke="${NAVY}" stroke-width="3"/>
    ${tx != null ? `<line x1="${tx}" x2="${tx}" y1="${T}" y2="${H - B}" stroke="#b42318" stroke-width="1.5"/><text x="${tx}" y="${T - 3}" text-anchor="middle" style="fill:#b42318;font-weight:700">Today</text>` : ''}
    ${last ? `<circle cx="${x(last.date)}" cy="${y(last.actual)}" r="5" fill="${NAVY}" stroke="#fff" stroke-width="2"/><text x="${Math.min(x(last.date) + 8, W - 90)}" y="${y(last.actual) + 16}" style="font-weight:700;fill:${NAVY}">${last.actual.toFixed(1)}%${planAt != null ? ` (${varTxt(last.actual - planAt)})` : ''}</text>` : ''}
    <line data-hover style="display:none" y1="${T}" y2="${H - B}" stroke="#98a2b3" stroke-dasharray="3 3"/>
    <rect data-hit x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" style="cursor:pointer"/>
  </svg>
  <div class="legend"><span><i style="background:${NAVY}"></i>Actual (approved)</span><span><i style="background:none;border-top:3px dashed #667085;height:0;vertical-align:3px"></i>Planned (baseline)</span><span><i style="background:#b42318;width:3px;height:12px"></i>Today</span></div>`);
}

let tipEl;
const tip = (show, text, x, y) => {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  tipEl.style.display = show ? 'block' : 'none';
  if (show) { tipEl.innerHTML = text; tipEl.style.left = Math.min(x + 14, innerWidth - 190) + 'px'; tipEl.style.top = y + 14 + 'px'; }
};
export function bindLine(el, points, onPoint) {
  const svg = el.querySelector('[data-line]');
  if (!svg) return;
  const hit = svg.querySelector('[data-hit]'), hover = svg.querySelector('[data-hover]');
  const vb = svg.viewBox.baseVal, L = 40, R = 14;
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date);
  const near = (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * vb.width;
    const t = t0 + ((vx - L) / (vb.width - L - R)) * (t1 - t0);
    return points.reduce((a, p) => (Math.abs(Date.parse(p.date) - t) < Math.abs(Date.parse(a.date) - t) ? p : a));
  };
  const xOf = (p) => L + ((Date.parse(p.date) - t0) / Math.max(1, t1 - t0)) * (vb.width - L - R);
  hit.addEventListener('mousemove', (e) => {
    const p = near(e);
    hover.style.display = ''; hover.setAttribute('x1', xOf(p)); hover.setAttribute('x2', xOf(p));
    const v = p.actual != null && p.planned != null ? p.actual - p.planned : null;
    tip(true, `<b>${dt(p.date)}</b><br>Planned: ${pctTxt(p.planned)}<br>Actual: ${p.actual == null ? '—' : pctTxt(p.actual)}${v != null ? `<br>Variance: ${varTxt(v)}` : ''}<br><span style="opacity:.8">Click to see work approved</span>`, e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => { hover.style.display = 'none'; tip(false); });
  hit.addEventListener('click', (e) => { const i = points.indexOf(near(e)); onPoint?.(points[i], points[Math.max(0, i - 1)]); });
}

// heat-map cell colour (sequential navy scale; the % is always printed in the cell)
export function heatStyle(v) {
  if (v == null) return 'background:#f2f4f7;color:#667085';
  const stops = [[238, 243, 250], [182, 201, 230], [91, 131, 189], [11, 37, 69]];
  const t = clamp(v) / 100 * 3, i = Math.min(2, Math.floor(t)), f = t - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `background:rgb(${c});color:${v > 52 ? '#fff' : '#0b2545'}`;
}

// segmented count bar + clickable legend
export function segBar(items, total) {
  const T = total ?? items.reduce((s, i) => s + i.n, 0);
  if (!T) return html`<div class="empty">No activities</div>`;
  return html`<div class="pb lg" style="display:flex;background:var(--line-2)" role="img" aria-label="${items.map((i) => `${i.label} ${i.n}`).join(', ')}">${items.map((i) => html`<span style="width:${(i.n / T) * 100}%;background:${i.color};display:block"></span>`)}</div>`;
}
