import type { ModelSpec, PartSpec } from '../ecs/model-types';
import { revealDepthFor, DEFAULT_WALL_DEPTH } from './frame-depth';
import { coursedPanel } from './frame-coursing';

// The POSTERN — the narrow threshold, for openings below the archway's 2.0m.
//
// ── WHY IT WAS REBUILT ───────────────────────────────────────────────────────
//
// Josh, comparing the two doorways on his phone: *"the massive stone one looks
// way better than the legacy one — can you remake that one to look awesome?"*
//
// He was right, and the bench says exactly why
// (`delve bench model-doorframe-tall --ortho` against `model-archway-tall`).
// This was a TIMBER frame: two 0.18m posts, an iron band, a doubled head and
// one knee brace, carrying a coursed stone panel a median 2m tall. The posts
// are a fifth the thickness of the mass above them, so the silhouette read as a
// trestle table with a wall balanced on it. Beside a real gate it looked like
// scaffolding somebody left behind.
//
// Two things made it worse than the sum of its parts:
//
//   THE ONE CURVE NEVER FIRED. The relieving arch was the model's only
//   non-square line, and it was gated on `fillHeight >= 0.37`. At the game's
//   most common ceiling (3.2m) the fill is 0.36m — so the common case was posts
//   and a beam, and the curve only appeared in tall rooms.
//
//   THE MATERIAL FOUGHT THE ROOM. Brown timber against dark dressed stone, in a
//   palette built on restraint. The old file argued the contrast was the point
//   — *"it is NOT the architecture, it is a prop somebody wedged into a hole"*.
//   That is a good idea and it is not what a doorway wants to be: every one of
//   these is a way through, and the way through should read as built.
//
// ── WHAT IT IS NOW, AND HOW IT STAYS DISTINCT ────────────────────────────────
//
// The same masonry family as content/archway.ts — voussoir ring, keystone,
// coursed jambs, glow on the ring alone — at the scale a narrow opening wants.
// The distinction between the two thresholds is no longer material, it is the
// CURVE, and it falls out of the geometry rather than being decided:
//
//   the wide gate is SEGMENTAL, because it must be. A round arch's rise is half
//   its span, so a 3.5m mouth would crown 1.75m above the springing and punch
//   through the room's ceiling.
//
//   the postern is ROUND, because it can be. At 1.0-2.0m the rise is 0.5-1.0m,
//   which fits under the springing line with room to spare — so a narrow
//   doorway gets the full semicircle a mason would actually turn over it.
//
// A half-circle beside a shallow segment reads as two different doors at a
// glance, in the dark, at lamp range. It degrades gracefully too: under a low
// corridor ceiling the rise shrinks and the arch goes segmental on its own,
// which is the same cap `archway.ts` applies for the same reason.
//
// Authoring axes (same convention as archway.ts):
//   - +X = along the lintel (the opening's running direction / the wall line)
//   - +Y = up
//   - +Z = INTO the passage (through the gate)
// The placer sets rotY so +X aligns with the wall the opening sits in.

export interface DoorframeOptions {
  /** Width of the opening this frames, in metres. The jambs flank it — the
   *  whole width stays walkable. Default 1.0 (a single-cell doorway). */
  width?: number;
  /** Ceiling height of the surrounding room — the fill rises from the springing
   *  line to here so no void peeks above. Default 3.2m. */
  ceilingHeight?: number;
  /** Interior height of the passage BEHIND the frame (the corridor's ceiling).
   *  The crown must not rise above it, or the bore shows a slit of void over the
   *  passage — the springing sinks and the rise shrinks until it clears. */
  openHeight?: number;
  /** Thickness of the wall this frame is set into, in metres. Every depth is
   *  derived from it — see content/frame-depth.ts. `WALL_T` (0.25) for a polygon
   *  room; 0 for a rect room's plane. */
  wallDepth?: number;
}

/**
 * Half the jamb's size along the wall (X).
 *
 * WAS 0.09, WHICH IS THE WHOLE PROPORTION BUG. A jamb that slim under two
 * metres of coursed wall is a table leg. This is close to the archway's 0.16 —
 * a postern is a SMALLER gate, not a flimsier one, and the stone over it weighs
 * the same either way.
 */
const JAMB_HALF_THICK = 0.14;
/** Depth along the passage (Z) used by the COLLISION blockers only. The visual
 *  depth comes from the reveal (`depths` below); this stays a constant because
 *  `doorframeCollision` is called without a wall thickness and has nothing to
 *  derive it from. Unchanged from the timber frame, so the physics contract the
 *  nav grid was tuned against does not move. */
const JAMB_DEPTH      = 0.55;
const BASE_HEIGHT     = 0.24;
const BASE_OVERHANG   = 0.06;      // plinth extends this far past the jamb each side
const IMPOST_HEIGHT   = 0.14;      // the block the arch springs from
const IMPOST_OVERHANG = 0.065;
const COURSES         = 2;         // shaft blocks between plinth and impost

/** Where the arch springs from, unobstructed. Sinks under a low `openHeight`. */
const SPRING_Y        = 2.05;
const SPRING_MIN      = 1.72;      // below this you would duck through
/** Never let the curve flatten into a line — below this it reads as a lintel
 *  with a kink and the whole distinction from the wide gate is lost. */
const MIN_RISE        = 0.20;
/** Voussoir count. Odd, so one sits dead centre and IS the keystone. Fewer than
 *  the archway's 7: the same block count round a shorter arc gives slivers. */
const VOUSSOIRS       = 5;
const VOUSSOIR_RADIAL = 0.17;      // ring thickness
const KEYSTONE_RADIAL = 0.30;
const LINTEL_OVERHANG = 0.09;      // fill extends past the opening each side
/** Fraction of the coursed face missing above the gate. This is the bit nobody
 *  could reach to repoint. */
const FILL_GAPS       = 0.16;

// NO BEVELS — the measurement is in archway.ts. A chamfer swaps every block for
// a RoundedBoxGeometry and a floor's doorways went 18ms → 128ms of build.

/**
 * Openings are snapped to this grid before ANY geometry is derived from them.
 *
 * The arch costs a CSG, and a CSG is 27ms. Snapping makes posterns REPEAT so the
 * memo below returns the same spec object and the builder's CSG cache (a WeakMap
 * keyed on the part) can hit. Same reasoning, same step, as archway.ts — and the
 * collision offset snaps with it, so the stone and the blockers cannot drift.
 */
const WIDTH_STEP = 0.10;
const snap = (v: number, step: number): number => Math.round(v / step) * step;

// ── THE JAMBS STAND BESIDE THE HOLE, NOT IN IT ───────────────────────────────
//
// Kept exactly as the timber frame had it, because it was hard-won. Measured
// over 240 floors: every doorframe the generator places is between 1.6m and the
// 2.0m archway threshold, and when the jambs sat INSIDE the opening every one of
// the 812 of them ate 0.36m of the way through. A 1.7m squeeze arrived at its
// doorway as 1.34m — Josh's *"they might be too narrow"*, and it was the frames,
// not the floor. A frame surrounds a hole; it does not stand in it.

/** Local-X offset from the centre to each jamb's centre. */
export function posternColumnOffset(width: number): number {
  return snap(width, WIDTH_STEP) / 2 + JAMB_HALF_THICK;
}

/** Walk-blockers matching the postern's jambs. They flank the opening rather
 *  than narrowing it, so they never pinch the walk band. Attach as the
 *  `collision` of the same prop that renders the model. */
export function doorframeCollision(
  width: number,
): import('../level/types').PropCollision[] | undefined {
  const jambOffset = posternColumnOffset(width);
  return [
    { kind: 'aabb', halfW: JAMB_HALF_THICK, halfD: JAMB_DEPTH / 2, ox: -jambOffset, oz: 0 },
    { kind: 'aabb', halfW: JAMB_HALF_THICK, halfD: JAMB_DEPTH / 2, ox: jambOffset, oz: 0 },
  ];
}

/** Half of the passable band through a postern — the whole opening, since
 *  nothing stands in it. The NavGate half-width pathfinding funnels through. */
export function doorframePassableHalfBand(width: number): number {
  return width / 2;
}

/**
 * The arch's geometry, solved from the opening.
 *
 *   R = (s² + f²) / 2f     centre at y = spring + f − R
 *
 * with half-span s and rise f. At f = s this is exactly a semicircle (R = s,
 * centre ON the springing line), which is the case a narrow opening gets.
 *
 * Exported for the test, which checks the curve actually passes through the
 * springing points rather than trusting the algebra.
 */
export function posternGeometry(width: number, ceiling: number, openHeight?: number): {
  spring: number; rise: number; radius: number; centreY: number; halfAngle: number;
  halfSpan: number;
} {
  // The arch springs from the JAMBS' inner faces, which are flush with the
  // opening's edges — so the half-span is simply half the opening. (The archway
  // has the same rule and states why: an arch spanning past its jambs springs
  // from thin air.)
  const s = Math.max(0.32, snap(width, WIDTH_STEP) / 2);
  // The crown has to clear BOTH ceilings: the room's, or the arch pokes through
  // it, and the passage's, or you see void over the corridor through the bore.
  const cap = Math.min(ceiling - 0.12, openHeight ?? Infinity);
  // ROUND IF IT FITS. Take rise = halfSpan (the full semicircle) whenever the
  // headroom allows, and shrink toward MIN_RISE when it does not — at which
  // point the curve is segmental, exactly like the wide gate, because the same
  // constraint is biting.
  const rise = Math.max(MIN_RISE, Math.min(s, cap - SPRING_MIN));
  const spring = Math.max(0.9, Math.min(SPRING_Y, cap - rise));
  const radius = (s * s + rise * rise) / (2 * rise);
  const centreY = spring + rise - radius;
  // Angle from vertical to the springing point. `radius - rise` is the vertical
  // leg from the circle's centre up to the springing line; at a true semicircle
  // it is zero and this is exactly π/2.
  const halfAngle = Math.atan2(s, radius - rise);
  return { spring, rise, radius, centreY, halfAngle, halfSpan: s };
}

/**
 * Every depth in this model, solved from the wall the gate is set into.
 *
 *   ring  >  fill  >  jambs
 *
 * The voussoirs stand proud of the wall face so a lamp rakes the curve; the fill
 * is the wall; the jambs sit a hair back so the ring reads as laid ON the reveal
 * rather than flush with it. Same order, and the same reasons, as the archway —
 * the two thresholds are one masonry family and a different depth order would
 * say they were built by different hands.
 */
function depths(reveal: number) {
  return {
    fill:     reveal,
    arch:     reveal + 0.10,
    keystone: reveal + 0.20,
    jamb:     Math.max(0.26, reveal - 0.10),
    plinth:   Math.min(Math.max(0.26, reveal - 0.10) + 0.13, reveal),
    impost:   Math.min(Math.max(0.26, reveal - 0.10) + 0.11, reveal),
  };
}

/** id → spec. Module-level, so the second floor's doorways are free. */
const MEMO = new Map<string, ModelSpec>();

export function doorframe(opts: DoorframeOptions = {}): ModelSpec {
  const width = snap(opts.width ?? 1.0, WIDTH_STEP);
  const ceiling = snap(opts.ceilingHeight ?? 3.2, 0.2);
  const open = opts.openHeight === undefined ? undefined : snap(opts.openHeight, 0.2);
  const reveal = revealDepthFor(opts.wallDepth ?? DEFAULT_WALL_DEPTH);
  const D = depths(reveal);
  const memoKey = `${width}|${ceiling}|${open ?? '-'}|${reveal}`;
  const hit = MEMO.get(memoKey);
  // SAME OBJECT, not an equal one — the CSG cache is keyed on the part.
  if (hit) return hit;

  const jambOffset = posternColumnOffset(width);
  const g = posternGeometry(width, ceiling, open);
  // The fill has to reach past the RING, not just past the opening: a voussoir's
  // extrados stands further out than its intrados, so a fill sized off the width
  // alone stops before the arch does.
  const extradosX = (g.radius + VOUSSOIR_RADIAL) * Math.sin(g.halfAngle);
  const fillWidth = Math.max(width + LINTEL_OVERHANG * 2, 2 * (extradosX + 0.07));

  const parts: PartSpec[] = [];

  // ── THE WALL, WITH A HOLE IN IT ────────────────────────────────────
  //
  // One subtract, one level deep. The cylinder that carves the arch is the same
  // circle the voussoirs are laid on, so the stone and the ring can never
  // disagree about where the curve is.
  const fillH = Math.max(0.12, ceiling - g.spring);
  parts.push({
    kind: 'csg', op: 'subtract', mat: 'stone', name: 'fill',
    a: { kind: 'box', pos: [0, g.spring + fillH / 2, 0], size: [fillWidth, fillH, D.fill], mat: 'stone' },
    b: {
      kind: 'cylinder', pos: [0, g.centreY, 0], rot: [Math.PI / 2, 0, 0],
      radius: g.radius, height: D.keystone * 3, segments: 40, mat: 'stone',
    },
  } as PartSpec);

  // ── THE RING ───────────────────────────────────────────────────────
  //
  // Voussoirs on cell CENTRES rather than endpoints, so no block straddles the
  // springing line with half of itself hanging below the impost.
  const step = (2 * g.halfAngle) / VOUSSOIRS;
  for (let i = 0; i < VOUSSOIRS; i++) {
    const theta = -g.halfAngle + (i + 0.5) * step;
    const key = i === (VOUSSOIRS - 1) / 2;
    const radial = key ? KEYSTONE_RADIAL : VOUSSOIR_RADIAL;
    const tang = g.radius * step * (key ? 1.28 : 1.12);
    const rho = g.radius + radial / 2;
    parts.push({
      kind: 'box',
      name: key ? 'keystone' : `voussoir-${i}`,
      // +Y of an unrotated box points radially outward at theta = 0, so −theta
      // about Z swings it round the arc. (Rotation sign is the documented
      // failure mode; the bench's TOP view catches a sign error immediately.)
      pos: [rho * Math.sin(theta), g.centreY + rho * Math.cos(theta), 0],
      rot: [0, 0, -theta],
      size: [tang, radial, key ? D.keystone : D.arch],
      mat: 'glow',
    } as PartSpec);
  }

  // ── THE WALL ABOVE THE ARCH ────────────────────────────────────────
  //
  // Coursed masonry on the fill's face, standing proud of it so the two read as
  // stone laid on stone rather than z-fighting as one plane. Starts above the
  // ring's crown — the spandrels are the arch's own stone, and coursing across
  // them would say the mason built the wall first.
  const crown = g.centreY + g.radius + KEYSTONE_RADIAL;
  parts.push(...coursedPanel({
    width: fillWidth, baseY: crown, topY: ceiling,
    depth: D.fill + 0.07, mat: 'stone', prefix: 'spandrel', seed: 3, gaps: FILL_GAPS,
  }));

  // ── THE JAMBS ──────────────────────────────────────────────────────
  const impostY = g.spring - IMPOST_HEIGHT / 2;
  const shaftBottom = BASE_HEIGHT;
  const shaftTop = g.spring - IMPOST_HEIGHT;
  const courseH = Math.max(0.18, (shaftTop - shaftBottom) / COURSES);

  for (const side of [-1, 1] as const) {
    const x = side * jambOffset;
    parts.push({
      kind: 'box', name: 'plinth',
      pos: [x, BASE_HEIGHT / 2, 0],
      size: [JAMB_HALF_THICK * 2 + BASE_OVERHANG * 2, BASE_HEIGHT, D.plinth],
      mat: 'stone',
    } as PartSpec);

    for (let c = 0; c < COURSES; c++) {
      // Alternating depth is what makes two blocks read as two blocks in
      // torchlight — a flush stack is indistinguishable from one tall box.
      const deep = c % 2 === 0 ? 0.02 : -0.02;
      // THE CHIP. One course, one side, missing a bite of its face. Deliberate
      // rather than rolled: the model is built per width and has no RNG, and a
      // gate that is the same on both sides is the tell that nobody built it.
      const chipped = side === 1 && c === 0;
      parts.push({
        kind: 'box', name: `course-${c}`,
        pos: [x - (chipped ? 0.02 : 0), shaftBottom + courseH * (c + 0.5), chipped ? -0.03 : 0],
        size: [
          JAMB_HALF_THICK * 2 - (chipped ? 0.04 : 0),
          courseH - 0.012,
          D.jamb + deep - (chipped ? 0.06 : 0),
        ],
        mat: 'stone',
      } as PartSpec);
    }

    // THE SPRINGER. Wide enough to actually receive the arch: the ring's lowest
    // block overhangs the springing point and needs stone under it. Solved
    // rather than guessed — an overhang the impost does not cover reads as the
    // arch resting on nothing.
    const impostHalf = Math.max(
      JAMB_HALF_THICK + IMPOST_OVERHANG, extradosX - jambOffset + 0.05);
    parts.push({
      kind: 'box', name: 'impost',
      pos: [x, impostY, 0],
      size: [impostHalf * 2, IMPOST_HEIGHT, D.impost],
      mat: 'glow',
    } as PartSpec);
  }

  const id = `postern-w${width.toFixed(2)}-c${ceiling.toFixed(1)}-s${g.spring.toFixed(2)}-f${g.rise.toFixed(2)}-r${reveal.toFixed(2)}`;

  const spec: ModelSpec = {
    id,
    materials: {
      // The archway's stone, exactly. These are two gates in one dungeon; a
      // different grey would say they were quarried in different centuries.
      stone: { color: 0x262a30, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
      // The ring. Identical to stone at rest (emissive 0); the threshold system
      // raises the warm emissive as the player nears, so a RING lights up rather
      // than the whole gate. Same 'glow' contract the archway uses (see the
      // builder's proximityGlow handling).
      glow: { color: 0x262a30, roughness: 1.0, metalness: 0.0, flatShading: true, emissive: 0xc05a18, emissiveIntensity: 0, detail: 'dressed' },
    },
    parts,
    // Eye mount points on the KEYSTONE's outer faces, one per side since a
    // passage is approached from both rooms — same contract as the archway, so
    // the nav eye sits on carved stone rather than at a guessed offset.
    slots: {
      eye_front: { pos: [0, g.spring + g.rise + KEYSTONE_RADIAL / 2, D.keystone / 2 + 0.01] },
      eye_back: {
        pos: [0, g.spring + g.rise + KEYSTONE_RADIAL / 2, -(D.keystone / 2 + 0.01)],
        rot: [0, Math.PI, 0],
      },
    },
  };
  MEMO.set(memoKey, spec);
  return spec;
}
