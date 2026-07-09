import type { LevelSpec } from './types';
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';
import { BONFIRE } from '../content/bonfire';
import { ALTAR_SKULL } from '../content/relics';
import { ITEMS } from '../content/items';

// Tutorial — the first descent. The player WAKES SEATED AT A BONFIRE
// in near-darkness (the arrival rig plays here like on every floor),
// with the fire offering TEND — the wick ritual, which is both the
// onboarding calibration (set your floor of visibility for THIS room,
// THIS phone, THIS light) and the first verb the dungeon teaches:
// your lamp is the only honest light down here.
//
// Everything after stays diegetic — no "press X" popups. Marginalia
// hints fade in per beat and dismiss when the action is performed;
// corpse notes set the voice; one fragile rat is the first strike;
// a chest potion teaches the magnetic pickup; the stairs descend.
//
// Returning players (CONTINUE save, or a finished run) bypass this
// floor — see start-screen.ts. A first-timer can still walk straight
// to the stairs in 15 seconds; nothing here is a wall.

const TUTORIAL_FLOOR_GLOW = floorGlow(0x6c5c40);

export const TUTORIAL: LevelSpec = {
  id: 'tutorial',
  // Depth 0 — gentlest possible floor; the single mob has 1 HP.
  depth: 0,
  displayName: 'Before the first step',
  // Slightly warmer fog than depth-1 — an ante-chamber, not yet the deep dark.
  fogColor: 0x14100a,

  // Wake at the south end, facing north (-Z) down the long chamber.
  startPos: { x: 0, z: 6.5, yaw: 0 },

  rooms: [
    {
      id: 'antechamber',
      // 4m wide × 16m long — beats stay spaced, and the stairwell's
      // recessed well (2.56m behind its entrance) fits INSIDE the
      // south wall instead of poking through it.
      rect: { x: 0, z: 0, w: 4, d: 16 },
      height: 2.8,
      // The room itself stays dark: the bonfire, the candles at the
      // stairs, and the player's lamp do the talking. The ritual's
      // calibration reads honestly against real darkness.
      lightTier: 'dark',
    },
  ],
  corridors: [],

  props: [
    // ── THE FIRST FIRE — at the player's left shoulder on waking.
    // Authored here so the builder's auto-threshold-bonfire stands
    // down; same fire, deliberate placement. TEND opens the wick
    // ritual (registered by the builder for every bonfire model).
    { kind: 'model', model: BONFIRE, x: 0, y: 0, z: 4.7, rotY: 2.2 },

    // ── FIRST CORPSE — a few steps in. Sets the voice.
    {
      kind: 'corpse',
      x: 1.0, z: 3.4,
      rotY: 0.4,
      note: 'I came down on my own legs.\nSo will you.\nKeep them moving.',
    },

    // Off-axis skull altar — pure atmosphere, breaks the lane's symmetry.
    {
      kind: 'model',
      model: ALTAR_SKULL,
      x: 1.4, y: 0.0, z: 1.5,
      rotY: -0.3,
    },

    // A spike trap mid-room — teaches "look at the floor" by
    // consequence. Telegraphs (plate sinks) before springing.
    {
      kind: 'spike-trap',
      x: 0, z: 0,
      damage: 1,
      telegraphTime: 1.2,
    },

    // ── SECOND CORPSE — past the trap, near the practice rat.
    {
      kind: 'corpse',
      x:  1.2, z: -3.5,
      rotY: -0.6,
      note: 'It does not learn.\nStrike anyway.\nThe next one will.',
    },

    // Floor glow at the far end — pulls the eye toward the descent.
    { kind: 'model', model: TUTORIAL_FLOOR_GLOW, x: 0, y: 0, z: -4.4 },

    // Floor candles flanking the stairs — the egress idiom.
    { kind: 'model', model: FLOOR_CANDLE, x: -0.9, y: 0, z: -4.6 },
    { kind: 'model', model: FLOOR_CANDLE, x:  0.9, y: 0, z: -4.6 },

    // ── MARGINALIA — the previous delver's notes. Each action-hint
    // dismisses the moment the player performs it.
    {
      kind: 'hint',
      x: 0, z: 6.0,   // at the waking spot, facing the fire
      text: 'tend the fire. teach your eyes what the dark allows.',
      triggerRadius: 3.0,
      lingerMs: 7000,
    },
    {
      kind: 'hint',
      x: 0, z: 3.6,   // after standing, the first walk
      text: 'step. it is the only verb you have.',
      triggerRadius: 2.6,
    },
    {
      kind: 'hint',
      x: 0, z: 0.6,   // approaching the trap plate
      text: 'look down. the floor is not always patient.',
      triggerRadius: 2.2,
      lingerMs: 3500,
    },
    {
      kind: 'hint',
      x: 0.4, z: -1.0,  // before the rat
      text: 'strike. it will not strike back forever.',
      triggerRadius: 2.4,
      dismissOn: 'enemy:killed',
    },
    {
      kind: 'hint',
      x: -1.4, z: -1.4,  // over the chest
      text: 'take what fell. the dead will not.',
      triggerRadius: 2.0,
      dismissOn: 'item:picked-up',
    },
    {
      kind: 'hint',
      x: 0, z: -3.8,  // at the stairs
      text: 'down. always down.',
      triggerRadius: 2.6,
      lingerMs: 6000,
    },

    // ── CHEST WITH A POTION — teaches the magnetic pickup.
    {
      kind: 'chest',
      x: -1.4, z: -1.8,
      rotY: 0.8,
      loot: { gold: 0, items: [ITEMS['flask-draught']] },
    },
  ],

  torches: [
    // ONE dim torch at the trap row — partial visibility sells the
    // "look carefully" beat. The entrance end is lit by the bonfire
    // alone now (the old twin sconces fought the ritual: calibrating
    // your dark floor next to a lit wall taught nothing).
    { x:  1.95, z: 0.0, height: 1.9, wall: 'E', colorTint: 0xddc090, intensityMul: 0.55 },
    // Stairs torch — cool blue, the descent palette.
    { x: -1.95, z: -4.6, height: 1.8, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.8 },
  ],

  // One fragile rat — the first strike. Won't chase far.
  spawns: [
    { enemyId: 'rat', x: 0.4, z: -2.0, roomId: 'antechamber' },
  ],

  doors: [],

  stairs: [
    {
      id: 'stairs-tutorial-down',
      x: 0, z: -5.0,
      rotY: Math.PI,
      targetLevel: 'depth-1',
    },
  ],
};
