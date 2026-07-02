import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, getInRangeInteractable } from './system';
import { registerLight } from '../scene/light-pool';
import { buildModel } from '../ecs/build-model';
import { rollLoot } from '../content/loot';
import { ITEMS, type ItemSpec } from '../content/items';
import { getCount, removeItem } from '../player/inventory';
import { createPickup } from './pickup';
import { gameRng } from '../engine/rng';
import { showInWorldMessage } from '../ui/pickup-notification';
import { playEquipClick, playRitualBell } from '../audio/sfx';
import { registerItemPreview, setItemPreviewAnchorAbove, setItemPreviewInspected, unregisterItemPreview } from '../ui/item-preview';
import { emit } from '../broadcast/event-bus';
import { TRANSACTION_TINTS } from '../content/transactions';
import type { StyleMaterials } from '../style/materials';

// ── THE RELIQUARY — locked show-and-tell (PRICED family) ─────────────
//
// An iron cage on a stone pedestal, gold-lit, with the prize FLOATING
// visible between the bars. The price is a skeleton key — stated on
// the prompt, no strings, no gamble. The tension isn't "what is it"
// (you can see it) or "what does it cost" (one key): it's ROUTING —
// keys are scarce, and spending one here means not having it for
// whatever's locked two floors down.
//
// Family contract (content/transactions.ts): PRICED·gold. You see the
// goods, you see the price, you choose. The grimmest thing about a
// reliquary is walking away from one.

const KEY_ID = 'skeleton-key';

export function spawnReliquary(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  depth: number,
  materials: StyleMaterials,
): void {
  const id = generateEntityId('reliquary');
  const tint = TRANSACTION_TINTS.priced;
  let opened = false;
  let offerSeen = false;
  let phase = gameRng() * Math.PI * 2;

  // The prize — pre-rolled at spawn, generous (locked > free), shown.
  const prize: ItemSpec =
    rollLoot({ depth, bias: 4 }, gameRng) ?? ITEMS['flask-draught'];

  // ── Geometry ──
  const group = new THREE.Group();
  group.position.copy(pos);
  const stone = materials.wall;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.38, 0.55, 10), stone);
  pedestal.position.y = 0.275;
  pedestal.castShadow = true; pedestal.receiveShadow = true;
  group.add(pedestal);

  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x16140f, roughness: 0.55, metalness: 0.8, flatShading: true,
  });
  const cage = new THREE.Group();
  const BAR_R = 0.26;
  const BAR_H = 0.62;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, BAR_H, 6), ironMat);
    bar.position.set(Math.cos(a) * BAR_R, 0.55 + BAR_H / 2, Math.sin(a) * BAR_R);
    bar.castShadow = true;
    cage.add(bar);
  }
  for (const y of [0.58, 0.55 + BAR_H - 0.03]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BAR_R, 0.018, 6, 18), ironMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    cage.add(ring);
  }
  // Domed cap with a small finial — a shrine, not a birdcage.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(BAR_R + 0.02, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), ironMat);
  cap.position.y = 0.55 + BAR_H - 0.04;
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({
    color: 0x8a6a28, roughness: 0.4, metalness: 0.9,
    emissive: tint.accent, emissiveIntensity: 0.8,
  }));
  finial.position.y = 0.55 + BAR_H + 0.12;
  cage.add(cap, finial);
  group.add(cage);
  scene.add(group);

  // The prize floats inside the cage.
  let prizeGroup: THREE.Group | null = null;
  if (prize.dropModel) {
    const built = buildModel(prize.dropModel);
    prizeGroup = built.group;
    prizeGroup.position.set(pos.x, pos.y + 0.86, pos.z);
    scene.add(prizeGroup);
  }

  // Gold light — PRICED family signal.
  // Gold light with a candle-class flicker — the cage holds a lit
  // shrine, not a lamp on a circuit.
  const flickSeed = gameRng() * Math.PI * 2;
  registerLight({
    id: `${id}-glow`, category: 'pickup',
    position: new THREE.Vector3(pos.x, pos.y + 0.9, pos.z),
    color: tint.light, intensity: 2.6, distance: 6.5, decay: 1.8,
    getIntensity: () => {
      const t = performance.now() / 1000;
      return 2.6 * (1 + 0.10 * (0.6 * Math.sin(t * 5.3 + flickSeed) + 0.4 * Math.sin(t * 8.1 + flickSeed * 2)));
    },
  });

  registerItemPreview(id, prize, { hideStatsUntilInspect: true });
  const PREVIEW_RANGE = 4.0;

  const interactable: import('./types').Interactable = {
    id,
    position: pos.clone(),
    radius: 1.6,
    labelOffsetY: 1.5,
    promptLabel: 'UNLOCK',
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    keepBuiltOnDestroy: true,
    onUse() {
      if (opened) return;
      if (getCount(KEY_ID) <= 0) {
        showInWorldMessage('Locked. It wants a key.');
        playEquipClick();
        return;
      }
      opened = true;
      removeItem(KEY_ID);
      emit({ type: 'transaction:accepted', family: 'priced', id, price: { itemId: KEY_ID } });
      playRitualBell({ x: pos.x, y: pos.y + 0.9, z: pos.z });
      // The cage sinks into the pedestal; the prize becomes a pickup.
      if (prizeGroup) {
        scene.remove(prizeGroup);
        prizeGroup.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m.dispose();
          mesh.geometry.dispose();
        });
        prizeGroup = null;
      }
      createPickup(scene, new THREE.Vector3(pos.x, 0.9, pos.z), prize);
      emit({ type: 'transaction:resolved', family: 'priced', id, outcome: { itemIds: [prize.id] } });
      interactable.promptLabel = '';
      unregisterItemPreview(id);
    },
    tick(dt: number, playerPos: THREE.Vector3) {
      if (opened) {
        // Cage sinks away after opening, then stops ticking the motion.
        if (cage.position.y > -BAR_H - 0.3) cage.position.y -= dt * 0.8;
        return;
      }
      phase += dt;
      if (prizeGroup) {
        prizeGroup.rotation.y = phase * 0.6;
        prizeGroup.position.y = pos.y + 0.86 + Math.sin(phase * 1.3) * 0.025;
      }
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      const inRange = dx * dx + dz * dz < PREVIEW_RANGE * PREVIEW_RANGE;
      if (inRange && !offerSeen) {
        offerSeen = true;
        emit({ type: 'transaction:offered', family: 'priced', id });
      }
      // Label derives from the floating prize's own top (was a fixed +1.75,
      // ~0.9m above the prize — it drove the textbox offscreen on approach).
      if (prizeGroup) setItemPreviewAnchorAbove(id, prizeGroup, inRange);
      setItemPreviewInspected(id, getInRangeInteractable() === interactable);
    },
    destroyed: false,
  };
  registerInteractable(interactable);
}
