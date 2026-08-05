// A FLOOR MADE OF POLYGONS — can you actually walk it?
//
// The first version of this generator produced a floor that LOOKED right in
// every plan view and was a soft-lock in every seed: `delve reach` flooded the
// entrance room and reported every other room "never entered", on 3 of 3
// sampled depths. Two separate bugs, both invisible to the eye:
//
//   1. The corridor sealed its own ends. `findOpenings` punched a doorway only
//      where another rect's EDGE coincided with the wall line, because that is
//      the only way the vault composer's grid ever connects anything. A
//      polygon's real wall sits BACK from its bounding box, so a corridor that
//      meets the wall necessarily ends INSIDE the rect — and got a solid cap.
//   2. The player spawned inside a pot. `roomCenter` is the point furthest
//      from any wall, which is where the spawn goes AND where the centrepiece
//      wants to go. The flood reported ONE reachable cell.
//
// Neither is a rendering bug, so no screenshot would have caught either. This
// floods the floor using the REAL wall planners — `planWallRing` for the poly
// shells and `findOpenings`/`subtractRanges` for the corridors, the same
// functions builder.ts calls — against the REAL `WalkableRegion`. A check that
// re-implemented the wall math would only be measuring its own copy of it.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { WALL_T } from '../src/level/poly-room-shell';
import { planWallRing } from '../src/level/poly-shell-plan';
import { findOpenings, subtractRanges } from '../src/level/wall-openings';
import { WalkableRegion, type WallSegment } from '../src/level/walkable';
import { pointInPoly, polyArea } from '../src/level/room-shape';
import { roomType } from '../src/level/room-types';
import type { LevelSpec, RoomSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337];
const DEPTHS = [2, 3, 5, 8, 11];

function floors(): LevelSpec[] {
  const out: LevelSpec[] = [];
  for (const seed of SEEDS) for (const depth of DEPTHS) out.push(generatePolyFloor(depth, seed));
  return out;
}

/**
 * The floor's collision model, built the way buildLevel builds it.
 *
 * Poly rooms get their ring planned with the corridor rects as openings; rects
 * (the corridors) get the four-edge / subtract-ranges treatment. Both call the
 * shipping functions.
 */
function walkableFor(spec: LevelSpec): WalkableRegion {
  const allRects: RoomSpec[] = [...spec.rooms, ...spec.corridors];
  const openings = spec.corridors.map((c) => c.rect);
  const segs: WallSegment[] = [];

  for (const r of spec.rooms) {
    if (!r.poly || r.poly.length < 3) continue;
    for (const s of planWallRing(r.poly, WALL_T, openings)) {
      segs.push({ ax: s.a[0], az: s.a[1], bx: s.b[0], bz: s.b[1] });
    }
  }
  for (const c of spec.corridors) {
    const { x, z, w, d } = c.rect;
    const edges = [
      { perpAxis: 'z' as const, perpCoord: z - d / 2, wallStart: x - w / 2, wallEnd: x + w / 2 },
      { perpAxis: 'z' as const, perpCoord: z + d / 2, wallStart: x - w / 2, wallEnd: x + w / 2 },
      { perpAxis: 'x' as const, perpCoord: x - w / 2, wallStart: z - d / 2, wallEnd: z + d / 2 },
      { perpAxis: 'x' as const, perpCoord: x + w / 2, wallStart: z - d / 2, wallEnd: z + d / 2 },
    ];
    for (const we of edges) {
      for (const seg of subtractRanges(we.wallStart, we.wallEnd, findOpenings(we, allRects, c))) {
        if (seg.end - seg.start < 0.01) continue;
        segs.push(we.perpAxis === 'z'
          ? { ax: seg.start, az: we.perpCoord, bx: seg.end, bz: we.perpCoord }
          : { ax: we.perpCoord, az: seg.start, bx: we.perpCoord, bz: seg.end });
      }
    }
  }
  return new WalkableRegion(allRects.map((r) => r.rect), [], segs);
}

/** Cells the player can stand on, flooded from the spawn. */
function flood(spec: LevelSpec): Set<string> {
  const W = walkableFor(spec);
  const CELL = 0.25, R = 0.3;
  const rects = [...spec.rooms, ...spec.corridors].map((r) => r.rect);
  const mnX = Math.min(...rects.map((r) => r.x - r.w / 2)), mxX = Math.max(...rects.map((r) => r.x + r.w / 2));
  const mnZ = Math.min(...rects.map((r) => r.z - r.d / 2)), mxZ = Math.max(...rects.map((r) => r.z + r.d / 2));
  const key = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
  const sp = spec.startPos!;
  const seen = new Set([key(sp.x, sp.z)]);
  const q: Array<[number, number]> = [[sp.x, sp.z]];
  while (q.length) {
    const [x, z] = q.pop()!;
    for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < mnX || nx > mxX || nz < mnZ || nz > mxZ) continue;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      if (W.contains(nx, nz, R, { ignoreOpenable: true })) { seen.add(k); q.push([nx, nz]); }
    }
  }
  return seen;
}

const CELL = 0.25;
const reached = (seen: Set<string>, x: number, z: number, slack = 1.0): boolean => {
  const n = Math.ceil(slack / CELL);
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (seen.has(`${cx + i},${cz + j}`)) return true;
  return false;
};

test('EVERY ROOM IS REACHABLE FROM THE SPAWN', () => {
  // The whole bug, stated directly. Both failures above show up here and
  // nowhere else in the suite.
  for (const spec of floors()) {
    const seen = flood(spec);
    for (const r of spec.rooms) {
      const c = r.rect;
      assert.ok(reached(seen, c.x, c.z, 3.0),
        `${spec.id}: room ${r.id} at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) cannot be walked to`);
    }
  }
});

test('the spawn is not standing inside something', () => {
  // The flood counts its seed cell unconditionally, so "spawn is blocked" reads
  // as a reachable floor of size 1 rather than as an error. Assert on the
  // NEIGHBOURS, which is the thing that was actually false.
  for (const spec of floors()) {
    const W = walkableFor(spec);
    const sp = spec.startPos!;
    let open = 0;
    for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const) {
      if (W.contains(sp.x + dx, sp.z + dz, 0.3, { ignoreOpenable: true })) open++;
    }
    assert.ok(open >= 3, `${spec.id}: the delver spawns boxed in — only ${open} of 4 steps are walkable`);
  }
});

test('THE STAIR CAN BE TAKEN', () => {
  for (const spec of floors()) {
    assert.ok((spec.stairs ?? []).length > 0, `${spec.id}: no way down`);
    const seen = flood(spec);
    for (const st of spec.stairs!) {
      assert.ok(reached(seen, st.x, st.z, 1.6),
        `${spec.id}: stair '${st.id}' at (${st.x.toFixed(1)}, ${st.z.toFixed(1)}) is unreachable`);
    }
  }
});

test('a corridor meets the polygon, not the bounding box', () => {
  // The generator's own precondition: a corridor whose end lands in the setback
  // between the polygon and its rect cuts no wall and opens nothing. This is
  // what made the doorways silently absent — the corridor was "connected" to a
  // room it never touched.
  for (const spec of floors()) {
    for (const c of spec.corridors) {
      const r = c.rect;
      const ends: Array<[number, number]> = r.w > r.d
        ? [[r.x - r.w / 2, r.z], [r.x + r.w / 2, r.z]]
        : [[r.x, r.z - r.d / 2], [r.x, r.z + r.d / 2]];
      for (const [x, z] of ends) {
        const inside = spec.rooms.some((rm) => rm.poly && pointInPoly(rm.poly, x, z));
        assert.ok(inside,
          `${spec.id}: corridor ${c.id} ends at (${x.toFixed(1)}, ${z.toFixed(1)}) — outside every room`);
      }
    }
  }
});

test('nothing is placed outside the room that owns it', () => {
  // Every placer queries the polygon, so a prop in stone means a placer is
  // reasoning about the rect behind the shape's back.
  for (const spec of floors()) {
    const inAny = (x: number, z: number) =>
      spec.rooms.some((r) => r.poly && pointInPoly(r.poly, x, z))
      || spec.corridors.some((c) => Math.abs(x - c.rect.x) <= c.rect.w / 2 + 0.01
                                 && Math.abs(z - c.rect.z) <= c.rect.d / 2 + 0.01);
    for (const p of spec.props ?? []) {
      const x = (p as { x?: number }).x, z = (p as { z?: number }).z;
      if (typeof x !== 'number' || typeof z !== 'number') continue;
      assert.ok(inAny(x, z), `${spec.id}: a ${(p as { kind: string }).kind} sits in the masonry`);
    }
    for (const s of spec.spawns ?? []) {
      assert.ok(inAny(s.x, s.z), `${spec.id}: ${s.enemyId} spawns inside a wall`);
    }
  }
});

test('DARKNESS IS THE BASELINE — nobody gets a floodlit room', () => {
  // Taking every mount a wall offered gave one light per 11m², against the
  // builder's own fill budget of one per 45m². Both ends matter: a room with NO
  // light is unplayable, and a room with eight is a different game.
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      const lit = (spec.torches ?? []).filter((t) => pointInPoly(r.poly!, t.x, t.z)).length;
      const area = polyArea(r.poly);
      assert.ok(lit > 0, `${spec.id}: room ${r.id} has no light at all`);
      assert.ok(area / lit > 14,
        `${spec.id}: room ${r.id} has ${lit} sconces over ${area.toFixed(0)}m² — one per ${(area / lit).toFixed(0)}m²`);
    }
  }
});

test('EVERY FLOOR PAYS WHAT IT PLANNED', () => {
  // floor-plan.ts's whole argument: a floor's content must not be a consequence
  // of the shape a seed happened to grow. The old failure mode was silent — a
  // seed that grew no dead-end spur simply went without a trove and nobody
  // decided that. So assert the OFFER slot, which is the one thing the contract
  // says is never optional.
  for (const spec of floors()) {
    const offer = spec.rooms.some((r) => {
      const c = roomType(r.roomType ?? '').centrepiece;
      return c === 'offerings' || c === 'merchant' || c === 'bargain';
    });
    assert.ok(offer, `${spec.id}: the floor owes an offer and staged none`);
  }
});

test('a staged room actually got its centrepiece', () => {
  // planCentrepiece returns EMPTY when the geometry can't carry the piece, and
  // degrading to an ordinary room is the CORRECT behaviour — but if the shapes
  // this generator picks can never carry a trove, every floor degrades and the
  // contract is satisfied on paper only.
  const staged: Record<string, { rooms: number; empty: number }> = {};
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      const piece = roomType(r.roomType ?? '').centrepiece;
      if (piece === 'none' || piece === 'descent' || piece === 'bargain') continue;
      const props = (spec.props ?? []).filter((p) => {
        const x = (p as { x?: number }).x, z = (p as { z?: number }).z;
        return typeof x === 'number' && typeof z === 'number' && pointInPoly(r.poly!, x, z);
      });
      staged[piece] ??= { rooms: 0, empty: 0 };
      staged[piece].rooms++;
      if (props.length === 0) staged[piece].empty++;
    }
  }
  for (const [piece, s] of Object.entries(staged)) {
    assert.equal(s.empty, 0,
      `${piece}: ${s.empty} of ${s.rooms} rooms staged nothing — the shapes can't carry the piece`);
  }
});

test('a CLEAN room is a stage, and a vendor never has company', () => {
  // Both flags exist because separate passes each used to answer a different
  // question: a trove refused loot and still got pillars in front of its
  // offerings. Here one occupancy answers for all of them, so this is the
  // regression guard on that.
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      const def = roomType(r.roomType ?? '');
      const inRoom = (x: number, z: number) => pointInPoly(r.poly!, x, z);
      if (def.clean) {
        const clutter = (spec.props ?? []).filter((p) => (p as { kind: string }).kind === 'vase'
          && inRoom((p as { x: number }).x, (p as { z: number }).z));
        assert.equal(clutter.length, 0, `${spec.id}: ${r.id} is a stage and has ${clutter.length} pots on it`);
      }
      if (!def.enemies) {
        const mobs = (spec.spawns ?? []).filter((s) => inRoom(s.x, s.z));
        assert.equal(mobs.length, 0, `${spec.id}: ${mobs.length} enemies in a ${r.roomType}`);
      }
    }
  }
});

test('A SEAL ALWAYS HAS SOMETHING THAT SPRINGS IT', () => {
  // A `contested` room drops a portcullis when you reach for what it guards —
  // and `guarded` exists only on offerings and chests. Land the modifier on a
  // SANCTUM and there is nothing to reach for, so the gate can never close and
  // the modifier is silently a no-op. Measured at 12 of 40 contested rooms
  // before the generator started refusing to ship a seal it can't spring.
  //
  // An arena is the exception by design: its challenge altar is the trigger,
  // and that is the room's centrepiece rather than a flag on a prop.
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      const fitting = (r as { perimeterFitting?: string }).perimeterFitting;
      if (fitting !== 'arena-portcullis' || r.roomType === 'arena') continue;
      const trigger = (spec.props ?? []).some((p) => (p as { guarded?: boolean }).guarded
        && pointInPoly(r.poly!, (p as { x: number }).x, (p as { z: number }).z));
      assert.ok(trigger, `${spec.id}: ${r.id} is sealed by nothing — the gate can never close`);
    }
  }
});

test('a dark room is dark, not broken', () => {
  // Zero lights would be a bug the player cannot distinguish from the end of
  // the world. One sconce behind you is what makes the dark ahead READ as dark.
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      if ((r as { lightTier?: string }).lightTier !== 'dark') continue;
      const lit = (spec.torches ?? []).filter((t) => pointInPoly(r.poly!, t.x, t.z)).length;
      assert.equal(lit, 1, `${spec.id}: a dark room carries ${lit} sconces`);
    }
  }
});

test('the same seed builds the same floor', () => {
  // Resume, descend and reload all regenerate the floor. A generator that
  // drifted would put the player somewhere the save file does not agree with.
  for (const seed of SEEDS) for (const depth of DEPTHS) {
    assert.equal(
      JSON.stringify(generatePolyFloor(depth, seed)),
      JSON.stringify(generatePolyFloor(depth, seed)),
      `depth ${depth} seed ${seed} regenerated differently`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
