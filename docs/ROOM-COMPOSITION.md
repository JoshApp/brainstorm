# Room composition — how a room gets furnished

Companion to **LEVEL-ARCHITECTURE.md** (which covers the floor plan) and
**VISUAL-LANGUAGE.md** (which covers what light is allowed to mean). This one
covers the middle: once a room has a shape, how does anything get *put in it* —
pillars, pilasters, sconces, altars, mobs, voids, embers — without ending up
inside each other, inside a wall, or in a place that reads as an accident.

---

## 0. The lesson this document is built on

The polygon shell shipped on 2026-08-05 with three defects that were live on the
phone within an hour: geometry with no vertex-colour attribute (black holes),
a ceiling mirrored in Z (the back of the room open to the void), and walls built
as independent slabs stretched past their ends "so they overlap" (which seals a
right angle and nothing else).

None of them were carelessness in the usual sense. They were all **unfalsifiable
by looking**. A hairline wedge at a chamfer is invisible in a screenshot. A
mirrored ceiling over a symmetric test room is correct. An unbound attribute
renders fine on one driver.

So the rule that governs everything below:

> **A placement system lands with the assertion that would have caught it being
> wrong. If you cannot state the invariant, you do not understand the system yet
> and should not be porting content onto it.**

The three defects above are now three one-line assertions in
`tests/poly-shell.test.ts`, each verified to bite by reintroducing the bug.
That is the bar.

### Quick port, or fix the foundation?

**Fix the foundation, one system at a time, each behind its invariant.** The
argument is not aesthetic. It is that we already ran the experiment: the
"port it and refine" version of the shell took an afternoon to write and
produced three bugs, two of which the codebase had *already documented as traps*
in comments the new code never read. The refinement pass costs more than
building it right, and it costs it in Josh-on-a-phone time.

"Don't over-architect" still holds for features. The shell, the placement
authority and the light vocabulary are not features — they are amortised over
every room the game will ever generate.

---

## 1. The tell: five repair passes

Today's builder contains `nudgePropsOutOfPassages`, `clearChestsBlockingCorridors`,
`rescueOneBlocker`, `ensureStairsReachable`, and an "elbow room" pass that strips
dressing off anything you have to touch.

Five repair passes is not five bugs. It is one bug, five times: **placement is
blind, and the damage is repaired afterwards.** Each pass fixes the failure that
was visible when it was written, which is why they accumulate and why they
sometimes fight each other.

Everything below replaces "place, then repair" with "place against a model of
what is already there."

---

## 2. Three registries a room publishes

The polygon shell already computes most of this — it is currently thrown away.

### 2.1 `WallSurface[]`

One per wall span, straight out of `planWallRing`: the inner segment, its
**inward normal**, its length, its height, its elevation, and whether each end is
a mitred corner or a doorway jamb.

Anything that mounts on a wall — sconce, pilaster, banner, rune, chain, seep,
wall mark — **asks a surface for a slot** instead of being handed an `(x, z)` and
a compass letter `'N' | 'S' | 'E' | 'W'`.

This is not tidiness. The compass letter is *why* the starter chamber's stair
sconce ended up hanging in the void when the room became an apse: the wall it
named stopped existing at that Z, and nothing could tell. A surface-relative
mount cannot express that mistake. It also kills the whole class at once — a
sconce can no longer land in a corner, inside a doorway, or on a wall that a
diagonal made shorter than the fixture.

Diagonal walls come free, which the compass letter never could.

### 2.2 `FloorRegion`

The polygon minus its voids, plus a **clearance field**: for any point, the
distance to the nearest wall and to the nearest already-claimed thing.

Placement becomes a *query*, not a coordinate:

- an altar wants **max clearance near the centroid**
- clutter wants the **wall band** (0.4–1.2m from a wall)
- a pillar colonnade wants a **rhythm**: even spacing along the room's long axis
  at a fixed wall offset
- an event wants **sightline from the entrance** (see §5)

The clearance field is also what makes "don't put things inside each other"
structural rather than a post-hoc nudge.

### 2.3 `Volume`

The dimension nothing currently models. A pillar is a cylinder from floor to
ceiling. A chandelier is a volume hanging *from* the ceiling. A god ray is a
shaft between the two. A pilaster is a slab standing off a wall.

Intersections are exactly what "they end up inside each other" means, and you
cannot prevent them with a 2D footprint. One occupancy structure that everything
**reserves against, in 3D**. Rooms are small; this is cheap.

---

## 3. Placement rules as DATA

With the registries above, the "rules" become specs the content layer can author
without reading the builder — which is the seam CLAUDE.md's Authoring Model
asks for.

```ts
pilaster: {                        // the engaged wall pillar
  mounts: 'wall',
  rhythm: 'even', spacing: [2.5, 4.0],
  minSpanLen: 3.0,                 // a short span gets none, not a cramped one
  skipNear: ['jamb', 'corner'],
  reserves: slab(0.5, 0.25, floor..ceiling),
}
sconce: {
  mounts: 'wall', rhythm: 'even', spacing: [4, 7], height: 2.0,
  avoid: ['pilaster'],             // resolved by the occupancy grid, not by luck
  requires: 'clear cone into the room',
}
pillar: {
  mounts: 'floor', rhythm: 'colonnade', wallOffset: [1.2, 2.0],
  reserves: cylinder(0.45, floor..ceiling),
}
```

`rhythm` is the load-bearing word. Architecture reads as architecture because
things REPEAT at an interval; scattering pilasters by rejection sampling reads as
rubble. A room should pick an interval once and hold it.

---

## 4. Light needs a shape vocabulary

Right now a light is a point with a colour. Josh's ask — *"lights can even be
placed on top of geometry or take different kinds of shapes"* — is really the
observation that **the emitter should be a property of a fixture, and fixtures
should declare what shape their light is.**

| shape    | fixture                      | what it signals                         |
| -------- | ---------------------------- | --------------------------------------- |
| `point`  | sconce, candle               | the baseline. Means nothing by itself.  |
| `pool`   | floor glow under an altar    | a hot spot — something is *here*        |
| `shaft`  | god ray                      | anchors content. Never ambience.        |
| `line`   | a crack in a ceiling or wall | a seam, a breach, something structural  |
| `volume` | bonfire, brazier stack       | safety, or a beat that just resolved    |

The slot-based light pool (`scene/light-pool.ts`) already handles the runtime
cost. What is missing is the vocabulary and the **budget**: per
VISUAL-LANGUAGE.md, anything brighter than the player's lamp, or in a colour the
lamp is not carrying, is a promise. One focal per room. That budget should be
asserted against the FINAL room, not intended by each producer — see
DESIGN-METHOD.md, "check final-state rules against the final state," which is
the rule we learned when four different producers each placed a major beat and
the director's one-per-room guarantee held only in the director.

---

## 5. Voids and obstacles are circulation edits, not decoration

`combineRects(add, sub)` already subtracts. The discipline is that a void is
**cut, then verified**: re-run reachability on the polygon, and if the cut
splits the room, either bridge it or reject the cut. Never place a hole and hope.

Named patterns, each a recipe taking `(polygon, role)` and returning polygon
edits plus spawn hints:

- **pinch** — a void narrowing the room to a choke. Forces commitment; good
  where a room should be defended.
- **ring** — a void in the middle. You must go around; ranged enemies gain a lot.
- **gallery** — a raised lip you can be shot from (needs R2 plates, #139).
- **bridge** — a single crossing with a drop either side. The most dramatic and
  the one that most needs the fall rules (#136) to exist first.

That is what turns "obstacles" into "gameplay patterns": the pattern is the unit,
not the individual rock.

## 6. Encounters should read the shape

Spawn placement currently knows the room's *role* but not its *form*. It should:

- an **ambush** wants spawn points outside the entrance's sightline
- an **arena** wants them spread on the far side, so the fight comes to you
- a **turret** (lasher, plague spore) wants a spot with long sightlines — which a
  polygon can now actually answer, since sightline is a segment test against the
  wall ring

---

## 7. Order of work

Each step lands with its invariant and is separately shippable.

1. **Publish `WallSurface[]`** from the shell and move sconces onto it.
   *Invariant:* every mounted fixture lies on a wall span, faces into the room,
   and clears every jamb.
2. **`FloorRegion` + clearance field**, and move ONE placer (clutter) onto it.
   *Invariant:* no placed prop overlaps another; every prop's reservation is
   inside the polygon.
3. **3D occupancy + `reserves`**, then pilasters and pillars as the first
   rhythm-based placers. *Invariant:* no two reservations intersect in 3D.
4. **Light shapes + the one-focal budget**, asserted on the final room.
5. **Void patterns**, gated on reachability after the cut.
6. **Encounter placement reads the polygon.**

Steps 1–3 delete repair passes as they go. That is how we know they worked:
the count of "fix it afterwards" passes should go DOWN, not up.
