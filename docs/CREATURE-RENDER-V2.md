# Creature Render V2 — rigid-skinned creatures

**DECIDED 2026-06-24.** Replace the per-joint rigid-segment **instancing**
(`mobs/creature-instancing.ts`) with **one `THREE.SkinnedMesh` per creature**.

## Why

The current renderer draws each creature as 15–17 rigid joint-segments **plus**
every authored-named part (all the clothing/armor) drawn individually — so a
clothed creature ≈ **~30 draws**, instancing barely helps, and the system is
fragile (the 2026-06-23 perf saga: shadow-cast poison, empty-batch leak,
compile gaps, geo leaks all came out of this machinery). At the target count
(**packs of 6–15**), the win is fewer draws PER creature, not sharing across
many.

## The approach (native, low-risk)

The art is **rigid** articulation (chunky PS1 parts, no smooth deform) =
`SkinnedMesh` with **rigid skin weights** (each vertex 100% to ONE joint).
Three's built-in skinning chunk does the GPU transform — **no custom shader**.

- `buildCreature`'s joints → a `THREE.Skeleton` (bones ARE the joints).
- All parts merge into **one BufferGeometry**; each vertex gets
  `skinIndex = [jointIndex,0,0,0]`, `skinWeight = [1,0,0,0]`.
- The existing per-frame joint animation drives the bones; the mesh deforms
  rigidly on the GPU → **1 draw/creature**, look identical.
- **Pack of 10: ~300 draws → ~10.**

## Dismemberment (keep a few: head, arms)

A small set of `severable` joints. On sever: move that bone far off (its verts
follow → vanish) or zero its verts, and spawn a flung part mesh at its world
pose. Body stays one draw. Per-LIMB precision only for the severable set, not
every joint.

## Integration (what stays / changes)

- **Animation** — unchanged in spirit: it already produces joint matrices; we
  feed them to the bones.
- **Hit zones / hurtbox** — unchanged (read joint world transforms).
- **Corpse / dissolve** — the skinned mesh carries the same `uDissolve` uniform.
- **Hit flash** — per-creature material flash (simpler than instanceColor; we're
  not instancing).
- **Shadows** — `castShadow=false` (blob shadow, as today). One mesh, easy to
  get right (no shared-segmentCache poisoning).

## Milestones (incremental, behind `?creatureV2=1`)

- **M1 ✓ DONE** — V2 builder (`mobs/creature-skinned.ts`). Headless-verified
  (`npm run verify-skinned`): all 20 buildable creatures bind-correct (skinned
  bind-pose bbox == original, 0 vert drift), 5–9× fewer draws.
- **M2 ✓ DONE** — wired into enemy spawn (gated). Flash/dissolve/core-reactor
  inherited free (they key off shared `built.materials`); animation automatic
  (joints ARE the bones). Chrome-verified on the arena pack: 6 SkinnedMeshes,
  **draws 203→150 (−26%)**, tris 71k→56k, **enemy draws 71→21**, no shader
  errors, correct articulation + live anim.
- **M3 ~ CODE-COMPLETE, on-device verify pending** — dismember (`severBone`
  collapses a joint subtree → limb vanishes; head + 2 shoulders + 2 hips;
  headless-verified) + death parity (crumble's per-joint fling skipped; topple +
  dissolve-in-place; release no-ops). **NOT done: retire `creature-instancing.ts`
  / flip default** — gated on confirming death+dismember FEEL on the phone (the
  remote kill hook `__smite` is stale/no-op, so combat death is untested in
  Chrome). All M2/M3 edits are no-ops when the flag is off → legacy unchanged.
- **M4 (optional, later)** — instanced rigid-skinning (bone-matrix texture) for
  true hordes (1 draw/TYPE). Only if counts grow past packs.

## Guardrail (built alongside)

**Perf-budget headless test** — load representative `?scenario=`s, assert
draws/tris/programs under a budget, fail CI on regression. So V2 — and every
future feature — can't silently blow the draw budget again. See
`scripts/perf-analyze.mjs` for the measurement vocabulary.

## Method

Profile in real Chrome (chrome-devtools MCP, CPU-throttled to ~mimic the POCO
F3) for the structural/CPU picture; phone recordings (`perf-analyze`) for
thermal + mobile-fill validation. **Instrument, don't guess** — the saga's
lesson.
