// Dash / dodge — a discrete lunge with a brief invulnerability window. The
// Souls roll, adapted for a mobile crawler: it's the defensive job stamina
// does, and the reason the bar matters in a fight.
//
// Mechanically it's a strong, short-lived impulse: it reuses the player
// knockback channel (updateCamera already runs that through wall/enemy
// collision, so a dash slides along geometry and can't punch through a wall),
// plus the existing entry-grace i-frame mechanism (damagePlayer already honours
// it) for the dodge window. Costs DASH_COST stamina; gated only when the bar is
// visibly empty, then the HUD flashes so the rejected tap reads as "you're out".

import { CONFIG } from '../config';
import { spendStaminaSoft } from './stamina';
import { noteDashStarted } from './just-dodge';
import { applyPlayerKnockback } from '../player/knockback';
import { setPlayerInvulnerable } from '../player/health';
import { flashStaminaBar } from '../ui/stamina-bar';
import { playWhoosh } from '../audio/sfx';

/** Fire a dash in WORLD direction (dirX, dirZ) — normalised internally. Returns
 *  true if it fired. Gated only when stamina is empty (flash + false). */
export function tryDash(dirX: number, dirZ: number): boolean {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0) return false;   // no resolvable direction
  if (!spendStaminaSoft(CONFIG.STAMINA.DASH_COST)) {
    flashStaminaBar();
    return false;
  }
  applyPlayerKnockback(dirX, dirZ, CONFIG.STAMINA.DASH_SPEED);
  setPlayerInvulnerable(CONFIG.STAMINA.DASH_IFRAME_S);
  // Mark the dodge so a hit negated in the next sliver counts as a just-dodge.
  noteDashStarted();
  playWhoosh();
  // Light haptic tick so the dodge has a physical "snap" on a phone.
  try { navigator.vibrate?.(12); } catch { /* unsupported */ }
  return true;
}
