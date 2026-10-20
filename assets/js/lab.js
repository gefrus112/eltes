/* ==========================================================================
   Eltes Lab — a small language model that trains in the browser.
   --------------------------------------------------------------------------
   This is a real neural network, not a demo animation. A character-level
   language model with:

     • a learned embedding for each of the last N characters
     • one tanh hidden layer
     • a softmax over the vocabulary
     • cross-entropy loss, full backpropagation and Adam

   It is small on purpose — tens of thousands of parameters, not billions —
   so the whole forward pass, backward pass and update fit comfortably in a
   browser tab and converge in seconds. It learns spelling, rhythm and short
   range structure. It cannot follow instructions, reason or recall facts.

   Exposed as window.EltesLab, and as a CommonJS module for the Node tests.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.EltesLab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* -------------------------------- corpora ------------------------------- */

  const CORPORA = [
    {
      id: 'eltes',
      name: 'Eltes handbook',
      note: 'Product copy about the workspace, models, search and Studio. The default.',
      text: `Eltes is a workspace for the models you already trust. You bring a key, choose a model, and keep every conversation in this browser. There is no account to create and no middle server in the path.

The workspace holds sixty-six model routes across fourteen providers. Claude, GPT, Gemini, DeepSeek, Grok, Kimi, Qwen, Llama and more sit in one picker, each with its own context window, price, tool support and streaming behaviour. Switching models does not split the thread: the same conversation continues, and every reply records which model wrote it.

Web search is a chip, not a separate product. Turn it on and the next question goes to Brave, Tavily, Serper or Exa through your own search key. Results come back as numbered sources, and the answer cites them inline. Every citation points at a real URL that you can open, and the sources list sits under the reply.

On-device, the CAI engine answers questions about Eltes itself. It handles setup, keys, model choice, arithmetic, units, dates and glossary terms without touching the network. It is deterministic and it is small; when it does not know, it says so instead of inventing an answer.

Studio is the build half of the workspace. It opens a real folder on your machine, shows the file tree, edits files, and runs a Linux shell in the pane beside the preview. A starter project is created on first run: an index page, a stylesheet, a script, notes and a build script. Run the build and the dist folder is written for you.

The interface is Obsidian: true black surfaces, silver accents and no blue in the shell. Graphite remains for anyone who prefers a softer grey. Both themes are tokens, so the whole shell changes from one block, and the choice is remembered in this browser.

The site you are reading floats in front of a galaxy. Two canvases paint it: one static layer with a Milky Way, a spiral galaxy, a globular cluster, an edge-on galaxy and coloured nebulae; one live layer of stars that drift, twinkle and stretch into short warp trails when you scroll. The new-chat screen adds warm orange embers that follow the pointer.

Nothing here is uploaded. Keys live in local storage, conversations live in local storage, and the only network requests are the ones you make to a provider or a search API. Clear the browser data and the workspace is empty again.
`
    },
    {
      id: 'prose',
      name: 'The long night',
      note: 'Original descriptive prose with long sentences and steady rhythm.',
      text: `The night came down slowly over the valley, first as a thinning of the light behind the western ridge, then as a blue hour that turned every roof and wall to a single soft shape. Lanterns came on one by one. A dog barked twice and thought better of it.

Above the ridge the sky was enormous. The first stars appeared where the blue was deepest, small and uncertain, and then the field filled in as the eye adjusted. By midnight the whole arch was visible, a river of pale light running from the hills to the sea, and the darker lanes inside it looked like a path cut through cloud.

She walked out to the edge of the field where the grass was short and the wind came clean off the water. The air smelled of dust and salt. Somewhere below her a gate creaked and then was still. She lay back on the warm ground and let the sky do the work of the evening, which is to say she stopped thinking about the day and began to notice small things instead.

A meteor fell, quickly, without drama, and was gone before she could point at it. Another followed a minute later. The longer she watched the more she saw, until the whole sky seemed to be moving very slightly, the way a crowd moves when it breathes. It was not a metaphor. The planet was turning, and she was riding it, and the stars were exactly where they had always been.

Near dawn the air grew colder and the eastern horizon turned grey, then silver, then a thin band of orange that spread like a stain through cloth. The stars went out in the order they had arrived, the brightest last. Birds began, cautiously, one voice and then a dozen. She stood up stiffly and walked back through the wet grass toward the house, and the morning was already ordinary and warm and loud.
`
    },
    {
      id: 'code',
      name: 'Interface code',
      note: 'HTML, CSS and JavaScript with indentation, punctuation and identifiers.',
      text: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Night sky</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body class="galaxy-page">
  <main class="wrap">
    <h1 class="title">A small sky</h1>
    <p class="lede">Every star is computed, not downloaded.</p>
    <button class="btn btn-primary" type="button" id="start">Start</button>
  </main>
  <canvas id="sky" aria-hidden="true"></canvas>
  <script src="sky.js"></script>
</body>
</html>

body {
  margin: 0;
  background: #000003;
  color: #f2f3f5;
  font-family: "Inter", system-ui, sans-serif;
}

.wrap {
  max-width: 760px;
  margin: 0 auto;
  padding: 96px 24px;
}

.title {
  font-size: clamp(32px, 6vw, 64px);
  letter-spacing: -0.03em;
}

.btn-primary {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  background: #b4b8c1;
  color: #08080a;
  padding: 10px 16px;
  cursor: pointer;
}

const canvas = document.querySelector("#sky");
const ctx = canvas.getContext("2d");
const stars = [];

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function build(count) {
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.4 + 0.3,
      a: Math.random() * 0.7 + 0.2
    });
  }
}

function frame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const star of stars) {
    ctx.fillStyle = "rgba(255, 255, 255, " + star.a + ")";
    ctx.fillRect(star.x, star.y, star.r, star.r);
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
build(900);
frame();
`
    }
  ];

  /* -------------------------------- random -------------------------------- */

  /* A seeded generator, so a run can be reproduced exactly in the tests. */
  function rng(seed) {
    let a = seed >>> 0;
    return function random() {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* -------------------------------- vocab --------------------------------- */

  const UNK = 0;
  const MAX_VOCAB = 96;

  function buildVocab(text) {
    const counts = new Map();
    for (const ch of text) counts.set(ch, (counts.get(ch) || 0) + 1);
    const chars = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([ch]) => ch)
      .filter((ch) => ch !== '\u0000')
      .slice(0, MAX_VOCAB - 1);
    // index 0 is reserved for characters the model has never seen
    const vocab = ['\u0000', ...chars];
    const index = new Map(vocab.map((ch, i) => [ch, i]));
    return { vocab, index };
  }

  function encode(text, index) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      const id = index.get(text[i]);
      out[i] = id === undefined ? UNK : id;
    }
    return out;
  }

  /* -------------------------------- model --------------------------------- */

  const DEFAULTS = {
    context: 14,
    embedding: 24,
    hidden: 128,
    seed: 7,
    batch: 24,
    lr: 0.003,
    clip: 5,
    decay: 0.00002,
    dropout: 0.1,
    steps: 1500
  };

  function zeros(n) {
    return new Float32Array(n);
  }

  function initWeights(size, fanIn, random) {
    const w = new Float32Array(size);
    // Xavier/Glorot, which keeps the tanh layer from saturating on step one
    const scale = Math.sqrt(1 / Math.max(1, fanIn));
    for (let i = 0; i < size; i += 1) {
      w[i] = (random() * 2 - 1) * scale;
    }
    return w;
  }

  function createModel(options = {}) {
    const corpus = options.corpus || CORPORA[0];
    const text = options.text || corpus.text;
    const config = {
      context: options.context || DEFAULTS.context,
      embedding: options.embedding || DEFAULTS.embedding,
      hidden: options.hidden || DEFAULTS.hidden,
      seed: options.seed || DEFAULTS.seed
    };
    const built = options.vocabChars
      ? (() => {
        const chars = options.vocabChars.filter((ch) => ch !== '\u0000');
        const vocab = ['\u0000', ...chars];
        return { vocab, index: new Map(vocab.map((ch, i) => [ch, i])) };
      })()
      : buildVocab(text);
    const { vocab, index } = built;
    const V = vocab.length;
    const dropout = options.dropout == null ? DEFAULTS.dropout : options.dropout;
    const C = config.context;
    const D = config.embedding;
    const H = config.hidden;
    const random = rng(config.seed);

    const E = initWeights(V * D, D, random);
    const W1 = initWeights(C * D * H, C * D, random);
    const b1 = zeros(H);
    const W2 = initWeights(H * V, H, random);
    const b2 = zeros(V);

    const params = {
      E, W1, b1, W2, b2
    };
    const grads = {
      E: zeros(V * D), W1: zeros(C * D * H), b1: zeros(H), W2: zeros(H * V), b2: zeros(V)
    };
    // Adam state
    const adam = {};
    Object.keys(params).forEach((key) => {
      adam[key] = { m: zeros(params[key].length), v: zeros(params[key].length) };
    });

    // scratch buffers, reused for every sample to keep the loop allocation-free
    const x = zeros(C * D);
    const h = zeros(H);
    const hPre = zeros(H);
    const mask = new Float32Array(H);
    const probs = zeros(V);
    const dh = zeros(H);
    const dx = zeros(C * D);

    const data = encode(text, index);
    const split = Math.max(C + 1, Math.floor(data.length * 0.9));
    const trainEnd = split;

    const model = {
      vocab,
      index,
      config,
      corpora: corpus.id,
      textLength: text.length,
      trainEnd,
      data,
      params,
      grads,
      adam,
      step: 0,
      history: [],
      lastLoss: null,
      lastValLoss: null,
      tokens: 0,
      sample(settings) {
        return sampleFrom(model, settings);
      },
      evaluate() {
        return evaluate(model);
      }
    };

    /* Forward pass for one context. Writes the hidden layer and softmax into
       the shared scratch buffers and returns the loss. */
    function forward(ctx, target, training) {
      const { params } = model;
      const { E, W1, b1, W2, b2 } = params;

      // embeddings, concatenated
      for (let i = 0; i < C; i += 1) {
        const base = ctx[i] * D;
        x.set(E.subarray(base, base + D), i * D);
      }

      // hidden = tanh(x . W1 + b1)
      for (let j = 0; j < H; j += 1) h[j] = b1[j];
      for (let i = 0; i < C * D; i += 1) {
        const xi = x[i];
        if (xi === 0) continue;
        const row = i * H;
        for (let j = 0; j < H; j += 1) h[j] += xi * W1[row + j];
      }
      const keep = 1 - (training ? dropout : 0);
      for (let j = 0; j < H; j += 1) {
        hPre[j] = Math.tanh(h[j]);
        if (training && random() < dropout) {
          mask[j] = 0;
          h[j] = 0;
        } else {
          mask[j] = training ? 1 / keep : 1;
          h[j] = hPre[j] * mask[j];
        }
      }

      // logits = h . W2 + b2, then softmax
      for (let k = 0; k < V; k += 1) probs[k] = b2[k];
      for (let j = 0; j < H; j += 1) {
        const hj = h[j];
        if (hj === 0) continue;
        const row = j * V;
        for (let k = 0; k < V; k += 1) probs[k] += hj * W2[row + k];
      }
      let max = -Infinity;
      for (let k = 0; k < V; k += 1) if (probs[k] > max) max = probs[k];
      let sum = 0;
      for (let k = 0; k < V; k += 1) {
        const e = Math.exp(probs[k] - max);
        probs[k] = e;
        sum += e;
      }
      const inv = 1 / sum;
      for (let k = 0; k < V; k += 1) probs[k] *= inv;

      const p = Math.max(1e-9, probs[target]);
      return -Math.log(p);
    }

    /* Backprop from the softmax distribution already in `probs`. */
    function backward(ctx, target, scale) {
      const { grads } = model;
      const { E, W1, W2 } = params;

      // dL/dlogits for softmax + cross entropy
      for (let k = 0; k < V; k += 1) {
        const d = (probs[k] - (k === target ? 1 : 0)) * scale;
        probs[k] = d;
        grads.b2[k] += d;
      }

      // W2 and the hidden gradient
      for (let j = 0; j < H; j += 1) dh[j] = 0;
      for (let j = 0; j < H; j += 1) {
        const hj = h[j];
        const row = j * V;
        let acc = 0;
        for (let k = 0; k < V; k += 1) {
          const d = probs[k];
          acc += d * W2[row + k];
          grads.W2[row + k] += hj * d;
        }
        dh[j] = acc;
      }

      // back through the dropout mask, then tanh
      for (let j = 0; j < H; j += 1) {
        dh[j] *= mask[j] * (1 - hPre[j] * hPre[j]);
        grads.b1[j] += dh[j];
      }

      // W1 and the embedding gradient
      for (let i = 0; i < C * D; i += 1) dx[i] = 0;
      for (let i = 0; i < C * D; i += 1) {
        const xi = x[i];
        const row = i * H;
        let acc = 0;
        for (let j = 0; j < H; j += 1) {
          const d = dh[j];
          acc += d * W1[row + j];
          grads.W1[row + j] += xi * d;
        }
        dx[i] = acc;
      }
      for (let i = 0; i < C; i += 1) {
        const base = ctx[i] * D;
        for (let d = 0; d < D; d += 1) grads.E[base + d] += dx[i * D + d];
      }
    }

    /* One minibatch: sample random windows, accumulate gradients, Adam step. */
    function trainStep(options = {}) {
      const batch = Math.max(1, Math.round(options.batch || DEFAULTS.batch));
      const lr = options.lr || DEFAULTS.lr;
      const clip = options.clip || DEFAULTS.clip;
      const decay = options.decay == null ? DEFAULTS.decay : options.decay;

      Object.keys(grads).forEach((key) => grads[key].fill(0));

      let total = 0;
      const scale = 1 / batch;
      const span = trainEnd - C;
      for (let b = 0; b < batch; b += 1) {
        const pos = C + Math.floor(random() * span);
        const ctx = new Array(C);
        for (let i = 0; i < C; i += 1) ctx[i] = data[pos - C + i];
        const target = data[pos];
        total += forward(ctx, target, true);
        backward(ctx, target, scale);
      }

      // clip the global gradient norm, which keeps tanh runs stable
      let norm = 0;
      Object.keys(grads).forEach((key) => {
        const g = grads[key];
        for (let i = 0; i < g.length; i += 1) norm += g[i] * g[i];
      });
      norm = Math.sqrt(norm);
      const factor = norm > clip ? clip / norm : 1;

      const t = model.step + 1;
      const b1m = 0.9;
      const b2m = 0.999;
      const eps = 1e-8;
      Object.keys(params).forEach((key) => {
        const p = params[key];
        const g = grads[key];
        const state = adam[key];
        for (let i = 0; i < p.length; i += 1) {
          const gi = g[i] * factor;
          state.m[i] = b1m * state.m[i] + (1 - b1m) * gi;
          state.v[i] = b2m * state.v[i] + (1 - b2m) * gi * gi;
          const mh = state.m[i] / (1 - Math.pow(b1m, t));
          const vh = state.v[i] / (1 - Math.pow(b2m, t));
          const decayed = key === 'b1' || key === 'b2' ? 0 : decay * p[i];
          p[i] -= lr * (mh / (Math.sqrt(vh) + eps) + decayed);
        }
      });

      model.step = t;
      model.tokens += batch;
      const loss = total / batch;
      model.lastLoss = loss;
      return loss;
    }

    model.trainStep = trainStep;
    return model;
  }

  /* ------------------------------- evaluation ------------------------------ */

  function evaluate(model, samples = 96) {
    const { C, D, H } = { C: model.config.context, D: model.config.embedding, H: model.config.hidden };
    const { data, vocab } = model;
    const V = vocab.length;
    const start = model.trainEnd;
    const span = data.length - start - C;
    if (span <= 2) return null;
    const step = Math.max(1, Math.floor(span / samples));
    let total = 0;
    let count = 0;

    // a small, allocation-light forward pass; it does not touch the gradients
    const x = new Float32Array(C * D);
    const h = new Float32Array(H);
    const logits = new Float32Array(V);
    for (let pos = start + C; pos < data.length; pos += step) {
      for (let i = 0; i < C; i += 1) {
        const base = data[pos - C + i] * D;
        x.set(model.params.E.subarray(base, base + D), i * D);
      }
      for (let j = 0; j < H; j += 1) h[j] = model.params.b1[j];
      for (let i = 0; i < C * D; i += 1) {
        const xi = x[i];
        if (xi === 0) continue;
        const row = i * H;
        for (let j = 0; j < H; j += 1) h[j] += xi * model.params.W1[row + j];
      }
      for (let j = 0; j < H; j += 1) h[j] = Math.tanh(h[j]);
      for (let k = 0; k < V; k += 1) logits[k] = model.params.b2[k];
      for (let j = 0; j < H; j += 1) {
        const hj = h[j];
        if (hj === 0) continue;
        const row = j * V;
        for (let k = 0; k < V; k += 1) logits[k] += hj * model.params.W2[row + k];
      }
      let max = -Infinity;
      for (let k = 0; k < V; k += 1) if (logits[k] > max) max = logits[k];
      let sum = 0;
      for (let k = 0; k < V; k += 1) sum += Math.exp(logits[k] - max);
      const p = Math.max(1e-9, Math.exp(logits[data[pos]] - max) / sum);
      total += -Math.log(p);
      count += 1;
    }
    model.lastValLoss = total / Math.max(1, count);
    return model.lastValLoss;
  }

  /* -------------------------------- sampling ------------------------------- */

  function sampleFrom(model, settings = {}) {
    const C = model.config.context;
    const D = model.config.embedding;
    const H = model.config.hidden;
    const V = model.vocab.length;
    const prompt = String(settings.prompt || '');
    const length = Math.max(1, Math.min(1200, settings.length || 240));
    const temperature = Math.max(0.05, Math.min(2, settings.temperature || 0.8));
    const topK = Math.max(1, Math.min(V, settings.topK || 12));
    const topP = Math.max(0.1, Math.min(1, settings.topP == null ? 0.94 : settings.topP));
    const penalty = settings.penalty == null ? 0.35 : settings.penalty;
    const random = settings.random || Math.random;
    const recent = [];

    let ctx = new Array(C).fill(0);
    if (prompt) {
      const ids = encode(prompt, model.index);
      const tail = Array.from(ids).slice(-C);
      ctx = [...new Array(C - tail.length).fill(0), ...tail];
    }

    const x = new Float32Array(C * D);
    const h = new Float32Array(H);
    const logits = new Float32Array(V);
    const candidates = [];
    let out = '';

    for (let step = 0; step < length; step += 1) {
      for (let i = 0; i < C; i += 1) {
        const base = ctx[i] * D;
        x.set(model.params.E.subarray(base, base + D), i * D);
      }
      for (let j = 0; j < H; j += 1) h[j] = model.params.b1[j];
      for (let i = 0; i < C * D; i += 1) {
        const xi = x[i];
        if (xi === 0) continue;
        const row = i * H;
        for (let j = 0; j < H; j += 1) h[j] += xi * model.params.W1[row + j];
      }
      for (let j = 0; j < H; j += 1) h[j] = Math.tanh(h[j]);
      for (let k = 0; k < V; k += 1) logits[k] = model.params.b2[k];
      for (let j = 0; j < H; j += 1) {
        const hj = h[j];
        if (hj === 0) continue;
        const row = j * V;
        for (let k = 0; k < V; k += 1) logits[k] += hj * model.params.W2[row + k];
      }

      // a light repetition penalty stops small models from looping
      for (let r = 0; r < recent.length; r += 1) logits[recent[r]] -= penalty * (1 - r / (recent.length + 1));

      // temperature, then keep the best k within the top-p mass
      let max = -Infinity;
      for (let k = 0; k < V; k += 1) {
        logits[k] /= temperature;
        if (logits[k] > max) max = logits[k];
      }
      candidates.length = 0;
      for (let k = 0; k < V; k += 1) candidates.push([k, Math.exp(logits[k] - max)]);
      candidates.sort((a, b) => b[1] - a[1]);
      let mass = 0;
      for (const c of candidates) mass += c[1];
      const keep = [];
      let running = 0;
      for (const c of candidates) {
        if (keep.length >= topK) break;
        keep.push(c);
        running += c[1];
        if (running / mass >= topP) break;
      }
      let total = 0;
      for (const c of keep) total += c[1];
      let r = random() * total;
      let picked = keep[keep.length - 1][0];
      for (const [id, p] of keep) {
        r -= p;
        if (r <= 0) { picked = id; break; }
      }

      const ch = model.vocab[picked];
      out += ch === '\u0000' ? '?' : ch;
      ctx = [...ctx.slice(1), picked];
      recent.unshift(picked);
      if (recent.length > 48) recent.pop();
      if (settings.onChar) settings.onChar(ch, out);
    }
    return out;
  }

  /* ------------------------------ persistence ------------------------------ */

  const STORAGE_KEY = 'eltes.lab.model.v1';

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(text) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function serialize(model) {
    const weights = {};
    Object.keys(model.params).forEach((key) => {
      const p = model.params[key];
      weights[key] = bytesToBase64(new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
    });
    return {
      version: 1,
      vocab: model.vocab.join(''),
      config: model.config,
      corpus: model.corpora || 'custom',
      textLength: model.textLength,
      step: model.step,
      tokens: model.tokens,
      loss: model.lastLoss,
      valLoss: model.lastValLoss,
      history: model.history.slice(-160),
      weights
    };
  }

  /* Rebuild a model from a saved snapshot, so a trained model can be sampled
     again without retraining. */
  function deserialize(saved) {
    if (!saved || saved.version !== 1 || !saved.vocab || !saved.weights) {
      throw new Error('That is not an Eltes Lab model.');
    }
    const vocab = [...saved.vocab];
    const index = new Map(vocab.map((ch, i) => [ch, i]));
    const config = saved.config;
    const V = vocab.length;
    const C = config.context;
    const D = config.embedding;
    const H = config.hidden;

    // Build the same shapes, then pour the saved weights in. The vocabulary
    // comes from the snapshot, not from a corpus, so every row lines up.
    const model = createModel({ text: '', vocabChars: vocab.slice(1), ...config });
    model.data = new Uint8Array(0);
    model.trainEnd = C + 1;
    Object.keys(saved.weights).forEach((key) => {
      const bytes = base64ToBytes(saved.weights[key]);
      const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      if (floats.length === model.params[key].length) model.params[key].set(floats);
    });
    model.step = saved.step || 0;
    model.tokens = saved.tokens || 0;
    model.lastLoss = saved.loss == null ? null : saved.loss;
    model.lastValLoss = saved.valLoss == null ? null : saved.valLoss;
    model.history = Array.isArray(saved.history) ? saved.history : [];
    model.corpora = saved.corpus || 'custom';
    model.textLength = saved.textLength || 0;
    model.trained = true;
    return model;
  }

  function storage() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (error) {
      return null;
    }
  }

  function save(model) {
    const store = storage();
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify(serialize(model)));
    return true;
  }

  function load() {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return deserialize(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function hasSaved() {
    const store = storage();
    return !!(store && store.getItem(STORAGE_KEY));
  }

  function clearSaved() {
    const store = storage();
    if (store) store.removeItem(STORAGE_KEY);
  }

  function paramCount(model) {
    return Object.values(model.params).reduce((sum, p) => sum + p.length, 0);
  }

  /* --------------------------- chat integration ---------------------------- */

  /* The app's local-model path calls this. A character model cannot answer a
     question, so it does the one thing it can do honestly: continue the words
     you typed, and say plainly what wrote it. */
  function chat(messages, options = {}) {
    const model = options.model || load();
    if (!model) {
      return {
        intent: 'lab-empty',
        text: '**Eltes Lab-1 is not trained yet.**\n\nOpen [Lab](train.html), pick a corpus and press **Train**, then save the model to this browser. It is a small character-level language model — tens of thousands of parameters, trained here in the tab — so it continues text rather than answering questions.'
      };
    }
    const list = Array.isArray(messages) ? messages : [];
    const last = [...list].reverse().find((m) => m && m.role === 'user');
    const prompt = last ? String(last.content || '').trim().slice(-400) : '';
    const length = Math.max(80, Math.min(420, (options.length || 260)));
    const generated = model.sample({
      prompt,
      length,
      temperature: options.temperature || 0.72,
      topK: options.topK || 10
    });
    const quoted = generated.split('\n').map((line) => `> ${line}`).join('\n');
    const corpus = (CORPORA.find((c) => c.id === model.corpora) || {}).name || 'your text';
    const loss = model.lastValLoss != null ? model.lastValLoss.toFixed(2) : (model.lastLoss != null ? model.lastLoss.toFixed(2) : '—');
    return {
      intent: 'lab',
      text: [
        `**Eltes Lab-1** · ${paramCount(model).toLocaleString()} parameters · trained on “${corpus}” · loss ${loss}`,
        '',
        'A character-level model continues text; it cannot follow instructions. Here is what it predicts after your words:',
        '',
        quoted
      ].join('\n')
    };
  }

  return {
    CORPORA,
    DEFAULTS,
    STORAGE_KEY,
    createModel,
    deserialize,
    serialize,
    sample: sampleFrom,
    evaluate,
    save,
    load,
    hasSaved,
    clearSaved,
    paramCount,
    chat,
    rng,
    buildVocab,
    encode
  };
});
