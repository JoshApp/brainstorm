import type { LevelSpec, PropSpec } from './types';
import {
  RUBBLE_CHUNK, BONE_PILE, SAND_DRIFT, BROKEN_PLANKS, ASH_MOUND, STONE_SHARDS,
  FLOOR_CRACK, WALL_SCORCH, WALL_GOUGE,
} from '../content/clutter';

// Clutter scatter pass.
//
// Walks each room rect produced by the vault composer and drops a
// handful of small debris / damage props on the floor + walls so the
// room reads as old, used, broken — not a clean cube of stone.
// Heavily edge/corner biased: real debris piles up at walls, dust
// settles in corners, scorch marks adhere to walls. Random centre
// placement only sprinkles cracks (the floor itself can crack
// anywhere).
//
// Avoids overlap by checking against ALL props ALREADY in the spec
// (the vault's authored props + group expansions). New clutter never
// lands within ~0.6m of an existing prop. Skip radius is generous
// because clutter geometry is bigger than its anchor point suggests.
//
// Stair footprints are also avoided — sigils on a carved-out cell
// float in mid-air.

// Floor pool — what to scatter on a typical floor cell.
const FLOOR_DEBRIS = [RUBBLE_CHUNK, BONE_PILE, BROKEN_PLANKS, ASH_MOUND, STONE_SHARDS];
const WALL_DAMAGE = [WALL_SCORCH, WALL_GOUGE];

interface PlacedPoint {
  x: number;
  z: number;
}

/** Scatter clutter across every room rect in spec. Mutates spec.props. */
export function scatterClutter(spec: LevelSpec, rand: () => number): void {
  // Collect existing prop positions for overlap avoidance.
  const existing: PlacedPoint[] = spec.props
    .filter((p) => 'x' in p && 'z' in p)
    .map((p) => ({ x: p.x as number, z: p.z as number }));

  // Stair footprints — same shape used by the floor-hole carve.
  const stairAabbs = (spec.stairs ?? []).map((s) => ({
    cx: s.x, cz: s.z, half: 1.6,
  }));

  const newProps: PropSpec[] = [];

  for (const r of spec.rooms) {
    decorateRect(r.rect, existing, stairAabbs, newProps, rand);
  }

  spec.props.push(...newProps);
}

function decorateRect(
  rect: { x: number; z: number; w: number; d: number },
  existing: PlacedPoint[],
  stairs: Array<{ cx: number; cz: number; half: number }>,
  out: PropSpec[],
  rand: () => number,
): void {
  const area = rect.w * rect.d;
  // ~1 floor debris per 6m² + a few cracks + 1-2 wall damages.
  // Small rooms get 2-3 things; large halls get 8-10.
  const floorCount = Math.max(2, Math.round(area / 6));
  const crackCount = Math.max(1, Math.round(area / 12));
  const wallCount = Math.max(1, Math.round(area / 18));
  const cornerCount = 2;  // sand drifts in 2 random corners

  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minZ = rect.z - rect.d / 2;
  const maxZ = rect.z + rect.d / 2;

  const tooClose = (x: number, z: number, minDist: number) => {
    for (const p of existing) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    for (const s of stairs) {
      if (x > s.cx - s.half && x < s.cx + s.half && z > s.cz - s.half && z < s.cz + s.half) return true;
    }
    return false;
  };

  const tryPlace = (
    sampler: () => { x: number; z: number },
    place: (x: number, z: number) => PropSpec,
    count: number,
    minDist: number,
    attemptsPerPlacement: number = 6,
  ) => {
    for (let i = 0; i < count; i++) {
      for (let a = 0; a < attemptsPerPlacement; a++) {
        const p = sampler();
        if (tooClose(p.x, p.z, minDist)) continue;
        out.push(place(p.x, p.z));
        existing.push(p);
        break;
      }
    }
  };

  // Edge-biased sampler — picks a point near one of the four walls
  // with some inward jitter (debris tends to settle along walls).
  const edgeSampler = () => {
    const wall = Math.floor(rand() * 4);
    const inset = 0.25 + rand() * 0.55;       // 0.25-0.8m from wall
    const along = rand();
    switch (wall) {
      case 0: return { x: minX + inset, z: minZ + along * rect.d };
      case 1: return { x: maxX - inset, z: minZ + along * rect.d };
      case 2: return { x: minX + along * rect.w, z: minZ + inset };
      default: return { x: minX + along * rect.w, z: maxZ - inset };
    }
  };

  // Centre sampler — anywhere inside the rect with a small margin so
  // it doesn't kiss the walls.
  const centreSampler = () => ({
    x: minX + 0.5 + rand() * Math.max(0, rect.w - 1),
    z: minZ + 0.5 + rand() * Math.max(0, rect.d - 1),
  });

  // Corner sampler — picks one of the four corners with small jitter.
  const cornerSampler = () => {
    const corner = Math.floor(rand() * 4);
    const j = 0.5 + rand() * 0.3;
    const cx = corner < 2 ? minX + j : maxX - j;
    const cz = (corner % 2 === 0) ? minZ + j : maxZ - j;
    return { x: cx, z: cz };
  };

  // ── Place floor debris, mostly edge-biased ─────────────────────
  tryPlace(
    () => (rand() < 0.7 ? edgeSampler() : centreSampler()),
    (x, z) => ({
      kind: 'model',
      model: FLOOR_DEBRIS[Math.floor(rand() * FLOOR_DEBRIS.length)],
      x,
      y: 0,
      z,
      rotY: rand() * Math.PI * 2,
    }),
    floorCount,
    0.55,
  );

  // ── Sand drifts in corners (the dusty-room feel) ────────────────
  tryPlace(
    cornerSampler,
    (x, z) => ({
      kind: 'model',
      model: SAND_DRIFT,
      x,
      y: 0,
      z,
      rotY: rand() * Math.PI * 2,
    }),
    cornerCount,
    0.5,
  );

  // ── Floor cracks, free placement (cracks happen anywhere) ───────
  tryPlace(
    centreSampler,
    (x, z) => ({
      kind: 'model',
      model: FLOOR_CRACK,
      x,
      y: 0,
      z,
      rotY: rand() * Math.PI * 2,
    }),
    crackCount,
    0.4,
  );

  // ── Wall damage — pick a wall, jitter along it, face the room ──
  // The placer offsets the prop INTO the wall plane by ~0.02m so
  // the decal/box sits flush, and sets rotY so the model's local +Z
  // (which faces the camera in its authored space) points back into
  // the room.
  for (let i = 0; i < wallCount; i++) {
    for (let a = 0; a < 6; a++) {
      const wall = Math.floor(rand() * 4);
      const along = 0.5 + rand() * 0.8;
      let x: number, z: number, rotY: number;
      switch (wall) {
        case 0: x = minX + 0.02; z = minZ + along + rand() * Math.max(0, rect.d - 1); rotY = -Math.PI / 2; break;  // W wall
        case 1: x = maxX - 0.02; z = minZ + along + rand() * Math.max(0, rect.d - 1); rotY =  Math.PI / 2; break;  // E wall
        case 2: x = minX + along + rand() * Math.max(0, rect.w - 1); z = minZ + 0.02; rotY = 0;            break;  // N wall
        default: x = minX + along + rand() * Math.max(0, rect.w - 1); z = maxZ - 0.02; rotY = Math.PI;     break;  // S wall
      }
      if (tooClose(x, z, 0.6)) continue;
      out.push({
        kind: 'model',
        model: WALL_DAMAGE[Math.floor(rand() * WALL_DAMAGE.length)],
        x,
        y: 1.1 + rand() * 0.6,
        z,
        rotY,
      });
      existing.push({ x, z });
      break;
    }
  }
}
