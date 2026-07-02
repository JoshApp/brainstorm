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

## Post-port review — 2026-07-02

A weakness pass over the finished port. FIXED in the same session:

- **Pipeline-rebuild GPU leak.** `rebuildWebGPUPipeline()` (fires on every
  resize/rotation, DPR/bloom/lean-bloom toggle, DEV probes) only nulled the
  refs; the retired PassNode / BloomNode (~11 RTs) / GaussianBlur / GTAO /
  RenderPipeline all own render targets with `dispose()`. Now: rebuild retires
  them, and they're disposed once the in-flight submit count is 0 (disposing a
  texture an in-flight submit references is a validation error).
- **`inFlight` strand on sync throw.** If `renderAsync()` threw synchronously,
  the in-flight count never decremented → every later frame skipped →
  permanent freeze. Now guarded (decrement + rethrow to the rate-limited log).
- **Corpse bleed-out was silently dead.** `stampBleedOut` queued pulses that
  only the removed WebGL `flushSplats` drained — so the growing-pool-under-the-
  corpse feature vanished in the port AND the queue grew unboundedly.
  `flushSplats` now drains due pulses into the WebGPU gore buffer. Verified
  live: 5 pulses → 0 immediate → 5 in the buffer after ~1.6s.
- **Adaptive resolution was blind on the WebGL2 fallback.** Its only signal was
  the WebGPU GPU timestamp; the fallback backend needs
  `EXT_disjoint_timer_query_webgl2` (absent on most mobiles) — exactly the weak
  devices that need the scaler. Now: a wall-clock drawn-frame-interval fallback,
  armed only on the WebGL backend (valid there — submits are sync, so rAF
  intervals stretch under GPU load; on WebGPU skip-pacing pins them). A real
  timestamp, if one ever resolves, takes over permanently. The thresholds scale
  with the frame-cap's effective interval so a deliberate 30fps cap isn't
  misread as a struggling device.
- **splat-map RT machinery deleted.** `initSplatMap` still allocated three
  render targets + GLSL stamp/dry ShaderMaterials that nothing ever rendered
  (gore is per-fragment now). Gone; the gameplay-facing emitter API stays.
  The `uSplat*` uniform refs remain exported but inert (surface-detail /
  build-model still import them — drop together later).
- **GPU-attribution probes made honest.** `setInscatterEnabled` /
  `setDepthCrushEnabled` were inert flags (the sweep reported fake ~0ms
  deltas); they now rebuild the pipeline with the effect actually off. The
  `viewmodel prepass` probe is removed — there is no prepass on WebGPU.
- **DEV lux meter no longer throws on WebGPU** (`getContext().readPixels` is
  WebGL-only); it drains requests with an explicit UNSUPPORTED verdict.

### Improvements to build on later

- **Promote tiled (Forward+) lighting.** `?tiled=1` (`scene/tiled-lighting.ts`)
  is a v2 rewrite: CPU-binned into uniform arrays (Three's stock compute-shader
  TiledLightsNode over-dispatches 32×, grids off the canvas instead of the 0.4×
  pass, and its storage bindings go stale through the warm's compileAsync) with
  NEAREST-FIRST bin insertion so tile overflow sheds the least-contributing
  lights (pack-order insertion was keeping far-past-cutoff torches and dropping
  the ones lighting the camera — the "tiled renders black" bug). Desktop A/B
  (`?scenario=perf-lights&n=N`, median GPU ms): lean 15.5/18.6/22.9 at
  n=14/30/56 vs tiled 14.8/14.9/14.9 — tiled is FLAT in light count, the "more
  torches at the same cost" win, at parity even at today's ~14 lights.
  REMAINING before promotion to default: the same A/B on the PHONE (`?tiled=1`
  works on the live site), plus a torch-dense real floor soak for look
  regressions (per-tile cap is 8 lights; overflow now degrades gracefully).
- **SSAO stays parked** — DECIDED 2026-07-02: too expensive for the phone
  budget right now; it stays a URL-flag experiment (`?ssao=1`), not a setting.
  Revisit only if the frame budget grows.
- ~~RenderPipeline.renderAsync() is deprecated in r184~~ DONE 2026-07-02:
  the frame submits via plain `render()` and MAX_IN_FLIGHT skip-pacing keys
  off `device.queue.onSubmittedWorkDone()` — true GPU completion. (The r184
  promise had degenerated to resolving at submit, so the cap had silently
  stopped skipping; this also restores the designed backpressure.)

### Done in the 2026-07-02 follow-up (the rest of the review list)

- **Async boot phase 1** — `scene/create-renderer.ts` owns construction +
  lighting-node selection + `await init()`; `main.ts` top-level-awaits it
  (vite `build.target: 'es2022'`), so everything below is structurally
  after-init. `renderer-mode.ts` (the ready flag) is gone.
- **Async boot phase 2 (2026-07-02)** — main.ts decomposed 2504 → ~1690
  lines; the boot spine now reads as the boot sequence. Carved out:
  `engine/frame-loop.ts` (cadence / fixed-step sim-present split / interp /
  fatal guard, explicit `FrameLoopDeps`), `debug/dev-hooks.ts` (all
  `window.__*` forensics + DEV URL overrides; tree-shakes from prod),
  `debug/profiler-wiring.ts` (ships-in-prod suite), `scene/video-settings.ts`
  (render scale / adaptive / bloom / DPR), `debug/boot-url-screens.ts`
  (?fake* seeds + ?show* previews), `ui/boot-veil.ts`, `debug/lux-button.ts`.
- **WebGPU device.lost recovery** — the last recovery gap:
  `installDeviceLossRecovery` (scene/context-recovery.ts) watches
  `device.lost` and shows the in-character veil + reload offer (a lost
  GPUDevice can't be revived in place; the save persists across the reload).
  `installContextRecovery` keeps owning the WebGL2 canvas events.
- **Honest renderer type** — `DelveRenderer` (= WebGPURenderer) across every
  signature; the `as unknown as WebGLRenderer` cast is gone. The dead
  `info.programs` reads became `pipelineCount()` (the pipeline-cache size).
- **GPU-load signal everywhere** — no-timestamp WebGPU adapters feed the
  adaptive scaler from submit→`onSubmittedWorkDone` latency; the WebGL2
  fallback uses the wall-clock drawn-interval path; compute timestamp pools
  are drained outside the profiler too.
- **Lux meter truly ported** — canvas `drawImage` snapshots proved racy under
  WebGPU (texture expiry → nondeterministic black); the meter now renders one
  extra frame through the real pipeline into a small RT +
  `readRenderTargetPixelsAsync` (exact display-referred image).
- **Light pool → light director** — reframed: selection/hysteresis/LOS/wobble
  is the system, slots are its output; the WebGL "fixed count dodges
  recompiles" rationale is history (documented as such), `slotScale` removed,
  env budget 10 → 14 (lean cull makes extra slots ~free — desktop-verified
  equal GPU ms; eyeball a torch-dense floor on the phone). REAL BUG FIXED:
  the lean/tiled light nodes routed SHADOW-CASTING env lights into their
  no-shadow loops, so the SHADOWS single/all settings silently cast nothing —
  casters now stay on the material path (fixed count per mode, recompile only
  on the settings flip).
- **Cleanup** — dead `gpu-timer.ts` + `render-probe.ts` deleted (with the
  inert probe arms, GPU/PASS toolbar buttons, F5/F8 hotkeys); OVERDRAW
  HEATMAP toggle chain removed; inert `uSplat*` refs removed; crash reports
  carry the adapter's real GPU name.

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
