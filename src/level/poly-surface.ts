import type { PropSpec } from './types';
import { polyArea, pointInPoly, type Poly } from './room-shape';
import { candidateSpots } from './floor-region';
import type { RoomOccupancy } from './room-occupancy';
import { roomType, type RoomTypeId } from './room-types';
import { skinCandidates } from './skin';
import { activeSkin } from './skins';
import type { Claim } from './prop-taxonomy';
import { FLOOR_CRACK } from '../content/clutter';
import { COBWEB_CORNER } from '../content/cobweb';
import type { WallSurface } from './wall-surfaces';
import { dressing } from './dressing';

// ── DEBRIS HAS A CAUSE. ──────────────────────────────────────────────────────
//
// Josh: *"I'd rather you rewrite the clutter thing, and it being part of the
// decoration system, than randomly sprawling floors with stuff — most of the old
// legacy systems are crude, we can do much better nowadays."*
//
// He is right, and the first version of this file was the thing he objected to:
// a straight port of `clutter.ts`'s surfacePass, which picks `area / 14` points
// off a sampler and drops a model on each. That is a DENSITY, and a density is
// why a vault floor's grit reads as noise — the same amount of stuff everywhere,
// caused by nothing, telling you nothing about the room it is in.
//
// ── WHAT THIS DOES INSTEAD ───────────────────────────────────────────────────
//
// Rubble collects. It sheds off walls, wedges into corners, and gets kicked out
// of anywhere anyone actually walks. So this places DEPOSITS, not points: a few
// anchors chosen because something is there, and a small pile around each that
// thins with distance.
//
//   AGAINST A WALL RUN — the long unbroken faces, where a ceiling sheds and
//     nobody treads. Weighted by length, so a nave's long side collects and a
//     two-metre stub between two doorways does not.
//   IN A CORNER — the sharp ones only. Debris wedges into a corner; it does not
//     wedge into a 135° chamfer.
//
// And HOW MUCH is the room's own condition, not its floor area. Every room
// already states how ruined it is — `wear`, the same number `poly-room-shell`
// builds its coursework and its half-collapsed wall from. Sharing it is the
// whole point: a room whose walls are coming down and whose floor is spotless is
// two rooms in one place. That number was sitting there unused by the floor.
//
// ── AND IT SPENDS NO SHARED RANDOMNESS ───────────────────────────────────────
//
// Its own stream, seeded from the room id. The ported version drew from the
// floor's `dressRand` and two tests caught it inside a minute: `A THEME CHANGE
// IS NOT A LEVEL CHANGE` (a palette whose debris pool was empty made a different
// number of draws, which moved a later prop) and `NOTHING STANDS IN A DOORWAY`
// (the corridor pass, downstream in the same stream, shifted a drag smear into a
// frame).
//
// That is not a bug to patch, it is a property to have. A decoration pass must
// not be ABLE to move anything. Per room, seeded by id, it cannot: a skin swap, a
// re-order, or deleting this file entirely leaves every spawn, every staged beat
// and every corridor exactly where it was.

/** The room this pass needs, stated here rather than inherited from a shape
 *  that grows elsewhere. */
export interface SurfaceRoom {
  id: string;
  type: RoomTypeId;
  poly: Poly;
  walls: readonly WallSurface[];
  occupancy: RoomOccupancy;
  /** How ruined this room is, 0..1 — the SAME number `poly-room-shell` derives
   *  its coursework and its collapsed wall from. */
  wear: number;
  /** Gates the vocabulary. A tended room is swept and never webbed; a flooded
   *  one is never offered ash — the filter runs inside `skinCandidates`, so it
   *  is never offered rather than offered and culled. */
  claims: readonly Claim[];
}

/** Deposits in a fully ruined room of reference size. Small on purpose: the
 *  read comes from each deposit being a PILE, not from there being many. */
const MAX_DEPOSITS = 5;
/** Pieces in one deposit. One is a dropped rock; six is a spill. */
const DEPOSIT_MIN = 2;
const DEPOSIT_MAX = 5;
/** How far a deposit's pieces spread from its anchor. */
const SPREAD = 0.85;
/** Below this the room is kept, not abandoned, and gets nothing. Shell wear is
 *  derived in [0.18, 0.68], so this leaves the tidier third clean. */
const WEAR_FLOOR = 0.30;
/** Square metres of room a deposit count is quoted against. */
const REFERENCE_AREA = 60;
/** A wall run shorter than this is a stub between doorways. */
const MIN_RUN = 2.2;
/** A corner sharp enough to trap anything. ~115°. */
const CORNER_MAX_ANGLE = 2.0;
const MAX_WEBS = 2;
const CORNER_INSET = 0.42;

/**
 * Dress one room's floor with the evidence of its own condition.
 *
 * Appends to `out`. Reserves nothing: debris is flat and walkable, and a room's
 * own grit pushing its content around is the opposite of dressing.
 */
export function surfaceDressRoom(r: SurfaceRoom, out: PropSpec[]): void {
  // A stage is a stage — shops, shrines and the harbor present one thing and
  // stay swept. The room type already says so; this pass just listens.
  if (roomType(r.type).clean) return;
  if (r.wear < WEAR_FLOOR) return;

  const rand = seededRand(`surface:${r.id}`);
  // Remapped onto [0, 1] from the floor of the range, so "just past the
  // threshold" means barely touched. A threshold that also scales its own
  // output is not a threshold.
  const ruin = Math.min(1, (r.wear - WEAR_FLOOR) / (1 - WEAR_FLOOR));
  // Sub-linear in area: a hall is not eight times as strewn as a cell, it just
  // has more places for a pile to be.
  const scale = Math.sqrt(Math.max(0.35, polyArea(r.poly) / REFERENCE_AREA));
  const deposits = Math.max(1, Math.round(MAX_DEPOSITS * ruin * scale));

  // POSITIONS ARE THE LEVEL'S, MODELS ARE THE SKIN'S.
  //
  // The pool is consulted for WHAT goes down, never for WHETHER to draw. An
  // earlier version wrapped this whole loop in `if (pool.length)`, so a palette
  // that declares no debris skipped every draw inside it and the CRACKS below
  // — which share this room's stream — moved. `A THEME CHANGE IS NOT A LEVEL
  // CHANGE` caught it, correctly: a theme may change what is on the floor and
  // may not change where anything is.
  const pool = skinCandidates(activeSkin(), { intent: 'debris.small', claims: r.claims });
  {
    let laid = 0;
    for (const a of shuffle(depositAnchors(r, rand), rand)) {
      if (laid >= deposits) break;
      const want = DEPOSIT_MIN + Math.floor(rand() * (DEPOSIT_MAX - DEPOSIT_MIN + 1));
      let placed = 0;
      for (let i = 0; i < want * 3 && placed < want; i++) {
        // Two draws averaged bias toward the anchor, so a deposit has a dense
        // heart and a couple of outliers — which is what a pile looks like, and
        // what a uniform disc does not.
        const d = ((rand() + rand()) / 2) * SPREAD;
        const ang = rand() * Math.PI * 2;
        const x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
        if (!pointInPoly(r.poly, x, z)) continue;
        if (!r.occupancy.fits({ kind: 'cylinder', x, z, r: 0.20, y0: 0, y1: 0.30 }, 0.06)) continue;
        // The rotation draw happens either way — see the note above.
        const rotY = rand() * Math.PI * 2;
        placed++;
        // Gated exactly where `!pool.length` is gated, and for the file's own
        // stated reason: "A THEME CHANGE IS NOT A LEVEL CHANGE". The draws above
        // have already happened and must keep happening — the cracks below share
        // this room's stream, so skipping a draw here would MOVE them.
        if (!pool.length || !dressing('floor-debris')) continue;
        out.push({
          kind: 'model', model: pool[(laid + placed) % pool.length],
          x, y: 0, z, rotY,
          _dbg: 'poly-surface',
        } as PropSpec);
      }
      if (placed) laid++;
    }
  }

  // ── CRACKS ───────────────────────────────────────────────────────────────
  // Not debris, and not placed like it. A crack is in the SLAB, so it belongs
  // in the open middle the deposits left alone. Flat, so no occupancy test — a
  // crack runs under a chest quite happily.
  const spots = shuffle(candidateSpots(r.poly, { radius: 0.20, band: [1.2, Infinity], pitch: 1.1 }), rand);
  const cracks = Math.max(1, Math.round(3 * ruin * scale));
  for (let i = 0; i < Math.min(cracks, spots.length); i++) {
    if (!dressing('floor-crack')) { rand(); continue; }   // spend the rotation draw
    out.push({
      kind: 'model', model: FLOOR_CRACK,
      x: spots[i].x, y: 0, z: spots[i].z, rotY: rand() * Math.PI * 2,
      _dbg: 'poly-surface',
    } as PropSpec);
  }

  // ── WEBS ─────────────────────────────────────────────────────────────────
  // In the REAL corners, which a polygon knows and a bounding box guesses — the
  // rect pass hung these at the four corners of the box, which on a shaped room
  // is open floor. Never in a tended room, which is the actual fix for "the
  // merchant stands inside his own cobwebs".
  if (dressing('cobweb-corner') && !r.claims.includes('tended') && ruin > 0.25) {
    let webs = 0;
    for (const c of shuffle(sharpCorners(r.poly), rand)) {
      if (webs >= MAX_WEBS) break;
      if (rand() > 0.28 * (0.5 + ruin)) continue;
      if (!r.occupancy.fits({ kind: 'cylinder', x: c.x, z: c.z, r: 0.35, y0: 1.5, y1: 2.6 }, 0.1)) continue;
      webs++;
      out.push({
        kind: 'model', model: COBWEB_CORNER,
        x: c.x, y: 1.7 + rand() * 0.85, z: c.z,
        rotY: c.rotY + (rand() - 0.5) * 0.7,
        rotZ: (rand() - 0.5) * 0.6,
        scale: 0.65 + rand() * 0.65,
        destructible: true,
        _dbg: 'poly-surface',
      } as PropSpec);
    }
  }
}

/**
 * Where debris would actually end up: along the long unbroken wall runs, and
 * wedged into the sharp corners.
 *
 * Wall runs are weighted by length by being offered more than once — a 9m nave
 * side gets three chances at a deposit and a 2.5m stub gets one, without the
 * caller needing to know a weighted pick is happening.
 */
function depositAnchors(r: SurfaceRoom, rand: () => number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const w of r.walls) {
    if (w.length < MIN_RUN) continue;
    const slots = Math.max(1, Math.min(3, Math.floor(w.length / 3)));
    for (let i = 0; i < slots; i++) {
      // Along the run but off both ends — the ends are jambs and corners, and
      // the corners are anchors in their own right below.
      const t = 0.2 + rand() * 0.6;
      const x = w.a[0] + (w.b[0] - w.a[0]) * t;
      const z = w.a[1] + (w.b[1] - w.a[1]) * t;
      // Off the wall by a little more than the pile's own spread, so a deposit
      // sits AGAINST the stone rather than half inside it.
      const px = x + w.inward[0] * 0.55, pz = z + w.inward[1] * 0.55;
      if (pointInPoly(r.poly, px, pz)) out.push({ x: px, z: pz });
    }
  }
  for (const c of sharpCorners(r.poly)) out.push({ x: c.x, z: c.z });
  return out;
}

/**
 * The polygon's real corners — inset along the bisector, facing back out of the
 * corner, and only the ones sharp enough to hold anything.
 */
function sharpCorners(poly: Poly): Array<{ x: number; z: number; rotY: number }> {
  const out: Array<{ x: number; z: number; rotY: number }> = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n];
    const ax = prev[0] - cur[0], az = prev[1] - cur[1];
    const bx = next[0] - cur[0], bz = next[1] - cur[1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    const ux = ax / la, uz = az / la, vx = bx / lb, vz = bz / lb;
    const interior = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (interior > CORNER_MAX_ANGLE) continue;          // a bend, not a corner
    let mx = ux + vx, mz = uz + vz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) continue;
    mx /= ml; mz /= ml;
    const x = cur[0] + mx * CORNER_INSET, z = cur[1] + mz * CORNER_INSET;
    // A reflex corner's bisector points OUT of the room; containment rejects it
    // without this needing to know what a reflex corner is.
    if (!pointInPoly(poly, x, z)) continue;
    out.push({ x, z, rotY: Math.atan2(-mx, -mz) });
  }
  return out;
}

/** Fisher-Yates on a copy. */
function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A stream of this room's own, from its id — the whole reason this pass cannot
 * move anything else on the floor.
 */
function seededRand(key: string): () => number {
  let x = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    x ^= key.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return () => {
    x = (x + 0x6D2B79F5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How much floor a room is carrying, for the audit — dressing has to be shown
 *  to have stayed dressing rather than become obstruction. */
export function surfaceDensity(poly: Poly, count: number): number {
  return count === 0 ? Infinity : polyArea(poly) / count;
}
