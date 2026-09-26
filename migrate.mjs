#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { migrateDocument } from './public/model.js';

try {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error('Uso: node migrate.mjs origen.json salida.json (archivo nuevo)');
  if (resolve(input) === resolve(output)) throw new Error('La salida debe ser distinta del documento original.');
  const source = await readFile(input, 'utf8');
  const document = migrateDocument(JSON.parse(source));
  await writeFile(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
  console.log(`Documento migrado: ${resolve(output)}. El original no cambió.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
