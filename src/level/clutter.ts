import type { LevelSpec, PropSpec, RoomSpec, TorchSpec, WalkableRect } from './types';
import {
  RUBBLE_CHUNK, ASH_MOUND, STONE_SHARDS,
  FLOOR_CRACK, WALL_SCORCH, WALL_GOUGE,
  CORNER_MOUND, CORNER_MOUND_LARGE, CORNER_MOUND_SMALL,
  WALL_PILE, WALL_BUTTRESS, RUINED_COLUMN,
  FALLEN_PILLAR_SEGMENT, IRON_BARS, LURKER,
} from '../content/clutter';
import { IRON_BRAZIER, CRESSET_PIKE } from '../content/light-props';
import { COBWEB_CORNER } from '../content/cobweb';
import { archway, archwayColumnOffset } from '../content/archway';
import { doorframe } from '../content/doorframe';
import {
  wallOpenings, inOpening, allStairFootprints, findContainingRect,
  type Opening, type StairFootprint,
} from './geometry-cull';

// =====================================================================
// LEVEL DECORATION PIPELINE
// =====================================================================
//
// The composer runs two distinct phases AFTER the base skeleton
// (rooms, corridors, stairs, and tile-authored props) is laid
// down. Each phase has a clear remit:
//
//   PHASE B — applyGeometryWarp
//   ─────────────────────────────
//   Everything that PHYSICALLY EXISTS in the world above the
//   base shell. Frames the playable space.
//     · Archways at corridor mouths — columns block, lintel
//       overhead. The transition moment between chambers.
//     · Buttresses + ruined columns — real obstacles attached
//       to walls / standing free. The player paths around them.
//     · Volumetric mounds — corner mounds + wall piles. Visual
//       mass that breaks rectangular silhouettes (no collision
//       so they don't gate movement, but they shape what the
//       eye reads).
//     · Torch reconciliation — torches mounted on walls that
//       got carved away by a corridor get dropped here, since
//       this is the last moment when the wall set is decided.
//
//   PHASE C — applySurfaceClutter
//   ─────────────────────────────
//   COSMETIC ONLY. Never carries collision, never changes the
//   playable shape. Runs LAST so it cannot conflict with any
//   structural decision above.
//     · Floor debris (small rubble, ash, shards)
//     · Floor cracks
//     · Wall damage — scorches + gouges on clear wall ranges
//     · Sparse corridor surface decor
//
// Both phases consume the same shared RoomContext (rect, wall
// openings, samplers, the running "occupied" list of placed
// points) so collision avoidance and opening-aware placement
// stays consistent across passes.

// Small floor debris pool — pure cosmetic, no collision. Used by
// the surface pass. IRON_BARS joins the pool to add a material
// contrast (dark iron vs stone) to break up the otherwise
// stone-only family.
const FLOOR_DEBRIS = [RUBBLE_CHUNK, ASH_MOUND, STONE_SHARDS, IRON_BARS];
const WALL_DAMAGE = [WALL_SCORCH, WALL_GOUGE];

const CORNER_MOUND_VARIANTS: Array<{ model: typeof CORNER_MOUND; weight: number }> = [
  { model: CORNER_MOUND_SMALL, weight: 5 },
  { model: CORNER_MOUND,       weight: 4 },
  { model: CORNER_MOUND_LARGE, weight: 1 },
  // LURKER — weight 0.4 against a 10-sum pool ≈ 4% per corner slot. A small
  // session of ~15-30 rooms will see one or two; players will notice it
  // PRESENT before they notice what it is. The art-direction goal isn't a
  // jump scare — it's the paranoia of "was that there before?"
  { model: LURKER,             weight: 0.4 },
];

// Clearance kept between a clutter prop and the edge of a pit/void, on top of
// the void's own footprint. Stops a column/brazier body from overhanging the
// hole even when its centre is just outside.
const VOID_MARGIN = 0.4;

interface PlacedPoint {
  x: number;
  z: number;
}

interface RoomContext {
  rect: WalkableRect;
  minX: number; maxX: number; minZ: number; maxZ: number;
  area: number;
  openN: Opening[]; openS: Opening[]; openE: Opening[]; openW: Opening[];
  existing: PlacedPoint[];
  tooClose: (x: number, z: number, minDist: number) => boolean;
  centreSampler: () => { x: number; z: number };
  edgeSampler: () => { x: number; z: number };
}

/**
 * PHASE B — Geometry warp.
 *
 * Frames the playable space:
 *   1. Archways at corridor mouths (with column collision)
 *   2. Structural props per room — buttresses + ruined columns
 *      (collision) and corner mounds + wall piles (visual mass)
 *   3. Reconcile torches against the final wall set: any torch
 *      mounted in a carved corridor opening is dropped here.
 *
 * Mutates spec.props and spec.torches. Must run BEFORE
 * applySurfaceClutter so the surface pass sees the final shape.
 */
export function applyGeometryWarp(spec: LevelSpec, rand: () => number): void {
  // 1. Archway emission. Walks every corridor, finds where it
  //    meets a room, drops a framed gate. De-duped so a shared
  //    edge only emits once.
  emitArchwaysForCorridors(spec);

  // 2. Per-room structural placement.
  const existing = collectExisting(spec);
  const stairs = allStairFootprints(spec);
  const allRectsFlat = [...spec.rooms, ...spec.corridors].map((r) => r.rect);
  // Centrepiece detection — does this room already contain a fountain
  // / altar / chest? If so, the light-prop pass skips it. Per the
  // "lighting as signal" rule in CLAUDE.md: an uncommon light source
  // should mean SOMETHING IS HAPPENING. If the room already has a
  // focal point, dropping a brazier next to it is competing noise.
  const centrepieceKinds = new Set(['fountain', 'altar', 'chest']);
  const centrepiecePoints: PlacedPoint[] = spec.props
    .filter((p) => 'kind' in p && centrepieceKinds.has(p.kind) && 'x' in p && 'z' in p)
    .map((p) => ({ x: p.x as number, z: p.z as number }));
  const out: PropSpec[] = [];
  const voids = spec.voids ?? [];
  for (const room of spec.rooms) {
    const ctx = buildRoomContext(room, allRectsFlat, existing, stairs, rand, voids);
    const hasCentrepiece = centrepiecePoints.some(
      (p) => p.x >= ctx.minX && p.x <= ctx.maxX && p.z >= ctx.minZ && p.z <= ctx.maxZ,
    );
    structuralPass(ctx, out, rand, hasCentrepiece);
  }
  stampDbg(out, 'geometry-warp');
  spec.props.push(...out);

  // 3. Drop torches whose wall mounting falls in a corridor
  //    opening — the wall slab there has been carved away, the
  //    torch would dangle in mid-air.
  spec.torches = spec.torches.filter((t) => !torchInOpening(t, allRectsFlat));
}

/**
 * @deprecated Old name. Kept as an alias for callers that haven't
 * been migrated; new code should call applyGeometryWarp.
 */
export const applyStructuralClutter = applyGeometryWarp;

/** Stage 2 — surface decoration. Floor debris, floor cracks, wall
 *  damage. Runs AFTER fixtures + structural so it doesn't paint
 *  over things or stuff cracks under a column. Mutates spec.props.
 *
 *  Corridors get a sparser version of the same — just enough
 *  debris + cracks to break the long empty hallway feel without
 *  cluttering passage. No wall damage in corridors (the walls
 *  are short + close enough that a decal reads as graffiti). */
export function applySurfaceClutter(spec: LevelSpec, rand: () => number): void {
  const existing = collectExisting(spec);
  const stairs = allStairFootprints(spec);
  const allRectsFlat = [...spec.rooms, ...spec.corridors].map((r) => r.rect);
  const out: PropSpec[] = [];
  const voids = spec.voids ?? [];
  for (const room of spec.rooms) {
    const ctx = buildRoomContext(room, allRectsFlat, existing, stairs, rand, voids);
    surfacePass(ctx, out, rand);
  }
  for (const corridor of spec.corridors) {
    const ctx = buildRoomContext(corridor, allRectsFlat, existing, stairs, rand, voids);
    corridorSurfacePass(ctx, out, rand);
  }
  stampDbg(out, 'surface-clutter');
  spec.props.push(...out);
}

/** Stamp a debug-provenance tag on every model prop in a batch (only if
 *  not already tagged, so a more specific upstream tag wins). Diagnostic
 *  only — read by the debug capture tool. */
function stampDbg(props: PropSpec[], source: string): void {
  for (const p of props) {
    if (p.kind === 'model' && p._dbg === undefined) p._dbg = source;
  }
}

// ── shared context ────────────────────────────────────────────────

function collectExisting(spec: LevelSpec): PlacedPoint[] {
  const out: PlacedPoint[] = spec.props
    .filter((p) => 'x' in p && 'z' in p)
    .map((p) => ({ x: p.x as number, z: p.z as number }));
  // Wall torches count as occupied — buttresses / wall piles / wall
  // damage must avoid sconces (otherwise the column buries the
  // torch).
  for (const t of spec.torches) out.push({ x: t.x, z: t.z });
  return out;
}

function buildRoomContext(
  room: RoomSpec,
  allRectsFlat: WalkableRect[],
  existing: PlacedPoint[],
  stairs: StairFootprint[],
  rand: () => number,
  voids: WalkableRect[] = [],
): RoomContext {
  const rect = room.rect;
  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minZ = rect.z - rect.d / 2;
  const maxZ = rect.z + rect.d / 2;
  const openN = wallOpenings(rect, 'N', allRectsFlat);
  const openS = wallOpenings(rect, 'S', allRectsFlat);
  const openE = wallOpenings(rect, 'E', allRectsFlat);
  const openW = wallOpenings(rect, 'W', allRectsFlat);

  const tooClose = (x: number, z: number, minDist: number) => {
    const md2 = minDist * minDist;
    for (const p of existing) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < md2) return true;
    }
    // Stair exclusion needs to inflate by ~prop half-size, otherwise a
    // wall buttress / mound / wall pile placed with its CENTER just
    // outside the stair AABB ends up with its body clipping into the
    // stair (the prop extends 0.3-0.5m into the room from the wall it
    // hangs on). Symptom: a quadratic open-back box wedged into the
    // stairwell or a wall pile inside the descent. 0.70m of margin
    // covers every current wall prop with safety.
    const STAIR_MARGIN = 0.70;
    for (const s of stairs) {
      if (x >= s.minX - STAIR_MARGIN && x <= s.maxX + STAIR_MARGIN &&
          z >= s.minZ - STAIR_MARGIN && z <= s.maxZ + STAIR_MARGIN) return true;
    }
    // Voids (pits / chasm cutouts) — a prop here floats over the abyss with no
    // floor under it. Reject the cell, inflated by VOID_MARGIN so the prop's
    // body doesn't overhang the hole's edge either. Voids are shaped FIRST (the
    // carve pass + authored vault.voids both land in spec.voids before clutter
    // runs); the placement stage just has to honour them.
    for (const v of voids) {
      const hw = v.w / 2 + VOID_MARGIN;
      const hd = v.d / 2 + VOID_MARGIN;
      if (x >= v.x - hw && x <= v.x + hw && z >= v.z - hd && z <= v.z + hd) return true;
    }
    return false;
  };

  const centreSampler = () => ({
    x: minX + 0.5 + rand() * Math.max(0, rect.w - 1),
    z: minZ + 0.5 + rand() * Math.max(0, rect.d - 1),
  });

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

  return {
    rect, minX, maxX, minZ, maxZ,
    area: rect.w * rect.d,
    openN, openS, openE, openW,
    existing, tooClose,
    centreSampler, edgeSampler,
  };
}

// ── stage 1: structural ───────────────────────────────────────────

function structuralPass(ctx: RoomContext, out: PropSpec[], rand: () => number, hasCentrepiece: boolean = false): void {
  // Corner mounds — volumetric piles of silt slumping out of each
  // corner. One large mound max per chamber so a single corner
  // reads as the "collapsed" focal point.
  const corners: Array<{ x: number; z: number; rotY: number; nearOpening: boolean }> = [
    { x: ctx.minX + 0.45, z: ctx.minZ + 0.45, rotY: 0,
      nearOpening: nearOpeningOnEither(ctx.openN, ctx.openW, ctx.minX + 0.45, ctx.minZ + 0.45) },
    { x: ctx.maxX - 0.45, z: ctx.minZ + 0.45, rotY: -Math.PI / 2,
      nearOpening: nearOpeningOnEither(ctx.openN, ctx.openE, ctx.maxX - 0.45, ctx.minZ + 0.45) },
    { x: ctx.minX + 0.45, z: ctx.maxZ - 0.45, rotY:  Math.PI / 2,
      nearOpening: nearOpeningOnEither(ctx.openS, ctx.openW, ctx.minX + 0.45, ctx.maxZ - 0.45) },
    { x: ctx.maxX - 0.45, z: ctx.maxZ - 0.45, rotY: Math.PI,
      nearOpening: nearOpeningOnEither(ctx.openS, ctx.openE, ctx.maxX - 0.45, ctx.maxZ - 0.45) },
  ];
  let largeUsed = false;
  for (const c of corners) {
    if (c.nearOpening) continue;
    if (rand() > 0.55) continue;
    if (ctx.tooClose(c.x, c.z, 0.7)) continue;
    const variant = pickCornerVariant(rand, largeUsed);
    if (variant === CORNER_MOUND_LARGE) largeUsed = true;
    out.push({ kind: 'model', model: variant, x: c.x, y: 0, z: c.z, rotY: c.rotY });
    ctx.existing.push({ x: c.x, z: c.z });
  }

  // Wall buttresses — floor-to-ceiling structural columns attached
  // to a wall. The biggest single change to room silhouette.
  const buttressCount = ctx.area >= 60 ? 2 : ctx.area >= 30 ? 1 : 0;
  for (let i = 0; i < buttressCount; i++) {
    placeWallAttached(WALL_BUTTRESS, 0.30, 0.7, ctx, out, rand);
  }

  // Ruined column stubs — free-standing chest-high broken column.
  // Carries a circular collision so the player has to path around
  // it — the columns aren't just visual, they ARE obstacles
  // (matches what they read as visually).
  const columnCount = ctx.area >= 80 ? 2 : ctx.area >= 40 ? 1 : 0;
  for (let i = 0; i < columnCount; i++) {
    for (let a = 0; a < 8; a++) {
      const p = ctx.centreSampler();
      if (p.x < ctx.minX + 1.4 || p.x > ctx.maxX - 1.4) continue;
      if (p.z < ctx.minZ + 1.4 || p.z > ctx.maxZ - 1.4) continue;
      if (ctx.tooClose(p.x, p.z, 1.2)) continue;
      out.push({
        kind: 'model',
        model: RUINED_COLUMN,
        x: p.x, y: 0, z: p.z,
        rotY: rand() * Math.PI * 2,
        collision: { kind: 'circle', r: 0.34 },
      });
      ctx.existing.push({ x: p.x, z: p.z });
      break;
    }
  }

  // Light-prop accent — at most ONE per room, always at an edge/corner.
  // Per CLAUDE.md "lighting as signal": uncommon light sources should
  // mean something is HAPPENING THERE, not decorate empty space. Rules:
  //
  //   - Skip rooms that already have a centrepiece (fountain/altar/
  //     chest). Those rooms have their own focal point; another light
  //     reads as noise that competes with the actual interactable.
  //   - Require a bigger room (≥ 50m²) so the accent has space to
  //     register. Smaller rooms feel cluttered immediately.
  //   - Low base rate (~22%). Most qualifying rooms get NO light prop.
  //     Scarcity is what makes the ones we DO place feel intentional.
  //   - Always edge/corner placement — never centreSampler. Mid-room
  //     placement was the "blocking paths" symptom Josh reported.
  //   - Pike-preferred for tighter rooms (narrow silhouette reads
  //     well against a wall); brazier reserved for rooms big enough
  //     that its footprint won't squeeze a doorway.
  if (!hasCentrepiece && ctx.area >= 50 && rand() < 0.22) {
    // Single helper for "near any door / corridor opening on any
    // wall." Each axis check uses the right coord against the right
    // opening list (openings on N/S walls have X-ranges; openings
    // on W/E walls have Z-ranges).
    const nearAnyOpening = (px: number, pz: number) =>
      inOpening(px, ctx.openN) || inOpening(px, ctx.openS) ||
      inOpening(pz, ctx.openW) || inOpening(pz, ctx.openE);

    const wantBrazier = ctx.area >= 70 && rand() < 0.35;
    if (wantBrazier) {
      // Brazier at a CORNER — pulled in from a corner by ~1.2m so the
      // bowl + haze read with stone on two sides framing it.
      const corners = shuffled([
        { x: ctx.minX + 1.2, z: ctx.minZ + 1.2 },
        { x: ctx.maxX - 1.2, z: ctx.minZ + 1.2 },
        { x: ctx.minX + 1.2, z: ctx.maxZ - 1.2 },
        { x: ctx.maxX - 1.2, z: ctx.maxZ - 1.2 },
      ], rand);
      for (const c of corners) {
        if (nearAnyOpening(c.x, c.z)) continue;
        if (ctx.tooClose(c.x, c.z, 1.4)) continue;
        out.push({
          kind: 'model',
          model: IRON_BRAZIER,
          x: c.x, y: 0, z: c.z,
          rotY: rand() * Math.PI * 2,
          collision: { kind: 'circle', r: 0.32 },
        });
        ctx.existing.push({ x: c.x, z: c.z });
        break;
      }
    } else {
      // Cresset pike — flush against a wall along the long edge.
      // Edge sampler picks a perimeter point; reject if it sits near
      // a door / corridor opening on any wall.
      for (let a = 0; a < 8; a++) {
        const p = ctx.edgeSampler();
        if (p.x < ctx.minX + 0.5 || p.x > ctx.maxX - 0.5) continue;
        if (p.z < ctx.minZ + 0.5 || p.z > ctx.maxZ - 0.5) continue;
        if (nearAnyOpening(p.x, p.z)) continue;
        if (ctx.tooClose(p.x, p.z, 1.2)) continue;
        out.push({
          kind: 'model',
          model: CRESSET_PIKE,
          x: p.x, y: 0, z: p.z,
          rotY: rand() * Math.PI * 2,
          collision: { kind: 'circle', r: 0.18 },
        });
        ctx.existing.push({ x: p.x, z: p.z });
        break;
      }
    }
  }

  // Wall piles — slump against a wall, lean into the room.
  const wallPileCount = Math.max(0, Math.round(ctx.area / 25));
  for (let i = 0; i < wallPileCount; i++) {
    placeWallPile(ctx, out, rand);
  }

  // Fallen pillar segments — horizontal stone cylinders ~1.5m
  // long lying on the floor. Pairs with the ruined column stubs
  // (a stub plus the piece that fell off, reading as a story).
  // Rare: medium-large rooms only, low chance per slot. Carries
  // AABB collision so the player paths around it.
  const fallenCount = ctx.area >= 80 ? 2 : ctx.area >= 50 ? 1 : 0;
  for (let i = 0; i < fallenCount; i++) {
    if (rand() > 0.6) continue;            // not every slot fills
    for (let a = 0; a < 8; a++) {
      const p = ctx.centreSampler();
      // Keep at least 1m off all walls so the segment isn't
      // visually clipping a wall buttress.
      if (p.x < ctx.minX + 1.1 || p.x > ctx.maxX - 1.1) continue;
      if (p.z < ctx.minZ + 1.1 || p.z > ctx.maxZ - 1.1) continue;
      if (ctx.tooClose(p.x, p.z, 1.4)) continue;
      // Axis-aligned (cardinal rotation) so the AABB collision
      // stays clean. ~half the time lying north-south, half
      // east-west.
      const rotY = rand() < 0.5 ? 0 : Math.PI / 2;
      out.push({
        kind: 'model',
        model: FALLEN_PILLAR_SEGMENT,
        x: p.x, y: 0, z: p.z,
        rotY,
        // Cylinder lying along local X → halfW=0.78 (length/2)
        // along its long axis, halfD=0.24 (radius + jitter) across.
        // builder.ts swaps halfW/halfD for ±π/2 rotation.
        collision: { kind: 'aabb', halfW: 0.78, halfD: 0.24 },
      });
      ctx.existing.push({ x: p.x, z: p.z });
      break;
    }
  }
}

// ── stage 2: surface ──────────────────────────────────────────────

function surfacePass(ctx: RoomContext, out: PropSpec[], rand: () => number): void {
  // Floor debris — edge-biased, varied. Per-room shuffle of the
  // pool so the same chunk model doesn't dominate a chamber.
  const floorCount = Math.max(1, Math.round(ctx.area / 14));
  const debrisOrder = shuffled(FLOOR_DEBRIS, rand);
  let debrisIdx = 0;
  for (let i = 0; i < floorCount; i++) {
    for (let a = 0; a < 6; a++) {
      const p = rand() < 0.7 ? ctx.edgeSampler() : ctx.centreSampler();
      if (ctx.tooClose(p.x, p.z, 0.7)) continue;
      const model = debrisOrder[debrisIdx % debrisOrder.length];
      debrisIdx++;
      out.push({
        kind: 'model',
        model,
        x: p.x, y: 0, z: p.z,
        rotY: rand() * Math.PI * 2,
      });
      ctx.existing.push(p);
      break;
    }
  }

  // Floor cracks — free placement anywhere.
  const crackCount = Math.max(1, Math.round(ctx.area / 20));
  for (let i = 0; i < crackCount; i++) {
    for (let a = 0; a < 6; a++) {
      const p = ctx.centreSampler();
      if (ctx.tooClose(p.x, p.z, 0.5)) continue;
      out.push({
        kind: 'model',
        model: FLOOR_CRACK,
        x: p.x, y: 0, z: p.z,
        rotY: rand() * Math.PI * 2,
      });
      ctx.existing.push(p);
      break;
    }
  }

  // Cobweb corners — faint webs tucked into the room's corners. Cosmetic
  // (no collision); seeds the abandoned, long-undisturbed mood. Kept SPARSE
  // and VARIED so they don't read as the same web stamped in every corner:
  //   - at most ~1-2 per room (shuffle corners, low per-corner odds),
  //   - height jittered (slung high to slung mid-corner),
  //   - rotY jittered off the corner-facing base, plus a rotZ tilt so the
  //     web plane hangs differently each time,
  //   - size jittered 65-130%.
  const cobwebCorners = shuffled([
    { x: ctx.minX + 0.35, z: ctx.minZ + 0.35, rotY:  Math.PI * 0.25 },
    { x: ctx.maxX - 0.35, z: ctx.minZ + 0.35, rotY:  Math.PI * 0.75 },
    { x: ctx.minX + 0.35, z: ctx.maxZ - 0.35, rotY: -Math.PI * 0.25 },
    { x: ctx.maxX - 0.35, z: ctx.maxZ - 0.35, rotY: -Math.PI * 0.75 },
  ], rand);
  let webs = 0;
  for (const c of cobwebCorners) {
    if (webs >= 2) break;                 // never more than two webs in a room
    if (rand() > 0.28) continue;          // most corners stay bare
    webs++;
    out.push({
      kind: 'model', model: COBWEB_CORNER,
      x: c.x,
      y: 1.7 + rand() * 0.85,             // slung mid-corner to high (1.7-2.55m)
      z: c.z,
      rotY: c.rotY + (rand() - 0.5) * 0.7,
      rotZ: (rand() - 0.5) * 0.6,         // tilt the web plane
      scale: 0.65 + rand() * 0.65,        // 65-130% size
    });
  }

  // Wall damage — scorches and gouges on clear wall sections.
  const wallCount = Math.max(0, Math.round(ctx.area / 30));
  for (let i = 0; i < wallCount; i++) {
    placeWallDamage(ctx, out, rand);
  }
}

// ── corridor surface pass ─────────────────────────────────────────

/** Sparser decoration for corridors. Long corridors get a few
 *  pieces of floor debris + one or two cracks; short ones get
 *  almost nothing. No wall props — corridor walls are too close
 *  for buttresses / piles to read properly. */
function corridorSurfacePass(ctx: RoomContext, out: PropSpec[], rand: () => number): void {
  const length = Math.max(ctx.rect.w, ctx.rect.d);
  // ~1 piece per 3m of length, capped. Corridors are normally
  // 1.8-5m long so this lands at 1-2 pieces typically.
  const floorCount = Math.max(0, Math.floor(length / 3));
  const debrisOrder = shuffled(FLOOR_DEBRIS, rand);
  let idx = 0;
  for (let i = 0; i < floorCount; i++) {
    for (let a = 0; a < 6; a++) {
      const p = ctx.centreSampler();
      // Edge bias — debris settles against the walls of a
      // narrow corridor, not in the middle where the player walks.
      const useEdge = rand() < 0.65;
      let sx = p.x, sz = p.z;
      if (useEdge) {
        // Push perpendicular to the corridor's long axis toward
        // a wall. Corridor running along Z (length d > w) →
        // push along X; running along X → push along Z.
        const runsAlongZ = ctx.rect.d > ctx.rect.w;
        const inset = 0.25 + rand() * 0.25;
        if (runsAlongZ) {
          sx = rand() < 0.5 ? ctx.minX + inset : ctx.maxX - inset;
        } else {
          sz = rand() < 0.5 ? ctx.minZ + inset : ctx.maxZ - inset;
        }
      }
      if (ctx.tooClose(sx, sz, 0.55)) continue;
      const model = debrisOrder[idx % debrisOrder.length];
      idx++;
      out.push({
        kind: 'model',
        model,
        x: sx, y: 0, z: sz,
        rotY: rand() * Math.PI * 2,
      });
      ctx.existing.push({ x: sx, z: sz });
      break;
    }
  }
  // A single floor crack per longer corridor.
  const crackCount = length > 3 ? 1 : 0;
  for (let i = 0; i < crackCount; i++) {
    for (let a = 0; a < 6; a++) {
      const p = ctx.centreSampler();
      if (ctx.tooClose(p.x, p.z, 0.5)) continue;
      out.push({
        kind: 'model',
        model: FLOOR_CRACK,
        x: p.x, y: 0, z: p.z,
        rotY: rand() * Math.PI * 2,
      });
      ctx.existing.push(p);
      break;
    }
  }
}

// ── per-prop placers ──────────────────────────────────────────────

function placeWallPile(ctx: RoomContext, out: PropSpec[], rand: () => number): void {
  for (let a = 0; a < 8; a++) {
    const wall = Math.floor(rand() * 4);
    const along = rand();
    let x = 0, z = 0, rotY = 0;
    let blocked = false;
    switch (wall) {
      case 0: {
        z = ctx.minZ + along * ctx.rect.d;
        if (inOpening(z, ctx.openW)) { blocked = true; break; }
        x = ctx.minX + 0.35; rotY = -Math.PI / 2; break;
      }
      case 1: {
        z = ctx.minZ + along * ctx.rect.d;
        if (inOpening(z, ctx.openE)) { blocked = true; break; }
        x = ctx.maxX - 0.35; rotY = Math.PI / 2; break;
      }
      case 2: {
        x = ctx.minX + along * ctx.rect.w;
        if (inOpening(x, ctx.openN)) { blocked = true; break; }
        z = ctx.minZ + 0.35; rotY = 0; break;
      }
      default: {
        x = ctx.minX + along * ctx.rect.w;
        if (inOpening(x, ctx.openS)) { blocked = true; break; }
        z = ctx.maxZ - 0.35; rotY = Math.PI; break;
      }
    }
    if (blocked) continue;
    if (ctx.tooClose(x, z, 0.9)) continue;
    out.push({ kind: 'model', model: WALL_PILE, x, y: 0, z, rotY });
    ctx.existing.push({ x, z });
    return;
  }
}

function placeWallDamage(ctx: RoomContext, out: PropSpec[], rand: () => number): void {
  for (let a = 0; a < 8; a++) {
    const wall = Math.floor(rand() * 4);
    const along = rand();
    let x = 0, z = 0, rotY = 0;
    let blocked = false;
    switch (wall) {
      case 0: {
        z = ctx.minZ + along * ctx.rect.d;
        if (inOpening(z, ctx.openW)) { blocked = true; break; }
        x = ctx.minX + 0.02; rotY = -Math.PI / 2; break;
      }
      case 1: {
        z = ctx.minZ + along * ctx.rect.d;
        if (inOpening(z, ctx.openE)) { blocked = true; break; }
        x = ctx.maxX - 0.02; rotY = Math.PI / 2; break;
      }
      case 2: {
        x = ctx.minX + along * ctx.rect.w;
        if (inOpening(x, ctx.openN)) { blocked = true; break; }
        z = ctx.minZ + 0.02; rotY = 0; break;
      }
      default: {
        x = ctx.minX + along * ctx.rect.w;
        if (inOpening(x, ctx.openS)) { blocked = true; break; }
        z = ctx.maxZ - 0.02; rotY = Math.PI; break;
      }
    }
    if (blocked) continue;
    if (ctx.tooClose(x, z, 0.8)) continue;
    out.push({
      kind: 'model',
      model: WALL_DAMAGE[Math.floor(rand() * WALL_DAMAGE.length)],
      x, y: 1.1 + rand() * 0.6, z, rotY,
    });
    ctx.existing.push({ x, z });
    return;
  }
}

/** Place a wall-attached prop in a clear segment. Used for the
 *  buttress (full-height structural column). Position lifts off
 *  the wall by `depth/2` so the model's half-thickness sits in
 *  the wall and the rest pokes into the room. Buttress carries
 *  a rectangular collision matching its protruding footprint —
 *  the player paths around the column. */
function placeWallAttached(
  model: typeof WALL_BUTTRESS,
  depth: number,
  alongHalf: number,
  ctx: RoomContext,
  out: PropSpec[],
  rand: () => number,
): void {
  // Slightly more generous slack for buttresses near doorways.
  const nearOpening = (pos: number, openings: Opening[]) => inOpening(pos, openings, 0.6);
  // Collision half-extents in MODEL local space — width along the
  // wall, depth out from the wall. Matches the buttress model's
  // main 0.85m × 0.55m body.
  const collisionHalfW = 0.40;     // along the wall
  const collisionHalfD = 0.28;     // out from the wall
  for (let a = 0; a < 10; a++) {
    const wall = Math.floor(rand() * 4);
    let x = 0, z = 0, rotY = 0;
    let blocked = false;
    switch (wall) {
      case 0: {
        z = ctx.minZ + alongHalf + rand() * Math.max(0, ctx.rect.d - 2 * alongHalf);
        if (nearOpening(z, ctx.openW)) { blocked = true; break; }
        x = ctx.minX + depth / 2 + 0.02; rotY = -Math.PI / 2; break;
      }
      case 1: {
        z = ctx.minZ + alongHalf + rand() * Math.max(0, ctx.rect.d - 2 * alongHalf);
        if (nearOpening(z, ctx.openE)) { blocked = true; break; }
        x = ctx.maxX - depth / 2 - 0.02; rotY = Math.PI / 2; break;
      }
      case 2: {
        x = ctx.minX + alongHalf + rand() * Math.max(0, ctx.rect.w - 2 * alongHalf);
        if (nearOpening(x, ctx.openN)) { blocked = true; break; }
        z = ctx.minZ + depth / 2 + 0.02; rotY = 0; break;
      }
      default: {
        x = ctx.minX + alongHalf + rand() * Math.max(0, ctx.rect.w - 2 * alongHalf);
        if (nearOpening(x, ctx.openS)) { blocked = true; break; }
        z = ctx.maxZ - depth / 2 - 0.02; rotY = Math.PI; break;
      }
    }
    if (blocked) continue;
    if (ctx.tooClose(x, z, 1.2)) continue;
    out.push({
      kind: 'model', model, x, y: 0, z, rotY,
      collision: { kind: 'aabb', halfW: collisionHalfW, halfD: collisionHalfD },
    });
    ctx.existing.push({ x, z });
    return;
  }
}

// ── helpers ───────────────────────────────────────────────────────

function nearOpeningOnEither(
  horizontalWall: Opening[],
  verticalWall: Opening[],
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

// ── archway emission ──────────────────────────────────────────────

/** Frame each corridor mouth with an ARCHWAY. Walks every wall
 *  of every corridor rect, finds where another rect (a room) is
 *  flush against it (= the corridor opening), and drops an
 *  archway sized to the opening width on that overlap. The
 *  lintel runs along the opening's axis; the two columns carry
 *  collision so the player paths between them rather than
 *  through them. The archway also includes a tympanum block
 *  above the lintel filling the wall to the ceiling, otherwise
 *  the player can see through the gap. */
function emitArchwaysForCorridors(spec: LevelSpec): void {
  const allRectsFlat = [
    ...spec.rooms.map((r) => r.rect),
    ...spec.corridors.map((r) => r.rect),
  ];
  // Map room rect → height so each archway uses the right
  // ceiling for its tympanum. Corridors and rooms can have
  // different heights; we read the abutting ROOM's height since
  // the archway sits in that room's wall.
  const heightByRect = new Map<{ x: number; z: number; w: number; d: number }, number>();
  for (const r of spec.rooms) heightByRect.set(r.rect, r.height);
  for (const r of spec.corridors) heightByRect.set(r.rect, r.height);

  // De-dupe — corridor↔room pairs share an edge so we'd
  // otherwise emit the same archway twice (once from each side).
  const seen = new Set<string>();
  for (const corridor of spec.corridors) {
    const c = corridor.rect;
    for (const side of ['N', 'S', 'E', 'W'] as const) {
      const openings = wallOpenings(c, side, allRectsFlat);
      for (const o of openings) {
        const width = o.end - o.start;
        if (width < 0.7) continue;     // skip skinny seams (build noise)
        // Position the archway at the midpoint of the opening,
        // sitting ON the wall plane.
        let ax = 0, az = 0, rotY = 0;
        if (side === 'N' || side === 'S') {
          ax = (o.start + o.end) / 2;
          az = side === 'N' ? c.z - c.d / 2 : c.z + c.d / 2;
          rotY = 0;        // lintel runs along X (model's local +X)
        } else {
          az = (o.start + o.end) / 2;
          ax = side === 'W' ? c.x - c.w / 2 : c.x + c.w / 2;
          rotY = Math.PI / 2;   // lintel runs along Z
        }
        const key = `${ax.toFixed(2)}:${az.toFixed(2)}:${rotY.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Find the abutting room's ceiling height (for tympanum
        // sizing). We pick the larger of the two abutting heights
        // so the tympanum never falls short of the ceiling. Also note
        // whether the room on the far side CONTAINS A STAIR — if so, its
        // mouth must stay column-free (see below).
        let ceiling = corridor.height;
        let stairMouth = false;
        for (const other of [...spec.rooms, ...spec.corridors]) {
          const or = other.rect;
          if (or === c) continue;
          // Quick adjacency check on the relevant axis.
          const adjacent =
            (side === 'N' && Math.abs((or.z + or.d / 2) - (c.z - c.d / 2)) < 0.05) ||
            (side === 'S' && Math.abs((or.z - or.d / 2) - (c.z + c.d / 2)) < 0.05) ||
            (side === 'W' && Math.abs((or.x + or.w / 2) - (c.x - c.w / 2)) < 0.05) ||
            (side === 'E' && Math.abs((or.x - or.w / 2) - (c.x + c.w / 2)) < 0.05);
          if (adjacent) {
            ceiling = Math.max(ceiling, other.height);
            if ((spec.stairs ?? []).some((st) =>
              Math.abs(st.x - or.x) <= or.w / 2 && Math.abs(st.z - or.z) <= or.d / 2)) {
              stairMouth = true;
            }
          }
        }

        // Narrow mouths get the light doorframe — its jambs are slim and it
        // emits NO collision, so it never chokes the gap. Only WIDE mouths get
        // the full archway with column blockers — UNLESS this is the mouth of a
        // STAIR ROOM: the stairwell footprint (2.56×1.95m) already eats most of
        // a small exit room, so a column at the mouth can pinch the only path
        // around it to the stair's interaction spot to <player-width — a
        // soft-lock (you can SEE the stairs but can't reach them). Stair-room
        // mouths therefore always get the collision-free doorframe.
        //
        // GUARANTEE (no archway can soft-lock a passage): the columns sit at
        // ±(width/2 − 0.16) with collision r 0.18, and the player radius is
        // 0.3. The passable centre-band is 2·(colOffset − 0.18 − 0.3). At the
        // 2.0m threshold that's 2·(0.84 − 0.48) = 0.72m — comfortably wider
        // than the player's 0.6m diameter. Below 2.0m the band would shrink
        // toward the knife-edge that soft-locked the chasm mouth, so those
        // openings get the collision-free doorframe instead. (Was 1.6m, which
        // left only a ~0.24m band — passable in theory, a trap in practice.)
        if (width < 2.0 || stairMouth) {
          spec.props.push({
            kind: 'model',
            model: doorframe({ width, ceilingHeight: ceiling }),
            x: ax, y: 0, z: az,
            rotY,
            proximityGlow: true,
            _dbg: 'doorframe',
          });
        } else {
          const colOffset = archwayColumnOffset(width);
          spec.props.push({
            kind: 'model',
            model: archway({ width, ceilingHeight: ceiling }),
            x: ax, y: 0, z: az,
            rotY,
            proximityGlow: true,   // lintel/keystone glow as the player nears
            _dbg: 'archway',
            // Column blockers sit at the column centre offsets so
            // collision matches the visible columns.
            // r 0.18 matches the visible column half-width (0.16) + a hair,
            // rather than the old generous 0.22 — every cm of collision here
            // narrows the walkable gap.
            collision: [
              { kind: 'circle', r: 0.18, ox: -colOffset, oz: 0 },
              { kind: 'circle', r: 0.18, ox:  colOffset, oz: 0 },
            ],
          });
        }
      }
    }
  }
}

// ── torch reconciliation ──────────────────────────────────────────

/** True if a torch sits on a wall range that has been carved
 *  away by an adjoining corridor / room. Uses the same
 *  wallOpenings shape math the builder uses for the actual
 *  carve, so what's flagged here matches what gets rendered. */
function torchInOpening(
  t: TorchSpec,
  rects: WalkableRect[],
): boolean {
  // The torch sits ~0.18m inside its room's wall — find which
  // rect contains it.
  const room = findContainingRect(t.x, t.z, rects, 0.05);
  if (!room) return false;
  const openings = wallOpenings(room, t.wall, rects);
  const pos = (t.wall === 'N' || t.wall === 'S') ? t.x : t.z;
  return inOpening(pos, openings);
}

// ── pick helpers ──────────────────────────────────────────────────

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
