// Prueba de inspector-3d sin dependencias: node:http + Chrome headless + node:assert.
//   node prueba.mjs              corre la autoprueba con ?debug=1 y sin él
//   node prueba.mjs --servir     solo sirve este repo en http://localhost:8123 con CORS (para attach() desde otra página)
// Chrome: variable CHROME o --chrome <ruta>; si no, las rutas estándar de Windows y Linux. Extra: --three <base> (→ ?three=).
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const { values: A } = parseArgs({ options: { servir: { type: 'boolean' }, chrome: { type: 'string' }, three: { type: 'string' }, puerto: { type: 'string' } } });
const TIPOS = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };

let alRecibir = null; const pedidos = [];
const srv = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  pedidos.push(ruta);
  if (req.method === 'POST' && ruta === '/resultado') {
    let b = ''; for await (const c of req) b += c;
    res.end('ok'); alRecibir?.(JSON.parse(b)); return;
  }
  const f = normalize(join(RAIZ, ruta.endsWith('/') ? ruta + 'index.html' : ruta));
  if (!f.startsWith(RAIZ) || /[\\/]\./.test(ruta)) { res.writeHead(404).end(); return; }
  try { const d = await readFile(f); res.writeHead(200, { 'Content-Type': TIPOS[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(d); }
  catch { res.writeHead(404).end(); }
});

if (A.servir) {
  const p = +(A.puerto || 8123);
  srv.listen(p, '127.0.0.1', () => console.log(`sirviendo ${RAIZ} en http://localhost:${p}/inspector.js (CORS abierto). Ctrl+C para salir.`));
} else await probar();

function buscarChrome() {
  const c = [A.chrome, process.env.CHROME,
    ...(process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap((b) =>
          [join(b, 'Google/Chrome/Application/chrome.exe'), join(b, 'Microsoft/Edge/Application/msedge.exe')])
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'])];
  return c.find((p) => p && existsSync(p));
}

function matar(pid) {
  try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL'); } catch { /* ya salió */ }
}

async function cargar(chrome, puerto, qs, pagina = 'prueba/index.html') {
  const perfil = await mkdtemp(join(tmpdir(), 'inspector3d-'));
  const gpu = process.platform === 'linux' ? ['--use-gl=angle', '--use-angle=gl-egl'] : [];
  const flags = ['--headless=new', `--user-data-dir=${perfil}`, '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...gpu,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', `http://127.0.0.1:${puerto}/${pagina}${qs}`];
  const proc = spawn(chrome, flags, { stdio: 'ignore' });
  try {
    return await new Promise((ok, mal) => {
      const t = setTimeout(() => mal(new Error(`sin POST /resultado en 60 s (${qs || 'sin debug'})`)), 60_000);
      alRecibir = (r) => { clearTimeout(t); ok(r); };
      proc.on('error', (e) => { clearTimeout(t); mal(e); });
    });
  } finally {
    alRecibir = null; matar(proc.pid);
    await rm(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
  }
}

async function probar() {
  const chrome = buscarChrome();
  if (!chrome) { console.error('No encontré Chrome. Pasa --chrome <ruta> o la variable CHROME.'); process.exit(1); }
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const puerto = srv.address().port, three = A.three ? `three=${encodeURIComponent(A.three)}` : '';
  const lineas = readFileSync(join(RAIZ, 'prueba/index.html'), 'utf8').split('\n'), linea = (m) => lineas.findIndex((l) => l.includes(m)) + 1;
  try {
    // 1) con ?debug=1, abierta como directorio (/prueba/ y no /prueba/index.html): el origen debe llevar el path
    const d = await cargar(chrome, puerto, `?debug=1${three && '&' + three}`, 'prueba/');
    console.log('GPU:', d.gpu);
    assert.deepEqual(d.fallos, [], 'la página reportó fallos');
    assert.deepEqual(d.enganche, { renderer: true, scene: true, camera: true, composer: true }, 'enganche sin attach()');
    assert.equal(d.stats.calls, d.esperado.calls, 'stats.calls'); assert.equal(d.stats.tris, d.esperado.tris, 'stats.tris');
    assert.equal(d.seleccion?.nombre, 'central', 'Alt+clic en el centro'); assert.ok(d.seleccion.trisFicha, 'la ficha muestra 80 tris');
    assert.ok(d.trampasDelante, 'hay trampas delante de central');
    assert.equal(d.seleccion.origen, `/prueba/:${linea('MARCA-CENTRAL')}`, 'origen con la página abierta como /');
    assert.deepEqual(d.statsConResaltado, { calls: d.esperado.calls + 1, lineas: 12 }, 'el resaltado suma 1 call y 12 líneas');
    assert.equal(d.statsSinSeleccion, d.esperado.calls, 'sin selección el resaltado sale de la escena');
    const lp = linea('MARCA-PONER'), ld = linea('MARCA-DER');
    assert.equal(d.origenDer.base, `/prueba/:${lp}`, 'origen sin saltar: el helper');
    assert.equal(d.origenDer.pila, `poner /prueba/:${lp} ← (anón) /prueba/:${ld}`, 'pila corta');
    assert.equal(d.origenDer.global, `/prueba/:${ld}`, 'window.__inspector3dSaltar');
    assert.equal(d.origenDer.attach, `/prueba/:${ld}`, 'attach({saltar})');
    for (const [k, v] of Object.entries(d.toggles)) assert.deepEqual(v, { cambia: true, restaura: true }, `toggle ${k}`);
    assert.ok(d.camara.dPos < 1e-3 && d.camara.dRot < 1e-6, `copiarCamara reproduce la pose (${JSON.stringify(d.camara)})`);
    assert.ok(d.copiarObjeto && d.memoria.geometrias >= 4, 'copiarObjeto y memoria');
    assert.ok(pedidos.includes('/inspector.js'));
    console.log('debug=1 ok:', JSON.stringify({ stats: d.stats, origen: d.seleccion.origen, pila: d.origenDer.pila, memoria: d.memoria }));
    // 2) sin ?debug: nada
    pedidos.length = 0;
    const o = await cargar(chrome, puerto, three && '?' + three);
    assert.deepEqual(o.fallos, []);
    assert.equal(o.inspector, 'undefined', 'window.__inspector3d'); assert.equal(o.devtools, 'undefined', '__THREE_DEVTOOLS__');
    assert.equal(o.nodosNuevos, 0, 'nodos DOM nuevos'); assert.ok(!pedidos.includes('/inspector.js'), 'inspector.js no se descarga');
    console.log('apagado ok');
    if (/swiftshader|llvmpipe/i.test(d.gpu)) console.log('aviso: GPU por software (SwiftShader/llvmpipe)');
    console.log('PRUEBA OK');
  } finally { srv.close(); }
}
