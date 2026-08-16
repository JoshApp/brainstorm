import type { ModelSpec } from '../ecs/model-types';
import type { PropSpec, RoomSpec } from './types';
import {
  corridorType, MIN_WALKABLE_WIDTH, type CorridorIntent,
} from './corridor-types';
import { CLAW_RAKE, DRAG_SMEAR } from '../content/corridor-marks';
import {
  FLOOR_CRACK, WALL_GOUGE, WALL_SCORCH, STONE_SHARDS,
  BONE_PILE, RUBBLE_CHUNK, SAND_DRIFT, WALL_PILE, IRON_BARS,
} from '../content/clutter';
import { OSSUARY_NICHE_SMALL } from '../content/ossuary';
import { pointInPoly, type Poly } from './room-shape';
import { dressing } from './dressing';

// ── ROOMS STAGE EVENTS. CORRIDORS HOLD EVIDENCE. ─────────────────────────────
//
// Measured before this file existed, over 36 floors and 2008 metres of
// corridor: the props standing in a corridor were 362 doorframes and 20 strays
// that had leaked in from room dressing. Excluding the frames a corridor owns
// anyway, that is ONE PROP EVERY HUNDRED METRES. Corridors were not sparse;
// they were empty.
//
// The rule this file holds to, and the reason it is not just "put clutter in
// corridors": a corridor may never hold a DECISION. Every interactable in this
// game is placed by machinery that reasons about rooms — spacing from the door
// you came in by, one major beat per region, the contract in floor-plan.ts. Put
// a chest in a corridor and all of that silently stops being true. So a
// corridor gets residue: what happened here, and what is up ahead. You read it
// at walking pace and you never stop.
//
// ── THE SECTION DECIDES WHAT IT CAN CARRY, AND THAT IS COMPUTED ──────────────
//
// This is the payoff of the section vocabulary (corridor-types.ts). Each beat
// declares a `footprint` — the metres of clear width it eats — and eligibility
// is DERIVED:
//
//     width - footprint  >=  MIN_WALKABLE_WIDTH
//
// against the same floor the corridor widths are solved from. Nobody hand-
// assigns "no mounds in a squeeze"; a 1.55m squeeze cannot carry a 0.24m pile
// of shards because 1.31m of remaining floor is under the clearance this
// dungeon guarantees, and the table says so by arithmetic. Widen the squeeze
// and it earns the mounds; retune the archway that MIN_WALKABLE_WIDTH is solved
// from and the whole table follows. A hand-kept list would be wrong within two
// changes and would fail silently.
//
// Be precise about the failure it prevents, because the threshold is borrowed
// and the reason is not. Everything here is COSMETIC — no collision, matching
// the contract level/clutter.ts states for these same models — so an oversized
// beat does not block a corridor or wall a mob out of it. It does something
// that reads worse: it stands where you walk, and you pass straight through a
// pile of bones. MIN_WALKABLE_WIDTH is the right number anyway (it is the width
// this dungeon promises stays clear); it is just guarding a clipping bug rather
// than a pathing one, and a comment that claimed otherwise would send the next
// session looking in the nav grid.
//
// So a squeeze carries only what is pressed INTO the stone — claw rakes, floor
// cracks, drag smears — which is also, conveniently, exactly the register it
// wants. A gallery carries the standing things: bone niches, barred openings,
// drifts.
//
// ── NO LIGHT ─────────────────────────────────────────────────────────────────
//
// Nothing here emits. CLAUDE.md is explicit that an uncommon light means SOMETHING
// IS HAPPENING THERE, and a lit corridor mark would spend that signal on
// scenery. The corridor is where the player's own lamp does the work: you find
// these because you swept the wall, not because they announced themselves.

export type CorridorMount =
  /** Flat on the floor. Walked over, never stepped onto. */
  | 'floor'
  /** Against a side wall, front out. */
  | 'wall';

export interface CorridorBeat {
  id: string;
  /** Which sections carry it, as a TASTE call — "seeing this from the far end
   *  is the point, so galleries only". It is not where size is expressed: list
   *  every section a beat editorially belongs in and let `footprint` and the
   *  placer's arithmetic drop it from the ones it cannot physically fit. A
   *  size limit written here as well makes the real rule untestable. */
  intents: readonly CorridorIntent[];
  mount: CorridorMount;
  /** Metres of the corridor's CLEAR WIDTH this beat consumes. Zero for
   *  anything flat enough to walk over or thin enough to vanish into the wall
   *  plane. See the derivation above before raising one. */
  footprint: number;
  /** Metres of ceiling it needs. Omit for anything under a metre. */
  minHeight?: number;
  /** Height up the wall, metres — a range, sampled per placement. Wall mounts
   *  only; a floor mount always sits at 0. */
  y?: readonly [number, number];
  /** True to lay the model along the corridor's RUN rather than across it. The
   *  one thing a room's clutter pass cannot author: a room has no direction. */
  alongRun?: boolean;
  model: ModelSpec;
  weight: number;
}

/**
 * The corridor's whole vocabulary of evidence.
 *
 * Data, so the content layer can extend it without reading the placer. Most of
 * it is reused from the room clutter set on purpose — a corridor and the room
 * it opens into are the same dungeon, and inventing a separate set of debris
 * for passages is how you get a floor that reads as two games.
 */
export const CORRIDOR_BEATS: readonly CorridorBeat[] = [
  // ── Pressed into the stone. Every section, including the squeeze. ──
  {
    id: 'claw-rake', intents: ['squeeze', 'pass', 'promise'], mount: 'wall',
    footprint: 0.06, y: [1.05, 1.55], model: CLAW_RAKE, weight: 1.0,
  },
  {
    id: 'drag-smear', intents: ['squeeze', 'pass', 'promise'], mount: 'floor',
    footprint: 0, alongRun: true, model: DRAG_SMEAR, weight: 0.9,
  },
  {
    id: 'floor-crack', intents: ['squeeze', 'pass', 'promise'], mount: 'floor',
    footprint: 0, alongRun: true, model: FLOOR_CRACK, weight: 0.7,
  },
  {
    id: 'wall-gouge', intents: ['squeeze', 'pass', 'promise'], mount: 'wall',
    footprint: 0.09, y: [1.00, 1.70], model: WALL_GOUGE, weight: 0.6,
  },
  {
    id: 'wall-scorch', intents: ['squeeze', 'pass', 'promise'], mount: 'wall',
    footprint: 0.02, y: [1.10, 1.80], model: WALL_SCORCH, weight: 0.5,
  },
  // ── Standing residue. THESE LIST EVERY SECTION ON PURPOSE. ──
  //
  // A pile of bones belongs in a tight corridor as much as a wide one — that is
  // a taste question and the answer is yes. What keeps it out of a squeeze is
  // its SIZE, and size is the placer's arithmetic, not a list somebody kept.
  // The first cut of this table hand-excluded them from `squeeze` as well, and
  // the effect was that removing the width rule entirely changed nothing: the
  // guard was real and the belt it wore was doing all the work, which is
  // indistinguishable from not having the guard until the day it matters.
  {
    id: 'stone-shards', intents: ['squeeze', 'pass', 'promise'], mount: 'floor',
    footprint: 0.24, model: STONE_SHARDS, weight: 0.6,
  },
  {
    id: 'bone-pile', intents: ['squeeze', 'pass', 'promise'], mount: 'floor',
    footprint: 0.29, model: BONE_PILE, weight: 0.5,
  },
  {
    id: 'rubble', intents: ['squeeze', 'pass', 'promise'], mount: 'floor',
    footprint: 0.38, model: RUBBLE_CHUNK, weight: 0.4,
  },
  // ── The gallery's own. TASTE, not size — each of these would fit a passage
  // and is held back because seeing it from the far end is the whole point. ──
  {
    id: 'sand-drift', intents: ['promise'], mount: 'floor',
    footprint: 0.55, model: SAND_DRIFT, weight: 0.5,
  },
  {
    id: 'wall-pile', intents: ['promise'], mount: 'wall',
    footprint: 0.71, model: WALL_PILE, weight: 0.5,
  },
  {
    // A barred opening in the side wall — you can see through it and you can
    // never go in. The purest form of the gallery's job (PROMISE: something
    // you cannot reach yet) and the cheapest, because it is a wall piece.
    id: 'iron-bars', intents: ['promise'], mount: 'wall',
    footprint: 0.37, minHeight: 2.60, y: [0, 0], model: IRON_BARS, weight: 0.7,
  },
  {
    id: 'bone-niche', intents: ['promise'], mount: 'wall',
    footprint: 0.40, minHeight: 3.00, y: [0, 0], model: OSSUARY_NICHE_SMALL, weight: 0.6,
  },
];

/** Metres between beats, by what the section is FOR. A squeeze is a moment and
 *  wants to feel worked-over; a passage is a walk and wants to stay quiet; a
 *  gallery wants a rhythm you can read from the far end. */
const SPACING: Record<CorridorIntent, number> = {
  squeeze: 1.8,
  pass: 3.2,
  promise: 2.2,
};

/**
 * How far from each end of a leg to leave alone, metres.
 *
 * The doorframe stands here, the corridor rect deliberately overruns into the
 * room, and the ceiling/floor plates are trimmed somewhere in this band
 * (corridor-trim.ts). Anything placed inside it is placed in a doorway.
 *
 * Set against the measured legs, not by feel: they run p10 4.3m to p90 8.6m, so
 * 1.2m a side leaves a p50 passage 3.5m of middle — enough for the one beat the
 * spacing above asks of it, and not so much that short links go bare.
 */
const END_CLEAR = 1.2;

/** Gap from the wall plane for a floor beat that hugs the side, metres. */
const WALL_GAP = 0.06;

/** How far to step INTO the wall when checking a mount has stone behind it. */
const WALL_PROBE = 0.35;

/**
 * How far a beat must stay from a doorway's centre, metres.
 *
 * NOT the same thing as END_CLEAR, and assuming it was is what the first pass
 * got wrong. A leg's END is not where its door is: the rect deliberately
 * overruns INTO the room so it can reach a wall that sits back from the room's
 * bounding box, so the portal can sit a metre inside the leg. Clearing the ends
 * put a drag smear 0.77m from an archway. The doorways have to be measured as
 * doorways.
 */
const DOOR_CLEAR = 1.1;

/**
 * Lay evidence down every corridor on the floor.
 *
 * `rand` MUST be the dressing stream, not the layout stream. What a corridor is
 * strewn with has no bearing on where anything goes, and drawing it from the
 * shared stream makes a theme change look like a level change — the coupling
 * poly-floor.ts already carries a header about.
 *
 * `doorways` are the portal midpoints from `planPortals` — the SAME call the
 * frames make, so a beat and the archway it would otherwise clip are measured
 * against one answer rather than two that agree until one changes.
 *
 * `roomFloors` are the room polygons, and the reason is the recurring one: A
 * POLYGON ROOM IS NOT ITS BOUNDING BOX. A corridor rect deliberately ends
 * INSIDE the room it serves, so a slot near the end of a leg can be standing on
 * a room's floor. That is not just untidy — the room claim pass reads every
 * prop inside a polygon as something that room ASSERTS, and a corridor's ash
 * mound turned an intact chapel into a room claiming both 'tended' and
 * 'desecrated'. A corridor's evidence is the corridor's.
 *
 * Returns props; places nothing itself, so a caller can budget or filter.
 */
export function dressCorridors(
  corridors: readonly RoomSpec[],
  doorways: ReadonlyArray<{ x: number; z: number }>,
  roomFloors: ReadonlyArray<Poly>,
  rand: () => number,
): PropSpec[] {
  if (!dressing('corridor-beats')) return [];
  /**
   * IS THERE STONE BEHIND THIS WALL MOUNT?
   *
   * A wall beat is placed at the corridor rect's edge and faces inward, which
   * assumes the far side of that edge is wall. Along a straight run it always
   * is. At a JUNCTION it is not: a dogleg's bend and an L's corner are two
   * rects overlapping, so one leg's "side wall" is the other leg's floor, and
   * a set of iron bars mounted there stands in mid-air across the opening.
   *
   * Measured before this check: 60 of 636 wall beats — 9.4% — were mounted on
   * open space, including 9 barred openings and 5 bone niches. Josh
   * photographed one of them as thin bars floating in a passage.
   *
   * Rooms are already excluded when the slot is chosen (a beat may not stand on
   * a room's floor at all), so this is specifically the corridor-to-corridor
   * case, and it is asked the same way the audit asked it: step INTO the wall
   * and see whether you are standing on floor.
   */
  const stoneBehind = (x: number, z: number, rotY: number): boolean => {
    const bx = x - Math.sin(rotY) * WALL_PROBE;
    const bz = z - Math.cos(rotY) * WALL_PROBE;
    return !corridors.some((c) =>
      Math.abs(bx - c.rect.x) <= c.rect.w / 2 && Math.abs(bz - c.rect.z) <= c.rect.d / 2)
      && !roomFloors.some((poly) => pointInPoly(poly, bx, bz));
  };
  const out: PropSpec[] = [];
  for (const c of corridors) {
    const section = corridorType(c.corridorType);
    const alongX = c.rect.w >= c.rect.d;
    const runLen = alongX ? c.rect.w : c.rect.d;
    const halfWidth = (alongX ? c.rect.d : c.rect.w) / 2;

    // A leg with no middle left after the doorways is all doorway.
    const usable = runLen - 2 * END_CLEAR;
    if (usable < 1.0) continue;

    // ROUND, not floor. A p50 passage has 3.5m of middle against a 3.2m
    // spacing; flooring that is zero, and the first pass shipped exactly that —
    // three beats a floor, one every 19 metres, which is barely distinguishable
    // from the empty corridors this file was written about.
    const spacing = SPACING[section.intent];
    const slots = Math.max(1, Math.round(usable / spacing));

    // Eligibility, computed once per corridor. See the header: the width test
    // is arithmetic against the same floor the widths themselves are solved
    // from, never a hand-kept list.
    const open = CORRIDOR_BEATS.filter((b) =>
      b.intents.includes(section.intent)
      && section.width - b.footprint >= MIN_WALKABLE_WIDTH
      && c.height >= (b.minHeight ?? 0));
    if (!open.length) continue;

    const runStart = (alongX ? c.rect.x - c.rect.w / 2 : c.rect.z - c.rect.d / 2) + END_CLEAR;
    const lateral = alongX ? c.rect.z : c.rect.x;

    for (let i = 0; i < slots; i++) {
      // Jittered inside the slot rather than laid on a grid — a corridor strewn
      // at a perfect interval reads as a corridor somebody decorated.
      const t = runStart + (i + 0.15 + rand() * 0.7) * spacing;
      const beat = pick(open, rand);
      if (!beat) continue;

      // Which side. A wall beat has to pick one; a floor beat that eats width
      // hugs one; a flat floor beat drifts around the centre line.
      const side = rand() < 0.5 ? -1 : 1;
      let off: number;
      if (beat.mount === 'wall') {
        off = side * (halfWidth - 0.02);
      } else if (beat.footprint > 0) {
        off = side * (halfWidth - beat.footprint / 2 - WALL_GAP);
      } else {
        off = (rand() - 0.5) * halfWidth;
      }

      const x = alongX ? t : lateral + off;
      const z = alongX ? lateral + off : t;
      if (doorways.some((d) => Math.hypot(x - d.x, z - d.z) < DOOR_CLEAR)) continue;
      if (roomFloors.some((poly) => pointInPoly(poly, x, z))) continue;
      const rotY = rotFor(beat, alongX, side, rand);
      if (beat.mount === 'wall' && !stoneBehind(x, z, rotY)) continue;

      out.push({
        kind: 'model',
        model: beat.model,
        x, y: beat.mount === 'wall' ? sampleY(beat, rand) : 0, z,
        rotY,
        _dbg: `corridor-${beat.id}`,
      } as PropSpec);
    }
  }
  return out;
}

function sampleY(beat: CorridorBeat, rand: () => number): number {
  const [lo, hi] = beat.y ?? [1.1, 1.6];
  return lo + rand() * (hi - lo);
}

/**
 * Which way the beat faces.
 *
 * A model's front is its local +Z, and a Y-rotation of θ sends that to
 * (sin θ, cos θ) — so the angle that takes a wall's outward normal is
 * `atan2(nx, nz)`, which is what wall-surfaces.ts computes for a room. The four
 * cardinals fall out of it: N→0, S→π, W→+π/2, E→−π/2.
 *
 * Worth spelling out because the two signs on the X walls are exactly the pair
 * that got swapped in the room clutter placer, where a wall decal ends up
 * facing into the stone and is therefore invisible rather than obviously wrong.
 */
function rotFor(
  beat: CorridorBeat, alongX: boolean, side: number, rand: () => number,
): number {
  if (beat.mount === 'wall') {
    // The wall is on `side`; its normal points back toward the centre line.
    const nx = alongX ? 0 : -side;
    const nz = alongX ? -side : 0;
    return Math.atan2(nx, nz);
  }
  // A floor beat laid along the run points either way down it — the direction
  // is the story, so it is a coin flip, not a constant.
  if (beat.alongRun) return (alongX ? Math.PI / 2 : 0) + (rand() < 0.5 ? 0 : Math.PI);
  return rand() * Math.PI * 2;
}

function pick(beats: readonly CorridorBeat[], rand: () => number): CorridorBeat | null {
  const total = beats.reduce((s, b) => s + b.weight, 0);
  let roll = rand() * total;
  for (const b of beats) { roll -= b.weight; if (roll <= 0) return b; }
  return beats[beats.length - 1] ?? null;
}
