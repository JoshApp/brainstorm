// What happens when an enemy is hit.
//
// takeDamage is the single entry for every source (melee, projectiles, DoT —
// registered as the entity's damage sink): the burrow / phase / summon gates,
// armour via computeDamage, hit reactions, part breaks and summons through
// boss-phases, morale, and the kill (drops, payoffs, gore, death.begin).
// Poise: applyStaggerDamage chips the pool, triggerStagger breaks it into a
// stagger (the execute window). Morale: breakMorale and applyFear rout it.
// resolveParry is a deflected strike's consequence for the attacker.
//
// A subsystem of createEnemy over EnemyCtx (mobs/enemy-ctx.ts).

import { playEnemyDeath, playEnemyHurt } from '../audio/sfx';
import { emit } from '../broadcast/event-bus';
import { fireCombatVerb } from '../combat/combat-verbs';
import { clearEntityCombatStats, computeDamage, type DamageEvent, unregisterDamageSink } from '../combat/damage';
import { fireDeathPayoffs } from '../combat/death-payoffs';
import { notePlayerDeflected } from '../combat/reactive-defense';
import { kickShake } from '../combat/screen-shake';
import { CONFIG } from '../config';
import { rollDropTable } from '../content/drop-tables';
import { arenaEnemiesInvincible } from '../debug/arena-mode';
import { tagPerfEvent } from '../debug/perf-recorder';
import { applyBuff } from '../ecs/buffs';
import { destroy as destroyEntity, get as getEntity } from '../ecs/world';
import { BREAK_RED, CLASH_GOLD, flashCombatWord } from '../effects/combat-word';
import { spawnGoldCoins } from '../effects/gold-coins';
import { spawnParrySpark } from '../effects/parry-spark';
import { gameRng, gameRngChance } from '../engine/rng';
import { createPickup } from '../interactables/pickup';
import { getCurrentDepth } from '../level/loader';
import { getCurrentWeapon } from '../player/current-weapon';
import { emitGoreSplash, stampBleedOut } from '../scene/splat-map';
import { LEVELS_ENABLED } from '../state/leveling';
import { audioSizeFor } from './enemy-overlays';
import type { EnemyCtx } from './enemy-ctx';
import { armedBlastAction, clearAoeTelegraph, clearLashTendril, fireBlast } from './enemy-abilities';
import { reconcileThreat } from './enemy-overlays';
import { leavePack } from './pack';
import * as THREE from 'three';

/** Toggle stagger-window weak points (zones flagged openWhenStaggered). */
export function setStaggerVuln(self: EnemyCtx, on: boolean): void {
  for (const z of self.hurtbox.zones) if (z.openWhenStaggered) z.enabled = on;
}

/**
 * Apply incoming damage. Takes a DamageEvent and routes through the
 * pipeline (computes final after this enemy's armor for the type),
 * then mutates HP and fires presentation effects.
 *
 * Returns the actual amount applied (caller can use for damage numbers).
 */
export function takeDamage(self: EnemyCtx, event: DamageEvent): number {
  if (!self.fsm.alive) return 0;
  // Buried/emerging mobs can't be hit — the creature itself is
  // underground or mid-burst, not yet a valid target. Routes
  // through here normally; we short-circuit before HP changes.
  if (!self.burrow.surfaced) return 0;
  // Multi-phase boss: invuln window on phase entry (e.g. the
  // skeleton's downed-and-rising animation).
  if (self.bossPhases.phaseInvulnerable) return 0;
  // SUMMON-GATE split window: untouchable for the brief spit only. The blow
  // clangs off (no wound, no wound-cry); the window closes a beat later and the
  // boss is open again whether or not its brood still lives.
  if (self.bossPhases.summonInvulnerable) { self.bossPhases.summonHitReact(); return 0; }
  const entity = getEntity(self.entityId);
  if (!entity || !entity.hp) return 0;
  const result = computeDamage(event);
  entity.hp.current = Math.max(0, entity.hp.current - result.applied);
  // Fire the NEXT summon threshold whenever this hit crosses it (one add per
  // threshold, spat one at a time as the boss is worn down). `while` so a big
  // hit that vaults two thresholds still owes both adds; never on a killing blow
  // (the lowest threshold is well above 0).
  self.bossPhases.fireCrossedSummons(entity.hp.current);
  // DEV training arena: floor HP at 1 so the sparring partner never dies —
  // hit flash, poise/stagger, and aggro all still fire above. Inert in prod
  // (the flag's setter ANDs with DEV).
  if (arenaEnemiesInvincible() && entity.hp.current <= 0) entity.hp.current = 1;
  // DoT ticks (bleed/poison/burn) have no attack/projectile caller to float
  // a damage number, so emit one from here — at the body centre, tinted to
  // the affliction's element. Works on the killing tick too (container
  // position is still valid through the death animation).
  if (event.dot && result.applied > 0) {
    emit({
      type: 'enemy:dot',
      x: self.container.position.x,
      y: self.container.position.y + self.aimHeightResolved,
      z: self.container.position.z,
      amount: result.applied,
      color: event.tint ?? 0xffffff,
    });
  }
  // Phase part-break thresholds — fire at-most-once per threshold.
  self.bossPhases.breakCrossedParts(entity.hp.current);
  self.coreReactor.hit();   // hit flash + glowing-core flare/pop (king)
  // Light rung of the hit ladder: a surviving hit that isn't mid-commit twitches
  // the body — "it felt that", so damage reads on a thinking thing, not a sponge.
  // Committed states (winding/striking) keep their telegraph clean — only a
  // FALTER (a heavy hit) interrupts those; a staggered mob is already reeling.
  if (entity.hp.current > 0 && self.fsm.state !== 'winding' && self.fsm.state !== 'striking' && self.fsm.state !== 'staggered') {
    self.bodyAnim.twitch();
  }
  // Pained cry when it survives the blow — the creature's voice on top of
  // the weapon's impact, so every connecting hit reads as "I hurt it." The
  // death path has its own (heavier) collapse sound, so skip if this killed.
  if (entity.hp.current > 0 && self.vocalArch) playEnemyHurt(self.vocalArch, self.container.position);
  // Damage from any source aggros (and keeps aggro for the full
  // loseSightTime window after the hit, even if the player breaks LOS
  // — a wounded mob doesn't forget). If we were idle/searching/etc,
  // jump straight to chasing (skip the alerted hesitation — being hit
  // IS the wake-up).
  self.aware.aggroed = true;
  self.aware.timeSinceLOS = 0;
  // Taking a hit cools the mood — the mob recoils and re-sizes-you-up before
  // its next burst (the intent layer reads `aggression`). Survivors only.
  if (entity.hp.current > 0) {
    self.intent.aggression = Math.max(0, self.intent.aggression - CONFIG.ENEMY_AI.INTENT.MOOD_HURT_DROP);
    // MORALE — crossing the low-HP line can BREAK the nerve: cowards rout,
    // berserkers fight on. Once per life; never a boss / already-broken / reeling
    // mob. (Bosses opt out of the intent layer, so `useIntent` gates it.)
    const M = CONFIG.ENEMY_AI.MORALE;
    if (self.useIntent && !self.poise.brokenOnce && self.fsm.state !== 'fleeing' && self.fsm.state !== 'staggered'
        && entity.hp.current <= self.bossPhases.maxHp * M.BREAK_HP
        && gameRngChance((1 - self.personality.boldness) * M.BREAK_CHANCE)) {
      breakMorale(self);
    }
  }
  if (self.hostileToPlayer && self.fsm.state !== 'fleeing'
      && (self.fsm.state === 'idle' || self.fsm.state === 'alerted' || self.fsm.state === 'searching' || self.fsm.state === 'returning')) {
    self.fsm.state = 'chasing';
    self.fsm.phaseTimer = 0;
  }
  if (entity.hp.current <= 0) {
    // Multi-phase: if there's a next phase, transition INSTEAD of dying —
    // animated collapse over the invuln window (mobs/boss-phases.ts).
    if (self.bossPhases.hasNextPhase()) {
      self.bossPhases.enterNext(true);
      return result.applied;
    }
    // Killed while ARMED — the bomb still goes off. Fired BEFORE aliveLocal
    // flips so fireBlast's self-destruct is a no-op (this death is already
    // in flight) and the blast is credited normally. Without this, correctly
    // killing a primed bomb would be the one safe answer to it, which is
    // exactly backwards: the tension is "back off, or kill it early", and
    // both halves of that only exist if a late kill still detonates.
    const armed = armedBlastAction(self);
    if (armed) fireBlast(self, armed, self.container.position, self.lastPlayerXZ);
    // Killed mid-windup — drop any pending AoE marker / lash tentacle so
    // it doesn't linger after the caster is gone.
    clearAoeTelegraph(self);
    clearLashTendril(self);
    // Mark dead immediately for combat/gameplay purposes (no more
    // damage, no AI ticks, kill counter triggers, drops spawn). The
    // container stays in the scene for the duration of the death
    // animation — the dissolve uniform + soul wisps run via the
    // dying-branch in update(). Final scene.remove happens when the
    // death sequence ends (mobs/enemy-death.ts).
    self.fsm.alive = false;
    // SUBSTRATE payoff hook (docs/BUILD-ECONOMY.md): fire status-death payoffs
    // while the dying enemy's buffs are STILL LIVE (before destroyEntity below).
    // A bleeding kill chains bleed to neighbours + feeds the blood-drinker.
    fireDeathPayoffs(entity, self.container.position);
    // Pop any OPEN deflect opportunity this mob was holding — a mob killed
    // mid-flash (white deflectable strike up) would otherwise leak the global
    // count, because the dead branch of update() returns before reconcileThreat
    // ever runs again. A leaked count leaves deflectOpportunityActive() stuck
    // true, so a LEFT-CLICK keeps routing to a (no-op) deflect and never
    // swings — while Space, which bypasses the tap arbiter, still attacks.
    reconcileThreat(self, false, false);
    // Snapshot the statuses live at the moment of death — destroyEntity wipes
    // them, but the kill event below must still say "died bleeding" so relic
    // triggers can condition on it (TriggerSpec.condition.victimHasBuff).
    const victimBuffs = entity.buffs.map((b) => b.specId);
    clearEntityCombatStats(self.entityId);
    unregisterDamageSink(self.entityId);
    destroyEntity(self.entityId);
    leavePack(self.entityId);   // killed mobs don't hit disposeEnemy — leave here
    playEnemyDeath(audioSizeFor(self.spec), self.container.position);
    // Drop table: each entry rolls independently. Multiple successful
    // drops are spread in a small arc around the death position so they
    // don't stack on the same pixel.
    // Unified DROP TABLE (content/drop-tables.ts) — the enemy's WHOLE drop from
    // one named table: gold + the odd key/consumable, or (elites/bosses) a
    // relic. No per-enemy pool arrays; a mob just names its tier. Items pop out
    // of the corpse on their own arcs; gold flies to the counter below.
    //
    // BOSSES DEFER their reward: a boss (the king, its princes, any boss body)
    // drops NOTHING on its own death — the hoard spawns once when the whole
    // boss ENCOUNTER completes (builder's onBossEncounterComplete), erupting
    // beside the bonfire that rises from the arena floor. This is the
    // "loot when the fight is over, not mid-fight" rule: a king that dies while
    // its brood still lives, or a prince cut down mid-fight, must not litter
    // the floor with the boss hoard before the room is clear.
    // Minibosses defer too — their reward erupts with the rest-fire on
    // encounter-complete (same rule as bosses, one tier down).
    // SUMMONED mobs pay nothing — not an item, not a coin. A spawner you can
    // stand next to is an infinite income tap otherwise, and the reward for a
    // summoned fight belongs to the encounter, once, when it resolves.
    if (!self.spec.isBoss && !self.spec.miniboss && !self.fsm.summoned) {
      const bundle = rollDropTable(self.spec.dropTable ?? 'enemy', getCurrentDepth(), gameRng);
      const N = bundle.items.length;
      bundle.items.forEach((item, i) => {
        const pos = self.container.position.clone();
        const angle = (N > 1 ? (i / N) * Math.PI * 2 : Math.random() * Math.PI * 2)
          + (Math.random() - 0.5) * 0.6;
        const horizontalSpeed = 1.4 + Math.random() * 0.6;
        const verticalSpeed = 3.6 + Math.random() * 0.5;
        const launchVel = new THREE.Vector3(
          Math.cos(angle) * horizontalSpeed,
          verticalSpeed,
          Math.sin(angle) * horizontalSpeed,
        );
        createPickup(self.scene, pos, item, { velocity: launchVel });
      });
      if (bundle.gold > 0) {
        const coinOrigin = self.container.position.clone();
        coinOrigin.y += 0.5;
        spawnGoldCoins(self.scene as THREE.Object3D, coinOrigin, bundle.gold);
      }
    }
    // Clear raycast targets so a swing mid-dissolve doesn't generate a
    // zero-damage "hit" on the disintegrating corpse.
    self.built.hitTargets.length = 0;
    // Tidy the stun ring + any leftover dizzy tumble if it died staggered.
    self.pres.stunStars?.dispose(); self.pres.stunStars = null;
    self.pres.fearSkull?.dispose(); self.pres.fearSkull = null;
    self.built.group.rotation.y = 0; self.built.group.rotation.z = 0;
    emit({ type: 'enemy:killed', enemyId: self.spec.id, victimBuffs });
    // Death soaks the floor: a big pool under the corpse plus a
    // directional spray thrown by the killing blow (away from the
    // player), in the species' own blood.
    const gore = self.spec.bloodAmount ?? 1;
    if (gore > 0.01) {
      const bloodC = self.spec.bloodColor ?? 0x5e1210;
      // The killing blow throws a MODEST splash (it used to detonate at
      // 1.4× — the whole pool arrived in one frame). The pool itself now
      // BLEEDS OUT under the corpse: stampBleedOut pulses ~1.6s of
      // spreading stain while the body dissolves.
      emitGoreSplash(
        self.container.position.x, self.container.position.z,
        self.container.position.y + 0.7 + Math.random() * 0.4,
        self.container.position.x - self.lastPlayerXZ.x,
        self.container.position.z - self.lastPlayerXZ.z,
        0.8 * gore, bloodC,
        { wallFallbackCardinals: true, sizeMul: Math.min(1.8, 0.75 + self.spec.collisionRadius * 0.9) },
      );
      stampBleedOut(self.container.position.x, self.container.position.z, bloodC, gore);
    }
    // Split-on-death — fire the builder's spawn callback so any
    // children appear in the same frame's enemy list. Pass a CLONE
    // of the death position because the builder may need it after
    // we've moved on (and clone is cheap).
    tagPerfEvent('death');   // perf timeline (no-op unless the dashcam rolls)
    if (self.onDeath) self.onDeath(self.spec, self.container.position.clone(), self.entityId);
    // Start the death: sever + gore on the killing blow, then the topple and
    // dissolve tick in update() (mobs/enemy-death.ts). XP/levels disabled
    // (#102) → no essence wisps (they granted XP); souls will revive this as
    // soul-shed later. Gold drops now as physical floor pickups.
    self.death.begin(event, self.lastPlayerXZ, LEVELS_ENABLED ? (self.spec.xp ?? 1) : 0);
    // (Gold now rides the unified drop table above — see rollDropTable.)
  }
  return result.applied;
}

// Chip the poise pool; break it → STAGGER. Called from the combat
// cone on a heavy melee hit, with the attacker's already-resolved
// stagger power (weapon weight × Might × charge — see attack.ts).
export function applyStaggerDamage(self: EnemyCtx, amount: number): boolean {
  if (!self.fsm.alive || !self.burrow.surfaced || amount <= 0) return false;
  if (!self.actionFsm.canBeStaggered()) return false;     // already reeling
  if (self.bossPhases.phaseInvulnerable) return false;     // boss phase-entry invuln
  self.poise.poiseLeft -= amount;
  self.poise.poiseRegenCd = CONFIG.POISE.REGEN_DELAY;
  if (self.poise.poiseLeft <= 0) { triggerStagger(self); return true; }
  // FALTER — the middle rung of the ladder. A heavy-enough single hit
  // (charged / hammer / a countered or deflect-empowered blow — light taps fall
  // under the threshold) that lands WHILE the enemy is committed to an attack
  // INTERRUPTS that attack, without a full break. This is the reward for
  // committing during a telegraph: bury a heavy in its wind-up and cancel the
  // swing. The poise damage still stands (it accumulates toward the real break)
  // and a cooldown stops you chain-faltering a windup forever. Reuses the
  // existing flinch-lock beat + parry-recoil stumble — no new interrupt system.
  if (amount >= CONFIG.POISE.FALTER_THRESHOLD
      && (self.fsm.state === 'winding' || self.fsm.state === 'striking')
      && self.poise.falterCd <= 0) {
    self.poise.falterCd = CONFIG.POISE.FALTER_CD;
    self.combat.currentAbility = null;
    clearAoeTelegraph(self);
    clearLashTendril(self);
    reconcileThreat(self, false, false);   // its threat flash is spent — the attack died
    self.setEyeFlare(0);
    self.actionFsm.enterFlinchLock(CONFIG.POISE.FALTER_LOCK_S);
    self.bodyAnim.flinch(CONFIG.POISE.FALTER_FLINCH);   // a visible backward stumble
    self.fsm.state = 'chasing';
    self.fsm.phaseTimer = 0;
  }
  return false;
}

export function triggerStagger(self: EnemyCtx): void {
  // Cancel whatever it was doing — the wind-up/strike is INTERRUPTED.
  self.combat.currentAbility = null;
  clearAoeTelegraph(self);
  clearLashTendril(self);
  self.setEyeFlare(0);
  // Visual punctuation of the break: a white hit-flash on the body (the
  // player-side cue — popup/sound/crunch — fires from attack.ts). Plus a punch
  // WORD so the poise-break reads as a decisive beat, not just a stumble.
  self.coreReactor.hit();
  flashCombatWord('BROKEN', BREAK_RED);
  self.fsm.state = 'staggered';
  self.actionFsm.enterStagger(CONFIG.POISE.STAGGER_DURATION);
  self.fsm.phaseTimer = 0;
  self.poise.poiseLeft = self.poise.poiseMax;          // reset — must be broken again
  self.poise.poiseRegenCd = CONFIG.POISE.REGEN_DELAY;
  self.aware.aggroed = true;                // a staggered mob is very much aware of you
  setStaggerVuln(self, true);          // expose any openWhenStaggered weak points
  // (Audio: the breaking hit's own hurt cry — via takeDamage — covers
  // the moment. A dedicated heavier "stagger" SFX is future polish.)
}

// Nerve BREAKS — the creature routs. Drop whatever it was doing and flee.
//
// A ROUT IS A FEAR. There used to be two ways into this state and they were
// not the same state: an IMPOSED fear (a poise break from behind) set
// `fearTimer` and then routed, while a SPONTANEOUS morale break just set
// `state = 'fleeing'` and left the timer at zero. The two then behaved
// differently in every place that reads the timer — the cower refreshed for
// one and lapsed for the other, the post-fear immunity engaged for one and
// not the other — and the `dread` debuff (content/buffs.ts) applied to
// NEITHER, despite config.ts documenting it as how fear slows a body. The
// buff existed, fully authored, and nothing in the game ever applied it.
//
// Josh: *"when an enemy flees we should make it have the fear debuff instead
// of just running away, that unifies things."* So there is now one door.
// Whatever broke the creature — its own nerve or a blow it never saw — it
// comes out feared: same timer, same skull, same DREAD stack in the debuff
// read, same slow, and one buff id for the fear archetype to key on.
export function breakMorale(self: EnemyCtx, durationS = CONFIG.ENEMY_AI.FEAR.BREAK_DURATION): void {
  self.poise.brokenOnce = true;
  self.combat.currentAbility = null;
  clearAoeTelegraph(self);
  clearLashTendril(self);
  reconcileThreat(self, false, false);   // its threat flash is spent
  self.setEyeFlare(0);
  self.poise.cowerTimer = 0;
  self.fsm.state = 'fleeing';
  self.fsm.phaseTimer = 0;
  self.poise.fearTimer = Math.max(self.poise.fearTimer, durationS);
  // The visible, inspectable half of the state. Rides the same duration as the
  // timer so the icon and the behaviour can't disagree.
  const ent = getEntity(self.entityId);
  if (ent) applyBuff(ent, 'dread', durationS, self.entityId);
}

// IMPOSE fear. The public route into the rout above, for anything that can
// frighten a creature rather than wait for its nerve to fail on its own — today
// a poise break landed from BEHIND (combat/attack.ts), tomorrow a 'fear'-domain
// relic or rite (content/domains.ts has carried the name for a while with
// nothing behind it).
//
// Returns true if the fear TOOK, so a caller can decide whether to pay out a
// beat for it. Refused for: the dead, bosses and minibosses (a set-piece has a
// tuned pressure curve and being frightened off is not part of it), and any
// creature still inside its post-fear immunity.
export function applyFear(self: EnemyCtx, seconds: number): boolean {
  if (!self.fsm.alive || seconds <= 0) return false;
  if (self.spec.isBoss || self.spec.miniboss) return false;
  if (self.poise.fearCd > 0) return false;
  // A creature already reeling from the break can't start RUNNING yet — it
  // routs the moment the stagger lets go (see the 'staggered' exit) — but the
  // fear itself lands now, timer and debuff both, so the handoff out of the
  // stagger has something to read.
  if (self.fsm.state !== 'staggered' && self.fsm.state !== 'fleeing') {
    breakMorale(self, seconds);
  } else {
    self.poise.fearTimer = Math.max(self.poise.fearTimer, seconds);
    const ent = getEntity(self.entityId);
    if (ent) applyBuff(ent, 'dread', seconds, self.entityId);
  }
  return true;
}

// Resolve a parry against the CURRENT deflectable strike — fired the INSTANT
// the player's window catches a committed attack (see the pre-switch block in
// update). It cancels the strike, counters the mob, and pays the player out.
// Crucially this runs during the WINDUP, not at the strike's landing — so a
// tap off the white flash flinches the enemy immediately, crisp, rather than
// waiting out the rest of the wind-up. Caller guarantees the ability is
// deflectable + reachable + isParryActive().
/** `poiseMul` / `knockMul` scale the counter's bite. 1 = a standing swing
 *  turned aside. A CHARGE passes more (CONFIG.DEFLECT.CHARGE_*): meeting one
 *  has to be worth more than sidestepping it, which is free and already
 *  works — otherwise the option is decoration nobody picks. */
export function resolveParry(self: EnemyCtx, toward: THREE.Vector3, poiseMul = 1, knockMul = 1): void {
  notePlayerDeflected();   // player side: i-frame + clash freeze + parry ting + EMPOWER next swing + riposte beat
  kickShake(0.22, 0.16);   // clash punch
  // Steel-on-steel spark AT the clash: a touch in FRONT of the mob toward the
  // player (so it reads in the open, not buried in the body), at weapon height.
  {
    const dx = toward.x - self.container.position.x;
    const dz = toward.z - self.container.position.z;
    const len = Math.hypot(dx, dz) || 1;
    spawnParrySpark(
      self.scene,
      self.container.position.x + (dx / len) * 0.55,
      self.container.position.y + self.aimHeightResolved,
      self.container.position.z + (dz / len) * 0.55,
    );
  }
  // Riposte — the parry lands a FULL LIGHT HIT'S worth of damage (the current
  // weapon's base, so it scales with the build instead of a hardcoded chip):
  // a clean parry IS a quick strike, timing it the advantage. Routed through
  // takeDamage so armour/resists apply and a kill runs the normal death path
  // (which also pops the deflect opportunity). If it finishes the mob, stop
  // here — the poise/flinch below would act on a corpse.
  takeDamage(self, { source: 'player', target: self.entityId, base: getCurrentWeapon().damage, type: 'physical' });
  if (!self.fsm.alive) return;
  // On-riposte verb (e.g. a serrated blade bleeds the foe it just parried).
  fireCombatVerb(getCurrentWeapon().onRiposte, self.entityId, 'enemy');
  // Chunk poise — by the WEAPON's authored parry poise (a heavy guard-breaker
  // staggers far faster than a light blade), falling back to the global
  // default. If it BREAKS → full stagger (execute window, via triggerStagger
  // inside). Else a soft FLINCH: cancel the attack, recoil off-balance, brief
  // no-act. Stacking deflects break it on their own; the empowered follow-up
  // swing breaks it much faster.
  const broke = applyStaggerDamage(self, 
    (getCurrentWeapon().parryPoise ?? CONFIG.DEFLECT.POISE_DAMAGE) * poiseMul,
  );
  if (!broke) {
    // A clean parry that didn't break poise — "TURNED". (A parry that DID
    // break shows the bigger "BROKEN" from triggerStagger instead.)
    flashCombatWord('TURNED', CLASH_GOLD);
    self.combat.currentAbility = null;
    clearAoeTelegraph(self);
    clearLashTendril(self);
    self.coreReactor.hit();     // white body flash — the parried recoil
    const dx = self.container.position.x - toward.x;
    const dz = self.container.position.z - toward.z;
    const len = Math.hypot(dx, dz) || 1;
    self.bodyAnim.applyKnockback(dx / len, dz / len, CONFIG.DEFLECT.FLINCH_KNOCKBACK * knockMul);
    self.bodyAnim.flinch(CONFIG.DEFLECT.FLINCH_PITCH);   // body snaps back — the visible recoil
    self.actionFsm.enterFlinchLock(CONFIG.DEFLECT.FLINCH_LOCK_S);
    self.fsm.state = 'chasing';
    self.fsm.phaseTimer = 0;
  }
}
