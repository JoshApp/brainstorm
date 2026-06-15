import type { LevelSpec } from './types';
import { emitArchwaysForCorridors } from './clutter';
import { FLOOR_CANDLE } from '../content/candle';
import { GREAT_BRAZIER, IRON_BRAZIER } from '../content/light-props';

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
  /** Override all four wall torches to this tint (mood) — e.g. the Marrow
   *  Sovereign's charnel-red hall. Unset = the default warm sconces. */
  torchTint?: number,
  /** Override the floor fog colour — the atmospheric wash. Pairs with
   *  torchTint for a fully mood-lit chamber. Unset = the default. */
  fogColor?: number,
): LevelSpec {
  const w = cols - 2;
  const d = rows - 2;
  const filled = innerFill();
  return {
    id: `test-${id}`,
    depth: 0,
    displayName,
    fogColor: fogColor ?? 0x14100a,
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
      { x: -(w / 2 + 0.05), z: -(d / 2) + 1.0, height: 2.0, wall: 'W', colorTint: torchTint ?? 0xffaa55, intensityMul: 0.9 },
      { x:  (w / 2 + 0.05), z: -(d / 2) + 1.0, height: 2.0, wall: 'E', colorTint: torchTint ?? 0xffaa55, intensityMul: 0.9 },
      { x: -(w / 2 + 0.05), z:  (d / 2) - 1.0, height: 2.0, wall: 'W', colorTint: torchTint ?? 0xc8a060, intensityMul: 0.7 },
      { x:  (w / 2 + 0.05), z:  (d / 2) - 1.0, height: 2.0, wall: 'E', colorTint: torchTint ?? 0xc8a060, intensityMul: 0.7 },
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
        // Silver chest at the deep end of the arena — the reward for
        // committing to the slam.
        { kind: 'chest', x: 0, z: -4.5, facing: { kind: 'wall-away' }, tier: 'silver' },
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

// ── Marrow Sovereign — two-phase skeleton boss. 20×22 hall lit
// charnel-RED (torches + bloodlit fog + braziers ringing the boss),
// so the pale bones read as something dredged from a slaughterhouse.
// The braziers are moodTintable — they ADAPT to the red torch palette,
// so their flame + light glow red without hand-tinting. Without close
// braziers the player's white hand-lamp washes the boss bone-white;
// these give the arena strong red light near him. Dormant on spawn;
// wakes when the player crosses the fog wall.
function buildMarrowSovereign(): LevelSpec {
  // Tall ceiling — the Sovereign towers to ~5m and his greatscythe sweeps
  // to ~7m; a 3.2m test ceiling decapitated the arena. 11m gives the
  // cathedral-of-bone headroom the silhouette needs to read.
  return smallChamber('marrow-sovereign', 'marrow sovereign', 20, 22, () => ({
    spawns: [
      { enemyId: 'marrow-sovereign', x: 0, z: -7, roomId: 'test-marrow-sovereign-room', dormant: true },
    ],
    props: [
      {
        kind: 'hint',
        x: 0, z: 7,
        text: 'break the legs first. then he crawls.',
        triggerRadius: 3.0,
        lingerMs: 5000,
      },
      // Fog wall at the south end. Marrow-red tint matches the
      // sovereign's ribcage glow — reads which boss is on the other
      // side from a distance.
      { kind: 'boss-mist', x: 0, z: 4, rotY: Math.PI, color: 0xff6030 },
      // Braziers RINGING the boss (centre is too far from the wall
      // torches). moodTintable → they adapt to the red torch palette and
      // glow charnel-red, washing the bones in dread instead of leaving
      // them to the white hand-lamp. Placed to the sides (x=±5) so they
      // flank the fight without blocking the central lane.
      { kind: 'model', model: IRON_BRAZIER, x: -5, y: 0, z: -4.5 },
      { kind: 'model', model: IRON_BRAZIER, x:  5, y: 0, z: -4.5 },
      { kind: 'model', model: IRON_BRAZIER, x: -5, y: 0, z: -8.5 },
      { kind: 'model', model: IRON_BRAZIER, x:  5, y: 0, z: -8.5 },
    ],
  }), 11, 0xff4a26, 0x140806);   // charnel-red hall — red torches + bloodlit fog
}

// ── Boiling King — Act I boss in a wide arena. Sized to match
// boss-hall (~18×16 walkable) so the king's 8m leap actually has
// room to commit. Player spawns at the south end, king at the
// north end so the first leap reads as "across the whole room."
function buildBoilingKing(): LevelSpec {
  return smallChamber('boiling-king', 'boiling king', 20, 22, () => ({
    spawns: [
      // King well to the north so the first leap reads as "across
      // the room", dormant until the fog wall is crossed. Test
      // chamber mirrors the production boss-floor behaviour
      // (procgen B-tile spawns are also dormant + woken on cross).
      { enemyId: 'boiling-king', x: 0, z: -7, roomId: 'test-boiling-king-room', dormant: true },
    ],
    // Threshold wall at z=5 with a 3.4m doorway — the player spawns in the
    // entry strip (south, z≈8) and the arena is north of it. These full-height
    // flanking walls give the doorway its COLLISION (you can't walk around the
    // gate); the gate fitting itself now builds the stone doorframe + lintel
    // fill, so no hand-authored lintel is needed any more.
    extraWalls: [
      { ax: -10, az: 5, bx: -1.7, bz: 5, height: 10.0 },
      { ax:  1.7, az: 5, bx:  10, bz: 5, height: 10.0 },
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
      { kind: 'boss-mist', x: 0, z: 5, rotY: Math.PI, color: 0x8aff44, width: 3.4 },
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

// ── Elevation lab — the verticality probe ───────────────────────────
// Two flat rooms 1.4m apart joined by a sloped corridor. Exercises every
// elevation seam at once: camera ground-sampling down the ramp, walls/
// ceiling/trim at offset, torch + fill-light heights, enemy ground
// follow (the ghoul lives in the LOW room and chases up the ramp),
// chest + vase + loot drops on the low plateau. If something floats or
// sinks, this room is where it shows.
export function buildElevationLab(): LevelSpec {
  const spec: LevelSpec = {
    id: 'test-elevation',
    depth: 0,
    displayName: 'elevation lab',
    fogColor: 0x14100a,
    startPos: { x: 0, z: 7, yaw: 0 },   // high room, facing the descent
    rooms: [
      { id: 'elev-high', rect: { x: 0, z: 5, w: 7, d: 7 }, height: TEST_HEIGHT, elevation: 0 },
      { id: 'elev-low', rect: { x: 0, z: -7, w: 8, d: 8 }, height: TEST_HEIGHT, elevation: -1.4 },
    ],
    corridors: [
      // 1.4m drop over a 4.5m run ≈ 17° average grade — the stair-run
      // sweet spot (the first 3m version hit ~36° and read as a slide).
      { id: 'elev-ramp', rect: { x: 0, z: -0.75, w: 2, d: 4.5 }, height: 2.8 },
    ],
    props: [
      { kind: 'chest', x: -2.2, z: -8.5, rotY: 0, facing: { kind: 'wall-away' } },
      { kind: 'vase-cluster', x: 2.4, z: -7.5 },
      { kind: 'vase', x: 2.6, z: 5.5 },
    ],
    torches: [
      { x: -3.55, z: 4.0, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.9 },
      { x: 3.55, z: 4.0, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.9 },
      { x: -4.05, z: -6.0, height: 2.0, wall: 'W', colorTint: 0xc8a060, intensityMul: 0.9 },
      { x: 4.05, z: -8.0, height: 2.0, wall: 'E', colorTint: 0xc8a060, intensityMul: 0.9 },
    ],
    spawns: [
      { enemyId: 'ghoul', x: 0, z: -8.5 },
    ],
    doors: [],
    extraWalls: [],
    stairs: [],
  };
  // Same corridor-mouth gates procgen emits — the ramp is tested WITH its
  // frames (lintel capped to the corridor height, jambs on the thresholds).
  emitArchwaysForCorridors(spec);
  return spec;
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
    id: 'elevation',
    name: 'Elevation Lab',
    description: 'Walk the ramp down. The ghoul below walks it up. Nothing should float.',
    build: buildElevationLab,
    loadout: { weapon: 'rusted-sword', offhand: 'oil-lamp' },
  },
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
    id: 'marrow-sovereign',
    name: 'Marrow Sovereign',
    description: 'Two-phase skeleton. Break the legs first — then he crawls.',
    build: buildMarrowSovereign,
    loadout: {
      weapon: 'scimitar',
      offhand: 'oil-lamp',
      consumables: ['healing-potion', 'healing-potion', 'healing-potion'],
    },
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
