// inspector-3d v0.1.0 — panel de depuración para gemelos three.js r160 (MIT).
// Se activa con ?debug=1. Sin ese parámetro no hace nada (ni DOM, ni globales, ni parches).
// Encuentra renderer, escena, cámara y composer solo, por el hook __THREE_DEVTOOLS__ de three; attach() es el respaldo.
import * as THREE from 'three';

const ON = new URLSearchParams(location.search).get('debug') === '1';
const MARCA = '__inspector3d';                  // userData del resaltado: fuera del árbol, del raycast y del coste
const origenes = new WeakMap();                  // hijo → Error de la primera vez que se agregó
const S = { renderer: null, scene: null, camera: null, composer: null, controls: null };
const stats = { fps: 0, ms: 0, msMax: 0, calls: 0, tris: 0, lineas: 0, puntos: 0, geometrias: 0, texturas: 0, programas: 0, heapMB: null };
const acum = { calls: 0, tris: 0, lineas: 0, puntos: 0 };
const orig = {};                                 // valores originales de los toggles: todo se puede revertir
let sel = null, helper = null, ui = null, iniciado = false;

// ---------------- enganche
function envolverRenderer(r) {
  if (!r || r.render.__insp) return;
  const render = r.render;
  r.render = function (scene, camera) {
    if (scene?.isScene && !esHelper(scene)) {
      if (!S.scene || (scene !== S.scene && scene.children.length > S.scene.children.length)) S.scene = scene;
      if (scene === S.scene) { S.camera = camera; S.renderer ??= this; prepararHelper(); }
    }
    // r160 reinicia info DESPUÉS de dibujar el mapa de sombras si autoReset es true: se apaga solo durante esta llamada
    // para que las sombras cuenten igual que en una app con autoReset = false. El valor de la app se restaura al salir.
    const info = this.info, auto = info.autoReset;
    if (auto) { info.autoReset = false; info.reset(); }
    const r0 = info.render, a = [r0.calls, r0.triangles, r0.lines, r0.points];
    try { return render.call(this, scene, camera); }
    finally {
      const r1 = info.render;
      acum.calls += r1.calls - a[0]; acum.tris += r1.triangles - a[1]; acum.lineas += r1.lines - a[2]; acum.puntos += r1.points - a[3];
      info.autoReset = auto;
    }
  };
  r.render.__insp = true;
  S.renderer ??= r;
}
function envolverComposer(proto) {
  if (!proto || proto.render.__insp) return;
  const render = proto.render;
  proto.render = function (...a) { if (!S.composer && (!S.renderer || this.renderer === S.renderer)) S.composer = this; return render.apply(this, a); };
  proto.render.__insp = true;
}
function parcharAdd() {
  const add = THREE.Object3D.prototype.add;
  if (add.__insp) return;
  THREE.Object3D.prototype.add = function (...objs) {
    for (const o of objs) if (o && o !== this && !origenes.has(o)) origenes.set(o, new Error());
    return add.apply(this, objs);
  };
  THREE.Object3D.prototype.add.__insp = true;
}

export function attach(o = {}) {
  for (const k of Object.keys(S)) if (o[k]) S[k] = o[k];   // claves desconocidas se ignoran: attach(window.miApp) funciona
  if (S.renderer) envolverRenderer(S.renderer);
  if (S.composer) S.renderer ??= S.composer.renderer;
  iniciar();
  return api;
}


// ---------------- stats por cuadro (rAF propio: publica el acumulado y lo pone en cero)
function iniciar() {
  if (iniciado) return; iniciado = true;
  window.__inspector3d = api;
  construirUI();
  let ult = performance.now(), n = 0, suma = 0, max = 0, tPub = ult;
  const cuadro = (t) => {
    const d = t - ult; ult = t;
    if (d > 0 && !document.hidden) { n++; suma += d; max = Math.max(max, d); }
    stats.calls = acum.calls; stats.tris = acum.tris; stats.lineas = acum.lineas; stats.puntos = acum.puntos;
    acum.calls = acum.tris = acum.lineas = acum.puntos = 0;
    if (t - tPub >= 250) {
      const info = S.renderer?.info;
      Object.assign(stats, { fps: n ? +(1000 * n / suma).toFixed(1) : 0, ms: n ? +(suma / n).toFixed(2) : 0, msMax: +max.toFixed(2),
        geometrias: info?.memory.geometries ?? 0, texturas: info?.memory.textures ?? 0, programas: info?.programs?.length ?? 0,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(1) : null });
      n = suma = max = 0; tPub = t; pintarStats();
    }
    requestAnimationFrame(cuadro);
  };
  requestAnimationFrame(cuadro);
  addEventListener('pointerdown', altClic, true);
}

// ---------------- utilidades de escena
const esHelper = (o) => !!o?.userData?.[MARCA];
const trisDe = (m) => {
  if (!m.isMesh || !m.geometry) return 0;
  const g = m.geometry, n = g.index ? g.index.count : g.attributes.position?.count || 0;
  return Math.round(n / 3) * (m.isInstancedMesh ? m.count : 1);
};
const instDe = (m) => (m.isInstancedMesh ? m.count : 1);
function hijos(o) { return o.children.filter((c) => !esHelper(c)); }
function resumen(o, soloVisibles) {
  let n = 0, tris = 0, calls = 0;
  const ir = (x) => {
    if (soloVisibles && !x.visible) return;
    tris += trisDe(x);
    if (x.isMesh || x.isLine || x.isPoints || x.isSprite) calls += Array.isArray(x.material) ? Math.max(1, x.geometry?.groups.length || 0) : 1;
    for (const c of hijos(x)) { n++; ir(c); }
  };
  ir(o);
  return { n, tris, calls };
}
function origen(o) {
  const e = origenes.get(o);
  if (e?.stack) {
    for (const l of e.stack.split('\n').slice(1)) {
      const m = l.match(/\(?((?:https?|file):\/\/[^\s)]+?):(\d+):\d+\)?\s*$/);
      if (!m || /three\.module|\/three\/|\/three@|inspector\.js/.test(m[1])) continue;
      let f = m[1]; try { f = new URL(f).pathname; } catch { /* ruta cruda */ }
      return { texto: `${f.split('/').pop()}:${m[2]}`, pila: e.stack };
    }
  }
  if (o.userData?.modulo) return { texto: String(o.userData.modulo), pila: '' };
  let a = o; while (a.parent && a.parent !== S.scene) a = a.parent;
  return { texto: a !== o && a.parent === S.scene ? `(en ${a.name || a.type})` : '—', pila: '' };
}
function ruta(o) { const r = []; for (let a = o; a; a = a.parent) r.unshift(a.name || a.type); return r.join(' › '); }
function jsonSeguro(v, max = 2048) {
  const vistos = new WeakSet();
  let s;
  try {
    s = JSON.stringify(v, (k, x) => {
      if (typeof x === 'function') return undefined;
      if (x && typeof x === 'object') {
        if (x.isObject3D || x.isMaterial || x.isBufferGeometry || x.isTexture) return `[${x.type || 'objeto'} ${x.name || x.uuid || ''}]`;
        if (ArrayBuffer.isView(x)) return `[${x.constructor.name} ${x.length}]`;
        if (vistos.has(x)) return '[ciclo]'; vistos.add(x);
      }
      return x;
    }, 1);
  } catch (e) { s = `"[no serializable: ${e.message}]"`; }
  return s && s.length > max ? s.slice(0, max) + '…' : (s ?? '');
}

// ---------------- selección y resaltado
function prepararHelper() {
  if (!sel || !S.scene) { if (helper) helper.visible = false; return; }
  if (!helper) {
    helper = new THREE.Box3Helper(new THREE.Box3(), 0xff00ff);
    helper.material.depthTest = false; helper.material.transparent = true; helper.renderOrder = 1e9;
    helper.userData[MARCA] = true; helper.raycast = () => {};
  }
  if (helper.parent !== S.scene) S.scene.add(helper);
  const o = sel.objeto, b = helper.box;
  if (o.isInstancedMesh && sel.instanceId != null) {
    const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
    o.updateWorldMatrix(true, false);
    o.getMatrixAt(sel.instanceId, _m); b.copy(g.boundingBox).applyMatrix4(_m.premultiply(o.matrixWorld));
  } else b.setFromObject(o);   // ponytail: recorre el subárbol cada cuadro; con la escena entera seleccionada cuesta, cachear si molesta
  helper.visible = !b.isEmpty() && o !== S.scene;
}
const _m = new THREE.Matrix4();
function select(objeto, instanceId) {
  sel = objeto ? { objeto, instanceId: instanceId ?? null } : null;
  prepararHelper(); pintarFicha();
  return sel;
}
const ray = new THREE.Raycaster(), _p = new THREE.Vector2();
function altClic(e) {
  if (!e.altKey || !S.renderer || !S.scene || !S.camera || ui?.contains(e.target)) return;
  const r = S.renderer.domElement.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  e.preventDefault(); e.stopImmediatePropagation();        // que OrbitControls no gire con el Alt+clic
  _p.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(_p, S.camera);
  ray.layers.mask = S.camera.layers.mask;
  const visible = (o) => { for (let a = o; a; a = a.parent) if (!a.visible || esHelper(a)) return false; return true; };
  let hit = null;
  try { hit = ray.intersectObject(S.scene, true).find((h) => visible(h.object)); } catch (err) { console.warn('[inspector] raycast', err); }
  select(hit?.object || null, hit?.instanceId);
}

// ---------------- toggles (cada uno guarda el original)
function luces() { const l = []; S.scene?.traverse((o) => { if (o.isLight) l.push(o); }); return l; }
function pases() { return S.composer?.passes || []; }
const esBase = (p) => /^(RenderPass|OutputPass)$/.test(p.constructor.name);
function set(nombre, valor) {
  const sc = S.scene, r = S.renderer;
  if (nombre === 'sombras') {
    for (const l of luces()) { if (!orig.sombras?.has(l)) (orig.sombras ??= new Map()).set(l, l.castShadow); l.castShadow = valor ? orig.sombras.get(l) : false; }
    if (valor && r) r.shadowMap.needsUpdate = true;      // apps con shadowMap.autoUpdate = false
  } else if (nombre === 'luces') luces().forEach((_, i) => set(`luz:${i}`, valor));
  else if (nombre.startsWith('luz:')) {
    const l = luces()[+nombre.slice(4)]; if (!l) return;
    (orig.luces ??= new Map()); if (!orig.luces.has(l)) orig.luces.set(l, l.visible);
    l.visible = valor ? orig.luces.get(l) : false; if (r) r.shadowMap.needsUpdate = true;
  } else if (nombre === 'niebla') {
    if (!sc) return; if (!('niebla' in orig)) orig.niebla = sc.fog;
    sc.fog = valor ? orig.niebla : null;
  } else if (nombre === 'post') {
    for (const p of pases()) { (orig.pases ??= new Map()); if (!orig.pases.has(p)) orig.pases.set(p, p.enabled); if (!esBase(p)) p.enabled = valor ? orig.pases.get(p) : false; }
  } else if (nombre.startsWith('pase:')) {
    const p = pases()[+nombre.slice(5)]; if (!p) return;
    (orig.pases ??= new Map()); if (!orig.pases.has(p)) orig.pases.set(p, p.enabled);
    p.enabled = !!valor;
  } else if (nombre === 'pixelRatio') {
    if (!r) return; if (!('pr' in orig)) orig.pr = r.getPixelRatio();
    const v = valor === 'original' || valor == null ? orig.pr : valor === 'dpr' ? devicePixelRatio : +valor;
    r.setPixelRatio(v); S.composer?.setPixelRatio(v);
  } else throw new Error(`[inspector] toggle desconocido: ${nombre}`);
  pintarToggles();
}

// ---------------- copiar
const f = (n) => +n.toFixed(4);
const v3 = (v) => `${f(v.x)}, ${f(v.y)}, ${f(v.z)}`;
function copiar(txt) {
  console.log(txt);
  const area = () => { const t = Object.assign(document.createElement('textarea'), { value: txt }); t.className = 'i3-copia'; ui?.querySelector('.i3-sal')?.replaceChildren(t); t.select(); };
  try { navigator.clipboard.writeText(txt).catch(area); } catch { area(); }
  return txt;
}
function copiarCamara() {
  const c = S.camera; if (!c) return '';
  let t = `camera.position.set(${v3(c.position)});\n`;
  if (S.controls?.target) t += `controls.target.set(${v3(S.controls.target)});\ncontrols.update();`;
  else { const p = c.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(c.getWorldPosition(new THREE.Vector3())); t += `camera.lookAt(${v3(p)});`; }
  return copiar(t);
}
function copiarObjeto() {
  const o = sel?.objeto; if (!o) return '';
  const w = o.getWorldPosition(new THREE.Vector3());
  return copiar(`// ${o.name || o.type} · ${origen(o).texto} · mundo (${v3(w)})\n` +
    `obj.position.set(${v3(o.position)});\nobj.rotation.set(${v3(o.rotation)});\nobj.scale.set(${v3(o.scale)});`);
}

// ---------------- memoria estimada (solo al pulsar)
function memoria() {
  const geos = new Set(), srcs = new Set(); let bAttr = 0, bTex = 0;
  const tex = (t) => {
    if (!t?.isTexture || srcs.has(t.source.uuid)) return; srcs.add(t.source.uuid);
    const d = t.source.data, w = d?.width || d?.videoWidth || 0, h = d?.height || d?.videoHeight || 0;
    bTex += w * h * 4 * 1.33 * (t.isCubeTexture ? 6 : 1);
  };
  const attr = (a) => { if (a) bAttr += (a.isInterleavedBufferAttribute ? a.data.array : a.array).byteLength; };
  S.scene?.traverse((o) => {
    if (esHelper(o)) return;
    const g = o.geometry;
    if (g && !geos.has(g.uuid)) { geos.add(g.uuid); attr(g.index); Object.values(g.attributes).forEach(attr); }
    if (o.isInstancedMesh) { attr(o.instanceMatrix); attr(o.instanceColor); }
    for (const m of [o.material].flat()) if (m) for (const v of Object.values(m)) tex(v);
  });
  tex(S.scene?.background); tex(S.scene?.environment);
  return { atributosMB: +(bAttr / 2 ** 20).toFixed(1), texturasMB: +(bTex / 2 ** 20).toFixed(1), geometrias: geos.size, imagenes: srcs.size };
}

// ---------------- UI
const CSS = `
.i3{position:fixed;top:8px;left:8px;z-index:2147483000;width:330px;max-height:calc(100vh - 16px);overflow:auto;background:rgba(10,14,20,.92);color:#e6edf3;
 font:11px/1.4 ui-monospace,Consolas,monospace;border:1px solid #30363d;border-radius:6px;padding:4px 6px}
.i3 summary{cursor:pointer;user-select:none} .i3>details>summary{font-weight:700;color:#7ee787;padding:2px 0}
.i3 button{font:inherit;background:#21262d;color:inherit;border:1px solid #30363d;border-radius:4px;padding:1px 6px;margin:1px;cursor:pointer}
.i3 .i3-n{padding-left:10px} .i3 .i3-n summary:hover{background:#1f2937} .i3 .i3-k{color:#8b949e}
.i3 table{border-collapse:collapse;width:100%} .i3 td{padding:0 3px;vertical-align:top} .i3 td:first-child{color:#8b949e;white-space:nowrap}
.i3 label{display:block} .i3 .i3-copia{width:100%;height:70px;font:inherit} .i3 pre{white-space:pre-wrap;margin:2px 0;color:#c9d1d9}
.i3 li{cursor:pointer} .i3 ol{margin:2px 0;padding-left:22px}`;
const el = (tag, props = {}, ...hijos) => { const e = Object.assign(document.createElement(tag), props); e.append(...hijos); return e; };
function seccion(titulo, abierta, ...contenido) { const d = el('details', { open: abierta }, el('summary', { textContent: titulo }), ...contenido); return d; }
function construirUI() {
  document.head.append(el('style', { textContent: CSS }));
  ui = el('div', { className: 'i3' });
  ui.append(
    seccion('Stats', true, el('pre', { className: 'i3-stats' }), el('button', { textContent: 'Memoria estimada', onclick: () => { ui.querySelector('.i3-mem').textContent = jsonSeguro(memoria()); } }), el('pre', { className: 'i3-mem' })),
    seccion('Escena', false, el('button', { textContent: 'Refrescar', onclick: pintarArbol }), el('div', { className: 'i3-arbol' })),
    seccion('Top coste', false, el('button', { textContent: 'Refrescar', onclick: pintarTop }), el('ol', { className: 'i3-top' })),
    seccion('Selección (Alt+clic)', true, el('div', { className: 'i3-ficha', textContent: 'nada' })),
    seccion('Toggles', false, el('div', { className: 'i3-tog' })),
    el('div', {}, el('button', { textContent: 'Copiar cámara', onclick: copiarCamara }), el('div', { className: 'i3-sal' })),
  );
  ui.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => {
    if (!d.open) return;
    const c = d.querySelector(':scope>.i3-arbol,:scope>.i3-top,:scope>.i3-tog');
    if (c && !c.childElementCount) ({ 'i3-arbol': pintarArbol, 'i3-top': pintarTop, 'i3-tog': pintarToggles })[c.className]();
  }));
  (document.body || document.documentElement).append(ui);
}
function pintarStats() {
  const p = ui?.querySelector('.i3-stats'); if (!p) return;
  const s = stats;
  p.textContent = `${s.fps} fps · ${s.ms} ms (máx ${s.msMax})\n${s.calls} calls · ${(s.tris / 1e3).toFixed(1)} k tris · ${s.lineas} lín · ${s.puntos} pts\n` +
    `geo ${s.geometrias} · tex ${s.texturas} · prog ${s.programas}${s.heapMB != null ? ` · heap ${s.heapMB} MB` : ''}` +
    (S.scene ? '' : '\n(sin escena: ¿se cargó antes que el renderer? usa attach())');
}
function nodo(o) {
  const r = resumen(o), d = el('details', { className: 'i3-n' });
  const s = el('summary', {}, `${o.name || o.type} `, el('span', { className: 'i3-k', textContent: `${r.n ? r.n + ' desc · ' : ''}${(r.tris / 1e3).toFixed(1)} k` }));
  s.addEventListener('click', () => select(o));
  d.append(s);
  if (hijos(o).length) d.addEventListener('toggle', () => { if (d.open && d.childElementCount === 1) d.append(...hijos(o).map(nodo)); });
  else s.style.listStyle = 'none';
  return d;
}
function pintarArbol() { const a = ui.querySelector('.i3-arbol'); a.replaceChildren(...(S.scene ? [nodo(S.scene)] : [])); }
function pintarTop() {
  const l = []; S.scene?.traverseVisible((o) => { if (o.isMesh && !esHelper(o)) l.push([trisDe(o), o]); });
  ui.querySelector('.i3-top').replaceChildren(...l.sort((a, b) => b[0] - a[0]).slice(0, 20).map(([t, o]) =>
    el('li', { textContent: `${(t / 1e3).toFixed(1)} k · ${o.name || o.type}${o.isInstancedMesh ? ` ×${o.count}` : ''} · ${origen(o).texto}`, onclick: () => select(o) })));
}
function pintarFicha() {
  const c = ui?.querySelector('.i3-ficha'); if (!c) return;
  if (!sel) { c.textContent = 'nada (Alt+clic en el canvas o clic en el árbol)'; return; }
  const o = sel.objeto, g = o.geometry, ori = origen(o), r = resumen(o, true);
  const w = o.getWorldPosition(new THREE.Vector3());
  const mats = [o.material].flat().filter(Boolean).map((m) => `${m.type}${m.name ? ' "' + m.name + '"' : ''} transp=${m.transparent} side=${m.side}`).join('\n');
  const filas = [
    ['nombre', `${o.name || '(sin nombre)'} · ${o.type}${sel.instanceId != null ? ` · instancia ${sel.instanceId}` : ''}`], ['ruta', ruta(o)], ['origen', ori.texto],
    ['visible', String(o.visible)], ['local', v3(o.position)], ['mundo', v3(w)],
    ...(g ? [['geometría', `${g.attributes.position?.count ?? 0} vért · ${(trisDe(o) / instDe(o))} tris · ${instDe(o)} inst`]] : []),
    ...(mats ? [['materiales', mats]] : []),
    ['render', `cast=${o.castShadow} recv=${o.receiveShadow} frustum=${o.frustumCulled} order=${o.renderOrder}`],
    ['subárbol', `${(r.tris / 1e3).toFixed(1)} k tris×inst · ~${r.calls} draw calls`],
    ['userData', jsonSeguro(o.userData)],
  ];
  const tabla = el('table', {}, ...filas.map(([k, v]) => el('tr', {}, el('td', { textContent: k }), el('td', { textContent: v }))));
  tabla.rows[2].cells[1].title = ori.pila;
  c.replaceChildren(tabla,
    el('button', { textContent: '↑ padre', disabled: !o.parent, onclick: () => select(o.parent) }),
    el('button', { textContent: o.visible ? 'ocultar' : 'mostrar', onclick: () => { o.visible = !o.visible; pintarFicha(); } }),
    el('button', { textContent: 'copiar', onclick: copiarObjeto }));
}
function pintarToggles() {
  const c = ui?.querySelector('.i3-tog'); if (!c) return;
  const chk = (txt, on, fn, title = '') => el('label', { title }, el('input', { type: 'checkbox', checked: on, onchange: (e) => fn(e.target.checked) }), ' ' + txt);
  const ls = luces(), ps = pases(), r = S.renderer;
  const pr = el('select', { onchange: (e) => set('pixelRatio', e.target.value) },
    ...['original', 0.5, 0.75, 1, 1.5, 2, 'dpr'].map((v) => el('option', { value: v, textContent: v === 'dpr' ? `dpr (${devicePixelRatio})` : v === 'original' ? `original (${orig.pr ?? r?.getPixelRatio()})` : v })));
  pr.value = 'pr' in orig && r ? ([0.5, 0.75, 1, 1.5, 2].includes(r.getPixelRatio()) ? String(r.getPixelRatio()) : r.getPixelRatio() === orig.pr ? 'original' : 'dpr') : 'original';
  c.replaceChildren(
    chk('sombras', ls.some((l) => l.castShadow), (v) => set('sombras', v), 'recompila y repinta el mapa: espera un tirón'),
    chk('niebla', !!S.scene?.fog, (v) => set('niebla', v)),
    chk(`luces (${ls.length})`, ls.some((l) => l.visible), (v) => set('luces', v), 'cambiar el número de luces recompila los shaders'),
    ...ls.map((l, i) => chk(`· ${l.name || l.type}`, l.visible, (v) => set(`luz:${i}`, v))),
    ...(ps.length ? [chk('postproceso (off = solo Render + Output)', ps.some((p) => !esBase(p) && p.enabled), (v) => set('post', v)),
      ...ps.map((p, i) => chk(`· ${p.constructor.name}`, p.enabled, (v) => set(`pase:${i}`, v)))] : [el('div', { className: 'i3-k', textContent: 'sin composer' })]),
    el('label', {}, 'pixelRatio ', pr));
}

const api = {
  attach, stats, select, set, copiarCamara, copiarObjeto, memoria, origen: (o) => origen(o).texto,
  get renderer() { return S.renderer; }, get scene() { return S.scene; }, get camera() { return S.camera; },
  get composer() { return S.composer; }, get controls() { return S.controls; }, get seleccion() { return sel; },
};

// al final: api y las constantes de arriba ya existen cuando arranca
if (ON) {
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit || 10, 40);
  const dt = (self.__THREE_DEVTOOLS__ ??= new EventTarget());
  dt.addEventListener('observe', (e) => {
    const d = e.detail;
    if (d?.isWebGLRenderer) envolverRenderer(d);
  });
  parcharAdd();
  try { envolverComposer((await import('three/addons/postprocessing/EffectComposer.js')).EffectComposer.prototype); }
  catch { /* sin addons en el import map: el composer llega por attach() */ }
  iniciar();
}
