// ── WALL PROFILES — the vertical grammar of a wall ───────────────────────────
//
// Josh: *"most of our things like wall floor are the same color and same kinda
// shader generation pattern... i think we could make things more 3d and break
// things up even more."*
//
// He's right, and the reason is structural rather than material: until now a
// wall segment was ONE jittered plane of full room height. Every bit of its
// "3D" came from vertex noise on a flat quad. No plinth, no string course, no
// cap — nothing with actual depth, so no surface ever casts a line of shadow
// across another, which is what makes real masonry read.
//
// A PROFILE is the fix, expressed as DATA: a wall is a stack of horizontal
// BANDS, bottom to top, each with a height and a DEPTH OFFSET from the wall
// plane. A plinth stands proud at the base; a string course steps out
// mid-height; a recessed field falls back between them. Where two adjacent
// bands sit at different depths, the builder closes the step with a connector
// quad, so the profile reads as carved masonry rather than floating panels.
//
// ── WHY THIS IS THE CHEAP MOVE HERE ─────────────────────────────────────────
// Every room's wall segments already merge into one mesh per material, and
// static-batch then folds those floor-wide — so bands cost TRIANGLES, which
// this game has in abundance, and not DRAWS, which are the phone's actual
// wall (CPU-encode bound; see the 2026-07-03 triage).
//
// A/B measured on THIS branch, 2026-08-15, `npm run perf-depths --seeds=1
// --max=3`, default profile flipped between runs:
//
//        default    drawables (d1/d2/d3)     triangles
//        plain      528 / 496 / 496          10.0k / 9.6k / 9.5k
//        plinth     512 / 512 / 512           9.7k / 9.8k / 9.7k
//
// Adding a band + a connector to every wall segment on the floor moved both
// numbers less than the run-to-run spread. The shell does not even appear as
// its own bucket in the by-owner breakdown — decor (71%), fx (17%) and sprites
// (12%) are where the drawables actually go.
//
// (An earlier version of this comment quoted "shell = 0.5% of drawables,
// ~100k triangles". Those were real numbers measured on a DIFFERENT branch
// and they do not describe this tree. Re-measure before quoting; don't carry
// a number across a branch.)
//
// ── CONSTRAINTS A PROFILE AUTHOR MUST RESPECT ───────────────────────────────
// 1. NEVER GO PROUD. Wall collision is a line along the wall PLANE, so a band
//    at positive depth is geometry the player walks through — a ledge that
//    clips your knees, which reads worse than a flat wall. Author the
//    frontmost course at depth 0 and RECESS everything else (negative). Being
//    stopped slightly short of a hollow is physically correct, and the player
//    capsule already holds you ~30cm off a wall, so a deep recess is free.
//    This is why the profiles below bottom out at -0.16 rather than standing
//    +0.055 proud: see the note above COURSED.
// 2. BANDS MUST SUM TO THE WALL HEIGHT. `resolveProfile` normalises for you —
//    it scales flexible bands to fill whatever height the room actually has,
//    since room heights vary and a profile is authored once.
// 3. FIXED BANDS STAY FIXED. A plinth is a real-world size; it should not
//    stretch to 3x in a tall room. Mark those `fixed: true` and only the
//    flexible bands absorb the difference.
// 4. MATERIAL CHANGES COST A MERGE GROUP. Bands merge per material, so using
//    two materials in a profile costs one extra draw per floor after
//    static-batch, not per room. Two is fine. Six is not.

/** One horizontal band of a wall, authored bottom-up. */
export interface WallBand {
  /** Band height in metres. Treated as a MINIMUM for flexible bands — they
   *  scale up to absorb whatever height the room has left over. */
  h: number;
  /** Offset from the wall plane, metres. POSITIVE = proud (toward the room),
   *  negative = recessed. Cosmetic only — see constraint 1 above. */
  depth: number;
  /** Material key on the level's material set. Bands sharing a material merge
   *  together, so prefer few. */
  mat: 'wall' | 'dressed';
  /** When true the band keeps its authored height regardless of room height —
   *  a plinth is a real size, not a fraction. Flexible bands take up the slack. */
  fixed?: boolean;
  /** Author-facing label. Shows up in debug reports; not used for rendering. */
  name?: string;
}

export type WallProfileName = 'plain' | 'coursed' | 'plinth';

/**
 * PLAIN — one full-height band flush with the wall plane.
 *
 * This is the pre-grammar wall, expressed in the new vocabulary. It exists so
 * the grammar can ship switched OFF: every room that doesn't opt into a profile
 * emits exactly the geometry it emitted before, one plane at depth 0. Rooms opt
 * in one at a time and any regression is attributable to a named profile rather
 * than to "the wall change".
 */
const PLAIN: WallBand[] = [
  { name: 'field', h: 1, depth: 0, mat: 'wall' },
];

// ── THE FIRST VERSION OF THESE WAS INVISIBLE ────────────────────────────────
// Shipped with the proud bands at +0.055 / +0.045. Josh, on the live build:
// *"i dont see a difference with wall coursed tbh."* He was right, and it took
// a REAL browser to see why — the headless snap's broken grade had been
// flattering flat geometry all along.
//
// The geometry was building correctly (coursed 107,298 tris vs plain 91,832,
// +17%). Two reasons it couldn't read:
//
//   1. THE WALL MATERIAL ALREADY HAS STRONG BRICK RELIEF. The shader draws
//      ~40cm blocks with deep mortar lines, high contrast. A 5cm step is noise
//      against that. Whatever the grammar does has to out-scale the pattern
//      that's already there, not compete with it.
//   2. NEAR-DARKNESS HIDES SHALLOW STEPS. Relief only reads where light rakes
//      across it, and most of a DELVE wall is 2+ metres from the nearest
//      flame. A step needs to be deep enough to throw a shadow at a grazing
//      angle, not merely to exist.
//
// ── AND THE FIX INVERTS THE DESIGN ──────────────────────────────────────────
// The obvious response — push the proud bands further out — runs straight into
// the collision constraint: wall collision is a line on the wall PLANE, so
// proud geometry is geometry the player walks through, and a 15cm ledge that
// clips your knees is worse than a flat wall.
//
// So RECESS instead. The reference course sits AT the wall plane (depth 0) and
// everything else falls back behind it. Collision now sits flush with the
// frontmost stone — nothing is walk-through — and the recess can go as deep as
// the look wants, because being blocked slightly before a hollow is physically
// correct and the player capsule already holds you ~30cm off a wall.
//
// Same relief, right side of the collision plane, and no ceiling on depth.

/**
 * PLINTH — the cheapest departure from flat: a base course and a recessed field.
 *
 * One extra band and one connector, buying the single most valuable line in the
 * room: a horizontal shadow where wall meets floor, running the whole perimeter.
 * Safe default for rooms that shouldn't draw attention to themselves.
 */
const PLINTH: WallBand[] = [
  { name: 'plinth', h: 0.42, depth: 0,     mat: 'dressed', fixed: true },
  { name: 'field',  h: 1.0,  depth: -0.14, mat: 'wall' },
];

/**
 * COURSED — plinth, recessed field, string course, upper field, cap.
 *
 * The full grammar, for rooms that earn a look: five bands and four depth
 * changes, so light rakes across four horizontal edges instead of none. The
 * deeply recessed fields are what stop the wall reading as a stack of shelves —
 * the standing courses need something to stand proud OF.
 *
 * The cap sits deeper than the plinth. Weight belongs at the bottom; a cap that
 * projects further than the base reads as top-heavy and wrong, and the eye
 * notices even when it can't say why.
 */
const COURSED: WallBand[] = [
  { name: 'plinth',  h: 0.38, depth: 0,     mat: 'dressed', fixed: true },
  { name: 'lower',   h: 1.0,  depth: -0.22, mat: 'wall' },
  { name: 'string',  h: 0.22, depth: -0.03, mat: 'dressed', fixed: true },
  { name: 'upper',   h: 0.8,  depth: -0.22, mat: 'wall' },
  { name: 'cap',     h: 0.20, depth: -0.08, mat: 'dressed', fixed: true },
];

const PROFILES: Record<WallProfileName, WallBand[]> = {
  plain: PLAIN,
  plinth: PLINTH,
  coursed: COURSED,
};

/** A band resolved against a concrete wall height: absolute Y range + depth. */
export interface ResolvedBand {
  /** Y of the band's bottom edge, relative to the wall's base. */
  y0: number;
  /** Y of the band's top edge, relative to the wall's base. */
  y1: number;
  depth: number;
  mat: 'wall' | 'dressed';
  name: string;
}

/**
 * Resolve a profile against a real wall height.
 *
 * Fixed bands keep their authored height; flexible bands share whatever is
 * left, in proportion to their authored heights. If the fixed bands alone
 * over-run the wall (a very low room), everything falls back to PLAIN rather
 * than emitting a squashed, overlapping profile — a short wall with no grammar
 * looks ordinary, a short wall with a broken grammar looks like a bug.
 */
export function resolveProfile(name: WallProfileName, wallHeight: number): ResolvedBand[] {
  const bands = PROFILES[name] ?? PLAIN;
  const fixedTotal = bands.reduce((s, b) => s + (b.fixed ? b.h : 0), 0);
  const flexAuthored = bands.reduce((s, b) => s + (b.fixed ? 0 : b.h), 0);
  const flexAvailable = wallHeight - fixedTotal;

  // Not enough wall left for the flexible bands to be meaningful — bail to
  // plain rather than emit slivers. 0.5m is about where a band stops reading
  // as a course and starts reading as a seam.
  if (flexAuthored > 0 && flexAvailable < 0.5) {
    return resolveProfile('plain', wallHeight);
  }

  const flexScale = flexAuthored > 0 ? flexAvailable / flexAuthored : 0;
  const out: ResolvedBand[] = [];
  let y = 0;
  for (const b of bands) {
    const h = b.fixed ? b.h : b.h * flexScale;
    if (h <= 1e-4) continue;
    out.push({ y0: y, y1: y + h, depth: b.depth, mat: b.mat, name: b.name ?? 'band' });
    y += h;
  }
  // Floating-point drift over five bands would leave a hairline gap at the
  // ceiling; pin the last band's top to the exact wall height.
  if (out.length > 0) out[out.length - 1].y1 = wallHeight;
  return out;
}

/** Every profile name, for debug listings and tests. */
export const WALL_PROFILE_NAMES = Object.keys(PROFILES) as WallProfileName[];

/**
 * THE DEFAULT PROFILE for rooms that don't name one.
 *
 * 'plinth' rather than 'plain': one extra band and one connector per wall
 * segment, buying a continuous horizontal shadow line where every wall meets
 * every floor. It grounds the room without asserting anything about it, which
 * is the right behaviour for a default — the loud profile ('coursed') stays
 * opt-in so that a room reading as deliberately BUILT still means something.
 * Cheap by the numbers above: the shell is 0.5% of drawables and these bands
 * merge into the groups that were already being merged.
 */
// TEMPORARILY 'coursed', FOR JUDGEMENT — not the intended end state.
//
// The preview flag below is DEV-gated, which means it is dead-code-eliminated
// from the production bundle and cannot do anything on the live site. Josh
// tests on his phone against the live URL, so `?wallprofile=coursed` was a
// preview affordance for a workflow he doesn't use — which is why his first
// look at this reported no difference at all.
//
// Until the per-room assignment exists, the loud profile is the default so it
// can actually be seen where it's actually judged. The end state is 'plinth'
// (or plain) everywhere ordinary and 'coursed' on rooms that have earned a
// look — a room reading as deliberately BUILT should mean something, and it
// can't if every room does it.
export const DEFAULT_WALL_PROFILE: WallProfileName = 'coursed';

/**
 * DEV-only override so a profile can be previewed on a real seeded floor
 * without editing code: `?wallprofile=coursed`. Returns null in production
 * (the whole block dead-code-eliminates) and for an unknown name, so a typo
 * falls back to the authored profile rather than silently flattening walls.
 */
export function devWallProfileOverride(): WallProfileName | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('wallprofile');
  return v && (WALL_PROFILE_NAMES as string[]).includes(v) ? (v as WallProfileName) : null;
}
