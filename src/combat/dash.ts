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
import { gameNow } from '../engine/game-clock';
import { registerSimReset } from '../engine/sim-state';
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
let lastStumbleAt = -Infinity;
let windedUntil = 0;
// The active dodge window (≈ the i-frame span). Lets the player-action FSM
// report 'dodging' as a real state with a duration, instead of inferring it
// from the invuln flag (which entry-grace + parry also set).
let dodgeActiveUntil = 0;
let dodgeStartedAt = 0;
let dodgeDurationMs = 0;

/** True while a dodge is mid-roll (its i-frame window). The FSM's 'dodging'. */
export function isDodging(): boolean { return gameNow() < dodgeActiveUntil; }

/**
 * The eye's vertical offset through a dodge — one arc up and back down, exactly
 * the shape vault-step.ts uses, so a hop is a hop wherever it comes from.
 *
 * A dodge that CLEARS something arcs properly; a flat-ground dodge barely
 * leaves the floor. That split is the point: the lift is what tells you the
 * obstacle was cleared rather than sidestepped, and if every dodge floated, the
 * one that matters would say nothing.
 */
export function dashHeightOffset(): number {
  if (!isDodging() || dodgeDurationMs <= 0) return 0;
  const k = Math.max(0, Math.min(1, (gameNow() - dodgeStartedAt) / dodgeDurationMs));
  const rise = isLeapingOverBody() ? CONFIG.VAULT.LEAP.RISE_M
    : isDashingOver() ? CONFIG.VAULT.DASH_OVER_RISE_M
      : CONFIG.VAULT.DASH_RISE_M;
  return Math.sin(k * Math.PI) * rise;
}

// DASH-OVER: set true at dash START only when a landing check said the dash CLEARS
// a dashable obstacle/gap onto valid floor. While it holds AND we're mid-roll, the
// movement collision ignores DASHABLE obstacles (so you vault over). False → normal
// dash, dashable things still block, you stop at the edge (no teleport, no stuck).
let dashOverActive = false;
export function setDashOver(v: boolean): void { dashOverActive = v; }
/** Is THIS dash a validated vault (ignore dashable obstacles this roll)? */
export function isDashingOver(): boolean { return dashOverActive && isDodging(); }

// Undershoot rescue. The lunge (knockback ≈1.3m + input) normally overshoots a
// 1m obstacle, but a no-input dash can die inside it. We remember the vault
// direction + a brief window; once the i-frame vault closes, if the player is
// still standing inside the dashable obstacle we complete the vault forward
// (never a teleport — a bounded step to the far edge). See resolveDashUndershoot.
let dashDirX = 0, dashDirZ = 0;
let dashHealUntil = 0;

// ── THE LEAP: A DODGE AIMED AT A BODY GOES OVER IT ──────────────────────────
//
// dashOverActive above is about STONE — the level's dashable obstacles. Enemies
// live nowhere in that path (walkable.canDashOver never looks at a mob), which
// is why the WALK-vault used to sail over them for free; that hole is closed in
// player/vault-step.ts. The move itself is worth keeping though, so it moves to
// the input that should have owned it all along.
//
// A leap is armed at dodge START, exactly like a dash-over: the caller has
// already checked that a body is on the roll's line and that there is real floor
// past it. While it holds, enemy collision and the depenetration push are OFF
// for the player (controls/camera.ts) — being inside the body mid-leap is the
// intended state, and the depenetration would otherwise shove you back out the
// side you came from, which is the exact "landing in them" this exists to fix.
//
// Then the landing is COMPLETED rather than hoped for. The lunge is ~1.3m of
// decaying knockback and a body at a metre needs closer to 1.8m, so undershoot
// is the common case — the same lesson dash-over learned (see the undershoot
// rescue above), applied to flesh. The landing point was validated before the
// dodge fired, so finishing the move is a short bounded correction to a place we
// already know is floor, never a teleport and never a guess.
let leapActive = false;
let leapLandX = 0, leapLandZ = 0;
let leapUntil = 0;

/** Arm a validated leap: this roll clears a body and comes down at (landX,landZ). */
export function noteBodyLeap(landX: number, landZ: number): void {
  leapActive = true;
  leapLandX = landX; leapLandZ = landZ;
  leapUntil = gameNow() + CONFIG.VAULT.LEAP.SETTLE_S * 1000;
}

/** Is THIS roll a validated leap over a body (ignore enemy collision)? */
export function isLeapingOverBody(): boolean { return leapActive && isDodging(); }

/**
 * Where a leap should come down, once its roll has ended and if it hasn't
 * already got there. Null when no leap is pending or the window has passed.
 *
 * The CALLER decides whether the correction is needed (it is the one that knows
 * whether the player is still standing in the body) and clamps the move against
 * the level — this module owns the intent, not the collision.
 */
export function pendingLeapLanding(): { x: number; z: number } | null {
  if (!leapActive) return null;
  if (isDodging()) return null;                 // still mid-leap; inside is fine
  if (gameNow() > leapUntil) { leapActive = false; return null; }
  return { x: leapLandX, z: leapLandZ };
}

/** The leap is resolved (landed, or the player was already clear). */
export function clearBodyLeap(): void { leapActive = false; }

/** Mark that a validated dash-over just FIRED in world direction (dirX,dirZ). */
export function noteDashOverFired(dirX: number, dirZ: number): void {
  const len = Math.hypot(dirX, dirZ) || 1;
  dashDirX = dirX / len; dashDirZ = dirZ / len;
  dashHealUntil = gameNow() + 600;   // ms — spans the knockback settle
}

/** If a dash-over undershot and left the player inside the dashable obstacle,
 *  return the position that completes the vault; null when nothing needs fixing.
 *  Only acts once the vault window has closed and only briefly after the dash. */
export function resolveDashOverLanding(
  x: number, z: number, radius: number,
  walkable: { resolveDashUndershoot(x: number, z: number, dx: number, dz: number, r: number): { x: number; z: number } | null },
): { x: number; z: number } | null {
  if (isDashingOver()) return null;          // still vaulting — being inside is intended
  if (gameNow() > dashHealUntil) return null;
  return walkable.resolveDashUndershoot(x, z, dashDirX, dashDirZ, radius);
}

/** Fire a dash in WORLD direction (dirX, dirZ) — normalised internally. Always
 *  fires (returns true) given a direction; an empty bar yields a weaker stumble.
 *  Gated only by the brief post-dodge cooldown. */
export function tryDash(dirX: number, dirZ: number): boolean {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0) return false;   // no resolvable direction
  if (gameNow() < cooldownUntil) return false;   // still in the post-dodge cooldown
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
  dodgeActiveUntil = gameNow() + iframes * 1000;
  dodgeStartedAt = gameNow();
  dodgeDurationMs = iframes * 1000;
  // Mark the dodge so a hit negated in the next sliver counts as a just-dodge.
  noteDashStarted();
  // Post-dodge cooldown — longer when this was a gassed stumble (over-extending
  // on empty leaves you committed).
  const now = gameNow();
  let cooldownS = full ? CONFIG.STAMINA.DASH_COOLDOWN_S : CONFIG.STAMINA.DASH_COOLDOWN_GASSED_S;
  if (!full) {
    // Desperate stumble on an empty bar — a camera lurch + stall regen + flash,
    // so it reads as "you're out, that was your last gasp", not a free escape.
    // CHAINING gassed stumbles escalates: the second within the window
    // locks the legs for the long cooldown and leaves you WINDED
    // (slowed below walking) — empty-tank dash-spam is never mobility.
    const chained = now - lastStumbleAt < CONFIG.STAMINA.STUMBLE_CHAIN_WINDOW_S * 1000;
    if (chained) {
      cooldownS = CONFIG.STAMINA.STUMBLE_CHAIN_COOLDOWN_S;
      windedUntil = now + CONFIG.STAMINA.STUMBLE_WINDED_S * 1000;
    }
    lastStumbleAt = now;
    stumble();
    stallRegen();
    flashStaminaBar();
  }
  cooldownUntil = now + cooldownS * 1000;
  playWhoosh();
  // Light haptic tick so the dodge has a physical "snap" on a phone (softer for
  // a stumble).
  try { navigator.vibrate?.(full ? 12 : 7); } catch { /* unsupported */ }
  return true;
}

/** Movement multiplier while WINDED from chained empty-bar stumbles
 *  (1 = normal). Camera movement composes this onto MOVE_SPEED. */
export function getWindedMoveMul(): number {
  return gameNow() < windedUntil ? CONFIG.STAMINA.STUMBLE_WINDED_MOVE_MUL : 1;
}

/** Reset the dodge cooldown — floor load. */
export function resetDashCooldown(): void {
  cooldownUntil = 0;
  lastStumbleAt = -Infinity;
  windedUntil = 0;
  dodgeActiveUntil = 0;
  dodgeDurationMs = 0;
  leapActive = false;
  dashOverActive = false;
}
// sim-state: a fresh run starts dodge-ready (see sim-state.ts).
registerSimReset(resetDashCooldown);
