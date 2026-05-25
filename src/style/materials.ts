import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Style } from './index';
import { applyStoneShader } from './stone-shader';

// Per-style material library. Centralizes all material decisions so the rest
// of the codebase (dungeon, sword, enemy, torchlight) just asks "give me the
// wall material for the current style" without knowing how each style works.

export interface StyleMaterials {
  wall: THREE.Material;
  floor: THREE.Material;
  ceiling: THREE.Material;
  swordBlade: THREE.Material;
  swordGuard: THREE.Material;
  swordHilt: THREE.Material;
  swordPommel: THREE.Material;
  torchBracket: THREE.Material;
  torchFlame: THREE.MeshStandardMaterial;
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
  });
  const floorBase = new THREE.MeshStandardMaterial({
    color: flat ? 0x1a1410 : CONFIG.FLOOR_COLOR,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: flat,
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
    swordBlade: new THREE.MeshStandardMaterial({
      color: 0x9a978f,
      roughness: 0.4,
      metalness: 0.85,
      fog: false,
      flatShading: flat,
    }),
    swordGuard: new THREE.MeshStandardMaterial({
      color: 0x3a2f22,
      roughness: 0.7,
      metalness: 0.6,
      fog: false,
      flatShading: flat,
    }),
    swordHilt: new THREE.MeshStandardMaterial({
      color: 0x1a1410,
      roughness: 0.9,
      metalness: 0.1,
      fog: false,
      flatShading: flat,
    }),
    swordPommel: new THREE.MeshStandardMaterial({
      color: 0x4a3a26,
      roughness: 0.6,
      metalness: 0.7,
      fog: false,
      flatShading: flat,
    }),
    torchBracket: new THREE.MeshStandardMaterial({
      color: 0x14110d,
      roughness: 0.85,
      metalness: 0.5,
      flatShading: flat,
    }),
    torchFlame: new THREE.MeshStandardMaterial({
      color: 0xffcc88,
      emissive: 0xff8844,
      emissiveIntensity: 3.0,
      roughness: 0.4,
      metalness: 0.0,
    }),
  };
}
