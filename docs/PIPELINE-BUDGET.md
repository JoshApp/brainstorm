# Pipeline Budget — zero in-game compilation

The charter for "no hitches during gameplay, ever." Read with `docs/WARMUP.md` (the warm
machinery) — this doc is the **why** and the **invariant**; WARMUP.md is the **how**.

## The law

> A WebGPU render **pipeline** (PSO) is compiled the first time a unique
> `(shader × vertex-layout × target-format × blend × depth × topology)` is drawn. The
> compile is **synchronous and ~tens of ms** — so a first-use compile *during* a frame
> *is* the hitch. ([W3C WebGPU spec], [MDN createRenderPipeline], [Toji glTF case study])

Every shipping engine solves this the same two ways, together — "PSO precaching"
([Unreal tech blog], [UE5 PSO playbook]):

1. **BOUND the set** of pipelines the game can ever need (no unbounded variants), and
2. **PRECOMPILE that whole set up front**, at a loading screen.

If the set is **closed** and **fully precompiled**, in-game compilation is not "rare" —
it is *impossible*, because there is nothing left to compile.

## Why DELVE hitched

A Three-WebGPU wrinkle makes (1) the hard part: the backend effectively mints a pipeline
**per material *instance*** — two structurally-identical `MeshStandardMaterial`s each
compile their own ([three.js #32735], [Babylon pipeline-cache notes]). So our pattern of
`new THREE.MeshStandardMaterial(sameParams)` **inside per-floor build functions**
(`decorate.ts`, `builder.ts`, `chandelier.ts`) minted **fresh pipelines every descent** —
the unbounded explosion (material IDs climbing `_864 → _1853`, recompiling each floor).
Multiplied by varied geometry attribute layouts, and made un-pre-warmable by LOS rooms
that stay hidden until entered.

## The three pillars

**1. Closed material set — `style/material-registry.ts` (`stdMat`).**
Every static surface material is requested via `stdMat(params)`, which returns a **shared,
structurally-deduplicated instance**. Identical params → one instance → one pipeline. The
distinct-material set becomes small and **enumerable** (a few kinds × the few per-act torch
tints), not per-floor-unbounded. Level teardown never disposes materials (`builder.ts`), so
sharing across floors is safe. **Invariant:** no `new THREE.MeshStandardMaterial` in
per-floor build code — route it through `stdMat`.

**2. Bounded geometry layouts.** Floor/wall/decor meshes emit ONE attribute layout
(position+normal+uv; vertexColors only where load-bearing and consistent) so `material ×
layout` stays a small product, not a combinatorial blow-up. *(Pillar 2 — staged after 1.)*

**3. Precompile the closed set at boot.** Because the set is enumerable, the boot warm
compiles every `(material × layout × render-state)` — including the **shadow** pass and the
**PSX target format** — once, behind the loading veil, exactly as it already does the enemy
roster. `registeredFloorMaterials()` exposes the live set to the warm.

## The acceptance test (CI-able invariant)

`window.__compileStats().compileHitches` must reach **0** during active play. The compile
watch (`debug/webgpu-compile-guard.ts`) flashes the instant anything compiles in-game — so
a single non-zero means *something minted a material outside the registry*. That is the
guard rail that keeps the budget closed as content is added.

## Status

- [x] Pillar 1 — `stdMat` registry + route the per-floor `new Material` sites through it.
- [ ] Pillar 1b — boot-prime the registry (enumerate per-act tints) so the warm covers it
      at boot, not just lazily on first encounter.
- [ ] Pillar 2 — unify floor/decor geometry attribute layouts.
- [ ] Pillar 3 — iterate `registeredFloorMaterials()` in the boot warm; drive hitches → 0.

[W3C WebGPU spec]: https://www.w3.org/TR/webgpu/
[MDN createRenderPipeline]: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipeline
[Toji glTF case study]: https://toji.dev/webgpu-gltf-case-study/
[Unreal tech blog]: https://www.unrealengine.com/tech-blog/game-engines-and-shader-stuttering-unreal-engines-solution-to-the-problem
[UE5 PSO playbook]: https://www.strayspark.studio/blog/ue5-shader-stutter-pso-precaching-playbook
[three.js #32735]: https://github.com/mrdoob/three.js/issues/32735
[Babylon pipeline-cache notes]: https://doc.babylonjs.com/setup/support/webGPU/webGPUInternals/webGPUCacheRenderPipeline
