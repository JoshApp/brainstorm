// The blast damage curve, alone in a file with no Three.js, no audio context
// and no DOM — so it can be imported by a headless test (and by an audit tool)
// without dragging a renderer in behind it. radial-blast.ts owns the effect;
// this owns the arithmetic.
//
// Why falloff exists at all: a flat-damage radius punishes the rim exactly as
// hard as the centre, so there is nothing to play against — you are either in
// or out, and "in" is unsurvivable. With falloff, clipping the edge is a
// survivable mistake and diving the middle is the real one.

/** Damage multiplier at `distance` from a blast centre — 1 at the centre,
 *  falling linearly to `rimDamageFrac` at the rim, 0 beyond it. */
export function blastDamageScale(distance: number, radius: number, rimDamageFrac = 0.45): number {
  if (distance > radius) return 0;
  if (rimDamageFrac >= 1) return 1;
  const t = Math.min(1, radius > 0 ? distance / radius : 1);
  return 1 + (rimDamageFrac - 1) * t;
}
