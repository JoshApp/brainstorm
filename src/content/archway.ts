import type { ModelSpec } from '../ecs/model-types';

// Corridor archway — a stone gate frame at the mouth of a
// corridor where it joins a room. Sells the transition between
// chambers: instead of just stepping from one box into another,
// the player passes UNDER something, framing the next room
// cinematically.
//
// Geometry: two square stone columns flanking the opening (~2m
// apart inner edge to inner edge), a thick lintel across the
// top, plus a keystone block in the middle of the lintel.
// Authored at a fixed 2.4m outer width; corridors are 1.6-3.4m
// wide so the columns either sit slightly INSIDE the corridor
// (narrow case) or with a small gap on either side (wide case).
// Either way it reads as an actual frame.
//
// No collision — the player walks through it. The columns are
// at ±1m off the archway centre so a 0.3m-radius player stays
// clear of them when walking the corridor centreline.

export const ARCHWAY: ModelSpec = {
  id: 'corridor-archway',
  materials: {
    stone: { color: 0x231d16, roughness: 1.0, metalness: 0.0, flatShading: true },
  },
  parts: [
    // Left column — square pillar.
    { kind: 'box', pos: [-1.00, 1.20, 0], size: [0.32, 2.40, 0.40], mat: 'stone' },
    // Right column.
    { kind: 'box', pos: [ 1.00, 1.20, 0], size: [0.32, 2.40, 0.40], mat: 'stone' },
    // Column bases — slightly wider plinths at the floor.
    { kind: 'box', pos: [-1.00, 0.15, 0], size: [0.45, 0.30, 0.52], mat: 'stone' },
    { kind: 'box', pos: [ 1.00, 0.15, 0], size: [0.45, 0.30, 0.52], mat: 'stone' },
    // Column capitals — caps at the top.
    { kind: 'box', pos: [-1.00, 2.45, 0], size: [0.45, 0.18, 0.50], mat: 'stone' },
    { kind: 'box', pos: [ 1.00, 2.45, 0], size: [0.45, 0.18, 0.50], mat: 'stone' },
    // Lintel across the top.
    { kind: 'box', pos: [0, 2.70, 0], size: [2.50, 0.30, 0.55], mat: 'stone' },
    // Keystone — small slightly-protruding block centred on the lintel.
    { kind: 'box', pos: [0, 2.55, 0], size: [0.32, 0.28, 0.60], mat: 'stone' },
  ],
};
