# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## [0.1.0] - 2026-11-20

### Agregado
- `inspector.js`: un solo archivo sin dependencias, activo solo con `?debug=1`.
- Enganche automático de renderer, escena, cámara y `EffectComposer` vía `__THREE_DEVTOOLS__` (three r160); `attach()` como respaldo.
- Stats por cuadro (fps, ms, calls, tris, líneas, puntos, geometrías, texturas, programas, heap) y "Memoria estimada".
- Árbol perezoso, Top coste (20 meshes), selección con Alt+clic, resaltado con `Box3Helper`, ficha con origen `archivo.js:línea`.
- Toggles revertibles: sombras, luces, niebla, pases de postproceso y pixelRatio.
- Copiar cámara y objeto como código.
- `prueba.mjs`: autoprueba con Chrome headless, con y sin `?debug=1`.
