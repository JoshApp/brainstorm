import type { PaletteV1 } from './palette';

// Act structure for the run — groups dungeon floors into themed
// sequences, each ending in a boss + safe-room checkpoint.
//
// Pattern:
//   ACT I    (depths 1-3):   floor 1 → 2 → 3 (boss) → SAFE
//   ACT II   (depths 4-7):   floor 4 → 5 → 6 → 7 (boss) → SAFE
//   ACT III  (depths 8-12):  ... 12 (boss) → SAFE
//   Beyond:  endless — palette cycles, scaling continues, no fixed
//            boss schedule.
//
// Within an act, descent stairs go straight to the next floor (no
// safe room between). The boss-floor descent goes to the safe room.
// The safe-room descent goes to the FIRST floor of the next act.
//
// Each act has its own atmosphere (torch tint + fog colour) so the
// dungeon's mood shifts as you descend — a tiny narrative arc.

export interface Act {
  /** 1-based act number for display + analytics. */
  number: number;
  /** Display name shown in the title card / depth counter. */
  name: string;
  /** Depths covered by this act. */
  depths: number[];
  /** The depth that contains the boss + ends the act. Usually the
   *  last entry of `depths`. */
  bossDepth: number;
  /** BossSpec id (see src/content/bosses.ts) that ends this act.
   *  procgen reads this to know which boss to spawn AND which
   *  preferred arena to bias the boss-vault roll toward. */
  bossId: string;
  /** Atmosphere for floors in this act. */
  torchTint: number;
  fogColor: number;
  /** Per-act palette defaults. Cascades through floor + vault
   *  overrides at compose time (see resolvePalette in palette.ts).
   *  The lighting pass (and future carve / decor passes) read
   *  from the resolved palette. Omit to keep all passes 'off'
   *  for this act — only hand-authored content. */
  palette?: PaletteV1;
}

export const ACTS: Act[] = [
  {
    number: 1,
    name: 'The Old Refectory',
    depths: [1, 2, 3],
    bossDepth: 3,
    bossId: 'boiling-king',
    torchTint: 0xffaa55,
    fogColor: 0x140a05,
    // First act to opt into the palette/pass system. Sparse amber
    // lighting — the refectory is mostly dim with a few torches at
    // entries + back walls. tone.lightTint mirrors torchTint so the
    // pass's procedural torches match the existing `*` aesthetic.
    palette: {
      tone: { lightTint: 0xffaa55, lightIntensity: 0.95 },
      light: { density: 'sparse' },
      decor: { style: 'pillared', density: 'light' },
      carve: { style: 'fissured', density: 'light' },
      // 'light' encounter = some X slots stay empty so the
      // refectory's earlier floors read as a quieter introductory
      // act. Acts II/III stay at 'standard' (full fill).
      encounter: { density: 'light' },
      events:    { density: 'light' },
    },
  },
  {
    number: 2,
    name: 'The Cistern',
    depths: [4, 5, 6, 7],
    bossDepth: 7,
    // INTERIM: the boiling-king fills every act's boss slot until Act II/III
    // get distinct bosses (was 'hollow-choir', the wraith placeholder).
    bossId: 'boiling-king',
    torchTint: 0x66ccdd,
    fogColor: 0x05101a,
  },
  {
    number: 3,
    name: 'The Verdant Rot',
    depths: [8, 9, 10, 11, 12],
    bossDepth: 12,
    // INTERIM: boiling-king everywhere until distinct bosses exist.
    bossId: 'boiling-king',
    torchTint: 0x80c060,
    fogColor: 0x080f05,
  },
];

/** Find the act this depth belongs to. Depths past Act III cycle
 *  through the palette pool with a synthetic act for endless mode. */
export function actForDepth(depth: number): Act {
  for (const a of ACTS) {
    if (a.depths.includes(depth)) return a;
  }
  // Endless mode — cycle palettes. Each "endless act" is 5 floors,
  // boss every 5th.
  const beyond = depth - (ACTS[ACTS.length - 1].depths[ACTS[ACTS.length - 1].depths.length - 1] + 1);
  const cycleIdx = Math.floor(beyond / 5) % ACTS.length;
  const palette = ACTS[cycleIdx];
  const actStart = ACTS[ACTS.length - 1].bossDepth + 1 + Math.floor(beyond / 5) * 5;
  return {
    number: ACTS.length + Math.floor(beyond / 5) + 1,
    name: `${palette.name} (revisited)`,
    depths: [actStart, actStart + 1, actStart + 2, actStart + 3, actStart + 4],
    bossDepth: actStart + 4,
    bossId: palette.bossId,
    torchTint: palette.torchTint,
    fogColor: palette.fogColor,
  };
}

/** Is this depth the boss-floor of its act? */
export function isBossDepth(depth: number): boolean {
  return actForDepth(depth).bossDepth === depth;
}

/** What level id does the stair at this dungeon depth target?
 *  Boss-depth → safe-N (the act's checkpoint). Non-boss → next depth. */
export function nextLevelAfter(depth: number): string {
  if (isBossDepth(depth)) return `safe-${depth}`;
  return `depth-${depth + 1}`;
}
