    /**
     * Visual Piano main runtime.
     * This file owns app orchestration (state, rendering, events).
     * Shared pure helpers are loaded first from:
     * - window.VisualPianoTimeUtils
     * - window.VisualPianoMarksUtils
     */
    const { formatTime, parseTimeInput } = window.VisualPianoTimeUtils || {};
    const { insertSortedUniqueMark, resolveLoopSegmentFromMarks } = window.VisualPianoMarksUtils || {};

    if (!formatTime || !parseTimeInput || !insertSortedUniqueMark || !resolveLoopSegmentFromMarks) {
      throw new Error('Visual Piano helpers failed to load. Check js/modules script includes.');
    }
    const canvas = document.getElementById('note-canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    let viewportWidth = 0;
    let viewportHeight = 0;
    let pixelRatio = window.devicePixelRatio || 1;

    const fileInput = document.getElementById('file-input');
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const speedSlider = document.getElementById('speed');
    const zoomSlider = document.getElementById('zoom');
    const volumeSlider = document.getElementById('volume');
    const soundSelect = document.getElementById('sound-select');
    const paletteBtn = document.getElementById('palette-btn');
    const progress = document.getElementById('progress');
    const seekMarksEl = document.getElementById('seek-marks');
    const markLoopBtn = document.getElementById('mark-loop');
    const jumpMarkBtn = document.getElementById('jump-mark');
    const loopToggleBtn = document.getElementById('loop-toggle');
    const handModeBtn = document.getElementById('hand-mode-btn');
    const keyboardModeBtn = document.getElementById('keyboard-mode-btn');

    const songTitleEl = document.getElementById('song-title');
    const centerMetaEl = document.getElementById('center-meta');
    const timeReadout = document.getElementById('time-readout');
    const tempoReadout = document.getElementById('tempo-readout');
    const keyToggleBtn = document.getElementById('key-toggle');
    const toast = document.getElementById('toast');
    const loopReadout = document.getElementById('loop-readout');
    const loopStartInput = document.getElementById('loop-start-input');
    const loopEndInput = document.getElementById('loop-end-input');

    const START_NOTE = 21; // A0
    const END_NOTE = 108; // C8

    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

    const keyToPitch = {
      'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4,
      'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9,
      'A#': 10, 'Bb': 10, 'B': 11
    };

    const scaleMajor = [0, 2, 4, 5, 7, 9, 11];
    const scaleMinor = [0, 2, 3, 5, 7, 8, 10];
    const keyProfiles = {
      major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
      minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
    };
    const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

    function normalizeTempoMap(entries) {
      const map = entries
        .map((entry) => ({ time: Number(entry.time) || 0, bpm: Number(entry.bpm) || 120 }))
        .filter((entry) => Number.isFinite(entry.time) && Number.isFinite(entry.bpm))
        .sort((a, b) => a.time - b.time);

      const compact = [];
      map.forEach((entry) => {
        if (!compact.length || Math.abs(entry.time - compact[compact.length - 1].time) > 1e-6) {
          compact.push(entry);
        } else {
          compact[compact.length - 1] = entry;
        }
      });

      if (!compact.length || compact[0].time > 0) {
        compact.unshift({ time: 0, bpm: 120 });
      }

      return compact;
    }

    function normalizeTimeSigMap(entries) {
      const map = entries
        .map((entry) => ({
          time: Number(entry.time) || 0,
          numerator: Number(entry.numerator) || 4,
          denominator: Number(entry.denominator) || 4
        }))
        .filter((entry) => Number.isFinite(entry.time))
        .sort((a, b) => a.time - b.time);

      const compact = [];
      map.forEach((entry) => {
        if (!compact.length || Math.abs(entry.time - compact[compact.length - 1].time) > 1e-6) {
          compact.push(entry);
        } else {
          compact[compact.length - 1] = entry;
        }
      });

      if (!compact.length || compact[0].time > 0) {
        compact.unshift({ time: 0, numerator: 4, denominator: 4 });
      }

      return compact;
    }

    function buildTempoMap(midi) {
      const entries = (midi.header.tempos || []).map((tempo) => ({
        time: tempo.time || 0,
        bpm: tempo.bpm || 120
      }));
      tempoMap = normalizeTempoMap(entries);
    }

    function buildTimeSigMap(midi) {
      const entries = (midi.header.timeSignatures || []).map((sig) => ({
        time: sig.time || 0,
        numerator: sig.timeSignature[0],
        denominator: sig.timeSignature[1]
      }));
      timeSigMap = normalizeTimeSigMap(entries);
    }

    function buildGridLines() {
      gridLines = [];
      if (!totalDuration) return;

      let tempoIndex = 0;
      let timeSigIndex = 0;
      let t = 0;
      let beatInBar = 0;

      const EPS = 1e-6;

      while (t <= totalDuration + EPS) {
        while (tempoMap[tempoIndex + 1]?.time <= t + EPS) tempoIndex++;
        while (timeSigMap[timeSigIndex + 1]?.time <= t + EPS) {
          timeSigIndex++;
          beatInBar = 0;
        }

        gridLines.push({ time: t, isBar: beatInBar === 0 });

        const tempo = tempoMap[tempoIndex] || { bpm: 120 };
        const sig = timeSigMap[timeSigIndex] || { numerator: 4, denominator: 4 };
        const beatsPerBar = Math.max(1, sig.numerator || 4);
        const beatUnit = Math.max(1, sig.denominator || 4);
        const beatSec = (60 / tempo.bpm) * (4 / beatUnit);

        const nextTempoTime = tempoMap[tempoIndex + 1]?.time ?? Infinity;
        const nextTimeSigTime = timeSigMap[timeSigIndex + 1]?.time ?? Infinity;
        const nextChange = Math.min(nextTempoTime, nextTimeSigTime);

        if (t + beatSec > nextChange + EPS) {
          if (nextChange === Infinity) break;
          t = nextChange;
          continue;
        }

        t += beatSec;
        beatInBar = (beatInBar + 1) % beatsPerBar;
      }
    }

    function normalizeKeyName(name) {
      if (!name) return null;
      const key = name.trim().split(' ')[0];
      const letter = key[0]?.toUpperCase() || '';
      const accidental = key.slice(1);
      return `${letter}${accidental}`;
    }

    function pitchClassToKeyName(pitchClass) {
      return PITCH_CLASS_NAMES[((pitchClass % 12) + 12) % 12];
    }

    function inferKeyFromNotes(noteList) {
      if (!noteList.length) return null;
      const histogram = new Array(12).fill(0);
      const bassHistogram = new Array(12).fill(0);
      const endingHistogram = new Array(12).fill(0);
      const totalTime = noteList.reduce((max, note) => Math.max(max, note.time + note.duration), 0);
      const endingStart = totalTime * 0.86;
      noteList.forEach((note) => {
        const pitch = note.midi % 12;
        const durationWeight = Math.max(0.02, note.duration);
        const velocityWeight = Math.max(0.2, note.velocity || 0.7);
        const weight = durationWeight * velocityWeight;
        histogram[pitch] += weight;
        if (note.midi < 60) {
          bassHistogram[pitch] += weight * 1.45;
        }
        if (note.time >= endingStart) {
          endingHistogram[pitch] += weight * 1.7;
        }
      });

      function normalize(vec) {
        const sum = vec.reduce((acc, value) => acc + value, 0) || 1;
        return vec.map((value) => value / sum);
      }

      function rotate(arr, shift) {
        const out = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
          out[i] = arr[(i + shift + arr.length) % arr.length];
        }
        return out;
      }

      function dot(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
        return sum;
      }

      const histNorm = normalize(histogram);
      const bassNorm = normalize(bassHistogram);
      const endingNorm = normalize(endingHistogram);
      const majorProfile = normalize(keyProfiles.major);
      const minorProfile = normalize(keyProfiles.minor);

      const candidates = [];
      for (let root = 0; root < 12; root++) {
        const majorFit = dot(histNorm, rotate(majorProfile, 12 - root));
        const minorFit = dot(histNorm, rotate(minorProfile, 12 - root));
        const tonicSalience = histNorm[root] * 0.14 + bassNorm[root] * 0.28 + endingNorm[root] * 0.36;
        candidates.push({
          score: majorFit + tonicSalience,
          key: pitchClassToKeyName(root),
          scale: 'major'
        });
        candidates.push({
          score: minorFit + tonicSalience,
          key: pitchClassToKeyName(root),
          scale: 'minor'
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      return best;
    }

    function midiToFreq(midi) {
      if (midiFreqCache[midi] === undefined) {
        midiFreqCache[midi] = Tone.Frequency(midi, 'midi').toFrequency();
      }
      return midiFreqCache[midi];
    }

    const keyboard = document.getElementById('keyboard');
    const whiteKeysEl = document.getElementById('white-keys');
    const blackKeysEl = document.getElementById('black-keys');
    const metronomeIndicator = document.getElementById('metronome-indicator');
    const keys = {};
    const keyPositions = {};

    let midiData = null;
    let notes = [];
    let renderNotes = [];
    let notesLeft = [];
    let notesRight = [];
    let totalDuration = 0;
    let loopStartSong = 0;
    let loopEndSong = 0;
    let isLooping = false;
    let seekMarks = [];
    let seekIsDragging = false;
    let seekSnapUntil = 0;
    let seekRefreshTimer = null;
    let pendingSeekSongTime = null;
    let suppressLoopInputBlurCommit = false;
    let splitPoint = 60; // Middle C
    let zoomValue = 160;
    let playbackSpeed = 1;
    let keyHighlightOn = false;
    let currentKeySignature = null;
    let handMode = 'both';
    let leftHandColor = '#4a7dff';
    let rightHandColor = '#ff7a00';
    let tempoMap = [{ time: 0, bpm: 120 }];
    let timeSigMap = [{ time: 0, numerator: 4, denominator: 4 }];
    let gridLines = [];
    let gridEnabled = false;
    let keyboardModeEnabled = false;
    const keyboardHeldNotes = new Map();

    const DEFAULTS = {
      speed: 1,
      volume: 0.85,
      zoom: 160,
      handMode: 'both'
    };
    const DEFAULT_STARTUP_MIDI_PATHS = [
      'assets/default.mid',
      'default.mid',
      'Johann Pachelbel - Canon in D.mid'
    ];
    const KEYBOARD_MIDI_MAP = {
      KeyZ: 60, KeyS: 61, KeyX: 62, KeyD: 63, KeyC: 64, KeyV: 65, KeyG: 66, KeyB: 67, KeyH: 68, KeyN: 69, KeyJ: 70, KeyM: 71,
      Comma: 72, KeyL: 73, Period: 74, Semicolon: 75, Slash: 76,
      KeyQ: 72, Digit2: 73, KeyW: 74, Digit3: 75, KeyE: 76, KeyR: 77, Digit5: 78, KeyT: 79, Digit6: 80, KeyY: 81, Digit7: 82, KeyU: 83,
      KeyI: 84, Digit9: 85, KeyO: 86, Digit0: 87, KeyP: 88
    };

    const SOUND_OFFSETS = {
      bright: -2,
      warm: 0,
      electric: -3,
      plucked: -4,
      synth: -1,
      harpsichord: -2,
      steelpan: -3,
      am: -2,
      fm: -2,
      duo: -2,
      mono: -2,
      membrane: -4,
      organ: -2
    };

    const PALETTES = [
      { left: '#4a7dff', right: '#ff7a00' },
      { left: '#00e5ff', right: '#ff2d95' },
      { left: '#7b2cff', right: '#ffe600' },
      { left: '#00ff88', right: '#ff4d00' },
      { left: '#00b3ff', right: '#ffb800' },
      { left: '#3dff7f', right: '#ff2a2a' }
    ];
    let paletteIndex = 2;

    let scheduledPart = null;
    const midiFreqCache = new Array(128);

    let master = null;
    let filter = null;
    let compressor = null;
    let synth = null;
    let audioReady = false;

    function initAudioEngine() {
      if (audioReady) return;
      master = new Tone.Gain(1).toDestination();
      filter = new Tone.Filter(12000, 'lowpass');
      compressor = new Tone.Compressor(-18, 3).connect(master);
      filter.connect(compressor);
      audioReady = true;
      createSynth(soundSelect.value || 'bright');
      applyVolume();
    }

    async function ensureAudioStarted() {
      if (!audioReady) {
        initAudioEngine();
      }
      try {
        await Tone.start();
      } catch (_) {
        // Browser gesture policy can reject start; retry on next gesture.
      }
    }

    function applyVolume() {
      if (!audioReady || !master) return;
      const level = Number(volumeSlider.value);
      const gain = level <= 0.001 ? 0 : Math.pow(level, 2.2);
      master.gain.value = gain;
      if (synth) {
        const offset = SOUND_OFFSETS[soundSelect.value] ?? 0;
        synth.volume.value = offset;
      }
    }

    function createSynth(type) {
      if (!audioReady || !filter) return;
      if (synth) synth.dispose();
      if (type === 'warm') {
        filter.frequency.value = 5200;
      } else if (type === 'bright') {
        filter.frequency.value = 14000;
      } else if (type === 'electric') {
        filter.frequency.value = 10000;
      } else if (type === 'plucked') {
        filter.frequency.value = 11000;
      } else {
        filter.frequency.value = 9000;
      }
      if (type === 'bright') {
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.002, decay: 0.08, sustain: 0.4, release: 0.8 }
        });
      } else if (type === 'am') {
        synth = new Tone.PolySynth(Tone.AMSynth, {
          harmonicity: 1.2,
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 1.0 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.9 }
        });
      } else if (type === 'fm') {
        synth = new Tone.PolySynth(Tone.FMSynth, {
          modulationIndex: 8,
          envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 1.0 }
        });
      } else if (type === 'duo') {
        synth = new Tone.PolySynth(Tone.DuoSynth, {
          harmonicity: 1.5,
          vibratoAmount: 0.2,
          envelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 1.0 }
        });
      } else if (type === 'mono') {
        synth = new Tone.PolySynth(Tone.MonoSynth, {
          oscillator: { type: 'sawtooth' },
          filter: { Q: 2, type: 'lowpass', rolloff: -24 },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.8 }
        });
      } else if (type === 'electric') {
        synth = new Tone.PolySynth(Tone.FMSynth, {
          modulationIndex: 10,
          envelope: { attack: 0.004, decay: 0.2, sustain: 0.3, release: 1.1 }
        });
      } else if (type === 'plucked') {
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' },
          envelope: { attack: 0.001, decay: 0.12, sustain: 0.0, release: 0.4 }
        });
      } else if (type === 'membrane') {
        synth = new Tone.PolySynth(Tone.MembraneSynth, {
          pitchDecay: 0.05,
          octaves: 6,
          envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 0.6 }
        });
      } else if (type === 'organ') {
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fattriangle', count: 3, spread: 18 },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.85, release: 0.9 }
        });
      } else if (type === 'harpsichord') {
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' },
          envelope: { attack: 0.001, decay: 0.15, sustain: 0.05, release: 0.35 }
        });
      } else if (type === 'steelpan') {
        synth = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2.5,
          modulationIndex: 18,
          envelope: { attack: 0.005, decay: 0.4, sustain: 0.15, release: 1.2 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.001, decay: 0.25, sustain: 0.2, release: 0.8 }
        });
      } else if (type === 'synth') {
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 1.4 }
        });
      } else {
        synth = new Tone.PolySynth(Tone.AMSynth, {
          harmonicity: 1.8,
          modulationIndex: 12,
          envelope: { attack: 0.004, decay: 0.25, sustain: 0.35, release: 1.6 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0.3, release: 1.2 }
        });
      }

      synth.connect(filter);
      synth.maxPolyphony = 32;
      synth.volume.value = SOUND_OFFSETS[type] ?? 0;
      applyVolume();
    }

    const activeKeys = new Set();
    const activeCounts = new Map();
    const activeHands = new Map();
    const pointerNotes = new Map();

    function isBlack(note) {
      return [1,3,6,8,10].includes(note % 12);
    }

    function getNoteName(note) {
      const octave = Math.floor(note / 12) - 1;
      return `${noteNames[note % 12]}${octave}`;
    }

    function buildKeyboard() {
      whiteKeysEl.innerHTML = '';
      blackKeysEl.innerHTML = '';
      const whiteKeys = [];
      for (let note = START_NOTE; note <= END_NOTE; note++) {
        if (!isBlack(note)) {
          const key = document.createElement('div');
          key.className = 'white-key key';
          key.dataset.note = note;
          key.addEventListener('animationend', () => key.classList.remove('key-flicker'));

          const label = document.createElement('div');
          label.className = 'key-label';
          label.textContent = getNoteName(note);
          key.appendChild(label);

          whiteKeysEl.appendChild(key);
          keys[note] = key;
          whiteKeys.push({ note, el: key });
        }
      }

      // Add black keys as absolute elements positioned between white keys
      whiteKeys.forEach(({ note, el }) => {
        const nextNote = note + 1;
        if (nextNote <= END_NOTE && isBlack(nextNote)) {
          const black = document.createElement('div');
          black.className = 'black-key key';
          black.dataset.note = nextNote;
          black.addEventListener('animationend', () => black.classList.remove('key-flicker'));

          const label = document.createElement('div');
          label.className = 'key-label';
          label.textContent = getNoteName(nextNote);
          black.appendChild(label);

          blackKeysEl.appendChild(black);
          keys[nextNote] = black;

          const left = el.offsetLeft + el.offsetWidth;
          black.style.left = `${left}px`;
        }
      });
    }

    function buildKeyMap() {
      const canvasRect = canvas.getBoundingClientRect();
      Object.keys(keys).forEach((note) => {
        const rect = keys[note].getBoundingClientRect();
        keyPositions[note] = {
          x: rect.left - canvasRect.left,
          width: rect.width,
          isBlack: isBlack(Number(note))
        };
      });
    }

    function layoutBlackKeys() {
      const whites = Array.from(whiteKeysEl.querySelectorAll('.white-key'));
      const whiteOffset = whiteKeysEl.offsetLeft;
      const minBlackWidth = window.innerWidth <= 980 ? 6 : 10;
      whites.forEach((white) => {
        const baseNote = parseInt(white.dataset.note, 10);
        const nextNote = baseNote + 1;
        if (nextNote <= END_NOTE && isBlack(nextNote)) {
          const black = keys[nextNote];
          if (!black) return;
          const width = Math.max(minBlackWidth, white.offsetWidth * 0.55);
          const center = whiteOffset + white.offsetLeft + white.offsetWidth;
          black.style.width = `${width}px`;
          black.style.left = `${center - width / 2}px`;
        }
      });
    }

    // metronome is now in the transport bar

    function updateNoteGeometry() {
      if (!notes.length) return;
      notes.forEach((note) => {
        const pos = keyPositions[note.midi];
        if (!pos) return;
        note.x = pos.x;
        note.width = pos.width;
        note.isBlack = pos.isBlack;
      });
    }

    function clearKeyHighlights() {
      Object.values(keys).forEach((key) => {
        key.classList.remove('key-in-scale');
        key.classList.remove('key-out-of-scale');
      });
    }

    function applyKeyHighlight() {
      if (!keyHighlightOn || !currentKeySignature) return;
      const rootName = normalizeKeyName(currentKeySignature.key);
      const root = keyToPitch[rootName];
      if (root === undefined) return;
      const scaleType = (currentKeySignature.scale || 'major').toLowerCase();
      const scale = scaleType.includes('minor') ? scaleMinor : scaleMajor;
      Object.keys(keys).forEach((noteStr) => {
        const note = Number(noteStr);
        const pitch = note % 12;
        const inScale = scale.includes((pitch - root + 12) % 12);
        keys[note].classList.toggle('key-in-scale', inScale);
      });
    }

    function resizeCanvas() {
      const highway = document.getElementById('highway');
      viewportWidth = highway.clientWidth;
      viewportHeight = highway.clientHeight;
      pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewportWidth * pixelRatio);
      canvas.height = Math.floor(viewportHeight * pixelRatio);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      requestAnimationFrame(() => {
        layoutBlackKeys();
        buildKeyMap();
        updateNoteGeometry();
        renderSeekMarks();
      });
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('visible');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => toast.classList.remove('visible'), 1800);
    }

    function performSeekRefresh(songTime) {
      Tone.Transport.seconds = songTime / playbackSpeed;
      clearActive();
      if (synth) synth.releaseAll();
      buildPart();
      lastIndex = lowerBound(songTime, renderNotes);
      if (isLooping) {
        updateLoopFromMarks();
      }
    }

    function flushSeekRefresh() {
      if (seekRefreshTimer) {
        clearTimeout(seekRefreshTimer);
        seekRefreshTimer = null;
      }
      if (pendingSeekSongTime === null) return;
      const songTime = pendingSeekSongTime;
      pendingSeekSongTime = null;
      performSeekRefresh(songTime);
    }

    function queueSeekRefresh(songTime) {
      pendingSeekSongTime = songTime;
      if (!seekIsDragging) {
        flushSeekRefresh();
        return;
      }
      if (seekRefreshTimer) return;
      seekRefreshTimer = setTimeout(() => {
        seekRefreshTimer = null;
        flushSeekRefresh();
      }, 48);
    }

    buildKeyboard();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);


    function resetUIState() {
      isLooping = false;
      loopStartSong = 0;
      loopEndSong = 0;
      seekMarks = [];
      zoomValue = DEFAULTS.zoom;
      gridEnabled = false;
      gridLines = [];
      keyHighlightOn = false;
      handMode = DEFAULTS.handMode;
      clearKeyHighlights();
      speedSlider.value = String(DEFAULTS.speed);
      volumeSlider.value = String(DEFAULTS.volume);
      playbackSpeed = DEFAULTS.speed;
      Tone.Transport.playbackRate = 1;
      clearScheduled();
      paletteIndex = 2;
      applyPalette(paletteIndex);
      applyVolume();
      updateHandButtons();
      updateLoopUI();
      renderSeekMarks();
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
      playBtn.setAttribute('aria-label', 'Play');
    }

    function parseMidi(arrayBuffer, fileName, autoplay = true) {
      stopPlayback();
      resetUIState();
      const midi = new Midi(arrayBuffer);
      midiData = midi;
      notes = [];
      midi.tracks.forEach((track, idx) => {
        track.notes.forEach((note) => {
          notes.push({
            time: note.time,
            duration: note.duration,
            midi: note.midi,
            freq: midiToFreq(note.midi),
            velocity: note.velocity,
            track: idx
          });
        });
      });
      notes.sort((a, b) => a.time - b.time);
      assignHands(notes);
      rebuildHandCaches();
      notes.forEach((note) => {
        const vel = Math.max(0.2, note.velocity || 0.7);
        note.widthScale = 0.85 + vel * 0.25;
        note.alphaFactor = 0.7 + vel * 0.3;
        note.color = getNoteColor(note);
      });
      applyPalette(paletteIndex);

      totalDuration = midi.duration || (notes.length ? notes[notes.length - 1].time + notes[notes.length - 1].duration : 0);

      loopStartSong = 0;
      loopEndSong = totalDuration;
      isLooping = false;
      updateLoopUI();
      seekMarks = [];
      renderSeekMarks();

      songTitleEl.textContent = fileName ? fileName : '';
      buildTempoMap(midi);
      buildTimeSigMap(midi);
      buildGridLines();
      const tempoValue = Math.round(tempoMap[0]?.bpm || 0);
      tempoReadout.textContent = tempoValue ? `${tempoValue} BPM` : '';
      const inferred = inferKeyFromNotes(notes);
      const chosen = inferred;
      currentKeySignature = chosen;
      if (chosen) {
        keyToggleBtn.textContent = `${chosen.key} ${chosen.scale}`;
      } else {
        keyToggleBtn.textContent = '';
      }
      keyToggleBtn.classList.toggle('hidden', !keyToggleBtn.textContent);

      tempoReadout.classList.toggle('hidden', !tempoReadout.textContent);
      const showMeta = tempoReadout.textContent || keyToggleBtn.textContent || songTitleEl.textContent;
      centerMetaEl.classList.toggle('hidden', !showMeta);

      progress.value = 0;
      progress.max = totalDuration || 1;
      Tone.Transport.seconds = 0;
      lastIndex = 0;
      lastTime = 0;
      lastBeat = -1;

      updateNoteGeometry();
      gridEnabled = true;
      setControlsEnabled(true);
      updateLoopUI();
      if (autoplay) {
        showToast('MIDI loaded. Playing.');
        startPlayback();
      } else {
        showToast('MIDI loaded.');
      }
    }

    function setControlsEnabled(enabled) {
      [playBtn, stopBtn, markLoopBtn, jumpMarkBtn, loopToggleBtn, soundSelect, paletteBtn, handModeBtn].forEach((btn) => {
        btn.disabled = !enabled;
      });
      if (!enabled) {
        songTitleEl.textContent = '';
        tempoReadout.textContent = '';
        keyToggleBtn.textContent = '';
        tempoReadout.classList.add('hidden');
        keyToggleBtn.classList.add('hidden');
        centerMetaEl.classList.add('hidden');
        keyHighlightOn = false;
        notes.forEach((note) => delete note.hand);
        notesLeft = [];
        notesRight = [];
        renderNotes = [];
        splitPoint = 60;
        clearKeyHighlights();
        gridEnabled = false;
        gridLines = [];
        handMode = DEFAULTS.handMode;
        updateHandButtons();
      }
    }

    function applyEditedLoopBounds(nextStart, nextEnd) {
      if (!totalDuration) return false;
      const EPS = 0.001;
      const prevStart = loopStartSong;
      const prevEnd = loopEndSong;

      let start = Math.max(0, Math.min(nextStart, totalDuration));
      let end = Math.max(0, Math.min(nextEnd, totalDuration));
      if (end - start < 0.01) {
        if (start >= totalDuration) {
          start = Math.max(0, totalDuration - 0.01);
          end = totalDuration;
        } else {
          end = Math.min(totalDuration, start + 0.01);
        }
      }

      seekMarks = seekMarks.filter((t) => {
        const isPrevStartBoundary = prevStart > EPS && Math.abs(t - prevStart) < EPS;
        const isPrevEndBoundary = prevEnd < totalDuration - EPS && Math.abs(t - prevEnd) < EPS;
        return !(isPrevStartBoundary || isPrevEndBoundary);
      });

      if (start > EPS) {
        insertSortedUniqueMark(seekMarks, start, EPS);
      }
      if (end < totalDuration - EPS) {
        insertSortedUniqueMark(seekMarks, end, EPS);
      }

      loopStartSong = start;
      loopEndSong = end;
      isLooping = true;
      setTransportLoop();

      const songTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      if (songTime < loopStartSong || songTime > loopEndSong) {
        progress.value = String(loopStartSong);
        Tone.Transport.seconds = loopStartSong / playbackSpeed;
        lastIndex = lowerBound(loopStartSong, renderNotes);
      }

      if (Tone.Transport.state === 'started') {
        buildPart();
      }
      updateLoopUI();
      showToast(`Loop updated: ${formatTime(loopStartSong)} - ${formatTime(loopEndSong)}.`);
      return true;
    }

    function commitLoopReadoutEdits() {
      if (!isLooping || !totalDuration) return;
      const parsedStart = parseTimeInput(loopStartInput.value);
      const parsedEnd = parseTimeInput(loopEndInput.value);
      if (parsedStart === null || parsedEnd === null) {
        loopStartInput.value = formatTime(loopStartSong);
        loopEndInput.value = formatTime(loopEndSong);
        showToast('Invalid loop time. Use m:ss or seconds.');
        return;
      }
      applyEditedLoopBounds(parsedStart, parsedEnd);
    }

    function getNoteColor(note) {
      const isLeft = note.hand ? note.hand === 'left' : note.midi < splitPoint;
      return isLeft ? leftHandColor : rightHandColor;
    }

    function isLeftHand(note) {
      if (note.hand) return note.hand === 'left';
      return note.midi < splitPoint;
    }

    function computeSplitPoint(notesList) {
      if (!notesList.length) return 60;
      let c1 = 40;
      let c2 = 72;
      for (let iter = 0; iter < 8; iter++) {
        let s1 = 0;
        let s2 = 0;
        let n1 = 0;
        let n2 = 0;
        for (const note of notesList) {
          const d1 = Math.abs(note.midi - c1);
          const d2 = Math.abs(note.midi - c2);
          if (d1 <= d2) {
            s1 += note.midi;
            n1++;
          } else {
            s2 += note.midi;
            n2++;
          }
        }
        if (n1) c1 = s1 / n1;
        if (n2) c2 = s2 / n2;
      }
      const low = Math.min(c1, c2);
      const high = Math.max(c1, c2);
      return (low + high) / 2;
    }

    function assignHands(notesList) {
      if (!notesList.length) {
        splitPoint = 60;
        return;
      }

      splitPoint = computeSplitPoint(notesList);

      const chordWindow = 0.06;
      const chordSpan = 10;
      let i = 0;

      while (i < notesList.length) {
        const startTime = notesList[i].time;
        const group = [];
        let j = i;
        while (j < notesList.length && notesList[j].time <= startTime + chordWindow) {
          group.push(notesList[j]);
          j++;
        }

        if (group.length >= 3) {
          const pitches = group.map((n) => n.midi).sort((a, b) => a - b);
          const span = pitches[pitches.length - 1] - pitches[0];
          if (span <= chordSpan) {
            const median = pitches[Math.floor(pitches.length / 2)];
            const hand = median < splitPoint ? 'left' : 'right';
            group.forEach((n) => {
              n.hand = hand;
            });
            i = j;
            continue;
          }
        }

        group.forEach((n) => {
          n.hand = n.midi < splitPoint ? 'left' : 'right';
        });

        i = j;
      }
    }

    function rebuildHandCaches() {
      notesLeft = [];
      notesRight = [];
      for (const note of notes) {
        if (note.hand === 'left') {
          notesLeft.push(note);
        } else if (note.hand === 'right') {
          notesRight.push(note);
        } else if (note.midi < splitPoint) {
          notesLeft.push(note);
        } else {
          notesRight.push(note);
        }
      }
      updateRenderNotes();
    }

    function updateRenderNotes() {
      if (handMode === 'left') {
        renderNotes = notesLeft;
      } else if (handMode === 'right') {
        renderNotes = notesRight;
      } else {
        renderNotes = notes;
      }
      lastIndex = 0;
      lastTime = 0;
    }

    function updateHandButtons() {
      handModeBtn.classList.toggle('active', handMode !== 'both');
      const handLabel = handMode === 'both' ? 'Hands: both' : `Hand: ${handMode}`;
      handModeBtn.setAttribute('aria-label', handLabel);
      handModeBtn.setAttribute('title', handLabel);
    }

    function releaseKeyboardHeldNotes() {
      keyboardHeldNotes.forEach((midi) => stopKey(midi));
      keyboardHeldNotes.clear();
    }

    function updateKeyboardModeButton() {
      keyboardModeBtn.classList.toggle('active', keyboardModeEnabled);
      const label = keyboardModeEnabled ? 'Keyboard mode: on' : 'Keyboard mode: off';
      keyboardModeBtn.setAttribute('aria-label', label);
      keyboardModeBtn.setAttribute('title', `${label} (FL-style typing keys)`);
    }

    function setKeyboardMode(nextEnabled) {
      const enabled = Boolean(nextEnabled);
      if (enabled === keyboardModeEnabled) return;
      keyboardModeEnabled = enabled;
      if (!keyboardModeEnabled) {
        releaseKeyboardHeldNotes();
      }
      updateKeyboardModeButton();
      showToast(keyboardModeEnabled ? 'Keyboard mode on. Hotkeys disabled.' : 'Keyboard mode off. Hotkeys enabled.');
    }

    function applyPalette(index) {
      const palette = PALETTES[index] || PALETTES[0];
      leftHandColor = palette.left;
      rightHandColor = palette.right;
      notes.forEach((note) => {
        note.color = getNoteColor(note);
      });
      activeKeys.forEach((midi) => {
        const key = keys[midi];
        if (!key) return;
        const hand = activeHands.get(midi) || (midi < splitPoint ? 'left' : 'right');
        key.style.setProperty('--active-color', hand === 'left' ? leftHandColor : rightHandColor);
      });
    }

    function clearScheduled() {
      if (scheduledPart) {
        scheduledPart.dispose();
        scheduledPart = null;
      }
    }

    function buildPart() {
      clearScheduled();
      if (!renderNotes.length) return;
      scheduledPart = new Tone.Part((time, note) => {
        const scaledDuration = note.duration / playbackSpeed;
        synth.triggerAttackRelease(note.freq || midiToFreq(note.midi), scaledDuration, time, note.velocity);
        Tone.Draw.schedule(() => addActive(note), time);
        Tone.Draw.schedule(() => removeActive(note.midi), time + scaledDuration);
      }, renderNotes.map((n) => [n.time / playbackSpeed, n]));
      scheduledPart.start(0);
    }

    function isNoteInScale(midiNote) {
      if (!currentKeySignature) return true;
      const rootName = normalizeKeyName(currentKeySignature.key);
      const root = keyToPitch[rootName];
      if (root === undefined) return true;
      const scaleType = (currentKeySignature.scale || 'major').toLowerCase();
      const scale = scaleType.includes('minor') ? scaleMinor : scaleMajor;
      const pitch = midiNote % 12;
      return scale.includes((pitch - root + 12) % 12);
    }

    function addActive(note) {
      const key = keys[note.midi];
      const count = activeCounts.get(note.midi) || 0;
      activeCounts.set(note.midi, count + 1);
      if (count > 0) {
        return;
      }

      if (key) {
        key.classList.add('active');
        key.style.setProperty('--active-color', note.color || getNoteColor(note));
        activeHands.set(note.midi, note.hand || (note.midi < splitPoint ? 'left' : 'right'));
        if (keyHighlightOn && !isNoteInScale(note.midi)) {
          key.classList.add('key-out-of-scale');
        } else {
          key.classList.remove('key-out-of-scale');
        }
      }
      activeKeys.add(note.midi);
    }

    function removeActive(note) {
      const count = activeCounts.get(note) || 0;
      if (count > 1) {
        activeCounts.set(note, count - 1);
        return;
      }
      activeCounts.delete(note);
      const key = keys[note];
      if (key) {
        key.classList.remove('active');
        key.classList.remove('key-out-of-scale');
        key.classList.remove('key-flicker');
        requestAnimationFrame(() => key.classList.add('key-flicker'));
      }
      activeHands.delete(note);
      activeKeys.delete(note);
    }

    function clearActive() {
      activeKeys.forEach((note) => removeActive(note));
      activeCounts.clear();
    }

    function updateLoopUI() {
      progress.classList.toggle('loop-active', isLooping);
      loopReadout.classList.toggle('hidden', !isLooping);
      if (isLooping) {
        loopStartInput.value = formatTime(loopStartSong);
        loopEndInput.value = formatTime(loopEndSong);
      }
      loopToggleBtn.classList.toggle('active', isLooping);
      loopToggleBtn.disabled = !seekMarks.length && !isLooping;
      renderSeekMarks();
    }

    function renderSeekMarks() {
      if (!seekMarksEl) return;
      seekMarksEl.innerHTML = '';
      if (!totalDuration) return;
      if (isLooping && loopEndSong > loopStartSong) {
        const loopBar = document.createElement('span');
        loopBar.className = 'seek-loop';
        const startRatio = Math.max(0, Math.min(1, loopStartSong / totalDuration));
        const endRatio = Math.max(0, Math.min(1, loopEndSong / totalDuration));
        const startPct = startRatio * 100;
        const endPct = endRatio * 100;
        loopBar.style.left = `${startPct}%`;
        loopBar.style.right = `${Math.max(0, 100 - endPct)}%`;

        const EDGE_EPS = 0.001;
        const leftCurved = startRatio <= EDGE_EPS;
        const rightCurved = endRatio >= 1 - EDGE_EPS;
        if (leftCurved && rightCurved) {
          loopBar.style.borderRadius = '999px';
        } else if (leftCurved) {
          loopBar.style.borderRadius = '999px 0 0 999px';
        } else if (rightCurved) {
          loopBar.style.borderRadius = '0 999px 999px 0';
        } else {
          loopBar.style.borderRadius = '0';
        }
        seekMarksEl.appendChild(loopBar);
      }
      seekMarks
        .filter((time) => time >= 0 && time <= totalDuration)
        .forEach((time) => {
          const mark = document.createElement('span');
          mark.className = 'seek-mark';
          const pct = (time / totalDuration) * 100;
          mark.style.left = `calc(${pct}% - 1px)`;
          seekMarksEl.appendChild(mark);
        });

    }

    function setTransportLoop() {
      Tone.Transport.loopStart = loopStartSong / playbackSpeed;
      Tone.Transport.loopEnd = loopEndSong / playbackSpeed;
      Tone.Transport.loop = isLooping;
    }


    async function startPlayback() {
      if (!midiData) return;
      await ensureAudioStarted();
      setTransportLoop();
      playbackSpeed = Number(speedSlider.value);
      Tone.Transport.playbackRate = 1;
      buildPart();

      if (Tone.Transport.state !== 'started') {
        Tone.Transport.start('+0.05', Tone.Transport.seconds || 0);
      }
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';
      playBtn.setAttribute('aria-label', 'Pause');
    }

    function pausePlayback() {
      if (Tone.Transport.state === 'started') {
        Tone.Transport.pause();
        playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
        playBtn.setAttribute('aria-label', 'Play');
      }
    }

    function stopPlayback() {
      const loopActive = isLooping && loopEndSong > loopStartSong;
      const targetSongTime = loopActive ? loopStartSong : 0;
      Tone.Transport.stop();
      Tone.Transport.seconds = targetSongTime / playbackSpeed;
      progress.value = targetSongTime;
      timeReadout.textContent = `${formatTime(targetSongTime)} / ${formatTime(totalDuration)}`;
      clearActive();
      clearScheduled();
      setTransportLoop();
      updateLoopUI();
      lastIndex = lowerBound(targetSongTime, renderNotes);
      lastTime = targetSongTime;
      lastBeat = -1;
      if (synth) {
        synth.releaseAll();
      }
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
      playBtn.setAttribute('aria-label', 'Play');
    }

    function lowerBound(time, list) {
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].time < time) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    let lastIndex = 0;
    let lastTime = 0;

    function lowerBoundGridLines(time) {
      let lo = 0;
      let hi = gridLines.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (gridLines[mid].time < time) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    function drawGrid(currentTime, pixelsPerSecond, hitLineY, startTime, endTime) {
      ctx.fillStyle = 'rgb(9, 12, 18)';
      ctx.fillRect(0, 0, viewportWidth, viewportHeight);

      if (!gridEnabled || !gridLines.length) return;

      const startIndex = lowerBoundGridLines(startTime);
      const barPath = new Path2D();
      const beatPath = new Path2D();
      const barYs = [];

      for (let i = startIndex; i < gridLines.length; i++) {
        const line = gridLines[i];
        if (line.time > endTime) break;
        const y = hitLineY - (line.time - currentTime) * pixelsPerSecond;
        if (line.isBar) {
          barPath.moveTo(0, y);
          barPath.lineTo(viewportWidth, y);
          barYs.push(y);
        } else {
          beatPath.moveTo(0, y);
          beatPath.lineTo(viewportWidth, y);
        }
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = 1;
      ctx.stroke(beatPath);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke(barPath);

      if (barYs.length) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.06)';
        for (const y of barYs) {
          ctx.fillRect(0, y - 4, viewportWidth, 8);
        }
      }
    }

    function drawNotes() {
      if (!midiData) return;
      const currentTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      const lookAhead = 3.5;
      const lookBehind = 1.2;
      const pixelsPerSecond = zoomValue;
      const hitLineY = viewportHeight;

      const startTime = Math.max(0, currentTime - lookBehind);
      const endTime = currentTime + lookAhead;

      drawGrid(currentTime, pixelsPerSecond, hitLineY, startTime, endTime);

      if (currentTime < lastTime - 0.2) {
        lastIndex = lowerBound(startTime, renderNotes);
      }

      while (lastIndex < renderNotes.length && renderNotes[lastIndex].time + renderNotes[lastIndex].duration < startTime) {
        lastIndex++;
      }

      // Ghost preview: next bar (outline only)
      let nextBarStart = null;
      let nextBarEnd = null;
      if (gridLines.length) {
        let idx = lowerBoundGridLines(currentTime);
        while (idx < gridLines.length && !gridLines[idx].isBar) idx++;
        if (idx < gridLines.length) {
          nextBarStart = gridLines[idx].time;
          let nextIdx = idx + 1;
          while (nextIdx < gridLines.length && !gridLines[nextIdx].isBar) nextIdx++;
          if (nextIdx < gridLines.length) nextBarEnd = gridLines[nextIdx].time;
        }
      }

      if (nextBarStart !== null && nextBarEnd !== null && zoomValue >= 120) {
        const ghostStart = Math.max(nextBarStart, endTime);
        const ghostEnd = nextBarEnd;
        if (ghostEnd > ghostStart) {
          const ghostStartIndex = lowerBound(ghostStart, renderNotes);
          for (let i = ghostStartIndex; i < renderNotes.length; i++) {
            const note = renderNotes[i];
            if (note.time > ghostEnd) break;
            if (note.x === undefined) continue;
            const yTop = hitLineY - (note.time - currentTime) * pixelsPerSecond - note.duration * pixelsPerSecond;
            const height = note.duration * pixelsPerSecond;
            const drawHeight = Math.max(5, height);
            const width = note.width * note.widthScale;
            const x = note.x + (note.width - width) / 2;
            ctx.globalAlpha = 0.25;
            ctx.strokeStyle = note.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, yTop, width, drawHeight);
          }
        }
      }

      for (let i = lastIndex; i < renderNotes.length; i++) {
        const note = renderNotes[i];
        if (note.time > endTime) break;
        if (note.x === undefined) continue;

        const yTop = hitLineY - (note.time - currentTime) * pixelsPerSecond - note.duration * pixelsPerSecond;
        const height = note.duration * pixelsPerSecond;
        const minHeight = 5;
        const isStaccato = height < minHeight;
        const drawHeight = isStaccato ? minHeight : height;
        const width = note.width * note.widthScale;
        const x = note.x + (note.width - width) / 2;

        // Note shadow
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(x + 1, yTop + 2, width, drawHeight);

        // Note body (velocity brightness)
        ctx.fillStyle = note.color;
        const baseAlpha = note.isBlack ? 0.82 : 0.92;
        ctx.globalAlpha = baseAlpha * note.alphaFactor;
        ctx.fillRect(x, yTop, width, drawHeight);

        if (isStaccato) {
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = note.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, yTop + 0.5, width - 1, drawHeight - 1);
        }

        // Hit flash at impact
        if (Math.abs(note.time - currentTime) <= 0.03) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = note.color;
          ctx.fillRect(x, hitLineY - 2, width, 2);
        }
      }

      ctx.globalAlpha = 1;
      lastTime = currentTime;
    }

    function updateUI() {
      if (!midiData) return;
      const currentTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      timeReadout.textContent = `${formatTime(currentTime)} / ${formatTime(totalDuration)}`;
      progress.value = Math.min(currentTime, totalDuration);
      if (currentTime >= totalDuration && Tone.Transport.state === 'started') {
        stopPlayback();
      }
    }

    const ACTIVE_FPS = 30;
    const IDLE_FPS = 8;
    const UI_UPDATE_INTERVAL = 500;
    let lastFrame = 0;
    let lastUiUpdate = 0;
    let lastBeat = -1;

    function animationLoop(timestamp) {
      if (document.visibilityState === 'hidden') {
        requestAnimationFrame(animationLoop);
        return;
      }
      if (!lastFrame) lastFrame = timestamp;
      const isPlaying = Tone.Transport.state === 'started';
      const targetInterval = 1000 / (isPlaying ? ACTIVE_FPS : IDLE_FPS);
      const delta = timestamp - lastFrame;
      if (delta >= targetInterval) {
        if (isPlaying) {
          drawNotes();
        }
        if (timestamp - lastUiUpdate >= UI_UPDATE_INTERVAL) {
          updateUI();
          lastUiUpdate = timestamp;
        }
        if (isPlaying && gridLines.length) {
          const songSeconds = (Tone.Transport.seconds || 0) * playbackSpeed;
          const beatIndex = Math.max(0, lowerBoundGridLines(songSeconds) - 1);
          if (beatIndex !== lastBeat) {
            lastBeat = beatIndex;
            metronomeIndicator.classList.add('flash');
            setTimeout(() => metronomeIndicator.classList.remove('flash'), 60);
          }
        } else {
          metronomeIndicator.classList.remove('flash');
        }
        lastFrame = timestamp;
      }
      requestAnimationFrame(animationLoop);
    }

    requestAnimationFrame(animationLoop);

    function playKey(note, velocity = 0.8) {
      if (!synth) return;
      const key = keys[note];
      if (key) {
        const inScale = key.classList.contains('key-in-scale');
        const color = inScale ? 'rgba(255, 140, 0, 0.9)' : '#00f0ff';
        key.style.setProperty('--active-color', color);
      }
      synth.triggerAttack(midiToFreq(note), undefined, velocity);
      addActive({ midi: note, track: 0 });
    }

    function stopKey(note) {
      if (!synth) return;
      synth.triggerRelease(midiToFreq(note));
      removeActive(note);
    }

    keyboard.addEventListener('pointerdown', async (event) => {
      const target = event.target.closest('[data-note]');
      if (!target) return;
      event.preventDefault();
      await ensureAudioStarted();
      const note = Number(target.dataset.note);
      playKey(note);
      pointerNotes.set(event.pointerId, note);
      keyboard.setPointerCapture(event.pointerId);
    });

    keyboard.addEventListener('pointermove', (event) => {
      if (!pointerNotes.has(event.pointerId)) return;
      const currentNote = pointerNotes.get(event.pointerId);
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const target = el ? el.closest('[data-note]') : null;
      if (!target) return;
      const nextNote = Number(target.dataset.note);
      if (nextNote !== currentNote) {
        stopKey(currentNote);
        playKey(nextNote);
        pointerNotes.set(event.pointerId, nextNote);
      }
    });

    function releasePointer(event) {
      if (!pointerNotes.has(event.pointerId)) return;
      const note = pointerNotes.get(event.pointerId);
      stopKey(note);
      pointerNotes.delete(event.pointerId);
    }

    keyboard.addEventListener('pointerup', releasePointer);
    keyboard.addEventListener('pointercancel', releasePointer);
    keyboard.addEventListener('pointerleave', releasePointer);
    keyboardModeBtn.addEventListener('click', () => setKeyboardMode(!keyboardModeEnabled));

    fileInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => parseMidi(e.target.result, file.name, true);
      reader.readAsArrayBuffer(file);
    });

    document.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

    document.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => parseMidi(e.target.result, file.name, true);
        reader.readAsArrayBuffer(file);
      }
    });

    async function loadDefaultMidiOnStartup() {
      if (window.location.protocol === 'file:') {
        showToast('Default MIDI autoload needs an HTTP server.');
        return;
      }

      for (const path of DEFAULT_STARTUP_MIDI_PATHS) {
        try {
          const response = await fetch(path, { cache: 'no-store' });
          if (!response.ok) continue;
          const arrayBuffer = await response.arrayBuffer();
          const title = path.split('/').pop() || path;
          parseMidi(arrayBuffer, title, false);
          return;
        } catch (error) {
          console.warn(`Failed loading startup MIDI from ${path}.`, error);
        }
      }

      showToast('Default MIDI not found. Use folder icon to load one.');
    }

    playBtn.addEventListener('click', () => {
      if (Tone.Transport.state === 'started') {
        pausePlayback();
      } else {
        startPlayback();
      }
    });
    stopBtn.addEventListener('click', stopPlayback);


    speedSlider.addEventListener('input', () => {
      const value = Number(speedSlider.value);
      if (!midiData) return;
      const songTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      clearActive();
      if (synth) synth.releaseAll();
      playbackSpeed = value;
      Tone.Transport.pause();
      Tone.Transport.seconds = songTime / playbackSpeed;
      setTransportLoop();
      buildPart();
      Tone.Transport.start('+0.01', Tone.Transport.seconds || 0);
      lastIndex = lowerBound(songTime, renderNotes);
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';
      playBtn.setAttribute('aria-label', 'Pause');
      showToast(`Speed: ${value.toFixed(2)}x`);
    });

    volumeSlider.addEventListener('input', () => {
      applyVolume();
    });

    soundSelect.addEventListener('change', () => {
      createSynth(soundSelect.value);
      showToast(`Sound: ${soundSelect.options[soundSelect.selectedIndex].text}`);
    });

    paletteBtn.addEventListener('click', () => {
      paletteIndex = (paletteIndex + 1) % PALETTES.length;
      applyPalette(paletteIndex);
      showToast('Palette updated.');
    });

    paletteBtn.addEventListener('dblclick', () => {
      paletteIndex = 0;
      applyPalette(paletteIndex);
      showToast('Palette reset.');
    });

    function resetSlider(slider, value) {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }

    speedSlider.addEventListener('dblclick', () => resetSlider(speedSlider, DEFAULTS.speed));
    volumeSlider.addEventListener('dblclick', () => resetSlider(volumeSlider, DEFAULTS.volume));
    zoomSlider.addEventListener('dblclick', () => resetSlider(zoomSlider, DEFAULTS.zoom));


    keyToggleBtn.addEventListener('click', () => {
      if (!currentKeySignature) return;
      keyHighlightOn = !keyHighlightOn;
      keyToggleBtn.classList.toggle('active', keyHighlightOn);
      keyboard.classList.toggle('key-highlight-on', keyHighlightOn);
      clearKeyHighlights();
      if (keyHighlightOn) {
        applyKeyHighlight();
      }
    });

    [loopStartInput, loopEndInput].forEach((input) => {
      input.addEventListener('click', (event) => event.stopPropagation());
      input.addEventListener('pointerdown', (event) => event.stopPropagation());
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitLoopReadoutEdits();
          suppressLoopInputBlurCommit = true;
          input.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          loopStartInput.value = formatTime(loopStartSong);
          loopEndInput.value = formatTime(loopEndSong);
          suppressLoopInputBlurCommit = true;
          input.blur();
        }
      });
      input.addEventListener('blur', () => {
        if (suppressLoopInputBlurCommit) {
          suppressLoopInputBlurCommit = false;
          return;
        }
        commitLoopReadoutEdits();
      });
    });

    progress.addEventListener('input', () => {
      if (!midiData) return;
      let songTime = Number(progress.value);
      const now = performance.now();
      if (seekIsDragging && seekMarks.length) {
        const nearest = seekMarks.reduce((best, t) => {
          const d = Math.abs(t - songTime);
          return d < best.dist ? { time: t, dist: d } : best;
        }, { time: songTime, dist: Infinity });
        const snapThreshold = 0.12;
        if (nearest.dist <= snapThreshold || now < seekSnapUntil) {
          songTime = nearest.time;
          seekSnapUntil = now + 1000;
        } else {
          seekSnapUntil = 0;
        }
        progress.value = String(songTime);
      }
      Tone.Transport.seconds = songTime / playbackSpeed;
      timeReadout.textContent = `${formatTime(songTime)} / ${formatTime(totalDuration)}`;
      queueSeekRefresh(songTime);
    });

    progress.addEventListener('pointerdown', () => {
      seekIsDragging = true;
    });

    progress.addEventListener('click', (event) => {
      event.stopPropagation();
    });


    const stopSeekDrag = () => {
      seekIsDragging = false;
      seekSnapUntil = 0;
      flushSeekRefresh();
    };

    progress.addEventListener('pointerup', stopSeekDrag);
    progress.addEventListener('pointercancel', stopSeekDrag);
    progress.addEventListener('pointerleave', stopSeekDrag);


    zoomSlider.addEventListener('input', () => {
      zoomValue = Number(zoomSlider.value);
      showToast(`Zoom: ${zoomValue}`);
    });

    function getBarStart(time) {
      if (!gridLines.length) return time;
      const idx = Math.max(0, lowerBoundGridLines(time) - 1);
      return gridLines[idx]?.time ?? time;
    }

    function getAdjacentBar(time, direction) {
      if (!gridLines.length) return time;
      const idx = Math.max(0, lowerBoundGridLines(time) - 1);
      const target = idx + direction;
      if (target < 0) return 0;
      if (target >= gridLines.length) return totalDuration;
      return gridLines[target]?.time ?? time;
    }

    function getSeekTimeFromPointer(event) {
      const rect = progress.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      const clamped = Math.min(1, Math.max(0, ratio));
      return clamped * totalDuration;
    }

    function updateLoopFromMarks() {
      if (!isLooping) return;
      const songTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      const segment = resolveLoopSegment(songTime);
      if (!segment) return;
      loopStartSong = segment.start;
      loopEndSong = segment.end;
      setTransportLoop();
      if (Tone.Transport.state === 'started') {
        Tone.Transport.seconds = loopStartSong / playbackSpeed;
        buildPart();
      }
      updateLoopUI();
    }

    markLoopBtn.addEventListener('click', () => {
      const songTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      const mark = getBarStart(songTime);
      const added = insertSortedUniqueMark(seekMarks, mark, 0.001);
      isLooping = false;
      updateLoopUI();
      showToast(added ? `Loop mark set at ${formatTime(mark)}.` : `Loop mark already exists at ${formatTime(mark)}.`);
    });

    function resolveLoopSegment(songTime) {
      return resolveLoopSegmentFromMarks(seekMarks, songTime, totalDuration);
    }

    loopToggleBtn.addEventListener('click', () => {
      if (!seekMarks.length) return;
      if (!isLooping) {
        const songTime = (Tone.Transport.seconds || 0) * playbackSpeed;
        const segment = resolveLoopSegment(songTime);
        if (!segment) return;
        loopStartSong = segment.start;
        loopEndSong = segment.end;
        isLooping = true;
      } else {
        isLooping = false;
      }
      setTransportLoop();
      updateLoopUI();
      if (Tone.Transport.state === 'started') {
        buildPart();
      }
      if (isLooping) {
        showToast(`Loop on: ${formatTime(loopStartSong)} - ${formatTime(loopEndSong)}.`);
      } else {
        showToast('Loop off.');
      }
    });

    jumpMarkBtn.addEventListener('click', () => {
      if (!seekMarks.length) return;
      const songTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      const sorted = seekMarks;
      const next = sorted.find((t) => t > songTime + 0.001);
      const target = next !== undefined ? next : sorted[0];
      progress.value = String(target);
      Tone.Transport.seconds = target / playbackSpeed;
      clearActive();
      if (synth) synth.releaseAll();
      buildPart();
      lastIndex = lowerBound(target, renderNotes);
      showToast(`Jumped to mark ${formatTime(target)}.`);
    });

    jumpMarkBtn.addEventListener('dblclick', () => {
      seekMarks = [];
      isLooping = false;
      loopStartSong = 0;
      loopEndSong = totalDuration;
      updateLoopUI();
      const songTime = (Tone.Transport.seconds || 0) * playbackSpeed;
      progress.value = String(songTime);
      Tone.Transport.seconds = songTime / playbackSpeed;
      clearActive();
      if (synth) synth.releaseAll();
      buildPart();
      lastIndex = lowerBound(songTime, renderNotes);
    });

    function toggleHandMode() {
      if (handMode === 'both') {
        handMode = 'left';
      } else if (handMode === 'left') {
        handMode = 'right';
      } else {
        handMode = 'both';
      }
      updateHandButtons();
      updateRenderNotes();
      clearActive();
      if (synth) synth.releaseAll();
      buildPart();
      showToast(handMode === 'both' ? 'Hands: both' : `Hand: ${handMode}`);
    }

    function seekByDelta(delta) {
      if (!midiData || !Number.isFinite(delta) || delta === 0) return;
      const currentSongTime = Number(progress.value) || 0;
      const nextSongTime = Math.min(totalDuration, Math.max(0, currentSongTime + delta));
      progress.value = String(nextSongTime);
      Tone.Transport.seconds = nextSongTime / playbackSpeed;
      timeReadout.textContent = `${formatTime(nextSongTime)} / ${formatTime(totalDuration)}`;
      queueSeekRefresh(nextSongTime);
    }

    function adjustSpeedByDelta(delta) {
      const current = Number(speedSlider.value);
      const min = Number(speedSlider.min) || 0.5;
      const max = Number(speedSlider.max) || 2;
      const step = Number(speedSlider.step) || 0.05;
      const next = Math.min(max, Math.max(min, current + delta));
      const snapped = Math.round(next / step) * step;
      if (Math.abs(snapped - current) < 1e-6) return;
      speedSlider.value = String(Number(snapped.toFixed(2)));
      speedSlider.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function isTypingTarget(target) {
      if (!target || !(target instanceof Element)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    handModeBtn.addEventListener('click', toggleHandMode);

    document.addEventListener('keydown', async (event) => {
      if (!keyboardModeEnabled || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const midiNote = KEYBOARD_MIDI_MAP[event.code];
      if (midiNote === undefined) return;
      event.preventDefault();
      if (keyboardHeldNotes.has(event.code) || event.repeat) return;
      await ensureAudioStarted();
      playKey(midiNote);
      keyboardHeldNotes.set(event.code, midiNote);
    });

    document.addEventListener('keyup', (event) => {
      if (!keyboardModeEnabled) return;
      const midiNote = keyboardHeldNotes.get(event.code);
      if (midiNote === undefined) return;
      event.preventDefault();
      stopKey(midiNote);
      keyboardHeldNotes.delete(event.code);
    });

    window.addEventListener('blur', releaseKeyboardHeldNotes);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseKeyboardHeldNotes();
    });

    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (keyboardModeEnabled) return;

      if (event.code === 'Space') {
        event.preventDefault();
        if (Tone.Transport.state === 'started') {
          pausePlayback();
        } else {
          startPlayback();
        }
        return;
      }
      if (event.code === 'Slash' && event.shiftKey) {
        event.preventDefault();
        showToast('Hotkeys: Space Play/Pause | R Stop | <-/-> Seek | M Mark | N Next Mark | L Loop | H Hand | [-]/[+] Speed | 0 Speed Reset');
        return;
      }

      if (!midiData) return;

      if (event.code === 'KeyR') {
        event.preventDefault();
        stopPlayback();
        return;
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        seekByDelta(event.shiftKey ? -5 : -2);
        return;
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        seekByDelta(event.shiftKey ? 5 : 2);
        return;
      }
      if (event.code === 'KeyM') {
        event.preventDefault();
        if (!markLoopBtn.disabled) markLoopBtn.click();
        return;
      }
      if (event.code === 'KeyN') {
        event.preventDefault();
        if (!jumpMarkBtn.disabled) jumpMarkBtn.click();
        return;
      }
      if (event.code === 'KeyL') {
        event.preventDefault();
        if (!loopToggleBtn.disabled) loopToggleBtn.click();
        return;
      }
      if (event.code === 'KeyH') {
        event.preventDefault();
        if (!handModeBtn.disabled) toggleHandMode();
        return;
      }
      if (event.code === 'BracketLeft' || event.code === 'Minus') {
        event.preventDefault();
        adjustSpeedByDelta(-0.05);
        return;
      }
      if (event.code === 'BracketRight' || event.code === 'Equal') {
        event.preventDefault();
        adjustSpeedByDelta(0.05);
        return;
      }
      if (event.code === 'Digit0') {
        event.preventDefault();
        resetSlider(speedSlider, DEFAULTS.speed);
        return;
      }
    });

    setControlsEnabled(false);
    updateKeyboardModeButton();
    loadDefaultMidiOnStartup();
