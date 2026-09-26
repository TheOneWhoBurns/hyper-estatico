import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { migrateDocument, validate } from '../public/model.js';

let directory, file, server;
const port = 14317;
const url = `http://127.0.0.1:${port}/api/document`;
const seed = { version: 2, slides: [
  { id: 'one', frame: { width: 1280, height: 720 }, background: '<style>body{background:white}</style>', elements: [] },
  { id: 'two', frame: { width: 1280, height: 960 }, background: '<style>body{background:coral}</style>', elements: [] },
] };
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hyper-estatico-test-'));
  file = join(directory, 'document.json');
  await writeFile(file, JSON.stringify(seed));
  server = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), DECK_PATH: file, ASSET_DIR: join(directory, 'assets') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server failed to start'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('Server startup timeout')), 5000).unref())]);
});
after(async () => { server?.kill(); if (server?.exitCode === null) await once(server, 'exit'); await rm(directory, { recursive: true, force: true }); });
const read = async () => { const response = await fetch(url); assert.equal(response.status, 200); return response.json(); };
async function agent(action, input = '') {
  const child = spawn(process.execPath, ['agent.mjs', ...action], { cwd: new URL('..', import.meta.url), env: { ...process.env, HYPER_ESTATICO_URL: `http://127.0.0.1:${port}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => errors += chunk);
  child.stdin.end(input);
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, errors);
  return JSON.parse(output);
}
test('agent can inspect one slide, import an image, and save its HTML without touching another slide', async () => {
  const before = await agent(['read', '2']);
  assert.equal(before.slide.id, 'two');
  assert.equal(before.total, 2);
  assert.equal(before.slide.background, seed.slides[1].background);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>');
  const upload = await fetch(`http://127.0.0.1:${port}/api/assets?name=sample.svg`, { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: svg });
  assert.equal(upload.status, 201);
  const { asset } = await upload.json();
  assert.equal(asset.kind, 'image');
  assert.deepEqual(await readFile(join(directory, 'assets', 'images', `${asset.id}.svg`)), svg);
  const served = await fetch(`http://127.0.0.1:${port}${asset.url}`);
  assert.equal(served.headers.get('content-type'), 'image/svg+xml');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), svg);
  const html = `<img src="${asset.url}" style="width:100%;height:100%">`;
  const result = await agent(['run', '2'], `slide.elements.push({id:'image',name:'Imagen',x:220,y:310,width:440,height:230,html:${JSON.stringify(html)}});`);
  assert.equal(result.slide.elements[0].id, 'image');
  const disk = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(disk.slides[0], seed.slides[0]);
  assert.deepEqual(disk.slides[1], result.slide);
  assert.deepEqual((await read()).document, disk);
  const edited = await agent(['run', 'two'], `slide.frame.height = 1100; slide.background = '<style>body{background:navy}</style>'; slide.elements[0].html = '<p contenteditable="true">Texto editado</p>';`);
  assert.deepEqual(edited.slide.frame, { width: 1280, height: 1100 });
  assert.equal(edited.slide.elements[0].html, '<p contenteditable="true">Texto editado</p>');
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(persisted.slides[0], seed.slides[0]);
  assert.deepEqual(persisted.slides[1], edited.slide);
});
test('stale save cannot overwrite an external agent edit or place an element outside the slide', async () => {
  const editor = await read();
  const outside = structuredClone(editor.document);
  outside.slides[0].elements.push({ id: 'lost', name: 'Lost', x: 1270, y: 0, width: 100, height: 100, html: 'lost' });
  const invalid = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': editor.revision }, body: JSON.stringify(outside) });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await read()), editor);
  const external = structuredClone(editor.document);
  external.slides[0].background = '<style>body{background:gold}</style>';
  await writeFile(file, JSON.stringify(external));
  const stale = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': editor.revision }, body: JSON.stringify(editor.document) });
  assert.equal(stale.status, 409);
  assert.deepEqual((await read()).document, external);
  const current = await read();
  const candidates = ['red', 'blue'].map(color => {
    const next = structuredClone(current.document);
    next.slides[0].background = `<style>body{background:${color}}</style>`;
    return next;
  });
  const responses = await Promise.all(candidates.map(document => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': current.revision }, body: JSON.stringify(document) })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = candidates[responses.findIndex(response => response.status === 200)];
  assert.deepEqual((await read()).document, winner);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), winner);
});

test('legacy migration preserves user content and metadata and cannot overwrite an existing file', async () => {
  const legacy = { version: 1, title: 'Mi presentación', frame: { width: 1280, height: 960 }, background: '<style>body{background:tan}</style>', elements: [
    { id: 'headline', name: 'Titular', x: 493, y: 210, width: 195, height: 616, html: '<h1 contenteditable="true">Mi edición</h1>', custom: { keep: true } },
  ] };
  const expected = { title: 'Mi presentación', version: 2, slides: [{ id: 'slide-1', frame: legacy.frame, background: legacy.background, elements: legacy.elements }] };
  assert.deepEqual(migrateDocument(legacy), expected);
  assert.equal(legacy.version, 1);
  assert.deepEqual(migrateDocument(expected), expected);
  const input = join(directory, 'legacy.json'), output = join(directory, 'migrated.json');
  const original = JSON.stringify(legacy, null, 2);
  await writeFile(input, original);
  const migrate = async destination => {
    const child = spawn(process.execPath, ['migrate.mjs', input, destination], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
    return (await once(child, 'exit'))[0];
  };
  assert.equal(await migrate(output), 0);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), expected);
  assert.equal(await migrate(output), 1);
  assert.equal(await migrate(input), 1);
  assert.equal(await readFile(input, 'utf8'), original);
  const outside = structuredClone(legacy);
  outside.elements[0].x = 1280;
  assert.throws(() => migrateDocument(outside), /dentro del frame/);
  for (const invalid of [null, { version: 2, slides: [null] }, { ...expected, slides: [{ ...expected.slides[0], elements: [null] }] }]) {
    assert.throws(() => validate(invalid), /inválido|único/);
  }
});
