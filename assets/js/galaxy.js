/* ==========================================================================
   Eltes — a living galaxy behind the site.
   --------------------------------------------------------------------------
   One fixed canvas. A pre-rendered deep-space backdrop (galactic band, dust),
   two slowly turning nebula clouds and three parallax layers of stars. Stars
   drift as if the page were travelling through space; fast scrolling leaves a
   short warp trail. Nothing is downloaded: every particle is computed here.

   • 30 fps, device pixel ratio capped at 1.75
   • stops when the tab is hidden
   • renders a single still frame when the reader prefers reduced motion
   • exposes window.EltesGalaxy for debugging and the smoke tests
   ========================================================================== */

(function () {
  'use strict';

  const canvas = document.querySelector('canvas[data-galaxy]');
  if (!canvas) return;
  // The painted backdrop lives on its own canvas so a resize costs one repaint
  // instead of one per frame. Without it, the backdrop is redrawn each frame.
  const backdropCanvas = document.querySelector('canvas[data-galaxy-backdrop]');

  let ctx = null;
  try {
    ctx = canvas.getContext && canvas.getContext('2d');
  } catch (error) {
    ctx = null;
  }
  const canDraw = ctx && typeof ctx.createLinearGradient === 'function' &&
    typeof ctx.createRadialGradient === 'function' && typeof ctx.drawImage === 'function';
  if (!canDraw) {
    if (canvas.parentElement) canvas.parentElement.classList.add('galaxy--static');
    return;
  }

  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const coarseQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;

  const rawIntensity = parseFloat(canvas.dataset.galaxy || '1');
  const INTENSITY = Number.isFinite(rawIntensity) ? Math.min(Math.max(rawIntensity, 0.3), 1.4) : 1;
  const FPS_CAP = coarseQuery && coarseQuery.matches ? 24 : 32;

  const COLORS = [
    [255, 255, 255],
    [226, 237, 255],
    [186, 212, 255],
    [255, 238, 210],
    [255, 208, 164],
    [192, 248, 236],
    [210, 192, 255]
  ];

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    stars: [],
    meteors: [],
    reduced: !!(reduceQuery && reduceQuery.matches),
    running: false,
    frames: 0,
    intensity: INTENSITY
  };

  let backdrop = null;
  let nebula = null;
  let glowSprites = null;
  let bokeh = [];
  let stars = state.stars;
  let meteors = state.meteors;
  let rafId = 0;
  let lastDraw = 0;
  let start = 0;
  let scrollY = window.scrollY || window.pageYOffset || 0;
  let lastScrollY = scrollY;
  let scrollKick = 0;
  let nextMeteorAt = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let resizeTimer = 0;

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);


  /* --------------------------- shooting stars ---------------------------- */

  /* A star that falls with a head, a tapering tail and a small bloom. Drawn
     from the star's own velocity so the tail always points where it came from. */
  function drawMeteor(m, fade) {
    const dx = m.vx * m.len;
    const dy = m.vy * m.len;
    const tail = ctx.createLinearGradient(m.x, m.y, m.x - dx, m.y - dy);
    tail.addColorStop(0, `rgba(255, 255, 255, ${(0.9 * fade).toFixed(3)})`);
    tail.addColorStop(0.12, `rgba(${m.hue}, ${(0.6 * fade).toFixed(3)})`);
    tail.addColorStop(0.46, `rgba(${m.hue}, ${(0.16 * fade).toFixed(3)})`);
    tail.addColorStop(1, `rgba(${m.hue}, 0)`);
    ctx.strokeStyle = tail;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - dx, m.y - dy);
    ctx.stroke();

    for (let i = 1; i <= 5; i += 1) {
      const f = i / 6;
      const sx = m.x - dx * f * 0.85 + (i % 2 ? 1 : -1) * i * 0.9;
      const sy = m.y - dy * f * 0.85 + (i % 2 ? -1 : 1) * i * 0.7;
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.4 * fade * (1 - f)).toFixed(3)})`;
      ctx.fillRect(sx, sy, 1.3, 1.3);
    }

    if (glowSprites) {
      const size = 26 * (0.6 + fade * 0.6);
      ctx.globalAlpha = fade;
      ctx.drawImage(glowSprites[0], m.x - size / 2, m.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------ rendering ------------------------------ */

  function makeCanvas(width, height) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    return c;
  }

  /* A radial gradient stretched into an ellipse, optionally rotated. */
  function ellipseFill(b, x, y, rx, ry, stops, rotation = 0) {
    b.save();
    b.translate(x, y);
    if (rotation) b.rotate(rotation);
    b.scale(1, ry / rx);
    const grad = b.createRadialGradient(0, 0, 0, 0, 0, rx);
    stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
    b.fillStyle = grad;
    b.beginPath();
    b.arc(0, 0, rx, 0, Math.PI * 2);
    b.fill();
    b.restore();
  }

  /* ---------------------------- scene sprites ---------------------------- */

  /* A grand-design spiral seen at an angle, painted once into a small sprite
     and blitted into the backdrop. Painting it small keeps the cost flat no
     matter how big the viewport is. */
  function spiralSprite(size) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    if (!g) return c;
    const R = size / 2;
    g.translate(R, R);

    // faint halo around the whole disk
    g.globalCompositeOperation = 'lighter';
    ellipseFill(g, 0, 0, R, R * 0.94, [
      [0, 'rgba(255, 224, 188, 0.2)'],
      [0.3, 'rgba(226, 208, 250, 0.07)'],
      [1, 'rgba(170, 170, 255, 0)']
    ]);

    const thetaMax = Math.PI * 3.05;
    const k = Math.log(1 / 0.055) / thetaMax;

    for (let arm = 0; arm < 2; arm += 1) {
      const phase = arm * Math.PI;

      // young blue-white stars strung along the arm
      for (let i = 0; i < 2400; i += 1) {
        const f = Math.pow(i / 2400, 0.84);
        const theta = f * thetaMax;
        const r = R * 0.055 * Math.exp(k * theta);
        const jitter = (Math.random() + Math.random() + Math.random() - 1.5) * R * 0.085 * (0.25 + f);
        const ang = theta + phase;
        const x = Math.cos(ang) * r + Math.cos(ang + Math.PI / 2) * jitter;
        const y = (Math.sin(ang) * r + Math.sin(ang + Math.PI / 2) * jitter) * 0.3;
        const warm = Math.max(0, 1 - f * 2.2);
        const rr = Math.round(214 + warm * 41);
        const gg = Math.round(226 - warm * 8);
        const bb = Math.round(255 - warm * 45);
        const a = (0.04 + 0.3 * (1 - f)) * rand(0.3, 1);
        g.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${Math.max(0.02, a).toFixed(3)})`;
        g.fillRect(x, y, rand(0.5, 1.6), rand(0.5, 1.6));
      }

      // pink star-forming knots
      for (let i = 0; i < 22; i += 1) {
        const f = rand(0.22, 0.94);
        const theta = f * thetaMax;
        const r = R * 0.055 * Math.exp(k * theta);
        const ang = theta + phase + rand(-0.14, 0.14);
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r * 0.3;
        const rad = rand(1.4, 4.6);
        const grad = g.createRadialGradient(x, y, 0, x, y, rad);
        grad.addColorStop(0, 'rgba(255, 158, 196, 0.62)');
        grad.addColorStop(1, 'rgba(255, 120, 170, 0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }

      // a dark dust lane hugging the inside edge of the arm
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 110; i += 1) {
        const f = Math.pow(i / 110, 0.82);
        const theta = f * thetaMax;
        const r = R * 0.055 * Math.exp(k * theta);
        const ang = theta + phase + 0.17;
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r * 0.3;
        const rad = R * 0.024 * (0.35 + f);
        const grad = g.createRadialGradient(x, y, 0, x, y, rad);
        grad.addColorStop(0, 'rgba(0, 0, 3, 0.5)');
        grad.addColorStop(0.6, 'rgba(0, 0, 3, 0.2)');
        grad.addColorStop(1, 'rgba(0, 0, 3, 0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }
      g.globalCompositeOperation = 'lighter';
    }

    // bar + nucleus, outshining everything else in the disk
    ellipseFill(g, 0, 0, R * 0.5, R * 0.085, [
      [0, 'rgba(255, 238, 206, 0.42)'],
      [0.55, 'rgba(255, 214, 172, 0.14)'],
      [1, 'rgba(255, 200, 150, 0)']
    ], 0.5);
    ellipseFill(g, 0, 0, R * 0.26, R * 0.12, [
      [0, 'rgba(255, 246, 230, 0.85)'],
      [0.2, 'rgba(255, 230, 190, 0.5)'],
      [0.55, 'rgba(255, 206, 150, 0.16)'],
      [1, 'rgba(255, 190, 130, 0)']
    ]);
    ellipseFill(g, 0, 0, R * 0.055, R * 0.03, [
      [0, 'rgba(255, 255, 255, 0.95)'],
      [0.5, 'rgba(255, 246, 224, 0.5)'],
      [1, 'rgba(255, 236, 200, 0)']
    ]);
    return c;
  }

  /* A globular cluster: a compact ball of resolved stars. */
  function clusterSprite(size) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    if (!g) return c;
    const R = size / 2;
    g.translate(R, R);
    g.globalCompositeOperation = 'lighter';
    ellipseFill(g, 0, 0, R * 0.9, R * 0.9, [
      [0, 'rgba(255, 232, 200, 0.34)'],
      [0.32, 'rgba(214, 206, 255, 0.12)'],
      [1, 'rgba(160, 170, 255, 0)']
    ]);
    for (let i = 0; i < 820; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.pow(Math.random(), 1.75) * R * 0.78;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      const alpha = rand(0.12, 0.8) * (1 - rad / (R * 0.95));
      const warm = Math.random() < 0.32;
      g.fillStyle = `rgba(${warm ? 255 : 226}, ${warm ? 226 : 236}, ${warm ? 194 : 255}, ${Math.max(0.02, alpha).toFixed(3)})`;
      g.fillRect(x, y, rand(0.4, 1.6), rand(0.4, 1.6));
    }
    return c;
  }

  /* A wispy emission nebula: a soft body plus a handful of filaments. */
  function nebulaKnot(b, x, y, radius, rgb, alpha) {
    // Painted small and blitted large: the upscale does the blurring, so the
    // cloud keeps soft, organic edges instead of visible gradient rings.
    const span = radius * 3;
    const size = Math.max(56, Math.round(span * 0.42));
    const sprite = makeCanvas(size, size);
    const g = sprite.getContext('2d');
    if (!g) return;
    const c = size / 2;
    const r = size * 0.3;
    g.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 12; i += 1) {
      const a = rand(0, Math.PI * 2);
      const d = rand(0, r * 0.95);
      const lx = c + Math.cos(a) * d;
      const ly = c + Math.sin(a) * d * 0.8;
      const lr = r * rand(0.22, 0.58);
      const grad = g.createRadialGradient(lx, ly, 0, lx, ly, lr);
      grad.addColorStop(0, `rgba(${rgb}, ${(alpha * rand(0.25, 0.6)).toFixed(3)})`);
      grad.addColorStop(0.5, `rgba(${rgb}, ${(alpha * rand(0.06, 0.18)).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(lx, ly, lr, 0, Math.PI * 2);
      g.fill();
    }

    g.lineCap = 'round';
    for (let i = 0; i < 16; i += 1) {
      const a0 = rand(0, Math.PI * 2);
      const d0 = rand(0, r * 0.7);
      let px = c + Math.cos(a0) * d0;
      let py = c + Math.sin(a0) * d0;
      g.beginPath();
      g.moveTo(px, py);
      for (let k = 0; k < 4; k += 1) {
        const ang = a0 + rand(-0.9, 0.9);
        const len = r * rand(0.14, 0.38);
        const nx = px + Math.cos(ang) * len;
        const ny = py + Math.sin(ang) * len * 0.85;
        g.quadraticCurveTo(px + Math.cos(ang + 0.7) * len * 0.5, py + Math.sin(ang + 0.7) * len * 0.5, nx, ny);
        px = nx;
        py = ny;
      }
      g.strokeStyle = `rgba(${rgb}, ${(alpha * rand(0.05, 0.15)).toFixed(3)})`;
      g.lineWidth = rand(1.4, 3.4);
      g.stroke();
    }

    b.save();
    b.globalCompositeOperation = 'lighter';
    b.drawImage(sprite, x - span / 2, y - span / 2, span, span);
    b.restore();
  }

  /* A bright foreground star with a bloom and four diffraction spikes. */
  function heroStar(b, x, y, r, rgb, alpha) {
    ellipseFill(b, x, y, r * 3.6, r * 3.6, [
      [0, `rgba(${rgb}, ${(alpha * 0.5).toFixed(3)})`],
      [0.32, `rgba(${rgb}, ${(alpha * 0.14).toFixed(3)})`],
      [1, `rgba(${rgb}, 0)`]
    ]);
    b.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.5).toFixed(3)})`;
    b.beginPath();
    b.arc(x, y, r * 0.52, 0, Math.PI * 2);
    b.fill();

    const len = r * 7;
    const spike = (dx, dy) => {
      const g = b.createLinearGradient(x, y, x + dx * len, y + dy * len);
      g.addColorStop(0, `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`);
      g.addColorStop(0.14, `rgba(${rgb}, ${(alpha * 0.4).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      b.strokeStyle = g;
      b.lineWidth = Math.max(0.7, r * 0.4);
      b.lineCap = 'round';
      b.beginPath();
      b.moveTo(x - dx * len, y - dy * len);
      b.lineTo(x + dx * len, y + dy * len);
      b.stroke();
    };
    spike(1, 0);
    spike(0, 1);
  }

  function buildBackdrop() {
    // Soft art does not need the full device ratio; 1.4 is indistinguishable
    // here and keeps the one-off paint cheap on high-density screens.
    const scale = Math.min(state.dpr, 1.4);
    const c = makeCanvas(state.width * scale, state.height * scale);
    const b = c.getContext('2d');
    if (!b) return null;
    const W = state.width;
    const H = state.height;
    b.scale(scale, scale);

    // 1. deep space: true black with a faint warm bloom, no blue cast
    const base = b.createLinearGradient(0, 0, W * 0.35, H);
    base.addColorStop(0, '#000001');
    base.addColorStop(0.42, '#010003');
    base.addColorStop(0.72, '#030105');
    base.addColorStop(1, '#000001');
    b.fillStyle = base;
    b.fillRect(0, 0, W, H);

    // 2. neighbours: a spiral top-right, a globular cluster top-left and one
    //    edge-on galaxy low on the left. All blitted from small sprites.
    const spiralSize = Math.min(H * 0.46, W * 0.32, 430);
    const spiral = spiralSprite(Math.round(spiralSize * state.dpr * 0.7));
    b.save();
    b.translate(W * 0.845, H * 0.16);
    b.rotate(-0.38);
    b.globalAlpha = 0.6;
    b.drawImage(spiral, -spiralSize / 2, -spiralSize / 2, spiralSize, spiralSize);
    b.restore();

    const clusterSize = Math.min(H * 0.24, 220);
    const cluster = clusterSprite(Math.round(clusterSize * state.dpr));
    b.save();
    b.globalAlpha = 0.8;
    b.drawImage(cluster, W * 0.1 - clusterSize / 2, H * 0.17 - clusterSize / 2, clusterSize, clusterSize);
    b.restore();

    b.save();
    b.translate(W * 0.055, H * 0.66);
    b.rotate(-0.55);
    b.scale(1, 0.22);
    ellipseFill(b, 0, 0, H * 0.17, H * 0.17, [
      [0, 'rgba(255, 240, 214, 0.5)'],
      [0.16, 'rgba(255, 226, 190, 0.24)'],
      [0.5, 'rgba(226, 214, 255, 0.07)'],
      [1, 'rgba(200, 200, 255, 0)']
    ]);
    b.restore();

    /* 3. the galactic band: a long tilted river of stars with a warm core and
       a cold outer lane, cut open by a dark rift. */
    const cx = W * 0.55;
    const cy = H * 0.66;
    const tilt = -0.3;
    const L = Math.hypot(W, H);
    const BW = Math.min(H * 0.34, 400);

    b.save();
    b.translate(cx, cy);
    b.rotate(tilt);
    b.globalCompositeOperation = 'lighter';

    // wide halo
    ellipseFill(b, 0, 0, L * 0.62, BW * 1.55, [
      [0, 'rgba(150, 132, 176, 0.11)'],
      [0.42, 'rgba(104, 96, 148, 0.055)'],
      [1, 'rgba(70, 60, 110, 0)']
    ]);

    // star clouds — warm in the middle, cool at the ends
    const clouds = [
      ['214, 228, 255', 0.46], ['242, 246, 255', 0.4],
      ['170, 206, 255', 0.34], ['255, 234, 202', 0.3],
      ['255, 210, 164', 0.2], ['255, 156, 192', 0.16],
      ['128, 226, 208', 0.12], ['186, 162, 255', 0.18]
    ];
    for (let i = 0; i < 64; i += 1) {
      const tint = clouds[(Math.random() * clouds.length) | 0];
      const along = rand(-0.5, 0.5) * L;
      const across = (Math.random() + Math.random() + Math.random() - 1.5) * BW * 0.5;
      const rx = rand(70, 320) * (1 - Math.abs(across) / (BW * 1.7));
      if (rx < 26) continue;
      const alpha = tint[1] * rand(0.035, 0.1) * (1 - Math.abs(across) / (BW * 1.7));
      ellipseFill(b, along, across, rx, rx * rand(0.26, 0.6), [
        [0, `rgba(${tint[0]}, ${Math.max(0.02, alpha).toFixed(3)})`],
        [0.55, `rgba(${tint[0]}, ${Math.max(0.01, alpha * 0.36).toFixed(3)})`],
        [1, `rgba(${tint[0]}, 0)`]
      ], rand(-0.32, 0.32));
    }

    // broad bulge, then a hot nucleus that blows the middle out to cream
    ellipseFill(b, -L * 0.14, 0, BW * 1.35, BW * 0.86, [
      [0, 'rgba(255, 238, 208, 0.3)'],
      [0.2, 'rgba(255, 222, 180, 0.17)'],
      [0.5, 'rgba(214, 196, 240, 0.07)'],
      [1, 'rgba(150, 160, 255, 0)']
    ]);
    ellipseFill(b, -L * 0.14, 0, BW * 0.7, BW * 0.44, [
      [0, 'rgba(255, 252, 240, 0.58)'],
      [0.22, 'rgba(255, 238, 206, 0.3)'],
      [0.6, 'rgba(255, 210, 160, 0.08)'],
      [1, 'rgba(255, 200, 150, 0)']
    ]);
    ellipseFill(b, -L * 0.14, 0, BW * 0.2, BW * 0.13, [
      [0, 'rgba(255, 255, 252, 0.9)'],
      [0.4, 'rgba(255, 247, 228, 0.42)'],
      [1, 'rgba(255, 228, 190, 0)']
    ]);

    // the rift: dark dust that splits the band in two
    b.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 64; i += 1) {
      const along = rand(-0.52, 0.42) * L;
      const across = rand(-1, 1) * BW * 0.22;
      const rx = rand(60, 260);
      const shade = rand(0.5, 0.9);
      ellipseFill(b, along, across, rx, rx * rand(0.12, 0.3), [
        [0, `rgba(1, 0, 4, ${shade.toFixed(3)})`],
        [0.4, `rgba(1, 0, 4, ${(shade * 0.6).toFixed(3)})`],
        [0.72, `rgba(1, 0, 4, ${(shade * 0.22).toFixed(3)})`],
        [1, 'rgba(1, 0, 4, 0)']
      ], rand(-0.16, 0.16));
    }

    // an edge of hot young stars along the rift, so it reads as a dust lane
    b.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i += 1) {
      const along = rand(-0.5, 0.45) * L;
      const across = rand(-1, 1) * BW * 0.2;
      const r = rand(0.6, 1.6);
      b.fillStyle = `rgba(226, 236, 255, ${rand(0.1, 0.36).toFixed(3)})`;
      b.beginPath();
      b.arc(along, across + rand(4, 16), r, 0, Math.PI * 2);
      b.fill();
    }

    // a handful of dense star clouds along the spine
    for (let i = 0; i < 9; i += 1) {
      const along = rand(-0.42, 0.42) * L;
      const across = rand(-0.35, 0.35) * BW;
      const rr = rand(30, 110);
      for (let j = 0; j < 340; j += 1) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.pow(Math.random(), 1.6) * rr;
        b.fillStyle = `rgba(${(206 + Math.random() * 49) | 0}, ${(222 + Math.random() * 26) | 0}, 255, ${rand(0.12, 0.6).toFixed(3)})`;
        b.fillRect(along + Math.cos(a) * d, across + Math.sin(a) * d * 0.5, rand(0.3, 1.1), rand(0.3, 1.1));
      }
    }

    // dense star field, exponentially clustered towards the spine
    const specks = Math.round(8200 * INTENSITY);
    for (let i = 0; i < specks; i += 1) {
      const along = rand(-0.55, 0.55) * L;
      const spread = Math.random() < 0.55 ? 0.2 : 0.72;
      const across = (Math.random() + Math.random() + Math.random() - 1.5) * BW * spread;
      const size = rand(0.3, 1.5);
      const bright = rand(0.04, 0.5) * (1 - Math.abs(across) / (BW * 1.45));
      if (bright <= 0.012) continue;
      const warm = Math.random() < 0.18;
      if (warm) {
        b.fillStyle = `rgba(255, ${(206 + Math.random() * 34) | 0}, ${(160 + Math.random() * 44) | 0}, ${bright.toFixed(3)})`;
      } else {
        const t = Math.random();
        b.fillStyle = `rgba(${(178 + t * 77) | 0}, ${(206 + t * 40) | 0}, 255, ${bright.toFixed(3)})`;
      }
      b.fillRect(along, across, size, size);
    }
    b.restore();

    // 4. emission nebulae, each with a different temperature
    b.globalCompositeOperation = 'lighter';
    nebulaKnot(b, W * 0.29, H * 0.71, Math.min(W, H) * 0.15, '255, 104, 146', 0.1);
    nebulaKnot(b, W * 0.73, H * 0.5, Math.min(W, H) * 0.13, '58, 226, 200', 0.085);
    nebulaKnot(b, W * 0.55, H * 0.88, Math.min(W, H) * 0.1, '255, 168, 100', 0.07);
    nebulaKnot(b, W * 0.12, H * 0.4, Math.min(W, H) * 0.09, '164, 128, 255', 0.06);

    // 5. a few foreground hero stars with diffraction spikes
    const heroes = [
      [0.72, 0.12, 2.1, '226, 236, 255', 0.8],
      [0.34, 0.22, 1.7, '255, 238, 210', 0.7],
      [0.9, 0.42, 1.5, '206, 226, 255', 0.6],
      [0.14, 0.3, 1.9, '255, 224, 196', 0.66],
      [0.62, 0.9, 1.4, '226, 238, 255', 0.5],
      [0.06, 0.88, 1.6, '210, 230, 255', 0.55],
      [0.46, 0.06, 1.3, '255, 244, 226', 0.5]
    ];
    heroes.forEach(([hx, hy, hr, hue, alpha]) => {
      heroStar(b, W * hx, H * hy, hr * INTENSITY, hue, alpha);
    });

    // 6. a cool haze low in the corners for depth
    ellipseFill(b, W * 0.06, H * 1.04, W * 0.4, H * 0.34, [
      [0, 'rgba(96, 74, 138, 0.18)'],
      [1, 'rgba(96, 74, 138, 0)']
    ]);
    ellipseFill(b, W * 0.95, H * 0.94, W * 0.28, H * 0.28, [
      [0, 'rgba(140, 96, 120, 0.12)'],
      [1, 'rgba(140, 96, 120, 0)']
    ]);

    // A veil keeps the artwork rich without competing with the typography.
    const veil = clamp(0.47 - INTENSITY * 0.13, 0.16, 0.42);
    const vignette = b.createRadialGradient(W * 0.5, H * 0.32, 0, W * 0.5, H * 0.4, Math.max(W, H) * 0.8);
    vignette.addColorStop(0, `rgba(1, 0, 4, ${(veil * 0.55).toFixed(3)})`);
    vignette.addColorStop(0.55, `rgba(1, 0, 4, ${(veil * 0.82).toFixed(3)})`);
    vignette.addColorStop(1, `rgba(1, 0, 4, ${veil.toFixed(3)})`);
    b.fillStyle = vignette;
    b.fillRect(0, 0, W, H);

    return c;
  }

  function buildNebula() {
    const size = 1024;
    const c = makeCanvas(size, size);
    const n = c.getContext('2d');
    if (!n) return null;
    n.globalCompositeOperation = 'lighter';
    const palette = [
      ['255, 118, 160', 0.4], ['74, 226, 198', 0.34], ['255, 176, 108', 0.24],
      ['178, 146, 255', 0.4], ['255, 92, 138', 0.2], ['140, 208, 255', 0.18],
      ['255, 210, 168', 0.16]
    ];
    for (let i = 0; i < 34; i += 1) {
      const tint = palette[(Math.random() * palette.length) | 0];
      const x = rand(size * 0.12, size * 0.88);
      const y = rand(size * 0.12, size * 0.88);
      const r = rand(size * 0.06, size * 0.26);
      const alpha = tint[1] * rand(0.22, 0.6);
      const g = n.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${tint[0]}, ${alpha.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(${tint[0]}, ${(alpha * 0.35).toFixed(3)})`);
      g.addColorStop(1, `rgba(${tint[0]}, 0)`);
      n.fillStyle = g;
      n.beginPath();
      n.arc(x, y, r, 0, Math.PI * 2);
      n.fill();
    }
    return c;
  }

  function buildGlowSprites() {
    return COLORS.map((rgb) => {
      const c = makeCanvas(48, 48);
      const g = c.getContext('2d');
      if (!g) return c;
      const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      grad.addColorStop(0, `rgba(255, 255, 255, 1)`);
      grad.addColorStop(0.16, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.95)`);
      grad.addColorStop(0.42, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.24)`);
      grad.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 48, 48);
      return c;
    });
  }

  function buildStars() {
    const area = state.width * state.height;
    const density = window.innerWidth < 720 ? 4200 : 3100;
    const count = Math.round(clamp(area / density, 110, window.innerWidth < 720 ? 320 : 680) * INTENSITY);
    const list = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const depth = Math.pow(Math.random(), 1.65);
      const tintIndex = Math.min(COLORS.length - 1, Math.floor(Math.pow(Math.random(), 1.5) * COLORS.length));
      list[i] = {
        x: Math.random(),
        y: Math.random(),
        z: 0.16 + depth * 0.84,
        r: 0.3 + depth * 1.45 * rand(0.7, 1.25),
        tint: tintIndex,
        a: rand(0.22, 0.92) * (0.5 + depth * 0.5),
        tw: rand(0.5, 2.1),
        ph: rand(0, Math.PI * 2),
        speed: 0.0035 + depth * 0.0085,
        flare: depth > 0.88 && Math.random() < 0.35
      };
    }
    stars = list;
    state.stars = list;

    bokeh = [];
    const bokehCount = Math.round(9 * INTENSITY);
    for (let i = 0; i < bokehCount; i += 1) {
      bokeh.push({
        x: Math.random(),
        y: Math.random(),
        r: rand(30, 78),
        a: rand(0.014, 0.038),
        tint: (Math.random() * COLORS.length) | 0,
        speed: rand(0.0009, 0.0022),
        ring: rand(0.1, 0.24)
      });
    }
  }

  function resize() {
    const prevW = state.width;
    const width = window.innerWidth || document.documentElement.clientWidth || 1280;
    const height = window.innerHeight || document.documentElement.clientHeight || 800;
    const mobile = width < 720;
    const dpr = clamp(window.devicePixelRatio || 1, 1, mobile ? 1.4 : 1.75);

    state.width = width;
    state.height = height;
    state.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    backdrop = buildBackdrop();
    if (backdropCanvas) {
      backdropCanvas.width = Math.round(width * dpr);
      backdropCanvas.height = Math.round(height * dpr);
      backdropCanvas.style.width = `${width}px`;
      backdropCanvas.style.height = `${height}px`;
      const bctx = backdropCanvas.getContext && backdropCanvas.getContext('2d');
      if (bctx) {
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        if (backdrop) bctx.drawImage(backdrop, 0, 0, backdropCanvas.width, backdropCanvas.height);
      }
    }
    if (!nebula) nebula = buildNebula();
    if (!glowSprites) glowSprites = buildGlowSprites();
    if (!state.stars.length || Math.abs(width - prevW) > 40) buildStars();

    // a new size invalidates the cached still frame
    if (state.reduced) drawStill();
  }

  /* ------------------------------- drawing ------------------------------- */

  function drawNebula(t) {
    if (!nebula) return;
    const W = state.width;
    const H = state.height;
    const size = Math.max(W, H) * 1.5;
    const drift = Math.sin(t * 0.008) * 26 + pointer.x * 20;
    const lift = Math.cos(t * 0.006) * 20 + pointer.y * 14 - scrollY * 0.02;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.19;
    ctx.translate(W * 0.52 + drift, H * 0.42 + lift);
    ctx.rotate(t * 0.0045);
    ctx.drawImage(nebula, -size / 2, -size / 2, size, size);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.11;
    ctx.translate(W * 0.24 - drift * 0.6, H * 0.68 + lift * 0.5);
    ctx.rotate(-t * 0.0032 + 2.1);
    ctx.drawImage(nebula, -size * 0.42, -size * 0.42, size * 0.84, size * 0.84);
    ctx.restore();
  }

  function drawStars(t) {
    const W = state.width;
    const H = state.height;
    const spanX = W + 260;
    const spanY = H + 200;
    const kick = clamp(scrollKick, -26, 26);

    for (let i = 0; i < stars.length; i += 1) {
      const star = stars[i];
      const drift = t * star.speed;
      let px = ((star.x * spanX + drift * spanX * 0.06 + pointer.x * 26 * star.z + scrollY * 0.02 * star.z) % spanX + spanX) % spanX - 130;
      let py = ((star.y * spanY + pointer.y * 16 * star.z) % spanY + spanY) % spanY - 100;

      const twinkle = 0.66 + 0.34 * Math.sin(t * star.tw + star.ph);
      const alpha = clamp(star.a * twinkle, 0.02, 1);
      const rgb = COLORS[star.tint];

      if (Math.abs(kick) > 2.5) {
        const trail = kick * star.z * 2.4;
        ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(alpha * 0.5).toFixed(3)})`;
        ctx.lineWidth = Math.max(0.6, star.r * 0.8);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - trail * 0.35, py - trail);
        ctx.stroke();
      }

      if (star.flare && glowSprites) {
        const size = star.r * 16;
        ctx.globalAlpha = alpha;
        ctx.drawImage(glowSprites[star.tint], px - size / 2, py - size / 2, size, size);
        ctx.globalAlpha = 1;
      } else if (star.r > 1.05) {
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, star.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
        const size = star.r > 0.7 ? 1.4 : 1;
        ctx.fillRect(px, py, size, size);
      }
    }
  }

  function drawBokeh(t) {
    if (!glowSprites) return;
    const W = state.width;
    const H = state.height;
    for (let i = 0; i < bokeh.length; i += 1) {
      const dot = bokeh[i];
      const spanX = W + dot.r * 2;
      const px = ((dot.x * spanX + t * dot.speed * spanX * 0.06 + pointer.x * 40) % spanX + spanX) % spanX - dot.r;
      const py = ((dot.y * (H + dot.r * 2) + pointer.y * 26) % (H + dot.r * 2) + H + dot.r * 2) % (H + dot.r * 2) - dot.r;
      ctx.globalAlpha = dot.a * (0.8 + 0.2 * Math.sin(t * 0.6 + i));
      ctx.drawImage(glowSprites[dot.tint], px - dot.r, py - dot.r, dot.r * 2, dot.r * 2);
      // a faint rim, the way an out-of-focus star reads through a lens
      ctx.globalAlpha = dot.a * dot.ring;
      ctx.strokeStyle = `rgba(${COLORS[dot.tint].join(', ')}, 0.9)`;
      ctx.lineWidth = Math.max(0.8, dot.r * 0.045);
      ctx.beginPath();
      ctx.arc(px, py, dot.r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function spawnMeteor() {
    const W = state.width;
    const H = state.height;
    if (!W || !H) return;
    const fromLeft = Math.random() < 0.72;
    meteors.push({
      x: fromLeft ? rand(W * 0.02, W * 0.6) : rand(W * 0.6, W * 0.98),
      y: rand(-H * 0.05, H * 0.45),
      vx: rand(0.42, 0.66) * (fromLeft ? 1 : -1) * (W / 1440),
      vy: rand(0.16, 0.29) * (H / 900),
      len: rand(120, 300),
      age: 0,
      life: rand(0.85, 1.5),
      hue: Math.random() < 0.6 ? '190, 220, 255' : '255, 228, 196'
    });
  }

  function drawMeteors(dt) {
    const W = state.width;
    const H = state.height;
    for (let i = meteors.length - 1; i >= 0; i -= 1) {
      const m = meteors[i];
      m.age += dt;
      if (m.age > m.life || m.x < -320 || m.x > W + 320 || m.y > H + 220) {
        meteors.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt * 600;
      m.y += m.vy * dt * 600;
      drawMeteor(m, Math.sin(Math.min(1, m.age / m.life) * Math.PI));
    }
  }

  function draw(t, dt) {
    const W = state.width;
    const H = state.height;
    ctx.clearRect(0, 0, W, H);
    // With a dedicated backdrop canvas this is a no-op; otherwise paint it here.
    if (backdrop && !backdropCanvas) ctx.drawImage(backdrop, 0, 0, W, H);

    drawNebula(t);
    drawBokeh(t);
    drawStars(t);
    if (!state.reduced) drawMeteors(dt);
  }

  function drawStill() {
    draw(18, 0.016);
  }

  /* --------------------------------- loop -------------------------------- */

  function frame(now) {
    if (!state.running) return;
    rafId = requestAnimationFrame(frame);
    if (!start) start = now;
    const t = (now - start) / 1000;
    const interval = 1000 / FPS_CAP;
    if (now - lastDraw < interval) return;
    const dt = Math.min(0.06, (now - (lastDraw || now)) / 1000);
    lastDraw = now;

    const sy = window.scrollY || window.pageYOffset || 0;
    const delta = sy - lastScrollY;
    lastScrollY = sy;
    scrollY = sy;
    if (Math.abs(delta) > 0.4) scrollKick = clamp(scrollKick + delta * 0.16, -30, 30);
    scrollKick *= 0.9;
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    if (!state.reduced && t > nextMeteorAt) {
      spawnMeteor();
      if (Math.random() < 0.22) spawnMeteor();
      nextMeteorAt = t + rand(6, 15);
    }

    draw(t, dt);
    state.frames += 1;
  }

  function startLoop() {
    if (state.running || state.reduced) return;
    state.running = true;
    nextMeteorAt = 1.2;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    state.running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* -------------------------------- events ------------------------------- */

  function onPointer(event) {
    pointer.tx = clamp((event.clientX / state.width) * 2 - 1, -1, 1);
    pointer.ty = clamp((event.clientY / state.height) * 2 - 1, -1, 1);
  }

  function onVisibility() {
    if (document.hidden) stopLoop();
    else startLoop();
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (state.reduced) drawStill();
    }, 180);
  }

  function onMotionChange() {
    state.reduced = !!(reduceQuery && reduceQuery.matches);
    if (state.reduced) {
      stopLoop();
      drawStill();
    } else {
      startLoop();
    }
  }

  /* --------------------------------- boot -------------------------------- */

  resize();
  buildStars();
  drawStill();
  if (backdropCanvas && backdropCanvas.parentElement) backdropCanvas.parentElement.classList.add('galaxy--ready');
  startLoop();

  window.addEventListener('scroll', () => {
    scrollY = window.scrollY || window.pageYOffset || 0;
  }, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  if (reduceQuery) {
    if (typeof reduceQuery.addEventListener === 'function') reduceQuery.addEventListener('change', onMotionChange);
    else if (typeof reduceQuery.addListener === 'function') reduceQuery.addListener(onMotionChange);
  }

  window.EltesGalaxy = {
    state,
    refresh: () => {
      resize();
      buildStars();
      drawStill();
    },
    frame: (time = 6) => draw(time, 0.016),
    layers: { backdrop: () => backdrop, nebula: () => nebula, sprites: () => glowSprites },
    start: startLoop,
    stop: stopLoop
  };
})();
