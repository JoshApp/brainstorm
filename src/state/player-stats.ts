import { writable } from './store';
import { computePlayerStats, type PlayerStats } from '../combat/modifiers';
import { getCurrentWeapon } from '../player/current-weapon';

// Single reactive snapshot of everything the UI wants to show about the
// player's combat stats. It folds the TWO previously-separate damage sources
// into one number:
//   - weapon-class proficiency + Acuity (applied in resolveWeaponStats)
//   - equipment damage bonus + multiplier (applied in computePlayerStats)
// so "how hard does my sword hit" has exactly one answer, used by every
// readout instead of each re-deriving the formula.
//
// Recomputed once per frame via recomputePlayerStats() (cheap; a handful of
// multiplies). The underlying store only notifies subscribers when a value
// actually changes, so callers can subscribe (onPlayerStatsChanged) and get
// a callback ONLY on real change — no per-frame DOM churn, no stale readouts.
//
// NOTE: the combat damage pipeline (attack.ts / damage.ts) still calls the
// raw computePlayerStats() directly — it runs in the 'unpaused' phase BEFORE
// this snapshot is recomputed each frame and is correctness-critical, so it
// must read live values, not last frame's snapshot. This store is the
// DISPLAY layer; both paths share the one compute function, so they can't
// drift.

export interface PlayerSnapshot extends PlayerStats {
  /** Effective base hit damage, no crit/finisher: the number the HUD shows.
   *  (resolvedWeaponDamage + weaponDamageBonus) * damageMultiplier. */
  weaponDamage: number;
  /** Raw resolved weapon damage (after proficiency) — for the "base+bonus"
   *  breakdown some readouts show. */
  weaponBaseDamage: number;
  weaponReach: number;
}

function compute(): PlayerSnapshot {
  const s = computePlayerStats();
  const w = getCurrentWeapon();
  const weaponDamage = (w.damage + s.weaponDamageBonus) * s.damageMultiplier;
  return { ...s, weaponDamage, weaponBaseDamage: w.damage, weaponReach: w.reach };
}

function snapshotEquals(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
  return (
    a.maxHp === b.maxHp &&
    a.weaponDamageBonus === b.weaponDamageBonus &&
    a.damageMultiplier === b.damageMultiplier &&
    a.finisherDamageMultiplier === b.finisherDamageMultiplier &&
    a.physicalArmor === b.physicalArmor &&
    a.magicArmor === b.magicArmor &&
    a.weaponDamage === b.weaponDamage &&
    a.weaponBaseDamage === b.weaponBaseDamage &&
    a.weaponReach === b.weaponReach
  );
}

const store = writable<PlayerSnapshot>(compute(), snapshotEquals);

/** Recompute from current sources. Call once per frame (the 'player-stats'
 *  system). Subscribers only fire when a value actually changed. */
export function recomputePlayerStats(): void {
  store.set(compute());
}

export function getPlayerSnapshot(): PlayerSnapshot {
  return store.get();
}

/** Subscribe to snapshot changes. Fires once immediately with the current
 *  snapshot, then on every real change. Returns an unsubscribe closure. */
export function onPlayerStatsChanged(fn: (s: PlayerSnapshot) => void): () => void {
  return store.subscribe(fn);
}
