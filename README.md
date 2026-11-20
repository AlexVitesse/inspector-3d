# inspector-3d

Panel de depuración para gemelos digitales hechos con **three.js r160** y `WebGLRenderer`. Un solo archivo, `inspector.js`, sin dependencias.
Se activa con `?debug=1`; sin ese parámetro no descarga ni ejecuta nada.

Lo que da:

| Sección | Qué hace |
|---|---|
| Stats | fps, ms (media y máximo), draw calls, triángulos, líneas y puntos **por cuadro**, geometrías, texturas, programas y heap. Se pinta 4 veces por segundo. |
| Memoria estimada | Al pulsar: MB de atributos (cada geometría una vez) y de texturas (`w*h*4*1.33`, cada `source` una vez). |
| Escena | Árbol perezoso (los hijos se crean al abrir el nodo) con descendientes y k tris. Clic = seleccionar. |
| Top coste | Los 20 meshes visibles con más tris × instancias. |
| Selección | **Alt+clic** en el canvas. Ficha con nombre, ruta, **origen `archivo.js:línea`**, posiciones, geometría, materiales, flags de render, coste del subárbol y `userData`. Botones ↑ padre, ocultar/mostrar y copiar. |
| Toggles | Sombras, luces (todas o una), niebla, cada pase del composer (o "solo Render + Output") y pixelRatio. Todo vuelve al valor original. |
| Copiar | Cámara y objeto como código listo para pegar (portapapeles, o un `<textarea>` si no se puede; siempre `console.log`). |

## Activarlo en un gemelo

1. Copia `inspector.js` junto al `index.html` del gemelo. La página debe tener un import map con `three` y `three/addons/`, el mismo que usa la app.
2. En el script módulo principal, **antes de crear el renderer**:

   ```js
   if (new URLSearchParams(location.search).get('debug') === '1') await import('./inspector.js');
   ```

   Si la página ya tiene `const QS = new URLSearchParams(location.search)`: `if (QS.get('debug') === '1') await import('./inspector.js');`
3. Abre `mi-gemelo/?debug=1`.

Notas:
- Las `import` estáticas se evalúan antes que el cuerpo del módulo, así que la línea puede ir después de ellas; lo que importa es que vaya antes de `new THREE.WebGLRenderer()` y de `new THREE.Scene()`.
- Alternativa: `import './inspector.js'` como primer import. Sin `?debug=1` no hace nada, pero el archivo se descarga siempre.
- No uses `import()` suelto en un `<script>` clásico: compite con la creación del renderer.

### Sin tocar archivos (respaldo `attach`)

Si la app expone sus objetos (o los tienes en la consola):

```bash
node prueba.mjs --servir          # sirve este repo en http://localhost:8123 con CORS
```

```js
// en la consola del gemelo, abierto con ?debug=1
(await import('http://localhost:8123/inspector.js')).attach({ renderer, scene, camera, composer, controls });
```

`attach` ignora las claves que no conoce, así que `attach(window.miApp)` funciona si el objeto trae esas propiedades.
Por esta vía no se conoce el origen de los objetos que ya existían (el parche de `add` llega tarde); se cae a `userData.modulo` o al grupo de primer nivel.
Pasar `controls` hace que "Copiar cámara" genere `controls.target.set(...)`; el enganche automático no los detecta y usa `camera.lookAt(...)`.

## API

```js
window.__inspector3d = {
  attach, stats, renderer, scene, camera, composer, controls, seleccion,
  select(obj, instanceId?), set(nombre, valor), copiarCamara(), copiarObjeto(), memoria(), origen(obj)
}
```

- `stats`: objeto plano `{fps, ms, msMax, calls, tris, lineas, puntos, geometrias, texturas, programas, heapMB}`. Lo puede leer otra herramienta (por ejemplo `--extra "window.__inspector3d?.stats"`).
- `seleccion`: `{ objeto, instanceId } | null`.
- `set(nombre, valor)`: `'sombras'`, `'luces'`, `'luz:<i>'`, `'niebla'`, `'post'`, `'pase:<i>'` con booleano; `'pixelRatio'` con número, `'dpr'` u `'original'`.

## Cómo funciona

- three r160 termina los constructores de `WebGLRenderer` y `Scene` con `__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent('observe', {detail: this}))`. El inspector crea ese `EventTarget` y envuelve `render` en la instancia del renderer (es propiedad de instancia, no del prototipo).
- Escena principal: de las que pasan por `render`, la que tiene más hijos (descarta escenas de entorno y pases de pantalla completa). Cámara: la última usada con ella.
- Composer: se envuelve `EffectComposer.prototype.render` importando el mismo módulo por el import map.
- Origen: se parchea `Object3D.prototype.add` y se guarda un `Error` por hijo la primera vez que se agrega; se muestra el primer frame que no es de three ni del inspector. El tooltip del campo "origen" trae la pila completa. Solo en modo debug (sube `Error.stackTraceLimit` a 40).
- Conteo: diferencia de `info.render` antes y después de cada `render`, acumulada y publicada por un rAF propio, que corre antes que el bucle de la app.

## Costes y límites

- El resaltado es un `Box3Helper` dentro de la escena: **suma 1 draw call y 12 líneas** mientras hay selección. En una selección grande (un grupo con miles de hijos) el `setFromObject` de cada cuadro cuesta CPU.
- Apagar sombras o luces cambia los shaders: espera un tirón al recompilar.
- Se mide la cadencia de rAF, no el tiempo de GPU. Para eso combina con [stats-gl](https://github.com/RenaudRohlinger/stats-gl); para capturar un cuadro, [Spector.js](https://spector.babylonjs.com/).
- Solo `WebGLRenderer` de r160 (el hook de devtools existe en r1xx; el Inspector oficial de r187 es solo para `WebGPURenderer`).
- Fuera de v0.1: buscador, wireframe, edición de transformaciones y persistencia del panel.

## Prueba

```bash
node prueba.mjs                     # o npm test
CHROME=/ruta/a/chrome node prueba.mjs --three http://127.0.0.1:PUERTO/vendor/three/   # sin internet: three local
```

Levanta un `node:http` en un puerto libre de 127.0.0.1, abre Chrome headless (`CHROME`, `--chrome` o rutas estándar) con un `--user-data-dir` temporal y carga `prueba/index.html`, una escena r160 mínima (jsdelivr) que **no expone nada en `window`**. Tras 30 cuadros la página hace sus comprobaciones y las manda a `/resultado`:

- con `?debug=1`: enganche sin `attach`, `stats.calls === 7` y `stats.tris === 298` exactos (sombra 1 + escena 4 + Copy 1 + Output 1), Alt+clic al centro selecciona `central` con origen `index.html:<línea>`, el resaltado suma 1 call y 12 líneas, cada toggle cambia y se restaura, y `copiarCamara()` reproduce la pose;
- sin `?debug`: `__inspector3d` y `__THREE_DEVTOOLS__` son `undefined`, no hay nodos DOM nuevos e `inspector.js` no se pidió.

En Linux usa `--use-gl=angle --use-angle=gl-egl`. La GPU que reportó WebGL (`UNMASKED_RENDERER_WEBGL`) se imprime; si es SwiftShader o llvmpipe se avisa.

## Desviaciones respecto al plan

- **Sombras en el conteo.** En r160, con `info.autoReset = true` el reinicio ocurre *después* de dibujar el mapa de sombras, así que esas draw calls se perdían. El wrapper pone `autoReset = false` solo durante su llamada a `render` (con un `reset()` manual) y lo restaura al salir. Así el conteo incluye sombras igual que en una app con `autoReset = false`. Efecto lateral: en apps con `autoReset = true`, `renderer.info` incluye las sombras mientras el inspector está activo.
- **Sin flags en los pases.** r160 no tiene `isRenderPass` ni `isOutputPass`; "solo Render + Output" se decide por `constructor.name`.
- **fps.** Se cuentan todos los cuadros con la pestaña visible (no se descartan los de más de 1 s, que en una carga pesada son la norma).
- **Integración de prueba en una copia.** Otro proceso servía el repo del banco de pruebas mientras se probaba, así que el hook se probó en una copia temporal fuera de git en vez de editar y revertir el original.
- **GTAO.** En el banco de pruebas el pase GTAO solo existe con `calidad=ultra`; con `calidad=alta` los pases son RenderPass, UnrealBloomPass, OutputPass, ShaderPass y SMAAPass.
- **Sin VPS.** La prueba corrió con GPU real (ANGLE D3D11) en la laptop; no hizo falta el servidor remoto.

## Licencia

MIT. Ver [LICENSE](LICENSE).
