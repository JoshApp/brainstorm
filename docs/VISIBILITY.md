# Visibility — one traversal, many subscribers

**Status: partly built.** This is the charter for finishing it. Josh, 2026-08-18:
*"the whole culling is now a patchwork of multiple things … I would like to rework a
coherent module that things can opt in to rather than the patchwork we have now."*

---

## What went wrong, so the rewrite doesn't repeat it

Every visibility bug this codebase has had is one of four faults. They are worth naming
because each of them looked like a different bug from inside the game.

**1. One question, several owners.** "Which space is this thing in" was answered by the
culler (`rectAt`, smallest-box-wins), the light pool (its own cached lookup), the signal
layer (another), and the ember emitters (another). A torch's stone, its light and its flame
could each land in a different room. That is what "signals flicker in another room" and
"lights vanish in the room I'm standing in" actually were.

**2. An answer outliving the world that produced it.** The maps are module-level, a culler
is per level, and two cullers are alive at once whenever the title vignette is up. A light
resolved during the title cached its room as `tv` and stayed dark for the whole run.

**3. The frustum leaking out of the draw list.** What to *render* depends on where you are
looking. Nothing else does. Culling lights by the draw list made torches gutter every time
the camera turned, and it took a day to find.

**4. Failing closed on "I don't know."** A space the walk never reached, a point off the
floor plan, a culler that has not ticked — every one of these was at some point read as
"hide it". Silence must mean *show*.

## Invariants

These are not preferences. Each was paid for.

- **The frustum never leaves the culler.** It is not an axis a consumer may opt into.
- **Silence fails open.** No world, no tick, no placement → visible. Only a *populated*
  answer that genuinely excludes something may hide it.
- **A world is part of an answer's identity.** Not a version to compare — part of the key,
  so a stale answer cannot be mistaken for a current one when ids repeat across floors.
- **A thing placed by position belongs to every space it touches**, and is shown while any
  of them passes. Rooms are polygons and corridors reach inside them; there is no single
  correct owner at a boundary, so do not invent a tie-break.
- **A shell belongs to exactly one space.** It is stamped with its rect id at build time.
  Position lookup is for things that were *placed*, never for things that were *built*.
- **Visibility through an opening is a question about two spans, not two points.** Sample
  the doorway across its clear width and the eye across a head's width.

## The target shape

One traversal per frame over the portal graph produces one record per space. Every consumer
reads that record through a declared policy. No consumer walks geometry, resolves a point,
or caches anything.

```
                 ┌──────────────────────────────┐
   level ───────▶│  space graph (nodes, portals)│
                 └──────────────┬───────────────┘
                                │  one flood per frame
                                ▼
                 ┌──────────────────────────────┐
                 │  SpaceVis per space          │
                 │    gates          (frustum-free)
                 │    transmittance  (frustum-free)
                 │    inView         (culler only)
                 └──────────────┬───────────────┘
                                │  membership: point → spaces[]
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        geometry policy    light policy     signal policy
        (inView + trans)   (maxGates 0)     (maxGates 1)
```

A policy is data, in one readable line at the consumer:

```ts
const LIGHT  = { maxGates: signalKnobs.lightGates() };
const SIGNAL = { maxGates: signalKnobs.gates() };
```

`gates` is the discrete, player-legible unit — a threshold is shut or it is not, decided by
whether its veil has given. It is the right axis for anything the player is meant to *learn*
by walking into it. Continuous attenuation was tried as a second axis and cut: it duplicated
a concept that already existed under a name (`reach`) that collided with a light's radius.
Do not reintroduce it without a use gates genuinely cannot serve.

## Done

- `level/space-index.ts` owns membership, world identity and `CullPolicy` / `passes()`.
- The light pool and the signal layer have no caches and no lookups of their own.
- The drawn set does not leave the culler; consumers see gates.
- One attribution rule for position-placed things, applied as an OR over the spaces they
  touch — shells keep their single build-time owner.
- Doorway sampled at 0.92 of its clear span, eye sampled across a head's width.
- `debug/cull-map.ts` draws all of it, and flags a paused world, because an `'unpaused'`
  system that is not running makes every gate on the map stale.

## Remaining

1. **One traversal.** The flood (transmittance + fog + frustum + LOS) and the gate walk are
   still two passes over the same graph. Merge them into one that emits `SpaceVis`.
2. **Ember emitters** still ask `canSeeSignalAt` rather than declaring a policy.
3. **Enemies and interactables** are still resolved per frame by `rectAt` — the single-owner
   rule this document says not to use for placed things. They move, so they need the
   membership lookup live rather than cached, but it should be the *same* lookup.
4. **Static batches** toggle per rect id. Fine for shells; check nothing placed rides on it.
5. **The `'unpaused'` phase.** A posed scenario freezes the world, so the veil tick never
   runs and every scenario measurement of gates is a lie. Either scenarios should tick the
   veils, or the freeze should be visible everywhere it matters — the map does it now, but
   the map is not the only thing that reads them.
