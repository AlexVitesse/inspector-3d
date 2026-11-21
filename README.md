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
| Selección | **Alt+clic** en el canvas: elige el primer objeto que se ve (ver abajo). Ficha con nombre, ruta, **origen `archivo.js:línea`**, **pila corta** (3 frames), posiciones, geometría, materiales, flags de render, coste del subárbol y `userData`. Botones ↑ padre, ocultar/mostrar y copiar. |
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

### Qué puede elegir el Alt+clic

El rayo atraviesa lo que no se ve. Se descarta un objeto si:

- él o algún ancestro tiene `visible = false`;
- es un helper: de three (`GridHelper`, `AxesHelper`, `CameraHelper`… cualquier `type` que termine en `Helper`), el resaltado del inspector, o tiene `userData.inspectorIgnorar = true` (él o un ancestro);
- su material (o el de la cara tocada, si hay varios) tiene `visible = false` o es `transparent` con `opacity` 0;
- no está en las capas de la cámara (`camera.layers`).

### Origen y helpers de la app

Si la app crea casi todo con un helper propio (`add(padre, geo, mat)`, `box(...)`, `mergeStatic(...)`), el primer frame fuera de three es siempre ese helper. Para que el origen marque al llamador, dile qué funciones saltar:

```js
window.__inspector3dSaltar = ['add', 'box', 'mergeStatic'];   // en la página, en cualquier momento
// o bien
window.__inspector3d.attach({ saltar: ['add', 'box', 'mergeStatic'] });
```

Se compara con el nombre de la función de cada frame (para `Clase.metodo`, con `metodo`). Si todos los frames son saltables, se usa el primero.
La fila "pila" de la ficha muestra 3 frames desde el origen (`fn archivo:línea ← …`) y el tooltip de "origen", la pila completa.
Si la página se abrió como directorio (`/` o `/app/` en vez de `/index.html`), el archivo se muestra como ese path: `/:2775`.

## API

```js
window.__inspector3d = {
  attach, stats, renderer, scene, camera, composer, controls, seleccion,
  select(obj, instanceId?), set(nombre, valor), copiarCamara(), copiarObjeto(), memoria(), origen(obj), pila(obj)
}
```

- `stats`: objeto plano `{fps, ms, msMax, calls, tris, lineas, puntos, geometrias, texturas, programas, heapMB}`. Lo puede leer otra herramienta (por ejemplo `--extra "window.__inspector3d?.stats"`).
- `seleccion`: `{ objeto, instanceId } | null`.
- `origen(obj)`: `archivo:línea`; `pila(obj)`: la pila corta. `attach({ saltar: [...] })` fija los helpers a saltar.
- `set(nombre, valor)`: `'sombras'`, `'luces'`, `'luz:<i>'`, `'niebla'`, `'post'`, `'pase:<i>'` con booleano; `'pixelRatio'` con número, `'dpr'` u `'original'`.

## Cómo funciona

- three r160 termina los constructores de `WebGLRenderer` y `Scene` con `__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent('observe', {detail: this}))`. El inspector crea ese `EventTarget` y envuelve `render` en la instancia del renderer (es propiedad de instancia, no del prototipo).
- Escena principal: de las que pasan por `render`, la que tiene más hijos (descarta escenas de entorno y pases de pantalla completa). Cámara: la última usada con ella.
- Composer: se envuelve `EffectComposer.prototype.render` importando el mismo módulo por el import map.
- Origen: se parchea `Object3D.prototype.add` y se guarda un `Error` por hijo la primera vez que se agrega (24 frames: el límite se sube solo durante esa captura, no se toca `Error.stackTraceLimit` de la app). La pila se procesa solo al mostrarla: se descartan los frames de three y del inspector y los helpers de `saltar`. Solo en modo debug.
- Conteo: diferencia de `info.render` antes y después de cada `render`, acumulada y publicada por un rAF propio, que corre antes que el bucle de la app.

## Costes y límites

- El resaltado es un `Box3Helper` que está en la escena **solo mientras hay selección**: suma 1 draw call y 12 líneas. Su caja se recalcula al seleccionar y 4 veces por segundo (no por cuadro); un objeto que se mueve rápido se ve con la caja un poco atrasada.
- **Coste propio** (medido con medidor-3d, `--sin-vsync`, GPU RTX headless, dos corridas intercaladas por variante). En un gemelo de ~360 draw calls y 1.75 M tris, vista general: sin inspector 147 y 196 fps p50; con 0.1.0, 149 y 147; con 0.1.1, 145 y 161. En `prueba/index.html` (~13 000 fps) tampoco hay diferencia. En ningún caso aparece una función del inspector entre las 25 con más CPU propia. La variación entre corridas, con la GPU compartida, es mayor que el coste del inspector. Aun así, compara escenarios entre sí con `?debug=1` en ambos.
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

- con `?debug=1`, abriendo la página como `/prueba/` (sin `index.html`): enganche sin `attach`, `stats.calls === 7` y `stats.tris === 298` exactos (sombra 1 + escena 4 + Copy 1 + Output 1), Alt+clic al centro atraviesa siete trampas (material invisible, opacidad 0, `inspectorIgnorar` propio y de un ancestro, otra capa, oculto y un `GridHelper`) y selecciona `central` con origen `/prueba/:<línea>`, el resaltado suma 1 call y 12 líneas y sale de la escena al deseleccionar, el origen de un objeto creado con un helper `poner()` marca el helper y, con `window.__inspector3dSaltar` o `attach({saltar})`, al llamador, cada toggle cambia y se restaura, y `copiarCamara()` reproduce la pose;
- sin `?debug`: `__inspector3d` y `__THREE_DEVTOOLS__` son `undefined`, no hay nodos DOM nuevos e `inspector.js` no se pidió.

En Linux usa `--use-gl=angle --use-angle=gl-egl`. La GPU que reportó WebGL (`UNMASKED_RENDERER_WEBGL`) se imprime; si es SwiftShader o llvmpipe se avisa.

## Desviaciones respecto al plan

- **Sombras en el conteo.** En r160, con `info.autoReset = true` el reinicio ocurre *después* de dibujar el mapa de sombras, así que esas draw calls se perdían. El wrapper pone `autoReset = false` solo durante su llamada a `render` (con un `reset()` manual) y lo restaura al salir. Así el conteo incluye sombras igual que en una app con `autoReset = false`. Efecto lateral: en apps con `autoReset = true`, `renderer.info` incluye las sombras mientras el inspector está activo.
- **Sin flags en los pases.** r160 no tiene `isRenderPass` ni `isOutputPass`; "solo Render + Output" se decide por `constructor.name`.
- **fps.** Se cuentan todos los cuadros con la pestaña visible (no se descartan los de más de 1 s, que en una carga pesada son la norma).
- **Integración de prueba en una copia.** Otro proceso servía el repo del banco de pruebas mientras se probaba, así que el hook se probó en una copia temporal fuera de git en vez de editar y revertir el original.
- **GTAO.** En el banco de pruebas el pase GTAO solo existe con `calidad=ultra`; con `calidad=alta` los pases son RenderPass, UnrealBloomPass, OutputPass, ShaderPass y SMAAPass.
- **Sin VPS.** La prueba corrió con GPU real (ANGLE D3D11) en la laptop; no hizo falta el servidor remoto.
- **0.1.1 en servidor Linux headless.** Ahí `prueba.mjs` no recibe `/resultado` en 60 s (igual con 0.1.0); queda pendiente. La medición de coste en GPU real de 0.1.1 se hizo con medidor-3d.

## Licencia

MIT. Ver [LICENSE](LICENSE).
