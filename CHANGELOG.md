# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## [0.1.1] - 2026-11-20

### Corregido
- Origen con el archivo vacío (`:2775`) cuando la página se abre como `/` en vez de `/index.html`: ahora se muestra el path (`/:2775`).
- Alt+clic elegía objetos ocultos o auxiliares. Ahora descarta ancestros invisibles, helpers de three (`*Helper`) y del inspector, objetos con `userData.inspectorIgnorar`, materiales con `visible = false` o transparentes con opacidad 0 y objetos fuera de las capas de la cámara.

### Agregado
- Helpers a saltar en el origen: `attach({ saltar: ['add', 'mergeStatic'] })` o `window.__inspector3dSaltar`.
- Fila "pila" en la ficha (3 frames desde el origen) y `__inspector3d.pila(obj)`.

### Cambiado
- Menos coste con `?debug=1`: la caja del resaltado se recalcula al seleccionar y a 4 Hz (antes, en cada `render`); el `Box3Helper` sale de la escena sin selección; el wrapper de `render` no crea objetos por llamada; el parche de `add` captura 24 frames y ya no sube `Error.stackTraceLimit` de toda la app. Medido con medidor-3d en GPU real: el coste queda dentro del ruido entre corridas (ver README, "Coste propio").

## [0.1.0] - 2026-11-20

### Agregado
- `inspector.js`: un solo archivo sin dependencias, activo solo con `?debug=1`.
- Enganche automático de renderer, escena, cámara y `EffectComposer` vía `__THREE_DEVTOOLS__` (three r160); `attach()` como respaldo.
- Stats por cuadro (fps, ms, calls, tris, líneas, puntos, geometrías, texturas, programas, heap) y "Memoria estimada".
- Árbol perezoso, Top coste (20 meshes), selección con Alt+clic, resaltado con `Box3Helper`, ficha con origen `archivo.js:línea`.
- Toggles revertibles: sombras, luces, niebla, pases de postproceso y pixelRatio.
- Copiar cámara y objeto como código.
- `prueba.mjs`: autoprueba con Chrome headless, con y sin `?debug=1`.
