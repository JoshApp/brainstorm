import * as THREE from 'three';
import type { LevelSpec, TileMap } from './types';
import { brighten, darken } from '../style/color-utils';
import { stdMat } from '../style/material-registry';

// Auto-decoration pass for procgen floors.
//
// Templates author the SHAPE of a floor (walls, encounters, stairs).
// This pass walks the same grid and scatters tiny emissive details on
// walls and floors — wall sigils, floor cracks, rubble piles — so every
// cell of an empty room has SOMETHING for the eye to find.
//
// PERF: every decoration of the same kind is rendered as ONE InstancedMesh
// per sub-geometry, not N draw calls per N decorations. A procgen floor
// with 15 sigils + 5 cracks + 4 rubble used to be ~50 draw calls; now
// it's 8 (2 per sigil sub-mesh + 3 per crack sub-mesh + 3 per rubble
// sub-mesh). Plus the emissive materials are shared across all instances
// of a kind, so material count stays flat.

const FLOOR_CHARS = new Set('.,SoO/^FCGRKWPAcvVTt<>'.split(''));
const NO_DECORATE_CHARS = new Set('SoO/^FCGRKWPAc'.split(''));

const SIGIL_CHANCE = 0.04;
const CRACK_CHANCE = 0.03;
const RUBBLE_CHANCE = 0.02;
const NICHE_CHANCE = 0.012;

interface InstancePlacement {
  /** Local position offset of this sub-mesh relative to the decoration's
   *  anchor point (the cell center for cracks/rubble, the wall surface
   *  for sigils). */
  pos: [number, number, number];
  /** Local size of the box for this sub-mesh. */
  size: [number, number, number];
  /** Optional local rotation about Y. */
  rotY?: number;
}

// Geometry for each decoration kind. Each entry becomes ONE InstancedMesh
// per FLOOR — drawn in a single draw call regardless of N instances.
const SIGIL_PARTS: InstancePlacement[] = [
  { pos: [0, 0, 0.012], size: [0.04, 0.16, 0.012] },  // vertical bar
  { pos: [0, 0, 0.012], size: [0.16, 0.04, 0.012] },  // horizontal bar
];

const CRACK_PARTS: InstancePlacement[] = [
  { pos: [0,     0, 0],     size: [0.32, 0.012, 0.025] },
  { pos: [0.12,  0, 0.04],  size: [0.18, 0.012, 0.02], rotY: 0.3 },
  { pos: [-0.10, 0, -0.04], size: [0.14, 0.012, 0.02], rotY: -0.5 },
];

const RUBBLE_PARTS: InstancePlacement[] = [
  { pos: [0,     0.04,  0],     size: [0.18, 0.08, 0.16] },
  { pos: [0.12,  0.025, 0.08],  size: [0.10, 0.05, 0.10], rotY: 0.4 },
  { pos: [-0.08, 0.02,  -0.05], size: [0.08, 0.04, 0.07], rotY: -0.7 },
];

// NICHE (box-buster #2): a faked wall recess — dressed jambs + lintel
// around a near-black void plate, a pale relic on the sill, a dim
// votive ember. Flush-mounted on the wall; the dark plate DOES the
// recess (the oldest depth lie in the book). Four material groups
// sharing one anchor list — four InstancedMesh sets per floor total.
const NICHE_FRAME_PARTS: InstancePlacement[] = [
  { pos: [-0.33, 0, 0.035], size: [0.08, 0.92, 0.07] },
  { pos: [0.33, 0, 0.035], size: [0.08, 0.92, 0.07] },
  { pos: [0, 0.50, 0.035], size: [0.74, 0.08, 0.07] },
  { pos: [0, -0.495, 0.05], size: [0.74, 0.07, 0.10] },
];
const NICHE_INNER_PARTS: InstancePlacement[] = [
  { pos: [0, 0, 0.012], size: [0.58, 0.92, 0.025] },
];
const NICHE_RELIC_PARTS: InstancePlacement[] = [
  { pos: [0, -0.37, 0.07], size: [0.15, 0.12, 0.12] },
  { pos: [0.06, -0.43, 0.08], size: [0.20, 0.05, 0.06], rotY: 0.4 },
];
const NICHE_EMBER_PARTS: InstancePlacement[] = [
  { pos: [0, -0.29, 0.055], size: [0.05, 0.05, 0.03] },
];

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3(1, 1, 1);

/**
 * Sprinkle decorations onto a procgen floor as INSTANCED meshes added
 * directly to the given root group. Returns nothing — side-effect only.
 */
export function decorateFloor(
  grid: TileMap,
  spec: LevelSpec,
  rand: () => number,
  tint: number,
  root: THREE.Object3D,
  /**
   * KEEP-OUT rectangles in world XZ. A cell whose centre falls in any of them
   * is not decorated at all. Three things use it, for the same reason — clutter
   * is the cheapest thing on the floor and the first thing that should yield:
   *
   *   - STAIR FOOTPRINTS: rubble would float in mid-air over the cut where the
   *     stairwell descends.
   *   - CLEAN ROOMS (room-types.ts `clean`): a trove's whole job is that you
   *     can see three things and choose; anything else on that floor is in the
   *     way, and this pass runs long after the composer's own decor gate.
   *   - INTERACTABLES: a chest that opens into a rubble pile, an offering with
   *     debris growing out of its plinth. Things stuck inside things.
   */
  keepOut: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [],
): void {
  const rows = grid.length;
  const cols = Math.max(...grid.map(r => r.length));
  const originX = -cols / 2;
  const originZ = -rows / 2;

  const cellChar = (c: number, r: number): string => {
    if (r < 0 || r >= rows) return ' ';
    return grid[r]?.[c] ?? ' ';
  };
  const isFloor = (c: number, r: number): boolean => FLOOR_CHARS.has(cellChar(c, r));
  const inKeepOut = (wx: number, wz: number): boolean => {
    for (const f of keepOut) {
      if (wx >= f.minX && wx <= f.maxX && wz >= f.minZ && wz <= f.maxZ) return true;
    }
    return false;
  };

  // Collect anchors first so we know how many instances each kind needs;
  // each anchor has a final world-space position + rotation.
  interface Anchor { x: number; y: number; z: number; rotY: number; }
  const sigilAnchors: Anchor[] = [];
  const crackAnchors: Anchor[] = [];
  const rubbleAnchors: Anchor[] = [];
  const nicheAnchors: Anchor[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = cellChar(c, r);
      if (!FLOOR_CHARS.has(ch)) continue;
      const cellWx = originX + c + 0.5;
      const cellWz = originZ + r + 0.5;
      if (inKeepOut(cellWx, cellWz)) continue;
      if (NO_DECORATE_CHARS.has(ch)) continue;
      const wx = originX + c + 0.5;
      const wz = originZ + r + 0.5;

      // Wall sigils: one roll per wall-adjacent direction.
      const dirs: Array<{ dx: number; dz: number; rotY: number; offX: number; offZ: number }> = [
        { dx: 0,  dz: -1, rotY: 0,            offX: 0,     offZ: -0.49 },
        { dx: 0,  dz:  1, rotY: Math.PI,      offX: 0,     offZ:  0.49 },
        { dx: -1, dz:  0, rotY: Math.PI / 2,  offX: -0.49, offZ: 0 },
        { dx:  1, dz:  0, rotY: -Math.PI / 2, offX:  0.49, offZ: 0 },
      ];
      for (const n of dirs) {
        if (isFloor(c + n.dx, r + n.dz)) continue;
        if (rand() < SIGIL_CHANCE) {
          sigilAnchors.push({
            x: wx + n.offX,
            y: 0.9 + rand() * 1.0,
            z: wz + n.offZ,
            rotY: n.rotY,
          });
        }
        // Wall niches — rarer than sigils; a corpse-hole with a relic.
        // The niche spans 0.74m of a 1m cell, centred, so it stays
        // clear of the openings the segment grid already excludes.
        else if (rand() < NICHE_CHANCE) {
          nicheAnchors.push({
            x: wx + n.offX * 0.96,
            y: 1.05,
            z: wz + n.offZ * 0.96,
            rotY: n.rotY,
          });
        }
      }
      // Floor cracks.
      if (rand() < CRACK_CHANCE) {
        crackAnchors.push({
          x: wx + (rand() - 0.5) * 0.4,
          y: 0.01,
          z: wz + (rand() - 0.5) * 0.4,
          rotY: rand() * Math.PI,
        });
      }
      // Rubble piles.
      if (rand() < RUBBLE_CHANCE) {
        rubbleAnchors.push({
          x: wx + (rand() - 0.5) * 0.5,
          y: 0,
          z: wz + (rand() - 0.5) * 0.5,
          rotY: rand() * Math.PI * 2,
        });
      }
    }
  }

  // Materials — one per kind, shared by all instances. Tint pulled
  // from the floor's torch color so decorations reinforce identity.
  const sigilMat = stdMat({
    color: 0x000000,
    emissive: brighten(tint, 0.55),
    emissiveIntensity: 1.4,
    roughness: 1.0,
    fog: false,
  });
  const crackMat = stdMat({
    color: 0x000000,
    emissive: darken(tint, 0.4),
    emissiveIntensity: 0.9,
    roughness: 1.0,
    fog: false,
  });
  const rubbleMat = stdMat({
    color: 0x252018,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
  });

  // Reference to the spec so other code can see how many decorations
  // got placed (informational — not used by the runtime currently).
  void spec;

  const nicheStoneMat = stdMat({
    color: 0x35302a, roughness: 0.8, metalness: 0.05, flatShading: true,
  });
  const nicheVoidMat = stdMat({
    color: 0x040405, roughness: 1.0,
  });
  const nicheBoneMat = stdMat({
    color: 0x9a8d74, roughness: 0.95, flatShading: true,
  });
  const nicheEmberMat = stdMat({
    color: 0x000000, emissive: brighten(tint, 0.3), emissiveIntensity: 0.9,
    roughness: 1.0, fog: false,
  });

  buildInstancedKind(root, SIGIL_PARTS, sigilAnchors, sigilMat);
  buildInstancedKind(root, CRACK_PARTS, crackAnchors, crackMat);
  buildInstancedKind(root, RUBBLE_PARTS, rubbleAnchors, rubbleMat);
  buildInstancedKind(root, NICHE_FRAME_PARTS, nicheAnchors, nicheStoneMat);
  buildInstancedKind(root, NICHE_INNER_PARTS, nicheAnchors, nicheVoidMat);
  buildInstancedKind(root, NICHE_RELIC_PARTS, nicheAnchors, nicheBoneMat);
  buildInstancedKind(root, NICHE_EMBER_PARTS, nicheAnchors, nicheEmberMat);
}

function buildInstancedKind(
  root: THREE.Object3D,
  parts: InstancePlacement[],
  anchors: Array<{ x: number; y: number; z: number; rotY: number }>,
  material: THREE.Material,
): void {
  if (anchors.length === 0) return;
  // One InstancedMesh per sub-part — each has its own box geometry.
  for (const part of parts) {
    const geom = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
    const inst = new THREE.InstancedMesh(geom, material, anchors.length);
    inst.castShadow = false;
    inst.receiveShadow = false;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      // World position = anchor + (anchor's rotation applied to part offset).
      const cosY = Math.cos(a.rotY);
      const sinY = Math.sin(a.rotY);
      const pox = part.pos[0] * cosY - part.pos[2] * sinY;
      const poz = part.pos[0] * sinY + part.pos[2] * cosY;
      tmpPos.set(a.x + pox, a.y + part.pos[1], a.z + poz);
      tmpEuler.set(0, a.rotY + (part.rotY ?? 0), 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      inst.setMatrixAt(i, tmpMatrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
  }
}

