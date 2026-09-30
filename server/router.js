// Minimal router with role enforcement. Every non-public route requires a valid session;
// `roles` limits which roles may call it (checked here, in the backend, before any handler runs).
import { HttpError } from './util.js';

const routes = [];
export function route(method, pattern, opts, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, opts: opts || {}, handler });
}
export const get = (p, o, h) => route('GET', p, o, h);
export const post = (p, o, h) => route('POST', p, o, h);
export const put = (p, o, h) => route('PUT', p, o, h);
export const del = (p, o, h) => route('DELETE', p, o, h);

export const ALL = ['pm', 'admin', 'engineer', 'supervisor'];
export const STAFF = ['engineer', 'supervisor'];
export const MGMT = ['pm', 'admin'];

export function match(method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { route: r, params };
  }
  return { route: null, pathMatched };
}

export function authorize(route, user) {
  if (route.opts.public) return;
  if (!user) throw new HttpError(401, 'Please sign in');
  const roles = route.opts.roles || ALL;
  if (!roles.includes(user.role)) throw new HttpError(403, 'Your role does not have access to this function');
  if (user.must_change && !route.opts.allowMustChange) throw new HttpError(403, 'Please change your temporary password first', { must_change: true });
}

export const sendFile = (buffer, contentType, filename) => ({ __file: true, buffer, contentType, filename });
