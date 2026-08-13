import type { LevelSpec, RoomSpec, WalkableRect } from './types';

// WHERE AM I, IN THE FLOOR'S OWN TERMS?
//
// A bug report can say "(12.4, 0, -8.1)" all day and it still doesn't name
// anything a reader can open a file about. The floor plan already has the
// vocabulary — rooms and corridors carry an `id`, corridors additionally carry
// a `corridorType` (what the passage is FOR) and a `linkId` (which connection a
// dogleg's legs belong to). Turning a world point into those ids is what makes
// "some rare corridors generate faulty" into "corridor c7, link r2→r5, a bend".
//
// Pure on purpose — spec plus a point, no scene, no renderer — so it is unit
// testable and so the report path and any headless sweep can share one answer.

export interface PlaceRef {
  /** The room or corridor rect's own id. */
  id: string;
  /** 'room' or 'corridor', by which list of the spec it came from. */
  kind: 'room' | 'corridor';
  /** Corridors only: what the passage is for (squeeze / passage / gallery). */
  corridorType?: string;
  /** Corridors only: the CONNECTION this rect belongs to. A dogleg's three legs
   *  share one linkId, which is the thing worth reporting — the leg ids are an
   *  implementation detail of how the bend was built. */
  linkId?: string;
}

export interface Placement {
  /** Everything containing the point. Usually one; two where a corridor mouth
   *  overlaps a room, which is itself often the interesting part of a report. */
  inside: PlaceRef[];
  /** Nearest rect when the point is inside nothing — the void-gap case, where
   *  "what is this hole next to" is the whole question. */
  nearest: (PlaceRef & { distance: number }) | null;
}

function ref(r: RoomSpec, kind: 'room' | 'corridor'): PlaceRef {
  const out: PlaceRef = { id: r.id, kind };
  if (r.corridorType) out.corridorType = r.corridorType;
  if (r.linkId) out.linkId = r.linkId;
  return out;
}

/** Distance from (x,z) to a rect's edge; 0 when inside. Rects are centre+extent. */
function edgeDistance(rect: WalkableRect, x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - rect.x) - rect.w / 2);
  const dz = Math.max(0, Math.abs(z - rect.z) - rect.d / 2);
  return Math.hypot(dx, dz);
}

/**
 * Name the room(s) and corridor(s) a world point falls in, or the nearest one.
 *
 * Tests against `rect` even for polygon rooms: `rect` is documented as the
 * polygon's bounding box and is what every rect-thinking system already reads,
 * so a point in a cut corner reports the room it is nominally in rather than
 * nothing at all. For "which floor feature is this", nominal is the useful
 * answer — a report about a wall that shouldn't be there is filed from beside
 * it, not from inside the walkable polygon.
 */
export function locateInLevel(spec: LevelSpec, x: number, z: number): Placement {
  const inside: PlaceRef[] = [];
  let nearest: (PlaceRef & { distance: number }) | null = null;

  const consider = (r: RoomSpec, kind: 'room' | 'corridor'): void => {
    const d = edgeDistance(r.rect, x, z);
    if (d === 0) { inside.push(ref(r, kind)); return; }
    if (!nearest || d < nearest.distance) nearest = { ...ref(r, kind), distance: Math.round(d * 100) / 100 };
  };

  for (const r of spec.rooms ?? []) consider(r, 'room');
  for (const c of spec.corridors ?? []) consider(c, 'corridor');

  return { inside, nearest: inside.length ? null : nearest };
}
