// ── HOW RUINED IS THIS ROOM? ─────────────────────────────────────────────────
//
// One number per room, in [0, 1], and it has to be ONE number: the coursework,
// the half-collapsed wall and the debris on the floor are all the same claim
// about the same place. A room whose walls are coming down and whose floor is
// spotless is two rooms standing in one spot.
//
// It lived inside `poly-room-shell` as a local `seededRand(room.id)`, which was
// fine while the shell was the only thing that wanted it. `poly-surface` wants
// it too — debris is caused by exactly the decay the shell is drawing — and the
// options were to duplicate seven lines of hash or to name the thing. Naming it
// is the same discipline as `wallCutsFor` and `plateExtentFor`: one producer,
// and readers take its answer rather than re-deriving it from the same inputs
// and drifting (docs/DESIGN-METHOD.md, and tests/one-ring.test.ts for the four
// times that drift has cost us).
//
// Seeded from the room ID, so it is stable across every pass, every reload and
// every consumer, and costs nothing from any shared random stream.

/** The band a derived wear falls in. A room is never pristine and never rubble;
 *  both extremes are things a room has to SAY, not roll. */
const MIN = 0.18;
const RANGE = 0.5;

/**
 * This room's condition, 0..1.
 *
 * `authored` wins when a room states its own — that is the seam a content layer
 * writes to when a room's condition is a statement rather than weather. The
 * stream is not consulted in that case, and does not need to be: it is keyed on
 * the id, so nothing downstream shifts.
 */
export function roomWear(id: string, authored?: number): number {
  if (authored !== undefined) return Math.max(0, Math.min(1, authored));
  return MIN + wearStream(id)() * RANGE;
}

/**
 * The room's decay stream, from its id.
 *
 * Exported because `poly-room-shell` needs MORE than the one number: after
 * taking wear off the front it keeps drawing, per wall, to decide which course
 * sits proud and which side is coming down. It must therefore take the wear
 * draw FROM THIS STREAM rather than calling `roomWear` beside it — otherwise
 * its walls start one draw earlier than they used to and every room in the game
 * re-rolls its masonry. Byte-identical to the local `seededRand` it replaced,
 * for exactly that reason.
 *
 *   const rand = wearStream(id);
 *   const wear = room.wear ?? WEAR_MIN + rand() * WEAR_RANGE;   // the first draw
 */
export function wearStream(key: string): () => number {
  let x = 2166136261;
  for (let i = 0; i < key.length; i++) { x ^= key.charCodeAt(i); x = Math.imul(x, 16777619); }
  x = x >>> 0;
  return () => {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The band a derived wear falls in, exported so the shell can take the draw
 *  itself and still land on the same number this function would return. */
export const WEAR_MIN = MIN;
export const WEAR_RANGE = RANGE;
