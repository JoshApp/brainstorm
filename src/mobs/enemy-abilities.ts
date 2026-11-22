// The ability runner: choosing a cast, telegraphing it, running its steps.
//
// An ability (content/abilities.ts) is a timeline of steps, each an action
// fired when its trigger holds. runAction resolves one action this frame:
// melee (with the parry and perfect-dodge ladder), projectile and fans, dash
// (same ladder at contact), aoe, blast, leap (a deterministic arc onto a
// locked landing) and field. setupAbilityTelegraph shows the windup's tell
// (ground ring, lash tendril, pose); fireBlast is the detonation shared by
// armed bombs and the killed-while-armed case.
//
// A subsystem of createEnemy over EnemyCtx (mobs/enemy-ctx.ts).

import { fireCombatVerb } from '../combat/combat-verbs';
import { spawnHazardField } from '../combat/hazard-field';
import { tryJustDodge } from '../combat/just-dodge';
import { spawnProjectile } from '../combat/projectile-pool';
import { radialBlast } from '../combat/radial-blast';
import { isParryActive } from '../combat/reactive-defense';
import { kickShake } from '../combat/screen-shake';
import { CONFIG } from '../config';
import { ELEMENTS, isDeflectable, type Ability, type AbilityAction, type Anchor, type Element, type Trigger } from '../content/abilities';
import { applyBuff } from '../ecs/buffs';
import { get as getEntity } from '../ecs/world';
import { spawnAoeTelegraph } from '../effects/aoe-telegraph';
import { spawnLashTendril } from '../effects/lash-tendril';
import { gameRngChance } from '../engine/rng';
import { groundYAt } from '../level/elevation';
import { type NavGrid } from '../level/nav-grid';
import { type WalkableRegion } from '../level/walkable';
import { getCurrentWeapon } from '../player/current-weapon';
import { damagePlayer } from '../player/health';
import { applyPlayerKnockback } from '../player/knockback';
import type { EnemyCtx } from './enemy-ctx';

/** clampMoveInto scratch (synchronous use only). */
const tmpClampFwd = { x: 0, z: 0 };
import { resolveParry, takeDamage } from './enemy-damage';
import { faceXZ, moveTowards, playerFacingThis, withinArc } from './enemy-locomotion';
import { applyTelegraphPose, type TelegraphStyle } from './pose-clips';
import * as THREE from 'three';

const tmpMuzzle = new THREE.Vector3();

const tmpTarget = new THREE.Vector3();

const tmpFanTarget = new THREE.Vector3();

// Charge-recoil speed (the dash's contact knockback). The impulse itself is
// owned + integrated by the body animator (bodyAnim.applyKnockback / tick).
const KNOCKBACK_CHARGE = 4.5;

export function clearAoeTelegraph(self: EnemyCtx) {
  if (self.combat.aoeTelegraph) { self.combat.aoeTelegraph.dispose(); self.combat.aoeTelegraph = null; }
  self.combat.aoeTelegraphFollowsSelf = false;
}

export function clearLashTendril(self: EnemyCtx) {
  if (self.combat.lashTendril) { self.combat.lashTendril.dispose(); self.combat.lashTendril = null; }
}

/**
 * Steer toward a world target, routing around obstacles via the nav
 * grid when there's no line-of-sight. Centralized so every state that
 * moves (chasing, searching, returning, winding) gets the same
 * "doesn't get stuck on pillars" behavior. For phasing mobs the
 * pathfinder is bypassed — they just steer directly and pass through
 * props (walls still block them through clampMove's ignoreObstacles).
 */
/** ROOT MOTION for the current ability — the step-in that makes a swing
 *  TRAVEL. Runs during winding / striking / recovering, so a step can be
 *  authored anywhere in the window.
 *
 *  Moves along the caster's COMMITTED FACING, never toward the player. That
 *  is the entire read: facing locks at commit, so the attack carries down the
 *  line it aimed and you beat it by not being on that line. A homing step
 *  would be a small dash and would delete the positional answer — the same
 *  mistake, in movement, that the missing melee arc was in space.
 *
 *  Goes through walkable.clampMoveInto like every other root writer, or mobs
 *  would step through walls. */
export function tickAbilityMotion(self: EnemyCtx, dt: number, walkable: WalkableRegion): void {
  const m = self.combat.currentAbility?.motion;
  if (!m || !self.combat.currentAbility) return;
  const total = self.combat.currentWindupTime + self.combat.currentAbility.strike + self.combat.currentAbility.recover;
  if (total <= 0) return;

  // Elapsed across the WHOLE window, so from/to read as one timeline rather
  // than per-phase fractions the author would have to convert by hand.
  const elapsed =
    self.fsm.state === 'winding'    ? self.fsm.phaseTimer
    : self.fsm.state === 'striking' ? self.combat.currentWindupTime + self.fsm.phaseTimer
    : self.fsm.state === 'recovering' ? self.combat.currentWindupTime + self.combat.currentAbility.strike + self.fsm.phaseTimer
    : -1;
  if (elapsed < 0) return;

  const p = elapsed / total;
  if (p < m.from || p > m.to) return;

  const span = Math.max(1e-4, m.to - m.from);
  const speed = m.distance / (span * total);       // metres per second
  const step = speed * dt;
  if (step <= 0) return;

  const fx = -Math.sin(self.container.rotation.y);      // committed facing (-Z local)
  const fz = -Math.cos(self.container.rotation.y);
  const cx = self.container.position.x, cz = self.container.position.z;
  const resolved = walkable.clampMoveInto(
    tmpClampFwd, cx, cz, cx + fx * step, cz + fz * step,
    self.spec.collisionRadius,
    self.spec.phasing ? { ignoreObstacles: true } : undefined,
  );
  self.container.position.x = resolved.x;
  self.container.position.z = resolved.z;
}

// (setEyeFlare / applyIdleEyes live above as eye-presenter aliases.)
// ── Ability runner helpers ─────────────────────────────────────────
/** Pick the highest-priority ready ability whose range band contains
 *  `distance`. null if none is ready/in-band (caller then steers). */
export function selectAbility(self: EnemyCtx, distance: number): Ability | null {
  for (const ab of self.combat.abilities) {
    if ((self.cooldowns.get(ab.id) ?? 0) > 0) continue;
    const min = ab.minRange ?? 0;
    if (distance >= min && distance <= ab.maxRange) return ab;
  }
  return null;
}

/** Telegraph + strike pose per ability flavour, driven by phase
 *  progress t (0..1). Data-driven via TELEGRAPH_POSES (pose-clips.ts):
 *  body lean + rise on every enemy, plus an arm swing on models that
 *  have shoulder pivots (graceful no-op otherwise). Eye flare ramps
 *  with the windup, holds at strike, fades over recover. */
export function applyTelegraph(self: EnemyCtx, style: Ability['pose'], phase: 'windup' | 'strike' | 'recover', t: number) {
  // Creatures drive the swing through their archetype clip (the override fires
  // on the windup edge); skip the legacy pose so they don't fight over the
  // shoulders. The eye-flare telegraph still plays for everyone.
  if (!self.usesClipAttacks) applyTelegraphPose(self.telegraphNodes, style as TelegraphStyle | undefined, phase, t);
  self.setEyeFlare(phase === 'windup' ? t : phase === 'strike' ? 1 : 1 - t);
}

/** Apply this enemy's on-hit status to the player, if it has one and
 *  the roll succeeds. Called after any strike that damages the player
 *  (melee + dash contact). Sourced to this enemy for kill attribution. */
export function inflictOnHit(self: EnemyCtx) {
  const oh = self.spec.onHit;
  if (!oh || !gameRngChance(oh.chance)) return;
  const player = getEntity('player');
  if (player) applyBuff(player, oh.buffId, oh.duration, self.entityId);
}

/** Resolve an anchor to a world XZ. self/player are live; lockedTarget
 *  is the snapshot taken at windup start (aoeTarget); landing is written
 *  by a leap on touchdown. */
export function resolveAnchor(self: EnemyCtx, a: Anchor, playerPos: THREE.Vector3): { x: number; z: number } {
  switch (a) {
    case 'self':         return { x: self.container.position.x, z: self.container.position.z };
    case 'lockedTarget': return { x: self.aoeTarget.x, z: self.aoeTarget.z };
    case 'landing':      return { x: self.landing.x, z: self.landing.z };
    default:             return { x: playerPos.x, z: playerPos.z };   // 'player'
  }
}

/** Damage type for an action's element (the element table is the single
 *  source — physical/arcane carry no status). */
export function dmgTypeOf(self: EnemyCtx, element?: Element) {
  return ELEMENTS[element ?? 'physical'].damageType;
}

export function fireBlast(
  self: EnemyCtx,
  action: Extract<AbilityAction, { kind: 'blast' }>,
  at: { x: number; z: number },
  playerPos: THREE.Vector3,
): void {
  if (self.combat.blastSpent) return;
  self.combat.blastSpent = true;
  clearAoeTelegraph(self);
  radialBlast(self.scene, {
    x: at.x, y: groundYAt(at.x, at.z), z: at.z,
    radius: action.radius,
    playerPos,
    damage: action.damage,
    mobDamage: action.mobDamage,
    rimDamageFrac: action.rimDamageFrac,
    knockbackSpeed: action.knockbackSpeed,
    shake: action.shake,
    color: action.color,
    type: dmgTypeOf(self, action.element),
    source: self.entityId,
    // Never let the bomb damage itself — it re-enters its own takeDamage
    // mid-death, and the self-destruct below already kills it.
    exclude: self.entityId,
  });
  // The bomb IS the enemy: it dies delivering the payload. source:null makes
  // this an ENVIRONMENTAL death, so a mob that blew itself up doesn't hand
  // the player kill credit for a fight they didn't win. It still runs the
  // full death path (drops, room-clear count, dissolve).
  if (action.selfDestruct && self.fsm.alive) {
    takeDamage(self, { source: null, target: self.entityId, base: 9999, type: 'physical' });
  }
}

/** The blast this mob is ARMED with right now, if any — i.e. it has committed
 *  to a blast ability and hasn't delivered it yet. Killing an armed bomb must
 *  still set it off: that is what makes "back off, or kill it early" a real
 *  decision instead of a gotcha for correctly killing the thing. */
export function armedBlastAction(self: EnemyCtx): Extract<AbilityAction, { kind: 'blast' }> | null {
  if (self.combat.blastSpent || !self.combat.currentAbility) return null;
  if (self.fsm.state !== 'winding' && self.fsm.state !== 'striking') return null;
  for (const step of self.combat.currentAbility.steps) {
    if (step.action.kind === 'blast') return step.action;
  }
  return null;
}

export function runAction(
  self: EnemyCtx,
  action: AbilityAction,
  ability: Ability,
  stepId: string | undefined,
  playerPos: THREE.Vector3,
  distance: number,
  dt: number,
  walkable: WalkableRegion,
  nav?: NavGrid,
): boolean {
  switch (action.kind) {
    case 'melee': {
      if (distance <= action.reach && withinArc(self, playerPos, action.arc)) {
        // Parry SAFETY NET — the airtight guarantee. The pre-switch block in
        // update catches the crisp strike-onset case using an approximate
        // reach band; THIS check runs at the exact instant a specific step
        // would connect, with its exact reach. If the window is live now, the
        // strike is deflected, NOT dealt — so no hit ever slips through while
        // a parry is open (a longer-reach step, a late damage frame, a tap
        // that lands a frame after onset all funnel through here).
        if (self.combat.currentAbility && isDeflectable(self.combat.currentAbility) && isParryActive()
            && playerFacingThis(self, playerPos)) {
          resolveParry(self, playerPos);
          return true;          // strike consumed — NO damage
        }
        // PERFECT DODGE — a precisely-timed roll (started within the perfect
        // window of this strike) earns the bonus, mirroring the parry. The
        // roll's own i-frames negate the damage; this pays the reward. A
        // merely early/sloppy dodge falls through to damagePlayer, where the
        // i-frames still negate it (survives, no bonus).
        if (tryJustDodge()) {
          fireCombatVerb(getCurrentWeapon().onPerfectDodge, self.entityId, 'self');
          return true;   // read the strike + rolled it
        }
        damagePlayer(action.damage, self.entityId, dmgTypeOf(self, action.element));
        inflictOnHit(self);
        self.combat.meleeHitLanded = true;  // the blow connected — strike is spent, no late parry
        return true;            // hit — done
      }
      // NEAR-MISS perfect dodge — the blade released right at your edge but
      // the roll carried you just clear IN TIME. A clean dodge escapes by
      // RANGE, so without this band a perfectly-timed roll would slip the
      // reward entirely (the in-reach path never runs). Reward the read.
      if (distance <= action.reach + CONFIG.JUST_DODGE.NEAR_MISS_GRACE && tryJustDodge()) {
        fireCombatVerb(getCurrentWeapon().onPerfectDodge, self.entityId, 'self');
        return true;            // the roll answered the strike
      }
      return false;             // keep trying within the strike window
    }
    case 'projectile': {
      tmpMuzzle.set(action.muzzle[0], action.muzzle[1], action.muzzle[2]);
      self.container.updateMatrixWorld();
      tmpMuzzle.applyMatrix4(self.container.matrixWorld);
      const t = resolveAnchor(self, action.toward ?? 'player', playerPos);
      // Aim at the player's eye height (playerPos IS camera.position — the
      // same reference the projectile hit-test uses), NOT flat at the muzzle
      // height. A low muzzle (e.g. the ground-hugging acid-spitter at y≈0.4)
      // would otherwise fly level UNDER the player's vertical hit window
      // (|dy| < 1.2) and never connect. Chest-height shooters (acolyte) are
      // unaffected — their muzzle already sits at player height.
      tmpTarget.set(t.x, playerPos.y, t.z);
      const count = action.count ?? 1;
      if (count <= 1) {
        spawnProjectile({
          typeId: action.projectileId, origin: tmpMuzzle, target: tmpTarget,
          damage: action.damage, source: self.entityId,
        });
      } else {
        // Fan: spread `count` projectiles around the centreline by
        // rotating the muzzle→target vector horizontally. Total spread
        // is symmetric around 0 (centre shard goes straight at the
        // anchor; outer shards lean ±spreadDeg/2). The shard radius
        // each carries `damage` independently — stacking is real.
        const spreadRad = ((action.spreadDeg ?? 18) * Math.PI) / 180;
        const dx0 = tmpTarget.x - tmpMuzzle.x;
        const dz0 = tmpTarget.z - tmpMuzzle.z;
        const dist = Math.hypot(dx0, dz0) || 1;
        for (let i = 0; i < count; i++) {
          // -0.5..+0.5 across the count, scaled to spreadRad.
          const f = count === 1 ? 0 : i / (count - 1) - 0.5;
          const ang = f * spreadRad;
          const c = Math.cos(ang), s = Math.sin(ang);
          const dxR = dx0 * c - dz0 * s;
          const dzR = dx0 * s + dz0 * c;
          // Re-project to roughly the same distance so all shards
          // share a launch speed and arc.
          const k = dist / Math.hypot(dxR, dzR);
          tmpFanTarget.set(tmpMuzzle.x + dxR * k, tmpTarget.y, tmpMuzzle.z + dzR * k);
          spawnProjectile({
            typeId: action.projectileId, origin: tmpMuzzle, target: tmpFanTarget,
            damage: action.damage, source: self.entityId,
          });
        }
      }
      return true;
    }
    case 'dash': {
      // Lunge until contact (or the strike runs out). The moment it
      // connects we hit + recoil OFF the player and stop driving forward,
      // so the charger doesn't end up stuck inside you.
      const tgt = resolveAnchor(self, action.toward, playerPos);
      moveTowards(self, tgt.x, tgt.z, action.speed, dt, walkable, nav);
      if (distance <= action.contactReach) {
        // MEET THE CHARGE. This ladder mirrors the melee case, and its absence
        // was the whole reason a charge could only ever be dodged: the parry
        // check lived in the `melee` action, and a dash's contact damage is a
        // different code path that never consulted it. So an ability tagged
        // deflectable would flash white — promising a counter — and then hit
        // you through the parry anyway. Now the promise is kept.
        if (self.combat.currentAbility && isDeflectable(self.combat.currentAbility) && isParryActive()
            && playerFacingThis(self, playerPos)) {
          resolveParry(self, playerPos,
            CONFIG.DEFLECT.CHARGE_POISE_MUL, CONFIG.DEFLECT.CHARGE_KNOCKBACK_MUL);
          return true;          // charge broken on your guard — NO damage, and it stops
        }
        if (tryJustDodge()) {
          fireCombatVerb(getCurrentWeapon().onPerfectDodge, self.entityId, 'self');
          return true;          // read the charge and rolled through it
        }
        damagePlayer(action.damage, self.entityId, dmgTypeOf(self, action.element));
        inflictOnHit(self);
        self.combat.meleeHitLanded = true;  // connected — no late parry can still turn it
        self.bodyAnim.applyKnockback(
          self.container.position.x - playerPos.x,
          self.container.position.z - playerPos.z,
          KNOCKBACK_CHARGE,
        );
        return true;            // contact — stop dashing
      }
      return false;
    }
    case 'aoe': {
      // Resolve against the action's origin (lockedTarget snapshot, or
      // self) — the player dodges by leaving the marked circle.
      const o = resolveAnchor(self, action.origin, playerPos);
      const dx = playerPos.x - o.x;
      const dz = playerPos.z - o.z;
      if (dx * dx + dz * dz <= action.radius * action.radius) {
        damagePlayer(action.damage, self.entityId, dmgTypeOf(self, action.element));
      }
      clearAoeTelegraph(self);
      return true;
    }
    case 'blast': {
      fireBlast(self, action, resolveAnchor(self, action.origin, playerPos), playerPos);
      return true;
    }
    case 'leap': {
      // Committed airborne jump: deterministic interpolation from takeoff
      // (leapStart) to the LOCKED landing zone, synced to a parabolic arc,
      // so the king touches down exactly on the marker. Self-contained;
      // never shares state, so it runs the whole strike.
      const strike = ability.strike > 0 ? ability.strike : 1;
      const t = Math.min(1, self.fsm.phaseTimer / strike);
      const dest = resolveAnchor(self, action.toward, playerPos);
      // Cap the travel to maxDistance from takeoff (a small chase hop),
      // else the arc covers the full gap in one leap.
      if (action.maxDistance) {
        const ddx = dest.x - self.leapStart.x;
        const ddz = dest.z - self.leapStart.z;
        const dd = Math.hypot(ddx, ddz);
        if (dd > action.maxDistance) {
          dest.x = self.leapStart.x + (ddx / dd) * action.maxDistance;
          dest.z = self.leapStart.z + (ddz / dd) * action.maxDistance;
        }
      }

      // Horizontal: ease to arrive OVER the marker by ~the apex, then
      // hold — so the back half reads as a committed vertical drop onto
      // the locked spot, not a glide.
      const riseFrac = action.riseFraction ?? 0.5;
      const hu = Math.min(1, t / Math.min(0.85, riseFrac + 0.2));
      const he = hu * hu * (3 - 2 * hu);               // smoothstep
      const tx = self.leapStart.x + (dest.x - self.leapStart.x) * he;
      const tz = self.leapStart.z + (dest.z - self.leapStart.z) * he;
      const resolved = walkable.clampMoveInto(
        tmpClampFwd,
        self.container.position.x, self.container.position.z, tx, tz,
        self.spec.collisionRadius,
        self.spec.phasing ? { ignoreObstacles: true } : undefined,
      );
      self.container.position.x = resolved.x;
      self.container.position.z = resolved.z;

      // Vertical: rise fast (ease into a brief hang at the apex), then a
      // gentle smoothstep descent with a soft landing — riseFrac < 0.5
      // stretches the drop so the player can read it and dodge off.
      let vy: number;
      if (t <= riseFrac) {
        const u = riseFrac > 0 ? t / riseFrac : 1;
        vy = Math.sin(u * Math.PI / 2);                // 0→1, decelerates into the apex
      } else {
        const u = (t - riseFrac) / (1 - riseFrac);     // 0→1 over the descent
        vy = 1 - u * u * (3 - 2 * u);                  // 1→0, slow-fast-slow (soft landing)
      }
      self.container.position.y = groundYAt(self.container.position.x, self.container.position.z) + action.arcHeight * vy;
      faceXZ(self, dest.x, dest.z);

      if (t >= 1) {
        self.container.position.y = groundYAt(self.container.position.x, self.container.position.z);
        // Write the landing anchor so a follow-up step (a puddle) can
        // build on the impact point, and emit the 'land' event.
        self.landing.set(self.container.position.x, self.container.position.y, self.container.position.z);
        if (action.shake) kickShake(action.shake, action.shakeDuration ?? 0.4);
        const dx = playerPos.x - self.container.position.x;
        const dz = playerPos.z - self.container.position.z;
        if (dx * dx + dz * dz <= action.landingRadius * action.landingRadius) {
          damagePlayer(action.damage, self.entityId, dmgTypeOf(self, action.element));
          inflictOnHit(self);
          if (action.knockbackSpeed) applyPlayerKnockback(dx, dz, action.knockbackSpeed);
        }
        clearAoeTelegraph(self);
        if (stepId) self.stepEvents.add(stepId + ':land');
        return true;            // landed — done
      }
      return false;
    }
    case 'field': {
      // Drop a persistent hazard field at the resolved origin (e.g. the
      // king's leap spilling an acid puddle at its `landing` point). It
      // ticks independently from here on — outliving this cast — and its
      // DoT is credited to this enemy.
      const o = resolveAnchor(self, action.origin, playerPos);
      spawnHazardField(self.scene, {
        x: o.x, z: o.z, radius: action.radius, lifetime: action.lifetime,
        slow: action.slow, dps: action.dps, dotInterval: action.dotInterval,
        damageType: dmgTypeOf(self, action.element), source: self.entityId,
        color: action.element === 'fire' ? 0xff5a1e
          : action.element === 'frost' ? 0x6ab8ff
          : 0x6abf2a,   // acid / default green
      });
      return true;
    }
  }
}

/** True when a step's trigger condition holds this frame. */
export function triggerMet(self: EnemyCtx, trigger: Trigger, clock: number): boolean {
  if ('at' in trigger) return clock >= trigger.at;
  return self.stepEvents.has(trigger.after + ':' + trigger.on);
}

/** At windup start: snapshot the locked target (the 'lockedTarget'
 *  anchor) and raise the spatial ground ring for the ability's first
 *  aoe/leap action — its "stand here and you eat it" tell. Melee/dash/
 *  projectile abilities have no ground ring (the pose is the tell). A
 *  leap clamps its landing zone outward to minDistance so a player
 *  hugging the body still gets a real arc. */
export function setupAbilityTelegraph(self: EnemyCtx, ability: Ability, playerPos: THREE.Vector3) {
  self.aoeTarget.set(playerPos.x, 0, playerPos.z);
  clearAoeTelegraph(self);
  for (const step of ability.steps) {
    const a = step.action;
    if (a.kind === 'aoe' || a.kind === 'blast') {
      const o = a.origin === 'self'
        ? { x: self.container.position.x, z: self.container.position.z }
        : { x: self.aoeTarget.x, z: self.aoeTarget.z };
      self.combat.aoeTelegraph = spawnAoeTelegraph(self.scene, o.x, o.z, a.radius);
      // A self-anchored ring on a mob that CREEPS during its windup has to
      // follow it, or the painted radius and the real one part company.
      self.combat.aoeTelegraphFollowsSelf = a.origin === 'self';
      return;
    }
    // Only a COMMITTED leap (onto the locked target) telegraphs a
    // landing ring — that's the "step off the marker" attack. A homing
    // hop (toward 'player') is just chase movement; no ring.
    if (a.kind === 'leap' && a.toward === 'lockedTarget') {
      const minD = a.minDistance ?? 0;
      const dx = self.aoeTarget.x - self.container.position.x;
      const dz = self.aoeTarget.z - self.container.position.z;
      const d = Math.hypot(dx, dz);
      if (minD > 0 && d < minD) {
        const dir = d > 1e-4
          ? { x: dx / d, z: dz / d }
          : { x: Math.sin(self.container.rotation.y), z: -Math.cos(self.container.rotation.y) };
        self.aoeTarget.set(
          self.container.position.x + dir.x * minD, 0,
          self.container.position.z + dir.z * minD,
        );
      }
      self.combat.aoeTelegraph = spawnAoeTelegraph(self.scene, self.aoeTarget.x, self.aoeTarget.z, a.landingRadius);
      return;
    }
  }
  // Lash — grow a slime tentacle out of the body toward the player. It
  // reaches over the windup (driven in the winding state), so it both
  // telegraphs and IS the attack. Reach = the lash's melee reach.
  if (ability.pose === 'lash') {
    const melee = ability.steps.find((st) => st.action.kind === 'melee')?.action;
    const reach = melee && melee.kind === 'melee' ? melee.reach : 3.0;
    clearLashTendril(self);
    self.combat.lashTendril = spawnLashTendril(self.container, self.aimHeightResolved, reach, 0xa8ff44);
  }
}
