import * as THREE from 'three';
import { stdMat } from '../style/material-registry';
import { generateEntityId } from '../ecs/world';
import { spawnEvent } from './event-factory';
import { gameRng } from '../engine/rng';
import { registerLight } from '../scene/light-pool';
import { healPlayer, getPlayerMaxHp, getPlayerHp } from '../player/health';
import { addCharges, refillFlask } from '../player/flask';
import { playHealSlurp } from '../audio/sfx';
import { showInscription } from '../ui/inscription';
import { flyToHud, projectToScreen } from '../ui/fly-to-hud';
import { getFlaskButtonEl } from '../controls/consumable-bar';
import { TAINTED_MUTATIONS } from '../content/tainted-mutations';
import { getMutationIds } from '../state/run-mutations';
import { applyMutationWithFeedback } from '../player/apply-mutation';

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

//   'sanctuary' (SAFE HAVEN): REST. The between-acts basin on the central
//                       pedestal — a FULL restore: heals to full AND refills
//                       every flask charge. The one unambiguous kindness the
//                       dark allows, before you carry everything back down.
export type FountainVariant = 'gamble' | 'rest' | 'tainted' | 'sanctuary';

interface VariantStyle {
  liquidColor: number;
  liquidEmissive: number;
  lightColor: number;
  promptLabel: string;
  promptKind: 'neutral' | 'unknown';
}

const VARIANT_STYLE: Record<FountainVariant, VariantStyle> = {
  gamble: {
    liquidColor:    0x3a2c10,
    liquidEmissive: 0xffc844,   // molten gold
    lightColor:     0xffc860,
    promptLabel:    'DRINK',
    promptKind:     'neutral',  // amber — a clean boon (a partial mend)
  },
  rest: {
    liquidColor:    0x3a2818,
    liquidEmissive: 0xffb070,   // warm amber — clean refuge water
    lightColor:     0xffc890,
    promptLabel:    'REST',
    promptKind:     'neutral',  // safe refuge water
  },
  sanctuary: {
    liquidColor:    0x2a2a1a,
    liquidEmissive: 0xfff0c0,   // pale gold-white — a holy, full-restore water
    lightColor:     0xffe6b0,
    promptLabel:    'REST',
    promptKind:     'neutral',
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
  // Shared between build (visuals) and onUse (drain): the liquid disc we hide and
  // the light intensity we dim once drunk. The basin STAYS after use (autoFinish
  // false), draining rather than vanishing — so these live in the closure.
  let liquid!: THREE.Mesh;
  const fountainState = { intensity: 1.8 };

  spawnEvent({
    kind: 'fountain',
    scene: parent,
    pos,
    rotY,
    radius: 1.3,
    promptLabel: style.promptLabel,
    promptKind: style.promptKind,
    family: 'unknown',      // a drink commits BEFORE the answer
    autoFinish: false,      // the drained basin remains as a spent fixture
    build: () => {
  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = rotY;
  parent.add(group);

  // Stone pedestal — short octagonal column.
  const stoneMat = stdMat({
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
  const dryDiscMat = stdMat({
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
  const liquidMat = stdMat({
    color:     style.liquidColor,
    emissive:  style.liquidEmissive,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0.0,
    transparent: true,
    opacity: 0.85,
    fog: false,
  });
  liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.04, 16),
    liquidMat,
  );
  liquid.position.y = 0.83;
  group.add(liquid);

  // Soft glow registered with the global light pool. Intensity is read
  // each frame via getIntensity so we can dim it after the fountain is
  // drunk (sets the fountainState.intensity to 0.2).
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

      return { group };
    },
    onUse: () => {
      // Drain the liquid visually — hide the emissive disc, dim the glow.
      liquid.visible = false;
      fountainState.intensity = 0.2;

      if (variant === 'tainted') {
        const mutationId = applyTaintedDrink();
        return { mutationId };
      }
      if (variant === 'sanctuary') {
        // The safe-haven basin: a FULL restore — heal to full AND refill every
        // flask charge. The gold-fill stream plays for the flask top-up.
        const before = getPlayerHp();
        healPlayer(getPlayerMaxHp(), 'passive');
        refillFlask();
        playHealSlurp();
        goldRefillStream(pos);
        showInscription('The basin takes the whole weight of the road. You rise whole, your flask full.');
        return { hpDelta: getPlayerMaxHp() - before };
      }
      // THE GOLDEN FLASK-REFILL FOUNTAIN IS CUT. Charges come back at a BONFIRE
      // and nowhere else — one source is what makes reaching a fire a decision,
      // and a basin that quietly topped you up undercut every fire on the floor.
      // The dungeon fountain is a partial heal now, same as 'rest'.
      // A solid PARTIAL heal — half the pool — not a free full reset. With the
      // HP bar cut down and the flask carrying more of your survivability, half
      // a bar out of a basin is real mercy without replacing a rest.
      const before = getPlayerHp();
      healPlayer(Math.ceil(getPlayerMaxHp() / 2), 'passive');   // environmental heal — a TRANSFORM may suppress it
      const healed = getPlayerMaxHp() - before;
      playHealSlurp();
      showInscription(
        healed > 0
          ? (variant === 'rest'
              ? 'The water is clean. Something in you settles.'
              : 'The water is cold. Something inside you mends.')
          : 'The water is clean. You were already whole.',
      );
      return { hpDelta: healed };
    },
  });
}

// A shower of gold flecks from the basin up into the flask HUD button — the
// diegetic "the charge arrived" read, staggered so it POURS rather than pops.
function goldRefillStream(pos: THREE.Vector3): void {
  const target = getFlaskButtonEl();
  const src = projectToScreen({ x: pos.x, y: pos.y + 0.85, z: pos.z })
    ?? { x: window.innerWidth * 0.5, y: window.innerHeight * 0.55 };
  for (let i = 0; i < 6; i++) {
    const jx = ((i * 53) % 40) - 20, jy = ((i * 31) % 26) - 13;   // deterministic scatter
    window.setTimeout(() => {
      const fleck = document.createElement('div');
      Object.assign(fleck.style, {
        borderRadius: '50%',
        background: 'radial-gradient(circle at 40% 35%, rgba(255,236,170,1), rgba(255,176,54,0.7) 70%, rgba(255,150,40,0) 100%)',
        boxShadow: '0 0 9px rgba(255,200,90,0.9)',
      } as Partial<CSSStyleDeclaration>);
      try {
        flyToHud({ from: { x: src.x + jx, y: src.y + jy }, targetEl: target, node: fleck, size: 13, accent: 'rgba(255,205,95,0.95)', durationMs: 640 });
      } catch { /* presentation must never break the drink */ }
    }, i * 70);
  }
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
