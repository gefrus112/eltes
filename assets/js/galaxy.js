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
    [214, 226, 255],
    [168, 201, 255],
    [133, 176, 255],
    [255, 238, 218],
    [190, 247, 236],
    [203, 190, 255]
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

    if (glowSprites) {
      const size = 22 * (0.6 + fade * 0.6);
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

  function buildBackdrop() {
    const c = makeCanvas(state.width * state.dpr, state.height * state.dpr);
    const b = c.getContext('2d');
    if (!b) return null;
    const W = state.width;
    const H = state.height;
    b.scale(state.dpr, state.dpr);

    // deep space
    const base = b.createLinearGradient(0, 0, W * 0.3, H);
    base.addColorStop(0, '#010207');
    base.addColorStop(0.45, '#02040c');
    base.addColorStop(0.75, '#030616');
    base.addColorStop(1, '#010106');
    b.fillStyle = base;
    b.fillRect(0, 0, W, H);

    /* The galaxy runs across the screen, tilted, with its warm core left of
       centre. Everything is drawn in a rotated frame, then dust is cut back
       through the glow so the band reads as a band instead of a blob. */
    const cx = W * 0.56;
    const cy = H * 0.6;
    const tilt = -0.34;
    const L = Math.hypot(W, H);
    const BW = Math.min(H * 0.36, 420);

    b.save();
    b.translate(cx, cy);
    b.rotate(tilt);
    b.globalCompositeOperation = 'lighter';

    // 1. the wide halo of the band
    ellipseFill(b, 0, 0, L * 0.62, BW * 1.65, [
      [0, 'rgba(70, 98, 186, 0.17)'],
      [0.5, 'rgba(56, 80, 160, 0.085)'],
      [1, 'rgba(40, 62, 130, 0)']
    ]);

    // 2. star clouds along the band — the structure that makes it read
    const clouds = [
      ['255, 228, 196', 0.34], ['196, 214, 255', 0.4], ['128, 166, 255', 0.34],
      ['168, 132, 255', 0.26], ['96, 220, 206', 0.18], ['255, 196, 210', 0.16]
    ];
    for (let i = 0; i < 54; i += 1) {
      const tint = clouds[(Math.random() * clouds.length) | 0];
      const along = rand(-0.48, 0.48) * L;
      const across = (Math.random() + Math.random() + Math.random() - 1.5) * BW * 0.55;
      const rx = rand(60, 300) * (1 - Math.abs(across) / (BW * 1.6));
      if (rx < 30) continue;
      const alpha = tint[1] * rand(0.1, 0.30) * (1 - Math.abs(across) / (BW * 1.6));
      ellipseFill(b, along, across, rx, rx * rand(0.3, 0.65), [
        [0, `rgba(${tint[0]}, ${Math.max(0.02, alpha).toFixed(3)})`],
        [0.55, `rgba(${tint[0]}, ${Math.max(0.01, alpha * 0.38).toFixed(3)})`],
        [1, `rgba(${tint[0]}, 0)`]
      ], rand(-0.3, 0.3));
    }

    // 3. the core: a warm bulge that outshines the arms
    ellipseFill(b, -L * 0.13, 0, BW * 1.55, BW * 1.05, [
      [0, 'rgba(255, 240, 210, 0.3)'],
      [0.16, 'rgba(255, 222, 178, 0.21)'],
      [0.45, 'rgba(206, 190, 255, 0.11)'],
      [1, 'rgba(150, 170, 255, 0)']
    ]);
    ellipseFill(b, -L * 0.13, 0, BW * 0.62, BW * 0.5, [
      [0, 'rgba(255, 252, 240, 0.46)'],
      [0.3, 'rgba(255, 238, 206, 0.18)'],
      [1, 'rgba(255, 210, 160, 0)']
    ]);

    // 4. dust lanes cut the glow: dark ellipses along the spine
    b.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 26; i += 1) {
      const along = rand(-0.5, 0.4) * L;
      const across = rand(-1, 1) * BW * 0.28;
      const rx = rand(80, 280);
      const shade = rand(0.22, 0.46);
      ellipseFill(b, along, across, rx, rx * rand(0.16, 0.34), [
        [0, `rgba(2, 3, 10, ${shade.toFixed(3)})`],
        [0.42, `rgba(2, 3, 10, ${(shade * 0.62).toFixed(3)})`],
        [0.72, `rgba(2, 3, 10, ${(shade * 0.24).toFixed(3)})`],
        [1, 'rgba(2, 3, 10, 0)']
      ], rand(-0.15, 0.15));
    }

    // 5. dense star clouds: thousands of faint specks hugging the band
    b.globalCompositeOperation = 'lighter';
    const specks = Math.round(2600 * INTENSITY);
    for (let i = 0; i < specks; i += 1) {
      const along = rand(-0.55, 0.55) * L;
      const across = (Math.random() + Math.random() + Math.random() - 1.5) * BW * 0.62;
      const size = rand(0.3, 1.15);
      const bright = rand(0.06, 0.4) * (1 - Math.abs(across) / (BW * 1.4));
      if (bright <= 0.01) continue;
      b.fillStyle = `rgba(${rand(186, 255) | 0}, ${rand(200, 245) | 0}, 255, ${bright.toFixed(3)})`;
      b.fillRect(along, across, size, size);
    }
    b.restore();

    // 6. a soft cool haze in the lower corners for depth
    ellipseFill(b, W * 0.08, H * 1.02, W * 0.42, H * 0.36, [
      [0, 'rgba(28, 64, 132, 0.22)'],
      [1, 'rgba(28, 64, 132, 0)']
    ]);
    ellipseFill(b, W * 0.94, H * 0.92, W * 0.3, H * 0.3, [
      [0, 'rgba(92, 60, 140, 0.14)'],
      [1, 'rgba(92, 60, 140, 0)']
    ]);

    // 7. two distant galaxies — faint, warm and cool, behind everything
    ellipseFill(b, W * 0.84, H * 0.16, 96, 34, [
      [0, 'rgba(255, 226, 196, 0.16)'],
      [0.35, 'rgba(255, 200, 170, 0.08)'],
      [1, 'rgba(255, 180, 150, 0)']
    ], 0.5);
    ellipseFill(b, W * 0.12, H * 0.3, 74, 26, [
      [0, 'rgba(196, 214, 255, 0.14)'],
      [0.4, 'rgba(150, 176, 255, 0.07)'],
      [1, 'rgba(120, 150, 255, 0)']
    ], 0.35);

    // A veil keeps the artwork rich without competing with the typography.
    const veil = clamp(0.58 - INTENSITY * 0.2, 0.2, 0.5);
    const vignette = b.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.78);
    vignette.addColorStop(0, `rgba(1, 2, 7, ${(veil * 0.55).toFixed(3)})`);
    vignette.addColorStop(0.55, `rgba(1, 2, 7, ${(veil * 0.8).toFixed(3)})`);
    vignette.addColorStop(1, `rgba(1, 2, 7, ${veil.toFixed(3)})`);
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
      ['62, 108, 255', 0.5], ['122, 92, 255', 0.42], ['24, 188, 168', 0.3],
      ['46, 120, 200', 0.4], ['186, 96, 200', 0.22], ['255, 160, 120', 0.12]
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
    const bokehCount = Math.round(7 * INTENSITY);
    for (let i = 0; i < bokehCount; i += 1) {
      bokeh.push({
        x: Math.random(),
        y: Math.random(),
        r: rand(26, 64),
        a: rand(0.015, 0.045),
        tint: (Math.random() * COLORS.length) | 0,
        speed: rand(0.0009, 0.0022)
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
        if (backdrop) bctx.drawImage(backdrop, 0, 0);
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
    ctx.globalAlpha = 0.3;
    ctx.translate(W * 0.52 + drift, H * 0.42 + lift);
    ctx.rotate(t * 0.0045);
    ctx.drawImage(nebula, -size / 2, -size / 2, size, size);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16;
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
