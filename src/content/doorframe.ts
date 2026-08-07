import type { ModelSpec, PartSpec } from '../ecs/model-types';
import { revealDepthFor, DEFAULT_WALL_DEPTH } from './frame-depth';
import { coursedPanel } from './frame-coursing';

// Doorframe — the LIGHT cousin of the corridor archway (content/archway.ts).
// Where the archway is an ornate gate for wide corridor mouths (columns with
// plinths + capitals + keystone), the doorframe is a plain stone surround for
// a NARROW opening: a doorway punched through an interior wall divider, a
// sealed door, a cobweb-gated choke.
//
// Why it exists: an opening carved in a thin wall shows the wall's bare
// cross-section — a flat "paper" edge orthogonal to the passage. The frame
// hides that edge: slim jambs give the opening visible depth, a lintel caps
// it, and a fill block closes the void above (the door cell is floor, so the
// divider wall has a full-height GAP there that would otherwise reveal the
// dark behind the wall).
//
// Authoring axes (same convention as archway.ts):
//   - +X = along the lintel (the opening's running direction / the wall line)
//   - +Y = up
//   - +Z = INTO the passage (through the gate)
// The placer sets rotY so +X aligns with the wall the opening sits in.
//
// Collision blockers match the posts and sit OUTSIDE the opening, so they can
// never pinch the walk band — see the note above `doorframeCollision`. Emission
// sites attach `collision: doorframeCollision(width)` so the geometry and the
// blockers come from the same constants and can't drift.

export interface DoorframeOptions {
  /** Width of the opening this frames, in metres. The posts flank it — the
   *  whole width stays walkable. Default 1.0 (a single-cell doorway). */
  width?: number;
  /** Ceiling height of the surrounding room — the fill block rises from
   *  the lintel top to here so no void peeks above. Default 3.2m. */
  ceilingHeight?: number;
  /** Interior height of the passage behind the frame. When lower than
   *  the default lintel line the frame compresses so the lintel
   *  overlaps the passage ceiling — no void slit above a low tunnel's
   *  ceiling (same fix as ArchwayOptions.openHeight). */
  openHeight?: number;
  /** Thickness of the wall this frame is set into, in metres. The stone fill
   *  above the head is sized from it — see content/frame-depth.ts. `WALL_T`
   *  (0.25) for a polygon room; 0 for a rect room's plane. */
  wallDepth?: number;
}

const JAMB_HALF_THICK = 0.09;     // half the jamb's size along the wall (X)
const JAMB_DEPTH      = 0.55;     // depth along the passage (Z) — gives mass
const LINTEL_BOTTOM   = 2.60;     // clear opening height (a door is 2.6 tall)
const LINTEL_HEIGHT   = 0.24;
const LINTEL_DEPTH    = 0.60;
const LINTEL_OVERHANG = 0.08;     // lintel extends past the jambs each side
/** How far the knee brace runs down the post and in along the head. Keep it
 *  well above head height — the collision contract knows nothing about it. */
const BRACE_RUN       = 0.30;

// ── THE WALL ABOVE THE HEAD ──────────────────────────────────────────────────
/** Fraction of the reveal the void-proof backing plate takes. The coursing in
 *  front of it is full depth, so every laid stone stands proud of it and a
 *  DROPPED one reads as a recess rather than as a hole. */
const FILL_BACK       = 0.62;
/** Rise of the relieving arch over the timber head. Shallow on purpose — the
 *  point is one curved line, not a second gate. */
const RELIEF_RISE     = 0.14;
const RELIEF_H        = 0.17;   // radial thickness of its blocks
const RELIEF_BLOCKS   = 5;
/** Fraction of the coursed face missing above a shored doorway. Higher than a
 *  sound wall's: this is the bit nobody could reach to repoint. */
const FILL_GAPS       = 0.16;

const LINTEL_TOP = LINTEL_BOTTOM + LINTEL_HEIGHT;

// ── THE POSTS STAND BESIDE THE HOLE, NOT IN IT ───────────────────────────────
//
// This used to be width-gated: a wide opening put its jambs INSIDE the gap with
// their outer faces flush to the edges, and only a narrow one flanked it. The
// gate was about collision — wide frames could "spare the room" for blockers.
//
// They could not. Measured over 240 floors: EVERY doorframe the generator
// places is between 1.6m and the 2.0m archway threshold, so every one of the
// 812 of them was on the inside branch, and every one ate 0.36m of the way
// through. A 1.7m squeeze corridor arrived at its doorway as 1.34m — which is
// Josh's *"they might be too narrow"*, and it was the frames, not the floor.
//
// A frame surrounds a hole. Both thresholds now say so (see the same note in
// archway.ts), which is one rule where there were two, and the whole opening is
// yours to walk through at every width.
//
// The blockers stay, because the posts still project into the room along Z and
// you can walk into one from the side — they just sit OUTSIDE the gap now,
// where the stone actually is.

/** Walk-blockers matching the doorframe's posts. They flank the opening rather
 *  than narrowing it, so they never pinch the walk band. Attach as the
 *  `collision` of the same prop that renders the model. */
export function doorframeCollision(
  width: number,
): import('../level/types').PropCollision[] | undefined {
  const jambOffset = width / 2 + JAMB_HALF_THICK;
  return [
    { kind: 'aabb', halfW: JAMB_HALF_THICK, halfD: JAMB_DEPTH / 2, ox: -jambOffset, oz: 0 },
    { kind: 'aabb', halfW: JAMB_HALF_THICK, halfD: JAMB_DEPTH / 2, ox: jambOffset, oz: 0 },
  ];
}

/** Half of the passable band through a doorframe — the whole opening, since
 *  nothing stands in it. The NavGate half-width pathfinding funnels through. */
export function doorframePassableHalfBand(width: number): number {
  return width / 2;
}

export function doorframe(opts: DoorframeOptions = {}): ModelSpec {
  const width = opts.width ?? 1.0;
  const ceiling = opts.ceilingHeight ?? 3.2;
  // The posts flank the opening at every width — inner face flush with the
  // edge — so the visual and the blockers agree and neither narrows the gap.
  const jambOffset = width / 2 + JAMB_HALF_THICK;
  const lintelWidth = width + JAMB_HALF_THICK * 4 + LINTEL_OVERHANG * 2;
  const lintelBottom = opts.openHeight !== undefined
    ? Math.min(LINTEL_BOTTOM, opts.openHeight - 0.10)
    : LINTEL_BOTTOM;
  const lintelTop = lintelBottom + LINTEL_HEIGHT;
  const fillDepth = revealDepthFor(opts.wallDepth ?? DEFAULT_WALL_DEPTH);
  const fillHeight = Math.max(0.1, ceiling - lintelTop);
  const fillCentreY = lintelTop + fillHeight / 2;

  const id = `doorframe2-w${width.toFixed(2)}-c${ceiling.toFixed(1)}-o${lintelBottom.toFixed(2)}-r${fillDepth.toFixed(2)}`;

  const parts: PartSpec[] = [];
  const postInner = jambOffset - JAMB_HALF_THICK;

  for (const side of [-1, 1] as const) {
    const x = side * jambOffset;
    // A post is TWO timbers with an iron band at the splice, not one extrusion.
    // The splice is the only thing that tells you which way is up on a plain
    // vertical box, and it costs one extra part.
    const spliceY = lintelBottom * 0.46;
    parts.push({
      kind: 'box', name: 'post-lower',
      pos: [x, spliceY / 2, 0],
      size: [JAMB_HALF_THICK * 2, spliceY, JAMB_DEPTH], mat: 'timber',
    } as PartSpec);
    parts.push({
      kind: 'box', name: 'post-upper',
      pos: [x, spliceY + (lintelBottom - spliceY) / 2, 0],
      // Slightly slimmer above the splice: a shored post is whatever timber
      // was to hand, and two identical halves read as one box again.
      size: [JAMB_HALF_THICK * 1.82, lintelBottom - spliceY, JAMB_DEPTH * 0.92], mat: 'timber',
    } as PartSpec);
    parts.push({
      kind: 'box', name: 'band',
      pos: [x, spliceY, 0],
      size: [JAMB_HALF_THICK * 2.3, 0.075, JAMB_DEPTH + 0.05], mat: 'iron',
    } as PartSpec);
    // Foot plate — keeps the timber out of the wet, and gives the post a base
    // so it doesn't grow out of the floor.
    parts.push({
      kind: 'box', name: 'foot',
      pos: [x, 0.05, 0],
      size: [JAMB_HALF_THICK * 2.6, 0.10, JAMB_DEPTH + 0.08], mat: 'iron',
    } as PartSpec);
  }

  // ── THE HEAD, DOUBLED ──────────────────────────────────────────────
  // A single beam is a slab. Two, the upper one longer and set back, reads as
  // carpentry — and the step between them is the one horizontal line in the
  // silhouette that catches a lamp from below.
  parts.push({
    kind: 'box', name: 'head',
    pos: [0, lintelBottom + LINTEL_HEIGHT * 0.32, 0],
    size: [lintelWidth, LINTEL_HEIGHT * 0.64, LINTEL_DEPTH], mat: 'timber',
  } as PartSpec);
  parts.push({
    kind: 'box', name: 'head-cap',
    pos: [0, lintelBottom + LINTEL_HEIGHT * 0.82, 0],
    size: [lintelWidth + 0.16, LINTEL_HEIGHT * 0.36, LINTEL_DEPTH * 0.78], mat: 'timber',
  } as PartSpec);

  // ── ONE KNEE BRACE, NOT TWO ────────────────────────────────────────
  //
  // The diagonal is the whole point: it is the only line in this dungeon that
  // is neither vertical nor horizontal, so a shored doorway is recognisable at
  // a distance no stone arch can match. It sits high — its lowest point is
  // BRACE_RUN below the head — so it never reaches the band a player or a mob
  // walks through, and the collision contract is untouched.
  //
  // And there is only ONE. The other rotted, or somebody took it. A frame with
  // a matched pair is a frame somebody is still maintaining, and nobody has
  // maintained anything down here for a long time.
  const braceLen = BRACE_RUN * Math.SQRT2;
  parts.push({
    kind: 'box', name: 'brace',
    pos: [postInner - BRACE_RUN / 2, lintelBottom - BRACE_RUN / 2, 0],
    rot: [0, 0, Math.PI / 4],
    size: [0.075, braceLen, JAMB_DEPTH * 0.7], mat: 'timber',
  } as PartSpec);
  // The stub of the one that went, still bolted to the post opposite.
  parts.push({
    kind: 'box', name: 'brace-stub',
    pos: [-(postInner - 0.05), lintelBottom - BRACE_RUN + 0.05, 0],
    rot: [0, 0, -Math.PI / 4],
    size: [0.075, 0.14, JAMB_DEPTH * 0.7], mat: 'timber',
  } as PartSpec);

  // ── WHAT CARRIES THE WALL OVER THE HEAD ────────────────────────────
  //
  // The backing plate closes the full-height gap the wall ring leaves at a
  // doorway; the relieving arch and the coursing in front of it are what you
  // actually look at. See content/frame-coursing.ts for the whole note.
  //
  // THE RELIEVING ARCH is what a mason builds over a timber head, because a
  // beam cannot carry a wall. Five blocks on a shallow segmental curve,
  // springing off the ends of the head. It is the only curve in an otherwise
  // square frame, which is the read at a distance.
  parts.push({
    kind: 'box', name: 'fill',
    pos: [0, fillCentreY, 0],
    size: [lintelWidth, fillHeight, fillDepth * FILL_BACK], mat: 'stone',
  } as PartSpec);

  // Only when there is wall to carry. In a low room the head is nearly at the
  // ceiling and the backing is the whole story.
  let coursesFrom = lintelTop;
  if (fillHeight >= RELIEF_RISE + RELIEF_H + 0.06) {
    const s = (lintelWidth * 0.74) / 2;
    const R = (s * s + RELIEF_RISE * RELIEF_RISE) / (2 * RELIEF_RISE);
    const centreY = lintelTop + RELIEF_RISE - R;
    const half = Math.atan2(s, R - RELIEF_RISE);
    const step = (2 * half) / RELIEF_BLOCKS;
    const rho = R + RELIEF_H / 2;
    for (let i = 0; i < RELIEF_BLOCKS; i++) {
      const theta = -half + (i + 0.5) * step;
      parts.push({
        kind: 'box', name: `relief-${i}`,
        pos: [rho * Math.sin(theta), centreY + rho * Math.cos(theta), 0],
        // Same sign convention as the archway's ring: −theta about Z swings an
        // unrotated box (local +Y radially out at theta = 0) round the arc.
        rot: [0, 0, -theta],
        size: [R * step * 1.08, RELIEF_H, fillDepth], mat: 'stone',
      } as PartSpec);
    }
    coursesFrom = lintelTop + RELIEF_RISE + RELIEF_H;
  }

  parts.push(...coursedPanel({
    width: lintelWidth, baseY: coursesFrom, topY: ceiling,
    depth: fillDepth, mat: 'stone', prefix: 'fillcourse', gaps: FILL_GAPS,
  }));

  return {
    id,
    materials: {
      stone: { color: 0x231d16, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
      // The frame itself. Warmer and lighter than the wall behind it, because
      // the point of this threshold is that it is NOT the architecture — it is
      // a prop somebody wedged into a hole in the architecture. That read is
      // what keeps it distinct from the stone archway rather than being a
      // smaller version of one.
      timber: { color: 0x3a2c1e, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
      // Bands, straps and foot plates carry the proximity glow — so nearing a
      // doorway lights the IRON, not the whole frame. Same 'glow' contract as
      // the archway (emissive 0 at rest; see the builder's proximityGlow
      // handling), a different shape saying it.
      iron: { color: 0x2b2a28, roughness: 0.85, metalness: 0.25, flatShading: true, emissive: 0xc05a18, emissiveIntensity: 0, detail: 'dressed' },
    },
    parts,
    // Eye mount points on the HEAD's front/back faces — same contract as the
    // archway (a doorframe is the narrow-mouth / stair-mouth variant, so it
    // needs the nav eye too). Without these, only wide-mouth archways got eyes.
    slots: {
      eye_front: { pos: [0, lintelBottom + LINTEL_HEIGHT / 2, LINTEL_DEPTH / 2 + 0.01] },
      eye_back: { pos: [0, lintelBottom + LINTEL_HEIGHT / 2, -(LINTEL_DEPTH / 2 + 0.01)], rot: [0, Math.PI, 0] },
    },
  };
}
