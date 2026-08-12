// Reactive defense — the shared layer under both deflect (tap a white flash)
// and just-dodge (roll a red one). It owns three things:
//
//   1. OPPORTUNITY registry — enemies winding a reachable, DEFLECTABLE strike
//      register an open opportunity. It drives the white flash AND tells the
//      tap arbiter that a tap should PARRY, not swing (the Sekiro context
//      switch: same input, meaning set by the telegraph).
//
//   2. PARRY window — a tap during an opportunity opens a brief active window;
//      an enemy's deflectable strike landing while it's open is negated and
//      staggers the attacker (resolved enemy-side via isParryActive). A short
//      lockout after every attempt stops mash-guarding.
//
//   3. BULLET TIME — the shared reward. A clean deflect OR just-dodge slows
//      the WORLD (enemies + projectiles) to CONFIG.BULLET_TIME.WORLD_SCALE,
//      easing back over DURATION_S. The PLAYER clock omits this scale (main.ts
//      builds playerDt without it), so you flow while they crawl.
//
// Module-level mutable state with getter/setters — the project's standard
// pattern. NOT persisted: reset on floor load (loader.ts).

import { CONFIG } from '../config';
import { gameNow } from '../engine/game-clock';
import { registerSimReset } from '../engine/sim-state';
import { setPlayerInvulnerable } from '../player/health';
import { freezeFor } from './hit-pause';
import { emit } from '../broadcast/event-bus';
import { playParry, playSlowmoEnter } from '../audio/sfx';
import { DEV } from '../debug/dev';
import { flashReaction } from '../debug/reaction-debug';

const now = () => gameNow() / 1000;

// ── 1. Opportunity registry ──────────────────────────────────────────
// A count, not a set: enemies push when their white flash opens and pop when
// it closes (strike resolved / interrupted / dead). The tap arbiter only
// needs "is any deflect available right now."
let openOpportunities = 0;

export function pushDeflectOpportunity(): void { openOpportunities++; }
export function popDeflectOpportunity(): void {
  openOpportunities = Math.max(0, openOpportunities - 1);
}
/** True when ≥1 enemy is flashing a deflectable strike — a tap should parry. */
export function deflectOpportunityActive(): boolean { return openOpportunities > 0; }

// ── 2. Parry window ──────────────────────────────────────────────────
// ANTI-MASH BY NARROWING, NOT BY DENYING (Sekiro's model, 2026-08-12).
//
// We used to answer mashing with a hard lockout: tap again too soon and the
// input was simply refused. That is the crude version, and it has the worst
// property a defensive mechanic can have — at the moment you most need the
// parry, the game silently does nothing, and the player cannot tell a refused
// input from a mistimed one.
//
// Sekiro instead SHRINKS the window with each recent press (down to a floor),
// and a SUCCESSFUL deflect clears the penalty instantly. Panic still costs you
// — each extra tap makes the next one less forgiving — but the input is never
// refused, so every failure is legibly your timing. And one good read buys back
// full generosity immediately, which rewards recovering your composure rather
// than punishing you for having lost it.
let parryActiveUntil = -Infinity;   // seconds — window during which a strike is deflected
let mashPresses = 0;                // recent presses, each narrowing the next window
let mashDecayAt = -Infinity;        // when the accumulated penalty lapses

/** The window a press would open right now, after the mash penalty. Exported so
 *  the HUD/debug can show the player what their panic has cost them. */
export function currentParryWindow(): number {
  const K = CONFIG.DEFLECT;
  const decay = now() >= mashDecayAt ? 0 : mashPresses;
  const shrunk = K.PARRY_WINDOW_S * Math.pow(K.MASH_SHRINK, decay);
  return Math.max(K.PARRY_WINDOW_MIN_S, shrunk);
}

/** The tap arbiter calls this when a tap lands during an opportunity. ALWAYS
 *  opens a window — a narrower one if you've been mashing. Returns true so
 *  callers keep their existing "a parry started" feedback. */
export function triggerParry(): boolean {
  const t = now();
  const K = CONFIG.DEFLECT;
  // Count this press against the mash penalty BEFORE computing the window, so
  // the first tap is full-width and the second is already narrower.
  if (t >= mashDecayAt) mashPresses = 0;
  const window = currentParryWindow();
  mashPresses++;
  mashDecayAt = t + K.MASH_DECAY_S;
  // Never SHORTEN a window already open (two taps around one incoming strike
  // shouldn't leave you less protected than the first tap alone did).
  parryActiveUntil = Math.max(parryActiveUntil, t + window);
  return true;
}

/** A clean deflect forgives the panic entirely — the next parry is full-width
 *  again. Called from notePlayerDeflected. */
export function clearParryMashPenalty(): void {
  mashPresses = 0;
  mashDecayAt = -Infinity;
}

/** enemy.ts checks this at the instant a deflectable strike would damage the
 *  player. Stays open for the whole window so a swarm's simultaneous strikes
 *  all deflect off one well-timed tap. */
export function isParryActive(): boolean { return now() < parryActiveUntil; }

// ── Deflect landed → the counter ──────────────────────────────────────
// Player-side reward of a clean deflect (the enemy-side flinch + poise chip
// live in enemy.ts). No bullet-time — deflect is the AGGRESSIVE answer:
//   · a brief i-frame so a 2nd attacker can't punish the parry instant,
//   · a clash freeze + parry "ting",
//   · an EMPOWER window so the next swing is the big hit,
//   · a one-shot riposte flag the viewmodel consumes to "raise the weapon".
let empowerUntil = -Infinity;
let ripostePending = false;

export function notePlayerDeflected(): void {
  // A clean read forgives the panic that preceded it — the next parry is
  // full-width again. This is the half of the anti-mash model that matters:
  // recovering your composure is rewarded immediately, so a scrappy exchange
  // can be pulled back rather than spiralling.
  clearParryMashPenalty();
  empowerUntil = now() + CONFIG.DEFLECT.EMPOWER_WINDOW_S;
  ripostePending = true;
  setPlayerInvulnerable(CONFIG.DEFLECT.IFRAME_S);
  freezeFor(CONFIG.DEFLECT.CLASH_FREEZE_MS);
  playParry();
  // The tempo lane's hook: Grace relics trigger on this (ecs/triggers.ts).
  emit({ type: 'player:deflected' });
  try { navigator.vibrate?.(CONFIG.DEFLECT.HAPTIC_MS); } catch { /* unsupported */ }
  if (DEV) flashReaction('PARRY', '#dfe8ff', 500);
}

/** attack.ts: is the next swing empowered by a recent deflect? */
export function isDeflectEmpowerActive(): boolean { return now() < empowerUntil; }
/** attack.ts: spend the empower on a connecting hit (one discrete payoff). */
export function consumeDeflectEmpower(): void { empowerUntil = -Infinity; }

/** systems.ts: true once after a deflect → fire the viewmodel "raise" beat. */
export function consumeRiposte(): boolean {
  if (!ripostePending) return false;
  ripostePending = false;
  return true;
}

// ── 3. Bullet time (the shared reward) ────────────────────────────────
let dipElapsed = Infinity;   // real-seconds since the dip began (∞ = idle)

/** Fire the reward — called by deflect (enemy-side) and just-dodge alike. */
export function enterBulletTime(): void {
  dipElapsed = 0;
  playSlowmoEnter();   // the world holds its breath — sub whoomph + the audio muffles
}

/** 0 → 1 "how deep is the slow-mo right now" — 1 at the held floor, easing to 0
 *  as it releases. The presentation layer (vignette / FOV / audio muffle) reads
 *  this so every cue tracks the actual dip, not a fixed timer. */
export function getBulletTimeIntensity(): number {
  const s = CONFIG.BULLET_TIME.WORLD_SCALE;
  return (1 - getWorldTimeScale()) / (1 - s);
}

/** WORLD time-scale (enemies + projectiles). 1 when idle; snaps to WORLD_SCALE
 *  on a clean defense, then eases back. main.ts folds this into scaledDt ONLY
 *  — the player clock (playerDt) never sees it, which is the asymmetry. */
export function getWorldTimeScale(): number {
  const dur = CONFIG.BULLET_TIME.DURATION_S;
  if (dipElapsed >= dur) return 1;
  const s = CONFIG.BULLET_TIME.WORLD_SCALE;
  const t = dipElapsed / dur;                       // 0 → 1 across the dip
  const hold = CONFIG.BULLET_TIME.HOLD_FRAC;
  // HOLD the world deep at WORLD_SCALE for the first `hold` of the window so the
  // slow-mo actually READS, THEN ease back to full over the remainder. (A plain
  // linear ramp spent the deep part in one frame — the dip was there but
  // invisible.) Quadratic release so the snap-back accelerates.
  if (t <= hold) return s;
  const r = (t - hold) / (1 - hold);                // 0 → 1 across the release
  return s + (1 - s) * (r * r);
}

/** True while the world is dilated — UI/feel hooks can read it (e.g. a vignette). */
export function isBulletTimeActive(): boolean {
  return dipElapsed < CONFIG.BULLET_TIME.DURATION_S;
}

/** Advance the dip in REAL time so it isn't slowed by its own dilation.
 *  main.ts calls this before composing scaledDt. */
export function tickBulletTime(realDt: number): void {
  if (dipElapsed < CONFIG.BULLET_TIME.DURATION_S) dipElapsed += realDt;
}

/** Floor load / death — clear everything. */
export function resetReactiveDefense(): void {
  openOpportunities = 0;
  parryActiveUntil = -Infinity;
  clearParryMashPenalty();
  dipElapsed = Infinity;
  empowerUntil = -Infinity;
  ripostePending = false;
}
// sim-state: deflect windows + opportunity count must clear at run start (see sim-state.ts).
registerSimReset(resetReactiveDefense);
