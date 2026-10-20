/* ==========================================================================
   Eltes — heated embers on the empty chat screen.
   --------------------------------------------------------------------------
   A warm, orange counterpoint to the black shell. A soft glow follows the
   pointer, embers rise and flicker, and movement throws a few extra sparks.
   Nothing is downloaded: every particle is a cached radial-gradient sprite.

   • 30 fps, device pixel ratio capped at 1.75
   • only runs while the new-chat screen is visible and the tab is awake
   • one still frame under prefers-reduced-motion, or with reduced motion on
   • exposes window.EltesEmbers for the smoke tests
   ========================================================================== */

(function () {
  'use strict';

  const canvas = document.querySelector('canvas[data-embers]');
  if (!canvas) return;
  const host = canvas.parentElement;
  const empty = document.querySelector('#emptyState');

  let ctx = null;
  try {
    ctx = canvas.getContext && canvas.getContext('2d');
  } catch (error) {
    ctx = null;
  }
  if (!ctx || typeof ctx.createRadialGradient !== 'function') {
    if (host) host.classList.add('embers-off');
    return;
  }

  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const FPS_CAP = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 24 : 30;
  const DPR_CAP = 1.75;
  const EMBER_TINTS = [
    [255, 142, 64],
    [255, 176, 96],
    [255, 112, 44],
    [255, 206, 140]
  ];

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    running: false,
    frames: 0,
    embers: 0,
    reduced: !!(reduceQuery && reduceQuery.matches),
    energy: 0,
    onScreen: false
  };

  let spriteCache = null;
  let embers = [];
  let sparks = [];
  let streaks = [];
  let rafId = 0;
  let lastDraw = 0;
  let started = 0;
  let resizeTimer = 0;
  let spawnAcc = 0;
  let pointer = { x: -1, y: -1, tx: -1, ty: -1, active: false, energy: 0 };
  let last = { x: 0, y: 0, t: 0 };

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  function makeCanvas(width, height) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    return c;
  }

  /* One radial-gradient sprite per tint, drawn once and blitted per ember. */
  function buildSprites() {
    return EMBER_TINTS.map(([r, g, b]) => {
      const c = makeCanvas(64, 64);
      const s = c.getContext('2d');
      if (!s) return c;
      const grad = s.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.14, `rgba(${r}, ${g}, ${b}, 0.95)`);
      grad.addColorStop(0.42, `rgba(${r}, ${g}, ${b}, 0.3)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      s.fillStyle = grad;
      s.fillRect(0, 0, 64, 64);
      return c;
    });
  }

  function resize() {
    const rect = host ? host.getBoundingClientRect() : null;
    const width = Math.max(1, Math.round((rect && rect.width) || window.innerWidth || 960));
    const height = Math.max(1, Math.round((rect && rect.height) || window.innerHeight || 700));
    const dpr = clamp(window.devicePixelRatio || 1, 1, DPR_CAP);
    state.width = width;
    state.height = height;
    state.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!spriteCache) spriteCache = buildSprites();
  }

  function spawnEmber(x, y, burst) {
    const tint = (Math.random() * EMBER_TINTS.length) | 0;
    const speed = burst ? rand(26, 64) : rand(10, 30);
    embers.push({
      x,
      y,
      vx: rand(-9, 9),
      vy: -speed,
      r: burst ? rand(1.6, 4.2) : rand(1.2, 3.4),
      a: burst ? rand(0.5, 0.95) : rand(0.3, 0.7),
      life: 0,
      max: rand(1.4, 3.2),
      tint,
      sway: rand(0.6, 1.8),
      phase: rand(0, Math.PI * 2)
    });
    if (embers.length > 160) embers.splice(0, embers.length - 160);
    state.embers = embers.length;
  }

  function spawnSpark(x, y) {
    sparks.push({ x, y, vx: rand(-70, 70), vy: rand(-40, 30), life: 0, max: rand(0.35, 0.8), tint: 3 });
    if (sparks.length > 60) sparks.splice(0, sparks.length - 60);
  }

  /* Short, wavy updraughts near the pointer: the air above a fire. */
  function spawnStreak(x, y) {
    streaks.push({
      x,
      y,
      h: rand(18, 46),
      w: rand(0.7, 1.6),
      life: 0,
      max: rand(0.5, 1.1),
      amp: rand(2.4, 7),
      phase: rand(0, Math.PI * 2),
      drift: rand(-6, 6),
      a: rand(0.03, 0.1)
    });
    if (streaks.length > 90) streaks.splice(0, streaks.length - 90);
  }

  function ambient(dt) {
    // a slow, constant trickle so the screen breathes when the pointer is still
    spawnAcc += dt;
    const rate = pointer.active ? 9 : 4;
    while (spawnAcc > 1 / rate) {
      spawnAcc -= 1 / rate;
      const x = pointer.active && Math.random() < 0.55
        ? pointer.x + rand(-90, 90)
        : rand(0, state.width);
      const y = pointer.active && Math.random() < 0.55
        ? pointer.y + rand(-60, 60)
        : state.height - rand(0, state.height * 0.25);
      spawnEmber(x, y, false);
    }
  }

  function update(dt, t) {
    const next = [];
    for (let i = 0; i < embers.length; i += 1) {
      const e = embers[i];
      e.life += dt;
      if (e.life >= e.max) continue;
      e.x += (e.vx + Math.sin(t * e.sway + e.phase) * 12) * dt;
      e.y += e.vy * dt;
      e.vy += 6 * dt; // embers cool and slow as they rise
      next.push(e);
    }
    embers = next;

    const nextStreaks = [];
    for (let i = 0; i < streaks.length; i += 1) {
      const st = streaks[i];
      st.life += dt;
      if (st.life >= st.max) continue;
      st.y -= 34 * dt;
      st.x += st.drift * dt;
      nextStreaks.push(st);
    }
    streaks = nextStreaks;

    const nextSparks = [];
    for (let i = 0; i < sparks.length; i += 1) {
      const s = sparks[i];
      s.life += dt;
      if (s.life >= s.max) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 140 * dt;
      nextSparks.push(s);
    }
    sparks = nextSparks;
    state.embers = embers.length;
  }

  function drawEmber(e, t) {
    const p = e.life / e.max;
    const envelope = Math.sin(Math.PI * p);
    const flicker = 0.72 + 0.28 * Math.sin(t * 9 + e.phase * 3);
    const alpha = clamp(e.a * envelope * flicker, 0, 1);
    const size = e.r * 9 * (0.6 + envelope * 0.7);
    const sprite = spriteCache[e.tint];
    if (!sprite) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, e.x - size / 2, e.y - size / 2, size, size);
    ctx.globalAlpha = 1;
    // a hot needle at the centre of the larger embers
    if (e.r > 2.8) {
      ctx.fillStyle = `rgba(255, 224, 176, ${(alpha * 0.85).toFixed(3)})`;
      ctx.fillRect(e.x - 0.5, e.y - 0.5, 1.2, 1.2);
    }
  }

  function drawStreaks(t) {
    for (let i = 0; i < streaks.length; i += 1) {
      const st = streaks[i];
      const prog = Math.min(1, st.life / st.max);
      const fade = Math.sin(prog * Math.PI) * st.a;
      if (fade <= 0.003) continue;

      // a tapering heat wisp: bright at the foot, gone at the tip
      const tipY = st.y - st.h * (0.4 + prog * 0.6);
      const grad = ctx.createLinearGradient(st.x, st.y, st.x, tipY);
      grad.addColorStop(0, `rgba(255, 168, 96, ${(fade * 0.9).toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(255, 146, 78, ${(fade * 0.4).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 130, 60, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = st.w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const steps = 9;
      for (let k = 0; k <= steps; k += 1) {
        const p = k / steps;
        const x = st.x + Math.sin(t * 3.4 + st.phase + p * 3.1) * st.amp * p * p;
        const y = st.y - st.h * p;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  /* Eight sparks orbiting the pointer at different radii and speeds: the
     halo reads as heat rather than a plain cursor spotlight. */
  const ORBITS = Array.from({ length: 8 }, (_, i) => ({
    r: 30 + i * 9 + (i % 3) * 6,
    speed: (i % 2 ? 1 : -1) * (0.32 + (i % 4) * 0.11),
    phase: (i / 8) * Math.PI * 2,
    size: 9 + (i % 4) * 3,
    tint: i % 3
  }));

  function drawOrbits(t) {
    const energy = clamp(state.energy, 0.18, 1);
    const sprite = spriteCache;
    if (!sprite) return;
    for (let i = 0; i < ORBITS.length; i += 1) {
      const o = ORBITS[i];
      const ang = t * o.speed + o.phase;
      const wobble = 1 + Math.sin(t * 1.6 + o.phase) * 0.12;
      const x = pointer.x + Math.cos(ang) * o.r * wobble;
      const y = pointer.y + Math.sin(ang) * o.r * wobble * 0.72;
      const alpha = (0.3 + energy * 0.5) * (0.55 + 0.45 * Math.sin(t * 2.4 + o.phase * 2));
      ctx.globalAlpha = clamp(alpha, 0, 1);
      const size = o.size * (0.8 + energy * 0.5);
      ctx.drawImage(sprite[o.tint], x - size / 2, y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
  }

  function drawGlow(t) {
    if (pointer.x < 0) return;
    const energy = clamp(state.energy, 0, 1);
    const radius = 210 + energy * 120;
    const grad = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius);
    grad.addColorStop(0, `rgba(255, 146, 70, ${(0.15 + energy * 0.15).toFixed(3)})`);
    grad.addColorStop(0.38, `rgba(255, 110, 46, ${(0.075 + energy * 0.08).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 90, 30, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // two slow heat rings, breathing outward around the pointer
    for (let i = 0; i < 2; i += 1) {
      const phase = (t * 0.22 + i * 0.5) % 1;
      const r = 24 + phase * (54 + energy * 40);
      const alpha = (1 - phase) * (0.035 + energy * 0.09);
      ctx.strokeStyle = `rgba(255, 178, 108, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function draw(t, dt) {
    const W = state.width;
    const H = state.height;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    // a hearth at the foot of the pane, breathing with the pointer
    const energy = clamp(state.energy, 0, 1);
    const hearth = ctx.createRadialGradient(W * 0.5, H * 1.04, 0, W * 0.5, H * 1.04, Math.max(W * 0.55, 320));
    hearth.addColorStop(0, `rgba(255, 128, 52, ${(0.06 + energy * 0.08).toFixed(3)})`);
    hearth.addColorStop(0.5, `rgba(255, 100, 40, ${(0.025 + energy * 0.03).toFixed(3)})`);
    hearth.addColorStop(1, 'rgba(255, 88, 28, 0)');
    ctx.fillStyle = hearth;
    ctx.fillRect(0, 0, W, H);

    drawGlow(t);
    drawOrbits(t);
    drawStreaks(t);
    for (let i = 0; i < embers.length; i += 1) drawEmber(embers[i], t);
    for (let i = 0; i < sparks.length; i += 1) {
      const s = sparks[i];
      const p = s.life / s.max;
      ctx.globalAlpha = (1 - p) * 0.9;
      const size = 14 * (1 - p * 0.5);
      const sprite = spriteCache && spriteCache[s.tint];
      if (sprite) ctx.drawImage(sprite, s.x - size / 2, s.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    state.frames += 1;
  }

  function step(now) {
    if (!state.running) return;
    rafId = requestAnimationFrame(step);
    if (!started) started = now;
    if (now - lastDraw < 1000 / FPS_CAP) return;
    const dt = Math.min(0.06, (now - (lastDraw || now)) / 1000);
    lastDraw = now;
    const t = (now - started) / 1000;

    // ease the glow towards the pointer
    if (pointer.tx >= 0 && !state.reduced) {
      pointer.x += (pointer.tx - pointer.x) * 0.18;
      pointer.y += (pointer.ty - pointer.y) * 0.18;
    }
    state.energy += (pointer.energy - state.energy) * 0.08;
    pointer.energy *= 0.9;

    ambient(dt);
    update(dt, t);
    draw(t, dt);
  }

  function start() {
    if (state.running || state.reduced) return;
    if (document.body.classList.contains('reduce-motion')) return;
    state.running = true;
    started = 0;
    lastDraw = 0;
    rafId = requestAnimationFrame(step);
  }

  function stop() {
    state.running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function drawStill() {
    if (!spriteCache) spriteCache = buildSprites();
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.globalCompositeOperation = 'lighter';
    const cx = state.width * 0.5;
    const cy = state.height * 0.42;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(state.width, state.height) * 0.56);
    grad.addColorStop(0, 'rgba(255, 150, 78, 0.16)');
    grad.addColorStop(0.5, 'rgba(255, 110, 46, 0.06)');
    grad.addColorStop(1, 'rgba(255, 90, 30, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(state.width, state.height) * 0.56, 0, Math.PI * 2);
    ctx.fill();
    // a handful of settled embers, so the still frame still feels warm
    for (let i = 0; i < 18; i += 1) {
      const x = rand(state.width * 0.12, state.width * 0.88);
      const y = rand(state.height * 0.3, state.height * 0.85);
      ctx.globalAlpha = rand(0.2, 0.7);
      const size = rand(6, 18);
      const sprite = spriteCache[(Math.random() * spriteCache.length) | 0];
      if (sprite) ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    state.frames += 1;
  }

  /* -------------------------------- events -------------------------------- */

  function onPointerMove(event) {
    if (!host || state.reduced) return;
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < -20 || y < -20 || x > rect.width + 20 || y > rect.height + 20) {
      pointer.active = false;
      return;
    }
    const now = performance.now();
    const dt = last.t ? Math.max(16, now - last.t) : 16;
    const dist = Math.hypot(x - last.x, y - last.y);
    const speed = dist / dt; // px per ms
    pointer.tx = x;
    pointer.ty = y;
    if (pointer.x < 0) { pointer.x = x; pointer.y = y; }
    pointer.active = true;
    pointer.energy = clamp(pointer.energy + speed * 2.4, 0, 1);
    if (pointer.energy > 0.35 && Math.random() < 0.5) spawnSpark(x + rand(-6, 6), y + rand(-6, 6));
    if (speed > 0.35 && Math.random() < 0.7) spawnEmber(x, y, true);
    if (pointer.energy > 0.18 && Math.random() < 0.34) spawnStreak(x + rand(-46, 46), y + rand(-30, 30));
    last = { x, y, t: now };
  }

  function onPointerLeave() {
    pointer.active = false;
    pointer.energy = 0;
  }

  function onPointerDown(event) {
    onPointerMove(event);
    for (let i = 0; i < 8; i += 1) spawnSpark(pointer.x + rand(-10, 10), pointer.y + rand(-10, 10));
    for (let i = 0; i < 5; i += 1) spawnEmber(pointer.x + rand(-16, 16), pointer.y + rand(-16, 16), true);
    for (let i = 0; i < 4; i += 1) spawnStreak(pointer.x + rand(-30, 30), pointer.y + rand(-20, 20));
  }

  function onVisibility() {
    if (document.hidden) stop();
    else if (state.onScreen) start();
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (state.reduced || !state.running) drawStill();
    }, 150);
  }

  function onMotionChange() {
    state.reduced = !!(reduceQuery && reduceQuery.matches);
    if (state.reduced) {
      stop();
      drawStill();
    } else if (state.onScreen) {
      start();
    }
  }

  function settingReduced() {
    return document.body.classList.contains('reduce-motion');
  }

  function sync() {
    const visible = (!empty || !empty.hidden) && !settingReduced();
    state.onScreen = visible;
    canvas.classList.toggle('is-on', visible);
    if (visible && !document.hidden) start();
    else stop();
  }

  /* --------------------------------- boot --------------------------------- */

  if (empty) {
    new MutationObserver(sync).observe(empty, { attributes: true, attributeFilter: ['hidden'] });
  }
  // Settings → Conversation → Reduce motion toggles a class on <body>.
  if (document.body) {
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  resize();
  if (state.reduced) drawStill();
  sync();
  if (state.onScreen && !document.hidden) start();

  if (host) {
    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerdown', onPointerDown, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  if (reduceQuery && reduceQuery.addEventListener) reduceQuery.addEventListener('change', onMotionChange);

  window.EltesEmbers = {
    state,
    start,
    stop,
    sync,
    spawnEmber,
    refresh: () => { resize(); if (state.reduced) drawStill(); }
  };
})();
