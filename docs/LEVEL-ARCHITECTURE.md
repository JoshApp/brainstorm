# The level pipeline, reauthored: compositions, not tilemaps

Written 2026-08-05. Supersedes the "keep the ASCII vaults" recommendation in
`LEVEL-OWNERSHIP.md` §2 — that document's diagnosis of *ownership* still stands
and its placement authority shipped, but its conclusion about the vault format
was too conservative. Josh:

> *"Honestly I think we've outgrown the ASCII vaults, they don't provide us
> anything. Right now we do a mix of both and it's like the worst of both — we
> end up with inflexible rooms that carry random pillars inside."*

That last clause is a better diagnosis than the one I wrote yesterday, and it
changes the recommendation.

---

## 1. Why the mix is worse than either half

Yesterday I framed the problem as ownership: seven producers, one grid, rules
re-enforced by culls. True, and fixed at claim time. But it does not explain why
a *hand-authored* room ends up with a pillar in the middle of it, which is the
thing you actually see on the phone.

The real answer is that the two halves trade in the wrong currency.

**A vault hands the generator FINISHED GEOMETRY.** Finished geometry is
simultaneously:

- **too rigid to adapt** — the room is a fixed rectangle with fixed contents, so
  when the floor plan needs a shop, the generator promotes a combat vault and
  inherits its monsters, its size, and its pillar placement; and
- **too under-specified to defend itself** — the tilemap says `#` (wall) and `.`
  (floor). It never says *"this is the approach to the altar, keep it clear"* or
  *"this hall reads as one long sightline, don't break it."* So the decorators,
  which cannot see intent, drop a pillar in the middle of the composition.

Both failure modes at once. That is precisely "the worst of both": it can't
change, **and** it can't protect itself.

Notice that neither failure is caused by hand-authoring, and neither is caused by
procedural generation. They're caused by the **handoff**. A tilemap is a lossy
format for the thing an author actually knows.

### What a hand-authored room actually knows, that the tilemap throws away

When you author a vault, you know things like:

- this is a **long hall**, and its length is the point
- the **dais at the far end** is where the eye goes
- the **floor is broken down the middle** and the two sides are separate routes
- **something important stands on the dais**, facing the entrance
- the columns are **rhythm**, not obstacles

The tilemap preserves exactly one of those: it freezes the columns into cells.
Everything else — the intent, the hierarchy, the reason — is lost at author time,
which is why every downstream pass has to guess.

---

## 2. The change: author COMPOSITION, not TILEMAP

A vault should stop being geometry and become a **composition**: a statement of
what the room *is*, at a level of abstraction the generator can fit to a real
rect and the decorators can read.

A composition declares, and declares **only**:

| It declares | It does NOT declare |
|---|---|
| **shape family** — long hall / chamber with apse / ring / broken floor / cells | exact wall cells |
| **masses** — regions where architecture sits, as regions with a rhythm | which prop a mass is |
| **voids** — regions where floor is missing | the exact rim |
| **slots** — "an event belongs here, facing this way, needing this apron" | which event |
| **combat slots** — where a fight is meant to happen, and its shape | which enemies |
| **focus** — where the eye should go | lighting |

Then the machine does the rest:

- **fits** the composition to whatever rect the floor plan gave this room (a long
  hall composition works at 8×20 or 6×14 — it scales, because it's a relation,
  not a grid)
- **skins** the masses from the floor's theme (a mass is a pillar on floor 2, a
  stalagmite on floor 6, a stack of crates in a storeroom)
- **fills** the slots from the floor's plan (the floor owes the run a shop → the
  shop goes in the slot whose shape and apron suit a vendor)
- **dresses** last, knowing every claim already made

This is not "the mix". The mix is two systems producing the same kind of output
and stepping on each other. This is a **clean layering**: the author states
intent, the machine states matter. Each is doing the thing it's good at.

### What this buys, concretely

- The **same composition** produces a different room every time it appears —
  different size, different skin, different contents. Twelve compositions
  out-vary thirty-seven frozen vaults.
- **Promotion becomes safe by construction.** A shop isn't a combat vault with
  its monsters culled; it's a composition whose combat slots were never filled.
  The three culls in `vault-compose.ts` stop having anything to delete.
- **Decorators can't ruin a composition**, because the composition told the
  placement authority what to protect *before* they ran.
- **The content layer's job gets easier, not harder.** Writing "long hall, dais at
  the end, broken floor down the middle, one event on the dais" is a smaller and
  more natural thing to author than a 20×8 character grid — and it's much harder
  to author *badly*.

---

## 3. Do we keep ASCII? No — and the measurement is one-sided

**Retraction.** The first version of this section argued "we have outgrown the
ASCII vaults, we have not outgrown ASCII" — keep the sketch, change the alphabet
to intent marks. Josh pushed back:

> *"What do we actually gain by the vaults today, do they actually carry
> anything? I don't care if the things can be diffed or whatever… it feels like
> all the ASCII rooms give us now is almost nothing, or am I wrong there? I've
> never seen them, I just felt obsoletion and collision from it."*

He is not wrong. I defended the format's *legibility* without first checking
whether it was carrying anything worth reading, which is the same mistake as
optimising a function nobody calls. So I measured all 37 vaults:

```
vaults                                       37
total tilemap cells                       4,519
  wall / floor / blank                     96.1%
  everything else                           3.9%   (vases 2.2%, enemy slots 1.0%,
                                                    traps, doors, stairs, start)
vaults whose map is a PLAIN RECTANGLE     36 / 37
vaults carrying ANY hand-placed prop      12 / 37
total hand-placed props, ALL vaults          21   (0.6 per vault)
```

Read that again: **thirty-six of thirty-seven vaults are a bordered rectangle
with nothing inside.** The entire hand-authored layer of this game amounts to
**37 rectangle sizes, 44 enemy-slot cells, 101 vase cells and 21 placed props** —
and the sizes cluster hard in 10–14 wide by 6–9 deep, so even the rectangles are
nearly the same rectangle.

There is no composition in there to preserve. The library is a generator wearing
37 rectangles as a costume, and every interesting thing in a finished room —
the debris, the masses, the light, the events, the traps — is placed by code
afterward. That is why "obsoletion and collision" is exactly what it feels like:
the vault contributes a shape the generator could have picked, and then collides
with the passes that do the real work.

**So the vaults go.** Not "keep the notation, change the alphabet" — there is
nothing to notate. What replaces them is not a better authoring format; it is an
actual room generator (§8).

**What survives hand-authoring:** the genuine set-pieces, where form is welded to
function and a generator would be actively wrong — the harbor, the boss arenas,
the tutorial chamber. That is a handful of rooms, authored as real geometry
because they are real geometry, not as a library the generator draws from.

## 4. The staged pipeline

Josh's proposed staging, made concrete and given the contract it was missing.

| # | Stage | Owns | Reads |
|---|---|---|---|
| 0 | **PLAN** | what this floor owes the run: beats, combat budget, one shop, one trove, the boss | act, depth, run state |
| 1 | **GRAPH** | rooms and connections as a graph, each with a ROLE. No geometry yet. | plan |
| 2 | **FORM** | each room's actual shape; stitching, merging, non-rectangular edges | graph |
| 3 | **CARVE** | voids first, then openings between rooms | form |
| 4 | **FIT** | apply each room's composition into its real shape: masses, slots, focus | form, carve |
| 5 | **CONTENT** | events into slots, enemies into combat slots, loot | plan, fit |
| 6 | **DRESS** | decoration, traces, light | everything |

**The contract, stated once so it stops being implicit in statement order:**

> **A stage may READ any earlier stage and WRITE only its own layer. No stage may
> modify an earlier stage's output.**

That single rule is what kills the culls. A cull exists because a late stage
found an earlier stage's mistake and could only delete it. If stage 5 cannot
write geometry and stage 6 cannot write content, there is nothing to reconcile.

**Ordering notes that are load-bearing and were previously accidental:**

- **Voids before openings** (within stage 3). Carve the chasm first, then cut the
  doorways, so an opening can never land on a rim. Today this is the other way
  around in one path, which is why 39 spike traps per 150 depth-3 floors still
  land inside a rift.
- **Focus before light** (4 before 6). The lighting doctrine says an uncommon
  light means something is happening there — so light must be placed by something
  that knows where the *something* is.
- **Claims before traces** (4 before 6). See §5.

### Where the code actually sits on this ladder today

Being honest, because the plan is only useful against a true starting point:

| Stage | State |
|---|---|
| 0 PLAN | **exists** — `acts.ts`, `room-types.ts`, role assignment |
| 1 GRAPH | **partial** — procgen builds a chain, not a graph; adjacency is implicit |
| 2 FORM | **rects only** — no merging, no shaping. This is where "nicer forms" lives, and it's untouched |
| 3 CARVE | **exists, mis-ordered** in at least one path |
| 4 FIT | **DOES NOT EXIST** |
| 5 CONTENT | **exists, scattered** across several producers |
| 6 DRESS | **exists**, and as of 2026-08-04 goes through the placement authority |

**Stage 4 is the missing one, and it is the whole problem.** Today the tilemap
*is* stage 4's output — computed at author time, frozen, and unable to respond to
anything stages 0–3 decided. "Inflexible rooms that carry random pillars" is the
exact symptom of a missing fit stage.

**So the recommendation is: build stage 4.** Everything else on this list is
reordering and tightening work that gets much easier once compositions exist.
Stage 2 (nicer forms, edge stitching) is the visual payoff and should come
*after* — it's far cheaper to fit a composition into an irregular room than to
fit a frozen tilemap into one.

---

## 5. Classifying props so the generator knows when to use them

Josh's sharpest question:

> *"About things like cobwebs, candles, pillars, general decoration — I don't know
> how we can class these props so the generator knows where and when to use them.
> I feel like if we do this right it can evolve into something that can craft
> procedural rooms that are not boring."*

There are **three orthogonal axes**, and we currently model only one.

### a) Physics — what it does to movement and sight

Blocks movement / blocks sight / neither. This is `PlaceKind` in
`placement-authority.ts` and it's fine. Keep it.

### b) Compositional role — what it is to the room's shape

- **MASS** — reads as architecture. Pillars, statues, fallen columns, rubble
  banks, stalagmites. Placed by stage 4 *as part of the composition*, with rhythm.
- **FURNISHING** — a deliberate object someone put there. Braziers, benches,
  tables, racks, cages. Placed by stage 5/6 and implies agency.
- **TRACE** — evidence of history. Cobwebs, stains, scorch, dust, bones, cracks.
  Placed by stage 6, never structural, and the cheapest way to make a room feel
  used.

Today a pillar and a cobweb are both "props" and both get scattered by a
decorator. That single conflation is why hand-authored rooms grow random pillars:
**a mass is a composition decision being made by a decoration pass.**

### c) CLAIM — what its presence asserts about the room

This is the axis we have nothing for, and it's the one that makes rooms not
boring.

Every prop implicitly claims something:

| Prop | Claims |
|---|---|
| lit candle, swept floor, fresh torch | **tended** — someone is here, or was recently |
| cobweb, dust, collapsed shelf | **abandoned** — nobody has been here in a long time |
| blood, broken idol, scattered bones | **desecrated** — something happened here |
| standing water, rot, pale growth | **flooded** |
| scorch, ash, cracked stone | **burned** |

**Claims contradict.** A candle says someone tends this place; a cobweb says
nobody has. Put both in a room and the room stops meaning anything — it becomes a
bag of props rather than a place.

That contradiction is *exactly* the bug already reported: **"the merchant stands
inside his own cobwebs."** I patched it yesterday with a feature apron, and the
apron was the right patch — but the real fault is that a *tended* claim (a living
vendor) and an *abandoned* claim (webs) were allowed in the same room at all.
Distance was never the point.

### The rule

> **A room commits to one or two CLAIMS, and then only admits props that support
> them.**

This is the whole answer to "how do we craft procedural rooms that are not
boring." A boring procedural room is a set of **independent random draws**. An
interesting room is a set of **evidence for one story**. Same prop count, same
generator, completely different read — because everything in it agrees.

It also delivers the "skinned live" idea for free. A composition says *mass*; the
room's claim plus the floor's theme decide whether that mass renders as a carved
pillar (tended), a fallen column choked in webs (abandoned), a blood-slick altar
stone (desecrated), or a fused slag pile (burned). **One composition, four rooms,
no extra authoring** — which is the payoff Josh is after when he says vaults
should be "skinned live".

And the existing `room-signature.ts` — which retints a room's torches by its role
— turns out to be this same idea applied to light alone. It works. Generalising
it from light to props is the move.

---

## 6. What I recommend, in order

1. **Prop taxonomy first** (b + c above). It's small, it's pure data, it needs no
   pipeline change, and it *immediately* improves rooms via the decorator that
   already exists — a decorator that respects claims produces better rooms today,
   before any of the rest lands. It's also the vocabulary every later stage needs.
2. **Stage 4: compositions.** Build the fit stage and the composition format.
   Convert a handful of vaults, run both systems side by side, compare on the
   phone. Do not convert all thirty-seven up front.
3. **Write the stage contract** into the pipeline and delete the culls that become
   unreachable.
4. **Stage 2: form and stitching.** Non-rectangular rooms, merges, organic edges.
   The visual payoff, and much cheaper once compositions can fit an odd shape.

### What NOT to do

- **Don't build a constraint solver.** The failure is a missing abstraction level,
  not insufficient cleverness, and a solver makes floors harder to author and much
  harder to debug.
- **Don't convert the vault library in one pass.** Compositions are a new
  authoring language; the first three will teach us what it's missing.
- **Don't do stage 2 first**, however tempting. Nicer room shapes with frozen
  tilemaps inside them is more of the same problem, wearing a better silhouette.

---

## 7. Resolution — the grid is coarse because it is doing three jobs at once

Josh, 2026-08-05:

> *"I hate about the ASCII vaults that they are so coarse. I originally wanted
> pixel vaults but I'm honestly open to anything — I just feel like we could use
> finer grids for placement as well as all the other things you and I deduced."*

The diagnosis is right. The remedy needs one correction first, because it's the
kind that wastes a week.

### A finer grid gives you smaller stair-steps, not smoother rooms

The 1m grid is most visibly wrong at **wall edges and void rims** — everything is
blocky. The instinct is to shrink the cell. But a 0.25m grid produces 0.25m
stair-steps: sixteen times the cells, the same *character* of edge, and an ASCII
sketch 80 characters wide for a single 20m room — which destroys the one property
the format was kept for.

Blocky edges are not a resolution problem. They're a **representation** problem: a
grid can only ever produce axis-aligned steps. A diagonal wall, a curved apse, a
rim that isn't a staircase all want a **polygon**, at any resolution.

So shrinking the cell pays 16× the cost for none of the thing actually wanted.

### The real fault: one grid is doing three unrelated jobs

The 1m grid is currently the authoring notation, the placement system, **and** the
collision/nav structure. Those three want *opposite* resolutions, which is why any
single number is wrong:

| Job | Wants | Why |
|---|---|---|
| **Authoring** | COARSE (~1m) | You're indicating intent — "a mass row along here", "void down the middle". Nobody wants to hand-place 32 pixels of pillar, and a coarse sketch is what keeps it glanceable, diffable and LLM-writable. |
| **Placement** | CONTINUOUS (float metres) | A candle in a corner, a pillar rotated 0.3 rad, a slot facing the door. Snapping any of this to *any* grid is what makes rooms read as stamped. |
| **Collision / nav** | FINE (~0.25m), **derived** | Here a fine grid genuinely helps — tighter pathing, mobs that fit between a pillar and a wall. But it should be **baked from the geometry**, never authored. |

The existing vault format already half-admits this. It carries an escape hatch:

> *"Optional precise-placement props in VAULT-LOCAL world coordinates … use this
> for anything the 1m grid can't place precisely: rotated fountains, altars off
> grid centre…"*

That hatch exists because the grid was already too coarse for the things that
matter, and it is used for exactly those things. That's evidence, not theory.

### The decision

**Three resolutions, each where it belongs. Placement stops using a grid at all.**

1. **Authoring sketch stays coarse (~1m) — and that is a feature.** In the
   composition model it isn't placing objects any more, it's indicating regions
   and slots. Coarse is the correct precision for intent.

2. **Placement is continuous.** The FIT stage resolves a composition into float
   world positions with rotation and per-room seeded jitter. This is also what
   makes the same composition produce a different room each time it appears — the
   variation is *free*, and it only exists because nothing snaps.

3. **Nav/collision is a fine derived grid**, baked from the finished geometry.
   Authored by nobody.

4. **Room outlines become polygons (rect unions), not cell sets.** This is what
   actually delivers non-blocky rooms, diagonal walls, merged chambers and rims
   that aren't staircases — and it's stage 2's job (`#73`). A polygon can be
   chamfered and merged; a cell grid can only be re-sampled.

The net effect is that "resolution" stops being a number we argue about. The
sketch is low-res *on purpose*, the world is continuous, and the nav grid is an
implementation detail.

### On pixel vaults specifically

The original instinct is closer to right than it sounds — an ASCII map **is**
already a pixel grid where characters are the pixels. What was wrong was never
the medium; it was that a pixel meant *an object at 1m* instead of *intent over
a region*.

If drawing rooms in an image editor is a better authoring experience than typing
them (it plausibly is, for shapes), that's worth having — but the **canonical
format should stay text**, because a PNG can't be diffed, can't be reviewed in a
terminal, and can't be written by a content layer. The way to get both is a
bidirectional converter: draw in any pixel editor, convert to the text sketch,
and the text is what the repo stores.

Worth building **only if** the text sketch turns out to be annoying to author in
practice. Not up front — it's a workflow convenience, and it can be added at any
time without the pipeline knowing.

---

## 8. The room generator

Josh, after the measurement in §3:

> *"I don't want finer steps, I want the rooms to feel less blocky and walk paths
> and obstacles to be built better… I really want a nice room generator."*

Three named wants — **less blocky**, **better walk paths**, **obstacles built
better** — plus one implementation complaint that turns out to be the same
problem: *"voids and obstacles are just annoying to code in the grid."*

All four have one root. **A grid is the wrong representation for a room.** Not
too coarse — wrong in kind. Everything below follows from replacing it.

### 8.1 A room is a POLYGON

The floor becomes an orthogonal polygon (with optional chamfered corners), built
by a tiny shape grammar rather than authored:

```
spine          one rect, the room's main axis
+ lobes        1-3 more rects unioned onto it — alcoves, transepts, a wider end
- bites        0-2 rects subtracted from corners — a notch, a collapsed corner
~ chamfer      convex corners cut at 45 degrees — the diagonal walls
```

That is maybe a hundred lines and it produces L-rooms, T-rooms, rooms with an
apse, rooms with a bitten corner, halls that widen at one end. **Non-blocky comes
from the chamfer and the union, not from smaller cells** — which is the §7 point
arriving where it actually pays.

There is a landing zone for this already: the builder consumes
`WallSegment { ax, az, bx, bz }` for floor-wall contacts and collision, so walls
are *already* line segments downstream. Only generation is rect-shaped
(`buildRoomShell` reads `rect.w` / `rect.d`); the consumers do not care. A polygon
room emits the same segment list with more segments in it, some of them diagonal.

### 8.2 Voids and obstacles are polygon ops, which is why they stop being annoying

Josh's implementation complaint is the honest one. In a grid, a void has to be
rasterised into cells, and then every downstream pass re-tests cells and each one
grows its own idea of the rim (`VOID_MARGIN` here, `LIP = 0.35` there, a
`freeAt` that one producer forgets to call). That is where the 39 spike traps in
rifts come from.

As polygons it collapses to one thing:

```
floor      = outline − voids − obstacle footprints
walkable(p) = pointInPolygon(p, floor)
```

One predicate. Continuous, no resolution, no margin constants, no rasterisation,
and no way for a producer to "forget" — because there is nothing else to ask.

### 8.3 The bit that actually makes rooms good: CIRCULATION FIRST

This is the answer to "walk paths and obstacles built better", and it's an
inversion rather than a tuning.

Today obstacles are scattered and the walk paths are whatever is left over. So a
pillar can land in the one line between two doors, and nothing notices. Turn it
around:

1. **Compute circulation first.** The paths between every pair of doors, and from
   each door to the room's focus (its centrepiece). This is a handful of
   shortest paths through an empty polygon — cheap.
2. **Widen them into protected corridors** of a minimum walkable width (~1.4m,
   comfortably more than the player's collision radius plus a dodge).
3. **Place masses only in the leftover pockets** — the regions circulation does
   not use.
4. **Verify on the finished room**: every door still reaches every other door and
   the focus, at width. If not, remove the newest mass and retry.

That single inversion delivers all three of Josh's wants at once:

- **the pillars are where you don't walk**, which is what "built better" means and
  what makes a room read as designed rather than sprinkled;
- **there is always a clean line between the doors**, so no room can be a
  navigation puzzle by accident;
- and the "random pillar inside the composition" failure becomes *structurally
  impossible*, not merely discouraged — a mass cannot be placed on circulation
  because circulation was claimed first.

It also gives masses their **rhythm** for free: a colonnade is what you get when
the leftover pockets are a regular series flanking a central corridor. You do not
have to author the rhythm; you get it by protecting the nave.

### 8.4 Archetypes are generator parameters, not tilemaps

Six or so archetypes, each ~20 lines of polygon construction plus a mass rule:

| archetype | polygon | masses |
|---|---|---|
| `hall` | long spine, maybe a wider end | rhythm along the length, flanking the nave |
| `chamber` | near-square, one focus | at corners, clear centre |
| `apse` | body + chamfered end holding the focus | frame the apse mouth |
| `pillared` | spine + side aisles | a real colonnade, nave protected |
| `broken` | spine with a void across it, one bridge | banks along the rim |
| `cells` | spine subdivided by low masses | the dividers ARE the masses |

Six of those, fitted to any size, skinned by the room's claims (§5), out-vary 37
frozen rectangles by a wide margin — and each one is a thing you can look at and
say "yes, that's a hall."

### 8.5 Staging

1. **Polygon room + shape grammar + chamfer**, rendered. The whole point is to
   *look* at a non-blocky room, so this ships first and alone.
2. **Circulation-first mass placement** (§8.3), with the reachability check as a
   test — a floor where any door can't reach the focus at width is a hard failure.
3. **Voids as polygon subtraction**, retiring the margin constants and the
   rasterised occupancy path.
4. **Archetypes**, one at a time, each snapped and compared.
5. **Delete the vault library** and the composer's tag/slot machinery, keeping
   only the genuine set-pieces as authored geometry.

Note what is NOT in this list: an authoring format. §2's "compositions" were the
right idea aimed at the wrong problem — they were a better way to hand-author,
and the measurement says hand-authoring was never carrying the rooms. The
archetype table above is where a design or content layer expresses intent now,
and it is code, which is the substrate that layer already writes.

---

## 9. Intent in, model out — the skin resolver

Josh, 2026-08-06: *"what if the placement is all about intent and what gets
rendered is decided by the skinner — the same generator can generate different
themed floors, models describe themselves, and the building passes can say 'I
want a light source here' optionally with constraints, and what gets put there
is up to the skinning resolver. Is there a good pattern here?"*

Yes, and it has a name. In procedural level generation this is the **semantic
dressing** split: a placement pass emits *tokens of intent* ("cover here", "light
here") and a separate dressing pass realises each token from the current biome's
palette. Structurally it is an Abstract Factory whose products are selected at
runtime. Two hand-rolled instances of it already existed in this codebase before
the general version — `lit-fixture-pool.ts` (one intent, one palette, hardcoded)
and the `shape → model` switch inside `poly-floor.ts:lightRoom` — and neither
could be swapped, so neither bought a theme.

`src/level/skin.ts` is the general version. `src/level/skins.ts` is the catalog.

### 9.1 The part that makes it better than a lookup table

The naive shape is `Record<Intent, ModelSpec>` per theme. It works, and it rots,
because every placer still has to know what *fits*: is there a wall to hang this
on, is there headroom, does a lit candle contradict the cobwebs this room already
committed to (§5)? That knowledge migrates into the placers one special case at a
time, and the theme table becomes a thing you must keep in sync with five call
sites.

So the split is by **who owns the fact**:

| owner | owns | example |
|---|---|---|
| the **request** | the SITUATION | 0.5m of free floor, 3.2m of headroom, the room has committed to `desecrated` |
| the **candidate** | its REQUIREMENTS | a cresset pike is 2.4m of iron; a wall torch asserts `tended` |
| the **skin** | TASTE | 75% torch, 25% cresset — the whole of what a theme is |
| the **resolver** | the MATCH, **and the refusal** | nothing in this palette belongs here → `null` |

`resolveSkin` returning `null` is a real answer, not a failure. A 1.8m
crawlspace genuinely cannot host a 2.4m pike, and the honest response is an empty
spot rather than a pike jammed through the ceiling. Every caller must have
somewhere to go when the answer is nothing.

The payoff is that **a theme is a data file**. "Flooded catacombs" is a palette,
not a change to any placement pass. And because the claim table from §5 filters
candidates at the point of choosing, a theme cannot contradict itself: ask a
desecrated room for a light and the tended candles are already gone from the
pool.

### 9.2 Dressing rolls must not touch the layout stream

The one non-obvious constraint, found by measuring rather than by reasoning.

The skin picks between a torch and a cresset — pure taste, no bearing on where
anything goes. Drawn from the floor's own RNG, that pick *advances the shared
stream*, and every later decision on the floor shifts with it. Measured across
240 floors when the wall pool was first wired in: three sconces, one standing
light and one floor glow moved, none of which were about fixtures.

Small, invisible, and corrosive — it makes a palette edit read as a procgen
regression, and it means you can never again tell the two apart. So
`generatePolyFloor` derives a second stream (`dressRand`) from the same seed and
hands *that* to the skin. Deterministic as before; independent of layout.
`tests/skin.test.ts` pins it end-to-end: same seed, two entirely different
palettes, every enemy and every non-light prop in exactly the same place.

### 9.2b What the resolver found the moment it read the claim table

Wiring the resolver made §5's claim table *live* for wall fixtures for the first
time — nothing had ever consulted it about one. It immediately reported **46 of
1308 polygon rooms (3.5%) contradicting themselves**, every case a lit wall
bracket arguing with a cobweb on the same doorway.

The declaration was wrong, not the generator. Both brackets said `tended` —
*someone keeps this lit* — and the rule that resolves it is the one the great
brazier's entry already established once:

> **Portable or placed asserts tending. Architectural does not.**

A candle somebody set down and a brazier somebody dragged in are housekeeping. A
bracket bolted into the masonry is part of the building, and in a dungeon whose
baseline is torchlight it is evidence of nothing. The alternative is that every
lit room in the game is tended and *no* room can ever be abandoned — which
collapses the whole claim vocabulary to a single value. `wall-stub` keeps its
`abandoned`, because a bracket with **no fire left** genuinely is evidence.

After: 0 of 1308. `tests/poly-floor.test.ts` pins it, and the pin was checked by
reverting the table and watching it fail.

Two process notes, both of which cost a measurement each:

- The first audit carried **its own copy** of the claim table, so it reported the
  same 46 rooms before *and after* the table was edited. It was measuring its own
  opinion (docs/DESIGN-METHOD.md: *every audit tool imports the real function*).
- The second offset `room.poly` by `room.rect`. **`poly` is already world-space**
  — the numbers that came out were about the wrong rooms entirely.

### 9.3 Where it stands, and what comes next

Wired: the four light intents on the polygon generator
(`light.wall` / `light.floor` / `light.pool` / `light.shaft`). One skin ships —
the crypt — and it reproduces what the dungeon already looked like, because the
first pass of an architecture should be the seam and not a new art direction.
The second skin lives in the test, so "a theme is a data file" is a demonstrated
fact rather than a claim in a comment.

Not yet routed, in rough order of value:

1. ~~**`debris.small` / `debris.corner`**~~ — **done.** `FLOOR_DEBRIS` and
   `CORNER_MOUND_VARIANTS` moved out of `clutter.ts` into the skin; the pass now
   decides only how much and where. Verified inert: the full prop tally over 210
   vault-composed floors is byte-identical before and after.

   Two things the routing needed, both of which sharpened the model:

   - **`skinCandidates`** returns the whole fitting pool rather than one pick.
     The debris pass deals ROUND-ROBIN so a room gets rubble *and* ash *and*
     shards instead of four of whatever the dice liked — the resolver owns the
     MATCH, the caller may own the ORDER. Same filter either way, which is the
     part that must not be duplicated.
   - **`SkinRequest.exclude`** carries "at most one large mound in this room".
     That is the caller's budget, not the candidate's requirement — a mound is no
     less suitable for having a twin elsewhere — so it belongs in the request
     with the rest of the situation.

   `WALL_DAMAGE` followed as `wall.damage` — trivially, because a scorch mark
   is nothing but its id.

   **`mass.pillar` is blocked, and the reason is worth writing down.** Every
   mass in `clutter.ts` carries model-specific placement facts baked into the
   call site: the ruined column gets `collision: {kind:'circle', r:0.34}`, the
   fallen segment gets a cardinal rotation because its AABB half-extents swap at
   ±π/2, the buttress gets a wall-attachment routine of its own. Those are
   properties *of the model*, sitting in the *pass*, which is exactly the
   coupling this architecture exists to remove — but moving them means the
   candidate has to carry a collision hint, and that is a real design step rather
   than a copy-paste. It is the right next piece of work and it is not a
   five-minute one.
2. **A room's claims reaching the light request.** The field is there and
   `poly-floor.ts` passes nothing, because it does not yet track per-room claims
   the way `clutter.ts` does. Once it does, a desecrated sanctum stops being
   offered a tended candle for free.
3. **A second real skin**, chosen per act. This is the point of all of it, and it
   is deliberately last — a theme is worth authoring once the seam is proven and
   every intent it needs is routed, not before.
