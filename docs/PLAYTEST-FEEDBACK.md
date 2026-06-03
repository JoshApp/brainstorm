# Playtest Feedback — triage & plan (2026-06-03)

A friend's playtest. Grouped, tagged, and ordered so we clear it one item
at a time. Tags: **[bug]** broken, **[bal]** tuning, **[ux]**, **[feat]**
new system, **[content]**, **[?]** needs a decision (talk first).

Everything is interrelated — balance numbers must be read in synergy (a
reach nerf + an AoE nerf + a stamina gate all change how strong charged
multi-hit is, etc.). Don't tune one in isolation.

---

## A. Weapon & combat balance
- [x] **[bal]** Spear reach **3.0/2.85 → 2.5/2.4** (still the longest melee, but
  trimmed toward the comfortable saber baseline). Dagger short reach kept. *(done)*
- [ ] **[bal]** **Crossbow + wand are way too strong** — no ammo, high damage,
  basically no drawback. Need a real cost (ammo? longer reload? the recover
  isn't enough). Ties to the stamina **[?]** below.
- [ ] **[?][bal]** **Charged attack is the meta** — too strong. Either nerf the
  charge bonus, or gate it behind **stamina** (see F).
- [x] **[bal]** **Multi-hit** trimmed: sword + dagger BASIC chains are now
  single-target; cleave kept on strafe SWEEPS, hammer side-swings/smash,
  the scythe (its identity), and charged moves. *(done)*
- [ ] **[bal]** **AoE hits everything** — needs a cap / falloff so an AoE
  doesn't clip every enemy + every prop in a wide radius.

## B. Projectiles (needs a rework)
- [x] **[bug]** Projectiles **stuck/eaten on low props** — the tick used the 2D
  `contains()`, killing any shot over a prop's footprint. Now uses the
  height-aware `containsProjectile()`. *(done)*
- [x] **[bug]** Shots **now reach enemies behind a low vase** — vases carry
  height 0.6, the shot flies over (height-aware), and auto-aim LOS is
  walls-only so the enemy is still locked. *(done)*
- [x] **[feat]** Projectile collision is now height-aware end-to-end; the prop
  collision-shape type gained an optional `height` so any low structural
  prop can let shots over too. *(done)*

## C. Stats & scaling
- [x] **[bug]** **Stats don't re-apply** — root cause: the run save persisted
  hp/inventory/equipment/xp but **NOT character state**, so on reload/resume
  attributes + proficiencies reset to baseline (your build vanished). Now
  the save carries the character (serializeCharacter at floor entry,
  hydrateCharacter on resume); death still wipes it. *(done)*
- [x] **[bal]** **Grit** +3 → **+2** max HP/point. *(done)*
- [x] **[bal]** **Lifesteal** reworked: per-hit drain → **chance-on-kill** proc
  (item % = chance, heals CONFIG.LIFESTEAL_ON_KILL_HEAL). *(done)*
- [x] **[ux]** Weapon card now shows **"Scales Might B"** (the scaling attr +
  grade). *(done)*

## D. Item balance
- [ ] **[bal]** **Rings inconsistent** — some give flat damage, some only
  conditional. Normalise so picks feel comparable.
- [x] **[bal]** **Regen potion** (steady-tonic) 6s → **3s** (~13 HP → ~7). *(done)*
- [ ] **[bal]** General **item balance pass** once the above land.

## E. Inventory UX
- [x] **[ux]** **NEW items** flagged: orange NEW badge + sorted to the top of
  the bag (cleared once viewed). *(done)*
- [x] **[ux]** **Item icons** 32px crunchy → 48px smooth (source render 96→128,
  antialiased); bag is now one-per-row with FULL names. *(done)*

## F. Movement & stamina  [?] — the big design fork
- [ ] **[?][feat]** **Stamina system?** Friend wants **sprint / dash-dodge**,
  and charged-attack/ranged spam needs a drawback. Stamina could gate all
  three. Question: **feasible on mobile without cluttering the HUD?**
  (a thin stamina ring under the reticle / round the joystick, auto-hiding
  when full?) Decide before touching charged-attack/ranged/dodge balance.

## G. Level / world bugs
- [ ] **[bug]** **Props float above carved holes** — prop placement doesn't
  account for the floor holes (related to the boss-hole carving). Don't
  place props over hole cells.
- [x] **[bug]** **Arena door never reopened** — root cause: a wave cleared
  only when every spawned mob was *dead*, so one unreachable mob (fell in a
  hole / slipped an entrance / wedged on a prop) froze the gate forever.
  Fixed (arena-waves.ts): a mob also counts as resolved if it *escaped the
  arena bounds*, plus a 75s hard-timeout backstop. *(done)*
- [ ] **[bug]** **Arena gate only sealed ONE random entrance** — proper fix is
  level-gen (seal ALL openings of an arena room on engage, reopen all on
  clear). PARTIALLY mitigated by the escape-resolve above (an escapee no
  longer soft-locks), but the seal-all-entrances is still TODO (overlaps the
  procgen/vault layer — coordinate).
- [~] **[bug]** **Levels lost on reload** — the save DOES store `floorId` +
  `depth` and resume loads them; the big real loss was the character (fixed
  above), which made a reload *feel* like a wiped run. Resume restores at the
  saved floor's START (checkpoint-at-floor-entry, by design — mid-floor
  position/cleared-rooms aren't kept). If a genuine floor-NUMBER regression
  remains (e.g. resumes at floor 1 when you were deep), need a repro. Mostly
  addressed; mid-floor resume = a bigger feature if wanted.

## H. Save & main menu
- [x] **[bug/ux]** With a run ongoing, **CONTINUE is now the prominent
  button**; starting anew is a muted "NEW RUN" behind a confirm. *(done)*
- [x] **[feat]** **Accidental run deletion** → "ABANDON RUN?" confirm before
  wiping (safe "keep" is the prominent choice). Save slots deferred. *(done)*

## I. Content
- [ ] **[content]** Promote the **new skeleton boss to the Floor-2 boss.**

---

## Proposed order (bugs → balance → UX → features)
1. **Quick correctness bugs** (data-loss + blatantly broken): levels-lost-on-
   reload, stats-don't-reapply, CONTINUE-prominent + wipe-confirm, arena
   gate (all entrances) + door-reopen, props-over-holes.
2. **Projectiles** (B) — behind-prop / stuck (their own rework).
3. **Balance tunes** (mostly config): grit HP, spear reach, regen potion,
   lifesteal rework, crossbow/wand, multi-hit, AoE — tuned *together*.
4. **Inventory UX** (E): new-flag/sort + bigger icons; scaling clarity (C).
5. **Skeleton boss → Floor 2** (I).
6. **Stamina + sprint/dodge** (F) — the feature, after the design decision.
7. Item balance polish (D) last, once systems settle.

## Decisions (resolved 2026-06-03)
- **Stamina: YES.** A stamina pool gates charged attacks + ranged shots +
  the new sprint/dash-dodge. Mobile HUD: a thin auto-hiding gauge (ring
  around the joystick or under the reticle). Built LAST (step 6); the
  charged-attack/ranged nerfs hang off it.
- **Run deletion: confirm prompt** (CONTINUE prominent when a run is live;
  "abandon run?" confirm before DESCEND wipes). Save slots = later, maybe.
- Starting with the **correctness bugs** (step 1).

## Still to decide (when we reach them)
- **Multi-hit philosophy** — which exact attacks may cleave.
- **Projectile rework scope** — fix the LOS/collision height test, or broader.
