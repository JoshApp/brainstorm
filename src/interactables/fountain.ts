import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { gameRngChance } from '../engine/rng';
import { registerLight } from '../scene/light-pool';
import { healPlayer, getPlayerMaxHp, getPlayerHp } from '../player/health';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { playHealSlurp, playBuffApply } from '../audio/sfx';
import { showNote } from '../ui/note-card';

// Fountain = a basin of suspect liquid. Two variants:
//
//   'gamble' (DUNGEON): DRINK gambles 50/50. Heal-to-full or a -1 weapon
//                       damage & -1 physical armour curse for ~5 minutes.
//                       Sickly green emissive, sells "this is suspect."
//
//   'rest'   (SAFE ROOM): REST always heals to full. No curse. Warm
//                         amber emissive — reads as clean water,
//                         a kindness between acts.
//
// One-use per fountain. After interacting, the prompt disappears and the
// liquid drains visually (basin shows the dry stone bottom). A short note
// pops describing what happened — both because feedback matters and
// because it fits the dungeon's in-world voice better than a number popup.

const CURSE_DURATION = 300;  // 5 minutes — effectively rest of an early run

export type FountainVariant = 'gamble' | 'rest';

export function spawnFountain(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  variant: FountainVariant = 'gamble',
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

  // Liquid — emissive disc on top.
  //   'gamble' — sickly green; reads as "wrong" the moment the player
  //              sees it. The 50/50 risk is in the colour.
  //   'rest'   — warm amber; reads as clean firelight in the basin,
  //              a refuge between acts.
  const liquidMat = new THREE.MeshStandardMaterial({
    color:     variant === 'rest' ? 0x3a2818 : 0x2a3a22,
    emissive:  variant === 'rest' ? 0xffb070 : 0x66ff88,
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

  // Soft glow registered with the global light pool. Intensity is read
  // each frame via getIntensity so we can dim it after the fountain is
  // drunk (sets the fountainState.intensity to 0.2).
  const fountainState = { intensity: 1.8 };
  registerLight({
    id: `fountain-${generateEntityId('fountain-light')}`,
    category: 'environment',
    position: new THREE.Vector3(pos.x, pos.y + 0.95, pos.z),
    color: variant === 'rest' ? 0xffc890 : 0x88ffaa,
    intensity: 1.8,
    distance: 2.4,
    decay: 1.6,
    getIntensity: () => fountainState.intensity,
  });

  let used = false;

  const interactable = {
    id: generateEntityId('fountain'),
    position: pos.clone(),
    radius: 1.3,
    promptLabel: variant === 'rest' ? 'REST' : 'DRINK',
    onUse() {
      if (used) return;
      used = true;
      interactable.promptLabel = '';

      // Drain the liquid visually — hide the emissive disc, dim the glow.
      liquid.visible = false;
      fountainState.intensity = 0.2;

      if (variant === 'rest') {
        // Safe-room fountain — no gamble. Always a clean mend.
        const before = getPlayerHp();
        healPlayer(getPlayerMaxHp());
        const healed = getPlayerMaxHp() - before;
        playHealSlurp();
        showNote(
          healed > 0
            ? 'The water is clean. Something in you settles.'
            : 'The water is clean. You were already whole.',
        );
        return;
      }

      // Dungeon fountain — 50/50 gamble. Seeded so a run is reproducible.
      const blessed = gameRngChance(0.5);
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
