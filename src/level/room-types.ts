// ROOM TYPES — what a room IS, what it may host, and what may happen in it.
//
// A finished room is built in LAYERS, and this table is what each pass consults
// so the passes never argue with each other:
//
//   1. IDENTITY   — the room's type. Structural rooms are PLACED (a boss arena
//                   must be shaped like one); role rooms are ASSIGNED to any room
//                   that qualifies; plain rooms are the connective majority.
//   2. CENTREPIECE— the ONE notable thing. Capped at one, by construction: this
//                   is what makes "bonfire + fountain + altar stacked in one room
//                   centre" impossible rather than merely discouraged. Most rooms
//                   have NONE — a landmark only reads as one when most rooms
//                   aren't.
//   3. MODIFIERS  — what HAPPENS around the centrepiece. A modifier never
//                   replaces identity; it layers on. The fountain room whose
//                   doors seal and fill with the dead is `fountain + ambush` —
//                   not a separate room type.
//   4. MINOR      — enemies as texture, breakables, clutter, small loot, per the
//                   allowances below.
//
// The point of the `modifiers` list is that a type declares what it is AND WHAT
// IT ISN'T. A shop takes no modifiers at all — you never fight beside a vendor,
// and no amount of budget pressure may decide otherwise. A fountain takes an
// ambush happily. That refusal is data, not a special case buried in a pass.

/** How a room's type gets decided. */
export type RoomKind =
  | 'structural'  // must exist, fixed position, FORM is welded to function
  | 'role'        // a job assigned to any qualifying room
  | 'plain';      // the connective majority — no centrepiece

/** The ONE notable thing a room hosts. Exactly zero or one, ever. */
export type Centrepiece =
  | 'none'
  | 'offerings'   // a trove — take one of several
  | 'merchant'    // a vendor and their wares
  | 'bargain'     // a deal paid in blood
  | 'trial'       // reward as bait: take it and the room answers
  | 'hazard'      // the trap, and the prize it guards
  | 'fire'        // a place to rest
  | 'descent'     // the way down
  | 'miniboss'
  | 'boss';

/** Layered ON TOP of identity. Never replaces the centrepiece. */
export type RoomModifier =
  | 'ambush'   // the doors seal and the room fills — the trap that was a fountain
  | 'hazard'   // floor traps dressed through the room
  | 'gated'    // sealed until an offering is made
  | 'dark';    // the lights are out in here

export interface RoomTypeDef {
  kind: RoomKind;
  /** The one notable thing. 'none' for the connective majority. */
  centrepiece: Centrepiece;
  /** May the combat budget seed wandering enemies here (enemies as TEXTURE)? */
  enemies: boolean;
  /** May a deal / defining find be STAGED here (the event budget's seam)? */
  event: boolean;
  /** May minor loot — chests, pickups, breakables — dress this room? */
  minorLoot: boolean;
  /** May a found bonfire settle here, and how strongly does it want to? */
  fire: boolean;
  firePref: number;
  /** Modifiers this type ACCEPTS. Empty means the type refuses all of them —
   *  the room is what it is and nothing gets layered on. */
  modifiers: readonly RoomModifier[];
}

/**
 * THE TABLE. A content/design layer reshapes floor feel here without reading a
 * single build pass — add a type, or flip what an existing one tolerates.
 */
export const ROOM_TYPES = {
  // ── STRUCTURAL — placed, form welded to function ───────────────────
  // You arrive here. Safe, marked, never a fight and never a deal.
  entrance: {
    kind: 'structural', centrepiece: 'none',
    enemies: false, event: false, minorLoot: true, fire: false, firePref: 0,
    modifiers: [],
  },
  // Holds the way down. A threshold, never a destination — but it can be the
  // last thing standing between you and the stairs.
  finish: {
    kind: 'structural', centrepiece: 'descent',
    enemies: true, event: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: ['ambush'],
  },
  // The elite's stage. No injected trash, no deal, no found fire — the miniboss
  // IS the content, and it gives a fire when it dies.
  miniboss: {
    kind: 'structural', centrepiece: 'miniboss',
    enemies: false, event: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: [],
  },
  boss: {
    kind: 'structural', centrepiece: 'boss',
    enemies: false, event: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: [],
  },

  // ── ROLE — a job assigned to any qualifying room ───────────────────
  // A calm pocket that hosts a question: a deal, or a defining find.
  feature: {
    kind: 'role', centrepiece: 'bargain',
    enemies: true, event: true, minorLoot: true, fire: true, firePref: 3,
    modifiers: ['ambush', 'hazard', 'gated'],
  },
  // The bonfire's own room — staged, prominent, never a fight.
  sanctum: {
    kind: 'role', centrepiece: 'fire',
    enemies: false, event: false, minorLoot: false, fire: true, firePref: 5,
    modifiers: [],
  },
  // The floor's guaranteed choice — several offerings, take one. A reward room
  // is a BREATH: no enemies, no hazards. It may be sealed behind an offering.
  trove: {
    kind: 'role', centrepiece: 'offerings',
    enemies: false, event: false, minorLoot: false, fire: false, firePref: 1,
    modifiers: ['gated'],
  },
  // You never fight beside a vendor. No modifiers, at all, ever.
  shop: {
    kind: 'role', centrepiece: 'merchant',
    enemies: false, event: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: [],
  },
  // Reward as bait — taking it seals the room and answers. The ambush isn't a
  // modifier here; it IS the centrepiece.
  trial: {
    kind: 'role', centrepiece: 'trial',
    enemies: true, event: true, minorLoot: false, fire: false, firePref: 0,
    modifiers: ['hazard'],
  },
  // The hazard and the prize it guards. Can also be waiting for you.
  trap: {
    kind: 'role', centrepiece: 'hazard',
    enemies: true, event: false, minorLoot: true, fire: false, firePref: 0,
    modifiers: ['ambush'],
  },

  // ── PLAIN — the connective majority, no centrepiece ────────────────
  combat: {
    kind: 'plain', centrepiece: 'none',
    enemies: true, event: true, minorLoot: true, fire: true, firePref: 1,
    modifiers: ['ambush', 'hazard'],
  },
  // A deliberately empty dread room. Its whole job is to be nothing — so the
  // only thing it tolerates is the dark getting worse.
  quiet: {
    kind: 'plain', centrepiece: 'none',
    enemies: false, event: true, minorLoot: true, fire: true, firePref: 4,
    modifiers: ['dark'],
  },
} as const satisfies Record<string, RoomTypeDef>;

export type RoomTypeId = keyof typeof ROOM_TYPES;

/** Look up a type, falling back to plain combat for an unknown id. */
export function roomType(id: string): RoomTypeDef {
  return (ROOM_TYPES as Record<string, RoomTypeDef>)[id] ?? ROOM_TYPES.combat;
}

/** Does this type tolerate that modifier? The refusal is the point — a shop
 *  answers false to everything, so no pass can decide to ambush a vendor. */
export function acceptsModifier(id: string, mod: RoomModifier): boolean {
  return roomType(id).modifiers.includes(mod);
}

/** Every type that may be ASSIGNED (role kinds). Structural rooms are placed by
 *  the spine and plain rooms are the fallback, so neither is assignable. */
export function assignableTypes(): RoomTypeId[] {
  return (Object.keys(ROOM_TYPES) as RoomTypeId[]).filter((k) => ROOM_TYPES[k].kind === 'role');
}

/** True when the type stages a notable thing. Used to enforce the ONE-per-room
 *  cap: a room that already has a centrepiece takes no other. */
export function hasCentrepiece(id: string): boolean {
  return roomType(id).centrepiece !== 'none';
}
