# Combat / Enemy Architecture

How enemy attacks, abilities, movement, and animation fit together —
the seam that keeps adding enemies from turning into a pile of `if`
branches. Companion to `docs/ENEMY-DESIGN.md` (which is the *what*: the
verb each enemy teaches); this is the *how*.

## The one idea: telegraphed phases carrying effects

Every enemy attack is an **Ability** = a phase sequence
(windup → strike → recover) carrying one or more **Effects**. The old
code hardcoded those three phases for a single attack with an
`if (spec.ranged)` branch inside; now the phases are generic and the
attack's behaviour lives in data.

```
Ability { id, minRange, maxRange, windup, strike, recover, cooldown,
          damage, telegraph, creep, effects: AbilityEffect[] }

AbilityEffect =
  | { kind: 'melee';      reach, damageType }
  | { kind: 'projectile'; projectileId, muzzle }
  | { kind: 'dash';       speed, toward, contactReach, damageType }   // moves the enemy
  | { kind: 'aoe';        radius, targetMode, damageType }            // telegraphed ground zone
```

- **windup** — telegraph (the player's reaction window). Melee abilities
  may *creep* toward the player here; charges don't (the dash is the
  approach).
- **strike** — effects fire. Instantaneous (melee/projectile) latch and
  fire once; continuous (dash) run the whole strike duration.
- **recover** — locked-out follow-through; the cooldown starts at its end.

**Attacks that move the enemy are not special-cased** — a charge is just
`telegraph: 'charge'` + a `dash` effect over a longer strike phase. A
retreat-leap would be a `dash` with `toward: 'away'`. New behaviour =
compose existing effects, or add ONE effect handler (`runEffect` in
`enemy.ts`). Never a new branch in the state machine.

## Where it lives

- `src/content/abilities.ts` — the `Ability` / `AbilityEffect` types +
  `resolveAbilities(spec)` and `defaultAbility(spec)`.
- `src/content/enemies.ts` — each `EnemySpec` may carry `abilities?`.
  Enemies that don't are auto-adapted: the legacy flat fields
  (`windupTime`, `attackRange`, `ranged`, …) are now **sugar** that
  `defaultAbility` compiles into a single ability. So adding the system
  touched zero of the 8 non-charger enemies.
- `src/mobs/enemy.ts` — the runner. `selectAbility(distance)` picks the
  highest-priority ready ability in band; winding/striking/recovering
  execute `currentAbility`; `runEffect` applies each effect;
  `applyTelegraph` poses per flavour; `cooldowns` gates re-use. AoE
  abilities raise a ground telegraph (`effects/aoe-telegraph.ts`) at
  windup start and resolve it at strike.

## Tile-char registry (no drift)

Placeable enemies declare their own map char via `EnemySpec.tileChar`.
That is the SINGLE source of truth — `content/enemies.ts` derives
`ENEMY_BY_CHAR` (char→id) + `ENEMY_CHAR_BY_ID` (id→char) from it, and
`tilemap.ts` (parsing + FLOOR_CHARS) and `procgen.ts` (roll→char) both
read those maps instead of hand-kept lists. Collisions with a
structural tile, the `X`/`B` procgen slots, or another enemy throw at
module load; `procgen.ts` also asserts every roll-table id has a
tileChar. So adding a placeable enemy is ONE field — the char can't
drift out of sync across files (the bug that motivated this).

## Movement / steering

Positioning is separate from attacking:

- **chase** — close toward `commitDistance` (the farthest maxRange of
  any ability) until an ability triggers.
- **kite** (`spec.preferredRange`) — back away when the player is inside
  the standoff band, so ranged enemies can't be free-killed point-blank.
- **dash** — ability-driven burst (charge/lunge), via the `dash` effect.
  The lunge stops the instant it connects and recoils off the player
  (a decaying knockback impulse) so the charger separates to a hittable
  distance instead of bulldozing into you. `enemy.applyKnockback()` is
  the reusable primitive — also wired-ready for player-hit stagger.

All movement funnels through `moveTowards`, which pathfinds around
obstacles (or steers straight for phasing mobs). Steering decides *how
to get in position*; the ability decides *what to do there*.

## Animation — crude, moody, keyed to phases

Two layers, both procedural (no model files, fits the PS1/Lunacid look):

1. **Presence** (`spec.presence`) — the ambient idle overlay (spectral
   float, lurch, twitch, coiled, chant). Always on, per-instance phase.
2. **Telegraph pose-clips** (`mobs/pose-clips.ts` + `applyTelegraph`) —
   data-driven per telegraph flavour: `swing` = lean-back→slam, `cast`
   = subtle→thrust, `charge` = coil-back→lunge. Each pose is additive
   offsets on named rig nodes — `rigTilt` (body lean) + `bob` (rise) on
   EVERY enemy, plus `armSwing` (shoulder pivots) on models that have
   them. Nodes that don't exist no-op, so one clip works on a fully-
   rigged humanoid and a limbless blob alike.

### Jointed limbs (the shared rig)

`SlotSpec.parent` (build-model) lets a slot nest under another node, so
a **shoulder pivot** parented to the body `rig` both swings its arm and
follows the body lean. The arm + fist hang below the pivot; the pose-
clip rotates the pivot. Rest pose is unchanged for every conversion —
the pivot + arm offset reproduce the old arm position exactly.

**Rigged with shoulder-pivot arms:** skirmisher (charge/slash), ghoul
+ defiler (ghoul model — swing/hex), wraith (reach), stoneguard (the
MAUL rides the right pivot → overhead slam). The acolyte is robed with
no visible arms (the staff implies them) so it stays body-only — not
every model needs limbs. Rat + ooze are non-humanoid, also body-only.

**Walk gait (done):** ghoul, skirmisher, stoneguard have `hipL/hipR`
pivots; legs swing from a DISTANCE-driven stride (advances by how far
the body actually moved, so feet roughly track the ground instead of
moonwalking). Gait amplitude eases in/out so legs settle to rest when
stopped, plus a subtle footfall bob. Floaters (wraith, acolyte) and
non-humanoids (rat, ooze) have no hips → they glide, which is correct.
See the locomotion block in `enemy.ts`.

**Head crane (done):** all five humanoids (ghoul, skirmisher,
stoneguard, wraith, acolyte) have a `neck` pivot holding the head +
eyes; it tips the gaze toward the player, stronger the closer they
are (looms at melee range, level at distance), eased back to neutral
when calm. Body yaw already faces the player; this adds the pitch.

**Parametric rig builder (done):** `creature()` (content/creature.ts)
assembles a humanoid ModelSpec with the FULL rig baked in — rig +
shoulderL/R + hipL/R + neck slots, limbs/head hung under them — so
anything built with it inherits arm-swing, gait, AND head-crane for
free, by construction (no per-model risk of forgetting a pivot). Proven
on the **defiler**, which now has its own gaunt/stooped/long-armed
violet silhouette instead of the recoloured ghoul. A few proportion
knobs (height, build, armLength, legLength, headRadius, hunch) +
palette make distinct shapes.

## Models — current + next

The hand-tuned bespoke builders (`humanoidGhoulModel`, `oozeModel`, …)
stay as-is. NEW humanoid enemies should use `creature({...})` — a few
params instead of a 40-line function, and the animation rig is correct
by construction. Migrating an existing model to `creature()` is
optional (only if a silhouette change is wanted; the rig pivots were
already added to the hand models by the animation passes).

**Next archetypes** (same idea, when needed): `quadruped` (rat-style),
`blob` (ooze), `floating` (robed caster / wraith) — each emitting the
standard slot names so they inherit whatever animation applies.

## Roadmap (effects + content)

- ~~`aoe` effect — zone denial.~~ ✅ DONE (the defiler).
- `spawn` effect — in-combat summon (distinct from split-on-death,
  which stays a death trigger in the builder).
- Pose-clip animation + the humanoid limb rig.
- Parametric creature model archetypes.
