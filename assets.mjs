import { readFile, writeFile, mkdir, readdir, stat, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSET_LIMIT = 25 * 1024 * 1024;
export const assetRoot = resolve(process.env.ASSET_DIR || join(dirname(fileURLToPath(import.meta.url)), 'assets'));
const formats = {
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'], avif: ['image', 'image/avif'], svg: ['image', 'image/svg+xml'],
  woff: ['font', 'font/woff'], woff2: ['font', 'font/woff2'], ttf: ['font', 'font/ttf'], otf: ['font', 'font/otf'],
};
function format(bytes) {
  const start = bytes.subarray(0, 16);
  const ascii = start.toString('ascii');
  if (start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (start[0] === 255 && start[1] === 216 && start[2] === 255) return 'jpg';
  if (/^GIF8[79]a/.test(ascii)) return 'gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii.slice(8, 12))) return 'avif';
  if (ascii.startsWith('wOFF')) return 'woff';
  if (ascii.startsWith('wOF2')) return 'woff2';
  if (ascii.startsWith('OTTO')) return 'otf';
  if (start.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) || ascii.startsWith('true')) return 'ttf';
  const xml = bytes.subarray(0, 8192).toString('utf8').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(xml)) return 'svg';
  throw new Error('Formato no compatible. Usa PNG, JPEG, GIF, WebP, AVIF, SVG, WOFF, WOFF2, TTF u OTF.');
}
export async function addAsset(bytes, originalName) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (!bytes.length || bytes.length > ASSET_LIMIT) throw new Error('Cada archivo debe contener datos y pesar como máximo 25 MB.');
  const extension = format(bytes);
  const [kind, mimeType] = formats[extension];
  const id = createHash('sha256').update(bytes).digest('hex');
  const category = kind === 'image' ? 'images' : 'fonts';
  const name = basename(String(originalName || `asset.${extension}`).replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240) || `asset.${extension}`;
  const asset = { id, kind, name, url: `/assets/${category}/${id}.${extension}`, mimeType, size: bytes.length, createdAt: new Date().toISOString(), ...(kind === 'font' ? { fontFamily: `Asset-${id.slice(0, 16)}` } : {}) };
  await mkdir(join(assetRoot, category), { recursive: true });
  await mkdir(join(assetRoot, 'metadata'), { recursive: true });
  const file = join(assetRoot, category, `${id}.${extension}`);
  // Content addressing makes concurrent identical writes safe; publish metadata only after the blob is complete.
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  try { await link(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; } finally { await unlink(temporary); }
  const metadata = join(assetRoot, 'metadata', `${id}.json`);
  const metaTemporary = `${metadata}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(metaTemporary, JSON.stringify(asset, null, 2) + '\n');
  let deduplicated = false;
  try { await link(metaTemporary, metadata); } catch (error) { if (error.code !== 'EEXIST') throw error; deduplicated = true; } finally { await unlink(metaTemporary); }
  return { asset: JSON.parse(await readFile(metadata, 'utf8')), deduplicated };
}
export async function listAssets() {
  let files;
  try { files = await readdir(join(assetRoot, 'metadata')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const assets = await Promise.all(files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => readFile(join(assetRoot, 'metadata', name), 'utf8').then(JSON.parse)));
  return assets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export async function readAsset(pathname) {
  const match = /^\/assets\/(images|fonts)\/([a-f0-9]{64})\.(png|jpg|gif|webp|avif|svg|woff|woff2|ttf|otf)$/.exec(pathname);
  if (!match || (formats[match[3]][0] === 'image' ? 'images' : 'fonts') !== match[1]) return null;
  try { return { bytes: await readFile(join(assetRoot, match[1], `${match[2]}.${match[3]}`)), mimeType: formats[match[3]][1] }; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...files] = process.argv.slice(2);
    if (command === 'list' && !files.length) console.log(JSON.stringify({ assets: await listAssets() }, null, 2));
    else if (command === 'add' && files.length) {
      const results = [];
      for (const file of files) {
        if ((await stat(file)).size > ASSET_LIMIT) throw new Error(`${file}: supera 25 MB.`);
        results.push(await addAsset(await readFile(file), basename(file)));
      }
      console.log(JSON.stringify({ assets: results.map(result => result.asset) }, null, 2));
    } else throw new Error('Uso: node assets.mjs add <archivo> [más archivos] | node assets.mjs list');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
