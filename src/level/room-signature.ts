import { CONFIG } from '../config';
import { mixColors } from './mood-tint';
import type { LightDensity } from './palette';
import type { TorchSpec } from './types';
import type { RoomTypeId } from './room-types';

// ATMOSPHERE SIGNATURE — what a staged room LOOKS LIKE from the doorway.
//
// Isaac tells you what a room is before you enter it: the door is marked. We
// have no map and no door icons, so the tell has to be the light itself. A
// promoted role room retints its own wall fixtures, and because the fill-light
// pass averages the torches inside a room's rect (mood-tint.ts
// averageTorchTintInRect), the room's ambient, its chandeliers and its walls all
// follow the same hue for free. One saturated colour spilling out of a corridor
// mouth is a PROMISE — "there is a shop down there", "that is a fight" — and the
// player learns to read it in about three floors.
//
// This is deliberately the cheapest possible mechanism: no new light sources, no
// budget spent, nothing added to a room that wasn't already lit. We recolour
// what's there. Per docs/VISUAL-LANGUAGE.md the palette stays small and fixed —
// blood-red, sickly-green, moonlight-blue, gold, violet — and a room commits to
// exactly one.

export interface RoomSignature {
  /** The hue the room's fixtures are pulled toward. */
  tint: number;
  /** How far toward `tint` (0 = untouched default warm, 1 = fully the hue).
   *  Below ~0.5 the dungeon's orange wins and the signal doesn't survive the
   *  walk down a corridor; above ~0.9 the room stops reading as torchlight. */
  strength: number;
  /** Multiplies each fixture's intensity. Below 1 the room goes quiet and lets
   *  its centrepiece be the brightest thing in it. */
  intensityMul: number;
  /** One line, for the author reading this table later — why this hue. */
  reads: string;
}

/**
 * THE TABLE. A design layer changes what a room feels like from the doorway by
 * editing a hex here, without touching a build pass.
 *
 * Note what is ABSENT: `feature` — the generic "a question is asked here" room —
 * takes no signature. Its content varies from a blood bargain to a free relic,
 * so a fixed colour would be a promise the room can't keep. A signature is only
 * honest when the room type always means the same thing.
 */
export const ROOM_SIGNATURES: Partial<Record<RoomTypeId, RoomSignature>> = {
  // GOLD — the gift. The trove is the floor's guaranteed choice, and the only
  // room in the game allowed to look generous. Gold is spent nowhere else, which
  // is exactly why it works here.
  // (Paler and brighter than the deeper gold of the floor glow under each
  // offering — fire lights a room warm, gilding lights it BRIGHT, and the
  // difference is what stops the trove reading as one more torchlit chamber.)
  trove: { tint: 0xffe08a, strength: 0.85, intensityMul: 1.15, reads: 'a gift, laid out' },

  // EMBER, and DIM. The rest room doesn't announce itself with brighter walls —
  // it goes quiet so the fire is the only warm thing in it. From the doorway you
  // see a dark room with one heart beating in the middle, which is the read we
  // want: mercy, not spectacle.
  sanctum: { tint: 0xff6a1e, strength: 0.7, intensityMul: 0.5, reads: 'dark, with one warm heart' },

  // VIOLET — the vendor. Not the dungeon's own colour; someone brought it down
  // here. Uncommon enough that a violet spill in a corridor means commerce.
  shop: { tint: 0xa06bd8, strength: 0.8, intensityMul: 1.0, reads: 'someone is trading down here' },

  // BLOOD — the gauntlet. Red is the game's danger colour everywhere else, so
  // the arena inherits it wholesale: this room is going to cost you.
  arena: { tint: 0xd8362a, strength: 0.85, intensityMul: 0.9, reads: 'this one is a fight' },

  // SICKLY GREEN — the trap. Wrongness. The prize is real and so is the floor.
  trap: { tint: 0x6fbf4a, strength: 0.8, intensityMul: 0.8, reads: 'something here is wrong' },
};

/** The signature for a room type, or undefined when the type makes no promise. */
export function signatureFor(roleId: string): RoomSignature | undefined {
  return ROOM_SIGNATURES[roleId as RoomTypeId];
}

const DENSITY_ORDER: LightDensity[] = ['off', 'dark', 'sparse', 'medium', 'dense'];

/**
 * The light floor a signature room needs to keep its promise.
 *
 * A signature recolours fixtures; it can't conjure them. Composed across nine
 * depths, roughly one staged room in ten came out with NO wall fixtures at all —
 * the vault authored none and the palette's density said 'off' — so the trove
 * that should have been visibly gilded was just another dark chamber you had to
 * walk into to understand. A room that makes a promise gets enough light to make
 * it: never LESS than sparse, never more than the palette already wanted.
 *
 * The one exception is deliberate and lives at the call site: a `dark` room keeps
 * its darkness. That modifier is the room telling you the lights are out, and
 * that's a promise too.
 */
export function signatureLightDensity(current: LightDensity): LightDensity {
  return DENSITY_ORDER.indexOf(current) < DENSITY_ORDER.indexOf('sparse') ? 'sparse' : current;
}

export interface SignatureRect { x: number; z: number; w: number; d: number }

/**
 * Pull every fixture inside `rect` toward the signature. Mutates the specs in
 * place (they're plain data owned by the composer, and every downstream pass —
 * fill light, chandeliers, mood tint — reads them after this runs). Returns how
 * many fixtures were touched, which is 0 for an unlit room: the caller can then
 * decide the signature didn't land.
 *
 * `margin` exists because wall fixtures sit at a small offset OUTSIDE the room's
 * nominal rect (WALL_OFFSET), so a strict containment test misses most of them.
 */
export function tintRoomTorches(
  sig: RoomSignature,
  rect: SignatureRect,
  torches: TorchSpec[],
  margin = 1.0,
): number {
  const hw = rect.w / 2 + margin;
  const hd = rect.d / 2 + margin;
  let n = 0;
  for (const t of torches) {
    if (t.x < rect.x - hw || t.x > rect.x + hw) continue;
    if (t.z < rect.z - hd || t.z > rect.z + hd) continue;
    const base = t.colorTint ?? CONFIG.TORCH_COLOR;
    t.colorTint = mixColors(base, sig.tint, sig.strength);
    t.intensityMul = (t.intensityMul ?? 1) * sig.intensityMul;
    n++;
  }
  return n;
}
