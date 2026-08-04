// Combat alerts — shared aggro broadcast between mobs.
//
// Without this, each enemy independently checks its sight cone +
// 2.5m hearing radius. An acolyte facing the wrong way while a rat
// fights the player two metres beside it stays idle. That reads as
// broken AI, not as "the acolyte is engrossed in chanting."
//
// Model:
//   - When any enemy first acquires the player (or takes damage),
//     it calls raise() with the player's current position. That
//     becomes "the active alert" — a single most-recent point.
//   - Idle enemies sample the alert each tick. If they're within
//     ALERT_RADIUS of the alert position, they self-aggro and treat
//     the alert position as their last-known-player-position
//     (they walk toward it, see the player on the way, fight).
//   - Alerts decay after ALERT_DURATION so an old alert doesn't
//     keep pulling enemies in long after the player has left.
//
// Cleared per-level by clearAlerts() in the loader teardown so the
// next floor starts quiet.

let activeX = 0;
let activeZ = 0;
let remaining = 0;   // seconds left on the active alert

/**
 * How far a shout carries.
 *
 * This was 14m, with a comment claiming it was "not so wide that mobs in the
 * NEXT room wander over". Measured on composed floors, the median room is 10m
 * across — so a 14m circle reached about 4m past the far wall in every
 * direction, and ~40% of every mob an alert pulled was standing in a DIFFERENT
 * ROOM. One alert dragged 5-7 mobs on average and as many as 16, which is the
 * "I'm one room away and suddenly I'm swarmed by ten enemies while the rest of
 * the floor is empty" report exactly.
 *
 * 10m is one room. Combined with the wall check below, a fight now recruits the
 * room it happens in, plus whatever can actually see down the corridor into it.
 */
export const ALERT_RADIUS = 10;
const ALERT_RADIUS_SQ = ALERT_RADIUS * ALERT_RADIUS;

/**
 * Does sound reach from the alert to this mob? Injected at level load (the
 * alert module has no business importing the level).
 *
 * "Walls don't block alerts" was the old rule, stated in this file as though it
 * were a decision. It is the mechanism behind the swarm: a fight in one chamber
 * shouting through stone into two neighbours. A wall now stops it; a doorway
 * doesn't, because the check is line-of-sight and an opening is a line.
 */
let losProbe: ((ax: number, az: number, bx: number, bz: number) => boolean) | null = null;

export function setAlertLineOfSight(fn: typeof losProbe): void {
  losProbe = fn;
}

/** Alerts decay quickly so a brief encounter doesn't echo through
 *  the rest of the floor. 5s is long enough for nearby mobs to
 *  notice on their next update, short enough that fights stay local. */
const ALERT_DURATION = 5;

/** Raise a combat alert at the given player position. Idempotent —
 *  multiple enemies seeing the player on the same frame just
 *  overwrite each other (they're all reporting the same spot). */
export function raiseAlert(playerX: number, playerZ: number) {
  activeX = playerX;
  activeZ = playerZ;
  remaining = ALERT_DURATION;
}

/** Per-frame decay. Called from main.ts after enemies tick. */
export function tickAlerts(dt: number) {
  if (remaining > 0) remaining -= dt;
}

/** Read the current alert. Returns null if no alert is active or
 *  the sampling enemy is outside ALERT_RADIUS. Enemy AI uses this
 *  in lieu of its own perception when it's idle/returning. */
export function sampleAlert(enemyX: number, enemyZ: number): { x: number; z: number } | null {
  if (remaining <= 0) return null;
  const dx = activeX - enemyX;
  const dz = activeZ - enemyZ;
  if (dx * dx + dz * dz > ALERT_RADIUS_SQ) return null;
  // Through stone, nobody hears you.
  if (losProbe && !losProbe(enemyX, enemyZ, activeX, activeZ)) return null;
  return { x: activeX, z: activeZ };
}

/** Wipe alert state on level teardown. */
export function clearAlerts() {
  remaining = 0;
  losProbe = null;   // the next floor installs its own
}
