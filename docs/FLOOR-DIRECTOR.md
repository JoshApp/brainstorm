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

**Anything the player is meant to FEEL claims an authored anchor; only trash
mobs get random cells.** Vault anchors exist today but only `kind: 'fire'` is
used (`vault.ts:163`; `loot`/`event`/`shrine` are stubbed comments) — light
those up. If a budget line needs a slot and no anchor is free, the content
**doesn't spawn** (scarcity by anchor count — you physically can't get ten
altars). This is the "hands-off to author, hand-placed in feel" tiled
solution.

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

## Build order (each step ships + is felt on the phone)

1. **Room roles (`resolveFloor` v0).** Promote spine tags to roles; enforce
   the role rules. No new content — pure placement discipline.
   *Felt:* safe start, clean exit, the bonfire gets its own room.
2. **Loot budget + the anchor lane.** Extend anchors to `loot`; add the Loot
   budget with the guaranteed early weapon + one anchored defining find per
   Full floor. Lift the curve into config.
   *Felt:* every run gets a build seed; finds read as placed, not sprayed.
3. **Event budget.** One question/floor into a `feature` event anchor; retire
   the `?` fountain/altar RNG + the manifest caps.
   *Felt:* every floor poses one real, staged deal.
4. **Pacing + history.** `floorHistory` in run-state; lean/full/quiet; one
   quiet floor per act.
   *Felt:* rhythm — and the dread of the fight-free floor.
5. **Follow-ons.** Scraps→rite conversion; attention aggregator → voice; the
   config-lifted curve tuned by the content layer.

## What we are NOT doing

- **No CSP solver** (the `LEVEL-PIPELINE.md` trap). `resolveFloor` decides and
  throws on invalid plans; it does not negotiate constraints.
- **Not ripping the 9 equip slots** yet — that's a separate build decision
  (see charter loot thread). The Director doesn't depend on it.
- **Not the LLM story layer** (Phase 5). Templated first.
