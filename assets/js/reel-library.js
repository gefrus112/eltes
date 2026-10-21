/* ==========================================================================
   Eltes Reel — the look library, the title library and the starter templates
   --------------------------------------------------------------------------
   Four hundred looks and two hundred titles, generated from ten families each
   so the names stay readable and the file stays small. Every entry is plain
   data: a look is a filter plus overlay recipe, a title is a text style plus an
   animation. `reel-ui.js` draws the cards, `reel.js` applies them.

   Nothing here loads a font, an image or a network request.
   ========================================================================== */
window.EltesReelLibrary = (function () {
  'use strict';

  const round = (value, places) => {
    const step = 10 ** (places || 3);
    return Math.round(value * step) / step;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /* ------------------------------ the looks ------------------------------- */

  const EFFECT_FAMILIES = [
    {
      id: 'cinema', name: 'Cinematic',
      base: { brightness: 0.97, contrast: 1.14, saturation: 1.04, sepia: 0.02 },
      tone: { vignette: 0.32, leak: 0.1, grain: 0.04, scanline: 0 },
      hue: [-7, 7]
    },
    {
      id: 'retro', name: 'Retro',
      base: { brightness: 1.04, contrast: 1.05, saturation: 0.9, sepia: 0.2 },
      tone: { vignette: 0.18, leak: 0.16, grain: 0.24, scanline: 0.12 },
      hue: [-14, 10]
    },
    {
      id: 'neon', name: 'Neon',
      base: { brightness: 1.01, contrast: 1.12, saturation: 1.52 },
      tone: { vignette: 0.14, leak: 0.26, grain: 0.03, scanline: 0 },
      hue: [-26, 26]
    },
    {
      id: 'film', name: 'Film',
      base: { brightness: 1.01, contrast: 1.08, saturation: 1.0, sepia: 0.07 },
      tone: { vignette: 0.22, leak: 0.08, grain: 0.3, scanline: 0 },
      hue: [-8, 8]
    },
    {
      id: 'golden', name: 'Golden',
      base: { brightness: 1.06, contrast: 1.02, saturation: 1.12, sepia: 0.14 },
      tone: { vignette: 0.16, leak: 0.32, grain: 0.05, scanline: 0 },
      hue: [-20, -2]
    },
    {
      id: 'arctic', name: 'Arctic',
      base: { brightness: 1.0, contrast: 1.07, saturation: 1.03 },
      tone: { vignette: 0.2, leak: 0.12, grain: 0.04, scanline: 0 },
      hue: [6, 24]
    },
    {
      id: 'mono', name: 'Mono',
      base: { brightness: 1.03, contrast: 1.1, saturation: 0, grayscale: 1 },
      tone: { vignette: 0.24, leak: 0, grain: 0.14, scanline: 0 },
      hue: [0, 0]
    },
    {
      id: 'dream', name: 'Dream',
      base: { brightness: 1.08, contrast: 0.94, saturation: 1.14, blur: 0.7 },
      tone: { vignette: 0.1, leak: 0.3, grain: 0.02, scanline: 0 },
      hue: [-10, 14]
    },
    {
      id: 'glitch', name: 'Glitch',
      base: { brightness: 0.98, contrast: 1.2, saturation: 1.38 },
      tone: { vignette: 0.12, leak: 0.06, grain: 0.2, scanline: 0.32 },
      hue: [-34, 34]
    },
    {
      id: 'vivid', name: 'Vivid',
      base: { brightness: 1.04, contrast: 1.16, saturation: 1.46 },
      tone: { vignette: 0.1, leak: 0.08, grain: 0.02, scanline: 0 },
      hue: [-6, 6]
    }
  ];

  const EFFECT_WORDS = [
    'Ember', 'Glacier', 'Static', 'Bloom', 'Drift', 'Haze', 'Copper', 'Tide', 'Pulse', 'Velvet',
    'Nitro', 'Sable', 'Aurora', 'Cinder', 'Mirage', 'Onyx', 'Saffron', 'Signal', 'Lumen', 'Prism',
    'Rust', 'Frost', 'Dusk', 'Halo', 'Vapor', 'Indigo', 'Marble', 'Cobalt', 'Amber', 'Echo',
    'Flare', 'Nova', 'Ripple', 'Solar', 'Surge', 'Tundra', 'Umber', 'Vista', 'Whisper', 'Zenith'
  ];

  function buildEffectLibrary() {
    const out = [];
    EFFECT_FAMILIES.forEach((family, familyIndex) => {
      for (let i = 0; i < EFFECT_WORDS.length; i += 1) {
        const t = EFFECT_WORDS.length === 1 ? 0 : i / (EFFECT_WORDS.length - 1);
        // A deterministic wobble so neighbouring cards never look identical.
        const wobble = Math.sin((i + 1) * (familyIndex + 2) * 0.7);
        const base = family.base;
        const tone = family.tone;
        const filter = {
          brightness: round(clamp((base.brightness || 1) + t * 0.14 + wobble * 0.03, 0.5, 1.7)),
          contrast: round(clamp((base.contrast || 1) + t * 0.2 + wobble * 0.04, 0.5, 1.85)),
          saturation: round(clamp((base.saturation === undefined ? 1 : base.saturation) + t * 0.22 + wobble * 0.05, 0, 2.2)),
          hue: Math.round((family.hue[0] + (family.hue[1] - family.hue[0]) * t) + wobble * 2),
          blur: round(clamp((base.blur || 0) + t * 0.5, 0, 3), 2),
          sepia: round(clamp((base.sepia || 0) + t * 0.1, 0, 0.6)),
          grayscale: base.grayscale || 0
        };
        const overlay = {
          vignette: round(clamp(tone.vignette + t * 0.22, 0, 1), 2),
          grain: round(clamp(tone.grain + t * 0.24, 0, 1), 2),
          leak: round(clamp(tone.leak + t * 0.2, 0, 1), 2),
          scanline: round(clamp(tone.scanline + (i % 7 === 0 ? 0.1 : 0), 0, 1), 2)
        };
        out.push({
          id: `${family.id}-${i + 1}`,
          name: `${family.name} ${EFFECT_WORDS[i]}`,
          family: family.id,
          familyName: family.name,
          filter,
          overlay
        });
      }
    });
    return out;
  }

  const EFFECT_LIBRARY = buildEffectLibrary();
  const effectById = (id) => EFFECT_LIBRARY.find((entry) => entry.id === id) || null;

  /* ------------------------------ the titles ------------------------------ */

  const TITLE_WORDS = [
    'Overdrive', 'Midnight', 'Sunset', 'Static', 'Bloom', 'Riot', 'Hush', 'Charge', 'Spark', 'Crown',
    'Drift', 'Signal', 'Echo', 'Prism', 'Flame', 'Frost', 'Velvet', 'Nitro', 'Orbit', 'Zenith'
  ];

  const TITLE_FAMILIES = [
    {
      id: 'bold', name: 'Bold', sample: 'MAKE IT LOUD', at: [0.5, 0.44],
      base: { font: 'Inter', weight: 800, size: 0.1, uppercase: true, spacing: 0.012, align: 'center', shadow: 0.42, stroke: 0, bg: '' },
      palette: ['#ffffff', '#dbe6ff', '#ffe9b0', '#c9f6e4']
    },
    {
      id: 'outline', name: 'Outline', sample: 'NO FILL', at: [0.5, 0.44],
      base: { font: 'Inter', weight: 900, size: 0.108, uppercase: true, spacing: 0.02, align: 'center', shadow: 0, stroke: 0.045, strokeColor: '#0b0d12' },
      palette: ['#ffffff', '#ffe14d', '#7cf0ff', '#ff9ecd']
    },
    {
      id: 'neon', name: 'Neon', sample: 'AFTER HOURS', at: [0.5, 0.46],
      base: { font: 'Inter', weight: 800, size: 0.094, uppercase: true, spacing: 0.03, align: 'center', shadow: 0.72, stroke: 0, bg: '' },
      palette: ['#39dca2', '#7cf0ff', '#ff5bd1', '#c9ff6b']
    },
    {
      id: 'retro', name: 'Retro', sample: 'SUMMER 84', at: [0.5, 0.45],
      base: { font: 'Inter', weight: 800, size: 0.098, uppercase: true, spacing: 0.024, align: 'center', shadow: 0.5, stroke: 0.014, strokeColor: '#3a1a12' },
      palette: ['#ffe2b8', '#ffb37a', '#ff8f6b', '#f4e3c1']
    },
    {
      id: 'clean', name: 'Clean', sample: 'A quiet caption', at: [0.5, 0.82],
      base: { font: 'Inter', weight: 500, size: 0.05, uppercase: false, spacing: 0.004, align: 'center', shadow: 0.2, stroke: 0, bg: '' },
      palette: ['#ffffff', '#eef2ff', '#d7f7ea', '#ffeccf']
    },
    {
      id: 'mono', name: 'Mono', sample: 'render(60fps)', at: [0.07, 0.12],
      base: { font: 'JetBrains Mono', weight: 500, size: 0.038, uppercase: false, spacing: 0, align: 'left', shadow: 0, stroke: 0, bg: '#04110dcc', radius: 0.01, padX: 0.016, padY: 0.008 },
      palette: ['#39dca2', '#7cf0ff', '#ffe14d', '#ffffff']
    },
    {
      id: 'badge', name: 'Badge', sample: 'NEW DROP', at: [0.08, 0.16],
      base: { font: 'Inter', weight: 700, size: 0.036, uppercase: true, spacing: 0.03, align: 'left', shadow: 0, stroke: 0, bg: '#39dca2', radius: 0.02, padX: 0.02, padY: 0.009 },
      palette: ['#06110d', '#06121d', '#1a0d16', '#141005']
    },
    {
      id: 'stack', name: 'Stack', sample: '01', at: [0.5, 0.5],
      base: { font: 'Inter', weight: 900, size: 0.15, uppercase: true, spacing: -0.03, align: 'center', shadow: 0.52, stroke: 0, bg: '' },
      palette: ['#ffffff', '#dbe6ff', '#39dca2', '#ffe14d']
    },
    {
      id: 'soft', name: 'Soft', sample: 'slow, then all at once', at: [0.5, 0.58],
      base: { font: 'Inter', weight: 500, size: 0.06, uppercase: false, spacing: 0.045, align: 'center', shadow: 0.34, stroke: 0, bg: '' },
      palette: ['#eef2ff', '#dbe9ff', '#e8ffe9', '#ffe8ef']
    },
    {
      id: 'impact', name: 'Impact', sample: 'BOOM', at: [0.5, 0.46],
      base: { font: 'Inter', weight: 900, size: 0.13, uppercase: true, spacing: -0.012, align: 'center', shadow: 0, stroke: 0.032, strokeColor: '#101010' },
      palette: ['#ffe14d', '#39dca2', '#ff5bd1', '#ffffff']
    }
  ];

  const TITLE_ANIMATIONS = ['pop', 'rise', 'drop', 'fade', 'blur', 'type'];

  function buildTitleLibrary() {
    const out = [];
    TITLE_FAMILIES.forEach((family, familyIndex) => {
      for (let i = 0; i < TITLE_WORDS.length; i += 1) {
        const color = family.palette[i % family.palette.length];
        const anim = TITLE_ANIMATIONS[(i + familyIndex) % TITLE_ANIMATIONS.length];
        const text = Object.assign({}, family.base, { value: family.sample, color });
        // Background badges need a readable foreground, so the family palette
        // supplies the ink and the fill comes from a fixed tone.
        if (family.id === 'badge') {
          text.color = color;
          text.bg = ['#39dca2', '#7cf0ff', '#ff5bd1', '#ffe14d'][i % 4];
        }
        out.push({
          id: `${family.id}-${i + 1}`,
          name: `${family.name} ${TITLE_WORDS[i]}`,
          family: family.id,
          familyName: family.name,
          sample: family.sample,
          text,
          x: family.at[0],
          y: family.at[1],
          animation: { in: anim, out: 'fade', inDur: anim === 'type' ? 0.9 : 0.42, outDur: 0.32 }
        });
      }
    });
    return out;
  }

  const TITLE_LIBRARY = buildTitleLibrary();
  const titleById = (id) => TITLE_LIBRARY.find((entry) => entry.id === id) || null;

  /* ----------------------------- the templates ---------------------------- */

  const THEMES = {
    midnight: '#05060a',
    ink: '#080a10',
    forest: '#04120e',
    plum: '#120a18',
    rust: '#160c08',
    slate: '#0b1016'
  };

  const slot = (R, start, duration, name) => R.createClip('image', {
    start,
    duration,
    name: name || 'Media slot',
    slot: true,
    mediaId: null,
    animation: { in: 'fade', out: 'fade', inDur: 0.3, outDur: 0.3 }
  });

  const title = (R, libraryId, start, duration, patch) => {
    const preset = titleById(libraryId) || TITLE_LIBRARY[0];
    return R.createTextClip(preset, Object.assign({ start, duration }, patch || {}));
  };

  const quote = (R, libraryId, start, duration, words, patch) => {
    const clip = title(R, libraryId, start, duration, patch);
    clip.text = Object.assign({}, clip.text, { value: words });
    return clip;
  };

  const TEMPLATES = [
    {
      id: 'title-card', name: 'Title card', tag: 'Starter', music: 'cinematic-rise',
      blurb: 'A big title, a subtitle underneath, a slow fade. 5 seconds.',
      background: THEMES.midnight, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'bold-1', 0.2, 4.6, 'YOUR TITLE HERE', { y: 0.44 }),
          quote(R, 'clean-3', 0.8, 4.0, 'A subtitle, a date or a credit', { y: 0.58 })
        ];
      }
    },
    {
      id: 'lyric', name: 'Lyric video', tag: 'Music', music: 'lofi-morning',
      blurb: 'Three typed lines over a dark bed — a lyric video you can drop clips behind.',
      background: THEMES.ink, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'soft-2', 0.2, 2.8, 'first line, kept quiet', { y: 0.46 }),
          quote(R, 'soft-9', 3.0, 2.8, 'second line, a little louder', { y: 0.5 }),
          quote(R, 'impact-6', 5.8, 3.0, 'THIRD LINE, ALL AT ONCE', { y: 0.46 })
        ];
      }
    },
    {
      id: 'vertical', name: 'Vertical 9:16', tag: 'Format', music: 'trap-bloom',
      blurb: 'A 1080 × 1920 canvas for Shorts and Reels, with a caption already placed.',
      background: THEMES.midnight, width: 1080, height: 1920,
      build(R) {
        return [
          slot(R, 0, 4, 'Vertical slot'),
          quote(R, 'clean-4', 0.3, 3.4, 'Add your clip to this slot', { y: 0.84 })
        ];
      }
    },
    {
      id: 'countdown', name: 'Countdown', tag: 'Starter', music: 'hype-drop',
      blurb: 'Three, two, one — one number per beat with a pop.',
      background: THEMES.ink, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'stack-1', 0.2, 0.9, '3', { y: 0.5 }),
          quote(R, 'stack-2', 1.1, 0.9, '2', { y: 0.5 }),
          quote(R, 'stack-3', 2.0, 0.9, '1', { y: 0.5 }),
          quote(R, 'impact-8', 2.9, 2.2, 'GO', { y: 0.5 })
        ];
      }
    },
    {
      id: 'quote', name: 'Quote card', tag: 'Starter', music: 'soft-piano',
      blurb: 'A centred quote with the attribution below it.',
      background: THEMES.plum, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'soft-5', 0.2, 4.4, '“The edit is the story you keep.”', { y: 0.44 }),
          quote(R, 'clean-7', 0.9, 3.7, '— someone worth quoting', { y: 0.6 })
        ];
      }
    },
    {
      id: 'promo', name: 'Sale promo', tag: 'Business', music: 'sunset-pop',
      blurb: 'A badge, a big number and a call to action.',
      background: THEMES.forest, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'badge-4', 0.2, 4.4, 'LIMITED TIME', { x: 0.08, y: 0.16 }),
          quote(R, 'impact-1', 0.4, 4.2, '40% OFF', { y: 0.5 }),
          quote(R, 'clean-2', 1.0, 3.6, 'ends sunday · use code ELTES', { y: 0.66 })
        ];
      }
    },
    {
      id: 'vlog-intro', name: 'Vlog intro', tag: 'Video', music: 'chill-steps',
      blurb: 'Two clips, a name card and a lower third — the shape of a weekly vlog.',
      background: THEMES.slate, width: 1920, height: 1080,
      build(R) {
        const a = slot(R, 0, 3, 'Intro clip');
        a.transition = { type: 'fade', duration: 0.6 };
        const b = slot(R, 3, 4, 'Second clip');
        b.transition = { type: 'slide', duration: 0.6 };
        return [
          a,
          b,
          quote(R, 'bold-4', 0.4, 2.4, 'EPISODE 12', { y: 0.4 }),
          quote(R, 'badge-9', 3.4, 3.4, 'THIS WEEK', { x: 0.08, y: 0.14 }),
          quote(R, 'clean-6', 3.6, 3.2, 'three days, one camera, no plan', { y: 0.82 })
        ];
      }
    },
    {
      id: 'travel', name: 'Travel montage', tag: 'Video', music: 'sunset-pop',
      blurb: 'Three slots with slides between them and a place name on each cut.',
      background: THEMES.rust, width: 1920, height: 1080,
      build(R) {
        const clips = [];
        ['CITY', 'COAST', 'HILLS'].forEach((label, index) => {
          const clip = slot(R, index * 3, 3, `${label} clip`);
          if (index > 0) clip.transition = { type: 'slide', duration: 0.7 };
          clips.push(clip);
          clips.push(quote(R, 'bold-3', index * 3 + 0.4, 2.4, label, { y: 0.2 }));
        });
        return clips;
      }
    },
    {
      id: 'before-after', name: 'Before / after', tag: 'Video', music: 'night-drive',
      blurb: 'Two slots joined by a wipe, with a label on each side.',
      background: THEMES.ink, width: 1920, height: 1080,
      build(R) {
        const second = slot(R, 3, 3, 'After');
        second.transition = { type: 'wipe', duration: 0.8 };
        return [
          slot(R, 0, 3, 'Before'),
          second,
          quote(R, 'badge-1', 0.2, 2.6, 'BEFORE', { x: 0.08, y: 0.14 }),
          quote(R, 'badge-2', 3.2, 2.6, 'AFTER', { x: 0.08, y: 0.14 })
        ];
      }
    },
    {
      id: 'product', name: 'Product spotlight', tag: 'Business', music: 'retro-funk',
      blurb: 'One slot, one price badge, one line of copy.',
      background: THEMES.slate, width: 1920, height: 1080,
      build(R) {
        return [
          slot(R, 0, 5, 'Product shot'),
          quote(R, 'impact-5', 0.4, 4.2, 'THE DROP', { y: 0.24 }),
          quote(R, 'badge-7', 0.6, 4.0, '$49', { x: 0.08, y: 0.74 }),
          quote(R, 'clean-8', 1.2, 3.4, 'free shipping this week', { y: 0.86 })
        ];
      }
    },
    {
      id: 'story', name: 'Story captions', tag: 'Format', music: 'soft-piano',
      blurb: 'A 9:16 story with three captions and a slot between them.',
      background: THEMES.plum, width: 1080, height: 1920,
      build(R) {
        return [
          slot(R, 0, 6, 'Story clip'),
          quote(R, 'clean-1', 0.4, 1.6, 'today I tried', { y: 0.3 }),
          quote(R, 'bold-6', 2.0, 1.6, 'SOMETHING NEW', { y: 0.34 }),
          quote(R, 'clean-5', 3.7, 2.0, 'and it worked', { y: 0.8 })
        ];
      }
    },
    {
      id: 'event', name: 'Event invite', tag: 'Business', music: 'epic-trailer',
      blurb: 'Date, place and a title that lands on the beat.',
      background: THEMES.midnight, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'badge-3', 0.3, 4.0, 'SAVE THE DATE', { x: 0.08, y: 0.14 }),
          quote(R, 'impact-3', 0.5, 3.8, 'FRIDAY NIGHT', { y: 0.44 }),
          quote(R, 'clean-10', 1.1, 3.2, '21:00 · the old warehouse', { y: 0.62 })
        ];
      }
    },
    {
      id: 'endcard', name: 'End card', tag: 'Starter', music: 'dream-waves',
      blurb: 'The last three seconds: a call to action and a handle.',
      background: THEMES.ink, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'bold-9', 0.2, 3.4, 'THANKS FOR WATCHING', { y: 0.42 }),
          quote(R, 'mono-2', 0.6, 3.0, '@yourhandle', { x: 0.5, y: 0.6 })
        ];
      }
    },
    {
      id: 'news', name: 'News ticker', tag: 'Business', music: 'night-drive',
      blurb: 'A headline, a mono ticker and a timestamp.',
      background: THEMES.slate, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'impact-2', 0.2, 4.4, 'BREAKING', { y: 0.3 }),
          quote(R, 'clean-7', 0.4, 4.2, 'the story, in one line', { y: 0.52 }),
          quote(R, 'mono-5', 0.8, 3.8, 'UPDATE 14:02 · ELTES', { x: 0.07, y: 0.86 })
        ];
      }
    },
    {
      id: 'gaming', name: 'Game clip', tag: 'Video', music: 'hype-drop',
      blurb: 'A vertical game clip with a killfeed badge and a shout.',
      background: THEMES.ink, width: 1080, height: 1920,
      build(R) {
        return [
          slot(R, 0, 6, 'Gameplay'),
          quote(R, 'mono-3', 0.4, 2.0, 'pentakill.exe', { x: 0.07, y: 0.12 }),
          quote(R, 'impact-7', 1.2, 2.4, 'CLUTCH', { y: 0.4 })
        ];
      }
    },
    {
      id: 'wedding', name: 'Wedding card', tag: 'Starter', music: 'soft-piano',
      blurb: 'Two names and a date in a soft serif-like setting.',
      background: THEMES.plum, width: 1920, height: 1080,
      build(R) {
        return [
          quote(R, 'soft-1', 0.3, 4.4, 'Ada & Charles', { y: 0.42 }),
          quote(R, 'clean-9', 0.9, 3.8, '12 · 06 · 2027', { y: 0.6 })
        ];
      }
    },
    {
      id: 'beat-drop', name: 'Beat drop', tag: 'Music', music: 'trap-bloom',
      blurb: 'Four half-second cuts that flash on the beat, then a title.',
      background: THEMES.ink, width: 1920, height: 1080,
      build(R) {
        const beats = [];
        for (let i = 0; i < 4; i += 1) {
          const clip = slot(R, i * 0.5, 0.5, `Beat ${i + 1}`);
          clip.transition = { type: 'flash', duration: 0.2 };
          beats.push(clip);
        }
        beats.push(quote(R, 'impact-4', 2.0, 3.0, 'DROP', { y: 0.48 }));
        return beats;
      }
    },
    {
      id: 'slideshow', name: 'Slideshow', tag: 'Video', music: 'chill-steps',
      blurb: 'Five stills, crossfaded, with a caption that changes each time.',
      background: THEMES.slate, width: 1920, height: 1080,
      build(R) {
        const clips = [];
        const captions = ['one', 'two', 'three', 'four', 'five'];
        for (let i = 0; i < 5; i += 1) {
          const clip = slot(R, i * 2.2, 2.2, `Photo ${i + 1}`);
          if (i > 0) clip.transition = { type: 'fade', duration: 0.5 };
          clip.motion = { type: 'zoom-in', amount: 0.08 };
          clips.push(clip);
          clips.push(quote(R, 'clean-2', i * 2.2 + 0.3, 1.6, captions[i], { y: 0.84 }));
        }
        return clips;
      }
    }
  ];

  const templateById = (id) => TEMPLATES.find((entry) => entry.id === id) || null;

  /** Build a template against the Reel API. Returns a project patch. */
  function buildTemplate(id, R) {
    const template = templateById(id);
    if (!template || !R) return null;
    const clips = template.build(R) || [];
    return {
      id: template.id,
      name: template.name,
      width: template.width,
      height: template.height,
      background: template.background,
      music: template.music || '',
      clips
    };
  }

  return {
    EFFECT_FAMILIES,
    EFFECT_LIBRARY,
    EFFECT_WORDS,
    effectById,
    TITLE_FAMILIES,
    TITLE_LIBRARY,
    TITLE_WORDS,
    titleById,
    TEMPLATES,
    templateById,
    buildTemplate,
    THEMES
  };
})();
