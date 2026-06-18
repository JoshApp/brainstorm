// ── FATE FIRE — a bonfire deals you ONE fate, then burns down ────────────────
//
// Resting at a fire opens the dealt-3-pick-1 draw (ui/card-reading.ts). Each fire
// deals exactly once: claim a card and the flame collapses to spent embers and the
// rest prompt goes quiet. The HARBOR's big fire also seals the stairs until drawn
// (fate-gate.ts) — small vault fires are optional extra fates and don't gate.
//
// Lit → spent (not unlit → lit): a burning fire is the invitation; drawing spends
// it. The transition is instant because the card screen covers the scene while it
// happens — the player turns back to find the fire already embers.
import * as THREE from 'three';
import { registerInteractable } from '../interactables/system';
import { generateEntityId } from '../ecs/world';
import { openCardReading } from '../ui/card-reading';
import { armFateGate, clearFateGate } from '../state/fate-gate';

interface FateFireOpts {
  /** The built bonfire model — its flame meshes/sprites get spent in place. */
  group: THREE.Object3D;
  position: THREE.Vector3;
  /** The harbor fire: gates descent until drawn. Small fires pass false. */
  isBig: boolean;
  /** Dim the prop's pooled light toward embers when spent. */
  dimLight?: (factor: number) => void;
}

const EMBER = new THREE.Color(0x551505);

export function registerFateFire(o: FateFireOpts): void {
  if (o.isBig) armFateGate();
  const flames = collectFlames(o.group);
  let drawn = false;

  const interactable = {
    id: generateEntityId('bonfire-rest'),
    position: o.position,
    radius: 1.8,
    labelOffsetY: 1.25,
    promptLabel: 'REST',
    built: { group: new THREE.Group(), parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    keepBuiltOnDestroy: true,
    onUse() {
      if (drawn) return; // a spent fire has nothing left to deal
      openCardReading({
        onDone: (picked) => {
          if (!picked || drawn) return;
          drawn = true;
          spendFlame(flames);
          o.dimLight?.(0.34);
          interactable.promptLabel = ''; // spent — no rest prompt
          if (o.isBig) clearFateGate();
        },
      });
    },
    destroyed: false,
  };
  registerInteractable(interactable);
}

/** Flame meshes (named 'flame') + every fire sprite in the model. */
function collectFlames(group: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  group.traverse((o) => { if ((o as THREE.Sprite).isSprite || o.name === 'flame') out.push(o); });
  return out;
}

/** Collapse the flames to low, cooled embers — smaller, dimmer, redder.
 *  Materials are CLONED before mutating: bonfire flame materials may be shared
 *  template-clones (perf), so editing in place could dim every other fire too. */
function spendFlame(flames: THREE.Object3D[]): void {
  for (const f of flames) {
    f.scale.multiplyScalar(0.45);
    const obj = f as THREE.Mesh | THREE.Sprite;
    if (!obj.material) continue;
    obj.material = Array.isArray(obj.material) ? obj.material.map(spend) : spend(obj.material);
  }
}

function spend(m: THREE.Material): THREE.Material {
  const c = m.clone();
  const cc = c as THREE.Material & { opacity?: number; color?: THREE.Color };
  if (typeof cc.opacity === 'number') { cc.opacity *= 0.5; cc.transparent = true; }
  cc.color?.lerp(EMBER, 0.6);
  return c;
}
