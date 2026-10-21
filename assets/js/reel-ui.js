/* ==========================================================================
   Eltes Reel — the editor UI
   --------------------------------------------------------------------------
   Builds the whole workspace inside `EltesReelUI.mount(root)`: media bin,
   canvas stage, inspector and a three-track timeline. All state lives in the
   project document from reel.js; this file only paints it and handles input.
   ========================================================================== */
window.EltesReelUI = (function () {
  'use strict';

  const R = () => window.EltesReel;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const RESOLUTIONS = [
    { id: '1080p', name: '1080p · 16:9', width: 1920, height: 1080 },
    { id: '720p', name: '720p · 16:9', width: 1280, height: 720 },
    { id: 'vertical', name: 'Vertical · 9:16', width: 1080, height: 1920 },
    { id: 'square', name: 'Square · 1:1', width: 1080, height: 1080 },
    { id: 'cinema', name: 'Cinema · 21:9', width: 1680, height: 720 }
  ];

  const DEFAULT_SETTINGS = { snap: true, safe: false, zoom: 1, quality: 8, showGrid: false };
  const LANE_LEFT = 54;

  let root = null;
  let el = {};
  let project = null;
  let sources = new Map();       // mediaId → { file, url, el, kind, buffer }
  let selectedId = null;
  let playhead = 0;
  let playing = false;
  let raf = 0;
  let lastTick = 0;
  let undoStack = [];
  let redoStack = [];
  let drag = null;
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let saveTimer = 0;
  let exporting = false;
  let cancelExport = false;
  let onExit = null;

  /* ------------------------------ persistence ----------------------------- */

  function loadProject() {
    try {
      const raw = localStorage.getItem(R().STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === R().VERSION) return parsed;
      }
    } catch (error) { /* a broken document should not block the editor */ }
    return R().createProject({});
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(R().SETTINGS_KEY);
      if (raw) settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (error) { /* defaults are fine */ }
  }

  function save(now) {
    clearTimeout(saveTimer);
    const write = () => {
      try {
        localStorage.setItem(R().STORAGE_KEY, JSON.stringify(project));
        flashSaved('saved');
      } catch (error) {
        flashSaved('storage full', true);
      }
    };
    if (now) write();
    else saveTimer = setTimeout(write, 500);
  }

  function flashSaved(text, warn) {
    if (!el.saved) return;
    el.saved.textContent = text;
    el.saved.classList.toggle('warn', !!warn);
    el.saved.classList.add('on');
    clearTimeout(flashSaved.timer);
    flashSaved.timer = setTimeout(() => el.saved.classList.remove('on'), 1400);
  }

  function persistSettings() {
    try { localStorage.setItem(R().SETTINGS_KEY, JSON.stringify(settings)); } catch (error) { /* ignore */ }
  }

  /* --------------------------------- undo --------------------------------- */

  function snapshot() {
    return JSON.stringify({ clips: project.clips, music: project.music, media: project.media, name: project.name });
  }

  function commit(mutator, options) {
    const before = snapshot();
    mutator();
    if (snapshot() === before) return false;
    undoStack.push(before);
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    afterChange(options);
    return true;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    apply(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    apply(redoStack.pop());
  }

  function apply(json) {
    const doc = JSON.parse(json);
    project.clips = doc.clips;
    project.music = doc.music;
    project.media = doc.media;
    project.name = doc.name;
    if (!R().findClip(project, selectedId)) selectedId = null;
    el.name.value = project.name;
    afterChange({ keepSelection: true });
  }

  function afterChange(options) {
    const opts = options || {};
    if (!opts.keepSelection) {
      if (selectedId && !R().findClip(project, selectedId)) selectedId = null;
    }
    save();
    renderAll();
  }

  /* --------------------------------- media -------------------------------- */

  const kindOf = (file) => {
    const type = (file && file.type) || '';
    const name = (file && file.name) || '';
    if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name)) return 'video';
    if (type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return 'audio';
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name)) return 'image';
    return '';
  };

  function bindSource(media, file) {
    const kind = kindOf(file);
    if (!kind) return null;
    const url = URL.createObjectURL(file);
    const record = { file, url, kind, el: null, buffer: null, duration: media.duration || 0 };

    if (kind === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.addEventListener('loadedmetadata', () => {
        record.duration = video.duration || 0;
        const entry = project.media.find((item) => item.id === media.id);
        if (entry && !entry.duration) entry.duration = record.duration;
        renderMediaList();
        renderTimeline();
      }, { once: true });
      record.el = video;
    } else if (kind === 'image') {
      const image = new Image();
      image.src = url;
      record.el = image;
    } else {
      const audio = document.createElement('audio');
      audio.src = url;
      audio.preload = 'auto';
      audio.addEventListener('loadedmetadata', () => {
        record.duration = audio.duration || 0;
        const entry = project.media.find((item) => item.id === media.id);
        if (entry && !entry.duration) entry.duration = record.duration;
        renderMediaList();
        renderTimeline();
      }, { once: true });
      record.el = audio;
    }
    sources.set(media.id, record);
    return record;
  }

  async function importFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    let added = 0;
    for (const file of list) {
      const kind = kindOf(file);
      if (!kind) { toast(`${file.name} is not a video, image or audio file`); continue; }
      // Re-link a media entry that survived a reload: same name, same kind.
      const orphan = project.media.find((item) => item.name === file.name && item.kind === kind && !sources.has(item.id));
      if (orphan) {
        bindSource(orphan, file);
        orphan.size = file.size;
        added += 1;
        continue;
      }
      const media = { id: R().uid('m'), name: file.name, kind, size: file.size, duration: 0 };
      project.media.push(media);
      const record = bindSource(media, file);
      if (record && kind === 'audio') {
        // Music goes straight onto the music track — that is what it is for.
        project.music.push(R().createMusic(media.id, file.name, { duration: 30 }));
      }
      added += 1;
    }
    if (added) {
      save();
      renderMediaList();
      renderTimeline();
      renderInspector();
      toast(`${added} file${added === 1 ? '' : 's'} ready`);
    }
  }

  function addMediaToTimeline(media) {
    if (!media) return;
    const source = sources.get(media.id);
    if (!source) { toast('Import the file again to use it'); return; }
    if (media.kind === 'audio') {
      commit(() => { project.music.push(R().createMusic(media.id, media.name, { start: playhead, duration: Math.max(2, source.duration || 30) })); });
      return;
    }
    const length = media.kind === 'video' ? Math.max(1, Math.min(source.duration || 5, 10)) : 5;
    commit(() => {
      const clip = R().createClip(media.kind, {
        mediaId: media.id,
        name: media.name.replace(/\.[a-z0-9]+$/i, ''),
        start: playhead,
        duration: length
      });
      project.clips.push(clip);
      selectedId = clip.id;
    });
  }

  function removeMedia(media) {
    if (!media) return;
    commit(() => {
      project.media = project.media.filter((item) => item.id !== media.id);
      project.clips = project.clips.filter((clip) => clip.mediaId !== media.id);
      project.music = project.music.filter((track) => track.mediaId !== media.id);
      const source = sources.get(media.id);
      if (source) { URL.revokeObjectURL(source.url); sources.delete(media.id); }
    });
  }

  function downloadMedia(media) {
    const source = sources.get(media.id);
    if (!source) { toast('Import the file again to download it'); return; }
    download(source.url, media.name);
  }

  /* --------------------------------- stage -------------------------------- */

  function canvasEl() { return el.canvas; }

  function draw(time) {
    const canvas = canvasEl();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    R().drawFrame(ctx, project, time, sources, { safe: settings.safe });
  }

  function syncVideos(time, shouldPlay) {
    for (const clip of R().clipsAt(project, time)) {
      if (clip.kind !== 'video') continue;
      const source = sources.get(clip.mediaId);
      const video = source && source.el;
      if (!video || video.readyState < 2) continue;
      const target = clamp((clip.in || 0) + (time - clip.start), 0, Math.max(0, (video.duration || 0) - 0.05));
      if (Math.abs(video.currentTime - target) > 0.22) {
        try { video.currentTime = target; } catch (error) { /* not seekable yet */ }
      }
      if (shouldPlay) {
        if (video.paused) video.play().catch(() => {});
      } else if (!video.paused) {
        video.pause();
      }
    }
    // Pause anything that fell out of the window.
    for (const [, source] of sources) {
      if (source.kind === 'video' && source.el && !videoActive(source, time)) {
        if (!source.el.paused) source.el.pause();
      }
    }
    syncMusic(time, shouldPlay);
  }

  function videoActive(source, time) {
    return project.clips.some((clip) => clip.mediaId && clip.kind === 'video'
      && sources.get(clip.mediaId) === source
      && time >= clip.start && time < R().clipEnd(clip));
  }

  function syncMusic(time, shouldPlay) {
    for (const track of project.music) {
      const source = sources.get(track.mediaId);
      const audio = source && source.kind === 'audio' ? source.el : null;
      if (!audio) continue;
      const active = time >= track.start && time < R().musicEnd(track);
      const target = clamp(time - track.start, 0, Math.max(0, (source.duration || audio.duration || 0) - 0.05));
      if (!active) {
        if (!audio.paused) audio.pause();
        continue;
      }
      if (Math.abs(audio.currentTime - target) > 0.3) {
        try { audio.currentTime = target; } catch (error) { /* ignore */ }
      }
      audio.volume = clamp(track.volume * musicFade(track, time), 0, 1);
      if (shouldPlay) { if (audio.paused) audio.play().catch(() => {}); }
      else if (!audio.paused) audio.pause();
    }
  }

  function musicFade(track, time) {
    const local = time - track.start;
    const remaining = R().musicEnd(track) - time;
    let gain = 1;
    if (track.fadeIn > 0 && local < track.fadeIn) gain *= clamp(local / track.fadeIn, 0, 1);
    if (track.fadeOut > 0 && remaining < track.fadeOut) gain *= clamp(remaining / track.fadeOut, 0, 1);
    return gain;
  }

  function seek(time, options) {
    playhead = clamp(time, 0, Math.max(0.01, R().projectLength(project)));
    syncVideos(playhead, playing && !(options && options.pauseAudio));
    draw(playhead);
    updateTransport();
    positionPlayhead();
  }

  function play() {
    if (playing) return;
    el.side.classList.remove('open');
    el.inspector.classList.remove('open');
    playing = true;
    lastTick = performance.now();
    el.playBtn.classList.add('on');
    el.playBtn.innerHTML = icon('pause', 15);
    syncVideos(playhead, true);
    const loop = (now) => {
      if (!playing) return;
      const delta = Math.min(0.25, (now - lastTick) / 1000);
      lastTick = now;
      const length = R().projectLength(project);
      playhead += delta;
      if (playhead >= length) {
        playhead = length;
        pause();
        draw(playhead);
        updateTransport();
        positionPlayhead();
        return;
      }
      syncVideos(playhead, true);
      draw(playhead);
      updateTransport();
      positionPlayhead();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    el.playBtn.classList.remove('on');
    el.playBtn.innerHTML = icon('play', 15);
    for (const [, source] of sources) {
      if (source.el && source.el.pause) source.el.pause();
    }
  }

  /* ------------------------------- rendering ------------------------------ */

  function icon(name, size) {
    try { return window.EltesIcons.icon(name, { size: size || 14 }); } catch (error) { return ''; }
  }

  function renderAll() {
    el.name.value = project.name;
    el.snap.checked = settings.snap;
    document.documentElement.style.setProperty('--reel-aspect', `${project.width} / ${project.height}`);
    el.canvas.width = project.width;
    el.canvas.height = project.height;
    draw(playhead);
    updateTransport();
    renderMediaList();
    renderTimeline();
    renderInspector();
    renderMusicList();
  }

  function updateTransport() {
    const length = R().projectLength(project);
    el.time.textContent = `${R().formatTime(playhead)} / ${R().formatTime(length)}`;
    el.scrub.value = String(clamp((playhead / Math.max(length, 0.01)) * 1000, 0, 1000));
    el.length.textContent = `${project.width}×${project.height} · ${project.fps} fps`;
  }

  function positionPlayhead() {
    if (!el.playhead) return;
    const pps = pxPerSec();
    const x = LANE_LEFT + playhead * pps;
    el.playhead.style.transform = `translateX(${x}px)`;
    if (playing) {
      const maxScroll = el.tracksScroll.scrollWidth - el.tracksScroll.clientWidth;
      const target = x - el.tracksScroll.clientWidth * 0.5;
      if (target > 0 && target < maxScroll) el.tracksScroll.scrollLeft = target;
    }
  }

  const pxPerSec = () => 44 * (settings.zoom || 1);

  function renderMediaList() {
    if (!el.mediaList) return;
    if (!project.media.length) {
      el.mediaList.innerHTML = `<p class="reel-hint">No media yet. Drop a video, image or audio file here — or press <strong>Import</strong>. Nothing is uploaded; files stay in this tab.</p>`;
      return;
    }
    el.mediaList.innerHTML = project.media.map((media) => {
      const source = sources.get(media.id);
      const ok = !!source;
      const seconds = source && source.duration ? R().formatTime(source.duration) : (media.duration ? R().formatTime(media.duration) : '—');
      return `<article class="reel-media${ok ? '' : ' missing'}" data-media="${media.id}">
        <span class="reel-media-thumb">${icon(media.kind === 'audio' ? 'volume-2' : (media.kind === 'image' ? 'image' : 'play'), 15)}</span>
        <span class="reel-media-main">
          <strong title="${escapeAttr(media.name)}">${escapeHtml(media.name)}</strong>
          <small>${media.kind} · ${seconds}${ok ? '' : ' · not loaded'}</small>
        </span>
        <span class="reel-media-acts">
          <button type="button" data-act="media-add" data-id="${media.id}" title="Add to the timeline at the playhead">${icon('plus', 13)}</button>
          <button type="button" data-act="media-download" data-id="${media.id}" title="Download the original file" ${ok ? '' : 'disabled'}>${icon('download', 13)}</button>
          <button type="button" data-act="media-remove" data-id="${media.id}" title="Remove from the project">${icon('trash-2', 13)}</button>
        </span>
      </article>`;
    }).join('');
  }

  function renderMusicList() {
    if (!el.musicList) return;
    if (!project.music.length) {
      el.musicList.innerHTML = '<p class="reel-hint">Import an audio file to lay a track under the edit. The export records it with the picture.</p>';
      return;
    }
    el.musicList.innerHTML = project.music.map((track) => {
      const source = sources.get(track.mediaId);
      const name = source ? source.file.name : (project.media.find((m) => m.id === track.mediaId) || {}).name || track.name;
      return `<article class="reel-track-item" data-track-id="${track.id}">
        <span class="reel-media-thumb">${icon('volume-2', 15)}</span>
        <span class="reel-media-main"><strong>${escapeHtml(name)}</strong>
          <small>starts ${R().formatTime(track.start)} · ${R().formatTime(track.duration)}</small></span>
        <span class="reel-media-acts">
          <button type="button" data-act="track-remove" data-id="${track.id}" title="Remove the track">${icon('trash-2', 13)}</button>
        </span>
      </article>`;
    }).join('');
  }

  function renderTimeline() {
    if (!el.tracks) return;
    const pps = pxPerSec();
    const length = R().projectLength(project);
    const width = Math.max(480, LANE_LEFT + (length + 4) * pps);
    el.tracks.style.width = `${width}px`;
    el.ruler.style.width = `${width}px`;
    el.ruler.innerHTML = rulerMarks(length + 4, pps);

    const lanes = {
      video: el.laneVideo,
      text: el.laneText,
      music: el.laneMusic
    };
    for (const [name, lane] of Object.entries(lanes)) {
      if (!lane) continue;
      lane.style.width = `${width}px`;
      if (name === 'music') {
        lane.innerHTML = project.music.map((track) => clipBlock({
          id: track.id,
          kind: 'audio',
          start: track.start,
          duration: track.duration,
          label: track.name,
          music: true
        }, pps)).join('');
      } else {
        const kind = name;
        lane.innerHTML = project.clips.filter((clip) => (kind === 'text' ? clip.kind === 'text' : clip.kind !== 'text'))
          .map((clip) => clipBlock(clip, pps)).join('');
      }
    }
    positionPlayhead();
  }

  function clipBlock(clip, pps) {
    const left = clip.start * pps;
    const width = Math.max(18, clip.duration * pps);
    const active = clip.id === selectedId ? ' on' : '';
    const kind = clip.kind === 'audio' ? 'audio' : clip.kind;
    const label = clip.kind === 'text' ? (clip.text && clip.text.value) || 'Text' : clip.label || clip.name;
    return `<div class="reel-clip ${kind}${active}" data-clip="${clip.id}" ${clip.music ? 'data-music="1"' : ''}
        style="left:${left}px;width:${width}px" tabindex="0" role="button" aria-label="${escapeAttr(label || 'clip')}">
      <span class="reel-clip-label">${escapeHtml(shortLabel(label))}</span>
      <span class="reel-handle l" data-handle="l"></span>
      <span class="reel-handle r" data-handle="r"></span>
    </div>`;
  }

  function shortLabel(value) {
    const text = String(value || '');
    return text.length > 26 ? `${text.slice(0, 25)}…` : text;
  }

  function rulerMarks(seconds, pps) {
    const step = pps < 30 ? 5 : (pps < 70 ? 2 : 1);
    let html = '';
    for (let second = 0; second <= seconds; second += step) {
      const left = LANE_LEFT + second * pps;
      html += `<span class="reel-tick" style="left:${left}px"><i></i>${R().formatTime(second)}</span>`;
    }
    return html;
  }

  /* ------------------------------- inspector ------------------------------ */

  function renderInspector() {
    if (!el.inspector) return;
    const clip = selectedId ? R().findClip(project, selectedId) : null;
    if (!clip) {
      el.inspector.innerHTML = `<div class="reel-empty-inspect">
        ${icon('mouse-pointer', 22)}
        <strong>Nothing selected</strong>
        <span>Pick a clip on the timeline. Drag it to move, drag its edges to trim, and use <kbd>S</kbd> to split at the playhead.</span>
      </div>`;
      return;
    }
    const parts = [];
    parts.push(`<div class="reel-inspect-head">
      <span class="reel-kind">${clip.kind}</span>
      <input class="reel-input" id="insName" value="${escapeAttr(clip.name)}" aria-label="Clip name" />
    </div>`);

    parts.push(`<div class="reel-group"><h5>Timing</h5>
      <div class="reel-row">
        <label>Start<input class="reel-input" type="number" min="0" step="0.1" id="insStart" value="${clip.start.toFixed(2)}" /></label>
        <label>Length<input class="reel-input" type="number" min="0.1" step="0.1" id="insDuration" value="${clip.duration.toFixed(2)}" /></label>
      </div>
      ${clip.kind === 'video' ? `<label class="reel-row single">Source in<input class="reel-input" type="number" min="0" step="0.1" id="insIn" value="${Number(clip.in || 0).toFixed(2)}" /></label>` : ''}
    </div>`);

    if (clip.kind === 'text') {
      const text = clip.text || {};
      parts.push(`<div class="reel-group"><h5>Text</h5>
        <textarea class="reel-textarea" id="insText" rows="3" placeholder="Say something">${escapeHtml(text.value || '')}</textarea>
        <div class="reel-row">
          <label>Font<select class="reel-input" id="insFont">
            ${['Inter', 'JetBrains Mono'].map((font) => `<option ${text.font === font ? 'selected' : ''}>${font}</option>`).join('')}
          </select></label>
          <label>Weight<select class="reel-input" id="insWeight">
            ${[400, 500, 600, 800, 900].map((w) => `<option value="${w}" ${Number(text.weight) === w ? 'selected' : ''}>${w}</option>`).join('')}
          </select></label>
        </div>
        <div class="reel-row">
          <label>Size<input class="reel-input" type="range" id="insSize" min="0.02" max="0.22" step="0.002" value="${Number(text.size) || 0.05}" /></label>
          <label>Colour<input class="reel-input" type="color" id="insColor" value="${toColor(text.color)}" /></label>
        </div>
        <div class="reel-row">
          <label>Align<select class="reel-input" id="insAlign">
            ${['left', 'center', 'right'].map((a) => `<option ${text.align === a ? 'selected' : ''}>${a}</option>`).join('')}
          </select></label>
          <label>Shadow<input class="reel-input" type="range" id="insShadow" min="0" max="1" step="0.05" value="${Number(text.shadow) || 0}" /></label>
        </div>
        <div class="reel-row">
          <label class="reel-check"><input type="checkbox" id="insUpper" ${text.uppercase ? 'checked' : ''} /> Uppercase</label>
          <label>Spacing<input class="reel-input" type="range" id="insSpacing" min="-0.03" max="0.16" step="0.005" value="${Number(text.spacing) || 0}" /></label>
        </div>
        <label class="reel-row single">Background
          <input class="reel-input" id="insBg" value="${escapeAttr(text.bg || '')}" placeholder="transparent" spellcheck="false" />
        </label>
      </div>`);
    } else {
      parts.push(`<div class="reel-group"><h5>Frame</h5>
        <div class="reel-row">
          <label>Fit<select class="reel-input" id="insFit">
            <option value="cover" ${clip.fit === 'cover' ? 'selected' : ''}>Cover</option>
            <option value="contain" ${clip.fit === 'contain' ? 'selected' : ''}>Contain</option>
          </select></label>
          <label>Opacity<input class="reel-input" type="range" id="insOpacity" min="0" max="1" step="0.01" value="${clip.opacity}" /></label>
        </div>
        <div class="reel-row">
          <label>Scale<input class="reel-input" type="range" id="insScale" min="0.2" max="2.5" step="0.01" value="${clip.scale}" /></label>
          <label>Rotate<input class="reel-input" type="range" id="insRotate" min="-180" max="180" step="1" value="${clip.rotate}" /></label>
        </div>
        <div class="reel-row">
          <label>X<input class="reel-input" type="range" id="insX" min="-0.5" max="1.5" step="0.01" value="${clip.x}" /></label>
          <label>Y<input class="reel-input" type="range" id="insY" min="-0.5" max="1.5" step="0.01" value="${clip.y}" /></label>
        </div>
      </div>`);

      const f = clip.filter || {};
      parts.push(`<div class="reel-group"><h5>Look</h5>
        <div class="reel-sliders">
          ${slider('brightness', 'Brightness', f.brightness, 0.4, 1.8, 0.01)}
          ${slider('contrast', 'Contrast', f.contrast, 0.4, 2, 0.01)}
          ${slider('saturation', 'Saturation', f.saturation, 0, 2.5, 0.01)}
          ${slider('hue', 'Hue', f.hue, -180, 180, 1)}
          ${slider('blur', 'Blur', f.blur, 0, 12, 0.1)}
          ${slider('grayscale', 'Black & white', f.grayscale, 0, 1, 0.01)}
          ${slider('sepia', 'Sepia', f.sepia, 0, 1, 0.01)}
        </div>
        <div class="reel-presets" id="insPresets">
          ${R().EFFECT_PRESETS.map((preset) => `<button type="button" class="reel-chip" data-fx="${preset.id}">${preset.name}</button>`).join('')}
        </div>
      </div>`);
      const o = clip.overlay || {};
      parts.push(`<div class="reel-group"><h5>Texture</h5>
        <div class="reel-sliders">
          ${slider('ov-vignette', 'Vignette', o.vignette, 0, 1, 0.01)}
          ${slider('ov-grain', 'Grain', o.grain, 0, 1, 0.01)}
          ${slider('ov-leak', 'Light leak', o.leak, 0, 1, 0.01)}
          ${slider('ov-scanline', 'Scanlines', o.scanline, 0, 1, 0.01)}
        </div>
      </div>`);
    }

    parts.push(`<div class="reel-group"><h5>Animation</h5>
      <div class="reel-row">
        <label>In<select class="reel-input" id="insAnimIn">
          ${R().ANIMATIONS.map((name) => `<option ${clip.animation.in === name ? 'selected' : ''}>${name}</option>`).join('')}
        </select></label>
        <label>Out<select class="reel-input" id="insAnimOut">
          ${R().ANIMATIONS.map((name) => `<option ${clip.animation.out === name ? 'selected' : ''}>${name}</option>`).join('')}
        </select></label>
      </div>
      <div class="reel-row">
        <label>In length<input class="reel-input" type="range" id="insInDur" min="0" max="2" step="0.05" value="${clip.animation.inDur}" /></label>
        <label>Out length<input class="reel-input" type="range" id="insOutDur" min="0" max="2" step="0.05" value="${clip.animation.outDur}" /></label>
      </div>
    </div>`);

    parts.push(`<div class="reel-inspect-foot">
      <button type="button" class="reel-btn" data-act="duplicate">${icon('copy', 13)} Duplicate</button>
      <button type="button" class="reel-btn" data-act="split">${icon('scissors', 13)} Split</button>
      <button type="button" class="reel-btn danger" data-act="clip-remove">${icon('trash-2', 13)} Delete</button>
    </div>`);

    el.inspector.innerHTML = parts.join('');
    bindInspector();
  }

  function slider(id, label, value, min, max, step) {
    const safe = Number.isFinite(Number(value)) ? Number(value) : min;
    return `<label class="reel-slider"><span>${label}</span>
      <input class="reel-input" type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${safe}" />
      <output>${Number(safe).toFixed(2)}</output></label>`;
  }

  function toColor(value) {
    const text = String(value || '');
    return /^#[0-9a-f]{6}$/i.test(text) ? text : '#ffffff';
  }

  function bindInspector() {
    const clip = selectedId ? R().findClip(project, selectedId) : null;
    if (!clip) return;
    const live = (selector, apply) => {
      const control = el.inspector.querySelector(selector);
      if (!control) return;
      control.addEventListener('input', () => {
        apply(control.type === 'checkbox' ? control.checked : (control.type === 'range' || control.type === 'number' ? Number(control.value) : control.value));
        draw(playhead);
        const output = control.parentElement.querySelector('output');
        if (output && control.type === 'range') output.textContent = Number(control.value).toFixed(2);
      });
    };
    const once = (selector, apply) => {
      const control = el.inspector.querySelector(selector);
      if (!control) return;
      control.addEventListener('change', () => {
        commit(() => apply(control.type === 'checkbox' ? control.checked : (control.type === 'range' || control.type === 'number' ? Number(control.value) : control.value)), { keepSelection: true });
      });
    };

    live('#insX', (value) => { clip.x = value; });
    live('#insY', (value) => { clip.y = value; });
    live('#insScale', (value) => { clip.scale = value; });
    live('#insRotate', (value) => { clip.rotate = value; });
    live('#insOpacity', (value) => { clip.opacity = value; });
    if (clip.kind !== 'text') {
      for (const key of ['brightness', 'contrast', 'saturation', 'hue', 'blur', 'grayscale', 'sepia']) {
        live(`#${key}`, (value) => { clip.filter[key] = value; });
      }
      live('#ov-vignette', (value) => { clip.overlay.vignette = value; });
      live('#ov-grain', (value) => { clip.overlay.grain = value; });
      live('#ov-leak', (value) => { clip.overlay.leak = value; });
      live('#ov-scanline', (value) => { clip.overlay.scanline = value; });
      const presets = el.inspector.querySelector('#insPresets');
      if (presets) {
        presets.addEventListener('click', (event) => {
          const button = event.target.closest('[data-fx]');
          if (!button) return;
          const preset = R().EFFECT_PRESETS.find((entry) => entry.id === button.dataset.fx);
          if (!preset) return;
          commit(() => {
            clip.filter = Object.assign({}, R().FILTER_DEFAULTS, preset.filter);
            clip.overlay = Object.assign({}, R().OVERLAY_DEFAULTS, preset.overlay);
          }, { keepSelection: true });
        });
      }
    } else {
      live('#insText', (value) => { clip.text.value = value; });
      live('#insColor', (value) => { clip.text.color = value; });
      live('#insShadow', (value) => { clip.text.shadow = value; });
      live('#insSpacing', (value) => { clip.text.spacing = value; });
      live('#insSize', (value) => { clip.text.size = value; });
      once('#insFont', (value) => { clip.text.font = value; });
      once('#insWeight', (value) => { clip.text.weight = Number(value); });
      once('#insAlign', (value) => { clip.text.align = value; });
      once('#insUpper', (value) => { clip.text.uppercase = value; });
      once('#insBg', (value) => { clip.text.bg = value; });
    }

    once('#insName', (value) => { clip.name = value || clip.name; });
    once('#insStart', (value) => { clip.start = Math.max(0, value); });
    once('#insDuration', (value) => { clip.duration = Math.max(0.1, value); });
    if (clip.kind === 'video') once('#insIn', (value) => { clip.in = Math.max(0, value); });
    once('#insFit', (value) => { clip.fit = value; });
    once('#insAnimIn', (value) => { clip.animation.in = value; });
    once('#insAnimOut', (value) => { clip.animation.out = value; });
    once('#insInDur', (value) => { clip.animation.inDur = value; });
    once('#insOutDur', (value) => { clip.animation.outDur = value; });
  }

  /* ------------------------------- timeline UI ---------------------------- */

  function timelineTime(event) {
    const rect = el.tracks.getBoundingClientRect();
    return Math.max(0, (event.clientX - rect.left - LANE_LEFT) / pxPerSec());
  }

  // Phones hide the side panes; picking a clip should bring its settings forward.
  function revealInspector() {
    if (!window.matchMedia || !window.matchMedia('(max-width: 980px)').matches) return;
    el.side.classList.remove('open');
    el.inspector.classList.add('open');
  }

  function bindTimeline() {
    el.tracksScroll.addEventListener('pointerdown', (event) => {
      const clipNode = event.target.closest('.reel-clip');
      const handle = event.target.closest('.reel-handle');
      if (clipNode) {
        const id = clipNode.dataset.clip;
        const isMusic = clipNode.dataset.music === '1';
        selectedId = isMusic ? null : id;
        if (isMusic) selectedId = null;
        const item = isMusic
          ? project.music.find((track) => track.id === id)
          : R().findClip(project, id);
        if (!item) return;
        el.inspector.dataset.music = isMusic ? id : '';
        drag = {
          type: handle ? (handle.dataset.handle === 'l' ? 'trim-start' : 'trim-end') : 'move',
          id,
          music: isMusic,
          startX: event.clientX,
          startItem: JSON.parse(JSON.stringify(item)),
          before: snapshot(),
          moved: false
        };
        if (isMusic) renderMusicInspector(item);
        else renderInspector();
        revealInspector();
        renderTimeline();
        event.preventDefault();
        return;
      }
      if (event.target.closest('.reel-lane') || event.target.closest('.reel-ruler')) {
        const time = timelineTime(event);
        pause();
        seek(R().snapTime(time, R().snapPoints(project), 6 / pxPerSec(), settings.snap));
      }
    });

    window.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = (event.clientX - drag.startX) / pxPerSec();
      if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
      const item = drag.music
        ? project.music.find((track) => track.id === drag.id)
        : R().findClip(project, drag.id);
      if (!item) return;
      const original = drag.startItem;
      const points = R().snapPoints(project, drag.music ? null : drag.id);
      if (drag.type === 'move') {
        item.start = R().snapTime(Math.max(0, original.start + dx), points, 6 / pxPerSec(), settings.snap);
      } else if (drag.type === 'trim-start') {
        const next = R().snapTime(Math.max(0, original.start + dx), points, 6 / pxPerSec(), settings.snap);
        const delta = next - original.start;
        const maxDelta = original.duration - 0.2;
        const applied = clamp(delta, -original.start, maxDelta);
        item.start = original.start + applied;
        item.duration = original.duration - applied;
        if (!drag.music && item.kind !== 'text') item.in = Math.max(0, (original.in || 0) + applied);
      } else {
        const next = R().snapTime(Math.max(original.start + 0.2, original.start + original.duration + dx), points, 6 / pxPerSec(), settings.snap);
        item.duration = Math.max(0.2, next - original.start);
      }
      draw(playhead);
      renderTimeline();
    });

    window.addEventListener('pointerup', () => {
      if (!drag) return;
      const moved = drag.moved;
      if (moved) {
        undoStack.push(drag.before);
        if (undoStack.length > 60) undoStack.shift();
        redoStack.length = 0;
        save();
        renderTimeline();
        renderInspector();
        renderMusicList();
      }
      drag = null;
    });
  }

  function renderMusicInspector(track) {
    if (!el.inspector) return;
    el.inspector.innerHTML = `<div class="reel-inspect-head"><span class="reel-kind">music</span><strong class="reel-music-title">${escapeHtml(track.name)}</strong></div>
      <div class="reel-group"><h5>Track</h5>
        <div class="reel-row">
          <label>Start<input class="reel-input" type="number" min="0" step="0.1" id="musStart" value="${track.start.toFixed(2)}" /></label>
          <label>Length<input class="reel-input" type="number" min="0.2" step="0.1" id="musDuration" value="${track.duration.toFixed(2)}" /></label>
        </div>
        <label class="reel-slider"><span>Volume</span><input class="reel-input" type="range" id="musVolume" min="0" max="1" step="0.01" value="${track.volume}" /><output>${track.volume.toFixed(2)}</output></label>
        <div class="reel-row">
          <label>Fade in<input class="reel-input" type="range" id="musFadeIn" min="0" max="4" step="0.1" value="${track.fadeIn}" /></label>
          <label>Fade out<input class="reel-input" type="range" id="musFadeOut" min="0" max="4" step="0.1" value="${track.fadeOut}" /></label>
        </div>
      </div>
      <div class="reel-inspect-foot"><button type="button" class="reel-btn danger" data-act="track-remove" data-id="${track.id}">${icon('trash-2', 13)} Remove track</button></div>`;
    for (const key of ['volume', 'fadeIn', 'fadeOut', 'start', 'duration']) {
      const control = el.inspector.querySelector(`#mus${key[0].toUpperCase()}${key.slice(1)}`);
      if (!control) continue;
      control.addEventListener('input', () => {
        track[key] = Number(control.value);
        const output = control.parentElement.querySelector('output');
        if (output) output.textContent = Number(control.value).toFixed(2);
        draw(playhead);
      });
      control.addEventListener('change', () => { save(); renderTimeline(); });
    }
  }

  /* ---------------------------------- panes ------------------------------- */

  function pane(name) {
    el.side.querySelectorAll('[data-pane]').forEach((node) => {
      node.classList.toggle('on', node.dataset.pane === name);
    });
    el.panes.forEach((node) => { node.hidden = node.dataset.pane !== name; });
  }

  function addText(presetId) {
    const preset = R().TEXT_PRESETS.find((entry) => entry.id === presetId) || R().TEXT_PRESETS[0];
    const clip = R().createTextClip(presetId, { start: playhead, duration: 4 });
    commit(() => { project.clips.push(clip); selectedId = clip.id; });
    pane('text');
  }

  /* --------------------------------- export ------------------------------- */

  function download(url, name) {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    download(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function openExport() {
    const mime = R().pickMime();
    el.exportMime.textContent = mime ? mime.replace('video/', '').replace(';', ' · ') : 'this browser cannot record video';
    el.exportName.value = R().sanitizeName(project.name);
    el.exportRes.innerHTML = `<option value="project">Project · ${project.width}×${project.height}</option>`
      + RESOLUTIONS.filter((res) => res.width !== project.width || res.height !== project.height)
        .map((res) => `<option value="${res.id}">${res.name}</option>`).join('');
    el.exportFps.value = String(project.fps);
    el.exportBar.style.width = '0%';
    el.exportStatus.textContent = '';
    el.exportDialog.showModal();
  }

  async function startExport() {
    if (exporting) return;
    const name = R().sanitizeName(el.exportName.value || project.name);
    const resId = el.exportRes.value;
    const res = RESOLUTIONS.find((entry) => entry.id === resId);
    const width = res ? res.width : project.width;
    const height = res ? res.height : project.height;
    const fps = Number(el.exportFps.value) || project.fps;
    const mime = R().pickMime();
    if (!mime) { el.exportStatus.textContent = 'This browser has no MediaRecorder video encoder. Try Chrome, Edge or Firefox.'; return; }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const duration = R().projectLength(project);
    const stream = canvas.captureStream(fps);

    // Music: decode every track once and schedule it into a stream destination.
    let audioCtx = null;
    let audioDest = null;
    const musicSources = [];
    const tracks = project.music.filter((track) => sources.has(track.mediaId));
    if (tracks.length) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();
        audioDest = audioCtx.createMediaStreamDestination();
        for (const track of tracks) {
          const source = sources.get(track.mediaId);
          if (!source.buffer) {
            const data = await source.file.arrayBuffer();
            source.buffer = await audioCtx.decodeAudioData(data.slice(0));
          }
          const buffer = source.buffer;
          const node = audioCtx.createBufferSource();
          node.buffer = buffer;
          const gain = audioCtx.createGain();
          node.connect(gain);
          gain.connect(audioDest);
          const startAt = audioCtx.currentTime + 0.25 + track.start;
          const playable = Math.min(track.duration, Math.max(0, buffer.duration));
          gain.gain.setValueAtTime(0.0001, startAt);
          if (track.fadeIn > 0) gain.gain.linearRampToValueAtTime(track.volume, startAt + Math.min(track.fadeIn, playable));
          else gain.gain.setValueAtTime(track.volume, startAt);
          const fadeOutStart = startAt + Math.max(0, playable - track.fadeOut);
          if (track.fadeOut > 0) {
            gain.gain.setValueAtTime(track.volume, fadeOutStart);
            gain.gain.linearRampToValueAtTime(0.0001, startAt + playable);
          }
          node.start(startAt, 0, playable);
          musicSources.push(node);
        }
        for (const audioTrack of audioDest.stream.getAudioTracks()) stream.addTrack(audioTrack);
      } catch (error) {
        el.exportStatus.textContent = 'Music could not be decoded; exporting picture only.';
      }
    }

    const options = {};
    if (mime) options.mimeType = mime;
    const bitrate = Math.round((Number(settings.quality) || 8) * 1000000);
    options.videoBitsPerSecond = bitrate;
    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (error) {
      el.exportStatus.textContent = `This browser refused ${mime}. Try a lower resolution.`;
      return;
    }
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

    exporting = true;
    cancelExport = false;
    el.exportGo.disabled = true;
    el.exportCancel.textContent = 'Cancel';
    el.exportStatus.textContent = `Recording ${width}×${height} at ${fps} fps…`;
    recorder.start(250);
    const started = performance.now() + 250;
    syncVideos(0, false);

    await new Promise((resolve) => {
      const step = (now) => {
        if (cancelExport) { resolve(); return; }
        const time = Math.max(0, (now - started) / 1000);
        if (time >= duration) { resolve(); return; }
        if (time >= 0) {
          // Play the video that is on screen and keep it aligned with the clock.
          for (const clip of project.clips) {
            if (clip.kind !== 'video') continue;
            const source = sources.get(clip.mediaId);
            const video = source && source.el;
            if (!video || video.readyState < 2) continue;
            const active = time >= clip.start && time < R().clipEnd(clip);
            if (!active) { if (!video.paused) video.pause(); continue; }
            if (video.paused) video.play().catch(() => {});
            const target = (clip.in || 0) + (time - clip.start);
            if (Math.abs(video.currentTime - target) > 0.25) {
              try { video.currentTime = target; } catch (error) { /* ignore */ }
            }
          }
          R().drawFrame(ctx, { ...project, width, height }, time, sources, { safe: false });
        }
        el.exportBar.style.width = `${Math.round((time / duration) * 100)}%`;
        el.exportStatus.textContent = `${R().formatTime(time)} of ${R().formatTime(duration)}`;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    recorder.stop();
    await stopped;
    for (const node of musicSources) { try { node.stop(); } catch (error) { /* already done */ } }
    if (audioCtx) await audioCtx.close();
    for (const source of sources.values()) if (source.el && source.el.pause) source.el.pause();
    exporting = false;
    el.exportGo.disabled = false;
    el.exportCancel.textContent = 'Close';

    if (cancelExport) { el.exportStatus.textContent = 'Cancelled — nothing was downloaded.'; return; }
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const extension = R().extensionFor(mime);
    downloadBlob(blob, `${name}.${extension}`);
    el.exportStatus.textContent = `Saved ${name}.${extension} · ${(blob.size / 1048576).toFixed(1)} MB`;
    el.exportBar.style.width = '100%';
    toast('Export ready');
  }

  function exportFrame() {
    const canvas = canvasEl();
    canvas.toBlob((blob) => {
      if (!blob) return toast('Could not read the frame');
      downloadBlob(blob, `${R().sanitizeName(project.name)}-${R().formatTime(playhead).replace(/[:.]/g, '-')}.png`);
    }, 'image/png');
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${R().sanitizeName(project.name)}.reel.json`);
  }

  /* ---------------------------------- DOM --------------------------------- */

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (value) => escapeHtml(value).replace(/"/g, '&quot;');

  function template() {
    return `<div class="reel">
      <header class="reel-top">
        <button type="button" class="reel-ghost" data-act="back" title="Back to Studio (Esc)">${icon('arrow-left', 15)}</button>
        <span class="reel-logo">${icon('film', 15)} Reel</span>
        <input class="reel-name" id="reelName" aria-label="Project name" maxlength="80" value="${escapeAttr(project.name)}" />
        <span class="reel-saved" id="reelSaved">saved</span>
        <span class="grow"></span>
        <button type="button" class="reel-ghost" data-act="undo" title="Undo (Ctrl+Z)">${icon('rotate-ccw', 15)}</button>
        <button type="button" class="reel-ghost" data-act="redo" title="Redo (Ctrl+Shift+Z)">${icon('redo-2', 15)}</button>
        <button type="button" class="reel-ghost reel-narrow" data-act="toggle-side" title="Media, text, effects and music">${icon('film', 15)}</button>
        <button type="button" class="reel-ghost reel-narrow" data-act="toggle-inspect" title="Clip settings">${icon('sliders-horizontal', 15)}</button>
        <button type="button" class="reel-ghost" data-act="settings" title="Project settings">${icon('settings', 15)}</button>
        <button type="button" class="reel-btn primary" data-act="export">${icon('download', 14)} <span class="reel-export-text">Export</span></button>
      </header>

      <div class="reel-body">
        <aside class="reel-side">
          <div class="reel-pane-tabs" role="tablist">
            <button type="button" data-pane="media" class="on" role="tab">Media</button>
            <button type="button" data-pane="text" role="tab">Text</button>
            <button type="button" data-pane="fx" role="tab">Effects</button>
            <button type="button" data-pane="music" role="tab">Music</button>
          </div>

          <section class="reel-pane" data-pane="media">
            <div class="reel-pane-head">
              <strong>Your media</strong>
              <span class="grow"></span>
              <button type="button" class="reel-btn small" data-act="import">${icon('plus', 13)} Import</button>
            </div>
            <div class="reel-media-list" id="reelMedia"></div>
            <p class="reel-note">Files are read from disk and kept in this tab. Nothing is uploaded.</p>
          </section>

          <section class="reel-pane" data-pane="text" hidden>
            <div class="reel-pane-head"><strong>Text</strong></div>
            <div class="reel-text-presets">
              ${R().TEXT_PRESETS.map((preset) => `<button type="button" class="reel-text-preset" data-text="${preset.id}">
                <span>${escapeHtml(preset.name)}</span><small>${escapeHtml(preset.sample)}</small></button>`).join('')}
            </div>
            <p class="reel-note">A text clip lands at the playhead. Drag it on the canvas to place it, then set its animation in the inspector.</p>
          </section>

          <section class="reel-pane" data-pane="fx" hidden>
            <div class="reel-pane-head"><strong>Looks</strong></div>
            <div class="reel-fx-grid">
              ${R().EFFECT_PRESETS.map((preset) => `<button type="button" class="reel-fx" data-fx="${preset.id}">
                <span class="reel-fx-swatch ${preset.id}"></span><span>${preset.name}</span></button>`).join('')}
            </div>
            <p class="reel-note">Select a video or image clip first; the look applies to that clip. Fine-tune it in the inspector.</p>
          </section>

          <section class="reel-pane" data-pane="music" hidden>
            <div class="reel-pane-head">
              <strong>Music</strong><span class="grow"></span>
              <button type="button" class="reel-btn small" data-act="import">${icon('plus', 13)} Add audio</button>
            </div>
            <div id="reelMusic"></div>
            <p class="reel-note">Volume and fades are written into the export.</p>
          </section>
        </aside>

        <main class="reel-stage">
          <div class="reel-canvas-wrap" id="reelDrop">
            <canvas id="reelCanvas" width="${project.width}" height="${project.height}" aria-label="Video preview"></canvas>
            <div class="reel-drop-hint">Drop a video, image or audio file</div>
          </div>
          <div class="reel-transport">
            <button type="button" class="reel-play" id="reelPlay" aria-label="Play">${icon('play', 15)}</button>
            <span class="reel-clock" id="reelTime">0:00.0 / 0:00.0</span>
            <input class="reel-scrub" id="reelScrub" type="range" min="0" max="1000" value="0" aria-label="Scrub" />
            <span class="reel-meta" id="reelMeta"></span>
            <button type="button" class="reel-ghost" data-act="frame" title="Save the current frame as a PNG">${icon('image', 14)} Frame</button>
          </div>
        </main>

        <aside class="reel-inspect" id="reelInspect"></aside>
      </div>

      <section class="reel-timeline">
        <div class="reel-tl-head">
          <button type="button" class="reel-btn small" data-act="split">${icon('scissors', 13)} Split</button>
          <button type="button" class="reel-btn small" data-act="duplicate">${icon('copy', 13)} Duplicate</button>
          <button type="button" class="reel-btn small danger" data-act="clip-remove">${icon('trash-2', 13)} Delete</button>
          <span class="grow"></span>
          <label class="reel-check"><input type="checkbox" id="reelSnap" checked /> Snap</label>
          <label class="reel-check"><input type="checkbox" id="reelSafe" /> Safe margins</label>
          <div class="reel-zoom">
            <button type="button" class="reel-ghost" data-act="zoom-out" aria-label="Zoom out">−</button>
            <span id="reelZoom">100%</span>
            <button type="button" class="reel-ghost" data-act="zoom-in" aria-label="Zoom in">+</button>
          </div>
        </div>
        <div class="reel-tracks-wrap" id="reelScroll">
          <div class="reel-tracks" id="reelTracks">
            <div class="reel-ruler" id="reelRuler"></div>
            <div class="reel-lane-row">
              <span class="reel-lane-name">Video</span>
              <div class="reel-lane" id="laneVideo" data-lane="video"></div>
            </div>
            <div class="reel-lane-row">
              <span class="reel-lane-name">Text</span>
              <div class="reel-lane" id="laneText" data-lane="text"></div>
            </div>
            <div class="reel-lane-row">
              <span class="reel-lane-name">Music</span>
              <div class="reel-lane" id="laneMusic" data-lane="music"></div>
            </div>
            <div class="reel-playhead" id="reelPlayhead"></div>
          </div>
        </div>
      </section>

      <input type="file" id="reelFile" accept="video/*,image/*,audio/*" multiple hidden />

      <dialog class="reel-dialog" id="reelExportDialog">
        <form method="dialog" class="reel-dialog-in">
          <h3>Export the edit</h3>
          <p class="reel-dialog-sub">Recorded from the canvas in this tab, at real time — keep the tab visible while it runs. Music tracks are mixed in; sound inside video clips is not.</p>
          <label class="reel-field">File name<input class="reel-input" id="reelExportName" /></label>
          <div class="reel-row">
            <label class="reel-field">Size<select class="reel-input" id="reelExportRes"></select></label>
            <label class="reel-field">FPS<select class="reel-input" id="reelExportFps">
              <option value="24">24</option><option value="30">30</option><option value="60">60</option>
            </select></label>
          </div>
          <p class="reel-export-mime" id="reelExportMime"></p>
          <div class="reel-progress"><span id="reelExportBar"></span></div>
          <p class="reel-export-status" id="reelExportStatus">Ready.</p>
          <div class="reel-dialog-foot">
            <button type="button" class="reel-btn" data-act="export-project">Project JSON</button>
            <span class="grow"></span>
            <button type="button" class="reel-btn" id="reelExportCancel" data-act="export-close">Close</button>
            <button type="button" class="reel-btn primary" id="reelExportGo" data-act="export-go">Start recording</button>
          </div>
        </form>
      </dialog>

      <dialog class="reel-dialog" id="reelSettingsDialog">
        <form method="dialog" class="reel-dialog-in">
          <h3>Project settings</h3>
          <p class="reel-dialog-sub">Changing the size re-frames every clip; text sizes are relative, so layouts survive.</p>
          <label class="reel-field">Project name<input class="reel-input" id="reelSetName" /></label>
          <label class="reel-field">Format<select class="reel-input" id="reelSetRes"></select></label>
          <div class="reel-row">
            <label class="reel-field">Background<input class="reel-input" type="color" id="reelSetBg" /></label>
            <label class="reel-field">Export quality (Mbps)<input class="reel-input" type="number" min="2" max="40" step="1" id="reelSetQuality" /></label>
          </div>
          <div class="reel-dialog-foot">
            <span class="reel-dialog-note">Saved in this browser.</span>
            <span class="grow"></span>
            <button type="button" class="reel-btn" data-act="settings-close">Done</button>
          </div>
        </form>
      </dialog>

      <div class="reel-toast" id="reelToast"></div>
    </div>`;
  }

  function toast(message) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.add('on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.remove('on'), 2200);
  }

  function cache() {
    const q = (selector) => root.querySelector(selector);
    el = {
      name: q('#reelName'),
      saved: q('#reelSaved'),
      canvas: q('#reelCanvas'),
      playBtn: q('#reelPlay'),
      time: q('#reelTime'),
      scrub: q('#reelScrub'),
      length: q('#reelMeta'),
      side: q('.reel-side'),
      panes: Array.from(root.querySelectorAll('.reel-pane')),
      mediaList: q('#reelMedia'),
      musicList: q('#reelMusic'),
      inspector: q('#reelInspect'),
      tracks: q('#reelTracks'),
      tracksScroll: q('#reelScroll'),
      ruler: q('#reelRuler'),
      laneVideo: q('#laneVideo'),
      laneText: q('#laneText'),
      laneMusic: q('#laneMusic'),
      playhead: q('#reelPlayhead'),
      snap: q('#reelSnap'),
      safe: q('#reelSafe'),
      zoom: q('#reelZoom'),
      file: q('#reelFile'),
      toast: q('#reelToast'),
      exportDialog: q('#reelExportDialog'),
      exportName: q('#reelExportName'),
      exportRes: q('#reelExportRes'),
      exportFps: q('#reelExportFps'),
      exportMime: q('#reelExportMime'),
      exportBar: q('#reelExportBar'),
      exportStatus: q('#reelExportStatus'),
      exportGo: q('#reelExportGo'),
      exportCancel: q('#reelExportCancel'),
      settingsDialog: q('#reelSettingsDialog'),
      setName: q('#reelSetName'),
      setRes: q('#reelSetRes'),
      setBg: q('#reelSetBg'),
      setQuality: q('#reelSetQuality')
    };
  }

  function bind() {
    el.name.addEventListener('input', () => {
      project.name = el.name.value;
      save();
    });

    root.addEventListener('click', (event) => {
      const paneButton = event.target.closest('[data-pane]');
      if (paneButton && paneButton.closest('.reel-pane-tabs')) { pane(paneButton.dataset.pane); return; }

      const textButton = event.target.closest('[data-text]');
      if (textButton) { addText(textButton.dataset.text); return; }

      const fxButton = event.target.closest('[data-fx]');
      if (fxButton) {
        const clip = selectedId ? R().findClip(project, selectedId) : null;
        if (!clip || clip.kind === 'text') { toast('Select a video or image clip first'); return; }
        const preset = R().EFFECT_PRESETS.find((entry) => entry.id === fxButton.dataset.fx);
        commit(() => {
          clip.filter = Object.assign({}, R().FILTER_DEFAULTS, preset.filter);
          clip.overlay = Object.assign({}, R().OVERLAY_DEFAULTS, preset.overlay);
        }, { keepSelection: true });
        renderInspector();
        return;
      }

      const mediaButton = event.target.closest('[data-act^="media-"]');
      if (mediaButton) {
        const media = project.media.find((item) => item.id === mediaButton.dataset.id);
        if (!media) return;
        if (mediaButton.dataset.act === 'media-add') addMediaToTimeline(media);
        else if (mediaButton.dataset.act === 'media-download') downloadMedia(media);
        else if (mediaButton.dataset.act === 'media-remove') removeMedia(media);
        return;
      }

      const action = event.target.closest('[data-act]');
      if (!action) return;
      const act = action.dataset.act;
      if (act === 'import') el.file.click();
      else if (act === 'back') close();
      else if (act === 'undo') undo();
      else if (act === 'redo') redo();
      else if (act === 'split') splitSelected();
      else if (act === 'duplicate') duplicateSelected();
      else if (act === 'clip-remove') deleteSelected();
      else if (act === 'track-remove') {
        commit(() => { project.music = project.music.filter((track) => track.id !== action.dataset.id); });
      } else if (act === 'zoom-in') { settings.zoom = clamp(settings.zoom * 1.25, 0.25, 4); persistSettings(); el.zoom.textContent = `${Math.round(settings.zoom * 100)}%`; renderTimeline(); }
      else if (act === 'zoom-out') { settings.zoom = clamp(settings.zoom / 1.25, 0.25, 4); persistSettings(); el.zoom.textContent = `${Math.round(settings.zoom * 100)}%`; renderTimeline(); }
      else if (act === 'toggle-side') {
        el.side.classList.toggle('open');
        el.inspector.classList.remove('open');
      }
      else if (act === 'toggle-inspect') {
        el.side.classList.remove('open');
        el.inspector.classList.toggle('open');
      }
      else if (act === 'frame') exportFrame();
      else if (act === 'export') openExport();
      else if (act === 'export-close') {
        if (exporting) { cancelExport = true; el.exportStatus.textContent = 'Stopping…'; }
        else el.exportDialog.close();
      }
      else if (act === 'export-go') startExport();
      else if (act === 'export-project') exportProject();
      else if (act === 'settings') openSettings();
      else if (act === 'settings-close') { applySettings(); el.settingsDialog.close(); }
    });

    el.playBtn.addEventListener('click', () => (playing ? pause() : play()));

    el.scrub.addEventListener('input', () => {
      pause();
      const length = R().projectLength(project);
      seek((Number(el.scrub.value) / 1000) * length);
    });

    el.snap.addEventListener('change', () => { settings.snap = el.snap.checked; persistSettings(); });
    el.safe.addEventListener('change', () => { settings.safe = el.safe.checked; persistSettings(); draw(playhead); });

    el.file.addEventListener('change', () => {
      importFiles(el.file.files);
      el.file.value = '';
    });

    const drop = root.querySelector('#reelDrop');
    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('over');
      if (event.dataTransfer && event.dataTransfer.files) importFiles(event.dataTransfer.files);
    });

    // drag a text clip on the canvas to position it
    el.canvas.addEventListener('pointerdown', (event) => {
      el.side.classList.remove('open');
      el.inspector.classList.remove('open');
      const clip = selectedId ? R().findClip(project, selectedId) : null;
      if (!clip) return;
      const rect = el.canvas.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { x: clip.x, y: clip.y };
      const move = (moveEvent) => {
        clip.x = clamp(origin.x + (moveEvent.clientX - startX) / rect.width, -0.2, 1.2);
        clip.y = clamp(origin.y + (moveEvent.clientY - startY) / rect.height, -0.2, 1.2);
        draw(playhead);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        save();
        renderInspector();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      event.preventDefault();
    });

    window.addEventListener('keydown', onKey);
    bindTimeline();
  }

  function onKey(event) {
    if (!root || root.hidden) return;
    if (event.target instanceof Element && event.target.matches('input, textarea, select')) return;
    // Dialogs keep their own keys (Esc closes them, not the editor).
    if ((el.exportDialog && el.exportDialog.open) || (el.settingsDialog && el.settingsDialog.open)) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if (event.key === ' ') {
      event.preventDefault();
      playing ? pause() : play();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      pause();
      seek(playhead - (event.shiftKey ? 5 : 0.1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      pause();
      seek(playhead + (event.shiftKey ? 5 : 0.1));
    } else if (event.key === 's' || event.key === 'S') {
      splitSelected();
    } else if (event.key === 't' || event.key === 'T') {
      addText('title');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelected();
    } else if (event.key === 'Escape') {
      close();
    } else if (event.key === 'Home') {
      seek(0);
    } else if (event.key === 'End') {
      seek(R().projectLength(project));
    }
  }

  function splitSelected() {
    if (!selectedId) return toast('Select a clip to split');
    const clip = R().findClip(project, selectedId);
    if (!clip) return;
    const time = clamp(playhead, clip.start + 0.1, R().clipEnd(clip) - 0.1);
    commit(() => {
      const right = R().splitClip(project, selectedId, time);
      if (right) selectedId = right.id;
      else toast('Move the playhead inside the clip first');
    });
  }

  function duplicateSelected() {
    const clip = selectedId ? R().findClip(project, selectedId) : null;
    if (!clip) return toast('Select a clip first');
    commit(() => {
      const copy = JSON.parse(JSON.stringify(clip));
      copy.id = R().uid(copy.kind === 'text' ? 't' : 'c');
      copy.start = R().clipEnd(clip) + 0.1;
      project.clips.push(copy);
      selectedId = copy.id;
    });
  }

  function deleteSelected() {
    const clip = selectedId ? R().findClip(project, selectedId) : null;
    if (!clip) return;
    commit(() => {
      R().removeClip(project, clip.id);
      selectedId = null;
    });
  }

  function openSettings() {
    el.setName.value = project.name;
    el.setRes.innerHTML = RESOLUTIONS.map((res) => `<option value="${res.id}" ${res.width === project.width && res.height === project.height ? 'selected' : ''}>${res.name}</option>`).join('');
    el.setBg.value = toColor(project.background);
    el.setQuality.value = String(settings.quality);
    el.settingsDialog.showModal();
  }

  function applySettings() {
    const name = R().sanitizeName(el.setName.value || project.name);
    const res = RESOLUTIONS.find((entry) => entry.id === el.setRes.value);
    commit(() => {
      project.name = name;
      if (res) { project.width = res.width; project.height = res.height; }
      project.background = el.setBg.value || '#000000';
      settings.quality = clamp(Number(el.setQuality.value) || 8, 2, 40);
    });
    persistSettings();
    el.canvas.width = project.width;
    el.canvas.height = project.height;
    draw(playhead);
  }

  /* --------------------------------- public ------------------------------- */

  function open() {
    root.hidden = false;
    requestAnimationFrame(() => {
      draw(playhead);
      positionPlayhead();
      const wide = !window.matchMedia || window.matchMedia('(min-width: 981px)').matches;
      if (wide) el.name.focus({ preventScroll: true });
    });
  }

  function close(options) {
    pause();
    save();
    root.hidden = true;
    if (!(options && options.silent) && typeof onExit === 'function') onExit();
  }

  function mount(node, options) {
    root = node;
    onExit = options && options.onExit;
    loadSettings();
    project = loadProject();
    root.innerHTML = template();
    cache();
    bind();
    el.zoom.textContent = `${Math.round(settings.zoom * 100)}%`;
    renderAll();
    el.settingsDialog.addEventListener('close', () => applySettings());
    el.exportDialog.addEventListener('cancel', (event) => { if (exporting) event.preventDefault(); });
    return { project: () => project, close, open, save: () => save(true) };
  }

  return { mount, open, RESOLUTIONS };
})();
