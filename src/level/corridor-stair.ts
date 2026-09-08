// ── A STAIR IS A SECTION, NOT SOMETHING THAT HAPPENS TO A CORRIDOR ───────────
//
// Josh: *"lets do stairs as corridor section."*
//
// corridor-types.ts gave a corridor a WORD — squeeze, passage, gallery — because "a room is
// a WORD first and a shape second, which is exactly why the content layer can extend rooms
// and cannot extend corridors". Descent never got one. A corridor was a stair only in the
// sense that the elevation planner happened to hand it a fall, and every consumer
// rediscovered that fact by sampling the elevation field at both ends. That is why the
// ceiling had to interrogate the floor to find out what it was covering.
//
// ── WHAT WAS ACTUALLY WRONG UNDERFOOT ───────────────────────────────────────
//
// Measured over 146 stair runs, 24 floors, from the shipping geometry:
//
//   riser        p50 0.17m   min 0.05   max 0.22
//   TREAD DEPTH  p50 1.86m   min 0.66   max 6.54
//   depth/rise   p50 11      min 4      max 38
//
// A real stair is about 0.17 rise to 0.28 going — a ratio near 1.6. At 11 these are not
// staircases, they are a few very wide terraces, and no choice of riser fixes it. The going
// is `rise / grade`, so the ratio is decided entirely by the GRADE, and the grade was 0.09
// because the fall was smeared evenly along the whole corridor.
//
// ── SO THE SECTION OWNS WHERE THE FALL IS SPENT ─────────────────────────────
//
// A stair hall is not a tilted corridor. It is LEVEL GROUND, then a compact FLIGHT, then
// level ground again. Spending the same fall over a short run instead of a long one buys
// the grade a staircase needs, and hands back the rest of the corridor as landing — which
// is also the more characterful shape: you walk, you meet a flight, you descend it.
//
// The field already draws exactly this profile (elevation.ts samples flat-apron / linear /
// flat-apron), so this changes WHERE the slope sits, not how it is evaluated. The aprons
// stop being a fixed fraction of the corridor and become the landings left over once the
// flight has taken what it needs.
//
// ── AND THE GRADE CAP KEEPS ITS ONE OWNER ───────────────────────────────────
//
// `corridorRampRun` exists because the composer divides a rolled drop by it to enforce
// ELEVATION_MAX_GRADE, and its own comment says the cap and the field's ramp maths "can
// never disagree about where the slope lives". So the longest a flight may be lives HERE,
// and elevation.ts asks this module rather than keeping a second opinion.

/** Rise per tread, metres — what the section is aiming for. The real rise is this rounded
 *  so the flight divides into whole treads; a flight that ends on a stub step reads as a
 *  mistake in the stone. */
const TARGET_RISE = 0.17;

/**
 * The grade a FLIGHT wants, fall over run.
 *
 * At 0.38 the going comes out near 0.45m against a 0.17m rise — a ratio of 2.6, against the
 * 11 the smeared ramp was producing. Not the 1.6 of a real staircase: that needs a grade of
 * 0.62, which is a 32-degree walk, and the camera glides this slope smoothly rather than
 * climbing steps (CONFIG.STAIR_RISER_M's note — "the eye and collision still glide the
 * smooth linear grade underneath"). Steeper is one constant away if it wants trying, and
 * ELEVATION_MAX_GRADE is the ceiling it has to stay under.
 */
const TARGET_GRADE = 0.38;

/** Level ground kept at each mouth of the corridor, metres. A flight may not start in a
 *  doorway: the threshold is where the corridor's floor meets the room's, and the ceiling
 *  meets the doorway head there too. Even a corridor that is stairs end to end keeps this
 *  much, so you always step onto level stone before you step through. */
const MIN_LANDING = 0.9;

/** A corridor that IS a staircase keeps only a footing at each mouth, not a landing. */
const THRESHOLD = 0.45;

/**
 * The gentlest grade still worth calling a stair.
 *
 * Josh: *"i rather like the stairs going all the way ... a fully staired corridor should be
 * possible."* Right, and this is the number that decides which shape a corridor gets. Give
 * the whole run to the fall and see what grade comes out: if it still reads as a flight,
 * that is the better corridor — you descend the length of it. If it comes out as a 5% tilt,
 * the corridor is simply too long for its fall, and smearing it is what produced the 1.86m
 * treads. Then the fall concentrates into a flight and the rest is landing.
 *
 * So neither shape is the default. The corridor's own proportions choose.
 */
const MIN_FULL_GRADE = 0.16;

/** The shortest thing worth calling a flight. Below this a corridor too short to hold
 *  landings simply gives the whole of itself to the slope, as it always did. */
const MIN_FLIGHT = 0.6;

/**
 * The longest flight a corridor of this length can hold — its length less both landings.
 *
 * THE ONE OWNER of that number: the composer divides a rolled drop by it to keep the grade
 * under ELEVATION_MAX_GRADE. Deliberately the SHORTEST run any shape will spend the fall
 * over — a 'full' stair uses more of the corridor than this, so it can only come out
 * gentler than the cap, never steeper. Conservative in the one direction that matters.
 */
export function maxFlightRun(corridorLen: number): number {
  return Math.max(MIN_FLIGHT, corridorLen - 2 * MIN_LANDING);
}

/**
 * A flight of stairs: the fall, and the stone that carries it.
 *
 * `t0`/`t1` are FRACTIONS of the corridor's travel axis, 0 at the low-coordinate end. Stated
 * as fractions rather than world metres so the descriptor survives a rect being moved or a
 * floor being rebuilt from the same spec.
 */
export type StairShapeId = 'full' | 'flight';

export interface StairFlight {
  /**
   * WHICH SHAPE OF STAIR.
   *
   *   'full'   — the corridor IS a staircase, mouth to mouth, bar a footing at each end.
   *   'flight' — level landing, a compact flight, level landing.
   *
   * A word, so the decor, light and content layers can ask what a passage IS rather than
   * comparing its numbers — the whole reason corridor-types.ts exists.
   */
  shape: StairShapeId;
  /** Metres the flight falls, always positive. */
  fall: number;
  /** Length of the FLIGHT — not of the corridor. */
  run: number;
  /** fall / run. What makes it read as a stair rather than a slope. */
  grade: number;
  /** Rise per tread. `fall / steps`, so the flight always ends on a whole step. */
  rise: number;
  /** Tread depth. `run / steps`. */
  going: number;
  /** Whole treads, at least one. */
  steps: number;
  /** Where the flight sits along the corridor, as fractions of its travel axis. */
  t0: number;
  t1: number;
}

/**
 * Plan the stair for a corridor that falls `fall` metres over `corridorLen`.
 *
 * Returns null for a corridor that does not fall — a level passage is not a stair with zero
 * steps, it is a different thing, and callers should be able to ask `if (stair)`.
 *
 * A FLIGHT is centred. A landing at both mouths is what the threshold wants, and centring is
 * the only placement that guarantees one at each without asking which end the player arrives
 * from — which a corridor cannot know, since it is walked in both directions.
 */
export function planFlight(fall: number, corridorLen: number): StairFlight | null {
  const drop = Math.abs(fall);
  if (drop < 1e-4 || corridorLen <= 0) return null;

  // Whole treads at the section's rise, then the real rise from the count. At least one:
  // a fall smaller than a single tread is one shallow step, not zero steps.
  const steps = Math.max(1, Math.round(drop / TARGET_RISE));
  const rise = drop / steps;

  // WOULD THE WHOLE CORRIDOR READ AS A STAIRCASE? Then let it be one.
  const fullRun = Math.max(MIN_FLIGHT, corridorLen - 2 * THRESHOLD);
  const shape: StairShapeId = drop / fullRun >= MIN_FULL_GRADE ? 'full' : 'flight';

  // A flight takes the run its grade asks for, clamped to what the corridor can lend it.
  // When the corridor is too short it takes everything and comes out gentler — the same
  // degradation the fixed-apron ramp had, and the composer's grade cap is set against that
  // same number so it can never come out steeper than the budget.
  const run = shape === 'full'
    ? fullRun
    : Math.min(maxFlightRun(corridorLen), Math.max(MIN_FLIGHT, drop / TARGET_GRADE));

  const half = run / 2;
  const mid = corridorLen / 2;
  return {
    shape,
    fall: drop,
    run,
    grade: drop / run,
    rise,
    going: run / steps,
    steps,
    t0: Math.max(0, (mid - half) / corridorLen),
    t1: Math.min(1, (mid + half) / corridorLen),
  };
}

// ── THE CREASE WAS NEVER A CEILING PROBLEM ───────────────────────────────────
//
// Josh: *"the corridor ceiling doesnt follow the stair but is straight then sudden drop then
// straight again"* — and later *"the ceiling should slowly descend with the stairs."*
//
// The first fix raked the ceiling into one straight plane, which removed the creases by
// refusing to follow the floor at all, and paid for it in headroom. The second attempt
// rounded the CEILING's knees while leaving the floor's sharp — and the suite caught it
// immediately: the two profiles were no longer parallel, so a flight pinched to 2.54m under
// a 3.00m section.
//
// Both were treating a floor defect at the ceiling. The floor is what has the corners in
// it: flat landing, then a hard angle into the rake, then a hard angle back. A ceiling built
// at `floor + H` inherits them because they are really there.
//
// So the ROUNDING GOES IN THE FLOOR, where the corners are. Each knee becomes a quadratic
// whose value and slope match the flat and the rake either side, so the ground eases into
// the descent the way a stair's bottom nosing eases into its landing. The ceiling then goes
// back to being the simplest thing it could ever have been — the floor plus the section's
// height, exactly parallel, headroom constant everywhere — and it has no creases because
// there are none left to inherit.

/** How far either side of a knee the ceiling curves, metres. About a stride: long enough to
 *  read as a curve rather than a corner, short enough that the flight's headroom is honest
 *  over nearly all of it. */
const KNEE_BLEND_M = 0.7;

/**
 * How far a ramp has fallen at `t` (0..1 along the corridor), as a fraction of its total —
 * 0 at the top, 1 at the bottom — with the two knees ROUNDED.
 *
 * `t0`/`t1` bound the sloping part; outside them the ground is level. Used by the elevation
 * field for EVERY ramp, whether the slope was placed by a planned flight or by the legacy
 * fixed apron, because a hand-authored corridor's corners crease exactly as hard.
 *
 * C1 by construction: each corner is replaced by a quadratic whose value and slope match the
 * flat and the rake at either end of the blend, so there is no angle anywhere in it. The
 * middle of the rake keeps its full slope, so rounding costs the grade budget nothing.
 */
export function roundedRampProfile(
  t: number, t0: number, t1: number, corridorLen: number,
): number {
  const span = t1 - t0;
  if (span <= 1e-6) return t <= t0 ? 0 : 1;
  const k = 1 / span;                       // slope of the rake, in fraction-per-t
  // Blend half-width, clamped so the two knees cannot overlap each other AND cannot reach
  // the corridor's mouths. That second clamp is not tidiness: the ground at a mouth has to be
  // EXACTLY the elevation of the room it opens into — the corridor floor meets the room floor
  // there, and tests/elevation.test.ts holds the seam to the metre. An ease that ran to the
  // edge left it 1.3mm low, which is a hairline of void at every threshold. Half the landing
  // stays dead flat.
  const b = Math.min(
    corridorLen > 0 ? KNEE_BLEND_M / corridorLen : 0,
    span / 2, t0 / 2, (1 - t1) / 2,
  );
  if (b <= 1e-9) {
    return t <= t0 ? 0 : t >= t1 ? 1 : (t - t0) * k;
  }
  if (t <= t0 - b) return 0;
  if (t < t0 + b) { const u = t - (t0 - b); return (k * u * u) / (4 * b); }
  if (t <= t1 - b) return (t - t0) * k;
  if (t < t1 + b) { const u = (t1 + b) - t; return 1 - (k * u * u) / (4 * b); }
  return 1;
}
