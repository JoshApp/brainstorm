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
  { name: 'plinth', h: 0.42, depth: 0,     mat: 'wall', fixed: true },
  { name: 'field',  h: 1.0,  depth: -0.14, mat: 'wall' },
];

/**
 * COURSED — plinth, recessed field, cap. Three bands, two depth changes.
 *
 * ── THE STRING COURSE IS GONE, AND SO IS THE DRESSED STONE ──────────────────
 * Josh, on the screenshots: *"can you remove the vertical bars that we added in
 * front of the mid section of the wall, i dont think we need it right now with
 * the cool new stone, and the bottom section towards the floor as well as
 * towards the ceiling it needs to have some sort of matching texture."*
 *
 * Both halves of that are the same mistake, made when the grammar was the ONLY
 * thing giving a wall depth. Back then the wall was a flat plane with a painted
 * brick pattern on it, so a band standing in front of the field was the only
 * source of a real shadow line, and a DIFFERENT material on that band was the
 * only way to say "this course is finished stone."
 *
 * Neither is true now. The stone itself has depth — POM displaces it, the
 * height field rakes it — so a band that stands in front of the field competes
 * with the masonry instead of framing it, and reads as a bar bolted across the
 * wall rather than as part of it. And the dressed ashlar the plinth and cap
 * were using is a genuinely different stone (bigger blocks, thin clean joints,
 * no brick damage, no seep), which at the base of a rough wall reads as a
 * smooth blank slab — the flat pale band in his screenshot.
 *
 * So: the field is one continuous run of masonry, the plinth steps FORWARD of
 * it at the base and the cap steps forward less at the top, and all three are
 * the same stone. What survives is the pair of horizontal shadow lines, which
 * is the part that was ever doing the work. Weight still belongs at the
 * bottom — the cap projects less than the plinth, and the eye notices when it
 * doesn't even if it can't say why.
 *
 * Side benefit, since it is the seam the peer session cares about: three bands
 * on ONE material merge into one group instead of five bands across two.
 */
const COURSED: WallBand[] = [
  { name: 'plinth',  h: 0.38, depth: 0,     mat: 'wall', fixed: true },
  { name: 'field',   h: 1.0,  depth: -0.22, mat: 'wall' },
  { name: 'cap',     h: 0.20, depth: -0.08, mat: 'wall', fixed: true },
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
// 'plain' — AND THE GRAMMAR HAS BEEN MADE REDUNDANT BY THE STONE.
//
// Josh, 2026-08-16: *"lets get rid of the lower bands between walls and floors,
// i think with the new wall geometry we can get rid of the banding as well or at
// least at the pertrusion."*
//
// This file's whole premise was that a wall was ONE JITTERED PLANE and the only
// way to get a real shadow line onto it was to step the geometry. Read the
// header: "no plinth, no string course, no cap — nothing with actual depth, so
// no surface ever casts a line of shadow across another." That was true when it
// was written and it is not true now. The masonry itself has depth — POM
// displaces the stone, the height field rakes it, the courses vary in size and
// break at their corners — so a band is no longer the cheapest source of a
// shadow line. It is a SECOND, COARSER rhythm laid across a surface that already
// has one, and two rhythms that don't agree read as a bar bolted to a wall.
//
// That is the same diagnosis that took the string course out of COURSED, applied
// one level up. The string course lost to the stone; so do the plinth and the
// cap.
//
// THE PROFILES ARE NOT DELETED. `resolveProfile` is unchanged and 'plinth' /
// 'coursed' still build exactly what they built — the vocabulary is data and a
// room that has earned a deliberately BUILT read can still ask for one. What
// changed is the DEFAULT, which is the only part that was making every wall in
// the dungeon look the same.
export const DEFAULT_WALL_PROFILE: WallProfileName = 'plain';

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
