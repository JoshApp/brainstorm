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

/** The job a room does on its floor. */
export type RoomRole =
  | 'entrance'  // the player spawns here — a safe beat, never a fight or a deal
  | 'combat'    // a fight room; the combat budget seeds here
  | 'feature'   // a calm pocket — hosts a question (deal) or a defining find
  | 'sanctum'   // the bonfire's OWN room; prominent, staged, no fight
  | 'finish'    // holds the way down — a bare exit, never a destination
  | 'quiet'     // a deliberately empty dread room (reserved for a pacing layer)
  | 'boss';     // the boss arena

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

// The tunable surface. A content/design layer can reshape floor feel here
// without reading a single build pass.
export const ROLE_CAPS: Record<RoomRole, RoleCaps> = {
  entrance: { allowCombat: false, allowBonfire: false, allowEvent: false, allowLoot: true,  bonfirePref: 0 },
  combat:   { allowCombat: true,  allowBonfire: true,  allowEvent: true,  allowLoot: true,  bonfirePref: 1 },
  feature:  { allowCombat: true,  allowBonfire: true,  allowEvent: true,  allowLoot: true,  bonfirePref: 3 },
  sanctum:  { allowCombat: false, allowBonfire: true,  allowEvent: false, allowLoot: false, bonfirePref: 5 },
  finish:   { allowCombat: true,  allowBonfire: false, allowEvent: false, allowLoot: false, bonfirePref: 0 },
  quiet:    { allowCombat: false, allowBonfire: true,  allowEvent: true,  allowLoot: true,  bonfirePref: 4 },
  boss:     { allowCombat: false, allowBonfire: false, allowEvent: false, allowLoot: false, bonfirePref: 0 },
};

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
