# Level Pipeline: Plan-vs-Build Refactor (parked)

> **2026-08-08 — the vault composer is RETIRED.** This document describes a
> pipeline in which floors were composed from hand-authored ASCII vaults. That
> generator, its library, its tilemap parser and its carve/decor/lighting passes
> are deleted; `level/poly-floor.ts` builds every floor from polygon rooms and is
> the only generator. The DIAGNOSIS and the reasoning below still stand — they
> are why the change happened — but read any description of what the code DOES as
> a record of what it did.

**Status:** Idea, not actioned. Recorded so we come back to it the next time
`builder.ts` bites.

**Date raised:** During the arena bug morning (challenge-arena alcove + portal
culling + side-opening bypass + auto-portcullis perimeter fitting).

---

## The instinct

`perimeterFitting` worked. It moved ONE decision from imperative
("authors enumerate every door spec") to declarative ("rooms declare
intent, builder honours it"). Every bug we hit that day was a
**plan-shape question** disguised as a **build-time bug**:

- The pointless alcove was a vault-layout decision the builder
  faithfully executed even though no caller wanted it.
- The side-opening bypass was a composition decision the builder
  couldn't validate because composition + build are entangled in
  the same file.
- The portal culling pop was a consequence of logical sub-rooms
  having no geometry — a planning fact the culler had to
  re-discover by walking the room graph.

Josh's pitch: "what if we made the build steps spec out the logic
together as pure data, then build it later?" Yes, that's the
direction.

## The proposed shape

Three pure functions over a stable data type, plus one impure
executor:

```
composeFloor(vaults, seed)  →  ChainSpec      // current vault-compose, but pure
resolveFloor(ChainSpec)     →  LevelPlan      // NEW — all decisions live here
buildFloor(plan, scene)     →  LiveLevel      // current builder, but no decisions
```

`LevelPlan` is the FULLY RESOLVED spec — everything `buildFloor`
needs to execute geometry, NOTHING it has to decide. By the time
the plan is built:

- All perimeter-fitting auto-installs are done. Every wall opening
  has a known fitting or is explicitly archway.
- Every encounter has a known room set, known wave list, known
  reactor wiring.
- Cross-vault opening dedup is done. No duplicate fittings, no
  invisible-wall overlap with visible portcullises.
- Constraint validation has fired (see below). Invalid plans throw
  with a clear error referencing the vault id and the constraint
  that failed.

## Why it pays off

1. **Testability.** `builder.ts` is currently 1400 lines of
   parsing + geometry + attribution + lifecycle + encounters
   interleaved. End-to-end snapshot tests are the only viable
   gate. With `resolveFloor` as a pure function, you can unit-test
   "given THIS chain spec, the plan has THIS many portcullises at
   THIS room's perimeter."

2. **Failing fast.** Constraint violations (an entrance too small
   for the policy, a vault depth that conflicts with a referenced
   encounter, a missing torch tint for a moodTintable prop)
   surface at plan time with a sensible error. Today they
   manifest as broken geometry the player walks into.

3. **LLM-authorability.** Pure-data specs are easier for a
   content/narration LLM to produce, validate, and diff than
   directives sprinkled through 30 vault files. This was an
   explicit CLAUDE.md pillar (the layered authoring model);
   the plan layer is the data surface those layers plug into.

4. **Composability.** `composeFloor` becomes the "what goes where"
   layer; `resolveFloor` becomes the "what does it mean" layer;
   `buildFloor` becomes the "how do we draw it" layer. Each one
   is replaceable without touching the others.

## The trap to avoid

**Do NOT build a CSP solver.** Once "rooms negotiate constraints
with their neighbours" enters the design, you're one bad week
away from a 3-IR compiler that nobody can read. The interesting
wins are 80% from just SEPARATING plan from build, 20% from any
real constraint resolution.

The plan resolver should THROW on invalid plans, not auto-fix.
Authors fix the vault. The error message points at the line.

## What I'd actually do

1. Pull `LevelPlan` out of `LevelSpec` as a SEPARATE type. Start
   with a thin wrapper: `LevelPlan` is `LevelSpec` plus a few
   "decided" fields (resolved fittings list, validated openings,
   encounter→room map). Initially `resolveFloor` is the identity
   over `LevelSpec` with one or two added fields.

2. Move the perimeter-fitting auto-install OUT of `builder.ts`
   into `resolveFloor`. It's already a pure function in spirit;
   make it one in code. Builder consumes the resolved fittings
   list and just installs them.

3. Move the encounter `roomIds` discovery (the gate's two-sided
   complex match) out of `builder.ts` into `resolveFloor`. Same
   pattern.

4. Add ONE constraint check first: "every fitting's wall segment
   lies on a valid wall." If a vault declares a door at coords
   that don't sit on any room's perimeter, the plan rejects.
   This catches a real class of authoring bug.

5. Stop. Build more constraint checks as bugs demand them.

## Trigger condition

Don't do this pre-emptively. Do it the next time we hit a builder
bug whose root cause is "the builder made a decision that should
have been a planning concern." A good signal: spending a
significant chunk of time tracking a bug across multiple files in
the `level/` directory, only to realize the fix is in the wrong
file.

## Bridge habit (start now)

Any NEW feature that adds a builder decision (like
`perimeterFitting`), pull the decision logic into a pure function
the builder calls — even before there's a formal plan layer.
That's how the plan layer accretes naturally instead of arriving
as a big-bang refactor. Today's auto-install pass is already
mostly this shape; it just hasn't been EXTRACTED yet.

## Out of scope

- Constraint negotiation between rooms (CSP)
- Procedural geometry generation from constraints (e.g. "synthesize
  a 5x7 room with one west entrance")
- Plan caching / incremental rebuild
- Plan diffing for hot reload

Any of those are interesting separately; none are prerequisites
for the wedge above.
