import { CONFIG } from '../config';
import { freezeFor } from '../combat/hit-pause';
import { kickShake } from '../combat/screen-shake';
import { flashVignette } from '../ui/vignette';
import { playPlayerHurt } from '../audio/sfx';
import { emit } from '../broadcast/event-bus';
import { get } from '../ecs/world';

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
  return get(PLAYER_ENTITY_ID)?.hp?.base ?? CONFIG.PLAYER_HP_MAX;
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

  player.hp.current = Math.max(0, player.hp.current - amount);

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
