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
    return ctx;
  } catch {
    return null;
  }
}

/** Set master volume (0..1). Settings menu calls this when the slider moves. */
export function setMasterVolume(v: number) {
  masterVolume = Math.max(0, Math.min(1, v));
  if (masterGain) masterGain.gain.value = masterVolume;
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

// ── Enemy death — per-size variant ─────────────────────────────────────
// Three size buckets:
//   small    rat / skitterer — squeal + light thud
//   medium   ghoul / skirmisher — low groan + collapse
//   spectral wraith — ethereal wail + dissolve hiss

export type EnemyDeathSize = 'small' | 'medium' | 'spectral';

export function playEnemyDeath(size: EnemyDeathSize = 'medium') {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

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
export function playEnemyWindup(size: EnemyDeathSize = 'medium') {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

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
export function playLootLand() {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const master = masterGain;

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
  const master = masterGain;

  // Map rarity 0..4 (mundane..fabled) to a small set of major-pentatonic notes
  const notes = [392, 440, 523, 659, 784];  // G4 A4 C5 E5 G5
  const f = notes[Math.max(0, Math.min(4, rarityIndex))];
  const tail = 0.32 + rarityIndex * 0.08;

  for (const mul of [1, 2]) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f * mul;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(mul === 1 ? 0.22 : 0.10, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + tail);
    osc.connect(g).connect(master);
    osc.start(now); osc.stop(now + tail + 0.04);
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

  // Crackle: 6-second loop of fire-like sound. Earlier this was constant
  // noise with a bandpass — which sounded like radio static, not fire.
  // Real fire crackle is sparse SHARP POPS with near-silence between
  // (plus a faint warm rumble that the drone bed below handles). Each
  // pop is a short noise burst with its own quick envelope, instead of
  // continuous filtered noise.
  const loopDur = 6.0;
  const sr = c.sampleRate;
  const b = c.createBuffer(1, Math.floor(sr * loopDur), sr);
  const d = b.getChannelData(0);
  d.fill(0);
  // Number of pops over the loop. ~7 per second → ~42 total; with random
  // envelopes 5–40 ms long they're audibly distinct, not a continuous hiss.
  const POPS_PER_SEC = 7;
  const totalPops = Math.floor(loopDur * POPS_PER_SEC);
  for (let p = 0; p < totalPops; p++) {
    const start = Math.floor(Math.random() * d.length);
    // Pop duration: 8–35 ms — short crackle snap. Bigger pops are louder.
    const popLen = Math.floor(sr * (0.008 + Math.random() * 0.027));
    const amp = 0.4 + Math.random() * 0.6;
    for (let i = 0; i < popLen && start + i < d.length; i++) {
      // Sharp attack, exponential decay envelope.
      const env = Math.exp(-i / (popLen * 0.25));
      d[start + i] += (Math.random() * 2 - 1) * amp * env;
    }
  }
  const s = c.createBufferSource();
  s.buffer = b; s.loop = true;
  // Slight pitch drift each cycle so the loop doesn't reveal itself.
  s.playbackRate.value = 0.95 + Math.random() * 0.1;
  // Bandpass tightened around the "snap" region of a real fire crackle
  // (2.5–4 kHz). Q=2 makes it a clearer click rather than a wide hiss.
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 2.2;
  // High-pass cut to kill any residual rumble — the drone bed owns the lows.
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 800;
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
