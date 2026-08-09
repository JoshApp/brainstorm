import type { PropSpec } from './types';
import type { Poly } from './room-shape';
import { clearance } from './floor-region';
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';

// Prop groups — named modular setpieces, expanded by the PRODUCER into real
// props before the spec leaves the generator.
//
// ── WHY EXPANSION HAPPENS HERE AND NOT IN THE BUILDER ────────────────────────
//
// It used to be a spec KIND: a pass emitted `{ kind: 'group', groupId: … }` and
// the vault composer expanded it downstream. That composer is gone, and the
// group kind outlived it by exactly one commit — the bone shrine was still
// being emitted onto every fifteenth floor and rendering as nothing at all,
// because the only code that knew how to expand it had been deleted. The floor
// hash could not see it: the SPEC was byte-identical, and the loss was entirely
// in what the builder made of it.
//
// So there is no longer a group prop kind. A prefab is a authoring convenience
// for the pass that places it, and the spec only ever contains props something
// renders. That removes the whole class of bug rather than the one instance.
//
// Authoring rules:
//   - Each child is a full PropSpec in GROUP-LOCAL coords (group centre = 0,0).
//   - Set minClearance on children that should drop if they land too close to a
//     wall (typical: 0.4-0.6m for candles, larger for altars).
//   - Keep groups SMALL — 2-5 children. Composability comes from stacking
//     groups, not from monstrous setpieces.

export interface GroupChild {
  /** Full PropSpec entry, with x/z relative to the group centre. */
  prop: PropSpec;
  /** Drop this child if it would land within this distance of the room's wall
   *  (in metres). 0 / undefined = always place. */
  minClearance?: number;
}

export interface PropGroupSpec {
  id: string;
  children: GroupChild[];
}

// Default corpse note — used by atmospheric groups so the author
// doesn't have to write a fresh line per spawn. The LLM in Phase 5
// will generate context-specific lines.
const CORPSE_NOTE = 'They were here before.\nSomething took them apart.';

const GLOW_BONE = floorGlow(0x80a0a0);

// Six more groups lived here — altar-ritual, fountain-shrine, tithe-shrine,
// ritual-circle, chest-cache, pillar-pair. Every one of them was addressed only
// by an ASCII vault map, and those are gone; centrepieces.ts stages altars,
// basins and troves now, with a room's own shape to place them against. They
// were deleted with the composer rather than left as data with no address.
export const PROP_GROUPS: Record<string, PropGroupSpec> = {
  // Single ritual candle + a corpse + a bone-glow patch. The "single
  // forlorn corpse" beat — sparse, used in encounter rooms.
  'bone-shrine': {
    id: 'bone-shrine',
    children: [
      { prop: { kind: 'corpse', x: 0, z: 0, rotY: -0.5, note: CORPSE_NOTE } },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: -0.7, y: 0, z: -0.4 }, minClearance: 0.4 },
      { prop: { kind: 'model', model: GLOW_BONE, x: 0, y: 0, z: 0 } },
    ],
  },
};

/**
 * Expand a group into its child props, placed at (x, z) and rotated about that
 * origin by rotY. Children are culled against the ROOM POLYGON, not a bounding
 * rect: a candle 0.4m inside the box of an L-shaped room can be outside the
 * room, and placing it there is the single most repeated bug in this generator.
 * `clearance` is signed, so one comparison answers both "is it in the room" and
 * "has it got space" — a child outside scores negative and always fails.
 */
export function expandGroup(
  groupId: string,
  x: number,
  z: number,
  rotY: number,
  poly: Poly,
): PropSpec[] {
  const spec = PROP_GROUPS[groupId];
  if (!spec) throw new Error(`Unknown propGroup id: ${groupId}`);
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const out: PropSpec[] = [];
  for (const child of spec.children) {
    const placed = transformChild(child, x, z, cos, sin, rotY);
    if (clearance(poly, placed.x, placed.z) < (child.minClearance ?? 0)) continue;
    out.push(placed);
  }
  return out;
}

/** Rotate the child's (x, z) about the group origin, then translate. */
function transformChild(
  child: GroupChild, gx: number, gz: number, cos: number, sin: number, rotY: number,
): PropSpec & { x: number; z: number } {
  const cx = child.prop.x, cz = child.prop.z;
  const result = { ...child.prop, x: gx + (cx * cos - cz * sin), z: gz + (cx * sin + cz * cos) };
  // A child's own rotY compounds with the group's.
  if ('rotY' in child.prop && rotY !== 0) {
    (result as { rotY?: number }).rotY = (child.prop.rotY ?? 0) + rotY;
  }
  // A `facing` directive that names a WORLD POINT (point-away / point-toward)
  // has to be moved into the same world space as the prop, or the corpse looks
  // at wherever the group's local origin happened to land on the last floor.
  // Coordinate-free kinds (fixed / wall-*) pass through untouched.
  if ('facing' in child.prop && child.prop.facing) {
    const f = child.prop.facing;
    if (f.kind === 'point-away' || f.kind === 'point-toward') {
      (result as { facing?: typeof f }).facing = {
        kind: f.kind,
        x: gx + (f.x * cos - f.z * sin),
        z: gz + (f.x * sin + f.z * cos),
      };
    }
  }
  return result;
}
