# DELVE — Pre-Build Consolidation Plan

> Status: IN PROGRESS (2026-07-31). A repo-wide refactor/unify/optimize pass before
> the next content push, synthesized from a four-way parallel audit of the whole
> `src/` tree (rendering, combat/entities, world/content, UI/infra).

## Progress log

- **Phase 0 — DONE.** Deleted `content/enemy-models.ts`, `level/format-experiment.ts`,
  the dead GLSL bake in `surface-textures.ts`, and the dead CPU path in
  `drifting-motes.ts`. −1,331 lines, build/tests green.
- **Phase 1d — DONE.** `state/persist.ts` (readJSON/writeJSON/readRaw/writeRaw/remove
  + `KEYS`). Migrated `telemetry.ts` + `meta-state.ts`; rest adopt incrementally.
- **Phase 3 (composeStrikeDamage) — DONE.** Extracted the crit×multipliers strike
  math into the tested `damage-math.ts`; melee + ranged share it. +4 tests.
- **Phase 1c (writable migration) — SKIPPED (won't do).** On inspection the
  hand-rolled listener modules do NOT fit `writable`: `game-mode` passes
  `(next, prev)`, `flask` listeners are no-arg, `character` mutates in place
  (where `writable`'s `Object.is` equality would silently stop notifying). Forcing
  them on risks notification bugs for a marginal consistency gain. Left as-is —
  this is a case where the "unify" is worse than the status quo.
- **Event-factory (separate thread) — effectively complete for the DEALS.**
  `spawnEvent` + fountain/blood-altar/reliquary migrated. The remaining
  interactables are either free (no cost → marginal benefit) or bespoke by design
  (tithe multi-choice sheet, challenge combat-trigger, merchant screen).

Remaining, highest-leverage first: **1a** (particle substrate), **2a** (enemy.ts
split), **2b** (builder.ts prop-kind dispatch), **2d** (finish weapon-pose→data),
**1b** (UI toolkit — needs phone). See phases below.


## The finding in one paragraph

116k lines, **remarkably low rot** (3 stopgaps, 2 TODOs, 1 HACK across the repo).
This is a *consolidation* job, not a cleanup-the-mess job. The debt is three
shapes: **(1)** a handful of GIANT files that bury otherwise-clean systems inside
one closure/function; **(2)** a few concepts with N bespoke implementations that
want ONE shared substrate (exactly like the event-factory we just built); and
**(3)** ~1,300 lines of provably-dead code (unreferenced files + WebGPU-migration
leftovers). Several things the audit expected to be broken are already good and
should NOT be touched: the stat/effect/damage pipeline is single-path; enemy
behaviour is already authored as data; materials/lights are already unified;
DEV-gating is clean and strips from prod.

## Sequencing principle

Delete dead → build the missing substrates → split the giants along their seams →
tidy consolidations → optimize. Each phase is independently shippable and mostly
behavior-preserving; split the risky ones (giant-file splits, UI toolkit) into
per-unit batches with phone verification between.

---

## PHASE 0 — Delete dead code (do first; free legibility)

| Item | Files | ~lines | I/E/R |
|---|---|---|---|
| Unreferenced enemy model file (superseded by `creature()`) | `content/enemy-models.ts` | 886 | H/S/low |
| Abandoned experiment (no exports, no importers) | `level/format-experiment.ts` | 204 | M/S/low |
| Dead GLSL surface-bake path (WebGL-only; CPU port is the live one) | `style/surface-textures.ts:36-188` | ~150 | M/S/low |
| Dead CPU billboard mote path (WebGPU path is the live one) | `effects/drifting-motes.ts` | ~60 | M/S/low |

Verify each with a `npm run build` + grep of `dist` before/after. ~1,300 lines gone,
zero behavior change.

---

## PHASE 1 — Build the missing substrates (the real unification wins)

These are the "N bespoke things → one system" items — highest long-term leverage.

### 1a. Particle-emitter substrate  *(impact: high, effort: L, risk: med)*
~13 effect files (`blood-burst`, `dust-puff`, `parry-spark`, `shatter-burst`,
`breath`, `flung-parts`, `gold-coins`, `xp-wisps`, `status-vfx`, …) each reimplement
the same particle struct + pool + `ensureMat` + gravity/drag integration + cohort
fade (the fade block is copy-pasted verbatim across three of them). Build one
poolable `ParticleEmitter` (pool, `integrate(dt)` with gravity/drag/floor-rest,
cohort fade, shared-material handle) and configure the bespoke emitters from it.
Fold in: route transient sprites through the existing `scene/sprite-batch.ts`
(draw-call win), pull droplet geometry from `scene/geometry-pool.ts` (kills the
per-droplet `new/dispose` in `blood-burst.ts:88`), and extract a `HomingCollectible`
variant shared by `gold-coins` + `xp-wisps` (near-identical today). Collapses ~13
per-frame system registrations toward one.

### 1b. UI form-control primitives  *(impact: high, effort: L, risk: med)*
The sheet chrome (`menu-shell.ts` `createSheet`/`menuButton` + `theme.ts`) is good but
adopted by only 7 screens, and there's **no shared form-control layer** — every screen
hand-rolls `toggle` / `slider` / `statRow` / `section` (`settings-menu.ts` alone has
5 private builders; `addStatRow` is duplicated verbatim between `end-screen` and
`inventory-stats`). Extract `ui/controls.ts` (`toggle/slider/labeledButton/statRow/
section` over `THEME`). Migrate `settings-menu.ts` (1,188 lines, doesn't even use
`createSheet`) first for the biggest payoff, then the stat-row screens. Do it
screen-by-screen (visual-regression risk).

### 1c. Standardize subscribed state on `writable`  *(impact: high, effort: M, risk: low)*
`state/store.ts writable<T>()` is a clean reactive primitive adopted by only 4 files,
while ~11 modules hand-roll their own `new Set<Listener>()` (`state/character`,
`game-mode`, `player/{equipment,reliquary,flask,inventory}`, `controls/keybindings`,
`settings/settings`, `net/delve-net`, `ui/screen-manager`). Convert the hand-rolled
listener-Set modules to `writable` (they already have the subscribe shape). Leave
pure getters (no subscribers) alone. Mechanical, mostly additive.

### 1d. `persist.ts` localStorage wrapper  *(impact: med, effort: S, risk: low)*
~20 files hand-roll `JSON.parse` + fallback + quota try/catch with scattered key
strings. Add `state/persist.ts` (`readJSON(key, fallback)`/`writeJSON`) + a keys
registry; adopt incrementally.

---

## PHASE 2 — Split the giants along their seams

The systems inside these are fine; they're just fused. Split by the concerns the
audit line-anchored. **The event-factory we just shipped is the template** for the
dispatch-table pattern used in 2a/2c.

### 2a. `mobs/enemy.ts` (3,076) — the keystone  *(impact: high, effort: L, risk: med)*
One `createEnemy` closure holds ~40 nested fns + a 745-line `update` FSM. Extract:
`enemy-damage.ts` (takeDamage + stagger/morale/parry), `enemy-ability-runner.ts`
(`runAction`/`selectAbility`/telegraph — already a subsystem, just inlined),
`enemy-movement.ts`, `enemy-perception.ts`, `enemy-death-anim.ts` (`tickDying`'s
~170 lines of collapse math — pure + testable). Lift the FSM's per-state bodies into
a `Record<EnemyState, handler>` table. Make boss-vs-mob a swapped *controller*
(strategy object) instead of the `useIntent` boolean sprinkled through 7 sites.

### 2b. `level/builder.ts` (2,715) — the other keystone  *(impact: high, effort: L, risk: med)*
One 1,800-line `buildLevel` fuses six concerns. Extract `room-shell.ts` (geometry +
bake passes — nearly self-contained already), `level-lights.ts` (light-pool reg +
flicker closures), `level-mobs.ts` (spawnInto/onEnemyDeath/boss wiring), and turn the
huge `prop.kind` if/else ladder (~1,100 lines) into a `Record<PropKind, (ctx,prop)=>void>`
**dispatch table** — so the placeable prop kinds read as a list of data, same shape as
the event-factory. Fold the inline room-clear + boss-phase trackers into `encounters/`
as Behaviors (the registry already says they're "intended to fold in next").

### 2c. `main.ts` (1,791) — phased boot  *(impact: high, effort: L, risk: med)*
~20 init concerns interleaved at module scope. Introduce `boot/` phase modules
(`initRenderStack`, `initLighting`, `initWorldSystems`, `initInput`, `initUiScreens`,
`initDiagnostics` [DEV], `initNetTelemetry`) over a shared `BootContext`; `main.ts`
becomes an ordered await-list. Also concentrates the scattered DEV blocks.

### 2d. `player/weapon-animations.ts` (1,323) — finish a stalled migration  *(impact: high, effort: M, risk: med)*
A 26-case switch dispatches ~30 hand-coded pose fns that are **already being replaced**
by `POSE_SPECS`/clips (`MIGRATED_POSE_KEYS` tracks progress). Finish migrating the
remaining poses to data; move the hand-coded fns to a test fixture
(`weapon-poses.oracle.ts`) so they leave the runtime bundle. Deletes ~1,000 lines
behind the existing pose-equivalence tests. **Guarded by those tests → lower risk
than its size implies.**

### 2e. Lower-urgency splits *(impact: med, effort: M, risk: low-med)*
`ecs/build-model.ts` (1,090 → pull out `model-materials.ts`, `model-reveal-webgpu.ts`,
`model-csg.ts`); `combat/attack.ts` (1,131 → `swing-shape.ts` pure geometry,
`ranged-fire.ts`); `content/enemies.ts` (2,697 → split creature/skin visual specs to
`enemy-creatures.ts`, leaving the stat registry); `content/items.ts` (2,033 → split
weapon-stat types + `rarity.ts` from the `ITEMS` registry); `level/vault-compose.ts`
(1,862 → `vault-repair.ts` reachability passes, `vault-transform.ts`);
`level/tilemap.ts` (980 → pull content-rolls out of the geometry parser);
`style/render-webgpu.ts` (966 → pipeline / warm / capture).

---

## PHASE 3 — Consolidations & doctrine

| Item | Action | I/E/R |
|---|---|---|
| Two files both claim "the one place" for loot (`loot.ts` vs `drop-tables.ts`) | Make `drop-tables.ts` the sole public entry; demote `rollLoot`/`rollCursedItem` to internal helpers; fix the header comments | M/M/med |
| "Encounter" means two things (`content/encounters.ts` packs vs `encounters/` lifecycle) | Rename `content/encounters.ts` → `content/enemy-packs.ts` | M/S/low |
| On-hit status applied via 2 divergent channels (trigger path vs direct `applyBuff` at 5+ sites) | One `applyOnHit(list, target, source)` helper owning the roll+apply | M/S/low |
| Crit + damage-multiplier math inline & duplicated (melee vs ranged) | Extend the tested `combat/damage-math.ts` with `rollCrit` + `composeStrikeDamage` | M/S/low |

---

## PHASE 4 — Optimization (measure-then-fix; all low priority)

- `aggregateSpeed` allocates a fresh array + object per enemy per frame (`modifiers.ts:283`,
  ~1k allocs/sec for a pack on mobile) → walk buffs into out-params.
- Per-droplet geometry `new/dispose` in `blood-burst` → folded into Phase 1a.
- Minor scratch-vector inconsistencies in `attack.ts` fire paths / `enemy.ts` launch.
- Hoist the `?bigfire` `URLSearchParams` read out of the builder prop loop.

The audit confirmed hot paths are otherwise allocation-clean — the codebase already
follows scratch-reuse discipline. Don't chase phantom perf; profile first.

---

## What NOT to touch (verified good)

- Stat/effect/damage pipeline (`combat/modifiers` → `ecs/{buffs,triggers}` → `damage`).
- Enemy behaviour-as-data (`EnemySpec.abilities` + the generic FSM — zero per-enemy branches).
- Material + light registration layers (already unified).
- The content include-flag seam + boot-time validator (already built this session).
- DEV-gating (clean; strips from prod).

## Recommended first moves

1. **Phase 0** (delete ~1,300 dead lines) — an afternoon, zero risk, instant legibility.
2. **Phase 1a + 1b** (particle substrate, UI controls) — the two highest-leverage
   unifications; each is the "one system for N copies" win.
3. **Phase 2a + 2b** (enemy.ts, builder.ts) — the keystones; do the prop-kind and
   FSM dispatch tables so the content layer sees data, not branches.

Everything else slots in as capacity allows. Nothing here blocks new content — but
doing 0 + 1 first makes every subsequent content addition cheaper.
