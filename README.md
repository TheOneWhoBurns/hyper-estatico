# hyper-estatico

Un editor mínimo para presentaciones hechas con HTML. Cada slide tiene tres piezas: un **frame**, un **fondo** HTML y **elementos** HTML que se pueden mover y redimensionar. Cada bloque admite CSS y JavaScript propios.

Necesitas Node.js 22 o posterior. Ejecuta `npm start` y abre [http://localhost:4317](http://localhost:4317).

El botón **Código** abre el JSON de toda la presentación. `↓`, `→` y `Espacio` avanzan; `↑` y `←` retroceden. También funcionan `PageDown` y `PageUp`. Los atajos respetan la edición de texto y los controles interactivos; el contador indica el slide actual. Para mover un elemento, selecciónalo y arrastra el pequeño control en su borde. Sus ocho puntos cambian el tamaño. `Ctrl/Cmd+C` y `Ctrl/Cmd+V` duplican el elemento seleccionado; `Delete` lo elimina. Puedes arrastrar archivos de imagen al lienzo para añadirlos. Se guardan en `assets/images/` y el documento conserva una URL estable. El editor impide que un elemento quede fuera de su frame.

El texto con `contenteditable="true"` se edita directamente con un clic y se guarda automáticamente. Ejemplo de un bloque:

```html
<h1 contenteditable="true">Título editable</h1>
```

El documento fuente es [`presentations/demo.json`](presentations/demo.json). Sus cambios se sincronizan con el lienzo. Un ejemplo del esquema:

```json
{
  "version": 2,
  "slides": [
    {
      "id": "intro",
      "frame": { "width": 1280, "height": 720 },
      "background": "<style>body{background:#f7f4ec}</style>",
      "elements": [
        {
          "id": "headline", "name": "Titular",
          "x": 150, "y": 270, "width": 980, "height": 180,
          "html": "<h1 contenteditable=\"true\">Hola</h1>"
        }
      ]
    }
  ]
}
```

Las coordenadas usan píxeles del frame. El orden de `elements` determina qué queda delante. El fondo pertenece a su slide y se renderiza separado de los elementos.

## Interfaz para agentes

El agente puede leer toda la presentación o un slide específico y ejecutar JavaScript sobre el estado actual:

```sh
node agent.mjs read
node agent.mjs read 1
node agent.mjs run 1 <<'JS'
slide.elements.push({
  id: crypto.randomUUID(), name: 'Nota',
  x: 80, y: 80, width: 400, height: 120,
  html: '<p contenteditable="true">Hola desde un agente</p>'
});
JS
```

En `run`, `doc` es la presentación completa y `slide` es el slide elegido cuando se pasa número o ID. El comando lee la versión reciente, guarda con detección de conflictos y devuelve el estado resultante. El código se ejecuta localmente con Node.js; usa solo código de confianza. Para ver un slide aislado en el navegador, abre `http://localhost:4317/?slide=2`. La variable `HYPER_ESTATICO_URL` cambia el servidor usado por el comando.

El [skill hyper-estatico](skills/hyper-estatico/SKILL.md) explica a un agente cómo crear, editar y comprobar contenido en este proyecto.

## Imágenes y fuentes

`assets/images/` y `assets/fonts/` guardan archivos por hash de contenido; `assets/metadata/` conserva nombre original, formato y URL. La importación evita duplicados y admite archivos de hasta 25 MB. El agente puede añadir archivos que le dé el usuario y consultar lo disponible:

```sh
node assets.mjs add /ruta/a/imagen.png /ruta/a/fuente.woff2
node assets.mjs list
```

Usa la URL devuelta en el HTML de un elemento (`<img src="/assets/images/…">`) o en CSS de un bloque:

```css
@font-face { font-family: "MiFuente"; src: url("/assets/fonts/…") format("woff2"); }
```

El servidor también ofrece `GET /api/assets` y `POST /api/assets?name=archivo.png` para importar desde la app. Solo escucha en localhost. La presentación, sus imágenes y sus fuentes viven en el mismo proyecto para poder moverlo como unidad.
