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

/** How far a mob can be from the alert position and still be pulled
 *  in. Slightly wider than typical room dimensions so the whole room
 *  joins the fight, but not so wide that mobs in the NEXT room
 *  wander over. Walls don't block alerts — corridors stay quiet
 *  unless somebody actually walks through them. */
export const ALERT_RADIUS = 14;
const ALERT_RADIUS_SQ = ALERT_RADIUS * ALERT_RADIUS;

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
  return { x: activeX, z: activeZ };
}

/** Wipe alert state on level teardown. */
export function clearAlerts() {
  remaining = 0;
}
