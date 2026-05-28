import type { LevelSpec } from './types';
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';

// Starter chamber — the first room of EVERY fresh run. Three altars,
// one weapon each. The player picks one (which auto-equips and
// dismisses the other two offers) and only then can the stairs at
// the back be descended.
//
// Design intent: this is the diegetic alternative to a card picker.
// Walking past the rejected weapons commits the choice physically —
// you remember the room you picked the maul in. The stair-gate
// (has-weapon predicate) means the player CAN'T accidentally skip
// the decision; they have to walk to an altar and take.
//
// First-time players land in the tutorial next (their fresh run also
// teaches movement). Returning players go straight to depth-1.

const STARTER_FLOOR_GLOW = floorGlow(0x6c5c40);

export function buildStarterChamber(nextLevelId: string): LevelSpec {
  return {
    id: 'starter',
    depth: 0,
    displayName: 'choose the thing you will die with',
    fogColor: 0x14100a,

    // Player enters at the south end facing north (-Z) toward the
    // three altars. yaw=0 leaves the camera's default-forward (-Z)
    // untouched — altars dead ahead on first frame.
    startPos: { x: 0, z: 3.5, yaw: 0 },

    rooms: [
      {
        id: 'antechamber',
        // 8m wide × 10m long. Wide enough that the three altars feel
        // separated, not stacked; long enough that the stairs at the
        // back read as a real onward direction once you've picked.
        rect: { x: 0, z: 0, w: 8, d: 10 },
        height: 2.8,
      },
    ],
    corridors: [],

    props: [
      // ── THREE STARTER ALTARS ──────────────────────────────────────
      // Arrayed across the back, left to right: needle → sword → maul.
      // Reading order suggests playstyle continuum (precise → balanced
      // → heavy). Spacing tuned so each silhouette gets its own dark
      // around it.
      { kind: 'starter-altar', x: -2.4, z: -1.5, rotY: 0,   weaponId: 'bone-needle' },
      { kind: 'starter-altar', x:  0.0, z: -1.5, rotY: 0,   weaponId: 'rusted-sword' },
      { kind: 'starter-altar', x:  2.4, z: -1.5, rotY: 0,   weaponId: 'iron-maul' },

      // Centre floor glow at the back end — guides the eye toward the
      // sealed stairs behind the altars. Once the player picks, the
      // glow + the moonbeam from the unsealed stairs converge.
      { kind: 'model', model: STARTER_FLOOR_GLOW, x: 0, y: 0, z: -3.0 },

      // Floor candles flanking each altar — three soft warm halos
      // across the back row, one per offering.
      { kind: 'model', model: FLOOR_CANDLE, x: -2.4, y: 0, z: -0.4 },
      { kind: 'model', model: FLOOR_CANDLE, x:  0.0, y: 0, z: -0.4 },
      { kind: 'model', model: FLOOR_CANDLE, x:  2.4, y: 0, z: -0.4 },

      // ── DIEGETIC HINT — italic in-world line on the entry approach.
      // Voice matches the rest of the tutorial-chamber notes: previous
      // delver's marginalia, terse, lowercase.
      {
        kind: 'hint',
        x: 0, z: 2.5,
        text: 'pick. the dark is patient. you are not.',
        triggerRadius: 3.0,
        lingerMs: 5000,
      },
      // A second hint near the (sealed) stairs in case the player walks
      // straight there before picking. Dismissed once a weapon is
      // equipped — taking ANY weapon emits item:picked-up via the
      // starter altar's setSlot path.
      {
        kind: 'hint',
        x: 0, z: -3.4,
        text: 'the way down will not open empty-handed.',
        triggerRadius: 2.4,
        lingerMs: 4000,
      },
    ],

    torches: [
      // Two entry sconces at the spawn end (south).
      { x: -3.95, z: 3.0, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.90 },
      { x:  3.95, z: 3.0, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.90 },
      // Two sconces behind the altars (north corners), cooler so the
      // back of the room reads as "ritual / chamber" rather than
      // "warm hearth."
      { x: -3.95, z: -2.0, height: 2.0, wall: 'W', colorTint: 0xc8c0e0, intensityMul: 0.70 },
      { x:  3.95, z: -2.0, height: 2.0, wall: 'E', colorTint: 0xc8c0e0, intensityMul: 0.70 },
      // Stairs torch — cool moonlight blue, matches the descent
      // palette of every other stairwell.
      { x: -3.95, z: -4.4, height: 1.8, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.75 },
    ],

    // No mobs. The starter chamber is the choice, not the test.
    spawns: [],

    doors: [],

    stairs: [
      {
        id: 'starter-stairs',
        // Back centre, descending into the north wall.
        x: 0, z: -4.5,
        rotY: Math.PI,
        targetLevel: nextLevelId,
        // SEALED until the player equips a weapon at one of the
        // altars. Stairs.ts re-checks the predicate every tick and
        // flips the prompt the instant the slot is filled.
        unlock: { kind: 'has-equipment', slot: 'weapon' },
      },
    ],
  };
}
