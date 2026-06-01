import { CONFIG } from '../config';
import { freezeFor } from '../combat/hit-pause';
import { kickShake } from '../combat/screen-shake';
import { flashVignette } from '../ui/vignette';
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

export function getPlayerMaxHp(): number {
  // Always reflects the current equipment — a freshly-equipped Ring of
  // Vigor bumps the visible max immediately.
  return computeStats().maxHp;
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
export function damagePlayer(amount: number, source: EntityId | null = null, type: DamageType = 'physical', quiet = false) {
  if (dead || godMode) return;
  const player = get(PLAYER_ENTITY_ID);
  if (!player || !player.hp) return;

  const result = computeDamage({ source, target: PLAYER_ENTITY_ID, base: amount, type });
  player.hp.current = Math.max(0, player.hp.current - result.applied);
  // Toughness proficiency: damage absorbed → +N. Block ticks too if
  // a shield is equipped (passive shields = every hit while equipped
  // counts; narrows to actual blocks once active blocking lands).
  if (result.applied > 0) {
    recordDamageTaken(result.applied);
    if (getEquipped('offhand')?.id === 'wooden-shield') recordShieldedHit();
  }

  // --- The player-hit crunch stack (skipped for DoT ticks) ---
  if (!quiet) {
    freezeFor(CONFIG.PLAYER_HIT_PAUSE_MS);
    kickShake(CONFIG.PLAYER_HIT_SHAKE_MAGNITUDE, CONFIG.PLAYER_HIT_SHAKE_DURATION);
    hapticVibrate(CONFIG.PLAYER_HIT_HAPTIC_MS);
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
