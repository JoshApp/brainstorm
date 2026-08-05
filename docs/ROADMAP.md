# DELVE — the working record

The task list is session-scoped, unordered and getting long. This file is the
durable version: what we've decided, what's outstanding, and *why* — so a future
session (or a future Josh) can pick any line up without re-deriving the argument.

**This is the source of truth for intent.** The task list is a scratchpad for
whatever is in flight.

Last reconciled: 2026-08-05.

---

## THE BUILD ORDER

One ordered sequence across all four threads, so "what do we build" has a single
answer. Reasons and alternatives are in the thread sections below; this is just
the order and why each thing sits where it does.

### Shipped 2026-08-05 (live on the phone)

| | |
|---|---|
| **Fear + backstab** | inflictable morale, the bone-skull tell, and the loop: break poise from behind → it panics → its back is yours |
| **Preloading** | CSG build cache (skeleton key 37ms → 2.2ms), CSG specs warmed at boot, a boot bar that stopped measuring a quarter of the wait |
| **Prop claims** | rooms stopped contradicting themselves — 0 arguing rooms at every depth, was 40/220 at depth 3 |

### Next, in order

| # | What | Why here |
|---|---|---|
| **1** | **#137 — make the existing height visible** | Needs no new system and no more decisions. Elevation already runs; it just arrives as a 4° ramp in fog. Step the ramps, open ledges with a drop point, let a 1.2m drop be a drop. You feel it immediately. |
| **2** | **`delve floor-report`** | Every finding today came from a throwaway script. Three significant ones in a day from tooling that doesn't exist — print what a floor actually contains (elevation spread, shapes, claims, cycle count) so the next one isn't luck. |
| **3** | **#138 — cycles in the floor plan** | The strongest idea in the survey and the cheapest. Our plan is a chain; one loop costs a graph edge, not a system. Gives shortcuts, two-way ambushes, rooms re-entered from a new side. |
| **4** | **#131 — polygon rooms** | The big one. Shape grammar, voids as polygon ops, circulation-first masses. Ships in `LEVEL-ARCHITECTURE.md` §8.5 order — polygon room FIRST and alone, because the point is to *look* at a non-blocky room. |
| **5** | **#139 — plates inside rooms** | After #131: a plate is a sub-polygon, so doing it on rectangles builds it twice. Overlook, sunken pit, dais. |
| **6** | **#135 / #136 — chasms as a weapon, falling** | Weapon-weighted shove; falling to the next floor hurt. Shares machinery with the ledge drop from step 1. |
| **7** | **#132 — combination simulator** | The gate on all weapon content. Build before authoring a single relic. |
| **8** | **#133 — wear-or-feed slice** | One basin, one weapon, three foods, no menu — and all three must visibly change the model. |

### The two open questions that need Josh

- **Does feeding a relic consume it permanently?** I lean strongly yes. Still
  unanswered, and it decides whether the weapon economy is real or a formality.
- **Does the polygon-room silhouette look right?** Unanswerable until step 4 puts
  a snap in front of you — which is why #131 ships the shape alone first.

---

## The four active threads

Everything below is one of these. If a new idea doesn't fit one, that's worth
noticing before it gets built.

1. **The level pipeline** — replacing stamped rectangles with a real room generator.
2. **The weapon** — wear-or-feed, and the game becoming about what you feed your blade.
3. **Combat texture** — finishers, chasms, the verbs that make fights feel physical.
4. **Foundations** — loading, tooling, the audit systems that keep content honest.

---

## 1. The level pipeline

Full argument: **`docs/LEVEL-ARCHITECTURE.md`**. Survey of how the field
solves this, and the verticality finding: **`docs/PROCGEN-RESEARCH.md`**. Prior diagnosis (ownership, the
placement authority, why culls are a smell): **`docs/LEVEL-OWNERSHIP.md`**.

### Decided

- **The problem was the handoff.** A vault handed the generator *finished
  geometry*, which is at once too rigid to adapt and too under-specified to
  defend itself — one room, both failure modes. The measurement below then showed
  the handoff wasn't even carrying anything.
- **The ASCII vaults go.** Measured 2026-08-05: 36 of 37 are a bordered rectangle
  with nothing inside, 96% of all tilemap cells are wall-or-floor, and the whole
  hand-authored layer amounts to 21 placed props. There was no composition in
  there to preserve. (This RETRACTS the earlier "keep ASCII, change the alphabet"
  call — see LEVEL-ARCHITECTURE.md §3.)
- **What replaces them is a ROOM GENERATOR, not a better authoring format** —
  LEVEL-ARCHITECTURE.md §8. Rooms become polygons from a small shape grammar
  (spine + lobes − bites + chamfer), voids and obstacles become polygon ops, and
  archetypes are generator parameters.
- **CIRCULATION FIRST.** Compute the paths between doors and to the focus,
  protect them at width, and place masses only in the leftover pockets. This is
  the inversion that makes "obstacles built better" structural rather than tuned —
  a mass *cannot* land on a walk path, because the path was claimed first.
- **Hand-authoring survives only for genuine set-pieces** (harbor, boss arenas,
  tutorial), where form is welded to function.
- **VERTICALITY ALREADY EXISTS AND ALREADY RUNS** (`docs/PROCGEN-RESEARCH.md` §4).
  60–75% of rooms sit at a non-zero elevation, median step 0.60m, −4.5m of total
  descent by depth 8, with ramped corridors and a ground-height field sampled by
  camera/mobs/loot. It doesn't *read* because rooms are internally flat and all
  the height is delivered as a ~4° corridor ramp you walk through in fog. The ask
  is not a height system; it is making the height we have VISIBLE.
- **Cycles beat everything else in the survey.** Our floor plan is a chain.
  Unexplored's central lesson is that cycles are a planned feature, not luck —
  and one loop per floor costs a graph edge, not a new system.
- **Not WFC, not a continuous heightmap, not a grammar engine** — reasons in
  `PROCGEN-RESEARCH.md` §5.
- **Rooms MAY have multiple levels — as PLATES, never walkable-over-walkable**
  (`PROCGEN-RESEARCH.md` §6). Everything spatial here is indexed by (x,z) with no
  layer — NavGrid is a flat `Uint8Array`, and `groundY(x,z)` returns one height.
  Plates (sunken pit, raised dais, a gallery ringing a sunken centre) never ask
  for two answers at one point, so they're a finer lookup in a field that exists.
  A true mezzanine needs a layer index through eight systems, for a floor we
  can't fight on anyway. Most things that LOOK like a second level are plates.
- **Ledges: you can drop, deliberately, never accidentally** (`PROCGEN-RESEARCH.md`
  §7). The rail is a blocker; a marked GAP is the only way over. This is a phone
  game with a thumbstick — backing off an edge you couldn't see is unforgivable.
  The drop buys a shortcut, and it turns the overlook into a real decision: stairs
  put you at the room's edge, the drop puts you in its middle.
- **Height is something you SEE and DESCEND, not something you FIGHT ACROSS.**
  Combat is deliberately 2D and doors seal on combat; embrace that. The best
  vertical moment available is the OVERLOOK — enter on a ledge, see the room
  before you're in it. In a fog-and-torch game that's a genuinely new view.
- **Seven-stage pipeline with a contract**: PLAN → GRAPH → FORM → CARVE → FIT →
  CONTENT → DRESS. *A stage may read any earlier stage and write only its own
  layer.* That rule is what kills the culls.
- **The FIT stage does not exist today.** The tilemap is its frozen output. The
  generator (§8) is what fills that gap.
- **Props have three axes**, and we model one. The missing ones are compositional
  ROLE (mass / furnishing / trace) and CLAIM (tended / abandoned / desecrated /
  flooded / burned). Claims contradict; a room commits to one or two and admits
  only props that support them. That is the difference between a bag of random
  draws and a place.
- **Resolution is per-layer, not one number** (`LEVEL-ARCHITECTURE.md` §7). A
  finer grid buys smaller stair-steps, not smoother rooms — non-blocky comes from
  polygons and chamfers. Placement is continuous; nav is a derived grid.
- **Room generation is the next build**, not an authoring format. §8.5 has the
  order; polygon rooms ship first and alone, because the point is to LOOK at
  one.

### Outstanding

| | What | Why now / why not yet |
|---|---|---|
| ~~#130~~ | Prop taxonomy: ROLE + CLAIM | **SHIPPED 2026-08-05.** 0 self-contradicting rooms at every depth (was 40/220 at depth 3), decoration density unchanged. |
| **#137** | R1 — make the existing height visible (ledges, steps, drops) | **Do first.** Builder work on a field that already runs; answers "the floor is flat" without generating anything. |
| **#138** | R3 — cycles in the floor plan | Cheapest big structural win in the survey. |
| **#139** | R2 — height inside rooms as 0.6m plates | Deliberately after #131 — a plate is a sub-polygon. |
| **#131** | Room generator: polygons, shape grammar, circulation-first masses | The main event. Ships in the order in LEVEL-ARCHITECTURE.md §8.5 — polygon room FIRST and alone, because the whole point is to look at a non-blocky room. |
| — | Stage contract + delete the culls | Falls out of #131. |
| **#73** | Room forms, stitching, merges | **Absorbed into #131** — the shape grammar IS this. Kept for tracking the merge/stitch half, which comes after single-room polygons land. |
| **#124** | Void carves under wells/basins | Ordering bug: carve voids *before* openings. Should fall out of the stage contract. |
| **#39 / #75** | Event placement + organic positioning within rooms | Re-read after #131 — circulation-first placement changes what "organic" means here. |
| **#118** | Summoning sigils as a shared system | Independent; small. |
| **#93** | Trap rework + more trap types | Wants #131's polygon voids first — traps in rifts is the same bug. |

### Known, unfixed

39 spike traps per 150 depth-3 floors still land inside a rift. The path never
consults `freeAt` — suspected: tilemap `^` cells aren't reserved into the
occupancy grid before the carve. Stage-3 territory; documented rather than
papered over.

---

## 2. The weapon

Full argument: **`docs/WEAPON-EVOLUTION-FUN.md`** (Part I: why structure-first
failed. Part II: the spine).

### Decided

- **Every relic can be WORN or FED.** One decision, repeated, no inventory to
  manage — that's the whole economy, and it answers the "inventory management
  isn't fun" objection directly.
- **Feeding either ADDS (a scar) or TAKES FORM.** Taking form is the rarer,
  bigger one: new silhouette, new name, a moveset trait. Boss relics are always
  this.
- **Taking form is a ModelSpec transformation at a named anchor** — cheap for us
  precisely because the models are code. This is the thing that would be
  ludicrous to hand-author, and it's the reason this design is available to us.
- **This is Isaac's synergy discovery in a Souls coat, not Monster Hunter.** MH
  is a known target you farm toward; ours is unknown and the run ends. Optimise
  for *surprise per run*, not progress toward a goal. Keep the narrow MH feeling:
  your weapon is visibly made of what you killed.
- **A precomputed LLM combination graph is a recipe list**, which Part I already
  ruled out. It survives only because outcome depends on the WEAPON as well as
  the food — a small auditable matrix, not a graph.
- **Division of labour with the LLM:** mechanics deterministic and audited; form,
  name and flavour authored by the LLM. It never decides a number.

### Open — needs Josh

- **Does feeding consume the relic permanently?** I lean strongly yes (maximum
  loss aversion; without it, feeding is a free button). Still unanswered.

### Outstanding

| | What | Why now / why not yet |
|---|---|---|
| **#132** | Combination simulator | **Build before authoring any content.** Not for the outliers — for the **dead cells**. Boring is the enemy care alone won't catch. |
| **#133** | Wear-or-feed vertical slice: one basin, one weapon, three foods, no menu | All three foods must **visibly change the model**. If it lands, the rest is authoring. |
| **#110** | Weapon scars S1–S3 | S0 shipped. The delivery changes: forge stays the boring legible option, the basin becomes the interesting one. |
| **#127** | Rework choice basin + cursed offerings | Folds into the above — the basin is already 80% of this shape, aimed backwards. |
| **#125** | Find the fun, not the fiction | The umbrella. Closed by the two docs; keep for tracking. |
| **#81 / #85 / #86** | Fates + trinkets as one domain mechanism; burdens; delver fragments | Downstream of wear-or-feed settling. |
| **#103–#106** | Weapon alignment colours, passive roles, moveset distinctiveness, consumables | Content passes; after the spine. |

---

## 3. Combat texture

### Decided

- **The finisher mechanic already exists** (`CONFIG.EXECUTE`: charged heavy on a
  staggered foe). What's missing is the *ceremony* — contextual tap, distinct
  animation, camera beat. There are now three "this one is open" states with
  overhead tells (staggered, feared, unaware), so the verb has somewhere to live.
- **Chasms should be a weapon.** Weapon-weighted shove gives the hammer a job
  that isn't damage, and makes room geometry part of combat.
- **The player falling should NOT skip a floor.** Skipping rewards a mistake, and
  a pit death on a phone is rage. Better: you fall to the *next* floor, hurt, away
  from the stairs, no bonfire. Not a skip — a fast dangerous descent, and a choice
  a bold player can take on purpose.

### Shipped

- **FEAR** (2026-08-05). Inflictable morale state, a bone skull tell, and the
  loop: break poise from behind → it panics → its back is yours → backstab.
  Backstab rides the additive-surplus lane (DESIGN-METHOD §1) so it's decisive
  without being a delete button.

### Outstanding

| | What | Notes |
|---|---|---|
| **#134** | Finisher ceremony | Risk: an animation lock in a swarm is how you die unfairly. Fast **and** i-framed. |
| **#135** | Chasm shove, mobs die in the void | Closer than it looks: `applyKnockback` exists on the Enemy interface and is never called by the player's swing. `tickKnockback` clamps to walkable — that's the gate. **Trap:** a mob lost to the void must count as a kill for room-clear. |
| **#136** | Player falls → next floor, hurt | Depends on #135's rim-crossing work. |
| **#90 / #77 / #89 / #91 / #92** | Shade-hunter, wall/ceiling climbers, maggot evolution, mimics v2, necromancer | Enemy roster. Independent of everything above. |

---

## 4. Foundations

### Shipped

- **Placement authority** (2026-08-04) — claim-time refusal instead of end-of-run
  culls. The elbow-room sweep survives as the *proof* the rule holds, not the
  enforcement.
- **Preloading** (2026-08-05) — CSG build cache (skeleton key 37ms → 2.2ms),
  CSG-bearing specs warmed at boot, and a four-phase boot bar that stopped
  measuring a quarter of the wait. See `docs/PRELOADING.md`.

### Outstanding

| | What | Notes |
|---|---|---|
| **#129** | Boot is honest now but still slow | `roster-warm` is ~88% of boot. Measure with `scripts/tmp/boot-timing.ts` before choosing a lever — do not guess a phase. |
| **#114** | Ground-item read: description overlaps the prompt, item hidden up close | Player-reported, unfixed. |
| **#116** | Buff/debuff HUD stacking + denser diegetic read | Player-reported, unfixed. |
| **#23** | Unified item-display component | Would absorb #114. |
| **#50** | Feedback → worklist loop | The collector exists; triage doesn't. |
| **#55** | Ambient light sensor → auto brightness | Feature, low priority. |

---

## Banked — good ideas, deliberately not now

These are recorded so they stop re-surfacing as "we should also…" mid-task.

- **#100 Souls as a second currency** — after the weapon spine settles.
- **#101 The Dark Souls death cycle as the roguelike**; find your own past runs.
- **#87 / #88 Domain alignment** biasing spawns; alignment-gated secret rooms.
- **#78 Author full builds first**, then decompose into pieces that are fun alone
  and fun together.
- **#79 The live crowd-authored game** — player feedback → triage → content
  authored by the minute. This is the endgame of the authoring model in CLAUDE.md
  and it depends on the audit systems (#132) existing first.
- **#71 The run-guide NPC** — a chained darkness entity that meets you at gates.
- **#80 Offhand + light source** — buckler/lantern coexistence.

---

## The rules we keep re-learning

Short list; the full versions live in `docs/DESIGN-METHOD.md` and
`docs/LEVEL-OWNERSHIP.md` §4. These are here because they have each cost us a
bug more than once.

1. **Bonuses add, penalties multiply, crit multiplies once.**
2. **Player-controlled condition + multiplicative payoff = broken, always.**
3. **Every audit tool imports the real function; every test feeds the caller's
   real values.** A test that invents its own inputs agrees with the bug.
4. **A final-state check VERIFIES a rule; it does not IMPLEMENT one.** A sweep can
   only delete, never place something better.
5. **A cost denominated in another system's units is a fraction, not a number.**
6. **Brief a role and a ceiling, not a vibe.**
7. **A detector that finds nothing looks exactly like a codebase with nothing to
   find.** (New, 2026-08-05: the CSG walker followed `children`; booleans live
   under `a`/`b`.)
