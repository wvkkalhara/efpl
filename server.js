#!/usr/bin/env node
/**
 * server.js — a zero-dependency static server for the site office.
 *
 *   node server.js            # http://0.0.0.0:3000
 *   PORT=8080 node server.js
 *
 * It exists for two reasons:
 *   1. Service workers (true offline install) need http:// or https://,
 *      they do not work from file://.
 *   2. A tablet on the site Wi-Fi can open the app from the office PC.
 *
 * It serves static files only. All data lives in the browser and in
 * Firebase — there is no database behind this process, so there is no
 * server-side attack surface to maintain.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function headers(ext) {
  return {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    // No X-Frame-Options / frame-ancestors: the review harness embeds the
    // app in a sandboxed iframe. Deployments that must not be framed can
    // add "frame-ancestors 'self'" to the CSP below.
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://*.firebaseapp.com",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
    'Cache-Control': 'no-cache',
  };
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const target = path.resolve(ROOT, rel);

  // path traversal guard
  if (!target.startsWith(ROOT)) {
    res.writeHead(403, headers('.txt'));
    return res.end('Forbidden');
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, headers('.txt'));
      return res.end('Not found');
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, Object.assign(headers(ext), { 'Content-Length': stat.size }));
    fs.createReadStream(target).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`EnerFab Biomass Storage on http://localhost:${PORT}`);
  console.log('Open it on a tablet with http://<office-pc-ip>:' + PORT);
});
