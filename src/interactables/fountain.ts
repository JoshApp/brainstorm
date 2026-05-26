import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { healPlayer, getPlayerMaxHp, getPlayerHp } from '../player/health';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { playHealSlurp, playBuffApply } from '../audio/sfx';
import { showNote } from '../ui/note-card';

// Fountain = a basin of suspect liquid. DRINK gambles 50/50:
//   - blessing: heal to full HP
//   - curse: -1 weapon damage AND -1 physical armor for ~5 minutes (the
//            rest of a typical run on early floors)
//
// One-use per fountain. After drinking, the prompt disappears and the
// liquid drains visually (basin shows the dry stone bottom). A short note
// pops describing what happened — both because feedback matters and
// because it fits the dungeon's in-world voice better than a number popup.
//
// Visual: stone pedestal + bowl + glowing liquid disc + a soft PointLight
// from the pickup pool would be ideal, but we don't have access to it from
// here without coupling. Instead use a small dedicated point light on the
// fountain since there's only one per room — light count is fixed at
// build time.

const CURSE_DURATION = 300;  // 5 minutes — effectively rest of an early run

export function spawnFountain(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
) {
  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = rotY;
  parent.add(group);

  // Stone pedestal — short octagonal column.
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x3a342c,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.38, 0.65, 8),
    stoneMat,
  );
  pedestal.position.y = 0.325;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  // Bowl — a wider, shorter cylinder with a recessed top. We build it as
  // a torus-ring lip + a flat inner disc so the liquid sits inside.
  const bowlOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.34, 0.18, 12),
    stoneMat,
  );
  bowlOuter.position.y = 0.74;
  bowlOuter.castShadow = true;
  group.add(bowlOuter);

  // Inner dry-stone disc — visible after the fountain is drunk. Starts
  // hidden behind the liquid (slightly lower).
  const dryDiscMat = new THREE.MeshStandardMaterial({
    color: 0x1a1612,
    roughness: 1.0,
  });
  const dryDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.02, 12),
    dryDiscMat,
  );
  dryDisc.position.y = 0.81;
  group.add(dryDisc);

  // Liquid — emissive disc on top. Sickly green; reads as "wrong" the
  // moment the player sees it. The 50/50 gamble means even cautious
  // players will eventually risk it.
  const liquidMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a22,
    emissive: 0x66ff88,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0.0,
    transparent: true,
    opacity: 0.85,
    fog: false,
  });
  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.04, 16),
    liquidMat,
  );
  liquid.position.y = 0.83;
  group.add(liquid);

  // Soft glow — one PointLight (low-cost; one per fountain, not
  // dynamically allocated, so light count stays stable).
  const glow = new THREE.PointLight(0x88ffaa, 1.8, 2.4, 1.6);
  glow.position.y = 0.95;
  group.add(glow);

  let used = false;

  const interactable = {
    id: generateEntityId('fountain'),
    position: pos.clone(),
    radius: 1.3,
    promptLabel: 'DRINK',
    onUse() {
      if (used) return;
      used = true;
      interactable.promptLabel = '';

      // Drain the liquid visually — hide the emissive disc, dim the glow.
      liquid.visible = false;
      glow.intensity = 0.2;

      // 50/50 gamble. Math.random() < 0.5 → blessing; otherwise curse.
      const blessed = Math.random() < 0.5;
      if (blessed) {
        const before = getPlayerHp();
        healPlayer(getPlayerMaxHp());
        const healed = getPlayerMaxHp() - before;
        playHealSlurp();
        showNote(
          healed > 0
            ? 'The water is cold. Something inside you mends.'
            : 'The water is cold. You were already whole.',
        );
      } else {
        const player = get('player');
        if (player) applyBuff(player, 'cursed', CURSE_DURATION);
        playBuffApply();
        showNote('The water is bitter. Something inside you settles in to stay.');
      }
    },
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
