// ── HOW A WEAPON IS HELD, AS DATA ────────────────────────────────────────────
//
// The last piece of the v3 grip. The solver (anim/grip-solver.ts) can close a hand onto a
// cylinder; this is where a weapon says WHICH cylinder, WHERE along it, and WHAT KIND of grip —
// so a content author can hold a new weapon correctly without touching a line of geometry code.
//
// Before this, the answer was sniffed: scan the weapon's parts for one named `grip` or `haft`
// and take its radius. That is a guess wearing a measurement's clothes, and it has no opinion at
// all about the two things that actually differ between weapons:
//
//   · WHERE along the haft the hand sits. The spear's haft is 0.40m long and was being gripped
//     at its exact centre, because the centre is all a radius sniff knows about.
//   · WHAT the grip IS. A war maul, a sabre and a quarterstaff are not held the same way, and
//     the wrist does not leave the hand at the same angle for any two of them.
//
// ── THE KNOBS ARE FEW ON PURPOSE ────────────────────────────────────────────
//
// Every field here earns its place by changing something visible that nothing else can express.
// A grip style is a NAME for a bundle of those, so content says `style: 'staff'` rather than
// four numbers — and a weapon that wants one number different overrides just that one.

import * as THREE from 'three';
import type { GripSpec, GripStyle, ModelSpec } from '../ecs/model-types';
import { FOREARM_EXIT_DESIRED } from './hand';

/** What the THUMB does. The one finger whose job changes between grips. */
export type ThumbMode =
  /** Wraps the hilt to meet the fingers — a closed fist. */
  | 'wrap'
  /** Rides ALONG the grip, pointing at the blade. A thrust and hammer grip, and it reads as
   *  intent: the thumb aimed down the weapon is a person about to push it somewhere. */
  | 'along';

export type { GripSpec, GripStyle };

/** A grip with every question answered — what the solver and the composer consume. */
export interface ResolvedGrip {
  style: GripStyle;
  radius: number;
  /** Weapon-local offset that walks the hand along the grip so it lands where `along` says.
   *  A VECTOR, not a distance along +Y: the spear's shaft runs along -Z (its cylinders carry
   *  rot [pi/2, 0, 0]), so "slide along the weapon's up axis" is wrong for half the roster. The
   *  direction is read off the grip cylinder's own orientation. */
  offset: [number, number, number];
  roll: number;
  thumb: ThumbMode;
  /** Where the forearm should leave the wrist, hand-frame. Belongs to the GRIP, not the hand:
   *  a hammer wrist and a sabre wrist differ, and that difference is a fact about what you are
   *  holding. content/hand.ts keeps the sabre value as the baseline. */
  forearmExit: [number, number, number];
}

const rad = (deg: number): number => Math.tan((deg * Math.PI) / 180);

/**
 * The styles.
 *
 * `saber` is the baseline and is deliberately identical to the pre-v3 behaviour, so every weapon
 * that declares nothing keeps the grip it already had and this file changes no existing feel.
 */
/** A style names the parts of a grip that are not derived from the weapon's own geometry. */
type Style = Pick<ResolvedGrip, 'roll' | 'thumb' | 'forearmExit'> & { along: number };

const STYLES: Record<GripStyle, Style> = {
  // A cut-and-thrust grip: hand centred on the hilt, thumb wrapped, relaxed wrist.
  saber: { along: 0.5, roll: 0, thumb: 'wrap', forearmExit: FOREARM_EXIT_DESIRED },
  // Hafted and heavy. The hand sits low toward the pommel for leverage, and the wrist is
  // straighter — you do not cock a maul, you drop it.
  hammer: { along: 0.35, roll: 0, thumb: 'wrap', forearmExit: [rad(-2), -1, rad(6)] },
  // Polearms. Held well down the shaft, thumb along it: the grip that aims a thrust.
  staff: { along: 0.22, roll: 0, thumb: 'along', forearmExit: [rad(-8), -1, rad(20)] },
  // Turned over — blade down past the little finger.
  reverse: { along: 0.5, roll: Math.PI, thumb: 'wrap', forearmExit: FOREARM_EXIT_DESIRED },
};

/** Fallback when a weapon names no grip cylinder. The authored sabre hilt. */
const BASELINE_RADIUS = 0.022;

/**
 * The grip cylinder a weapon is held by: the first part named `grip` or `haft`.
 *
 * Returns its AXIS too, taken from the part's own rotation. A primitive cylinder runs along its
 * local +Y, so an unrotated hilt gives +Y — but the spear's shaft is authored along -Z with
 * rot [pi/2, 0, 0], and assuming +Y would slide the hand sideways off the shaft.
 */
function gripCylinder(
  spec: ModelSpec,
): { radius: number; height: number; axis: THREE.Vector3 } | null {
  for (const part of spec.parts) {
    if (part.name !== 'grip' && part.name !== 'haft') continue;
    if (part.kind === 'cylinder' || part.kind === 'cone' || part.kind === 'capsule') {
      const r = part.rot ?? [0, 0, 0];
      const axis = new THREE.Vector3(0, 1, 0)
        .applyEuler(new THREE.Euler(r[0], r[1], r[2])).normalize();
      return { radius: part.radius, height: 'height' in part ? part.height : 0, axis };
    }
  }
  return null;
}

/**
 * Everything the hand needs to know about holding this weapon.
 *
 * Authored `grip` wins, then the style's defaults, then the weapon's own geometry.
 */
export function resolveGrip(spec: ModelSpec): ResolvedGrip {
  const g = spec.grip ?? {};
  const style = g.style ?? 'saber';
  const s = STYLES[style];
  const cyl = gripCylinder(spec);
  const along = g.along ?? s.along;
  return {
    style,
    radius: g.radius ?? cyl?.radius ?? BASELINE_RADIUS,
    // Measured from the cylinder's centre, so `along: 0.5` is no shift and every weapon that
    // declares nothing sits exactly where it always did.
    offset: cyl
      ? (cyl.axis.clone().multiplyScalar((along - 0.5) * cyl.height).toArray() as
        [number, number, number])
      : [0, 0, 0],
    roll: g.roll ?? s.roll,
    thumb: s.thumb,
    forearmExit: s.forearmExit,
  };
}
