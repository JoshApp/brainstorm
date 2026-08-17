# Links v3 — a floor is a graph of spaces

Josh, 2026-08-17, after a day of patching: *"can we please take a step back, this
all sounds so messy... it feels like we are trying to comply with things that are
unnecessary, like old thoughts or things we did. can we just redo all of this
properly so it supports gameplay?"*

He is right, and the evidence is the day itself: six changes made and reverted, each
one blocked by an assumption from a system that predates anchors. Not bad luck —
the wrong altitude.

## What the floor owes GAMEPLAY

Everything below is derived from this list. If something in the generator does not
serve one of these, it is not a requirement, it is a habit.

1. **Rooms you can fight in.** Space to dodge, sightlines that read, a shape you can
   learn. Combat is the first pillar; the room is its arena.
2. **Thresholds you move through, that PACE the fight.** Doors seal on combat, mobs
   funnel through openings, a corridor is where you retreat to and get cornered in.
   A threshold's *width* matters only because it decides **what fits through it**
   and **whether a fight can happen in it**.
3. **Reachability.** Every room the plan asks for is reachable. Non-negotiable: an
   unreachable room is a dead floor.
4. **A descent you can feel.** Downhill is forward; the stairs are findable.
5. **Places to put content.** Fires, chests, altars, corpses — anchored in rooms
   with elbow room.

## What does NOT matter, and has been driving the code anyway

- Whether a corridor is 1.55m or 3.60m *as a category*. It matters that a mob fits
  or does not; the vocabulary is a means.
- Straight vs bent, *except* for sightline: a straight corridor shows you the next
  room, a bend hides it. That is a gameplay knob, not a shape budget.
- Run length. It has picked the corridor's section for months and says nothing about
  the place.
- Whether corridors are rects. This is the big one — see below.

## The model

**A floor is a GRAPH of spaces. An edge is a LINK. A link is a polyline.**

```
Room          declares SOCKETS: stretches of one wall that can be cut,
              each with a width range it can afford.   (level/anchors.ts — exists)

Link          from socket A to socket B: legs, each an axis-aligned segment
              with one width. The polyline IS the link. Nothing derives it;
              everything derives FROM it.

Geometry      generated from the polyline: floor plate, ceiling, side walls,
              the cut in each room's wall, the sill, the lintel.

Elevation     a second pass over the SAME polyline: each leg gets a start and
              end height. A leg with a change is a ramp.
```

### The three rules that kill this session's whole bug class

1. **Placement and connection are ONE decision.** A room is placed *by* its link:
   pick a socket on something already placed, pick a socket on the new room,
   position the room so they face each other. A link cannot fail, because the link
   is what chose the position. **No fallback exists to write.**

2. **Width has ONE owner: the link.** `width = min(A affords, B affords, cap)`.
   The wall's cut, the frame, the plate and the nav gate all read that number. Today
   the rect says 2.20m and the frame says 1.03m and a mob walks a corridor it cannot
   exit.

3. **The cut is DECLARED, never rediscovered.** The link states `(edge, t0, t1)` per
   end — `planWallRing` already accepts exactly this shape. No rect overlap, no
   re-clipping, so no 0.9m overshoot and nothing to trim back.

## What this DELETES

More than it adds, which is the sign it is right:

| gone | why it existed |
| --- | --- |
| `connect()`'s straight + dogleg fallback | placement did not consult walls |
| `connectL` (the chord) | same, for the loop |
| the pocket's raw placement rect | same, for pockets |
| `OVERLAP` (0.9m) | so a rect could re-derive a declared cut |
| `corridor-trim` / `plateExtentFor` | to undo the overlap |
| `legAxis` + "rect 1 is the landing" | a rect cannot state its own slope |
| `corridorTypeFor(runLength)` | no better quantity was available |
| `plateInsideRoom`, `linkRectsMisplaced` | impossible by construction now |
| the frame's `withSill` | the wall owns its threshold (landed today) |

Rects do not disappear — nav, culling and occupancy read them — but they become a
**derived view** of the polyline, generated once, never the record.

## Order of work

Each stage leaves the floor buildable and is measured, not asserted.

1. **`Link` as a type, and geometry derived from it.** Build the polyline from the
   existing router (it already produces exactly this — `LinkRoute` has legs,
   thresholds and per-end widths), and generate rects from it instead of the reverse.
   Gate: identical floors, `servedBy: route` unchanged.
2. **Placement by socket.** Rooms placed by their link. Gate: **blind corridors 0**,
   and the three blind producers deleted, not merely unused.
3. **Declared cuts.** Link states its cut; drop `OVERLAP` and the trim. Gate: no
   void and no z-fight at any threshold — the marks Josh took this morning, clean.
4. **Width from space.** `corridorTypeForSpace` wired, now that width has one owner.
   Gate: squeeze back near 24%, restore the 5% section floor.
5. **Elevation over the polyline.** Legs carry heights; `flatFloors` retired. Gate:
   the elevation suite passes with routed chords, which today it cannot.

## The measurements this replaces guesswork with

Kept because each one caught something this session, and each is a gate above:

- corridors by producer and by link kind (`route` / `guess` / `chord`)
- doorways straddling a bend (12.1%, and 0 is the target)
- anchor grant rate, and wall-face length distribution
- seam step at a threshold (`< 0.02m`)
- section mix, and floors carrying two or more
