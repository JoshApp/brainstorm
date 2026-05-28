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
    // ── Hollow body — five walls (no top), so when the lid swings up
    // the player sees an actual interior cavity instead of a solid
    // block. Wall thickness 0.04m. Interior cavity dimensions:
    // (0.5 - 2*0.04) × (0.3 - 0.04) × (0.4 - 2*0.04) = 0.42 × 0.26 × 0.32.
    // Floor (with a darker interior material so the cavity reads
    // distinctly from the outside).
    { name: 'body', kind: 'box', pos: [0, 0.02, 0],     size: [0.50, 0.04, 0.40], mat: 'wood' },
    // Front wall
    { kind: 'box', pos: [0, 0.165, 0.18],  size: [0.50, 0.27, 0.04], mat: 'wood' },
    // Back wall
    { kind: 'box', pos: [0, 0.165, -0.18], size: [0.50, 0.27, 0.04], mat: 'wood' },
    // Left wall
    { kind: 'box', pos: [-0.23, 0.165, 0], size: [0.04, 0.27, 0.40], mat: 'wood' },
    // Right wall
    { kind: 'box', pos: [ 0.23, 0.165, 0], size: [0.04, 0.27, 0.40], mat: 'wood' },
    // Interior lining — slightly inset darker box on the cavity floor
    // gives a clear "the bottom is empty space, not the outer floor"
    // read when looking down into the open chest.
    { kind: 'box', pos: [0, 0.045, 0], size: [0.42, 0.005, 0.32], mat: 'wood_dark' },

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

// ── Iron chest — second tier ──────────────────────────────────────
// Heavier iron banding + a small green-tinted emissive lock so it
// reads as "uncommon" even before opening. Same dimensions + hinge
// geometry as the supply chest so the open animation and loot spawn
// slot work unchanged. Used in arena rewards and "earned" caches.
export const CHEST_IRON: ModelSpec = {
  id: 'chest-iron',
  materials: {
    wood: { color: 0x1f160d, roughness: 0.9, metalness: 0.0, flatShading: 'auto' },
    wood_dark: { color: 0x150f08, roughness: 0.95, metalness: 0.0, flatShading: 'auto' },
    iron: { color: 0x33302c, roughness: 0.55, metalness: 0.75, flatShading: 'auto' },
    seal: {
      color: 0x000000,
      emissive: 0x4a8a3a,           // uncommon-green tier glow
      emissiveIntensity: 1.2,
      roughness: 0.4,
    },
  },
  slots: {
    hinge: { pos: [0, 0.3, -0.18] },
    loot_spawn: { pos: [0, 0.32, 0] },
  },
  parts: [
    { name: 'body', kind: 'box', pos: [0, 0.02, 0],     size: [0.50, 0.04, 0.40], mat: 'wood' },
    { kind: 'box', pos: [0, 0.165, 0.18],  size: [0.50, 0.27, 0.04], mat: 'wood' },
    { kind: 'box', pos: [0, 0.165, -0.18], size: [0.50, 0.27, 0.04], mat: 'wood' },
    { kind: 'box', pos: [-0.23, 0.165, 0], size: [0.04, 0.27, 0.40], mat: 'wood' },
    { kind: 'box', pos: [ 0.23, 0.165, 0], size: [0.04, 0.27, 0.40], mat: 'wood' },
    { kind: 'box', pos: [0, 0.045, 0], size: [0.42, 0.005, 0.32], mat: 'wood_dark' },
    // Thicker iron bands — wraps around the whole chest at three
    // points so the silhouette reads as iron-bound.
    { kind: 'box', pos: [-0.18, 0.15, 0],  size: [0.035, 0.34, 0.42], mat: 'iron' },
    { kind: 'box', pos: [ 0.18, 0.15, 0],  size: [0.035, 0.34, 0.42], mat: 'iron' },
    { kind: 'box', pos: [0, 0.04, 0],  size: [0.50, 0.025, 0.40], mat: 'iron' },
    {
      name: 'lid',
      parent: 'hinge',
      kind: 'box',
      pos: [0, 0.025, 0.18],
      size: [0.5, 0.05, 0.4],
      mat: 'wood_dark',
    },
    // Iron lid band — top trim.
    { parent: 'hinge', kind: 'box', pos: [0, 0.05, 0.18], size: [0.5, 0.012, 0.4], mat: 'iron' },
    // Lock plate — iron rim + green sigil core.
    { kind: 'box', pos: [0, 0.22, 0.205], size: [0.09, 0.09, 0.012], mat: 'iron' },
    { kind: 'box', pos: [0, 0.22, 0.212], size: [0.045, 0.045, 0.005], mat: 'seal' },
  ],
};

// ── Boss chest — third tier ───────────────────────────────────────
// Ornate, larger, gold-trimmed with a bright amber emissive seal.
// Used as the reward gate after a boss kill or as a signature
// centrepiece in a treasure vault. Same hinge / loot-spawn slot
// shape so the interactable code stays unchanged.
export const CHEST_BOSS: ModelSpec = {
  id: 'chest-boss',
  materials: {
    wood: { color: 0x2a1b0f, roughness: 0.85, metalness: 0.0, flatShading: 'auto' },
    wood_dark: { color: 0x180e06, roughness: 0.95, metalness: 0.0, flatShading: 'auto' },
    gold: { color: 0xa37822, roughness: 0.35, metalness: 0.9, flatShading: 'auto' },
    seal: {
      color: 0x000000,
      emissive: 0xffb040,         // fabled amber-gold tier glow
      emissiveIntensity: 1.8,
      roughness: 0.3,
    },
  },
  slots: {
    // Slightly higher hinge to match the taller body. Loot spawn lifted
    // too so the spawn arc clears the bigger lid.
    hinge: { pos: [0, 0.42, -0.23] },
    loot_spawn: { pos: [0, 0.46, 0] },
  },
  parts: [
    // Larger body — 0.62 × 0.40 × 0.50.
    { name: 'body', kind: 'box', pos: [0, 0.02, 0],     size: [0.62, 0.04, 0.50], mat: 'wood' },
    { kind: 'box', pos: [0, 0.225, 0.23],  size: [0.62, 0.37, 0.04], mat: 'wood' },
    { kind: 'box', pos: [0, 0.225, -0.23], size: [0.62, 0.37, 0.04], mat: 'wood' },
    { kind: 'box', pos: [-0.29, 0.225, 0], size: [0.04, 0.37, 0.50], mat: 'wood' },
    { kind: 'box', pos: [ 0.29, 0.225, 0], size: [0.04, 0.37, 0.50], mat: 'wood' },
    { kind: 'box', pos: [0, 0.045, 0], size: [0.54, 0.005, 0.42], mat: 'wood_dark' },
    // Gold corner posts.
    { kind: 'box', pos: [-0.29, 0.20, -0.23], size: [0.05, 0.42, 0.05], mat: 'gold' },
    { kind: 'box', pos: [ 0.29, 0.20, -0.23], size: [0.05, 0.42, 0.05], mat: 'gold' },
    { kind: 'box', pos: [-0.29, 0.20,  0.23], size: [0.05, 0.42, 0.05], mat: 'gold' },
    { kind: 'box', pos: [ 0.29, 0.20,  0.23], size: [0.05, 0.42, 0.05], mat: 'gold' },
    // Gold horizontal trim.
    { kind: 'box', pos: [0, 0.20, 0.232], size: [0.55, 0.025, 0.005], mat: 'gold' },
    { kind: 'box', pos: [0, 0.20, -0.232], size: [0.55, 0.025, 0.005], mat: 'gold' },
    {
      name: 'lid',
      parent: 'hinge',
      kind: 'box',
      pos: [0, 0.035, 0.23],
      size: [0.62, 0.07, 0.50],
      mat: 'wood_dark',
    },
    // Gold lid trim.
    { parent: 'hinge', kind: 'box', pos: [0, 0.07, 0.23], size: [0.64, 0.018, 0.50], mat: 'gold' },
    // Front amber seal — bigger emissive than the iron chest. Reads
    // as a glowing lockstone from across a room.
    { kind: 'box', pos: [0, 0.28, 0.262], size: [0.16, 0.16, 0.012], mat: 'gold' },
    { kind: 'box', pos: [0, 0.28, 0.270], size: [0.09, 0.09, 0.006], mat: 'seal' },
  ],
};
