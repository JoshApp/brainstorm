import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import type { StyleMaterials } from '../style/materials';
import { activateEncounter, onEncounterComplete } from '../encounters/registry';
import { arenaEncounterId } from '../level/arena-waves';
import { createPickup } from './pickup';
import { rollLoot } from '../content/loot';
import { ITEMS, type ItemSpec } from '../content/items';
import { gameRng } from '../engine/rng';
import { showInWorldMessage } from '../ui/pickup-notification';
import { playImpact, playChestOpen } from '../audio/sfx';
import { kickShake } from '../combat/screen-shake';
import { registerLight, unregisterLight } from '../scene/light-pool';

// Challenge offering — the VOLUNTARY arena. A reliquary bound in iron chains
// sits at the centre of an open arena (no slam on entry). Approach it, accept
// the trial, and it ACTIVATES the room's wave encounter: the gate slams (a
// reactor on the encounter — see door.ts), waves come. Survive them and the
// encounter completes → the chains shatter and the hoard is yours. The reward
// is the whole point, which is why you choose to ring the bell.
//
// Pure reactor wiring on the Encounter layer: onUse = TRIGGER (activate),
// chains+loot = REACTOR (on complete). The offering knows nothing about waves
// or the gate.

const SEAM = 0xc4202a;

export function spawnChallengeOffering(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  roomId: string,
  depth: number,
  materials: StyleMaterials,
): void {
  const encId = arenaEncounterId(roomId);

  const group = new THREE.Group();
  group.position.copy(pos);
  scene.add(group);

  // Reliquary body — a dark stone coffer.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.46), materials.wall);
  body.position.y = 0.32;
  body.castShadow = true;
  group.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.5), materials.wall);
  lid.position.y = 0.63;
  group.add(lid);

  // Glowing seam between body + lid — the bound thing breathing inside.
  const seamMat = new THREE.MeshBasicMaterial({ color: SEAM, transparent: true, opacity: 0.9, fog: false });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.04, 0.48), seamMat);
  seam.position.y = 0.57;
  group.add(seam);

  // Iron chains crossing the coffer (hidden when the trial is won).
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.7, metalness: 0.6 });
  const chains: THREE.Mesh[] = [];
  for (const c of [
    { size: [0.72, 0.06, 0.06] as [number, number, number], y: 0.42, z: 0.0 },
    { size: [0.06, 0.06, 0.58] as [number, number, number], y: 0.42, z: 0.0 },
    { size: [0.72, 0.06, 0.06] as [number, number, number], y: 0.20, z: 0.0 },
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...c.size), ironMat);
    m.position.set(0, c.y, c.z);
    group.add(m);
    chains.push(m);
  }

  // Blood-red hotspot light — an UNCOMMON light source = "something here."
  const lightId = generateEntityId('challenge-light');
  registerLight({ id: lightId, category: 'pickup', position: new THREE.Vector3(pos.x, 0.6, pos.z), color: SEAM, intensity: 2.6, distance: 3.0, decay: 1.6 });

  const id = generateEntityId('challenge-offering');
  let accepted = false;
  let claimed = false;
  let phase = 0;

  const interactable: import('./types').Interactable = {
    id,
    position: pos.clone(),
    radius: 1.6,
    labelOffsetY: 1.0,
    promptLabel: 'accept the trial',
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    onUse() {
      if (accepted) return;
      accepted = true;
      interactable.promptLabel = '';
      // TRIGGER: activate the room's wave encounter → the gate seals (reactor)
      // and the waves begin. Now you have to earn it.
      activateEncounter(encId);
      showInWorldMessage('The iron will not give until the dark is fed.');
      playChestOpen();
    },
    tick(dt: number) {
      phase += dt;
      // The seam breathes; brighter + faster once the trial is on, hot when won.
      const rate = claimed ? 5 : accepted ? 3 : 1.6;
      const lo = claimed ? 0.7 : 0.45;
      seamMat.opacity = lo + 0.35 * (0.5 + 0.5 * Math.sin(phase * rate));
    },
    destroyed: false,
    onDestroy() {
      unregisterLight(lightId);
      scene.remove(group);
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
        mesh.geometry.dispose();
      });
      unsubscribe();
    },
  };
  registerInteractable(interactable);

  // REACTOR: the trial is won → shatter the chains + yield the hoard. A
  // generous bias (boss-chest tier) so the gamble pays out; always at least
  // a heal so committing is never a total loss.
  const unsubscribe = onEncounterComplete(encId, () => {
    if (claimed) return;
    claimed = true;
    for (const m of chains) m.visible = false;
    seamMat.color.setHex(0xffd0a0);
    playImpact(interactable.position);
    kickShake(0.08, 0.2);
    showInWorldMessage('Fed. The chains fall.');
    const drops: Array<ItemSpec | null> = [];
    drops.push(rollLoot({ depth, bias: 4 }, gameRng) ?? ITEMS['healing-potion'] ?? null);
    drops.push(rollLoot({ depth, bias: 3 }, gameRng));
    let i = 0;
    for (const item of drops) {
      if (!item) continue;
      const a = (i / Math.max(1, drops.length)) * Math.PI * 2;
      const dropPos = new THREE.Vector3(pos.x + Math.cos(a) * 0.5, 0.6, pos.z + Math.sin(a) * 0.5);
      createPickup(scene, dropPos, item);
      i++;
    }
  });
}
