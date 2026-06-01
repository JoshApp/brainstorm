import * as THREE from 'three';
import type { StyleMaterials } from '../style/materials';
import { buildModel } from '../ecs/build-model';
import { buildRng, buildRngInt } from '../engine/rng';
import {
  ALTAR_BOWL, ALTAR_CHALICE, ALTAR_DAGGER, ALTAR_BONES, ALTAR_CANDLE_STUB,
  type AltarItemEntry,
} from '../content/altar-items';
import { ALTAR_SKULL } from '../content/relics';
import { pooledBox, pooledCylinder } from '../scene/geometry-pool';

// Inline scene builders for pillar + altar.
//
// The original builder.ts emitted a plain box for the pillar and
// a box-on-a-box for the altar — both were the visual nadir of
// the dungeon's set dressing. These helpers replace them with
// richer geometry while keeping the call sites in builder.ts
// minimal.
//
// Each function returns a Group that the caller adds to root +
// pushes the matching obstacle for. Geometry shares the existing
// StyleMaterials so palette stays consistent across rooms.
//
// All primitive geometries route through scene/geometry-pool.ts so
// every identical part across every pillar/altar instance shares
// the same vertex buffer.
//
// ── Seam fix ──────────────────────────────────────────────────────
// Stacked segments (plinth → bead → shaft → bead → capital) used to
// meet at EXACT y boundaries — both pieces' edges sat at the same
// coordinate. Camera-angle-dependent sub-pixel gaps showed the floor
// behind through the seam. Now every piece extends by SEAM_BLEED at
// each end (half above, half below) so adjacent pieces overlap by
// SEAM_BLEED. The silhouette grows by an invisible 3mm per side; the
// seam never appears.
const SEAM_BLEED = 0.008;

// ── Pillar ────────────────────────────────────────────────────────
//
// Five segments stacked along Y:
//   1. Lower plinth — slightly wider square base
//   2. Lower torus — small bead between plinth and shaft
//   3. Shaft       — octagonal-ish cross-section (we render as a
//                    cylinder with 8 segments so it reads as a
//                    chiseled column from any angle without
//                    needing a custom geometry)
//   4. Upper torus — capital bead matching the lower
//   5. Capital     — wider square cap at the top
// Plus 4 thin vertical fluting boxes recessed into the shaft to
// catch torchlight.

export function buildAltarPillar(
  x: number, z: number,
  size: number,
  height: number,
  materials: StyleMaterials,
): { group: THREE.Group; obstacle: { minX: number; maxX: number; minZ: number; maxZ: number } } {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // The shaft sits between the plinth + capital. We allocate
  // 12% of height to plinth + capital combined.
  const plinthH = 0.18;
  const capitalH = 0.18;
  const beadH = 0.05;
  const shaftH = height - plinthH - capitalH - beadH * 2;

  const shaftRadius = size * 0.42;
  const plinthSide = size;
  const capitalSide = size * 1.05;

  const stone = materials.wall;

  // Plinth — wider square at the floor. Extended by SEAM_BLEED so
  // it overlaps the bead above; floor side stays at y=0 (the bleed
  // sinks into the floor mesh, which is what we want).
  const plinth = new THREE.Mesh(pooledBox(plinthSide, plinthH + SEAM_BLEED, plinthSide), stone);
  plinth.position.y = plinthH / 2 + SEAM_BLEED / 2;
  plinth.castShadow = true; plinth.receiveShadow = true;
  group.add(plinth);

  // Lower bead — torus-like band (we use a flattened cylinder).
  // Extended both ends — overlaps the plinth below and the shaft above.
  const lowerBead = new THREE.Mesh(
    pooledCylinder(shaftRadius * 1.18, shaftRadius * 1.18, beadH + SEAM_BLEED * 2, 16),
    stone,
  );
  lowerBead.position.y = plinthH + beadH / 2;
  lowerBead.castShadow = true; lowerBead.receiveShadow = true;
  group.add(lowerBead);

  // Shaft — 8-sided cylinder reads as a chiseled column. Extended
  // both ends to overlap the beads above and below.
  const shaft = new THREE.Mesh(
    pooledCylinder(shaftRadius, shaftRadius, shaftH + SEAM_BLEED * 2, 8),
    stone,
  );
  shaft.position.y = plinthH + beadH + shaftH / 2;
  shaft.castShadow = true; shaft.receiveShadow = true;
  group.add(shaft);

  // Thin vertical fluting boxes recessed into the shaft so
  // torchlight catches an edge. Four of them at compass points.
  const flutingThick = shaftRadius * 0.10;
  const flutingDepth = shaftRadius * 0.08;
  const flutingY = plinthH + beadH + shaftH / 2;
  for (const dir of [
    [shaftRadius - flutingDepth * 0.5, 0],
    [-(shaftRadius - flutingDepth * 0.5), 0],
    [0, shaftRadius - flutingDepth * 0.5],
    [0, -(shaftRadius - flutingDepth * 0.5)],
  ] as const) {
    const flute = new THREE.Mesh(
      pooledBox(
        Math.abs(dir[0]) > 0 ? flutingDepth : flutingThick,
        shaftH * 0.85,
        Math.abs(dir[1]) > 0 ? flutingDepth : flutingThick,
      ),
      stone,
    );
    flute.position.set(dir[0], flutingY, dir[1]);
    flute.castShadow = true; flute.receiveShadow = true;
    group.add(flute);
  }

  // Upper bead — mirror of the lower one. Extended both ends.
  const upperBead = new THREE.Mesh(
    pooledCylinder(shaftRadius * 1.18, shaftRadius * 1.18, beadH + SEAM_BLEED * 2, 16),
    stone,
  );
  upperBead.position.y = plinthH + beadH + shaftH + beadH / 2;
  upperBead.castShadow = true; upperBead.receiveShadow = true;
  group.add(upperBead);

  // Capital — wider square cap. Extended at the bottom to overlap
  // the upper bead; top stays at room height (no seam there since
  // the ceiling sits above).
  const capital = new THREE.Mesh(pooledBox(capitalSide, capitalH + SEAM_BLEED, capitalSide), stone);
  capital.position.y = height - capitalH / 2 - SEAM_BLEED / 2;
  capital.castShadow = true; capital.receiveShadow = true;
  group.add(capital);

  const half = size / 2;
  return {
    group,
    obstacle: {
      minX: x - half, maxX: x + half,
      minZ: z - half, maxZ: z + half,
    },
  };
}

// ── Altar ─────────────────────────────────────────────────────────
//
// Wider stepped base + main block + top slab, with 1-3 random
// ritual items placed on the top surface. Pool: bowl, chalice,
// dagger, bones, skull, candle stub. Each instance picks a
// random combination so altars look hand-dressed.

const ITEM_POOL: AltarItemEntry[] = [
  { model: ALTAR_BOWL,          weight: 4, halfExtent: 0.16 },
  { model: ALTAR_BONES,         weight: 4, halfExtent: 0.14 },
  { model: ALTAR_SKULL,         weight: 3, halfExtent: 0.14 },
  { model: ALTAR_CANDLE_STUB,   weight: 3, halfExtent: 0.07 },
  { model: ALTAR_CHALICE,       weight: 2, halfExtent: 0.10 },
  { model: ALTAR_DAGGER,        weight: 2, halfExtent: 0.12 },
];

// Altar dimensions — slightly wider than the original block.
const ALTAR_BASE_W = 1.30;
const ALTAR_BASE_D = 1.00;
const ALTAR_BASE_H = 0.14;
const ALTAR_STEP_W = 1.12;
const ALTAR_STEP_D = 0.82;
const ALTAR_STEP_H = 0.10;
const ALTAR_BODY_W = 0.94;
const ALTAR_BODY_D = 0.64;
const ALTAR_BODY_H = 0.50;
const ALTAR_SLAB_W = 1.04;
const ALTAR_SLAB_D = 0.72;
const ALTAR_SLAB_H = 0.08;

const ALTAR_TOP_Y =
  ALTAR_BASE_H + ALTAR_STEP_H + ALTAR_BODY_H + ALTAR_SLAB_H;

export function buildAltarBlock(
  x: number, z: number,
  materials: StyleMaterials,
): { group: THREE.Group; obstacle: { minX: number; maxX: number; minZ: number; maxZ: number } } {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const stone = materials.wall;
  const stoneFloor = materials.floor;

  // Stacked segments overlap by SEAM_BLEED at each interface — without
  // this, adjacent boxes meet at an exact y boundary and a sub-pixel
  // gap shows the floor through the seam at oblique camera angles.

  // Base — widest step. Extended upward to overlap the step above.
  const base = new THREE.Mesh(pooledBox(ALTAR_BASE_W, ALTAR_BASE_H + SEAM_BLEED, ALTAR_BASE_D), stoneFloor);
  base.position.y = ALTAR_BASE_H / 2 + SEAM_BLEED / 2;
  base.castShadow = true; base.receiveShadow = true;
  group.add(base);

  // Step — narrower than base. Extended both ends.
  const step = new THREE.Mesh(pooledBox(ALTAR_STEP_W, ALTAR_STEP_H + SEAM_BLEED * 2, ALTAR_STEP_D), stone);
  step.position.y = ALTAR_BASE_H + ALTAR_STEP_H / 2;
  step.castShadow = true; step.receiveShadow = true;
  group.add(step);

  // Body — the main altar block. Extended both ends.
  const body = new THREE.Mesh(pooledBox(ALTAR_BODY_W, ALTAR_BODY_H + SEAM_BLEED * 2, ALTAR_BODY_D), stone);
  body.position.y = ALTAR_BASE_H + ALTAR_STEP_H + ALTAR_BODY_H / 2;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Top slab — slightly wider than the body, gives a "ledge" feel.
  // Extended downward to overlap the body; top stays at the placement
  // height (items sit on top, anchored to ALTAR_TOP_Y).
  const slab = new THREE.Mesh(pooledBox(ALTAR_SLAB_W, ALTAR_SLAB_H + SEAM_BLEED, ALTAR_SLAB_D), stoneFloor);
  slab.position.y = ALTAR_BASE_H + ALTAR_STEP_H + ALTAR_BODY_H + ALTAR_SLAB_H / 2 - SEAM_BLEED / 2;
  slab.castShadow = true; slab.receiveShadow = true;
  group.add(slab);

  // Drape ritual items on top.
  const itemCount = buildRngInt(1, 3);     // 1-3 items
  const placed: Array<{ ox: number; oz: number; r: number }> = [];
  for (let i = 0; i < itemCount; i++) {
    const entry = pickWeighted(ITEM_POOL);
    if (!entry) continue;
    // Try a few positions on the slab surface.
    for (let a = 0; a < 6; a++) {
      const ox = (buildRng() - 0.5) * (ALTAR_SLAB_W - 2 * entry.halfExtent - 0.06);
      const oz = (buildRng() - 0.5) * (ALTAR_SLAB_D - 2 * entry.halfExtent - 0.06);
      let collides = false;
      for (const p of placed) {
        const dx = p.ox - ox;
        const dz = p.oz - oz;
        const minDist = p.r + entry.halfExtent;
        if (dx * dx + dz * dz < minDist * minDist) { collides = true; break; }
      }
      if (collides) continue;
      const built = buildModel(entry.model);
      built.group.position.set(ox, ALTAR_TOP_Y, oz);
      built.group.rotation.y = buildRng() * Math.PI * 2;
      group.add(built.group);
      placed.push({ ox, oz, r: entry.halfExtent });
      break;
    }
  }

  return {
    group,
    obstacle: {
      minX: x - ALTAR_BASE_W / 2, maxX: x + ALTAR_BASE_W / 2,
      minZ: z - ALTAR_BASE_D / 2, maxZ: z + ALTAR_BASE_D / 2,
    },
  };
}

function pickWeighted(pool: AltarItemEntry[]): AltarItemEntry | null {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = buildRng() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1] ?? null;
}
