import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { mergeInteractableStatics, reportMerge } from '../ecs/merge-static';
import { generateEntityId } from '../ecs/world';
import { CHEST, CHEST_IRON, CHEST_BOSS } from '../content/chest';
import { KEY_ID, type DropResult } from '../content/drop-tables';
import { canAfford, payCost, unaffordableMessage } from './event-factory';
import { showInWorldMessage } from '../ui/pickup-notification';
import { registerInteractable, unregisterInteractable } from './system';
import { registerLight, unregisterLight } from '../scene/light-pool';
import { createPickup } from './pickup';
import { playChestOpen, playEquipClick, playDenied } from '../audio/sfx';
import { spawnGoldCoins } from '../effects/gold-coins';
import { recordChestOpened } from '../state/character';
import { emit } from '../broadcast/event-bus';
import { isEncounterComplete } from '../encounters/registry';
import { stdMat } from '../style/material-registry';
import { getTexture } from '../style/procedural-textures';

export type ChestTier = 'wood' | 'silver' | 'gold';

// Bronze = plain wood, silver = iron-bound, gold = ornate amber — the
// silhouette IS the tier's promise, read across the room.
const TIER_MODEL: Record<ChestTier, typeof CHEST> = {
  wood: CHEST,
  silver: CHEST_IRON,
  gold: CHEST_BOSS,
};

// Chest interactable. Two states: closed (default) and open.
//
// On use (when closed):
//   - Set state to opening; animate the lid hinge from 0° to ~110° backwards
//     over ~0.5s.
//   - Once open, spawn a pickup interactable (the loot) beside the chest.
//   - Become inert (can't be used again).
//
// Mimic mode (when `isMimic` is true and `onMimic` is provided):
//   - Idle: the lid breathes a tiny y-jiggle (sub-millimetre) so a careful
//     observer can catch the deception. The chest looks otherwise normal.
//   - On use: the lid SLAMS open (faster + further than the supply animation)
//     and the chest's interactable handle unregisters. The level builder's
//     onMimic callback spawns a mimic mob at this position. The chest model
//     stays in the scene as the post-reveal "abandoned husk" — when the
//     mimic dies, its body is what gets dissolved, not this prop.

const LID_OPEN_ANGLE = -1.9;     // rad — slightly past vertical so the lid leans back
const OPEN_DURATION = 0.55;      // seconds for the swing-open animation
const MIMIC_SLAM_ANGLE = -2.3;   // further back — violent
const MIMIC_SLAM_DURATION = 0.18; // fast
// Subtle idle "breathing" on a mimic's lid. Sub-millimetre y-bob +
// micro X-rotation. Visible only if you stop and watch. Real chests
// are utterly still.
const MIMIC_IDLE_BREATH_AMPL_Y = 0.0015;   // ~1.5 mm
const MIMIC_IDLE_BREATH_AMPL_ROT = 0.006;  // ~0.3°
const MIMIC_IDLE_BREATH_HZ = 0.8;          // slow lung rhythm

export function spawnChest(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  bundle: DropResult,
  tier: ChestTier = 'wood',
  isMimic: boolean = false,
  onMimic?: (worldPos: THREE.Vector3) => void,
  /** EVENT LOCK (#74): while this encounter is not complete, the chest is SEALED
   *  — it can't be opened, and a violet seal-glow marks it. Taking the room's
   *  gate offering (which completes the encounter) releases every chest bound to
   *  it. You can always walk away — a sealed chest is skipped loot, not a trap. */
  gateId?: string,
  /** CONTESTED (room modifier): fired the moment the chest is opened, BEFORE
   *  the loot spills. The prize was never hidden — only defended — so the room
   *  seals and the waves come as a consequence of you reaching for it. */
  onOpened?: () => void,
) {
  const built = buildModel(TIER_MODEL[tier]);
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  // A GOLD chest holds court — a warm amber glow marks it as a hot-spot across
  // the room (lighting doctrine: a rare light means something is here). Wood +
  // silver stay dark; only the prize tier earns the signal.
  const glowId = `${generateEntityId('chest-glow')}`;
  if (tier === 'gold') {
    registerLight({
      id: glowId, category: 'pickup',
      position: new THREE.Vector3(pos.x, pos.y + 0.55, pos.z),
      color: 0xffb040, intensity: 2.0, distance: 5.5, decay: 1.9,
      getIntensity: () => { const t = performance.now() / 1000; return 2.0 * (1 + 0.08 * Math.sin(t * 4.7)); },
    });
  }

  // EVENT LOCK (#74) — while the gate encounter is unresolved the chest is
  // SEALED: a violet seal-disc marks it, and onUse refuses. Taking the room's
  // offering completes the encounter and every bound chest releases together.
  let gated = !!gateId && !isEncounterComplete(gateId);
  let sealDisc: THREE.Mesh | null = null;
  if (gated && gateId) {
    const sealMat = stdMat({
      map: getTexture('fire-wisp'), color: 0x8a4bd6, emissive: 0x8a4bd6, emissiveIntensity: 1.1,
      transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, fog: false, depthWrite: false,
    });
    sealDisc = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), sealMat);
    sealDisc.rotation.x = -Math.PI / 2;
    sealDisc.position.set(pos.x, pos.y + 0.02, pos.z);
    scene.add(sealDisc);
    // Release is POLLED in tick (isEncounterComplete) rather than a bus
    // subscription — the chest has no teardown hook, so a listener would leak
    // across floors; a per-frame Map lookup while sealed is cheaper anyway.
  }

  const hinge = built.slots.get('hinge');
  const lootSpawnSlot = built.slots.get('loot_spawn');
  // Track the lid's authored Y so the mimic breathing can offset from
  // it without drifting.
  const lidPart = built.parts.get('lid');
  // Collapse the chest's own static meshes now that the parts it animates are
  // in hand. 'lid', 'hinge' and 'loot_spawn' are protected (they are in
  // parts/slots), and the merge never crosses a group, so the lid still swings
  // — carrying one merged mesh instead of several.
  reportMerge('chest', mergeInteractableStatics(built, { label: 'chest-merged' }));
  const lidBaseY = lidPart?.position.y ?? 0;

  let state: 'closed' | 'opening' | 'open' = 'closed';
  let openTimer = 0;
  // Per-instance phase so a cluster of mimic chests don't all breathe
  // in unison (the lockstep would itself be a tell).
  const mimicPhase = Math.random() * Math.PI * 2;
  let breathT = 0;
  const id = generateEntityId('chest');

  const interactable = {
    id,
    position: pos.clone(),
    radius: 1.4,
    promptLabel: 'OPEN',
    // A GOLD chest wants a key. This is the key's reason to exist: a currency
    // needs its own doors or it's just a second coin. Wood and silver open free —
    // they pay pickups — so the key is only ever spent on the tier that holds a
    // build piece. Routed through the same central applier every other priced
    // thing uses, so the refusal message and the deduction stay consistent.
    cost: tier === 'gold' ? { itemId: KEY_ID } : undefined,
    onUse() {
      if (state !== 'closed') return;
      if (tier === 'gold' && !canAfford({ itemId: KEY_ID })) {
        showInWorldMessage(unaffordableMessage({ itemId: KEY_ID }));
        playDenied();
        return;
      }
      // EVENT-GATED: sealed until the room's offering is taken. Skippable — you
      // can leave it — but not openable while the seal holds.
      if (gated) {
        showInWorldMessage('Sealed. An offering holds it.');
        playEquipClick();
        return;
      }
      if (tier === 'gold') payCost({ itemId: KEY_ID });
      state = 'opening';
      openTimer = 0;
      interactable.promptLabel = '';
      // CONTESTED: springs before the lid finishes — the fight starts as you
      // reach, not after you've pocketed the reward.
      onOpened?.();
      playChestOpen();
      recordChestOpened();
      // Economy-lane hook: Greed relics trigger on this (ecs/triggers.ts).
      emit({ type: 'chest:opened', tier });
      // On reveal, settle the lid back to its base Y before swinging
      // — otherwise the residual breath offset would briefly fight
      // the open animation.
      if (isMimic && lidPart) lidPart.position.y = lidBaseY;
    },
    tick(dt: number) {
      // EVENT LOCK release — the room's offering completed the gate; drop the
      // seal (polled, not subscribed — see the seal setup above).
      if (gated && gateId && isEncounterComplete(gateId)) {
        gated = false;
        if (sealDisc) { scene.remove(sealDisc); sealDisc = null; }
        playEquipClick();
      }
      if (sealDisc) {
        // Faint violet breath so the seal reads as live magic, not decor.
        const m = sealDisc.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 0.9 + 0.4 * (0.5 + 0.5 * Math.sin(breathT * 3));
        breathT += dt;
      }
      // Idle breathing on a mimic's lid — slow vertical bob + a
      // sympathetic micro-rotation through the hinge. Stops the
      // moment the chest opens.
      if (isMimic && state === 'closed' && lidPart && hinge) {
        breathT += dt;
        const phase = breathT * MIMIC_IDLE_BREATH_HZ * Math.PI * 2 + mimicPhase;
        lidPart.position.y = lidBaseY + Math.sin(phase) * MIMIC_IDLE_BREATH_AMPL_Y;
        hinge.rotation.x = Math.sin(phase + 0.7) * MIMIC_IDLE_BREATH_AMPL_ROT;
      }
      if (state === 'opening' && hinge) {
        openTimer += dt;
        const duration = isMimic ? MIMIC_SLAM_DURATION : OPEN_DURATION;
        const targetAngle = isMimic ? MIMIC_SLAM_ANGLE : LID_OPEN_ANGLE;
        const t = Math.min(1, openTimer / duration);
        // Mimic slam: snap accelerating ease-in (the lid is THROWN
        // open). Real chest: ease-out (it settles open).
        const ease = isMimic ? t * t : 1 - (1 - t) * (1 - t);
        hinge.rotation.x = targetAngle * ease;
        if (openTimer >= duration) {
          state = 'open';
          if (isMimic && onMimic) {
            // Mimic reveal — hand off to the builder to spawn the
            // mob in the right room context. Pull our own
            // interactable off the registry so the OPEN prompt
            // can't re-trigger. Also yank the disguise mesh from
            // the scene so it doesn't sit visibly overlapping with
            // the mimic mob's own body.
            unregisterInteractable(id);
            if (tier === 'gold') unregisterLight(glowId);   // the disguise + its glow go with the reveal
            const worldPos = new THREE.Vector3();
            built.group.getWorldPosition(worldPos);
            scene.remove(built.group);
            onMimic(worldPos);
          } else if (lootSpawnSlot) {
            // Normal chest — spawn the rolled BUNDLE (content/drop-tables.ts):
            // each item as a pickup (spread so they don't stack on one pixel),
            // plus any gold (a whiffed roll pays emptyGold, so it never gapes).
            const worldPos = new THREE.Vector3();
            lootSpawnSlot.getWorldPosition(worldPos);
            const N = bundle.items.length;
            bundle.items.forEach((item, i) => {
              const p = worldPos.clone();
              p.x += (i - (N - 1) / 2) * 0.35;
              createPickup(scene, p, item);
            });
            if (bundle.gold > 0) spawnGoldCoins(scene, worldPos, bundle.gold);
          }
        }
      }
    },
    built,
  };
  registerInteractable(interactable);
}
