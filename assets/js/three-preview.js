/* Optional offline Three.js runtime and transparent, reviewable starter source. */
(function (root) {
  'use strict';
  let pending;
  async function runtime() {
    if (!pending) pending = fetch('assets/js/vendor/three.r180.min.js', { cache: 'force-cache', credentials: 'omit' }).then(response => {
      if (!response.ok) throw new Error('Bundled Three.js could not load. Reload or check the local installation.');
      return response.text();
    }).catch(error => { pending = null; throw error; });
    return pending;
  }
  function settings() {
    const accent = document.body.style.getPropertyValue('--ctab-accent').trim();
    return { theme: document.body.dataset.theme === 'grey' ? 'grey' : 'black',
      accent: /^#[\da-f]{6}$/i.test(accent) && accent !== '#c4c7cf' ? accent : null,
      reducedMotion: document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches };
  }
  function starter() {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eltes 3D starter</title><style>
html,body { margin:0; height:100%; background:#000; color:#eee; font:16px system-ui; }
canvas { display:block; width:100%; height:100%; }
header { position:absolute; top:20px; left:20px; z-index:1; pointer-events:none; }
h1 { font-size:20px; } p { font-size:13px; max-width:32ch; }
button { pointer-events:auto; background:#191919; color:white; padding:8px 12px; border:1px solid #777; border-radius:6px; }
#fallback { padding:24px; }
</style></head><body><header><h1>Orbit study</h1><p>Offline Three.js. Respects reduced motion. No network assets.</p><button id="motion" type="button">Pause animation</button></header>
<div id="fallback" role="status"></div>
<script>
// Enable “Bundled Three.js” in the Eltes preview. To run a downloaded copy,
// supply your own local Three.js build before this script; no CDN is required.
const prefs = window.ELTES_PREVIEW || { theme: 'black', reducedMotion: true };
const palette = prefs.theme === 'grey'
  ? { background: 0x1a1a1a, mesh: '#bdc1c6', light: 0x8ab4f8 }
  : { background: 0x000000, mesh: '#c4c7cf', light: 0xffaa00 };
let renderer, geometry, material, frame = 0, disposed = false;
try {
  if (!window.THREE) throw new Error('Enable the bundled Three.js preview runtime.');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 4;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setClearColor(palette.background);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  document.body.append(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const key = new THREE.PointLight(palette.light, 30); key.position.set(2, 3, 4); scene.add(key);
  geometry = new THREE.TorusKnotGeometry(0.8, 0.22, 96, 16);
  material = new THREE.MeshStandardMaterial({ color: prefs.accent || palette.mesh, metalness: 0.65, roughness: 0.3, wireframe: true });
  const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
  let paused = !!prefs.reducedMotion, last = 0;
  const button = document.getElementById('motion');
  function label() { button.textContent = paused ? 'Play animation' : 'Pause animation'; button.setAttribute('aria-pressed', String(!paused)); }
  function draw(time) {
    frame = 0;
    if (disposed || document.hidden) return;
    const delta = Math.min((time - (last || time)) / 1000, 0.05); last = time;
    if (!paused) { mesh.rotation.y += delta * 0.4; mesh.rotation.x += delta * 0.2; }
    renderer.render(scene, camera);
    if (!paused) frame = requestAnimationFrame(draw);
  }
  function schedule() { if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(draw); }
  function resize() { const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); schedule(); }
  button.onclick = () => { paused = !paused; last = 0; label(); schedule(); };
  const visibility = () => { cancelAnimationFrame(frame); frame = 0; last = 0; schedule(); };
  addEventListener('resize', resize); document.addEventListener('visibilitychange', visibility);
  function cleanup() {
    if (disposed) return; disposed = true; cancelAnimationFrame(frame);
    removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility);
    geometry.dispose(); material.dispose(); renderer.dispose();
  }
  addEventListener('pagehide', cleanup, { once: true });
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); cleanup(); document.getElementById('fallback').textContent = 'Graphics context lost. Restart the preview to try again.'; });
  label(); resize();
} catch (error) {
  disposed = true; cancelAnimationFrame(frame);
  if (geometry) geometry.dispose(); if (material) material.dispose(); if (renderer) renderer.dispose();
  document.getElementById('fallback').textContent = '3D unavailable: ' + error.message;
  document.getElementById('motion').disabled = true;
}
<\/script></body></html>`;
  }
  const api = { runtime, settings, starter };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EltesThreePreview = api;
})(typeof window === 'object' ? window : globalThis);
