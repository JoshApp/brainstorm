import type { LevelSpec } from './types';
import { TUTORIAL } from './tutorial';

// Hand-authored floor specs USED to live here: LEVEL_1 (depth-1) and
// LEVEL_2 (depth-2). Both have been deleted in favour of pure procgen.
// The act structure in src/level/acts.ts owns depth → next-floor
// routing; the level loader falls back to generateFloor(depth) for
// any id not in this registry, so 'depth-1' and 'depth-2' are now
// produced on demand by the vault composer.

// Registry. The level loader looks up targetLevel against this map.
export const LEVELS: Record<string, LevelSpec> = {
  // Tutorial: entry chamber for first-time players. Its stairs target
  // 'depth-1', which is procgen-composed (vault chain) — no longer
  // a hand-authored level. The act structure in src/level/acts.ts
  // owns depth → next-floor routing.
  'tutorial': TUTORIAL,
};
