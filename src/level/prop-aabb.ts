import type { PropSpec } from './types';

// Shared collision-AABB lookup for every prop kind that pushes an
// obstacle in builder.ts. Single source of truth so the passage-zone
// pass and the reachability check don't duplicate the builder's
// numbers (and silently drift when those numbers move).
//
// Returns null for props with NO collision (corpses, spike-traps,
// hints, notes, groups). Returns the WORLD-space AABB after applying
// the prop's rotY for model-kind props with an offset collision.
//
// All non-model kinds use axis-aligned AABBs that DON'T rotate —
// matches the builder, which only supports cardinal rotations for
// the bespoke kinds (chest, altar, fountain, etc.) anyway.

export interface PropAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Reusable constants — match the builder's per-kind footprint
// numbers exactly. If the builder changes its footprint for a kind,
// update here too.
const CHEST_HX = 0.28;
const CHEST_HZ = 0.23;
const ALTAR_HX = 0.65;
const ALTAR_HZ = 0.50;
const BLOOD_ALTAR_HX = 0.44;
const BLOOD_ALTAR_HZ = 0.36;
const STARTER_ALTAR_HX = 0.40;
const STARTER_ALTAR_HZ = 0.32;
const FOUNTAIN_R = 0.45;
const VASE_R = 0.18;
// Pillar size is parameterised in altar-pillar-builders.ts; the
// default 'P'-tile pillar is 0.6m square per buildAltarPillar's
// `size` arg in builder.ts. If pillar sizes diverge later, plumb
// the actual size through.
const PILLAR_HALF = 0.30;

export function getPropAABB(prop: PropSpec): PropAABB | null {
  switch (prop.kind) {
    case 'chest':
    case 'stash-chest':
      return aabbHalf(prop.x, prop.z, CHEST_HX, CHEST_HZ);
    case 'altar':
      return aabbHalf(prop.x, prop.z, ALTAR_HX, ALTAR_HZ);
    case 'blood-altar':
      return aabbHalf(prop.x, prop.z, BLOOD_ALTAR_HX, BLOOD_ALTAR_HZ);
    case 'starter-altar':
      return aabbHalf(prop.x, prop.z, STARTER_ALTAR_HX, STARTER_ALTAR_HZ);
    case 'fountain':
      return aabbHalf(prop.x, prop.z, FOUNTAIN_R, FOUNTAIN_R);
    case 'vase':
      return aabbHalf(prop.x, prop.z, VASE_R, VASE_R);
    case 'pillar':
      return aabbHalf(prop.x, prop.z, PILLAR_HALF, PILLAR_HALF);
    case 'model': {
      if (!prop.collision) return null;
      // Use only the FIRST collision shape for the AABB read — most
      // props are single-shape; archways are the exception and we
      // don't currently nudge those.
      const shape = Array.isArray(prop.collision) ? prop.collision[0] : prop.collision;
      if (!shape) return null;
      const angle = prop.rotY ?? 0;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const ox = shape.ox ?? 0;
      const oz = shape.oz ?? 0;
      const wox = ca * ox + sa * oz;
      const woz = -sa * ox + ca * oz;
      const cx = prop.x + wox;
      const cz = prop.z + woz;
      if (shape.kind === 'circle') {
        return aabbHalf(cx, cz, shape.r, shape.r);
      }
      const swap = Math.abs(ca) < 0.5;
      const hw = swap ? shape.halfD : shape.halfW;
      const hd = swap ? shape.halfW : shape.halfD;
      return aabbHalf(cx, cz, hw, hd);
    }
    // No collision — walkable.
    case 'corpse':
    case 'spike-trap':
    case 'vase-cluster':   // multi-instance — passage check skips it
    // 'cobweb' DOES block, but it's an intentional destructible gate —
    // return null so the corridor-clearance nudge + reachability rescue
    // leave it alone (the player clears it by slashing, not by walking
    // around it).
    case 'cobweb':
    case 'hint':
    case 'group':
      return null;
  }
  return null;
}

function aabbHalf(x: number, z: number, hx: number, hz: number): PropAABB {
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

/** Apply a nudge to a prop in-place. The PropSpec's x/z move; any
 *  cached AABB is invalidated. Used by the passage-clearance pass. */
export function nudgeProp(prop: PropSpec & { x: number; z: number }, dx: number, dz: number): void {
  prop.x += dx;
  prop.z += dz;
}
