# Move Timeline — the unified attack-move system

**Status:** core runtime built + tested (`src/combat/move-timeline.ts`,
`tests/move-timeline.test.ts`). Integration into the viewmodel + combat
in progress, proving on the Harrow first.

## Why

The old system fused three concerns and split the one that mattered.
Animation was a single pose-curve per combo step; hits were a separate
"re-open the strike N times" hack in `attack.ts` on a *different* clock.
They desynced (flurries fired damage but the weapon only played one
stab), and every attempt to bolt on multi-hit animation was a patch on
a structural gap. Multi-hit, rhythmic attacks, and item modifiers that
change *how* you hit had nowhere clean to live.

## The model — three layers, one clock

An attack **move** is one authored timeline that both the animation and
the hit resolver read from, so they cannot desync.

- **Motion** (how it looks): normalized pose keyframes — `intro`, a
  repeatable `loop` cycle (one stab out-and-back), `outro`.
- **Timing** (how fast): real-second durations, scaled by `attackSpeed`.
- **Hits** (what/when): a strike lands at `hitAt` within each loop; the
  loop **count** is the flurry size.

Payload (damage / bleed / procs) stays with the caller — separate from
motion + timing, so balance is tuned as data without re-animating.

## The two item stats (deliberately distinct — they feel different)

- **`attackSpeed`** — compresses the whole clock. Motion *and* hits speed
  up together, always in sync. A faster dagger.
- **`flurryHits`** — adds loop iterations. More stabs, more hits; the
  animation just repeats its cycle more. A dagger that rips more per swing.

They compose: `resolveMove(spec, { attackSpeed, flurryHits })` →
`{ duration, loops, hitTimes[], poseAt(t) }`. The viewmodel calls
`poseAt(elapsed)` each frame; the combat resolver fires a strike as
real-time crosses each `hitTimes[i]`. Same clock, guaranteed sync.

## What it unifies

Flurry = the loop (within a move). Combo = a sequence of moves.
Directional / charged = alternate MoveSpecs picked by input state. All
the old special cases (flurry hack, directional-move shadow, finisher
path) collapse into "author a MoveSpec as data."

## Migration

1. ✓ Core runtime + tests (`move-timeline.ts`).
2. Author the Harrow as a MoveSpec; viewmodel reads `poseAt`, combat
   reads `hitTimes` — behind a per-weapon flag, old path untouched.
3. Verify in-browser (the weapon visibly stabs N times, in sync).
4. Migrate remaining weapons; delete the flurry hack + phase-pose path.

Feel is preserved through migration: existing tuned poses/timings become
the timeline data — the structure changes, the values don't.
