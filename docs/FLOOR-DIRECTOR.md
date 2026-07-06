# DELVE — The Floor Director

**Status: SPEC, 2026-07-06.** Companion to `GAMEPLAY-CHARTER.md` (the what)
and `LEVEL-PIPELINE.md` (the plan-vs-build refactor this finally justifies).
This governs **floor pacing + loot distribution + the event system** as ONE
layer. Sessions build against it; changes here are design decisions.

---

## The one function

```
resolveFloor(depth, act, history) → FloorPlan
```

Where it sits in the pipeline (`LEVEL-PIPELINE.md`):

```
composeFloor  → what rooms exist        (built: vault-compose.ts)
resolveFloor  → what they MEAN + hold   (NEW — this doc)
buildFloor    → how to draw them        (built: builder.ts)
```

Today `content-budget.ts` is a *proto-director for combat only* — a pure
`floorContentBudget(depth, seed)`. The Floor Director **generalizes it**:
same shape, but it owns three budget lines instead of one, reads room roles,
and remembers the last few floors.

A `FloorPlan` is four decisions: **pacing tier → room roles → three budget
lines → anchored placement.**

---

## 1. Pacing — the floor's rhythm

Three tiers. The floor contract (fight / question / glint) is *modulated* by
the tier, not flat every floor.

| Tier | Delivers | When |
|---|---|---|
| **Lean** | a fight + maybe a question | act openings, early depth |
| **Full** | fight + question + glint | mid-act |
| **Quiet** | **no fight** — a question + dread only | exactly one per act, forced |

Rules:
- **One quiet floor per act, never two in a row.** The quiet floor is what
  makes the next fight land — the paranoia it breeds is the point.
- **Pre-boss floor is always Full** (never lean into the boss).
- Chosen from `depth` + position-in-act + **history**.

**History lives in run state.** Add `floorHistory: FloorShape[]` (or a small
pacing ledger) to `SaveData` in `src/state/run-state.ts` — the only structure
that survives floor-to-floor. `content-budget.ts` currently `void depth`s its
events param and `floor-manifest.ts` has an unused `_depth` — those are the
reserved hooks history threads into.

---

## 2. Room roles — where meaning can live

Every room gets a **job**, assigned in `resolveFloor` by promoting the spine
tags that already exist (`start`/`combat`/`boss`/`exit`):

| Role | Rule (this is where the charter's asks become mechanical) |
|---|---|
| `entrance` | no combat, no event. The safe beat. (Start room is already spawn-excluded — this makes it a *rule*, and extends a gentle first `combat` room so stepping out doesn't swamp you.) |
| `combat` | hosts the fight budget |
| `feature` | hosts the floor's **question** (a deal) or a defining find |
| `sanctum` | the bonfire's **own** room — never shared with a fight or the exit |
| `finish` | bare exit. **No deal, no bonfire, no glint.** It's the way down, not a destination. |
| `quiet` | the deliberate empty dread room (pacing tier `quiet`) |

Safe start, no-major-in-stairwell, and prominent bonfire all fall out of role
rules — not special cases.

---

## 3. The three budget lines

Generalize `FloorContentBudget` (`content-budget.ts:23`) from `{combat,
events}` to **`{combat, loot, event}`**. Each line is a *count* + a
*placement rule*.

| Line | Count from | Placed in | Rule |
|---|---|---|---|
| **Combat** *(built)* | depth curve, hard min 3 | `combat` rooms | trash can take random open cells — it's a fight |
| **Loot** *(new)* | scarce curve; **1 defining weapon guaranteed early** | `feature`/`combat`, on **anchors** | felt loot claims an anchor or doesn't spawn |
| **Event** *(new)* | ~1 question/floor, scaling deeper | `feature`, on an **event anchor** | the floor's *question*; early = survivable-bad, deep = run-threatening |

### The placement law (meaning, not spam)

**Anything the player is meant to FEEL claims an authored MARKER; only trash
mobs get random cells.** If a budget line needs a slot and no marker is free,
the content **doesn't spawn** (scarcity by marker count — you physically can't
get ten altars). "Hands-off to author, hand-placed in feel."

---

## 2b. The authoring model — vague markers, not a content taxonomy

The marker a vault declares is **deliberately dumb**. It does NOT say
"blood-altar" or even "deal" — because the meaningful intent already lives
elsewhere, and a fact should live in exactly one place:

- **The ROOM carries category + flavor.** Its *role* says the category a spot
  may hold (a `feature` room's spots → a deal/find; a `combat` room's → a
  fight). Its *theme/palette* says the flavor (a bloody vault → a bloody deal;
  a merchant never spawns in the gore room).
- **The BUDGET carries how-much / how-rare** (the three lines above).
- **The MARKER carries only WHERE**, plus at most two optional bits geometry
  can't infer:

  ```
  Marker = { col, row, focal?, facing? }
  ```
  - `focal` — is this *the* spot the room is built around (the dais) vs an
    ordinary spot? The one bit that makes the defining find / the deal land on
    the hero spot instead of a corner. Defaults from geometry (dead-end/raised).
  - `facing` — which way it looks (the altar faces the entrance). Defaults to
    the room entrance.

- **FILL combines them:** `room role + theme + budget + marker → content`.

So a vault authors *shape + role + theme + a few dumb markers* and the pipeline
does the rest. This is L4D's model (designers place generic candidate spots;
the Director picks a subset) — NOT a deep per-marker content vocabulary.

**Escape hatch:** truly-fixed content (a story corpse, the safe-room merchant)
stays a **concrete `cellProps` placement**, not a marker. Markers are for the
varied stuff; concrete placement for the fixed stuff.

## 2c. Two content tiers — Defining (fill) vs Furnishing (decorate)

The reason vases/chests feel ad-hoc today is they're lumped with the beats.
Split them:

| Tier | What | Stage | Where |
|---|---|---|---|
| **Defining** | the fight, the deal, the *defining* find, the gold chest | **FILL** | role-gated, budget-sized, onto markers (focal spots), ~one beat/room |
| **Furnishing** | vases, destructibles, minor restock chests, clutter, ambient props | **DECORATE** | **every** room, sized by its space, tuned by its mood |

Vases/destructibles/minor chests are **furnishing** — a per-room DECORATE
density, not floor-budgeted content. The anchored weapon / gold chest is
**defining** — FILL, on a focal marker.

**Mood flows down (fill before decorate):** a room's final mood =
`base theme + whatever event FILL landed in it`. Because DECORATE runs *after*
FILL and reads that mood, the vases come out bloody in the room the blood altar
landed in, the torches tint to match, and furnishing dresses *around* the
resolved content (occupancy grid already enforces this). Events may also
**request** furnishing they need (breakable vases hiding loot, a cobweb seal),
which DECORATE honours — so event + props are integrated by construction, not
hand-authored together.

---

## 4. Loot distribution — the numbers

The roller (`src/content/loot.ts`) is solid; the pool is already
authored-identity-dominant. We add **floor-level accounting** on top, we don't
replace it.

- **Guaranteed defining weapon, early.** Act I early floors force one Loot
  slot to a `weapon` (any `weaponClass`), placed on a `feature` anchor. This
  is the **build seed** — no run is a dud. Same trick as the combat-count
  floor.
- **The "defining find" is anchored, not rolled.** Add a placement lane
  *outside* the per-source weight roll: a Full floor's Loot budget stages one
  high-tier item on a `feature` anchor (the corpse at the dangerous dead-end).
  Discovery-reward, not drop-rate. The scarce-unique direction lives here — no
  need for a new rarity, just guaranteed *placement* of the sparse end.
- **Dopamine = which rung, revealed on inspect.** Rarity already carries
  meaning: `rare` = build-enabling, `cursed` = risk sidegrade, `fabled` =
  run-defining. Keep the tiers; the thrill is not knowing which you found
  until you inspect. "Crappy" = *characterful but not for my build*, never
  "+2 str".
- **Lift the curve into config.** `rarityWeights`/`q` are inline in
  `loot.ts:30-46`; combat's are in `CONFIG`. Move the loot curve into a
  `CONFIG.LOOT` block so it's tunable + LLM-authorable like everything else
  (charter pillar). Tidy, do it with the Loot budget work.
- **Scraps → the rite.** A not-for-you find feeds the scraps→big rite
  (`transactions.ts` grammar), never vendor trash. *(Follow-on.)*

---

## 5. The event system — the floor's question

- **Add the event budget line.** ~1 question/floor, **family by depth**:
  early = `unknown` (fountain, tithe — survivable-bad at worst); deep =
  `bargain`/`trial` (blood altar, challenge — run-threatening gambles). The
  grammar + interactables are all built (`transactions.ts` + `interactables/`);
  this just *budgets and places* them.
- **Retire the per-slot RNG + caps.** Today events are the `?`-slot dice
  (nothing/trap/fountain/altar) + authored vaults + a 3-kind post-hoc cap
  (`floor-manifest.ts`). Replace with budget-driven placement into a
  `feature`-room **event anchor**. Authored deals (merchant in the safe room,
  vault-baked tithe/reliquary) stay explicit; the budget skips rooms that
  already host one.
- **Rob / Read the dead** (charter) slots onto this same line later as a new
  event type — no new machinery.
- **Wire the attention consumer.** Producers already emit
  `transaction:offered/accepted/resolved` on the bus; the **attention meter is
  vaporware** (comment-only, `transactions.ts:8`) and `broadcast/voice.ts`
  doesn't subscribe. The Director is the natural owner: aggregate the
  transaction stream → attention → the voice. *(Follow-on, but the seam is
  half-built.)*

---

## Prior art (deep-research, 2026-07-06 — verified sources)

This model is not invented; it's the shipped playbook. Key confirmed findings:

- **L4D's weapon caches ARE this system.** *"The map designer hand-places many
  POSSIBLE loot locations and the AI Director selects which subset actually
  spawns each run — chosen over pure procedural placement to preserve visual
  storytelling/intent."* (Mike Booth, Valve.) Our markers + fill, verbatim,
  from 2008. Their spots are coarse affordances, not a deep content taxonomy —
  which is why our markers are dumb.
- **Spelunky: guarantee the critical path FIRST, then dress.** Carve a solvable
  entrance→exit path, *then* add non-path rooms; side paths exist only to hold
  treasure; the main path is made visually distinguishable. → our spine
  guarantee + roles.
- **The Riftbreaker: designers paint masks/marks; the generator fills** at
  randomized position/orientation. "Prefabs act as authorable content anchors."
  → our marker + decorate model.
- **Slay the Spire's pity offset** (−5% → +40%, resets on a rare) guarantees the
  good thing eventually without feeling scripted. → the defining-find guarantee.
- **L4D Director = pace, don't difficulty-scale:** a four-state intensity FSM
  (Build Up → Sustain Peak → Peak Fade → Relax) that varies the *frequency* of
  peaks, injects mercy lulls, exempts bosses. Valve called it "procedural
  narrative." → our pacing tier + the charter's "the deep deals the floor."
- **Pure WFC cannot express intent** (local consistency, no pacing/theme); the
  fix is a two-layer graph-grammar (mission) + local fill. The unsolved frontier
  gap — *propagating authored semantic metadata into the generated content* —
  **is exactly our marker→fill seam.** Our LLM authoring layer is the edge.
- **Cost warning:** Unexplored's hand-designed feel came from ~5,000 authored
  rewrite rules. Intent is bought with authoring effort — which is why the LLM
  layer authoring dumb markers against a schema is the affordable path, not
  hand-tuning grammars.
- *Refuted by verification (do NOT trust):* "a player-modelling director is
  measurably better than random" (human study inconclusive); StS's exact
  encounter-keyed rarity table.

---

## Build order (each step ships + is felt on the phone)

1. **Room roles (`resolveFloor` v0).** ✓ DONE. Rooms classified; passes read
   caps not tags; the bonfire settles by role.
2. **Markers + the FILL stage.** ✓ (this pass) Extend anchors → dumb markers
   (`focal`/`facing`); add `floor-fill.ts`; the loot budget's **defining find**
   is staged onto a focal marker via the roller (hint-bounded, deterministic).
   *Felt:* a real reward lands on the dais, different every run.
3. **Event budget.** One question/floor onto a focal marker in a `feature`
   room; retire the `?` fountain/altar RNG + the manifest caps.
   *Felt:* every floor poses one real, staged deal.
4. **Furnishing pass.** Vases/destructibles/minor chests → a DECORATE-stage
   density per room, mood-tuned + event-aware. Move baked clutter out of vaults.
   *Felt:* rooms feel inhabited and coherent, never twice the same.
5. **Pacing + history.** `floorHistory` in run-state; lean/full/quiet.
6. **Follow-ons.** Scraps→rite; attention aggregator → voice; guaranteed early
   weapon (build seed); lift the loot curve into config.

## What we are NOT doing

- **No CSP solver** (the `LEVEL-PIPELINE.md` trap). `resolveFloor` decides and
  throws on invalid plans; it does not negotiate constraints.
- **Not ripping the 9 equip slots** yet — that's a separate build decision
  (see charter loot thread). The Director doesn't depend on it.
- **Not the LLM story layer** (Phase 5). Templated first.
