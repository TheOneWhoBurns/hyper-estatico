import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './public/model.js';
import { addAsset, listAssets, readAsset, ASSET_LIMIT } from './assets.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const file = resolve(process.env.DECK_PATH || join(root, 'presentations/demo.json'));
const port = Number(process.env.PORT || 4317);
const clients = new Set();
const hash = body => createHash('sha256').update(body).digest('hex');
let writing = Promise.resolve();
const read = async () => { const raw = await readFile(file, 'utf8'); return { document: validate(JSON.parse(raw)), revision: hash(raw) }; };
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(res, 403, { error: 'Host no autorizado.' });
    const assetRead = req.method === 'GET' && new URL(req.url, `http://${host}`).pathname.startsWith('/assets/');
    if (!assetRead && req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Origen no autorizado.' });
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/api/assets' && req.method === 'GET') return json(res, 200, { assets: await listAssets() });
    if (url.pathname === '/api/assets' && req.method === 'POST') {
      if (Number(req.headers['content-length']) > ASSET_LIMIT) return json(res, 413, { error: 'El archivo supera 25 MB.' });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > ASSET_LIMIT) return json(res, 413, { error: 'El archivo supera 25 MB.' });
        chunks.push(chunk);
      }
      const result = await addAsset(Buffer.concat(chunks), url.searchParams.get('name'));
      return json(res, result.deduplicated ? 200 : 201, result);
    }
    if (url.pathname.startsWith('/assets/') && req.method === 'GET') {
      const asset = await readAsset(url.pathname);
      if (!asset) return json(res, 404, { error: 'Archivo no encontrado.' });
      res.writeHead(200, {
        'Content-Type': asset.mimeType,
        'Content-Length': asset.bytes.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      });
      return res.end(asset.bytes);
    }
    if (url.pathname === '/api/document' && req.method === 'GET') return json(res, 200, await read());
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n'); clients.add(res);
      const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000);
      req.on('close', () => { clearInterval(timer); clients.delete(res); }); return;
    }
    if (url.pathname === '/api/document' && req.method === 'PUT') {
      if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'Se requiere JSON.' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 12 * 1024 * 1024) return json(res, 413, { error: 'El proyecto supera 12 MB.' }); }
      const document = validate(JSON.parse(body));
      const operation = writing.then(async () => {
        const current = await read();
        if (req.headers['if-match'] !== current.revision) return json(res, 409, { error: 'El archivo cambió fuera del editor. Conserva tu código pendiente antes de recargar.' });
        const raw = JSON.stringify(document, null, 2) + '\n';
        await writeFile(file + '.tmp', raw); await rename(file + '.tmp', file);
        json(res, 200, { revision: hash(raw) });
      });
      writing = operation.catch(() => {}); await operation; return;
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método no disponible.' });
    const paths = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/model.js': 'model.js' };
    if (!paths[url.pathname]) return json(res, 404, { error: 'No encontrado.' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': `${types[extname(paths[url.pathname])]} ; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(join(root, 'public', paths[url.pathname])));
  } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.end(); }
});
await mkdir(dirname(file), { recursive: true });
let debounce;
const watcher = watch(dirname(file), (_, name) => {
  if (name && String(name) !== file.split('/').at(-1)) return;
  clearTimeout(debounce); debounce = setTimeout(() => { for (const client of clients) client.write('data: changed\n\n'); }, 180);
});
server.listen(port, '127.0.0.1', () => console.log(`hyper-estatico → http://localhost:${port}\nDocumento: ${file}`));
function close() { watcher.close(); for (const c of clients) c.end(); server.close(() => process.exit()); }
process.on('SIGTERM', close); process.on('SIGINT', close);
