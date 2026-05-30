import type { Vault } from './vault';
import { BONFIRE } from '../content/bonfire';
import { godRay } from '../content/god-ray';
import { COBWEB_CORNER } from '../content/cobweb';

// God-ray instances scoped per vault — used VERY sparingly (a few
// signature chambers, not every room). Same visual family as the
// stair moonbeam but in the room itself.
const RAY_PALE   = godRay({ tint: 0xb8c8ff });
const RAY_GOLD   = godRay({ tint: 0xffd060 });
const RAY_VIOLET = godRay({ tint: 0xa080ff });

// Vault library — Pass A (variety) + Pass B (atmosphere).
//
// Tile dictionary (canonical list in src/level/tilemap.ts):
//   #  wall      .  floor    S  player spawn   /  stairs DOWN
//   o  door      O  sealed door (clear to open)   D  arena door (slams on enter)
//   P  pillar    A  altar    c  chest          C  corpse
//   F  fountain  ^  spike trap
//   T  torch N   t  torch S  <  torch W       >  torch E
//   G  ghoul     R  rat      K  skirmisher    W  wraith   Y  acolyte
//   M  stoneguard (slow armoured tank)
//   Z  ooze (splits in two on death)
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
  // 'S' centred in the room. Bonfire sits ~1.2m east of the spawn
  // so the player sees its warm light on their right side as they
  // appear. Torches scarcer + asymmetric — one torch each end,
  // diagonally opposed; the bonfire carries the rest of the warmth.
  map: [
    '##########',
    '#..T.....#',
    '#........#',
    '#...S....#',
    '#........#',
    '#.....T..#',
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
  // Cut to 2 torches diagonally so the alcove has a moodier
  // light gradient rather than four symmetric pools.
  map: [
    '############',
    '#..T.......#',
    '#..........#',
    '#..C..S..C.#',
    '#..........#',
    '#.......T..#',
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
  // Torches scarcer + asymmetric — one corner each row, opposite
  // sides. Lit hotspots near two edges; the middle stays darker
  // so dark-adapt has somewhere to engage.
  map: [
    '############',
    '#..T.......#',
    '#v........v#',
    '#....X.....#',
    '#..........#',
    '#..X....X..#',
    '#.........v#',
    '#.......T..#',
    '############',
  ],
};

const COMBAT_PILLARS: Vault = {
  id: 'combat-pillars',
  tags: ['combat'],
  // Two torches diagonally opposite instead of four in pairs —
  // most of the room past the pillars stays dim.
  map: [
    '##############',
    '#....T.......#',
    '#.P........P.#',
    '#....X.......#',
    '#............#',
    '#.....X......#',
    '#.P........P.#',
    '#.........T..#',
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
  //
  // Torch pass: cut from 8 → 4 and staggered diagonally so the
  // hall has clear lit hotspots near a couple of pillars + large
  // dim middle. Dark-adapt has room to engage in the middle
  // colonnade.
  map: [
    '################',
    '#..T..........T#',
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
    '#T..........T..#',
    '################',
  ],
  minDepth: 3,
  weight: 2,
  props: [
    { kind: 'group', groupId: 'ritual-circle', x: 0, z: 0 },
    { kind: 'group', groupId: 'bone-shrine',   x: -5, z: -5 },
    { kind: 'group', groupId: 'bone-shrine',   x:  5, z:  5 },
    // One violet god ray off to the side of the central ritual,
    // so the player can walk through the beam on their approach.
    { kind: 'model', model: RAY_VIOLET, x: -4, y: 0, z: 3, rotY: 0.4 },
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
  // Altar as the room CENTERPIECE; chests tucked against the
  // side walls where treasure caches go. Chest + altar side-by-
  // side in the middle of a room read as "two centerpieces" —
  // neither wins the eye. Authored rule going forward:
  //   - altars / fountains: centre of the room
  //   - chests: against a side wall (or as the LONE centerpiece
  //     in non-altar rooms)
  map: [
    '##########',
    '#...t....#',
    '#........#',
    '#...A....#',
    '#........#',
    '#c......c#',
    '#...X....#',
    '##########',
  ],
  torchTint: TORCH_GOLD,
};

const TREASURE_CACHE: Vault = {
  id: 'treasure-cache',
  tags: ['treasure'],
  // A pair of vases tucked among the chests — small loot tease,
  // breakable for coins.
  map: [
    '########',
    '#..T...#',
    '#.c..c.#',
    '#.v..v.#',
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
    // Warm gold shaft falling on the centre — the treasure
    // signature beat. Offset slightly so it lands beside the
    // altar group rather than overlapping it.
    { kind: 'model', model: RAY_GOLD, x: 2.5, y: 0, z: 0, rotY: -0.3 },
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

// Pillared inner chamber framing a single wraith + chest. The four
// pillars read as "the thing was contained here" — they don't actually
// block the player, but they enclose the eye on the centerpiece.
// Player has to commit to the fight to claim the chest behind the
// guardian.
const ENCOUNTER_PRISON: Vault = {
  id: 'encounter-prison',
  tags: ['encounter'],
  map: [
    '############',
    '#....T.....#',
    '#.P......P.#',
    '#..........#',
    '#..W.....c.#',
    '#..........#',
    '#.P......P.#',
    '#....t.....#',
    '############',
  ],
  minDepth: 2,   // wraith is a real threat — keep off depth 1
  weight: 1,
  torchTint: TORCH_BLOOD,
};

// Arena encounter — the lock-on-enter test. The 'D' door starts
// visibly open at the corridor mouth; the moment the player crosses
// into the vault it slams shut and a quartet of mobs becomes the
// problem. Door reopens on room-clear so the spine progression isn't
// permanently broken if the player somehow can't finish (e.g. only
// option is to die + restart). Inner chest as the carrot for taking
// the fight.
const ENCOUNTER_ARENA: Vault = {
  id: 'encounter-arena',
  tags: ['encounter'],
  // Layout: an entry alcove at the top, an interior wall row with a
  // single 'D' arena door, and the arena proper below holding two
  // pairs of ghouls and an iron chest centrepiece. Multi-room vault
  // parsing splits the alcove and arena into separate sub-rooms; the
  // 'D' door's cross-axis trigger fires the slam when the player
  // walks through it — not on vault entry. The arena sub-room's
  // clear count re-opens the door so the player can continue south.
  //
  // The chest is declared as a PROP (not a 'c' tile) so we can ask
  // for the iron tier — the arena reward should LOOK like more than
  // a roadside supply box.
  map: [
    '##############',
    '#....T....T..#',
    '#............#',
    '#............#',
    '######D#######',
    '#.G........G.#',
    '#............#',
    '#............#',
    '#............#',
    '#.G........G.#',
    '#....t....t..#',
    '##############',
  ],
  minDepth: 3,
  weight: 1,
  torchTint: TORCH_BLOOD,
  props: [
    { kind: 'chest', x: 0, z: 1.5, tier: 'iron', facing: { kind: 'wall-away' } },
  ],
};

// Blood altar encounter. A single cursed offering (ring of marrow)
// floats over a basin in the centre of the chamber. Walking into the
// glow does nothing; TAKE costs 4 HP and erupts in blood — the item
// is yours, the stone block stays as a marker. Real gamble: at low
// HP this kills you outright. Two flanking candles + cool side
// torches frame the basin in violet glow from the offering itself.
const ENCOUNTER_BLOOD_ALTAR: Vault = {
  id: 'encounter-blood-altar',
  tags: ['encounter'],
  map: [
    '############',
    '#....T.....#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#....t.....#',
    '############',
  ],
  minDepth: 2,
  weight: 1,
  torchTint: TORCH_BLOOD,
  props: [
    { kind: 'blood-altar', x: 0, z: 0, rotY: 0, itemId: 'ring-of-marrow' },
    // Diegetic hint placed where the player approaches from the south
    // entry corridor. Voice matches the rest of the tutorial-style
    // marginalia: terse, lowercase, world-spoken.
    {
      kind: 'hint',
      x: 0, z: 2.0,
      text: 'the price is in marrow.',
      triggerRadius: 2.8,
      lingerMs: 5000,
    },
  ],
};

// Spike-trap puzzle. Chest in the centre with four spike traps in the
// corners — the loot is visible but reaching it on a careless approach
// hurts. Non-combat encounter that changes the playstyle from "fight
// or skip" to "look where you're stepping."
const ENCOUNTER_TRAPPED: Vault = {
  id: 'encounter-trapped',
  tags: ['encounter'],
  map: [
    '##########',
    '#...T....#',
    '#^......^#',
    '#........#',
    '#...c....#',
    '#........#',
    '#^......^#',
    '#...t....#',
    '##########',
  ],
  weight: 1,
  torchTint: TORCH_GREEN,
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
    '#...........#',
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
    '#............./#',
    '#....t....t....#',
    '################',
  ],
  minDepth: 7,
  weight: 1,
  torchTint: TORCH_BLOOD,
  props: [
    // Two converging god rays — pale moonlight from one
    // direction, violet from another — light hitting the boss
    // through cathedral cracks. Sets the cathedral feel.
    { kind: 'model', model: RAY_PALE,   x: -3.5, y: 0, z: 1, rotY: 0.5 },
    { kind: 'model', model: RAY_VIOLET, x:  3.5, y: 0, z: 3, rotY: -0.5 },
  ],
};

// Spider nest — a web-gated combat set-piece. The only way in is a
// destructible cobweb curtain ('%') plugging the choke; slash through
// it into a sickly-green chamber thick with webs, a skeleton, and four
// spiders that pounce from the corners. Loot ('c') waits past the
// swarm. Ties the cobweb + spider + skeleton work into one room where
// they reinforce each other.
const ENCOUNTER_NEST: Vault = {
  id: 'encounter-nest',
  tags: ['combat'],
  map: [
    '##############',
    '#.....T......#',
    '#............#',
    '######%#######',   // cobweb gate — cut it to enter the nest
    '#..N......N..#',
    '#............#',
    '#.....L......#',
    '#..N......N..#',
    '#.....c......#',
    '#.....t......#',
    '##############',
  ],
  minDepth: 4,
  weight: 1,
  torchTint: TORCH_GREEN,
  // Guaranteed corner webs so the nest reads webbed (clutter's ambient
  // webs are sparse). Vault-local coords: centre = (0,0). Slung high
  // into the four chamber corners, hubs facing inward.
  props: [
    { kind: 'model', model: COBWEB_CORNER, x: -5.5, y: 2.2, z: -1, rotY:  Math.PI * 0.25 },
    { kind: 'model', model: COBWEB_CORNER, x:  5.5, y: 2.2, z: -1, rotY:  Math.PI * 0.75 },
    { kind: 'model', model: COBWEB_CORNER, x: -5.5, y: 2.2, z:  4, rotY: -Math.PI * 0.25 },
    { kind: 'model', model: COBWEB_CORNER, x:  5.5, y: 2.2, z:  4, rotY: -Math.PI * 0.75 },
  ],
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
  ENCOUNTER_NEST,
  TREASURE_ALTAR, TREASURE_CACHE, TREASURE_VAULT,
  ENCOUNTER_FOUNTAIN, ENCOUNTER_CORPSES, ENCOUNTER_RITUAL,
  ENCOUNTER_PRISON, ENCOUNTER_TRAPPED, ENCOUNTER_BLOOD_ALTAR,
  ENCOUNTER_ARENA,
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
