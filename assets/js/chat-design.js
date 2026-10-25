/* CTab: local-only visual preferences. Never inject CSS or provider configuration. */
(function (root) {
  'use strict';
  const PRESETS = Object.freeze({
    eltes: { name: 'Eltes', note: 'Original black workspace', accent: '#c4c7cf', font: 'system', width: 900, size: 14, radius: 16, layout: 'bubbles' },
    claude: { name: 'Claude-inspired', note: 'Warm accents, editorial answers', accent: '#d9a487', font: 'serif', width: 820, size: 16, radius: 12, layout: 'flat' },
    gemini: { name: 'Gemini-inspired', note: 'Blue accents, rounded cards', accent: '#9cbcff', font: 'system', width: 960, size: 15, radius: 24, layout: 'cards' },
    chatgpt: { name: 'ChatGPT-inspired', note: 'Minimal, focused conversation', accent: '#8cd5b6', font: 'system', width: 820, size: 15, radius: 22, layout: 'bubbles' },
    kimi: { name: 'Kimi Code-inspired', note: 'Monospace, compact geometry', accent: '#b6eca4', font: 'mono', width: 1100, size: 14, radius: 4, layout: 'flat' },
    notebook: { name: 'Notebook', note: 'Reading-first, violet cards', accent: '#c8b7f2', font: 'serif', width: 760, size: 17, radius: 10, layout: 'cards' }
  });
  const FONTS = { system: 'system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, SFMono-Regular, Consolas, monospace' };
  function normalize(value) {
    const v = value && typeof value === 'object' ? value : {};
    const preset = Object.hasOwn(PRESETS, v.preset) ? v.preset : 'eltes';
    const base = PRESETS[preset];
    const number = (key, min, max) => typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.max(min, Math.min(max, Math.round(v[key]))) : base[key];
    return { preset, accent: /^#[\da-f]{6}$/i.test(v.accent) ? v.accent.toLowerCase() : base.accent,
      font: Object.hasOwn(FONTS, v.font) ? v.font : base.font,
      layout: ['bubbles', 'flat', 'cards'].includes(v.layout) ? v.layout : base.layout,
      width: number('width', 680, 1200), size: number('size', 13, 20), radius: number('radius', 0, 28) };
  }
  function luminance(hex) {
    const rgb = hex.match(/[\da-f]{2}/gi).map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  function variables(value) {
    const d = normalize(value);
    const rgb = d.accent.match(/[\da-f]{2}/gi).map(n => parseInt(n, 16)).join(', ');
    return {
      '--ctab-accent': d.accent, '--ctab-on-accent': luminance(d.accent) > .179 ? '#000000' : '#ffffff',
      '--ctab-font': FONTS[d.font], '--ctab-width': d.width + 'px', '--ctab-size': d.size + 'px', '--ctab-radius': d.radius + 'px',
      '--accent-rgb': rgb, '--accent-soft-rgb': rgb, '--accent-line-rgb': rgb,
      '--accent-grad-a': d.accent, '--accent-grad-b': d.accent,
      // Very dark custom accents still need readable labels on dark surfaces.
      '--accent-text': luminance(d.accent) < .25 ? '#e4e6eb' : d.accent
    };
  }
  function apply(value, body) {
    const d = normalize(value);
    body.dataset.chatDesign = d.preset; body.dataset.chatLayout = d.layout;
    Object.entries(variables(d)).forEach(([key, val]) => body.style.setProperty(key, val));
    return d;
  }
  const api = { PRESETS, normalize, variables, apply, luminance };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EltesChatDesign = api;
})(typeof window === 'object' ? window : globalThis);
