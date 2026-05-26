// Auto-decoration pass for procgen floors.
//
// Templates author the SHAPE of a floor (walls, encounters, stairs).
// This pass walks the same grid and sprinkles tiny emissive details on
// walls and floors — wall sigils, floor cracks — so every cell of an
// empty room has SOMETHING for the eye to find. The result: dark areas
// feel like an inhabited place rather than empty space.
//
// Details use the floor's torch tint so they reinforce per-floor color
// identity. Density is deterministic via the same RNG seed the level
// generator uses, so a resumed floor decorates identically.

import type { LevelSpec, TileMap, PropSpec } from './types';
import type { ModelSpec } from '../ecs/model-types';

const FLOOR_CHARS = new Set('.,SoO/^FCGRKWPAcTt<>'.split(''));
// Cells with explicit gameplay content — skip decoration on top of them
// so a sigil doesn't end up overlapping a corpse / fountain / spawn.
const NO_DECORATE_CHARS = new Set('SoO/^FCGRKWPAc'.split(''));

const SIGIL_CHANCE = 0.07;   // per (cell × wall-neighbor) roll
const CRACK_CHANCE = 0.06;   // per cell roll
const RUBBLE_CHANCE = 0.04;  // per cell roll

/**
 * Decorate a floor: mutates spec.props with sigils on walls + cracks
 * on floor cells. Deterministic given the same RNG.
 */
export function decorateFloor(
  grid: TileMap,
  spec: LevelSpec,
  rand: () => number,
  tint: number,
): void {
  const rows = grid.length;
  const cols = Math.max(...grid.map(r => r.length));
  const originX = -cols / 2;
  const originZ = -rows / 2;

  const cellChar = (c: number, r: number): string => {
    if (r < 0 || r >= rows) return ' ';
    const row = grid[r] ?? '';
    return row[c] ?? ' ';
  };
  const isFloor = (c: number, r: number): boolean => FLOOR_CHARS.has(cellChar(c, r));

  // One model spec per kind per floor; props all reference these so
  // buildModel doesn't allocate fresh materials per decoration.
  const sigilModel = makeSigilModel(brighten(tint, 0.55));
  const crackModel = makeCrackModel(darken(tint, 0.4));
  const rubbleModel = makeRubbleModel();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = cellChar(c, r);
      if (!FLOOR_CHARS.has(ch)) continue;
      if (NO_DECORATE_CHARS.has(ch)) continue;

      const wx = originX + c + 0.5;
      const wz = originZ + r + 0.5;

      // ── Wall sigils: roll once per WALL-NEIGHBOR direction ──────
      // North wall (cell to z-1 is non-floor) → sigil at the cell's
      // north edge, facing south (rotY=0 since wall faces -Z inward).
      const neighbors: Array<{ dx: number; dz: number; rotY: number; offX: number; offZ: number }> = [
        { dx: 0,  dz: -1, rotY: 0,            offX: 0,    offZ: -0.49 },
        { dx: 0,  dz:  1, rotY: Math.PI,      offX: 0,    offZ:  0.49 },
        { dx: -1, dz:  0, rotY: Math.PI / 2,  offX: -0.49, offZ: 0   },
        { dx:  1, dz:  0, rotY: -Math.PI / 2, offX:  0.49, offZ: 0   },
      ];
      for (const n of neighbors) {
        if (isFloor(c + n.dx, r + n.dz)) continue;  // not adjacent to wall here
        if (rand() < SIGIL_CHANCE) {
          spec.props.push({
            kind: 'model',
            model: sigilModel,
            x: wx + n.offX,
            y: 0.9 + rand() * 1.0,  // varied height — chest to head level
            z: wz + n.offZ,
            rotY: n.rotY,
          } as PropSpec);
        }
      }

      // ── Floor cracks: one roll per cell, varied angle ───────────
      if (rand() < CRACK_CHANCE) {
        spec.props.push({
          kind: 'model',
          model: crackModel,
          x: wx + (rand() - 0.5) * 0.4,
          y: 0.01,
          z: wz + (rand() - 0.5) * 0.4,
          rotY: rand() * Math.PI,
        } as PropSpec);
      }

      // ── Rubble piles (small dark chunks on the floor). Add visual
      // texture in walkable space without affecting collision. Skip
      // doorway cells (don't trip the player on the threshold).
      if (rand() < RUBBLE_CHANCE) {
        spec.props.push({
          kind: 'model',
          model: rubbleModel,
          x: wx + (rand() - 0.5) * 0.5,
          y: 0,
          z: wz + (rand() - 0.5) * 0.5,
          rotY: rand() * Math.PI * 2,
        } as PropSpec);
      }
    }
  }
}

// ── Model specs ────────────────────────────────────────────────────

function makeSigilModel(color: number): ModelSpec {
  return {
    id: `sigil-${color.toString(16)}`,
    materials: {
      glyph: {
        color: 0x000000,
        emissive: color,
        emissiveIntensity: 1.4,
        roughness: 1.0,
        fog: false,
      },
    },
    parts: [
      // Greek-cross-ish glyph: a vertical bar + horizontal bar.
      { kind: 'box', pos: [0, 0, 0.012],  size: [0.04, 0.16, 0.012], mat: 'glyph' },
      { kind: 'box', pos: [0, 0, 0.012],  size: [0.16, 0.04, 0.012], mat: 'glyph' },
    ],
  };
}

function makeCrackModel(color: number): ModelSpec {
  return {
    id: `crack-${color.toString(16)}`,
    materials: {
      crack: {
        color: 0x000000,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 1.0,
        fog: false,
      },
    },
    parts: [
      // A jagged crack — three thin boxes at slight angles approximate
      // a fissure on the floor. All emissive so it reads as "something
      // glowing through cracked stone."
      { kind: 'box', pos: [0,    0, 0],    size: [0.32, 0.012, 0.025], mat: 'crack' },
      { kind: 'box', pos: [0.12, 0, 0.04], size: [0.18, 0.012, 0.02],  mat: 'crack', rot: [0, 0.3, 0] },
      { kind: 'box', pos: [-0.10, 0, -0.04], size: [0.14, 0.012, 0.02], mat: 'crack', rot: [0, -0.5, 0] },
    ],
  };
}

function makeRubbleModel(): ModelSpec {
  return {
    id: 'rubble',
    materials: {
      stone: {
        color: 0x252018,
        roughness: 1.0,
        metalness: 0.0,
        flatShading: true,
      },
    },
    parts: [
      { kind: 'box', pos: [0,    0.04, 0],     size: [0.18, 0.08, 0.16], mat: 'stone' },
      { kind: 'box', pos: [0.12, 0.025, 0.08], size: [0.10, 0.05, 0.10], mat: 'stone', rot: [0, 0.4, 0] },
      { kind: 'box', pos: [-0.08, 0.02, -0.05], size: [0.08, 0.04, 0.07], mat: 'stone', rot: [0, -0.7, 0] },
    ],
  };
}

// ── Color helpers ──────────────────────────────────────────────────

function brighten(hex: number, t: number): number {
  const r = Math.min(255, ((hex >> 16) & 0xff) + (255 - ((hex >> 16) & 0xff)) * t);
  const g = Math.min(255, ((hex >> 8) & 0xff)  + (255 - ((hex >> 8) & 0xff))  * t);
  const b = Math.min(255, (hex & 0xff)         + (255 - (hex & 0xff))         * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function darken(hex: number, t: number): number {
  const r = ((hex >> 16) & 0xff) * (1 - t);
  const g = ((hex >> 8) & 0xff)  * (1 - t);
  const b = (hex & 0xff)         * (1 - t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
