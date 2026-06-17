import { isArrivalActive } from './arrival';
import { gameNow } from '../engine/game-clock';
import { registerSimReset } from '../engine/sim-state';
import { recordPlayerDamage } from './damage-recap';
import { CONFIG } from '../config';
import { freezeFor } from '../combat/hit-pause';
import { kickShake } from '../combat/screen-shake';
import { flashVignette } from '../ui/vignette';
import { flashDirectionalDamage } from '../ui/directional-damage';
import { playPlayerHurt, playMagicHit, playPlayerDeathStinger } from '../audio/sfx';
import { emit } from '../broadcast/event-bus';
import { get } from '../ecs/world';
import { computeStats } from './equipment-stats';
import { computeDamage, registerDamageSink, type DamageType, type DamageEvent } from '../combat/damage';
import type { EntityId } from '../ecs/types';
import { recordHpRecovered, recordDamageTaken, recordShieldedHit } from '../state/character';
import { getEquipped } from './equipment';
import { DEV } from '../debug/dev';

// Player health module. State now lives in the world entity (id: 'player')
// rather than module-level vars, so effects (heal, apply-buff, damage) can
// address it through the same code path as everything else.

const PLAYER_ENTITY_ID = 'player';

let onDeathCb: (() => void) | null = null;
let dead = false;
// Debug invulnerability — when on, damagePlayer is a no-op. Set via
// setGodMode (debug scenarios / the ?god=1 flag) so we can pose combat
// states, drive enemies, and screenshot without dying. Gated on DEV: in a
// production build `DEV` is the literal `false`, so `DEV && on` is always
// false — godmode is unreachable on the live site no matter who calls this.
let godMode = false;
export function setGodMode(on: boolean) { godMode = DEV && on; }
export function isGodMode(): boolean { return godMode; }

// Entry-grace invulnerability — a short, real (non-debug) window where the
// player can't be hurt. Used by the soulslike fog gate: crossing the
// threshold grants a beat of immortality so the boss (which wakes as you
// enter) can't bomb you before you've stepped through and can act.
let invulnUntil = 0;
export function setPlayerInvulnerable(seconds: number): void {
  invulnUntil = gameNow() + seconds * 1000;
}
export function isPlayerInvulnerable(): boolean {
  return gameNow() < invulnUntil;
}
export function resetPlayerInvuln(): void {
  invulnUntil = 0;
}
// sim-state: the i-frame window must be cleared at run start (see sim-state.ts).
registerSimReset(resetPlayerInvuln);

// Route damage-over-time ticks (poison/burn/bleed inflicted by enemies)
// through the player's health with the QUIET flag, so they reduce HP +
// can kill + flash the vignette, but don't strobe the screen with the
// per-tick hit-crunch. Registered once at module load.
registerDamageSink(PLAYER_ENTITY_ID, (e: DamageEvent) => {
  const before = get(PLAYER_ENTITY_ID)?.hp?.current ?? 0;
  damagePlayer(e.base, e.source, e.type, true);
  const after = get(PLAYER_ENTITY_ID)?.hp?.current ?? 0;
  return Math.max(0, before - after);
});

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

export function getPlayerHp(): number {
  return get(PLAYER_ENTITY_ID)?.hp?.current ?? 0;
}

let lastKnownMax: number | null = null;

export function getPlayerMaxHp(): number {
  // Always reflects the current equipment — a freshly-equipped Ring of
  // Vigor bumps the visible max immediately.
  const max = computeStats().maxHp;
  // RECONCILE on max changes (equip swaps, mutations, altar prices —
  // every source funnels through computeStats, and the HUD reads this
  // every frame, so this is the one chokepoint that sees all deltas):
  //   max GAINED → heal by the gained amount (vigor arrives as vigor)
  //   max PAID   → current clamps down to the new ceiling
  const player = get(PLAYER_ENTITY_ID);
  if (player?.hp && lastKnownMax !== null && max !== lastKnownMax && !dead) {
    if (max > lastKnownMax) {
      player.hp.current = Math.min(max, player.hp.current + (max - lastKnownMax));
    } else {
      player.hp.current = Math.min(player.hp.current, Math.max(1, max));
    }
  }
  lastKnownMax = max;
  return max;
}

/** Restore HP, clamped to the current max. Returns actual amount healed. */
export function healPlayer(amount: number): number {
  if (dead || amount <= 0) return 0;
  const player = get(PLAYER_ENTITY_ID);
  if (!player || !player.hp) return 0;
  const max = computeStats().maxHp;
  const before = player.hp.current;
  player.hp.current = Math.min(max, player.hp.current + amount);
  const recovered = player.hp.current - before;
  if (recovered > 0) recordHpRecovered(recovered);
  return recovered;
}

export function isPlayerDead(): boolean {
  return dead;
}

export function onPlayerDeath(cb: () => void) {
  onDeathCb = cb;
}

/**
 * Apply incoming damage to the player. Routes through the central damage
 * pipeline so equipment armor + (future) buffs + damage type all apply
 * consistently. `source` is the attacker's entity id (an enemy) — null
 * for environmental damage (a trap, a fall). Default damage type is
 * physical since most enemy attacks are melee.
 */
/**
 * Apply damage to the player. `quiet` skips the full hit-crunch
 * (freeze/shake/haptic/grunt) — used for damage-over-time ticks so a
 * poison/burn ticking twice a second doesn't strobe the screen. HP
 * reduction, the vignette flash, and death are NOT skipped (a DoT must
 * still be able to kill, with feedback).
 */
export function damagePlayer(amount: number, source: EntityId | null = null, type: DamageType = 'physical', quiet = false, cause?: string) {
  if (dead || godMode) return;
  if (isArrivalActive()) return;   // mid-wake at the bonfire — untouchable
  if (gameNow() < invulnUntil) {
    // Hit negated by i-frames (dodge / entry-grace). Pure survival — NO reward
    // here. The just-dodge bonus is earned by precise ROLL TIMING against a
    // strike and is fired enemy-side (enemy.ts → tryJustDodge), mirroring the
    // parry; it must NOT trigger just because invuln happened to eat a blow.
    return;
  }
  const player = get(PLAYER_ENTITY_ID);
  if (!player || !player.hp) return;

  const result = computeDamage({ source, target: PLAYER_ENTITY_ID, base: amount, type });
  player.hp.current = Math.max(0, player.hp.current - result.applied);
  // Toughness proficiency: damage absorbed → +N. Block ticks too if
  // a shield is equipped (passive shields = every hit while equipped
  // counts; narrows to actual blocks once active blocking lands).
  if (result.applied > 0) {
    // Attribute the blow — feeds the per-life damage recap (the killer for
    // the feed + bloodstain epitaph, and the end-screen "what took you"
    // breakdown). `quiet` marks DoT ticks (bleed/poison/burn).
    recordPlayerDamage(source, result.applied, quiet, cause);
    recordDamageTaken(result.applied);
    if (getEquipped('offhand')?.id === 'wooden-shield') recordShieldedHit();
  }

  // --- The player-hit crunch stack (skipped for DoT ticks) ---
  // Scale freeze / shake / haptic by how hard the blow landed: a 1-dmg graze
  // is baseline, a heavy hit is up to HIT_FEEDBACK_DMG_MAX× — strong hits
  // hit hard. Plus a directional edge-flash pointing at the attacker so a hit
  // reads as a THREAT FROM somewhere, not just a screen-wide red wash.
  if (!quiet) {
    const s = Math.min(
      CONFIG.HIT_FEEDBACK_DMG_MAX,
      1 + Math.max(0, result.applied - 1) * CONFIG.HIT_FEEDBACK_DMG_SLOPE,
    );
    freezeFor(CONFIG.PLAYER_HIT_PAUSE_MS * s);
    kickShake(CONFIG.PLAYER_HIT_SHAKE_MAGNITUDE * s, CONFIG.PLAYER_HIT_SHAKE_DURATION);
    hapticVibrate(Math.round(CONFIG.PLAYER_HIT_HAPTIC_MS * s));
    flashDirectionalDamage(source, result.applied);
  }
  flashVignette(result.applied);
  if (!quiet) {
    playPlayerHurt();
    // Magic strikes layer a sour bell+sizzle on top of the hurt grunt — the
    // wraith should sound spectral, not like another club-swing.
    if (type === 'magic') playMagicHit();
  }
  // Carry the attacker through to listeners. Trigger pipeline reads
  // this to resolve `target: 'attacker'` effects (chill-on-damaged,
  // thorns, etc.) — without it, defensive procs only target self.
  emit({ type: 'player:damaged', hpLeft: player.hp.current, amount: result.applied, attacker: source ?? undefined });

  if (player.hp.current <= 0 && !dead) {
    dead = true;
    playPlayerDeathStinger();
    emit({ type: 'player:killed' });
    onDeathCb?.();
  }
}
