import { CONFIG } from '../config';
import { freezeFor } from '../combat/hit-pause';
import { kickShake } from '../combat/screen-shake';
import { flashVignette } from '../ui/vignette';
import { playPlayerHurt } from '../audio/sfx';

// Player health module. Singleton state + damage handler that mirrors the
// crunch stack from attack.ts but stronger (longer freeze, bigger shake,
// longer haptic, grunt sound, vignette flash).
//
// On HP=0 fires the registered onDeath callback once.

let hp = CONFIG.PLAYER_HP_MAX;
let dead = false;
let onDeathCb: (() => void) | null = null;

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

export function getPlayerHp(): number {
  return hp;
}

export function isPlayerDead(): boolean {
  return dead;
}

export function onPlayerDeath(cb: () => void) {
  onDeathCb = cb;
}

export function damagePlayer(amount: number) {
  if (dead) return;
  hp = Math.max(0, hp - amount);

  // --- THE PLAYER-HIT CRUNCH (mirror of attack.ts but stronger) ---
  freezeFor(CONFIG.PLAYER_HIT_PAUSE_MS);
  kickShake(CONFIG.PLAYER_HIT_SHAKE_MAGNITUDE, CONFIG.PLAYER_HIT_SHAKE_DURATION);
  hapticVibrate(CONFIG.PLAYER_HIT_HAPTIC_MS);
  flashVignette();
  playPlayerHurt();

  if (hp <= 0 && !dead) {
    dead = true;
    onDeathCb?.();
  }
}
