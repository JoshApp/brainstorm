// WEAPON TEMPER — the blacksmith's per-weapon upgrade level (task #94).
//
// The blacksmith TEMPERS the weapon in your hand: each temper raises that
// weapon's level, adding flat damage. The upgrade sticks to the WEAPON (keyed by
// item id), so a tempered blade keeps its edge across floors and even if you
// sheathe it and draw it later — it is not a run-wide "you hit harder" buff.
//
// Module-level state with serialize/hydrate, mirroring run-mutations.ts, so it
// persists through the save (a resume / floor reload keeps your forge work) and
// clears on a fresh run. The stat pipeline (combat/modifiers.ts) reads the DRAWN
// weapon's level and adds it as weapon damage.

/** Flat weapon damage added per temper level. */
export const TEMPER_DAMAGE_PER_LEVEL = 1;
/** How many times a single weapon can be tempered. */
export const MAX_TEMPER_LEVEL = 5;

let levels = new Map<string, number>();

/** The temper level of a weapon by item id (0 if never forged). */
export function getTemperLevel(weaponId: string | undefined | null): number {
  return weaponId ? (levels.get(weaponId) ?? 0) : 0;
}

/** Can this weapon be tempered further? */
export function canTemper(weaponId: string | undefined | null): boolean {
  return !!weaponId && getTemperLevel(weaponId) < MAX_TEMPER_LEVEL;
}

/** Raise a weapon's temper by one (capped). Returns the new level. */
export function temperWeapon(weaponId: string): number {
  const next = Math.min(MAX_TEMPER_LEVEL, getTemperLevel(weaponId) + 1);
  levels.set(weaponId, next);
  return next;
}

/** Flat weapon-damage bonus a weapon currently carries from tempering. */
export function temperDamageBonus(weaponId: string | undefined | null): number {
  return getTemperLevel(weaponId) * TEMPER_DAMAGE_PER_LEVEL;
}

/** Wipe all temper (fresh run). */
export function clearTemper(): void {
  levels = new Map();
}

/** Snapshot for the save (weaponId → level). */
export function serializeTemper(): Record<string, number> {
  return Object.fromEntries(levels);
}

/** Restore from a save snapshot (or clear if absent). */
export function hydrateTemper(data: Record<string, number> | undefined): void {
  levels = new Map(Object.entries(data ?? {}));
}
