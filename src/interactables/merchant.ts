// The wandering merchant — a hooded figure with a lantern (lighting-as-signal:
// a merchant is an EVENT). Walk up, the buy-panel opens, spend run gold on
// wares rolled from the loot pool. Stock is rolled ONCE at spawn and remembered
// (sold wares stay sold) so re-opening the stall is consistent.

import * as THREE from 'three';
import type { ModelSpec } from '../ecs/model-types';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { rollShopStock } from '../content/shop';
import { openShopScreen } from '../ui/shop-screen';

// Cloaked merchant, primitives only (no texture pipeline — per the charter).
// Dark robe, a band of tarnished gold, eyes + a lantern that glow so the
// silhouette reads in torchlight.
export const MERCHANT_MODEL: ModelSpec = {
  id: 'wandering-merchant',
  materials: {
    robe:  { color: 0x241d18, roughness: 0.98, metalness: 0.0, flatShading: 'auto' },
    trim:  { color: 0xb08a3c, roughness: 0.55, metalness: 0.85, flatShading: 'auto' },
    glow:  { color: 0x140a04, emissive: 0xffb347, emissiveIntensity: 1.6, roughness: 1.0 },
    eyes:  { color: 0x000000, emissive: 0xffd27a, emissiveIntensity: 1.2, roughness: 1.0 },
  },
  parts: [
    // Robed body — a tall capsule rising from the floor.
    { name: 'body', kind: 'capsule', pos: [0, 0.68, 0], radius: 0.27, height: 0.70, mat: 'robe', jitter: 0.02 },
    // Hood — a sphere over where the head would be.
    { name: 'hood', kind: 'sphere', pos: [0, 1.30, 0], radius: 0.30, scale: [1.0, 1.08, 1.0], mat: 'robe', jitter: 0.02 },
    // Eyes glinting in the hood's shadow (faces -Z, the "front").
    { kind: 'sphere', pos: [-0.10, 1.32, -0.23], radius: 0.035, mat: 'eyes' },
    { kind: 'sphere', pos: [ 0.10, 1.32, -0.23], radius: 0.035, mat: 'eyes' },
    // Tarnished-gold band at the waist — the only wealth on a grim figure.
    { kind: 'torus', pos: [0, 0.96, 0], rot: [Math.PI / 2, 0, 0], radius: 0.28, tube: 0.025, mat: 'trim' },
    // Staff + hanging lantern (the light).
    { kind: 'cylinder', pos: [0.34, 0.62, 0.06], radius: 0.018, height: 1.30, mat: 'trim' },
    { kind: 'sphere', pos: [0.34, 1.30, 0.06], radius: 0.075, mat: 'glow' },
  ],
};

/** Spawn a merchant at a floor position and register its interactable. `depth`
 *  drives the stock roll. */
export function spawnMerchant(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  depth: number,
): void {
  const built = buildModel(MERCHANT_MODEL);
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  parent.add(built.group);

  // Roll the stall's wares once; the panel mutates `sold` flags in place so
  // walking away and back shows the same (partly-bought) stock.
  const stock = rollShopStock(depth);

  registerInteractable({
    id: generateEntityId('merchant'),
    position: pos.clone(),
    radius: 1.4,
    promptLabel: 'TRADE',
    labelOffsetY: 1.6,
    onUse() {
      openShopScreen(stock);
    },
    built,
  });
}

// The RELIC-KEEPER — the trinket merchant. Same silhouette as the trader, but
// its wealth reads ARCANE not golden: a violet-lit charm on the staff, cold
// amethyst trim, a witch-light in the hood. Stock is drawn from the reliquary
// pool and a purchase COLLECTS into the reliquary (shop-screen routes relics),
// so this is where you buy INTO a domain build with gold.
export const RELIC_KEEPER_MODEL: ModelSpec = {
  id: 'relic-keeper',
  materials: {
    robe: { color: 0x1c1622, roughness: 0.98, metalness: 0.0, flatShading: 'auto' },
    trim: { color: 0x7a5ca8, roughness: 0.5, metalness: 0.7, flatShading: 'auto' },
    glow: { color: 0x14081c, emissive: 0xb066ff, emissiveIntensity: 1.7, roughness: 1.0 },
    eyes: { color: 0x000000, emissive: 0xc79bff, emissiveIntensity: 1.3, roughness: 1.0 },
  },
  parts: [
    { name: 'body', kind: 'capsule', pos: [0, 0.68, 0], radius: 0.27, height: 0.70, mat: 'robe', jitter: 0.02 },
    { name: 'hood', kind: 'sphere', pos: [0, 1.30, 0], radius: 0.30, scale: [1.0, 1.08, 1.0], mat: 'robe', jitter: 0.02 },
    { kind: 'sphere', pos: [-0.10, 1.32, -0.23], radius: 0.035, mat: 'eyes' },
    { kind: 'sphere', pos: [ 0.10, 1.32, -0.23], radius: 0.035, mat: 'eyes' },
    // Amethyst band at the waist.
    { kind: 'torus', pos: [0, 0.96, 0], rot: [Math.PI / 2, 0, 0], radius: 0.28, tube: 0.025, mat: 'trim' },
    // Staff with a floating relic-charm at the top (the witch-light).
    { kind: 'cylinder', pos: [0.34, 0.62, 0.06], radius: 0.018, height: 1.30, mat: 'trim' },
    { kind: 'sphere', pos: [0.34, 1.36, 0.06], radius: 0.07, mat: 'glow' },
    // A ring of tiny charms hanging off the staff (relics for sale).
    { kind: 'torus', pos: [0.34, 1.14, 0.06], rot: [Math.PI / 2, 0, 0], radius: 0.08, tube: 0.012, mat: 'trim' },
  ],
};

/** Spawn the relic-keeper (trinket merchant). Stock is relics; buying collects
 *  into the reliquary. `depth` drives the roll. */
export function spawnTrinketMerchant(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  depth: number,
): void {
  const built = buildModel(RELIC_KEEPER_MODEL);
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  parent.add(built.group);

  const stock = rollShopStock(depth, 3, undefined, 'reliquary');

  registerInteractable({
    id: generateEntityId('relic-keeper'),
    position: pos.clone(),
    radius: 1.4,
    promptLabel: 'BARTER',
    labelOffsetY: 1.6,
    onUse() {
      openShopScreen(stock);
    },
    built,
  });
}
