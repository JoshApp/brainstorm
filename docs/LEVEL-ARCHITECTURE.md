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

## 3. Do we keep ASCII?

**We have outgrown the ASCII vaults. We have not outgrown ASCII.**

The format's real value was never that it's a grid — it's that **you can see the
room at a glance, in a diff, in a terminal, without running anything**. That
property matters more here than in most codebases, because the authoring model
(CLAUDE.md) has several layers reading and writing the same substrate, and a
format only one of them can visualise is a format that rots.

So: keep the sketch, **change the alphabet**. Marks stop meaning objects and
start meaning intent:

```
compose 'hall-of-the-dais'
shape: long-hall

  ###################
  #.................#
  #..M...........M..#      M = mass (rhythm: paired, along the length)
  #.................#
  #~~~~~~~~~~~~~~~~~#      ~ = void region
  #.................#
  #..M....[E<]...M..#      [E<] = event slot, facing -Z (toward the entry)
  #.................#
  ###################

focus: E
combat: 2 slots, loose        ← "a fight happens here", not "an X stands here"
claims: abandoned, cold
```

That is still glanceable, still diffable, still writable by a content layer with
no implementation knowledge — and every mark now carries a reason. Regions that
are genuinely awkward in a grid (a mass's rhythm, a slot's apron radius) live in
the small structured block underneath, where coordinates would have been unreadable
anyway.

**Honest tradeoff:** regions-with-facing are a slightly poor fit for a character
grid, and a pure JSON/region format would be more precise. I'm recommending
against it because precision isn't the bottleneck — *legibility across authoring
layers* is, and a list of rects is something nobody can picture.

---

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
