# Instrucciones para agentes

`presentations/demo.json` es el documento fuente. El agente opera mediante `node agent.mjs read` y `node agent.mjs run < cambio.js`; así lee la versión actual y guarda con detección de conflictos. Usa el código para ajustar el documento sin tocar el runtime del editor.

Conserva el esquema `version: 2` con `slides[]`. Cada slide tiene `id`, `frame: {width, height}`, `background` y `elements[]`. El fondo es propio de cada slide. Cada elemento necesita `id`, `name`, `x`, `y`, `width`, `height` y `html` y debe quedar dentro de su frame. Mantén los IDs ajenos a tu cambio; el orden de `elements` determina qué queda delante. `node agent.mjs read 2` lee solo el segundo slide y `node agent.mjs run 2` recibe `slide` además de `doc`.

Escribe el HTML, CSS y JavaScript de cada bloque inline y adapta su diseño al tamaño del propio bloque. Haz que el texto destinado a edición directa tenga `contenteditable="true"`; el editor guarda esos cambios. Tras editar, comprueba en el editor que el frame, el fondo y los elementos se ven y funcionan como esperaba el usuario. Usa pocas pruebas significativas; corrige los fallos antes de dar el trabajo por terminado. El skill `skills/hyper-estatico/SKILL.md` contiene el flujo breve para agentes.

Para archivos que entregue el usuario, usa `node assets.mjs add /ruta/al/archivo` y referencia la URL devuelta en el HTML/CSS del slide. `node assets.mjs list` muestra imágenes y fuentes ya disponibles. Mantén los archivos en `assets/` en vez de incrustarlos como data URL en el JSON.
