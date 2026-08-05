# How levels are actually generated: a survey, and what it means for us

Written 2026-08-05, answering Josh:

> *"At some point I'd like to introduce height maps, basically making the floor go
> up and/or down so it's not just flat… isn't there a better way to generate
> levels procedurally than we do? We chose this at first because it was simple but
> I want to know what the research and best games today do to solve these issues
> we had and will have."*

Two halves: **what the field does**, and **what we should do**. The second half
turned out to be dominated by something I found while checking the first — see §4,
which is the part worth reading if you read nothing else.

A caveat on sourcing: several of the best primary sources (BorisTheBrave's
Unexplored breakdown, the Dead Cells postmortem, the PCG Book dungeon chapter,
the Level Design Book) return HTTP 403 to automated fetches. Their search
summaries are cited below and the claims drawn from them are marked; anything
unmarked is from the codebase or from general knowledge and should be treated as
my assertion, not a citation.

---

## 1. The five families, and what each is actually for

Constructive dungeon generation splits into a small number of families. They are
not competitors — the useful systems combine them in stages, each doing the one
thing it's good at.

| Family | Produces | Good at | Bad at |
|---|---|---|---|
| **Space partition (BSP)** | rooms in a subdivided rectangle | guaranteed coverage, no overlap, trivial | everything looks like a subdivided rectangle |
| **Agent / digger** | organic winding corridors | caves, winding, character | control — you can't ask it for a shape |
| **Cellular automata** | blobby organic caverns | natural cave forms, cheap | connectivity, and anything architectural |
| **Graph / shape grammars** | a *structure* that becomes geometry | intent, pacing, locks-and-keys, cycles | needs a second stage to become space |
| **Constraint solving (WFC)** | locally-consistent tilings | local plausibility, "looks like the example" | global rules |

The last two are where the modern work is, and the split between them is sharp
and worth internalising:

**Wave Function Collapse** guarantees that output is *locally* similar to an
example, but local adjacency rules "often fail to capture global solvability
rules, potentially making many such levels unplayable" ([research summary][wfc]).
Fixing that means bolting global constraints back on — multi-layer generation,
distance constraints, or reformulating as an MDP with an external optimiser.
**WFC is a texture algorithm being asked to do architecture.** It is superb for
making a wall look like a wall; it does not know what a level is for.

**Graph grammars** start from the opposite end. You describe the *mission* — the
structure of the experience — and rewrite it until it's detailed enough to become
space. This is the family that knows what a level is for.

---

## 2. Cyclic dungeon generation (Unexplored) — the strongest single idea

Unexplored's generator is the most-cited modern advance, and its core insight is
one sentence:

> Instead of taking linear paths as its most basic structure, **it generates
> everything in cycles from the start**, so good cycles are a *planned feature* of
> the output rather than something that appears by luck ([Game Developer][gd],
> [BorisTheBrave][btb]).

Why cycles matter: a linear dungeon is a corridor with rooms on it. A cycle is a
loop — you go out one way and come back another. Cycles produce, for free, the
things that make hand-made dungeons feel designed:

- **shortcuts and unlocks** — the loop closes back to somewhere you've been
- **alternative solutions** — two paths from entrance to goal
- **ambushes that make sense** — the thing behind you came from the other arm
- **a sense of place** — you re-encounter a room from a new direction

The implementation is a transformational grammar (their tool is Ludoscope, their
language PhantomGrammar): a mission graph is rewritten by developer-authored
rules, then tile grammars turn the graph into actual tiles ([Game Developer][gd],
[Ludomotion][ludo]).

**The transferable part is not the tooling.** It's: *generate the structure as a
graph with cycles, and only then turn it into space.* We already have half of
this — a floor plan with rooms and roles — but our plan is a **chain**, not a
graph, and it has no cycles at all.

---

## 3. The hybrid consensus (Dead Cells)

The other reference point is Dead Cells, which is explicitly a *middle* path: it
uses **hand-made room templates plus a graph describing the level's structure**,
with both differing per stage, and the generator picks a template per graph node
([Deepnight][dn], [Game Developer][dc]).

That is close to what DELVE does today — and it's worth being precise about why
ours underperforms it. Dead Cells' templates carry real hand-authored level design
(platforms, hazards, routes) because it's a 2D platformer where a room's *shape*
is the gameplay. Ours carry a rectangle: 36 of 37 vaults are a bordered box, and
the whole library holds 21 placed props (measured — `LEVEL-ARCHITECTURE.md` §3).
**We adopted the hybrid architecture without the half that makes it pay.**

So: same architecture, and the honest options are to either author templates that
genuinely carry design, or to drop the template half and generate the shapes.
We've chosen the second (§8 of `LEVEL-ARCHITECTURE.md`), and this survey supports
it — for a first-person 3D game, room shape is much cheaper to generate well than
to hand-author, because there is no pixel-precise platforming riding on it.

---

## 4. THE FINDING: we already have verticality, and it doesn't read

Josh asked to "introduce height maps at some point". While checking whether the
codebase could support it, I found that **elevation already exists, is already
active, and is already on the phone.**

`src/level/elevation.ts` — a per-floor ground-height field sampled by the camera,
mobs, loot, effects and interactables. `RoomSpec.elevation`. Ramped corridors.
`CONFIG.ELEVATION_DROP_WEIGHTS`, with a max grade Josh himself signed off from the
phone. And the model it chose is *the right one*:

> Rooms are flat plateaus at their elevation; corridors are ramps lerping between
> the elevations at their two ends. Collision and pathfinding stay 2D — the field
> is presentation truth, not a movement gate. Fights stay on one plane per room
> (doors seal on combat), so combat math, the splat map and the nav grid never see
> a slope.

That is exactly the pattern the multi-level research recommends — discrete floor
plates with explicit vertical connections, rather than a continuous heightfield —
and it is the reason the system has cost us nothing in bugs.

**Measured over 120 generated floors:**

```
rooms at a non-zero elevation      60–75%   (depth 1 → 8)
total elevation range at depth 8   0 to −4.5m
median step between adjacent levels  0.60m
steps below 0.35m (imperceptible)      5%
```

So it is not subtle-by-accident and it is not broken. **Six hundred millimetres
per step, across three quarters of all rooms, four and a half metres of total
descent by depth 8.** And Josh — who plays this on his phone daily — did not know
it was there.

### Why it doesn't read

Because of the one line that makes the system safe:

> **Rooms are internally FLAT.**

All the height lives *between* rooms, and it is delivered as a **ramp along a
corridor**. So the player never sees a height difference — they *walk through*
one. In a dark corridor, in fog, with a torch, a 0.6m rise over an 8m ramp is a
4° slope you cannot perceive. And inside rooms, where all the time and all the
fighting happens, the floor is dead level.

The level-design literature is unambiguous about what verticality is *for*, and
none of it is available to us: height gives **sightlines and tactical advantage**,
and an overview of a space is "the most effective way to quickly get [players] all
the needed information" ([Level Design Book][ldb], [salivity][vert]). Every one of
those payoffs requires **seeing two elevations at once**. A ramp between two flat
rooms delivers height you traverse and never height you look at.

That reframes Josh's request entirely:

> **We don't need a height system. We need the height we already have to become
> visible — and we need some of it to move inside rooms.**

---

## 5. Recommendations

Ordered by payoff per unit of risk. The first two are small and use what exists.

### R1 — Make the existing height VISIBLE (small, do first)

The elevation field already knows every room's plateau. What's missing is
geometry that *shows* the difference:

- **Where a corridor ramps, put a stepped edge on it** — three risers instead of a
  4° slope. A stair reads as height; a ramp reads as floor.
- **Where two rooms at different elevations are adjacent, open a LEDGE between
  them** instead of a door. You stand at the rail and look down into the next
  room. That's the overlook the literature says does the work, and the elevation
  data to place it is already computed.
- **Let the drop be a drop.** A 1.2m step down that you jump/vault rather than
  walk — we already shipped a vault-over-obstacle move.

None of this touches generation. It's builder work reading a field that exists.

### R2 — Height INSIDE rooms, as plates (medium)

Keep "one room, one combat plane" — that invariant is why the system is bug-free —
but let a room contain **two plates joined by steps**, with combat happening on
the larger one. A sunken floor with a raised dais at one end; a walkway above a
pit. This is the single biggest change to how a room *feels* and it's compatible
with everything: collision stays 2D, the nav grid stays flat per plate.

The rule to hold: **plates quantise to 0.6m** (the step the game already uses).
Never a continuous heightfield — that's what makes rooms unwalkable and props
float, and the research's multi-level approaches all quantise for the same reason.

### R3 — CYCLES in the floor plan (medium, biggest structural win)

Our floor plan is a chain. Unexplored's central lesson is that cycles should be
*planned*, not accidental. Adding even one loop per floor gives us shortcuts,
two-way ambushes, and rooms re-entered from a new side — and it costs a graph
edge, not a new system. **This is the highest-value idea in the whole survey and
the cheapest of the three.**

### R4 — What NOT to do

- **Don't adopt WFC.** It's a local-consistency algorithm and our problem is
  global (pacing, reachability, one shop per floor). We'd spend the whole budget
  bolting global constraints back on ([research summary][wfc]).
- **Don't build a continuous heightmap.** The discrete-plate model we already
  have is what the multi-level literature converges on, and it's why elevation has
  never caused a collision bug here.
- **Don't build a mission-graph rewriting language.** Ludoscope/PhantomGrammar is
  a tool for a team authoring many dungeons across many games. We need cycles in a
  plan, which is a graph operation, not a grammar engine.

### The order I'd actually do them

**R1 (see the height we have) → R3 (cycles) → polygon rooms (`LEVEL-ARCHITECTURE`
§8) → R2 (plates inside rooms).**

R1 first because it's a day's work on a system that already runs and it answers
"the floor is flat" without generating anything. R2 last because it's the one that
wants polygon rooms underneath it — a plate is a sub-polygon, and doing it on
rectangles would be building the thing twice.

---

## Sources

- [Unexplored's Secret: 'Cyclic Dungeon Generation' — Game Developer][gd]
- [Dungeon Generation in Unexplored — BorisTheBrave][btb]
- [Graph Rewriting for Procedural Level Generation — BorisTheBrave][btb2]
- [Unexplored 2 Dev Blog: Level Generation — Ludomotion][ludo]
- [The Level Design of Dead Cells: a hybrid approach — Deepnight][dn]
- [Building the Level Design of a procedurally generated Metroidvania — Game Developer][dc]
- [Automatic Generation of Game Levels Based on Controllable WFC — ICEC 2020][wfc]
- [Constructive Generation Methods for Dungeons and Levels — PCG Book, Liapis][pcg]
- [Extending Recursive Backtracking for Multi-Level 3D Dungeon Layouts][multi]
- [Verticality — The Level Design Book][ldb]
- [Vertical Level Design Techniques in 3D Games][vert]

[gd]: https://www.gamedeveloper.com/design/unexplored-s-secret-cyclic-dungeon-generation-
[btb]: https://www.boristhebrave.com/2021/04/10/dungeon-generation-in-unexplored/
[btb2]: https://www.boristhebrave.com/2021/04/02/graph-rewriting/
[ludo]: https://www.ludomotion.com/blogs/level-generation/index.html
[dn]: https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/
[dc]: https://www.gamedeveloper.com/design/building-the-level-design-of-a-procedurally-generated-metroidvania-a-hybrid-approach-
[wfc]: https://link.springer.com/chapter/10.1007/978-3-030-65736-9_3
[pcg]: https://antoniosliapis.com/articles/pcgbook_dungeons.php
[multi]: https://www.researchgate.net/publication/396108479_Extending_Recursive_Backtracking_for_Procedural_Generation_of_Interconnected_Rooms_and_Staircases_in_Multi-Level_3D_Dungeon_Layouts
[ldb]: https://book.leveldesignbook.com/process/layout/flow/verticality
[vert]: https://salivity.github.io/game-development/article/vertical-level-design-techniques-in-3d-games
