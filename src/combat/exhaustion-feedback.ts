// Exhaustion feedback — the felt-stamina channel.
//
// When you've spent yourself down, "winded" is communicated through the BODY,
// not a HUD number you can't watch mid-fight: breathing that quickens and a
// subtle camera chest-heave, both ramping with exertion. Silent + still when
// rested, light when low, heavy panting + a bigger heave when gassed. Pairs with
// the gassed heartbeat haptic (exhaustion-haptic.ts) and the ghost stamina bar.
//
// One continuous breath PHASE drives both channels: it advances at a rate that
// climbs with exertion, fires a breath puff once per cycle, and its sine is the
// chest-heave the camera reads. Module-level mutable state; NOT persisted.

import { CONFIG } from '../config';
import { staminaFraction, isStaminaExhausted } from './stamina';
import { playBreath } from '../audio/sfx';

let phase = 0;             // continuous breath phase (in cycles)
let currentExertion = 0;   // last computed 0..1, baked into the heave

// 0 when rested, ramps in below WINDED_THRESHOLD (capped at SUBGASSED_MAX), and
// pins to 1 while gassed — so low stamina breathes lightly, empty pants hard.
function exertion(): number {
  if (isStaminaExhausted()) return 1;
  const T = CONFIG.EXHAUSTION.WINDED_THRESHOLD;
  const frac = staminaFraction();
  if (frac >= T) return 0;
  return ((T - frac) / T) * CONFIG.EXHAUSTION.SUBGASSED_MAX;
}

/** Tick in REAL time, so the breath cadence is steady through slow-mo / hit-
 *  pause. Call from an 'unpaused' system (it falls silent in menus). */
export function tickExhaustionFeedback(realDt: number): void {
  const ex = exertion();
  currentExertion = ex;
  if (ex <= 0) { phase = 0; return; }
  const rate = CONFIG.EXHAUSTION.BREATH_HZ_MIN
    + (CONFIG.EXHAUSTION.BREATH_HZ_MAX - CONFIG.EXHAUSTION.BREATH_HZ_MIN) * ex;
  const prev = phase;
  phase += realDt * rate;
  if (Math.floor(phase) > Math.floor(prev)) playBreath(ex);   // one puff per cycle
}

/** Breath oscillation for the camera chest-heave, in [−exertion, +exertion].
 *  Multiply by the HEAVE_* amplitudes. 0 when rested. */
export function getExhaustionHeave(): number {
  return Math.sin(phase * Math.PI * 2) * currentExertion;
}

export function resetExhaustionFeedback(): void {
  phase = 0;
  currentExertion = 0;
}
