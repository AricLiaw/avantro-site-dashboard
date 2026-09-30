// Small shared helpers: dates, numbers, errors.
export const pad = (n) => String(n).padStart(2, '0');

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toUTC = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export const isDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(toUTC(s)).toISOString().slice(0, 10) === s;

export const addDays = (s, n) => new Date(toUTC(s) + n * 864e5).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 864e5); // a - b in days
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
export const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

export function startOfWeek(s) {
  const dow = (new Date(toUTC(s)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(s, -dow);
}
export function monthRange(s) {
  const [y, m] = s.split('-').map(Number);
  const from = `${y}-${pad(m)}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [from, to];
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

// '' / null / undefined -> null, otherwise number (NaN if not numeric)
export const num = (v) => (v === '' || v == null ? null : Number.isFinite(+v) ? +v : NaN);
export const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
export const int01 = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
export const uniq = (arr) => [...new Set(arr)];
