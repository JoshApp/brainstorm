import { CONFIG } from '../config';
import { getFlask, spendCharge } from './flask';
import { healPlayer, getPlayerHp, getPlayerMaxHp, isPlayerDead } from './health';
import { passiveHealSuppressed } from '../combat/transforms';
import { getPlayerAction } from '../combat/player-action';
import { registerSimReset } from '../engine/sim-state';
import { playHealSlurp, playFlaskUncork, playFlaskLower } from '../audio/sfx';
import { flashHealGlow } from '../ui/vignette';
import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';

// The flask DRINK — a channel, not an instant tap. Raise the flask, sip at
// SIP_AT (that's when the heal lands and the charge is spent), lower it.
// Souls commitment with an escape hatch:
//   - CANCELABLE until the sip: a dodge, an attack, a parry, or re-tapping the
//     flask button lowers it. The charge is only ever spent AT the sip, so an
//     early cancel refunds implicitly — nothing was taken.
//   - Taking DAMAGE does NOT interrupt: you can chug through a hit; the price
//     of drinking under pressure is the time you spend not fighting.
//   - Slow walk while the flask is up (getDrinkMoveMul → camera movement).
//
// Runs on the PLAYER clock (playerDt): the drink freezes under hit-pause and
// the death dip, but is NOT slowed by reactive-defense bullet-time — a clean
// dodge's slow-world payoff is exactly the safest moment to drink.
//
// This module owns the sim state only. Presentation reads it:
//   - flask-viewmodel.ts samples getDrinkProgress() for the raise animation
//   - consumable-bar.ts renders the progress ring + start/deny feedback

export type DrinkRequestResult =
  | 'started' | 'fervor' | 'lowered' | 'drinking'   // start (heal · fervor) · lowered · re-tap (ignore)
  | 'empty' | 'full' | 'suppressed' | 'busy';       // withheld — caller shows why

let t = -1;          // seconds into the drink; -1 = not drinking
let sipped = false;  // the sip landed (charge spent, effect applied)
// The drink's MODE, captured at start. 'heal' = normal restore. 'fervor' = under
// Red Thirst, where normal healing is suppressed, the flask instead pours a
// BLOOD RUSH (lifesteal + damage surge) so its charge isn't dead weight.
let mode: 'heal' | 'fervor' = 'heal';

/** True while the flask is raised (from start until lowered/finished). */
export function isDrinkingFlask(): boolean { return t >= 0; }

/** Drink progress 0..1 (0 when idle). The viewmodel + HUD ring sample this. */
export function getDrinkProgress(): number {
  return t < 0 ? 0 : Math.min(1, t / CONFIG.FLASK.DRINK_S);
}

/** True once this drink's sip has landed (the committed point). */
export function hasSipLanded(): boolean { return sipped; }

/** Movement multiplier while drinking — composes onto MOVE_SPEED in camera.ts. */
export function getDrinkMoveMul(): number {
  return t >= 0 ? CONFIG.FLASK.DRINK_MOVE_MUL : 1;
}

/** The flask button / hotkey entry point. A re-tap while already drinking is
 *  IGNORED — only committing to a dash or an attack lowers the flask (handled in
 *  tickFlaskDrink). Otherwise start the channel if the flask + stance allow it.
 *  The caller maps the result to feedback — this module never touches the DOM. */
export function requestFlaskDrink(): DrinkRequestResult {
  if (t >= 0) return 'drinking';   // already drinking — a second tap does nothing
  if (getFlask().charges <= 0) return 'empty';
  const suppressed = passiveHealSuppressed();   // Red Thirst — heal path is closed
  // Under suppression the flask becomes a FERVOR draught (a combat surge), so the
  // "already at full HP" gate doesn't apply — you'd drink it to fight, not to mend.
  if (!suppressed && getPlayerHp() >= getPlayerMaxHp()) return 'full';
  if (getPlayerAction() !== 'idle') return 'busy';    // mid-swing/dodge/parry — hands are full
  t = 0;
  sipped = false;
  mode = suppressed ? 'fervor' : 'heal';
  playFlaskUncork();
  return mode === 'fervor' ? 'fervor' : 'started';
}

/** Lower the flask now. Before the sip this is a free cancel (the charge was
 *  never spent); after the sip the heal already landed and this just ends the
 *  tail early. Safe to call when not drinking. */
export function cancelFlaskDrink(): void {
  if (t < 0) return;
  if (!sipped) playFlaskLower();   // the sip already made its own sound
  t = -1;
}

/** Advance the drink on the PLAYER clock. Called from the sim systems pass. */
export function tickFlaskDrink(dt: number): void {
  if (t < 0) return;
  if (isPlayerDead()) { t = -1; return; }
  // Any real action snatches the flask down. Drinks only START from idle, so a
  // non-idle action here is by definition a new commitment that outranks it.
  if (getPlayerAction() !== 'idle') { cancelFlaskDrink(); return; }
  t += dt;
  const p = t / CONFIG.FLASK.DRINK_S;
  if (!sipped && p >= CONFIG.FLASK.SIP_AT) {
    sipped = true;
    if (mode === 'fervor') {
      // Red Thirst: no heal — spend the charge on a BLOOD RUSH surge instead, so
      // the flask still matters when it can't mend you.
      const player = get('player');
      if (player) {
        applyBuff(player, CONFIG.RED_THIRST.FERVOR_BUFF, CONFIG.RED_THIRST.FERVOR_DURATION_S, 'player');
        spendCharge();
        playHealSlurp();
        flashHealGlow();
        try { navigator.vibrate?.(18); } catch { /* unsupported */ }
      }
    } else {
      // 'passive' heal — suppression is pre-checked at start, but a transform
      // could land mid-drink; if the heal yields nothing, keep the charge.
      const healed = healPlayer(getFlask().healPerCharge, 'passive');
      if (healed > 0) {
        spendCharge();
        playHealSlurp();
        flashHealGlow();
        try { navigator.vibrate?.(18); } catch { /* unsupported */ }
      }
    }
  }
  if (p >= 1) t = -1;
}

function resetFlaskDrink(): void { t = -1; sipped = false; mode = 'heal'; }
// sim-state: no drink survives a run start / floor teleport (see sim-state.ts).
registerSimReset(resetFlaskDrink);
