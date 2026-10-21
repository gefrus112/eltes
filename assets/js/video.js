(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const ui = {
    fileInput: byId('fileInput'), choose: byId('chooseVideo'), replace: byId('replaceVideo'),
    urlForm: byId('urlForm'), videoUrl: byId('videoUrl'), loadUrl: byId('loadUrl'),
    dropZone: byId('dropZone'), dropHint: byId('dropHint'), video: byId('sourceVideo'), vignette: byId('vignetteLayer'),
    empty: byId('emptyState'), sourceName: byId('sourceName'), videoInfo: byId('videoInfo'),
    play: byId('playButton'), mute: byId('muteButton'), time: byId('timeDisplay'), scrubber: byId('scrubber'),
    trimStart: byId('trimStart'), trimEnd: byId('trimEnd'), text: byId('overlayText'),
    playbackSpeed: byId('playbackSpeed'), vignetteControl: byId('vignette'), resetLook: byId('resetLook'),
    layer: byId('textLayer'), caption: byId('previewCaption'), export: byId('exportButton'),
    status: byId('exportStatus'), quality: byId('exportQuality'), progressWrap: byId('progressWrap'),
    progress: byId('exportProgress'), progressLabel: byId('progressLabel')
  };
  const filterInputs = ['brightness', 'contrast', 'saturation', 'sepia', 'hue', 'blur'].map(byId);
  const overlayInputs = ['overlayFont', 'overlaySize', 'overlayColor', 'overlayPosition', 'overlayAlign', 'overlayBackdrop'].map(byId);
  const editableInputs = [ui.trimStart, ui.trimEnd, ui.text, ui.playbackSpeed, ui.vignetteControl, ...filterInputs, ...overlayInputs];
  let fileUrl = null;
  let sourceKind = 'file';
  let loadedDuration = 0;
  let isBusy = false;
  let isMuted = false;
  let exportFrame = 0;
  let dragDepth = 0;

  function duration() { return loadedDuration || 0; }
  function startTime() { return Number(ui.trimStart.value) || 0; }
  function endTime() { return Number(ui.trimEnd.value) || 0; }
  function filterString() {
    return `brightness(${byId('brightness').value}%) contrast(${byId('contrast').value}%) saturate(${byId('saturation').value}%) sepia(${byId('sepia').value}%) hue-rotate(${byId('hue').value}deg) blur(${byId('blur').value}px)`;
  }
  function effectValue(id, value) {
    const suffix = id === 'hue' ? '°' : (id === 'blur' ? ' px' : '%');
    return `${value}${suffix}`;
  }
  function clearPresetSelection() {
    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
  }
  function clock(seconds, tenths = false) {
    const safe = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${tenths ? `.${Math.floor((safe % 1) * 10)}` : ''}`;
  }
  function setStatus(message) { ui.status.textContent = message; }
  function setPlayerPlaying(playing) {
    const icon = ui.play.querySelector('[data-icon]');
    if (icon) {
      icon.dataset.icon = playing ? 'pause' : 'play';
      delete icon.dataset.iconReady;
      window.EltesIcons.hydrate(ui.play);
    }
    ui.play.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
    ui.play.title = playing ? 'Pause video' : 'Play video';
  }
  function updateControls() {
    const hasVideo = Boolean(ui.video.src && duration() > 0);
    editableInputs.forEach((input) => { input.disabled = !hasVideo || isBusy; });
    ui.play.disabled = !hasVideo || isBusy;
    ui.mute.disabled = !hasVideo || isBusy;
    ui.scrubber.disabled = !hasVideo || isBusy;
    ui.export.disabled = !hasVideo || ui.video.readyState < 2 || isBusy;
    ui.resetLook.disabled = !hasVideo || isBusy;
    document.querySelectorAll('[data-preset]').forEach((button) => { button.disabled = !hasVideo || isBusy; });
    ui.videoUrl.disabled = isBusy;
    ui.loadUrl.disabled = isBusy;
    ui.replace.disabled = isBusy;
    ui.choose.disabled = isBusy;
  }
  function updateClock() {
    const t = Math.min(ui.video.currentTime || 0, duration());
    ui.time.textContent = `${clock(t, true)} / ${clock(duration())}`;
    if (!ui.scrubber.matches(':active')) ui.scrubber.value = String(t);
  }
  function updateTextOverlay() {
    const text = ui.text.value.trim();
    const isVisible = Boolean(text && duration() && ui.video.currentTime >= startTime() && ui.video.currentTime <= endTime());
    ui.layer.hidden = !isVisible;
    if (!isVisible) return;
    ui.caption.textContent = text;
    ui.layer.dataset.position = byId('overlayPosition').value;
    ui.layer.dataset.align = byId('overlayAlign').value;
    ui.layer.dataset.backdrop = byId('overlayBackdrop').value;
    ui.caption.style.fontFamily = byId('overlayFont').value;
    ui.caption.style.fontSize = `${byId('overlaySize').value}px`;
    ui.caption.style.color = byId('overlayColor').value;
  }
  function updatePreview() {
    ui.video.style.filter = filterString();
    const vignette = Number(ui.vignetteControl.value) / 100;
    ui.vignette.hidden = vignette <= 0;
    ui.vignette.style.opacity = String(vignette);
    updateTextOverlay();
    updateClock();
  }
  function enableEditor() {
    ui.empty.hidden = true;
    ui.video.controls = false;
    updateControls();
    updatePreview();
  }
  function acceptsVideo(file) {
    return file && (file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|ogv|ogg|mkv|avi)$/i.test(file.name));
  }
  function resetSourceState(name, kind) {
    ui.video.pause();
    sourceKind = kind;
    loadedDuration = 0;
    ui.empty.hidden = true;
    ui.sourceName.textContent = name;
    ui.trimStart.value = '0';
    ui.trimEnd.value = '0';
    ui.scrubber.value = '0';
  }
  function loadVideo(file) {
    if (!acceptsVideo(file)) {
      setStatus('Choose a video file your browser can play.');
      return;
    }
    if (isBusy) return;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    resetSourceState(file.name, 'file');
    ui.videoUrl.value = '';
    fileUrl = URL.createObjectURL(file);
    ui.video.crossOrigin = 'anonymous';
    ui.video.src = fileUrl;
    ui.videoInfo.textContent = 'LOADING VIDEO';
    ui.video.playbackRate = Number(ui.playbackSpeed.value);
    ui.video.load();
    updateControls();
    setStatus('Loading local video metadata…');
  }
  function loadVideoUrl(rawUrl) {
    if (isBusy) return;
    let parsed;
    try { parsed = new URL(rawUrl.trim()); } catch {
      setStatus('Enter a valid direct video URL, starting with https:// or http://.');
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      setStatus('Video URLs must use http:// or https:// and cannot contain account credentials.');
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = null;
    let displayName = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    try { displayName = decodeURIComponent(displayName); } catch { /* Keep the encoded path as a safe label. */ }
    resetSourceState(displayName, 'url');
    ui.videoUrl.value = parsed.href;
    ui.video.crossOrigin = 'anonymous';
    ui.video.referrerPolicy = 'no-referrer';
    ui.video.src = parsed.href;
    ui.videoInfo.textContent = 'LOADING REMOTE VIDEO';
    ui.video.playbackRate = Number(ui.playbackSpeed.value);
    ui.video.load();
    updateControls();
    setStatus(`Loading the video directly from ${parsed.hostname}. The host must allow browser CORS.`);
  }
  function openPicker() {
    if (!isBusy) ui.fileInput.click();
  }

  ui.choose.addEventListener('click', openPicker);
  ui.replace.addEventListener('click', openPicker);
  ui.urlForm.addEventListener('submit', (event) => {
    event.preventDefault();
    loadVideoUrl(ui.videoUrl.value);
  });
  ui.fileInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) loadVideo(file);
    event.target.value = '';
  });
  ui.video.addEventListener('loadedmetadata', () => {
    if (!Number.isFinite(ui.video.duration) || ui.video.duration <= 0) {
      loadedDuration = 0;
      ui.empty.hidden = false;
      ui.videoInfo.textContent = 'UNSUPPORTED VIDEO';
      updateControls();
      setStatus(sourceKind === 'url'
        ? 'That URL did not return a readable video. Use a direct media URL with CORS enabled, not a video webpage.'
        : 'This file has no readable duration. Try another browser-playable video.');
      return;
    }
    loadedDuration = ui.video.duration;
    ui.trimStart.min = '0';
    ui.trimStart.max = String(loadedDuration);
    ui.trimStart.value = '0';
    ui.trimEnd.min = '0';
    ui.trimEnd.max = String(loadedDuration);
    ui.trimEnd.value = String(loadedDuration.toFixed(1));
    ui.scrubber.min = '0';
    ui.scrubber.max = String(loadedDuration);
    ui.scrubber.value = '0';
    ui.video.currentTime = 0;
    const originLabel = sourceKind === 'url' ? 'REMOTE' : 'LOCAL';
    ui.videoInfo.textContent = `${originLabel} · ${ui.video.videoWidth} × ${ui.video.videoHeight} · ${clock(loadedDuration)}`;
    enableEditor();
    setStatus(sourceKind === 'url'
      ? 'Remote video loaded. The browser is connected directly to its host; edits and export run here.'
      : 'Adjust the range and look, then export your edited clip.');
  });
  ui.video.addEventListener('loadeddata', () => { updateControls(); updatePreview(); });
  ui.video.addEventListener('timeupdate', () => {
    if (!isBusy && !ui.video.paused && endTime() > startTime() && ui.video.currentTime >= endTime()) {
      ui.video.pause();
      ui.video.currentTime = endTime();
    }
    updatePreview();
    if (!isBusy) updateClock();
  });
  ui.video.addEventListener('seeked', updatePreview);
  ui.video.addEventListener('error', () => {
    if (!fileUrl && sourceKind !== 'url') return;
    loadedDuration = 0;
    ui.empty.hidden = false;
    ui.videoInfo.textContent = sourceKind === 'url' ? 'URL LOAD FAILED' : 'CANNOT PLAY FILE';
    updateControls();
    setStatus(sourceKind === 'url'
      ? 'Could not load that URL. Check that it is a direct video link and its host allows CORS; otherwise download the clip and choose the local file.'
      : 'This browser cannot decode that video. Try MP4 (H.264) or WebM.');
  });
  ui.video.addEventListener('ended', () => {
    if (!isBusy) setPlayerPlaying(false);
  });

  ui.play.addEventListener('click', async () => {
    if (isBusy || !duration()) return;
    if (ui.video.paused) {
      if (ui.video.currentTime < startTime() || ui.video.currentTime >= endTime()) ui.video.currentTime = startTime();
      try {
        await ui.video.play();
        setPlayerPlaying(true);
      } catch (error) {
        setStatus(`Playback failed: ${error.message || 'the browser could not start this video.'}`);
      }
    } else {
      ui.video.pause();
      setPlayerPlaying(false);
    }
  });
  ui.video.addEventListener('pause', () => {
    if (!isBusy) setPlayerPlaying(false);
  });
  ui.mute.addEventListener('click', () => {
    isMuted = !isMuted;
    ui.video.muted = isMuted;
    const icon = ui.mute.querySelector('[data-icon]');
    if (icon) { icon.dataset.icon = isMuted ? 'volume-x' : 'volume-2'; delete icon.dataset.iconReady; window.EltesIcons.hydrate(ui.mute); }
    ui.mute.setAttribute('aria-label', isMuted ? 'Unmute preview audio' : 'Mute preview audio');
    ui.mute.title = isMuted ? 'Unmute preview audio' : 'Mute preview audio';
  });
  ui.scrubber.addEventListener('input', () => {
    if (duration()) ui.video.currentTime = Number(ui.scrubber.value);
  });

  ui.trimStart.addEventListener('change', () => {
    const end = endTime();
    const start = Math.min(Math.max(0, Number(ui.trimStart.value) || 0), Math.max(0, end - 0.1));
    ui.trimStart.value = start.toFixed(1);
    if (ui.video.currentTime < start || ui.video.currentTime > end) ui.video.currentTime = start;
    updatePreview();
  });
  ui.trimEnd.addEventListener('change', () => {
    const start = startTime();
    const end = Math.min(duration(), Math.max(start + 0.1, Number(ui.trimEnd.value) || 0));
    ui.trimEnd.value = end.toFixed(1);
    if (ui.video.currentTime > end) ui.video.currentTime = end;
    updatePreview();
  });
  filterInputs.forEach((input) => input.addEventListener('input', () => {
    const output = byId(`${input.id}Value`);
    output.value = effectValue(input.id, input.value);
    output.textContent = effectValue(input.id, input.value);
    clearPresetSelection();
    updatePreview();
  }));
  ui.vignetteControl.addEventListener('input', () => {
    const output = byId('vignetteValue');
    output.value = `${ui.vignetteControl.value}%`;
    output.textContent = `${ui.vignetteControl.value}%`;
    clearPresetSelection();
    updatePreview();
  });
  const effectDefaults = { brightness: 100, contrast: 100, saturation: 100, sepia: 0, hue: 0, blur: 0, vignette: 0 };
  function applyLook(values, activePreset = '') {
    filterInputs.forEach((input, index) => {
      input.value = String(values[index]);
      const output = byId(`${input.id}Value`);
      output.value = effectValue(input.id, values[index]);
      output.textContent = effectValue(input.id, values[index]);
    });
    ui.vignetteControl.value = String(values[6]);
    byId('vignetteValue').value = `${values[6]}%`;
    byId('vignetteValue').textContent = `${values[6]}%`;
    document.querySelectorAll('[data-preset]').forEach((button) => {
      const active = button.dataset.preset === activePreset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updatePreview();
  }
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const presets = {
        none: [100, 100, 100, 0, 0, 0, 0],
        cinema: [96, 116, 91, 0, 0, 0, 24],
        mono: [100, 112, 0, 0, 0, 0, 0],
        warm: [103, 106, 116, 18, 350, 0, 14]
      };
      applyLook(presets[button.dataset.preset], button.dataset.preset);
    });
  });
  ui.resetLook.addEventListener('click', () => applyLook([
    effectDefaults.brightness, effectDefaults.contrast, effectDefaults.saturation,
    effectDefaults.sepia, effectDefaults.hue, effectDefaults.blur, effectDefaults.vignette
  ], 'none'));
  ui.playbackSpeed.addEventListener('change', () => {
    ui.video.playbackRate = Number(ui.playbackSpeed.value);
  });
  ui.text.addEventListener('input', updatePreview);
  overlayInputs.forEach((input) => input.addEventListener('change', updatePreview));
  overlayInputs.forEach((input) => input.addEventListener('input', updatePreview));

  ['dragenter', 'dragover'].forEach((name) => ui.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    if (isBusy) return;
    if (name === 'dragenter') dragDepth += 1;
    ui.dropZone.classList.add('dragging');
    ui.dropHint.hidden = false;
  }));
  ['dragleave', 'drop'].forEach((name) => ui.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    if (name === 'dragleave') dragDepth = Math.max(0, dragDepth - 1);
    if (name === 'drop') dragDepth = 0;
    if (dragDepth === 0 || name === 'drop') {
      ui.dropZone.classList.remove('dragging');
      ui.dropHint.hidden = true;
    }
    if (name === 'drop' && !isBusy) {
      const file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) loadVideo(file);
    }
  }));
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  function drawVignette(ctx, width, height) {
    const amount = Number(ui.vignetteControl.value) / 100;
    if (!amount) return;
    const centerX = width / 2;
    const centerY = height / 2;
    const gradient = ctx.createRadialGradient(centerX, centerY, Math.min(width, height) * 0.18, centerX, centerY, Math.hypot(width, height) * 0.58);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.62, `rgba(0, 0, 0, ${amount * 0.12})`);
    gradient.addColorStop(1, `rgba(0, 0, 0, ${amount * 0.82})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawCaption(ctx, width, height, displayHeight) {
    const text = ui.text.value.trim();
    if (!text || ui.video.currentTime < startTime() || ui.video.currentTime > endTime()) return;
    const scale = height / Math.max(1, displayHeight);
    const fontSize = Math.max(12, Number(byId('overlaySize').value) * scale);
    const lineHeight = fontSize * 1.17;
    const maxWidth = width * 0.86;
    const fontFamily = byId('overlayFont').value;
    const weight = 750;
    ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    });
    if (line) lines.push(line);
    ctx.textAlign = byId('overlayAlign').value;
    ctx.textBaseline = 'middle';
    const marginX = width * 0.08;
    const marginY = height * 0.07;
    const align = byId('overlayAlign').value;
    const x = align === 'left' ? marginX : (align === 'right' ? width - marginX : width / 2);
    const totalHeight = lineHeight * lines.length;
    const position = byId('overlayPosition').value;
    let firstY = position === 'top'
      ? marginY + lineHeight / 2
      : position === 'center'
        ? (height - totalHeight) / 2 + lineHeight / 2
        : height - marginY - totalHeight + lineHeight / 2;
    firstY = Math.max(lineHeight / 2, Math.min(height - totalHeight / 2, firstY));
    const lineWidths = lines.map((item) => ctx.measureText(item).width);
    const boxWidth = Math.min(maxWidth, Math.max(...lineWidths)) + fontSize * 0.56;
    const boxX = align === 'left' ? x - fontSize * 0.28 : align === 'right' ? x - boxWidth + fontSize * 0.28 : x - boxWidth / 2;
    const backdrop = byId('overlayBackdrop').value;
    if (backdrop === 'box') {
      const padY = fontSize * 0.18;
      const boxY = firstY - lineHeight / 2 - padY;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.66)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(boxX, boxY, boxWidth, totalHeight + padY * 2, fontSize * 0.12);
      else ctx.rect(boxX, boxY, boxWidth, totalHeight + padY * 2);
      ctx.fill();
    }
    ctx.fillStyle = byId('overlayColor').value;
    ctx.shadowColor = 'rgba(0, 0, 0, .88)';
    ctx.shadowBlur = backdrop === 'shadow' ? fontSize * 0.45 : 0;
    ctx.shadowOffsetY = backdrop === 'shadow' ? fontSize * 0.08 : 0;
    lines.forEach((item, index) => {
      const y = firstY + index * lineHeight;
      if (backdrop === 'outline') {
        ctx.lineWidth = Math.max(2, fontSize * 0.055);
        ctx.strokeStyle = '#07101b';
        ctx.lineJoin = 'round';
        ctx.strokeText(item, x, y, maxWidth);
      }
      ctx.fillText(item, x, y, maxWidth);
    });
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function waitForFrameData() {
    if (ui.video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('The browser did not decode a video frame in time.'));
      }, 10_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        ui.video.removeEventListener('loadeddata', onLoaded);
        ui.video.removeEventListener('error', onError);
      };
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('The browser could not decode this video.')); };
      ui.video.addEventListener('loadeddata', onLoaded, { once: true });
      ui.video.addEventListener('error', onError, { once: true });
    });
  }

  function waitForSeek(target) {
    if (Math.abs(ui.video.currentTime - target) < 0.04) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('The video could not seek to the selected start time.'));
      }, 8000);
      const cleanup = () => {
        window.clearTimeout(timer);
        ui.video.removeEventListener('seeked', onSeeked);
        ui.video.removeEventListener('error', onError);
      };
      const onSeeked = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('The video could not be decoded.')); };
      ui.video.addEventListener('seeked', onSeeked, { once: true });
      ui.video.addEventListener('error', onError, { once: true });
      ui.video.currentTime = target;
    });
  }

  ui.export.addEventListener('click', async () => {
    if (!duration() || isBusy) return;
    if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
      setStatus('Export is not supported in this browser. Try the latest Chrome, Edge, or Firefox.');
      return;
    }
    if (endTime() <= startTime()) {
      setStatus('Set an end time after the start time before exporting.');
      return;
    }

    isBusy = true;
    updateControls();
    ui.video.pause();
    ui.progressWrap.hidden = false;
    ui.progress.style.width = '0%';
    ui.progressLabel.textContent = 'Preparing export…';
    setStatus('Rendering on this device. Longer clips may take a while.');

    let sourceStream = null;
    let outputStream = null;
    let recorder = null;
    let audioAvailable = false;
    const mutedBeforeExport = ui.video.muted;
    const playbackRateBeforeExport = ui.video.playbackRate;
    let stopped = false;
    let chunks = [];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    const videoWidth = ui.video.videoWidth;
    const videoHeight = ui.video.videoHeight;
    if (!context || !videoWidth || !videoHeight) {
      isBusy = false;
      setPlayerPlaying(false);
      updateControls();
      ui.progressWrap.hidden = true;
      setStatus('This video could not be prepared for export. Try another file.');
      return;
    }
    const scale = Math.min(1, 1920 / videoWidth, 1920 / videoHeight);
    canvas.width = Math.max(2, Math.floor(videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.floor(videoHeight * scale / 2) * 2);
    const displayHeight = Math.min(ui.dropZone.clientHeight, ui.dropZone.clientWidth * videoHeight / videoWidth);
    const canvasFilter = filterString();

    const cleanup = () => {
      if (exportFrame) cancelAnimationFrame(exportFrame);
      exportFrame = 0;
      if (sourceStream) sourceStream.getTracks().forEach((track) => track.stop());
      if (outputStream) outputStream.getTracks().forEach((track) => track.stop());
      ui.video.pause();
      setPlayerPlaying(false);
      ui.video.muted = mutedBeforeExport;
      ui.video.playbackRate = playbackRateBeforeExport;
      isBusy = false;
      updateControls();
    };
    const finish = (errorMessage = '') => {
      if (stopped) return;
      stopped = true;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (error) { cleanup(); setStatus(errorMessage || `Export failed: ${error.message}`); }
      } else {
        cleanup();
        if (errorMessage) setStatus(errorMessage);
      }
    };
    const renderFrame = () => {
      context.save();
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.filter = canvasFilter;
      context.drawImage(ui.video, 0, 0, canvas.width, canvas.height);
      context.restore();
      drawVignette(context, canvas.width, canvas.height);
      drawCaption(context, canvas.width, canvas.height, displayHeight);
    };

    try {
      await waitForFrameData();
      await waitForSeek(startTime());
      renderFrame();
      const canvasStream = canvas.captureStream(30);
      outputStream = canvasStream;
      ui.video.muted = false;
      const capture = ui.video.captureStream || ui.video.mozCaptureStream;
      if (typeof capture === 'function') {
        sourceStream = capture.call(ui.video);
        const audioTracks = sourceStream.getAudioTracks();
        audioAvailable = audioTracks.length > 0;
        audioTracks.forEach((track) => outputStream.addTrack(track));
        sourceStream.getVideoTracks().forEach((track) => track.stop());
      }
      const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
        ? mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type))
        : undefined;
      const high = ui.quality.value === 'high';
      const options = {};
      if (mimeType) options.mimeType = mimeType;
      options.videoBitsPerSecond = high ? 12_000_000 : 5_000_000;
      options.audioBitsPerSecond = high ? 192_000 : 128_000;
      recorder = new MediaRecorder(outputStream, options);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener('error', (event) => {
        finish(`Export failed: ${event.error?.message || 'the browser recorder encountered an error.'}`);
      });
      recorder.addEventListener('stop', () => {
        cleanup();
        ui.progressWrap.hidden = true;
        if (!chunks.length) {
          setStatus('The browser produced an empty export. Try a different browser or source format.');
          return;
        }
        const contentType = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(chunks, { type: contentType });
        const extension = contentType.includes('mp4') ? 'mp4' : 'webm';
        const base = (ui.sourceName.textContent || 'eltes-video').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'eltes-video';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${base}-edited.${extension}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        ui.progress.style.width = '100%';
        setStatus(`Export complete. Downloaded ${a.download}.`);
        chunks = [];
      }, { once: true });
      recorder.start(250);
      ui.video.playbackRate = Number(ui.playbackSpeed.value);
      await ui.video.play();
      const audioNotice = audioAvailable ? '' : ' No audio track is available to the browser recorder, so this export may be silent.';
      setStatus(`Rendering and recording your selected range…${audioNotice}`);
      const tick = () => {
        if (!isBusy || !recorder || recorder.state === 'inactive') return;
        renderFrame();
        const progress = Math.max(0, Math.min(100, ((ui.video.currentTime - startTime()) / (endTime() - startTime())) * 100));
        ui.progress.style.width = `${progress}%`;
        ui.progressLabel.textContent = `Rendering… ${Math.round(progress)}%`;
        if (ui.video.currentTime >= endTime() || ui.video.ended) {
          finish();
          return;
        }
        exportFrame = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      const message = sourceKind === 'url' && error.name === 'SecurityError'
        ? 'This video host does not allow canvas export from this page (CORS). Try another direct media URL or download the clip and load it locally.'
        : `Export failed: ${error.message || 'the browser could not render this file.'}`;
      finish(message);
      ui.progressWrap.hidden = true;
      if (!recorder || recorder.state === 'inactive') cleanup();
    }
  });

  updateControls();
})();
