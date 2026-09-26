---
name: hyper-estatico
description: Create or edit a hyper-estatico presentation through its minimal agent interface, then inspect the rendered result in the browser. Use for work in a hyper-estatico project, not for unrelated HTML pages.
---

# hyper-estatico

Work from the project directory. Start the local server with `npm start` if it is not running. A presentation has `slides[]`. Each slide contains only a `frame`, its own `background`, and `elements`. The background and every element are independent HTML/CSS/JavaScript blobs; elements also have `id`, `name`, `x`, `y`, `width`, and `height`. Coordinates use frame pixels; elements must stay entirely inside their frame. Array order controls stacking.

Use two agent actions:

1. `node agent.mjs read` returns the presentation and revision. `node agent.mjs read 2` returns only slide 2 when you want to focus on one slide. Read before deciding what to change.
2. Send JavaScript on stdin to `node agent.mjs run [slide number or ID]`. The code receives `doc`, the current presentation, and `slide` when a selector is given. Mutate it synchronously; the command validates and saves it with conflict detection, then returns the result. Example:

   ```sh
   node agent.mjs run 1 <<'JS'
   const el = slide.elements.find(el => el.id === 'headline');
   el.html = '<h1 contenteditable="true">Nuevo titular</h1>';
   JS
   ```

Preserve existing slide and element IDs unless removing them is part of the request. Put HTML, CSS, and JavaScript inside the relevant blob string. Make user-facing text directly editable by adding `contenteditable="true"` to its text element. The app persists edits from those elements automatically. Treat `run` as local trusted code execution. If the save reports a conflict, read the new state and reconcile the intended change before trying again.

When the user supplies an image or font file, import it with `node assets.mjs add /absolute/path/to/file`. Use the returned `/assets/images/...` URL in `<img src="...">` or `/assets/fonts/...` URL in a blob's `@font-face` rule. `node assets.mjs list` shows existing assets and their original names; reuse them when appropriate. Keep binary files in the managed `assets/` tree rather than putting data URLs in the document. Files dragged into the browser canvas are imported automatically.

Inspect the actual slide in a browser after changing it. Use `http://localhost:4317/?slide=2` to view one slide. Check the visual layout at the intended ratio, type into editable text to verify persistence, and exercise interactive content when the request includes behavior. The editor synchronizes saved changes automatically. Keep the human interface and the agent workflow minimal; do not add component catalogs or extra controls for ordinary content edits.
