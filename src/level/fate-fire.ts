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
import { grantEmber } from '../player/ember';
import { healPlayer, getPlayerHp, getPlayerMaxHp } from '../player/health';
import { refillFlask } from '../player/flask';
import { flashHearthEmbrace } from '../ui/vignette';
import { spawnStatusTextHere } from '../ui/damage-numbers';

/** The two things a rest gives you, coloured so they read apart at a glance:
 *  flesh-warm for health, flask-gold for charges. */
/** Borrowed life — the same amber the ember hearts use on the bar. */
const HEARTH_EMBER_COLOR = 'rgba(255, 176, 74, 0.98)';
/** The refuge fire's two lines — flesh-warm for the mend, flask-gold for the
 *  charges, so they read apart at a glance. */
const HEARTH_MEND_COLOR = 'rgba(255, 214, 170, 0.98)';
const HEARTH_FLASK_COLOR = 'rgba(255, 198, 92, 0.98)';
import { CONFIG } from '../config';
import { collectFlames, spendFlames } from './flame-spend';

interface FateFireOpts {
  /** The built bonfire model — its flame meshes/sprites get spent in place. */
  group: THREE.Object3D;
  position: THREE.Vector3;
  /** The harbor fire: gates descent until drawn. Small fires pass false. */
  isBig: boolean;
  /**
   * THE REFUGE FIRE — the great fire in a safe room, between acts.
   *
   * The two kinds of fire mean different things and should not be confused:
   * a fire in the DEEP lends you life you didn't have (ember), while the fire
   * in the REFUGE gives back the life you spent — a full mend and a full flask.
   * One is a gift with a catch, the other is the game being plainly kind, once,
   * in the one place that is safe.
   *
   * That split is also what keeps the flask honest: it has exactly one refill
   * point in the whole run, and it's the place you were going to stop at anyway.
   */
  haven?: boolean;
  /** Dim the prop's pooled light toward embers when spent. */
  dimLight?: (factor: number) => void;
  /**
   * CONTESTED — resting here seals the room and the waves come.
   *
   * room-types.ts has always said a sanctum ACCEPTS the `contested` modifier
   * ("a rest you fight for"), and room-modifiers.ts has always been willing to
   * assign it: 'fire' is in its GUARDABLE set. But the trigger the seal uses is
   * the `guarded` flag, and that flag only exists on offerings and chests. A
   * fire is neither, so the portcullis had nothing to spring it and the
   * modifier was silently a no-op — measured at 12 of 40 contested rooms.
   *
   * This is the missing half. Fired on the FIRST rest, before the gift, so the
   * room closes as you reach for the mercy rather than after you have banked it.
   */
  onGuardSprung?: () => void;
}

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
      if (drawn) return; // a spent fire has nothing left to give
      // CONTESTED: reaching for the rest is what springs the room. Before the
      // gift, so you are fighting for it rather than after it.
      o.onGuardSprung?.();
      // FATES ARE DISABLED — the fire no longer deals a card. It's a plain REST:
      // Once per fire (the `drawn` guard).
      drawn = true;
      // SHOW THE PLAYER WHAT THEY GOT. A rest that silently sets a number is a
      // rest you don't feel, and this is the one moment the game is kind — so
      // the fire takes the whole screen for a beat and the gift floats up off
      // the flame, where the player is already looking.
      // WHAT A FIRE GIVES: ember, and only ember. Not a heal, not a refill.
      // A heal is worth most to a player who is nearly dead, which made the
      // optimal approach "arrive bleeding" and paid you LESS for having played
      // well. Ember is the same size whatever shape you're in, so a fire is a
      // flat beat you can route toward instead of a variable-value pit stop —
      // and it gives the ember economy one dependable source that isn't a
      // bargain, which is what lets the bargains be genuinely cruel.
      const at = o.position.clone();
      if (o.haven) {
        // THE REFUGE. Whole again, flask full — the road so far is forgiven.
        const before = getPlayerHp();
        healPlayer(getPlayerMaxHp(), 'passive');
        const mended = Math.max(0, Math.round(getPlayerHp() - before));
        refillFlask();
        flashHearthEmbrace();
        if (mended > 0) spawnStatusTextHere(at, `+${mended} MENDED`, HEARTH_MEND_COLOR);
        spawnStatusTextHere(at.clone().setY(at.y + 0.42), 'FLASK FULL', HEARTH_FLASK_COLOR);
      } else {
        const gained = grantEmber(CONFIG.BONFIRE.EMBER);
        flashHearthEmbrace();
        spawnStatusTextHere(at, gained > 0 ? `+${gained} EMBER` : 'ALREADY BURNING', HEARTH_EMBER_COLOR);
      }
      spendFlames(flames);
      o.dimLight?.(0.16);   // drop the light to a cold, barely-there glow
      interactable.promptLabel = ''; // spent — no rest prompt
      if (o.isBig) clearFateGate();
    },
    destroyed: false,
  };
  registerInteractable(interactable);
}
