import type { Vault } from './vault';
import { godRay } from '../content/god-ray';
import { COBWEB_CORNER } from '../content/cobweb';
import { GREAT_BRAZIER } from '../content/light-props';

// God-ray instances scoped per vault — used VERY sparingly (a few
// signature chambers, not every room). Same visual family as the
// stair moonbeam but in the room itself.
const RAY_PALE   = godRay({ tint: 0xb8c8ff });
const RAY_GOLD   = godRay({ tint: 0xffd060 });
const RAY_VIOLET = godRay({ tint: 0xa080ff });

// Vault library — Pass A (variety) + Pass B (atmosphere).
//
// Tile dictionary (canonical list in src/level/tilemap.ts) — ASCII
// now holds STRUCTURE + SLOTS only. Everything else (decor, specific
// mobs, sophisticated torches) lives in vault.cellProps + the rare
// absolute-coord vault.props.
//
//   #  wall          .  floor          ,  corridor floor
//   S  player spawn  /  stairs DOWN
//   o  door          O  sealed door (clears with room)
//   D  arena door (slams on enter)
//   X  ROLLED ENEMY  (procgen picks from depth/encounter pack)
//   B  BOSS SLOT     (resolves to the act's bossId)
//   $  OPTIONAL LOOT (rolls chest-or-empty per slot)
//   ?  RANDOM EVENT  (trap / fountain / altar / nothing)
//   ^  spike trap    (hazard placed deterministically)
//   *  LIGHT         (wall torch on nearest wall, auto-detected)
//   %  cobweb gate   (destructible; coalesced into a curtain)
//
// Per-cell content (decor, hand-placed mobs, etc.) goes here:
//
//   cellProps: {
//     '3,2': [{ kind: 'pillar' }, { kind: 'torch', wall: 'N' }],
//     '5,3': [{ kind: 'spawn', enemyId: 'boiling-king' }],
//     '6,4': [{ kind: 'loot-anchor', prominence: 'minor' }],                  // depth-rolled tier
//     '7,5': [{ kind: 'loot-anchor', prominence: 'major' }],    // forced tier
//     '8,1': [{ kind: 'pillar', offset: [0.2, 0] }],  // sub-cell nudge
//   },
//
// For things that don't bind to one cell — sub-cell sconces, props
// between cells — use the absolute-coord vault.props / vault.torches
// arrays.

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
    '#..*.....#',
    '#........#',
    '#...S....#',
    '#........#',
    '#.....*..#',
    '##########',
  ],
  // No baked fire — the content director owns fires now (a fire is a FOUND
  // event placed deeper in the floor, never furniture at the entrance). The
  // run-start chamber keeps its wake-fire; procgen start rooms stay cold.
  torchTint: TORCH_WARM,
};

const FOYER_PILLAR: Vault = {
  id: 'foyer-pillar',
  tags: ['start'],
  map: [
    '############',
    '#....*.....#',
    '#..........#',
    '#..........#',
    '#....S.....#',
    '#..........#',
    '#..........#',
    '############',
  ],
  // No baked fire (director owns fires — see FOYER_SMALL).
  torchTint: TORCH_WARM,
  cellProps: {
    '2,2': [{ kind: 'pillar' }],
    '9,2': [{ kind: 'pillar' }],
    '2,6': [{ kind: 'pillar' }],
    '9,6': [{ kind: 'pillar' }],
  },
};

const FOYER_ALCOVE: Vault = {
  id: 'foyer-alcove',
  tags: ['start'],
  // Cut to 2 torches diagonally so the alcove has a moodier
  // light gradient rather than four symmetric pools.
  map: [
    '############',
    '#..*.......#',
    '#..........#',
    '#.....S....#',
    '#..........#',
    '#.......*..#',
    '############',
  ],
  // No baked fire (director owns fires — see FOYER_SMALL).
  torchTint: TORCH_AMBER,
  cellProps: {
    '3,3': [{ kind: 'loot-anchor', prominence: 'minor' }],
    '9,3': [{ kind: 'loot-anchor', prominence: 'minor' }],
  },
};

// ── COMBAT vaults ─────────────────────────────────────────────────

const COMBAT_OPEN: Vault = {
  id: 'combat-open',
  tags: ['combat'],
  lightTier: 'dim',
  // Torches scarcer + asymmetric — one corner each row, opposite
  // sides. Lit hotspots near two edges; the middle stays darker
  // so dark-adapt has somewhere to engage.
  map: [
    '############',
    '#..*.......#',
    '#..........#',
    '#....X.....#',
    '#....$.....#',
    '#..X....X..#',
    '#..........#',
    '#.......*..#',
    '############',
  ],
  // $ = optional loot for clearing — sometimes a chest, sometimes nothing.
  cellProps: {
    '1,2': [{ kind: 'vase' }],
    '10,2': [{ kind: 'vase' }],
    '10,6': [{ kind: 'vase' }],
  },
  // A fire reads well in the quiet back-left corner — the director places one
  // here when this floor rolls a fire (else it stays a plain combat room).
  anchors: [{ kind: 'fire', col: 2, row: 6 }],
};

const COMBAT_PILLARS: Vault = {
  id: 'combat-pillars',
  tags: ['combat'],
  // Casters use the pillars as cover — close the gap or get pelted.
  encounter: { archetype: 'caster-pack', intensity: 'medium' },
  // Two torches diagonally opposite instead of four in pairs —
  // most of the room past the pillars stays dim.
  map: [
    '##############',
    '#....*.......#',
    '#............#',
    '#....X.......#',
    '#............#',
    '#.....X......#',
    '#............#',
    '#.........*..#',
    '##############',
  ],
  torchTint: TORCH_VIOLET,
  cellProps: {
    '2,2': [{ kind: 'pillar' }],
    '11,2': [{ kind: 'pillar' }],
    '2,6': [{ kind: 'pillar' }],
    '11,6': [{ kind: 'pillar' }],
  },
  // Fire spot between the back pillars — a natural rest nook once cleared.
  // Focal content marker back-right: the FILL stage may stage the floor's
  // defining find here (guarded treasure — fight, then the reward).
  anchors: [
    { kind: 'fire', col: 6, row: 6 },
    { kind: 'spot', col: 10, row: 5, focal: true },
  ],
};

const COMBAT_CHOKE: Vault = {
  id: 'combat-choke',
  tags: ['combat'],
  // Map is 10 cols × 8 rows → vault-local x ∈ [-5, +5], z ∈ [-4, +4].
  map: [
    '##########',
    '#...*....#',
    '#.X......#',
    '#........#',
    '#.X......#',
    '#.X......#',
    '#...*....#',
    '##########',
  ],
  lightTier: 'dim',
  minDepth: 2,
  cellProps: {
    // The acolyte that anchored this room.
    '7,2': [{ kind: 'spawn', enemyId: 'acolyte' }],
  },
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
    '#..*..........*#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#....X....X....#',
    '#..............#',
    '#......X.......#',
    '#..............#',
    '#....X....X....#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#*..........*..#',
    '################',
  ],
  minDepth: 3,
  weight: 2,
  props: [
    { kind: 'group', groupId: 'ritual-circle', x: 0, z: 0 },
    { kind: 'group', groupId: 'bone-shrine',   x: -5, z: -5 },
    { kind: 'group', groupId: 'bone-shrine',   x:  5, z:  5 },
    // Violet god ray landing ON the central ritual altar — just
    // outside the front-right candle so the shaft falls on the altar
    // + skull, not on empty floor. Crossing the beam = arriving at
    // the ritual (Lighting-as-signal: anchor the beam, don't decorate).
    { kind: 'model', model: RAY_VIOLET, x: 1.4, y: 0, z: 0.5, rotY: 0.4 },
  ],
  // Ritual-circle group already has its own focal glow + the
  // bone-shrines colour the corners. Wall torches push violet.
  torchTint: TORCH_VIOLET,
  // PROTOTYPE: a coherent bruiser pack fills the X slots around the boss —
  // a slow armoured grind in the big hall, not a random grab-bag.
  encounter: { archetype: 'bruisers', intensity: 'medium' },
  cellProps: {
    '2,3': [{ kind: 'pillar' }],
    '5,3': [{ kind: 'pillar' }],
    '8,3': [{ kind: 'pillar' }],
    '11,3': [{ kind: 'pillar' }],
    '13,3': [{ kind: 'pillar' }],
    '2,7': [{ kind: 'pillar' }],
    '5,7': [{ kind: 'pillar' }],
    '10,7': [{ kind: 'pillar' }],
    '13,7': [{ kind: 'pillar' }],
    '2,11': [{ kind: 'pillar' }],
    '5,11': [{ kind: 'pillar' }],
    '8,11': [{ kind: 'pillar' }],
    '11,11': [{ kind: 'pillar' }],
    '13,11': [{ kind: 'pillar' }],
  },
};

const COMBAT_ARENA: Vault = {
  id: 'combat-arena',
  tags: ['combat'],
  // Open chamber, ritual feel: altar in the centre with X mobs
  // around it. Blood-red wall torches set the tone — no spotlight.
  map: [
    '##############',
    '#....*....*..#',
    '#............#',
    '#....X.......#',
    '#............#',
    '#............#',
    '#............#',
    '#.X........X.#',
    '#.....?......#',
    '#............#',
    '#....*....*..#',
    '##############',
  ],
  minDepth: 2,
  weight: 1,
  torchTint: TORCH_BLOOD,
  cellProps: {
  },
};

const COMBAT_DOORS: Vault = {
  id: 'combat-doors',
  tags: ['combat'],
  // Sealed room-clear gauntlet — a swarm that floods you once the doors lock.
  encounter: { archetype: 'swarm', intensity: 'medium' },
  // Trap-arena gating — doors START OPEN, SLAM shut the moment you cross
  // in, then reopen when the room's enemies die. This is the 'D' tile
  // (gate-arena): walk in, the doors lock BEHIND you, fight, escape.
  // (Was 'O' = gate-cleared, which seals from the START — leaving all four
  // doors locked on arrival around a room full of enemies you could never
  // reach to clear: a permanent soft-lock on the spine. The comment always
  // described the trap; the tile was wrong.)
  map: [
    '############',
    '#....*.....#',
    'D..........D',
    '#..X....X..#',
    '#..........#',
    '#....X.....#',
    '#..........#',
    '#..X....X..#',
    'D..........D',
    '#....*.....#',
    '############',
  ],
  lightTier: 'dim',
  minDepth: 4,
};

// ── TREASURE vaults ───────────────────────────────────────────────

const TREASURE_ALTAR: Vault = {
  id: 'treasure-altar',
  tags: ['treasure'],
  // A lone guardian over the hoard, not a random mob.
  encounter: { archetype: 'bruisers', intensity: 'light' },
  // Altar as the room CENTERPIECE; chests tucked against the
  // side walls where treasure caches go. Chest + altar side-by-
  // side in the middle of a room read as "two centerpieces" —
  // neither wins the eye. Authored rule going forward:
  //   - altars / fountains: centre of the room
  //   - chests: against a side wall (or as the LONE centerpiece
  //     in non-altar rooms)
  map: [
    '##########',
    '#...*....#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#...X....#',
    '##########',
  ],
  torchTint: TORCH_GOLD,
  cellProps: {
    '1,5': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '8,5': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
  },
};

const TREASURE_CACHE: Vault = {
  id: 'treasure-cache',
  tags: ['treasure'],
  // A pair of vases tucked among the chests — small loot tease,
  // breakable for coins.
  map: [
    '########',
    '#..*...#',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '########',
  ],
  minDepth: 3,
  torchTint: TORCH_GOLD,
  cellProps: {
    '2,2': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '5,2': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '2,3': [{ kind: 'vase' }],
    '5,3': [{ kind: 'vase' }],
    '3,5': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
  },
  // Focal content marker at the cache's heart — the FILL stage stages the
  // floor's defining find here (varies each run), amid the baked cache chests.
  anchors: [{ kind: 'spot', col: 3, row: 3, focal: true }],
};

const TREASURE_VAULT: Vault = {
  id: 'treasure-vault',
  tags: ['treasure'],
  // Big chamber with one centrepiece chest-cache group + a ritual
  // altar in the middle. Tile-placed chests in the ASCII give the
  // baseline; the chest-cache group adds candles + a fallen guard.
  map: [
    '############',
    '#...*....*.#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#...*....*.#',
    '############',
  ],
  minDepth: 5,
  weight: 1,
  props: [
    { kind: 'group', groupId: 'altar-ritual', x: 0, z: 0 },
    // Warm gold shaft landing ON the treasure altar — the signature
    // beat. Just off the altar's side (clear of the flanking candles
    // + the corpse at the foot) so the shaft falls on the altar
    // itself, not several metres into open floor.
    { kind: 'model', model: RAY_GOLD, x: 1.4, y: 0, z: 0, rotY: -0.3 },
  ],
  torchTint: TORCH_GOLD,
  cellProps: {
    '2,2': [{ kind: 'pillar' }],
    '9,2': [{ kind: 'pillar' }],
    '4,3': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '9,3': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '4,7': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '9,7': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '2,8': [{ kind: 'pillar' }],
    '9,8': [{ kind: 'pillar' }],
  },
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
    '#..*.....#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#..*.....#',
    '##########',
  ],
  props: [
    { kind: 'group', groupId: 'fountain-shrine', x: 0, z: 0 },
  ],
  torchTint: TORCH_PALE,
};

const ENCOUNTER_TITHE: Vault = {
  id: 'encounter-tithe',
  tags: ['encounter'],
  // The tithe basin alone in a narrow chamber — UNKNOWN family
  // (transactions.ts): pale light over a dry hollow, nothing else.
  // The emptiness is deliberate: a room that holds only a question.
  map: [
    '########',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '#*....*#',
    '########',
  ],
  lightTier: 'dim',
  minDepth: 2,
  weight: 1,
  props: [
    { kind: 'tithe-basin', x: 0, z: -0.5 },
  ],
  torchTint: TORCH_PALE,
};

const TREASURE_RELIQUARY: Vault = {
  id: 'treasure-reliquary',
  tags: ['treasure'],
  // The locked cage under gold light — PRICED family. The prize is
  // visible from the doorway; whether you have (or will spend) a
  // skeleton key is the whole encounter.
  map: [
    '########',
    '#......#',
    '#......#',
    '#......#',
    '#*....*#',
    '########',
  ],
  // Deeper + rarer than the other treasure vaults: keys are rare-band
  // drops, and a reliquary you meet before any key has had a CHANCE to
  // drop reads as a taunt rather than a routing decision.
  minDepth: 3,
  weight: 0.5,
  props: [
    { kind: 'reliquary', x: 0, z: -0.5 },
  ],
  torchTint: TORCH_GOLD,
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
    '#...*......#',
    '#..........#',
    '#..........#',
    '#......$...#',
    '#...^......#',
    '#..........#',
    '#.....*....#',
    '############',
  ],
  lightTier: 'dark',
  minDepth: 2,
  torchTint: TORCH_GREEN,
  cellProps: {
    '2,2': [{ kind: 'loot-anchor', prominence: 'minor' }],
    '6,3': [{ kind: 'loot-anchor', prominence: 'minor' }],
    '9,6': [{ kind: 'loot-anchor', prominence: 'minor' }],
  },
};

const ENCOUNTER_RITUAL: Vault = {
  id: 'encounter-ritual',
  tags: ['encounter'],
  // Altar with the ritual-circle group dropped on it (altar + skull
  // + 4 candles + bone glow). Empty floor around — non-combat.
  map: [
    '############',
    '#...*...*..#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#...^......#',
    '############',
  ],
  lightTier: 'dim',
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
  // Map is 12 cols × 9 rows → vault-local x ∈ [-6, +6], z ∈ [-4.5, +4.5].
  map: [
    '############',
    '#....*.....#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#....*.....#',
    '############',
  ],
  lightTier: 'dim',
  minDepth: 2,   // wraith is a real threat — keep off depth 1
  weight: 1,
  torchTint: TORCH_BLOOD,
  // The lone wraith guardian — cell-bound, no world-coord math.
  // (Migration also fixes a 0.5m z drift the previous absolute-
  // coord entry had — should sit at cell (2,4) which is z=0,
  // not z=-0.5.)
  cellProps: {
    // Wraith guardian + the four pillars that enclose it + the chest
    // behind. All cell-bound, in reading order top→bottom.
    '2,2': [{ kind: 'pillar' }],
    '9,2': [{ kind: 'pillar' }],
    '2,4': [{ kind: 'spawn', enemyId: 'wraith' }],
    '9,4': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '2,6': [{ kind: 'pillar' }],
    '9,6': [{ kind: 'pillar' }],
  },
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
  // SINGLE ROOM + perimeterFitting 'arena-trap': portcullises auto-
  // install at every composer-cut entrance and slam when the player
  // commits through ANY of them (default 'cross' trigger). The old
  // layout used an entry alcove + internal 'D' gate row, which split
  // the vault's walkable area in the tilemap flood-fill — the phantom
  // sub-rooms it generated were the 'silly little extra rooms in the
  // middle of nowhere' (same bug class the challenge arena was cured
  // of, same cure).
  //
  // The chest is declared as a PROP (not a 'c' tile) so we can ask
  // for the iron tier — the arena reward should LOOK like more than
  // a roadside supply box.
  // Map is 14 cols × 9 rows → vault-local x ∈ [-7, +7], z ∈ [-4.5, +4.5].
  map: [
    '##############',
    '#....*....*..#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#....*....*..#',
    '##############',
  ],
  lightTier: 'dim',
  minDepth: 3,
  weight: 1,
  torchTint: TORCH_BLOOD,
  perimeterFitting: 'arena-trap',
  // Chest sits at world x=0 — exactly between cells (6,7) and
  // (7,7) on a 14-wide grid. Stays in the absolute-coord array
  // since neither cell is a clean fit; this is the legit
  // sub-cell escape case.
  props: [
    { kind: 'loot-anchor', prominence: 'major', x: 0, z: 0.5, facing: { kind: 'wall-away' } },
  ],
  // No static guardians — a TRAP arena: committing through any entrance
  // slams every gate and the wave controller summons escalating waves
  // (arena-waves.ts). The gates only rise once the last wave is dead.
};

// CHALLENGE arena — the VOLUNTARY twin of the trap. Same shape (entry alcove,
// 'D' gate, arena below) but the centrepiece is a chained CHALLENGE OFFERING
// instead of a chest. The gate does NOT slam on entry — placing an offering in
// the room. You walk in (no gate, no slam, no alcove), read the altar, and
// CHOOSE to accept: the room seals at every entrance (the encounter's
// activate reactor walls every external opening on the room's perimeter —
// see builder.ts), the wave gauntlet summons, and surviving it yields a
// generous hoard. Risk you opt into, for loot you can see.
//
// (The combat-arena to the north of this file still uses the alcove + 'D'
// gate layout — it NEEDS the gate to detect the slam-on-entry crossing.
// The challenge variant doesn't; the offering is the trigger, the encounter
// is the seal.)
const CHALLENGE_ARENA: Vault = {
  id: 'challenge-arena',
  tags: ['treasure'],
  map: [
    '##############',
    '#....*....*..#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#....*....*..#',
    '##############',
  ],
  lightTier: 'dim',
  minDepth: 3,
  weight: 1,
  torchTint: TORCH_BLOOD,
  // Declarative perimeter: every entrance the composer cuts into this
  // chamber becomes a portcullis. The altar's encounter activate reactor
  // slams them all in unison and raises them on completion — the player
  // can't slip in through a side passage and skip the gate visual.
  perimeterFitting: 'arena-portcullis',
  // Altar sits in the centre of the chamber (vault-local origin).
  props: [
    { kind: 'challenge-offering', x: 0, z: 0 },
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
    '#....*.....#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#....*.....#',
    '############',
  ],
  lightTier: 'dim',
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
    '#...*....#',
    '#^......^#',
    '#........#',
    '#........#',
    '#........#',
    '#^......^#',
    '#...*....#',
    '##########',
  ],
  weight: 1,
  torchTint: TORCH_GREEN,
  cellProps: {
    '4,4': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
  },
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
    '#....*..*...#',
    '#...........#',
    '#.....B.....#',
    '#...........#',
    '#...X...X...#',
    '#...........#',
    '#........../#',
    '#############',
  ],
  lightTier: 'dim',
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
    '#....*....*....#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#......B.......#',
    '#..............#',
    '#......X.......#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#....X....X....#',
    '#............./#',
    '#....*....*....#',
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
  cellProps: {
    '2,3': [{ kind: 'pillar' }],
    '13,3': [{ kind: 'pillar' }],
    '2,7': [{ kind: 'pillar' }],
    '12,7': [{ kind: 'pillar' }],
    '2,9': [{ kind: 'pillar' }],
    '13,9': [{ kind: 'pillar' }],
  },
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
  // SINGLE ROOM + perimeterFitting 'cobweb': EVERY composer-cut
  // entrance gets sealed by a destructible web — the den is closed
  // until you cut your way in, from whichever side you found it.
  // The old internal '%' curtain row split the vault into phantom
  // sub-rooms in the flood-fill (the extra-room bug) and only sealed
  // ONE of the entrances anyway.
  map: [
    '##############',
    '#.....*......#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#.....*......#',
    '##############',
  ],
  lightTier: 'dark',
  minDepth: 4,
  weight: 1,
  torchTint: TORCH_GREEN,
  perimeterFitting: 'cobweb',
  // FORMAT C demo — corner cobwebs and set-piece spawns authored by
  // cell, not by world coord. Reads in the same space as the ASCII
  // above (count columns / rows in the map to verify each entry).
  // Map is 14 cols × 11 rows. Cell (col, row) → world (col-6.5, row-5).
  // The four cobweb models still want their non-default y (2.2m up
  // in the corner) and rotation, so they get the full PropSpec
  // entry without x/z — those come from the cell key.
  cellProps: {
    // Corner cobwebs (map is 14×9 now; cell (col,row) → world
    // (col−6.5, row−4)). Hubs face inward via rotY.
    '1,1':  [{ kind: 'model', model: COBWEB_CORNER, y: 2.2, rotY:  Math.PI * 0.25 }],
    '12,1': [{ kind: 'model', model: COBWEB_CORNER, y: 2.2, rotY:  Math.PI * 0.75 }],
    '1,7':  [{ kind: 'model', model: COBWEB_CORNER, y: 2.2, rotY: -Math.PI * 0.25 }],
    '12,7': [{ kind: 'model', model: COBWEB_CORNER, y: 2.2, rotY: -Math.PI * 0.75 }],
    // Set-piece spawns — four spiders in a quad around the centre,
    // one skeleton midway. The cell key reads the same as the ASCII.
    '3,2':  [{ kind: 'spawn', enemyId: 'spider' }],
    '10,2': [{ kind: 'spawn', enemyId: 'spider' }],
    '3,6':  [{ kind: 'spawn', enemyId: 'spider' }],
    '10,6': [{ kind: 'spawn', enemyId: 'spider' }],
    '6,4':  [{ kind: 'spawn', enemyId: 'skeleton' }],
    // Reward chest at the back of the swarm.
    '6,6':  [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
  },
};

// ── EXIT vaults ───────────────────────────────────────────────────

const EXIT_SIMPLE: Vault = {
  id: 'exit-simple',
  tags: ['exit'],
  // '/' is INSIDE the walkable interior with an adjacent '#'
  // neighbour, so auto-rotation lands the descent against the wall.
  // The stair's own moonbeam + outline does the colour-anchor work.
  map: [
    // Enlarged to 10×6 with the stair wall-centred: the 2.56×1.95m stairwell
    // needs go-around clearance to reach its mouth, or the descent soft-locks
    // (verified via `npm run reach`). The old 8×4 was too cramped.
    '##########',
    '#..*.....#',
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
    '#....*.....#',
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
    '#....*....*..#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#......./....#',
    '#....*....*..#',
    '##############',
  ],
  minDepth: 3,
  torchTint: TORCH_PALE,
  cellProps: {
    '2,2': [{ kind: 'pillar' }],
    '11,2': [{ kind: 'pillar' }],
    '2,5': [{ kind: 'pillar' }],
    '11,5': [{ kind: 'pillar' }],
  },
};

// ── New variety vaults (Pass C) ───────────────────────────────────
// Deliberately pillar-light: pillars aren't instanced yet, so colonnades
// would worsen the boss-floor draw-call cost. Variety here comes from
// SILHOUETTE (non-rectangular rooms) and THEME, not prop density.

// Cross/I-shaped combat room — narrow top + bottom arms, wide middle.
// Breaks the "every room is a box" read. Reachable from any side: the
// composer's corridor enters mid-edge, which lands in an arm or the
// central band, both connected.
const COMBAT_CROSS: Vault = {
  id: 'combat-cross',
  tags: ['combat'],
  map: [
    '############',
    '####.**.####',
    '####....####',
    '#..........#',
    '#.X..X...X.#',
    '#..........#',
    '####....####',
    '####.**.####',
    '############',
  ],
  lightTier: 'dim',
  minDepth: 2,
  weight: 2,
  // PROTOTYPE: coherent pack instead of 3 independent X rolls. A swarm —
  // fast weak bodies that overwhelm the cross's narrow arms.
  encounter: { archetype: 'swarm', intensity: 'medium' },
};

// Mine-shaft gallery — long, narrow, low, pale. The "white corridor that
// feels like a mine shaft" as an actual room: ore-vein vases, a couple of
// rats, cold cyan torches, a low ceiling (the composer pitches it into an
// A-frame at depth). Common (weight 2) so the mine feel recurs.
const MINESHAFT_GALLERY: Vault = {
  id: 'mineshaft-gallery',
  tags: ['combat'],
  map: [
    '##############',
    '#*..........*#',
    '#....XX......#',
    '#............#',
    '#*..........*#',
    '##############',
  ],
  lightTier: 'dim',
  minDepth: 1,
  weight: 2,
  torchTint: TORCH_PALE,
  roomHeight: 2.6,
  wallVariant: 'braced',   // timber support frames — the mine-shaft read
  // Vermin swarm — light + fast, scaling with depth instead of fixed rats.
  encounter: { archetype: 'swarm', intensity: 'light' },
  cellProps: {
    '4,1': [{ kind: 'vase' }],
    '8,1': [{ kind: 'vase' }],
    '7,3': [{ kind: 'vase' }],
    '4,4': [{ kind: 'vase' }],
    '8,4': [{ kind: 'vase' }],
  },
};

// Ossuary — a lore pocket: four corpses (Souls-style notes), a chest in
// the middle, sickly-green light. Low threat, high atmosphere.
const ENCOUNTER_OSSUARY: Vault = {
  id: 'encounter-ossuary',
  tags: ['encounter'],
  // Light, mixed haunt — a lore pocket, not a hard fight.
  encounter: { archetype: 'mixed', intensity: 'light' },
  map: [
    '############',
    '#....*.....#',
    '#..........#',
    '#..........#',
    '#.X......X.#',
    '#..........#',
    '#....*.....#',
    '############',
  ],
  lightTier: 'dark',
  minDepth: 2,
  weight: 1,
  torchTint: TORCH_GREEN,
  cellProps: {
    '2,1': [{ kind: 'loot-anchor', prominence: 'minor' }],
    '8,1': [{ kind: 'loot-anchor', prominence: 'minor' }],
    '5,3': [{ kind: 'loot-anchor', prominence: 'minor', facing: { kind: 'wall-away' } }],
    '2,6': [{ kind: 'loot-anchor', prominence: 'minor' }],
    '8,6': [{ kind: 'loot-anchor', prominence: 'minor' }],
  },
};

// Spike gauntlet — a hazard-grid combat room. Spike traps stagger the
// floor so the fight is about footing, not just the mobs.
const COMBAT_PITS: Vault = {
  id: 'combat-pits',
  tags: ['combat'],
  // Ranged threats behind the spike grid — footing matters under fire.
  encounter: { archetype: 'caster-pack', intensity: 'medium' },
  map: [
    '############',
    '#..*....*..#',
    '#..........#',
    '#.^..X..^..#',
    '#....^.....#',
    '#.^..X..^..#',
    '#....?.....#',
    '#..*....*..#',
    '############',
  ],
  lightTier: 'dim',
  minDepth: 3,
  weight: 1,
};

// Grand boss hall — bigger than the cathedral (18×16 walkable) for a real
// set-piece. Drama comes from the auto-assigned grand barrel vault (boss tag
// → rise 1.9), NOT god rays: god rays are the boss-floor overdraw culprit, so
// this arena stays torch-lit and leans on ceiling geometry + scale instead.
// Pillar-light (4) so it doesn't blow the draw-call budget like the cathedral.
const BOSS_HALL: Vault = {
  id: 'boss-hall',
  tags: ['boss'],
  map: [
    '####################',
    '#...*..........*...#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#........X.........#',
    '#..................#',
    '#........B.........#',
    '#..................#',
    '#..X..........X....#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#...*..........*...#',
    '#........../.......#',
    '####################',
  ],
  minDepth: 3,
  // Tall vaulted ceiling — the king's leap arc and the Marrow Sovereign's
  // 5m frame + greatscythe both want headroom. 14m so the giant skeleton
  // doesn't scrape the rafters and the eye actually lifts to find his skull.
  roomHeight: 14,
  // Weight 3 (vs 1 for the antechamber + cathedral) so the grand
  // arena wins the boss-vault roll most of the time. Tiny boss rooms
  // are still possible — they're the variant for the curious player
  // — but the new fights are big enough that the cramped vault would
  // feel undersized.
  weight: 3,
  torchTint: TORCH_BLOOD,
  // Wall torches alone leave this 18×16 arena's centre black. Four great
  // braziers ring the boss so the floor you fight on is actually lit —
  // free-standing fire, not just sconces on the far walls.
  props: [
    { kind: 'model', model: GREAT_BRAZIER, x: -5, y: 0, z: -4 },
    { kind: 'model', model: GREAT_BRAZIER, x:  5, y: 0, z: -4 },
    { kind: 'model', model: GREAT_BRAZIER, x: -5, y: 0, z:  4 },
    { kind: 'model', model: GREAT_BRAZIER, x:  5, y: 0, z:  4 },
  ],
  // Signature lighting: two king-gold wall sconces flank the boss,
  // sub-cell-precise (x = ±2.5 — no T-char could land here), brighter
  // and warmer than the room's blood-tinted ASCII torches. Reads as
  // "throne-room altar" the moment the player crosses the threshold.
  // Demonstrates the vault.torches array's sub-cell + per-torch tint
  // + intensity control that the inline T/t/</> chars can't express.
  torches: [
    { x: -2.5, z: -8.6, wall: 'N', height: 2.3, colorTint: TORCH_GOLD, intensityMul: 1.3 },
    { x:  2.5, z: -8.6, wall: 'N', height: 2.3, colorTint: TORCH_GOLD, intensityMul: 1.3 },
  ],
  cellProps: {
    '5,3': [{ kind: 'pillar' }],
    '14,3': [{ kind: 'pillar' }],
    '5,13': [{ kind: 'pillar' }],
    '14,13': [{ kind: 'pillar' }],
  },
  // Fog wall at the south edge — player enters from the corridor
  // on the south side, walks NORTH into the arena. rotY=π so the
  // plane's normal faces north (the cross-detect interprets +d as
  // "arena side": player crosses negative → positive == entering).
  // The mist colour is supplied by the act's BossSpec.mistColor.
  bossMist: { x: 0, z: 4.5, rotY: Math.PI },
};

// Chasm bridge — a void splits the room; a narrow walkable bridge crosses it
// (with thin ledges to either side). Pure flat-playfield verticality: the
// floor is cut, an edge barrier blocks the abyss, drop geometry falls away
// below. Tense crossing without any player-Y simulation. The void rects are
// vault-local; the map stays ordinary floor (the voids block the cells they
// cover). Enemies sit on the rims + one on the bridge.
const CHASM_BRIDGE: Vault = {
  id: 'chasm-bridge',
  tags: ['combat'],
  map: [
    '################',
    '#..X.......*...#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#......X.......#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#...*......X...#',
    '################',
  ],
  lightTier: 'dim',
  minDepth: 3,
  weight: 1,
  torchTint: TORCH_PALE,
  // Two voids flanking a 3m central bridge (x∈[-1.5,1.5]), with ~2m walkable
  // ledges at the E/W walls + ~3m rims N/S. Every margin is >= 2m so the
  // PLAYER (collision radius 0.3) can actually traverse the strip a corridor
  // opens onto — a thinner ledge soft-locks: you enter onto a sliver with the
  // abyss right ahead and can't slip past it to the bridge. (Was 1m ledges,
  // which the old point-BFS reachability check wrongly passed.)
  voids: [
    { x: -3.25, z: 0, w: 3.5, d: 4 },
    { x: 3.25, z: 0, w: 3.5, d: 4 },
  ],
};

// Chasm rim — the void owns the room's HEART; the floor is a ring running
// around it. Where the bridge is a tense crossing, the rim is a circuit:
// combat orbits the abyss, and whichever way you back off, the edge is
// near. Every strip of the ring is 2m (player + corridor entry safe; all
// four edge midpoints walkable for the composer), so the room accepts
// openings on any side.
const CHASM_RIM: Vault = {
  id: 'chasm-rim',
  tags: ['combat'],
  map: [
    '##############',
    '#.*........*.#',
    '#...X........#',
    '#............#',
    '#............#',
    '#............#',
    '#........X...#',
    '#.*........*.#',
    '##############',
  ],
  lightTier: 'dim',
  minDepth: 2,
  weight: 1,
  torchTint: TORCH_PALE,
  voids: [
    { x: 0, z: 0, w: 8, d: 3 },
  ],
};

export const VAULTS: Vault[] = [
  FOYER_SMALL, FOYER_PILLAR, FOYER_ALCOVE,
  COMBAT_OPEN, COMBAT_PILLARS, COMBAT_CHOKE, COMBAT_HALL, COMBAT_ARENA, COMBAT_DOORS,
  COMBAT_CROSS, MINESHAFT_GALLERY, COMBAT_PITS, CHASM_BRIDGE, CHASM_RIM,
  ENCOUNTER_NEST,
  TREASURE_ALTAR, TREASURE_CACHE, TREASURE_VAULT,
  ENCOUNTER_FOUNTAIN,
  ENCOUNTER_TITHE,
  TREASURE_RELIQUARY, ENCOUNTER_CORPSES, ENCOUNTER_RITUAL,
  ENCOUNTER_PRISON, ENCOUNTER_TRAPPED, ENCOUNTER_BLOOD_ALTAR,
  ENCOUNTER_ARENA, CHALLENGE_ARENA, ENCOUNTER_OSSUARY,
  BOSS_ANTECHAMBER, BOSS_CATHEDRAL, BOSS_HALL,
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
