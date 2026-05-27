import type { LevelSpec, PropSpec, RoomSpec, StairsSpec } from './types';
import {
  RUBBLE_CHUNK, ASH_MOUND, STONE_SHARDS,
  FLOOR_CRACK, WALL_SCORCH, WALL_GOUGE,
  CORNER_MOUND, CORNER_MOUND_LARGE, CORNER_MOUND_SMALL,
  WALL_PILE, WALL_BUTTRESS, RUINED_COLUMN,
} from '../content/clutter';
import { STAIRWELL_TOTAL_DEPTH, STAIRWELL_HALF_WIDTH } from '../interactables/stairs';

// Clutter scatter pass.
//
// Walks each room rect produced by the vault composer and drops a
// modest amount of small debris / damage props on the floor + walls
// so the room reads as old, used, broken — not a clean cube of
// stone. Heavily edge / corner biased: real debris piles up at
// walls, dust settles in corners, scorch marks adhere to walls.
//
// Volumetric corner mounds and wall piles do the actual visual
// "deformation" — they break the rectangular silhouette by piling
// against walls + corners and slumping into the room.
//
// Wall placements skip CORRIDOR OPENINGS — any segment of a room
// wall that has a corridor (or another room) flush against it is
// not really a wall, so decals there would float in mid-air after
// the carve. We mirror the builder's findOpenings logic to detect
// those gaps.
//
// Overlap avoidance: every new prop checks a generous radius
// against existing props + stair footprints.

// Floor debris pool — kept to chunky stone-family props. The
// earlier bone-piles and broken-planks read as noisy "branches"
// from a distance; pulled them out so the eye latches on the
// bigger silhouettes (wall piles, corner mounds, buttresses)
// instead of getting busy at floor level.
const FLOOR_DEBRIS = [RUBBLE_CHUNK, ASH_MOUND, STONE_SHARDS];
const WALL_DAMAGE = [WALL_SCORCH, WALL_GOUGE];

// Corner mound variants — picked weighted per corner so the big
// version is rare but the small/medium read as the default. Big
// mounds dominate one corner of a chamber; small ones fill the
// other corners more subtly.
const CORNER_MOUND_VARIANTS: Array<{ model: typeof CORNER_MOUND; weight: number }> = [
  { model: CORNER_MOUND_SMALL, weight: 5 },
  { model: CORNER_MOUND,       weight: 4 },
  { model: CORNER_MOUND_LARGE, weight: 1 },
];

interface PlacedPoint {
  x: number;
  z: number;
}

interface Opening {
  start: number;
  end: number;
}

/** Scatter clutter across every room rect in spec. Mutates spec.props. */
export function scatterClutter(spec: LevelSpec, rand: () => number): void {
  const existing: PlacedPoint[] = spec.props
    .filter((p) => 'x' in p && 'z' in p)
    .map((p) => ({ x: p.x as number, z: p.z as number }));

  // Directional stair footprints — cover the FULL stair body
  // (extends STAIRWELL_TOTAL_DEPTH in the descent direction from
  // the stair position) PLUS a generous approach zone in front of
  // the mouth so a buttress can't spawn where the player walks up
  // to descend. The previous symmetric 1.6m radius let clutter
  // land in the back of long stair bodies.
  const stairAabbs = (spec.stairs ?? []).map(stairFootprint);

  // Build the same allRects list buildRoomShell uses, so opening
  // detection here matches what's actually carved at render time.
  const allRects: RoomSpec[] = [...spec.rooms, ...spec.corridors];

  const newProps: PropSpec[] = [];
  for (const r of spec.rooms) {
    decorateRect(r, allRects, existing, stairAabbs, newProps, rand);
  }
  spec.props.push(...newProps);
}

/** AABB covering the stairwell body + approach corridor, axis-
 *  aligned (stairs only auto-rotate to cardinal angles so the
 *  rotated body's AABB is itself axis-aligned). */
function stairFootprint(s: StairsSpec): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const rotY = s.rotY ?? 0;
  const dirX = Math.sin(rotY);
  const dirZ = Math.cos(rotY);
  const APPROACH = 1.6;                            // clear floor in front of the mouth
  const SIDE = STAIRWELL_HALF_WIDTH + 0.55;        // side parapets + margin
  // World position of the deepest point of the stair body.
  const bx = s.x + dirX * STAIRWELL_TOTAL_DEPTH;
  const bz = s.z + dirZ * STAIRWELL_TOTAL_DEPTH;
  // World position of the approach point (in front of the mouth).
  const fx = s.x - dirX * APPROACH;
  const fz = s.z - dirZ * APPROACH;
  // Perpendicular side extent: when the descent runs along Z,
  // the sides are along X (and vice versa). For axial rotY this
  // collapses cleanly because one of dirX/dirZ is 0.
  const sideDx = Math.abs(dirZ) * SIDE;
  const sideDz = Math.abs(dirX) * SIDE;
  return {
    minX: Math.min(bx, fx) - sideDx,
    maxX: Math.max(bx, fx) + sideDx,
    minZ: Math.min(bz, fz) - sideDz,
    maxZ: Math.max(bz, fz) + sideDz,
  };
}

function decorateRect(
  room: RoomSpec,
  allRects: RoomSpec[],
  existing: PlacedPoint[],
  stairs: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>,
  out: PropSpec[],
  rand: () => number,
): void {
  const rect = room.rect;
  const area = rect.w * rect.d;

  // Sparser than the first pass — the user's feedback was that the
  // debris repeated too obviously. 1 piece per ~14m² floor, 1 wall
  // damage per ~30m², 1 crack per ~20m². Small rooms get 1-2
  // pieces; large halls get 6-8.
  const floorCount = Math.max(1, Math.round(area / 14));
  const crackCount = Math.max(1, Math.round(area / 20));
  const wallCount = Math.max(0, Math.round(area / 30));
  const wallPileCount = Math.max(0, Math.round(area / 25));

  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minZ = rect.z - rect.d / 2;
  const maxZ = rect.z + rect.d / 2;

  // Corridor / room openings per wall. Each wall is a 1D range
  // along its running axis; openings are sub-ranges that have an
  // adjoining rect on the other side, so the wall is actually
  // carved away there. Decals placed in those ranges would float.
  const openN = collectOpenings('N', rect, allRects);
  const openS = collectOpenings('S', rect, allRects);
  const openE = collectOpenings('E', rect, allRects);
  const openW = collectOpenings('W', rect, allRects);

  const tooClose = (x: number, z: number, minDist: number) => {
    const md2 = minDist * minDist;
    for (const p of existing) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < md2) return true;
    }
    for (const s of stairs) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return true;
    }
    return false;
  };

  const inOpening = (pos: number, openings: Opening[]): boolean => {
    for (const o of openings) {
      if (pos >= o.start - 0.4 && pos <= o.end + 0.4) return true;
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

  const centreSampler = () => ({
    x: minX + 0.5 + rand() * Math.max(0, rect.w - 1),
    z: minZ + 0.5 + rand() * Math.max(0, rect.d - 1),
  });

  // Edge sampler avoids opening ranges — debris-piled-against-a-
  // wall shouldn't sit where the corridor mouth is.
  const edgeSampler = (): { x: number; z: number } => {
    const wall = Math.floor(rand() * 4);
    const inset = 0.25 + rand() * 0.55;
    const along = rand();
    switch (wall) {
      case 0: {
        const z = minZ + along * rect.d;
        if (inOpening(z, openW)) return centreSampler();
        return { x: minX + inset, z };
      }
      case 1: {
        const z = minZ + along * rect.d;
        if (inOpening(z, openE)) return centreSampler();
        return { x: maxX - inset, z };
      }
      case 2: {
        const x = minX + along * rect.w;
        if (inOpening(x, openN)) return centreSampler();
        return { x, z: minZ + inset };
      }
      default: {
        const x = minX + along * rect.w;
        if (inOpening(x, openS)) return centreSampler();
        return { x, z: maxZ - inset };
      }
    }
  };

  // Shuffle the debris pool per-room so the same model doesn't
  // dominate a single chamber. The next room gets a fresh shuffle.
  const debrisOrder = shuffled(FLOOR_DEBRIS, rand);
  let debrisIdx = 0;
  const pickDebris = () => {
    const m = debrisOrder[debrisIdx % debrisOrder.length];
    debrisIdx++;
    return m;
  };

  // Floor debris, mostly edge-biased.
  tryPlace(
    () => (rand() < 0.7 ? edgeSampler() : centreSampler()),
    (x, z) => ({
      kind: 'model',
      model: pickDebris(),
      x,
      y: 0,
      z,
      rotY: rand() * Math.PI * 2,
    }),
    floorCount,
    0.7,
  );

  // Corner mounds — volumetric piles of silt slumping out of each
  // corner. Authored with HIGH end at local (-,-); rotate per
  // corner so the high end faces into the corner. Skip a corner
  // that's near an opening so we don't block the doorway.
  const corners: Array<{ x: number; z: number; rotY: number; nearOpening: boolean }> = [
    { x: minX + 0.45, z: minZ + 0.45, rotY: 0,
      nearOpening: nearOpeningOnEither(openN, openW, minX + 0.45, minZ + 0.45) },
    { x: maxX - 0.45, z: minZ + 0.45, rotY: -Math.PI / 2,
      nearOpening: nearOpeningOnEither(openN, openE, maxX - 0.45, minZ + 0.45) },
    { x: minX + 0.45, z: maxZ - 0.45, rotY:  Math.PI / 2,
      nearOpening: nearOpeningOnEither(openS, openW, minX + 0.45, maxZ - 0.45) },
    { x: maxX - 0.45, z: maxZ - 0.45, rotY: Math.PI,
      nearOpening: nearOpeningOnEither(openS, openE, maxX - 0.45, maxZ - 0.45) },
  ];
  // Up to ONE large mound per chamber — the others stay small/
  // medium so a single corner reads as the "collapsed" focal point.
  let largeUsed = false;
  for (const c of corners) {
    if (c.nearOpening) continue;
    if (rand() > 0.55) continue;
    if (tooClose(c.x, c.z, 0.7)) continue;
    const variant = pickCornerVariant(rand, largeUsed);
    if (variant === CORNER_MOUND_LARGE) largeUsed = true;
    out.push({ kind: 'model', model: variant, x: c.x, y: 0, z: c.z, rotY: c.rotY });
    existing.push({ x: c.x, z: c.z });
  }

  // ── Wall buttresses ─────────────────────────────────────────────
  // Structural columns attached to a wall, floor-to-ceiling. These
  // are the biggest single change to room silhouette — they cast
  // shadows across the floor from torches, so the wall stops
  // reading as one flat plane. Big rooms get 1-2, small ones get
  // none (a buttress in a tiny room eats too much floor space).
  const buttressCount = area >= 60 ? 2 : area >= 30 ? 1 : 0;
  for (let i = 0; i < buttressCount; i++) {
    placeWallAttached(
      WALL_BUTTRESS, /*depth*/ 0.30, /*alongHalf*/ 0.7,
      rect, openN, openS, openE, openW, tooClose, out, existing, rand,
    );
  }

  // ── Ruined column stubs ────────────────────────────────────────
  // Free-standing chest-high broken column. Placed in open floor
  // (not against a wall) — reads as a colonnade that mostly fell.
  // Adds vertical break + a navigation obstacle the player has to
  // path around. Rare in small rooms.
  const columnCount = area >= 80 ? 2 : area >= 40 ? 1 : 0;
  for (let i = 0; i < columnCount; i++) {
    for (let a = 0; a < 8; a++) {
      const p = centreSampler();
      // Keep clear of walls — columns mid-room read better.
      if (p.x < minX + 1.4 || p.x > maxX - 1.4) continue;
      if (p.z < minZ + 1.4 || p.z > maxZ - 1.4) continue;
      if (tooClose(p.x, p.z, 1.2)) continue;
      out.push({
        kind: 'model',
        model: RUINED_COLUMN,
        x: p.x, y: 0, z: p.z,
        rotY: rand() * Math.PI * 2,
      });
      existing.push({ x: p.x, z: p.z });
      break;
    }
  }

  // Wall piles — slump against a wall, lean into the room. Skip
  // wall positions that fall inside a corridor opening.
  for (let i = 0; i < wallPileCount; i++) {
    for (let a = 0; a < 8; a++) {
      const wall = Math.floor(rand() * 4);
      const along = rand();
      let x = 0, z = 0, rotY = 0;
      let blocked = false;
      switch (wall) {
        case 0: { // W
          z = minZ + along * rect.d;
          if (inOpening(z, openW)) { blocked = true; break; }
          x = minX + 0.35;
          rotY = -Math.PI / 2;
          break;
        }
        case 1: { // E
          z = minZ + along * rect.d;
          if (inOpening(z, openE)) { blocked = true; break; }
          x = maxX - 0.35;
          rotY = Math.PI / 2;
          break;
        }
        case 2: { // N
          x = minX + along * rect.w;
          if (inOpening(x, openN)) { blocked = true; break; }
          z = minZ + 0.35;
          rotY = 0;
          break;
        }
        default: { // S
          x = minX + along * rect.w;
          if (inOpening(x, openS)) { blocked = true; break; }
          z = maxZ - 0.35;
          rotY = Math.PI;
          break;
        }
      }
      if (blocked) continue;
      if (tooClose(x, z, 0.9)) continue;
      out.push({ kind: 'model', model: WALL_PILE, x, y: 0, z, rotY });
      existing.push({ x, z });
      break;
    }
  }

  // Floor cracks, free placement (cracks happen anywhere).
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
    0.5,
  );

  // Wall damage — pick a wall, jitter along it, skip openings.
  for (let i = 0; i < wallCount; i++) {
    for (let a = 0; a < 8; a++) {
      const wall = Math.floor(rand() * 4);
      const along = rand();
      let x = 0, z = 0, rotY = 0;
      let blocked = false;
      switch (wall) {
        case 0: { // W
          z = minZ + along * rect.d;
          if (inOpening(z, openW)) { blocked = true; break; }
          x = minX + 0.02;
          rotY = -Math.PI / 2;
          break;
        }
        case 1: { // E
          z = minZ + along * rect.d;
          if (inOpening(z, openE)) { blocked = true; break; }
          x = maxX - 0.02;
          rotY = Math.PI / 2;
          break;
        }
        case 2: { // N
          x = minX + along * rect.w;
          if (inOpening(x, openN)) { blocked = true; break; }
          z = minZ + 0.02;
          rotY = 0;
          break;
        }
        default: { // S
          x = minX + along * rect.w;
          if (inOpening(x, openS)) { blocked = true; break; }
          z = maxZ - 0.02;
          rotY = Math.PI;
          break;
        }
      }
      if (blocked) continue;
      if (tooClose(x, z, 0.8)) continue;
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

// ── helpers ──────────────────────────────────────────────────────

/** Mirror of builder.findOpenings — locates the ranges on each
 *  wall of `self` where another rect is flush, indicating a
 *  corridor / room carve. */
function collectOpenings(
  side: 'N' | 'S' | 'E' | 'W',
  self: { x: number; z: number; w: number; d: number },
  allRects: RoomSpec[],
): Opening[] {
  const EPS = 0.05;
  const out: Opening[] = [];
  for (const other of allRects) {
    const o = other.rect;
    // Same-rect identity — same centre + same size means it's us.
    if (Math.abs(o.x - self.x) < 1e-6 && Math.abs(o.z - self.z) < 1e-6
        && o.w === self.w && o.d === self.d) continue;

    if (side === 'N' || side === 'S') {
      const wallZ = side === 'N' ? self.z - self.d / 2 : self.z + self.d / 2;
      const oNorth = o.z - o.d / 2;
      const oSouth = o.z + o.d / 2;
      const coincides = Math.abs(oSouth - wallZ) < EPS || Math.abs(oNorth - wallZ) < EPS;
      if (!coincides) continue;
      const a = Math.max(self.x - self.w / 2, o.x - o.w / 2);
      const b = Math.min(self.x + self.w / 2, o.x + o.w / 2);
      if (b > a + EPS) out.push({ start: a, end: b });
    } else {
      const wallX = side === 'W' ? self.x - self.w / 2 : self.x + self.w / 2;
      const oWest = o.x - o.w / 2;
      const oEast = o.x + o.w / 2;
      const coincides = Math.abs(oEast - wallX) < EPS || Math.abs(oWest - wallX) < EPS;
      if (!coincides) continue;
      const a = Math.max(self.z - self.d / 2, o.z - o.d / 2);
      const b = Math.min(self.z + self.d / 2, o.z + o.d / 2);
      if (b > a + EPS) out.push({ start: a, end: b });
    }
  }
  return out;
}

/** True if either of the two adjoining walls of a corner has an
 *  opening within ~1.2m — placing a mound there would visually
 *  crowd the doorway. */
function nearOpeningOnEither(
  horizontalWall: Opening[],   // N or S wall openings (positions in X)
  verticalWall: Opening[],     // W or E wall openings (positions in Z)
  cx: number,
  cz: number,
): boolean {
  const probe = (openings: Opening[], v: number) => {
    for (const o of openings) {
      if (v >= o.start - 1.2 && v <= o.end + 1.2) return true;
    }
    return false;
  };
  return probe(horizontalWall, cx) || probe(verticalWall, cz);
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Weighted-pick a corner mound variant. If a large mound has
 *  already been placed in this chamber, drop it from the pool —
 *  one big collapse focal point per room reads better than four. */
function pickCornerVariant(
  rand: () => number,
  largeUsed: boolean,
): typeof CORNER_MOUND {
  const pool = largeUsed
    ? CORNER_MOUND_VARIANTS.filter((v) => v.model !== CORNER_MOUND_LARGE)
    : CORNER_MOUND_VARIANTS;
  const total = pool.reduce((s, v) => s + v.weight, 0);
  let r = rand() * total;
  for (const v of pool) {
    r -= v.weight;
    if (r <= 0) return v.model;
  }
  return pool[pool.length - 1].model;
}

/** Place a wall-attached prop on a random wall, biasing to mid-
 *  segments (away from openings + corners). The prop is positioned
 *  with its "wall" side against the chosen wall surface; rotY
 *  rotates the model so its authored -Z (wall-facing side) points
 *  back into the wall, with the model body protruding into the
 *  room by `depth` metres.
 *
 *  Used for the buttress (full-height structural column). The
 *  position lifts off the wall by `depth/2` so the model's half-
 *  thickness sits in the wall and the rest pokes into the room. */
function placeWallAttached(
  model: typeof WALL_BUTTRESS,
  depth: number,
  alongHalf: number,
  rect: { x: number; z: number; w: number; d: number },
  openN: Opening[],
  openS: Opening[],
  openE: Opening[],
  openW: Opening[],
  tooClose: (x: number, z: number, d: number) => boolean,
  out: PropSpec[],
  existing: PlacedPoint[],
  rand: () => number,
): void {
  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minZ = rect.z - rect.d / 2;
  const maxZ = rect.z + rect.d / 2;
  for (let a = 0; a < 10; a++) {
    const wall = Math.floor(rand() * 4);
    // Sample inside the wall span, leaving alongHalf metres of
    // clearance from each corner.
    let x = 0, z = 0, rotY = 0;
    let blocked = false;
    switch (wall) {
      case 0: { // W
        z = minZ + alongHalf + rand() * Math.max(0, rect.d - 2 * alongHalf);
        if (inOpeningRange(z, openW)) { blocked = true; break; }
        x = minX + depth / 2 + 0.02;
        rotY = -Math.PI / 2;
        break;
      }
      case 1: { // E
        z = minZ + alongHalf + rand() * Math.max(0, rect.d - 2 * alongHalf);
        if (inOpeningRange(z, openE)) { blocked = true; break; }
        x = maxX - depth / 2 - 0.02;
        rotY = Math.PI / 2;
        break;
      }
      case 2: { // N
        x = minX + alongHalf + rand() * Math.max(0, rect.w - 2 * alongHalf);
        if (inOpeningRange(x, openN)) { blocked = true; break; }
        z = minZ + depth / 2 + 0.02;
        rotY = 0;
        break;
      }
      default: { // S
        x = minX + alongHalf + rand() * Math.max(0, rect.w - 2 * alongHalf);
        if (inOpeningRange(x, openS)) { blocked = true; break; }
        z = maxZ - depth / 2 - 0.02;
        rotY = Math.PI;
        break;
      }
    }
    if (blocked) continue;
    if (tooClose(x, z, 1.2)) continue;
    out.push({ kind: 'model', model, x, y: 0, z, rotY });
    existing.push({ x, z });
    return;
  }
}

function inOpeningRange(pos: number, openings: Opening[]): boolean {
  for (const o of openings) {
    if (pos >= o.start - 0.6 && pos <= o.end + 0.6) return true;
  }
  return false;
}
