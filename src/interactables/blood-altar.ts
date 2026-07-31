import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { getInRangeInteractable } from './system';
import { spawnEvent } from './event-factory';
import { tryAutoEquip } from '../player/equipment';
import { addItem, removeItem } from '../player/inventory';
import { rollItemInstance, instanceDisplayName } from '../player/item-instance';
import { spawnBloodBurst } from '../effects/blood-burst';
import { playEquipClick } from '../audio/sfx';
import { RARITY_COLORS } from '../content/items';
import { registerItemPreview, setItemPreviewAnchor, setItemPreviewInspected, unregisterItemPreview } from '../ui/item-preview';
import type { ItemSpec } from '../content/items';
import type { EntityId } from '../ecs/types';
import type { StyleMaterials } from '../style/materials';
import { disposeBuiltTree } from '../style/material-registry';
import { applyBrokenness } from './brokenness';

// Blood altar — a stone block with a CURSED offering floating above it, washed
// in violet glow. Taking it ALWAYS costs BLOOD_PRICE_HP (can kill at low HP).
// Now built on spawnEvent: the factory owns the id, the −4 ❤ cost chip, the
// central HP deduction (cost.hp), the bargain transaction emits, and teardown.
// This file keeps only the bespoke visuals (the leaning basin + floating,
// bobbing, preview-driven offering) and the effect (burst + grant).
//
// Order note: the factory runs the effect (blood burst + grant) BEFORE paying
// the HP cost, so the burst still anchors at the altar before a lethal take.

const BLOOD_PRICE_HP = 4;   // half the base pool — a real bet at high HP, lethal at low

const ROTATE_SPEED = 0.6;
const BOB_AMPLITUDE = 0.030;
const BOB_FREQUENCY = 0.7;   // slow, dreamy hover
const PREVIEW_RANGE = 4.0;   // identify (name+flavour) from a few steps; stats gated on inspect

export function spawnBloodAltar(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  cursedItem: ItemSpec,
  materials: StyleMaterials,
  onDestroy?: () => void,
) {
  // Shared across build / onUse / onDestroy.
  let offerGroup!: THREE.Group;
  let discMat!: THREE.MeshBasicMaterial;
  let previewId: EntityId;
  const baseH = 0.62, topH = 0.08;
  const restingY = baseH + topH + 0.32;

  spawnEvent({
    kind: 'blood-altar',
    scene,
    pos,
    rotY,
    radius: 1.6,
    labelOffsetY: 0.55,        // sits low, below the floating offering + its card
    promptLabel: 'OFFER',      // you give blood for it — not a plain TAKE
    promptKind: 'bargain',     // violet — a cursed bargain
    cost: { hp: BLOOD_PRICE_HP },   // shows "−4 ❤" and is deducted centrally
    family: 'bargain',
    previewItem: cursedItem,
    keepBuiltOnDestroy: true,  // the stone basin stays; onDestroy yanks only the offering
    build: (ctx) => {
      previewId = ctx.id;
      // ── Stone group (stays after the offering is taken) ──
      const stoneGroup = new THREE.Group();
      stoneGroup.position.copy(pos);
      stoneGroup.rotation.y = rotY;
      scene.add(stoneGroup);

      const baseW = 0.78, baseD = 0.62;
      const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, baseH, baseD), materials.wall);
      base.position.y = baseH / 2;
      base.castShadow = true; base.receiveShadow = true;
      stoneGroup.add(base);

      const topW = baseW + 0.10, topD = baseD + 0.10;
      const top = new THREE.Mesh(new THREE.BoxGeometry(topW, topH, topD), materials.wall);
      top.position.y = baseH + topH / 2;
      top.castShadow = true; top.receiveShadow = true;
      stoneGroup.add(top);

      // Cursed-violet floor disc under the offering.
      discMat = new THREE.MeshBasicMaterial({
        color: RARITY_COLORS.cursed, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(topW * 0.85, topD * 0.85), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = baseH + topH + 0.005;
      stoneGroup.add(disc);

      // Half-broken: the basin has stood a long time. Position-seeded, disc re-levelled.
      let bs = (((pos.x * 73856093) ^ (pos.z * 19349663)) >>> 0) || 1;
      const brand = () => { bs = (Math.imul(bs, 1664525) + 1013904223) >>> 0; return bs / 0x100000000; };
      applyBrokenness(stoneGroup, 0.5, brand);
      disc.rotation.set(-Math.PI / 2, 0, 0);   // keep the glow flat despite the lean

      // ── Offered item — separate root so destroy yanks only the offering ──
      const offeringSpec = cursedItem.viewmodel ?? cursedItem.dropModel;
      offerGroup = buildModel(offeringSpec).group;
      offerGroup.position.copy(pos);
      offerGroup.position.y += restingY;
      offerGroup.rotation.set(0.15, rotY, 0.20);
      scene.add(offerGroup);

      registerItemPreview(ctx.id, cursedItem, { hideStatsUntilInspect: true });
      const previewY = pos.y + restingY + 0.5;   // STABLE anchor — doesn't bob

      let phase = 0;
      const tick = (dt: number, playerPos: THREE.Vector3) => {
        phase += dt;
        offerGroup.rotation.y = rotY + phase * ROTATE_SPEED;
        offerGroup.position.y = pos.y + restingY + Math.sin(phase * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE;
        const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
        const inRange = (dx * dx + dz * dz) < PREVIEW_RANGE * PREVIEW_RANGE;
        setItemPreviewAnchor(ctx.id, pos.x, previewY, pos.z, inRange);
        // Stats only when THIS altar is the highlighted interactable.
        setItemPreviewInspected(ctx.id, getInRangeInteractable() === ctx.self);
      };
      return { group: offerGroup, tick };
    },
    onUse: () => {
      // Burst first (anchored at the altar, before the HP price the factory pays
      // next), then grant + auto-equip.
      const burstY = pos.y + baseH + topH + 0.30;
      spawnBloodBurst(scene, pos.x, burstY, pos.z);
      const inst = rollItemInstance(cursedItem);
      addItem(cursedItem.id, instanceDisplayName(inst));
      if (tryAutoEquip(cursedItem, inst.affixes)) removeItem(cursedItem.id);   // moved to a slot — drop the bag copy
      playEquipClick();
      return { itemIds: [cursedItem.id], hpDelta: -BLOOD_PRICE_HP };
    },
    onDestroy: () => {
      scene.remove(offerGroup);
      disposeBuiltTree(offerGroup);
      discMat.opacity = 0.18;   // altar reads "spent" but stays as a marker
      unregisterItemPreview(previewId);
      onDestroy?.();
    },
  });
}
