// An enemy's per-frame brain: update().
//
// Order each frame: eye veil boost → death tick (if dying) → burrow gate →
// boss-phase timers and collapse → aura → fog-gate dormancy and wake →
// perception → cooldowns and timers → poise regen → the parry onset check →
// the state machine (dormant, staggered, fleeing, idle, alerted, searching,
// returning, chasing, winding, striking, recovering) → threat flash →
// animation and audio overlays.
//
// A subsystem of createEnemy over EnemyCtx (mobs/enemy-ctx.ts); the states
// call into enemy-abilities, enemy-locomotion, enemy-damage, enemy-perception
// and enemy-overlays.

import { playEnemyStrike, playEnemyWindup, playFuse } from '../audio/sfx';
import { aggregateSpeed } from '../combat/modifiers';
import { isParryActive } from '../combat/reactive-defense';
import { kickShake } from '../combat/screen-shake';
import { CONFIG } from '../config';
import { creepReach, creepSpeedMul, firstMeleeReach, isDeflectable, threatReach, wantsCreep } from '../content/abilities';
import { get as getEntity } from '../ecs/world';
import { gameNow } from '../engine/game-clock';
import { gameRng } from '../engine/rng';
import { groundYAt } from '../level/elevation';
import { type NavGrid } from '../level/nav-grid';
import { type WalkableRegion } from '../level/walkable';
import { damagePlayer } from '../player/health';
import { setPlayerInAura } from '../player/inside-aura';
import { isBossEngaged, levelHasFogWall } from '../ui/boss-engagement';
import { raiseAlert, sampleAlert } from './alerts';
import { isBossEncounterEngaged } from './boss-encounter';
import type { EnemyState } from './enemy';
import { audioSizeFor } from './enemy-overlays';
import type { EnemyCtx } from './enemy-ctx';
import { applyTelegraph, armedBlastAction, clearAoeTelegraph, clearLashTendril, runAction, selectAbility, setupAbilityTelegraph, tickAbilityMotion, triggerMet } from './enemy-abilities';
import { breakMorale, resolveParry, setStaggerVuln } from './enemy-damage';
import { applyTilt, distToXZ, faceMovement, faceTarget, faceXZ, meleeArcOf, moveTowards, playerFacingThis, tickFeint, withinArc } from './enemy-locomotion';
import { crownHeight, reconcileThreat, tickClipAnimator, tickLashDeform, tickVocalisation } from './enemy-overlays';
import { canSeePlayer } from './enemy-perception';
import { createFearSkull } from './fear-skull';
import { selectIntent } from './intent';
import { packMoveTarget, packScratch, requestToken } from './pack';
import { restTelegraphPose } from './pose-clips';
import { createStunStars } from './stun-stars';
import * as THREE from 'three';

// How much brighter (and larger) an eye burns when its owner is a pure silhouette, over what the
// presenter's own state asked for. Falls to nothing as the light resolves the body — see the
// EyePresenter's setVeilBoost for why it is the INVERSE of reveal rather than a flat boost.
const VEIL_EYE_BOOST = 3.2;

// Grace beat a fog-gate boss grants the player on waking — it closes the
// distance but holds fire this long so you can orient out of the walk-in.
const ENGAGE_GRACE = 2.4;

const IDLE_SCAN_INTERVAL_MIN = CONFIG.ENEMY_AI.IDLE_SCAN_INTERVAL_MIN;
const IDLE_SCAN_INTERVAL_JITTER = CONFIG.ENEMY_AI.IDLE_SCAN_INTERVAL_JITTER;

const IDLE_SCAN_HOLD_CHANCE = CONFIG.ENEMY_AI.IDLE_SCAN_HOLD_CHANCE;

const IDLE_SCAN_STEP = CONFIG.ENEMY_AI.IDLE_SCAN_STEP;

const IDLE_SCAN_HALF_ARC = CONFIG.ENEMY_AI.IDLE_SCAN_HALF_ARC;

// then cowers; re-engages once, or is cut down cowering
// AI timing/feel constants are tuned in src/config.ts (CONFIG.ENEMY_AI);
// the rationale for each stays here at the use site.
// How long an enemy hesitates after first spotting the player before
// committing to chase. Sells the "I see you" moment — also gives the
// player a reaction window.
const ALERTED_DURATION = CONFIG.ENEMY_AI.ALERTED_DURATION;

// How long the enemy will search at the last-known position before giving
// up. Doesn't override per-spec loseSightTime; this is the search PHASE
// duration after sight is already lost.
const SEARCH_DURATION = CONFIG.ENEMY_AI.SEARCH_DURATION;

const tmpDir = new THREE.Vector3();

const DROP_HEIGHT = 4.5;   // metres above the floor it waits / falls from

const ENTRANCE_DUR = 0.55;

// Head-crane / knockback / locomotion / presence overlays live in the body
// animator (enemy-animation.ts), driven from update() below.
export function update(self: EnemyCtx, dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion, nav?: NavGrid) {
  self.lastPlayerXZ.copy(playerPos);
  // ── EYES CARRY FURTHER THE LESS OF THE CREATURE YOU CAN SEE ───────────
  //
  // mobs/enemy-reveal.ts writes `reveal` in the present phase; every eye state below repaints
  // from its base each tick, so the boost has to be in place BEFORE they run. Set once, here,
  // rather than at each of the four painting sites — a state added later would silently miss it
  // otherwise, and the failure mode is a species whose eyes never carry, which reads as the
  // effect being broken rather than as a missing call.
  {
    const r = self.container.userData.reveal;
    self.eyePresenter.setVeilBoost(1 + VEIL_EYE_BOOST * (1 - (typeof r === 'number' ? r : 0)));
  }
  if (!self.fsm.alive) {
    // Dying branch — run the death animation; everything else (AI,
    // perception, movement) is gated off.
    if (self.death.dying) self.death.tick(dt);
    return;
  }

  // ── Burrowed (pre-emerge gate) ─────────────────────────────────
  // While buried or emerging the mob is inert: no perception, no AI.
  if (self.burrow.tick(dt, playerPos)) return;

  // Hit flash + glowing-core heartbeat/flare (see enemy-presentation.ts).
  self.coreReactor.tick(dt);

  // Phase-entry invuln + summon-gate windows tick down; while a phase
  // collapse plays the boss is INERT (and invulnerable) — skip all AI.
  if (self.bossPhases.tick(dt)) return;

  // Capture home yaw the very first tick so idle scan rotates around the
  // actual placed-orientation (set by builder via faceWorld at spawn).
  if (!self.idle.homeYawSet) {
    self.idle.homeYaw = self.container.rotation.y;
    self.idle.scanTargetYaw = self.idle.homeYaw;
    self.idle.homeYawSet = true;
  }

  // Vocalisation — hear it before you see it. (see tickVocalisation)
  tickVocalisation(self, dt, distToXZ(self, playerPos));

  // ── Inside-aura tick (king-slime body, etc.) ─────────────────────
  // Cheap distance check + state machine for the "you're standing
  // INSIDE me" pressure. Grace period means a quick roll-through
  // costs no HP; lingering does.
  if (self.spec.aura) {
    const dx = playerPos.x - self.container.position.x;
    const dz = playerPos.z - self.container.position.z;
    const distSq = dx * dx + dz * dz;
    const r = self.spec.aura.radius;
    if (distSq <= r * r) {
      if (self.spec.aura.slowFactor !== undefined && self.spec.aura.slowFactor !== 1.0) {
        setPlayerInAura(self.spec.aura.slowFactor);
      }
      self.combat.auraInsideTime += dt;
      if (self.combat.auraInsideTime >= self.spec.aura.gracePeriod) {
        self.combat.auraDamageTimer += dt;
        if (self.combat.auraDamageTimer >= self.spec.aura.dotInterval) {
          self.combat.auraDamageTimer -= self.spec.aura.dotInterval;
          damagePlayer(self.spec.aura.dotDamage, self.entityId, self.spec.damageType ?? 'magic');
        }
      }
    } else {
      self.combat.auraInsideTime = 0;
      self.combat.auraDamageTimer = 0;
    }
  }

  // A dormant boss (the king behind its fog gate) stays inert — no
  // perception, no aggro — until the player COMMITS by entering the gate
  // (the encounter engages). Souls-style: the fight starts when you cross
  // the threshold, not when the boss spots you from across the room.
  // Gated on the fog wall existing so a fog-less boss can't deadlock
  // (it would never engage without the cross trigger).
  const dormant = !!self.spec.dormantUntilEngaged && levelHasFogWall() && !isBossEncounterEngaged();
  if (self.aware.wasDormant && !dormant) {
    // Just woke (player committed at the fog gate). A grace beat before
    // the first assault so the player can orient coming out of the
    // walk-in — the boss closes the distance but holds fire. Push every
    // ability onto a short cooldown (only lengthens, never shortens an
    // already-staggered one).
    for (const ab of self.combat.abilities) {
      self.cooldowns.set(ab.id, Math.max(self.cooldowns.get(ab.id) ?? 0, ENGAGE_GRACE));
    }
    // Ceiling-drop entrance: reveal + start the plummet (the impact quake
    // fires when it lands, below). Plays inside the grace window.
    if (self.isCeilingDrop) { self.built.group.visible = true; self.pres.entranceTimer = 0; }
  }
  self.aware.wasDormant = dormant;
  self.aware.dormant = dormant;
  if (dormant) {
    self.aware.aggroed = false;
    if (self.fsm.state !== 'idle') { self.fsm.state = 'idle'; self.fsm.phaseTimer = 0; }
    // Ceiling-drop bosses hide above the arena until the cross — the blob
    // shadow on the floor is the only tell of where they'll land.
    if (self.isCeilingDrop) self.built.group.visible = false;
  }

  // ── Perception ─────────────────────────────────────────────────────
  // Refresh sight check every frame. Once aggroed, we stay aggroed
  // until loseSightTime seconds pass with no LOS AND we've transitioned
  // out of mid-attack states (winding/striking/recovering finish before
  // we drop aggro).
  const seesPlayer = self.hostileToPlayer && !dormant && canSeePlayer(self, playerPos, walkable);
  if (seesPlayer) {
    self.aware.timeSinceLOS = 0;
    self.lastSeenPos.copy(playerPos);
    if (!self.aware.aggroed) {
      self.aware.aggroed = true;
      if (self.fsm.state === 'idle' || self.fsm.state === 'returning') {
        self.fsm.state = 'alerted';
        self.fsm.phaseTimer = 0;
        playEnemyWindup(audioSizeFor(self.spec), self.container.position);  // "I see you" growl
      }
    }
    // Shared aggro — broadcast the player's position so nearby
    // idle mobs join the fight. Overwriting each frame is fine;
    // it's the same player, the alert just keeps refreshing.
    raiseAlert(playerPos.x, playerPos.z);
  } else if (self.aware.aggroed) {
    self.aware.timeSinceLOS += dt;
    // Drop aggro only when we've lost sight long enough AND we're not
    // mid-attack. Mid-attack we let the swing finish first.
    const attackingStates: ReadonlyArray<EnemyState> = ['winding', 'striking', 'recovering'];
    if (self.aware.timeSinceLOS >= self.loseSightTime && !attackingStates.includes(self.fsm.state)) {
      self.aware.aggroed = false;
      if (self.fsm.state === 'chasing') {
        self.fsm.state = 'searching';
        self.fsm.phaseTimer = 0;
      }
    }
  }

  const distance = distToXZ(self, playerPos);

  // Chill / haste — movement pace + attack-phase timing scale by the
  // entity's speed buffs (chill = both < 1). moveSpeed is used by every
  // movement state; actionDt slows the windup/strike/recover advance.
  const speed = aggregateSpeed(self.entityId);
  const moveSpeed = self.spec.moveSpeed * speed.move;
  const actionDt = dt * speed.action;

  // Tick down per-ability cooldowns.
  if (self.cooldowns.size > 0) {
    for (const [id, t] of self.cooldowns) {
      if (t > 0) self.cooldowns.set(id, Math.max(0, t - dt));
    }
  }

  // Poise regen — once the player stops landing stagger pressure, the
  // pool refills (a grace delay, then a steady rate) so you must
  // SUSTAIN hits to break it. A staggered enemy doesn't regen (its
  // pool is already reset for the next break).
  self.actionFsm.tick(dt);   // advance interrupt beats (stagger + parry flinch-lock)
  if (self.poise.falterCd > 0) self.poise.falterCd = Math.max(0, self.poise.falterCd - dt);
  if (self.combat.plantTimer > 0) self.combat.plantTimer = Math.max(0, self.combat.plantTimer - dt);
  // FEAR burns down whatever the creature is doing (including reeling), and
  // the moment it runs out the immunity starts — so nerve returns exactly
  // once per scare and can't be re-broken on the same breath.
  if (self.poise.fearTimer > 0) {
    self.poise.fearTimer = Math.max(0, self.poise.fearTimer - dt);
    if (self.poise.fearTimer === 0) self.poise.fearCd = CONFIG.ENEMY_AI.FEAR.IMMUNE_AFTER;
  } else if (self.poise.fearCd > 0) {
    self.poise.fearCd = Math.max(0, self.poise.fearCd - dt);
  }
  if (self.fsm.state !== 'staggered') {
    if (self.poise.poiseRegenCd > 0) self.poise.poiseRegenCd = Math.max(0, self.poise.poiseRegenCd - dt);
    else if (self.poise.poiseLeft < self.poise.poiseMax) {
      // HP-SCALED recovery (the two-gauge coupling): a healthy enemy shrugs
      // posture off fast, so you can't just chip-and-deflect it to a break at
      // full HP; as its HP drops the recovery slows toward a floor, so posture
      // damage STICKS on a wounded foe. This teaches "whittle its health, THEN
      // break and execute" with no tutorial — the FromSoft coupling.
      const ent = getEntity(self.entityId);
      const hpFrac = ent?.hp && self.bossPhases.maxHp > 0 ? ent.hp.current / self.bossPhases.maxHp : 1;
      const recoverMul = Math.max(CONFIG.POISE.RECOVER_HP_FLOOR, hpFrac * hpFrac);
      self.poise.poiseLeft = Math.min(self.poise.poiseMax, self.poise.poiseLeft + CONFIG.POISE.REGEN_RATE * recoverMul * dt);
    }
  }

  // Face target is conditional — idle/returning faces the scan target, not the
  // player; a staggered enemy is reeling and doesn't track you; and CHASING
  // faces its direction of TRAVEL (handled in its own case below) so a prowling
  // mob circles instead of crab-walking sideways while staring at you.
  if (self.fsm.state !== 'idle' && self.fsm.state !== 'returning' && self.fsm.state !== 'staggered'
      && self.fsm.state !== 'chasing' && self.fsm.state !== 'fleeing') {
    faceTarget(self, playerPos, dt);
  }

  // ── PARRY (immediate, on the STRIKE) ─────────────────────────────
  // You parry the blade as it comes OUT, not the wind-up. The window opens
  // on the white flash (which leads the strike by FLASH_LEAD_S — your
  // reaction time), and stays open across the strike (PARRY_WINDOW_S), but
  // the deflect only RESOLVES once the mob is actually STRIKING. It resolves
  // on the first striking frame — BEFORE the switch runs the strike step
  // that deals damage — so the catch is crisp + immediate, never a windup
  // freebie.
  //
  // MELEE ONLY, deliberately — this uses firstMeleeReach, NOT the wider
  // threatReach that the flash band below uses. The two are allowed to differ
  // here: a dash's threat band is its whole commit range (so the white flash
  // rides the coil and you get time to answer), but resolving a parry on that
  // band would let you turn a charge aside from six metres away, on its first
  // striking frame, before it had gone anywhere. A charge is parried WHEN IT
  // ARRIVES — the dash action's own contact check does it, at contactReach.
  if (self.combat.currentAbility && self.fsm.state === 'striking' && !self.combat.meleeHitLanded
      && isParryActive() && isDeflectable(self.combat.currentAbility) && playerFacingThis(self, playerPos)) {
    const pReach = firstMeleeReach(self.combat.currentAbility);
    const pArc = meleeArcOf(self, self.combat.currentAbility);
    // Same arc as the damage and the flash. Without it you could turn aside —
    // and collect the riposte for — a swing that was never going to reach you.
    if (pReach !== null && distance <= pReach + 1.2
        && (pArc === null || withinArc(self, playerPos, pArc))) {
      resolveParry(self, playerPos);
    }
  }

  // A clean parry's riposte (resolveParry → takeDamage above) can FINISH the
  // mob right here, mid-update, BEFORE the switch. The death path already
  // popped this mob's deflect opportunity and ran its drops/cleanup — but
  // currentAbility is still set (resolveParry returns early on a kill, before
  // nulling it), so falling through to the strike switch would run strike
  // logic on a corpse AND re-arm the threat flash at frame-end (2273), leaking
  // the global deflect count. A leaked count leaves deflectOpportunityActive()
  // stuck true, so left-click dead-routes to a no-op deflect forever. Bail the
  // instant the riposte finished it — this is the parry-kill deadlock fix.
  if (!self.fsm.alive) return;

  switch (self.fsm.state) {
    case 'dormant': {
      // No perception, no movement, no idle scan, no vocalisation.
      // Only check is "did the boss-bar engagement flip on?" — the
      // fog-wall cross trigger flips it, and that's our wake
      // signal. We jump straight to chasing so the bar appearing,
      // the boss intro, and the boss starting to hunt all land on
      // the SAME frame the player crosses the threshold.
      if (isBossEngaged()) {
        self.fsm.state = 'chasing';
        self.fsm.phaseTimer = 0;
      }
      break;
    }
    case 'staggered': {
      // Poise broken — reel in place, can't act. A DIZZY TUMBLE: recoil back,
      // then wobble + spin around the model's own axis like a cartoon
      // character seeing stars (eased out as it recovers), eyes dimmed, the
      // stun-star ring orbiting overhead. The openWhenStaggered weak points
      // are exposed this whole window. The free-hit the player earned.
      // The beat is advanced once per frame by action.tick (above); read its
      // elapsed time to drive the dizzy → settle arc.
      const elapsed = self.actionFsm.staggerElapsed();
      // Dizzy for the first ~1.5s (spin + drunken lean), then SETTLE into a
      // slumped, head-down stun with a gentle sway for the rest of the long
      // window — reads "down for a beat", not spinning forever.
      const wob = Math.max(0, 1 - elapsed / 1.5);
      applyTilt(self, -0.45 - 0.25 * wob);                                  // stays slumped back
      self.built.group.rotation.y = Math.sin(elapsed * 15) * 0.4 * wob;    // dizzy spin
      self.built.group.rotation.z = Math.sin(elapsed * 11) * 0.18 * wob + Math.sin(elapsed * 2.2) * 0.06;
      self.applyIdleEyes();              // eyes go dim — visibly stunned, not glaring
      self.built.group.position.y = 0;
      // Placed above the model's ACTUAL top, not a guessed height — a tall
      // body (stoneguard) otherwise buries the stars in its chest.
      if (!self.pres.stunStars) self.pres.stunStars = createStunStars(self.container, crownHeight(self) + 0.4);
      if (!self.actionFsm.isStaggered()) {
        applyTilt(self, 0);
        self.built.group.rotation.y = 0;
        self.built.group.rotation.z = 0;
        setStaggerVuln(self, false);   // close the exposed weak point
        // If the blow that broke it came from BEHIND, fear was imposed during
        // the reel and cashes in here: it comes out of the stagger running,
        // not swinging. That handoff is the whole poise→panic→backstab loop.
        if (self.poise.fearTimer > 0) breakMorale(self);
        else { self.fsm.state = 'chasing'; self.fsm.phaseTimer = 0; }
      }
      break;
    }
    case 'fleeing': {
      // Nerve broke — ROUT away from the player, then COWER at a safe remove (a
      // free kill), then re-engage ONCE (brokenOnce stops a second flee). The
      // head-track keeps it glancing back over its shoulder as it runs.
      self.fsm.phaseTimer += dt;
      const M = CONFIG.ENEMY_AI.MORALE;
      if (self.poise.cowerTimer > 0) {
        // COWERING — hunched, defenceless. Bolt again if the player closes back
        // in; otherwise hold until nerve returns.
        self.poise.cowerTimer -= dt;
        if (distance < M.FLEE_SAFE_DIST * 0.6) {
          self.poise.cowerTimer = 0;   // player chased it down → bolt
        } else {
          applyTilt(self, -0.5);            // hunched down/back
          self.eyePresenter.applySearch();  // eyes dim — cowed, not glaring
          self.built.group.position.y = 0;
          if (self.poise.cowerTimer <= 0) {
            // Nerve returns when the cower runs out — UNLESS fear is still on
            // it, in which case no amount of hiding is enough. Refresh the
            // cower rather than letting it lapse, so it stays hunched instead
            // of twitching back into a one-frame rout every 2.6s.
            if (self.poise.fearTimer > 0) self.poise.cowerTimer = M.COWER_DURATION;
            else { applyTilt(self, 0); self.fsm.state = 'chasing'; self.fsm.phaseTimer = 0; }
          }
          break;
        }
      }
      // ROUT — run directly away from the player, panicked + fast.
      const dxr = self.container.position.x - playerPos.x, dzr = self.container.position.z - playerPos.z;
      const l = Math.hypot(dxr, dzr) || 1;
      const bx = self.container.position.x, bz = self.container.position.z;
      moveTowards(self, self.container.position.x + (dxr / l) * 3.0, self.container.position.z + (dzr / l) * 3.0,
                  moveSpeed * M.FLEE_SPEED_MUL, dt, walkable, nav);
      faceMovement(self, self.container.position.x - bx, self.container.position.z - bz, playerPos, dt);
      self.eyePresenter.applySearch();
      applyTilt(self, 0);
      self.built.group.position.y = 0;
      // Reached safety → cower. Cornered (can't open the gap after a few
      // seconds of running the walls) → cower anyway, a trapped coward.
      if (distance >= M.FLEE_SAFE_DIST || self.fsm.phaseTimer > 3.0) self.poise.cowerTimer = M.COWER_DURATION;
      break;
    }
    case 'idle': {
      // Dormant boss (king behind its fog gate): hold dead STILL — no
      // gaze scan, no alerts. It's asleep, looming, until you commit.
      // (The constant left-right idle scan reads as a twitchy giant.)
      if (dormant) {
        self.applyIdleEyes();
        applyTilt(self, 0);
        self.built.group.position.y = 0;
        break;
      }
      // ── AMBIENT WANDER (non-hostile vermin) ────────────────────────────
      // A maggot never hunts; instead of standing frozen it crawls slowly
      // between random spots near its spawn, wriggling as it goes — living
      // atmosphere. Paused between crawls with an in-place squirm.
      if (!self.hostileToPlayer) {
        if (!self.idle.homeSet) { self.idle.homeX = self.container.position.x; self.idle.homeZ = self.container.position.z; self.idle.homeSet = true; }
        const wt = gameNow() / 1000;   // game clock: live = performance.now(), replay = stepped
        self.applyIdleEyes();
        applyTilt(self, 0);
        if (self.idle.wanderPause > 0) {
          self.idle.wanderPause -= dt;
          self.container.rotation.y += Math.sin(wt * 3.0 + self.wrigglePhase) * dt * 0.5;   // idle squirm
          self.built.group.position.y = Math.abs(Math.sin(wt * 2.4 + self.wrigglePhase)) * 0.006;
          break;
        }
        if (!self.idle.wanderActive) {
          const a = gameRng() * Math.PI * 2;
          const r = 0.4 + gameRng() * 1.2;
          self.idle.wanderX = self.idle.homeX + Math.cos(a) * r;
          self.idle.wanderZ = self.idle.homeZ + Math.sin(a) * r;
          self.idle.wanderActive = true; self.idle.wanderTimer = 0;
        }
        self.idle.wanderTimer += dt;
        const wdx = self.idle.wanderX - self.container.position.x, wdz = self.idle.wanderZ - self.container.position.z;
        if (Math.hypot(wdx, wdz) < 0.14 || self.idle.wanderTimer > 3) {
          self.idle.wanderActive = false;
          self.idle.wanderPause = 0.7 + gameRng() * 1.6;   // rest + wriggle between crawls
          self.built.group.position.y = 0;
          break;
        }
        moveTowards(self, self.idle.wanderX, self.idle.wanderZ, moveSpeed, dt, walkable, nav);
        // Ease yaw toward travel + a side-to-side wriggle (the grub crawl).
        const targetYaw = Math.atan2(wdx, wdz) + Math.PI;
        let dyw = targetYaw - self.container.rotation.y;
        while (dyw > Math.PI) dyw -= Math.PI * 2; while (dyw < -Math.PI) dyw += Math.PI * 2;
        self.container.rotation.y += dyw * Math.min(1, dt * 2.5) + Math.sin(wt * 8 + self.wrigglePhase) * dt * 0.9;
        self.built.group.position.y = Math.abs(Math.sin(wt * 9 + self.wrigglePhase)) * 0.008;
        break;
      }
      // Shared aggro pickup — if a fellow mob has broadcast an alert
      // and we're inside its radius, join the fight. Sets lastSeenPos
      // to the alert location so 'searching' / 'chasing' have a
      // direction to head even if we don't currently have LOS.
      const alert = self.hostileToPlayer ? sampleAlert(self.container.position.x, self.container.position.z) : null;
      if (alert) {
        self.aware.aggroed = true;
        self.lastSeenPos.set(alert.x, 0, alert.z);
        self.fsm.state = 'alerted';
        self.fsm.phaseTimer = 0;
        playEnemyWindup(audioSizeFor(self.spec), self.container.position);
        break;
      }
      // Slow scan around home yaw. Pick a new target angle every
      // IDLE_SCAN_INTERVAL seconds; lerp toward it. Dim eye flare so
      // a watching player can tell at a glance "this one hasn't seen me yet."
      self.idle.scanTimer += dt;
      if (self.idle.scanTimer >= self.idle.scanInterval) {
        self.idle.scanTimer = 0;
        self.idle.scanInterval = IDLE_SCAN_INTERVAL_MIN + gameRng() * IDLE_SCAN_INTERVAL_JITTER;
        if (gameRng() < IDLE_SCAN_HOLD_CHANCE) {
          // Pause: keep watching the current direction for a beat.
          self.idle.scanTargetYaw = self.container.rotation.y;
        } else {
          // Gentle random-walk with a HOME-PULL: step a little from where we're
          // looking, but bias 35% back toward home each step so the gaze settles
          // looking forward instead of pinging between the arc edges (the old
          // left-right metronome). Clamped to ±arc as a hard backstop.
          const stepped = self.idle.scanTargetYaw
            + (gameRng() * 2 - 1) * IDLE_SCAN_STEP
            - (self.idle.scanTargetYaw - self.idle.homeYaw) * 0.35;
          self.idle.scanTargetYaw = Math.max(self.idle.homeYaw - IDLE_SCAN_HALF_ARC,
                                   Math.min(self.idle.homeYaw + IDLE_SCAN_HALF_ARC, stepped));
        }
      }
      // Ease container yaw toward the scan target — slow, so a gaze shift drifts
      // with weight instead of snapping. Wrap delta to nearest π.
      let delta = self.idle.scanTargetYaw - self.container.rotation.y;
      while (delta >  Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      self.container.rotation.y += delta * Math.min(1, dt * 0.6);
      self.applyIdleEyes();
      applyTilt(self, 0);
      self.built.group.position.y = 0;
      break;
    }

    case 'alerted': {
      // Brief "I see you" pause. Eyes flare bright, body rears back
      // slightly, then commits to chase. Face player during this so the
      // moment reads — the model snaps from scan-pose to confront-pose.
      self.fsm.phaseTimer += dt;
      const t = Math.min(1, self.fsm.phaseTimer / ALERTED_DURATION);
      faceTarget(self, playerPos, dt);
      self.setEyeFlare(t);
      applyTilt(self, -0.15 * t);   // slight rear-back (negative tilt)
      self.built.group.position.y = 0;
      if (self.fsm.phaseTimer >= ALERTED_DURATION) {
        self.fsm.state = 'chasing';
        self.fsm.phaseTimer = 0;
      }
      break;
    }

    case 'searching': {
      // Walk toward last known position. If we get close to it without
      // re-acquiring (canSeePlayer handles that above by resetting
      // state to chasing on re-acquire), wait a beat, then return home.
      self.fsm.phaseTimer += dt;
      const dxs = self.lastSeenPos.x - self.container.position.x;
      const dzs = self.lastSeenPos.z - self.container.position.z;
      const distToLast = Math.hypot(dxs, dzs);
      // Face the search direction.
      faceTarget(self, self.lastSeenPos, dt);
      if (distToLast > 0.4) {
        // Wary search — slower than chase (0.7x). Pathfinds around
        // obstacles, same as chasing.
        moveTowards(self, self.lastSeenPos.x, self.lastSeenPos.z, moveSpeed * 0.7, dt, walkable, nav);
      }
      // Search times out either by phaseTimer or by re-acquiring (above).
      if (self.fsm.phaseTimer >= SEARCH_DURATION) {
        self.fsm.state = 'returning';
        self.fsm.phaseTimer = 0;
      }
      // Dimmer eye flare during search — alert but not committed.
      self.eyePresenter.applySearch();
      applyTilt(self, 0);
      self.built.group.position.y = 0;
      break;
    }

    case 'returning': {
      // Returning home also picks up alerts — if combat reignites
      // before we've reached our post, turn back around.
      const returnAlert = self.hostileToPlayer ? sampleAlert(self.container.position.x, self.container.position.z) : null;
      if (returnAlert) {
        self.aware.aggroed = true;
        self.lastSeenPos.set(returnAlert.x, 0, returnAlert.z);
        self.fsm.state = 'chasing';
        self.fsm.phaseTimer = 0;
        break;
      }
      // Walk back to spawn post. On arrival, snap to home yaw and idle.
      const dxr = self.homePos.x - self.container.position.x;
      const dzr = self.homePos.z - self.container.position.z;
      const distHome = Math.hypot(dxr, dzr);
      if (distHome < 0.25) {
        self.fsm.state = 'idle';
        // Reset scan so it picks a fresh target next idle tick.
        self.idle.scanTimer = self.idle.scanInterval;
        self.idle.scanTargetYaw = self.idle.homeYaw;
        break;
      }
      // Walk back to spawn at 0.6x speed, routing around obstacles.
      moveTowards(self, self.homePos.x, self.homePos.z, moveSpeed * 0.6, dt, walkable, nav);
      // Face direction of travel — use the home delta direction so
      // facing is stable even if the path waypoint pulls slightly
      // sideways.
      tmpDir.set(self.homePos.x - self.container.position.x, 0, self.homePos.z - self.container.position.z);
      if (tmpDir.lengthSq() > 1e-6) tmpDir.normalize();
      faceXZ(self, self.container.position.x + tmpDir.x, self.container.position.z + tmpDir.z);
      self.applyIdleEyes();
      applyTilt(self, 0);
      self.built.group.position.y = 0;
      break;
    }

    case 'chasing': {
      // ATTACK FIRST: if a ready ability's band contains us, commit to
      // it — regardless of being a kiter or "too close." This is the
      // fix for kiters never attacking: the flee branch used to run
      // first, so an acolyte (which the faster player can always stay
      // close to) fled forever and never cast. Now it shoots whenever
      // it can; the cooldown between shots is its window to reposition.
      // Gate the commit on a pack ATTACK TOKEN — only ATTACK_TOKENS mobs may
      // be mid-attack at once. A mob that wants to attack but can't get a
      // token falls through to movement below: it holds the ring and prowls,
      // waiting its turn (the pack takes turns lunging instead of all swinging
      // at once). Bosses + lone mobs are unaffected (a token is always free).
      // ── Intent decision (Enemy AI V2) ─────────────────────────────
      // Warm the mood toward the personality's target while engaged, then
      // re-pick the intent on the slow decision tick (commitment, not jitter).
      // Bosses skip this and keep the old always-commit pressure.
      if (self.useIntent) {
        const I = CONFIG.ENEMY_AI.INTENT;
        const warmTarget = I.MOOD_TARGET_BASE + self.personality.boldness * I.MOOD_TARGET_BOLD;
        self.intent.aggression += (warmTarget - self.intent.aggression) * Math.min(1, I.MOOD_WARM_RATE * dt);
        // Time since this mob last COMMITTED an attack. Reset at the commit
        // below (not when `press` is merely chosen — a press that never gets
        // an ability or a pack token has not fed the mob, and resetting there
        // would let it starve-loop while still doing nothing).
        self.intent.sinceCommit += dt;
        self.intent.decisionTimer -= dt;
        if (self.intent.decisionTimer <= 0) {
          self.intent.decisionTimer = I.DECISION_MIN + gameRng() * I.DECISION_JITTER;
          const ent = getEntity(self.entityId);
          const hpFrac = ent?.hp && self.bossPhases.maxHp > 0 ? ent.hp.current / self.bossPhases.maxHp : 1;
          self.intent.currentIntent = selectIntent({
            distance, reach: self.spec.strikeRange, commitDistance: self.commitDistance,
            aggression: self.intent.aggression, personality: self.personality,
            canAttack: selectAbility(self, distance) !== null,
            hpFrac, sinceCommit: self.intent.sinceCommit, rng: gameRng,
          });
        }
      }

      const ability = selectAbility(self, distance);
      // Attacks are HELD unless an aggressive intent (press) releases one —
      // that's what makes the fight breathe. Bosses always release.
      const mayRelease = !self.useIntent || self.intent.currentIntent.releaseAttack;
      if (ability && self.actionFsm.canAct() && mayRelease && requestToken(self.entityId)) {
        self.combat.currentAbility = ability;
        self.combat.meleeHitLanded = false;   // fresh strike — parryable until it connects
        self.fsm.state = 'winding';
        self.fsm.phaseTimer = 0;
        self.rollWindupTime();
        // A bomb arming gets the FUSE instead of the generic windup bark: a
        // rising whine held for the exact length of this mob's windup, so the
        // pitch climb tells you how long you have. Josh's ask was that the
        // thing about to blow says so diegetically — no meter, no icon; the
        // sound, the swelling body, and the ring on the floor are the UI.
        if (armedBlastAction(self)) playFuse(self.container.position, self.combat.currentWindupTime);
        else playEnemyWindup(audioSizeFor(self.spec), self.container.position);
        // Snapshot the committed target (the 'lockedTarget' anchor) +
        // raise the spatial telegraph the instant the windup begins, so
        // the player has the full windup to step off the marker.
        setupAbilityTelegraph(self, ability, playerPos);
        // Committing spends aggression → a lull before the next burst.
        if (self.useIntent) self.intent.aggression = Math.max(0, self.intent.aggression - CONFIG.ENEMY_AI.INTENT.MOOD_COMMIT_DROP);
        self.intent.sinceCommit = 0;   // fed — the starvation pressure resets
      } else {
        // No ability available (out of band, or on cooldown).
        const pref = self.spec.preferredRange ?? 0;
        // Ranged mobs only fight from a CLEAR sightline (DOOM's ranged demons
        // hold an open angle rather than firing into cover). A blocked kiter
        // repositions to round the obstacle instead of holding behind a wall.
        const kiterCanShoot = pref > 0
          && walkable.hasLineOfSight(self.container.position.x, self.container.position.z, playerPos.x, playerPos.z);
        if (self.combat.plantTimer > 0) {
          // PLANTED — it just fired and is watching what you do about it.
          faceTarget(self, playerPos, dt);
        } else if (kiterCanShoot && distance < pref) {
          // KITER too close — back away to reopen the gap (the
          // reposition window between shots). Aim ~2m directly away;
          // moveTowards pathfinds + clamps against walls. Cornered, it
          // can't retreat (your reward for running it down).
          const dx = self.container.position.x - playerPos.x;
          const dz = self.container.position.z - playerPos.z;
          const len = Math.hypot(dx, dz) || 1;
          moveTowards(self, 
            self.container.position.x + (dx / len) * 2.0,
            self.container.position.z + (dz / len) * 2.0,
            moveSpeed, dt, walkable, nav,
          );
          faceXZ(self, playerPos.x, playerPos.z);   // ranged: keep the player in its sights as it backs off
        } else if (kiterCanShoot && distance <= self.commitDistance) {
          // KITER waiting out its cooldown while comfortably in range +
          // sighted — HOLD position (just keep facing the player). Without this
          // it would creep toward you between shots, which looked wrong.
          faceTarget(self, playerPos, dt);
        } else if (pref > 0 && !kiterCanShoot) {
          // RANGED, shot BLOCKED — advance to round the obstacle and regain a
          // sightline (moveTowards pathfinds around walls); once it can see you
          // again it drops back to hold + fire. Faces its actual travel.
          const bx = self.container.position.x, bz = self.container.position.z;
          moveTowards(self, playerPos.x, playerPos.z, moveSpeed, dt, walkable, nav);
          faceMovement(self, self.container.position.x - bx, self.container.position.z - bz, playerPos, dt);
        } else if (self.useIntent && self.intent.currentIntent.moveMode === 'hold') {
          // WATCH — the lull, but COILED not frozen: periodically feint a lunge
          // (dart in, snap back) so it reads as circling for an opening. Between
          // feints it holds + faces the player (the head already tracks).
          if (!tickFeint(self, dt, playerPos, walkable, nav)) faceMovement(self, 0, 0, playerPos, dt);
        } else if (distance > 0.1) {
          // CLOSE / CIRCLE / press — move to the PACK ring slot (surrounds the
          // player; speed scales with the intent — press rushes, circle prowls),
          // then face the mob's ACTUAL travel this frame. Charging in → it faces
          // you; prowling the ring → it faces along its arc (circles, showing its
          // flank) rather than crab-walking sideways; blocked/arrived → it faces
          // you, poised. The windup's aim-ramp snaps the final aim on the strike.
          const spd = self.useIntent ? self.intent.currentIntent.speedMul : 1;
          const ringTarget = packMoveTarget(self.entityId, playerPos, packScratch());
          const tx = ringTarget ? ringTarget.x : playerPos.x;
          const tz = ringTarget ? ringTarget.z : playerPos.z;
          const bx = self.container.position.x, bz = self.container.position.z;
          moveTowards(self, tx, tz, moveSpeed * spd, dt, walkable, nav);
          faceMovement(self, self.container.position.x - bx, self.container.position.z - bz, playerPos, dt);
        } else {
          faceMovement(self, 0, 0, playerPos, dt);   // on top of the player — face them
        }
      }
      self.setEyeFlare(0);
      applyTilt(self, 0);
      self.built.group.position.y = 0;
      break;
    }

    case 'winding': {
      if (!self.combat.currentAbility) { self.fsm.state = 'chasing'; break; }
      self.fsm.phaseTimer += actionDt;
      tickAbilityMotion(self, dt, walkable);
      const t = Math.min(1, self.fsm.phaseTimer / self.combat.currentWindupTime);
      applyTelegraph(self, self.combat.currentAbility.pose, 'windup', t);
      if (self.combat.aoeTelegraph) self.combat.aoeTelegraph.setProgress(t);
      if (self.combat.lashTendril) self.combat.lashTendril.setProgress(t);   // tentacle reaches out over the windup
      // Melee creep — close at half-speed during windup so a stationary
      // player still gets clipped (a backpedalling player out-runs it).
      // Charges DON'T creep: the dash strike is the approach.
      // A primed BLAST creeps too, and at full speed: once it's armed it is
      // committed, and a bomb that stops walking the moment it lights is a
      // bomb you beat by taking one step back.
      const reach = creepReach(self.combat.currentAbility);
      if (wantsCreep(self.combat.currentAbility) && reach !== null && distance > reach) {
        moveTowards(self, playerPos.x, playerPos.z, moveSpeed * creepSpeedMul(self.combat.currentAbility), dt, walkable, nav);
      }
      // Drag a self-anchored danger ring along with the body.
      if (self.combat.aoeTelegraph && self.combat.aoeTelegraphFollowsSelf) {
        self.combat.aoeTelegraph.moveTo(self.container.position.x, self.container.position.z);
      }
      // The core runs hot as the fuse burns (the body's swell is the other
      // half of the tell — it lives in tickLashDeform, which owns scale).
      if (armedBlastAction(self)) self.setEyeFlare(Math.min(1, 0.35 + 0.65 * t));
      if (self.fsm.phaseTimer >= self.combat.currentWindupTime) {
        self.fsm.state = 'striking';
        self.fsm.phaseTimer = 0;
        playEnemyStrike(audioSizeFor(self.spec), self.container.position);  // the attack RELEASE bark
        // Arm the timeline: clear per-step latches + events, capture the
        // leap takeoff point.
        self.combat.stepStarted = self.combat.currentAbility.steps.map(() => false);
        self.combat.stepDone = self.combat.currentAbility.steps.map(() => false);
        self.stepEvents.clear();
        self.leapStart.copy(self.container.position);
      }
      break;
    }

    case 'striking': {
      if (!self.combat.currentAbility) { self.fsm.state = 'chasing'; break; }
      self.fsm.phaseTimer += actionDt;
      tickAbilityMotion(self, dt, walkable);
      // Run the timeline: fire each step once its trigger is met, then
      // keep ticking it until its action latches done. Per-step state,
      // so steps never interfere with each other.
      const steps = self.combat.currentAbility.steps;
      for (let i = 0; i < steps.length; i++) {
        if (self.combat.stepDone[i]) continue;
        if (!self.combat.stepStarted[i]) {
          if (!triggerMet(self, steps[i].trigger, self.fsm.phaseTimer)) continue;
          // MELEE CONTACT timing — a melee blow lands when the swing reaches
          // the struck pose (CONTACT_FRAC into the strike), not on strike-frame
          // 0. This is what connects the damage to the visible swing and lets a
          // dodge read against the swing, not the windup. Other action kinds
          // (projectile / aoe / dash / leap) fire on their authored `at`.
          if (steps[i].action.kind === 'melee'
              && self.fsm.phaseTimer < self.combat.currentAbility.strike * CONFIG.MOB_STRIKE_CONTACT_FRAC) continue;
          self.combat.stepStarted[i] = true;
        }
        const done = runAction(self, steps[i].action, self.combat.currentAbility, steps[i].id, playerPos, distance, dt, walkable, nav);
        if (done) self.combat.stepDone[i] = true;
        // A deflected melee strike calls triggerStagger() inside runAction,
        // which NULLS currentAbility and flips to 'staggered' mid-loop. Bail
        // immediately — the rest of this case dereferences currentAbility
        // (.pose / .strike) and would crash (the parry-freeze bug).
        if (!self.combat.currentAbility) break;
      }
      if (!self.combat.currentAbility) break;
      applyTelegraph(self, self.combat.currentAbility.pose, 'strike',
        self.combat.currentAbility.strike > 0 ? Math.min(1, self.fsm.phaseTimer / self.combat.currentAbility.strike) : 1);
      if (self.combat.lashTendril) self.combat.lashTendril.snap();            // tentacle snaps out + flares on the strike
      if (self.fsm.phaseTimer >= self.combat.currentAbility.strike) {
        self.fsm.state = 'recovering';
        self.fsm.phaseTimer = 0;
        // Safety: snap any in-air leap Y back to ground if the touchdown
        // didn't catch the final frame (dt overshoot), so the enemy
        // can't end up floating at the arc peak.
        self.container.position.y = groundYAt(self.container.position.x, self.container.position.z);
      }
      break;
    }

    case 'recovering': {
      if (!self.combat.currentAbility) { self.fsm.state = 'chasing'; break; }
      self.fsm.phaseTimer += actionDt;
      tickAbilityMotion(self, dt, walkable);
      const t = Math.min(1, self.fsm.phaseTimer / self.combat.currentAbility.recover);
      applyTelegraph(self, self.combat.currentAbility.pose, 'recover', t);
      if (self.combat.lashTendril) self.combat.lashTendril.setProgress(Math.max(0, 1 - t));   // retract the tentacle
      if (self.fsm.phaseTimer >= self.combat.currentAbility.recover) {
        // Hold the ground it just shot from (see plantTimer).
        if (self.combat.currentAbility.steps.some((st) => st.action.kind === 'projectile')) {
          self.combat.plantTimer = CONFIG.ENEMY_AI.RANGED_PLANT_S;
        }
        // ±18% jitter so packs drift out of sync over the fight.
        self.cooldowns.set(self.combat.currentAbility.id, (self.combat.currentAbility.cooldown ?? 0) * (0.82 + gameRng() * 0.36));
        self.combat.currentAbility = null;
        clearAoeTelegraph(self);   // safety — normally disposed at strike
        clearLashTendril(self);
        self.fsm.state = 'chasing';
        self.fsm.phaseTimer = 0;
      }
      break;
    }
  }

  // ── Reactive-defense threat flash ────────────────────────────────
  // Flash during the lead-up to a reachable CONTACT strike: the last
  // FLASH_LEAD_S of windup through the whole strike window. Deflectable
  // abilities flash white (and open a parry opportunity); unblockable
  // ones flash red (dodge only). Everything else (ranged/aoe/leap/blast)
  // never flashes — those are avoided, not parried.
  // threatReach (not firstMeleeReach) so a CHARGE flashes too: its band is
  // the commit range, because a dash brings itself to you and flashing at
  // contact distance would leave no time to answer.
  {
    const mReach = self.combat.currentAbility ? threatReach(self.combat.currentAbility) : null;
    const lead = CONFIG.DEFLECT.FLASH_LEAD_S;
    // aliveLocal guard: a mob killed by its own riposte mid-update (the
    // runAction safety-net parry path reaches here with currentAbility still
    // set) must NEVER re-arm the flash — that's the deflect-count leak.
    // The flash must respect the same arc the damage does — and this is a
    // TEACHING signal, not just correctness: once the aim locks at commit, a
    // player who circles out of the wedge watches the flash go dark. That's
    // the game saying "you're clear now", and it's how the arc gets learned
    // without a tutorial.
    const mArc = self.combat.currentAbility ? meleeArcOf(self, self.combat.currentAbility) : null;
    const opener = self.combat.currentAbility?.steps[0]?.action;
    let wantFlash = false;
    if (self.fsm.alive && self.combat.currentAbility && !self.combat.meleeHitLanded) {
      if (opener?.kind === 'dash' && self.fsm.state === 'striking') {
        // A CHARGE is told by TIME-TO-CONTACT, not by phase or distance band.
        // A dash closes at its own speed from anywhere in its commit range, so
        // a phase-based tell gives wildly different warning depending on where
        // it started: the skirmisher committing at 6.5m needs ~0.69s to arrive,
        // committing at 1.8m needs ~0.06s. A fixed band would flash a full
        // second early in one case and far too late in the other. Flashing at a
        // fixed time BEFORE ARRIVAL gives the same honest reaction budget every
        // time, which is the whole point of the number.
        const ttc = opener.speed > 0
          ? Math.max(0, (distance - opener.contactReach) / opener.speed)
          : 0;
        wantFlash = ttc <= lead;
      } else if (mReach !== null) {
        wantFlash = distance <= mReach + 1.2
          && (mArc === null || withinArc(self, playerPos, mArc))
          && (self.fsm.state === 'striking'
              || (self.fsm.state === 'winding' && self.fsm.phaseTimer >= self.combat.currentWindupTime - lead));
      }
    }
    reconcileThreat(self, wantFlash, wantFlash && isDeflectable(self.combat.currentAbility!));
  }

  // ── Post-AI animation/audio overlays ─────────────────────────────
  // Order matters: head crane + knockback, then gait (reads this frame's
  // net movement), then the presence overlay last so its idle bob stacks
  // on top of whatever the state animation set.
  // Zero the vertical base BEFORE the overlays. They ADD their bob/dip to
  // group.position.y each frame; without a clean base, any AI state that
  // forgets to reset y lets the presence dip ACCUMULATE (~+0.4 m/s upward —
  // the "floating away" bug). One reset here makes the overlays drift-proof.
  self.built.group.position.y = 0;
  // Ceiling-drop entrance — override the base y while parked above / falling.
  // Parked at DROP_HEIGHT while dormant (hidden); on wake it accelerates down
  // (ease-in = gravity) and slams the floor with a quake. The presence bob
  // below then stacks normally once it's landed (entranceTimer past the dur).
  if (self.isCeilingDrop) {
    if (dormant) {
      self.built.group.position.y = DROP_HEIGHT;
    } else if (self.pres.entranceTimer >= 0 && self.pres.entranceTimer < ENTRANCE_DUR) {
      self.pres.entranceTimer += dt;
      const t = Math.min(1, self.pres.entranceTimer / ENTRANCE_DUR);
      self.built.group.position.y = DROP_HEIGHT * (1 - t * t);   // ease-in fall
      if (t >= 1 && !self.pres.entranceImpactDone) {
        self.pres.entranceImpactDone = true;
        kickShake(0.6, 0.5);   // the slam
      }
    }
  }
  // Focus tracking: the signed yaw from the body's CURRENT facing to the player
  // (this frame's root yaw is already set above), so the head twists to keep
  // watching you while the body faces its movement (DOOM-style — see enemy-animation).
  const _pYaw = Math.atan2(playerPos.x - self.container.position.x, playerPos.z - self.container.position.z) + Math.PI;
  const yawToPlayer = Math.atan2(Math.sin(_pYaw - self.container.rotation.y), Math.cos(_pYaw - self.container.rotation.y));
  self.bodyAnim.tickHeadCrane(dt, distance, self.aware.aggroed && self.fsm.state !== 'returning', yawToPlayer);
  self.bodyAnim.tickKnockback(dt, walkable);
  self.bodyAnim.tickLocomotion(dt);
  self.bodyAnim.tickPresence(dt);
  self.bodyAnim.tickFlinch(dt);   // parry recoil — owns rotation.x while active, so last
  tickLashDeform(self, dt);
  tickClipAnimator(self, dt);
  // Pose-system mobs rest their telegraph arms when NOT mid-attack (clip-mobs
  // self-rest via their base clip). Without this a biped's shoulders freeze
  // mid-swing on a stagger/interrupt. Attack phases set the pose themselves.
  if (!self.usesClipAttacks && self.fsm.state !== 'winding' && self.fsm.state !== 'striking' && self.fsm.state !== 'recovering') {
    restTelegraphPose(self.telegraphNodes);
  }
  // Stun-star ring — orbits while staggered, fades out after (so it lingers a
  // beat as the mob shakes it off). No-op until the first stagger builds it.
  self.pres.stunStars?.tick(dt, self.fsm.state === 'staggered');
  // FEAR skull — hangs over anything whose nerve has broken, whether the game
  // frightened it (the low-HP morale roll) or the player did (a poise break
  // from behind). Suppressed while STAGGERED so the two overhead cues never
  // stack on one head; the skull takes over the instant the reel ends, which
  // is also the instant the mob turns and runs.
  {
    const showSkull = self.isFeared() && self.fsm.state !== 'staggered';
    if (showSkull && !self.pres.fearSkull) self.pres.fearSkull = createFearSkull(self.container, crownHeight(self) + 0.20);
    self.pres.fearSkull?.tick(dt, showSkull);
  }
}
