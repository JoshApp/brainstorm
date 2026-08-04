// THE FLOOR PLAN — what a floor OWES you, decided before any geometry exists.
//
// The old order was backwards: build a spine, see what rooms came out, then hand
// content to whatever qualified. That makes a floor's content a CONSEQUENCE OF
// ITS SHAPE — if a seed happened to grow no dead-end spur, it got no trove, and
// nobody decided that. The manifest is the other way round: it states the
// contract first, and placement's job is to satisfy it.
//
// (floor-manifest.ts already said this in its own header — "PLAN the floor's
// content first, then place it" — and then only ever shipped the post-hoc
// culler. This is that missing step. The culler stays: it's the backstop for
// vault-baked set-pieces the plan didn't ask for.)
//
// ── WHAT A FLOOR OWES YOU ────────────────────────────────────────────
// Three slots, and the variety comes from WHICH thing fills each:
//
//   OFFER   — something to take or choose. Always present. The trove is the
//             dependable version, but a hoard of gold or a fistful of keys is
//             also an offer: the slot does not have to be POWER.
//   THREAT  — something that can kill you. The combat budget always covers this;
//             an arena / trap / ambush is the loud version.
//   MERCY   — something that gives back without asking. A fire, coin, borrowed
//             life. MAY ROLL EMPTY, deliberately: a floor that gives nothing
//             back is what makes the next fire matter, and it's the difference
//             between a LEAN floor and a boring one.
//
// ── WHERE THINGS WANT TO SIT ─────────────────────────────────────────
// Placement is a PREFERENCE THAT GETS SCORED, not a hard category — except
// where the mechanism itself demands one. Four pressures decide it:
//
//   1. Is it a destination you CHOOSE? Then it wants a leaf: the value is the
//      detour, and on the through-path you didn't choose it, you just crossed it.
//   2. Does it want uninterrupted attention? Browsing a vendor or surveying
//      three plinths is a decision made standing still.
//   3. Does it change the room's RULES? An arena seals — a sealed passthrough
//      would block your route.
//   4. Is it spatially greedy? Three plinths need real floor.
//
// And the inverse matters just as much: a FIRE is better stumbled into than
// routed to (Dark Souls puts them on the path — the "thank god" is the surprise),
// and a TRAP on a dead end is a trap nobody springs.

import { actForDepth } from './acts';
import type { RoomTypeId } from './room-types';

/** What a slot is FOR. See the contract above. */
export type SlotRole = 'offer' | 'threat' | 'mercy';

/**
 * Where a piece of content wants to sit.
 *
 * `dedicated` — its own room, strongly prefers a dead-end leaf.
 * `anywhere`  — a passthrough is fine, and often better.
 * `on-path`   — must be crossable. Unavoidability IS the mechanism: a toll you
 *               can walk around is not a toll, and a trap nobody springs is
 *               scenery. Note this is a preference for the THROUGH-ROUTE, not a
 *               ban on events — a trap guarding a reward is still on the path to
 *               that reward.
 */
export type Placement = 'dedicated' | 'anywhere' | 'on-path';

export interface PlanEntry {
  /** The room type that stages this, when it claims a whole room. */
  id: RoomTypeId;
  role: SlotRole;
  placement: Placement;
  /** Earliest depth this may appear. */
  minDepth: number;
  /** Relative weight within its slot's pool. */
  weight: number;
  /**
   * Roughly what claiming this is WORTH to the player. A toll has to be smart
   * about what it gates — pricing a doorway in front of nothing is a tax, and
   * pricing it in front of a trove is a decision. The toll pass reads this to
   * set (or refuse) a price.
   */
  worth: number;
}

/** Everything a floor has decided to contain, before a single room exists. */
export interface FloorPlan {
  /** Always present, in slot order. The floor is not valid without these. */
  required: PlanEntry[];
  /** Rolled extras — 0-2, depth-gated. */
  rolled: PlanEntry[];
  /** Convenience: required + rolled. */
  all: PlanEntry[];
}

// ── THE POOL ─────────────────────────────────────────────────────────
// A content/design layer reshapes floor feel by editing THIS, not a build pass.

/**
 * The trove — three things on stone, take one.
 *
 * ONCE PER ACT, not once per floor. A guarantee you meet every single floor
 * stops being a beat and becomes a checkpoint: you know it's coming, you know
 * roughly what it holds, and the reward stream flattens into a metronome (the
 * audit's CoV flag). Once an act, it's an event you look forward to.
 *
 * The OFFER slot itself is still guaranteed every floor — the trove just isn't
 * the only thing that can fill it. A bargain, a hoard, a shop: anything that
 * puts something in front of you and asks a question of you counts.
 */
const TROVE: PlanEntry = {
  id: 'trove', role: 'offer', placement: 'dedicated', minDepth: 1, weight: 1, worth: 3,
};

/** The fallback OFFER for floors that aren't the act's trove floor. A staged
 *  bargain is the same promise in a different shape: something in front of you,
 *  and a question about it. */
const BARGAIN_OFFER: PlanEntry = {
  id: 'feature', role: 'offer', placement: 'anywhere', minDepth: 1, weight: 1, worth: 2,
};

/**
 * Is this the act's trove floor? Derived from the act's own depth list rather
 * than tracked in run state — the plan is PURE, and a floor must be able to
 * decide this on its own from `depth` alone.
 *
 * The act's FIRST non-boss floor — so floor 1 of the run always has one. You
 * arrive with nothing; the run should hand you its first real decision straight
 * away rather than making you earn a floor before it's allowed to matter. It
 * also front-loads each act: you pick your direction, then spend the act
 * finding out whether you were right.
 */
export function isTroveFloor(depth: number): boolean {
  const act = actForDepth(depth);
  const nonBoss = act.depths.filter((d) => d !== act.bossDepth);
  if (nonBoss.length === 0) return false;
  return depth === nonBoss[0];
}

/**
 * The rolled pool. Note the placements, because they're the design:
 *   shop   — dedicated. You never fight beside a vendor, and browsing is a
 *            decision made standing still.
 *   arena  — dedicated. It SEALS; a sealed through-room blocks your route.
 *   trap   — ON-PATH. A trap on a spur is a trap nobody springs. It wants a
 *            place a trap actually works: a crossing you have to make, or the
 *            approach to something you want.
 *   feature— anywhere. A bargain is an encounter you MEET, not a place you visit.
 *   sanctum— anywhere, and rare. A fire is better stumbled into than routed to;
 *            the dedicated shrine-room version is the exception, not the rule.
 */
const POOL: readonly PlanEntry[] = [
  { id: 'shop',    role: 'offer',  placement: 'dedicated', minDepth: 2, weight: 3, worth: 3 },
  { id: 'arena',   role: 'threat', placement: 'dedicated', minDepth: 3, weight: 2, worth: 3 },
  { id: 'trap',    role: 'threat', placement: 'on-path',   minDepth: 2, weight: 3, worth: 2 },
  { id: 'sanctum', role: 'mercy',  placement: 'anywhere',  minDepth: 2, weight: 3, worth: 2 },
];

/** How many extras a floor rolls. Two is the ceiling on purpose: the trove plus
 *  two is already three landmarks, and past that a floor stops having ordinary
 *  rooms for them to stand against. */
const EXTRA_CHANCE_TWO = 0.45;

/**
 * Decide what this floor contains. PURE — rand injected, no geometry, no scene —
 * so a floor's contract is deterministic per seed and unit-testable on its own,
 * which is the whole point of deciding it before the rooms exist.
 *
 * A boss floor plans NOTHING: the boss is the floor's offer, threat and mercy at
 * once, and anything else on the way in competes with it.
 */
export function planFloor(
  depth: number,
  rand: () => number,
  opts: { isBossFloor?: boolean } = {},
): FloorPlan {
  if (opts.isBossFloor) return { required: [], rolled: [], all: [] };

  // The offer slot is always filled; WHICH thing fills it is the variety.
  const required = [isTroveFloor(depth) ? TROVE : BARGAIN_OFFER];
  const rolled: PlanEntry[] = [];

  const eligible = POOL.filter((e) => depth >= e.minDepth);
  const want = rand() < EXTRA_CHANCE_TWO ? 2 : 1;
  const used = new Set<RoomTypeId>();

  for (let i = 0; i < want; i++) {
    const open = eligible.filter((e) => !used.has(e.id));
    if (open.length === 0) break;
    const total = open.reduce((s, e) => s + e.weight, 0);
    let roll = rand() * total;
    let chosen = open[open.length - 1];
    for (const e of open) { roll -= e.weight; if (roll <= 0) { chosen = e; break; } }
    used.add(chosen.id);
    rolled.push(chosen);
  }

  return { required, rolled, all: [...required, ...rolled] };
}

/** Entries that want their own room on a dead-end spur. */
export function dedicatedEntries(plan: FloorPlan): PlanEntry[] {
  return plan.all.filter((e) => e.placement === 'dedicated');
}

/** How many dead-end spurs the geometry must provide to satisfy this plan. The
 *  layout pass reads this and GROWS that many branches, instead of growing one
 *  and hoping — which is what left floors without a trove. */
export function requiredLeafCount(plan: FloorPlan): number {
  return dedicatedEntries(plan).length;
}
