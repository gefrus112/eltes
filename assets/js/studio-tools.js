/* ==========================================================================
   Other tools — the tab that holds everything Studio does that is not code
   --------------------------------------------------------------------------
   Reel (the video editor, mounted from reel.js + reel-ui.js), a frame grabber
   and a gradient palette. The screen is an overlay so the workspace keeps its
   files, preview and terminal underneath.
   ========================================================================== */
window.EltesTools = (function () {
  'use strict';

  const TOOLS = [
    {
      id: 'reel',
      icon: 'film',
      title: 'Reel — video editor',
      desc: 'Import clips, cut them on a timeline, animate text, stack looks and music, then record a real video file. Nothing is uploaded.'
    },
    {
      id: 'frame',
      icon: 'image',
      title: 'Frame grabber',
      desc: 'Scrub a video to the exact moment you want and save that frame as a PNG — or export a still from an image.'
    },
    {
      id: 'palette',
      icon: 'sparkles',
      title: 'Palette',
      desc: 'Mix up to four stops into a CSS gradient, preview it, and copy the declaration straight into your stylesheet.'
    }
  ];

  const TOOL_IDS = ['hub', 'reel', 'frame', 'palette'];

  /* Deep links: studio.html?tools=reel, ?tool=reel, or #reel / #tools=reel.
     The landing page and the workspace both use this to open Reel directly
     instead of leaving the editor three clicks inside Studio. */
  function toolFromLocation(search, hash) {
    let wanted = '';
    try {
      const params = new URLSearchParams(String(search || ''));
      wanted = String(params.get('tools') || params.get('tool') || '').trim().toLowerCase();
    } catch (error) {
      wanted = '';
    }
    if (!wanted) {
      const raw = String(hash || '').replace(/^#/, '').trim().toLowerCase();
      const match = raw.match(/^(?:tools=)?(hub|reel|frame|palette)$/);
      if (match) wanted = match[1];
    }
    return TOOL_IDS.includes(wanted) ? wanted : '';
  }

  let screen = null;
  let reel = null;
  let current = 'hub';
  let frame = { url: '', kind: '', el: null };
  let palette = { type: 'linear', angle: 135, stops: ['#39dca2', '#3d7bff', '#8b7cff'] };

  const icon = (name, size) => {
    try { return window.EltesIcons.icon(name, { size: size || 16 }); } catch (error) { return ''; }
  };
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function shell() {
    return `<header class="tools-top">
      <button type="button" class="tools-back" id="toolsBack">${icon('arrow-left', 14)} Studio</button>
      <span class="tools-title">Other tools</span>
      <nav class="tools-tabs" id="toolsTabs" aria-label="Tools">
        <button type="button" data-tool="hub" class="on">Overview</button>
        <button type="button" data-tool="reel">Reel</button>
        <button type="button" data-tool="frame">Frame</button>
        <button type="button" data-tool="palette">Palette</button>
      </nav>
      <span class="tools-space"></span>
      <span class="tools-hint">Runs in this tab · files stay on your machine</span>
    </header>
    <div class="tools-body">
      <section class="tools-pane" data-tool="hub">
        <div class="tool-grid">${TOOLS.map((tool) => `
          <button type="button" class="tool-card" data-tool="${tool.id}">
            <span class="tool-ico">${icon(tool.icon, 17)}</span>
            <strong>${esc(tool.title)}</strong>
            <p>${esc(tool.desc)}</p>
          </button>`).join('')}
        </div>
      </section>
      <section class="tools-pane" data-tool="reel" hidden><div class="reel-host" id="reelRoot"></div></section>
      <section class="tools-pane" data-tool="frame" hidden>${framePane()}</section>
      <section class="tools-pane" data-tool="palette" hidden>${palettePane()}</section>
    </div>`;
  }

  function framePane() {
    return `<div class="reel-simple">
      <h2>Frame grabber</h2>
      <p>Pick a video and scrub to the frame you want, or load an image and save it as a PNG. The file is decoded in the tab — nothing is uploaded.</p>
      <div class="panel">
        <label class="reel-btn" style="align-self:flex-start;cursor:pointer">
          ${icon('plus', 13)} Choose a video or image
          <input type="file" id="frameFile" accept="video/*,image/*" hidden />
        </label>
        <div id="frameStage" class="frame-stage" hidden>
          <video id="frameVideo" playsinline muted hidden></video>
          <img id="frameImage" alt="" hidden />
        </div>
        <label class="frame-scrub" id="frameScrubWrap" hidden>
          <span>Position</span>
          <input class="reel-input" type="range" id="frameRange" min="0" max="1000" value="0" />
          <output id="frameTime">0:00.0</output>
        </label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="reel-btn primary" id="frameGrab" disabled>${icon('download', 13)} Save PNG</button>
          <span class="reel-export-status" id="frameStatus"></span>
        </div>
      </div>
    </div>`;
  }

  function palettePane() {
    return `<div class="reel-simple">
      <h2>Palette</h2>
      <p>A gradient builder that gives you the CSS back. Useful for a hero, a card wash or a video background.</p>
      <div class="panel">
        <div class="palette-preview" id="palettePreview"></div>
        <div class="reel-row">
          <label>Type<select class="reel-input" id="paletteType">
            <option value="linear">linear</option>
            <option value="radial">radial</option>
            <option value="conic">conic</option>
          </select></label>
          <label>Angle<input class="reel-input" type="range" id="paletteAngle" min="0" max="360" step="1" value="135" /></label>
        </div>
        <div class="palette-stops" id="paletteStops"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="reel-btn" id="paletteAdd">${icon('plus', 13)} Add stop</button>
          <button type="button" class="reel-btn" id="paletteRandom">${icon('shuffle', 13)} Shuffle</button>
          <span class="grow"></span>
          <button type="button" class="reel-btn primary" id="paletteCopy">${icon('copy', 13)} Copy CSS</button>
        </div>
        <textarea class="reel-textarea" id="paletteCss" readonly rows="3"></textarea>
      </div>
    </div>`;
  }

  /* ------------------------------- navigation ----------------------------- */

  /* Two pinned tabs point at this overlay: "Video editor" opens Reel, "Other
     tools" opens the hub. Both light up according to where you are. */
  function syncTabs() {
    const hubTab = document.getElementById('btnTools');
    const reelTab = document.getElementById('btnReel');
    const isOpen = !!(screen && !screen.hidden);
    if (hubTab) hubTab.classList.toggle('on', isOpen && current !== 'reel');
    if (reelTab) reelTab.classList.toggle('on', isOpen && current === 'reel');
  }

  function show(tool) {
    current = tool;
    screen.querySelectorAll('.tools-tabs [data-tool]').forEach((node) => {
      node.classList.toggle('on', node.dataset.tool === tool);
    });
    screen.querySelectorAll('.tools-pane[data-tool]').forEach((node) => {
      node.hidden = node.dataset.tool !== tool;
    });
    if (tool === 'reel' && reel) reel.open();
    else if (reel) reel.close({ silent: true });
    syncTabs();
  }

  function open(tool) {
    screen.hidden = false;
    document.body.classList.add('tools-open');
    show(tool || 'hub');
  }

  function close() {
    if (reel) reel.close({ silent: true });
    screen.hidden = true;
    document.body.classList.remove('tools-open');
    syncTabs();
  }

  /* -------------------------------- palette ------------------------------- */

  function gradientCss() {
    const stops = palette.stops.filter(Boolean);
    if (palette.type === 'radial') return `radial-gradient(circle at 50% 40%, ${stops.join(', ')})`;
    if (palette.type === 'conic') return `conic-gradient(from ${palette.angle}deg, ${stops.join(', ')})`;
    return `linear-gradient(${palette.angle}deg, ${stops.join(', ')})`;
  }

  function renderPalette() {
    const preview = document.getElementById('palettePreview');
    const css = gradientCss();
    if (preview) preview.style.background = css;
    const out = document.getElementById('paletteCss');
    if (out) out.value = `background: ${css};`;
    const stops = document.getElementById('paletteStops');
    if (stops) {
      stops.innerHTML = palette.stops.map((color, index) => `<span class="palette-stop">
        <input type="color" class="reel-input" value="${esc(color)}" data-stop="${index}" aria-label="Stop ${index + 1}" />
        ${palette.stops.length > 2 ? `<button type="button" class="palette-del" data-del="${index}" aria-label="Remove stop">×</button>` : ''}
      </span>`).join('');
    }
    const angle = document.getElementById('paletteAngle');
    if (angle) angle.disabled = palette.type === 'radial';
    const angleRow = angle ? angle.closest('label') : null;
    if (angleRow) angleRow.style.opacity = palette.type === 'radial' ? '0.45' : '';
  }

  function bindPalette() {
    const pane = screen.querySelector('.tools-pane[data-tool="palette"]');
    pane.addEventListener('input', (event) => {
      const stop = event.target.closest('[data-stop]');
      if (stop) { palette.stops[Number(stop.dataset.stop)] = stop.value; renderPalette(); return; }
      if (event.target.id === 'paletteAngle') { palette.angle = Number(event.target.value); renderPalette(); }
    });
    pane.addEventListener('change', (event) => {
      if (event.target.id === 'paletteType') { palette.type = event.target.value; renderPalette(); }
    });
    pane.addEventListener('click', async (event) => {
      const del = event.target.closest('[data-del]');
      if (del) { palette.stops.splice(Number(del.dataset.del), 1); renderPalette(); return; }
      if (event.target.closest('#paletteAdd') && palette.stops.length < 4) {
        palette.stops.push(randomColor());
        renderPalette();
      } else if (event.target.closest('#paletteRandom')) {
        palette.stops = palette.stops.map(() => randomColor());
        renderPalette();
      } else if (event.target.closest('#paletteCopy')) {
        const button = event.target.closest('#paletteCopy');
        const label = button.lastChild;
        const flash = () => {
          if (!label || label.nodeType !== 3) return;
          const was = label.textContent;
          label.textContent = ' Copied';
          setTimeout(() => { if (label.isConnected) label.textContent = was; }, 1400);
        };
        try {
          await navigator.clipboard.writeText(`background: ${gradientCss()};`);
          flash();
        } catch (error) {
          const out = document.getElementById('paletteCss');
          if (out) { out.select(); document.execCommand && document.execCommand('copy'); }
        }
      }
    });
    renderPalette();
  }

  const randomColor = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;

  /* --------------------------------- frame -------------------------------- */

  function bindFrame() {
    const pane = screen.querySelector('.tools-pane[data-tool="frame"]');
    const input = pane.querySelector('#frameFile');
    const video = pane.querySelector('#frameVideo');
    const image = pane.querySelector('#frameImage');
    const stage = pane.querySelector('#frameStage');
    const scrubWrap = pane.querySelector('#frameScrubWrap');
    const range = pane.querySelector('#frameRange');
    const clock = pane.querySelector('#frameTime');
    const grab = pane.querySelector('#frameGrab');
    const status = pane.querySelector('#frameStatus');

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (frame.url) URL.revokeObjectURL(frame.url);
      frame = { url: URL.createObjectURL(file), kind: file.type.startsWith('video') ? 'video' : 'image', el: null, file };
      stage.hidden = false;
      status.textContent = '';
      if (frame.kind === 'video') {
        video.hidden = false;
        image.hidden = true;
        video.src = frame.url;
        frame.el = video;
        scrubWrap.hidden = false;
        grab.disabled = false;
        video.addEventListener('loadedmetadata', () => {
          range.value = '0';
          clock.textContent = window.EltesReel.formatTime(0);
        }, { once: true });
      } else {
        video.hidden = true;
        video.removeAttribute('src');
        image.hidden = false;
        image.src = frame.url;
        frame.el = image;
        scrubWrap.hidden = true;
        grab.disabled = false;
      }
    });

    video.addEventListener('seeked', () => {
      clock.textContent = window.EltesReel.formatTime(video.currentTime);
    });

    range.addEventListener('input', () => {
      if (!video.duration) return;
      video.currentTime = (Number(range.value) / 1000) * video.duration;
    });

    grab.addEventListener('click', () => {
      const source = frame.el;
      if (!source) return;
      const width = source.videoWidth || source.naturalWidth || source.width;
      const height = source.videoHeight || source.naturalHeight || source.height;
      if (!width || !height) { status.textContent = 'The file is still loading.'; return; }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(source, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) { status.textContent = 'Could not read that frame.'; return; }
        const name = (frame.file ? frame.file.name.replace(/\.[a-z0-9]+$/i, '') : 'frame');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name}-${Math.round((source.currentTime || 0) * 10) / 10}s.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        status.textContent = `Saved ${width}×${height} PNG.`;
      }, 'image/png');
    });
  }

  /* ---------------------------------- init -------------------------------- */

  function init() {
    const host = document.getElementById('toolsScreen');
    if (!host) return;
    screen = host;
    screen.className = 'tools-screen';
    screen.hidden = true;
    screen.innerHTML = shell();

    screen.addEventListener('click', (event) => {
      const go = event.target.closest('[data-tool]');
      if (go) {
        const tool = go.dataset.tool;
        show(tool);
        return;
      }
      if (event.target.closest('#toolsBack')) close();
    });

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-tools-open]');
      if (!trigger) return;
      const wanted = String(trigger.dataset.toolsOpen || '').trim().toLowerCase();
      open(TOOL_IDS.includes(wanted) ? wanted : 'hub');
    });

    document.addEventListener('keydown', (event) => {
      if (screen.hidden) return;
      if (event.key === 'Escape' && current !== 'reel') close();
    });

    const button = document.getElementById('btnTools');
    if (button) {
      button.addEventListener('click', () => {
        if (screen.hidden) open('hub');
        else if (current === 'hub' || current === 'frame' || current === 'palette') close();
        else show('hub');
      });
    }

    const reelButton = document.getElementById('btnReel');
    if (reelButton) {
      reelButton.addEventListener('click', () => {
        if (!screen.hidden && current === 'reel') close();
        else open('reel');
      });
    }

    if (window.EltesReelUI && window.EltesReelUI.mount) {
      reel = window.EltesReelUI.mount(document.getElementById('reelRoot'), {
        onExit: () => show('hub')
      });
    } else {
      document.getElementById('reelRoot').innerHTML = '<p style="padding:24px;color:#787a80">Reel could not load.</p>';
    }

    bindPalette();
    bindFrame();

    // A shared link opens straight into the tool it names.
    const requested = toolFromLocation(window.location.search, window.location.hash);
    if (requested) open(requested);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { open, close: () => close(), show, TOOLS, toolFromLocation };
})();
