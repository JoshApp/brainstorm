// Dash / dodge — a discrete lunge with a brief invulnerability window. The
// Souls roll, adapted for a mobile crawler: it's the defensive job stamina does.
//
// Mechanically it's a strong, short-lived impulse: it reuses the player
// knockback channel (updateCamera already runs that through wall/enemy
// collision, so a dash slides along geometry and can't punch through a wall),
// plus the existing entry-grace i-frame mechanism (damagePlayer already honours
// it) for the dodge window.
//
// Dodge NEVER blocks — it's the defensive lifeline, and being denied it the one
// moment you're empty is the least-fair feeling on a phone. With stamina it's a
// full dodge (DASH_COST, full i-frames). On an empty bar it still fires as a
// desperate STUMBLE: shorter i-frames + a weaker lunge, and it stalls your regen
// so a no-stamina escape is a punishing last resort, not free.

import { CONFIG } from '../config';
import { spendStaminaSoft, stallRegen } from './stamina';
import { suppressChargeUntilRelease } from '../controls/charge-input';
import { noteDashStarted } from './just-dodge';
import { stumble } from './camera-stumble';
import { applyPlayerKnockback } from '../player/knockback';
import { setPlayerInvulnerable } from '../player/health';
import { flashStaminaBar } from '../ui/stamina-bar';
import { playWhoosh } from '../audio/sfx';

// A short cooldown after a dodge so it can't be mashed — refreshed on each dash,
// longer when the dodge was a gassed stumble.
let cooldownUntil = 0;

/** Fire a dash in WORLD direction (dirX, dirZ) — normalised internally. Always
 *  fires (returns true) given a direction; an empty bar yields a weaker stumble.
 *  Gated only by the brief post-dodge cooldown. */
export function tryDash(dirX: number, dirZ: number): boolean {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0) return false;   // no resolvable direction
  if (performance.now() < cooldownUntil) return false;   // still in the post-dodge cooldown
  // Dodge-cancel: drop any held heavy and REFUND its reservation FIRST, so that
  // stamina is back in the pool to fund this escape (panic-cancel a big charge
  // straight into a clean dodge). Suppresses re-charge until the finger lifts.
  suppressChargeUntilRelease();
  // Soft spend: true if we had a sliver (full dodge), false if empty (stumble).
  const full = spendStaminaSoft(CONFIG.STAMINA.DASH_COST);
  const speed = CONFIG.STAMINA.DASH_SPEED * (full ? 1 : CONFIG.STAMINA.DASH_STUMBLE_SPEED_MUL);
  const iframes = CONFIG.STAMINA.DASH_IFRAME_S * (full ? 1 : CONFIG.STAMINA.DASH_STUMBLE_IFRAME_MUL);
  applyPlayerKnockback(dirX, dirZ, speed);
  setPlayerInvulnerable(iframes);
  // Mark the dodge so a hit negated in the next sliver counts as a just-dodge.
  noteDashStarted();
  // Post-dodge cooldown — longer when this was a gassed stumble (over-extending
  // on empty leaves you committed).
  cooldownUntil = performance.now()
    + (full ? CONFIG.STAMINA.DASH_COOLDOWN_S : CONFIG.STAMINA.DASH_COOLDOWN_GASSED_S) * 1000;
  if (!full) {
    // Desperate stumble on an empty bar — a camera lurch + stall regen + flash,
    // so it reads as "you're out, that was your last gasp", not a free escape.
    stumble();
    stallRegen();
    flashStaminaBar();
  }
  playWhoosh();
  // Light haptic tick so the dodge has a physical "snap" on a phone (softer for
  // a stumble).
  try { navigator.vibrate?.(full ? 12 : 7); } catch { /* unsupported */ }
  return true;
}

/** Reset the dodge cooldown — floor load. */
export function resetDashCooldown(): void {
  cooldownUntil = 0;
}
