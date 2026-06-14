import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { CHEST, CHEST_IRON, CHEST_BOSS } from '../content/chest';
import type { ItemSpec } from '../content/items';
import { registerInteractable, unregisterInteractable } from './system';
import { createPickup } from './pickup';
import { playChestOpen } from '../audio/sfx';
import { spawnGoldCoins } from '../effects/gold-coins';
import { recordChestOpened } from '../state/character';

export type ChestTier = 'supply' | 'iron' | 'boss';

// Gold a chest spews when it rolled no item (the "coin cache" fallback) — a
// satisfying bundle, scaled by tier. The gold-coins effect bundles these into
// a few chunky coins, so the count reads as "a small fortune," not litter.
const COIN_CACHE_GOLD: Record<ChestTier, number> = { supply: 14, iron: 26, boss: 48 };

const TIER_MODEL = {
  supply: CHEST,
  iron: CHEST_IRON,
  boss: CHEST_BOSS,
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
  loot: ItemSpec | undefined,
  tier: ChestTier = 'supply',
  isMimic: boolean = false,
  onMimic?: (worldPos: THREE.Vector3) => void,
) {
  const built = buildModel(TIER_MODEL[tier]);
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  const hinge = built.slots.get('hinge');
  const lootSpawnSlot = built.slots.get('loot_spawn');
  // Track the lid's authored Y so the mimic breathing can offset from
  // it without drifting.
  const lidPart = built.parts.get('lid');
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
    onUse() {
      if (state !== 'closed') return;
      state = 'opening';
      openTimer = 0;
      interactable.promptLabel = '';
      playChestOpen();
      recordChestOpened();
      // On reveal, settle the lid back to its base Y before swinging
      // — otherwise the residual breath offset would briefly fight
      // the open animation.
      if (isMimic && lidPart) lidPart.position.y = lidBaseY;
    },
    tick(dt: number) {
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
            const worldPos = new THREE.Vector3();
            built.group.getWorldPosition(worldPos);
            scene.remove(built.group);
            onMimic(worldPos);
          } else if (loot && lootSpawnSlot) {
            // Normal chest — spawn the loot pickup beside it.
            const worldPos = new THREE.Vector3();
            lootSpawnSlot.getWorldPosition(worldPos);
            createPickup(scene, worldPos, loot);
          } else if (lootSpawnSlot) {
            // No item rolled — don't gape empty. It's a COIN CACHE: spew a
            // bundle of coins (the gold-coins effect arcs them out + they home
            // to you). Scaled by tier so a boss chest pays more.
            const worldPos = new THREE.Vector3();
            lootSpawnSlot.getWorldPosition(worldPos);
            spawnGoldCoins(scene, worldPos, COIN_CACHE_GOLD[tier]);
          }
        }
      }
    },
    built,
  };
  registerInteractable(interactable);
}
