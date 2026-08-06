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
import { candidateSpots } from '../src/level/floor-region';
import { roomType } from '../src/level/room-types';
import { propFacts, claimsConflict } from '../src/level/prop-taxonomy';
import { wallFixtureModel } from '../src/level/lit-fixture-pool';
import type { LevelSpec, PropSpec, RoomSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// WIDER THAN IT WAS, AND THE REASON IS ON THE RECORD.
//
// This was 4 seeds × 5 depths = 20 floors, and 20 floors was enough to FIND the
// first 46 claim contradictions but not enough to prove the zero it then
// claimed: re-run over 12 × 12, the same assertion failed again on seeds it had
// never seen. A sample that can only find a bug once is a sample that retires
// itself the moment the bug is fixed.
//
// 12 seeds × 6 depths spans every act (safe rooms at 3/7/12 are vault-composed,
// so the depths here are the procgen ones) and still runs in a few seconds.
const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444, 555, 66, 777, 8888];
const DEPTHS = [1, 2, 5, 6, 8, 11];

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
  // VOIDS ARE COLLISION. builder.ts turns every spec.voids rect into a
  // full-height AABB obstacle; a flood that omitted them would report a room as
  // reachable when a rift had cut it in half, which is precisely the failure the
  // rift planner exists to prevent and precisely the one a test with no
  // obstacles cannot see.
  const obstacles = (spec.voids ?? []).map((v) => ({
    kind: 'aabb' as const,
    minX: v.x - v.w / 2, maxX: v.x + v.w / 2,
    minZ: v.z - v.d / 2, maxZ: v.z + v.d / 2,
    yTop: Infinity,
  }));
  return new WalkableRegion(allRects.map((r) => r.rect), obstacles, segs);
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

/**
 * Every light source in a room, of any SHAPE.
 *
 * Counting `spec.torches` alone was right when a sconce was the only kind of
 * light there was. light-plan.ts added pools, shafts and standing braziers, and
 * those are exactly the shapes the rooms a bracket cannot serve fall back to —
 * so a torch-only count reports the rooms the new system FIXED as unlit.
 */
function lightsIn(spec: LevelSpec, poly: NonNullable<RoomSpec['poly']>): number {
  // cresset-pike was missing here until the interior-light pass made it 30% of
  // every standing light the generator places — a light this helper could not
  // see was a light no lighting test could count.
  const LIGHT_MODEL = /^(god-ray|floor-glow|iron-brazier|great-brazier|cresset-pike)/;
  const torches = (spec.torches ?? []).filter((t) => pointInPoly(poly, t.x, t.z)).length;
  const models = (spec.props ?? []).filter((p) => {
    const m = p as { kind?: string; model?: { id?: string }; x?: number; z?: number };
    return m.kind === 'model' && LIGHT_MODEL.test(m.model?.id ?? '')
      && typeof m.x === 'number' && typeof m.z === 'number' && pointInPoly(poly, m.x, m.z);
  }).length;
  return torches + models;
}

/** The same lights, as POINTS — for anything asking how far away one is. */
function lightPoints(
  spec: LevelSpec, poly: NonNullable<RoomSpec['poly']>,
): Array<{ x: number; z: number }> {
  const LIGHT_MODEL = /^(god-ray|floor-glow|iron-brazier|great-brazier|cresset-pike)/;
  return [
    ...(spec.torches ?? []).filter((t) => pointInPoly(poly, t.x, t.z)).map((t) => ({ x: t.x, z: t.z })),
    ...(spec.props ?? []).flatMap((p) => {
      const m = p as { kind?: string; model?: { id?: string }; x?: number; z?: number };
      return m.kind === 'model' && LIGHT_MODEL.test(m.model?.id ?? '')
        && typeof m.x === 'number' && typeof m.z === 'number' && pointInPoly(poly, m.x, m.z)
        ? [{ x: m.x, z: m.z }] : [];
    }),
  ];
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

test('NO CORRIDOR END IS ORPHANED', () => {
  // The generator's own precondition: an end that lands in blank space cuts no
  // wall and opens nothing. That is what made the doorways silently absent —
  // the corridor was "connected" to a room it never touched.
  //
  // "In a room OR in another corridor", because a connection is not always one
  // rect. A dogleg is three — a leg, a cross piece, a leg — and its two interior
  // joints are corridor-to-corridor by design. Asserting every end lands in a
  // ROOM was right until bends existed and would now forbid them.
  for (const spec of floors()) {
    for (const c of spec.corridors) {
      const r = c.rect;
      const ends: Array<[number, number]> = r.w > r.d
        ? [[r.x - r.w / 2, r.z], [r.x + r.w / 2, r.z]]
        : [[r.x, r.z - r.d / 2], [r.x, r.z + r.d / 2]];
      for (const [x, z] of ends) {
        const inRoom = spec.rooms.some((rm) => rm.poly && pointInPoly(rm.poly, x, z));
        const inJoint = spec.corridors.some((o) => o !== c
          && Math.abs(x - o.rect.x) <= o.rect.w / 2 + 0.01
          && Math.abs(z - o.rect.z) <= o.rect.d / 2 + 0.01);
        assert.ok(inRoom || inJoint,
          `${spec.id}: corridor ${c.id} ends at (${x.toFixed(1)}, ${z.toFixed(1)}) — in nothing`);
      }
    }
  }
});

test('A BEND ACTUALLY BREAKS THE SIGHTLINE', () => {
  // The whole point of a dogleg. If the two legs shared a lateral it would be a
  // straight corridor in three pieces — more geometry, same telescope.
  let bends = 0;
  for (const spec of floors()) {
    const byLink = new Map<string, typeof spec.corridors>();
    for (const c of spec.corridors) {
      const m = /^(cor-p?\d+)-\d+$/.exec(c.id);
      if (!m) continue;
      byLink.set(m[1], [...(byLink.get(m[1]) ?? []), c]);
    }
    for (const [id, parts] of byLink) {
      assert.equal(parts.length, 3, `${spec.id}: bend ${id} has ${parts.length} pieces, expected 3`);
      bends++;
      // The two LEGS run along the connecting axis; the cross runs across it.
      // Their perpendicular offsets must differ, or nothing is blocked.
      const legs = parts.filter((p) => p.rect.d > p.rect.w).length > 1
        ? parts.filter((p) => p.rect.d > p.rect.w).map((p) => p.rect.x)
        : parts.filter((p) => p.rect.w > p.rect.d).map((p) => p.rect.z);
      const spread = Math.max(...legs) - Math.min(...legs);
      assert.ok(spread > 1.5,
        `${spec.id}: bend ${id}'s legs are only ${spread.toFixed(1)}m apart — you can see straight through`);
    }
  }
  assert.ok(bends > 5, `only ${bends} bends across every sampled floor — the dogleg never fires`);
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
      const lit = lightsIn(spec, r.poly);
      const area = polyArea(r.poly);
      assert.ok(lit > 0, `${spec.id}: room ${r.id} has no light at all`);
      assert.ok(area / lit > 14,
        `${spec.id}: room ${r.id} has ${lit} lights over ${area.toFixed(0)}m² — one per ${(area / lit).toFixed(0)}m²`);
    }
  }
});

test('A HALL DOES NOT LIE ABOUT ITS SIZE', () => {
  // Josh, walking a polygon floor: *"rooms are bigger, they are barely lit in
  // the center most of the time."* Measured, he was right — the HEART of a poly
  // room (its point furthest from any wall) sat within a bracket's 5m reach only
  // 59% of the time, against 76% on the vault floors he had been walking for
  // months. A perimeter of sconces cannot light the middle of a 140m² hall.
  //
  // Asserted on the halls only, because that IS the rule: a room narrow in
  // either direction is served by its walls however long it runs.
  const REACH = 5.0, HALL = 3.4;
  let halls = 0, blind = 0;
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      const deep = candidateSpots(r.poly, { radius: 0.5, band: [HALL, Infinity], pitch: 0.9 });
      if (!deep.length) continue;   // not a hall — its walls are the answer
      halls++;
      const heart = deep[0];        // sorted by clearance: the deepest floor there is
      const lights = lightPoints(spec, r.poly);
      const d = lights.length
        ? Math.min(...lights.map((l) => Math.hypot(l.x - heart.x, l.z - heart.z)))
        : Infinity;
      if (d > REACH) blind++;
    }
  }
  assert.ok(halls > 50, `only ${halls} halls in the sample — not measuring the rule`);
  // 15 of 84 today, and the residue was read rather than waved at: 4 are halls
  // whose heart sits in an ambush pocket and stays dark ON PURPOSE (rule 4
  // outranks this one), and the other 11 all land between 5.1m and 7.8m — the
  // heart is a spot nothing may stand on (a stairwell, an offering) so the light
  // went to the nearest floor a brazier fits and the measurement, which does not
  // care whether you can stand there, calls that a miss.
  assert.ok(blind / halls < 0.25,
    `${blind}/${halls} halls have an unlit heart — the middle of the room is a guess again`);
});

test('...and the dungeon is still dark', () => {
  // The other end of the same rule, and the one that fails silently. Lighting
  // every hall's middle is trivially achievable by putting a brazier in every
  // room, which would cost the game its entire vocabulary for "this room
  // matters". The vault floors run ~2 standing lights a floor; this caps the
  // polygon floors near the same order.
  for (const spec of floors()) {
    const standing = (spec.props ?? []).filter((p) => {
      const m = p as { kind?: string; model?: { id?: string } };
      return m.kind === 'model' && /^(iron-brazier|cresset-pike)/.test(m.model?.id ?? '');
    }).length;
    assert.ok(standing <= 12,
      `${spec.id}: ${standing} standing lights on one floor — it is not a dungeon any more`);
  }
});

test('EVERY FLOOR PAYS WHAT IT PLANNED', () => {
  // floor-plan.ts's whole argument: a floor's content must not be a consequence
  // of the shape a seed happened to grow. The OFFER slot is the one thing the
  // contract says is never optional.
  //
  // THIS TEST USED TO READ THE PLAN INSTEAD OF THE FLOOR. It asked whether a
  // room of an offer-staging TYPE existed — which is a fact about the plan, and
  // was true on every floor while 5 floors in 240 actually staged nothing,
  // because on a non-trove floor the offer is a bargain the DIRECTOR places and
  // the director is allowed to decline. Check the final-state rule against the
  // final state (docs/DESIGN-METHOD.md). So: count the PROPS.
  const OFFER = new Set(['offering', 'chest', 'merchant', 'challenge-offering',
                         'tithe-basin', 'altar', 'blood-altar']);
  for (const spec of floors()) {
    const staged = (spec.props ?? []).filter((p) => OFFER.has((p as { kind: string }).kind));
    assert.ok(staged.length > 0,
      `${spec.id}: the contract promises an offer and the floor staged none`);
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
  // the world. ONE light behind you is what makes the dark ahead READ as dark.
  //
  // "One light", not "one sconce": a dark room whose single door-side bracket
  // falls inside an ambush's shadow gets a standing brazier instead, which is
  // the same decision reached by a different shape.
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      if ((r as { lightTier?: string }).lightTier !== 'dark') continue;
      const lit = lightsIn(spec, r.poly!);
      assert.equal(lit, 1, `${spec.id}: a dark room carries ${lit} lights`);
    }
  }
});

test('NOTHING THAT GATES SITS ON THE WAY TO THE STAIRS', () => {
  // This bug has now been fixed twice with the wrong test, which is the sign the
  // rule was never "a dead end".
  //
  //   v1 webbed any room the player walked THROUGH — 85% of one floor behind a
  //      single swing.
  //   v2 restricted it to rooms with one exit, and the STAIR room is a dead end
  //      by topology: 52% and 39% of two floors behind a web.
  //   v3 excepted the stair room, and the ENTRANCE walked into the same hole
  //      from the other end — one link, and that link is the way onward. 35 webs
  //      across 240 floors, 24 of them nearer the exit than the spawn.
  //
  // The rule is and always was about the MAINLINE. This floods the spawn→stairs
  // path from the shipped spec's own geometry — not from the generator's
  // bookkeeping, so a bug in that bookkeeping cannot hide here — and asserts
  // nothing gating stands on it.
  for (const spec of floors()) {
    const polyRooms = spec.rooms.filter((r) => r.poly);
    if (!polyRooms.length) continue;
    // Rooms AND corridors are nodes. A dogleg is three corridor rects and its
    // middle one touches no room at all, so a room-to-room adjacency built from
    // single corridors reports the stair room unreachable — which is how the
    // first version of this check ended up asserting on a floor it had failed to
    // understand rather than on the thing under test.
    const hit = (a: RoomSpec['rect'], b: RoomSpec['rect']) =>
      Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 0.05 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + 0.05;
    const nodes = [...polyRooms, ...(spec.corridors ?? [])];
    const adj = new Map<string, string[]>();
    const join = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (!hit(nodes[i].rect, nodes[j].rect)) continue;
        join(nodes[i].id, nodes[j].id); join(nodes[j].id, nodes[i].id);
      }
    }
    const sp = spec.startPos!;
    const start = polyRooms.find((r) => pointInPoly(r.poly!, sp.x, sp.z))?.id;
    // spec.stairs, NOT a 'stairs' prop — there is no such prop kind. Looking for
    // one made `end` undefined on every floor, the path set empty, and the whole
    // assertion vacuous: it passed with the fence deliberately deleted.
    const stair = (spec.stairs ?? [])[0];
    const end = stair ? polyRooms.find((r) => pointInPoly(r.poly!, stair.x, stair.z))?.id : undefined;
    assert.ok(start && end, `${spec.id}: could not locate the spawn room or the stair room`);
    if (!start || !end) continue;

    const parent = new Map<string, string | null>([[start, null]]);
    const q = [start];
    for (let i = 0; i < q.length && q[i] !== end; i++) {
      for (const n of adj.get(q[i]) ?? []) if (!parent.has(n)) { parent.set(n, q[i]); q.push(n); }
    }
    assert.ok(parent.has(end), `${spec.id}: the stair room is not reachable from the spawn`);
    const path = new Set<string>();
    for (let at: string | null | undefined = end; at; at = parent.get(at)) path.add(at);

    for (const r of polyRooms) {
      if (!path.has(r.id)) continue;
      const webbed = (spec.props ?? []).some(
        (p) => (p as { kind: string }).kind === 'cobweb' && pointInPoly(r.poly!, p.x, p.z));
      assert.ok(!webbed,
        `${spec.id}: ${r.id} is on the spawn→stairs path and carries a web — that is a toll, not a detour`);
    }
  }
});

test('NO ROOM CONTRADICTS ITSELF', () => {
  // docs/LEVEL-ARCHITECTURE.md §5: a room commits to one or two CLAIMS, and a
  // lit candle (SOMEONE IS HERE) cannot share a room with a cobweb (NOBODY HAS
  // BEEN, FOR YEARS) at any separation. clutter.ts enforces this on the vault
  // path; poly-decor.ts has no claim awareness at all, so this is the check that
  // the polygon generator does not quietly reintroduce "the merchant stands in
  // his own cobwebs".
  //
  // Measured 0 across 240 floors. It was 35 rooms (2.7%) while wall brackets
  // were classified 'tended' — every one of them a bracket arguing with a web —
  // which is what moved them to neutral: a torch bolted into masonry is part of
  // the building, not evidence that somebody keeps it lit. If that reasoning is
  // ever revisited, this test is what will say so.
  //
  // Goes through propFacts, NOT a copy of the claim table. The first version of
  // this measurement carried its own and reported the same number before and
  // after the table changed.
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      // r.poly is WORLD-space, like every other use of it in this file.
      const here: PropSpec[] = (spec.props ?? []).filter((p) => pointInPoly(r.poly!, p.x, p.z));
      for (const t of spec.torches ?? []) {
        if (!pointInPoly(r.poly!, t.x, t.z)) continue;
        here.push({ kind: 'model', model: wallFixtureModel(t.fixtureKind), x: t.x, y: 0, z: t.z } as PropSpec);
      }
      const claims = here.flatMap((p) => (propFacts(p)?.claims ?? []).map((c) => ({ c, p })));
      for (let i = 0; i < claims.length; i++) {
        for (let j = i + 1; j < claims.length; j++) {
          assert.ok(!claimsConflict(claims[i].c, claims[j].c),
            `${spec.id}: ${r.id} asserts both '${claims[i].c}' and '${claims[j].c}' — `
            + `the room is a bag of props, not a place`);
        }
      }
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
