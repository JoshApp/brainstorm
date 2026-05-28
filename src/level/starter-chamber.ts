import type { LevelSpec } from './types';
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';

// Starter chamber — the first room of EVERY fresh run. Three altars,
// one weapon each. The player picks one (which auto-equips and
// dismisses the other two offers) and only then can the stairs at
// the back be descended.
//
// Layout note (matters for stair body): the stair descends INTO the
// back wall over STAIRWELL_TOTAL_DEPTH (~2.56m) along its rotY
// direction. The stair TOP must sit at least that far in front of
// the back wall or the body buries into the wall mesh. The hand-
// authored placement below leaves ~0.9m clearance.

const STARTER_FLOOR_GLOW = floorGlow(0x6c5c40);

export function buildStarterChamber(nextLevelId: string): LevelSpec {
  return {
    id: 'starter',
    depth: 0,
    displayName: 'choose the thing you will die with',
    fogColor: 0x14100a,

    // Player enters at the south end facing north (-Z) toward the
    // three altars. Room is 8 × 14m so the stair body has room to
    // extend without burying into the back wall.
    startPos: { x: 0, z: 5.5, yaw: 0 },

    rooms: [
      {
        id: 'antechamber',
        rect: { x: 0, z: 0, w: 8, d: 14 },
        height: 2.8,
      },
    ],
    corridors: [],

    props: [
      // ── THREE STARTER ALTARS ──────────────────────────────────────
      // Centered front-to-back; needle / sword / maul left to right.
      { kind: 'starter-altar', x: -2.4, z: 0.0, rotY: 0, weaponId: 'bone-needle' },
      { kind: 'starter-altar', x:  0.0, z: 0.0, rotY: 0, weaponId: 'rusted-sword' },
      { kind: 'starter-altar', x:  2.4, z: 0.0, rotY: 0, weaponId: 'iron-maul' },

      // Floor candles in FRONT of each altar (player's approach side) —
      // warm halo per offering.
      { kind: 'model', model: FLOOR_CANDLE, x: -2.4, y: 0, z: 1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x:  0.0, y: 0, z: 1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x:  2.4, y: 0, z: 1.0 },

      // Mid-chamber floor glow near the stairs but offset so it doesn't
      // sit under the stair body / parapet.
      { kind: 'model', model: STARTER_FLOOR_GLOW, x: 0, y: 0, z: -2.0 },

      // ── DIEGETIC HINTS ───────────────────────────────────────────
      {
        kind: 'hint',
        x: 0, z: 4.0,
        text: 'pick. the dark is patient. you are not.',
        triggerRadius: 3.0,
        lingerMs: 5000,
      },
      {
        kind: 'hint',
        x: 0, z: -2.5,
        text: 'the way down will not open empty-handed.',
        triggerRadius: 2.4,
        lingerMs: 4000,
      },
    ],

    torches: [
      // Two entry sconces at the spawn end (south).
      { x: -3.95, z: 4.5, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.90 },
      { x:  3.95, z: 4.5, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.90 },
      // Cool sconces flanking the altars — "ritual / chamber" feel.
      { x: -3.95, z: -0.5, height: 2.0, wall: 'W', colorTint: 0xc8c0e0, intensityMul: 0.70 },
      { x:  3.95, z: -0.5, height: 2.0, wall: 'E', colorTint: 0xc8c0e0, intensityMul: 0.70 },
      // Stairs torch — cool moonlight blue, side-mounted so it doesn't
      // clash with the stair's own moonbeam halo.
      { x: -3.95, z: -3.5, height: 1.8, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.75 },
    ],

    // No mobs. The starter chamber is the choice, not the test.
    spawns: [],

    doors: [],

    stairs: [
      {
        id: 'starter-stairs',
        // Stair top z=-3.5; rotY=Math.PI descends INTO -Z (north wall).
        // Body extends STAIRWELL_TOTAL_DEPTH (~2.56m) from the top to
        // z=-6.06, leaving ~0.9m clearance to the back wall at z=-7.
        x: 0, z: -3.5,
        rotY: Math.PI,
        targetLevel: nextLevelId,
        // SEALED until the player equips a weapon at one of the
        // altars. stairs.ts re-checks the predicate every tick.
        unlock: { kind: 'has-equipment', slot: 'weapon' },
      },
    ],
  };
}
