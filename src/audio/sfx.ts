// Procedural sound effects via the Web Audio API. No asset files — these are
// synthesized sounds we iterate on directly in code, in keeping with the
// game's code-generated-everything ethos. Browsers require a user-gesture-
// initiated context, so the AudioContext is created lazily on first call.
// The attack button press IS a user gesture, so the first sword swing will
// succeed in creating it.
//
// ── Bus layout ─────────────────────────────────────────────────────────
//
//      source → masterGain → destination                (UI / 2D sounds)
//      source → panner → dryGain → masterGain
//                     └ wetGain → reverb → masterGain   (positional sounds)
//
// 2D sounds (existing flat SFX — menu clicks, footsteps, heal slurp, etc.)
// keep connecting directly to masterGain — no panning, no reverb. Sounds
// that want a spatial sense (enemy windup/death, impact, loot land) route
// through createPositionalChain(pos), which sets up a PannerNode plus dry
// and wet (reverb send) gains in parallel.
//
// The reverb is a synthetic impulse response — a short decaying noise burst
// generated into an AudioBuffer once, fed into a single shared ConvolverNode.
// All positional sounds share that one convolver via the wet bus, so the
// CPU cost is fixed regardless of how many spatialized sounds are firing.

export type Vec3Sound = { x: number; y: number; z: number };

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let reverbInput: GainNode | null = null;   // sources send into here for reverb
let reverbOutput: GainNode | null = null;  // last node in reverb chain — disconnect to bypass
let reverbEnabled = true;
let masterVolume = 0.55;  // overridden by settings on init

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(ctx.destination);
    // Reverb bus: wet input → convolver → master. A single shared
    // convolver, so per-frame CPU is fixed no matter how many sounds
    // are routing through it.
    reverbInput = ctx.createGain();
    reverbInput.gain.value = 1.0;
    const convolver = ctx.createConvolver();
    // Shorter IR (was 1.6s × 2.6 decay) — half the per-sample cost.
    // Mobile convolvers scale with IR length × number of input sources;
    // dropping to 0.8s × 3.5 keeps the room-sense audible at roughly
    // half the convolution work per second.
    convolver.buffer = makeReverbImpulse(ctx, 0.8, 3.5);
    // Output trim so wet doesn't drown the dry path. Tweak to taste.
    reverbOutput = ctx.createGain();
    reverbOutput.gain.value = 0.55;
    reverbInput.connect(convolver).connect(reverbOutput);
    // Connect into master only when reverb is enabled; setReverbEnabled
    // re-wires this on toggle. Bypass = no signal reaches the destination
    // so the browser can short-circuit the convolution work.
    if (reverbEnabled) reverbOutput.connect(masterGain);
    return ctx;
  } catch {
    return null;
  }
}

/** Synthetic reverb IR — exponentially-decaying stereo noise. Cheap,
 *  procedural, and tunable per-act later (longer tail for the Cistern,
 *  damped tail for the Refectory). */
function makeReverbImpulse(c: AudioContext, durationSec: number, decay: number): AudioBuffer {
  const sr = c.sampleRate;
  const length = Math.max(1, Math.floor(sr * durationSec));
  const ir = c.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Power-law decay — fast initial fall, long quiet tail.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return ir;
}

/** Build the dry+wet routing chain for a positional sound. Sources
 *  connect into the returned node; their signal flows through a panner
 *  (which Web Audio positions in 3D relative to the listener), then
 *  splits to dry → master and wet → reverb. The shared convolver does
 *  the heavy lifting once; per-sound CPU is just a panner + two gains.
 *
 *  wetSend defaults to 0.35 — present but not drowning. UI sounds skip
 *  this path entirely and stay bone dry. */
function createPositionalChain(pos: Vec3Sound, wetSend: number = 0.35): AudioNode {
  const c = ctx!;
  const panner = c.createPanner();
  panner.panningModel = 'equalpower';   // cheap, mobile-safe; HRTF is CPU
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.5;             // metres — full volume within
  panner.maxDistance = 28;              // beyond this, no more attenuation
  panner.rolloffFactor = 1.4;
  panner.coneInnerAngle = 360;
  // Modern AudioParam API where available; fall back to setPosition()
  // on older Safari. Same for the listener pose tick below.
  if ('positionX' in panner) {
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
  } else {
    (panner as unknown as { setPosition: (x: number, y: number, z: number) => void })
      .setPosition(pos.x, pos.y, pos.z);
  }
  const dryGain = c.createGain();
  dryGain.gain.value = 1.0;
  const wetGain = c.createGain();
  wetGain.gain.value = wetSend;
  panner.connect(dryGain).connect(masterGain!);
  panner.connect(wetGain).connect(reverbInput!);
  return panner;
}

// ── Shared infrastructure access for other audio modules ──────────────
// music.ts uses these to plug its layers into the same context + busses
// as the SFX, sharing the reverb convolver instead of building its own.

/** Audio context (null until first user gesture creates it). */
export function getAudioContext(): AudioContext | null {
  ensureCtx();
  return ctx;
}

/** Suspend the audio clock — pauses ALL sound (sfx + music share this one
 *  context) WITHOUT tearing down the graph. For tab-out: the render loop is
 *  throttled when the page is hidden, but Web Audio keeps running, so the
 *  ambient bed would play on in the background. No-op until the context exists
 *  (first gesture) or if already suspended. resumeAudio() continues exactly
 *  where it left off. */
export function suspendAudio(): void {
  if (ctx && ctx.state === 'running') void ctx.suspend();
}

/** Resume after suspendAudio() (tab back in). No-op if not suspended. */
export function resumeAudio(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}
/** Master output bus — every dry path terminates here. */
export function getMasterGain(): GainNode | null {
  ensureCtx();
  return masterGain;
}
/** Shared reverb wet-bus input. Connect into this for spatial tail. */
export function getReverbInput(): GainNode | null {
  ensureCtx();
  return reverbInput;
}

/** Update the AudioListener pose so positional pans/distances track the
 *  player's view. Call once per frame from the main loop with the
 *  camera. Cheap — just sets a few AudioParam values. */
export function setAudioListenerPose(
  px: number, py: number, pz: number,
  fx: number, fy: number, fz: number,
): void {
  const c = ensureCtx();
  if (!c) return;
  const lis = c.listener;
  if ('positionX' in lis) {
    lis.positionX.value = px;
    lis.positionY.value = py;
    lis.positionZ.value = pz;
    lis.forwardX.value = fx;
    lis.forwardY.value = fy;
    lis.forwardZ.value = fz;
    lis.upX.value = 0;
    lis.upY.value = 1;
    lis.upZ.value = 0;
  } else {
    const oldLis = lis as unknown as {
      setPosition: (x: number, y: number, z: number) => void;
      setOrientation: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
    };
    oldLis.setPosition(px, py, pz);
    oldLis.setOrientation(fx, fy, fz, 0, 1, 0);
  }
}

/** Set master volume (0..1). Settings menu calls this when the slider moves. */
export function setMasterVolume(v: number) {
  masterVolume = Math.max(0, Math.min(1, v));
  if (masterGain) masterGain.gain.value = masterVolume;
}

/** Toggle the reverb wet bus. Off = the convolver's output is
 *  disconnected from master so it stops processing audio (browsers
 *  short-circuit convolution work when output isn't reaching the
 *  destination). Sounds keep their dry path; they just lose the room
 *  tail. Used by the REVERB setting on mobile-perf-sensitive devices. */
export function setReverbEnabled(enabled: boolean) {
  reverbEnabled = enabled;
  if (!reverbOutput || !masterGain) return;
  try {
    if (enabled) reverbOutput.connect(masterGain);
    else reverbOutput.disconnect(masterGain);
  } catch {
    // Already (dis)connected — Web Audio throws when reconnecting an
    // existing connection or disconnecting one that isn't there.
  }
}

/** Sword cutting air — a short filtered noise burst, mid-high frequency, fast decay. */
export function playWhoosh() {
  const c = ensureCtx();
  if (!c || !masterGain) return;

  const duration = 0.18;
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  // Bandpass that sweeps down for a "swoosh" character
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2400, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(700, c.currentTime + duration);
  filter.Q.value = 1.2;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);

  src.connect(filter).connect(gain).connect(masterGain);
  src.start();
  src.stop(c.currentTime + duration);
}

/** A single breath PUFF — soft filtered noise, airy attack/decay. `intensity`
 *  0..1 scales volume + lowers/darkens the breath (a tired, voiced exhale gets
 *  louder, longer, and lower). Used by the exhaustion feedback so "winded" is
 *  audible — the felt-stamina channel, not a HUD readout. */
export function playBreath(intensity: number) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const i = Math.max(0, Math.min(1, intensity));
  const now = c.currentTime;
  const duration = 0.30 + 0.18 * i;        // heavier breaths last a touch longer
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let k = 0; k < bufferSize; k++) data[k] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;

  // Breathy bandpass — lower + wider than the whoosh so it reads as air, not a
  // swoosh; a tired breath sits lower and sweeps down (an exhale).
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  const centre = 900 - 320 * i;            // 900Hz light → ~580Hz heavy
  filter.frequency.setValueAtTime(centre * 1.3, now);
  filter.frequency.exponentialRampToValueAtTime(centre * 0.7, now + duration);
  filter.Q.value = 0.7;                     // wide → airy, not whistly

  const gain = c.createGain();
  const peak = 0.045 + 0.20 * i;            // quiet when lightly winded, present when gassed
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + duration * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  src.connect(filter).connect(gain).connect(masterGain);
  src.start();
  src.stop(now + duration);
}

/** Heavy impact — low-frequency body thud + a brief high-mid crack on top. */
export function playImpact(pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;

  const now = c.currentTime;
  const out: AudioNode = pos ? createPositionalChain(pos, 0.40) : masterGain;

  // Body: low oscillator dropping to sub-bass
  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(140, now);
  body.frequency.exponentialRampToValueAtTime(45, now + 0.18);
  const bodyGain = c.createGain();
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.8, now + 0.005);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  body.connect(bodyGain).connect(out);
  body.start(now);
  body.stop(now + 0.24);

  // Crack: short noise burst, high-passed
  const crackDur = 0.06;
  const crackBuffer = c.createBuffer(1, Math.floor(c.sampleRate * crackDur), c.sampleRate);
  const crackData = crackBuffer.getChannelData(0);
  for (let i = 0; i < crackData.length; i++) {
    crackData[i] = (Math.random() * 2 - 1) * (1 - i / crackData.length);
  }
  const crack = c.createBufferSource();
  crack.buffer = crackBuffer;
  const crackFilter = c.createBiquadFilter();
  crackFilter.type = 'highpass';
  crackFilter.frequency.value = 1500;
  const crackGain = c.createGain();
  crackGain.gain.value = 0.4;
  crack.connect(crackFilter).connect(crackGain).connect(out);
  crack.start(now);
  crack.stop(now + crackDur);
}

/** Player getting hurt — a short pained grunt: low oscillator with vibrato + brief noise. */
export function playPlayerHurt() {
  const c = ensureCtx();
  if (!c || !masterGain) return;

  const now = c.currentTime;
  const duration = 0.35;

  // Grunt: low oscillator with downward pitch envelope + slight vibrato
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + duration);

  // Vibrato LFO for vocal-like quality
  const lfo = c.createOscillator();
  lfo.frequency.value = 14;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 12;
  lfo.connect(lfoGain).connect(osc.frequency);

  // Lowpass to take the edge off the saw
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(700, now);
  filter.frequency.exponentialRampToValueAtTime(280, now + duration);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.55, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(filter).connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + duration);
  lfo.start(now);
  lfo.stop(now + duration);
}

// ── Enemy death — per-size variant ─────────────────────────────────────
// Three size buckets:
//   small    rat / skitterer — squeal + light thud
//   medium   ghoul / skirmisher — low groan + collapse
//   spectral wraith — ethereal wail + dissolve hiss

export type EnemyDeathSize = 'small' | 'medium' | 'spectral';

export function playEnemyDeath(size: EnemyDeathSize = 'medium', pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  // Spectral deaths get a wetter send — they're meant to feel ethereal.
  const master: AudioNode = pos
    ? createPositionalChain(pos, size === 'spectral' ? 0.60 : 0.40)
    : masterGain;

  if (size === 'small') {
    // Rodent squeal + tiny thud
    const sq = c.createOscillator();
    sq.type = 'sawtooth';
    sq.frequency.setValueAtTime(900, now);
    sq.frequency.exponentialRampToValueAtTime(420, now + 0.18);
    const sqg = c.createGain();
    sqg.gain.setValueAtTime(0.0001, now);
    sqg.gain.exponentialRampToValueAtTime(0.32, now + 0.01);
    sqg.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
    const sqf = c.createBiquadFilter();
    sqf.type = 'lowpass'; sqf.frequency.value = 1800;
    sq.connect(sqf).connect(sqg).connect(master);
    sq.start(now); sq.stop(now + 0.22);

    // Tiny thud
    const thud = c.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(120, now + 0.04);
    thud.frequency.exponentialRampToValueAtTime(55, now + 0.16);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.0001, now + 0.04);
    tg.gain.exponentialRampToValueAtTime(0.35, now + 0.05);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thud.connect(tg).connect(master);
    thud.start(now + 0.04); thud.stop(now + 0.20);
    return;
  }

  if (size === 'spectral') {
    // Ethereal wail + dissolve hiss
    const wail = c.createOscillator();
    wail.type = 'sine';
    wail.frequency.setValueAtTime(440, now);
    wail.frequency.exponentialRampToValueAtTime(110, now + 0.7);
    const wg = c.createGain();
    wg.gain.setValueAtTime(0.0001, now);
    wg.gain.exponentialRampToValueAtTime(0.32, now + 0.04);
    wg.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    // Detune second osc one fifth up for harmonic glow
    const wail2 = c.createOscillator();
    wail2.type = 'sine';
    wail2.frequency.setValueAtTime(660, now);
    wail2.frequency.exponentialRampToValueAtTime(165, now + 0.7);
    const wg2 = c.createGain();
    wg2.gain.setValueAtTime(0.0001, now);
    wg2.gain.exponentialRampToValueAtTime(0.14, now + 0.05);
    wg2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    wail.connect(wg).connect(master);
    wail2.connect(wg2).connect(master);
    wail.start(now); wail.stop(now + 0.8);
    wail2.start(now); wail2.stop(now + 0.8);

    // Dissolve hiss — long noise tail with downward filter sweep
    const hissDur = 0.9;
    const hb = c.createBuffer(1, Math.floor(c.sampleRate * hissDur), c.sampleRate);
    const hd = hb.getChannelData(0);
    for (let i = 0; i < hd.length; i++) hd[i] = (Math.random() * 2 - 1) * 0.4;
    const hs = c.createBufferSource(); hs.buffer = hb;
    const hf = c.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.setValueAtTime(2400, now);
    hf.frequency.exponentialRampToValueAtTime(500, now + hissDur);
    hf.Q.value = 0.8;
    const hg = c.createGain();
    hg.gain.setValueAtTime(0.0001, now);
    hg.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
    hg.gain.exponentialRampToValueAtTime(0.001, now + hissDur);
    hs.connect(hf).connect(hg).connect(master);
    hs.start(now); hs.stop(now + hissDur);
    return;
  }

  // Medium — low groan + collapse thud + cloth-rustle noise
  const groan = c.createOscillator();
  groan.type = 'sawtooth';
  groan.frequency.setValueAtTime(150, now);
  groan.frequency.exponentialRampToValueAtTime(60, now + 0.45);
  const gf = c.createBiquadFilter();
  gf.type = 'lowpass';
  gf.frequency.setValueAtTime(600, now);
  gf.frequency.exponentialRampToValueAtTime(180, now + 0.45);
  const gg = c.createGain();
  gg.gain.setValueAtTime(0.0001, now);
  gg.gain.exponentialRampToValueAtTime(0.55, now + 0.02);
  gg.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  groan.connect(gf).connect(gg).connect(master);
  groan.start(now); groan.stop(now + 0.5);

  // Collapse thud, delayed slightly
  const td = 0.18;
  const thud = c.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(110, now + td);
  thud.frequency.exponentialRampToValueAtTime(38, now + td + 0.22);
  const tg = c.createGain();
  tg.gain.setValueAtTime(0.0001, now + td);
  tg.gain.exponentialRampToValueAtTime(0.7, now + td + 0.005);
  tg.gain.exponentialRampToValueAtTime(0.001, now + td + 0.25);
  thud.connect(tg).connect(master);
  thud.start(now + td); thud.stop(now + td + 0.28);
}

/** Enemy windup growl — short menacing telegraph as enemy starts winding up.
 *  Size buckets match playEnemyDeath. */
export function playEnemyWindup(size: EnemyDeathSize = 'medium', pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master: AudioNode = pos
    ? createPositionalChain(pos, size === 'spectral' ? 0.55 : 0.30)
    : masterGain;

  const baseFreq = size === 'small' ? 280 : size === 'spectral' ? 220 : 110;
  const peakFreq = size === 'small' ? 360 : size === 'spectral' ? 320 : 150;
  const duration = 0.22;

  const osc = c.createOscillator();
  osc.type = size === 'spectral' ? 'sine' : 'sawtooth';
  osc.frequency.setValueAtTime(baseFreq, now);
  osc.frequency.exponentialRampToValueAtTime(peakFreq, now + duration * 0.7);
  osc.frequency.exponentialRampToValueAtTime(baseFreq, now + duration);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = size === 'spectral' ? 1200 : 500;
  filter.Q.value = 4;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(size === 'small' ? 0.18 : 0.32, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(filter).connect(gain).connect(master);
  osc.start(now); osc.stop(now + duration);
}

// ── Monster vocalisations ───────────────────────────────────────────────
//
// Positional idle/aware sounds emitted by living mobs (see mobs/enemy.ts).
// The point: you HEAR a thing before you SEE it — sound as a "something
// lives here" signal, sourced from a real enemy's position (never random).
// Each archetype is a short synth; the panner attenuates with distance, so
// a far mob is a faint cue down the dark and a near one is unmistakable.

export type VocalArchetype = 'skitter' | 'rattle' | 'groan' | 'squeak' | 'gurgle' | 'grind' | 'hiss';

// Global throttle so a swarm can't stack into a wall of noise — at most one
// vocalisation every ~0.45s across all mobs.
let lastVocalAt = -1;

function shortNoise(c: AudioContext, dur: number): AudioBuffer {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Emit a creature vocalisation at a world position. `agitated` (chasing/
 *  searching) tightens + brightens it vs. a calm idle utterance. */
export function playEnemyVocal(archetype: VocalArchetype, pos: Vec3Sound, agitated = false) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  if (lastVocalAt >= 0 && now - lastVocalAt < 0.45) return;
  lastVocalAt = now;

  const out = createPositionalChain(pos, archetype === 'groan' ? 0.5 : 0.35);
  const r = () => Math.random();
  const ag = agitated ? 1 : 0;

  switch (archetype) {
    case 'skitter': {
      // Rapid tiny chitinous clicks — a spider scuttling in the dark.
      const n = 4 + Math.floor(r() * (agitated ? 5 : 3));
      let t = now;
      for (let i = 0; i < n; i++) {
        const src = c.createBufferSource();
        src.buffer = shortNoise(c, 0.02);
        const hp = c.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 2400 + r() * 1800;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.10 + 0.05 * ag, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 0.03);
        src.connect(hp).connect(g).connect(out);
        src.start(t); src.stop(t + 0.04);
        t += 0.035 + r() * (agitated ? 0.03 : 0.05);
      }
      break;
    }
    case 'rattle': {
      // Dry bone clatter — slower, woodier clicks than the skitter.
      const n = 3 + Math.floor(r() * 3);
      let t = now;
      for (let i = 0; i < n; i++) {
        const src = c.createBufferSource();
        src.buffer = shortNoise(c, 0.03);
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1100 + r() * 900; bp.Q.value = 3;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.14, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 0.06);
        src.connect(bp).connect(g).connect(out);
        src.start(t); src.stop(t + 0.07);
        t += 0.07 + r() * 0.06;
      }
      break;
    }
    case 'groan': {
      // Low detuned moan with a slow pitch waver — the dread voice. Could be
      // the dead, could be the structure. (The one Josh liked, now sourced.)
      const base = (58 + r() * 40) * (agitated ? 1.18 : 1);
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.linearRampToValueAtTime(base * 1.13, now + 0.8);
      osc.frequency.linearRampToValueAtTime(base * 0.96, now + 1.7);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 230 + r() * 130; bp.Q.value = 4.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.17, now + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 2.1);
      osc.connect(bp).connect(g).connect(out);
      osc.start(now); osc.stop(now + 2.3);
      break;
    }
    case 'squeak': {
      // Short high chirp — vermin.
      const n = 1 + Math.floor(r() * 2);
      let t = now;
      for (let i = 0; i < n; i++) {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        const f = 700 + r() * 500;
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.09);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2000;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 0.11);
        osc.connect(lp).connect(g).connect(out);
        osc.start(t); osc.stop(t + 0.13);
        t += 0.12 + r() * 0.08;
      }
      break;
    }
    case 'gurgle': {
      // Wet low wobble — ooze. Bandpassed noise with an amplitude warble.
      const src = c.createBufferSource();
      src.buffer = shortNoise(c, 0.8); src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 280 + r() * 120; bp.Q.value = 2.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.13, now + 0.1);
      // warble
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7 + r() * 5;
      const lfoG = c.createGain(); lfoG.gain.value = 0.06;
      lfo.connect(lfoG).connect(g.gain);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 0.7);
      src.connect(bp).connect(g).connect(out);
      src.start(now); src.stop(now + 0.75); lfo.start(now); lfo.stop(now + 0.75);
      break;
    }
    case 'grind': {
      // Low stone-on-stone grind — the stoneguard shifting its weight.
      const src = c.createBufferSource();
      src.buffer = shortNoise(c, 1.0); src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.16, now + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 1.0);
      src.connect(lp).connect(g).connect(out);
      src.start(now); src.stop(now + 1.05);
      break;
    }
    case 'hiss': {
      // Breathy whisper — caster / acid-spitter. Highpassed noise swell.
      const src = c.createBufferSource();
      src.buffer = shortNoise(c, 0.9); src.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 3200; hp.Q.value = 0.7;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.08 + 0.03 * ag, now + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 0.85);
      src.connect(hp).connect(g).connect(out);
      src.start(now); src.stop(now + 0.9);
      break;
    }
  }
}

// ── Combat & locomotion creature sounds ──────────────────────────────────
// Hurt cries (struck but alive), strike grunts (the attack RELEASE, after
// the windup growl), and footstep foley (locomotion you hear approaching).
// All positional, all sourced from a real mob — the same "sound means
// something lives/acts HERE" contract as the idle vocalisations. Each has its
// own light global throttle so a swarm stays legible instead of walling up.

let lastHurtAt = -1;
let lastFootstepAt = -1;

/** Pained stab when a mob is struck and SURVIVES. Short + sharp — the idle
 *  archetype's character compressed into a flinch. Pairs with the weapon
 *  impact (metal/flesh) to make every connecting hit read as "I hurt it." */
export function playEnemyHurt(archetype: VocalArchetype, pos: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  if (lastHurtAt >= 0 && now - lastHurtAt < 0.05) return;   // de-stack cone multi-hits
  lastHurtAt = now;
  const out = createPositionalChain(pos, 0.3);
  const r = () => Math.random();

  switch (archetype) {
    case 'gurgle': {
      // Wet splat — struck jelly.
      const src = c.createBufferSource(); src.buffer = shortNoise(c, 0.18);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380 + r() * 120; bp.Q.value = 1.6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.22, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.16);
      src.connect(bp).connect(g).connect(out); src.start(now); src.stop(now + 0.18);
      break;
    }
    case 'rattle':
    case 'grind': {
      // Dry crack — bone/stone taking the blow.
      const src = c.createBufferSource(); src.buffer = shortNoise(c, 0.08);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = archetype === 'grind' ? 520 : 1400; bp.Q.value = 4;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.26, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.09);
      src.connect(bp).connect(g).connect(out); src.start(now); src.stop(now + 0.1);
      break;
    }
    case 'skitter':
    case 'squeak': {
      // High pained screech — vermin/chitin.
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      const f = (archetype === 'squeak' ? 900 : 1300) + r() * 300;
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.5, now + 0.12);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.13);
      osc.connect(lp).connect(g).connect(out); osc.start(now); osc.stop(now + 0.15);
      break;
    }
    case 'hiss': {
      // Sharp shriek — caster's breath cut short.
      const src = c.createBufferSource(); src.buffer = shortNoise(c, 0.16);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.2, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.14);
      src.connect(hp).connect(g).connect(out); src.start(now); src.stop(now + 0.16);
      break;
    }
    case 'groan':
    default: {
      // Pained grunt — short low sawtooth punched down.
      const base = 120 + r() * 40;
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 0.6, now + 0.16);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.2, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.18);
      osc.connect(bp).connect(g).connect(out); osc.start(now); osc.stop(now + 0.2);
      break;
    }
  }
}

/** The attack RELEASE — a short aggressive exhale/bark as the mob commits to
 *  its strike, after the rising windup growl. Sized like death/windup. */
export function playEnemyStrike(size: EnemyDeathSize = 'medium', pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const out = pos ? createPositionalChain(pos, 0.3) : masterGain;
  const base = size === 'small' ? 220 : size === 'spectral' ? 150 : 130;
  // Body — a fast downward grunt.
  const osc = c.createOscillator();
  osc.type = size === 'spectral' ? 'sine' : 'sawtooth';
  osc.frequency.setValueAtTime(base * 1.5, now);
  osc.frequency.exponentialRampToValueAtTime(base * 0.7, now + 0.14);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = base * 2.4; bp.Q.value = 2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.2, now + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0006, now + 0.16);
  osc.connect(bp).connect(g).connect(out);
  osc.start(now); osc.stop(now + 0.18);
  // Transient — a noisy "huff" of air at the front of the bark.
  const src = c.createBufferSource(); src.buffer = shortNoise(c, 0.06);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(0.12, now + 0.004);
  ng.gain.exponentialRampToValueAtTime(0.0006, now + 0.07);
  src.connect(hp).connect(ng).connect(out);
  src.start(now); src.stop(now + 0.08);
}

/** One locomotion tick — quiet, per-archetype. Driven by a mob's ACTUAL
 *  distance travelled (stride cadence in mobs/enemy.ts), so it only sounds
 *  when something is really moving and falls silent the instant it's pinned
 *  or idle. Globally throttled so a pack doesn't blur into static. */
export function playEnemyFootstep(archetype: VocalArchetype, pos: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  if (lastFootstepAt >= 0 && now - lastFootstepAt < 0.07) return;
  lastFootstepAt = now;
  const out = createPositionalChain(pos, 0.2);
  const r = () => Math.random();

  // Each archetype is one short filtered-noise tick. [filterType, freq, Q, peak, dur].
  const P: Record<VocalArchetype, ['highpass' | 'lowpass' | 'bandpass', number, number, number, number]> = {
    gurgle: ['bandpass', 300, 1.4, 0.07, 0.06],   // wet squelch
    rattle: ['bandpass', 1300, 5, 0.06, 0.04],    // bone tick
    skitter: ['highpass', 3000, 0.7, 0.05, 0.025],// chitin click
    grind: ['lowpass', 420, 0.8, 0.085, 0.10],    // stone scuff
    groan: ['lowpass', 700, 0.7, 0.05, 0.07],     // heavy drag
    squeak: ['highpass', 2500, 0.7, 0.04, 0.025], // light scurry
    hiss: ['highpass', 4200, 0.7, 0.035, 0.05],   // cloth rustle (robed)
  };
  const [ft, freq, q, peak, dur] = P[archetype];
  const src = c.createBufferSource(); src.buffer = shortNoise(c, dur);
  const f = c.createBiquadFilter(); f.type = ft; f.frequency.value = freq * (0.9 + r() * 0.2); f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0006, now + dur);
  src.connect(f).connect(g).connect(out);
  src.start(now); src.stop(now + dur + 0.02);
}

/** A withheld/denied action — pickup refused (carry full), or drinking at
 *  full HP. Deliberately NOT a chime: a dull, low, lowpassed double-knock
 *  that falls in pitch (a flat "no"), so it reads as "blocked" without the
 *  bright UI-bleep register. */
// Surface materials the player's weapon can strike. Each maps to a
// dedicated synth voicing in playSurfaceHit. Use 'stone' for walls /
// pillars; 'ceramic' for vases + pottery; 'wood' for chests + crates;
// 'metal' for grates + iron banding. Add a new value here, then teach
// playSurfaceHit how to voice it — callers stay unchanged.
export type HitMaterial = 'stone' | 'ceramic' | 'wood' | 'metal';

/** Play a sword-on-surface impact at `pos`, voiced for `material`. The
 *  blade is the same; the SURFACE swallows the strike differently.
 *
 *  Authoring a new material:
 *    1) Add it to `HitMaterial`.
 *    2) Add a case below. Three-layer template (body / mid / grit)
 *       keeps the family coherent so all hit sounds belong to the
 *       same world.
 *
 *  All voicings decay under ~250ms — surfaces don't ring. The blade's
 *  pre-impact whoosh has already played (onSwingStart); this is the
 *  CONTACT report. */
export function playSurfaceHit(material: HitMaterial, pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const out: AudioNode = pos ? createPositionalChain(pos, 0.30) : masterGain;
  switch (material) {
    case 'stone':   return voiceStone(c, out, now);
    case 'ceramic': return voiceCeramic(c, out, now);
    case 'wood':    return voiceWood(c, out, now);
    case 'metal':   return voiceMetal(c, out, now);
  }
}

/** Compat alias — earlier callers used playWallHit. Same sound as
 *  playSurfaceHit('stone', pos). */
export function playWallHit(pos?: Vec3Sound) {
  playSurfaceHit('stone', pos);
}

/** A surface DESTROYED (not just struck) — the fuller break/shatter. Routed by
 *  material like playSurfaceHit; falls back to the single-hit voice for
 *  materials without a dedicated shatter. Used when a vase/crate is smashed. */
export function playSurfaceShatter(material: HitMaterial, pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const out: AudioNode = pos ? createPositionalChain(pos, 0.35) : masterGain;
  switch (material) {
    case 'ceramic': return voiceCeramicShatter(c, out, now);
    default:        return playSurfaceHit(material, pos);
  }
}

// ── STONE ─ walls, pillars, altars. Low CLANK with grit. ─────────────
//   BODY  sine 360 → 90 Hz, lowpassed @ 420 Hz       (dull stone weight)
//   CLANK sawtooth 520 → 240 Hz, bandpassed @ 700 Hz (steel's bite)
//   GRIT  60ms noise, bandpassed @ 1.5 kHz           (chip / skitter)
function voiceStone(c: AudioContext, out: AudioNode, now: number): void {
  const bodyLp = c.createBiquadFilter();
  bodyLp.type = 'lowpass'; bodyLp.frequency.value = 420; bodyLp.Q.value = 0.7;
  bodyLp.connect(out);
  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(360, now);
  body.frequency.exponentialRampToValueAtTime(90, now + 0.18);
  const bodyG = c.createGain();
  bodyG.gain.setValueAtTime(0.0001, now);
  bodyG.gain.exponentialRampToValueAtTime(0.55, now + 0.004);
  bodyG.gain.exponentialRampToValueAtTime(0.0006, now + 0.20);
  body.connect(bodyG).connect(bodyLp);
  body.start(now); body.stop(now + 0.22);

  const clankBp = c.createBiquadFilter();
  clankBp.type = 'bandpass'; clankBp.frequency.value = 700; clankBp.Q.value = 2.0;
  clankBp.connect(out);
  const clank = c.createOscillator();
  clank.type = 'sawtooth';
  clank.frequency.setValueAtTime(520, now);
  clank.frequency.exponentialRampToValueAtTime(240, now + 0.08);
  const clankG = c.createGain();
  clankG.gain.setValueAtTime(0.0001, now);
  clankG.gain.exponentialRampToValueAtTime(0.18, now + 0.003);
  clankG.gain.exponentialRampToValueAtTime(0.0005, now + 0.11);
  clank.connect(clankG).connect(clankBp);
  clank.start(now); clank.stop(now + 0.12);

  attachNoiseBurst(c, out, now, 0.06, 'bandpass', 1500, 0.9, 0.13);
}

// ── CERAMIC ─ vases, pottery. Sharp CRACK + a quick shard tinkle. ─────
//   SNAP  sine 700 → 220 Hz, fast 80ms decay        (the crack)
//   CHIP  highpassed noise @ 3 kHz, very short      (the chip-off)
//   TINK  two short tones around 2.4 / 3.1 kHz      (shards scattering)
function voiceCeramic(c: AudioContext, out: AudioNode, now: number): void {
  const snap = c.createOscillator();
  snap.type = 'sine';
  snap.frequency.setValueAtTime(700, now);
  snap.frequency.exponentialRampToValueAtTime(220, now + 0.06);
  const snapG = c.createGain();
  snapG.gain.setValueAtTime(0.0001, now);
  snapG.gain.exponentialRampToValueAtTime(0.42, now + 0.003);
  snapG.gain.exponentialRampToValueAtTime(0.0005, now + 0.10);
  snap.connect(snapG).connect(out);
  snap.start(now); snap.stop(now + 0.11);

  attachNoiseBurst(c, out, now, 0.035, 'highpass', 3000, 0, 0.22);

  const tinks: Array<[number, number]> = [[2400, now + 0.030], [3100, now + 0.060]];
  for (const [f, t] of tinks) {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.65, t + 0.10);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.11);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.12);
  }
}

// ── CERAMIC SHATTER ─ a vase SMASHED, not tapped. Fuller + LOWER than the
//   single-hit tink (which read too shrill): a low body crack, a mid crunch of
//   the break, then a clatter of mid-pitched shards scattering on the floor.
//   BODY   sine 190 → 70 Hz, lowpassed         (the dull crack / weight)
//   CRUNCH 120ms noise bandpassed @ 1.1 kHz    (the break itself, not shrill)
//   SHARDS ~6 short tones 800–1800 Hz, staggered (pottery scattering)
function voiceCeramicShatter(c: AudioContext, out: AudioNode, now: number): void {
  const bodyLp = c.createBiquadFilter();
  bodyLp.type = 'lowpass'; bodyLp.frequency.value = 520; bodyLp.Q.value = 0.7;
  bodyLp.connect(out);
  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(190, now);
  body.frequency.exponentialRampToValueAtTime(70, now + 0.12);
  const bodyG = c.createGain();
  bodyG.gain.setValueAtTime(0.0001, now);
  bodyG.gain.exponentialRampToValueAtTime(0.5, now + 0.004);
  bodyG.gain.exponentialRampToValueAtTime(0.0006, now + 0.14);
  body.connect(bodyG).connect(bodyLp);
  body.start(now); body.stop(now + 0.15);

  // The break — a mid noise crunch (not the 3 kHz highpass chip of a tap).
  attachNoiseBurst(c, out, now, 0.12, 'bandpass', 1100, 1.2, 0.3);

  // Shards scattering — several mid-pitched tones over ~0.2s. Lower + more
  // numerous than the single-hit's two tinks, so it reads as pottery breaking.
  const shards: Array<[number, number]> = [
    [1500, 0.015], [1100, 0.045], [1800, 0.07], [950, 0.11], [1350, 0.15], [800, 0.20],
  ];
  for (const [f, dt] of shards) {
    const t = now + dt;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.09);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.10);
  }
}

// ── WOOD ─ chests, crates, doors. Dull THOCK, no ring. ────────────────
//   BODY  sine 200 → 60 Hz, 150ms                   (low dull weight)
//   KNOCK triangle 320 → 140 Hz, bandpassed @ 450 Hz (wooden strike)
//   GRAIN tight noise burst @ 800 Hz                 (splinter grit)
function voiceWood(c: AudioContext, out: AudioNode, now: number): void {
  const bodyLp = c.createBiquadFilter();
  bodyLp.type = 'lowpass'; bodyLp.frequency.value = 280; bodyLp.Q.value = 0.6;
  bodyLp.connect(out);
  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(200, now);
  body.frequency.exponentialRampToValueAtTime(60, now + 0.16);
  const bodyG = c.createGain();
  bodyG.gain.setValueAtTime(0.0001, now);
  bodyG.gain.exponentialRampToValueAtTime(0.45, now + 0.005);
  bodyG.gain.exponentialRampToValueAtTime(0.0006, now + 0.17);
  body.connect(bodyG).connect(bodyLp);
  body.start(now); body.stop(now + 0.19);

  const knockBp = c.createBiquadFilter();
  knockBp.type = 'bandpass'; knockBp.frequency.value = 450; knockBp.Q.value = 1.4;
  knockBp.connect(out);
  const knock = c.createOscillator();
  knock.type = 'triangle';
  knock.frequency.setValueAtTime(320, now);
  knock.frequency.exponentialRampToValueAtTime(140, now + 0.07);
  const knockG = c.createGain();
  knockG.gain.setValueAtTime(0.0001, now);
  knockG.gain.exponentialRampToValueAtTime(0.20, now + 0.004);
  knockG.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
  knock.connect(knockG).connect(knockBp);
  knock.start(now); knock.stop(now + 0.10);

  attachNoiseBurst(c, out, now, 0.04, 'bandpass', 800, 0.7, 0.07);
}

// ── METAL ─ grates, iron banding, helms. Edged CLANG + brief ring. ───
//   BODY  square 480 → 220 Hz, lowpass envelope     (the strike)
//   RING  sine 1600 Hz, ~180ms exponential decay    (the metal's hum)
//   BURR  bandpassed noise @ 1.8 kHz                (the bite)
function voiceMetal(c: AudioContext, out: AudioNode, now: number): void {
  const bodyLp = c.createBiquadFilter();
  bodyLp.type = 'lowpass'; bodyLp.frequency.value = 1100; bodyLp.Q.value = 0.8;
  bodyLp.connect(out);
  const body = c.createOscillator();
  body.type = 'square';
  body.frequency.setValueAtTime(480, now);
  body.frequency.exponentialRampToValueAtTime(220, now + 0.10);
  const bodyG = c.createGain();
  bodyG.gain.setValueAtTime(0.0001, now);
  bodyG.gain.exponentialRampToValueAtTime(0.28, now + 0.003);
  bodyG.gain.exponentialRampToValueAtTime(0.0005, now + 0.13);
  body.connect(bodyG).connect(bodyLp);
  body.start(now); body.stop(now + 0.14);

  const ring = c.createOscillator();
  ring.type = 'sine';
  ring.frequency.value = 1600;
  const ringG = c.createGain();
  ringG.gain.setValueAtTime(0.0001, now);
  ringG.gain.exponentialRampToValueAtTime(0.15, now + 0.005);
  ringG.gain.exponentialRampToValueAtTime(0.0005, now + 0.20);
  ring.connect(ringG).connect(out);
  ring.start(now); ring.stop(now + 0.22);

  attachNoiseBurst(c, out, now, 0.05, 'bandpass', 1800, 1.2, 0.10);
}

// Shared noise-burst helper for the GRIT / CHIP / BURR layer. Builds a
// one-off short noise sample, filters it, gains it, plays it.
function attachNoiseBurst(
  c: AudioContext, out: AudioNode, now: number,
  dur: number, filter: 'bandpass' | 'highpass' | 'lowpass',
  freq: number, q: number, gain: number,
): void {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const node = c.createBufferSource();
  node.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  if (filter === 'bandpass' && q > 0) f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  node.connect(f).connect(g).connect(out);
  node.start(now); node.stop(now + dur);
}

export function playDenied() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
  lp.connect(masterGain);
  // Two soft low knocks, the second lower — a downward "nope".
  const hits: Array<[number, number]> = [[180, now], [132, now + 0.085]];
  for (const [f, t] of hits) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
    osc.connect(g).connect(lp);
    osc.start(t); osc.stop(t + 0.15);
  }
}

/** Magic strike — wraith hits, distinct from physical impact. Brief bell-like
 *  chime layered with a sizzle to read as "burn + ring". */
export function playMagicHit() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  // Bell — two slightly detuned triangles tuned to a minor third for a sour ring
  const f1 = 660, f2 = 785;
  for (const f of [f1, f2]) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(g).connect(master);
    osc.start(now); osc.stop(now + 0.58);
  }
  // Sizzle — short noise burst, high-passed
  const sd = 0.22;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * sd), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(); s.buffer = b;
  const f = c.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 2200;
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.25, now);
  sg.gain.exponentialRampToValueAtTime(0.001, now + sd);
  s.connect(f).connect(sg).connect(master);
  s.start(now); s.stop(now + sd);
}

// ── Pickup / item interaction ─────────────────────────────────────────

/** Loot landing on the floor — short tumbly thump. Played when an item
 *  pickup spawns (after enemy death). */
export function playLootLand(pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master: AudioNode = pos ? createPositionalChain(pos, 0.30) : masterGain;

  // Thud
  const thud = c.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(90, now);
  thud.frequency.exponentialRampToValueAtTime(45, now + 0.14);
  const tg = c.createGain();
  tg.gain.setValueAtTime(0.0001, now);
  tg.gain.exponentialRampToValueAtTime(0.35, now + 0.004);
  tg.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  thud.connect(tg).connect(master);
  thud.start(now); thud.stop(now + 0.18);

  // Tiny clink/scrape on top
  const cd = 0.08;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * cd), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(); s.buffer = b;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass'; filt.frequency.value = 3500; filt.Q.value = 2;
  const sg = c.createGain();
  sg.gain.value = 0.18;
  s.connect(filt).connect(sg).connect(master);
  s.start(now + 0.02); s.stop(now + 0.02 + cd);
}

/** Pickup chime — when player TAKES an item. Rarity-tinted pitch — better
 *  rarities ring higher and longer. */
export function playPickupChime(rarityIndex: number = 0) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;

  // A cold, hollow toll — NOT a cheery bell. The old sound was a bright
  // major-pentatonic ding (G4 + octave) that rang out happily in the
  // exploration silence — wrong for grimdark ("items don't celebrate; the
  // system observes without judgment"). Now: a low root + bare FIFTH (hollow,
  // indifferent) through a lowpass, short decay so it doesn't linger. Rarity
  // still reads — it raises the pitch + lengthens, and uncommon+ get a faint
  // high shimmer so a real find still feels like one.
  const idx = Math.max(0, Math.min(4, rarityIndex));
  const roots = [196, 220, 247, 277, 311];   // G3..D#4 — rises with rarity, stays low/dark
  const root = roots[idx];
  const tail = 0.22 + idx * 0.05;

  // Warmth lowpass — shaves the bright top so the toll reads as struck stone/
  // metal, not a synth bell.
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.7;
  lp.connect(masterGain);

  // Root + bare fifth (×1.5) — a hollow, cold interval, no major brightness.
  for (const [mul, amp] of [[1, 0.20], [1.5, 0.11]] as const) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = root * mul;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(amp, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, now + tail);
    osc.connect(g).connect(lp);
    osc.start(now); osc.stop(now + tail + 0.05);
  }

  // Rare-find shimmer — a faint high partial that only blooms for uncommon+.
  if (idx >= 2) {
    const sh = c.createOscillator();
    sh.type = 'sine';
    sh.frequency.value = root * 4;
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, now + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.04 + idx * 0.012, now + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0006, now + tail * 1.2);
    sh.connect(sg).connect(masterGain);
    sh.start(now + 0.02); sh.stop(now + tail * 1.2 + 0.05);
  }

  // Rare+ resonant swell — a sub-octave sine UNDER the toll that blooms in
  // slowly and decays, giving a real find weight/body without brightening
  // it. Fabled holds it nearly 3× as long: the "held tone" that says THIS
  // one matters. Routed through the warmth lowpass so it reads as a deep
  // struck resonance, not a synth pad.
  if (idx >= 2) {
    const swellTail = tail * (idx >= 4 ? 2.8 : 1.7);
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = root * 0.5;
    const subg = c.createGain();
    subg.gain.setValueAtTime(0.0001, now);
    subg.gain.exponentialRampToValueAtTime(0.16 + (idx - 2) * 0.05, now + 0.13);
    subg.gain.exponentialRampToValueAtTime(0.0006, now + swellTail);
    sub.connect(subg).connect(lp);
    sub.start(now); sub.stop(now + swellTail + 0.1);
  }
}

/** Chest opening — creaky wood hinge: pitch-rising filtered noise. */
export function playChestOpen() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  const dur = 0.55;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
  const s = c.createBufferSource(); s.buffer = b;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.setValueAtTime(380, now);
  filt.frequency.exponentialRampToValueAtTime(900, now + dur);
  filt.Q.value = 6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
  g.gain.linearRampToValueAtTime(0.15, now + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  s.connect(filt).connect(g).connect(master);
  s.start(now); s.stop(now + dur);

  // Final thunk as the lid stops
  const thunk = c.createOscillator();
  thunk.type = 'sine';
  thunk.frequency.setValueAtTime(85, now + dur - 0.02);
  thunk.frequency.exponentialRampToValueAtTime(40, now + dur + 0.12);
  const tg = c.createGain();
  tg.gain.setValueAtTime(0.0001, now + dur - 0.02);
  tg.gain.exponentialRampToValueAtTime(0.32, now + dur - 0.015);
  tg.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.14);
  thunk.connect(tg).connect(master);
  thunk.start(now + dur - 0.02); thunk.stop(now + dur + 0.15);
}

/** Drinking a potion — wet slurp + glass settle. */
export function playHealSlurp() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  // Wet gulp — noise modulated by a low oscillator giving a "glub" pulse
  const dur = 0.35;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const pulse = 0.5 + 0.5 * Math.sin(i / c.sampleRate * 22);
    d[i] = (Math.random() * 2 - 1) * 0.4 * pulse;
  }
  const s = c.createBufferSource(); s.buffer = b;
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(900, now);
  filt.frequency.linearRampToValueAtTime(400, now + dur);
  filt.Q.value = 2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.4, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  s.connect(filt).connect(g).connect(master);
  s.start(now); s.stop(now + dur);

  // Glass clink at the end
  const clinkF = 1800;
  const ck = c.createOscillator();
  ck.type = 'triangle';
  ck.frequency.value = clinkF;
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.0001, now + dur);
  cg.gain.exponentialRampToValueAtTime(0.12, now + dur + 0.005);
  cg.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.18);
  ck.connect(cg).connect(master);
  ck.start(now + dur); ck.stop(now + dur + 0.2);
}

/** Buff activating — magical shimmer up-glide. Distinct from heal. */
export function playBuffApply() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  // Two saws gliding up a fifth
  for (const [start, end, vol] of [[200, 300, 0.16], [400, 600, 0.10]] as const) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + 0.45);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(800, now);
    f.frequency.exponentialRampToValueAtTime(2400, now + 0.45);
    f.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(f).connect(g).connect(master);
    osc.start(now); osc.stop(now + 0.58);
  }
}

// ── UI ────────────────────────────────────────────────────────────────

/** Menu opening — soft paper rustle / fabric flip. */
export function playMenuOpen() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  const dur = 0.22;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = Math.sin((i / d.length) * Math.PI);
    d[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const s = c.createBufferSource(); s.buffer = b;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(1600, now);
  f.frequency.linearRampToValueAtTime(2400, now + dur);
  f.Q.value = 1.5;
  const g = c.createGain();
  g.gain.value = 0.22;
  s.connect(f).connect(g).connect(master);
  s.start(now); s.stop(now + dur);
}

/** Menu closing — similar to open but sweeps down. */
export function playMenuClose() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  const dur = 0.18;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = Math.sin((i / d.length) * Math.PI);
    d[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const s = c.createBufferSource(); s.buffer = b;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(2200, now);
  f.frequency.linearRampToValueAtTime(1400, now + dur);
  f.Q.value = 1.5;
  const g = c.createGain();
  g.gain.value = 0.18;
  s.connect(f).connect(g).connect(master);
  s.start(now); s.stop(now + dur);
}

/** Equip click — short metal-on-leather clink. */
export function playEquipClick() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  // Two close metallic transients
  for (const [t, freq] of [[0, 1400], [0.025, 1900]] as const) {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.exponentialRampToValueAtTime(0.10, now + t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.08);
    const filt = c.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 5;
    osc.connect(filt).connect(g).connect(master);
    osc.start(now + t); osc.stop(now + t + 0.10);
  }
}

// ── Player death — final stinger ──────────────────────────────────────

/** Player death stinger — slow descending dread tone + low boom. */
export function playPlayerDeathStinger() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  // Boom
  const boom = c.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(80, now);
  boom.frequency.exponentialRampToValueAtTime(28, now + 0.9);
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, now);
  bg.gain.exponentialRampToValueAtTime(0.75, now + 0.04);
  bg.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
  boom.connect(bg).connect(master);
  boom.start(now); boom.stop(now + 1.5);

  // Descending dread chord (minor second)
  for (const [f, vol] of [[220, 0.18], [233, 0.14]] as const) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, now + 0.1);
    o.frequency.exponentialRampToValueAtTime(f * 0.4, now + 1.6);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(700, now + 0.1);
    filt.frequency.exponentialRampToValueAtTime(200, now + 1.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now + 0.1);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    o.connect(filt).connect(g).connect(master);
    o.start(now + 0.1); o.stop(now + 1.85);
  }
}

/** Footstep on stone — soft scuff. Called once per stride from the camera
 *  update; pitch slightly randomized so successive steps don't sound robotic. */
export function playFootstep() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

  const dur = 0.12;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = (1 - i / d.length) * (i < 200 ? i / 200 : 1);
    d[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const s = c.createBufferSource(); s.buffer = b;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 800 + Math.random() * 300;
  f.Q.value = 1.5;
  const g = c.createGain();
  g.gain.value = 0.10;
  s.connect(f).connect(g).connect(master);
  s.start(now); s.stop(now + dur);
}

// ── Ambience: looped torch crackle + room drone ───────────────────────

let crackleSource: AudioBufferSourceNode | null = null;
let crackleGain: GainNode | null = null;
let droneGain: GainNode | null = null;

/** Start the looped torch-crackle bed. setTorchProximity controls volume
 *  based on how close the listener is to torches. Cheap: one source, one
 *  gain — no per-torch nodes. */
export function startAmbience() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  if (crackleSource) return;  // already running
  const master = masterGain;

  // Crackle: 6-second loop of fire-like sound. Two layered components:
  //
  //   1. CONTINUOUS FIZZ BED — quiet broadband noise filling the loop
  //      so there's never empty silence. This is the warm hiss of
  //      flame burning gas. Without it, the gaps between pops read as
  //      "click… click… click…" — a Geiger counter.
  //
  //   2. SOFT POPS on top — short noise bursts with gentle attack +
  //      exponential decay. Far fewer pops than before AND each pop
  //      has a slower attack (~10% of length, not instant), so they
  //      blend into the fizz rather than punch out as sharp clicks.
  //
  // Filter chain widened + dropped from 3 kHz to 1.5 kHz so the warmer
  // body of fire reads through instead of just the snap region. Low Q
  // (0.7) means it's a gentle tilt, not a sharp resonance peak.
  const loopDur = 6.0;
  const sr = c.sampleRate;
  const b = c.createBuffer(1, Math.floor(sr * loopDur), sr);
  const d = b.getChannelData(0);
  // Fizz bed — VERY quiet bed of noise so there's never absolute
  // silence between pops (silent gaps are what make sparse clicks
  // read as Geiger ticks). Kept low enough that it doesn't dominate
  // — the pops should be the foreground sound.
  const FIZZ_AMP = 0.018;
  for (let i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * FIZZ_AMP;
  }
  // Crackles ON TOP of the fizz — SUBTLE. Rare, quiet, with a soft
  // attack so they barely announce themselves above the fizz floor.
  // The fizz carries the ambience; the pops are just a hint that
  // there's fire in the room.
  const POPS_PER_SEC = 1.5;
  const totalPops = Math.floor(loopDur * POPS_PER_SEC);
  for (let p = 0; p < totalPops; p++) {
    const start = Math.floor(Math.random() * d.length);
    const popLen = Math.floor(sr * (0.025 + Math.random() * 0.060));
    const amp = 0.06 + Math.random() * 0.14;   // 0.06–0.20 — quiet
    for (let i = 0; i < popLen && start + i < d.length; i++) {
      // 18% gentle attack — pops swell in rather than punch in.
      const attackLen = popLen * 0.18;
      const attack = i < attackLen ? i / attackLen : 1;
      const decay = Math.exp(-i / (popLen * 0.45));
      const env = attack * decay;
      d[start + i] += (Math.random() * 2 - 1) * amp * env;
    }
  }
  const s = c.createBufferSource();
  s.buffer = b; s.loop = true;
  // Slight pitch drift each cycle so the loop doesn't reveal itself.
  s.playbackRate.value = 0.95 + Math.random() * 0.1;
  // Bandpass centred around the warm-body region of fire (1.5 kHz)
  // with low Q so it's a broad tilt, not a sharp resonant peak.
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.7;
  // High-pass cut keeps the drone bed's low rumble territory clean
  // but pulled down from 800 Hz → 300 Hz so the warmth comes through.
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 300;
  crackleGain = c.createGain();
  crackleGain.gain.value = 0;  // starts silent; setTorchProximity raises it
  s.connect(hp).connect(bp).connect(crackleGain).connect(master);
  s.start();
  crackleSource = s;

  // Room drone: slow low oscillator + detuned partner for haunted shimmer
  droneGain = c.createGain();
  droneGain.gain.value = 0.05;
  droneGain.connect(master);
  for (const [f0, vol] of [[55, 0.6], [82.5, 0.25]] as const) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f0;
    const og = c.createGain();
    og.gain.value = vol;
    // Slow LFO on volume for breathing quality
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.13;
    const lfoG = c.createGain();
    lfoG.gain.value = vol * 0.3;
    lfo.connect(lfoG).connect(og.gain);
    o.connect(og).connect(droneGain);
    o.start(); lfo.start();
  }
}

/** Adjust torch crackle volume — caller passes a 0..1 proximity factor each
 *  frame (computed from sum of (1 - dist/range) across all torches, clamped).
 *  Cheap to call every frame; uses linearRamp for smooth movement. */
export function setTorchProximity(p: number) {
  const c = ensureCtx();
  if (!c || !crackleGain) return;
  // Cap lowered from 0.22 → 0.14 now that the crackle is sparse pops
  // rather than continuous filtered noise. Sparse content reads as
  // louder per-event; cap so a torch-rich room doesn't drown combat.
  const target = Math.max(0, Math.min(1, p)) * 0.14;
  crackleGain.gain.linearRampToValueAtTime(target, c.currentTime + 0.1);
}

/** Broadcast/achievement chime — bright two-note arpeggio, sci-fi notification feel.
 *  Cool register on purpose to contrast the dungeon's warm sound design. */
export function playBroadcastChime() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const master = masterGain;

  const now = c.currentTime;
  const notes = [880, 1318.5]; // A5 then E6 — bright open fifth

  notes.forEach((freq, i) => {
    const t = now + i * 0.07;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    // Quieter than before (was 0.18) — chime was fighting combat sounds.
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.34);
  });
}

// Deep ritual bell — a slow, mournful toll. Real bells have INHARMONIC
// partials (the overtones aren't integer multiples of the fundamental),
// so three sines tuned to a strike-bell-style spectrum carry the
// character: fundamental near C3, "hum" tone a third above (inharmonic),
// "prime" tone an octave-and-a-bit higher. A tiny strike noise burst
// stamps the front. Slow exponential decay across ~2s; the bell
// sustains while the ritual gate seals.
export function playRitualBell(pos?: Vec3Sound) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const out: AudioNode = pos ? createPositionalChain(pos, 0.55) : masterGain;

  // Three partials — fundamental + two inharmonic overtones. Bell-like
  // strikes are characterised by these non-integer ratios, so the toll
  // reads as "a real bell" instead of an organ chord.
  const partials: Array<[number, number, number]> = [
    [130, 0.40, 2.20],   // fundamental — deep, big amplitude, long decay
    [320, 0.22, 1.50],   // "hum" partial — minor-3rdish above the doubled root
    [560, 0.14, 1.10],   // "prime" partial — high, dims fastest
  ];
  for (const [f, amp, decay] of partials) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, now);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(amp, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0006, now + decay);
    osc.connect(g).connect(out);
    osc.start(now);
    osc.stop(now + decay + 0.05);
  }

  // Strike — a brief lowpassed noise click for the hammer's contact. Stamps
  // the leading edge so the toll has a felt onset, not just a swell.
  const strikeDur = 0.05;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * strikeDur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const strike = c.createBufferSource();
  strike.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;
  lp.Q.value = 0.7;
  const sg = c.createGain();
  sg.gain.value = 0.22;
  strike.connect(lp).connect(sg).connect(out);
  strike.start(now);
  strike.stop(now + strikeDur);
}
