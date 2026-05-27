import type { Vault } from './vault';
import { BONFIRE } from '../content/bonfire';

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

// Per-vault torch tint constants. The room's MOOD comes from
// these now, not from a floor-glow spotlight: a treasure chamber
// burns warm gold even in the cool Cistern act; a ritual cell
// burns deep red; an antechamber stays pale and watchful.
const TORCH_WARM   = 0xffb070;
const TORCH_AMBER  = 0xffa050;
const TORCH_PALE   = 0xa8c0d8;
const TORCH_GREEN  = 0x70d090;
const TORCH_BLOOD  = 0xff5040;
const TORCH_VIOLET = 0xa080ff;
const TORCH_GOLD   = 0xffd060;

// floorGlow is retained for prop-group internals (the soft accent
// glow at the foot of an altar etc) — see prop-groups.ts. Vault
// entries themselves no longer drop a glow per chamber; they set
// `torchTint` instead so the wall torches do the colouring.

// ── START vaults ──────────────────────────────────────────────────

const FOYER_SMALL: Vault = {
  id: 'foyer-small',
  tags: ['start'],
  // 'S' centred in the room (was hugging the south edge — player
  // spawned at the door instead of in the middle). Bonfire sits
  // ~1.2m east of the spawn so the player sees its warm light
  // on their right side as they appear.
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
    { kind: 'model', model: BONFIRE, x: 0.8, y: 0, z: 0 },
  ],
  // Bonfire is the warm anchor — no extra glow needed.
  torchTint: TORCH_WARM,
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
    // Centred between the back pillars — bonfire as the room's
    // visual anchor; spawn is two cells to its west.
    { kind: 'model', model: BONFIRE, x: 1.5, y: 0, z: 0.5 },
  ],
  torchTint: TORCH_WARM,
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
    // Tucked between the two corpses, north of the spawn — the
    // player appears facing south and sees the bonfire glow off
    // to their right rear.
    { kind: 'model', model: BONFIRE, x: 1.5, y: 0, z: -0.5 },
  ],
  torchTint: TORCH_AMBER,
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
  torchTint: TORCH_VIOLET,
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
  ],
  // Ritual-circle group already has its own focal glow + the
  // bone-shrines colour the corners. Wall torches push violet.
  torchTint: TORCH_VIOLET,
};

const COMBAT_ARENA: Vault = {
  id: 'combat-arena',
  tags: ['combat'],
  // Open chamber, ritual feel: altar in the centre with X mobs
  // around it. Blood-red wall torches set the tone — no spotlight.
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
  torchTint: TORCH_BLOOD,
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
  torchTint: TORCH_GOLD,
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
  torchTint: TORCH_GOLD,
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
  ],
  torchTint: TORCH_GOLD,
};

// ── ENCOUNTER vaults (non-combat) ────────────────────────────────

const ENCOUNTER_FOUNTAIN: Vault = {
  id: 'encounter-fountain',
  tags: ['encounter'],
  // Fountain in the centre with its shrine group (flanking candles +
  // bone glow). The group's own glow + candles set the focal mood;
  // wall torches push pale-cyan to match the basin.
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
  ],
  torchTint: TORCH_PALE,
};

const ENCOUNTER_CORPSES: Vault = {
  id: 'encounter-corpses',
  tags: ['encounter'],
  // Asymmetric corpse arrangement — the four-corners + trap-in-
  // middle pattern read as boilerplate. This is "they died trying
  // to reach the door, one fell hard against the wall, one near
  // the trap." Authored to look LIVED IN.
  map: [
    '############',
    '#...T......#',
    '#.C........#',
    '#.....C....#',
    '#..........#',
    '#...^......#',
    '#........C.#',
    '#.....t....#',
    '############',
  ],
  minDepth: 2,
  torchTint: TORCH_GREEN,
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
  torchTint: TORCH_GREEN,
  props: [
    { kind: 'group', groupId: 'ritual-circle', x: 0, z: 0 },
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
  torchTint: TORCH_BLOOD,
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
  torchTint: TORCH_BLOOD,
};

// ── EXIT vaults ───────────────────────────────────────────────────

const EXIT_SIMPLE: Vault = {
  id: 'exit-simple',
  tags: ['exit'],
  // '/' is INSIDE the walkable interior with an adjacent '#'
  // neighbour, so auto-rotation lands the descent against the wall.
  // The stair's own moonbeam + outline does the colour-anchor work.
  map: [
    '##########',
    '#..T.....#',
    '#........#',
    '#......./#',
    '#........#',
    '##########',
  ],
  torchTint: TORCH_PALE,
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
  torchTint: TORCH_PALE,
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
  torchTint: TORCH_PALE,
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
