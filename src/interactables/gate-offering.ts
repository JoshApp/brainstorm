import * as THREE from 'three';
import { spawnEvent } from './event-factory';
import { registerEncounter, activateEncounter } from '../encounters/registry';
import { stdMat } from '../style/material-registry';
import { registerLight, unregisterLight } from '../scene/light-pool';
import { generateEntityId } from '../ecs/world';
import { showInscription } from '../ui/inscription';
import { playRitualBell } from '../audio/sfx';
import { kickShake } from '../combat/screen-shake';
import type { StyleMaterials } from '../style/materials';

// GATE OFFERING (#74) — a room-wide LOCK you resolve by giving something. Until
// the offering is taken, every chest bound to its `gateId` is SEALED (violet
// seal-disc; won't open). Taking it completes the gate's encounter and each
// bound chest releases together — "an offering that unlocks the rest of the
// room." The offering itself need not be generous; its point is the KEY it turns.
//
// It owns the encounter: registers + activates on spawn (so the chests read
// sealed), and completes it in onUse. You can always walk away — a sealed chest
// is skipped loot, never a trap. Built on spawnEvent like the other shrines.

const SEAL_COLOR = 0x8a4bd6;   // violet — matches the sealed-chest seal-disc
// The toll the room asks to break its seals — a modest GOLD offering, so the
// gate is a real decision (pay to claim the hoard, or leave it) rather than a
// free unlock. Skippable: broke or unwilling, you just walk past the sealed loot.
const GATE_COST_GOLD = 25;

export function spawnGateOffering(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  gateId: string,
  materials?: StyleMaterials,
): void {
  const stone = materials?.wall ?? stdMat({ color: 0x3a342c, roughness: 0.95, metalness: 0, flatShading: true });
  // Own the gate: active from spawn so bound chests read it as sealed.
  const handle = registerEncounter(gateId, {});
  activateEncounter(gateId);

  const lightId = generateEntityId('gate-offering-light');
  let intensity = 1.6;
  registerLight({
    id: lightId, category: 'pickup',
    position: new THREE.Vector3(pos.x, pos.y + 0.7, pos.z),
    color: SEAL_COLOR, intensity: 1.6, distance: 3.2, decay: 1.7,
    getIntensity: () => intensity,
  });

  spawnEvent({
    kind: 'gate-offering',
    scene, pos, rotY,
    radius: 1.6,
    promptLabel: 'MAKE THE OFFERING',
    promptKind: 'bargain',       // violet — a bargain with the room
    cost: { gold: GATE_COST_GOLD },   // shows the "25 ◎" chip; the factory deducts it
    family: 'bargain',
    build: () => {
      const group = new THREE.Group();
      group.position.copy(pos);
      group.rotation.y = rotY;
      scene.add(group);

      // A low hexagonal plinth with a shallow bowl — the thing you give TO.
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.5, 6), stone);
      plinth.position.y = 0.25;
      plinth.castShadow = true; plinth.receiveShadow = true;
      group.add(plinth);

      const bowlMat = stdMat({ color: 0x1a1020, emissive: SEAL_COLOR, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.0 });
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.07, 12), bowlMat);
      bowl.position.y = 0.535;
      group.add(bowl);

      // A slow violet sigil breath so it reads as a live seal, not a dead prop.
      let phase = 0;
      const tick = (dt: number) => {
        phase += dt;
        intensity = 1.6 * (0.85 + 0.25 * Math.sin(phase * 2.4));
        bowlMat.emissiveIntensity = 1.0 * (0.8 + 0.3 * Math.sin(phase * 2.4));
      };
      return { group, tick };
    },
    onUse: () => {
      // The seals let go — every chest polling this gate opens for business.
      handle.complete();
      intensity = 0.3;   // spent — dim to a banked ember
      playRitualBell(pos);
      kickShake(0.10, 0.25);
      showInscription('You give what the room asks. The seals let go.', { holdMs: 2600 });
      return {};
    },
    onDestroy: () => { unregisterLight(lightId); },
  });
}
