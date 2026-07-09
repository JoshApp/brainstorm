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
    // Bigger than the wood chest (0.60 × 0.34 × 0.48) — the middle step.
    { name: 'body', kind: 'box', pos: [0, 0.02, 0],     size: [0.60, 0.04, 0.48], mat: 'wood' },
    { kind: 'box', pos: [0, 0.195, 0.22],  size: [0.60, 0.31, 0.04], mat: 'wood' },
    { kind: 'box', pos: [0, 0.195, -0.22], size: [0.60, 0.31, 0.04], mat: 'wood' },
    { kind: 'box', pos: [-0.28, 0.195, 0], size: [0.04, 0.31, 0.48], mat: 'wood' },
    { kind: 'box', pos: [ 0.28, 0.195, 0], size: [0.04, 0.31, 0.48], mat: 'wood' },
    { kind: 'box', pos: [0, 0.045, 0], size: [0.52, 0.005, 0.40], mat: 'wood_dark' },
    // Thicker iron bands — wraps around the whole chest at three
    // points so the silhouette reads as iron-bound.
    { kind: 'box', pos: [-0.22, 0.18, 0],  size: [0.04, 0.38, 0.50], mat: 'iron' },
    { kind: 'box', pos: [ 0.22, 0.18, 0],  size: [0.04, 0.38, 0.50], mat: 'iron' },
    { kind: 'box', pos: [0, 0.04, 0],  size: [0.60, 0.025, 0.48], mat: 'iron' },
    {
      name: 'lid',
      parent: 'hinge',
      kind: 'box',
      pos: [0, 0.03, 0.22],
      size: [0.60, 0.06, 0.48],
      mat: 'wood_dark',
    },
    // Iron lid band — top trim.
    { parent: 'hinge', kind: 'box', pos: [0, 0.06, 0.22], size: [0.60, 0.014, 0.48], mat: 'iron' },
    // Lock plate — iron rim + green sigil core.
    { kind: 'box', pos: [0, 0.25, 0.245], size: [0.10, 0.10, 0.012], mat: 'iron' },
    { kind: 'box', pos: [0, 0.25, 0.252], size: [0.05, 0.05, 0.005], mat: 'seal' },
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
    wood: { color: 0x241608, roughness: 0.85, metalness: 0.0, flatShading: 'auto' },
    wood_dark: { color: 0x140b04, roughness: 0.95, metalness: 0.0, flatShading: 'auto' },
    gold: { color: 0xb0832a, roughness: 0.3, metalness: 0.95, flatShading: 'auto' },
    bone: { color: 0xcabfa2, roughness: 0.75, metalness: 0.0, flatShading: 'auto' },  // occult pallor
    seal: {
      color: 0x000000,
      emissive: 0xffb040,         // fabled amber-gold tier glow
      emissiveIntensity: 2.2,
      roughness: 0.3,
    },
  },
  slots: {
    // Taller/deeper body — the imposing tier. Hinge + loot spawn lift to match.
    hinge: { pos: [0, 0.54, -0.29] },
    loot_spawn: { pos: [0, 0.60, 0] },
  },
  parts: [
    // Much larger body — 0.76 × 0.50 × 0.60 (a landmark you read across the room).
    { name: 'body', kind: 'box', pos: [0, 0.02, 0],     size: [0.76, 0.04, 0.60], mat: 'wood' },
    { kind: 'box', pos: [0, 0.29, 0.28],  size: [0.76, 0.50, 0.04], mat: 'wood' },
    { kind: 'box', pos: [0, 0.29, -0.28], size: [0.76, 0.50, 0.04], mat: 'wood' },
    { kind: 'box', pos: [-0.36, 0.29, 0], size: [0.04, 0.50, 0.60], mat: 'wood' },
    { kind: 'box', pos: [ 0.36, 0.29, 0], size: [0.04, 0.50, 0.60], mat: 'wood' },
    { kind: 'box', pos: [0, 0.045, 0], size: [0.66, 0.005, 0.50], mat: 'wood_dark' },
    // Gold corner posts (thicker, taller).
    { kind: 'box', pos: [-0.36, 0.27, -0.28], size: [0.06, 0.54, 0.06], mat: 'gold' },
    { kind: 'box', pos: [ 0.36, 0.27, -0.28], size: [0.06, 0.54, 0.06], mat: 'gold' },
    { kind: 'box', pos: [-0.36, 0.27,  0.28], size: [0.06, 0.54, 0.06], mat: 'gold' },
    { kind: 'box', pos: [ 0.36, 0.27,  0.28], size: [0.06, 0.54, 0.06], mat: 'gold' },
    // Gold horizontal trim (top + mid banding).
    { kind: 'box', pos: [0, 0.50, 0.283], size: [0.66, 0.03, 0.006], mat: 'gold' },
    { kind: 'box', pos: [0, 0.16, 0.283], size: [0.66, 0.02, 0.006], mat: 'gold' },
    {
      name: 'lid',
      parent: 'hinge',
      kind: 'box',
      pos: [0, 0.04, 0.29],
      size: [0.76, 0.08, 0.60],
      mat: 'wood_dark',
    },
    // Gold lid trim (front + back edge).
    { parent: 'hinge', kind: 'box', pos: [0, 0.085, 0.29], size: [0.78, 0.02, 0.60], mat: 'gold' },
    // OCCULT SIGIL — a raised gold ring on the front with a glowing amber core
    // (a ritual lockstone — this chest shouldn't be opened), flanked by two
    // small bone HORNS on the lid crown for the grotesque tell.
    { kind: 'cylinder', pos: [0, 0.34, 0.325], radius: 0.13, height: 0.03, rot: [Math.PI / 2, 0, 0], segments: 16, mat: 'gold' },
    { kind: 'cylinder', pos: [0, 0.34, 0.345], radius: 0.07, height: 0.02, rot: [Math.PI / 2, 0, 0], segments: 16, mat: 'seal' },
    // Horns on the lid crown — angled outward, the grotesque tell.
    { parent: 'hinge', kind: 'cone', pos: [-0.26, 0.12, 0.22], radius: 0.06, height: 0.22, rot: [0, 0, 0.55], mat: 'bone' },
    { parent: 'hinge', kind: 'cone', pos: [ 0.26, 0.12, 0.22], radius: 0.06, height: 0.22, rot: [0, 0, -0.55], mat: 'bone' },
  ],
};
