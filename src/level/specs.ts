import type { LevelSpec } from './types';

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
  ],

  torches: [
    // North wall — the one the player faces at spawn
    { x: 0, z: -3.6, height: 2.2, wall: 'N' },
    // South wall — turn around to see this one
    { x: 0, z: 3.6, height: 2.2, wall: 'S' },
  ],

  spawns: [
    // Slow heavy hitter centered in front of the altar — the silhouetted
    // ritual fight, visible at spawn.
    { enemyId: 'ghoul', x: -0.6, z: -1.5 },
    // Fast small skirmisher to the player's right — both enemies visible at
    // spawn so the player immediately sees they have to track two rhythms.
    { enemyId: 'skirmisher', x: 1.4, z: -1.8 },
  ],
};
