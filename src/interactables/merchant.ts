// The wandering merchant — a hooded figure with a lantern (lighting-as-signal:
// a merchant is an EVENT). Walk up, the buy-panel opens, spend run gold on
// wares rolled from the loot pool. Stock is rolled ONCE at spawn and remembered
// (sold wares stay sold) so re-opening the stall is consistent.

import * as THREE from 'three';
import type { ModelSpec } from '../ecs/model-types';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { showInWorldMessage } from '../ui/pickup-notification';
import { registerLight } from '../scene/light-pool';
import { rollShopStock } from '../content/shop';
import { openShopScreen } from '../ui/shop-screen';

/** Register the vendor's lantern/relic as a flickering pooled light at the
 *  model's `light` offset — a merchant is an EVENT (lighting-as-signal), so the
 *  glow it casts is how you find the stall in torchlight. */
function registerVendorLight(model: ModelSpec, pos: THREE.Vector3): void {
  const L = model.light;
  if (!L) return;
  const [lx, ly, lz] = L.pos ?? [0, 0, 0];
  const base = L.intensity ?? 1.6;
  const seed = (lx + lz) * 3.1;
  registerLight({
    id: generateEntityId('vendor-light'),
    category: 'environment',
    position: new THREE.Vector3(pos.x + lx, pos.y + ly, pos.z + lz),
    color: L.color ?? 0xffb347, intensity: base, distance: L.distance ?? 4.2, decay: L.decay ?? 1.8,
    getIntensity: () => {
      const t = performance.now() / 1000;
      return base * (1 + 0.09 * (0.6 * Math.sin(t * 5.3 + seed) + 0.4 * Math.sin(t * 8.1)));
    },
  });
}

// Cloaked merchant, primitives only (no texture pipeline — per the charter).
// A HUNCHED PEDDLER: a flared robe (not a pill), a deep cowl over a shadowed
// face, arms drawn in, and a laden PACK on the back — a figure who has carried
// wares a long way. Gold trim + a caged lantern read the silhouette in torchlight.
export const MERCHANT_MODEL: ModelSpec = {
  id: 'wandering-merchant',
  materials: {
    robe:  { color: 0x2a221a, roughness: 0.98, metalness: 0.0, flatShading: 'auto' },
    dark:  { color: 0x140f0a, roughness: 1.0,  metalness: 0.0, flatShading: 'auto' },  // cowl shadow / face void
    leather: { color: 0x4a3826, roughness: 0.92, metalness: 0.0, flatShading: 'auto' },  // pack + straps
    trim:  { color: 0xb08a3c, roughness: 0.5,  metalness: 0.85, flatShading: 'auto' },
    iron:  { color: 0x33302c, roughness: 0.6,  metalness: 0.7,  flatShading: 'auto' },  // lantern cage
    glow:  { color: 0x140a04, emissive: 0xffb347, emissiveIntensity: 1.9, roughness: 1.0 },
    eyes:  { color: 0x000000, emissive: 0xffd27a, emissiveIntensity: 1.3, roughness: 1.0 },
  },
  parts: [
    // ── Robe: a flared skirt (wide base → waist), so the base plants on the
    //    floor instead of a rounded pill. Slight forward lean = a laden hunch. ──
    { name: 'skirt', kind: 'cylinder', pos: [0, 0.38, 0.02], radiusTop: 0.24, radius: 0.40, height: 0.76, segments: 10, mat: 'robe', jitter: 0.02 },
    // Torso — narrower, leaning forward a touch over the skirt.
    { name: 'torso', kind: 'cylinder', pos: [0, 0.98, -0.03], radiusTop: 0.20, radius: 0.25, height: 0.44, segments: 10, mat: 'robe', jitter: 0.02, rot: [0.12, 0, 0] },
    // Sloped shoulders — a low box sitting across the torso top.
    { kind: 'box', pos: [0, 1.16, -0.05], size: [0.44, 0.14, 0.30], bevel: 0.05, mat: 'robe', jitter: 0.02 },
    // ── Cowl — a cone hood, its mouth open toward -Z (the front) over a dark
    //    face void; eyes glint deep inside. ──
    { name: 'cowl', kind: 'cone', pos: [0, 1.34, -0.04], radius: 0.22, height: 0.34, segments: 9, mat: 'robe', jitter: 0.02 },
    { name: 'face', kind: 'sphere', pos: [0, 1.24, -0.14], radius: 0.135, scale: [0.9, 1.0, 0.7], mat: 'dark' },
    { name: 'eye_l', kind: 'sphere', pos: [-0.055, 1.26, -0.20], radius: 0.028, mat: 'eyes' },
    { name: 'eye_r', kind: 'sphere', pos: [ 0.055, 1.26, -0.20], radius: 0.028, mat: 'eyes' },
    // ── Arms — drawn in across the belly (the peddler's clasp). Two angled
    //    sleeve capsules meeting at the front. ──
    { name: 'arm_l', kind: 'capsule', pos: [-0.19, 0.92, -0.14], radius: 0.075, height: 0.30, rot: [0.5, 0, 0.5], mat: 'robe', jitter: 0.02 },
    { name: 'arm_r', kind: 'capsule', pos: [ 0.19, 0.92, -0.14], radius: 0.075, height: 0.30, rot: [0.5, 0, -0.5], mat: 'robe', jitter: 0.02 },
    // ── The PACK — a laden sack + a rolled bundle on top, riding high on the
    //    back (+Z). This is the "wandering merchant" read. ──
    { name: 'pack', kind: 'box', pos: [0, 1.02, 0.24], size: [0.40, 0.46, 0.26], bevel: 0.07, mat: 'leather', jitter: 0.03 },
    { name: 'bedroll', kind: 'cylinder', pos: [0, 1.30, 0.26], radius: 0.10, height: 0.44, rot: [0, 0, Math.PI / 2], segments: 8, mat: 'leather', jitter: 0.02 },
    // Straps crossing the chest (leather bands) + a gold clasp where they meet.
    { kind: 'box', pos: [-0.12, 1.02, -0.18], size: [0.05, 0.5, 0.04], rot: [0, 0, 0.28], mat: 'leather' },
    { kind: 'box', pos: [ 0.12, 1.02, -0.18], size: [0.05, 0.5, 0.04], rot: [0, 0, -0.28], mat: 'leather' },
    { name: 'clasp', kind: 'box', pos: [0, 1.02, -0.20], size: [0.08, 0.08, 0.03], bevel: 0.02, mat: 'trim' },
    // Coin pouch at the hip.
    { kind: 'sphere', pos: [-0.26, 0.66, -0.12], radius: 0.07, scale: [1.0, 1.15, 1.0], mat: 'leather' },
    // Tarnished-gold hem band at the waist.
    { kind: 'torus', pos: [0, 0.76, 0], rot: [Math.PI / 2, 0, 0], radius: 0.26, tube: 0.02, mat: 'trim' },
    // ── Staff + a CAGED lantern (an iron box frame around a warm core), held to
    //    the merchant's right. The signal light. ──
    { name: 'staff', kind: 'cylinder', pos: [0.30, 0.70, -0.14], radius: 0.018, height: 1.46, rot: [0.06, 0, 0.04], mat: 'leather' },
    { kind: 'box', pos: [0.33, 1.30, -0.16], size: [0.13, 0.16, 0.13], bevel: 0.02, mat: 'iron' },       // lantern cage
    { name: 'lantern', kind: 'sphere', pos: [0.33, 1.30, -0.16], radius: 0.065, mat: 'glow' },            // warm core
    { kind: 'box', pos: [0.33, 1.39, -0.16], size: [0.06, 0.04, 0.06], mat: 'iron' },                     // lantern cap
  ],
  light: { pos: [0.33, 1.30, -0.16], color: 0xffb347, intensity: 1.6, distance: 4.2, decay: 1.8 },
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
  registerVendorLight(MERCHANT_MODEL, pos);

  // NO MENU. The stock stands on the counter in front of him (level/centrepieces
  // planMerchant → priced offerings), so the goods ARE the shop: you walk up to
  // a ware, read it where it lies, and pay for it in the world. Opening a panel
  // on top of that would be the same transaction twice, and the screen version
  // is the one that breaks the fiction — you don't browse a menu in a dungeon.
  //
  // He stays interactable because a shopkeeper you can't address is furniture.
  // He just talks instead of trading.
  void depth;
  registerInteractable({
    id: generateEntityId('merchant'),
    position: pos.clone(),
    radius: 1.4,
    promptLabel: 'SPEAK',
    labelOffsetY: 1.6,
    onUse() {
      showInWorldMessage(PEDDLER_LINES[peddlerLine++ % PEDDLER_LINES.length]);
    },
    built,
  });
}

/** What the peddler says. In-world register (Tone Bible): the place does not
 *  joke. He is not pleased to see you; he is pleased to see coin. */
const PEDDLER_LINES: readonly string[] = [
  'Coin on the stone. I do not haggle with the walking.',
  'Take what you can carry. The rest keeps.',
  'Others have stood where you stand. Their coin spent the same.',
  'Look all you like. Looking is free.',
];
let peddlerLine = 0;

// The RELIC-KEEPER — the trinket merchant. A GAUNT, taller silhouette than the
// peddler: a spined/horned cowl, skeletal charm-hung robe, and a staff topped
// with a CAGED relic-light. Its wealth reads ARCANE not golden — cold amethyst
// trim, a violet witch-light, charms that float. Stock is the reliquary pool;
// a purchase COLLECTS into the reliquary — this is where you buy INTO a domain.
export const RELIC_KEEPER_MODEL: ModelSpec = {
  id: 'relic-keeper',
  materials: {
    robe: { color: 0x1c1622, roughness: 0.98, metalness: 0.0, flatShading: 'auto' },
    dark: { color: 0x0d0812, roughness: 1.0,  metalness: 0.0, flatShading: 'auto' },   // cowl shadow / face void
    bone: { color: 0xc8bfa8, roughness: 0.85, metalness: 0.0, flatShading: 'auto' },   // horns + charms
    trim: { color: 0x7a5ca8, roughness: 0.45, metalness: 0.7, flatShading: 'auto' },   // amethyst metal
    iron: { color: 0x2a2630, roughness: 0.6,  metalness: 0.7, flatShading: 'auto' },   // cage
    glow: { color: 0x14081c, emissive: 0xb066ff, emissiveIntensity: 2.0, roughness: 1.0 },
    eyes: { color: 0x000000, emissive: 0xc79bff, emissiveIntensity: 1.4, roughness: 1.0 },
  },
  parts: [
    // Tall, thin flared robe — narrower + a touch taller than the peddler.
    { name: 'skirt', kind: 'cylinder', pos: [0, 0.42, 0], radiusTop: 0.20, radius: 0.34, height: 0.84, segments: 10, mat: 'robe', jitter: 0.02 },
    { name: 'torso', kind: 'cylinder', pos: [0, 1.04, 0], radiusTop: 0.17, radius: 0.21, height: 0.46, segments: 10, mat: 'robe', jitter: 0.02 },
    // Narrow raised shoulders (a hunched, gaunt line).
    { kind: 'box', pos: [0, 1.24, -0.02], size: [0.38, 0.12, 0.26], bevel: 0.04, mat: 'robe', jitter: 0.02 },
    // ── Spined cowl — a taller cone hood with two bone HORNS curving back. ──
    { name: 'cowl', kind: 'cone', pos: [0, 1.44, -0.02], radius: 0.19, height: 0.40, segments: 9, mat: 'robe', jitter: 0.02 },
    { name: 'horn_l', kind: 'cone', pos: [-0.12, 1.52, 0.04], radius: 0.035, height: 0.24, rot: [-0.5, 0, 0.35], mat: 'bone' },
    { name: 'horn_r', kind: 'cone', pos: [ 0.12, 1.52, 0.04], radius: 0.035, height: 0.24, rot: [-0.5, 0, -0.35], mat: 'bone' },
    { name: 'face', kind: 'sphere', pos: [0, 1.34, -0.12], radius: 0.115, scale: [0.85, 1.05, 0.7], mat: 'dark' },
    { name: 'eye_l', kind: 'sphere', pos: [-0.05, 1.36, -0.17], radius: 0.026, mat: 'eyes' },
    { name: 'eye_r', kind: 'sphere', pos: [ 0.05, 1.36, -0.17], radius: 0.026, mat: 'eyes' },
    // Long thin sleeves hanging at the sides (skeletal, drawn down).
    { name: 'arm_l', kind: 'capsule', pos: [-0.20, 0.92, -0.06], radius: 0.06, height: 0.42, rot: [0.1, 0, 0.18], mat: 'robe', jitter: 0.02 },
    { name: 'arm_r', kind: 'capsule', pos: [ 0.20, 0.92, -0.06], radius: 0.06, height: 0.42, rot: [0.1, 0, -0.18], mat: 'robe', jitter: 0.02 },
    // Amethyst hem band + a chest brooch.
    { kind: 'torus', pos: [0, 0.82, 0], rot: [Math.PI / 2, 0, 0], radius: 0.22, tube: 0.018, mat: 'trim' },
    { kind: 'box', pos: [0, 1.06, -0.17], size: [0.06, 0.09, 0.03], bevel: 0.02, mat: 'trim' },
    // ── Hanging CHARMS — bone shards + a small relic on cords across the front,
    //    plus a floating violet mote (the wares' arcane hum). ──
    { kind: 'capsule', pos: [-0.10, 0.86, -0.15], radius: 0.014, height: 0.16, mat: 'bone' },
    { kind: 'box', pos: [-0.10, 0.74, -0.16], size: [0.05, 0.07, 0.02], rot: [0, 0, 0.4], mat: 'bone' },
    { kind: 'capsule', pos: [0.08, 0.88, -0.15], radius: 0.014, height: 0.12, mat: 'bone' },
    { name: 'float_charm', kind: 'sphere', pos: [-0.24, 1.02, -0.18], radius: 0.045, mat: 'glow' },
    // ── Staff with a CAGED relic-light at the top (iron cage around a violet
    //    orb) + a bone ring below it. The witch-light. ──
    { name: 'staff', kind: 'cylinder', pos: [0.28, 0.74, -0.10], radius: 0.016, height: 1.52, rot: [0.04, 0, 0.03], mat: 'iron' },
    { kind: 'box', pos: [0.30, 1.42, -0.13], size: [0.12, 0.14, 0.12], bevel: 0.015, mat: 'iron' },   // cage
    { name: 'relic', kind: 'sphere', pos: [0.30, 1.42, -0.13], radius: 0.055, mat: 'glow' },           // caged orb
    { kind: 'cone', pos: [0.30, 1.51, -0.13], radius: 0.05, height: 0.07, mat: 'iron' },               // cage cap
    { kind: 'torus', pos: [0.29, 1.20, -0.11], rot: [Math.PI / 2, 0, 0], radius: 0.06, tube: 0.012, mat: 'bone' },  // charm ring
  ],
  light: { pos: [0.30, 1.42, -0.13], color: 0xb066ff, intensity: 1.5, distance: 4.0, decay: 1.9 },
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
  registerVendorLight(RELIC_KEEPER_MODEL, pos);

  const stock = rollShopStock(depth, 3, undefined, 'reliquary');

  registerInteractable({
    id: generateEntityId('relic-keeper'),
    position: pos.clone(),
    radius: 1.4,
    promptLabel: 'BARTER',
    labelOffsetY: 1.6,
    onUse() {
      openShopScreen(stock, {
        title: 'THE RELIC-KEEPER',
        emptyLine: 'The reliquary is spent. Come back with fuller pockets, or deeper.',
      });
    },
    built,
  });
}
