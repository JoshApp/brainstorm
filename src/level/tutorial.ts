import type { LevelSpec } from './types';
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';
import { ALTAR_SKULL } from '../content/relics';
import { ITEMS } from '../content/items';

// Tutorial — the first time a player ever runs DELVE, they descend
// into this small chamber BEFORE the real dungeon. The goal is to
// teach movement, look, attack, and pickup WITHOUT any popup-style
// "press SPACE to attack" prompts. Everything is diegetic: two
// corpses with one-line notes set the voice and signpost the loop;
// a single stationary trash mob is the first practice strike; a
// healing potion glows on the floor to teach the magnetic pickup;
// stairs at the far end descend into LEVEL_1.
//
// Returning players (CONTINUE save, or having beaten a run) bypass
// this room — see start-screen.ts. Even a first-time player can
// blast through in 10 seconds by walking straight to the stairs,
// so it's not a wall.

const TUTORIAL_FLOOR_GLOW = floorGlow(0x6c5c40);

export const TUTORIAL: LevelSpec = {
  id: 'tutorial',
  // Depth 0 — modifiers + scaling treat this as the gentlest possible
  // floor. The single mob already has 1 HP baseline so even multipliers
  // can't make it dangerous.
  depth: 0,
  displayName: 'Before the first step',
  // Slightly warmer fog than LEVEL_1 — reads as "ante-chamber," not yet
  // the deep dark.
  fogColor: 0x14100a,

  // Player enters at the south end of a long narrow chamber, facing
  // north (-Z) toward the stairs at the far end. yaw=0 leaves the
  // camera's default-forward (-Z) untouched, so the descent is dead
  // ahead on first frame.
  startPos: { x: 0, z: 5.5, yaw: 0 },

  rooms: [
    {
      id: 'antechamber',
      // 4m wide × 14m long. Long enough that the corpse notes and the
      // training mob feel SPACED, not stacked on top of each other.
      rect: { x: 0, z: 0, w: 4, d: 14 },
      height: 2.8,
    },
  ],
  corridors: [],

  props: [
    // ── FIRST CORPSE — just past the entrance (south end). Sets the
    // voice and hints at the input scheme without spelling it out.
    {
      kind: 'corpse',
      x: -1.0, z: 4.0,
      rotY: 0.4,
      note: 'I came down on my own legs.\nSo will you.\nKeep them moving.',
    },

    // Centre of the room — the altar from the ritual chamber gets
    // echoed here as a small skull-on-stone, but ARRANGED OFF-AXIS so
    // it doesn't block the lane. Pure atmosphere.
    {
      kind: 'model',
      model: ALTAR_SKULL,
      x: 1.4, y: 0.0, z: 1.5,
      rotY: -0.3,
    },

    // A spike trap mid-room — teaches "look at the floor" without a
    // popup. It telegraphs (plate sinks) BEFORE springing, so a
    // careful first-timer doesn't get hit; a reckless one does. Soft
    // teaching by consequence.
    {
      kind: 'spike-trap',
      x: 0, z: 0,
      damage: 1,
      telegraphTime: 1.2,
    },

    // ── SECOND CORPSE — past the trap, near the training mob.
    {
      kind: 'corpse',
      x:  1.2, z: -3.5,
      rotY: -0.6,
      note: 'It does not learn.\nStrike anyway.\nThe next one will.',
    },

    // Centre floor glow at the far end — guides the eye toward the
    // exit stairs (visible from across the room thanks to the moonbeam).
    { kind: 'model', model: TUTORIAL_FLOOR_GLOW, x: 0, y: 0, z: -6.0 },

    // Floor candles flanking the descent — same idiom as the safe room
    // and LEVEL_1 stairwell. Warm light at the egress so the player's
    // eye is drawn there once the mob is dealt with.
    { kind: 'model', model: FLOOR_CANDLE, x: -0.9, y: 0, z: -5.5 },
    { kind: 'model', model: FLOOR_CANDLE, x:  0.9, y: 0, z: -5.5 },

    // ── DIEGETIC TUTORIAL HINTS — italic in-world text that fades in
    // as the player nears each beat. Tonal slot is "previous delver's
    // marginalia": short, lowercase, world-voiced. Each hint that
    // teaches an ACTION dismisses the moment the player performs it
    // (attack, pickup) so it feels responsive rather than scripted.
    {
      kind: 'hint',
      x: 0, z: 4.6,   // just past the spawn, before the entry corpse
      text: 'step. it is the only verb you have.',
      triggerRadius: 2.8,
    },
    {
      kind: 'hint',
      x: 0, z: 0.6,   // approaching the spike-trap plate
      text: 'look down. the floor is not always patient.',
      triggerRadius: 2.2,
      lingerMs: 3500,
    },
    {
      kind: 'hint',
      x: 0.4, z: -1.0,  // a step before the rat / chest area
      text: 'strike. it will not strike back forever.',
      triggerRadius: 2.4,
      dismissOn: 'enemy:killed',
    },
    {
      kind: 'hint',
      x: -1.4, z: -1.4,  // hovering above the chest with the potion
      text: 'take what fell. the dead will not.',
      triggerRadius: 2.0,
      dismissOn: 'item:picked-up',
    },
    {
      kind: 'hint',
      x: 0, z: -4.6,  // approaching the stairs
      text: 'down. always down.',
      triggerRadius: 2.6,
      lingerMs: 6000,
    },

    // ── HEALING POTION ON THE FLOOR — teaches the magnetic pickup.
    // Placed slightly off the centre-line so the player has to step
    // toward it; combined with the absorb radius, walking near triggers
    // the vacuum. After this the player has felt the pickup mechanic.
    // (Implemented as a chest because we don't have a "free-floating
    // item on the floor" prop kind yet — opens immediately to drop the
    // potion as a pickup that homes to the player.)
    {
      kind: 'chest',
      x: -1.4, z: -1.8,
      rotY: 0.8,
      loot: ITEMS['healing-potion'],
    },
  ],

  torches: [
    // Two wall sconces at the spawn end — entrance lit.
    { x: -1.95, z: 5.0, height: 2.0, wall: 'W', colorTint: 0xffaa55, intensityMul: 0.95 },
    { x:  1.95, z: 5.0, height: 2.0, wall: 'E', colorTint: 0xffaa55, intensityMul: 0.95 },
    // Dim torch at the trap row — partial visibility there sells the
    // "look carefully" beat.
    { x:  1.95, z: 0.0, height: 1.9, wall: 'E', colorTint: 0xddc090, intensityMul: 0.55 },
    // Stairs torch — cool blue accent, matches the descent palette of
    // the rest of the dungeon's stairwells.
    { x: -1.95, z: -5.5, height: 1.8, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.8 },
  ],

  // ONE training mob — a rat. 1 HP, fragile, slow. Even a bare-handed
  // tap kills it. Functions as a target dummy that also moves enough
  // to teach "things in the dungeon come at you." If the player runs
  // past, the rat won't follow far (perception ranges are short).
  spawns: [
    { enemyId: 'rat', x: 0.4, z: -2.0, roomId: 'antechamber' },
  ],

  doors: [],

  stairs: [
    {
      id: 'stairs-tutorial-down',
      // North end, descending into the back wall. After this, the
      // player lands in LEVEL_1 — the actual dungeon begins.
      x: 0, z: -5.8,
      rotY: Math.PI,    // descend NORTH (into -Z, the back wall)
      targetLevel: 'depth-1',
    },
  ],
};
