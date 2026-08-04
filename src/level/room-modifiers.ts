// ROOM MODIFIERS — what HAPPENS around a room's centrepiece.
//
// Layer 3 of the room model (level/room-types.ts): identity says WHAT a room is,
// the centrepiece is the one notable thing in it, and a modifier is what the
// room DOES to you while you're there. A modifier never replaces identity — the
// fountain room whose doors seal and fill with the dead is `feature + ambush`,
// not a separate room type. That's what keeps the vocabulary small while the
// floors stay varied.
//
// Two rules make this readable instead of soup:
//
//   1. The TYPE decides what it tolerates, not the budget. `acceptsModifier` is
//      the gate, and a refusal is absolute — a shop takes none, ever, no matter
//      how badly a floor wants another beat.
//   2. ONE modifier per room, and only a couple of rooms per floor. A room the
//      player can name ("the dark one", "the one that sealed") is a memory; a
//      room that is dark AND trapped AND contested is noise.
//
// PURE — rand injected, no scene — so a floor's danger is deterministic per seed
// and unit-testable alongside role assignment.

import { acceptsModifier, roomType, type Centrepiece, type RoomModifier, type AppliedModifier } from './room-types';
import type { FloorRoles, RoomNode } from './floor-roles';

/**
 * Modifiers something downstream actually EXPRESSES. The type table declares
 * tolerance for more than this on purpose (it's a design vocabulary), but
 * assigning one nothing renders would be a silent no-op — a room that claims to
 * be dangerous and simply isn't. So assignment draws from here, and adding an
 * expression means adding its kind to this list.
 *
 * NOT here yet: `toll` (the way in is priced) and `gated` (sealed until an
 * offering is made elsewhere). Both need a PRICED THRESHOLD — a doorway that
 * refuses you until you pay it — which the chest-bound gate machinery (#74)
 * doesn't provide. That's its own pass, not a bolt-on.
 */
export const WIRED_MODIFIERS: readonly RoomModifier[] = ['ambush', 'contested', 'hazard', 'dark'];

/**
 * Centrepieces something can actually GUARD. `contested` fires when you reach
 * for the room's notable thing, so it needs an ACT to intercept — an offering
 * you take, a chest you open, a fire you sit at. Resting counts, and it's the
 * best one: you are never more committed than in the second you decide to mend.
 * A staircase has no such act, and a bargain already charges you its own way.
 */
const GUARDABLE: ReadonlySet<Centrepiece> = new Set<Centrepiece>(['offerings', 'hazard', 'fire']);

/** At most this many rooms on a floor carry a modifier. Restraint IS the
 *  feature: a floor where every room does something has no rooms that do. */
const MAX_MODIFIED_ROOMS = 2;

/** What may be rolled, from what depth, at what relative weight. Floor 1 rolls
 *  nothing at all — the first descent teaches the shape of a room before the
 *  dungeon starts breaking it. */
const ROLLED: ReadonlyArray<{ kind: RoomModifier; minDepth: number; weight: number }> = [
  { kind: 'dark',      minDepth: 2, weight: 3 },
  { kind: 'hazard',    minDepth: 2, weight: 3 },
  { kind: 'ambush',    minDepth: 3, weight: 4 },
  // The one that costs you for reaching. Deep only — early on you're still
  // learning that a reward can be a trap.
  { kind: 'contested', minDepth: 5, weight: 3 },
];

/** How many waves answer a seal, by depth. Kept small — a modifier is a beat,
 *  not the arena room's whole gauntlet. */
function wavesFor(depth: number): number {
  return Math.max(1, Math.min(3, 1 + Math.floor(depth / 5)));
}

export interface ModifierPlan {
  /** roomId → the one modifier it carries. Rooms absent from this carry none. */
  byRoom: ReadonlyMap<string, AppliedModifier>;
}

/**
 * Lay 0-2 modifiers onto a floor's rooms.
 *
 * `contested` is special-cased in candidate selection: "reach for it and answer
 * for it" is meaningless in a room with nothing to reach for, so it only lands
 * where a centrepiece stands. Everything else prefers a room the player will
 * walk THROUGH — a modifier on a dead-end spur is one many runs never meet.
 */
export function assignModifiers(
  roles: FloorRoles,
  nodes: readonly RoomNode[],
  opts: { depth: number; rand: () => number; isBossFloor?: boolean },
): ModifierPlan {
  const byRoom = new Map<string, AppliedModifier>();
  // A boss floor's beat is the boss. Nothing else gets to interrupt the walk in.
  if (opts.isBossFloor) return { byRoom };

  const pool = ROLLED.filter(
    (r) => opts.depth >= r.minDepth && WIRED_MODIFIERS.includes(r.kind),
  );
  if (pool.length === 0) return { byRoom };

  const howMany = opts.rand() < 0.40 ? MAX_MODIFIED_ROOMS : 1;
  const used = new Set<RoomModifier>();

  for (let i = 0; i < howMany; i++) {
    const open = pool.filter((r) => !used.has(r.kind));
    if (open.length === 0) break;

    // Weighted pick FIRST, then find a room that will take it. Picking the room
    // first and then asking what it tolerates biases every floor toward whatever
    // the most permissive room type happens to be.
    const total = open.reduce((s, r) => s + r.weight, 0);
    let roll = opts.rand() * total;
    let chosen = open[open.length - 1];
    for (const r of open) { roll -= r.weight; if (roll <= 0) { chosen = r; break; } }

    const eligible = nodes.filter((n) => {
      if (byRoom.has(n.roomId)) return false;                     // one per room
      const role = roles.role(n.roomId);
      if (!acceptsModifier(role, chosen.kind)) return false;
      if (chosen.kind === 'contested') return GUARDABLE.has(roomType(role).centrepiece);
      return true;
    });
    used.add(chosen.kind);
    if (eligible.length === 0) continue;

    // Busiest room first — a modifier on a through-room is one the run meets.
    const ranked = eligible.slice().sort((a, b) => b.connections - a.connections);
    const pick = ranked[0];
    const applied: AppliedModifier = { kind: chosen.kind };
    if (chosen.kind === 'ambush' || chosen.kind === 'contested') {
      applied.waves = wavesFor(opts.depth);
    }
    byRoom.set(pick.roomId, applied);
  }

  return { byRoom };
}
