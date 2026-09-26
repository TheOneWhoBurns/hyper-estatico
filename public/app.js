import { validate, blobDocument } from './model.js';

const $ = id => document.getElementById(id);
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const copy = value => structuredClone(value);
const slide = () => deck.slides[slideIndex];
const element = () => slide().elements.find(el => el.id === selectedId);
let deck, revision, slideIndex = 0, selectedId = null, scale = 1, gesture = null;
let dirty = false, saving = false, draft = false, blocked = false, remotePending = false;
let toastTimer;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').hidden = true, 5000);
}
function status() {
  $('save-status').textContent = blocked ? 'Conflicto' : saving ? 'Guardando…' : dirty || draft ? 'Sin guardar' : 'Guardado';
}
function code() {
  if (!draft) $('code-editor').value = JSON.stringify(deck, null, 2);
  status();
}
function place(node, el) {
  Object.assign(node.style, { left: `${el.x}px`, top: `${el.y}px`, width: `${el.width}px`, height: `${el.height}px` });
}
function fit() {
  if (!deck) return;
  const area = $('workspace'), padding = getComputedStyle(area), frame = slide().frame;
  scale = Math.max(.025, Math.min(
    (area.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight)) / frame.width,
    (area.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom)) / frame.height,
  ));
  Object.assign($('stage').style, { width: `${frame.width * scale}px`, height: `${frame.height * scale}px` });
  Object.assign($('frame').style, { width: `${frame.width}px`, height: `${frame.height}px`, transform: `scale(${scale})` });
}
function selection() {
  const el = element();
  $('selection').hidden = !el;
  if (el) place($('selection'), el);
}
function render() {
  const current = slide();
  const wanted = [{ id: '$background', name: 'Fondo', x: 0, y: 0, ...current.frame, html: current.background }, ...current.elements];
  const existing = new Map([...$('frame').querySelectorAll('.blob')].map(node => [node.dataset.id, node]));
  for (const [id, node] of existing) if (!wanted.some(item => item.id === id)) node.remove();
  wanted.forEach((item, index) => {
    let box = existing.get(item.id);
    if (!box) {
      box = document.createElement('div');
      box.className = 'blob';
      box.dataset.id = item.id;
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.tabIndex = -1;
      box.append(iframe);
      box.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        if (box.dataset.id === '$background') { selectedId = null; selection(); return; }
        begin(event, box.dataset.id, 'move');
      });
      $('frame').insertBefore(box, $('selection'));
    }
    place(box, item);
    box.style.zIndex = index;
    box.classList.toggle('background-blob', index === 0);
    const iframe = box.firstElementChild;
    iframe.title = item.name;
    if (iframe.dataset.source !== item.html) {
      iframe.srcdoc = blobDocument(item.html);
      iframe.dataset.source = item.html;
    }
  });
  $('slide-status').textContent = `${slideIndex + 1} / ${deck.slides.length}`;
  selection(); fit(); status();
}
function changed({ repaint = true } = {}) {
  dirty = true;
  if (repaint) render();
  code();
  save();
}
async function save() {
  if (saving || blocked || !dirty) return;
  saving = true; status();
  const snapshot = JSON.stringify(deck);
  try {
    const response = await fetch('/api/document', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': revision }, body: snapshot });
    const result = await response.json();
    if (response.status === 409) { blocked = true; throw new Error('El archivo cambió. Conserva tu edición y recarga antes de seguir.'); }
    if (!response.ok) throw new Error(result.error);
    revision = result.revision;
    dirty = snapshot !== JSON.stringify(deck);
  } catch (error) { blocked = true; toast(error.message); }
  finally { saving = false; status(); if (dirty && !blocked) save(); else if (remotePending) checkRemote(); }
}
function apply() {
  if (!draft) return true;
  try {
    const next = validate(JSON.parse($('code-editor').value));
    const oldId = slide().id;
    deck = next;
    slideIndex = Math.max(0, deck.slides.findIndex(item => item.id === oldId));
    selectedId = null;
    draft = false;
    $('frame').querySelectorAll('.blob').forEach(node => node.remove());
    changed();
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}
function showSlide(index) {
  if (index < 0 || index >= deck.slides.length || !apply()) return;
  slideIndex = index;
  selectedId = null;
  $('frame').querySelectorAll('.blob').forEach(node => node.remove());
  const url = new URL(location.href);
  url.searchParams.set('slide', String(index + 1));
  history.replaceState(null, '', url);
  render();
}
function begin(event, id, direction) {
  if (!apply()) return;
  event.preventDefault(); event.stopPropagation();
  selectedId = id; selection();
  gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, scale, direction, start: copy(element()) };
  event.currentTarget.setPointerCapture(event.pointerId);
}
$('selection').querySelectorAll('.handle').forEach(handle => handle.addEventListener('pointerdown', event => begin(event, selectedId, handle.dataset.direction)));
document.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const g = gesture, el = element(), s = g.start, frame = slide().frame;
  const dx = (event.clientX - g.x) / g.scale, dy = (event.clientY - g.y) / g.scale;
  if (g.direction === 'move') {
    el.x = Math.round(clamp(s.x + dx, 0, frame.width - s.width));
    el.y = Math.round(clamp(s.y + dy, 0, frame.height - s.height));
  } else {
    let left = s.x, top = s.y, right = s.x + s.width, bottom = s.y + s.height;
    if (g.direction.includes('e')) right = clamp(Math.round(right + dx), left + 16, frame.width);
    if (g.direction.includes('s')) bottom = clamp(Math.round(bottom + dy), top + 16, frame.height);
    if (g.direction.includes('w')) left = clamp(Math.round(left + dx), 0, right - 16);
    if (g.direction.includes('n')) top = clamp(Math.round(top + dy), 0, bottom - 16);
    Object.assign(el, { x: left, y: top, width: right - left, height: bottom - top });
  }
  const node = [...$('frame').querySelectorAll('.blob')].find(box => box.dataset.id === el.id);
  place(node, el); selection();
});
function end(event) {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const moved = JSON.stringify(gesture.start) !== JSON.stringify(element());
  gesture = null;
  if (moved) changed(); else if (remotePending) checkRemote();
}
document.addEventListener('pointerup', end);
document.addEventListener('pointercancel', end);

const textTarget = target => target instanceof HTMLElement && (target.matches('textarea,input,[contenteditable]') || !!target.closest('[contenteditable]'));
document.addEventListener('copy', event => {
  if (!deck || !element() || textTarget(event.target)) return;
  event.clipboardData.setData('text/plain', JSON.stringify({ type: 'hyper-estatico-element', element: element() }));
  event.preventDefault();
});
document.addEventListener('paste', event => {
  if (!deck || textTarget(event.target) || !apply()) return;
  let payload;
  try { payload = JSON.parse(event.clipboardData.getData('text/plain')); } catch { return; }
  if (payload?.type !== 'hyper-estatico-element' || !payload.element) return;
  const source = payload.element, frame = slide().frame;
  if (![source.x, source.y, source.width, source.height].every(Number.isFinite) || typeof source.html !== 'string' || typeof source.name !== 'string' || source.width < 16 || source.height < 16) return;
  const width = Math.min(source.width, frame.width), height = Math.min(source.height, frame.height);
  const item = { ...copy(source), id: crypto.randomUUID(), width, height, x: clamp(source.x + 24, 0, frame.width - width), y: clamp(source.y + 24, 0, frame.height - height) };
  slide().elements.push(item); selectedId = item.id; event.preventDefault(); changed();
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); apply(); return; }
  if (textTarget(event.target)) return;
  if ((event.key === 'Delete' || event.key === 'Backspace') && element()) {
    if (!apply()) return;
    slide().elements = slide().elements.filter(item => item.id !== selectedId);
    selectedId = null; event.preventDefault(); changed();
  }
  if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault(); showSlide(slideIndex + (event.key === 'PageDown' ? 1 : -1));
  }
});
$('toggle-code').onclick = () => {
  $('code-panel').hidden = !$('code-panel').hidden;
  $('toggle-code').setAttribute('aria-expanded', String(!$('code-panel').hidden));
  code(); fit();
};
$('close-code').onclick = () => {
  if (!apply()) return;
  $('code-panel').hidden = true;
  $('toggle-code').setAttribute('aria-expanded', 'false'); fit();
};
$('code-editor').oninput = () => { draft = $('code-editor').value !== JSON.stringify(deck, null, 2); status(); };
$('code-editor').onkeydown = event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const editor = event.target;
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
};
$('apply-code').onclick = apply;
window.addEventListener('message', event => {
  const iframe = [...$('frame').querySelectorAll('.blob iframe')].find(node => node.contentWindow === event.source);
  if (!iframe) return;
  if (event.data?.type === 'hyper-estatico:select') {
    selectedId = iframe.parentElement.dataset.id === '$background' ? null : iframe.parentElement.dataset.id;
    selection();
  } else if (event.data?.type === 'hyper-estatico:text' && typeof event.data.html === 'string') {
    const id = iframe.parentElement.dataset.id;
    if (id === '$background') slide().background = event.data.html;
    else {
      const item = slide().elements.find(el => el.id === id);
      if (!item) return;
      item.html = event.data.html;
    }
    iframe.dataset.source = event.data.html;
    changed({ repaint: false });
  } else if (event.data?.type === 'hyper-estatico:dragover') {
    document.body.classList.add('dragging-image');
  } else if (event.data?.type === 'hyper-estatico:drop') {
    const rect = iframe.getBoundingClientRect();
    handleDrop(event.data, rect.left + event.data.x, rect.top + event.data.y);
  }
});

async function imageSize(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}
async function addImage(src, name, clientX, clientY, offset = 0) {
  const size = await imageSize(src), frame = slide().frame;
  const factor = Math.min(1, frame.width * .45 / size.width, frame.height * .6 / size.height);
  const width = Math.max(16, Math.round(size.width * factor)), height = Math.max(16, Math.round(size.height * factor));
  const rect = $('stage').getBoundingClientRect();
  const x = clamp(Math.round((clientX - rect.left) / scale + offset), 0, frame.width - width);
  const y = clamp(Math.round((clientY - rect.top) / scale + offset), 0, frame.height - height);
  const safe = src.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const item = { id: crypto.randomUUID(), name, x, y, width, height, html: `<img src="${safe}" alt="" style="display:block;width:100%;height:100%;object-fit:contain">` };
  slide().elements.push(item); selectedId = item.id; changed();
}
async function uploadImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Arrastra un archivo de imagen.');
  const response = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Error ${response.status} al guardar la imagen.`);
  return result.asset.url;
}
document.addEventListener('dragover', event => {
  if (![...event.dataTransfer.types].some(type => ['Files', 'text/uri-list', 'text/html'].includes(type))) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('dragging-image');
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dragging-image'); });
async function handleDrop(data, clientX, clientY) {
  document.body.classList.remove('dragging-image');
  if (!deck || !apply()) return;
  try {
    const files = [...(data.files || [])].filter(file => file.type.startsWith('image/'));
    if (files.length) {
      for (const [index, file] of files.entries()) await addImage(await uploadImage(file), file.name, clientX, clientY, index * 24);
      return;
    }
    const src = new DOMParser().parseFromString(data.html || '', 'text/html').querySelector('img')?.src || (data.uri || '').split('\n').find(line => /^https?:\/\//.test(line));
    if (!src || !/^(https?:\/\/|data:image\/)/.test(src)) throw new Error('No se encontró una imagen para añadir.');
    let imported;
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const name = src.startsWith('data:') ? 'imagen' : new URL(src).pathname.split('/').pop() || 'imagen';
      imported = await uploadImage(new File([blob], name, { type: blob.type }));
    } catch { throw new Error('No se pudo importar la imagen. Guárdala y arrastra el archivo al lienzo.'); }
    await addImage(imported, 'Imagen', clientX, clientY);
  } catch (error) { toast(error.message); }
}
document.addEventListener('drop', event => {
  if (!deck || !$('workspace').contains(event.target)) return;
  event.preventDefault();
  handleDrop({ files: event.dataTransfer.files, html: event.dataTransfer.getData('text/html'), uri: event.dataTransfer.getData('text/uri-list') }, event.clientX, event.clientY);
});

async function checkRemote() {
  if (saving || gesture) { remotePending = true; return; }
  remotePending = false;
  try {
    const response = await fetch('/api/document'), state = await response.json();
    if (!response.ok) throw new Error(state.error);
    if (state.revision === revision) return;
    if (JSON.stringify(state.document) === JSON.stringify(deck)) { revision = state.revision; return; }
    if (dirty || draft) { blocked = true; status(); toast('El archivo cambió. Conserva tu código pendiente antes de recargar.'); return; }
    const oldId = slide().id;
    deck = validate(state.document);
    revision = state.revision;
    slideIndex = Math.max(0, deck.slides.findIndex(item => item.id === oldId));
    selectedId = null;
    $('frame').querySelectorAll('.blob').forEach(node => node.remove());
    render(); code();
  } catch (error) { toast(error.message); }
}
new ResizeObserver(fit).observe($('workspace'));
window.addEventListener('beforeunload', event => { if (dirty || draft) { event.preventDefault(); event.returnValue = ''; } });
try {
  const response = await fetch('/api/document'), state = await response.json();
  if (!response.ok) throw new Error(state.error);
  deck = validate(state.document); revision = state.revision;
  slideIndex = clamp(Number(new URL(location.href).searchParams.get('slide') || 1) - 1 || 0, 0, deck.slides.length - 1);
  render(); code();
  new EventSource('/api/events').onmessage = checkRemote;
} catch (error) { toast(error.message); $('save-status').textContent = 'No se pudo cargar'; }
