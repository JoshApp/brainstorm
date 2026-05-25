import { CONFIG } from '../config';
import { freezeFor } from '../combat/hit-pause';
import { kickShake } from '../combat/screen-shake';
import { flashVignette } from '../ui/vignette';
import { playPlayerHurt } from '../audio/sfx';
import { emit } from '../broadcast/event-bus';
import { get } from '../ecs/world';
import { computeStats } from './equipment-stats';

// Player health module. State now lives in the world entity (id: 'player')
// rather than module-level vars, so effects (heal, apply-buff, damage) can
// address it through the same code path as everything else.

const PLAYER_ENTITY_ID = 'player';

let onDeathCb: (() => void) | null = null;
let dead = false;

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
  return player.hp.current - before;
}

export function isPlayerDead(): boolean {
  return dead;
}

export function onPlayerDeath(cb: () => void) {
  onDeathCb = cb;
}

export function damagePlayer(amount: number) {
  if (dead) return;
  const player = get(PLAYER_ENTITY_ID);
  if (!player || !player.hp) return;

  // Apply equipment damage reduction (armor + passives), floored at 1 so
  // even a full set of cloaks can't make the player invulnerable.
  const reduction = computeStats().damageReduction;
  const finalAmount = Math.max(1, amount - reduction);

  player.hp.current = Math.max(0, player.hp.current - finalAmount);

  // --- The player-hit crunch stack ---
  freezeFor(CONFIG.PLAYER_HIT_PAUSE_MS);
  kickShake(CONFIG.PLAYER_HIT_SHAKE_MAGNITUDE, CONFIG.PLAYER_HIT_SHAKE_DURATION);
  hapticVibrate(CONFIG.PLAYER_HIT_HAPTIC_MS);
  flashVignette();
  playPlayerHurt();
  emit({ type: 'player:damaged', hpLeft: player.hp.current });

  if (player.hp.current <= 0 && !dead) {
    dead = true;
    emit({ type: 'player:killed' });
    onDeathCb?.();
  }
}
