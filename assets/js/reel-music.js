/* ==========================================================================
   Eltes Reel — the free music bench
   --------------------------------------------------------------------------
   Twelve beds, synthesised in this tab: no sample packs, no downloads, no
   licensing to check. Each track is a chord progression, a bass line, a drum
   pattern and (on some) a pentatonic melody, rendered to 16-bit mono WAV at
   22.05 kHz and handed to the same importer a dropped file would use.

   A 90 BPM, 8-bar bed is about 21 seconds and ~900 kB as WAV. Rendering is
   pure arithmetic — `test/reel-library.test.cjs` runs it in Node with no audio
   context at all.
   ========================================================================== */
window.EltesReelMusic = (function () {
  'use strict';

  const SAMPLE_RATE = 22050;

  const TRACKS = [
    {
      id: 'lofi-morning', name: 'Lo-fi Morning', mood: 'chill', bpm: 84, bars: 8,
      key: 57, scale: [0, 3, 5, 7, 10], chords: [[0, 3, 7, 10], [-3, 0, 5, 8], [-5, -1, 2, 7], [-3, 0, 4, 7]],
      drums: 'lofi', melody: true, color: '#39dca2',
      desc: 'Soft keys, brushed drums, a little dust. Good under talking.'
    },
    {
      id: 'neon-drive', name: 'Neon Drive', mood: 'house', bpm: 118, bars: 8,
      key: 60, scale: [0, 2, 3, 7, 9], chords: [[0, 3, 7], [-2, 1, 5], [-4, 0, 3], [-2, 1, 5]],
      drums: 'house', melody: true, color: '#7cf0ff',
      desc: 'Four-on-the-floor, a wide pad and a plucked lead.'
    },
    {
      id: 'trap-bloom', name: 'Trap Bloom', mood: 'trap', bpm: 140, bars: 8,
      key: 55, scale: [0, 3, 5, 6, 10], chords: [[0, 3, 7], [0, 3, 7], [-3, 0, 5], [-3, 0, 5]],
      drums: 'trap', melody: true, color: '#ff5bd1',
      desc: '808-ish low end, rolled hats and a dark bell lead.'
    },
    {
      id: 'cinematic-rise', name: 'Cinematic Rise', mood: 'cinematic', bpm: 70, bars: 8,
      key: 48, scale: [0, 2, 3, 7, 8], chords: [[0, 3, 7], [-2, 1, 5], [-5, -2, 2], [-2, 1, 5]],
      drums: 'cinema', melody: false, color: '#ffc266',
      desc: 'Slow strings-like pad with a timpani pulse. Opens a film.'
    },
    {
      id: 'sunset-pop', name: 'Sunset Pop', mood: 'pop', bpm: 104, bars: 8,
      key: 62, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [-3, 0, 4], [-5, -1, 2], [-1, 2, 7]],
      drums: 'pop', melody: true, color: '#ff9e6d',
      desc: 'Bright major chords, claps on two and four.'
    },
    {
      id: 'night-drive', name: 'Night Drive', mood: 'synthwave', bpm: 96, bars: 8,
      key: 53, scale: [0, 3, 5, 7, 10], chords: [[0, 3, 7], [-4, 0, 3], [-5, -1, 2], [-4, 0, 3]],
      drums: 'synthwave', melody: true, color: '#8b7cff',
      desc: 'Arpeggiated pad and a gated snare. Neon on wet asphalt.'
    },
    {
      id: 'soft-piano', name: 'Soft Piano', mood: 'piano', bpm: 72, bars: 8,
      key: 60, scale: [0, 2, 4, 5, 7, 9, 11], chords: [[0, 4, 7], [-3, 2, 5], [-5, 0, 4], [-3, 2, 7]],
      drums: 'none', melody: true, color: '#eef2ff',
      desc: 'Felt-piano chords and a melody that leaves space.'
    },
    {
      id: 'hype-drop', name: 'Hype Drop', mood: 'trap', bpm: 150, bars: 8,
      key: 51, scale: [0, 3, 5, 6, 7, 10], chords: [[0, 3, 7], [0, 3, 7], [0, 5, 8], [0, 3, 10]],
      drums: 'trap', melody: true, color: '#ffe14d',
      desc: 'Fast hats, a stabbing brass chord and a drop at bar five.'
    },
    {
      id: 'chill-steps', name: 'Chill Steps', mood: 'chill', bpm: 90, bars: 8,
      key: 58, scale: [0, 2, 3, 7, 9], chords: [[0, 3, 7], [-2, 1, 5], [-4, 0, 3], [-2, 1, 5]],
      drums: 'lofi', melody: true, color: '#c9f6e4',
      desc: 'A walking bass under lazy chords. Good for a vlog intro.'
    },
    {
      id: 'epic-trailer', name: 'Epic Trailer', mood: 'cinematic', bpm: 60, bars: 8,
      key: 45, scale: [0, 2, 3, 5, 7, 8, 10], chords: [[0, 3, 7], [-2, 1, 5], [0, 3, 7], [-5, -1, 2]],
      drums: 'cinema', melody: false, color: '#ff8f6b',
      desc: 'Low drone, big hits, no melody. For a hard cut.'
    },
    {
      id: 'retro-funk', name: 'Retro Funk', mood: 'funk', bpm: 108, bars: 8,
      key: 52, scale: [0, 2, 3, 5, 7, 9, 10], chords: [[0, 3, 7], [0, 3, 7], [-2, 1, 5], [-2, 1, 5]],
      drums: 'funk', melody: true, color: '#f4e3c1',
      desc: 'Off-beat bass, tight hats, a clav-like lead.'
    },
    {
      id: 'dream-waves', name: 'Dream Waves', mood: 'ambient', bpm: 80, bars: 8,
      key: 50, scale: [0, 2, 3, 7, 8], chords: [[0, 3, 7, 10], [-2, 1, 5, 8], [-5, -1, 2, 7], [-2, 1, 5, 8]],
      drums: 'none', melody: false, color: '#7cf0ff',
      desc: 'Wide chords with no percussion. End cards and slow fades.'
    }
  ];

  const trackById = (id) => TRACKS.find((entry) => entry.id === id) || null;
  const midi = (note) => 440 * 2 ** ((note - 69) / 12);

  /* ------------------------------- synthesis ------------------------------ */

  // A 4096-point sine table. Four hundred tracks of bed are meant to render
  // between a click and the next frame, so the inner loop reads a table
  // instead of calling Math.sin a few million times.
  const SINE_MASK = 4095;
  const SINE_TABLE = new Float32Array(SINE_MASK + 1);
  for (let i = 0; i <= SINE_MASK; i += 1) SINE_TABLE[i] = Math.sin((2 * Math.PI * i) / (SINE_MASK + 1));

  function addTone(buffer, start, length, freq, gain, shape) {
    const from = Math.max(0, Math.floor(start * SAMPLE_RATE));
    const to = Math.min(buffer.length, Math.floor((start + length) * SAMPLE_RATE));
    const attack = Math.min(0.08, length * 0.25);
    const release = Math.max(0.05, length * 0.45);
    const step = (freq / SAMPLE_RATE) * (SINE_MASK + 1);
    let p1 = 0;
    let p2 = 0;
    let p3 = 0;
    let p4 = 0;
    for (let i = from; i < to; i += 1) {
      const left = (i - from) / SAMPLE_RATE;
      const remaining = (to - i) / SAMPLE_RATE;
      const env = Math.min(1, left / attack) * Math.min(1, remaining / release);
      const a = SINE_TABLE[p1 & SINE_MASK];
      let sample = a;
      if (shape === 'warm') sample = a * 0.7 + SINE_TABLE[p2 & SINE_MASK] * 0.2 + SINE_TABLE[p3 & SINE_MASK] * 0.08;
      else if (shape === 'reed') sample = a * 0.6 + SINE_TABLE[p2 & SINE_MASK] * 0.28 + SINE_TABLE[p4 & SINE_MASK] * 0.1;
      else if (shape === 'bell') sample = a * 0.6 + SINE_TABLE[p2 & SINE_MASK] * 0.3 + SINE_TABLE[p4 & SINE_MASK] * 0.1;
      buffer[i] += sample * env * gain;
      p1 += step;
      p2 += step * 2;
      p3 += step * 3;
      p4 += step * 4;
    }
  }

  function addNoise(buffer, start, length, gain, decay, tone) {
    const from = Math.max(0, Math.floor(start * SAMPLE_RATE));
    const to = Math.min(buffer.length, Math.floor((start + length) * SAMPLE_RATE));
    let last = 0;
    let seed = 22222;
    for (let i = from; i < to; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const white = (seed / 0x7fffffff) * 2 - 1;
      const filtered = tone === 'high' ? white - last : white * 0.6 + last * 0.4;
      last = white;
      const t = (i - from) / SAMPLE_RATE;
      const env = Math.exp(-t / decay);
      buffer[i] += filtered * env * gain;
    }
  }

  function addKick(buffer, start, gain) {
    const from = Math.max(0, Math.floor(start * SAMPLE_RATE));
    const to = Math.min(buffer.length, Math.floor((start + 0.35) * SAMPLE_RATE));
    let phase = 0;
    for (let i = from; i < to; i += 1) {
      const t = (i - from) / SAMPLE_RATE;
      const freq = 45 + 110 * Math.exp(-t * 22);
      const env = Math.exp(-t * 9);
      buffer[i] += SINE_TABLE[phase & SINE_MASK] * env * gain;
      phase += (freq / SAMPLE_RATE) * (SINE_MASK + 1);
    }
  }

  function drumPattern(track, buffer, beat, bar, barIndex) {
    const style = track.drums || 'none';
    const beatLen = 60 / track.bpm;
    if (style === 'none') return;
    if (style === 'cinema') {
      if (barIndex % 2 === 0) addKick(buffer, bar, 0.5);
      addKick(buffer, bar + beatLen * 2, 0.25);
      addNoise(buffer, bar + beatLen * 3, 0.5, 0.05, 0.2, 'high');
      return;
    }
    if (style === 'trap' || style === 'house') {
      for (let b = 0; b < 4; b += 1) addKick(buffer, bar + b * beatLen, style === 'house' ? 0.42 : 0.5);
      addNoise(buffer, bar + beatLen, 0.16, 0.16, 0.06, 'high');
      addNoise(buffer, bar + beatLen * 3, 0.16, 0.16, 0.06, 'high');
      const hats = style === 'trap' ? 8 : 4;
      for (let h = 0; h < hats; h += 1) {
        addNoise(buffer, bar + (h * 4 / hats) * beatLen, 0.05, style === 'trap' ? 0.05 : 0.035, 0.012, 'high');
      }
      return;
    }
    // pop, funk, synthwave and lofi share a backbeat
    addKick(buffer, bar, 0.42);
    addKick(buffer, bar + beatLen * 2, 0.34);
    if (style === 'funk') addKick(buffer, bar + beatLen * 2.5, 0.2);
    addNoise(buffer, bar + beatLen, 0.18, 0.15, 0.05, 'mid');
    addNoise(buffer, bar + beatLen * 3, 0.18, 0.15, 0.05, 'mid');
    for (let h = 0; h < 8; h += 1) {
      addNoise(buffer, bar + (h * beatLen) / 2, 0.04, 0.03, 0.01, 'high');
    }
  }

  /** Render a track to a Float32Array of mono samples. */
  function renderSamples(trackOrId) {
    const track = typeof trackOrId === 'string' ? trackById(trackOrId) : trackOrId;
    if (!track) return null;
    const beat = 60 / track.bpm;
    const barLength = beat * 4;
    const total = Math.ceil(track.bars * barLength * SAMPLE_RATE) + SAMPLE_RATE * 0.5;
    const buffer = new Float32Array(total);

    for (let barIndex = 0; barIndex < track.bars; barIndex += 1) {
      const bar = barIndex * barLength;
      const chord = track.chords[barIndex % track.chords.length];
      const dropIn = track.id === 'hype-drop' && barIndex < 4 ? 0 : 1;

      // pad / chord stabs
      chord.forEach((semitone, voice) => {
        const note = track.key + semitone;
        addTone(buffer, bar, barLength * 0.96, midi(note), 0.055 / (voice * 0.25 + 1), voice === 0 ? 'warm' : 'reed');
      });

      // bass — root on the beat, an octave down
      const bassNote = track.key + chord[0] - 24;
      addTone(buffer, bar, beat * 1.6, midi(bassNote), 0.09, 'warm');
      if (track.drums === 'funk' || track.drums === 'house') {
        addTone(buffer, bar + beat * 2.5, beat * 0.7, midi(bassNote + 12), 0.06, 'warm');
      }

      // melody: a pentatonic walk that repeats every two bars
      if (track.melody) {
        const steps = [0, 2, 1, 3, 2, 4, 3, 1];
        for (let step = 0; step < 8; step += 1) {
          const degree = steps[(step + barIndex * 2) % steps.length];
          const semitone = track.scale[degree % track.scale.length];
          const note = track.key + 12 + semitone + (degree >= track.scale.length ? 12 : 0);
          const at = bar + step * (barLength / 8);
          addTone(buffer, at, barLength / 8 * 0.9, midi(note), (dropIn ? 0.038 : 0.012), 'bell');
        }
      }

      drumPattern(track, buffer, beat, bar, barIndex);
    }

    // A gentle fade in and out so a loop dropped on the timeline never clicks.
    const fade = Math.floor(SAMPLE_RATE * 0.25);
    for (let i = 0; i < fade; i += 1) {
      buffer[i] *= i / fade;
      buffer[total - 1 - i] *= i / fade;
    }

    // Normalise to about -3 dBFS.
    let peak = 0;
    for (let i = 0; i < total; i += 1) peak = Math.max(peak, Math.abs(buffer[i]));
    if (peak > 0) {
      const gain = 0.7 / peak;
      for (let i = 0; i < total; i += 1) buffer[i] *= gain;
    }
    return { sampleRate: SAMPLE_RATE, samples: buffer, duration: total / SAMPLE_RATE };
  }

  /** 16-bit PCM mono WAV bytes, ready for a Blob or a File. */
  function wavBytes(trackOrId) {
    const rendered = renderSamples(trackOrId);
    if (!rendered) return null;
    const { samples, sampleRate } = rendered;
    const dataSize = samples.length * 2;
    const bytes = new Uint8Array(44 + dataSize);
    const view = new DataView(bytes.buffer);
    const writeString = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
    }
    return bytes;
  }

  function durationOf(trackOrId) {
    const track = typeof trackOrId === 'string' ? trackById(trackOrId) : trackOrId;
    if (!track) return 0;
    return Math.round(track.bars * (60 / track.bpm) * 4 * 10) / 10;
  }

  return { TRACKS, SAMPLE_RATE, trackById, renderSamples, wavBytes, durationOf };
})();
