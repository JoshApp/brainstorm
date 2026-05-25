import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Style } from './index';
import { applyStoneShader } from './stone-shader';

// Per-style material library — only the BIG STATIC SURFACES of the level
// (walls, floor, ceiling). Dynamic entities (enemies, sword, torches, future
// chests) own their materials via ModelSpec.materials so per-instance state
// (hit flash, independent flame flicker) doesn't bleed across instances.

export interface StyleMaterials {
  wall: THREE.Material;
  floor: THREE.Material;
  ceiling: THREE.Material;
}

export function buildMaterials(style: Style): StyleMaterials {
  // For FLAT style: hard-faceted surfaces + slightly punchier colors so the
  // facets read as polygons rather than mud.
  const flat = style === 'flat';

  const wallBase = new THREE.MeshStandardMaterial({
    color: flat ? 0x2a221c : CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: flat,
    vertexColors: true,   // per-vertex tint jitter breaks up uniform surfaces
  });
  const floorBase = new THREE.MeshStandardMaterial({
    color: flat ? 0x1a1410 : CONFIG.FLOOR_COLOR,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: flat,
    vertexColors: true,
  });
  const ceilingBase = new THREE.MeshStandardMaterial({
    color: CONFIG.CEILING_COLOR,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: flat,
  });

  // For STONE style: inject a procedural noise+mortar shader on the wall/floor
  // so they read as actual masonry, not just a flat color.
  if (style === 'stone') {
    applyStoneShader(wallBase, { scale: 5.5, mortarColor: 0x05030a, baseColor: 0x35281e });
    applyStoneShader(floorBase, { scale: 4.0, mortarColor: 0x040303, baseColor: 0x1f1612 });
  }

  return {
    wall: wallBase,
    floor: floorBase,
    ceiling: ceilingBase,
  };
}
