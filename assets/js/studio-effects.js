/* ==========================================================================
   Eltes Studio — effect recipes
   --------------------------------------------------------------------------
   Each recipe is a complete, dependency-free HTML page. Selecting one writes
   it into the workspace and opens it in the editor + preview, so the code you
   read is exactly the code that renders. No images, no CDN, no build step.
   ========================================================================== */

window.EltesEffects = (() => {
  const gradientMesh = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Animated gradient mesh</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #05070c;
    color: #f3f5f9;
  }

  /* Four soft radial gradients drifting under a blur = a mesh gradient. */
  .mesh {
    position: fixed;
    inset: -20%;
    filter: blur(48px) saturate(130%);
    opacity: 0.95;
  }
  .mesh span {
    position: absolute;
    width: 62vmax;
    height: 62vmax;
    border-radius: 50%;
    mix-blend-mode: screen;
    animation: drift 22s ease-in-out infinite alternate;
  }
  .mesh span:nth-child(1) { background: #2f6bff; top: -10%; left: -6%; }
  .mesh span:nth-child(2) { background: #8b5cf6; top: 8%; right: -12%; animation-duration: 27s; animation-delay: -6s; }
  .mesh span:nth-child(3) { background: #12b981; bottom: -16%; left: 16%; animation-duration: 31s; animation-delay: -12s; }
  .mesh span:nth-child(4) { background: #f97362; bottom: -8%; right: 4%; animation-duration: 25s; animation-delay: -3s; }

  @keyframes drift {
    from { transform: translate3d(-3%, -2%, 0) scale(1); }
    to   { transform: translate3d(5%, 4%, 0) scale(1.18); }
  }

  /* Grain: an SVG fractal-noise tile laid over the colour. */
  .grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.22;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  .card {
    position: relative;
    z-index: 2;
    width: min(620px, 88vw);
    padding: 42px;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(8, 12, 20, 0.42);
    backdrop-filter: blur(18px) saturate(120%);
    box-shadow: 0 40px 120px -40px rgba(0, 0, 0, 0.85);
  }
  .eyebrow {
    margin: 0 0 14px;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.62);
  }
  h1 {
    margin: 0 0 14px;
    font-size: clamp(34px, 6vw, 58px);
    line-height: 1.02;
    letter-spacing: -0.035em;
    font-weight: 600;
  }
  p { margin: 0; color: rgba(255, 255, 255, 0.66); line-height: 1.65; }
  .row { display: flex; gap: 10px; margin-top: 26px; flex-wrap: wrap; }
  .pill {
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
    font-size: 12.5px;
  }
  @media (prefers-reduced-motion: reduce) { .mesh span { animation: none; } }
</style>
</head>
<body>
  <div class="mesh" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
  <div class="grain" aria-hidden="true"></div>

  <main class="card">
    <p class="eyebrow">Code, not an image file</p>
    <h1>Four gradients and one noise tile.</h1>
    <p>Everything here is CSS: radial fields of colour, blurred together, drifting on a 22-second loop under a fractal-noise overlay. Resize the window and it re-flows — no bitmap to re-export.</p>
    <div class="row"><span class="pill">filter: blur()</span><span class="pill">mix-blend-mode</span><span class="pill">feTurbulence</span></div>
  </main>
</body>
</html>
`;

  const particles = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Canvas particle field</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: radial-gradient(1200px 700px at 50% -10%, #0e1a2c, #04060a 70%);
    color: #e9edf3;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    overflow: hidden;
  }
  canvas { display: block; width: 100%; height: 100%; }
  .hud {
    position: fixed;
    left: 26px;
    bottom: 24px;
    font-size: 11.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(233, 237, 243, 0.45);
  }
  .hud b { color: rgba(233, 237, 243, 0.8); font-weight: 600; }
</style>
</head>
<body>
  <canvas id="field" aria-label="Animated particle field"></canvas>
  <div class="hud">particles <b id="count">0</b> · links <b id="links">0</b></div>

<script>
  const canvas = document.getElementById('field');
  const ctx = canvas.getContext('2d');
  const countEl = document.getElementById('count');
  const linksEl = document.getElementById('links');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let points = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const target = Math.round((width * height) / 18000);
    points = Array.from({ length: Math.min(Math.max(target, 40), 190) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.34,
      vy: (Math.random() - 0.5) * 0.34,
      r: 1 + Math.random() * 1.8
    }));
    countEl.textContent = points.length;
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    let links = 0;

    for (const p of points) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 120) {
          links += 1;
          ctx.strokeStyle = 'rgba(130, 190, 255,' + (0.18 * (1 - dist / 120)).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const p of points) {
      ctx.beginPath();
      ctx.fillStyle = 'rgba(180, 214, 255, 0.9)';
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    linksEl.textContent = links;
    if (!reduced) requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  resize();
  frame();
</script>
</body>
</html>
`;

  const aurora = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Aurora ribbons</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #03060b;
    color: #f2f6ff;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  /* Ribbons: tall, rotated gradients blurred into light. */
  .ribbon {
    position: absolute;
    width: 48vmax;
    height: 130vmax;
    border-radius: 50%;
    filter: blur(60px);
    opacity: 0.55;
    mix-blend-mode: screen;
    transform-origin: 50% 50%;
    animation: sway 26s ease-in-out infinite alternate;
  }
  .r1 { left: -18vmax; top: -46vmax; background: linear-gradient(180deg, transparent, #2f6bff 35%, #12b981 75%, transparent); }
  .r2 { right: -20vmax; top: -40vmax; background: linear-gradient(180deg, transparent, #8b5cf6 30%, #22d3ee 78%, transparent); animation-delay: -8s; animation-duration: 31s; }
  .r3 { left: 22vmax; top: -56vmax; background: linear-gradient(180deg, transparent, #f472b6 40%, #fbbf24 82%, transparent); opacity: 0.34; animation-delay: -14s; animation-duration: 24s; }

  @keyframes sway {
    from { transform: rotate(-14deg) translate3d(-2vmax, 0, 0) scaleY(1); }
    to   { transform: rotate(9deg) translate3d(3vmax, 4vmax, 0) scaleY(1.08); }
  }

  .stars {
    position: absolute;
    inset: 0;
    opacity: 0.5;
    background-image:
      radial-gradient(1px 1px at 20% 30%, #fff, transparent),
      radial-gradient(1px 1px at 68% 18%, #cfe0ff, transparent),
      radial-gradient(1px 1px at 42% 72%, #fff, transparent),
      radial-gradient(1.5px 1.5px at 84% 58%, #fff, transparent),
      radial-gradient(1px 1px at 12% 82%, #bcd6ff, transparent),
      radial-gradient(1px 1px at 92% 86%, #fff, transparent);
  }

  h1 {
    position: relative;
    z-index: 2;
    margin: 0;
    padding: 0 24px;
    text-align: center;
    font-size: clamp(40px, 9vw, 118px);
    font-weight: 300;
    letter-spacing: -0.05em;
    line-height: 0.94;
    text-shadow: 0 10px 60px rgba(0, 0, 0, 0.7);
  }
  h1 span {
    display: block;
    font-size: 0.22em;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 22px;
  }
  @media (prefers-reduced-motion: reduce) { .ribbon { animation: none; } }
</style>
</head>
<body>
  <div class="ribbon r1" aria-hidden="true"></div>
  <div class="ribbon r2" aria-hidden="true"></div>
  <div class="ribbon r3" aria-hidden="true"></div>
  <div class="stars" aria-hidden="true"></div>
  <h1>Northern<br />signal<span>pure CSS · no images</span></h1>
</body>
</html>
`;

  const halftone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Animated halftone</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    background: #07090d;
    color: #f6f7fa;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    overflow: hidden;
  }

  /* A repeating radial gradient is a dot screen. Two layers, offset, then a
     mask that sweeps across — the dots grow and fade like a print halftone. */
  .halftone {
    position: absolute;
    inset: -10%;
    background-image:
      radial-gradient(circle at 50% 50%, #e8ecf4 1.6px, transparent 1.7px),
      radial-gradient(circle at 50% 50%, #8fa0b8 1.1px, transparent 1.2px);
    background-size: 14px 14px, 14px 14px;
    background-position: 0 0, 7px 7px;
    -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 12%, transparent 68%);
    mask-image: radial-gradient(circle at 50% 50%, #000 12%, transparent 68%);
    animation: breathe 9s ease-in-out infinite alternate;
    opacity: 0.9;
  }

  @keyframes breathe {
    from { transform: scale(0.92) rotate(-2deg); opacity: 0.5; }
    to   { transform: scale(1.14) rotate(3deg); opacity: 1; }
  }

  .glow {
    position: absolute;
    width: 52vmax;
    height: 52vmax;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(61, 125, 255, 0.5), rgba(139, 92, 246, 0.18) 42%, transparent 68%);
    filter: blur(20px);
  }

  .label {
    position: relative;
    z-index: 2;
    text-align: center;
    mix-blend-mode: difference;
  }
  .label b {
    display: block;
    font-size: clamp(38px, 8vw, 96px);
    font-weight: 700;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .label small {
    display: block;
    margin-top: 16px;
    font-size: 11px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.7);
  }
  @media (prefers-reduced-motion: reduce) { .halftone { animation: none; } }
</style>
</head>
<body>
  <div class="glow" aria-hidden="true"></div>
  <div class="halftone" aria-hidden="true"></div>
  <div class="label"><b>HALFTONE</b><small>two gradients · one mask</small></div>
</body>
</html>
`;

  const orb = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Glowing orb</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    overflow: hidden;
    background:
      radial-gradient(800px 500px at 50% 120%, rgba(90, 120, 255, 0.12), transparent 70%),
      #04060a;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #eef2f9;
  }

  .scene { position: relative; display: grid; place-items: center; width: min(560px, 90vw); aspect-ratio: 1; }

  /* Core: a conic gradient spinning behind a soft highlight. */
  .orb {
    position: relative;
    width: 62%;
    aspect-ratio: 1;
    border-radius: 50%;
    background:
      radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.18) 26%, transparent 46%),
      conic-gradient(from 0deg, #1b2a44, #3d7bff, #8b5cf6, #22d3ee, #12b981, #1b2a44);
    box-shadow:
      0 0 60px rgba(61, 123, 255, 0.45),
      0 0 160px rgba(139, 92, 246, 0.28),
      inset 0 0 70px rgba(0, 0, 0, 0.55);
    animation: spin 18s linear infinite;
  }
  .orb::after {
    content: "";
    position: absolute;
    inset: 12%;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.45);
  }

  .ring {
    position: absolute;
    width: 92%;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 1px solid rgba(160, 200, 255, 0.16);
    animation: tilt 22s linear infinite;
  }
  .ring.b { width: 78%; border-color: rgba(255, 255, 255, 0.1); animation-direction: reverse; animation-duration: 16s; }
  .ring::before {
    content: "";
    position: absolute;
    top: -3px;
    left: 50%;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #dbeaff;
    box-shadow: 0 0 14px #8fc2ff;
  }

  .caption {
    position: absolute;
    bottom: 6%;
    text-align: center;
    font-size: 11px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(238, 242, 249, 0.5);
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes tilt {
    from { transform: rotateX(68deg) rotateZ(0deg); }
    to   { transform: rotateX(68deg) rotateZ(360deg); }
  }
  @media (prefers-reduced-motion: reduce) { .orb, .ring { animation: none; } }
</style>
</head>
<body>
  <div class="scene">
    <div class="ring" aria-hidden="true"></div>
    <div class="ring b" aria-hidden="true"></div>
    <div class="orb" role="img" aria-label="Glowing gradient orb"></div>
    <p class="caption">conic gradient · spinning</p>
  </div>
</body>
</html>
`;

  const poster = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Generative poster</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    background: #0a0a0c;
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #f5f2ea;
    padding: 24px;
  }

  .poster {
    position: relative;
    width: min(680px, 100%);
    aspect-ratio: 4 / 5;
    overflow: hidden;
    border-radius: 6px;
    isolation: isolate;
    background:
      repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.05) 0 1px, transparent 1px 26px),
      linear-gradient(165deg, #ff6b4a 0%, #d92d5c 38%, #4d2bff 78%, #120d2b 100%);
    box-shadow: 0 50px 120px -50px #000;
  }

  /* SVG turbulence duotone wash */
  .wash {
    position: absolute;
    inset: 0;
    opacity: 0.5;
    mix-blend-mode: soft-light;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='w'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.05' numOctaves='4' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 0.9 0 0 0 0 0.8 0 0 0 0.8 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23w)'/%3E%3C/svg%3E");
  }

  .type {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 34px;
  }
  .type .top { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; }
  .type h1 {
    margin: 0;
    font-size: clamp(54px, 10vw, 104px);
    line-height: 0.86;
    font-weight: 800;
    letter-spacing: -0.055em;
    text-transform: uppercase;
    mix-blend-mode: overlay;
  }
  .type .bottom { display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; line-height: 1.5; }
  .type .bottom span:last-child { text-align: right; opacity: 0.7; }

  .stamp {
    position: absolute;
    right: -30px;
    top: 32%;
    transform: rotate(90deg);
    font-size: 10px;
    letter-spacing: 0.5em;
    text-transform: uppercase;
    opacity: 0.65;
  }
</style>
</head>
<body>
  <article class="poster">
    <div class="wash" aria-hidden="true"></div>
    <div class="stamp">Eltes Studio · № 001</div>
    <div class="type">
      <div class="top"><span>Generative series</span><span>2026</span></div>
      <h1>Make<br />it<br />move</h1>
      <div class="bottom">
        <span>CSS gradients<br />SVG turbulence<br />pure code</span>
        <span>No images<br />were harmed</span>
      </div>
    </div>
  </article>
</body>
</html>
`;

  const items = [
    {
      id: 'gradient-mesh',
      name: 'Animated gradient mesh',
      tag: 'CSS',
      blurb: 'Four radial fields, blurred and drifting under a fractal-noise grain tile.',
      swatch: 'radial-gradient(circle at 20% 20%, #2f6bff, transparent 55%), radial-gradient(circle at 80% 30%, #8b5cf6, transparent 55%), radial-gradient(circle at 40% 85%, #12b981, transparent 55%), #070a10',
      code: gradientMesh
    },
    {
      id: 'particles',
      name: 'Canvas particle field',
      tag: 'Canvas',
      blurb: 'A DPR-aware particle network with distance-based links and reduced-motion support.',
      swatch: 'radial-gradient(circle at 50% 40%, #1b3a5c, #04060a 70%)',
      code: particles
    },
    {
      id: 'aurora',
      name: 'Aurora ribbons',
      tag: 'CSS',
      blurb: 'Tall rotated gradient ribbons, blurred into light, swaying behind type.',
      swatch: 'linear-gradient(160deg, #03060b 10%, #2f6bff 45%, #12b981 70%, #03060b 96%)',
      code: aurora
    },
    {
      id: 'halftone',
      name: 'Animated halftone',
      tag: 'CSS',
      blurb: 'Two repeating dot screens under a radial mask — a print texture that breathes.',
      swatch: 'radial-gradient(circle at 50% 50%, #e8ecf4 1.4px, transparent 1.6px) 0 0 / 12px 12px, linear-gradient(160deg, #131722, #07090d)',
      code: halftone
    },
    {
      id: 'orb',
      name: 'Glowing orb',
      tag: 'CSS',
      blurb: 'A spinning conic gradient with 3D-tilted orbit rings and soft bloom.',
      swatch: 'conic-gradient(from 210deg, #1b2a44, #3d7bff, #8b5cf6, #22d3ee, #12b981, #1b2a44)',
      code: orb
    },
    {
      id: 'poster',
      name: 'Generative poster',
      tag: 'SVG',
      blurb: 'Duotone turbulence, blend modes and big type — a poster with no bitmap assets.',
      swatch: 'linear-gradient(165deg, #ff6b4a, #d92d5c 38%, #4d2bff 78%, #120d2b)',
      code: poster
    }
  ];

  return { items };
})();
