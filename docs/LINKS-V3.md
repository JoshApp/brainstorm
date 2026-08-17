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

## Order of work — ALL FIVE STAGES LANDED, 2026-08-17

Each stage left the floor buildable and was measured, not asserted.

1. **`Link` as a type, and geometry derived from it.** ✓ Gate met: identical floors.
2. **Placement by socket.** ✓ Gate met: **blind corridors 0**, all three producers gone.
   Spine, pocket and chord are 100% routed.
3. **Declared cuts.** ✓ `Link.aCut`/`bCut` state edge, span AND height. Gate met: over
   648 doorways the hole matches the passage at the 5th, 50th and 95th percentile, and
   the stone over a doorway starts exactly at the passage's ceiling — 0 mismatches.
4. **Width from space.** ✓ `corridorTypeForSpace` wired. Squeeze 1.3% → ~40%, gallery
   ~9%, 97% of floors carrying two or more sections. The word is applied AFTER the fact
   by `sectionForWidth`, so it can never overstate what was built.
5. **Elevation over the polyline.** ✓ A link states its LANDINGS, so the fall is spent
   along the legs and the bend stays level for any leg count. `flatFloors`, `connectL`
   and the 0.9m overlap all retired in the same change.

## What this taught, and it is the reason to write it down

**Every single defect in this rebuild was one producer's output being read as a shape.**

- "Three rects, so the middle is the landing" — true of `connectL`, false of the router,
  and that one sentence is why elevation was switched off for a week.
- `w > d` as a travel axis — true while a leg is longer than it is wide, false for a Z's
  middle leg and meaningless for a square landing. It was being used that way in six
  places, including the shipping plate trim.
- `min(w, d)` as a clear width — same fault, same six places.
- `pointInPoly(rect end)` as "this corridor reaches this room" — true only because of the
  0.9m overshoot, so dropping the overshoot silently returned NO DOORWAYS and the rift
  planner cut thresholds off.
- Counting non-dormant spawns as "the floor's fight" — an ambush pack is dormant by
  design, so ambush rooms read as empty and 43% of every enemy in the game was placed by
  a repair pass.

The fix in every case was the same: **the thing that decided it should state it.** A
corridor now states its width, its height, its axis, and whether it is a leg or a
landing. Nothing infers those from a bounding box.

**And the audits were wrong more often than the code.** Nine separate checks in this
rebuild reported a healthy floor as broken, every one because it called the real function
differently than the game does — the flood keying cells with `Math.round` exactly on the
tie boundary (which cost hours chasing a wall that was not there), ten call sites
hand-mapping `{ id, rect }` into `planPortals` and stripping the declaration, a control
that required real data to still disagree. `docs/DESIGN-METHOD.md` says every audit tool
imports the real function. That is not enough: **it has to call it the way the game calls
it**, and where the input is easy to get wrong the function should build it itself.

## The measurements this replaces guesswork with

Kept because each one caught something this session, and each is a gate above:

- corridors by producer and by link kind (`route` / `guess` / `chord`)
- doorways straddling a bend (12.1%, and 0 is the target)
- anchor grant rate, and wall-face length distribution
- seam step at a threshold (`< 0.02m`)
- section mix, and floors carrying two or more
