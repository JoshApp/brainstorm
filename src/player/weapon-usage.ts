import { on as onEvent, type GameEvent } from '../broadcast/event-bus';
import { getEquipped } from './equipment';

// WEAPON USAGE — a per-run tally of how much each weapon has actually been
// FOUGHT with (landed hits, keyed by weapon id). It exists so a system can tell
// your real MAIN weapon — the one you've carved a delve with — apart from a
// throwaway spare you happen to be holding.
//
// The load-bearing user is the tithe basin: sacrificing "your weapon" should
// mean something, and you shouldn't be able to cheese it by equipping a rusted
// castoff a step before the hollow and tithing THAT for a better blade. The
// basin reads getWeaponHits() to know whether the offering was a true sacrifice
// (honoured) or a cheap trade (scorned).
//
// Tracked off the bus's `attack:hit` (which fires on every landed player strike);
// we read the equipped weapon id at the moment of the hit. Per-run only — wiped
// by resetWeaponUsage() at the start of every new run, same as the character.

const hitsByWeapon = new Map<string, number>();
let initialized = false;

/** Wire the attack:hit listener once. Idempotent (mirrors initCharacterTracking). */
export function initWeaponUsage(): void {
  if (initialized) return;
  initialized = true;
  onEvent((event: GameEvent) => {
    if (event.type !== 'attack:hit') return;
    const id = getEquipped('weapon')?.id;
    if (!id) return;
    hitsByWeapon.set(id, (hitsByWeapon.get(id) ?? 0) + 1);
  });
}

/** Wipe the tally — called at the start of a new run (death resets everything). */
export function resetWeaponUsage(): void {
  hitsByWeapon.clear();
}

/** How many hits this weapon id has landed this run (0 if never wielded). */
export function getWeaponHits(weaponId: string): number {
  return hitsByWeapon.get(weaponId) ?? 0;
}

/** The id of the weapon you've fought with MOST this run — your true main — or
 *  null if you've landed no hits yet. Ties break toward whichever was seen first. */
export function getMainWeaponId(): string | null {
  let bestId: string | null = null;
  let best = 0;
  for (const [id, hits] of hitsByWeapon) {
    if (hits > best) { best = hits; bestId = id; }
  }
  return bestId;
}
