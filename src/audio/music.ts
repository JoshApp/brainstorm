// Procedural music + soundscape engine. Layered Web Audio synthesis driven
// by game state. Everything is generated in code (no asset files).
//
// DESIGN: silence is the default; sound is signal (the audio sibling of the
// "lighting as signal" doctrine). So MELODY is rare and reserved —
//   - Exploration: NO melody. A subtle felt-not-heard drone (the tonal
//     floor / threat bed) + a sparse ambient SOUNDSCAPE (drips, settling
//     stone, far groans, drafts) on long irregular gaps. The dungeon's
//     voice, not a score — the player listens into the dark.
//   - Combat: the drone tightens + a held-tension layer swells. The crunchy
//     impact SFX carries the rhythm; no battle theme.
//   - Safe rooms: the only place melodic MOTIFS play — the exhale/reward.
// A synth pluck playing a tune in a grimdark dungeon reads as "MIDI
// keyboard" no matter how good the notes, so melody earns its place by
// scarcity. (Boss music — a reserved, sustained, textural bed — is a TODO.)
//
// Iteration notes:
//   - V1 used a random pick from the mode pool per pluck. Result was
//     "atonal pluck shower" — notes had no shape. V2 (here) plays
//     hand-authored motifs (small phrases of 3-6 notes with their own
//     rhythm) from a per-palette pool, so the music has SENTENCES
//     instead of word salad.
//   - V1 combat layer was a thumping sub-bass throb. Too in-your-face.
//     V2 is a high-octave breath that swells gently — feels like
//     held tension, not a war drum.
//   - All target gains pulled WAY down from V1 (~half). Music should
//     fade INTO the dungeon, not announce itself.
//   - Separate music volume slider scales musicMasterGain after the
//     per-state mix, independent of the SFX master.
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

/** A single note inside a motif. Semitone offset relative to the
 *  palette root, octave shift from the root's octave, and how long
 *  the note rings before the next one starts. */
interface MotifNote {
  semitones: number;
  octave: number;
  /** Time until the NEXT note starts (in seconds). The note's tail
   *  decays through this window — a longer interNoteDur = more
   *  breathing space between notes. */
  interNoteDur: number;
}

/** A motif is just an ordered list of notes. Phrases of 3-6 notes
 *  are the sweet spot — long enough to feel composed, short enough
 *  to vary without exhausting the listener. */
type Motif = MotifNote[];

interface MusicPalette {
  /** Drone root in Hz. */
  rootHz: number;
  /** Hand-authored motif pool. The scheduler picks one, plays it,
   *  pauses 6-14s, picks another (avoiding immediate repeat). All
   *  notes inside use semitone offsets that already conform to
   *  the palette's mode. */
  motifs: Motif[];
  /** Drone oscillator waveform — 'triangle' = warm chant, 'sawtooth' =
   *  pinched/sour, 'sine' = pure / ethereal. */
  droneWave: OscillatorType;
  /** Pluck filter cutoff — lower = duller / muffled, higher = bell-like. */
  pluckCutoff: number;
}

// ── Palettes ───────────────────────────────────────────────────────────
//
// Motif notation: each note is { semitones from root, octave, time
// until next note in seconds }. Octave 3 = pluck sits a third octave
// above the root (i.e. root D2 → motif octave 3 means D5-ish range).
// Phrases hand-shaped so they have a SHAPE — descents, plaintive
// climbs, hovering resolutions. Not random selections from a mode.

/** Act 1 — The Old Refectory. Warm, monastic, dark. Phrygian mode at D2.
 *  Motifs are slow stepwise descents and rising plaints — chant-like. */
const PALETTE_REFECTORY: MusicPalette = {
  rootHz: 73.42,                            // D2
  droneWave: 'triangle',
  pluckCutoff: 3000,
  motifs: [
    // "Descent" — ♭3 → ♭2 → 1, with a return + final resolution.
    // The phrygian pulldown to the leading tone is the act's voice.
    [
      { semitones: 3, octave: 3, interNoteDur: 1.3 },
      { semitones: 1, octave: 3, interNoteDur: 1.0 },
      { semitones: 0, octave: 3, interNoteDur: 1.6 },
      { semitones: 1, octave: 3, interNoteDur: 1.1 },
      { semitones: 0, octave: 3, interNoteDur: 2.0 },
    ],
    // "Hover" — sit on the fifth, drift to the fourth and back, fall.
    [
      { semitones: 7, octave: 3, interNoteDur: 1.2 },
      { semitones: 5, octave: 3, interNoteDur: 1.0 },
      { semitones: 7, octave: 3, interNoteDur: 1.4 },
      { semitones: 3, octave: 3, interNoteDur: 1.8 },
    ],
    // "Whisper" — three sparse notes, very quiet phrase.
    [
      { semitones: 0, octave: 3, interNoteDur: 2.4 },
      { semitones: 1, octave: 3, interNoteDur: 1.8 },
      { semitones: 0, octave: 3, interNoteDur: 2.2 },
    ],
    // "Lift" — rise to the ♭6 and let it ring. The ♭6 is phrygian's
    // most haunted interval; landing on it without resolving is the
    // hook.
    [
      { semitones: 0, octave: 3, interNoteDur: 1.1 },
      { semitones: 3, octave: 3, interNoteDur: 1.0 },
      { semitones: 5, octave: 3, interNoteDur: 1.1 },
      { semitones: 8, octave: 3, interNoteDur: 2.6 },
    ],
  ],
};

/** Act 2 — The Cistern. Cold, watery, unstable. Locrian at A1. Motifs
 *  fall like drops — single high notes that descend to the dissonant
 *  diminished fifth. Slower than Act 1, more space between notes. */
const PALETTE_CISTERN: MusicPalette = {
  rootHz: 55.00,                            // A1
  droneWave: 'sine',
  pluckCutoff: 2200,
  motifs: [
    // "Drip" — single note repeated twice, then a slow fall.
    [
      { semitones: 10, octave: 3, interNoteDur: 1.6 },
      { semitones: 10, octave: 3, interNoteDur: 2.0 },
      { semitones: 6,  octave: 3, interNoteDur: 2.8 },
    ],
    // "Ripple" — descending phrase that hits the ♭5.
    [
      { semitones: 6,  octave: 3, interNoteDur: 1.0 },
      { semitones: 5,  octave: 3, interNoteDur: 1.0 },
      { semitones: 3,  octave: 3, interNoteDur: 1.2 },
      { semitones: 1,  octave: 3, interNoteDur: 1.4 },
      { semitones: 0,  octave: 3, interNoteDur: 2.4 },
    ],
    // "Submerged" — two low notes, sustained.
    [
      { semitones: 0,  octave: 3, interNoteDur: 2.8 },
      { semitones: 3,  octave: 3, interNoteDur: 3.0 },
    ],
  ],
};

/** Act 3 — The Verdant Rot. Sickly, organic, buzzing. Hungarian minor at
 *  F2 — the augmented fourth gives the "wrong nature" colour. Motifs
 *  lurch and hover on the ♯4. */
const PALETTE_VERDANT: MusicPalette = {
  rootHz: 87.31,                            // F2
  droneWave: 'sawtooth',
  pluckCutoff: 1800,
  motifs: [
    // "Lurch" — climb through the augmented fourth.
    [
      { semitones: 0, octave: 3, interNoteDur: 1.1 },
      { semitones: 3, octave: 3, interNoteDur: 1.0 },
      { semitones: 6, octave: 3, interNoteDur: 1.4 },
      { semitones: 7, octave: 3, interNoteDur: 1.8 },
    ],
    // "Wrong song" — hover on the ♯4 dissonance.
    [
      { semitones: 3, octave: 3, interNoteDur: 1.2 },
      { semitones: 6, octave: 3, interNoteDur: 1.2 },
      { semitones: 3, octave: 3, interNoteDur: 1.4 },
      { semitones: 0, octave: 3, interNoteDur: 2.0 },
    ],
    // "Sigh" — leading-tone resolution. Three quiet notes.
    [
      { semitones: 11, octave: 2, interNoteDur: 1.4 },
      { semitones: 0,  octave: 3, interNoteDur: 1.6 },
      { semitones: 3,  octave: 3, interNoteDur: 2.4 },
    ],
  ],
};

/** Safe rooms — pentatonic, slow, warmer. Same root as Act 1 (D2) so
 *  the tonal centre travels with the player. Motifs are small arches
 *  and resolutions — the music is allowed to feel like an exhale. */
const PALETTE_SAFE: MusicPalette = {
  rootHz: 73.42,                            // D2
  droneWave: 'triangle',
  pluckCutoff: 4200,
  motifs: [
    // "Hope" — a 5-note arch resolving down to the root.
    [
      { semitones: 7,  octave: 3, interNoteDur: 1.1 },
      { semitones: 5,  octave: 3, interNoteDur: 1.0 },
      { semitones: 3,  octave: 3, interNoteDur: 1.2 },
      { semitones: 0,  octave: 3, interNoteDur: 2.2 },
    ],
    // "Rest" — an arch up to the 4 and back.
    [
      { semitones: 0,  octave: 3, interNoteDur: 1.4 },
      { semitones: 3,  octave: 3, interNoteDur: 1.2 },
      { semitones: 5,  octave: 3, interNoteDur: 1.4 },
      { semitones: 3,  octave: 3, interNoteDur: 1.2 },
      { semitones: 0,  octave: 3, interNoteDur: 2.4 },
    ],
    // "Single" — one note, allowed to ring.
    [
      { semitones: 0,  octave: 3, interNoteDur: 3.0 },
    ],
  ],
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

// musicMasterGain sits after all per-layer mixing — the music-volume
// slider drives this. Stays separate from the SFX master so the player
// can quiet the score without dropping combat impact.
let musicMasterGain: GainNode | null = null;
let musicVolume = 0.65;

// Output gains for each layer. Per-state target levels are set in
// applyState(); ramps run on these.
let droneGain: GainNode | null = null;
let pluckGain: GainNode | null = null;
let combatGain: GainNode | null = null;

// Drone oscillators (we keep the array so palette swaps can retune them).
const droneOscs: OscillatorNode[] = [];
// Combat oscillators — same purpose, separate array because they tune
// to the root × different multipliers than the drone.
const combatOscs: OscillatorNode[] = [];
// Motif scheduler handle.
let motifScheduler: number | null = null;
// Ambient soundscape: output bus + scheduler + shared noise buffer.
let ambientGain: GainNode | null = null;
let ambientScheduler: number | null = null;
let noiseBuffer: AudioBuffer | null = null;
// Heat decay ticker.
let heatTicker: number | null = null;
// Last-played motif index so we avoid playing the same one twice in a row.
let lastMotifIdx = -1;

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

  // Music master sits between the per-layer mix and the SFX master,
  // driven by the music-volume settings slider. Independent of SFX.
  musicMasterGain = c.createGain();
  musicMasterGain.gain.value = musicVolume;
  musicMasterGain.connect(master);

  // ── Per-layer output gains (start silent; setMusicState ramps them) ──
  droneGain  = c.createGain(); droneGain.gain.value  = 0;
  pluckGain  = c.createGain(); pluckGain.gain.value  = 0;
  combatGain = c.createGain(); combatGain.gain.value = 0;
  // Each layer feeds musicMasterGain + a small wet send into the shared
  // reverb. Drone is sustained — too much reverb gets muddy; keep it
  // dryish. Plucks live on the reverb tail to feel cavernous.
  for (const [g, wet] of [
    [droneGain,  0.20] as const,
    [pluckGain,  0.45] as const,
    [combatGain, 0.25] as const,
  ]) {
    const wetSend = c.createGain();
    wetSend.gain.value = wet;
    g.connect(musicMasterGain);
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

  // ── Combat layer — low dissonant dread ───────────────────────────────
  // V1 was a sub-bass throb (too in-your-face); V2 was a mid consonant
  // "breath" (a clean fifth — too pleasant, read as nothing). V3: a LOW,
  // DISSONANT swell — a low octave (root × 2) plus the TRITONE above it
  // (× 2.83, the "wrong" interval), through a lowpass so it's felt as
  // unease in the chest, not heard as a note. Slow swell, never a pulse.
  // The crunchy impact SFX carry the rhythm; this is just dread under it.
  const combatMul = [2.0, 2.83];   // low octave + tritone above → tension
  const combatFilt = c.createBiquadFilter();
  combatFilt.type = 'lowpass';
  combatFilt.frequency.value = 520;
  combatFilt.Q.value = 0.8;
  combatFilt.connect(combatGain);
  for (let i = 0; i < 2; i++) {
    const o = c.createOscillator();
    o.type = i === 0 ? 'triangle' : 'sawtooth';   // saw on the tritone = teeth
    o.frequency.value = currentPalette.rootHz * combatMul[i];
    o.detune.value = i === 0 ? -5 : 7;

    const og = c.createGain();
    og.gain.value = i === 0 ? 0.22 : 0.12;

    // Slow ominous swell (~0.22-0.28 Hz) — slower than the old breath so it
    // looms rather than pulses.
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.22 + i * 0.06;
    const lfoG = c.createGain();
    lfoG.gain.value = og.gain.value * 0.4;
    lfo.connect(lfoG).connect(og.gain);

    o.connect(og).connect(combatFilt);
    o.start(); lfo.start();
    combatOscs.push(o);
  }

  // ── Ambient bus ──────────────────────────────────────────────────────
  // The environmental one-shots (drips, settling stone, far groans, drafts)
  // are diegetic WORLD sound, not score — so they hang off the SFX master
  // (master), not musicMasterGain. They get a heavy wet send so they echo
  // down the corridors. Muting "music" leaves the dungeon's voice intact.
  ambientGain = c.createGain();
  ambientGain.gain.value = 1.0;
  ambientGain.connect(master);
  const ambientWet = c.createGain();
  ambientWet.gain.value = 0.55;
  ambientGain.connect(ambientWet).connect(reverb);

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

  // Per-state target levels — pulled WAY down from V1 ("too strong"
  // feedback). The music should fade INTO the dungeon, not announce
  // itself. Numbers below are AFTER the music-volume slider, so 0..1
  // = relative to the music mix (which is then scaled by master).
  switch (state) {
    case 'exploration':
      // No melody in exploration — silence is the instrument. Only a
      // subtle felt-not-heard drone (the tonal floor / threat bed); the
      // dungeon's voice is the sparse ambient one-shot soundscape below.
      // Melodic motifs are reserved for safe rooms (the exhale).
      setRamp(droneGain,  0.20, 2.2);
      setRamp(pluckGain,  0.00, 1.2);
      setRamp(combatGain, 0.00, 0.8);
      break;
    case 'combat':
      setRamp(droneGain,  0.34, 0.6);
      setRamp(pluckGain,  0.08, 0.4);   // duck plucks — held breath breathes
      setRamp(combatGain, 0.22, 0.7);   // gentle swell, not a thump
      break;
    case 'safe':
      setRamp(droneGain,  0.22, 2.4);
      setRamp(pluckGain,  0.20, 2.4);
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
  scheduleMotifLoop();
  scheduleAmbientLoop();
}

// ── Motif scheduler ────────────────────────────────────────────────────
//
// Plays HAND-AUTHORED phrases (see each palette's motif pool), not
// random notes. Each motif is played note-by-note with its own rhythm.
// Between motifs we pause a few seconds so the silence has shape too.
//
// Variation knobs that keep the loop from feeling rote:
//   - Avoid playing the same motif index twice in a row.
//   - 25% chance to shift the motif up an octave (still in the
//     palette's key, just brighter). Adds register variety.
//   - Pause length between motifs is randomized 5-12s (exploration)
//     or 8-16s (safe room). Combat skips motifs entirely.

function scheduleMotifLoop(): void {
  if (motifScheduler !== null) {
    clearTimeout(motifScheduler);
    motifScheduler = null;
  }
  // Melody lives ONLY in safe rooms now — the exhale/reward. Exploration is
  // soundscape + silence; combat is the tension layer + impacts.
  if (currentState !== 'safe') return;
  // First note fires after a small intro delay so a state change
  // (e.g. entering exploration from level load) doesn't drop a note
  // the instant the camera arrives.
  const introDelay = 1200 + Math.random() * 1500;
  motifScheduler = window.setTimeout(playNextMotif, introDelay);
}

function playNextMotif(): void {
  if (currentState !== 'safe') return;
  const c = getAudioContext();
  if (!c || !pluckGain) return;
  const motifs = currentPalette.motifs;
  if (!motifs.length) return;

  // Pick a motif index that isn't the last one we played.
  let idx = Math.floor(Math.random() * motifs.length);
  if (motifs.length > 1 && idx === lastMotifIdx) {
    idx = (idx + 1) % motifs.length;
  }
  lastMotifIdx = idx;
  const motif = motifs[idx];
  // Optional octave shift — 25% chance, +1 octave. Keeps the same
  // mode and shape but brighter; adds variety without breaking the
  // composed feel.
  const octaveShift = Math.random() < 0.25 ? 1 : 0;

  // Schedule each note. Web Audio's currentTime is float seconds;
  // we walk the motif accumulating time and start each pluck at the
  // right offset. The motif lives in one playPluckAt call per note.
  let tOffset = 0;
  for (const note of motif) {
    playPluckAt(note.semitones, note.octave + octaveShift, c.currentTime + tOffset);
    tOffset += note.interNoteDur;
  }

  // After the motif finishes, pause then queue the next.
  const pauseAfter = currentState === 'safe'
    ? 8000 + Math.random() * 8000      // 8-16s in safe rooms
    : 5000 + Math.random() * 7000;     // 5-12s in exploration
  motifScheduler = window.setTimeout(playNextMotif, tOffset * 1000 + pauseAfter);
}

/** Play a single pluck note at an absolute audio-context time. Uses
 *  the palette's pluck cutoff for its low-pass filter. Plucked-sine
 *  voice + a quiet fifth partial for a hollow bell tone. */
function playPluckAt(semitones: number, octave: number, when: number): void {
  const c = getAudioContext();
  if (!c || !pluckGain) return;

  const freq = currentPalette.rootHz * Math.pow(2, octave + semitones / 12);
  const partials: Array<[number, number]> = [
    [freq,        0.34],
    [freq * 1.5,  0.08],
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
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(amp, when + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, when + 2.4);

    osc.connect(filt).connect(env).connect(pluckGain);
    osc.start(when);
    osc.stop(when + 2.5);
  }
}

// ── Ambient soundscape ─────────────────────────────────────────────────
//
// The dungeon's voice during exploration (and, sparser, in safe rooms):
// sparse environmental one-shots on long irregular gaps so it never reads
// as a loop or as music. Silence between them is the point — the player
// listens. All synthesised in code, panned + reverbed so they feel like
// they come from somewhere down the dark.

/** Shared white-noise buffer for the noise-based ambiences. */
function getNoise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/** A stereo-panned node feeding the ambient bus (falls back to the bus
 *  directly where StereoPanner is unavailable). */
function ambientOut(c: AudioContext, pan: number): AudioNode {
  if (!ambientGain) return c.destination;
  if (typeof c.createStereoPanner === 'function') {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(ambientGain);
    return p;
  }
  return ambientGain;
}

/** A water drip. The natural "ploink" of a drop landing comes from a quick
 *  UPWARD pitch chirp (cavity resonance rising as the cavity closes) + a tiny
 *  noise tap at the onset — not a downward sweep (that reads as a sci-fi
 *  blip). Short and soft; the reverb tail makes it echo down the stone. */
function ambientDrip(c: AudioContext, when: number, pan: number): void {
  const out = ambientOut(c, pan);
  // Tiny attack transient — the "tap" of the drop hitting water.
  const tap = c.createBufferSource();
  tap.buffer = noiseBuffer ?? getNoise(c);
  const tapHp = c.createBiquadFilter();
  tapHp.type = 'highpass'; tapHp.frequency.value = 1800;
  const tapG = c.createGain();
  tapG.gain.setValueAtTime(0.06, when);
  tapG.gain.exponentialRampToValueAtTime(0.0005, when + 0.012);
  tap.connect(tapHp).connect(tapG).connect(out);
  tap.start(when); tap.stop(when + 0.03);
  // Resonant body — rises in pitch quickly, very short decay.
  const f0 = 380 + Math.random() * 260;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, when);
  osc.frequency.exponentialRampToValueAtTime(f0 * 2.1, when + 0.05);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(0.16 + Math.random() * 0.08, when + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0006, when + 0.14);
  osc.connect(env).connect(out);
  osc.start(when); osc.stop(when + 0.18);
}

/** Distant settling stone / a far collapse — a low filtered-noise swell.
 *  Quiet and slow; reads as "something shifted, far off". */
function ambientRumble(c: AudioContext, when: number, pan: number): void {
  const out = ambientOut(c, pan);
  const src = c.createBufferSource();
  src.buffer = getNoise(c); src.loop = true;
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 120 + Math.random() * 70;
  filt.Q.value = 0.7;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.linearRampToValueAtTime(0.35, when + 0.7);
  env.gain.exponentialRampToValueAtTime(0.0005, when + 2.6);
  src.connect(filt).connect(env).connect(out);
  src.start(when); src.stop(when + 2.8);
}

// (The far-off groan moved to a MONSTER vocalisation — see playEnemyVocal in
// sfx.ts. A groan implies a creature, so it now comes from a real mob's
// position, not random nowhere. Random ambience stays purely environmental.)

/** Wind through a gap — a band-swept noise swell. The dungeon breathing. */
function ambientDraft(c: AudioContext, when: number, pan: number): void {
  const out = ambientOut(c, pan);
  const src = c.createBufferSource();
  src.buffer = getNoise(c); src.loop = true;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = 2.5;
  filt.frequency.setValueAtTime(360, when);
  filt.frequency.linearRampToValueAtTime(700, when + 1.4);
  filt.frequency.linearRampToValueAtTime(300, when + 3.0);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.linearRampToValueAtTime(0.11, when + 1.0);
  env.gain.exponentialRampToValueAtTime(0.0005, when + 3.0);
  src.connect(filt).connect(env).connect(out);
  src.start(when); src.stop(when + 3.2);
}

// Weighted pool — drips dominate (the signature dungeon sound), the rest
// punctuate. Cumulative weights for a single random pick.
const AMBIENT_POOL: Array<{ fn: (c: AudioContext, when: number, pan: number) => void; weight: number }> = [
  { fn: ambientDrip,   weight: 3.0 },
  { fn: ambientDraft,  weight: 2.2 },
  { fn: ambientRumble, weight: 1.6 },
];
const AMBIENT_WEIGHT_TOTAL = AMBIENT_POOL.reduce((s, a) => s + a.weight, 0);

function scheduleAmbientLoop(): void {
  if (ambientScheduler !== null) {
    clearTimeout(ambientScheduler);
    ambientScheduler = null;
  }
  // Soundscape runs while exploring + (sparser) in safe rooms. Combat,
  // death, off get silence-but-for-the-fight / nothing.
  if (currentState !== 'exploration' && currentState !== 'safe') return;
  // Long, irregular gaps. Safe rooms breathe slower (you're meant to rest).
  const gap = currentState === 'safe'
    ? 11000 + Math.random() * 12000   // 11-23s
    : 6000 + Math.random() * 9000;    // 6-15s
  ambientScheduler = window.setTimeout(() => {
    playAmbientOneShot();
    scheduleAmbientLoop();
  }, gap);
}

function playAmbientOneShot(): void {
  const c = getAudioContext();
  if (!c || !ambientGain) return;
  let r = Math.random() * AMBIENT_WEIGHT_TOTAL;
  let pick = AMBIENT_POOL[0];
  for (const a of AMBIENT_POOL) { if ((r -= a.weight) <= 0) { pick = a; break; } }
  const pan = (Math.random() * 2 - 1) * 0.8;   // spread across the field
  pick.fn(c, c.currentTime + 0.03, pan);
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

/** Re-pitch the drone + combat oscillators to the current palette's
 *  root + re-pick the drone wave type. Called on level:loaded so an act
 *  transition feels like the room changed key beneath you. AudioParam
 *  ramps keep the change smooth — no clicks. */
function retuneDroneStack(): void {
  const c = getAudioContext();
  if (!c) return;
  const now = c.currentTime;
  const droneRatios = [1.0, 1.5, 2.0];
  for (let i = 0; i < droneOscs.length && i < droneRatios.length; i++) {
    const o = droneOscs[i];
    o.type = currentPalette.droneWave;
    const targetHz = currentPalette.rootHz * droneRatios[i];
    o.frequency.cancelScheduledValues(now);
    o.frequency.setTargetAtTime(targetHz, now, 0.8);
  }
  // Combat layer rides the same root: a low octave + the tritone above it
  // (the dissonant dread interval). Stays anchored to the floor's key.
  const combatMultipliers = [2.0, 2.83];
  for (let i = 0; i < combatOscs.length && i < combatMultipliers.length; i++) {
    const o = combatOscs[i];
    const targetHz = currentPalette.rootHz * combatMultipliers[i];
    o.frequency.cancelScheduledValues(now);
    o.frequency.setTargetAtTime(targetHz, now, 0.8);
  }
}

// ── Public lifecycle hooks ─────────────────────────────────────────────

/** Force a music state — used by the title screen and death sequence. */
export function setMusicState(state: MusicState): void {
  applyState(state);
}

/** Set the music master volume (0..1). Independent of the SFX master.
 *  Persisted via Settings and re-applied on each settings change. */
export function setMusicVolume(v: number): void {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicMasterGain) musicMasterGain.gain.value = musicVolume;
}

/** Tear down (e.g. on hard reset). Mostly for tests / future use. */
export function stopMusic(): void {
  if (heatTicker !== null) { clearInterval(heatTicker); heatTicker = null; }
  if (motifScheduler !== null) { clearTimeout(motifScheduler); motifScheduler = null; }
  if (ambientScheduler !== null) { clearTimeout(ambientScheduler); ambientScheduler = null; }
  applyState('off');
}
