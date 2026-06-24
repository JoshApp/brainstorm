# WebGPU / TSL migration (the `webgpu` branch)

Living plan + log for moving DELVE's renderer from the classic WebGLRenderer
(GLSL) to Three's unified **WebGPURenderer + TSL**. Isolated spike branch; `main`
is untouched. No rush — correctness over speed; breaking the branch is fine.

## Why (and the honest non-reason)

**Wins:** future-proofing (WebGL is now Three's legacy-maintenance path; all dev
energy is on the node/WebGPU renderer), TSL shader authoring (one shader source
→ both WGSL and GLSL), lower CPU draw-submission overhead, and compute-shader
headroom for future effects.

**NOT a reason — pacing.** The frame-pacing / present judder is `rAF` + vsync +
no-VRR-control + LTPO — a browser *platform* limit, identical under WebGPU. This
migration will not change it. (See `frame-pacer.ts`; the fix there is the cap
hybrid, not a renderer.)

## Verified feasibility (2026-06)

- **Version bump clean.** Three 0.160 → **0.184**: zero tsc errors, clean vite
  build, on the existing WebGLRenderer. (Phase 0, committed.)
- **Typing works.** `three/webgpu` (`WebGPURenderer`) and `three/tsl` (`uniform`,
  `vec3`, `Fn`, …) resolve and typecheck in 0.184 — Three ships its own types now.
- **Fallback is built in.** `WebGPURenderer` auto-selects WebGPU, else WebGL2.
  So the END STATE is a SINGLE renderer (no permanent dual path); the WebGL2
  fallback covers devices without WebGPU (older Android, non-26 iOS).

## End-state architecture

- ONE `WebGPURenderer`, constructed async (`await renderer.init()` before first
  render, or `renderer.renderAsync()`).
- All materials are node/TSL materials. Standard materials (`MeshStandardMaterial`
  etc.) auto-convert; our CUSTOM shaders become TSL.
- The PSX post pipeline (`render-target.ts`) rebuilt on Three's TSL-based
  `PostProcessing` (`three/tsl` + `three/addons/.../PostProcessing`), or hand-
  rolled node passes.
- Profiling GPU timing on WebGPU timestamp queries (the cockpit's
  `EXT_disjoint_timer_query` + `readPixels` probe are WebGL-only).

## Transition strategy

Keep WebGLRenderer the DEFAULT on the branch so the game stays runnable, and
build the WebGPU path behind **`?webgpu=1`** so each milestone is A/B-testable on
the dev server (`localhost:5191`). Collapse to WebGPU-only once the pipeline is
ported and verified on the phone.

## The porting surface (audit)

### Renderer-API usages (WebGL-specific → must change)
- `render-target.ts` — `WebGLRenderTarget` ×N → `RenderTarget`; the whole multi-
  pass pipeline.
- `debug/gpu-timer.ts`, `debug/frame-timing.ts` — `getContext()`,
  `EXT_disjoint_timer_query_webgl2`, `readPixels` → WebGPU timestamp queries.
- `debug/lux.ts`, `style/surface-textures.ts` — `readRenderTargetPixels` /
  readback → async WebGPU readback.

### Custom GLSL → TSL (8 files)
- `style/render-target.ts` — **the crown jewel**: blit (PSX palette/dither/CRT),
  bloom, depth-crush, fog-inscatter. Biggest single task.
- `ecs/build-model.ts` — **the reveal seam** (`onBeforeCompile`): "significant
  forms revealed by coloured light out of black." Core visual identity. Port to a
  TSL node-material override. High priority, high care.
- `scene/lamp-reveal.ts` — lamp-reveal shader (wall-runes, corpse reveal).
- `scene/splat-map.ts` — gore splat stamping (ShaderMaterial).
- `style/surface-detail.ts`, `style/surface-ao.ts`, `style/surface-textures.ts`
  — procedural surface shading (`onBeforeCompile` + ShaderMaterial).
- `interactables/outline.ts` — selection outline.

### `onBeforeCompile` patches (6) → TSL node overrides
`surface-detail`, `surface-ao`, `build-model`, `lamp-reveal`, `geometry-prims`,
`debug/lambert-preview`. `onBeforeCompile` is WebGL-only; under WebGPU it's
ignored, so each becomes a node-material composition.

## Phases (tracked as tasks)

- **Phase 0 — version bump** ✓ committed (build-clean; visual check on 5191 TBD).
- **Phase 1 — renderer foundation**: WebGPURenderer construction + async boot +
  ready-gate, behind `?webgpu=1`; raw scene renders under WebGPU (PSX + custom
  shaders bypassed/degraded). Proves the backend boots end-to-end.
- **Phase 2 — TSL pipeline**: port the shaders above, re-enabling each under
  `?webgpu=1`. Reveal seam + PSX blit first (they define the look).
- **Phase 3 — profiling on WebGPU**: timestamp-query GPU timing so the cockpit
  keeps working.

## Suboptimal / buggy / fragile — flagged during the port, REVISIT

Not blindly porting these — noting them so we fix root causes, not reproduce
them. (Maintained as the rewrite surfaces more.)

- **`renderer.info` manual-reset coupling** (`render-target.ts` + `main.ts:265`).
  `info.autoReset=false` + a manual `info.reset()` inside `renderWithStyle` is
  fragile global state — it silently broke under WebGPU (draw counter climbed
  unbounded). The per-frame stat plumbing should be explicit, not a global flag
  the render path is trusted to reset.
- **Too much render-dependent work at MODULE BOOT.** The WebGPU port was
  whack-a-mole because the surface-texture bake (readback), `warmupContent`
  (render), `renderer.compile`, and `flushSplats` all assume a *synchronous*,
  ready renderer at import time. There's no clean async init phase — `main.ts`
  does ~all of boot at module scope. A real `async boot()` would make this (and
  any future async backend) sane.
- **Global `ShaderChunk` monkey-patching** (`banded-lighting.ts` mutates
  `THREE.ShaderChunk.lights_fragment_end` for ALL materials). Fragile global
  mutation, hard to reason about; TSL node materials replace it cleanly.
- **The light pool** — a whole subsystem that exists only to dodge WebGL
  light-count recompiles (see above). The "three torch emitters must agree on
  tint" trap is a symptom of its complexity.
- **Warmup machinery over-built for WebGL quirks** (retain-materials-so-dispose-
  doesn't-delete-the-program, the instanced-warm hack). `compileAsync` collapses
  it.
- **`main.ts` is ~2000 lines** doing boot + renderer + systems + profiler +
  scenarios at module scope. Worth decomposing once the renderer settles.

(Already fixed this session, same class of latent bug: the frame-pacer metastable
accumulator, and `preserveDrawingBuffer` always-on in Debug Mode.)

## Risks / watch-list

- **Lighting/color from the bump** (useLegacyLights removed): the game may render
  brighter/darker on 0.184 even on WebGL — verify on 5191 before trusting any
  WebGPU comparison.
- **`renderAsync` in the sync tick loop**: the loop is synchronous; WebGPU render
  is async. Use a ready-gate + `renderAsync` carefully so a frame can't overlap.
- **iOS coverage**: WebGPU only on iOS 26+; the WebGL2 fallback must stay healthy
  (don't author anything TSL can't lower to GLSL).
- **`readPixels` paths** (lux, splat readback, GPU probe) are sync on WebGL,
  async on WebGPU — anything reading them mid-frame needs rework.
