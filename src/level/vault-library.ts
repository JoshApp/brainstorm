import type { Vault } from './vault';

// Vault library — starter set. Each vault is a small ASCII chunk
// (≤ 12 cells in either axis) so the composer can chain several into
// a single floor without the whole thing ballooning into a maze.
//
// Tile dictionary (canonical list in src/level/tilemap.ts):
//   #  wall      .  floor    S  player spawn   /  stairs DOWN
//   o  door      O  sealed door (clear to open)
//   P  pillar    A  altar    c  chest          C  corpse
//   F  fountain  ^  spike trap
//   T  torch N   t  torch S  <  torch W       >  torch E
//   G  ghoul     R  rat      K  skirmisher    W  wraith   Y  acolyte
//   X  random enemy (composer fills depth-appropriate)   B  boss slot
//
// Vault authoring rules:
//   - Wrap each chunk in '#' so it's a closed box. The composer KNOCKS
//     open one wall edge per connection (the corridor mouth).
//   - Keep the chunk roughly square; pinwheels and long corridors fight
//     the linear chain composer.
//   - Each vault gets its OWN torches — the composer doesn't add any.
//   - One 'S' goes in a START vault; one '/' goes in an EXIT (or BOSS)
//     vault. Other vaults must not have either.

// ── START vaults ──────────────────────────────────────────────────

const FOYER_SMALL: Vault = {
  id: 'foyer-small',
  tags: ['start'],
  map: [
    '##########',
    '#...T....#',
    '#........#',
    '#........#',
    '#........#',
    '#...S....#',
    '##########',
  ],
};

const FOYER_PILLAR: Vault = {
  id: 'foyer-pillar',
  tags: ['start'],
  map: [
    '############',
    '#....T.....#',
    '#.P......P.#',
    '#..........#',
    '#..........#',
    '#.P......P.#',
    '#....S.....#',
    '############',
  ],
};

const FOYER_ALCOVE: Vault = {
  id: 'foyer-alcove',
  tags: ['start'],
  map: [
    '############',
    '#..T....T..#',
    '#..........#',
    '#..C....C..#',
    '#..........#',
    '#.....S....#',
    '############',
  ],
};

// ── COMBAT vaults ─────────────────────────────────────────────────

const COMBAT_OPEN: Vault = {
  id: 'combat-open',
  tags: ['combat'],
  map: [
    '##########',
    '#..T...T.#',
    '#........#',
    '#...X....#',
    '#........#',
    '#..X....X#',
    '#........#',
    '##########',
  ],
};

const COMBAT_PILLARS: Vault = {
  id: 'combat-pillars',
  tags: ['combat'],
  map: [
    '############',
    '#...T....T.#',
    '#.P......P.#',
    '#....X.....#',
    '#..........#',
    '#.P..X...P.#',
    '#..........#',
    '############',
  ],
};

const COMBAT_CHOKE: Vault = {
  id: 'combat-choke',
  tags: ['combat'],
  // Narrow chamber — funnels the player past mobs. Good for ranged.
  map: [
    '#########',
    '#...T...#',
    '#.X...Y.#',
    '#.......#',
    '#.X.....#',
    '#...t...#',
    '#########',
  ],
  minDepth: 2,
};

// ── TREASURE vaults ───────────────────────────────────────────────

const TREASURE_ALTAR: Vault = {
  id: 'treasure-altar',
  tags: ['treasure'],
  map: [
    '#########',
    '#...t...#',
    '#..A.c..#',
    '#.......#',
    '#...X...#',
    '#########',
  ],
};

const TREASURE_CACHE: Vault = {
  id: 'treasure-cache',
  tags: ['treasure'],
  map: [
    '#######',
    '#..T..#',
    '#.c.c.#',
    '#.....#',
    '#######',
  ],
  minDepth: 3,
};

// ── ENCOUNTER vaults (non-combat) ────────────────────────────────

const ENCOUNTER_FOUNTAIN: Vault = {
  id: 'encounter-fountain',
  tags: ['encounter'],
  map: [
    '########',
    '#..T...#',
    '#......#',
    '#..F...#',
    '#......#',
    '#...C..#',
    '########',
  ],
};

const ENCOUNTER_CORPSES: Vault = {
  id: 'encounter-corpses',
  tags: ['encounter'],
  map: [
    '#########',
    '#...t...#',
    '#.C...C.#',
    '#...^...#',
    '#.C...C.#',
    '#########',
  ],
  minDepth: 2,
};

// ── BOSS vaults ───────────────────────────────────────────────────

const BOSS_ANTECHAMBER: Vault = {
  id: 'boss-antechamber',
  tags: ['boss'],
  map: [
    '###########',
    '#....T....#',
    '#.........#',
    '#....B....#',
    '#.........#',
    '#...X.X...#',
    '#....t....#',
    '#....../..#',   // descent in the back-east corner, auto-rotates to wall
    '###########',
  ],
  minDepth: 4,
};

// ── EXIT vaults ───────────────────────────────────────────────────

const EXIT_SIMPLE: Vault = {
  id: 'exit-simple',
  tags: ['exit'],
  // '/' must sit at an INTERIOR cell (not the perimeter column) so
  // the stair top lands inside the shrunk walkable rect. East
  // neighbour is '#' → auto-rotates to descend east into the wall.
  map: [
    '##########',
    '#..T.....#',
    '#........#',
    '#......./#',
    '#........#',
    '##########',
  ],
};

const EXIT_ALCOVE: Vault = {
  id: 'exit-alcove',
  tags: ['exit'],
  // Stair pulled into the room with adjacent south '#' neighbour — descends south.
  map: [
    '############',
    '#....t.....#',
    '#..........#',
    '#..........#',
    '#......../.#',
    '############',
  ],
};

export const VAULTS: Vault[] = [
  FOYER_SMALL, FOYER_PILLAR,
  COMBAT_OPEN, COMBAT_PILLARS, COMBAT_CHOKE,
  TREASURE_ALTAR, TREASURE_CACHE,
  ENCOUNTER_FOUNTAIN, ENCOUNTER_CORPSES,
  BOSS_ANTECHAMBER,
  EXIT_SIMPLE, EXIT_ALCOVE,
];

/** Lookup: list of vaults usable for a given tag at a given depth. */
export function vaultsForTag(tag: string, depth: number): Vault[] {
  return VAULTS.filter((v) =>
    v.tags.includes(tag as VaultTagFilter)
    && (v.minDepth ?? 1) <= depth
    && (v.maxDepth ?? 999) >= depth,
  );
}

type VaultTagFilter = Vault['tags'][number];
