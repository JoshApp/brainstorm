import type { LevelSpec } from './types';
import { FLOOR_CANDLE } from '../content/candle';
import { GREAT_BRAZIER } from '../content/light-props';

// Test chambers — small standalone levels reachable from the title
// screen for isolated feature testing. Each chamber spawns the player
// with a baseline loadout (rusted sword + oil lamp) into a small room
// that exercises ONE feature: the arena door, the blood altar, the
// ooze split, etc.
//
// Test chambers live OUTSIDE the run-state save flow — entering one
// doesn't touch the player's real save (see src/state/run-state-listeners.ts
// which skips persistence for level ids prefixed 'test-').
//
// Returning to the menu: Settings → Quit to Menu (the existing flow).
// The page reload re-boots into the title screen.

const TEST_HEIGHT = 3.2;

function smallChamber(
  id: string,
  displayName: string,
  rows: number,
  cols: number,
  innerFill: () => Partial<Pick<LevelSpec, 'props' | 'spawns' | 'doors' | 'extraWalls'>>,
  height: number = TEST_HEIGHT,
): LevelSpec {
  const w = cols - 2;
  const d = rows - 2;
  const filled = innerFill();
  return {
    id: `test-${id}`,
    depth: 0,
    displayName,
    fogColor: 0x14100a,
    // Player spawn near the south wall, facing north.
    startPos: { x: 0, z: d / 2 - 1, yaw: 0 },
    rooms: [
      {
        id: `test-${id}-room`,
        rect: { x: 0, z: 0, w, d },
        height,
      },
    ],
    corridors: [],
    props: filled.props ?? [],
    torches: [
      { x: -(w / 2 + 0.05), z: -(d / 2) + 1.0, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
      { x:  (w / 2 + 0.05), z: -(d / 2) + 1.0, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      { x: -(w / 2 + 0.05), z:  (d / 2) - 1.0, height: 2.0, wall: 'W', colorTint: 0xc8a060, intensityMul: 0.7 },
      { x:  (w / 2 + 0.05), z:  (d / 2) - 1.0, height: 2.0, wall: 'E', colorTint: 0xc8a060, intensityMul: 0.7 },
    ],
    spawns: filled.spawns ?? [],
    doors: filled.doors ?? [],
    extraWalls: filled.extraWalls ?? [],
    stairs: [],
  };
}

// ── Arena door — the interior-wall lock-on-enter test. The vault
// composer's spine corridor logic doesn't apply here (this is a
// standalone room), so the arena door is hand-placed as an interior
// wall segment + DoorSpec.
function buildArena(): LevelSpec {
  // 12×12 chamber. Coordinate sense (matches smallChamber + camera):
  //   yaw=0 faces -Z. Player spawns at +Z (south end), walks toward
  //   -Z (north). Arena (challenge area) is on the NEGATIVE-Z side.
  //
  // Interior wall at z = -1 with a 1m gap at x=0 for the door. The
  // arena room is at z < -1 (north of the wall, where the player is
  // heading). Mobs + chest live there. The hint sits in the south
  // alcove where the player approaches the door.
  const spec = smallChamber('arena', 'arena door', 12, 14, () => {
    const wallZ = -1;
    return {
      props: [
        // Iron chest at the deep end of the arena — the reward for
        // committing to the slam.
        { kind: 'chest', x: 0, z: -4.5, facing: { kind: 'wall-away' }, tier: 'iron' },
        {
          kind: 'hint',
          x: 0, z: 3.0,             // SOUTH side, where the player approaches
          text: 'cross the threshold. the door will not wait.',
          triggerRadius: 3.0,
          lingerMs: 4500,
        },
      ],
      spawns: [
        // Ghouls live INSIDE the arena (z < wallZ). Previously they
        // were authored at z = 2 — same side as the player spawn —
        // so crossing the door slammed onto an empty room.
        { enemyId: 'ghoul', x: -2.5, z: -2.5, roomId: 'test-arena-arena' },
        { enemyId: 'ghoul', x:  2.5, z: -2.5, roomId: 'test-arena-arena' },
      ],
      doors: [
        {
          id: 'test-arena-door',
          ax: -0.5, az: wallZ, bx: 0.5, bz: wallZ,
          height: 2.6,
          hinge: 'a',
          swingDir: 1,
          unlock: { kind: 'arena', roomIds: ['test-arena-arena'] },
        },
      ],
      // Interior wall — two segments west and east of the 1m door gap.
      extraWalls: [
        { ax: -6, az: wallZ, bx: -0.5, bz: wallZ, height: TEST_HEIGHT },
        { ax:  0.5, az: wallZ, bx:  6, bz: wallZ, height: TEST_HEIGHT },
      ],
    };
  });
  // Add the arena sub-room (logical-only) — the NORTH half of the
  // chamber, where the mobs spawn. room:cleared fires for this id
  // when both ghouls die, which is what unlocks the door.
  spec.rooms.push({
    id: 'test-arena-arena',
    rect: { x: 0, z: -3.5, w: 12, d: 5 },
    height: TEST_HEIGHT,
    logicalOnly: true,
  });
  return spec;
}

// ── Blood altar — single offering, 4 HP cost, can kill at low HP.
function buildBloodAltar(): LevelSpec {
  return smallChamber('blood-altar', 'blood altar', 10, 10, () => ({
    props: [
      { kind: 'blood-altar', x: 0, z: 0, rotY: 0, itemId: 'ring-of-marrow' },
      {
        kind: 'hint',
        x: 0, z: 2.5,
        text: 'the price is in marrow.',
        triggerRadius: 3.0,
        lingerMs: 4000,
      },
      { kind: 'model', model: FLOOR_CANDLE, x: -1.4, y: 0, z: -0.8 },
      { kind: 'model', model: FLOOR_CANDLE, x:  1.4, y: 0, z: -0.8 },
    ],
  }));
}

// ── Ooze — single parent ooze. Kill it, see the split.
function buildOoze(): LevelSpec {
  return smallChamber('ooze', 'ooze split', 10, 10, () => ({
    spawns: [
      { enemyId: 'ooze', x: 0, z: -1, roomId: 'test-ooze-room' },
    ],
    props: [
      {
        kind: 'hint',
        x: 0, z: 2.5,
        text: 'one becomes two. catch them in one swing.',
        triggerRadius: 3.0,
        lingerMs: 4500,
      },
    ],
  }));
}

// ── Stoneguard — one tank + a chest behind. Tests the windup-and-punish
// rhythm against a high-HP armoured enemy.
function buildStoneguard(): LevelSpec {
  return smallChamber('stoneguard', 'stoneguard', 12, 10, () => ({
    spawns: [
      { enemyId: 'stoneguard', x: 0, z: -1, roomId: 'test-stoneguard-room' },
    ],
    props: [
      { kind: 'chest', x: 0, z: -4, facing: { kind: 'wall-away' } },
      {
        kind: 'hint',
        x: 0, z: 3.0,
        text: 'wait for the wind-up. punish the recovery.',
        triggerRadius: 3.0,
        lingerMs: 4500,
      },
    ],
  }));
}

// ── Starter altars — same loadout choice the real game opens with,
// useful for testing the picker / item models / equipment swap flow.
function buildStarterAltars(): LevelSpec {
  return smallChamber('starter-altars', 'starter altars', 10, 12, () => ({
    props: [
      { kind: 'starter-altar', x: -2.4, z: 0, rotY: 0, weaponId: 'bone-needle' },
      { kind: 'starter-altar', x:  0.0, z: 0, rotY: 0, weaponId: 'rusted-sword' },
      { kind: 'starter-altar', x:  2.4, z: 0, rotY: 0, weaponId: 'iron-maul' },
      {
        kind: 'hint',
        x: 0, z: 2.8,
        text: 'pick one. stairs do not figure into this room.',
        triggerRadius: 3.0,
        lingerMs: 4500,
      },
    ],
  }));
}

// ── Boiling King — Act I boss in a wide arena. Sized to match
// boss-hall (~18×16 walkable) so the king's 8m leap actually has
// room to commit. Player spawns at the south end, king at the
// north end so the first leap reads as "across the whole room."
function buildBoilingKing(): LevelSpec {
  return smallChamber('boiling-king', 'boiling king', 20, 22, () => ({
    spawns: [
      // King well to the north so the first leap reads as "across the room".
      { enemyId: 'boiling-king', x: 0, z: -7, roomId: 'test-boiling-king-room' },
    ],
    // Threshold wall at z=5 with a 3.4m doorway — the player spawns in the
    // entry strip (south, z≈8) and the arena is north of it. The fog gate
    // fills the doorway, so the seal actually seals (you can't walk around
    // it) and it reads as a real soulslike fog gate, not a panel mid-room.
    // Flanking walls run FULL room height; a lintel caps the opening so the
    // door is framed (no empty slot to the ceiling above the mist).
    extraWalls: [
      { ax: -10, az: 5, bx: -1.7, bz: 5, height: 10.0 },
      { ax:  1.7, az: 5, bx:  10, bz: 5, height: 10.0 },
      // Lintel: visual-only cap above the 4.6m door opening (no collision).
      { ax: -1.7, az: 5, bx:  1.7, bz: 5, height: 5.4, baseY: 4.6 },
    ],
    props: [
      // Free-standing braziers ringing the centre so the floor under
      // the fight is actually lit — wall torches alone leave a 20m
      // arena's middle pitch black. Mirrors boss-hall's atmosphere.
      { kind: 'model', model: GREAT_BRAZIER, x: -5, y: 0, z: -3 },
      { kind: 'model', model: GREAT_BRAZIER, x:  5, y: 0, z: -3 },
      { kind: 'model', model: GREAT_BRAZIER, x: -5, y: 0, z:  3 },
      { kind: 'model', model: GREAT_BRAZIER, x:  5, y: 0, z:  3 },
      {
        // In the entry strip, south of the gate — advice before you commit.
        kind: 'hint',
        x: 0, z: 7,
        text: 'it has eaten kings. step OFF the marker.',
        triggerRadius: 3.0,
        lingerMs: 5000,
      },
      // Soulslike fog GATE in the doorway. Walk up, INTERACT to enter; it
      // seals behind you once you cross and lifts when the boss encounter
      // (king + all spawns) is done. King's signature acid-green tint.
      { kind: 'boss-mist', x: 0, z: 5, rotY: Math.PI, color: 0x8aff44, width: 3.4, height: 4.6 },
    ],
  }), 10.0);   // tall ceiling — the king is huge + leaps ~4m; a 3.2m roof clips it
}

// ── Dummy — empty room. Baseline for camera / movement / lighting
// comparisons against the feature chambers.
function buildDummy(): LevelSpec {
  return smallChamber('dummy', 'empty chamber', 10, 10, () => ({
    props: [
      {
        kind: 'hint',
        x: 0, z: 2.5,
        text: 'a control. nothing happens here.',
        triggerRadius: 3.0,
        lingerMs: 3500,
      },
    ],
  }));
}

export interface TestChamber {
  id: string;
  name: string;
  description: string;
  build: () => LevelSpec;
  /** Force-equip these items before entering. Defaults to a rusted
   *  sword so the player has something to swing with. Consumables
   *  go into the hotbar so a boss-test chamber can hand the player
   *  potions without spawning chest props. */
  loadout?: { weapon?: string; offhand?: string; consumables?: string[] };
}

export const TEST_CHAMBERS: TestChamber[] = [
  {
    id: 'arena',
    name: 'Arena Door',
    description: 'Walk through the door — it slams. Kill both ghouls — it reopens.',
    build: buildArena,
    loadout: { weapon: 'rusted-sword', offhand: 'oil-lamp' },
  },
  {
    id: 'blood-altar',
    name: 'Blood Altar',
    description: 'Take the offering. It costs 4 HP. At low HP it kills you.',
    build: buildBloodAltar,
    loadout: { weapon: 'rusted-sword', offhand: 'oil-lamp' },
  },
  {
    id: 'ooze',
    name: 'Ooze Split',
    description: 'Kill the parent. It becomes two smaller oozes you also have to kill.',
    build: buildOoze,
    loadout: { weapon: 'rusted-sword', offhand: 'oil-lamp' },
  },
  {
    id: 'stoneguard',
    name: 'Stoneguard',
    description: 'Slow, armoured, big windup, big punish. Read the telegraph.',
    build: buildStoneguard,
    loadout: { weapon: 'iron-maul', offhand: 'oil-lamp' },
  },
  {
    id: 'boiling-king',
    name: 'Boiling King',
    description: 'Act I boss. He leaps, lands hard, and sticks you if you stand in the slime.',
    build: buildBoilingKing,
    // Give the player something with reach + a couple of potions
    // so the fight is winnable on a first try.
    loadout: {
      weapon: 'scimitar',
      offhand: 'oil-lamp',
      // Three potions for the fight — generous enough that a first-try
      // attempt isn't gated on perfect dodging.
      consumables: ['healing-potion', 'healing-potion', 'healing-potion'],
    },
  },
  {
    id: 'starter-altars',
    name: 'Starter Altars',
    description: 'Three weapon offerings — same picker the real run opens with.',
    build: buildStarterAltars,
    loadout: { offhand: 'oil-lamp' },
  },
  {
    id: 'dummy',
    name: 'Empty Chamber',
    description: 'A control. Useful for movement / lighting comparisons.',
    build: buildDummy,
    loadout: { weapon: 'rusted-sword', offhand: 'oil-lamp' },
  },
];

export function findTestChamber(id: string): TestChamber | undefined {
  return TEST_CHAMBERS.find((c) => c.id === id);
}
