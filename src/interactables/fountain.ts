import * as THREE from 'three';
import { generateEntityId, get } from '../ecs/world';
import { registerInteractable } from './system';
import { gameRng } from '../engine/rng';
import { registerLight } from '../scene/light-pool';
import { healPlayer, getPlayerMaxHp, getPlayerHp } from '../player/health';
import { playHealSlurp, playBuffApply } from '../audio/sfx';
import { showNote } from '../ui/note-card';
import { TAINTED_MUTATIONS } from '../content/tainted-mutations';
import { getMutationIds } from '../state/run-mutations';
import { applyMutationWithFeedback } from '../player/apply-mutation';
import { emit } from '../broadcast/event-bus';

// Fountain — a basin of suspect liquid. Three variants today:
//
//   'gamble' (DUNGEON): DRINK. Always heals to full. Sickly green-amber
//                       basin reads "found in the dark, drink at your own
//                       risk" — but the dungeon, today, is being kind.
//                       (Was a 50/50 heal/curse gamble; the curse moved
//                       to the tainted variant where the choice is in
//                       the player's hands, not in a coin flip.)
//
//   'rest'   (SAFE):    REST. Always heals to full. Warm amber glow.
//                       The clean kindness between acts.
//
//   'tainted' (SAFE):   DRINK. Applies one PERMANENT run-lifetime
//                       mutation rolled from TAINTED_MUTATIONS — mostly
//                       Faustian (gift + cost), some pure ruin, some
//                       pure gift. Dark crimson basin, slow-glowing
//                       like coals under the surface. The deliberate
//                       trade you commit to between acts.
//
// One-use per fountain. After interacting, the prompt disappears and the
// liquid drains visually. A short note pops describing what happened —
// in-world voice, never numbers.

export type FountainVariant = 'gamble' | 'rest' | 'tainted';

interface VariantStyle {
  liquidColor: number;
  liquidEmissive: number;
  lightColor: number;
  promptLabel: string;
  promptKind: 'neutral' | 'unknown';
}

const VARIANT_STYLE: Record<FountainVariant, VariantStyle> = {
  gamble: {
    liquidColor:    0x2a3a22,
    liquidEmissive: 0x66ff88,   // sickly green — but no longer cursed
    lightColor:     0x88ffaa,
    promptLabel:    'DRINK',
    promptKind:     'unknown',  // pale — looks suspect (drinks clean now, but reads as a gamble)
  },
  rest: {
    liquidColor:    0x3a2818,
    liquidEmissive: 0xffb070,   // warm amber — clean refuge water
    lightColor:     0xffc890,
    promptLabel:    'REST',
    promptKind:     'neutral',  // safe refuge water
  },
  tainted: {
    liquidColor:    0x2a0a0a,
    liquidEmissive: 0xa01828,   // dark crimson — coals under the skin
    lightColor:     0xc83838,
    promptLabel:    'DRINK',
    promptKind:     'unknown',  // pale — a permanent mutation, outcome hidden
  },
};

export function spawnFountain(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  variant: FountainVariant = 'gamble',
) {
  const style = VARIANT_STYLE[variant];

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

  // Liquid — emissive disc on top. Colour per variant; reads at a glance.
  const liquidMat = new THREE.MeshStandardMaterial({
    color:     style.liquidColor,
    emissive:  style.liquidEmissive,
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
    color: style.lightColor,
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
    promptLabel: style.promptLabel,
    promptKind: style.promptKind,
    onUse() {
      if (used) return;
      used = true;
      interactable.promptLabel = '';
      // Unified transaction stream: a drink commits BEFORE the answer —
      // the UNKNOWN family (content/transactions.ts).
      emit({ type: 'transaction:accepted', family: 'unknown', id: interactable.id, price: {} });

      // Drain the liquid visually — hide the emissive disc, dim the glow.
      liquid.visible = false;
      fountainState.intensity = 0.2;

      if (variant === 'tainted') {
        const mutationId = applyTaintedDrink();
        emit({ type: 'transaction:resolved', family: 'unknown', id: interactable.id, outcome: { mutationId } });
        return;
      }
      // Both 'gamble' and 'rest' now do the same thing — a full heal.
      // The variants still look different (green vs amber), but neither
      // gambles. The dungeon is indifferent, sometimes kind.
      const before = getPlayerHp();
      healPlayer(getPlayerMaxHp());
      const healed = getPlayerMaxHp() - before;
      emit({ type: 'transaction:resolved', family: 'unknown', id: interactable.id, outcome: { hpDelta: healed } });
      playHealSlurp();
      showNote(
        healed > 0
          ? (variant === 'rest'
              ? 'The water is clean. Something in you settles.'
              : 'The water is cold. Something inside you mends.')
          : 'The water is clean. You were already whole.',
      );
    },
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}

// Roll one tainted mutation, apply it, reconcile current HP against any
// max-hp delta, and surface the moment as a note. Prefers mutations the
// player hasn't already taken so a single fountain run doesn't roll the
// same brand twice; falls through if every mutation is already on them.
function applyTaintedDrink(): string {
  const already = new Set(getMutationIds());
  const fresh = TAINTED_MUTATIONS.filter((m) => !already.has(m.id));
  const pool = fresh.length > 0 ? fresh : TAINTED_MUTATIONS;
  const mutation = pool[Math.floor(gameRng() * pool.length)];
  // Shared Faustian-apply (HP reconcile + sfx + the brand's note) —
  // same door the phials use (player/apply-mutation.ts).
  applyMutationWithFeedback(mutation.id);
  return mutation.id;
}
