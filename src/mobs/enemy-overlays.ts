// Per-frame presentation that runs alongside the AI, not inside it.
//
// The clip animator (base walk/idle/crawl layer + a windup override per cast),
// the lash / cast body deforms, ambient vocalisation, the reactive-defense
// threat flash (white = deflectable, red = not), and the crown height overhead
// cues sit at.
//
// A subsystem of createEnemy over EnemyCtx (mobs/enemy-ctx.ts).

import { mechanicalContactFrac } from '../anim/contact-warp';
import { playEnemyVocal, type EnemyDeathSize, type VocalArchetype } from '../audio/sfx';
import { ENEMY_AUDIO_SIZE, ENEMY_VOCAL_ARCHETYPE, type EnemySpec } from '../content/enemies';
import { popDeflectOpportunity, pushDeflectOpportunity } from '../combat/reactive-defense';
import { CONFIG } from '../config';
import { gameRng } from '../engine/rng';
import type { EnemyCtx } from './enemy-ctx';
import { armedBlastAction } from './enemy-abilities';
import * as THREE from 'three';

// Audio buckets are content data (see content/enemies.ts). These thin
// lookups apply the runtime defaults: 'medium' for an unlisted size,
// null (silent) for an unlisted voice.
export function audioSizeFor(spec: EnemySpec): EnemyDeathSize {
  return ENEMY_AUDIO_SIZE[spec.id] ?? 'medium';
}

export function vocalArchetypeFor(spec: EnemySpec): VocalArchetype | null {
  return ENEMY_VOCAL_ARCHETYPE[spec.id] ?? null;
}

// Within this distance an IDLE/unaware mob vocalises much more often (a
// "stir") so a lurking thing reliably announces itself as you near it —
// hear-before-see — while staying sparse across the rest of the dark.
const VOCAL_STIR_RANGE = 7;

/** Local Y of the creature's actual crown, from its bounding box. Guessing a
 *  height buries an overhead cue in a tall body (the stoneguard); measured
 *  once, on first use, and shared by both overhead cues. */
export function crownHeight(self: EnemyCtx): number {
  self.built.group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(self.built.group);
  return isFinite(box.max.y) ? box.max.y - self.container.position.y : self.aimHeightResolved * 1.5;
}

export function reconcileThreat(self: EnemyCtx, on: boolean, deflectable: boolean): void {
  if (on === self.pres.threatOn && deflectable === self.pres.threatDeflectable) return;
  const wasPushing = self.pres.threatOn && self.pres.threatDeflectable;
  const willPush = on && deflectable;
  if (wasPushing && !willPush) popDeflectOpportunity();
  if (!wasPushing && willPush) pushDeflectOpportunity();
  self.pres.threatOn = on;
  self.pres.threatDeflectable = deflectable;
  self.eyePresenter.setThreatFlash(on ? (deflectable ? self.THREAT_DEFLECT_COLOR : self.THREAT_UNBLOCK_COLOR) : null);
}

// ── Per-frame animation/audio overlays ──────────────────────────────
// Cosmetic + audio steps that run every aware/active frame regardless of
// AI state. Pulled out of update() so the state machine reads clean; each
// is a nested closure so it keeps direct access to the model refs.
// Emit a positional vocalisation in "living its life" states (not
// mid-attack). Agitated when hunting; calm + sparse at post.
export function tickVocalisation(self: EnemyCtx, dt: number, distToPlayer: number) {
  if (!self.vocalArch) return;
  self.audio.vocalTimer -= dt;
  if (self.audio.vocalTimer > 0) return;
  const agitated = self.fsm.state === 'chasing' || self.fsm.state === 'searching';
  const canVocalize = self.fsm.state === 'idle' || self.fsm.state === 'returning' || agitated;
  if (canVocalize) {
    playEnemyVocal(self.vocalArch, self.container.position, agitated);
    // Cadence: hunting = frequent; idle FAR = sparse (silence-first dread);
    // idle NEAR the player = a "stir" so a lurking mob reliably announces
    // itself as you approach (hear-before-see), without chattering room-wide.
    if (agitated) self.audio.vocalTimer = 2.5 + gameRng() * 3;
    else if (distToPlayer < VOCAL_STIR_RANGE) self.audio.vocalTimer = 3 + gameRng() * 3;
    else self.audio.vocalTimer = 6 + gameRng() * 8;
  } else {
    self.audio.vocalTimer = 1.5;   // mid-attack — retry shortly
  }
}

/** Drive the keyframe animator from AI state. setBase responds to
 *  locomotion changes (idle ↔ walk ↔ crawl); playOverride fires once
 *  on the windup edge with the ability's clip stretched to the FULL
 *  windup+strike+recover window. */
export function tickClipAnimator(self: EnemyCtx, dt: number): void {
  if (!self.clipAnimator || !self.animBundle) return;
  const bundle = self.animBundle;
  // Decide base layer from state + phase.
  const phase = self.bossPhases.current;
  const useCrawl = phase?.useCrawlAnimation && bundle.crawl;
  const movingState =
    self.fsm.state === 'chasing' || self.fsm.state === 'searching' || self.fsm.state === 'returning';
  const baseClip = movingState
    ? (useCrawl ? bundle.crawl! : bundle.walk)
    : bundle.idle;
  self.clipAnimator.setBase(baseClip);
  // Fire an override on the WINDUP edge — exactly once per ability cast.
  // We watch for (state, ability) tuple changes; entering 'winding' with
  // a different ability than last time = new cast.
  const inWindup = self.fsm.state === 'winding' && self.combat.currentAbility;
  const abId = inWindup ? self.combat.currentAbility!.id : null;
  const transitioned =
    self.pres.prevAnimState !== self.fsm.state ||
    self.pres.prevAnimAbilityId !== abId ||
    self.pres.prevAnimPhaseIndex !== self.bossPhases.index;
  if (transitioned && inWindup && abId) {
    const clip = bundle.abilities[abId];
    if (clip && self.combat.currentAbility) {
      const total = self.combat.currentWindupTime + self.combat.currentAbility.strike + self.combat.currentAbility.recover;
      // ONE CLOCK: tell the animator where the damage actually lands so it can
      // warp clip time onto it. Uses the LIVE (jittered) windup, so a telegraph
      // rolled 22% long still lands its visual hit on its real one.
      //
      // Only for abilities whose contact is a fixed INSTANT. A dash connects
      // when it physically reaches you — there's no time to align to, and
      // warping toward a made-up one would move the animation away from the
      // truth rather than toward it. Those play unwarped.
      const opener = self.combat.currentAbility.steps[0]?.action;
      const timedContact = opener?.kind === 'melee';
      const mech = timedContact
        ? mechanicalContactFrac(
            self.combat.currentWindupTime, self.combat.currentAbility.strike, self.combat.currentAbility.recover,
            CONFIG.MOB_STRIKE_CONTACT_FRAC,
          )
        : null;
      self.clipAnimator.playOverride(clip, total, mech);
    }
  }
  // Stagger drops any in-flight override so the reel reads.
  if (self.fsm.state === 'staggered' && self.pres.prevAnimState !== 'staggered') {
    self.clipAnimator.cancelOverride();
  }
  self.pres.prevAnimState = self.fsm.state;
  self.pres.prevAnimAbilityId = abId;
  self.pres.prevAnimPhaseIndex = self.bossPhases.index;
  self.clipAnimator.update(dt);
}

// Lash deform — on a 'lash' telegraph the body ELONGATES toward the
// player (the slime rears + reaches a pseudopod), squashing slightly on
// the other axes (volume-ish), then SNAPS forward on the strike. Eases
// back to base scale whenever not lashing. Scale is otherwise untouched
// by the animation layers (which use position/rotation), so it's free.
export function tickLashDeform(self: EnemyCtx, dt: number) {
  const lashing = self.combat.currentAbility?.pose === 'lash';
  // A CAST reads on a limbless body too: the thing INFLATES as it charges the
  // shot and empties as it fires. Same writer as the lash (this function owns
  // built.group.scale), opposite sign — a lash reaches toward you, a spit
  // gathers into itself first.
  const casting = self.combat.currentAbility?.pose === 'cast';
  let target = 0;
  let ease = dt * 9;
  let swell = 0;
  if (lashing && self.fsm.state === 'winding') {
    target = 0.5 * Math.min(1, self.fsm.phaseTimer / self.combat.currentWindupTime);   // rear up slowly
  } else if (lashing && self.fsm.state === 'striking') {
    target = 1.0;                                                  // snap forward
    ease = dt * 26;
  } else if (casting && self.fsm.state === 'winding') {
    swell = 0.30 * Math.min(1, self.fsm.phaseTimer / self.combat.currentWindupTime);
  } else if (casting && self.fsm.state === 'striking') {
    swell = -0.16;                                                 // empties as it fires
  }
  self.pres.castSwell += (swell - self.pres.castSwell) * Math.min(1, dt * (swell < self.pres.castSwell ? 24 : 8));
  self.pres.lashStretch += (target - self.pres.lashStretch) * Math.min(1, ease);
  if (target === 0 && self.pres.lashStretch < 0.002) self.pres.lashStretch = 0;
  // GELATINOUS jiggle (blobs/oozes) — a continuous squash-and-stretch about
  // the resting volume so the jelly reads alive even standing still. Lives
  // here because tickLashDeform OWNS built.group.scale (a presence overlay
  // would be clobbered by this writer). Volume-ish: squash Y, bulge X/Z.
  let gx = 1, gy = 1, gz = 1;
  if (self.spec.presence === 'gelatinous') {
    self.pres.gelTime += dt;
    const w = Math.sin(self.pres.gelTime * 3.2) * 0.1;
    gy = 1 - w; gx = 1 + w * 0.5; gz = 1 + w * 0.5;
  }
  // THE FUSE, made visible. An armed blast inflates as it primes, with a
  // beat that ACCELERATES (6 → 26 rad/s across the windup) — the swell says
  // "this one is a bomb", the quickening says "and it is nearly done." Both
  // read from across a dark room, where a subtle tell would not. Rides this
  // writer rather than easing through castSwell, because the whole point is
  // a hard pulse that smoothing would flatten.
  let fuse = 1;
  if (self.fsm.state === 'winding' && armedBlastAction(self)) {
    const ft = Math.min(1, self.combat.currentWindupTime > 0 ? self.fsm.phaseTimer / self.combat.currentWindupTime : 1);
    self.pres.fuseBeatPhase += dt * (CONFIG.FUSE.BEAT_HZ_START + CONFIG.FUSE.BEAT_HZ_RAMP * ft);
    fuse = (1 + CONFIG.FUSE.SWELL * ft * ft)                    // slow start, late bloom
         * (1 + CONFIG.FUSE.BEAT * ft * Math.sin(self.pres.fuseBeatPhase));
  } else {
    self.pres.fuseBeatPhase = 0;
  }
  // Elongate along local Z (forward/back, the player axis since the
  // container faces the player); squash X/Y a touch.
  const sw = (1 + self.pres.castSwell) * fuse;
  self.built.group.scale.set(
    self.groupBaseScale.x * gx * sw * (1 - 0.12 * self.pres.lashStretch),
    self.groupBaseScale.y * gy * sw * (1 - 0.16 * self.pres.lashStretch),
    self.groupBaseScale.z * gz * sw * (1 + 0.55 * self.pres.lashStretch),
  );
}
