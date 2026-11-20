import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { pipeline } from 'node:stream';

const password = readFileSync(new URL('../.local/reader-password', import.meta.url), 'utf8').trim();
if (password.length < 24) throw new Error('A strong reader password is required');

const digest = value => createHash('sha256').update(value).digest();
const expected = digest('Basic ' + Buffer.from('reader:' + password).toString('base64'));
const forwardedHeaders = ['range', 'content-type', 'content-length', 'sec-fetch-site', 'accept-encoding', 'if-none-match'];

createServer((req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!timingSafeEqual(digest(req.headers.authorization ?? ''), expected)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="English Tool"' }).end('Sign in to English Tool.');
    return;
  }
  const stateWrite = req.method === 'POST' && req.url === '/api/reader-state';
  if (!req.url?.startsWith('/') || (req.method !== 'GET' && !stateWrite)) {
    res.writeHead(405).end();
    return;
  }

  const upstream = request({
    hostname: '127.0.0.1',
    port: 4173,
    method: req.method,
    path: req.url,
    headers: Object.fromEntries(forwardedHeaders
      .filter(name => req.headers[name] !== undefined).map(name => [name, req.headers[name]])),
    timeout: 120_000,
  }, response => {
    const vary = response.headers.vary;
    res.writeHead(response.statusCode ?? 502, {
      ...response.headers, vary: vary ? vary + ', Authorization' : 'Authorization',
    });
    pipeline(response, res, () => {});
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (res.headersSent) res.destroy();
    else res.writeHead(502).end('English Tool is temporarily unavailable.');
  });
  res.on('close', () => upstream.destroy());
  if (stateWrite) req.pipe(upstream);
  else upstream.end();
}).listen(4174, '127.0.0.1');
