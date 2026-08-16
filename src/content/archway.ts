import type { ModelSpec, PartSpec } from '../ecs/model-types';
import { revealDepthFor, DEFAULT_WALL_DEPTH } from './frame-depth';
import { coursedPanel } from './frame-coursing';

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

const JAMB_HALF_THICK = 0.16;      // half the jamb's size along the wall (X)
const BASE_HEIGHT     = 0.28;
const BASE_OVERHANG   = 0.07;      // plinth extends this far past the jamb each side
const IMPOST_HEIGHT   = 0.16;      // the block the arch springs from
const IMPOST_OVERHANG = 0.075;
const COURSES         = 3;         // shaft blocks between plinth and impost

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
  const fillH = Math.max(0.12, ceiling - g.spring);
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

  // ── THE WALL ABOVE THE ARCH ────────────────────────────────────────
  //
  // The fill above is a doorway-sized hole in the wall ring, closed with one
  // box — a median 2.6m of blank stone over every gate, reaching 5.4m at the
  // worst. Coursed masonry goes on its face, standing proud of the fill so the
  // two read as stone laid on stone rather than z-fighting as one plane. The
  // shared panel (content/frame-coursing.ts) lays it on the same world grid the
  // wall texture uses, so the joints line up with the mortar behind them.
  //
  // It starts above the ring's crown: the spandrels are the arch's own stone,
  // and coursing laid across them would say the mason built the wall first.
  const crown = g.centreY + g.radius + KEYSTONE_RADIAL;
  parts.push(...coursedPanel({
    width: fillWidth, baseY: crown, topY: ceiling,
    depth: D.fill + 0.08, mat: 'stone', prefix: 'spandrel', seed: 7,
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

  const id = `archway2-w${width.toFixed(2)}-c${ceiling.toFixed(1)}-s${g.spring.toFixed(2)}-r${reveal.toFixed(2)}`;

  const spec: ModelSpec = {
    id,
    materials: {
      // ONE material, and it is the WALL's. A gate is a hole in a wall, so its
      // stone should be that wall's stone — and because the detail projects in
      // world space, the frame's courses line up with the masonry they
      // interrupt rather than running to a rhythm of their own.
      // (Was 'dressed', a finer ashlar, alongside a second 'glow' material for
      // the ring. Both are gone: see the header.)
      stone: { color: 0x262a30, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'wall' },
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
