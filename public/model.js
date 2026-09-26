const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validate(doc) {
  if (!isRecord(doc) || doc.version !== 2 || !Array.isArray(doc.slides) || !doc.slides.length) throw new Error('Formato de presentación inválido.');
  const slideIds = new Set();
  for (const slide of doc.slides) {
    if (!isRecord(slide) || typeof slide.id !== 'string' || !slide.id.trim() || slideIds.has(slide.id)) throw new Error('Cada slide necesita un ID único.');
    slideIds.add(slide.id);
    for (const key of ['width', 'height']) {
      if (!Number.isFinite(slide.frame?.[key]) || slide.frame[key] < 100 || slide.frame[key] > 8000) throw new Error('Tamaño de frame inválido.');
    }
    if (typeof slide.background !== 'string' || !Array.isArray(slide.elements)) throw new Error('Fondo o elementos inválidos.');
    const ids = new Set();
    for (const el of slide.elements) {
      if (!isRecord(el) || typeof el.id !== 'string' || !el.id.trim() || el.id === '$background' || ids.has(el.id)) throw new Error('Cada elemento necesita un ID único dentro del slide.');
      ids.add(el.id);
      if (typeof el.name !== 'string' || typeof el.html !== 'string') throw new Error('El elemento necesita nombre y HTML.');
      for (const key of ['x', 'y', 'width', 'height']) {
        if (!Number.isFinite(el[key])) throw new Error('Geometría inválida.');
      }
      if (el.width < 16 || el.height < 16 || el.x < 0 || el.y < 0 || el.x + el.width > slide.frame.width || el.y + el.height > slide.frame.height) throw new Error('El elemento debe quedar dentro del frame.');
    }
  }
  return doc;
}

// Migration is explicit: reads and normal saves keep requiring the current schema.
// Never repair geometry silently; an invalid legacy document needs a deliberate edit.
export function migrateDocument(document) {
  if (!isRecord(document)) throw new Error('Formato de presentación inválido.');
  if (document.version === 2) return validate(structuredClone(document));
  if (document.version !== 1 || 'slides' in document) throw new Error('Versión de presentación no compatible.');
  const { version, frame, background, elements, ...metadata } = structuredClone(document);
  return validate({ ...metadata, version: 2, slides: [{ id: 'slide-1', frame, background, elements }] });
}

export function blobDocument(html) {
  const defaults = '<meta data-he-runtime charset="utf-8"><meta data-he-runtime name="viewport" content="width=device-width,initial-scale=1"><style data-he-runtime>html,body{margin:0;width:100%;height:100%}*{box-sizing:border-box}body{overflow:hidden}</style><script data-he-runtime>addEventListener("pointerdown",()=>parent.postMessage({type:"hyper-estatico:select"},"*"));addEventListener("input",e=>{if(!e.target.isContentEditable)return;const clone=document.documentElement.cloneNode(true);clone.querySelectorAll("[data-he-runtime]").forEach(n=>n.remove());parent.postMessage({type:"hyper-estatico:text",html:"<!doctype html>"+clone.outerHTML},"*")});addEventListener("dragover",e=>{e.preventDefault();parent.postMessage({type:"hyper-estatico:dragover"},"*")});addEventListener("drop",e=>{e.preventDefault();parent.postMessage({type:"hyper-estatico:drop",x:e.clientX,y:e.clientY,files:[...e.dataTransfer.files],html:e.dataTransfer.getData("text/html"),uri:e.dataTransfer.getData("text/uri-list")},"*")});</script>';
  if (/<html[\s>]/i.test(html)) {
    return /<head[\s>]/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1>${defaults}`)
      : html.replace(/<html([^>]*)>/i, `<html$1><head>${defaults}</head>`);
  }
  return `<!doctype html><html><head>${defaults}</head><body>${html}</body></html>`;
}
