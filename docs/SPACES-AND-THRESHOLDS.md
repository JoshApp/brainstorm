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

That last row is the bug Josh keeps photographing: a 3.0m passage reaching 0.73m
into a 5.2m hall stands its ceiling slab and its side walls **inside the room**,
so from indoors you are looking at the outside of a tunnel.

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
   *  run available between corners and pilasters sets the max; the walkable
   *  floor (corridor-types.MIN_WALKABLE_WIDTH) sets the min. An edge too short
   *  to hold the min publishes no anchor at all, which is how a room says
   *  "not through here" without anybody special-casing it. */
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
   runs — flat spans, clear of corners and pilasters. Verify: every room the
   layout wants to connect has an anchor facing the right way, and the anchors
   agree with where the current pipeline actually puts doors.
3. **The layout links anchors, not rooms.** Routing becomes anchor→anchor,
   which is also *easier*: both endpoints are known exactly instead of being
   searched for. Corridor geometry starts and ends on the anchor planes.
   Verify: overshoot deleted, reachability green.
4. **Walls cut at their own anchors.** `planWallRing` takes the room's claimed
   anchors; `findOpenings`' rect-crossing inference retires.
5. **Corridors carry a polygon** — stroked centreline between two anchors, so a
   bend is one shape. Verify: no orphaned ends, wall beats stop needing the
   stone-behind probe.
6. **Delete the repair passes**, one commit each, guarded by the suite. Each
   should be a deletion with no behaviour change — if a deletion moves a
   number, the model is not finished.
7. **Anchor `kind`** — the door vocabulary, and the frames built from it.

Do not skip step 6 into step 7. The repair passes going inert *is* the proof
the model works; adding the vocabulary first would build new content on the old
foundation and hide whether the seam was ever fixed.

---

## Status

Step 0 (this document + the measurement) is done. Nothing below it has landed
yet. The numbers to beat, from the current generator:

- corridor/room penetrations: **480** (target 0)
- of those with a ceiling mismatch: **442**
- wall beats needing a stone-behind probe: was 60/636, currently fixed by a
  probe that step 3 should make unnecessary
