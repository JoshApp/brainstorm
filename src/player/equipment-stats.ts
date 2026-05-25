// Compatibility shim — the real implementation now lives in the unified
// modifier system at src/combat/modifiers.ts (where buffs + equipment +
// future stat sources all aggregate through one place).
//
// Existing call sites import { computeStats } from here; we re-export
// computePlayerStats under the old name so they keep working unchanged.

export { computePlayerStats as computeStats } from '../combat/modifiers';
export type { PlayerStats } from '../combat/modifiers';
