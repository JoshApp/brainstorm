// Floor roles — the resolveFloor seam (docs/FLOOR-DIRECTOR.md, step 1).
//
// A floor is a graph of rooms. Before anything is DRESSED into those rooms, we
// give each one a JOB — its role in the floor — and the build passes read that
// job instead of hardcoding "is this the start vault?" checks. The point is that
// floors compose DELIBERATELY: content goes where its role says it may, so a
// floor reads as designed rather than sprayed.
//
// This is intentionally DATA, not cleverness (CLAUDE.md: code is an interface
// between layers). To add a rule, flip a flag in ROLE_CAPS. To add a role, add a
// vocabulary entry + its caps. The passes never grow a new special-case; they
// ask a capability. That's how this stays extensible without a rewrite.
//
// Step 1 assigns entrance / combat / feature / finish / boss and leaves
// `sanctum` for the bonfire pass to DESIGNATE and `quiet` for a later pacing
// layer — both already carry caps so the seam is ready.

import { ROOM_TYPES, roomType, assignableTypes, type RoomTypeId } from './room-types';

/** The job a room does on its floor. This IS the room-type id — one vocabulary,
 *  not two that drift apart. See level/room-types.ts for what each one means and
 *  what it tolerates. */
export type RoomRole = RoomTypeId;

/** What a role PERMITS. The build passes read these; they don't read the role. */
export interface RoleCaps {
  /** The combat budget may seed enemies into this room's open cells. */
  allowCombat: boolean;
  /** A bonfire may rest here (the room contributes fire anchors + can be chosen). */
  allowBonfire: boolean;
  /** A deal / question may be staged here (event budget — step 3). */
  allowEvent: boolean;
  /** A defining find may be staged here (loot budget — step 2). */
  allowLoot: boolean;
  /** Higher = a better HOME for the floor's one bonfire. Combined with a
   *  dead-end bonus so the fire settles at the quiet end of a spur, not on the
   *  through-path. */
  bonfirePref: number;
}

// The caps are DERIVED from the room-type table (level/room-types.ts) — that
// table is the single source of truth for what a room is, what it may host, and
// what may happen in it. This projection exists so the existing build passes keep
// their narrow, familiar question ("may a fire rest here?") while richer passes
// read the type directly for its centrepiece and accepted modifiers.
//
// To change floor feel, edit ROOM_TYPES — not this.
export const ROLE_CAPS: Record<RoomRole, RoleCaps> = Object.fromEntries(
  (Object.keys(ROOM_TYPES) as RoomRole[])
    .map((role) => {
      const t = roomType(role);
      return [role, {
        allowCombat: t.enemies,
        allowBonfire: t.fire,
        allowEvent: t.event,
        allowLoot: t.minorLoot,
        bonfirePref: t.firePref,
      } satisfies RoleCaps];
    }),
) as Record<RoomRole, RoleCaps>;

/** Where a room sits on the spine — authoritative over vault tags, because
 *  middle vaults draw from a union pool and their tags are only hints (v3). */
export type RoomSlot = 'start' | 'mid' | 'end' | 'branch';

export interface RoomNode {
  roomId: string;
  /** The vault's authored tags (a hint for mids/branches; not trusted for ends). */
  tags: readonly string[];
  /** Structural position on the spine — the trusted signal for the ends. */
  slot: RoomSlot;
  /** Corridor connections. 1 = a dead-end spur (a good, quiet bonfire home). */
  connections: number;
}

export interface FloorRoles {
  role(roomId: string): RoomRole;
  caps(roomId: string): RoleCaps;
  /** bonfirePref for the room + a dead-end bonus. Used to pick the fire's home. */
  bonfireScore(roomId: string): number;
  /** The bonfire pass calls this once it settles on a room, so debug + later
   *  passes see the sanctum. Purely a re-tag; caps update with it. */
  designate(roomId: string, role: RoomRole): void;
  entries(): ReadonlyMap<string, RoomRole>;
}

function classify(node: RoomNode, opts: { isBossFloor: boolean }): RoomRole {
  switch (node.slot) {
    case 'start':
      return 'entrance';
    case 'end':
      return opts.isBossFloor ? 'boss' : 'finish';
    case 'branch':
      // Dead-end pockets are authored calm (treasure = loot, encounter = a
      // fountain/altar/lore beat). Both read as a `feature` room.
      return 'feature';
    case 'mid':
    default:
      // A deliberately-injected miniboss arena keeps its role (the tag IS trusted
      // here — composeFloor only stamps it on a slot it means as the elite stage).
      if (node.tags.includes('miniboss')) return 'miniboss';
      // A mid whose vault is a calm shape reads as feature; otherwise it's a
      // fight room. Tags are only a hint here, which is exactly what we want.
      if (node.tags.includes('treasure') || node.tags.includes('encounter')) return 'feature';
      return 'combat';
  }
}

/**
 * Assign a role to every room on the floor. Pure — no scene, no RNG — so it's
 * unit-testable (docs/LEVEL-PIPELINE.md: decisions live in a pure resolve step).
 */
export function assignFloorRoles(
  nodes: readonly RoomNode[],
  opts: { isBossFloor: boolean },
): FloorRoles {
  const roles = new Map<string, RoomRole>();
  const deadEnd = new Map<string, boolean>();
  for (const n of nodes) {
    roles.set(n.roomId, classify(n, opts));
    deadEnd.set(n.roomId, n.connections <= 1);
  }
  const roleOf = (id: string): RoomRole => roles.get(id) ?? 'combat';
  return {
    role: roleOf,
    caps: (id) => ROLE_CAPS[roleOf(id)],
    bonfireScore: (id) => ROLE_CAPS[roleOf(id)].bonfirePref + (deadEnd.get(id) ? 2 : 0),
    designate: (id, role) => { if (roles.has(id)) roles.set(id, role); },
    entries: () => roles,
  };
}

// ── Role-room assignment (the second pass) ───────────────────────────
// classify() above gives every room its STRUCTURAL job. This pass then promotes
// a FEW of the ordinary ones into role rooms — the floor's trove, its shop, an
// arena — from a small budget.
//
// The budget is the whole point. A landmark only reads as a landmark when most
// rooms aren't one, so this deliberately upgrades 1-3 rooms and leaves the rest
// as connective tissue. Isaac's own ratio is ~3-5 special against ~8-10 plain.

/** Rooms this pass may promote — the ones with no structural identity of their
 *  own. Everything else (entrance, finish, the arenas, a designated sanctum) is
 *  already doing a job that must not be overwritten. */
const PROMOTABLE: ReadonlySet<RoomRole> = new Set<RoomRole>(['combat', 'feature']);

/** What may be rolled onto a floor, and from what depth. The trove is handled
 *  separately (it's guaranteed, not rolled). Weight is relative. */
const ROLLED_ROLES: ReadonlyArray<{ role: RoomRole; minDepth: number; weight: number }> = [
  { role: 'shop',  minDepth: 2, weight: 3 },
  { role: 'trap',  minDepth: 2, weight: 2 },
  { role: 'arena', minDepth: 3, weight: 2 },
];

export interface RoleRoomPlan {
  /** roomId → the role it was promoted to. Empty when nothing qualified. */
  assigned: ReadonlyMap<string, RoomRole>;
}

/**
 * Promote a few ordinary rooms into role rooms. PURE — rand is injected, no
 * scene — so the floor's shape is unit-testable and reproducible per seed.
 *
 * A floor gets ONE guaranteed trove (its dependable build offering, so the run
 * stays plannable) plus 0-2 rolled extras. Boss floors get none: the boss IS the
 * floor's event, and a shop next door would undercut it.
 */
export function assignRoleRooms(
  roles: FloorRoles,
  nodes: readonly RoomNode[],
  opts: { depth: number; rand: () => number; isBossFloor?: boolean },
): RoleRoomPlan {
  const assigned = new Map<string, RoomRole>();
  if (opts.isBossFloor) return { assigned };

  // Candidates, quiet-end first: a dead-end spur is a better home for a reward
  // or a vendor than a room you merely pass through.
  const candidates = nodes
    .filter((n) => PROMOTABLE.has(roles.role(n.roomId)))
    .sort((a, b) => a.connections - b.connections);
  if (candidates.length === 0) return { assigned };

  const take = (role: RoomRole): boolean => {
    const pick = candidates.find((n) => !assigned.has(n.roomId));
    if (!pick) return false;
    assigned.set(pick.roomId, role);
    roles.designate(pick.roomId, role);
    return true;
  };

  // 1. The guaranteed trove — the floor's dependable choice.
  take('trove');

  // 2. Rolled extras. Leave at least one ordinary room behind so a floor never
  //    becomes wall-to-wall landmarks (the muddiness we're fixing).
  const spare = Math.max(0, candidates.length - assigned.size - 1);
  const extras = Math.min(spare, opts.rand() < 0.45 ? 2 : 1);
  const pool = ROLLED_ROLES.filter((r) => opts.depth >= r.minDepth);
  const used = new Set<RoomRole>();
  for (let i = 0; i < extras; i++) {
    const open = pool.filter((r) => !used.has(r.role) && assignableTypes().includes(r.role as never));
    if (open.length === 0) break;
    const total = open.reduce((s, r) => s + r.weight, 0);
    let roll = opts.rand() * total;
    let chosen = open[open.length - 1];
    for (const r of open) { roll -= r.weight; if (roll <= 0) { chosen = r; break; } }
    if (!take(chosen.role)) break;
    used.add(chosen.role);
  }

  return { assigned };
}
