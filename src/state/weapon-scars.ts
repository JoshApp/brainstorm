import { SCARS, type ScarClass } from '../content/scars';

// WEAPON SCARS — which weapon carries which scars, for this run.
//
// Keyed by ITEM ID, exactly like state/weapon-temper.ts: a scarred blade keeps
// its history when you sheathe it, swap to your sidearm and draw it again three
// floors later. It is not a run-wide "you hit harder" — it belongs to the
// weapon, which is the entire point (docs/WEAPON-EVOLUTION.md).
//
// Module-level state with serialize/hydrate, so a floor reload or a resume keeps
// the forge work and a fresh delver starts with blank steel.

/** One scar per class, so a weapon carries at most three. */
export const MAX_SCARS_PER_WEAPON = 3;

let scars = new Map<string, string[]>();

/** The scar ids on a weapon (empty for blank steel). */
export function getScars(weaponId: string | undefined | null): readonly string[] {
  return (weaponId && scars.get(weaponId)) || [];
}

/** Which lanes this weapon has already spent. */
export function takenScarClasses(weaponId: string | undefined | null): Set<ScarClass> {
  const out = new Set<ScarClass>();
  for (const id of getScars(weaponId)) {
    const k = SCARS[id]?.klass;
    if (k) out.add(k);
  }
  return out;
}

/**
 * Can this weapon take this scar? False when the lane is already spent — the
 * one-per-class rule lives HERE, at the only door, rather than being restated
 * by every offer site (DESIGN-METHOD §3: a rule about the final state is checked
 * against the final state).
 */
export function canTakeScar(weaponId: string | undefined | null, scarId: string): boolean {
  if (!weaponId) return false;
  const spec = SCARS[scarId];
  if (!spec) return false;
  if (getScars(weaponId).includes(scarId)) return false;
  return !takenScarClasses(weaponId).has(spec.klass);
}

/** Burn a scar into a weapon. Returns whether it took. */
export function applyScar(weaponId: string, scarId: string): boolean {
  if (!canTakeScar(weaponId, scarId)) return false;
  const list = scars.get(weaponId);
  if (list) list.push(scarId);
  else scars.set(weaponId, [scarId]);
  return true;
}

/** Every scar id this weapon could still be offered. */
export function offerableScars(weaponId: string | undefined | null): string[] {
  return Object.keys(SCARS).filter((id) => canTakeScar(weaponId, id));
}

/** Wipe all scars (fresh run). */
export function clearScars(): void {
  scars = new Map();
}

/** Snapshot for the save (weaponId → scar ids). */
export function serializeScars(): Record<string, string[]> {
  return Object.fromEntries(scars);
}

/** Restore from a save snapshot (or clear if absent). Unknown ids from an older
 *  catalog are dropped rather than kept as dead weight. */
export function hydrateScars(data: Record<string, string[]> | undefined): void {
  scars = new Map();
  for (const [weaponId, ids] of Object.entries(data ?? {})) {
    const kept = ids.filter((id) => SCARS[id]);
    if (kept.length) scars.set(weaponId, kept);
  }
}
