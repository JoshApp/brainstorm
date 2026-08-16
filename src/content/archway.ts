import type { ModelSpec, PartSpec } from '../ecs/model-types';
import { revealDepthFor, DEFAULT_WALL_DEPTH } from './frame-depth';

// Corridor archway — the stone gate at the mouth of a corridor where it joins a
// room. Sells the transition between chambers: instead of stepping from one box
// into another, the player passes UNDER something.
//
// ── WHY IT WAS REBUILT ───────────────────────────────────────────────────────
//
// Josh, on the old one: *"a lot of the old stuff is ugly and unclean."* He was
// right, and the bench says exactly why (`delve bench model-archway --ortho`):
// it was two plain rectangular legs, a slab lintel and a slab of wall above,
// eight axis-aligned boxes in one material. That is the "one blob of leather"
// failure CLAUDE.md warns about — no silhouette, nothing for torchlight to
// catch, and from the front it read as a hole cut in a wall rather than a gate.
//
// What changed, in order of how much it does:
//
//   A REAL ARCH. The opening is a segmental curve cut from the wall fill with
//   one CSG subtract, and a ring of VOUSSOIRS is laid around it. A curve
//   against a dungeon of right angles is the whole read: you see an arch at
//   the far end of a dark room and you know it is a way through before you can
//   make out anything else about it.
//
//   NO PROXIMITY GLOW. There used to be a second stone material, 'glow', on the
//   voussoirs and imposts, whose emissive was raised by threshold-draft as the
//   player approached — a lit ring on every gate in the dungeon. Its own comment
//   admitted what it was: "the archway crown — its natural warm proximity glow
//   (decoration, not the cue)". That is the thing this project's lighting
//   doctrine names as the one it must not do — *"if we use special lighting as
//   pure decoration, we destroy that signal"* — and Josh called it a bug on
//   sight. The ring is now the same stone as the jambs.
//
//   What still lights at a threshold is the dungeon's EYE on the keystone, which
//   is a real cue (it kindles toward unexplored ground) and is untouched: it
//   mounts through the eye_front / eye_back slots, not through this material.
//
//   COURSED JAMBS. Three blocks with alternating depth and a chamfer instead
//   of one extruded pillar, so a jamb self-shadows and reads as masonry.
//
//   IT IS NOT SYMMETRICAL. One course on the left is chipped back. Procedural
//   stone reads as new precisely because both sides match.
//
// Authoring axes:
//   - +X = along the gate (the wall's running direction)
//   - +Y = up
//   - +Z = INTO the corridor / through the gate
// The composer rotates with rotY so +X aligns with the wall the gate sits in.
//
// Collision: emitted via PropSpec.collision[] with two circle blockers at the
// jamb positions — the composer computes those from `archwayColumnOffset`.

export interface ArchwayOptions {
  /** Width of the corridor opening this archway frames, in
   *  metres. Jambs are positioned so their OUTER faces sit
   *  just inside the opening (~0.04m clearance). */
  width: number;
  /** Ceiling height of the abutting room. The wall fill rises from the
   *  springing line to here so the void behind the wall doesn't peek
   *  through. Default 3.2m. */
  ceilingHeight?: number;
  /**
   * Interior height of the passage BEHIND the gate (the corridor's ceiling).
   *
   * The arch's CROWN must not rise above it: the bore is the one place you can
   * see through, so a crown above the corridor's ceiling plane shows a slit of
   * void over the passage. The springing line sinks until the crown clears.
   * (Rolled mine-tunnel corridors run 2.3-2.6m.) Default: uncapped.
   */
  openHeight?: number;
  /**
   * Thickness of the wall this gate is set into, in metres. Every depth in the
   * model is derived from it — see content/frame-depth.ts, and the measurement
   * that says why. `WALL_T` (0.25) for a polygon room; 0 for a rect room, whose
   * wall is a single plane. Default: a thin dungeon wall.
   */
  wallDepth?: number;
}

// ── THE JAMBS ARE MASSIVE NOW, AND IT IS A HIERARCHY ARGUMENT ────────────────
// 0.16 (a 0.32m pilaster) was authored against a wall that was a flat plane with
// a painted brick pattern on it. The wall now lays real stones that run to 1.5m+
// across, and beside those a third of a metre of jamb reads as a stick. The gate
// stopped being the biggest thing in the picture, which is the whole job of a
// gate. 0.26 (a 0.52m pier) puts it back on the right side of the wall's own
// blocks — and because the jambs flank the opening rather than standing in it,
// widening them only ever widens the passable band (archwayPassableHalfBand).
export const JAMB_HALF_THICK = 0.26;      // half the jamb's size along the wall (X)
const BASE_HEIGHT     = 0.28;
const BASE_OVERHANG   = 0.07;      // plinth extends this far past the jamb each side
const IMPOST_HEIGHT   = 0.16;      // the block the arch springs from
const IMPOST_OVERHANG = 0.075;
// TWO courses, not three. Same argument as the jamb width one level down: the
// shaft should read as a couple of massive stones, not as a stack of small ones.
// The shader supplies the imperfection; the geometry should supply the shape.
const COURSES         = 2;         // shaft blocks between plinth and impost

// NO BEVELS, AND IT IS A MEASUREMENT NOT A TASTE. A chamfer on the fifteen
// blocks here swaps every one for a RoundedBoxGeometry, and a floor's sixteen
// doorways went from 18ms to 128ms of build — seven times the cost, on the
// frame where a descent is already loading. At this fidelity (flat-shaded dark
// stone, one lamp) a 2cm chamfer is worth almost nothing; the silhouette does
// the work, and the silhouette is free.

/** Where the arch springs from, unobstructed. Sinks under `openHeight`. */
const SPRING_Y        = 2.20;
const SPRING_MIN      = 1.78;      // below this you would duck through
/** Voussoir count. Odd, so one sits dead centre and IS the keystone. */
const VOUSSOIRS       = 7;
const VOUSSOIR_RADIAL = 0.19;      // ring thickness
const KEYSTONE_RADIAL = 0.34;
const LINTEL_OVERHANG = 0.10;      // fill extends past the opening each side
/** The hood mould over the extrados — the ring that FINISHES the arch. Slim:
 *  it is a lip that throws a shadow, not a second course of voussoirs. */
const HOOD_RADIAL     = 0.12;
/** Radians the hood runs past the voussoir ring at each springing, so it lands
 *  ON the wall either side instead of stopping in mid-air at the impost. */
const HOOD_SPREAD     = 0.18;
const HOOD_BLOCKS     = 9;

/**
 * Every depth in this model, solved from the wall the gate is set into.
 *
 * These used to be four constants around a `FILL_DEPTH = 1.10` — a metre of
 * stone, in a 0.25m wall, so half the gate hung out in the corridor. The
 * measurement and the rule live in content/frame-depth.ts; what is here is the
 * ORDER, which is the part you can see:
 *
 *   ring  >  fill  >  jambs
 *
 * The voussoirs stand proud of the wall face so a lamp rakes the curve; the
 * fill is the wall; the jambs sit a hair back from it so the ring reads as
 * laid ON the reveal rather than flush with it. The keystone is the proudest
 * block in the gate, because the dungeon's eye is set in it.
 */
function depths(reveal: number) {
  return {
    fill:     reveal,
    arch:     reveal + 0.12,
    keystone: reveal + 0.24,
    // An arch springing from imposts much shallower than the ring reads as a
    // slab resting on sticks, so the jambs stay within a hand of the fill
    // rather than taking a fixed fraction of it.
    jamb:     Math.max(0.28, reveal - 0.10),
    // The footing and the springer step OUT from the shaft, but never past the
    // wall face — a plinth prouder than the fill is a buttress, and a gate does
    // not have buttresses.
    plinth:   Math.min(Math.max(0.28, reveal - 0.10) + 0.14, reveal),
    impost:   Math.min(Math.max(0.28, reveal - 0.10) + 0.12, reveal),
  };
}

/**
 * Openings are snapped to this grid before ANY geometry is derived from them.
 *
 * THE ARCH COSTS A CSG, and a CSG is 27ms. A doorway width is a continuous
 * float, so every archway on a floor used to be a unique spec — meaning the
 * builder's CSG_CACHE (keyed on the part object) could never hit, and a floor
 * with sixteen doorways paid nearly half a second of boolean solving on a
 * phone. Snapping the width and the heights makes archways REPEAT, so the
 * memo below returns the same spec object and the cache does its job.
 *
 * Everything derived from the width snaps together — the collision offset as
 * well as the model — so the stone and the blockers can never end up 4cm
 * apart, which is the failure a "quantise the model only" shortcut ships.
 */
const WIDTH_STEP = 0.10;
const snap = (v: number, step: number): number => Math.round(v / step) * step;

/**
 * Local-X offset from the archway centre to each jamb's centre.
 *
 * ── THE JAMBS STAND BESIDE THE HOLE, NOT IN IT ───────────────────────────────
 *
 * Josh, on the screenshots: *"are the corridors etc big enough… I got the
 * feeling they might be too narrow."* Measured, and it was not the corridors —
 * a polygon room's narrow dimension is a median 10.5m against the vault's 7.0,
 * and the corridors match the vault almost exactly (2.20m median against
 * 2.22m). It was every DOORWAY.
 *
 * The jambs used to sit INSIDE the opening with their outer faces flush to its
 * edges, so each one ate a full jamb-thickness of the way through: 0.68m gone
 * from every doorway in the game, at every width. A median 2.2m corridor
 * necked to 1.52m and a 1.7m squeeze to 1.02m — and the archway of the day was
 * a metre deep, so that pinch became a metre-long tunnel rather than a thin one.
 *
 * A door frame surrounds a hole; it does not stand in it. The jambs now flank
 * the opening — pilasters against the solid wall either side, which is the
 * same move doorframe.ts already makes for its narrow openings — and the whole
 * hole is yours to walk through.
 *
 * Everything downstream follows for free and in the SAFE direction: the arch
 * springs from the jamb inner faces, so it now spans the opening exactly; the
 * collision blockers move out of the walk band with the stone they represent;
 * and `archwayPassableHalfBand` — which the nav gates and the stair-mouth
 * soft-lock guarantee are computed against — can only get wider.
 */
export function archwayColumnOffset(width: number): number {
  return snap(width, WIDTH_STEP) / 2 + JAMB_HALF_THICK;
}

/** Half of the passable band between the archway's jamb BLOCKERS
 *  (collision r 0.18 at the jamb centres) — the NavGate half-width
 *  pathfinding funnels through. */
export function archwayPassableHalfBand(width: number): number {
  return Math.max(0.2, archwayColumnOffset(width) - 0.18);
}

/**
 * The arch's geometry, solved from the opening.
 *
 * A SEGMENTAL arch, not a round one, and the reason is the ceiling: a round
 * arch's rise is half its span, so a 1.8m doorway would crown 0.9m above the
 * springing and punch through a 3.0m room. A segmental arch takes its rise as
 * an input and solves for the radius, so a wide gate stays a gate instead of
 * becoming a cathedral.
 *
 *   R = (s² + f²) / 2f     centre at y = spring + f − R
 *
 * with half-span s and rise f. Exported for the test, which checks the curve
 * actually passes through the springing points rather than trusting the algebra.
 */
export function archGeometry(width: number, ceiling: number, openHeight?: number): {
  spring: number; rise: number; radius: number; centreY: number; halfAngle: number;
  halfSpan: number;
} {
  // THE ARCH SPRINGS FROM THE JAMBS, NOT FROM THE OPENING'S EDGES. A jamb's
  // outer face is flush with the wall opening and its inner face therefore
  // stands one jamb-thickness inside it (`archwayColumnOffset`), so an arch
  // spanning the full width would spring from thin air a third of a metre
  // outboard of the stone meant to carry it — which is exactly the flared
  // notch the first pass of this rebuild showed on the bench.
  const s = Math.max(0.35, archwayColumnOffset(width) - JAMB_HALF_THICK);
  const rise = Math.min(0.40, Math.max(0.22, s * 0.45));
  // The crown has to clear BOTH ceilings: the room's (or the arch pokes through
  // it) and the passage's (or you see void over the corridor through the bore).
  const cap = Math.min(ceiling - 0.14, openHeight ?? Infinity);
  const spring = Math.max(SPRING_MIN, Math.min(SPRING_Y, cap - rise));
  const radius = (s * s + rise * rise) / (2 * rise);
  const centreY = spring + rise - radius;
  // Angle from vertical to the springing point. `radius - rise` is the vertical
  // leg from the circle's centre up to the springing line.
  const halfAngle = Math.atan2(s, radius - rise);
  return { spring, rise, radius, centreY, halfAngle, halfSpan: s };
}

/** id → spec. Module-level, so the second floor's doorways are free. */
const MEMO = new Map<string, ModelSpec>();

export function archway(opts: ArchwayOptions): ModelSpec {
  const width = snap(opts.width, WIDTH_STEP);
  const ceiling = snap(opts.ceilingHeight ?? 3.2, 0.2);
  const open = opts.openHeight === undefined ? undefined : snap(opts.openHeight, 0.2);
  const reveal = revealDepthFor(opts.wallDepth ?? DEFAULT_WALL_DEPTH);
  const D = depths(reveal);
  const memoKey = `${width}|${ceiling}|${open ?? '-'}|${reveal}`;
  const hit = MEMO.get(memoKey);
  // SAME OBJECT, not an equal one. The builder's CSG cache is a WeakMap keyed
  // on the part, so returning a fresh-but-identical spec would cache nothing.
  if (hit) return hit;
  const jambOffset = archwayColumnOffset(width);
  const g = archGeometry(width, ceiling, open);
  // The fill has to reach past the RING, not just past the opening. A
  // voussoir's extrados stands further out than its intrados, so with the arch
  // now spanning the full hole the ring's ends overhang a fill sized off the
  // width alone — and the wall behind the arch stops before the arch does.
  const extradosX = (g.radius + VOUSSOIR_RADIAL) * Math.sin(g.halfAngle);
  const fillWidth = Math.max(width + LINTEL_OVERHANG * 2, 2 * (extradosX + 0.08));

  const parts: PartSpec[] = [];

  // ── THE WALL, WITH A HOLE IN IT ────────────────────────────────────
  //
  // One subtract, one level deep. The block spans springing→ceiling across the
  // whole opening, and the cylinder that carves the arch out of it is the same
  // circle the voussoirs are laid on — so the stone and the ring can never
  // disagree about where the curve is, which is what would happen if the fill
  // were hand-fitted boxes around it.
  // The gate's own stone spans springing → hood, NOT springing → ceiling. The
  // hood's top is derived below from the same circle, so this is stated once
  // here in the terms the box needs and re-derived there in the terms the
  // closure needs; both come off `g`, so they cannot drift.
  const gateTop = g.centreY + g.radius + VOUSSOIR_RADIAL + HOOD_RADIAL;
  const fillH = Math.max(0.12, gateTop - g.spring);
  parts.push({
    kind: 'csg', op: 'subtract', mat: 'stone', name: 'fill',
    a: { kind: 'box', pos: [0, g.spring + fillH / 2, 0], size: [fillWidth, fillH, D.fill], mat: 'stone' },
    // Laid along Z (rotX = 90°) so its circular face is the arch. Long enough
    // to punch clean through the fill from both sides.
    b: {
      kind: 'cylinder', pos: [0, g.centreY, 0], rot: [Math.PI / 2, 0, 0],
      radius: g.radius, height: D.keystone * 3, segments: 48, mat: 'stone',
    },
  } as PartSpec);

  // ── THE RING ───────────────────────────────────────────────────────
  //
  // Voussoirs on cell CENTRES rather than on the endpoints, so no block
  // straddles the springing line with half of itself hanging below the impost.
  // Tangential width overruns its cell by 12% — masonry with tight joints, not
  // a dashed line.
  const step = (2 * g.halfAngle) / VOUSSOIRS;
  for (let i = 0; i < VOUSSOIRS; i++) {
    const theta = -g.halfAngle + (i + 0.5) * step;
    const key = i === (VOUSSOIRS - 1) / 2;
    const radial = key ? KEYSTONE_RADIAL : VOUSSOIR_RADIAL;
    const tang = g.radius * step * (key ? 1.30 : 1.12);
    const rho = g.radius + radial / 2;
    parts.push({
      kind: 'box',
      name: key ? 'keystone' : `voussoir-${i}`,
      // +Y of an unrotated box points radially outward at theta = 0, so a
      // rotation of −theta about Z swings it round the arc. (Rotation sign is
      // the documented failure mode; this one is checked by the bench's TOP
      // view, where a sign error puts the ring on its side.)
      pos: [rho * Math.sin(theta), g.centreY + rho * Math.cos(theta), 0],
      rot: [0, 0, -theta],
      size: [tang, radial, key ? D.keystone : D.arch],
      mat: 'stone',
    } as PartSpec);
  }

  // ── THE HOOD, AND WHERE THE GATE STOPS ─────────────────────────────
  //
  // Josh, 2026-08-16: *"lets make them not expand endless till they hit the
  // ceiling but make them simply a nice arch."*
  //
  // He is describing a real fault and it was two things stacked. `planWallRing`
  // cuts an opening from FLOOR TO CEILING, so the gate has always had to close
  // the hole above itself or you would see void over every doorway — fine, and
  // not negotiable. But that closure was being made out of GATE: a slab at the
  // full reveal depth (0.57m, standing 0.16m proud of the wall on both faces)
  // with coursed masonry laid proud of THAT, running all the way up. In a 5m
  // room the arch was a metre of it and blank monumental frontage was the other
  // four. Nothing said where the gate ended, so it read as not ending.
  //
  // A gate ends at its HOOD. The hood mould (label course, dripstone — masons
  // have had a word for this for eight hundred years) is a slim ring laid over
  // the extrados that finishes the arch and throws the one shadow that says
  // "this is the top of the thing." Above it, the hole is closed by a plate at
  // the WALL's OWN THICKNESS, flush with the wall's faces — same stone, same
  // world-projected masonry, no proud edge. It is not part of the gate and it
  // does not read as part of the gate; it is the wall, continuing.
  //
  // (The proud coursed spandrel panel is gone with the slab it was dressing. It
  // was solving "this blank frontage is boring", which was the wrong problem —
  // the frontage should not have been there.)
  const step2 = (2 * (g.halfAngle + HOOD_SPREAD)) / HOOD_BLOCKS;
  const hoodRho = g.radius + VOUSSOIR_RADIAL + HOOD_RADIAL / 2;
  for (let i = 0; i < HOOD_BLOCKS; i++) {
    const theta = -(g.halfAngle + HOOD_SPREAD) + (i + 0.5) * step2;
    parts.push({
      kind: 'box',
      name: `hood-${i}`,
      pos: [hoodRho * Math.sin(theta), g.centreY + hoodRho * Math.cos(theta), 0],
      rot: [0, 0, -theta],
      size: [hoodRho * step2 * 1.10, HOOD_RADIAL, D.arch + 0.06],
      mat: 'stone',
    } as PartSpec);
  }
  // Where the gate's own stone stops. Everything above this is wall.
  const hoodTop = g.centreY + g.radius + VOUSSOIR_RADIAL + HOOD_RADIAL;

  // ── THE WALL ABOVE, WHICH IS WALL ──────────────────────────────────
  //
  // Flush: `wallDepth` thick, centred on the wall plane, so its faces are the
  // wall's faces. The world-projected masonry carries straight across it — the
  // courses line up with the stone either side because they are computed from
  // world position, not from this model — and there is no proud edge to catch a
  // lamp and announce a seam. A rect room passes wallDepth 0 (its wall is a
  // single plane), so the plate takes a minimum thickness rather than vanishing.
  const closureH = ceiling - hoodTop;
  if (closureH > 0.06) {
    parts.push({
      kind: 'box', name: 'wall-above',
      pos: [0, hoodTop + closureH / 2, 0],
      size: [fillWidth, closureH, Math.max(opts.wallDepth ?? DEFAULT_WALL_DEPTH, 0.12)],
      mat: 'stone',
    } as PartSpec);
  }

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
      // Alternating depth is what makes three blocks read as three blocks in
      // torchlight — a flush stack is indistinguishable from one tall box.
      const deep = c % 2 === 0 ? 0.02 : -0.02;
      // THE CHIP. One course, one side, missing a bite of its face. Deliberate
      // rather than rolled: the model is built per width and has no RNG, and a
      // gate that is the same on both sides is the tell that nobody built it.
      const chipped = side === -1 && c === 1;
      parts.push({
        kind: 'box', name: `course-${c}`,
        pos: [x + (chipped ? 0.022 : 0), shaftBottom + courseH * (c + 0.5), chipped ? -0.03 : 0],
        size: [
          JAMB_HALF_THICK * 2 - (chipped ? 0.045 : 0),
          courseH - 0.012,
          D.jamb + deep - (chipped ? 0.07 : 0),
        ],
        mat: 'stone',
      } as PartSpec);
    }

    // THE SPRINGER. Wide enough to actually receive the arch: a voussoir's
    // extrados sits further out than its intrados, so the ring's lowest block
    // overhangs the springing point and needs stone under it. Solved rather
    // than guessed — an overhang the impost does not cover reads as the arch
    // resting on nothing.
    const impostHalf = Math.max(
      JAMB_HALF_THICK + IMPOST_OVERHANG, extradosX - jambOffset + 0.06);
    parts.push({
      kind: 'box', name: 'impost',
      pos: [x, impostY, 0],
      size: [impostHalf * 2, IMPOST_HEIGHT, D.impost],
      mat: 'stone',
    } as PartSpec);
  }

  const id = `archway3-w${width.toFixed(2)}-c${ceiling.toFixed(1)}-s${g.spring.toFixed(2)}-r${reveal.toFixed(2)}`;

  const spec: ModelSpec = {
    id,
    materials: {
      // ONE material, and it is the WALL's. A gate is a hole in a wall, so its
      // stone should be that wall's stone — and because the detail projects in
      // world space, the frame's courses line up with the masonry they
      // interrupt rather than running to a rhythm of their own.
      // (Was 'dressed', a finer ashlar, alongside a second 'glow' material for
      // the ring. Both are gone: see the header.)
      // 'frame', not 'wall' — the quieter dialect (style/materials.ts). Same
      // texture on the same world projection, so a gate's courses still line up
      // with the masonry they interrupt; the world-space damage layers come off
      // so the gate is the calm thing in a noisy wall rather than more of it.
      stone: { color: 0x262a30, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'frame' },
    },
    parts,
    // Mount points for the dungeon's EYE, on the KEYSTONE's outer faces (one
    // per side, since a passage is approached from both rooms). The nav system
    // reads these, so the eye sits ON the carved stone rather than at a guessed
    // offset — and it now rides the crown of the arch, which is where a mason
    // would have put the carving anyway. Each faces outward (the eye is built
    // facing +Z; eye_back is turned to face the other way).
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
