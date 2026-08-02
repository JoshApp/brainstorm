// The FILL stage — resolve dumb content markers into concrete DEFINING content
// (docs/FLOOR-DIRECTOR.md, step 2). A marker says only WHERE (+ focal/facing);
// the room's ROLE says the category it may hold; the BUDGET says how much / how
// rare; this module COMBINES them. Pure + deterministic: same (spots, budget,
// depth, seed) → same placement, so floors replay and headless sweeps reproduce.
//
// This is L4D's model: the vault hand-places candidate spots, the director picks
// which one actually gets the reward this run — "staged but varied".

import type { FloorRoles } from './floor-roles';
import { rollDropItem } from '../content/drop-tables';
import type { ItemSpec, Rarity } from '../content/items';

/** A harvested content marker in world space, ready for the fill to resolve. */
export interface ContentSpot {
  x: number;
  z: number;
  roomId: string;
  /** The room's built-around hero spot (a dais) vs an ordinary spot. */
  focal: boolean;
  /** Yaw the content should face (radians), if the marker declared one. */
  facing?: number;
}

/** A resolved defining find — a staged reward the composer emits as a chest. */
export interface DefiningFind {
  x: number;
  z: number;
  roomId: string;
  facing?: number;
  loot: ItemSpec;
  /** The marker this find claimed — so the director can keep the deal off it. */
  spot: ContentSpot;
}

/** The deal kinds the FILL stage may stage for the floor's QUESTION. Shallow
 *  ones are survivable-bad; deep ones are run-threatening gambles. */
export type DealKind = 'fountain' | 'tithe-basin' | 'altar' | 'blood-altar';

/** A resolved staged deal — the floor's one QUESTION, on a marker. */
export interface StagedDeal {
  x: number;
  z: number;
  roomId: string;
  kind: DealKind;
}

/** Deals split by tension: survivable-bad early, run-threatening deep. */
const SHALLOW_DEALS: readonly DealKind[] = ['fountain', 'tithe-basin'];
const DEEP_DEALS: readonly DealKind[] = ['blood-altar', 'altar'];

/** Keep staged content this far from an AVOID point (the fire, another beat) so a
 *  reward chest never lands jammed against the bonfire (#69). Mirrors the
 *  loot-director's event clearance. */
const AVOID_CLEARANCE = 3.0;

/** Points the staged content should stand clear of (the fire, an already-placed
 *  beat). Empty = no constraint. */
export type AvoidPoint = { x: number; z: number };

/** Min distance from `s` to any avoid point (Infinity when there are none). */
function clearOf(s: { x: number; z: number }, avoid: readonly AvoidPoint[]): number {
  let m = Infinity;
  for (const a of avoid) m = Math.min(m, Math.hypot(s.x - a.x, s.z - a.z));
  return m;
}

/**
 * Stage the floor's ONE question (a deal) onto a marker. Mirrors
 * {@link fillDefiningFind}: eligible = a `spot` in an EVENT-permitting room,
 * focal preferred, and never the spot already taken by the find (`exclude`).
 * The KIND is chosen from `allowed` (the director's variety-filtered set),
 * biased by depth toward survivable (shallow) or run-threatening (deep). Returns
 * null when there's no budget-allowed kind or no eligible marker.
 */
export function fillQuestion(
  spots: readonly ContentSpot[],
  roles: FloorRoles,
  allowed: readonly DealKind[],
  depth: number,
  deepDepth: number,
  rand: () => number,
  exclude?: ContentSpot | null,
  avoid: readonly AvoidPoint[] = [],
): StagedDeal | null {
  if (allowed.length === 0) return null;

  let eligible = spots.filter(
    (s) => roles.caps(s.roomId).allowEvent && s !== exclude,
  );
  if (eligible.length === 0) return null;

  // Keep the deal clear of the fire / the find (a deal jammed against the
  // bonfire reads as a pile) — but only if some spot stays eligible after.
  if (avoid.length > 0) {
    const clear = eligible.filter((s) => clearOf(s, avoid) >= AVOID_CLEARANCE);
    if (clear.length > 0) eligible = clear;
  }

  // SMART PLACEMENT (not blind dedup): don't drop the floor's question into the
  // SAME ROOM as its reward (the find) — a chest and a fountain crammed together
  // reads as a pile, and the two beats stop being separate decisions. Prefer any
  // other room; only fall back to the find's room if the floor has nowhere else,
  // and even then require real spacing from the find's spot so they don't overlap.
  if (exclude) {
    const otherRoom = eligible.filter((s) => s.roomId !== exclude.roomId);
    if (otherRoom.length > 0) {
      eligible = otherRoom;
    } else {
      const MIN_SEP2 = 4 * 4;   // ≥4m apart when forced to share the find's room
      const spaced = eligible.filter(
        (s) => (s.x - exclude.x) ** 2 + (s.z - exclude.z) ** 2 >= MIN_SEP2,
      );
      if (spaced.length > 0) eligible = spaced;
    }
  }

  const focal = eligible.filter((s) => s.focal);
  const pool = focal.length > 0 ? focal : eligible;
  const spot = pool.length === 1 ? pool[0] : pool[Math.floor(rand() * pool.length)];

  // Prefer the depth-appropriate tension band; fall back to whatever's allowed.
  const band = depth >= deepDepth ? DEEP_DEALS : SHALLOW_DEALS;
  const preferred = allowed.filter((k) => band.includes(k));
  const from = preferred.length > 0 ? preferred : allowed;
  const kind = from[Math.floor(rand() * from.length)];

  return { x: spot.x, z: spot.z, roomId: spot.roomId, kind };
}

/**
 * Stage the floor's ONE defining find, if the budget grants one AND the floor
 * offers an eligible marker. Eligible = a `spot` in a room whose role permits
 * loot; FOCAL spots are strongly preferred (the reward lands on the dais, not a
 * corner). Returns null when there's no budget or no eligible spot — the find
 * simply doesn't appear (scarcity by marker count, never a forced drop into a
 * random cell).
 *
 * Consumes rand() deterministically: one draw to pick the spot (only when there
 * are ties to break), then the loot roll.
 */
export function fillDefiningFind(
  spots: readonly ContentSpot[],
  roles: FloorRoles,
  budget: { definingFind: boolean; minRarity: Rarity },
  depth: number,
  rand: () => number,
  avoid: readonly AvoidPoint[] = [],
): DefiningFind | null {
  if (!budget.definingFind) return null;

  let eligible = spots.filter((s) => roles.caps(s.roomId).allowLoot);
  if (eligible.length === 0) return null;

  // Keep the reward CLEAR of the fire (a chest crammed against the bonfire reads
  // as a pile). Prefer spots ≥ clearance; a room forced to share with the fire
  // now carries an offset marker (vault-compose), so "clear" usually still holds.
  if (avoid.length > 0) {
    const clear = eligible.filter((s) => clearOf(s, avoid) >= AVOID_CLEARANCE);
    if (clear.length > 0) eligible = clear;
  }

  // A reward chest is a SECONDARY read — the centre of a room is the event's, not
  // the loot's (#69). So prefer the varied off-centre SECONDARY spots and pick one
  // at random for run-to-run variety (#72); fall back to a focal cell only when a
  // room offers no secondary (tiny rooms, event rooms with a single clear marker).
  const secondary = eligible.filter((s) => !s.focal);
  const pool = secondary.length > 0 ? secondary : eligible;
  const spot = pool.length === 1 ? pool[0] : pool[Math.floor(rand() * pool.length)];

  // The 'defining-find' pool (drop-tables.ts) owns the bias / rarity floor /
  // gear-only filter now — a potion is never a defining find, and the reward
  // scales with depth. A null roll (empty band) means no find.
  const loot = rollDropItem('defining-find', depth, rand);
  if (!loot) return null;

  return { x: spot.x, z: spot.z, roomId: spot.roomId, facing: spot.facing, loot, spot };
}
