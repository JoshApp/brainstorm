// Procedural sound effects via the Web Audio API. No asset files — these are
// placeholder synthesized sounds we can iterate on, with real samples coming
// later. Two events for now: whoosh (sword cutting air) on swing start, and
// impact (heavy thud) on a hit landing.
//
// Browsers require a user-gesture-initiated context, so the AudioContext is
// lazily created on first call. The attack button press IS a user gesture,
// so the first sword swing will succeed in creating it.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
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

/** Heavy impact — low-frequency body thud + a brief high-mid crack on top. */
export function playImpact() {
  const c = ensureCtx();
  if (!c || !masterGain) return;

  const now = c.currentTime;

  // Body: low oscillator dropping to sub-bass
  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(140, now);
  body.frequency.exponentialRampToValueAtTime(45, now + 0.18);
  const bodyGain = c.createGain();
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.8, now + 0.005);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  body.connect(bodyGain).connect(masterGain);
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
  crack.connect(crackFilter).connect(crackGain).connect(masterGain);
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
