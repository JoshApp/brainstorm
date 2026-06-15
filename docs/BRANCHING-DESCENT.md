# Branching Descent — Multiple Ways Down

> **STATUS: ACTIVE ITERATION — 2026-06-15.** Not built. Companion to
> `docs/THE-DUNGEON-NOTICES.md` (the compass/tarot thread) and
> `docs/LEVEL-PIPELINE.md`. Tags: **[LEANING]** / **[OPEN]**.

## The premise

Today descent is a single funnel: find the stairs, go down. That makes
*reaching the exit* pure logistics. **Make the exit a choice and it
becomes agency** — the highest-leverage, lowest-cost way to make each
floor a decision instead of a walk. This is the Hades-door / Spelunky-
shortcut move, and it fits DELVE's spine: *going down is the whole
progression metaphor.*

## Exit taxonomy [LEANING]

Three kinds of way-down, each a different point on a risk/reward triangle:

| Exit | Feel | Trade |
|---|---|---|
| **Stairs** | the safe baseline — always present | known, you arrive standing |
| **Trapdoor / shaft** | the *greedy* line | drops you a floor fast, exposed/mid-vault — skips content but skips its *loot* too |
| **Marked / fog gate** | the *noticed* line | richer room beyond, but costs something — a price, or a spike in the dungeon's attention |

**Rules so the choice stays real:**
- **Stairs are always present.** No floor traps you into the risky line.
- **One alternate appears situationally**, varying by depth/act — never
  all three at once (that's noise, not choice).
- **No strictly-dominant exit.** If one is always best, the choice is
  fake. It must be a genuine triangle: safe / deeper-but-exposed /
  richer-but-costly.

## The trapdoor (the first alternate — the proof of concept)

- **Drops you to the NEXT floor**, not a return-trip treasure room.
  A round-trip pocket fights pillar 5 ("delve structure, not
  extraction"). The trapdoor is a *second kind of stairway* — same
  destination, worse footing.
- **You arrive exposed** — mid-room, maybe ambushed, maybe in a vault the
  stairs would never have reached. Treasure can live down there, but on
  the next floor's terms.
- **It looks like the dungeon grabbing your ankle.** The iron grate floor
  models you can already walk on are the asset — a grate that reads as
  solid floor and *isn't* is a perfect grimdark gotcha. (Open question:
  always-telegraphed-and-chosen vs occasionally-a-surprise. Lean: mostly
  *visible and chosen* so it's agency, with rare unmarked ones as cruelty
  — never so often it taxes walking.)

## Tie to the compass [LEANING]

This is the cheap proof-of-concept for `THE-DUNGEON-NOTICES.md`:
**taking the greedy descent spikes your Avarice/Blood Gaze** — the
dungeon notices you took the hungry path, and that bends what it deals
you and says to you. The marked gate might cost *attention* directly. So
the exits aren't just level structure — they're the first actions that
feed the dungeon's read of you.

## Implementation [LEANING]

Reuse the **opening/fitting unification** (see
`project_opening_fitting_unification`): corridor / door / portcullis /
fog-gate / cobweb all install via one `spawnFitting(opening)` drain. A
trapdoor is just a **new `OpeningSpec`** — no new placement code. The
boss-gate position is already derived from `placeDir`; alternate exits
slot into the same machinery.

## Version one [LEANING]

1. **Stairs stay the default** everywhere.
2. **Add the trapdoor as the single alternate exit type**, introduced
   only **deeper in the descent** (Josh: "start simple… later in the
   descent") — a certain depth/act gate, not floor 1.
3. Build it as one `OpeningSpec`; it descends, lands you exposed.
4. **Feel it on the phone first.** Only add the marked/fog gate as a
   third exit if the two-way fork actually lands as a decision.
5. The compass spike (Avarice/Blood Gaze on greedy descent) can come
   with the compass system — not required for the first feel test.

## Open questions

- **Telegraphed vs surprise** trapdoors (agency vs cruelty — see above).
- **How often** an alternate exit appears (every floor past depth N? a
  chance? authored per vault?).
- **What's down there** — is the trapdoor's floor a normal procgen floor
  entered awkwardly, or a special "you fell" vault flavor?
