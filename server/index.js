// Avantro Project - construction progress dashboard. HTTP server entry point (no external dependencies).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, q, q1, run } from './db.js';
import { match, authorize } from './router.js';
import { currentUser } from './auth.js';
import { HttpError } from './util.js';
import './routes-core.js';
import './routes-dashboard.js';
import './routes-updates.js';
import './routes-issues.js';
import './routes-admin.js';
import './reports.js';
import { seedDemo, seedEmpty, wipeProject, DEMO_PASSWORD } from './seed.js';
import { removePhoto } from './routes-updates.js';

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

// ---- startup seeding ----
if (process.argv.includes('--reseed')) {
  wipeProject(null);
  seedDemo();
  console.log('Demonstration data regenerated.');
} else if (!q1('SELECT 1 x FROM users')) {
  if ((process.env.AVANTRO_SEED || 'demo') === 'empty') {
    const c = seedEmpty();
    console.log(`\n  Empty project created. Sign in as "${c.username}" with the temporary password below (you must change it on first sign-in):\n  ${c.password}\n`);
  } else {
    seedDemo();
    console.log('\n  Demonstration data created (3 towers, all trades). Demo accounts are listed on the sign-in page.');
  }
}
const cleanup = () => {
  for (const p of q("SELECT * FROM photos WHERE kind='pending' AND created_at < ?", new Date(Date.now() - 2 * 864e5).toISOString())) removePhoto(p);
  run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
};
cleanup();
setInterval(cleanup, 3600e3).unref();

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request is too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Length': data.length, ...headers });
  res.end(data);
}

async function handleApi(req, res, url) {
  const { route, params, pathMatched } = match(req.method, url.pathname);
  if (!route) return send(res, pathMatched ? 405 : 404, { error: pathMatched ? 'Method not allowed' : 'Not found' });
  const user = currentUser(req);
  authorize(route, user);
  if (!['GET', 'HEAD'].includes(req.method)) {
    // CSRF defence in depth (cookie is SameSite=Strict): custom header + same-origin Origin check
    if (req.headers['x-requested-with'] !== 'avantro') throw new HttpError(403, 'Missing request header');
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
  }
  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const buf = await readBody(req, route.opts.raw ? 12 * 1024 * 1024 : 2 * 1024 * 1024);
    if (route.opts.raw) body = buf;
    else if (buf.length) {
      try { body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
      if (body === null || typeof body !== 'object') body = {};
    }
  }
  const query = Object.fromEntries(url.searchParams);
  const out = await route.handler({ req, res, user, params, query, body });
  if (out?.__file) {
    const headers = { 'Content-Type': out.contentType, 'Content-Length': out.buffer.length, 'X-Content-Type-Options': 'nosniff', ...(out.headers || {}) };
    if (out.filename) headers['Content-Disposition'] = `attachment; filename="${out.filename.replace(/[^\w.\-]/g, '_')}"`;
    res.writeHead(200, headers);
    return res.end(out.buffer);
  }
  send(res, 200, out ?? { ok: true }, { 'Cache-Control': 'no-store' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) return send(res, 404, 'Not found');
    file = path.join(PUBLIC, 'index.html');
  }
  const buf = fs.readFileSync(file);
  send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (['GET', 'HEAD'].includes(req.method)) serveStatic(req, res, url);
    else send(res, 405, 'Method not allowed');
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on the server' });
  }
});
server.requestTimeout = 60000;
server.listen(PORT, HOST, () => {
  const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log(`\n  Avantro Project dashboard running\n  This computer : http://localhost:${PORT}`);
  for (const ip of nets) console.log(`  On your network: http://${ip}:${PORT}   (phones / tablets on the same Wi-Fi)`);
  console.log('\n  Press Ctrl+C to stop.\n');
});
