import type { Vault } from './vault';
import { floorGlow } from './../content/light-props';

// Vault library — Pass A (variety) + Pass B (atmosphere).
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
// Each vault may also declare a `props` array of float-coord
// placements (vault-local coordinates, vault centre = (0, 0)) for
// things the 1m grid can't express: rotated fountains, off-grid
// altars, decorative models, atmospheric floor glows, hint triggers.
// The composer translates them to world space when stitching the
// floor.

// Floor-glow models scoped per vault so atmospheric tints stay
// per-room (a warm-tinted treasure room can sit inside a cool act).
const GLOW_WARM   = floorGlow(0xffb070);
const GLOW_AMBER  = floorGlow(0xffa050);
const GLOW_COOL   = floorGlow(0x80aacc);
const GLOW_GREEN  = floorGlow(0x70d090);
const GLOW_BLOOD  = floorGlow(0xff4030);
const GLOW_VIOLET = floorGlow(0xa080ff);
const GLOW_GOLD   = floorGlow(0xffd060);

// ── START vaults ──────────────────────────────────────────────────

const FOYER_SMALL: Vault = {
  id: 'foyer-small',
  tags: ['start'],
  // 'S' centred in the room (was hugging the south edge — player
  // spawned at the door instead of in the middle).
  map: [
    '##########',
    '#..T...T.#',
    '#........#',
    '#...S....#',
    '#........#',
    '#..T...T.#',
    '##########',
  ],
  props: [
    { kind: 'model', model: GLOW_WARM, x: 0, y: 0, z: 0 },
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
    '#....S.....#',
    '#..........#',
    '#.P......P.#',
    '############',
  ],
  props: [
    { kind: 'model', model: GLOW_WARM, x: 0, y: 0, z: 0 },
  ],
};

const FOYER_ALCOVE: Vault = {
  id: 'foyer-alcove',
  tags: ['start'],
  map: [
    '############',
    '#..T....T..#',
    '#..........#',
    '#..C..S..C.#',
    '#..........#',
    '#..T....T..#',
    '############',
  ],
  props: [
    { kind: 'model', model: GLOW_AMBER, x: 0, y: 0, z: 0 },
  ],
};

// ── COMBAT vaults ─────────────────────────────────────────────────

const COMBAT_OPEN: Vault = {
  id: 'combat-open',
  tags: ['combat'],
  map: [
    '############',
    '#..T....T..#',
    '#..........#',
    '#....X.....#',
    '#..........#',
    '#..X....X..#',
    '#..........#',
    '#..T....T..#',
    '############',
  ],
};

const COMBAT_PILLARS: Vault = {
  id: 'combat-pillars',
  tags: ['combat'],
  map: [
    '##############',
    '#....T....T..#',
    '#.P........P.#',
    '#....X.......#',
    '#............#',
    '#.....X......#',
    '#.P........P.#',
    '#....T....T..#',
    '##############',
  ],
  props: [
    { kind: 'model', model: GLOW_VIOLET, x: 0, y: 0, z: 0 },
  ],
};

const COMBAT_CHOKE: Vault = {
  id: 'combat-choke',
  tags: ['combat'],
  map: [
    '##########',
    '#...T....#',
    '#.X....Y.#',
    '#........#',
    '#.X......#',
    '#.X......#',
    '#...t....#',
    '##########',
  ],
  minDepth: 2,
};

const COMBAT_HALL: Vault = {
  id: 'combat-hall',
  tags: ['combat'],
  // Large pillar hall — a real chamber, not just a room. Anchors a
  // floor. Atmospheric setpieces (ritual-circle in the centre,
  // bone-shrines tucked into the corners) come from prop groups.
  map: [
    '################',
    '#..T...T..T..T.#',
    '#..............#',
    '#.P..P..P..P.P.#',
    '#..............#',
    '#....X....X....#',
    '#..............#',
    '#.P..P.B..P..P.#',
    '#..............#',
    '#....X....X....#',
    '#..............#',
    '#.P..P..P..P.P.#',
    '#..............#',
    '#..T...T..T..T.#',
    '################',
  ],
  minDepth: 3,
  weight: 2,
  props: [
    { kind: 'group', groupId: 'ritual-circle', x: 0, z: 0 },
    { kind: 'group', groupId: 'bone-shrine',   x: -5, z: -5 },
    { kind: 'group', groupId: 'bone-shrine',   x:  5, z:  5 },
    { kind: 'model', model: GLOW_VIOLET, x: -3, y: 0, z: -2 },
    { kind: 'model', model: GLOW_VIOLET, x:  3, y: 0, z:  2 },
  ],
};

const COMBAT_ARENA: Vault = {
  id: 'combat-arena',
  tags: ['combat'],
  // Open chamber, ritual feel: altar in the centre with X mobs
  // around it. Blood-red floor tint sets the tone.
  map: [
    '##############',
    '#....T....T..#',
    '#............#',
    '#....X.......#',
    '#............#',
    '#.....A......#',
    '#............#',
    '#.X........X.#',
    '#............#',
    '#............#',
    '#....t....t..#',
    '##############',
  ],
  minDepth: 2,
  weight: 1,
  props: [
    { kind: 'model', model: GLOW_BLOOD, x: 0, y: 0, z: 0 },
  ],
};

const COMBAT_DOORS: Vault = {
  id: 'combat-doors',
  tags: ['combat'],
  // Room-clear gating — sealed doors open when the room's enemies
  // die. Player walks in, the doors lock behind, fight, escape.
  map: [
    '############',
    '#....T.....#',
    'O..........O',
    '#..X....X..#',
    '#..........#',
    '#....B.....#',
    '#..........#',
    '#..X....X..#',
    'O..........O',
    '#....t.....#',
    '############',
  ],
  minDepth: 4,
};

// ── TREASURE vaults ───────────────────────────────────────────────

const TREASURE_ALTAR: Vault = {
  id: 'treasure-altar',
  tags: ['treasure'],
  map: [
    '##########',
    '#...t....#',
    '#..A.c...#',
    '#........#',
    '#...X....#',
    '##########',
  ],
  props: [
    { kind: 'model', model: GLOW_GOLD, x: 0, y: 0, z: 0 },
  ],
};

const TREASURE_CACHE: Vault = {
  id: 'treasure-cache',
  tags: ['treasure'],
  map: [
    '########',
    '#..T...#',
    '#.c..c.#',
    '#......#',
    '#......#',
    '#..c...#',
    '########',
  ],
  minDepth: 3,
  props: [
    { kind: 'model', model: GLOW_GOLD, x: 0, y: 0, z: 0 },
  ],
};

const TREASURE_VAULT: Vault = {
  id: 'treasure-vault',
  tags: ['treasure'],
  // Big chamber with one centrepiece chest-cache group + a ritual
  // altar in the middle. Tile-placed chests in the ASCII give the
  // baseline; the chest-cache group adds candles + a fallen guard.
  map: [
    '############',
    '#...T....T.#',
    '#.P......P.#',
    '#...c....c.#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#...c....c.#',
    '#.P......P.#',
    '#...t....t.#',
    '############',
  ],
  minDepth: 5,
  weight: 1,
  props: [
    { kind: 'group', groupId: 'altar-ritual', x: 0, z: 0 },
    { kind: 'model', model: GLOW_GOLD, x: 0, y: 0, z: 0 },
  ],
};

// ── ENCOUNTER vaults (non-combat) ────────────────────────────────

const ENCOUNTER_FOUNTAIN: Vault = {
  id: 'encounter-fountain',
  tags: ['encounter'],
  // Fountain in the centre with its shrine group (flanking candles +
  // bone glow). The tile-based 'F' inside the room is replaced by
  // the group's float-positioned fountain so we can rotate it.
  map: [
    '##########',
    '#..T.....#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#..t.....#',
    '##########',
  ],
  props: [
    { kind: 'group', groupId: 'fountain-shrine', x: 0, z: 0 },
    { kind: 'model', model: GLOW_COOL, x: 0, y: 0, z: 0 },
  ],
};

const ENCOUNTER_CORPSES: Vault = {
  id: 'encounter-corpses',
  tags: ['encounter'],
  map: [
    '##########',
    '#...t....#',
    '#.C....C.#',
    '#...^....#',
    '#.C....C.#',
    '#..T.....#',
    '##########',
  ],
  minDepth: 2,
  props: [
    { kind: 'model', model: GLOW_GREEN, x: 0, y: 0, z: 0 },
  ],
};

const ENCOUNTER_RITUAL: Vault = {
  id: 'encounter-ritual',
  tags: ['encounter'],
  // Altar with the ritual-circle group dropped on it (altar + skull
  // + 4 candles + bone glow). Empty floor around — non-combat.
  map: [
    '############',
    '#...T...T..#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#...^......#',
    '############',
  ],
  minDepth: 3,
  weight: 1,
  props: [
    { kind: 'group', groupId: 'ritual-circle', x: 0, z: 0 },
    { kind: 'model', model: GLOW_GREEN, x: 0, y: 0, z: 0 },
  ],
};

// ── BOSS vaults ───────────────────────────────────────────────────

const BOSS_ANTECHAMBER: Vault = {
  id: 'boss-antechamber',
  tags: ['boss'],
  // '/' MUST be at an interior cell. Previously sat at the perimeter
  // column → stair top landed outside the shrunk rect → invisible.
  // Now at col 11 (interior) with col 12 = '#' to trigger east
  // auto-rotation; descent goes east into the back wall.
  map: [
    '#############',
    '#....T..T...#',
    '#...........#',
    '#.....B.....#',
    '#...........#',
    '#...X...X...#',
    '#..........##',
    '#........../#',
    '#############',
  ],
  minDepth: 3,
  props: [
    { kind: 'model', model: GLOW_BLOOD, x: 0, y: 0, z: 0 },
  ],
};

const BOSS_CATHEDRAL: Vault = {
  id: 'boss-cathedral',
  tags: ['boss'],
  // Pillared cathedral — the boss stands at the back. Stair sits
  // INSIDE the row (col 14, with col 15 = '#') so auto-rotation
  // descends east into the back wall, and the stair top stays
  // inside the shrunk walkable rect.
  map: [
    '################',
    '#....T....T....#',
    '#..............#',
    '#.P..........P.#',
    '#..............#',
    '#......B.......#',
    '#..............#',
    '#.P....X....P..#',
    '#..............#',
    '#.P..........P.#',
    '#..............#',
    '#....X....X....#',
    '#............/#',
    '#....t....t....#',
    '################',
  ],
  minDepth: 7,
  weight: 1,
  props: [
    { kind: 'model', model: GLOW_BLOOD, x: 0, y: 0, z: -2 },
    { kind: 'model', model: GLOW_VIOLET, x: 0, y: 0, z: 2 },
  ],
};

// ── EXIT vaults ───────────────────────────────────────────────────

const EXIT_SIMPLE: Vault = {
  id: 'exit-simple',
  tags: ['exit'],
  // '/' is INSIDE the walkable interior with an adjacent '#'
  // neighbour, so auto-rotation lands the descent against the wall.
  map: [
    '##########',
    '#..T.....#',
    '#........#',
    '#......./#',
    '#........#',
    '##########',
  ],
  props: [
    { kind: 'model', model: GLOW_COOL, x: 0, y: 0, z: 0 },
  ],
};

const EXIT_ALCOVE: Vault = {
  id: 'exit-alcove',
  tags: ['exit'],
  map: [
    '############',
    '#....t.....#',
    '#..........#',
    '#..........#',
    '#......../.#',
    '############',
  ],
  props: [
    { kind: 'model', model: GLOW_COOL, x: 0, y: 0, z: 0.5 },
  ],
};

const EXIT_GRAND: Vault = {
  id: 'exit-grand',
  tags: ['exit'],
  // Larger exit hall — moonbeam descent reads cinematic. '/' on the
  // last interior row so south neighbour = '#' = auto-rotation south.
  // Stair descends into the back wall behind the colonnade.
  map: [
    '##############',
    '#....T....T..#',
    '#.P........P.#',
    '#............#',
    '#............#',
    '#.P........P.#',
    '#......./....#',
    '#....t....t..#',
    '##############',
  ],
  minDepth: 3,
  props: [
    { kind: 'model', model: GLOW_COOL, x: 0, y: 0, z: 2 },
  ],
};

export const VAULTS: Vault[] = [
  FOYER_SMALL, FOYER_PILLAR, FOYER_ALCOVE,
  COMBAT_OPEN, COMBAT_PILLARS, COMBAT_CHOKE, COMBAT_HALL, COMBAT_ARENA, COMBAT_DOORS,
  TREASURE_ALTAR, TREASURE_CACHE, TREASURE_VAULT,
  ENCOUNTER_FOUNTAIN, ENCOUNTER_CORPSES, ENCOUNTER_RITUAL,
  BOSS_ANTECHAMBER, BOSS_CATHEDRAL,
  EXIT_SIMPLE, EXIT_ALCOVE, EXIT_GRAND,
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
