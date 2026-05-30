// Procedural music engine. Layered Web Audio synthesis driven by game
// state — exploration drone + sparse plucks, a sub-bass throb that
// fades up under combat, a quieter warmer bed in safe rooms. Everything
// is generated in code (no asset files), in keeping with the rest of
// the project.
//
// ── Layer architecture ────────────────────────────────────────────────
//
// All layers are PERSISTENT — three running oscillator stacks whose
// per-layer gains we slide to "mix" between states. Smooth crossfade,
// no awkward starts/stops. Each layer feeds master + a wet send into
// the shared reverb convolver in sfx.ts (so the music sits inside the
// same room as the SFX).
//
//   droneGain    — root + fifth + octave triangle drones with slow
//                  LFOs on detune and amplitude. Always non-zero
//                  except in 'off' / 'death'; carries the floor's
//                  tonal centre.
//   pluckGain    — gain envelope for scheduled pluck notes. The
//                  scheduler picks pitches from the palette's mode
//                  and times them sparsely. Ducks in combat.
//   combatGain   — low sub-throb (a sine + octave with an amplitude
//                  LFO at ~1.3 Hz). Audible only in 'combat'.
//
// ── State machine ────────────────────────────────────────────────────
//
// Driven by a tiny heat accumulator that listens to combat events:
//   attack:hit      → heat += 1.0
//   player:damaged  → heat += 1.5
//   enemy:killed    → heat += 0.6
// Decay  -0.55 / sec. Heat crosses thresholds to flip the state:
//   > 1.2 → 'combat'        (urgent layer fades in fast)
//   < 0.35 → back to floor-default (slow ramp)
//
// level:loaded  → 'safe' if levelId starts with 'safe-', else 'exploration'
// player:killed → 'death' (silence with a brief tail)
//
// ── Palette ──────────────────────────────────────────────────────────
//
// Per-act palette swaps the drone root, the pluck mode, and the
// instrument timbre. Act 1 ships here; Acts 2/3 are stubs to fill in
// once the system feels right on Act 1.

import { on as onEvent } from '../broadcast/event-bus';
import { getAudioContext, getMasterGain, getReverbInput } from './sfx';
import { actForDepth } from '../level/acts';
import { getCurrentDepth } from '../level/loader';

export type MusicState = 'off' | 'exploration' | 'combat' | 'safe' | 'death';

interface MusicPalette {
  /** Drone root in Hz. */
  rootHz: number;
  /** Semitone offsets from the root that the pluck scheduler may pick
   *  from. Should be a scale or mode — pentatonic minor, phrygian,
   *  locrian, hungarian minor, etc. Smaller pools = more tonal weight. */
  modeIntervals: number[];
  /** Octave offsets the plucks bounce through (relative to the root's
   *  octave). [0, 1] means root-octave + one above. */
  pluckOctaveRange: [number, number];
  /** Drone oscillator waveform — 'triangle' = warm chant, 'sawtooth' =
   *  pinched/sour, 'sine' = pure / ethereal. */
  droneWave: OscillatorType;
  /** Pluck filter cutoff — lower = duller / muffled, higher = bell-like. */
  pluckCutoff: number;
}

// ── Palettes ───────────────────────────────────────────────────────────

/** Act 1 — The Old Refectory. Warm, monastic, dark. Phrygian mode at D2
 *  is the classic "candlelit stone hall" sound — minor second on top of
 *  the root gives the anxious lean without going abrasive. */
const PALETTE_REFECTORY: MusicPalette = {
  rootHz: 73.42,                            // D2
  modeIntervals: [0, 1, 3, 5, 7, 8, 10],    // phrygian: ♭2, ♭3, 4, 5, ♭6, ♭7
  pluckOctaveRange: [2, 3],
  droneWave: 'triangle',
  pluckCutoff: 3200,
};

/** Act 2 — The Cistern. Cold, watery, unstable. Locrian at A1 — the most
 *  dissonant minor mode, fits "subterranean / drowned / wrong". */
const PALETTE_CISTERN: MusicPalette = {
  rootHz: 55.00,                            // A1
  modeIntervals: [0, 1, 3, 5, 6, 8, 10],    // locrian
  pluckOctaveRange: [3, 4],
  droneWave: 'sine',
  pluckCutoff: 2200,                        // duller — through-water filter
};

/** Act 3 — The Verdant Rot. Sickly, organic, buzzing. Hungarian minor at
 *  F2 — the augmented fourth gives the "wrong nature" colour. */
const PALETTE_VERDANT: MusicPalette = {
  rootHz: 87.31,                            // F2
  modeIntervals: [0, 2, 3, 6, 7, 8, 11],    // hungarian minor
  pluckOctaveRange: [2, 3],
  droneWave: 'sawtooth',
  pluckCutoff: 1800,                        // muffled, fungal
};

/** Safe rooms — sparser, lighter, warmer than the dungeon palette.
 *  Same root as Act 1 (D2) so the tonal centre travels with the player;
 *  pluck pool trims to pentatonic for a calmer, less-chromatic feel. */
const PALETTE_SAFE: MusicPalette = {
  rootHz: 73.42,                            // D2 (same as Refectory)
  modeIntervals: [0, 3, 5, 7, 10],          // minor pentatonic
  pluckOctaveRange: [3, 4],                 // brighter octaves
  droneWave: 'triangle',
  pluckCutoff: 4200,                        // bell-clear
};

function paletteForLevel(levelId: string): MusicPalette {
  if (levelId.startsWith('safe-')) return PALETTE_SAFE;
  const depth = getCurrentDepth();
  const act = actForDepth(depth);
  if (act.number === 1) return PALETTE_REFECTORY;
  if (act.number === 2) return PALETTE_CISTERN;
  return PALETTE_VERDANT;
}

// ── Engine state ───────────────────────────────────────────────────────

let started = false;
let currentState: MusicState = 'off';
let currentPalette: MusicPalette = PALETTE_REFECTORY;
let combatHeat = 0;          // 0..several; thresholds 1.2 (in) and 0.35 (out)
let lastTickAt = 0;          // ms timestamp for the heat decay

// Output gains for each layer. Per-state target levels are set in
// applyState(); ramps run on these.
let droneGain: GainNode | null = null;
let pluckGain: GainNode | null = null;
let combatGain: GainNode | null = null;

// Drone oscillators (we keep the array so palette swaps can retune them).
const droneOscs: OscillatorNode[] = [];
// Pluck scheduler handle.
let pluckScheduler: number | null = null;
// Heat decay ticker.
let heatTicker: number | null = null;

// ── Init ────────────────────────────────────────────────────────────────

/** Build the persistent oscillator stacks. Idempotent. The AudioContext
 *  is created on the first user gesture via sfx.ensureCtx, so this
 *  needs to be called from the same gesture path as startAmbience. */
export function startMusic(): void {
  if (started) return;
  const c = getAudioContext();
  if (!c) return;
  const master = getMasterGain();
  const reverb = getReverbInput();
  if (!master || !reverb) return;

  // ── Per-layer output gains (start silent; setMusicState ramps them) ──
  droneGain  = c.createGain(); droneGain.gain.value  = 0;
  pluckGain  = c.createGain(); pluckGain.gain.value  = 0;
  combatGain = c.createGain(); combatGain.gain.value = 0;
  // Each layer feeds master + a small wet send into the shared reverb.
  // Drone is sustained — too much reverb gets muddy; keep it dryish.
  // Plucks live on the reverb tail to feel cavernous.
  for (const [g, wet] of [
    [droneGain,  0.25] as const,
    [pluckGain,  0.55] as const,
    [combatGain, 0.30] as const,
  ]) {
    const wetSend = c.createGain();
    wetSend.gain.value = wet;
    g.connect(master);
    g.connect(wetSend).connect(reverb);
  }

  // ── Drone stack — root + fifth + octave ──────────────────────────────
  // Three triangles tuned root / (root * 1.5) / (root * 2). Each gets
  // an LFO on detune (slow breath) and a separate LFO on its own
  // amplitude — so the three voices breathe out of phase, like
  // candle-lit chant.
  const droneRatios = [1.0, 1.5, 2.0];
  for (let i = 0; i < droneRatios.length; i++) {
    const o = c.createOscillator();
    o.type = currentPalette.droneWave;
    o.frequency.value = currentPalette.rootHz * droneRatios[i];

    const og = c.createGain();
    og.gain.value = i === 0 ? 0.18 : (i === 1 ? 0.10 : 0.07);

    // Detune LFO — ±0.6 cents, ~0.07-0.13 Hz.
    const detLfo = c.createOscillator();
    detLfo.type = 'sine';
    detLfo.frequency.value = 0.07 + i * 0.03;
    const detLfoG = c.createGain();
    detLfoG.gain.value = 0.6;
    detLfo.connect(detLfoG).connect(o.detune);

    // Amplitude LFO — slow breath, ~30% of base gain.
    const ampLfo = c.createOscillator();
    ampLfo.type = 'sine';
    ampLfo.frequency.value = 0.11 + i * 0.04;
    const ampLfoG = c.createGain();
    ampLfoG.gain.value = og.gain.value * 0.30;
    ampLfo.connect(ampLfoG).connect(og.gain);

    o.connect(og).connect(droneGain);
    o.start(); detLfo.start(); ampLfo.start();
    droneOscs.push(o);
  }

  // ── Combat layer — sub-throb ─────────────────────────────────────────
  // A 55 Hz sine plus an octave (110 Hz), both with a 1.3 Hz amplitude
  // LFO so they THROB. The combatGain stays at 0 until heat says
  // we're in combat. Cheap, persistent, no scheduling.
  for (const freq of [55, 110]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;

    const og = c.createGain();
    og.gain.value = freq === 55 ? 0.55 : 0.22;

    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.30 + (freq === 110 ? 0.07 : 0);
    const lfoG = c.createGain();
    lfoG.gain.value = og.gain.value * 0.95;   // near-full duck on each pulse
    lfo.connect(lfoG).connect(og.gain);

    o.connect(og).connect(combatGain);
    o.start(); lfo.start();
  }

  // ── Combat-heat decay ticker ─────────────────────────────────────────
  // 4 ticks per second is enough — heat moves slowly. We drive
  // setMusicState() based on threshold crossings inside the tick.
  heatTicker = window.setInterval(tickHeat, 250);

  // Event hooks for state changes + heat bumps.
  initMusicEventHooks();

  started = true;
  // Default to exploration until level:loaded fires; the title screen
  // owns its own state via setMusicState('off') if it wants silence.
  applyState('exploration');
}

// ── State application ──────────────────────────────────────────────────

/** Apply a music state — ramps the three layer gains to their per-state
 *  target levels and reschedules the pluck loop. Private; callers go
 *  through the heat tracker or event hooks. */
function applyState(state: MusicState): void {
  if (state === currentState) return;
  const c = getAudioContext();
  if (!c || !droneGain || !pluckGain || !combatGain) return;
  const now = c.currentTime;

  const setRamp = (g: GainNode, target: number, ramp: number) => {
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(target, now, ramp);
  };

  // Per-state target levels. droneTarget tracks the "always there but
  // varies by mood" character; pluckTarget controls the gentle melodic
  // sprinkles; combatTarget gates the sub-throb. Volumes here are
  // applied AFTER the master volume slider, so 0..1 = relative to the
  // total mix.
  switch (state) {
    case 'exploration':
      setRamp(droneGain,  0.50, 1.8);
      setRamp(pluckGain,  0.40, 1.8);
      setRamp(combatGain, 0.00, 0.8);
      break;
    case 'combat':
      setRamp(droneGain,  0.70, 0.4);
      setRamp(pluckGain,  0.05, 0.4);   // duck plucks — let the throb breathe
      setRamp(combatGain, 0.85, 0.4);
      break;
    case 'safe':
      setRamp(droneGain,  0.40, 2.4);
      setRamp(pluckGain,  0.35, 2.4);
      setRamp(combatGain, 0.00, 0.8);
      break;
    case 'death':
      setRamp(droneGain,  0.00, 1.2);
      setRamp(pluckGain,  0.00, 0.6);
      setRamp(combatGain, 0.00, 0.6);
      break;
    case 'off':
      // Hard mute.
      for (const g of [droneGain, pluckGain, combatGain]) {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0, now);
      }
      break;
  }
  currentState = state;
  schedulePluckLoop();
}

// ── Pluck scheduler ────────────────────────────────────────────────────

function schedulePluckLoop(): void {
  if (pluckScheduler !== null) {
    clearTimeout(pluckScheduler);
    pluckScheduler = null;
  }
  let delay: number;
  if (currentState === 'safe') {
    delay = 5500 + Math.random() * 4500;        // every 5.5-10s, calmer
  } else if (currentState === 'exploration') {
    delay = 4200 + Math.random() * 3800;        // every 4.2-8s
  } else {
    // 'combat' / 'death' / 'off' — no plucks
    return;
  }
  pluckScheduler = window.setTimeout(() => {
    playPluck();
    schedulePluckLoop();
  }, delay);
}

function playPluck(): void {
  const c = getAudioContext();
  if (!c || !pluckGain) return;
  const now = c.currentTime;

  // Pick a mode degree + octave from the palette.
  const intervals = currentPalette.modeIntervals;
  const semitones = intervals[Math.floor(Math.random() * intervals.length)];
  const [oMin, oMax] = currentPalette.pluckOctaveRange;
  const octaveStep = oMin + Math.floor(Math.random() * (oMax - oMin + 1));
  // Pitch = root × 2^(octaveStep + semitones/12). 2^octaveStep doubles
  // per octave; +semitones/12 is the in-mode position.
  const freq = currentPalette.rootHz * Math.pow(2, octaveStep + semitones / 12);

  // Plucked sine — fast attack, slow decay. Light low-pass filter for
  // a softened bell. Two notes per pluck: the fundamental + a quieter
  // perfect fifth above for a hollow harmonic shimmer.
  const partials: Array<[number, number]> = [
    [freq,        0.40],
    [freq * 1.5,  0.10],
  ];
  for (const [f, amp] of partials) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;

    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = currentPalette.pluckCutoff;
    filt.Q.value = 0.9;

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(amp, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, now + 2.0);

    osc.connect(filt).connect(env).connect(pluckGain);
    osc.start(now);
    osc.stop(now + 2.1);
  }
}

// ── Heat tracker + event hooks ─────────────────────────────────────────

function tickHeat(): void {
  if (!started) return;
  const now = Date.now();
  const dt = lastTickAt ? (now - lastTickAt) / 1000 : 0;
  lastTickAt = now;
  if (combatHeat > 0) combatHeat = Math.max(0, combatHeat - 0.55 * dt);

  // Only nudge state if we're in a state that heat is allowed to
  // override. Safe rooms IGNORE combat heat (there are no enemies),
  // death is terminal until reset, off means the engine is muted.
  if (currentState !== 'exploration' && currentState !== 'combat') return;
  if (combatHeat > 1.2 && currentState !== 'combat') applyState('combat');
  else if (combatHeat < 0.35 && currentState === 'combat') applyState('exploration');
}

function initMusicEventHooks(): void {
  onEvent((event) => {
    if (event.type === 'attack:hit')        combatHeat += 1.0;
    else if (event.type === 'player:damaged') combatHeat += 1.5;
    else if (event.type === 'enemy:killed') combatHeat += 0.6;
    else if (event.type === 'player:killed') applyState('death');
    else if (event.type === 'level:loaded') {
      // Switch palette + reset state + clear any lingering combat heat.
      currentPalette = paletteForLevel(event.levelId);
      retuneDroneStack();
      combatHeat = 0;
      applyState(event.levelId.startsWith('safe-') ? 'safe' : 'exploration');
    }
  });
}

/** Re-pitch the drone oscillators to the current palette's root +
 *  re-pick their wave type. Called on level:loaded so the act transition
 *  feels like the room changed key beneath you. AudioParam ramp keeps
 *  the change smooth — no clicks. */
function retuneDroneStack(): void {
  const c = getAudioContext();
  if (!c || droneOscs.length === 0) return;
  const now = c.currentTime;
  const ratios = [1.0, 1.5, 2.0];
  for (let i = 0; i < droneOscs.length && i < ratios.length; i++) {
    const o = droneOscs[i];
    o.type = currentPalette.droneWave;
    const targetHz = currentPalette.rootHz * ratios[i];
    o.frequency.cancelScheduledValues(now);
    o.frequency.setTargetAtTime(targetHz, now, 0.8);
  }
}

// ── Public lifecycle hooks ─────────────────────────────────────────────

/** Force a music state — used by the title screen and death sequence. */
export function setMusicState(state: MusicState): void {
  applyState(state);
}

/** Tear down (e.g. on hard reset). Mostly for tests / future use. */
export function stopMusic(): void {
  if (heatTicker !== null) { clearInterval(heatTicker); heatTicker = null; }
  if (pluckScheduler !== null) { clearTimeout(pluckScheduler); pluckScheduler = null; }
  applyState('off');
}
