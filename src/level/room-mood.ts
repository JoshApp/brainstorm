import * as THREE from 'three';

// Per-room mood override — a runtime tint a room can be SET to while a
// ritual / event is active, blended over time with the room's baked
// torch palette and dropped to reveal the original look on demand.
//
// Floor-wide mood already lives in level/acts.ts (the act's torchTint).
// Per-room is the layer above that: when a challenge altar starts a
// ritual, the room overrides red; on win, it eases back. The mood
// system is the seam — content authors hit setRoomMood() and the
// torches + fills + flames they registered through bindLight /
// bindFlame slerp toward that tint.
//
// Cheap by design: per-room state (one record), per-bound-item one
// mutation. No per-frame allocation, no shader work, no event bus
// listeners. Bindings are CLEARED at level teardown
// (clearRoomMoodBindings); state survives unless explicitly reset.

interface MoodState {
  /** Target tint colour (hex) — applied at full strength when mix=1. */
  overrideColor: number;
  /** Live 0..1 blend. 0 = base only, 1 = full override. Eases each tick. */
  currentMix: number;
  /** Target blend driven by the most recent set/clear call. */
  targetMix: number;
  /** 1/sec exponential rate at which currentMix eases toward targetMix. */
  rampRate: number;
}

interface BoundLight {
  source: { color: number };  // a registered LightSource — pool reads .color each frame
  baseColor: number;
}
interface BoundFlame {
  material: THREE.MeshStandardMaterial;
  baseColor: number;
  baseEmissive: number;
}

const moodByRoom = new Map<string, MoodState>();
const lightsByRoom = new Map<string, BoundLight[]>();
const flamesByRoom = new Map<string, BoundFlame[]>();

// Linear RGB mix in hex space. Cheap, gamma-incorrect but acceptable for
// the small palette range these moods live in (warm amber ↔ blood-red etc).
function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const tt = Math.max(0, Math.min(1, t));
  const r = Math.round(ar + (br - ar) * tt);
  const g = Math.round(ag + (bg - ag) * tt);
  const bl = Math.round(ab + (bb - ab) * tt);
  return (r << 16) | (g << 8) | bl;
}

/** Set a room's mood OVERRIDE colour, or clear it (null). `rampSeconds` is
 *  how long the blend takes to ease in (or out, on clear). Calling with the
 *  same colour while already set just refreshes the ramp rate. */
export function setRoomMood(
  roomId: string,
  color: number | null,
  rampSeconds: number = 0.6,
): void {
  let state = moodByRoom.get(roomId);
  if (!state) {
    state = { overrideColor: color ?? 0xffffff, currentMix: 0, targetMix: 0, rampRate: 1 };
    moodByRoom.set(roomId, state);
  }
  if (color !== null) state.overrideColor = color;
  state.targetMix = color !== null ? 1 : 0;
  state.rampRate = rampSeconds > 0 ? 1 / rampSeconds : 1000;
}

/** Register a light source for room-mood tinting. The source's `color` field
 *  is mutated each frame; the original is remembered so a clear restores it. */
export function bindLight(
  roomId: string,
  source: { color: number },
): void {
  let arr = lightsByRoom.get(roomId);
  if (!arr) { arr = []; lightsByRoom.set(roomId, arr); }
  arr.push({ source, baseColor: source.color });
}

/** Register a flame material — colour + emissive are tinted together so the
 *  flame visibly reads the mood in both lit and unlit paths. */
export function bindFlame(
  roomId: string,
  material: THREE.MeshStandardMaterial,
): void {
  let arr = flamesByRoom.get(roomId);
  if (!arr) { arr = []; flamesByRoom.set(roomId, arr); }
  arr.push({
    material,
    baseColor: material.color.getHex(),
    baseEmissive: material.emissive ? material.emissive.getHex() : 0,
  });
}

/** Per-frame: ease each room's currentMix toward targetMix, then apply the
 *  blended colour to every bound light + flame in that room. Idle rooms (no
 *  mood entry, or fully settled mix=0) cost nothing — the loop early-outs. */
export function tickRoomMood(dt: number): void {
  for (const [roomId, state] of moodByRoom) {
    const before = state.currentMix;
    const k = 1 - Math.exp(-state.rampRate * dt);
    state.currentMix += (state.targetMix - state.currentMix) * k;
    // Idle: target=0 AND currentMix already collapsed. Restore base once
    // (in case a previous tick wrote a non-base value) then skip.
    if (state.currentMix < 0.001 && state.targetMix === 0) {
      if (before > 0.001) {
        for (const bl of lightsByRoom.get(roomId) ?? []) bl.source.color = bl.baseColor;
        for (const bf of flamesByRoom.get(roomId) ?? []) {
          bf.material.color.setHex(bf.baseColor);
          if (bf.material.emissive) bf.material.emissive.setHex(bf.baseEmissive);
        }
      }
      continue;
    }
    const mix = state.currentMix;
    const target = state.overrideColor;
    for (const bl of lightsByRoom.get(roomId) ?? []) {
      bl.source.color = mixHex(bl.baseColor, target, mix);
    }
    for (const bf of flamesByRoom.get(roomId) ?? []) {
      bf.material.color.setHex(mixHex(bf.baseColor, target, mix));
      if (bf.material.emissive) bf.material.emissive.setHex(mixHex(bf.baseEmissive, target, mix));
    }
  }
}

/** Drop every binding + state. Call at level teardown so a stale moody room
 *  from the previous floor doesn't tint a torch that happens to reuse the id. */
export function clearRoomMoodBindings(): void {
  moodByRoom.clear();
  lightsByRoom.clear();
  flamesByRoom.clear();
}
