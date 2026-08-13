// RITE executor — the thin imperative layer over the rite DATA (content/rites.ts).
// Builds HUNGER from combat (the meter), and fires the equipped rite when asked:
// resolve its live form by your domain commitment, pay the costs (Hunger + your
// own blood), erupt on everyone near, take the blood back. Carrier of the active
// lane; the rite itself is data, this just enacts it on the world.

import type { Enemy } from '../mobs/enemy';
import { on } from '../broadcast/event-bus';
import { RITES, resolveRite, type RiteEffect } from '../content/rites';
import { heldDomainCount } from '../content/cards';
import {
  getHunger, grantHunger, spendHunger, getEquippedRite, getHeldCards,
} from '../state/run-state';
import { bleedPlayer, healPlayer } from '../player/health';
import { get } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';
import { kickShake } from './screen-shake';
import { enterStillness } from './rite-stillness';
import { firstBodyOnPath, type BodyCircle } from '../player/body-path';

interface RiteDeps {
  /** Player position source (the erupt centre). */
  getCenter: () => { x: number; z: number };
  /** Live enemy list on the current floor. */
  getEnemies: () => readonly Enemy[];
  /**
   * Where the player is FACING, as a unit vector on the floor plane. Supplied by
   * the caller because the rite layer has no camera.
   */
  getFacing?: () => { x: number; z: number };
  /**
   * Could the player legally end up at (x,z) from where they are? Expected to
   * refuse anything a DODGE would refuse — no through-walls, no inside-a-pillar
   * — so a rite can never reach somewhere the movement rules wouldn't. Split
   * from `teleport` so the "can I?" and the "do it" are one question asked
   * twice, never two implementations that can disagree.
   */
  canReach?: (x: number, z: number) => boolean;
  /** Put the player at (x,z). Only ever called for a spot canReach approved. */
  teleport?: (x: number, z: number) => void;
}

let deps: RiteDeps | null = null;

// Hunger gain per combat beat. Kills feed most (you're rewarded for finishing),
// hits a trickle, crits a touch more — so ~5 kills or sustained aggression banks
// a Hemorrhage (cost 50). Tunable.
const HUNGER_ON_KILL = 10;
const HUNGER_ON_HIT = 2;
const HUNGER_ON_CRIT = 1;

/** Wire the rite system: bank Hunger from combat, and remember how to reach the
 *  world (player position + enemies) for activation. Called once at boot. */
export function initRites(d: RiteDeps): void {
  deps = d;
  on((e) => {
    if (e.type === 'enemy:killed') grantHunger(HUNGER_ON_KILL);
    else if (e.type === 'attack:hit') {
      grantHunger(HUNGER_ON_HIT);
      if (e.crit) grantHunger(HUNGER_ON_CRIT);
    }
  });
}

/** Fire the equipped rite if one's slotted and Hunger affords it. Returns
 *  whether it fired. Runs the rite's resolved EFFECT LIST — one handler per kind
 *  (content/rites.ts owns the vocabulary). Deterministic given world state. */
export function tryActivateRite(): boolean {
  const id = getEquippedRite();
  if (!id || !deps) return false;
  const spec = RITES[id];
  if (!spec || getHunger() < spec.hungerCost) return false;

  const effects = resolveRite(spec, heldDomainCount(getHeldCards(), spec.domain));

  // A rite whose ONLY effect is a step you cannot take is a dead press that eats
  // your meter — you stand flush against a wall, tap, and the bar empties for
  // nothing. Refuse it up front instead: the Hunger stays banked and the button
  // stays live. (Only blink-only rites qualify; anything that also erupts, heals
  // or buffs always does something, so it always fires.)
  if (effects.every((e) => e.kind === 'blink') && !anyBlinkWouldLand(effects)) return false;

  spendHunger(spec.hungerCost);

  const center = deps.getCenter();
  const player = get('player');
  for (const eff of effects) {
    switch (eff.kind) {
      case 'cost':     if (eff.hp > 0) bleedPlayer(eff.hp); break;              // pay blood (floored at 1)
      case 'heal':     if (eff.hp > 0) healPlayer(eff.hp, 'combat'); break;
      case 'selfBuff': if (player) applyBuff(player, eff.buff, eff.duration, 'player'); break;
      case 'nova':     runNova(eff, center); break;
      case 'stillness': enterStillness(eff.seconds, eff.deep); break;
      case 'blink':    runBlink(eff); break;
      case 'fear':     runFear(eff, center); break;
      case 'charge':   runCharge(eff); break;
    }
  }

  kickShake(0.55, 0.18);   // the rite punches the screen
  return true;
}

/** BLINK handler — step forward through whatever is in the way. */
function runBlink(eff: Extract<RiteEffect, { kind: 'blink' }>): void {
  blinkStep(eff.distance, true);
}

/** Would ANY of these blinks move the player at all? Probes without committing. */
function anyBlinkWouldLand(effects: readonly RiteEffect[]): boolean {
  return effects.some((e) => e.kind === 'blink' && blinkStep(e.distance, false));
}

/**
 * One blink probe. Walks the distance back in steps and takes the furthest
 * landing that holds. `commit: false` asks the same question without moving —
 * one code path, so the "can I?" and the "do it" can never disagree.
 */
function blinkStep(distance: number, commit: boolean): boolean {
  if (!deps?.canReach || !deps.teleport || !deps.getFacing) return false;
  const c = deps.getCenter();
  const f = deps.getFacing();
  const len = Math.hypot(f.x, f.z) || 1;
  const nx = f.x / len, nz = f.z / len;
  const STEPS = 6;
  for (let i = STEPS; i >= 1; i--) {
    const d = (distance * i) / STEPS;
    const x = c.x + nx * d, z = c.z + nz * d;
    if (!deps.canReach(x, z)) continue;
    if (commit) deps.teleport(x, z);
    return true;
  }
  return false;
}

/**
 * FEAR handler — break the nerve of everything in radius.
 *
 * Routed through the creature's own `applyFear` rather than setting a state
 * here, so a rite-cast terror and a poise-break-from-behind terror are the SAME
 * thing: same rout, same skull, same DREAD debuff, same post-fear immunity, same
 * refusal for bosses. That unification is what makes this rite compose with the
 * backstab loop instead of sitting beside it (mobs/enemy.ts breakMorale).
 *
 * Deals no damage on purpose. What it buys is a room where nobody is swinging.
 */
function runFear(eff: Extract<RiteEffect, { kind: 'fear' }>, c: { x: number; z: number }): void {
  if (!deps) return;
  const r2 = eff.radius * eff.radius;
  for (const enemy of deps.getEnemies()) {
    if (!enemy.alive) continue;
    const dx = enemy.position.x - c.x;
    const dz = enemy.position.z - c.z;
    if (dx * dx + dz * dz > r2) continue;
    enemy.applyFear(eff.seconds);   // refuses bosses + anything inside its immunity
  }
}

/**
 * CHARGE handler — rush the line, hit everything on it, come out the far side.
 *
 * Two halves, and they are deliberately separate:
 *
 * MOVEMENT reuses `blinkStep`, which walks the distance back until a landing
 * holds against the DODGE's own walkability probe. So a charge can never end
 * inside a pillar or through a wall, and it falls short rather than failing —
 * the rite always does something for its Hunger.
 *
 * CONTACT sweeps the PATH rather than testing the destination. A rush that only
 * hit what was at the end would run straight past the crowd it charged into,
 * which is the entire point of the move. Same swept-capsule maths the walk-vault
 * and the leap use (player/body-path.ts), so "what is on this line" has one
 * answer in the codebase rather than three.
 */
function runCharge(eff: Extract<RiteEffect, { kind: 'charge' }>): void {
  if (!deps?.getFacing) return;
  const from = deps.getCenter();
  const f = deps.getFacing();
  const len = Math.hypot(f.x, f.z) || 1;
  const nx = f.x / len, nz = f.z / len;

  // Move first, then resolve contact along where we ACTUALLY went — a charge
  // stopped short by a wall must not still hit things past that wall.
  blinkStep(eff.distance, true);
  const to = deps.getCenter();
  const travelled = Math.hypot(to.x - from.x, to.z - from.z);
  // Even a fully blocked charge shoulders whatever is right in front of you.
  const reach = Math.max(travelled, 1.0);

  const bodies: BodyCircle[] = [];
  const hitRadius = eff.radius ?? 1.1;
  for (const enemy of deps.getEnemies()) {
    if (!enemy.alive) continue;
    bodies.length = 0;
    bodies.push({ x: enemy.position.x, z: enemy.position.z, radius: enemy.collisionRadius });
    if (!firstBodyOnPath(from.x, from.z, from.x + nx * reach, from.z + nz * reach, hitRadius, bodies)) continue;
    enemy.takeDamage({ source: 'player', target: enemy.entityId, base: eff.damage, type: 'physical' });
    if (eff.knockback) enemy.applyKnockback(nx, nz, eff.knockback);
    if (eff.buff) {
      const ent = get(enemy.entityId);
      if (ent) applyBuff(ent, eff.buff, eff.buffDuration ?? 4, 'player');
    }
  }
}

/** NOVA handler — damage everyone in radius, brand them with a buff if the effect
 *  carries one, and take blood back per enemy caught. */
function runNova(eff: Extract<RiteEffect, { kind: 'nova' }>, c: { x: number; z: number }): void {
  if (!deps) return;
  const r2 = eff.radius * eff.radius;
  let caught = 0;
  for (const enemy of deps.getEnemies()) {
    if (!enemy.alive) continue;
    const dx = enemy.position.x - c.x;
    const dz = enemy.position.z - c.z;
    if (dx * dx + dz * dz > r2) continue;
    enemy.takeDamage({ source: 'player', target: enemy.entityId, base: eff.damage, type: 'physical' });
    if (eff.buff) {
      const ent = get(enemy.entityId);
      if (ent) applyBuff(ent, eff.buff, eff.buffDuration ?? 4, 'player');
    }
    caught++;
  }
  // Take the blood back — a combat heal (Red Thirst can't suppress this).
  if (caught > 0 && eff.healPerHit) healPlayer(caught * eff.healPerHit, 'combat');
}
