import type { EncounterArchetype } from '../content/encounters';
import { ENEMIES } from '../content/enemies';
import type { Poly } from './room-shape';

// ── THE ROOM DECIDES WHAT THE FIGHT IS ───────────────────────────────────────
//
// Josh, on the barren-halls ticket: *"I don't want to just randomly fill rooms.
// I want to fill them with intent — we should use the bigger space for GAMEPLAY
// rather than decorating it aimlessly."*
//
// He is right, and the measurement says the ticket was aimed at the wrong thing.
// A hall is not under-decorated; a hall is under-USED. Measured over 72 floors:
// the spawn COUNT already scales with area (polyArea / 40), so a big room gets
// more enemies. What it does not get is a different FIGHT. `rollFloorEnemies`
// hard-coded `archetype: 'mixed'` for every room on every poly floor, so the
// ranged share of spawns came out 14.8% in a mid room, 16.0% in a large one and
// 8.9% in a hall — flat, and if anything BACKWARDS. The rooms where a 9m attack
// range is the only place it can mean anything were getting the fewest archers.
//
// So a hall was the same encounter twice, in a bigger box. Adding scenery to it
// would not have changed that.
//
// ── WHAT A BIG ROOM ACTUALLY AFFORDS ─────────────────────────────────────────
//
// DISTANCE. That is the whole of it, and it is the one resource a corridor and
// a small chamber cannot supply. Distance is what makes a ranged enemy a threat
// instead of a melee enemy that flinches; it is what makes closing ground a
// decision; and this game already has a mechanic that only pays out across a
// gap — accuracy demands stillness, so a shot fired while moving blooms off-aim
// (CONFIG, "RANGED COMMITMENT"). None of that can happen in six metres.
//
// So the room's SPAN picks the encounter, out of archetypes content/encounters.ts
// already authored and the poly floor had never once used:
//
//   caster-pack  ['heavy','ranged','ranged','ranged']  — its own comment reads
//                "casters behind a melee guard — forces you to close under
//                fire", which is a hall's fight described exactly.
//   swarm        five light bodies — needs room to be surrounded IN.
//   bruisers     a slow armoured grind — a tight room, where you cannot kite
//                and have to trade.
//   mixed        the middle, and what every room used to get.
//
// SPAN, NOT AREA. What an archer needs is a straight line, and a long room has
// one that a square of the same floor area does not. Measured on the polygon's
// own extent rather than its rect, because a polygon room is not its bounding
// box — that mistake has cost this session four separate bugs.

/**
 * THE SPAN AT WHICH A RANGED ENEMY BECOMES A RANGED ENEMY, and it is derived.
 *
 * Read off the roster: the longest `attackRange` any ranged mob carries. Under
 * that the archer is inside its own minimum useful distance the moment you take
 * two steps, and the fight is a melee fight with worse animations. Retune the
 * acolyte and this moves with it — the same discipline MIN_WALKABLE_WIDTH is
 * solved with in corridor-types.ts, and for the same reason: a number typed in
 * here would be right today and quietly wrong after the next balance pass.
 */
function longestRangedReach(): number {
  let max = 0;
  for (const e of Object.values(ENEMIES) as Array<{ ranged?: boolean; attackRange?: number }>) {
    if (e.ranged && (e.attackRange ?? 0) > max) max = e.attackRange ?? 0;
  }
  return max;
}
export const RANGED_SPAN = longestRangedReach();

/**
 * The longest straight line inside the room, metres.
 *
 * The polygon's own diameter — the greatest distance between any two of its
 * corners. Not the bounding box's diagonal: an L-shaped room's box spans a
 * quadrant it has no floor in, and would be credited with a sightline that
 * does not exist.
 */
export function roomSpan(poly: Poly): number {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const d = Math.hypot(poly[i][0] - poly[j][0], poly[i][1] - poly[j][1]);
      if (d > best) best = d;
    }
  }
  return best;
}

/** A span band and what it fights like. Weights, not a hard pick — a floor where
 *  every big room runs the same archetype is a floor with one idea in it. */
interface ShapeBand {
  /** Minimum span, metres. Bands are tried longest-first. */
  minSpan: number;
  weights: ReadonlyArray<readonly [EncounterArchetype, number]>;
}

/**
 * WHAT A ROOM OF THIS SPAN FIGHTS LIKE.
 *
 * The thresholds are multiples of RANGED_SPAN rather than metres, so the whole
 * table follows the roster instead of drifting from it:
 *
 *   under 1.25× — an archer cannot open a gap here at all. Bruisers: stand and
 *                 trade, because there is nowhere to go.
 *   1.25 - 1.8× — a gap exists but you cross it in a couple of strides. The
 *                 middle, and mostly what the floor used to be.
 *   over 1.8×   — a real hall. Casters behind a guard, or a swarm with room to
 *                 come around you. This is the band that was doing nothing.
 *
 * AND THE MULTIPLIERS ARE SET AGAINST THE MEASURED SPREAD, not chosen for how
 * they read. Room span over 72 floors runs p25 11.4m, p50 14.0m, p75 16.2m — so
 * 1.25× (11.3m) and 1.8× (16.2m) cut the floor roughly into quarter / half /
 * quarter. A first pass put the top band at 1.6×, which is 14.4m, which is the
 * MEDIAN: half of every floor came out a "hall", and a hall that is half the
 * rooms is just a room.
 */
const BANDS: readonly ShapeBand[] = [
  {
    minSpan: RANGED_SPAN * 1.8,
    weights: [['caster-pack', 0.45], ['swarm', 0.35], ['mixed', 0.20]],
  },
  {
    minSpan: RANGED_SPAN * 1.25,
    weights: [['mixed', 0.50], ['caster-pack', 0.25], ['swarm', 0.25]],
  },
  {
    minSpan: 0,
    weights: [['bruisers', 0.55], ['mixed', 0.45]],
  },
];

/**
 * Which archetype this room's shape asks for.
 *
 * `rand` is the floor's layout stream — an encounter is not dressing, it is
 * part of what the floor IS, so it belongs on the same deterministic stream as
 * everything else that decides content.
 */
export function archetypeForSpan(span: number, rand: () => number): EncounterArchetype {
  const band = BANDS.find((b) => span >= b.minSpan) ?? BANDS[BANDS.length - 1];
  const total = band.weights.reduce((s, [, w]) => s + w, 0);
  let roll = rand() * total;
  for (const [id, w] of band.weights) { roll -= w; if (roll <= 0) return id; }
  return band.weights[band.weights.length - 1][0];
}
