import type { LevelSpec } from './types';
import { SCIMITAR_RELIC } from '../content/relics';

// Hand-authored level 1 — the current ritual chamber, expressed as data.
// Once we trust this format, procgen and additional floors just produce more
// LevelSpecs.

export const LEVEL_1: LevelSpec = {
  id: 'depth-1',

  startPos: { x: 0, z: 0, yaw: 0 }, // spawn center of room, facing -Z (north)

  rooms: [
    {
      id: 'main-chamber',
      rect: { x: 0, z: 0, w: 8, d: 8 },
      height: 3.2,
    },
  ],

  corridors: [],

  props: [
    { kind: 'pillar', x: -1.8, z: -2.2 },
    { kind: 'pillar', x: 1.8, z: -2.2 },
    { kind: 'pillar', x: -1.8, z: 2.2 },
    { kind: 'pillar', x: 1.8, z: 2.2 },
    { kind: 'altar', x: 0, z: -2.8 },
    // SCIMITAR RELIC laid across the altar top. Altar top surface is at y=0.55
    // (altar block is 0.55 tall, centered at y=0.275). Tip-down, hilt-up,
    // rotated a bit so it lies diagonal across the altar stone.
    {
      kind: 'model',
      model: SCIMITAR_RELIC,
      x: 0, y: 0.56, z: -2.78,
      // Lay it flat on the altar: rotate -90° around X so the blade (originally
      // pointing along +Y) lies along the ground plane, then a bit of Y-rotation
      // so it sits diagonally rather than dead-straight.
      rotX: -Math.PI / 2,
      rotY: 0.6,
    },
  ],

  torches: [
    // North wall — the one the player faces at spawn
    { x: 0, z: -3.6, height: 2.2, wall: 'N' },
    // South wall — turn around to see this one
    { x: 0, z: 3.6, height: 2.2, wall: 'S' },
  ],

  spawns: [
    // Slow heavy hitter in front of the altar — the silhouetted ritual fight.
    { enemyId: 'ghoul', x: -0.6, z: -1.5 },
    // Fast small skirmisher to the player's right — both visible at spawn.
    { enemyId: 'skirmisher', x: 1.4, z: -1.8 },
    // Rat scuttling along the right wall — trash mob, fast, low HP, no
    // telegraph. Spawning behind a pillar so it has to come around it.
    { enemyId: 'rat', x: 2.4, z: 0.5 },
  ],
};
