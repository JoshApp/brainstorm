# Spaces and thresholds

The floor's geometry, restated. This document is the plan for replacing
build-then-reconcile with declare-then-build, and the record of the measurement
that made the case. Written 2026-08-08, mid-migration — read the **Status**
section at the bottom for where it actually is.

---

## The problem, measured

A corridor is an axis-aligned rect run between two rooms. It deliberately
**overshoots into them**, because a polygon room's real wall sits back from its
bounding box by an unknown amount, and overshooting is the only way to guarantee
the corridor reaches stone.

Measured over 36 floors:

| | |
|---|---|
| places a corridor rect reaches inside a room polygon | **480** |
| how deep, median / p90 / max | **0.73m / 0.83m / 3.60m** |
| of those, ceiling heights differing by >0.15m | **442 (92%)** |

**Read that table carefully — it measures the RECT, and the rect is bookkeeping.**
When first written this section said "480 penetrations, 92% with a ceiling
mismatch — that's the leak," which was wrong in the specific way
DESIGN-METHOD.md warns about: *measure the thing that ships, not a proxy.* Run
the same check on the plate that is actually BUILT (`plateExtentFor`, which
clips the rect back to the wall) and it is **4 of 1221, 0.33%**. The repair
passes work. What the 480 measures is how much rope the model needs to hold
itself up, not how much of it is visible.

So the case for this migration is NOT "the geometry is broken everywhere." It is
that seven systems exist to undo one deliberate lie, they each know a piece of
the truth, and every geometry bug this session was two of them disagreeing —
including the 0.33% that still leaks. The photographed bug is real; the number
that explains it is 4, not 480.

## The seven repair passes

Because the overshoot is a lie the rest of the pipeline has to live with, seven
systems exist to undo its consequences:

| system | what it undoes |
|---|---|
| `wall-openings.findOpenings` | punches a hole where rects cross a wall line |
| `portals.planPortals` | works out where the doorway *really* is |
| `corridor-trim.plateExtentFor` | clips the floor/ceiling plate back to the wall |
| `corridor-ceiling.ceilingForLink` | clamps a corridor under the room it enters |
| `poly-elevation.linkRectsMisplaced` | vetoes a drop when a rect lands in the wrong room |
| `rect-at.rectAtIn` | disambiguates "which room is this point in" |
| `room-culling` boundary probe | decides which room owns a doorframe |

Every geometry bug this session was two of these disagreeing. The root cause
written into four separate file headers is one sentence: **a polygon room is not
its bounding box.** The overshoot is the disease; those seven are medication.

---

## Why it pushes in at all

Not for geometry — for **bookkeeping**. The only mechanism for cutting a hole in
a wall is rect-overlap: `findOpenings` and `planPortals` look for a corridor
rect crossing a wall line. A corridor cannot know where a polygon room's real
wall sits, so it overshoots `OVERLAP = 0.9m` to *guarantee* that crossing is
visible to the finder. The 0.9m is not a corridor reaching into a room; it is a
lookup key.

Everything downstream — the trim, the height clamp, the misplaced-rect veto, the
side-wall subtraction in `builder.ts` — is the price of making that one lookup
work.

## The model

**Josh, and this supersedes the ray-marched version this document was first
written with:**

> *"shouldn't we be able to cleanly build things by doing portal ANCHORS in the
> room and connecting them from there? The room itself saying how the door can
> be carved — we can specify intent on how big, what kind — and then we connect
> the anchors. That way we can also build the anchor as a door opening, frame,
> whatever we want, and the corridors properly connect, stopping the z-fighting
> and all the overlap shenanigans, because it gets clean."*

That is right, and it is one step further than solving the seam by ray-marching
from a room's centre. Marching still asks *"where is the wall?"* — better than
overshooting, but still a question with an answer that can be wrong. **An anchor
is not a question.** The room places it ON its own wall, so it is correct by
construction:

- The room knows its polygon, its corners, its pilasters and where its
  centrepiece stands. It can put doors on flat runs, clear of corners, aligned
  to the coursing — none of which a corridor arriving from outside can know.
- It carries **intent**: how wide, how tall, what `kind`. The frame is authored
  at the anchor; the corridor is built to it.
- It is authorable. A hand-built vault can declare "one door, on the north
  face, a gate" and the layout has to honour it. A sealed room declares none.

So a room publishes its doors, the layout picks which to use, and a corridor
runs **anchor to anchor** — starting and ending exactly on two planes that were
correct before it existed. There is nothing to overshoot toward, so there is
nothing to trim, clamp, veto or subtract afterwards.

### An anchor declares a RANGE, not a number

Josh: *"maybe a room can declare a range it can have — basically the max — and
then we make it fit."*

Right, and it is the difference between negotiating and overruling. A fixed
width makes every mismatch a conflict somebody has to lose; a range makes most
of them agree, because the two bands overlap and any width inside the overlap is
acceptable to both.

```ts
interface PortalAnchor {
  id: string;
  edge: number;                     // which polygon edge it sits on
  at: [number, number];             // the point, ON that edge
  normal: [number, number];         // outward
  /** What this wall can AFFORD: [min, max]. Derived, not typed in — the flat
   *  run available between corners and pilasters sets the max; the narrowest
   *  hole the game cuts anywhere (`CRAWL_MIN`) sets the min. An edge too short
   *  to hold the min publishes no anchor at all, which is how a room says
   *  "not through here" without anybody special-casing it.
   *
   *  Note the min is CAPABILITY, not requirement: a wall is perfectly able to
   *  hold a hole too tight for a stoneguard, and saying so is what makes a
   *  crawl placeable at all. Needing a link mobs can use is the LAYOUT's
   *  requirement, and it asks for it by BAND (below). */
  width: [number, number];
  /** Likewise capped by the room's own height — an opening cannot be taller
   *  than the wall it is cut into. */
  height: [number, number];
  kind: ThresholdKind;
  used?: string;                    // the link that claimed it
}
```

**Resolution: intersect, then prefer the section.** The feasible band is the
overlap of the two anchors' ranges. Inside it, take the width the corridor's
section wants (`corridor-types` — a squeeze asks for 1.55, a gallery for 3.60)
clamped into the band. Only when the bands do NOT overlap is there a decision to
make, and then **the tighter one wins**: an opening that does not fit one of its
sides is not an opening. With ranges that case should be rare, and it is worth
counting rather than assuming — if it is common, the ranges are wrong.

### Three bands, and one of them is a mechanic

Josh: *"I love the occasional massive portal as well as a sneaky way."*

The **massive portal** turned out to be a supply question with the supply
already in hand. Across 323 polygon rooms the widest run a room can offer is
p50 **6.6m**, p90 **11.1m**; **77%** could host a 4m opening and **54%** a 6m
one. The shapes were never the constraint — nothing was asking them. So a gate
being rare has to be a DECISION, and if it ever reads as rare-because-geometry
that is a bug in the layout, not in the shapes.

The **sneaky way** is not a supply question and it is not a small door. It is a
door the big things cannot use. The player's collision radius is 0.3; the widest
ROAMING enemy is the stoneguard at 0.55. An opening sized into that gap passes
you and refuses what is chasing you — an escape route, a shortcut with a cost
(you cannot fight in it), a place where only the small things follow.

| band | width | job |
|---|---|---|
| `crawl` | 0.85 – 1.15m | who may follow you |
| `door` | 1.35 – 3.2m | circulation; the only band the layout may hang a mainline on |
| `gate` | 4.0 – 12.0m | a statement |

All three are solved through `gateAdmits`, the same predicate the nav grid uses
at runtime, so "the stoneguard cannot follow you in here" is computed rather
than asserted. And the crawl is a **gradient**, which is the nice part: at 1.15m
it refuses the stoneguard and the wraith; at 0.85m it refuses six of the roster,
ghoul and defiler and lasher included.

**The failure this already had, recorded because it looked exactly like
success.** The first version derived the crawl's max from
`corridor-types.WIDEST_ROAMER_RADIUS` (0.62) — a figure deliberately padded
*above* the roster so corridors fit everything. Padding is the safe error for
"how wide must this be so everything fits" and the WRONG error for "how narrow
must this be so something is kept out." The resulting crawl band admitted all 23
mobs and excluded nothing, while looking entirely plausible in the source. The
fix is that `WIDEST_ROAMER` is now read off `ENEMIES` itself, and the test
asserts the *exclusion* at every width across the band rather than the numbers.

### The SHAPE declares its anchors, and the generator rotates it to fit

Josh: *"not all rooms need to have all sides open — some might not work. So a
room can declare possible anchors and the generator needs to rotate the room
shape to mix and match. That way we can also use room shapes rotated, which
makes some looping easier and allows more variety. Portal carving becomes a
problem of the room itself, and that way we can also do way better opening
entrance geometry."*

This is the piece that turns the anchor idea into a system, and it changes what
a room shape IS: not a polygon the layout happens to place, but a **template
with a connection contract**.

```ts
interface RoomShape {
  id: string;
  poly: Poly;                       // authored in its own local frame
  /** Where this shape is WILLING to be entered. An ell says "the two long
   *  faces, never the inner corner"; a sanctum says "one face, and it is a
   *  gate". A shape that declares none is a room the layout cannot use, which
   *  is a legitimate thing to say. */
  anchors: AnchorSpec[];
  /** Which presentations are allowed. Quarter turns and mirrors only —
   *  everything downstream assumes axis-aligned walls, and a free rotation
   *  would hand us diagonal geometry, which is where the bugs live. */
  symmetry: 'rot4' | 'rot4-mirror' | 'fixed';
}
```

**Placement becomes a small constraint solve instead of a search.** Today
`stepFrom` picks a direction, drops a box, and `connect()` then goes looking for
a wall to punch. With declared anchors the layout asks the opposite question —
*"which rotation of this shape has a free anchor facing the way I am coming
from, and another facing onward?"* — tries the four (or eight) presentations,
and keeps one that satisfies it. If none does, the shape simply is not used
here, and the layout picks another. Degrade, never fail.

Three things fall out, and the third is the one that matters most:

**1. Variety for free.** One authored shape is four or eight presentations. The
content layer authors a good ell once and the floor gets it in every
orientation, with its doors always on the faces that suit it.

**2. Loops get much easier.** The loop pass measured earlier this session found
that of 383 candidate room pairs, ZERO were connectable, because `stepFrom` only
ever produces alignment between spine neighbours — a loop had to wait for a
geometric coincidence that never came. A room that declares THREE anchors is
saying "spine in, spine out, and one more" out loud, and the layout can plan a
cycle instead of hoping for one.

**3. THE FRAME STOPS BEING A PROP.** This is the deep one. Today a doorway is a
hole punched in a wall ring, with a separate archway model stood in the gap —
two independent meshes asked to occupy the same plane, which is the z-fighting,
the inset stone doors, and the mass-above-the-arch, all of it. If the room owns
its openings, the opening is part of the room's own shell: one mesh with a
shaped hole, jambs and reveal and threshold cut as geometry rather than
delivered as a prop that has to line up. Two surfaces cannot fight for a plane
when there is only one surface.

That also unlocks the entrance geometry Josh is after — a splayed reveal, a
stepped threshold, a segmental head — because they become part of how the wall
is built rather than a model that must be sized to a hole somebody else made.

**Migration note:** declared anchors and derived ones are not exclusive. A shape
with no `anchors` falls back to deriving candidates from its flat wall runs (the
rule above). That keeps this incremental — nothing has to be authored up front,
and a shape earns hand-placed doors when it turns out to need them.

### On flaring the corridor instead

Josh: *"or kinda make the corridor get wider from one side to the other."*

Tempting, and the READ is right — a passage that opens out as it reaches a hall
is architecture, not a bug. But making the corridor itself variable-width is the
wrong place to put it:

- It breaks *one section per link*, which is a rule with a reason: a passage
  that changes width partway does not read as a designed space (see
  `corridor-types.ts`).
- A taper is easy on a straight run and unpleasant on a bend — the width change
  has to distribute around a corner, and bends are already where the geometry
  bugs live.
- Every consumer that places things along a corridor currently assumes a
  constant lateral: the decor placer, the wall mounts, the nav band, the light
  spacing. A varying width means each of them grows a parameter.

**So put the flare on the THRESHOLD, not the corridor.** A splayed mouth — the
opening widening over the last stretch before it meets the room — is local
geometry at the seam, which is exactly where a frame is already being built. It
buys the same read (the passage opens into the hall) and costs one model
variant instead of a parameter in five systems. Real masonry does this and has
a word for it: a splayed embrasure.

That also keeps the flare a *deliberate* beat rather than a consequence of two
numbers failing to match — it fires when a narrow section meets a wide room,
which is when it means something.

A **threshold** is then a pair of claimed anchors resolved to one agreed set of
numbers. The type below is unchanged; only how it is *obtained* changes, from
solved to declared.


**ONE PRIMITIVE — a SPACE.** A polygon, a height, a floor elevation. Rooms are
spaces. Corridors are spaces. There is no second kind of thing.

**ONE SEAM — a THRESHOLD.** Where two spaces meet:

```ts
interface Threshold {
  id: string;
  spaces: [string, string];      // the two it joins
  at: [number, number];          // the point, ON both polygons' shared edge
  normal: [number, number];      // out of spaces[0], into spaces[1]
  width: number;                 // clear opening
  height: number;                // clear opening — ONE number both sides use
  floorY: number;                // one ground height, so a seam cannot step
  kind: ThresholdKind;           // gap | half | frame | gate
}
```

The threshold is **decided before any corridor geometry exists** — and with
anchors the question "where does this wall actually sit" is never asked at all,
because the room answered it while it still owned the wall.

### How a floor is built

1. Shape the room, and have it **publish its anchors** — candidate doors on its
   own flat wall runs, clear of its corners and pilasters, each carrying a
   width, a height and a `kind`. The room is the only thing that knows all of
   that, so it is the only thing that should decide.
2. The layout **claims a pair of anchors** and routes between them. Both
   endpoints are known exactly, which makes routing easier than searching for a
   wall: a centreline polyline plus a section (`corridor-types.ts`) for width
   and height.
3. Reconcile the pair into a **threshold** — intersect their ranges, take the
   section's preferred width clamped into the overlap, and where the bands do
   not overlap at all, the tighter one wins.
4. Build the corridor's polygon as the centreline **stroked** to the section's
   width and **stopped on both anchor planes**. It never enters a room, because
   there is nothing to reach toward — the wall's position was known first.
5. Every space cuts its own wall ring at its own claimed anchors. `planWallRing`
   already takes openings; they stop being inferred from rect crossings.
6. The frame is built at the anchor, from its declared width / height / kind —
   so it **cannot** fight the corridor, because the corridor was built to the
   same numbers.

### What this deletes

- **`plateExtentFor`** — nothing overhangs, so there is nothing to trim.
- **`ceilingForLink`** — the threshold declares one height; there is no
  mismatch to clamp.
- **`linkRectsMisplaced`** — a rect cannot be misplaced when it stops at the
  wall.
- **`rectAtIn`'s polygon-beats-box rule** — spaces do not overlap, so the
  question has one answer.
- **the culling boundary probe** — the threshold *is* the shared object; it is
  visible when either of its two spaces is.
- **`findOpenings`' rect-crossing inference** — a space cuts a declared span.
- **`planPortals`' cut-grouping** — the opening is declared, not reconstructed
  from which edges a rect happened to cross.

### And a link is ONE polygon, not three rects

A dogleg or an L is currently three rects overlapping at their corners, and
every consumer has to understand that: elevation needed per-leg travel axes,
the room graph needed per-link adjacency, and corridor wall beats mounted onto
open space at the joints (9.4% of them, measured).

A stroked centreline is a single polygon whose outline already includes its
corners. The joints stop existing rather than being handled.

### Why this shape, and why it is flexible

`kind` is a data field, so the door vocabulary is a table rather than a code
path:

| kind | what it says about what is behind |
|---|---|
| `gap` | worn through, unmade. The common case. |
| `half` | stoop or clamber — pairs with the 2.30m squeeze. |
| `frame` | somebody built this. A made room. |
| `gate` | monumental, and RARE — it should mean the room matters. |

Chosen from what is on *both* sides — the two spaces' sections and roles — not
from the opening's width. That is Josh's "hint at what lies behind" as a
lookup, not as new geometry.

It is also the move that has worked three times in one day: `corridor-types`
(declare the section, geometry follows), `encounter-shape` (declare the intent,
composition follows), `frame-depth` (one rule for how deep a doorway is, both
sides read it). Declare the word; let the geometry follow.

### The tell that it is right

The existing invariant tests — the reachability flood, no orphaned corridor
ends, no step at a seam, no doorway opening onto nothing, every room has a
portal — stop being *checks* and become *consequences*. A test that can no
longer fail because the model makes it impossible is the goal; a test that keeps
catching the same class of bug means the model is still wrong.

---

## Migration

The build path already branches on `poly` (`builder.ts`: any RoomSpec carrying a
polygon builds via `buildPolyRoomShell`, everything else via the rect path). So
a corridor that gains a polygon routes itself through the same machinery rooms
use, with no new branch. That is why this is tractable rather than a rewrite.

Order, each step measurable on its own:

1. **`threshold.ts`** — the type, and a solver kept as a migration aid so the
   declared answer can be checked against the inferred one. DONE: it reproduces
   656 of 658 openings `planPortals` finds, 99.7%, median offset 2cm.
2. **Rooms publish anchors.** `shapeRoom` emits candidate doors on its own wall
   runs — flat spans, clear of corners and pilasters, each with a width RANGE.
   Derived first; a shape may override with declared ones. Verify: every room
   the layout wants to connect has an anchor facing the right way, and they
   agree with where the current pipeline actually puts doors.
3. **Placement chooses a rotation that satisfies the anchors.** Quarter turns
   and mirrors. Verify: floors still generate at every seed (degrade, never
   fail), and count how often no presentation fits — if that is common, the
   shapes are over-constrained.
4. **The layout links anchors, not rooms.** Routing becomes anchor→anchor,
   which is also *easier*: both endpoints are known exactly instead of being
   searched for. Corridor geometry starts and ends on the anchor planes.
   Verify: overshoot deleted, reachability green.
5. **Walls cut at their own anchors.** `planWallRing` takes the room's claimed
   anchors; `findOpenings`' rect-crossing inference retires.
6. **Corridors carry a polygon** — stroked centreline between two anchors, so a
   bend is one shape. Verify: no orphaned ends, wall beats stop needing the
   stone-behind probe.
7. **Delete the repair passes**, one commit each, guarded by the suite. Each
   should be a deletion with no behaviour change — if a deletion moves a
   number, the model is not finished.
8. **Anchor `kind`** — the door vocabulary, and the opening geometry built
   INTO the shell rather than stood in the hole.

Do not skip step 7 into step 8. The repair passes going inert *is* the proof
the model works; adding the vocabulary first would build new content on the old
foundation and hide whether the seam was ever fixed.

---

## Status

**Step 1 done** — `threshold.ts` (the seam type + solver, reproducing 99.7% of
the shipping openings) and `anchors.ts` (rooms publish what their walls can
afford, plus the band vocabulary above).

**Step 2 in progress** — anchors are derived and measured but nothing consumes
them yet, which is deliberate: the derivation gets checked against the shipping
pipeline BEFORE the pipeline is rebuilt on it.

What the anchors measure today, over 323 polygon rooms on 48 floors:

| | |
|---|---|
| rooms that can host no door at all | **0** |
| anchors per room, median | **6** |
| widest run a room can offer, p50 / p90 | **6.6m / 11.1m** |
| rooms that could host a `gate` (4m+) | **77%** |
| today's doorways with a facing anchor near them | **89%** |
| median corner clearance — covered doors vs uncovered | **+1.02m vs −0.83m** |

That last row is the result the model rests on: of the doorways the walls cannot
account for, **92% overlap a corner**. The doors the anchors miss are almost
exactly the doors that should not be there.

The numbers to beat, from the current generator:

- corridor/room penetrations, RECT: **480** — bookkeeping, expected to go to 0
  as a side effect, not the goal
- corridor/room penetrations, BUILT PLATE: **4 / 1221 (0.33%)** — this is the
  one that is actually visible, and the one to drive to zero
- wall beats needing a stone-behind probe: was 60/636, currently fixed by a
  probe that step 6 should make unnecessary
