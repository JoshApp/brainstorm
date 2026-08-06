// WHERE DOES A MODEL'S MASS SIT, RELATIVE TO THE FRONT IT CLAIMS?
//
// Every placer in this game assumes a model's front is its local −Z. That
// assumption is invisible: a model authored facing +X is rotated as though −Z
// were its face, lands sideways, and reads as somebody having placed it badly.
// The information lives in the author's head and nowhere the renderer can read.
//
// `ModelSpec.mount.forward` is where a model says otherwise. This is the check
// that a declaration — or the absence of one — matches the geometry.
//
// PURE, and separate from the script that prints it, for the reason
// docs/DESIGN-METHOD.md gives: an audit tool must import the real function. The
// classifier and its test are the same code, so a test that passes is evidence
// about the thing that ships rather than about a copy of it.

/** The subset of a part this needs. Structural, so any ModelSpec part fits. */
export interface FacingPart {
  pos?: readonly [number, number, number];
  size?: readonly [number, number, number];
  radius?: number;
  height?: number;
}

export interface FacingSubject {
  parts: readonly FacingPart[];
  /** What the model claims. Absent means the −Z every placer assumes. */
  forward?: 'x' | '-x' | 'z' | '-z';
}

export type FacingVerdict =
  /** Mass sits where the declared front says it should. */
  | 'ok'
  /** Mass sits BEHIND the declared front — the model faces the other way, or
   *  it needs an explicit `forward`. */
  | 'BACKWARD'
  /** No meaningful depth: a decal, a glow, a scratch on a wall. It has no front
   *  to be wrong about. */
  | 'thin';

export interface FacingReport {
  verdict: FacingVerdict;
  /** Volume-weighted centroid, model-local. */
  cx: number; cz: number;
  /** Bounding extents. */
  depth: number; width: number;
}

/**
 * Below this depth a model is a flat thing that lives ON a surface.
 *
 * Depth ALONE decides it. Requiring both depth AND width to be small classed a
 * 4cm-deep, 26cm-wide wall gouge as a solid, then flagged it for having its
 * negligible mass six tenths of its negligible depth to one side. One false
 * positive in a detector this small is enough to teach you to ignore it.
 */
const THIN_DEPTH = 0.08;
/** How far off centre the mass must sit, as a share of the model's own size,
 *  before it counts. A wall bracket whose arm reaches back is EXPECTED to lean
 *  backward, so the bar is a large fraction rather than any offset at all. */
const OFFSET_SHARE = 0.28;
// THERE IS NO 'SIDEWAYS' CHECK, AND THAT IS A DELIBERATE DELETION.
//
// The obvious second heuristic is "far wider than it is deep, with its mass off
// the centre line — so it was probably authored across X". It reads well and it
// cannot work: a bench, a counter, a sarcophagus and a market stall are all
// wide, off-centre and CORRECTLY facing −Z. Width is not evidence of anything.
//
// Tried, and it split the difference badly — a stall with its keeper 0.9m off a
// 2.4m counter sat just under the threshold, so the rule was one fixture-tweak
// away from either missing real cases or flagging every bench in the game. A
// check that cannot separate "wide" from "mis-authored" is a check that trains
// you to ignore its output, which is worse than not having it.
//
// Mass behind the declared front is the one signal that means only one thing.

function extent(p: FacingPart): [number, number, number] {
  if (p.size) return [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  const r = p.radius ?? 0.05;
  const h = (p.height ?? r * 2) / 2;
  return [r, h, r];
}

/** Rough volume, so a slab outweighs a decorative pin. */
function volume(p: FacingPart): number {
  const [x, y, z] = extent(p);
  return Math.max(1e-6, x * y * z);
}

/** Measure a model against the front it claims. Never throws; a model with no
 *  parts comes back 'thin', which is the honest answer for nothing. */
export function classifyFacing(m: FacingSubject): FacingReport {
  let vol = 0, cx = 0, cz = 0;
  let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const p of m.parts) {
    const v = volume(p);
    const [ex, , ez] = extent(p);
    const px = p.pos?.[0] ?? 0, pz = p.pos?.[2] ?? 0;
    vol += v; cx += px * v; cz += pz * v;
    minZ = Math.min(minZ, pz - ez); maxZ = Math.max(maxZ, pz + ez);
    minX = Math.min(minX, px - ex); maxX = Math.max(maxX, px + ex);
  }
  if (vol <= 0 || m.parts.length === 0) {
    return { verdict: 'thin', cx: 0, cz: 0, depth: 0, width: 0 };
  }
  cx /= vol; cz /= vol;
  const depth = maxZ - minZ, width = maxX - minX;
  if (depth < THIN_DEPTH) return { verdict: 'thin', cx, cz, depth, width };

  const fwd = m.forward ?? '-z';
  const behind =
      fwd === '-z' ? cz > depth * OFFSET_SHARE
    : fwd === 'z'  ? cz < -depth * OFFSET_SHARE
    : fwd === '-x' ? cx > width * OFFSET_SHARE
    :                cx < -width * OFFSET_SHARE;
  if (behind) return { verdict: 'BACKWARD', cx, cz, depth, width };
  return { verdict: 'ok', cx, cz, depth, width };
}
