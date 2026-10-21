/* ==========================================================================
   Eltes Lab — page controller
   Drives train.html: the training scheduler, the loss chart, sampling and the
   memorisation test. All of the maths lives in lab.js; this file is the UI and
   never invents a number — every readout comes from a model in this tab.
   ========================================================================== */

(function () {
  'use strict';

  const Lab = window.EltesLab;
  if (!Lab) return;

  const $ = (id) => document.getElementById(id);
  const CORPUS_HINTS = {
    eltes: 'Product copy and documentation. Teaches the model English sentences and UI vocabulary.',
    prose: 'A short story. Richer sentences and punctuation, a harder vocabulary to predict.',
    code: 'HTML, CSS and JavaScript from the interface. Teaches brackets, tags and indentation.'
  };

  const state = {
    model: null,
    series: [],
    training: false,
    stop: false,
    paused: false,
    timer: null,
    startedAt: 0,
    elapsed: 0,
    total: 1500,
    batch: 24,
    lr: 0.003,
    evalEvery: 50,
    setup: null,
    best: null,
    lastStatusAt: 0,
    memo: { model: null, running: false, stop: false, text: '' }
  };

  /* -------------------------------- helpers -------------------------------- */

  const num = (id, fallback) => {
    const value = parseFloat($(id).value);
    return Number.isFinite(value) ? value : fallback;
  };

  function fmt(n, digits) {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  /* Levenshtein ratio, two rows: how close two strings are, 0…1. */
  function similarity(a, b) {
    if (!a.length || !b.length) return 0;
    let prev = new Array(b.length + 1);
    let next = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1) prev[j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      next[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
      }
      const swap = prev;
      prev = next;
      next = swap;
    }
    return 1 - prev[b.length] / Math.max(a.length, b.length);
  }

  function setStatus(el, text, mode) {
    const status = $(el);
    const label = $(el + 'Text');
    status.classList.remove('is-live', 'is-done');
    if (mode) status.classList.add('is-' + mode);
    if (label) label.textContent = text;
    else status.textContent = text;
  }

  /* --------------------------------- chart --------------------------------- */

  const chart = {
    canvas: null,
    ctx: null,
    w: 0,
    h: 0,
    dpr: 1
  };

  function initChart() {
    chart.canvas = $('lossChart');
    if (!chart.canvas) return;
    chart.ctx = chart.canvas.getContext('2d');
    resizeChart();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resizeChart).observe(chart.canvas.parentElement);
    } else {
      window.addEventListener('resize', resizeChart);
    }
    drawChart();
  }

  function resizeChart() {
    const canvas = chart.canvas;
    if (!canvas || !chart.ctx) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    chart.dpr = Math.min(2, window.devicePixelRatio || 1);
    chart.w = Math.max(320, Math.floor(rect.width - 16));
    chart.h = Math.max(180, Math.floor(rect.height - 6));
    canvas.width = Math.floor(chart.w * chart.dpr);
    canvas.height = Math.floor(chart.h * chart.dpr);
    chart.ctx.setTransform(chart.dpr, 0, 0, chart.dpr, 0, 0);
    drawChart();
  }

  function drawChart() {
    const ctx = chart.ctx;
    if (!ctx) return;
    const { w, h } = chart;
    ctx.clearRect(0, 0, w, h);

    const pad = { left: 40, right: 14, top: 14, bottom: 24 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const points = state.series;
    let min = Infinity;
    let max = -Infinity;
    points.forEach((p) => {
      [p.train, p.val].forEach((v) => {
        if (v == null || !Number.isFinite(v)) return;
        if (v < min) min = v;
        if (v > max) max = v;
      });
    });
    if (!Number.isFinite(min)) { min = 0; max = 4; }
    if (max - min < 0.6) { const mid = (max + min) / 2; min = mid - 0.3; max = mid + 0.3; }
    const span = max - min;
    min = Math.max(0, min - span * 0.12);
    max = max + span * 0.12;

    const xMax = Math.max(50, state.total || 1500);
    const X = (step) => pad.left + (step / xMax) * plotW;
    const Y = (loss) => pad.top + plotH - ((loss - min) / (max - min)) * plotH;

    /* grid + labels */
    ctx.save();
    ctx.strokeStyle = 'rgba(150, 185, 250, 0.09)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(140, 158, 186, 0.7)';
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const rows = 4;
    for (let i = 0; i <= rows; i += 1) {
      const y = pad.top + (plotH / rows) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y + 0.5);
      ctx.lineTo(pad.left + plotW, y + 0.5);
      ctx.stroke();
      const value = max - ((max - min) / rows) * i;
      ctx.fillText(value.toFixed(2), pad.left - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const cols = 5;
    for (let i = 0; i <= cols; i += 1) {
      const step = Math.round((xMax / cols) * i);
      const x = X(step);
      ctx.fillStyle = 'rgba(140, 158, 186, 0.55)';
      ctx.fillText(String(step), x, pad.top + plotH + 8);
      ctx.strokeStyle = 'rgba(150, 185, 250, 0.05)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, pad.top);
      ctx.lineTo(x + 0.5, pad.top + plotH);
      ctx.stroke();
    }
    ctx.restore();

    if (!points.length) return;

    const line = (key, color, width, dash) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      points.forEach((p) => {
        const v = p[key];
        if (v == null || !Number.isFinite(v)) return;
        const x = X(p.step);
        const y = Y(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
      return started;
    };

    /* soft area under the training curve */
    const firstTrain = points.find((p) => p.train != null);
    if (firstTrain) {
      ctx.save();
      ctx.beginPath();
      let started = false;
      points.forEach((p) => {
        if (p.train == null) return;
        const x = X(p.step);
        const y = Y(p.train);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      const last = [...points].reverse().find((p) => p.train != null);
      ctx.lineTo(X(last.step), pad.top + plotH);
      ctx.lineTo(X(firstTrain.step), pad.top + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
      grad.addColorStop(0, 'rgba(255, 155, 82, 0.18)');
      grad.addColorStop(1, 'rgba(255, 155, 82, 0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    line('train', '#ff9b52', 1.9, null);
    const hasVal = line('val', '#46d3ff', 1.5, [4, 3]);

    /* end labels */
    const withTrain = points.filter((p) => p.train != null);
    if (withTrain.length) {
      const last = withTrain[withTrain.length - 1];
      ctx.save();
      ctx.fillStyle = '#ffb87f';
      ctx.beginPath();
      ctx.arc(X(last.step), Y(last.train), 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (state.best) {
      ctx.save();
      ctx.strokeStyle = 'rgba(70, 211, 255, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(X(state.best.step), Y(state.best.loss), 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const withVal = points.filter((p) => p.val != null);
    if (hasVal && withVal.length) {
      const last = withVal[withVal.length - 1];
      ctx.save();
      ctx.fillStyle = '#46d3ff';
      ctx.beginPath();
      ctx.arc(X(last.step), Y(last.val), 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ------------------------------- readouts -------------------------------- */

  function renderStats() {
    const model = state.model;
    $('statStep').textContent = fmt(model ? model.step : 0);
    $('statTokens').textContent = fmt(model ? model.tokens : 0);
    $('statLoss').textContent = model && model.lastLoss != null ? model.lastLoss.toFixed(3) : '—';
    $('statVal').textContent = model && model.lastValLoss != null ? model.lastValLoss.toFixed(3) : '—';
    const basis = model && model.lastValLoss != null ? model.lastValLoss : (model ? model.lastLoss : null);
    $('statPpl').textContent = basis != null ? Math.exp(basis).toFixed(1) : '—';
    const perStep = state.elapsed && model && model.step ? state.elapsed / model.step : null;
    $('statSpeed').innerHTML = perStep != null ? perStep.toFixed(1) + '<small>ms</small>' : '—<small>ms</small>';
    $('progressBar').style.width = model && state.total ? Math.min(100, (model.step / state.total) * 100) + '%' : '0%';
    $('progress').classList.toggle('is-idle', !model || !model.step);
    $('chartMeta').textContent = model
      ? `${fmt(model.step)} steps · ${fmt(Lab.paramCount(model))} params · vocab ${model.vocab.length}`
      : 'no run yet';
    $('legendMeta').textContent = model
      ? (state.best
        ? `best val ${state.best.loss.toFixed(2)} @ ${fmt(state.best.step)} · ${Lab.paramCount(model).toLocaleString()} weights`
        : `${Lab.paramCount(model).toLocaleString()} weights · ${model.textLength.toLocaleString()} chars of corpus`)
      : '—';
    $('chartEmpty').classList.toggle('is-hidden', state.series.length > 0);
  }

  function enableSampling(on) {
    $('generateBtn').disabled = !on;
    $('saveBtn').disabled = !on;
    $('sampleMeta').textContent = on ? 'ready' : 'waiting for a model';
  }

  /* ------------------------------- training -------------------------------- */

  function readSetup() {
    const corpusId = $('corpus').value;
    const corpus = Lab.CORPORA.find((c) => c.id === corpusId) || Lab.CORPORA[0];
    return {
      corpus,
      steps: Math.max(100, Math.min(6000, Math.round(num('steps', 1500)))),
      seed: Math.max(1, Math.round(num('seed', 7))),
      context: Math.max(4, Math.min(32, Math.round(num('context', 14)))),
      embedding: Math.max(8, Math.min(64, Math.round(num('embedding', 24)))),
      hidden: Math.max(16, Math.min(384, Math.round(num('hidden', 128)))),
      batch: Math.max(4, Math.min(64, Math.round(num('batch', 24)))),
      lr: Math.max(0.0001, Math.min(0.05, num('lr', 0.003))),
      dropout: Math.max(0, Math.min(0.5, num('dropout', 0.1)))
    };
  }

  function startTraining() {
    if (state.training) return;

    /* Pressing Resume keeps the live model and its optimiser state. A fresh run
       (after a completed run, or after loading a snapshot) builds a new model:
       a deserialised checkpoint has no corpus bytes, so it can be sampled but
       never trained further. */
    if (state.paused && state.model && state.model.step > 0 && state.model.step < state.total) {
      state.paused = false;
      state.stop = false;
      state.training = true;
      state.startedAt = performance.now() - state.elapsed;
      $('trainBtn').disabled = true;
      $('stopBtn').disabled = false;
      enableSampling(false);
      $('trainLabel').textContent = 'Training…';
      setStatus('trainStatus', `Resuming from step ${fmt(state.model.step)} of ${fmt(state.total)}.`, 'live');
      state.timer = setTimeout(tickTraining, 0);
      return;
    }

    const setup = readSetup();
    state.setup = setup;
    state.total = setup.steps;
    state.batch = setup.batch;
    state.lr = setup.lr;
    state.series = [];
    state.stop = false;
    state.paused = false;
    state.elapsed = 0;
    state.best = null;
    state.lastStatusAt = 0;
    state.model = Lab.createModel({
      corpus: setup.corpus,
      seed: setup.seed,
      context: setup.context,
      embedding: setup.embedding,
      hidden: setup.hidden,
      dropout: setup.dropout
    });
    state.model.corpora = setup.corpus.id;
    state.model.textLength = setup.corpus.text.length;
    enableSampling(false);
    $('trainBtn').disabled = true;
    $('stopBtn').disabled = false;
    $('trainLabel').textContent = 'Training…';
    $('sampleEmpty').hidden = false;
    $('sampleOut').hidden = true;
    setStatus('trainStatus', `Training on ${setup.corpus.name} — step 0 of ${fmt(state.total)}.`, 'live');
    state.training = true;
    state.startedAt = performance.now();
    renderStats();
    drawChart();
    state.timer = setTimeout(tickTraining, 0);
  }

  function tickTraining() {
    if (!state.model) return;
    const started = performance.now();
    const model = state.model;
    let lastVal = null;

    /* A slice of ~40 ms of work keeps the tab at interactive frame rates. */
    while (!state.stop && model.step < state.total && performance.now() - started < 40) {
      model.trainStep({ batch: state.batch, lr: state.lr });
      if (model.step % 5 === 0) {
        state.series.push({ step: model.step, train: model.lastLoss, val: null });
      }
      if (model.step % state.evalEvery === 0) {
        lastVal = model.evaluate();
        if (lastVal != null && (!state.best || lastVal < state.best.loss)) state.best = { loss: lastVal, step: model.step };
        const point = state.series[state.series.length - 1];
        if (point && point.step === model.step) point.val = lastVal;
        else state.series.push({ step: model.step, train: model.lastLoss, val: lastVal });
      }
    }

    state.elapsed = performance.now() - state.startedAt;
    renderStats();
    drawChart();

    if (model.step < state.total && !state.stop) {
      /* the status region is aria-live: update it a few times a second, not per slice */
      const now = performance.now();
      if (!state.lastStatusAt || now - state.lastStatusAt > 320) {
        state.lastStatusAt = now;
        setStatus('trainStatus', `Training — step ${fmt(model.step)} of ${fmt(state.total)} · loss ${model.lastLoss.toFixed(3)}${lastVal != null ? ` · val ${lastVal.toFixed(3)}` : ''}`, 'live');
      }
      state.timer = setTimeout(tickTraining, 0);
      return;
    }
    finishTraining();
  }

  function finishTraining() {
    const model = state.model;
    state.training = false;
    state.elapsed = performance.now() - state.startedAt;
    const complete = !!(model && model.step >= state.total);
    state.paused = !complete;
    $('trainBtn').disabled = false;
    $('stopBtn').disabled = true;
    $('trainLabel').textContent = complete ? 'Train again' : 'Resume';
    if (!model || !model.step) { setStatus('trainStatus', 'Idle — nothing trained yet.', null); return; }

    /* one last validation pass so the readout matches the final weights */
    if (model.trainEnd && model.trainEnd < model.data.length - model.config.context - 2) {
      model.evaluate();
      const point = state.series[state.series.length - 1];
      if (point && point.step === model.step) point.val = model.lastValLoss;
    }
    state.elapsed = performance.now() - state.startedAt;
    renderStats();
    drawChart();
    enableSampling(true);
    const seconds = (state.elapsed / 1000).toFixed(1);
    const hitMax = model.step >= state.total;
    setStatus(
      'trainStatus',
      `${hitMax ? 'Trained' : 'Stopped at'} ${fmt(model.step)} steps in ${seconds} s · ${(state.elapsed / model.step).toFixed(1)} ms/step · train ${model.lastLoss.toFixed(3)}${model.lastValLoss != null ? ` · val ${model.lastValLoss.toFixed(3)}` : ''}`,
      'done'
    );
    /* show something straight away so the limits are visible, not hidden */
    generate({ quiet: true, instant: true });
  }

  /* -------------------------------- sampling ------------------------------- */

  let generating = false;

  function generate(options = {}) {
    if (!state.model || !state.model.step || generating) return;
    generating = true;
    const prompt = $('prompt').value || '';
    const length = Math.round(num('length', 240));
    $('generateLabel').textContent = 'Generating…';
    $('generateBtn').disabled = true;
    $('sampleEmpty').hidden = true;
    const out = $('sampleOut');
    out.hidden = false;
    out.innerHTML = '';
    const echo = document.createElement('span');
    echo.className = 'prompt-echo';
    echo.textContent = prompt;
    out.appendChild(echo);
    const body = document.createElement('span');
    out.appendChild(body);
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    out.appendChild(cursor);

    const text = state.model.sample({
      prompt,
      length,
      temperature: num('temperature', 0.7),
      topK: Math.round(num('topK', 12))
    });

    /* reveal in chunks; the text is already generated, this is just legibility.
       The sample after training lands at once, so the console never swallows a click. */
    let i = 0;
    const chunk = options.instant ? text.length : Math.max(2, Math.round(text.length / 90));
    const started = performance.now();
    const paint = () => {
      i = Math.min(text.length, i + chunk);
      body.textContent = text.slice(0, i);
      if (i < text.length) {
        requestAnimationFrame(paint);
        return;
      }
      cursor.remove();
      generating = false;
      $('generateLabel').textContent = 'Generate again';
      $('generateBtn').disabled = false;
      $('copyBtn').disabled = false;
      const ms = Math.round(performance.now() - started);
      $('sampleFoot').textContent = `${text.length} chars · ${ms} ms · T ${num('temperature', 0.7).toFixed(2)} · top-k ${Math.round(num('topK', 12))}`;
      if (options.quiet) {
        /* a gentle nudge toward the honest section after the first sample */
        $('sampleFoot').textContent += ' · read the limits →';
      }
    };
    requestAnimationFrame(paint);
  }

  /* ------------------------------- checkpoint ------------------------------ */

  function savedBytes() {
    try {
      return JSON.stringify(Lab.serialize(state.model)).length;
    } catch (error) {
      return 0;
    }
  }

  function renderSaved(prefix) {
    const raw = (() => {
      try { return localStorage.getItem(Lab.STORAGE_KEY); } catch (error) { return null; }
    })();
    const pill = $('savedPill');
    const text = $('savedText');
    if (!raw) {
      pill.textContent = 'No checkpoint';
      pill.classList.remove('is-live');
      text.textContent = 'Train a model, then save it to this browser. The chat can then answer as Eltes Lab-1.';
      return;
    }
    let saved = null;
    try { saved = JSON.parse(raw); } catch (error) { saved = null; }
    if (!saved) {
      pill.textContent = 'Unreadable';
      pill.classList.remove('is-live');
      text.textContent = 'The stored checkpoint could not be parsed. Delete it and train again.';
      return;
    }
    pill.textContent = 'Saved';
    pill.classList.add('is-live');
    const params = Object.values(saved.weights || {}).reduce((sum, b64) => sum + Math.floor((b64.length * 3) / 4 / 4), 0);
    const corpus = (Lab.CORPORA.find((c) => c.id === saved.corpus) || {}).name || 'custom text';
    const kb = Math.round(raw.length / 1024);
    text.textContent = `${prefix ? prefix + ' · ' : ''}${params.toLocaleString()} params · trained on ${corpus} · ${fmt(saved.step)} steps · val loss ${saved.valLoss != null ? saved.valLoss.toFixed(3) : '—'} · ${kb} KB · press Load saved to sample from it.`;
  }

  function saveModel() {
    if (!state.model) return;
    state.model.history = state.series.slice(-160).map((p) => ({ step: p.step, train: p.train, val: p.val }));
    const ok = Lab.save(state.model);
    if (!ok) {
      $('savedPill').textContent = 'Blocked';
      $('savedText').textContent = 'This browser refused localStorage (private mode or storage full). The model is still live on this page.';
      return;
    }
    renderSaved('Saved just now');
  }

  function loadModel() {
    const model = Lab.load();
    if (!model) {
      $('savedText').textContent = 'There is no saved model in this browser yet. Train one and press Save model.';
      return;
    }
    state.model = model;
    state.best = model.lastValLoss != null ? { loss: model.lastValLoss, step: model.step } : null;
    state.total = Math.max(100, model.step || 1500);
    state.series = Array.isArray(model.history) && model.history.length
      ? model.history.filter((p) => p && typeof p.step === 'number')
      : [{ step: model.step, train: model.lastLoss, val: model.lastValLoss }];
    if (!state.series.length) state.series = [{ step: model.step, train: model.lastLoss, val: model.lastValLoss }];
    $('steps').value = String(state.total);
    $('context').value = String(model.config.context);
    $('embedding').value = String(model.config.embedding);
    $('hidden').value = String(model.config.hidden);
    state.paused = false;
    enableSampling(!!model.step);
    $('trainLabel').textContent = 'Train again';
    renderStats();
    resizeChart();
    setStatus('trainStatus', `Loaded a saved checkpoint — ${fmt(model.step)} steps, val loss ${model.lastValLoss != null ? model.lastValLoss.toFixed(3) : '—'}. Sample from it, or press Train again for a fresh run.`, 'done');
    $('sampleEmpty').hidden = false;
    $('sampleOut').hidden = true;
    $('generateLabel').textContent = 'Generate';
    $('sampleFoot').textContent = '';
  }

  /* ------------------------------- memorise -------------------------------- */

  function startMemo() {
    if (state.memo.running) return;
    const text = $('memoText').value.trim();
    if (text.length < 40) {
      setStatus('memoStatus', 'Give it at least a sentence — 40 characters or more.', null);
      return;
    }
    const steps = Math.max(300, Math.min(3000, Math.round(num('memoSteps', 1400))));
    const seed = Math.max(1, Math.round(num('memoSeed', 3)));
    const model = Lab.createModel({
      text: (text + '\n').repeat(24),
      seed,
      context: 16,
      embedding: 24,
      hidden: 128,
      dropout: 0
    });
    state.memo = { model, running: true, stop: false, text, steps, done: 0 };
    $('memoBtn').disabled = true;
    $('memoStopBtn').disabled = false;
    $('memoLabel').textContent = 'Memorising…';
    $('memoOut').textContent = 'Training…';
    $('memoMatch').textContent = '—';
    $('memoMatchBar').style.width = '0%';
    setStatus('memoStatus', `Training on the paragraph ×24 — step 0 of ${fmt(steps)}.`, 'live');
    setTimeout(tickMemo, 0);
  }

  function tickMemo() {
    const memo = state.memo;
    if (!memo.model || !memo.running) return;
    const started = performance.now();
    while (!memo.stop && memo.model.step < memo.steps && performance.now() - started < 40) {
      memo.model.trainStep({ batch: 24, lr: 0.004 });
    }
    const pct = Math.min(100, (memo.model.step / memo.steps) * 100);
    $('memoBar').style.width = pct + '%';
    $('memoMeta').textContent = `loss ${memo.model.lastLoss != null ? memo.model.lastLoss.toFixed(5) : '—'}`;
    if (memo.model.step < memo.steps && !memo.stop) {
      setStatus('memoStatus', `Memorising — step ${fmt(memo.model.step)} of ${fmt(memo.steps)} · loss ${memo.model.lastLoss.toFixed(4)}`, 'live');
      setTimeout(tickMemo, 0);
      return;
    }
    finishMemo();
  }

  function finishMemo() {
    const memo = state.memo;
    memo.running = false;
    $('memoBtn').disabled = false;
    $('memoStopBtn').disabled = true;
    $('memoLabel').textContent = 'Memorise again';

    /* one more validation-free readout, then recite with almost no randomness */
    const text = memo.text;
    const prompt = text.slice(0, Math.min(32, Math.max(8, Math.floor(text.length / 6))));
    const length = Math.min(600, text.length + 40);
    const recital = memo.model.sample({
      prompt,
      length,
      temperature: 0.12,
      topK: 1,
      topP: 1,
      penalty: 0,
      random: (function () { let s = 1234567; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })()
    });
    const target = text.slice(prompt.length, prompt.length + recital.length);
    const score = similarity(recital, target);
    $('memoOut').textContent = recital;
    $('memoMatch').textContent = Math.round(score * 100) + '%';
    $('memoMatchBar').style.width = Math.round(score * 100) + '%';
    $('memoMeta').textContent = `loss ${memo.model.lastLoss != null ? memo.model.lastLoss.toFixed(5) : '—'}`;
    const loss = memo.model.lastLoss != null ? memo.model.lastLoss.toFixed(4) : '—';
    setStatus('memoStatus', `Trained ${fmt(memo.model.step)} steps · final loss ${loss} · ${Math.round(score * 100)}% character match.`, 'done');
  }

  /* -------------------------------- wiring --------------------------------- */

  function bind() {
    $('corpus').addEventListener('change', () => {
      $('corpusHint').textContent = CORPUS_HINTS[$('corpus').value] || '';
    });
    $('resetSetup').addEventListener('click', () => {
      $('corpus').value = 'eltes';
      $('corpusHint').textContent = CORPUS_HINTS.eltes;
      $('steps').value = '1500';
      $('seed').value = '7';
      $('context').value = '14';
      $('embedding').value = '24';
      $('hidden').value = '128';
      $('batch').value = '24';
      $('lr').value = '0.003';
      $('dropout').value = '0.1';
    });

    $('trainBtn').addEventListener('click', startTraining);
    $('stopBtn').addEventListener('click', () => {
      state.stop = true;
      setStatus('trainStatus', 'Stopping after this slice…', 'live');
    });

    $('generateBtn').addEventListener('click', () => generate());
    $('copyBtn').addEventListener('click', async () => {
      const text = $('sampleOut').textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        $('copyBtn').textContent = 'Copied';
        setTimeout(() => { $('copyBtn').innerHTML = '<span data-icon="copy" data-icon-size="13"></span>Copy'; if (window.EltesIcons) window.EltesIcons.hydrate($('copyBtn')); }, 1400);
      } catch (error) {
        $('copyBtn').textContent = 'Copy failed';
      }
    });

    $('temperature').addEventListener('input', (e) => { $('temperatureOut').textContent = Number(e.target.value).toFixed(2); });
    $('topK').addEventListener('input', (e) => { $('topKOut').textContent = e.target.value; });
    $('length').addEventListener('input', (e) => { $('lengthOut').textContent = e.target.value; });

    $('saveBtn').addEventListener('click', saveModel);
    $('loadBtn').addEventListener('click', loadModel);
    $('clearBtn').addEventListener('click', () => {
      Lab.clearSaved();
      renderSaved();
      $('savedPill').textContent = 'Deleted';
      $('savedText').textContent = 'Checkpoint removed. The model on this page is untouched until you reload.';
    });

    $('memoBtn').addEventListener('click', startMemo);
    $('memoStopBtn').addEventListener('click', () => { state.memo.stop = true; });
    $('memoText').addEventListener('input', () => {
      $('memoChars').textContent = $('memoText').value.length + ' chars';
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state.model && !$('generateBtn').disabled) {
        e.preventDefault();
        generate();
      }
    });
  }

  function init() {
    initChart();
    bind();
    $('memoChars').textContent = $('memoText').value.length + ' chars';
    $('temperatureOut').textContent = Number($('temperature').value).toFixed(2);
    $('topKOut').textContent = $('topK').value;
    $('lengthOut').textContent = $('length').value;
    renderStats();
    renderSaved();
    enableSampling(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
