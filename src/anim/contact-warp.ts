import type { Clip } from './types';

// ONE CLOCK for a mob's attack — the fix for the measured drift between when a
// mob's weapon VISIBLY arrives and when it actually damages you.
//
// THE BUG THIS EXISTS FOR. An ability's phases are real seconds
// (`windup / strike / recover`) and damage lands inside the STRIKE window, but
// its animation is a normalized clip stretched across the TOTAL. The two are
// pinned to different things, so their alignment is an accident of each mob's
// phase ratios. Measured 2026-08-12 across every mob attack clip in the game —
// the gap between the clip's SNAP keyframe and the real damage instant:
//
//   ghoul/rake +34ms · skeleton/chop +92ms · skirmisher/thrust +161ms
//   defiler/sweep +166ms · stoneguard/pound +197ms
//
// Every one positive: the damage always landed BEFORE the limb arrived. On the
// stoneguard you were hit roughly a fifth of a second before the maul finished
// coming down. Nobody chose those numbers; they fell out of arithmetic, and
// retuning any mob's windup silently moved its visual hit.
//
// THE FIX. Rather than rewrite every clip, warp clip TIME so the clip's contact
// keyframe lands exactly on the mechanical damage instant. Piecewise-linear:
// the wind-up half compresses or stretches to reach contact on time, then the
// follow-through half fills the rest. Authored poses keep their shape and their
// relative ordering; only the rate changes either side of the hit.
//
// This is the cheap version of "one clock" from COMBAT-CHARTER.md Idea 1 — it
// makes the visual and the mechanical agree by construction, with zero
// re-authoring, and it survives any future retune of the phase durations.

/** Where in a clip the HIT reads — normalized 0..1.
 *
 *  Explicit `clip.contactAt` wins. Otherwise we infer it from the authoring
 *  convention in clips-mobs.ts: the keyframe tagged `easeInCubic` is the SNAP
 *  (the limb accelerating into the blow), which is precisely the frame the eye
 *  reads as impact. Returns null when a clip has no identifiable contact — a
 *  cast, an idle, anything that isn't a strike — and such clips are left
 *  unwarped rather than guessed at. */
export function clipContactAt(clip: Clip): number | null {
  if (typeof clip.contactAt === 'number') {
    return Math.max(0, Math.min(1, clip.contactAt));
  }
  const snap = clip.keyframes.find((k) => k.ease === 'easeInCubic');
  return snap ? Math.max(0, Math.min(1, snap.t)) : null;
}

/**
 * Remap playback progress so the clip's contact frame lands on the mechanical
 * one.
 *
 * `p` is real progress through the ability window (0..1). `clipContact` is where
 * the hit reads in the clip; `mechContact` is where the damage actually fires in
 * the window. Returns the clip time to sample.
 *
 * Both halves stay monotonic, so the animation never stutters or runs backward.
 * Degenerate inputs (contact at exactly 0 or 1) fall through to the identity
 * mapping rather than dividing by zero — an unwarped clip is a small visual
 * imprecision; a NaN pose is a mob folded inside out.
 */
export function warpToContact(p: number, clipContact: number, mechContact: number): number {
  const t = Math.max(0, Math.min(1, p));
  const c = clipContact;
  const m = mechContact;
  if (!(c > 0 && c < 1) || !(m > 0 && m < 1)) return t;
  if (t <= m) return (t / m) * c;
  return c + ((t - m) / (1 - m)) * (1 - c);
}

/**
 * Where the mechanical hit falls in an ability's window, as a fraction of the
 * whole — `windup + strike * contactFrac`, over the total.
 *
 * Takes the LIVE windup (rolled per-cast with ±22% jitter), not the spec value,
 * so a jittered telegraph still lands its visual hit on its real one.
 *
 * Returns null when the window is degenerate. Callers should also skip the warp
 * for abilities whose contact isn't time-based at all — a `dash` connects when
 * it physically reaches you, so there is no fixed instant to align to, and
 * pretending otherwise would warp the animation toward a lie.
 */
export function mechanicalContactFrac(
  windup: number, strike: number, recover: number, contactFrac: number,
): number | null {
  const total = windup + strike + recover;
  if (!(total > 0)) return null;
  return (windup + strike * contactFrac) / total;
}
