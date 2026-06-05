// Exhaustion haptic — makes the GASSED state felt, not read.
//
// When a committal action empties the bar you're locked out of the power moves
// (charged / ranged / dash) until regen recovers — the "stalled recovery"
// punishment for over-committing. On a phone you can't watch the bar mid-fight,
// so a slow HEARTBEAT pulse in the player's hand communicates "you're winded"
// directly: the punishment lands without a glance at the HUD. This is the first
// of the felt-stamina channels (breath + camera-heave are the future siblings).
//
// Module-level mutable state, getter/setter pattern. NOT persisted.

import { CONFIG } from '../config';
import { isStaminaExhausted } from './stamina';

let beatTimer = 0;
let wasExhausted = false;

// A double-thump heartbeat: short thump — pause — slightly longer thump.
const HEARTBEAT_PATTERN: number[] = [14, 90, 22];

function pulse(): void {
  try { navigator.vibrate?.(HEARTBEAT_PATTERN); } catch { /* unsupported */ }
}

/** Tick the heartbeat in REAL time, so the cadence stays steady through slow-mo
 *  / hit-pause. Call from an 'unpaused' system (so it falls silent in menus). */
export function tickExhaustionHaptic(realDt: number): void {
  if (!isStaminaExhausted()) {
    wasExhausted = false;
    beatTimer = 0;
    return;
  }
  if (!wasExhausted) {
    // Just bottomed out — thump immediately so the over-commit registers.
    wasExhausted = true;
    beatTimer = CONFIG.STAMINA.EXHAUST_HEARTBEAT_S;
    pulse();
    return;
  }
  beatTimer -= realDt;
  if (beatTimer <= 0) {
    beatTimer = CONFIG.STAMINA.EXHAUST_HEARTBEAT_S;
    pulse();
  }
}

export function resetExhaustionHaptic(): void {
  beatTimer = 0;
  wasExhausted = false;
}
