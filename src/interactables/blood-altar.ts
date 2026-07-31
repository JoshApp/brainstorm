import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, getInRangeInteractable } from './system';
import { tryAutoEquip } from '../player/equipment';
import { addItem, removeItem } from '../player/inventory';
import { rollItemInstance, instanceDisplayName } from '../player/item-instance';
import { damagePlayer } from '../player/health';
import { spawnBloodBurst } from '../effects/blood-burst';
import { playEquipClick } from '../audio/sfx';
import { RARITY_COLORS } from '../content/items';
import { emit } from '../broadcast/event-bus';
import { registerItemPreview, setItemPreviewAnchor, setItemPreviewInspected, unregisterItemPreview } from '../ui/item-preview';
import type { ItemSpec } from '../content/items';
import type { StyleMaterials } from '../style/materials';
import { disposeBuiltTree } from '../style/material-registry';
import { applyBrokenness } from './brokenness';

// Blood altar — a stone block with a CURSED offering floating above
// it, washed in violet glow. Taking it ALWAYS damages the player
// (BLOOD_PRICE HP, can kill at low HP). On take:
//
//   1. damagePlayer fires — full crunch stack (hit-pause + shake +
//      vignette + sfx) and a player:killed event if it drops you to 0.
//   2. blood burst at the altar (red sprites + droplets).
//   3. Item enters inventory and auto-equips if the slot is free.
//   4. The floating offer vanishes via the unified interactables
//      cleanup hook; the stone block stays as a monument.
//
// Visual cue: the offered item floats with a violet halo (cursed
// rarity tint) so the player can read "this is cursed" before
// committing. A diegetic hint reinforces the price.

// HP COST. Half the base PLAYER_HP_MAX so it's a real bet — at high
// HP the trade is "I lose half my buffer for permanent power"; at
// low HP it's "I might die for this." Both fit the gamble brief.
const BLOOD_PRICE_HP = 4;

const ROTATE_SPEED = 0.6;
const BOB_AMPLITUDE = 0.030;
const BOB_FREQUENCY = 0.7;   // slow, dreamy hover (was 1.4 — read as jittery)

export function spawnBloodAltar(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  cursedItem: ItemSpec,
  materials: StyleMaterials,
  onDestroy?: () => void,
) {
  // ── Stone group (stays after the offering is gone, like the
  // starter altars). Slightly darker silhouette than the regular
  // altars — implied by using the wall material with a small wider
  // basin top so it reads as a "blood basin," not a chest plinth.
  const stoneGroup = new THREE.Group();
  stoneGroup.position.copy(pos);
  stoneGroup.rotation.y = rotY;
  scene.add(stoneGroup);

  const baseH = 0.62;
  const baseW = 0.78;
  const baseD = 0.62;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(baseW, baseH, baseD),
    materials.wall,
  );
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  stoneGroup.add(base);

  const topW = baseW + 0.10;
  const topD = baseD + 0.10;
  const topH = 0.08;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(topW, topH, topD),
    materials.wall,
  );
  top.position.y = baseH + topH / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  stoneGroup.add(top);

  // Cursed-violet floor disc UNDER the offering — visual signature
  // for "this isn't a normal altar." Additive so it glows over the
  // stone slab without obscuring it.
  const discRarity = RARITY_COLORS.cursed;
  const discMat = new THREE.MeshBasicMaterial({
    color: discRarity,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(topW * 0.85, topD * 0.85),
    discMat,
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = baseH + topH + 0.005;
  stoneGroup.add(disc);

  // Half-broken treatment — the basin has stood here a long time. Position-seeded
  // so a re-render of this floor decays it identically. The disc is re-levelled
  // afterward so the violet glow still reads flat on the (now-leaning) slab.
  let bs = (((pos.x * 73856093) ^ (pos.z * 19349663)) >>> 0) || 1;
  const brand = () => { bs = (Math.imul(bs, 1664525) + 1013904223) >>> 0; return bs / 0x100000000; };
  applyBrokenness(stoneGroup, 0.5, brand);
  disc.rotation.set(-Math.PI / 2, 0, 0);   // keep the glow disc flat despite the lean

  // ── Offered item — separate scene-graph root so destroy can yank
  // only the offering. Mirrors starter-altar's split-roots pattern.
  const offeringSpec = cursedItem.viewmodel ?? cursedItem.dropModel;
  const built = buildModel(offeringSpec);
  const offerGroup = built.group;
  const restingY = baseH + topH + 0.32;
  offerGroup.position.copy(pos);
  offerGroup.position.y += restingY;
  offerGroup.rotation.set(0.15, rotY, 0.20);
  scene.add(offerGroup);

  const id = generateEntityId('blood-altar');
  let phase = 0;
  let taken = false;
  let offerSeen = false;

  // Item-preview label. Blood altars charge 4 HP up front; the player
  // needs to KNOW what they're paying for before tapping TAKE. The
  // preview shows when the player is within PREVIEW_RANGE so the
  // offering can be IDENTIFIED (name + flavour) from a few steps
  // away — STATS are gated on inspection (= you're the highlighted
  // interactable), so you have to lean in to read the price. That's
  // the gamble beat: name + flavour set the tone, stats are the
  // contract, and you only see the contract once you've committed
  // to actually approach the altar.
  const PREVIEW_RANGE = 4.0;
  registerItemPreview(id, cursedItem, { hideStatsUntilInspect: true });
  // Description box anchors to a STABLE height above the altar — NOT the live
  // (bobbing) offering position — so it sits still instead of jittering up and
  // down with the hover (which read as nauseating).
  const previewY = pos.y + restingY + 0.5;

  const interactable: import('./types').Interactable = {
    id,
    position: pos.clone(),
    radius: 1.6,
    // Prompt sits LOW (at the altar top, below the floating offering) so it
    // doesn't collide with the offering + its description box stacked above.
    labelOffsetY: 0.55,
    promptLabel: 'OFFER',     // you give blood for it — not a plain TAKE
    promptKind: 'bargain',    // violet — a cursed bargain, read the stakes
    cost: { hp: BLOOD_PRICE_HP },  // shows the "−4 ❤" price chip before you commit

    built: {
      group: offerGroup,
      parts: new Map(),
      slots: new Map(),
      materials: new Map(),
      hitTargets: [],
    },
    keepBuiltOnDestroy: true,
    onUse() {
      if (taken) return;
      taken = true;
      // Unified transaction stream (content/transactions.ts): a blood
      // altar is the BARGAIN family — visible cursed goods, painful
      // immediate price.
      emit({ type: 'transaction:accepted', family: 'bargain', id, price: { hp: BLOOD_PRICE_HP } });
      // Order matters: trigger the blood burst at the altar's centre
      // FIRST so the visual is anchored to the offering, not to the
      // dying player camera if this kill drops you. Then apply
      // damage (which may flip dying=true), then add the item.
      const burstY = pos.y + baseH + topH + 0.30;
      spawnBloodBurst(scene, pos.x, burstY, pos.z);
      damagePlayer(BLOOD_PRICE_HP, null, 'physical', false, 'their own bargain');
      // Add to inventory (with affix roll like a normal pickup) and
      // auto-equip if the slot is free. If full, item stays in the
      // bag — player can manually equip later.
      const inst = rollItemInstance(cursedItem);
      const displayName = instanceDisplayName(inst);
      addItem(cursedItem.id, displayName);
      if (tryAutoEquip(cursedItem, inst.affixes)) {
        // The item moved to a slot — remove the bag copy so it
        // doesn't double-count.
        removeItem(cursedItem.id);
      }
      playEquipClick();
      emit({ type: 'transaction:resolved', family: 'bargain', id, outcome: { itemIds: [cursedItem.id], hpDelta: -BLOOD_PRICE_HP } });
      // Mark for the system tick to run onDestroy next frame —
      // tears down the offering mesh + fires the owner cleanup.
      interactable.destroyed = true;
      interactable.promptLabel = '';
    },
    tick(dt: number, playerPos: THREE.Vector3) {
      if (taken) return;
      phase += dt;
      offerGroup.rotation.y = rotY + phase * ROTATE_SPEED;
      offerGroup.position.y = pos.y + restingY + Math.sin(phase * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE;
      // Show the preview only when the player is in approach range —
      // not constantly across the floor, since blood altars are a
      // commitment beat, not a picker.
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      const inRange = (dx * dx + dz * dz) < PREVIEW_RANGE * PREVIEW_RANGE;
      if (inRange && !offerSeen) {
        offerSeen = true;
        emit({ type: 'transaction:offered', family: 'bargain', id });
      }
      setItemPreviewAnchor(id, pos.x, previewY, pos.z, inRange);   // STABLE anchor — doesn't bob
      // Stats only when this altar is the one the player is actually
      // highlighting — i.e. in interact range AND looking at it. The
      // existing in-range check from the interactables system already
      // encodes both, so we just ask "am I the highlighted one?".
      setItemPreviewInspected(id, getInRangeInteractable() === interactable);
    },
    destroyed: false,
    onDestroy() {
      scene.remove(offerGroup);
      disposeBuiltTree(offerGroup);
      // Also dim the violet disc — the altar is "spent" after the
      // offering is taken. Stays visible as a marker but quieter.
      discMat.opacity = 0.18;
      unregisterItemPreview(id);
      onDestroy?.();
    },
  };
  registerInteractable(interactable);
}
