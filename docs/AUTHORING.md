# Authoring content in DELVE

This is the reference for adding **enemies, weapons, items, affixes, sets,
statuses, and projectiles** — the things a content author (human or LLM)
adds *without touching engine code*. The rule the codebase is built around:

> **Adding one piece of content = adding one data entry to one registry.**
> No new classes, no new `if` branches, no wiring across files.

Everything here is plain TypeScript object literals in `src/content/`.
TypeScript proves the shape; a boot-time validator (`src/content/validate.ts`)
proves the cross-references. Get a reference wrong and the game refuses to
start with a message naming the offender — so it's safe to author blind.

**Tone first.** Read the Tone Bible + the "Lighting as signal" and "Tone
Layering" sections of `CLAUDE.md` before writing any player-facing text.
In-world names are grim/terse ("A blade that remembers heat"); the broadcast
layer is the only place snark lives. No exclamation points, no emoji.

---

## Tooling: author → iterate → inspect

**One front door: `npm run delve`.** It indexes the whole creator suite —
models *and* world. Run it with no args to see everything; the rest of this
section is just "which sub-command for which job." If you're reaching for a
bespoke script or hand-writing a debug scenario, stop — the answer is almost
always already a `delve` command.

**The loop for a model** (weapon viewmodel, mob, item, prop):

1. **Author** — edit the `ModelSpec` (inline on the item/enemy spec). Coordinate
   convention, named anchors, and `orient()` for rotations are doctrine — they
   live in `CLAUDE.md` → "Model authoring". Read that before placing a part.
2. **Iterate** — `delve bench viewmodel-<id> --hand --ortho --debug`. No game
   underneath: isolated scene, 4-view contact sheet (FRONT/SIDE/TOP/ISO), part
   colours, slot markers, bounding box, and a JSON readout. **This is the loop
   for geometry/grip/anchors.** For live sliders use the browser:
   `npm run dev` → `bench.html?subject=viewmodel-<id>&edit=1` (has a "Copy spec").
3. **Inspect in context** — `delve snap viewmodel-<id>` renders it in the *real*
   engine (dungeon fog, torchlight, PSX post) — the question "does it read in
   the dark?", which the bench's clean studio light can't answer. Or browse the
   whole registry live with `?viewer=1` in the browser (orbit + swing scrubber).
4. **Validate** — `delve test` (boot-time validator + invariants).

**Which tool for which job:**

| I want to… | Command |
|---|---|
| iterate on model **geometry / grip / anchors** | `delve bench viewmodel-<id> --hand --ortho --debug` |
| see a model in **real dungeon lighting** / a live swing | `delve snap viewmodel-<id>` |
| **browse every** mob/weapon/item live, orbit, scrub a swing | `?viewer=1` in the browser |
| tune **weapon numbers** (derived reach · class · arc · dmg) | `delve weapons` |
| list what the tools can point at | `delve list [vaults\|mobs\|items]` |
| **fast** floor soft-lock check (no browser) | `delve check <seed> <depth>` |
| **faithful** walkability (real collision) | `delve reach <seed> <depth>` |
| screenshot any scenario / vault | `delve snap <target>` |
| drive + inspect the live world | `delve pilot --vault <id> --do "…"` |
| autonomous playtest episode | `delve play` |

**Snaps run on WEBGPU now** (since 2026-08-13). That is the backend the game
ships on, so it is the one the tool verifies; `delve snap … --webgl` forces the
WebGL2 backend as a control. This was believed impossible for months — headless
Chromium *can* run WebGPU, it just cannot present to a canvas, and the failed
present used to take the whole device down. `scripts/headless-browser.ts` is the
single source of truth for how it works (secure origin, one flag, a swap-chain
shim, and the frame read back offscreen and painted under the HUD). Two things
follow:

- **Dawn's validation layer is live in a snap.** Validation is device-independent,
  so a usage/synchronization-scope error from Josh's phone reproduces headlessly.
  `delve snap` prints anything the run collected on `window.__gpuErrors`.
- **Known headless-only noise:** `[psx] in-flight watchdog: N submit(s) never
  completed` fires a few times per run with `__gpuErrors` EMPTY. That watchdog
  guesses "probably failed validation"; here it is just software rasterisation
  being slow to land completions. Not a game bug — don't chase it from a snap.

**Naming is convention, not a lookup.** Every subject in `ITEMS`/`ENEMIES` gets
a preview for free, named `viewmodel-<id>` (held weapon), `mob-<id>`, or
`item-<id>` (drop model) — derived in `src/debug/authorables.ts`, auto-filled in
`scenarios.ts`. Add a weapon to `items.ts` and `delve bench viewmodel-<your-id>`
works immediately. **Don't hand-write a preview scenario** — the only scenarios
worth authoring by hand are ones that *aren't* plain previews (a posed combat
review, a clip test). Use the full registry id (`viewmodel-bent-sickle`), not a
nickname.

---

## The registries at a glance

| Content | File | Registry | Keyed by |
|---|---|---|---|
| Enemy | `content/enemies.ts` | `ENEMIES` | enemy id + `tileChar` |
| Enemy ability | `content/abilities.ts` (type) → on a spec | `EnemySpec.abilities` | per-enemy |
| Item / weapon / armor | `content/items.ts` | `ITEMS` | item id |
| Weapon class timings | `content/weapon-classes.ts` | `WEAPON_CLASS_DEFAULTS` | class name |
| Affix | `content/affixes.ts` | `AFFIXES` | affix id |
| Set | `content/sets.ts` | `SETS` | set id |
| Status / buff | `content/buffs.ts` | `BUFFS` | buff id |
| Projectile | `content/projectiles.ts` | registered in `registerProjectiles()` | projectile id |
| Model | inline on the spec | `ModelSpec` (`ecs/model-types.ts`) | — |

String ids tie it together: a weapon's `onHit.buffId` → `BUFFS`, a drop's
`itemId` → `ITEMS`, `ranged.projectileId` → a registered projectile, etc.
**The validator checks every one of these at boot.**

---

## Models — the shared visual vocabulary

Everything visible is a `ModelSpec` (`ecs/model-types.ts`): a list of
`parts`, a `materials` map, optional named `slots`, optional `light`.
Geometry is composed from primitives — no mesh files.

Part kinds: `sphere · box · capsule · cylinder · cone · lathe` (revolve a
`[r,y]` profile) `· extrude` (push a `[x,y]` shape) `· torus · sprite`
(billboard) `· decal` (oriented plane). Each part references a material by
the `mat` key. Common knobs: `pos/rot/scale`, `jitter` (organic
roughening), `parent` (nest under another part **name** or **slot**).

Two ways to build a creature model:
1. **`creature()`** (`content/creature.ts`) — parametric humanoid: pass
   `palette`, `height/build/armLength/legLength/headRadius/hunch`,
   `head: 'smooth' | 'skull'`. Returns a rigged `ModelSpec` with
   `rig/shoulderL/R/hipL/R/neck` slots already wired for the walk gait +
   head-crane. **Use this for anything bipedal.**
2. **Hand-authored `ModelSpec`** — for non-humanoids (rat, ooze, spider).
   If the AI animates it, expose the part/material names the spec points
   at (`tiltPartName`, `eyeMaterialName`, `flashMaterialName`).

The validator warns (doesn't throw) if a part's `mat` isn't in `materials`
or a `parent` names nothing — a bad material usually shows up visually.

---

## Add an ENEMY

Add one entry to `ENEMIES` in `content/enemies.ts`:

```ts
'gravewight': {
  id: 'gravewight',
  name: 'gravewight',
  tileChar: 'G',                 // UNIQUE, not a reserved structural char
  hp: 6, moveSpeed: 1.8, attackDamage: 2,
  attackRange: 1.6, strikeRange: 1.1,
  windupTime: 0.6, strikeTime: 0.12, recoverTime: 0.6,
  model: creature({ palette: { body: 0x3a3f3a, eye: 0x9fe0ff }, head: 'skull', hunch: 0.1 }),
  baseEyeEmissive: 1.8, collisionRadius: 0.3,
  tiltPartName: 'rig', flashMaterialName: 'body', eyeMaterialName: 'eyes',
  presence: 'lurch',             // idle character: spectral|lurch|twitch|coiled|chant
  onHit: { buffId: 'chill', chance: 0.3, duration: 2 },   // status it puts on YOU
  drops: { rate: 0.4, pool: [{ itemId: 'healing-potion', weight: 4 }, { itemId: 'spear', weight: 1 }] },
  xp: 7, gold: [0, 8],
},
```

Then place it: nothing. **That's the whole wiring.** A new enemy is reachable
the moment it is in the registry and appears in a depth's roll table
(`level/procgen.ts` `rollTableForRaw`) — the generator asks each room what
should fight in it and rolls from there.

(This used to say "put its `tileChar` in a vault map". Enemies were placed by
stamping a character into a hand-authored ASCII tilemap. That whole format is
retired — `tileChar` no longer places anything.)

The flat `windup/strike/recover/attackRange` fields synthesize a default
attack. For **multiple attacks or movement attacks**, add `abilities` (see
below) — the flat fields still feed the debug poser + audio, so nothing
else changes.

Optional behavior flags: `ranged` (shooter), `preferredRange` (kiter —
backs away to hold a band), `attackCooldown` (reposition window between
shots), `phasing` (walks through props), `noPlayerCollision` (you walk
through it), `splitsInto` (spawns children on death — child must NOT itself
split). Perception: `sightRange/sightConeHalfAngle/hearingRange/loseSightTime`.

### Enemy abilities

An `Ability` is a telegraphed `windup → strike → recover` carrying one or
more **effects** (a tagged union in `content/abilities.ts`):

- `{ kind: 'melee', reach, damageType? }` — contact hit at strike.
- `{ kind: 'projectile', projectileId, muzzle }` — fire a bolt.
- `{ kind: 'dash', speed, toward: 'player'|'away', contactReach }` — the
  charge/lunge/leap: move the enemy during strike, hit on contact.
- `{ kind: 'aoe', radius, targetMode: 'player'|'self' }` — telegraphed
  ground zone; a ring shows during windup, resolves at strike.

```ts
abilities: [
  { id: 'charge', maxRange: 8, minRange: 3, windup: 0.5, strike: 0.4, recover: 0.7,
    cooldown: 3, damage: 3, telegraph: 'charge',
    effects: [{ kind: 'dash', speed: 9, toward: 'player', contactReach: 1.2 }] },
  { id: 'swipe', maxRange: 1.8, windup: 0.4, strike: 0.12, recover: 0.5,
    damage: 2, effects: [{ kind: 'melee', reach: 1.3 }] },
],
```

Listed highest-priority first; the AI picks the first whose range band
matches. **New behavior = compose existing effects.** A genuinely new verb
is *one* handler in `enemy.ts` — never a new branch in the AI tick.

---

## Add a WEAPON

A weapon is an `ITEMS` entry with `kind: 'weapon'` and a `weapon` block:

```ts
'reaver-axe': {
  id: 'reaver-axe', kind: 'weapon', rarity: 'rare',
  name: 'A reaver's axe', flavor: 'It favours the backswing.',
  dropModel: REAVER_AXE, viewmodel: REAVER_AXE,          // ModelSpec(s) in content/weapons.ts
  weapon: {
    class: 'hammer',                 // dagger|sword|hammer|spear|crossbow|wand
    reach: 2.1, coneHalfAngle: 0.8, damage: 3,
    critChance: 0.1, critMultiplier: 2.2,
    onHit: { buffId: 'bleed', chance: 0.4, duration: 3 },  // base on-hit
    // ranged: { projectileId: 'crossbow-bolt' },           // present = it FIRES (crossbow/wand)
  },
  affixPool: ['keening', 'gallows', 'rending', 'searing'],  // ids into AFFIXES
  maxAffixes: 2,                                            // optional; else rarity decides
  setId: 'reaver',                                          // optional set membership
},
```

- **Class** picks the animation + default timings
  (`WEAPON_CLASS_DEFAULTS` in `weapon-classes.ts`). Each class maps to pose
  curves in `player/weapon-animations.ts`. Adding a class = add defaults +
  pose keys + the pose functions.
- **`ranged`** makes the strike fire a projectile (auto-targets the nearest
  enemy in a forward cone — one-thumb, no aiming). The class's slow recover
  is the reload — the cost that keeps ranged from obsoleting melee.
- **`onHit`** applies a status on every landed hit (melee cone OR bolt).
  Combines with on-hit affixes + set on-hits via `getPlayerOnHits()`.
- **Make it obtainable**: add its `itemId` to an enemy's `drops.pool` (or a
  chest). An unreferenced weapon never appears.

The viewmodel `ModelSpec` should run the blade/barrel along `−Z` (forward)
with a `muzzle` slot for ranged. See `CROSSBOW/WAND/SPEAR` in
`content/weapons.ts` for worked examples.

---

## Add an AFFIX

Affixes are per-instance suffixes (`"of the keening"`) layered on a fixed
item identity. Two flavors, in `content/affixes.ts`:

```ts
// Stat affix — rolls a value in [min,max] per instance.
'cruel': { id: 'cruel', suffix: 'cruel', weight: 1,
  rolls: [{ kind: 'weapon-damage', min: 1, max: 2, integer: true }] },

// Behavioral affix — grants an on-hit status (no stats). Makes the item DO
// something, not just have bigger numbers.
'venom': { id: 'venom', suffix: 'venom-etched', weight: 1,
  onHit: { buffId: 'poison', chance: 0.35, duration: 4 } },
```

Add the id to the `affixPool` of any item that should be able to roll it.
**Rarity drives how many roll**: `RARITY_AFFIX_BUDGET` (in `items.ts`) sets
the affix count + the chance each successive affix lands, so a `rare` item
genuinely out-rolls a `mundane` one. `spec.maxAffixes` overrides the count.

---

## Add a SET

Sets reward wearing matched pieces. In `content/sets.ts`:

```ts
'reaver': {
  id: 'reaver', name: 'The Reaver's Oath',
  bonuses: [
    { pieces: 2, modifiers: [{ kind: 'weapon-damage', amount: 1 }] },
    { pieces: 4, modifiers: [{ kind: 'damage-multiplier', amount: 1.15 }],
      onHit: { buffId: 'bleed', chance: 0.5, duration: 3 } },   // player-wide on-hit
  ],
},
```

Tag members with `setId: 'reaver'` on each item. A bonus activates when the
count of equipped pieces with that `setId` meets `pieces`. Set modifiers
feed the central stat pipeline; set on-hits feed `getPlayerOnHits()`. The
inventory details panel shows the set with met tiers lit / unmet dimmed.
(The validator warns about a set with zero member items.)

---

## Add a STATUS (buff)

`content/buffs.ts`. A buff is the status-effect primitive — DoT, stat
modifier, or both, with stacking + a vfx hint:

```ts
'frostbite': {
  id: 'frostbite', displayName: 'FROSTBITE', maxStacks: 3,
  modifiers: [{ kind: 'move-speed-mult', amount: 0.7 }],
  tickInterval: 1, tickEffect: { type: 'damage', amount: 1, damageType: 'magic' },
  vfx: { color: 0x8fd8ff, style: 'drip' },   // status-vfx.ts emits motes from this
},
```

Reference its id from a weapon/affix/set `onHit`, an enemy `onHit`, or a
consumable `consumableBuff`. Damage statuses route deaths through the
damage-sink registry so kill credit + drops resolve correctly.

---

## Add a PROJECTILE

`content/projectiles.ts`: define a `ProjectileType` and register it in
`registerProjectiles()`. Reference its id from a weapon's `ranged` or an
enemy's `ranged` / projectile ability. `speed` is the dodge affordance;
`color` should match the caster's cue so the player reads "that one's at me."

---

## The safety net

`validateContent()` runs at boot (after projectiles register) and **throws**
listing every broken reference: a dead `buffId`, `itemId`, `projectileId`,
`affixPool` id, `setId`, or `splitsInto.enemyId`. Model material/parent
typos are **warnings** (they usually show visually). This is why content is
safe to author by editing data alone — a typo fails loud and early instead
of silently producing a dead feature.

If you add a *new kind of reference* (a new string id pointing into a new
registry), add a check for it in `validate.ts` so the net stays complete.
