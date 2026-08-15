import * as THREE from 'three';
import { CONFIG } from '../config';
import { installSurfaceDetail, installNamedSurfaceDetail, registerSurfaceDetail } from './surface-detail';
import { bakeSurfaceTexture, SURFACE_TILE } from './surface-textures';
import type { DelveRenderer } from '../scene/create-renderer';

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

export function buildMaterials(renderer: DelveRenderer): StyleMaterials {
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
    // ROUGHNESS 1.0 → 0.72, and this is the half that isn't about colour.
    //
    // Wall 0.95 vs floor 1.0 is no difference at all: both are fully matte, so
    // both return light the same way and only the albedo separates them — and
    // with near-black albedo the LIGHT dominates, so they collapse into one
    // material at two brightnesses. That's the real reason value contrast alone
    // never fixed this.
    //
    // A rougher-than-matte floor can't have a highlight; a smoother one can.
    // At 0.72 the flagstones take a broad grazing sheen from torchlight — damp
    // stone — which does three things a colour change cannot: it CARRIES THE
    // LIGHT'S COLOUR (the premise Josh wants kept), it MOVES with the player,
    // and it responds to where the flame actually is. Floor and wall now differ
    // in how they answer light, not just in what colour they are.
    roughness: 0.72,
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

  // Chasm/crack drop walls + ceiling-shaft walls. Wall BRICK (the faces are
  // vertical, so they texture correctly), double-sided so the inner faces
  // show. vertexColors:true is load-bearing: the shaft/drop geometry bakes a
  // depth fade into its vertex colours (bright at the rim/lip → pure black a
  // few metres in — see applyDepthFade in geometry-prims.ts), which is what
  // makes a pit read as an abyss instead of a lit box. Emissive must stay
  // ZERO — vertex colour only multiplies albedo, so any emissive would leave
  // a residual glow at full depth and the void would never reach black.
  const chasmWall = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    vertexColors: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
  // Wall/floor baked AO rides the materials' vertexColors natively (node
  // pipeline multiplies vColor into diffuse) — no install step needed.

  // Baked, mipmapped tiling stone detail. WALLS = brick, FLOOR = flagstones,
  // CEILING = coffered panels (its own language). Warm tint on the floor, cold
  // on the ceiling, neutral walls. Mipmaps + anisotropy keep it stable under
  // the 0.4x render scale (no crawl/flicker).
  const wallTex = bakeSurfaceTexture(renderer, 'wall');
  installSurfaceDetail(wallBase, {
    splat: true,
    brickDamage: true, grooveFill: true, seamGlow: true,
    tex: wallTex,
    tile: SURFACE_TILE.wall, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.30,
  });
  installSurfaceDetail(chasmWall, {
    splat: true,
    tex: wallTex, brickDamage: true, grooveFill: true, seamGlow: true,
    tile: SURFACE_TILE.wall, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.30,
  });
  installSurfaceDetail(floorBase, {
    // Floor: SHADOW only (subtle), no coloured glow — the glow on the ground was
    // too light/yellow and broke the grimdark. Just a quiet darken in the gaps.
    splat: true, seamShadow: true, seamGlowScale: 0.35,
    tex: bakeSurfaceTexture(renderer, 'floor'),
    // TINT WAS [1.08, 0.9, 0.64] — a hard amber multiply on the floor's albedo:
    // blue cut by 36%. THAT is why the floor and the wall read as the same
    // stone. Josh: *"the floor and wall look the exact same hue ... they have
    // the exact same shade."* The wall's tint is neutral [1,1,1], so the floor
    // was being pushed warm to meet it, and any change to FLOOR_COLOR was
    // multiplied straight back out again — which is why making the base colour
    // cool did nothing visible.
    //
    // Now cool, mirroring the ceiling's existing [0.7, 0.8, 1.05]. The system
    // always supported per-surface tinting; the floor was simply authored warm.
    tile: SURFACE_TILE.floor, proj: 'horiz', tint: [0.90, 0.97, 1.12], relief: 0.32,
  });
  installSurfaceDetail(ceilingBase, {
    seamShadow: true,   // panel/beam SHADOW for depth — no coloured glow (that looked weird up there)
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
