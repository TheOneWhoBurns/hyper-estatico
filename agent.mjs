#!/usr/bin/env node
const base = (process.env.HYPER_ESTATICO_URL || 'http://localhost:4317').replace(/\/$/, '');

async function stdin() {
  let code = '';
  for await (const chunk of process.stdin) code += chunk;
  return code;
}

async function read() {
  const response = await fetch(`${base}/api/document`);
  const state = await response.json();
  if (!response.ok) throw new Error(state.error || `HTTP ${response.status}`);
  return state;
}

function pickSlide(document, selector) {
  if (!selector) return null;
  const index = /^\d+$/.test(selector) ? Number(selector) - 1 : document.slides.findIndex(slide => slide.id === selector);
  if (index < 0 || index >= document.slides.length) throw new Error('Slide no encontrado.');
  return { slide: document.slides[index], index: index + 1, total: document.slides.length };
}

try {
  const action = process.argv[2];
  const selector = process.argv[3];
  if (process.argv.length > 4) throw new Error('Demasiados argumentos.');
  if (action === 'read') {
    const state = await read();
    console.log(JSON.stringify(selector ? { ...pickSlide(state.document, selector), revision: state.revision } : state, null, 2));
  } else if (action === 'run') {
    if (process.stdin.isTTY) throw new Error('Pasa el JavaScript por stdin.');
    const code = await stdin();
    if (!code.trim()) throw new Error('El código está vacío.');
    const state = await read();
    const doc = structuredClone(state.document);
    const picked = pickSlide(doc, selector);
    const run = new Function('doc', 'slide', code);
    const result = run(doc, picked?.slide);
    if (result && typeof result.then === 'function') throw new Error('El código debe ser síncrono.');
    const response = await fetch(`${base}/api/document`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': state.revision },
      body: JSON.stringify(doc),
    });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || `HTTP ${response.status}`);
    console.log(JSON.stringify(selector ? { ...pickSlide(doc, selector), revision: saved.revision } : { document: doc, revision: saved.revision }, null, 2));
  } else {
    throw new Error('Uso: node agent.mjs read [número|id] | node agent.mjs run [número|id] < cambio.js');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
