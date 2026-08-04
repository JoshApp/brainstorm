import type { TransactionPrice } from '../content/transactions';

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
  | 'gauntlet'    // waves, each one answered with a reward
  | 'hazard'      // the trap, and the prize it guards
  | 'fire'        // a place to rest
  | 'descent'     // the way down
  | 'miniboss'
  | 'boss';

/**
 * Layered ON TOP of identity. Never replaces the centrepiece.
 *
 * The two combat modifiers differ by TRIGGER, and they feel different because of
 * it: `ambush` fires when you ENTER (you walked into it), `contested` fires when
 * you TAKE (you reached for it). Same enemies, opposite emotions — one is a trap
 * sprung on you, the other a price you chose to pay.
 */
export type RoomModifier =
  | 'ambush'     // ON ENTER: the doors seal and the room fills
  | 'contested'  // ON TAKE: the centrepiece is guarded — reach for it and answer for it
  | 'toll'       // ON ENTER: the way in is priced — coin, key, or blood
  | 'hazard'     // floor traps dressed through the room
  | 'gated'      // sealed until an offering is made elsewhere
  | 'dark';      // the lights are out in here

/**
 * A modifier as ACTUALLY APPLIED to a room. The type table says what a room may
 * tolerate; this says what it got and on what terms. Parameters live here rather
 * than in the table because the same modifier is priced differently on floor 2
 * and floor 9 — the table declares tolerance, placement declares terms.
 */
export interface AppliedModifier {
  kind: RoomModifier;
  /** For 'toll' — what the way in costs. Routed through the same central applier
   *  every other priced thing uses (interactables/event-factory). */
  price?: TransactionPrice;
  /** For 'ambush' / 'contested' — how many waves answer. */
  waves?: number;
}

export interface RoomTypeDef {
  kind: RoomKind;
  /**
   * A BOOKEND exists to OPEN or CLOSE the floor — it is not what the floor is
   * about. It may still be dressed (the way down can be a blood door), but it
   * never counts toward the floor's CONTENT BUDGET, and the question "is this
   * floor mostly landmarks?" is asked over the rooms BETWEEN the bookends.
   *
   * This distinction is load-bearing on short floors. A depth-1 floor of
   * entrance + one room + exit looked like "2 of 3 rooms are landmarks" when
   * measured naively; measured honestly it has exactly ONE content room, which
   * is the real problem (see CONFIG.FLOOR_SHAPE — floors carry a minimum
   * number of content rooms so a landmark has something to be a landmark
   * against).
   */
  bookend: boolean;
  /** The one notable thing. 'none' for the connective majority. */
  centrepiece: Centrepiece;
  /** May the combat budget seed wandering enemies here (enemies as TEXTURE)? */
  enemies: boolean;
  /** May a deal / defining find be STAGED here (the event budget's seam)? */
  event: boolean;
  /** May minor loot — chests, pickups, breakables — dress this room? */
  minorLoot: boolean;
  /**
   * THE FLOOR IS A STAGE. Nothing scattered, nothing underfoot: no procedural
   * decor, no furnishing, no rubble, no traps, no carved voids. Only what the
   * room's centrepiece deliberately places.
   *
   * This is a stronger statement than `minorLoot: false`, and it needs to be
   * separate from it. A trove already refused loot and still ended up with
   * pillars in front of its outer offerings and a crack across its floor,
   * because decor, carve and the hazard modifier are different passes that each
   * asked a different question. `clean` is the one answer all of them read: if
   * the whole point of the room is that you can see three things and choose
   * between them, then anything else on that floor is in the way.
   */
  clean: boolean;
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
    kind: 'structural', bookend: true, centrepiece: 'none',
    enemies: false, event: false, clean: false, minorLoot: true, fire: false, firePref: 0,
    modifiers: [],
  },
  // Holds the way down. A threshold, never a destination — but it can be the
  // last thing standing between you and the stairs, and the way down can be
  // PRICED: `finish + toll` is the blood door.
  finish: {
    kind: 'structural', bookend: true, centrepiece: 'descent',
    enemies: true, event: false, clean: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: ['ambush', 'toll'],
  },
  // The elite's stage. No injected trash, no deal, no found fire — the miniboss
  // IS the content, and it gives a fire when it dies.
  miniboss: {
    kind: 'structural', bookend: false, centrepiece: 'miniboss',
    enemies: false, event: false, clean: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: [],
  },
  boss: {
    kind: 'structural', bookend: false, centrepiece: 'boss',
    enemies: false, event: false, clean: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: [],
  },

  // ── ROLE — a job assigned to any qualifying room ───────────────────
  // A calm pocket that hosts a question: a deal, or a defining find.
  feature: {
    kind: 'role', bookend: false, centrepiece: 'bargain',
    enemies: true, event: true, clean: false, minorLoot: true, fire: true, firePref: 3,
    modifiers: ['ambush', 'contested', 'toll', 'hazard', 'gated'],
  },
  // The bonfire's room. Staged, prominent — and NOT always safe. A fire is the
  // one mercy the dungeon offers, which makes it the best thing in the game to
  // put a price on: `sanctum + contested` is a rest you fight for, `sanctum +
  // ambush` is mercy that turns on you as you reach it. It still seeds no
  // wandering trash of its own — whatever happens here is the modifier's doing,
  // so an unmodified fire stays the clean breath it's meant to be.
  sanctum: {
    kind: 'role', bookend: false, centrepiece: 'fire',
    enemies: false, event: false, clean: false, minorLoot: false, fire: true, firePref: 5,
    modifiers: ['ambush', 'contested'],
  },
  // The floor's guaranteed choice — several offerings, take one. A reward room
  // is a BREATH: no enemies, no hazards. It may be sealed behind an offering.
  trove: {
    kind: 'role', bookend: false, centrepiece: 'offerings',
    enemies: false, event: false, clean: true, minorLoot: false, fire: false, firePref: 1,
    // You may have to FIGHT for the offerings (contested) or PAY to reach them
    // (toll) — but the room is never sprung on you. A reward you walked into
    // honestly stays a breath; the cost is always one you saw coming.
    modifiers: ['contested', 'toll', 'gated'],
  },
  // You never fight beside a vendor. No modifiers, at all, ever.
  shop: {
    kind: 'role', bookend: false, centrepiece: 'merchant',
    enemies: false, event: false, clean: true, minorLoot: false, fire: false, firePref: 0,
    modifiers: [],
  },
  // A gauntlet room: waves, each one answered with a reward. Its identity IS the
  // fighting — which is why this is a TYPE and "fight for the thing" is not. You
  // may have to pay your way in.
  arena: {
    kind: 'role', bookend: false, centrepiece: 'gauntlet',
    enemies: true, event: false, clean: false, minorLoot: false, fire: false, firePref: 0,
    modifiers: ['toll', 'hazard'],
  },
  // The hazard and the prize it guards. Can also be waiting for you.
  trap: {
    kind: 'role', bookend: false, centrepiece: 'hazard',
    enemies: true, event: false, clean: false, minorLoot: true, fire: false, firePref: 0,
    modifiers: ['ambush', 'contested'],
  },

  // ── PLAIN — the connective majority, no centrepiece ────────────────
  combat: {
    kind: 'plain', bookend: false, centrepiece: 'none',
    enemies: true, event: true, clean: false, minorLoot: true, fire: true, firePref: 1,
    modifiers: ['ambush', 'hazard', 'dark'],
  },
  // A deliberately empty dread room. Its whole job is to be nothing — so the
  // only thing it tolerates is the dark getting worse.
  quiet: {
    kind: 'plain', bookend: false, centrepiece: 'none',
    enemies: false, event: true, clean: false, minorLoot: true, fire: true, firePref: 4,
    modifiers: ['dark', 'hazard'],
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

/**
 * True when the room is a BOOKEND — it opens or closes the floor rather than
 * holding its content. The floor's content budget, and every "how dense are the
 * landmarks?" measurement, must exclude these: counting the entrance and the
 * stairwell as content makes a short floor look full when it's empty.
 */
export function isBookend(id: string): boolean {
  return roomType(id).bookend;
}

/** True when the type stages a notable thing. Used to enforce the ONE-per-room
 *  cap: a room that already has a centrepiece takes no other. */
export function hasCentrepiece(id: string): boolean {
  return roomType(id).centrepiece !== 'none';
}
