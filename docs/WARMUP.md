# Shader / Pipeline Warmup (WebGPU)

How DELVE avoids first-use shader stutter on WebGPU, why it's built this way, and how
to extend it. This is a baseline system — read this before changing the warmup.

## The problem

A WebGPU **render pipeline** is compiled the first time a unique (material × render-state)
combination is drawn. That compile is slow and can't fit in a frame, so the first spawn of
an enemy / first death / first vase-break **hitches**. We compile everything once, up front,
behind the loading screen, so play is smooth.

The hard part is the **"exact circumstances"**: a pipeline's identity is its *whole*
descriptor — shader code **+ vertex buffer layout (incl. skinning attributes) + target
texture format + blend + depth/stencil + topology + bind-group layout**. Warm under *any*
different state and you compile a *different* pipeline; the real one still compiles on first
use. So the warm must run at the **exact live state**.

## The three load-bearing facts (from research)

1. **Browsers persistently cache compiled pipelines across sessions** (Chrome's
   `DawnWebGPUCache`). First creation is slow, cached creation is fast. So warmup is
   fundamentally a **first-visit-only** cost; an installed PWA warms once, then is fast.
   (Caveats: origin-partitioned, **off in incognito**, evictable under storage pressure.)
2. **There is no app-level pipeline cache API** (`GPUPipelineCache` is deferred post-MVP).
   Unlike Unity/Vulkan/D3D, we **cannot record + ship precompiled pipelines.** The browser
   cache is the only persistence and it's automatic/opaque.
3. **A pipeline is determined by the material + the geometry's *attributes*, not its vertex
   count.** So we do **not** need to build a full creature to warm its pipeline.

## The architecture

### 1. Cheap warm — materials on dummies (`content/spawn-warmups.ts`)
The naive warm built the entire creature (CSG + skinning, ~seconds each) just to render its
material — froze boot, then (when deferred to play) lagged for ~20s. Instead we create just
the **material** (`createMaterialFromDef` — applies the full reveal/dissolve/gore node setup)
and render it on a **tiny dummy of the right attribute shape**:
- creature bodies → a **1-bone `SkinnedMesh` quad** (the skinning variant),
- everything → a **tiny box** (the plain variant, used by flung chunks / props / items).

A real creature mesh's attributes are `[normal, position, skinIndex, skinWeight, uv]` — the
dummy matches exactly, so it compiles the **identical pipeline** the live spawn reuses.

### 2. Warm everything at boot, behind the loading cover
Because warming is now cheap, every content hook is `tier: 'essential'` (the default) and the
whole roster warms at boot through the **real PSX pipeline** (`runWarmupPassWebGPU`), so the
compiled pipelines match the live render's target format. The game frame is fully paused
during this (`scene/loading-gate.ts`) — no sim, audio, or half-built artifacts — and the
descent cover shows a real progress bar. Repeat visits hit the browser cache → near-instant.

### 3. The compile guard (`debug/webgpu-compile-guard.ts`)
`renderer.info` has no `.programs` on WebGPU, so the WebGL warmup guard was blind. We patch
the device's `createRenderPipeline` (transparent pass-through) to count compiles and **warn
on any that happen after warmup** — the WebGPU-native "record what compiles" instrument.
`window.__compileStats()` → `{ total, postWarmup, gaps }`. **postWarmup must be 0**: it's the
proof the warm is comprehensive, and it lights up immediately if a new material type isn't
warmed.

## The compile / lagspike watch (your radar)

`renderer.info` has no `.programs` on WebGPU, so `debug/webgpu-compile-guard.ts` patches the
device's pipeline creation to count compiles. `tickCompileWatch()` runs each frame (DEV) and
**flashes an on-screen banner the instant a pipeline compiles in-play** (red — a fixable WARM
GAP) or a frame runs long (amber — GC/CPU). `window.__compileStats()` returns
`{ total, postWarmup, gaps, compileHitches, laggyFrames }`. **The goal is `compileHitches`
trending to 0** — when you add content, play it and watch: a red flash means you introduced a
gap, and `gaps` names the material type.

## How to add a warmable

- **Enemy / item / destructible / prop**: warmed automatically — enemies/items from their
  registries, props from `WARM_MODELS` (`content/warmup-models.ts` — add a prop spec there).
- **A new effect** that spawns a new material mid-combat: `registerWarmup({ label, spawn, clear })`
  next to its spawn/tick/clear.
- **CRITICAL — non-`MeshStandard` materials.** The cheap materials-on-dummies warm only covers
  `MeshStandard`. **Sprites, Points, and Basic materials are SEPARATE pipelines** (keyed on
  blending + fog), warmed by the `primitive:sprites+basic` hook in `spawn-warmups.ts`. If you
  add a sprite/points/basic with a NEW blending or fog combo, the watch will flash it — extend
  that hook with the new variant.

After any addition, confirm `window.__compileStats().compileHitches` stays ~0 while exercising it.

## Known limits / future options

- **First visit compiles ~all pipelines** (one-time, behind the loading screen). Repeat visits
  are cache-fast. If first-visit load needs to be shorter, the lever is async pipeline
  creation (`createRenderPipelineAsync`, non-blocking) — but it must compile at the **PSX
  target format**, not the canvas format, or it warms the wrong pipeline (gaps reappear).
- **Geometry of the warm dummies is shared + tiny**; nothing heavy is retained. Materials are
  retained so the pipelines stay pinned for the session.
- **Record-and-replay manifest** (Unity ShaderVariantCollection style): the compile guard
  already records the keys; if `postWarmup` ever shows real gaps we can persist them to
  localStorage and warm them next boot. Not needed while `postWarmup` is 0.
