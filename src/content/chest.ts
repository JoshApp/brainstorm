import type { ModelSpec } from '../ecs/model-types';

// Wooden chest. Two-piece (body + lid) so the lid can swing open on a hinge.
//
// The lid is parented to a 'hinge' slot at the back-top edge of the body. To
// open the chest, rotate the hinge anchor's X rotation backward (negative).
// The lid swings up and back, pivoting around the back edge — like a real
// chest. Body dimensions: 0.5 wide × 0.3 tall × 0.4 deep.

export const CHEST: ModelSpec = {
  id: 'chest',
  materials: {
    wood: {
      color: 0x2a1d11,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: 'auto',
    },
    wood_dark: {
      color: 0x1a1108,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: 'auto',
    },
    iron: {
      color: 0x14110d,
      roughness: 0.85,
      metalness: 0.5,
      flatShading: 'auto',
    },
  },
  slots: {
    // Hinge anchor: back-top edge of the body. Lid is parented here so
    // rotating this slot's X rotation swings the lid around the back edge.
    hinge: { pos: [0, 0.3, -0.18] },
    // Where loot pops out when the chest opens.
    loot_spawn: { pos: [0, 0.32, 0] },
  },
  parts: [
    // Body — main box of the chest
    { name: 'body', kind: 'box', pos: [0, 0.15, 0], size: [0.5, 0.3, 0.4], mat: 'wood' },
    // Iron bands across the body (small flat boxes)
    { kind: 'box', pos: [-0.18, 0.15, 0],  size: [0.02, 0.32, 0.42], mat: 'iron' },
    { kind: 'box', pos: [ 0.18, 0.15, 0],  size: [0.02, 0.32, 0.42], mat: 'iron' },
    // Lid — child of the hinge slot. Local position: from the hinge point,
    // offset forward (+Z) by half the lid depth so the lid sits on top of the
    // body when the hinge rotation is 0.
    {
      name: 'lid',
      parent: 'hinge',
      kind: 'box',
      pos: [0, 0.025, 0.18],   // 18cm forward of hinge, 2.5cm up to give a slight overlap on body
      size: [0.5, 0.05, 0.4],
      mat: 'wood_dark',
    },
    // Lock plate — small box on the front face of the body
    { kind: 'box', pos: [0, 0.22, 0.205], size: [0.06, 0.06, 0.01], mat: 'iron' },
  ],
};
