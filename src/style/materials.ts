import * as THREE from 'three';
import { CONFIG } from '../config';
import { installSurfaceAO } from './surface-ao';
import { installSurfaceDetail } from './surface-detail';
import { bakeSurfaceTexture, SURFACE_TILE } from './surface-textures';

// Material library for the BIG STATIC SURFACES of the level (walls, floor,
// ceiling). Dynamic entities (enemies, sword, torches, chests) own their
// materials via ModelSpec.materials so per-instance state (hit flash,
// independent flame flicker) doesn't bleed across instances.

export interface StyleMaterials {
  wall: THREE.Material;
  floor: THREE.Material;
  ceiling: THREE.Material;
  /** Aged dark timber — mine-shaft bracing + plank doors. */
  timber: THREE.Material;
  /** Plain stone for PROPS (pillars, etc.) — wall colour, no brick detail. */
  stone: THREE.Material;
}

export function buildMaterials(renderer: THREE.WebGLRenderer): StyleMaterials {
  // Emissive baseline: a tiny self-luminance on every static surface so
  // even unlit corners imply geometry ("stone, but barely") instead of
  // reading as black void. Way better than cranking global ambient,
  // which would flatten the warm/cool torch contrast.
  const wallEmissive  = 0x0a0805;
  const floorEmissive = 0x06050a;
  const ceilEmissive  = 0x040303;
  const emissiveBoost = 1.0;

  const wallBase = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    vertexColors: true,   // per-vertex tint jitter breaks up uniform surfaces
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
    // Wall planes are single quads with their normal facing INTO the
    // room. When the player stands in a corridor and sees the back
    // side of the adjacent vault's south wall (or vice versa), back-
    // face culling would render it invisible — looked like "the wall
    // is missing a side." Double-sided is the small-cost fix; with
    // our wall count it doesn't move the perf needle.
    side: THREE.DoubleSide,
  });
  const floorBase = new THREE.MeshStandardMaterial({
    color: CONFIG.FLOOR_COLOR,
    roughness: 1.0,
    metalness: 0.0,
    vertexColors: true,
    emissive: floorEmissive,
    emissiveIntensity: emissiveBoost,
  });
  const ceilingBase = new THREE.MeshStandardMaterial({
    color: CONFIG.CEILING_COLOR,
    roughness: 1.0,
    metalness: 0.0,
    emissive: ceilEmissive,
    emissiveIntensity: emissiveBoost,
  });

  // Timber — aged dark wood for mine-shaft bracing and plank doors. Warmer
  // and a touch lighter than the near-black stone so framing/doors read as a
  // distinct material under torchlight without breaking the grimdark palette.
  const timberBase = new THREE.MeshStandardMaterial({
    color: 0x3a2a18,
    roughness: 1.0,
    metalness: 0.0,
    emissive: 0x0a0703,
    emissiveIntensity: emissiveBoost,
  });

  // Plain stone for props (pillars). Same near-black stone as the walls, but
  // WITHOUT the brick surface-detail — the running-bond pattern is for the big
  // architectural planes; wrapping it around a round shaft read wrong and no
  // other prop uses it. Kept as its own material so props share one draw state.
  const propStone = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
  });

  // Live-controllable baked surface AO (wall/floor vertex colours).
  installSurfaceAO(wallBase);
  installSurfaceAO(floorBase);

  // Baked, mipmapped tiling stone detail. WALLS = brick, FLOOR = flagstones,
  // CEILING = coffered panels (its own language). Warm tint on the floor, cold
  // on the ceiling, neutral walls. Mipmaps + anisotropy keep it stable under
  // the 0.4x render scale (no crawl/flicker).
  installSurfaceDetail(wallBase, {
    tex: bakeSurfaceTexture(renderer, 'wall'),
    tile: SURFACE_TILE.wall, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.25,
  });
  installSurfaceDetail(floorBase, {
    tex: bakeSurfaceTexture(renderer, 'floor'),
    tile: SURFACE_TILE.floor, proj: 'horiz', tint: [1.08, 0.9, 0.64], relief: 0.32,
  });
  installSurfaceDetail(ceilingBase, {
    tex: bakeSurfaceTexture(renderer, 'ceiling'),
    tile: SURFACE_TILE.ceiling, proj: 'horiz', tint: [0.7, 0.8, 1.05], relief: 0.32,
  });

  return {
    wall: wallBase,
    floor: floorBase,
    ceiling: ceilingBase,
    timber: timberBase,
    stone: propStone,
  };
}
