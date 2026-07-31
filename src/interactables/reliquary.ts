import * as THREE from 'three';
import { getInRangeInteractable } from './system';
import { spawnEvent } from './event-factory';
import { registerLight } from '../scene/light-pool';
import { buildModel } from '../ecs/build-model';
import { rollDropItem } from '../content/drop-tables';
import { ITEMS, type ItemSpec } from '../content/items';
import { createPickup } from './pickup';
import { gameRng } from '../engine/rng';
import { playRitualBell } from '../audio/sfx';
import { registerItemPreview, setItemPreviewAnchorAbove, setItemPreviewInspected, unregisterItemPreview } from '../ui/item-preview';
import { TRANSACTION_TINTS } from '../content/transactions';
import type { StyleMaterials } from '../style/materials';
import { disposeBuiltTree } from '../style/material-registry';

// ── THE RELIQUARY — locked show-and-tell (PRICED family) ─────────────
//
// An iron cage on a stone pedestal, gold-lit, prize FLOATING visible between
// the bars. The price is a skeleton key — stated on the prompt (the "give 🔑"
// chip). Built on spawnEvent: the factory owns the id, the key cost + its
// affordability gate (the old manual getCount check → the factory's "Locked. It
// wants a key." message), the priced transaction emits, and the preview handle.
// This file keeps the cage geometry, the floating-prize tick, and the unlock.

const KEY_ID = 'skeleton-key';

export function spawnReliquary(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  depth: number,
  materials: StyleMaterials,
): void {
  const tint = TRANSACTION_TINTS.priced;
  let opened = false;
  let phase = gameRng() * Math.PI * 2;
  let prizeGroup: THREE.Group | null = null;
  let cage!: THREE.Group;
  const BAR_H = 0.62;

  // The prize — pre-rolled at spawn, generous (locked > free), shown.
  const prize: ItemSpec = rollDropItem('reliquary', depth, gameRng) ?? ITEMS['flask-draught'];

  spawnEvent({
    kind: 'reliquary',
    scene,
    pos,
    radius: 1.6,
    labelOffsetY: 1.5,
    promptLabel: 'UNLOCK',
    cost: { itemId: KEY_ID },   // "give 🔑"; the factory blocks + messages if you lack one
    family: 'priced',
    previewItem: prize,
    keepBuiltOnDestroy: true,
    autoFinish: false,          // the cage sinks + stays; it does not vanish
    build: (ctx) => {
      // ── Geometry ──
      const group = new THREE.Group();
      group.position.copy(pos);
      const stone = materials.wall;
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.38, 0.55, 10), stone);
      pedestal.position.y = 0.275;
      pedestal.castShadow = true; pedestal.receiveShadow = true;
      group.add(pedestal);

      const ironMat = new THREE.MeshStandardMaterial({ color: 0x16140f, roughness: 0.55, metalness: 0.8, flatShading: true });
      cage = new THREE.Group();
      const BAR_R = 0.26;
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
      const cap = new THREE.Mesh(new THREE.SphereGeometry(BAR_R + 0.02, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), ironMat);
      cap.position.y = 0.55 + BAR_H - 0.04;
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({
        color: 0x8a6a28, roughness: 0.4, metalness: 0.9, emissive: tint.accent, emissiveIntensity: 0.8,
      }));
      finial.position.y = 0.55 + BAR_H + 0.12;
      cage.add(cap, finial);
      group.add(cage);
      scene.add(group);

      // The prize floats inside the cage.
      if (prize.dropModel) {
        prizeGroup = buildModel(prize.dropModel).group;
        prizeGroup.position.set(pos.x, pos.y + 0.86, pos.z);
        scene.add(prizeGroup);
      }

      // Gold light — PRICED signal, candle-class flicker (a lit shrine).
      const flickSeed = gameRng() * Math.PI * 2;
      registerLight({
        id: `${ctx.id}-glow`, category: 'pickup',
        position: new THREE.Vector3(pos.x, pos.y + 0.9, pos.z),
        color: tint.light, intensity: 2.6, distance: 6.5, decay: 1.8,
        getIntensity: () => {
          const t = performance.now() / 1000;
          return 2.6 * (1 + 0.10 * (0.6 * Math.sin(t * 5.3 + flickSeed) + 0.4 * Math.sin(t * 8.1 + flickSeed * 2)));
        },
      });

      registerItemPreview(ctx.id, prize, { hideStatsUntilInspect: true });
      const PREVIEW_RANGE = 4.0;

      const tick = (dt: number, playerPos: THREE.Vector3) => {
        if (opened) {
          // Cage sinks into the pedestal after opening, then stops.
          if (cage.position.y > -BAR_H - 0.3) cage.position.y -= dt * 0.8;
          return;
        }
        phase += dt;
        if (prizeGroup) {
          prizeGroup.rotation.y = phase * 0.6;
          prizeGroup.position.y = pos.y + 0.86 + Math.sin(phase * 1.3) * 0.025;
        }
        const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
        const inRange = dx * dx + dz * dz < PREVIEW_RANGE * PREVIEW_RANGE;
        if (prizeGroup) setItemPreviewAnchorAbove(ctx.id, prizeGroup, inRange);
        setItemPreviewInspected(ctx.id, getInRangeInteractable() === ctx.self);
      };
      return { group, tick };
    },
    onUse: (ctx) => {
      opened = true;
      playRitualBell({ x: pos.x, y: pos.y + 0.9, z: pos.z });
      // The cage sinks (tick); the prize becomes a pickup on the pedestal.
      if (prizeGroup) { scene.remove(prizeGroup); disposeBuiltTree(prizeGroup); prizeGroup = null; }
      createPickup(scene, new THREE.Vector3(pos.x, 0.9, pos.z), prize);
      unregisterItemPreview(ctx.id);
      return { itemIds: [prize.id] };
    },
  });
}
