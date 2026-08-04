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
import { getFlask, addCharges } from '../player/flask';
import { healPlayer, getPlayerHp, getPlayerMaxHp } from '../player/health';
import { grantEmber } from '../player/ember';
import { flashHearthEmbrace } from '../ui/vignette';
import { spawnStatusTextHere } from '../ui/damage-numbers';

/** The two things a rest gives you, coloured so they read apart at a glance:
 *  flesh-warm for health, flask-gold for charges. */
const HEARTH_MEND_COLOR = 'rgba(255, 214, 170, 0.98)';
const HEARTH_FLASK_COLOR = 'rgba(255, 198, 92, 0.98)';
/** Borrowed life — the same amber the ember hearts use on the bar. */
const HEARTH_EMBER_COLOR = 'rgba(255, 176, 74, 0.98)';
import { CONFIG } from '../config';

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
// A CLAIMED fire is cold, not just small: the flames collapse toward this dark
// ash so a spent fire reads as "already taken" at a glance, not as a little fire
// you could still rest at (playtest: hard to tell a claimed fire from a live one).
const SPENT_ASH = new THREE.Color(0x241009);

export function registerFateFire(o: FateFireOpts): void {
  if (o.isBig) armFateGate();
  const flames = collectFlames(o.group);
  let drawn = false;

  const interactable = {
    id: generateEntityId('bonfire-rest'),
    position: o.position,
    radius: 1.8,
    labelOffsetY: 1.25,
    promptLabel: 'MEND',
    built: { group: new THREE.Group(), parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    keepBuiltOnDestroy: true,
    onUse() {
      if (drawn) return; // a spent fire has nothing left to give
      // FATES ARE DISABLED — the fire no longer deals a card. It's a plain REST:
      // RECHARGE ONE FLASK CHARGE, or — if the flask is already full — pour the
      // charge's worth of HP straight into you, so the rest is never wasted. Once
      // per fire (the `drawn` guard). The full reset lives at the safe-haven basin.
      drawn = true;
      // THE MEND. A bonfire is the Dark Souls beat and nothing else: it mends
      // you and refills the flask, then you decide whether to go on. The flask
      // is the ONLY thing that refills here — the golden fountain that used to
      // hand out charges is cut, so a fire is the single place your heals come
      // back and reaching one is the decision it should be.
      //
      // SHOW THE PLAYER WHAT THEY GOT. A rest that silently sets two numbers is
      // a rest you don't feel, and this is the one moment the game is kind — so
      // the fire takes the whole screen for a beat, and the two things it gave
      // you float up off the flame where you're already looking.
      // ORDER MATTERS: flask, then flesh, then the overflow becomes EMBER.
      // Spending it this way means a rest is never wasted — arrive at full
      // health and the whole budget converts to borrowed life, so a fire is
      // worth reaching whatever state you're in.
      const charges = addCharges(CONFIG.BONFIRE.FLASK_CHARGES);
      const budget = getPlayerMaxHp() * CONFIG.BONFIRE.MEND_BUDGET;
      const hpBefore = getPlayerHp();
      healPlayer(budget, 'passive');
      const mended = Math.max(0, Math.round(getPlayerHp() - hpBefore));
      // Whatever the flesh couldn't take. grantEmber clamps to the cap itself,
      // so an already-shielded delver simply tops off rather than being refused.
      const spare = Math.max(0, Math.round(budget - mended));
      if (spare > 0) grantEmber(spare);
      flashHearthEmbrace();
      const at = o.position.clone();
      if (mended > 0) spawnStatusTextHere(at, `+${mended} MENDED`, HEARTH_MEND_COLOR);
      if (charges > 0) {
        // Stacked upward so the lines never overlap on a phone.
        spawnStatusTextHere(at.clone().setY(at.y + 0.42), `+${charges} FLASK`, HEARTH_FLASK_COLOR);
      }
      if (spare > 0) {
        spawnStatusTextHere(at.clone().setY(at.y + 0.84), `+${spare} EMBER`, HEARTH_EMBER_COLOR);
      }
      spendFlame(flames);
      o.dimLight?.(0.16);   // drop the light to a cold, barely-there glow
      interactable.promptLabel = ''; // spent — no rest prompt
      if (o.isBig) clearFateGate();
    },
    destroyed: false,
  };
  registerInteractable(interactable);
}

/** DEV: collapse a built bonfire's flames to the CLAIMED look (for snap compare). */
export function debugSpendFlames(group: THREE.Object3D): void {
  if (!import.meta.env.DEV) return;
  spendFlame(collectFlames(group));
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
    f.scale.multiplyScalar(0.28);   // collapse to a low ember heap, not a small flame
    const obj = f as THREE.Mesh | THREE.Sprite;
    if (!obj.material) continue;
    obj.material = Array.isArray(obj.material) ? obj.material.map(spend) : spend(obj.material);
  }
}

function spend(m: THREE.Material): THREE.Material {
  const c = m.clone();
  const cc = c as THREE.Material & { opacity?: number; color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };
  if (typeof cc.opacity === 'number') { cc.opacity *= 0.3; cc.transparent = true; }
  cc.color?.lerp(SPENT_ASH, 0.82);
  cc.emissive?.lerp(EMBER, 0.7);   // any self-lit flame cools to a faint ember, not a bright tongue
  if (typeof cc.emissiveIntensity === 'number') cc.emissiveIntensity *= 0.35;
  return c;
}
