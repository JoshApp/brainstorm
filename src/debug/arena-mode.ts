// DEV-only "training arena" toggle: when on, enemies never die — takeDamage
// still flashes them, chips poise, staggers, and aggros, but their HP floors at
// 1 so they keep coming. Paired with player godmode (the combat-arena scenario
// sets both), it's a fighting-game practice room for the reactive-defense loop:
// endless sparring partners you can parry / dodge / stagger forever.
//
// Hard DEV-gated (the setter ANDs with DEV) and reset on floor load, so it can
// never reach the live build or leak into real play.

import { DEV } from './dev';
import { registerSimReset } from '../engine/sim-state';

let enemiesInvincible = false;

export function setArenaEnemiesInvincible(on: boolean): void {
  enemiesInvincible = DEV && on;
}
// sim-state: the training-arena invuln flag must never leak past its own
// scenario into a fresh run (see sim-state.ts).
registerSimReset(() => setArenaEnemiesInvincible(false));

export function arenaEnemiesInvincible(): boolean {
  return enemiesInvincible;
}
