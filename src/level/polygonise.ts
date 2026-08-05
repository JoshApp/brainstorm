import type { LevelSpec, RoomSpec } from './types';
import { chamfer, pointInPoly, type Poly } from './room-shape';
import { clearance } from './floor-region';

// ── TEACHING THE EXISTING DUNGEON TO STOP BEING BOXES ────────────────────────
//
// The polygon shell has been real for a while and exactly ONE room in the game
// used it — the starter chamber, hand-authored, hand-verified. Every procgen
// floor was still rectangles, because a vault room can't simply be handed an
// archetype: it carries content the tilemap placed against its rect (torches AT
// the wall cells, props against the walls, doors in the perimeter, stairs
// descending INTO a specific wall). Swap in a shape that's smaller anywhere and
// that content is now inside stone.
//
// So this does the SMALLEST thing that stops a room being a box, and refuses
// when it can't:
//
//   CHAMFER ONLY. Cut the four corners and nothing else. The bounding box is
//   unchanged, so everything mounted along a wall — which is nearly everything
//   the tilemap places — is exactly where it was. Only the corners move, and
//   corners are where content is rarest.
//
//   THEN CHECK, THEN COMMIT. Every prop, torch, spawn, door, stair body and the
//   player's own start position is tested against the polygon with clearance. If
//   any of them would end up outside, the room stays a rectangle. Placement
//   DEGRADES; it does not damage and repair.
//
// This is a slice, not the destination. The destination is the generator owning
// placement so a room can be any archetype (docs/ROOM-COMPOSITION.md). But a
// chamfered room gets the polygon shell's coursework and piers, gets walls that
// are no longer four flat planes, and gets there without touching the vault
// pipeline at all — and the fit gate is the same check the real version needs.

/** How hard to cut, as a fraction of the room's short side. Deliberately mild:
 *  this runs on EVERY room in the game, and a dungeon of hard-cut octagons reads
 *  as a style, not as architecture. */
const CHAMFER_FRACTION = 0.16;
const CHAMFER_MAX = 1.4;
/** Below this the corners are all there is, and cutting them makes a lozenge. */
const MIN_SIDE = 5.0;
/** Smallest cut worth making. `chamfer` itself ignores anything under 0.2m, and
 *  a 0.3m nick on a 10m wall is invisible — a room that can only take that is a
 *  room that should stay a rectangle. */
const MIN_CHAMFER = 0.3;
/** Clearance every checked position needs from the new outline — but only where
 *  the rect actually offered that much; see clearOfCut. */
const MARGIN = 0.28;
/** Elbow room a position may lose to the cut. Big enough that a shaved
 *  centimetre doesn't veto a room, small enough that nothing ends up in stone. */
const LOSS_TOLERANCE = 0.30;
/** How far a stair body reaches into its wall (STAIRWELL_TOTAL_DEPTH ~2.56). */
const STAIR_BODY = 2.6;

/**
 * Give every eligible room in `spec` a chamfered polygon.
 *
 * Mutates in place, additively: a room that doesn't qualify is left exactly as
 * it was, and the rect path builds it exactly as before. Returns a count for
 * audits — "how much of the dungeon is no longer boxes" is a number worth being
 * able to measure rather than assert.
 */
export function polygoniseRooms(
  spec: LevelSpec,
  /** Why a room stayed rectangular. Audits pass this; the game doesn't. A gate
   *  that rejects everything looks exactly like a dungeon with nothing to
   *  convert, so the reason has to be askable. */
  onSkip?: (roomId: string, reason: string) => void,
): { converted: number; skipped: number } {
  let converted = 0, skipped = 0;
  const openings = (spec.corridors ?? []).map((c) => c.rect);
  for (const room of spec.rooms) {
    const why = ineligible(room);
    if (why) { skipped++; onSkip?.(room.id, why); continue; }
    const poly = largestFittingChamfer(spec, room, openings, onSkip && ((r) => onSkip(room.id, r)));
    if (!poly) { skipped++; continue; }
    room.poly = poly;
    converted++;
  }
  return { converted, skipped };
}

/**
 * Rooms the polygon shell cannot yet build.
 *
 * Each of these is a rect-path feature the poly shell doesn't have — timber
 * bracing, a floor grate, a ceiling shaft. Converting one wouldn't look wrong,
 * it would look MISSING, which is harder to notice and harder to trace back.
 *
 * Vaulted ceilings USED to be on this list, and they were 67% of every refusal:
 * excluding them held conversion at 1% of rooms, which is a feature that isn't
 * in the game. The poly shell builds them now.
 */
function ineligible(room: RoomSpec): string | null {
  if (room.logicalOnly) return 'logical-only';
  if (room.wallVariant === 'braced') return 'braced';
  if (room.poly) return 'already shaped';
  if (Math.min(room.rect.w, room.rect.d) < MIN_SIDE) return 'too small';
  return null;
}

/**
 * The biggest corner cut this room's CONTENTS will tolerate, or null.
 *
 * The first version tried one chamfer and rejected the room if anything fell
 * outside. Measured across 288 floors: that converted ZERO rooms. Every eligible
 * room failed, and always on the same thing — clutter. A vase or a broken column
 * is placed in the WALL BAND, which is exactly the strip a corner cut removes.
 *
 * So don't reject the room and don't move the vase: SHRINK THE SHAPE. Walk the
 * chamfer down and take the largest that everything clears. A room whose corners
 * are full keeps small cuts; an empty hall gets the full one. Nothing is
 * destroyed and nothing is nudged — the shape yields to the content, which is
 * the right way round, because the content was placed deliberately and the
 * chamfer is decoration.
 */
function largestFittingChamfer(
  spec: LevelSpec, room: RoomSpec,
  openings: ReadonlyArray<{ x: number; z: number; w: number; d: number }>,
  onSkip?: (reason: string) => void,
): Poly | null {
  const max = Math.min(CHAMFER_MAX, Math.min(room.rect.w, room.rect.d) * CHAMFER_FRACTION);
  let last = 'chamfer too small';
  for (let amount = max; amount >= MIN_CHAMFER - 1e-6; amount -= 0.15) {
    const poly = chamferedPoly(room, amount);
    if (!poly) { last = `chamfer noop @${amount.toFixed(1)}`; continue; }
    const bad = contentFits(spec, room, poly, openings);
    if (!bad) return poly;
    last = bad;
  }
  onSkip?.(last);
  return null;
}

/** The room's rect with its corners cut. */
function chamferedPoly(room: RoomSpec, amount: number): Poly | null {
  const cut = chamfer(rectPoly(room.rect), amount);
  return cut.length >= 5 ? cut : null;
}

/**
 * Does everything already in this room survive the new outline?
 *
 * The list is every producer that places something at a position inside a room.
 * Missing one means that thing silently ends up in the wall — which is the exact
 * failure mode this whole effort has been chasing, so the list is deliberately
 * long and deliberately includes things that "obviously" sit near the middle.
 */
function contentFits(
  spec: LevelSpec, room: RoomSpec, poly: Poly,
  openings: ReadonlyArray<{ x: number; z: number; w: number; d: number }>,
): string | null {
  const inRoom = (x: number, z: number) => insideRect(room.rect, x, z);

  for (const p of spec.props ?? []) {
    const px = (p as { x?: number }).x, pz = (p as { z?: number }).z;
    if (typeof px !== 'number' || typeof pz !== 'number') continue;
    if (!inRoom(px, pz)) continue;
    if (!clearOfCut(poly, room.rect, px, pz, MARGIN)) return `prop:${(p as {kind?:string}).kind}`;
  }
  // A sconce sits ON the wall, so it needs the outline to still pass through it
  // — not clearance. Checked as "inside at all", with the corner cut being the
  // only thing that can remove it.
  for (const t of spec.torches ?? []) {
    if (!inRoom(t.x, t.z)) continue;
    if (!pointInPoly(poly, t.x, t.z)) return 'torch';
  }
  for (const s of spec.spawns ?? []) {
    if (!inRoom(s.x, s.z)) continue;
    if (!clearOfCut(poly, room.rect, s.x, s.z, MARGIN)) return 'spawn';
  }
  for (const d of spec.doors ?? []) {
    const mx = (d.ax + d.bx) / 2, mz = (d.az + d.bz) / 2;
    if (!inRoom(mx, mz)) continue;
    if (!pointInPoly(poly, mx, mz)) return 'door';
  }
  for (const st of spec.stairs ?? []) {
    if (!inRoom(st.x, st.z)) continue;
    // The whole descent run, not just the head — a stair whose body leaves the
    // room buries into masonry, which is invisible until you take it.
    const dirX = Math.sin(st.rotY ?? 0), dirZ = Math.cos(st.rotY ?? 0);
    for (let t = 0; t <= STAIR_BODY; t += 0.2) {
      if (!pointInPoly(poly, st.x + dirX * t, st.z + dirZ * t)) return 'stair body';
    }
  }
  if (spec.startPos && inRoom(spec.startPos.x, spec.startPos.z)) {
    if (!clearOfCut(poly, room.rect, spec.startPos.x, spec.startPos.z, 0.5)) return 'startPos';
  }
  // A corridor must still meet a wall it can cut. A chamfer that swallowed a
  // doorway would seal the room — the one failure here that isn't cosmetic.
  for (const r of openings) {
    if (!touchesRect(room.rect, r)) continue;
    if (!pointInPoly(poly, r.x, r.z) && !edgeCrossesRect(poly, r)) return 'corridor mouth';
  }
  return null;
}

function insideRect(r: { x: number; z: number; w: number; d: number }, x: number, z: number): boolean {
  return Math.abs(x - r.x) <= r.w / 2 + 0.01 && Math.abs(z - r.z) <= r.d / 2 + 0.01;
}

function touchesRect(
  a: { x: number; z: number; w: number; d: number },
  b: { x: number; z: number; w: number; d: number },
): boolean {
  return Math.abs(a.x - b.x) <= (a.w + b.w) / 2 + 0.5 && Math.abs(a.z - b.z) <= (a.d + b.d) / 2 + 0.5;
}

/**
 * How much elbow room did the CUT take from this position?
 *
 * Two wrong versions before this one, and the second is the instructive one.
 *
 * v1 asked "is there `pad` metres of clearance". Zero rooms converted across
 * 288 floors: a vase placed 0.3m from a wall has never had 0.45m of clearance
 * and never will — the rect path put it there deliberately. Demanding room the
 * dungeon never offered measures the wrong thing entirely.
 *
 * v2 sampled a ring and required that anything still inside the old rect was
 * also inside the new polygon. Still zero — because at a prop sitting 0.45m off
 * a corner-adjacent wall, one sample lands exactly ON the old wall plane, and
 * the chamfer there has taken 5 CENTIMETRES. A binary test can't tell a 5cm
 * shave from being swallowed whole.
 *
 * So measure the loss. Signed distance to the outline, before and after: a
 * position may keep less room than it had, but not much less, and never less
 * than a floor. That is a statement about the CHANGE, which is what a
 * conversion actually risks.
 */
function clearOfCut(
  poly: Poly, rect: { x: number; z: number; w: number; d: number },
  x: number, z: number, floor: number,
): boolean {
  if (!pointInPoly(poly, x, z)) return false;
  const before = clearance(rectPoly(rect), x, z);
  const after = clearance(poly, x, z);
  return after >= Math.min(floor, before - LOSS_TOLERANCE);
}

/** A rect as a polygon, so both sides of the comparison use the same measure. */
function rectPoly(r: { x: number; z: number; w: number; d: number }): Poly {
  const hw = r.w / 2, hd = r.d / 2;
  return [
    [r.x - hw, r.z - hd], [r.x + hw, r.z - hd], [r.x + hw, r.z + hd], [r.x - hw, r.z + hd],
  ];
}

/** Does any polygon edge pass through this rect? (i.e. can it still cut a
 *  doorway here). */
function edgeCrossesRect(
  poly: Poly, r: { x: number; z: number; w: number; d: number },
): boolean {
  const minX = r.x - r.w / 2 - 0.3, maxX = r.x + r.w / 2 + 0.3;
  const minZ = r.z - r.d / 2 - 0.3, maxZ = r.z + r.d / 2 + 0.3;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    // Sample the edge — exact clipping isn't needed to answer "does it come
    // near", and this can't be wrong in a way that seals a room silently.
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
    }
  }
  return false;
}
