import * as THREE from 'three';
import { CONFIG } from '../config';
import { installSurfaceAO } from './surface-ao';
import { installSurfaceDetail, installNamedSurfaceDetail, registerSurfaceDetail } from './surface-detail';
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
  /** Stone for PROPS (pillars, etc.) — wall colour, faint grain (no brick). */
  stone: THREE.Material;
  /** Dressed/ashlar stone for FRAMING — archways, doorframes, lintels. */
  dressed: THREE.Material;
  /** Wall brick, no vertex colours, double-sided — for chasm/crack drop walls. */
  chasmWall: THREE.Material;
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

  // Stone for props (pillars). Same near-black stone as the walls. Gets a FAINT
  // grain (below) — not brick — so a round shaft catches torchlight without the
  // masonry pattern smearing around its curve.
  const propStone = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
  });

  // Dressed/ashlar stone for architectural FRAMING (archways, doorframes,
  // lintels). Big even blocks, thin clean joints — "finished" stone that frames
  // a passage, contrasting the rough masonry walls. Detail installed below.
  const dressedBase = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.92,
    metalness: 0.0,
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
  });

  // Chasm/crack drop walls — the vertical sides of floor voids. Wall BRICK
  // (their walls are vertical, so they texture correctly) but NO vertex colours
  // (the drop geometry carries none — vertexColors:true would render it black)
  // and double-sided so the inner faces show. Shares the wall texture (below).
  const chasmWall = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
    side: THREE.DoubleSide,
  });

  // Live-controllable baked surface AO (wall/floor vertex colours).
  installSurfaceAO(wallBase);
  installSurfaceAO(floorBase);

  // Baked, mipmapped tiling stone detail. WALLS = brick, FLOOR = flagstones,
  // CEILING = coffered panels (its own language). Warm tint on the floor, cold
  // on the ceiling, neutral walls. Mipmaps + anisotropy keep it stable under
  // the 0.4x render scale (no crawl/flicker).
  const wallTex = bakeSurfaceTexture(renderer, 'wall');
  installSurfaceDetail(wallBase, {
    splat: true,
    brickDamage: true, grooveFill: true,
    tex: wallTex,
    tile: SURFACE_TILE.wall, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.30,
  });
  installSurfaceDetail(chasmWall, {
    splat: true,
    tex: wallTex, brickDamage: true, grooveFill: true,
    tile: SURFACE_TILE.wall, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.30,
  });
  installSurfaceDetail(floorBase, {
    splat: true,
    tex: bakeSurfaceTexture(renderer, 'floor'),
    tile: SURFACE_TILE.floor, proj: 'horiz', tint: [1.08, 0.9, 0.64], relief: 0.32,
  });
  installSurfaceDetail(ceilingBase, {
    tex: bakeSurfaceTexture(renderer, 'ceiling'),
    tile: SURFACE_TILE.ceiling, proj: 'horiz', tint: [0.7, 0.8, 1.05], relief: 0.32,
  });

  // Framing (dressed ashlar) + prop columns (faint grain). Register the dressed
  // config by name too, so the ModelSpec compiler can opt archways/doorframes in.
  const dressedCfg = {
    tex: bakeSurfaceTexture(renderer, 'dressed'),
    tile: SURFACE_TILE.dressed, proj: 'wall' as const, tint: [1.0, 1.0, 1.0] as const, relief: 0.16,
  };
  installSurfaceDetail(dressedBase, dressedCfg);
  registerSurfaceDetail('dressed', dressedCfg);
  registerSurfaceDetail('grain', {
    tex: bakeSurfaceTexture(renderer, 'grain'),
    tile: SURFACE_TILE.grain, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.05,
  });
  installNamedSurfaceDetail(propStone, 'grain');   // columns: faint grain only

  return {
    wall: wallBase,
    floor: floorBase,
    ceiling: ceilingBase,
    timber: timberBase,
    stone: propStone,
    dressed: dressedBase,
    chasmWall,
  };
}
