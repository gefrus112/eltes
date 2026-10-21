/* ==========================================================================
   Eltes Reel — a browser-native video editor
   --------------------------------------------------------------------------
   No dependencies and no upload: media files stay in this tab, the edit is a
   plain JSON document, frames are drawn to a <canvas> and the export is
   recorded from that canvas with MediaRecorder (video + music).

   The pure part (model, timeline maths, effect strings, animation curves,
   text wrapping, export mime selection) is separated from the DOM so it can
   be tested with `node --test`; the UI is mounted by `EltesReel.mount()`.
   ========================================================================== */
window.EltesReel = (function () {
  'use strict';

  const VERSION = 1;
  const STORAGE_KEY = 'eltes.reel.v1';
  const SETTINGS_KEY = 'eltes.reel.settings.v1';

  /* ------------------------------- utilities ------------------------------ */

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const round = (value, step) => Math.round(value / step) * step;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  let counter = 0;
  function uid(prefix) {
    counter += 1;
    return `${prefix || 'c'}${Date.now().toString(36).slice(-4)}${counter.toString(36)}`;
  }

  /** 0:07.4 — timeline clock. */
  function formatTime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(total / 60);
    const rest = total - minutes * 60;
    const whole = Math.floor(rest);
    const tenths = Math.floor((rest - whole) * 10);
    return `${minutes}:${String(whole).padStart(2, '0')}.${tenths}`;
  }

  function parseClock(text) {
    const match = String(text || '').trim().match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  const sanitizeName = (name) => String(name || 'reel')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'reel';

  /* --------------------------------- model -------------------------------- */

  const FILTER_DEFAULTS = { brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0 };
  const OVERLAY_DEFAULTS = { vignette: 0, grain: 0, leak: 0, scanline: 0 };

  const EFFECT_PRESETS = [
    { id: 'none', name: 'None', filter: {}, overlay: {} },
    { id: 'cinema', name: 'Cinematic', filter: { contrast: 1.12, saturation: 1.06, brightness: 0.98 }, overlay: { vignette: 0.35, leak: 0.12 } },
    { id: 'vhs', name: 'VHS', filter: { saturation: 1.25, contrast: 1.05, hue: 3 }, overlay: { grain: 0.3, scanline: 0.22 } },
    { id: 'noir', name: 'Noir', filter: { grayscale: 1, contrast: 1.22, brightness: 1.02 }, overlay: { vignette: 0.5, grain: 0.12 } },
    { id: 'dream', name: 'Dream', filter: { blur: 1.2, brightness: 1.06, saturation: 1.12 }, overlay: { leak: 0.28 } },
    { id: 'neon', name: 'Neon', filter: { saturation: 1.5, contrast: 1.1, hue: -10 }, overlay: { vignette: 0.2, leak: 0.2 } },
    { id: 'warm', name: 'Golden', filter: { saturation: 1.15, hue: -6, brightness: 1.04 }, overlay: { leak: 0.4 } },
    { id: 'mono', name: 'Mono', filter: { grayscale: 1, contrast: 1.05 }, overlay: { vignette: 0.25 } }
  ];

  const ANIMATIONS = ['none', 'fade', 'rise', 'drop', 'pop', 'blur', 'type'];

  const TEXT_PRESETS = [
    {
      id: 'title',
      name: 'Title',
      sample: 'MAKE IT LOUD',
      text: { value: 'MAKE IT LOUD', font: 'Inter', weight: 800, size: 0.105, color: '#ffffff', uppercase: true, spacing: 0.02, align: 'center', shadow: 0.45, stroke: 0, bg: '' },
      x: 0.5, y: 0.44, animation: { in: 'pop', out: 'fade', inDur: 0.5, outDur: 0.4 }
    },
    {
      id: 'caption',
      name: 'Caption',
      sample: 'A caption that reads on any background',
      text: { value: 'A caption that reads on any background', font: 'Inter', weight: 600, size: 0.042, color: '#ffffff', uppercase: false, spacing: 0, align: 'center', shadow: 0, stroke: 0, bg: '#000000b3', radius: 0.012, padX: 0.03, padY: 0.012 },
      x: 0.5, y: 0.86, animation: { in: 'rise', out: 'fade', inDur: 0.3, outDur: 0.3 }
    },
    {
      id: 'lower',
      name: 'Lower third',
      sample: 'Eltes · Studio',
      text: { value: 'Eltes · Studio', font: 'Inter', weight: 600, size: 0.05, color: '#ffffff', uppercase: false, spacing: 0.01, align: 'left', shadow: 0.3, stroke: 0, bg: '#0b0d12cc', bar: '#39dca2' },
      x: 0.08, y: 0.76, animation: { in: 'rise', out: 'fade', inDur: 0.45, outDur: 0.3 }
    },
    {
      id: 'mono',
      name: 'Mono',
      sample: 'render(60fps)',
      text: { value: 'render(60fps)', font: 'JetBrains Mono', weight: 500, size: 0.038, color: '#39dca2', uppercase: false, spacing: 0, align: 'left', shadow: 0, stroke: 0, bg: '#04110dcc' },
      x: 0.06, y: 0.1, animation: { in: 'type', out: 'fade', inDur: 0.8, outDur: 0.25 }
    },
    {
      id: 'stack',
      name: 'Big number',
      sample: '01',
      text: { value: '01', font: 'Inter', weight: 900, size: 0.16, color: '#ffffff', uppercase: false, spacing: -0.02, align: 'center', shadow: 0.55, stroke: 0, bg: '' },
      x: 0.5, y: 0.5, animation: { in: 'blur', out: 'fade', inDur: 0.4, outDur: 0.3 }
    }
  ];

  function createProject(options) {
    const config = options || {};
    const project = {
      version: VERSION,
      name: sanitizeName(config.name || 'Untitled reel'),
      width: num(config.width, 1920),
      height: num(config.height, 1080),
      fps: num(config.fps, 30),
      background: config.background || '#000000',
      media: [],
      clips: [],
      music: []
    };
    return project;
  }

  function createClip(kind, patch) {
    const base = {
      id: uid(kind === 'text' ? 't' : 'c'),
      kind,
      name: kind === 'text' ? 'Text' : (kind === 'image' ? 'Image' : 'Clip'),
      mediaId: null,
      start: 0,
      duration: kind === 'text' ? 4 : 5,
      in: 0,
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotate: 0,
      opacity: 1,
      fit: 'cover',
      filter: Object.assign({}, FILTER_DEFAULTS),
      overlay: Object.assign({}, OVERLAY_DEFAULTS),
      animation: { in: 'fade', out: 'fade', inDur: 0.4, outDur: 0.35 },
      text: null
    };
    return Object.assign(base, patch || {});
  }

  function createTextClip(presetId, patch) {
    const preset = TEXT_PRESETS.find((entry) => entry.id === presetId) || TEXT_PRESETS[0];
    const clip = createClip('text', {
      name: preset.name,
      x: preset.x,
      y: preset.y,
      animation: Object.assign({}, preset.animation),
      text: Object.assign({ font: 'Inter', weight: 600, size: 0.05, color: '#ffffff', uppercase: false, spacing: 0, align: 'center', shadow: 0, stroke: 0, bg: '' }, preset.text)
    });
    return Object.assign(clip, patch || {});
  }

  function createMusic(mediaId, name, patch) {
    return Object.assign({
      id: uid('m'),
      mediaId,
      name: name || 'Music',
      start: 0,
      duration: 30,
      volume: 0.8,
      fadeIn: 0.8,
      fadeOut: 1.2
    }, patch || {});
  }

  const clipEnd = (clip) => (Number(clip.start) || 0) + (Number(clip.duration) || 0);
  const musicEnd = (track) => (Number(track.start) || 0) + (Number(track.duration) || 0);

  function projectLength(project) {
    let end = 0;
    for (const clip of project.clips) end = Math.max(end, clipEnd(clip));
    for (const track of project.music) end = Math.max(end, musicEnd(track));
    return Math.max(1, end);
  }

  function clipsAt(project, time) {
    return project.clips
      .filter((clip) => time >= clip.start && time < clipEnd(clip))
      .sort((a, b) => (a.kind === 'text' ? 1 : 0) - (b.kind === 'text' ? 1 : 0));
  }

  function findClip(project, id) {
    return project.clips.find((clip) => clip.id === id) || null;
  }

  function removeClip(project, id) {
    const before = project.clips.length;
    project.clips = project.clips.filter((clip) => clip.id !== id);
    return project.clips.length !== before;
  }

  /** Cut a clip in two at `time`. Returns the new clip, or null. */
  function splitClip(project, id, time) {
    const clip = findClip(project, id);
    if (!clip) return null;
    const offset = time - clip.start;
    if (offset <= 0.05 || offset >= clip.duration - 0.05) return null;
    const left = clip;
    const right = JSON.parse(JSON.stringify(clip));
    right.id = uid(clip.kind === 'text' ? 't' : 'c');
    right.start = time;
    right.duration = clip.duration - offset;
    right.in = (clip.in || 0) + offset;
    right.animation = Object.assign({}, clip.animation, { in: 'none', inDur: 0 });
    if (clip.kind === 'text') {
      right.animation.out = clip.animation.out;
      left.animation = Object.assign({}, clip.animation, { out: 'none', outDur: 0 });
    } else {
      left.animation = Object.assign({}, clip.animation, { out: 'none', outDur: 0 });
    }
    left.duration = offset;
    project.clips.push(right);
    return right;
  }

  /** Nearest interesting time within `threshold` seconds, or the time itself. */
  function snapTime(time, points, threshold, enabled) {
    if (enabled === false) return Math.max(0, time);
    let best = time;
    let bestDistance = Math.max(0, Number(threshold) || 0);
    for (const point of points) {
      const distance = Math.abs(point - time);
      if (distance <= bestDistance) { best = point; bestDistance = distance; }
    }
    return Math.max(0, best);
  }

  function snapPoints(project, ignoreId) {
    const points = [0];
    for (const clip of project.clips) {
      if (clip.id === ignoreId) continue;
      points.push(clip.start, clipEnd(clip));
    }
    for (const track of project.music) points.push(track.start, musicEnd(track));
    return points;
  }

  /* ------------------------------- rendering ------------------------------ */

  const FILTER_UNITS = { brightness: '', contrast: '', saturation: '', hue: 'deg', blur: 'px', sepia: '', grayscale: '', invert: '' };

  function effectFilter(filter) {
    const source = Object.assign({}, FILTER_DEFAULTS, filter || {});
    const parts = [];
    for (const key of Object.keys(FILTER_DEFAULTS)) {
      const value = num(source[key], FILTER_DEFAULTS[key]);
      if (value === FILTER_DEFAULTS[key]) continue;
      const unit = FILTER_UNITS[key] || '';
      parts.push(`${key}(${Number(value.toFixed(3))}${unit})`);
    }
    return parts.length ? parts.join(' ') : 'none';
  }

  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const easeIn = (x) => Math.pow(clamp(x, 0, 1), 3);
  const easeInOut = (x) => {
    const t = clamp(x, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  /**
   * Where a clip's entrance/exit animation is at `time`.
   * Offsets are a fraction of the frame height, so a 1080p and a 720p export
   * move the same distance relative to the picture.
   */
  function animationAt(clip, time) {
    const anim = clip.animation || {};
    const inDur = Math.max(0, num(anim.inDur, 0));
    const outDur = Math.max(0, num(anim.outDur, 0));
    const local = time - clip.start;
    const remaining = clipEnd(clip) - time;
    const state = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, reveal: 1 };

    const apply = (kind, progress) => {
      if (!kind || kind === 'none') return;
      const shown = easeOut(progress);
      if (kind === 'fade') state.alpha *= shown;
      else if (kind === 'rise') { state.alpha *= shown; state.dy += (1 - shown) * 0.055; }
      else if (kind === 'drop') { state.alpha *= shown; state.dy -= (1 - shown) * 0.055; }
      else if (kind === 'pop') { state.alpha *= shown; state.scale *= 0.86 + 0.14 * shown + 0.03 * Math.sin(shown * Math.PI); }
      else if (kind === 'blur') { state.alpha *= shown; state.blur += (1 - shown) * 14; }
      else if (kind === 'type') { state.reveal *= shown; }
    };

    if (inDur > 0 && local < inDur) apply(anim.in, easeInOut(local / inDur));
    if (outDur > 0 && remaining < outDur) apply(anim.out, easeInOut(remaining / outDur));
    state.alpha = clamp(state.alpha, 0, 1);
    state.offsets = { dx: state.dx, dy: state.dy };
    return state;
  }

  function fitRect(sw, sh, dw, dh, mode) {
    if (!sw || !sh) return { x: 0, y: 0, w: dw, h: dh };
    const scale = mode === 'contain'
      ? Math.min(dw / sw, dh / sh)
      : Math.max(dw / sw, dh / sh);
    const w = sw * scale;
    const h = sh * scale;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
  }

  /** Greedy word wrap; `measure` is injected so tests can run without a canvas. */
  function wrapText(text, maxWidth, measure) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${line} ${words[i]}`;
      if (measure(candidate) <= maxWidth) line = candidate;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
    return lines;
  }

  function hexToRgba(color, alpha) {
    const value = String(color || '#000000');
    const short = value.match(/^#([0-9a-f]{3})$/i);
    const full = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (short) {
      const [r, g, b] = short[1].split('').map((c) => parseInt(c + c, 16));
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (full) {
      const int = parseInt(full[1], 16);
      const r = (int >> 16) & 255; const g = (int >> 8) & 255; const b = int & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return value;
  }

  function grainPattern(ctx) {
    if (ctx.__reelGrain) return ctx.__reelGrain;
    const size = 96;
    const tile = document.createElement('canvas');
    tile.width = size; tile.height = size;
    const tctx = tile.getContext('2d');
    const image = tctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = 120 + Math.random() * 135;
      image.data[i] = value; image.data[i + 1] = value; image.data[i + 2] = value;
      image.data[i + 3] = 26 + Math.random() * 40;
    }
    tctx.putImageData(image, 0, 0);
    ctx.__reelGrain = ctx.createPattern(tile, 'repeat');
    return ctx.__reelGrain;
  }

  function drawOverlays(ctx, overlay, width, height, seed) {
    const o = Object.assign({}, OVERLAY_DEFAULTS, overlay || {});
    if (o.vignette > 0) {
      const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.72);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${Number(o.vignette.toFixed(3))})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
    if (o.leak > 0) {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, hexToRgba('#ff9a3d', Number((o.leak * 0.55).toFixed(3))));
      gradient.addColorStop(0.45, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, hexToRgba('#ff4d8d', Number((o.leak * 0.28).toFixed(3))));
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    if (o.scanline > 0) {
      ctx.save();
      ctx.globalAlpha = Number((o.scanline * 0.5).toFixed(3));
      ctx.fillStyle = '#000000';
      const step = Math.max(2, Math.round(height / 360));
      for (let y = (seed || 0) % step; y < height; y += step * 2) ctx.fillRect(0, y, width, step);
      ctx.restore();
    }
    if (o.grain > 0) {
      ctx.save();
      ctx.globalAlpha = Number((o.grain * 0.6).toFixed(3));
      const pattern = grainPattern(ctx);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }
  }

  function drawPlaceholder(ctx, clip, width, height, color) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, height * 0.002);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, width - ctx.lineWidth * 2, height - ctx.lineWidth * 2);
    ctx.fillStyle = color || 'rgba(255,255,255,0.55)';
    ctx.font = `${Math.round(height * 0.035)}px ${'Inter, system-ui, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Missing media · ${clip.name}`, width / 2, height / 2);
    ctx.restore();
  }

  function drawText(ctx, clip, width, height, state) {
    const spec = clip.text || {};
    const size = Math.max(8, num(spec.size, 0.05) * height);
    const family = spec.font === 'JetBrains Mono' ? "'JetBrains Mono', ui-monospace, monospace" : 'Inter, system-ui, sans-serif';
    const weight = num(spec.weight, 600);
    const spacing = num(spec.spacing, 0) * size;
    const text = String(spec.value || '');
    const shown = spec.uppercase ? text.toUpperCase() : text;
    const reveal = state && state.reveal != null ? state.reveal : 1;
    const visible = reveal >= 1 ? shown : shown.slice(0, Math.max(0, Math.floor(shown.length * reveal)));

    ctx.save();
    ctx.font = `${weight} ${size}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing.toFixed(2)}px`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = spec.align === 'left' ? 'left' : (spec.align === 'right' ? 'right' : 'center');

    const maxWidth = width * 0.86;
    const lines = wrapText(visible, maxWidth, (value) => ctx.measureText(value).width);
    const lineHeight = size * 1.16;
    const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
    const cx = clip.x * width;
    const cy = clip.y * height;
    const top = cy - blockHeight / 2 + lineHeight / 2;

    const padX = num(spec.padX, 0.02) * height;
    const padY = num(spec.padY, 0.01) * height;

    if (spec.bg) {
      let widest = 0;
      for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
      const boxW = widest + padX * 2;
      const boxH = blockHeight + padY * 2;
      const boxX = spec.align === 'left' ? cx - padX : (spec.align === 'right' ? cx - boxW + padX : cx - boxW / 2);
      const radius = Math.min(num(spec.radius, 0.01) * height, boxH / 2);
      ctx.save();
      ctx.fillStyle = spec.bg;
      ctx.beginPath();
      const rx = Math.min(radius, boxW / 2);
      if (ctx.roundRect) ctx.roundRect(boxX, cy - boxH / 2, boxW, boxH, rx);
      else ctx.rect(boxX, cy - boxH / 2, boxW, boxH);
      ctx.fill();
      if (spec.bar) {
        ctx.fillStyle = spec.bar;
        ctx.fillRect(boxX, cy - boxH / 2, Math.max(2, height * 0.006), boxH);
      }
      ctx.restore();
    }

    lines.forEach((line, index) => {
      const y = top + index * lineHeight;
      if (num(spec.shadow, 0) > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${num(spec.shadow, 0)})`;
        ctx.fillText(line, cx + size * 0.035, y + size * 0.035);
        ctx.restore();
      }
      if (num(spec.stroke, 0) > 0) {
        ctx.save();
        ctx.lineWidth = num(spec.stroke, 0) * size * 0.12;
        ctx.strokeStyle = spec.strokeColor || 'rgba(0,0,0,0.9)';
        ctx.lineJoin = 'round';
        ctx.strokeText(line, cx, y);
        ctx.restore();
      }
      ctx.fillStyle = spec.color || '#ffffff';
      ctx.fillText(line, cx, y);
    });
    ctx.restore();
  }

  /**
   * Draw one frame of the project.
   * `sources` maps mediaId → { el, kind }; anything missing is drawn as a
   * placeholder instead of failing the whole export.
   */
  function drawFrame(ctx, project, time, sources, options) {
    const opts = options || {};
    const width = project.width;
    const height = project.height;
    const map = sources || new Map();

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = project.background || '#000000';
    ctx.fillRect(0, 0, width, height);

    const clips = clipsAt(project, time);
    for (const clip of clips) {
      const state = animationAt(clip, time);
      if (state.alpha <= 0.001) continue;
      const alpha = state.alpha * clamp(num(clip.opacity, 1), 0, 1);

      if (clip.kind === 'text') {
        ctx.save();
        ctx.globalAlpha = alpha;
        const offsetY = state.dy * height;
        const offsetX = state.dx * width;
        ctx.translate(clip.x * width + offsetX, clip.y * height + offsetY);
        ctx.scale(state.scale, state.scale);
        ctx.rotate((num(clip.rotate, 0) * Math.PI) / 180);
        ctx.translate(-clip.x * width, -clip.y * height);
        drawText(ctx, clip, width, height, state);
        ctx.restore();
        continue;
      }

      const source = clip.mediaId ? map.get(clip.mediaId) : null;
      const el = source && source.el;
      const ready = el && (el.videoWidth || el.naturalWidth || el.width);
      if (!ready) {
        drawPlaceholder(ctx, clip, width, height);
        continue;
      }
      const sw = el.videoWidth || el.naturalWidth || el.width;
      const sh = el.videoHeight || el.naturalHeight || el.height;
      const box = fitRect(sw, sh, width, height, clip.fit);
      const scale = num(clip.scale, 1) * state.scale;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(width / 2 + state.dx * width, height / 2 + state.dy * height);
      ctx.rotate((num(clip.rotate, 0) * Math.PI) / 180);
      ctx.scale(scale, scale);
      const filter = effectFilter(clip.filter);
      if (filter !== 'none') {
        const blur = state.blur ? ` blur(${state.blur.toFixed(1)}px)` : '';
        if ('filter' in ctx) ctx.filter = `${filter}${blur}`;
      } else if (state.blur && 'filter' in ctx) {
        ctx.filter = `blur(${state.blur.toFixed(1)}px)`;
      }
      ctx.drawImage(el, box.x - width / 2, box.y - height / 2, box.w, box.h);
      ctx.restore();

      drawOverlays(ctx, clip.overlay, width, height, Math.floor(time * 12));
    }

    if (opts.safe) {
      ctx.save();
      ctx.strokeStyle = 'rgba(57,220,162,0.5)';
      ctx.setLineDash && ctx.setLineDash([height * 0.012, height * 0.012]);
      ctx.lineWidth = Math.max(1, height * 0.002);
      ctx.strokeRect(width * 0.05, height * 0.05, width * 0.9, height * 0.9);
      ctx.strokeRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
      ctx.restore();
    }
    ctx.restore();
  }

  /* -------------------------------- export -------------------------------- */

  const MIME_CANDIDATES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4'
  ];

  function pickMime(candidates, isSupported) {
    const list = candidates || MIME_CANDIDATES;
    const support = typeof isSupported === 'function'
      ? isSupported
      : (type) => (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
    for (const type of list) {
      try { if (support(type)) return type; } catch (error) { /* keep looking */ }
    }
    return '';
  }

  const extensionFor = (mime) => (/mp4/i.test(mime) ? 'mp4' : 'webm');

  /* ------------------------------ public API ------------------------------ */

  return {
    VERSION,
    STORAGE_KEY,
    SETTINGS_KEY,
    // model
    createProject,
    createClip,
    createTextClip,
    createMusic,
    clipEnd,
    musicEnd,
    projectLength,
    clipsAt,
    findClip,
    removeClip,
    splitClip,
    snapTime,
    snapPoints,
    // render
    effectFilter,
    animationAt,
    fitRect,
    wrapText,
    drawFrame,
    hexToRgba,
    easeOut,
    easeIn,
    easeInOut,
    // export
    MIME_CANDIDATES,
    pickMime,
    extensionFor,
    // misc
    uid,
    clamp,
    round,
    num,
    formatTime,
    parseClock,
    sanitizeName,
    FILTER_DEFAULTS,
    OVERLAY_DEFAULTS,
    EFFECT_PRESETS,
    TEXT_PRESETS,
    ANIMATIONS,
    // filled in by reel-ui.js
    mount: null
  };
})();
