import type { Centrepiece } from './room-types';

// ── WHERE LIGHT GOES, DECIDED AFTER THE ROOM IS FURNISHED ────────────────────
//
// The old order placed sconces from WALL GEOMETRY ALONE, before anything was in
// the room. That can only ever answer "where could a bracket hang", which is not
// a question anybody in the game is asking. It produced rooms lit evenly around
// their perimeter with the one thing worth seeing sitting in the middle at the
// same brightness as a pot.
//
// This runs LAST instead, and asks the only question that matters:
//
//     WHAT IN THIS ROOM SHOULD THE PLAYER SEE, AND WHAT SHOULD THEY NOT?
//
// The dungeon's baseline is darkness (CLAUDE.md). The player's lamp is the
// baseline everywhere. So ANY light the room itself provides is a claim that
// something is there — and if we spend that claim on decoration, we've spent
// the only vocabulary we had for "something is happening here".
//
// ── THE RULES ────────────────────────────────────────────────────────
//
// 1. ONE FOCAL PER ROOM, AND ONLY IF THE ROOM HAS A FOCUS. The brightest thing
//    in a room is the thing the room is about. A room with no centrepiece gets
//    no focal light — it is not a lesser room, it is a DARK room, which is what
//    most of this dungeon is.
//
// 2. THE FOCAL'S SHAPE FOLLOWS WHAT IT MARKS (see FOCUS_LIGHT). A trove earns a
//    shaft because a god ray must anchor content and a trove is the definition
//    of content; a merchant earns a warm pool because a shop is TENDED; a hazard
//    earns a floor pool because danger belongs on the floor you have to cross.
//
// 3. THE WAY ON IS ALWAYS FINDABLE. The descent gets a light. On a phone, in the
//    dark, hunting for the stair is not tension, it is a chore.
//
// 4. SHADOW IS DECLARED, NOT LEFT OVER. An ambush only works if the ambush is in
//    the dark, so callers pass the places that MUST stay unlit and every fixture
//    respects them. This is the rule that makes the system a system: without it
//    "add light where it's interesting" quietly lights the thing hiding.
//
// 5. THE FOCAL OUTSHINES EVERYTHING. Enforced by construction — wash fixtures
//    are clamped below the focal. Otherwise rule 1 is a comment, not a design:
//    four wall sconces at 0.85 drown one shaft at 0.8 and the room reads flat.
//
// 6. COLOUR IS A PROMISE. The tint comes from what's being lit, so a hue the
//    player learns to read (gold = an offer, red = it will cost you) means the
//    same thing on every floor.
//
// Pure: no THREE, no scene, no RNG of its own. A room's lighting is a function
// of its contents, which is what makes it testable and what lets a content layer
// retune the whole dungeon's feel by editing FOCUS_LIGHT.

export type LightRole =
  /** The one thing the room is about. At most one per room. */
  | 'focal'
  /** The way on. Wayfinding, not decoration. */
  | 'threshold'
  /** The dim minimum so a room isn't an unreadable void. Always dimmest. */
  | 'wash';

export type LightShape =
  /** A point on a wall — the workhorse. */
  | 'sconce'
  /** A glow on the floor under something. Reads as the FLOOR mattering. */
  | 'pool'
  /** A shaft from above. Anchors; never decorates. */
  | 'shaft'
  /** A standing point source on the floor, for a room with no wall to use. */
  | 'brazier';

export interface Fixture {
  role: LightRole;
  shape: LightShape;
  x: number;
  z: number;
  /** Mount height for a sconce; 0 for floor-standing shapes. */
  height: number;
  /** Exact bracket facing for a sconce on a non-axial wall. */
  rotY?: number;
  wall?: 'N' | 'S' | 'E' | 'W';
  /** Relative brightness. A focal is always strictly the brightest in its room. */
  intensity: number;
  color: number;
}

/** A wall bracket the room could hang something on. Shape-compatible with the
 *  TorchSpec the sconce pass already produces, so callers hand theirs straight in. */
export interface Mount {
  x: number; z: number; height: number;
  rotY?: number; wall: 'N' | 'S' | 'E' | 'W';
}

export interface LightSubject {
  /** What the room is ABOUT, if anything. No focus → no focal light. */
  focus?: { x: number; z: number; kind: Centrepiece };
  /** The stair down, if this room holds it. Always gets marked (rule 3). */
  descent?: { x: number; z: number };
  /** Circles that must stay dark — ambush pockets, a `dark` room's interior.
   *  Vetoes any fixture whose position falls inside (rule 4). */
  shadow?: ReadonlyArray<{ x: number; z: number; r: number }>;
  /** Brackets available for sconces, best-first. */
  mounts: ReadonlyArray<Mount>;
  /** Room floor area, m². Drives the wash budget. */
  area: number;
  /** Ceiling height — a shaft needs headroom to read as a shaft. */
  height: number;
  /**
   * Somewhere a STANDING light can go if every other rule declines.
   *
   * Two real rooms end up with nothing otherwise, and both are silent:
   *   - a `dark` room whose one door-side bracket falls inside an ambush's
   *     shadow, so rule 4 vetoes the only light rule 5 was going to allow;
   *   - a cavern or tomb with 28 short edges and no wall run long enough to
   *     hang a bracket on at all.
   * Zero light is not the same as a dark room. A dark room is a decision the
   * player can read; an unlit one is indistinguishable from the end of the
   * world, and they will stand at the threshold wondering if it is broken.
   *
   * The caller must supply a point that is NOT in shadow (the room's mouth
   * works: an ambush is chosen out of the mouth's sightline by construction).
   */
  fallback?: { x: number; z: number };
}

// ── THE TABLE A CONTENT LAYER RETUNES ────────────────────────────────

const GOLD = 0xffc257;      // an offer. The one hue the dungeon's palette never makes.
const EMBER = 0xff9a3c;     // fire, warmth, mercy.
const BLOOD = 0xd03a2a;     // it will cost you.
const MOON = 0xb8c8ff;      // something older than the dungeon is getting in.
const SICK = 0x7fd08a;      // wrong.

/**
 * What each kind of centrepiece does to the light around it.
 *
 * `shapes` is ordered: the first that the room can physically support wins, so a
 * trove in a low room falls back from a shaft to a pool rather than growing a
 * shaft through a 2.8m ceiling.
 */
const FOCUS_LIGHT: Partial<Record<Centrepiece, {
  shapes: readonly LightShape[]; color: number; intensity: number;
}>> = {
  // Three things on stone, take one. The clearest "content is HERE" in the game.
  offerings: { shapes: ['shaft', 'pool'], color: GOLD, intensity: 1.0 },
  // A living vendor. Tended, lit from his own lamp, warm.
  merchant:  { shapes: ['pool', 'brazier'], color: EMBER, intensity: 0.85 },
  // The gauntlet's summoning circle. Cold and wrong before it starts.
  gauntlet:  { shapes: ['pool'], color: SICK, intensity: 0.8 },
  // A prize ringed by spikes. The DANGER is the floor, so light the floor.
  hazard:    { shapes: ['pool'], color: BLOOD, intensity: 0.8 },
  // The fire lights itself — anything we add competes with it.
  fire:      { shapes: [], color: EMBER, intensity: 0 },
  // The way down. Marked, never dressed up.
  descent:   { shapes: ['sconce'], color: MOON, intensity: 0.7 },
};

/** Wash: one dim bracket per this many m². Darkness is the baseline, so this is
 *  deliberately meaner than "enough to see by" — the lamp is what you see by. */
const WASH_PER_M2 = 34;
const WASH_MAX = 3;
/** A wash fixture may never come within this much of the focal's brightness. */
const WASH_CEILING = 0.55;
/** A shaft needs this much headroom or it reads as a lamp on a stick. */
const SHAFT_MIN_HEIGHT = 3.6;
/** How near a threshold sconce sits to the thing it marks. */
const THRESHOLD_INTENSITY = 0.55;

/**
 * Light a furnished room.
 *
 * Deterministic and total: same subject in, same fixtures out, and it never
 * throws — a room it can't light comes back with an empty list, which is a
 * legitimate room in this game.
 */
export function planRoomLight(subject: LightSubject): Fixture[] {
  const out: Fixture[] = [];
  const dark = (x: number, z: number): boolean =>
    (subject.shadow ?? []).some((s) => Math.hypot(s.x - x, s.z - z) < s.r);

  const used: Array<{ x: number; z: number }> = [];
  const tooClose = (x: number, z: number, gap: number): boolean =>
    used.some((u) => Math.hypot(u.x - x, u.z - z) < gap);

  const add = (f: Fixture): void => {
    if (dark(f.x, f.z)) return;
    out.push(f);
    used.push({ x: f.x, z: f.z });
  };

  // ── 1. THE FOCAL ───────────────────────────────────────────────────
  let focalIntensity = 0;
  const focus = subject.focus;
  const spec = focus ? FOCUS_LIGHT[focus.kind] : undefined;
  if (focus && spec) {
    for (const shape of spec.shapes) {
      // A shaft in a low room is a lamp on a stick, not a shaft of daylight.
      if (shape === 'shaft' && subject.height < SHAFT_MIN_HEIGHT) continue;
      if (shape === 'sconce') {
        const m = nearestMount(subject.mounts, focus.x, focus.z, dark);
        if (!m) continue;
        add({ role: 'focal', shape, x: m.x, z: m.z, height: m.height,
              rotY: m.rotY, wall: m.wall, intensity: spec.intensity, color: spec.color });
      } else {
        if (dark(focus.x, focus.z)) break;
        add({ role: 'focal', shape, x: focus.x, z: focus.z, height: 0,
              intensity: spec.intensity, color: spec.color });
      }
      focalIntensity = spec.intensity;
      break;
    }
  }

  // ── 2. THE WAY ON ──────────────────────────────────────────────────
  // Rule 3, and it is deliberately NOT conditional on the focal. A stair in an
  // otherwise-focal room still gets its own mark: "the thing here" and "the way
  // out" are two different pieces of information and the player needs both.
  if (subject.descent) {
    const m = nearestMount(subject.mounts, subject.descent.x, subject.descent.z, dark);
    if (m && !tooClose(m.x, m.z, 1.0)) {
      add({ role: 'threshold', shape: 'sconce', x: m.x, z: m.z, height: m.height,
            rotY: m.rotY, wall: m.wall,
            intensity: Math.min(THRESHOLD_INTENSITY, focalIntensity > 0 ? focalIntensity * 0.8 : THRESHOLD_INTENSITY),
            color: MOON });
    }
  }

  // ── 3. THE WASH ────────────────────────────────────────────────────
  // What's left of the budget, spread across the remaining brackets, clamped
  // strictly under the focal (rule 5). A room whose focal exists gets LESS wash,
  // not the same amount plus a highlight — otherwise the highlight is just one
  // more light in a lit room.
  const budget = Math.max(
    focalIntensity > 0 ? 0 : 1,
    Math.min(WASH_MAX, Math.round(subject.area / WASH_PER_M2)) - (focalIntensity > 0 ? 1 : 0),
  );
  const washIntensity = focalIntensity > 0
    ? Math.min(WASH_CEILING, focalIntensity * 0.6)
    : WASH_CEILING;

  for (const m of spreadMounts(subject.mounts, budget, used, dark)) {
    add({ role: 'wash', shape: 'sconce', x: m.x, z: m.z, height: m.height,
          rotY: m.rotY, wall: m.wall, intensity: washIntensity, color: 0 });
  }

  // ── 4. NOBODY GETS NOTHING ─────────────────────────────────────────
  // A standing light needs no wall and answers both ways a room can come out
  // black (see LightSubject.fallback). Dimmest thing in the room by definition.
  if (out.length === 0 && subject.fallback) {
    add({ role: 'wash', shape: 'brazier', x: subject.fallback.x, z: subject.fallback.z,
          height: 0, intensity: 0.45, color: 0 });
  }

  return out;
}

/** The lit bracket closest to a point, skipping any that fall in shadow. */
function nearestMount(
  mounts: ReadonlyArray<Mount>, x: number, z: number,
  dark: (x: number, z: number) => boolean,
): Mount | null {
  let best: Mount | null = null, bestD = Infinity;
  for (const m of mounts) {
    if (dark(m.x, m.z)) continue;
    const d = (m.x - x) ** 2 + (m.z - z) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/**
 * Pick `n` brackets as far from each other AND from what's already placed as
 * possible.
 *
 * Farthest-point sampling seeded with the fixtures already committed, so the
 * wash spreads AWAY from the focal instead of piling onto whichever wall
 * happened to be longest. That clustering is most of what makes procedural
 * lighting read as sprinkled rather than placed.
 */
function spreadMounts(
  mounts: ReadonlyArray<Mount>, n: number,
  placed: ReadonlyArray<{ x: number; z: number }>,
  dark: (x: number, z: number) => boolean,
): Mount[] {
  const pool = mounts.filter((m) => !dark(m.x, m.z)
    && !placed.some((p) => Math.hypot(p.x - m.x, p.z - m.z) < 1.0));
  const out: Mount[] = [];
  const anchors = [...placed];
  while (out.length < n && pool.length > 0) {
    let bestIdx = 0, bestD = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let nearest = Infinity;
      for (const a of anchors) nearest = Math.min(nearest, (pool[i].x - a.x) ** 2 + (pool[i].z - a.z) ** 2);
      if (nearest > bestD) { bestD = nearest; bestIdx = i; }
    }
    const pick = pool.splice(bestIdx, 1)[0];
    out.push(pick);
    anchors.push(pick);
  }
  return out;
}

/** Exported for the audit: is this plan legal? Returns the rule it breaks. */
export function lightPlanViolation(fixtures: readonly Fixture[]): string | null {
  const focals = fixtures.filter((f) => f.role === 'focal');
  if (focals.length > 1) return `${focals.length} focal lights in one room`;
  if (focals.length === 1) {
    const brightest = Math.max(...fixtures.map((f) => f.intensity));
    if (focals[0].intensity < brightest) {
      return `a ${fixtures.find((f) => f.intensity === brightest)!.role} outshines the focal`;
    }
  }
  return null;
}
