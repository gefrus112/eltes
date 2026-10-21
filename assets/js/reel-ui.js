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

  const DEFAULT_SETTINGS = { snap: true, safe: false, loop: false, zoom: 1, quality: 8, showGrid: false };
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

  // Pane filters and the free-music bench (kept out of the project document:
  // browsing the library is not an edit).
  const lookFilter = { family: 'all' };
  const titleFilter = { family: 'all' };
  const freeCache = new Map();
  let tuneAudio = null;
  let tunePlaying = '';

  // A colour script per family, so every look card gets its own little scene.
  // Hues drift with the card index, then the look's own filter is applied on
  // top — the same maths the canvas runs, so the card previews the edit.
  const LOOK_ART = {
    cinema: { sky: [206, 32, 44], sun: [38, 84, 72], ground: [206, 26, 16], ink: [210, 22, 7] },
    retro: { sky: [32, 76, 62], sun: [44, 94, 78], ground: [18, 42, 30], ink: [22, 32, 10] },
    neon: { sky: [258, 58, 24], sun: [318, 90, 66], ground: [232, 58, 13], ink: [252, 54, 5] },
    film: { sky: [38, 26, 42], sun: [42, 66, 64], ground: [28, 22, 22], ink: [30, 18, 9] },
    golden: { sky: [34, 86, 60], sun: [48, 96, 78], ground: [22, 58, 28], ink: [24, 42, 9] },
    arctic: { sky: [196, 60, 60], sun: [186, 76, 84], ground: [208, 46, 42], ink: [212, 42, 16] },
    mono: { sky: [220, 6, 52], sun: [220, 8, 88], ground: [220, 5, 26], ink: [220, 5, 8] },
    dream: { sky: [286, 56, 63], sun: [318, 84, 84], ground: [252, 44, 38], ink: [268, 40, 12] },
    glitch: { sky: [174, 60, 30], sun: [320, 88, 62], ground: [198, 56, 15], ink: [202, 44, 6] },
    vivid: { sky: [212, 84, 55], sun: [46, 96, 68], ground: [142, 58, 33], ink: [204, 44, 9] }
  };

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
    return JSON.stringify({
      clips: project.clips,
      music: project.music,
      media: project.media,
      name: project.name,
      width: project.width,
      height: project.height,
      background: project.background,
      fps: project.fps
    });
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
    project.width = doc.width || project.width;
    project.height = doc.height || project.height;
    project.background = doc.background || project.background;
    project.fps = doc.fps || project.fps;
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

  let sharedAudio = null;

  function audioContext() {
    if (sharedAudio) return sharedAudio;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { sharedAudio = new Ctor(); } catch (error) { sharedAudio = null; }
    return sharedAudio;
  }

  // Decode the song once so the music lane can show its waveform. The export
  // reuses this buffer instead of reading the file again.
  function decodePeaks(record, file) {
    const ctx = audioContext();
    if (!ctx || typeof file.arrayBuffer !== 'function') return;
    file.arrayBuffer()
      .then((data) => ctx.decodeAudioData(data.slice(0)))
      .then((buffer) => {
        record.buffer = buffer;
        record.peaks = R().peaksFrom(buffer, 240);
        if (buffer.duration) record.duration = buffer.duration;
        renderTimeline();
      })
      .catch(() => { /* the player still works without peaks */ });
  }

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
      decodePeaks(record, file);
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
      const target = clamp(R().sourceTime(clip, time), 0, Math.max(0, (video.duration || 0) - 0.05));
      if (video.playbackRate !== R().clipSpeed(clip)) {
        try { video.playbackRate = R().clipSpeed(clip); } catch (error) { /* the browser caps it */ }
      }
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
    updateKeyButtons();
  }

  function updateKeyButtons() {
    const clip = selectedId ? R().findClip(project, selectedId) : null;
    const buttons = el.inspector ? el.inspector.querySelectorAll('[data-key]') : [];
    if (!clip || !buttons.length) return;
    buttons.forEach((button) => {
      const on = R().hasKeyframe(clip, button.dataset.key, playhead);
      button.classList.toggle('on', on);
      button.querySelector('b').textContent = on ? '◆' : '◇';
    });
  }

  function play() {
    if (playing) return;
    stopTunePreview();
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
        if (settings.loop) {
          playhead = 0;
          lastTick = now;
          syncVideos(0, true);
          draw(0);
          positionPlayhead();
          updateTransport();
          raf = requestAnimationFrame(loop);
          return;
        }
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

  function renderStarter() {
    if (!el.starter) return;
    el.starter.hidden = project.clips.length > 0 || project.music.length > 0;
  }

  function renderAll() {
    el.name.value = project.name;
    el.snap.checked = settings.snap;
    el.loop.checked = settings.loop;
    document.documentElement.style.setProperty('--reel-aspect', `${project.width} / ${project.height}`);
    el.canvas.width = project.width;
    el.canvas.height = project.height;
    draw(playhead);
    updateTransport();
    renderMediaList();
    renderTimeline();
    renderInspector();
    renderMusicList();
    renderStarter();
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
      const name = track.name || (source ? source.file.name : '') || (project.media.find((m) => m.id === track.mediaId) || {}).name || 'Music';
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
          mediaId: track.mediaId,
          music: true
        }, pps)).join('');
      } else {
        const kind = name;
        lane.innerHTML = project.clips.filter((clip) => (kind === 'text' ? clip.kind === 'text' : clip.kind !== 'text'))
          .map((clip) => clipBlock(clip, pps)).join('');
      }
    }
    paintWaveforms();
    positionPlayhead();
  }

  function paintWaveforms() {
    if (!el.laneMusic) return;
    el.laneMusic.querySelectorAll('.reel-clip[data-music="1"]').forEach((node) => {
      const track = project.music.find((item) => item.id === node.dataset.clip);
      const source = track ? sources.get(track.mediaId) : null;
      const peaks = source && source.peaks;
      const canvas = node.querySelector('canvas.reel-wave');
      if (!canvas) return;
      if (!peaks || !peaks.length) { canvas.hidden = true; return; }
      canvas.hidden = false;
      const width = Math.max(16, Math.round(node.getBoundingClientRect().width || node.offsetWidth || 0));
      const height = 26;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const mid = height / 2;
      for (let x = 0; x < width; x += 2) {
        const value = peaks[Math.floor((x / width) * peaks.length)] || 0;
        const bar = Math.max(1, value * (height - 4));
        ctx.fillRect(x, mid - bar / 2, 1, bar);
      }
    });
  }

  function clipBlock(clip, pps) {
    const left = clip.start * pps;
    const width = Math.max(18, clip.duration * pps);
    const active = clip.id === selectedId ? ' on' : '';
    const kind = clip.kind === 'audio' ? 'audio' : clip.kind;
    const label = clip.kind === 'text' ? (clip.text && clip.text.value) || 'Text' : clip.label || clip.name;
    const transition = !clip.music && clip.transition && clip.transition.type !== 'none'
      ? R().TRANSITIONS.find((entry) => entry.id === clip.transition.type)
      : null;
    const transitionWidth = transition ? Math.min(width, Math.max(8, (Number(clip.transition.duration) || 0.6) * pps)) : 0;
    return `<div class="reel-clip ${kind}${active}" data-clip="${clip.id}" ${clip.music ? 'data-music="1"' : ''}
        style="left:${left}px;width:${width}px" tabindex="0" role="button" aria-label="${escapeAttr(label || 'clip')}">
      ${clip.music ? '<canvas class="reel-wave" aria-hidden="true"></canvas>' : ''}
      <span class="reel-clip-label">${escapeHtml(shortLabel(label))}</span>
      ${transition ? `<span class="reel-trans" style="width:${transitionWidth}px" title="${escapeAttr(`${transition.name} · ${clip.transition.duration}s`)}"></span>` : ''}
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

    if (clip.kind === 'video') {
      const speed = R().clipSpeed(clip);
      const source = sources.get(clip.mediaId);
      const available = source && source.duration ? source.duration : 0;
      const used = (Number(clip.duration) || 0) * speed;
      parts.push(`<div class="reel-group"><h5>Speed <em class="reel-count">${speed.toFixed(2)}×</em></h5>
        <div class="reel-speed-row">
          ${SPEEDS.map((value) => `<button type="button" class="reel-chip${Math.abs(speed - value) < 0.001 ? ' on' : ''}" data-speed="${value}">${value}×</button>`).join('')}
        </div>
        <label class="reel-slider"><span>Custom</span>
          <input class="reel-input" type="range" id="insSpeed" min="${R().SPEED_MIN}" max="${R().SPEED_MAX}" step="0.05" value="${speed}" />
          <output>${speed.toFixed(2)}×</output></label>
        <p class="reel-hint">${available ? `This clip uses ${used.toFixed(1)} s of a ${available.toFixed(1)} s source.` : 'Speed squeezes or stretches the source.'} Changing it re-times the clip so the same stretch of footage stays on screen.</p>
      </div>`);
    }

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
        <div class="reel-row">
          <label>Outline<input class="reel-input" type="range" id="insStroke" min="0" max="0.2" step="0.005" value="${Number(text.stroke) || 0}" /></label>
          <label>Outline colour<input class="reel-input" type="color" id="insStrokeColor" value="${toColor(text.strokeColor || '#000000')}" /></label>
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

      const motion = clip.motion || { type: 'none', amount: 0.12 };
      const motionNames = {
        none: 'None',
        'zoom-in': 'Zoom in',
        'zoom-out': 'Zoom out',
        'pan-left': 'Pan left',
        'pan-right': 'Pan right',
        'drift-up': 'Drift up'
      };
      parts.push(`<div class="reel-group"><h5>Motion</h5>
        <div class="reel-row">
          <label>Move<select class="reel-input" id="insMotion">
            ${R().MOTION_IDS.map((id) => `<option value="${id}" ${motion.type === id ? 'selected' : ''}>${motionNames[id]}</option>`).join('')}
          </select></label>
          <label>Strength<input class="reel-input" type="range" id="insMotionAmt" min="0.02" max="0.35" step="0.01" value="${Number(motion.amount) || 0.12}" ${motion.type === 'none' ? 'disabled' : ''} /></label>
        </div>
        <p class="reel-hint">A slow move across the clip — useful for stills in a music video.</p>
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

    const keyNames = { x: 'X', y: 'Y', scale: 'Scale', rotate: 'Rotate', opacity: 'Opacity' };
    const keyed = R().keyframesOf;
    const keyRows = R().KEYFRAME_PROPS.flatMap((prop) =>
      keyed(clip, prop).map((key) => ({ prop, key }))
    ).sort((a, b) => a.key.t - b.key.t);
    parts.push(`<div class="reel-group"><h5>Keyframes <em class="reel-count">${R().keyframeCount(clip)}</em></h5>
      <div class="reel-keyrow">
        ${R().KEYFRAME_PROPS.map((prop) => {
          const on = R().hasKeyframe(clip, prop, playhead);
          return `<button type="button" class="reel-key ${on ? 'on' : ''}" data-key="${prop}" title="${on ? 'Remove' : 'Add'} a ${keyNames[prop]} key at ${R().formatTime(playhead)}">${keyNames[prop]}<b>${on ? '◆' : '◇'}</b></button>`;
        }).join('')}
      </div>
      ${keyRows.length ? `<div class="reel-keylist">
        ${keyRows.map(({ prop, key }) => `<div class="reel-keyitem">
          <span><b>${keyNames[prop]}</b> ${R().formatTime(key.t)}</span>
          <select class="reel-input" data-key-ease="${prop}" data-key-time="${key.t}" title="Easing into this key">
            ${R().KEYFRAME_EASES.map((ease) => `<option value="${ease}" ${key.ease === ease ? 'selected' : ''}>${ease === 'inout' ? 'ease in-out' : ease}</option>`).join('')}
          </select>
          <button type="button" class="reel-key x" data-key-remove="${prop}" data-key-time="${key.t}" title="Remove this key">×</button>
        </div>`).join('')}
      </div>` : ''}
      <p class="reel-hint">A key stores ${'the'} value at the playhead. With two or more, Reel animates between them — the diamonds fill when a key sits under the playhead.</p>
    </div>`);

    const transition = clip.transition || { type: 'none', duration: 0.6 };
    if (clip.kind !== 'text') parts.push(`<div class="reel-group"><h5>Transition in</h5>
      <div class="reel-row">
        <label>Type<select class="reel-input" id="insTransition">
          ${R().TRANSITIONS.map((entry) => `<option value="${entry.id}" ${transition.type === entry.id ? 'selected' : ''}>${entry.name}</option>`).join('')}
        </select></label>
        <label>Length<input class="reel-input" type="range" id="insTransDur" min="0.2" max="2" step="0.05" value="${Number(transition.duration) || 0.6}" ${transition.type === 'none' ? 'disabled' : ''} /></label>
      </div>
      <p class="reel-hint">Blends with the clip that ends at this cut — on a first clip it fades from the background. It replaces this clip's in-animation while it runs.</p>
    </div>`);

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
      <button type="button" class="reel-btn" data-act="clip-ripple" title="Delete and pull this lane's later clips left">${icon('arrow-left', 13)} Close gap</button>
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
          const preset = R().look(button.dataset.fx);
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
      live('#insStroke', (value) => { clip.text.stroke = value; });
      once('#insStrokeColor', (value) => { clip.text.strokeColor = value; });
    }

    once('#insName', (value) => { clip.name = value || clip.name; });
    once('#insStart', (value) => { clip.start = Math.max(0, value); });
    once('#insDuration', (value) => { clip.duration = Math.max(0.1, value); });
    if (clip.kind === 'video') once('#insIn', (value) => { clip.in = Math.max(0, value); });
    once('#insFit', (value) => { clip.fit = value; });
    el.inspector.querySelectorAll('[data-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const prop = button.dataset.key;
        if (R().hasKeyframe(clip, prop, playhead)) commit(() => R().removeKeyframe(clip, prop, playhead), { keepSelection: true });
        else {
          const value = R().clipState(clip, playhead)[prop];
          commit(() => R().setKeyframe(clip, prop, playhead, value, 'inout'), { keepSelection: true });
          toast(`${prop[0].toUpperCase()}${prop.slice(1)} key at ${R().formatTime(playhead)}`);
        }
      });
    });
    el.inspector.querySelectorAll('[data-key-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const prop = button.dataset.keyRemove;
        const time = Number(button.dataset.keyTime);
        commit(() => R().removeKeyframe(clip, prop, time), { keepSelection: true });
      });
    });
    el.inspector.querySelectorAll('[data-key-ease]').forEach((select) => {
      select.addEventListener('change', () => {
        const prop = select.dataset.keyEase;
        const time = Number(select.dataset.keyTime);
        const value = R().keyframeValue(clip, prop, time);
        commit(() => R().setKeyframe(clip, prop, time, value == null ? 0 : value, select.value), { keepSelection: true });
      });
    });

    const motionSelect = el.inspector.querySelector('#insMotion');
    if (motionSelect) {
      motionSelect.addEventListener('change', () => {
        commit(() => { clip.motion.type = motionSelect.value; }, { keepSelection: true });
        renderInspector();
        draw(playhead);
      });
    }
    const motionAmount = el.inspector.querySelector('#insMotionAmt');
    if (motionAmount) {
      let before = null;
      const snap = () => { before = snapshot(); };
      motionAmount.addEventListener('pointerdown', snap);
      motionAmount.addEventListener('keydown', snap);
      motionAmount.addEventListener('input', () => {
        clip.motion.amount = Number(motionAmount.value);
        draw(playhead);
      });
      motionAmount.addEventListener('change', () => {
        if (before && snapshot() !== before) {
          undoStack.push(before);
          if (undoStack.length > 60) undoStack.shift();
          redoStack.length = 0;
          save();
        }
        before = null;
      });
    }
    const speedRange = el.inspector.querySelector('#insSpeed');
    if (speedRange) {
      let beforeSpeed = null;
      const output = speedRange.parentElement.querySelector('output');
      const snapSpeed = () => { beforeSpeed = snapshot(); };
      speedRange.addEventListener('pointerdown', snapSpeed);
      speedRange.addEventListener('keydown', snapSpeed);
      speedRange.addEventListener('input', () => {
        if (!setClipSpeed(clip, Number(speedRange.value))) return;
        if (output) output.textContent = `${R().clipSpeed(clip).toFixed(2)}×`;
        draw(playhead);
        renderTimeline();
        updateTransport();
      });
      speedRange.addEventListener('change', () => {
        if (beforeSpeed && snapshot() !== beforeSpeed) {
          undoStack.push(beforeSpeed);
          if (undoStack.length > 60) undoStack.shift();
          redoStack.length = 0;
          save();
        }
        beforeSpeed = null;
        renderInspector();
      });
    }

    once('#insAnimIn', (value) => { clip.animation.in = value; });
    once('#insAnimOut', (value) => { clip.animation.out = value; });
    once('#insInDur', (value) => { clip.animation.inDur = value; });
    once('#insOutDur', (value) => { clip.animation.outDur = value; });

    const transitionSelect = el.inspector.querySelector('#insTransition');
    if (transitionSelect) {
      transitionSelect.addEventListener('change', () => {
        commit(() => { clip.transition.type = transitionSelect.value; }, { keepSelection: true });
        renderInspector();
        renderTimeline();
      });
    }
    const transitionLength = el.inspector.querySelector('#insTransDur');
    if (transitionLength) {
      let before = null;
      const snap = () => { before = snapshot(); };
      transitionLength.addEventListener('pointerdown', snap);
      transitionLength.addEventListener('keydown', snap);
      transitionLength.addEventListener('input', () => {
        clip.transition.duration = Number(transitionLength.value);
        draw(playhead);
        renderTimeline();
      });
      transitionLength.addEventListener('change', () => {
        if (before && snapshot() !== before) {
          undoStack.push(before);
          if (undoStack.length > 60) undoStack.shift();
          redoStack.length = 0;
          save();
        }
        before = null;
      });
    }
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
        if (!drag.music && item.kind !== 'text') item.in = Math.max(0, (original.in || 0) + applied * R().clipSpeed(original));
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

  /* --------------------------- the library panes --------------------------- */

  const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%)`;

  /** The inline style that gives a look card its own little picture. */
  function lookArtStyle(look, index) {
    const art = LOOK_ART[look.family] || LOOK_ART.cinema;
    const drift = (index % 9) - 4;
    const shift = (Number(look.filter && look.filter.hue) || 0) * 0.5;
    const overlay = look.overlay || {};
    return [
      `--sky:${hsl(art.sky[0] + drift * 2.5 + shift, art.sky[1] + drift, art.sky[2] + drift * 1.6)}`,
      `--sun:${hsl(art.sun[0] + drift * 1.5 + shift, art.sun[1], art.sun[2] + drift)}`,
      `--ground:${hsl(art.ground[0] + drift * 2 + shift, art.ground[1], art.ground[2] + drift)}`,
      `--ink:${hsl(art.ink[0] + shift, art.ink[1], art.ink[2])}`,
      `--vig:${Number(overlay.vignette) || 0}`,
      `--leak:${Number(overlay.leak) || 0}`,
      `--scan:${Number(overlay.scanline) || 0}`,
      `--grain:${Number(overlay.grain) || 0}`,
      `filter:${R().effectFilter(look.filter)}`
    ].join(';');
  }

  function buildLooks() {
    if (!el.looks) return;
    const looks = R().looks();
    const lib = window.EltesReelLibrary;
    const families = (lib && Array.isArray(lib.EFFECT_FAMILIES)) ? lib.EFFECT_FAMILIES : [];
    if (el.lookFamilies) {
      el.lookFamilies.innerHTML = `<button type="button" class="reel-chip on" data-look-family="all">All <b>${looks.length}</b></button>`
        + families.map((family) => `<button type="button" class="reel-chip" data-look-family="${family.id}">${escapeHtml(family.name)} <b>${looks.filter((look) => look.family === family.id).length}</b></button>`).join('');
    }
    el.looks.innerHTML = looks.map((look, index) => `<button type="button" class="reel-look" data-look="${look.id}" data-family="${look.family || 'classic'}" data-name="${escapeAttr(look.name.toLowerCase())}" title="${escapeAttr(`${look.name} — ${look.familyName || 'look'}`)}">
        <span class="reel-look-art" style="${lookArtStyle(look, index)}"><i class="leak"></i><i class="scan"></i><i class="grain"></i></span>
        <span class="reel-look-name">${escapeHtml(look.name)}</span>
      </button>`).join('');
    filterLooks();
  }

  function filterLooks() {
    if (!el.looks) return;
    const query = String(el.lookSearch ? el.lookSearch.value : '').trim().toLowerCase();
    let shown = 0;
    el.looks.querySelectorAll('.reel-look').forEach((card) => {
      const match = (lookFilter.family === 'all' || card.dataset.family === lookFilter.family)
        && (!query || card.dataset.name.includes(query) || card.dataset.family.includes(query));
      card.hidden = !match;
      if (match) shown += 1;
    });
    if (el.lookCount) el.lookCount.textContent = `${shown} of ${R().looks().length}`;
    if (el.lookFamilies) {
      el.lookFamilies.querySelectorAll('[data-look-family]').forEach((chip) => {
        const on = chip.dataset.lookFamily === lookFilter.family;
        chip.classList.toggle('on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
  }

  function titleCardStyle(text) {
    const style = [
      `color:${text.color || '#ffffff'}`,
      `font-family:${text.font === 'JetBrains Mono' ? "'JetBrains Mono', ui-monospace, monospace" : 'Inter, system-ui, sans-serif'}`,
      `font-weight:${Number(text.weight) || 600}`,
      `font-size:${Math.round(clamp(8 + (Number(text.size) || 0.05) * 32, 9, 15))}px`,
      `letter-spacing:${Number(text.spacing) || 0}em`,
      `text-transform:${text.uppercase ? 'uppercase' : 'none'}`,
      `text-align:${text.align || 'center'}`
    ];
    if (text.bg) style.push(`background:${text.bg}`, 'padding:4px 8px', 'border-radius:5px');
    if (Number(text.stroke) > 0) style.push(`-webkit-text-stroke:${Math.max(1, Math.round(Number(text.stroke) * 26))}px ${text.strokeColor || '#000000'}`);
    if (Number(text.shadow) > 0) style.push(`text-shadow:0 2px 8px rgba(0,0,0,${Number(text.shadow)})`);
    return style.join(';');
  }

  function buildTitles() {
    if (!el.titles) return;
    const list = R().titles();
    const families = window.EltesReelLibrary && Array.isArray(window.EltesReelLibrary.TITLE_FAMILIES)
      ? window.EltesReelLibrary.TITLE_FAMILIES
      : [];
    if (el.titleFamilies) {
      el.titleFamilies.innerHTML = `<button type="button" class="reel-chip on" data-title-family="all">All <b>${list.length}</b></button>`
        + families.map((family) => `<button type="button" class="reel-chip" data-title-family="${family.id}">${escapeHtml(family.name)} <b>${list.filter((title) => title.family === family.id).length}</b></button>`).join('');
    }
    el.titles.innerHTML = list.map((preset) => `<button type="button" class="reel-title" data-text="${preset.id}" data-family="${preset.family}" data-name="${escapeAttr(`${preset.name} ${preset.familyName} ${preset.sample}`.toLowerCase())}" title="${escapeAttr(preset.name)}">
        <span class="reel-title-art"><span style="${escapeAttr(titleCardStyle(preset.text || {}))}">${escapeHtml(preset.sample)}</span></span>
        <span class="reel-title-meta"><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.familyName)} · ${escapeHtml((preset.animation || {}).in || 'fade')}</small></span>
      </button>`).join('');
    filterTitles();
  }

  function filterTitles() {
    if (!el.titles) return;
    const query = String(el.titleSearch ? el.titleSearch.value : '').trim().toLowerCase();
    let shown = 0;
    el.titles.querySelectorAll('.reel-title').forEach((card) => {
      const match = (titleFilter.family === 'all' || card.dataset.family === titleFilter.family)
        && (!query || card.dataset.name.includes(query));
      card.hidden = !match;
      if (match) shown += 1;
    });
    if (el.titleCount) el.titleCount.textContent = `${shown} of ${R().titles().length}`;
    if (el.titleFamilies) {
      el.titleFamilies.querySelectorAll('[data-title-family]').forEach((chip) => {
        const on = chip.dataset.titleFamily === titleFilter.family;
        chip.classList.toggle('on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
  }

  function buildTemplates() {
    if (!el.templates) return;
    const list = R().templates();
    const lib = window.EltesReelMusic;
    el.templates.innerHTML = list.map((tpl) => {
      const aspect = tpl.width > tpl.height ? '16:9' : (tpl.width === tpl.height ? '1:1' : '9:16');
      const track = lib && lib.trackById(tpl.music);
      return `<button type="button" class="reel-template" data-template="${tpl.id}" data-name="${escapeAttr(`${tpl.name} ${tpl.tag} ${tpl.blurb}`.toLowerCase())}" style="--tpl:${tpl.background || '#05060a'}">
          <span class="reel-template-art" aria-hidden="true"><i style="--w:64%;--y:32%"></i><i style="--w:42%;--y:50%"></i><i style="--w:28%;--y:64%"></i></span>
          <span class="reel-template-main">
            <strong>${escapeHtml(tpl.name)}</strong>
            <small>${escapeHtml(tpl.tag)} · ${aspect}${track ? ` · ${escapeHtml(track.name)}` : ''}</small>
            <em>${escapeHtml(tpl.blurb)}</em>
          </span>
          <span class="reel-template-go">Use</span>
        </button>`;
    }).join('');
    if (el.templateCount) el.templateCount.textContent = `${list.length} free`;
    filterTemplates();
  }

  function filterTemplates() {
    if (!el.templates) return;
    const query = String(el.templateSearch ? el.templateSearch.value : '').trim().toLowerCase();
    el.templates.querySelectorAll('.reel-template').forEach((card) => {
      card.hidden = !!query && !card.dataset.name.includes(query);
    });
  }

  function renderBench() {
    if (!el.bench) return;
    const lib = window.EltesReelMusic;
    if (!lib || !Array.isArray(lib.TRACKS)) {
      el.bench.innerHTML = '<p class="reel-hint">The free music bench did not load.</p>';
      return;
    }
    el.bench.innerHTML = lib.TRACKS.map((track) => `<article class="reel-tune" data-tune="${track.id}" style="--tune:${track.color || '#39dca2'}">
        <span class="reel-tune-art" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="reel-tune-main">
          <strong>${escapeHtml(track.name)}</strong>
          <small>${escapeHtml(track.mood)} · ${track.bpm} BPM · ${lib.durationOf(track).toFixed(0)} s</small>
          <em>${escapeHtml(track.desc || '')}</em>
        </span>
        <span class="reel-tune-acts">
          <button type="button" data-act="tune-preview" data-id="${track.id}" title="Preview — rendered in this tab">${icon('play', 12)}</button>
          <button type="button" data-act="tune-add" data-id="${track.id}" title="Add to the timeline">${icon('plus', 12)} Add</button>
        </span>
      </article>`).join('');
    if (el.tuneCount) el.tuneCount.textContent = `${lib.TRACKS.length} tracks`;
  }

  /** Render one free track to a cached WAV File. Rendering is pure maths. */
  function freeTrackEntry(track) {
    const lib = window.EltesReelMusic;
    if (!lib || !track) return null;
    const cached = freeCache.get(track.id);
    if (cached) return cached;
    let bytes = null;
    try { bytes = lib.wavBytes(track); } catch (error) { bytes = null; }
    if (!bytes) { toast('This browser could not render the track'); return null; }
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const file = new File([blob], `${track.name}.wav`, { type: 'audio/wav' });
    const entry = { blob, file, url: URL.createObjectURL(blob) };
    freeCache.set(track.id, entry);
    if (freeCache.size > 4) {
      const oldest = freeCache.keys().next().value;
      const drop = freeCache.get(oldest);
      if (drop && drop.url) URL.revokeObjectURL(drop.url);
      freeCache.delete(oldest);
    }
    return entry;
  }

  const rendering = new Set();

  function addFreeTrack(id, options) {
    const lib = window.EltesReelMusic;
    const track = lib && lib.trackById(id);
    if (!track || rendering.has(id)) return;
    const config = options || {};
    const cached = freeCache.has(id);
    const requested = Number(config.start);
    const start = Number.isFinite(requested) ? Math.max(0, requested) : playhead;
    rendering.add(id);
    // Rendering a bed is a few hundred milliseconds of arithmetic. Say so
    // first, yield a frame, then do the work and hand the file to the importer.
    if (!cached && !config.silent) toast(`Rendering ${track.name}…`);
    setTimeout(() => {
      try {
        const entry = freeTrackEntry(track);
        if (!entry) return;
        const seconds = Math.max(2, Math.round(lib.durationOf(track) * 10) / 10);
        const name = `${R().sanitizeName(track.name)}.wav`;
        let added = false;
        commit(() => {
          let media = project.media.find((item) => item.name === name && item.kind === 'audio' && sources.has(item.id));
          if (!media) {
            media = { id: R().uid('m'), name, kind: 'audio', size: entry.file.size, duration: seconds };
            project.media.push(media);
            bindSource(media, entry.file);
          }
          project.music.push(R().createMusic(media.id, track.name, {
            start, duration: seconds, volume: 0.75, fadeIn: 0.6, fadeOut: 1.4
          }));
          added = true;
        });
        if (added && !config.silent) toast(`${track.name} added — generated here, no download`);
      } finally {
        rendering.delete(id);
      }
    }, 40);
  }

  function stopTunePreview() {
    if (tuneAudio) {
      try { tuneAudio.pause(); } catch (error) { /* already stopped */ }
    }
    tuneAudio = null;
    tunePlaying = '';
    if (el.bench) el.bench.querySelectorAll('[data-tune]').forEach((card) => card.classList.remove('playing'));
  }

  function previewTune(id) {
    const lib = window.EltesReelMusic;
    const track = lib && lib.trackById(id);
    if (!track) return;
    if (tunePlaying === id) { stopTunePreview(); return; }
    stopTunePreview();
    toast(`Rendering ${track.name}…`);
    setTimeout(() => {
      const entry = freeTrackEntry(track);
      if (!entry) return;
      tuneAudio = new Audio(entry.url);
      tuneAudio.volume = 0.8;
      tuneAudio.addEventListener('ended', () => {
        tunePlaying = '';
        tuneAudio = null;
        if (el.bench) el.bench.querySelectorAll('[data-tune]').forEach((card) => card.classList.remove('playing'));
      }, { once: true });
      tuneAudio.play().catch(() => toast('Playback was blocked — press Preview again'));
      tunePlaying = id;
      if (el.bench) el.bench.querySelectorAll('[data-tune]').forEach((card) => card.classList.toggle('playing', card.dataset.tune === id));
    }, 40);
  }

  /** The clip a look should land on: the selection, or the picture at the playhead. */
  function pictureUnderPlayhead() {
    if (selectedId) {
      const selected = R().findClip(project, selectedId);
      if (selected && selected.kind !== 'text') return selected;
    }
    const visible = R().clipsAt(project, playhead).filter((clip) => clip.kind !== 'text');
    return visible.length ? visible[visible.length - 1] : null;
  }

  const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

  /** Change speed and carry the source range with it. */
  function setClipSpeed(clip, value) {
    const speed = clamp(Number(value) || 1, R().SPEED_MIN, R().SPEED_MAX);
    const previous = R().clipSpeed(clip);
    if (Math.abs(previous - speed) < 0.001) return false;
    const span = (Number(clip.duration) || 0) * previous;
    clip.speed = Math.round(speed * 100) / 100;
    clip.duration = Math.max(0.2, Math.round((span / speed) * 100) / 100);
    return true;
  }

  function freezeFrame() {
    const canvas = el.canvas;
    if (!canvas || !R().clipsAt(project, playhead).length) {
      toast('Move the playhead onto a picture first');
      return;
    }
    draw(playhead);
    const at = playhead;
    const name = `freeze-${R().formatTime(at).replace(/[:.]/g, '-')}.png`;
    canvas.toBlob(async (blob) => {
      if (!blob) { toast('This browser could not snapshot the frame'); return; }
      const file = new File([blob], name, { type: 'image/png' });
      await importFiles([file]);
      const media = project.media.find((item) => item.name === name);
      if (!media) return;
      const clip = R().createClip('image', { mediaId: media.id, name: 'Freeze frame', start: at, duration: 2 });
      commit(() => { project.clips.push(clip); selectedId = clip.id; });
      toast('Freeze frame added — two seconds, still');
    }, 'image/png');
  }

  /* ---------------------------------- panes ------------------------------- */

  function pane(name) {
    el.side.querySelectorAll('[data-pane]').forEach((node) => {
      node.classList.toggle('on', node.dataset.pane === name);
    });
    el.panes.forEach((node) => { node.hidden = node.dataset.pane !== name; });
  }

  function addText(presetId) {
    const preset = R().titlePreset(presetId);
    if (!preset) return;
    const clip = R().createTextClip(preset, { start: playhead, duration: 4 });
    commit(() => { project.clips.push(clip); selectedId = clip.id; });
    pane('text');
    toast(`${preset.name} title added`);
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
            if (video.playbackRate !== R().clipSpeed(clip)) {
              try { video.playbackRate = R().clipSpeed(clip); } catch (error) { /* the browser caps it */ }
            }
            const target = R().sourceTime(clip, time);
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

  function loadProjectData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.clips) || !Array.isArray(data.music)) {
      toast('That file is not a Reel project');
      return;
    }
    const clips = data.clips
      .filter((clip) => clip && ['video', 'image', 'text'].includes(clip.kind))
      .map((clip) => Object.assign(R().createClip(clip.kind, {}), clip, {
        transition: Object.assign({ type: 'none', duration: 0.6 }, clip.transition),
        animation: Object.assign({ in: 'fade', out: 'fade', inDur: 0.4, outDur: 0.35 }, clip.animation)
      }));
    const music = data.music
      .filter((track) => track && track.id)
      .map((track) => Object.assign(R().createMusic(track.mediaId, track.name, {}), track));
    const base = R().createProject({
      name: data.name,
      width: data.width,
      height: data.height,
      fps: data.fps,
      background: data.background
    });
    commit(() => {
      for (const source of sources.values()) { if (source.url) URL.revokeObjectURL(source.url); }
      sources.clear();
      project.clips = clips;
      project.music = music;
      project.media = Array.isArray(data.media) ? data.media : [];
      project.name = base.name;
      project.width = base.width;
      project.height = base.height;
      project.fps = base.fps;
      project.background = base.background;
      selectedId = null;
    });
    seek(0);
    toast('Project opened — re-link its media to see it');
  }

  function applyTemplate(id) {
    const built = R().template(id);
    if (!built) { toast('That starter is not available'); return; }
    const empty = !project.clips.length && !project.music.length;
    const offset = empty ? 0 : R().projectLength(project);
    for (const clip of built.clips) clip.start += offset;
    commit(() => {
      if (empty) {
        project.width = built.width;
        project.height = built.height;
        project.background = built.background;
        el.canvas.width = project.width;
        el.canvas.height = project.height;
      }
      for (const clip of built.clips) project.clips.push(clip);
      selectedId = built.clips[0] ? built.clips[0].id : null;
    });
    if (empty) {
      playhead = 0;
      draw(playhead);
      updateTransport();
      positionPlayhead();
      toast(`${built.name} — drop your clips on the slots`);
    } else {
      seek(Math.min(offset, R().projectLength(project)));
      toast(`${built.name} added at ${R().formatTime(offset)}`);
    }
    // The bed is generated, not fetched; give the UI a beat to paint first.
    if (built.music && !project.music.length) {
      const bed = built.music;
      setTimeout(() => { if (!project.music.length) addFreeTrack(bed, { start: offset }); }, 80);
    }
    pane('starter');
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
        <button type="button" class="reel-ghost" data-act="shortcuts" title="Keyboard shortcuts (?)">${icon('help-circle', 15)}</button>
        <button type="button" class="reel-ghost" data-act="settings" title="Project settings">${icon('settings', 15)}</button>
        <button type="button" class="reel-btn primary" data-act="export">${icon('download', 14)} <span class="reel-export-text">Export</span></button>
      </header>

      <div class="reel-body">
        <aside class="reel-side">
          <div class="reel-pane-tabs" role="tablist">
            <button type="button" data-pane="media" class="on" role="tab">Media</button>
            <button type="button" data-pane="starter" role="tab">Starter</button>
            <button type="button" data-pane="text" role="tab">Titles</button>
            <button type="button" data-pane="fx" role="tab">Looks</button>
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

          <section class="reel-pane" data-pane="starter" hidden>
            <div class="reel-pane-head"><strong>Free starters</strong><span class="reel-count" id="reelTemplateCount"></span></div>
            <label class="reel-search">
              <input type="search" id="reelTemplateSearch" placeholder="Search templates" autocomplete="off" aria-label="Search templates" />
            </label>
            <div class="reel-template-list" id="reelTemplates"></div>
            <p class="reel-note">Every starter is made of ordinary, editable clips and text — nothing is locked. Placeholder slots take any video or photo you drop on them.</p>
          </section>

          <section class="reel-pane" data-pane="text" hidden>
            <div class="reel-pane-head"><strong>Titles</strong><span class="reel-count" id="reelTitleCount"></span></div>
            <label class="reel-search">
              <input type="search" id="reelTitleSearch" placeholder="Search 200 titles" autocomplete="off" aria-label="Search titles" />
            </label>
            <div class="reel-family-chips" id="reelTitleFamilies"></div>
            <div class="reel-title-grid" id="reelTitles"></div>
            <p class="reel-note">A title lands at the playhead with its animation already set. Edit the words, colour and timing in the inspector.</p>
          </section>

          <section class="reel-pane" data-pane="fx" hidden>
            <div class="reel-pane-head"><strong>Looks</strong><span class="reel-count" id="reelLookCount"></span></div>
            <label class="reel-search">
              <input type="search" id="reelLookSearch" placeholder="Search 400 looks" autocomplete="off" aria-label="Search looks" />
            </label>
            <div class="reel-family-chips" id="reelLookFamilies"></div>
            <label class="reel-check reel-look-all"><input type="checkbox" id="reelLookAll" /> Apply to every picture clip</label>
            <div class="reel-look-grid" id="reelLooks"></div>
            <p class="reel-note">Select a video or image clip, or park the playhead over one, then pick a card. Every card shows that look on the same little scene; fine-tune the recipe in the inspector.</p>
          </section>

          <section class="reel-pane" data-pane="music" hidden>
            <div class="reel-pane-head"><strong>Free music</strong><span class="reel-count" id="reelTuneCount"></span></div>
            <div class="reel-bench" id="reelBench"></div>
            <div class="reel-pane-head reel-pane-head-split">
              <strong>Your tracks</strong><span class="grow"></span>
              <button type="button" class="reel-btn small" data-act="import">${icon('plus', 13)} Add audio</button>
            </div>
            <div id="reelMusic"></div>
            <p class="reel-note">The bench is synthesised in this tab: no downloads, no sample packs, no licence to clear. Volume and fades are written into the export.</p>
          </section>
        </aside>

        <main class="reel-stage">
          <div class="reel-canvas-wrap" id="reelDrop">
            <canvas id="reelCanvas" width="${project.width}" height="${project.height}" aria-label="Video preview"></canvas>
            <div class="reel-starter" id="reelStarter" hidden>
              <div class="reel-starter-in">
                <strong>Start an edit</strong>
                <p>Drop a video, image or song anywhere, or begin with a template.</p>
                <div class="reel-starter-grid">
                  ${R().templates().slice(0, 6).map((tpl) => {
                    const aspect = tpl.width > tpl.height ? '16:9' : (tpl.width === tpl.height ? '1:1' : '9:16');
                    return `<button type="button" data-template="${tpl.id}"><b>${escapeHtml(tpl.name)}</b><span>${escapeHtml(tpl.tag)} · ${aspect}</span></button>`;
                  }).join('')}
                </div>
                <small>Everything stays in this browser.</small>
              </div>
            </div>
            <div class="reel-drop-hint">Drop a video, image or audio file</div>
          </div>
          <div class="reel-transport">
            <button type="button" class="reel-play" id="reelPlay" aria-label="Play">${icon('play', 15)}</button>
            <span class="reel-clock" id="reelTime">0:00.0 / 0:00.0</span>
            <input class="reel-scrub" id="reelScrub" type="range" min="0" max="1000" value="0" aria-label="Scrub" />
            <span class="reel-meta" id="reelMeta"></span>
            <button type="button" class="reel-ghost" data-act="freeze" title="Freeze this frame into a two-second still">${icon('copy', 14)} Freeze</button>
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
          <label class="reel-check"><input type="checkbox" id="reelLoop" /> Loop</label>
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
      <input type="file" id="reelProjectFile" accept=".json,application/json" hidden />

      <dialog class="reel-dialog" id="reelShortcutsDialog">
        <form method="dialog" class="reel-dialog-in">
          <h3>Keyboard</h3>
          <p class="reel-dialog-sub">Reel listens while the editor is open. Typing in a field is always left alone.</p>
          <ul class="reel-keys">
            <li><span><kbd>Space</kbd></span><span>Play / pause</span></li>
            <li><span><kbd>←</kbd> <kbd>→</kbd></span><span>Step 0.1 s · hold <kbd>Shift</kbd> for 5 s</span></li>
            <li><span><kbd>Home</kbd> <kbd>End</kbd></span><span>Jump to the start or the end</span></li>
            <li><span><kbd>S</kbd></span><span>Split the selected clip at the playhead</span></li>
            <li><span><kbd>T</kbd></span><span>Add a title at the playhead</span></li>
            <li><span><kbd>Delete</kbd></span><span>Remove the selected clip</span></li>
            <li><span><kbd>Shift</kbd>+<kbd>Delete</kbd></span><span>Remove it and close the gap</span></li>
            <li><span><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd></span><span>Undo · add <kbd>Shift</kbd> to redo</span></li>
            <li><span><kbd>?</kbd></span><span>This sheet</span></li>
            <li><span><kbd>Esc</kbd></span><span>Back to Studio</span></li>
          </ul>
          <div class="reel-dialog-foot">
            <button type="button" class="reel-btn" data-act="shortcuts-close">Close</button>
          </div>
        </form>
      </dialog>

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
            <button type="button" class="reel-btn" data-act="import-project">Open project</button>
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
      loop: q('#reelLoop'),
      safe: q('#reelSafe'),
      zoom: q('#reelZoom'),
      file: q('#reelFile'),
      projectFile: q('#reelProjectFile'),
      starter: q('#reelStarter'),
      looks: q('#reelLooks'),
      lookSearch: q('#reelLookSearch'),
      lookFamilies: q('#reelLookFamilies'),
      lookCount: q('#reelLookCount'),
      lookAll: q('#reelLookAll'),
      titles: q('#reelTitles'),
      titleSearch: q('#reelTitleSearch'),
      titleFamilies: q('#reelTitleFamilies'),
      titleCount: q('#reelTitleCount'),
      templates: q('#reelTemplates'),
      templateSearch: q('#reelTemplateSearch'),
      templateCount: q('#reelTemplateCount'),
      bench: q('#reelBench'),
      tuneCount: q('#reelTuneCount'),
      toast: q('#reelToast'),
      exportDialog: q('#reelExportDialog'),
      shortcutsDialog: q('#reelShortcutsDialog'),
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

    if (el.lookSearch) el.lookSearch.addEventListener('input', filterLooks);
    if (el.titleSearch) el.titleSearch.addEventListener('input', filterTitles);
    if (el.templateSearch) el.templateSearch.addEventListener('input', filterTemplates);

    root.addEventListener('click', (event) => {
      const paneButton = event.target.closest('[data-pane]');
      if (paneButton && paneButton.closest('.reel-pane-tabs')) { pane(paneButton.dataset.pane); return; }

      const templateButton = event.target.closest('[data-template]');
      if (templateButton) { applyTemplate(templateButton.dataset.template); return; }

      const textButton = event.target.closest('[data-text]');
      if (textButton) { addText(textButton.dataset.text); return; }

      const lookButton = event.target.closest('[data-look]');
      if (lookButton) {
        const clip = pictureUnderPlayhead();
        if (!clip) { toast('Select a video or image clip first'); return; }
        selectedId = clip.id;
        const look = R().look(lookButton.dataset.look);
        if (!look) return;
        const all = !!(el.lookAll && el.lookAll.checked);
        const targets = all ? project.clips.filter((item) => item.kind !== 'text') : [clip];
        commit(() => {
          for (const target of targets) {
            target.filter = Object.assign({}, R().FILTER_DEFAULTS, look.filter);
            target.overlay = Object.assign({}, R().OVERLAY_DEFAULTS, look.overlay);
          }
        }, { keepSelection: true });
        el.looks.querySelectorAll('[data-look]').forEach((card) => card.classList.toggle('on', card === lookButton));
        renderInspector();
        toast(all ? `${look.name} applied to ${targets.length} clip${targets.length === 1 ? '' : 's'}` : `${look.name} applied`);
        return;
      }

      const lookFamily = event.target.closest('[data-look-family]');
      if (lookFamily) { lookFilter.family = lookFamily.dataset.lookFamily; filterLooks(); return; }

      const titleFamily = event.target.closest('[data-title-family]');
      if (titleFamily) { titleFilter.family = titleFamily.dataset.titleFamily; filterTitles(); return; }

      const speedButton = event.target.closest('[data-speed]');
      if (speedButton) {
        const clip = selectedId ? R().findClip(project, selectedId) : null;
        if (!clip || clip.kind !== 'video') return;
        commit(() => setClipSpeed(clip, Number(speedButton.dataset.speed)), { keepSelection: true });
        renderInspector();
        renderTimeline();
        draw(playhead);
        return;
      }

      const fxButton = event.target.closest('[data-fx]');
      if (fxButton) {
        const clip = selectedId ? R().findClip(project, selectedId) : null;
        if (!clip || clip.kind === 'text') { toast('Select a video or image clip first'); return; }
        const preset = R().look(fxButton.dataset.fx);
        if (!preset) return;
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
      if (act === 'tune-add') addFreeTrack(action.dataset.id);
      else if (act === 'tune-preview') previewTune(action.dataset.id);
      else if (act === 'freeze') freezeFrame();
      else if (act === 'import') el.file.click();
      else if (act === 'back') close();
      else if (act === 'undo') undo();
      else if (act === 'redo') redo();
      else if (act === 'split') splitSelected();
      else if (act === 'duplicate') duplicateSelected();
      else if (act === 'clip-remove') deleteSelected();
      else if (act === 'clip-ripple') deleteSelected({ ripple: true });
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
      else if (act === 'shortcuts') openShortcuts();
      else if (act === 'shortcuts-close') closeShortcuts();
      else if (act === 'export-project') exportProject();
      else if (act === 'import-project') el.projectFile.click();
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
    el.loop.addEventListener('change', () => { settings.loop = el.loop.checked; persistSettings(); });
    el.safe.addEventListener('change', () => { settings.safe = el.safe.checked; persistSettings(); draw(playhead); });

    el.file.addEventListener('change', () => {
      importFiles(el.file.files);
      el.file.value = '';
    });

    el.projectFile.addEventListener('change', () => {
      const file = el.projectFile.files && el.projectFile.files[0];
      el.projectFile.value = '';
      if (!file) return;
      file.text()
        .then((text) => loadProjectData(JSON.parse(text)))
        .catch(() => toast('That file is not readable JSON'));
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
    if (
      (el.exportDialog && el.exportDialog.open) ||
      (el.settingsDialog && el.settingsDialog.open) ||
      (el.shortcutsDialog && el.shortcutsDialog.open)
    ) return;
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
      deleteSelected({ ripple: event.shiftKey });
    } else if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
      event.preventDefault();
      openShortcuts();
    } else if (event.key === 'Escape') {
      close();
    } else if (event.key === 'Home') {
      seek(0);
    } else if (event.key === 'End') {
      seek(R().projectLength(project));
    }
  }

  function openShortcuts() {
    const dialog = el.shortcutsDialog;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function closeShortcuts() {
    const dialog = el.shortcutsDialog;
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
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

  function deleteSelected(options) {
    const clip = selectedId ? R().findClip(project, selectedId) : null;
    if (!clip) return;
    const ripple = !!(options && options.ripple);
    const textLane = clip.kind === 'text';
    const end = R().clipEnd(clip);
    const length = clip.duration;
    commit(() => {
      R().removeClip(project, clip.id);
      if (ripple) {
        // Only this lane moves; the other picture lane and the music stay put.
        for (const other of project.clips) {
          if ((other.kind === 'text') !== textLane) continue;
          if (other.start >= end - 0.0001) other.start = Math.max(0, other.start - length);
        }
      }
      selectedId = null;
    });
    if (ripple) toast('Gap closed');
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
      paintWaveforms();
    });
  }

  function close(options) {
    pause();
    stopTunePreview();
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
    buildLooks();
    buildTitles();
    buildTemplates();
    renderBench();
    bind();
    el.zoom.textContent = `${Math.round(settings.zoom * 100)}%`;
    renderAll();
    el.settingsDialog.addEventListener('close', () => applySettings());
    el.exportDialog.addEventListener('cancel', (event) => { if (exporting) event.preventDefault(); });
    return { project: () => project, close, open, save: () => save(true) };
  }

  return { mount, open, RESOLUTIONS };
})();
