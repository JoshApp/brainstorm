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

## The model

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

The threshold is **decided before any corridor geometry exists**, and it is the
only place the question "where does this wall actually sit" is ever asked.

### How a floor is built

1. Shape the rooms (unchanged).
2. Route a link between two rooms: a **centreline** polyline, and a section
   (`corridor-types.ts` — squeeze / passage / gallery) giving width and height.
3. Solve a **threshold** at each end, by marching from the room's interior along
   the centreline until the polygon boundary is crossed. This is the existing
   `exitPoint`, promoted from a helper to the thing that owns the answer.
4. Build the corridor's polygon as the centreline **stroked** to the section's
   width and **stopped at both threshold planes**. It never enters a room.
5. Every space cuts its own wall ring, with openings at exactly the thresholds
   that touch it. `planWallRing` already does this; it just needs thresholds
   instead of inferred rect crossings.
6. The frame is built from the threshold's declared width / height / kind — so
   it **cannot** fight the corridor, because the corridor was built from the
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

1. **`threshold.ts`** — the type and the solver. Emitted alongside today's
   geometry, consumed by nobody yet. Verify: a threshold exists for every
   opening `planPortals` finds today.
2. **Corridors stop at thresholds.** Kill the overshoot. Verify: the 480
   penetrations go to 0, and the reachability suite stays green.
3. **Corridors carry a polygon.** Stroked centreline. Verify: the wall ring
   closes, no orphaned ends, wall beats stop needing the stone-behind probe.
4. **Walls cut thresholds.** `planWallRing` takes thresholds; `findOpenings`
   inference retires.
5. **Delete the repair passes**, one commit each, guarded by the suite. Each
   should be a deletion with no behaviour change — if a deletion moves a
   number, the model is not finished.
6. **Threshold `kind`** — the door vocabulary, and the frames built from it.

Do not skip step 5 into step 6. The repair passes going inert *is* the proof
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
