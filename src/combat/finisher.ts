import { CONFIG } from '../config';
import { isFrozen } from './hit-pause';
import { playFinisher } from '../audio/sfx';
import { registerSimReset } from '../engine/sim-state';
import type { Vec3Sound } from '../audio/sfx';

// THE FINISHER CEREMONY — the beat that turns an execution into a MOMENT.
//
// The mechanic was already whole: attack.ts gives a charged heavy into a
// poise-broken foe EXECUTE.DAMAGE_MUL damage and refunds stamina, and the kill
// already got EMPHASIS — a longer freeze, a bigger shake, doubled haptic, a
// second thud. What it did not have was a SHAPE. Emphasis makes a hit louder;
// a ceremony gives it a beginning, a held middle, and a release you feel end.
//
// Three beats, in order, and the order is the whole point:
//
//   1. THE CRACK   — the hit-pause that already fires. Unchanged; this module
//                    deliberately waits it out (see tickFinisher) so the two
//                    don't overlap into one mushy hitch.
//   2. THE HUSH    — the world drops to WORLD_SCALE and holds there, the view
//                    narrows, the air goes warm and close at the edges, the
//                    audio dulls. The PLAYER is untouched — the same asymmetry
//                    the perfect-dodge dip uses, so you can keep swinging
//                    through your own execution rather than watch a cutscene.
//   3. THE RELEASE — a quadratic snap back to full speed.
//
// Every cue reads `finisherIntensity()`, so nothing here runs on a parallel
// timer that can drift out of step with the dip it is supposed to be
// illustrating. The presentation half (vignette / FOV / audio muffle) lives in
// effects/slowmo-presentation.ts, which is the single owner of those three.
//
// Ticked in REAL time, like the other time-scale contributors, so the ceremony
// is never slowed by its own slow motion.

const C = () => CONFIG.EXECUTE.CEREMONY;

let elapsed = Infinity;   // real-seconds since the hush opened (∞ = idle)

/** Open the ceremony. Called from the strike path on a finisher that KILLED,
 *  with the victim's position so the sting lands where the body did. */
export function triggerFinisher(at?: Vec3Sound): void {
  elapsed = 0;
  playFinisher(at);
}

/** True while the hush is open — for anything that wants to know. */
export function isFinisherActive(): boolean {
  return elapsed < C().DURATION_S;
}

/**
 * 0 → 1 "how deep is the hush right now" — 1 at the held floor, easing to 0 as
 * it releases. Derived from the time scale rather than kept alongside it, so a
 * cue driven by this can never disagree with the world it is dressing.
 */
export function finisherIntensity(): number {
  const s = C().WORLD_SCALE;
  return (1 - finisherWorldTimeScale()) / (1 - s);
}

/**
 * The WORLD time-scale contribution (1 = no effect). Multiplied into scaledDt
 * and fxDt by the frame loop and NOT into playerDt — that omission is the
 * asymmetry, and it is the reason a finisher feels like a flex rather than a
 * pause.
 */
export function finisherWorldTimeScale(): number {
  const { DURATION_S: dur, WORLD_SCALE: s, HOLD_FRAC: hold } = C();
  if (elapsed >= dur) return 1;
  const t = elapsed / dur;                  // 0 → 1 across the window
  // HOLD deep for the first `hold` of the window so the slow motion actually
  // READS (a plain linear ramp spends the deep part in a single frame — the
  // lesson bullet-time already learned), THEN release, quadratically, so the
  // snap back accelerates into full speed instead of sliding into it.
  if (t <= hold) return s;
  const r = (t - hold) / (1 - hold);
  return s + (1 - s) * (r * r);
}

/**
 * Advance the hush in REAL time.
 *
 * Held off while the world is frozen, so the hit-pause and the hush are two
 * beats and not one: the crack lands, THEN time thickens. Without this the
 * freeze would eat ~20% of the window before the player ever saw it move.
 */
export function tickFinisher(realDt: number): void {
  if (elapsed >= C().DURATION_S) return;
  if (isFrozen()) return;
  elapsed += realDt;
}

/** Floor load / death / run start — clear it. */
export function resetFinisher(): void {
  elapsed = Infinity;
}
// sim-state: an in-flight hush must not survive into the next floor.
registerSimReset(resetFinisher);
