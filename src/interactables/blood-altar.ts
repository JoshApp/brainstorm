import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { spawnEvent } from './event-factory';
import { groundEquip } from '../player/ground-equip';
import { dropGearPickup } from './pickup';
import { rollItemInstance } from '../player/item-instance';
import { spawnBloodBurst } from '../effects/blood-burst';
import { playEquipClick } from '../audio/sfx';
import { RARITY_COLORS } from '../content/items';
import type { ItemSpec } from '../content/items';
import type { StyleMaterials } from '../style/materials';
import { disposeBuiltTree } from '../style/material-registry';
import { applyBrokenness } from './brokenness';
import { getPlayerMaxHp } from '../player/health';
import { CONFIG } from '../config';

// Blood altar — a stone block with a CURSED offering floating above it, washed
// in violet glow. Taking it ALWAYS costs blood (can kill at low HP).
// Now built on spawnEvent: the factory owns the id, the −4 ❤ cost chip, the
// central HP deduction (cost.hp), the bargain transaction emits, and teardown.
// This file keeps only the bespoke visuals (the leaning basin + floating,
// bobbing offering) and the effect (burst + grant). The offering's item CARD is
// the shared item-overlay (via `previewItem` on the interactable) — the same
// panel every floor pickup + reward uses — so there is ONE display, not the old
// floating-label + card duplicate.
//
// Order note: the factory runs the effect (blood burst + grant) BEFORE paying
// the HP cost, so the burst still anchors at the altar before a lethal take.

/** What the altar charges, right now, in hit points. A FRACTION of the live max
 *  pool (CONFIG.BLOOD_PRICE.ALTAR) rather than a flat number — this was hard-
 *  coded at 4 back when the pool was 8, and stayed 4 when the pool became 5,
 *  which quietly turned "half your health" into four fifths of it. */
function bloodPriceHp(): number {
  return Math.max(1, Math.round(getPlayerMaxHp() * CONFIG.BLOOD_PRICE.ALTAR));
}

const ROTATE_SPEED = 0.6;
const BOB_AMPLITUDE = 0.030;
const BOB_FREQUENCY = 0.7;   // slow, dreamy hover

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
    cost: { hp: bloodPriceHp() },   // shows the live price on the chip; deducted centrally
    family: 'bargain',
    previewItem: cursedItem,
    keepBuiltOnDestroy: true,  // the stone basin stays; onDestroy yanks only the offering
    build: (ctx) => {
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

      // The item CARD is the shared item-overlay (driven by `previewItem` on the
      // interactable). No per-altar floating label — that was the duplicate.
      let phase = 0;
      const tick = (dt: number) => {
        phase += dt;
        offerGroup.rotation.y = rotY + phase * ROTATE_SPEED;
        offerGroup.position.y = pos.y + restingY + Math.sin(phase * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE;
      };
      return { group: offerGroup, tick };
    },
    onUse: () => {
      // Burst first (anchored at the altar, before the HP price the factory pays
      // next), then grant + auto-equip.
      const burstY = pos.y + baseH + topH + 0.30;
      spawnBloodBurst(scene, pos.x, burstY, pos.z);
      // The cursed gift equips straight from the altar (no bag): an empty slot
      // takes it; full slots open the swap-or-leave compare and the piece you
      // shed drops onto the altar's stone. A relic collects into the reliquary.
      const inst = rollItemInstance(cursedItem);
      groundEquip({
        item: cursedItem,
        affixes: inst.affixes,
        onEquipped: () => {},
        dropDisplaced: (dItem, dAff) => dropGearPickup(scene, pos, dItem, dAff),
      });
      playEquipClick();
      return { itemIds: [cursedItem.id], hpDelta: -bloodPriceHp() };
    },
    onDestroy: () => {
      scene.remove(offerGroup);
      disposeBuiltTree(offerGroup);
      discMat.opacity = 0.18;   // altar reads "spent" but stays as a marker
      onDestroy?.();
    },
  });
}
