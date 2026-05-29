// Leveling curve — pure math, no module state, no browser deps (so it's unit
// testable in Node). run-state.ts wraps these with the live XP total.
//
// Quadratic per-level cost: gaining level L costs L * XP_PER_LEVEL XP.
// Cumulative XP to FINISH level L = XP_PER_LEVEL * L * (L-1) / 2.
// At XP_PER_LEVEL=10:
//   L1 → L2: needs 10 cumulative
//   L2 → L3: needs 30 cumulative
//   L3 → L4: needs 60 cumulative
//   L4 → L5: needs 100 cumulative

export const XP_PER_LEVEL = 10;

/** Cumulative XP needed to BE at level L (i.e. to finish level L-1). */
export function xpFloorForLevel(level: number): number {
  if (level <= 1) return 0;
  return XP_PER_LEVEL * level * (level - 1) / 2;
}

/** Current level for an XP total. Level 1 starts at 0 XP. Inverts the
 *  cumulative curve: L = (1 + sqrt(1 + 8*xp/k)) / 2. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;   // guard the sqrt against negative/zero XP
  const L = (1 + Math.sqrt(1 + 8 * xp / XP_PER_LEVEL)) / 2;
  return Math.max(1, Math.floor(L));
}

/** XP earned WITHIN the current level (0 ... xpForNextLevel-1). */
export function xpInLevel(xp: number): number {
  return xp - xpFloorForLevel(levelForXp(xp));
}

/** XP needed to FINISH the current level (i.e. the size of the bar). */
export function xpForNextLevel(xp: number): number {
  const level = levelForXp(xp);
  return xpFloorForLevel(level + 1) - xpFloorForLevel(level);
}
