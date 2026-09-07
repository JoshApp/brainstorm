# Performance audit — 2026-09-07

Reviewed the frame-system list, lighting/culling, particle batches, floor teardown,
floating HUD, stat aggregation and profiling harness. Based on `origin/main`
at `f9b514bf`, in the isolated `codex/perf-audit` worktree.

The game already has substantial pooling, batching, light culling and warmup
infrastructure. This pass fixes four specific sources of wasted work or misleading
measurements; it does not establish the dominant bottleneck on a physical phone.

## Findings and changes

| Area | Problem | Change and evidence |
| --- | --- | --- |
| Floating HUD | Moving `left`/`top` invalidated layout immediately before another label/card read `offsetHeight`/`offsetWidth`. | Move with transforms from a fixed origin. The final landscape fixture (three previews, prompt and item card) fell from **481 layout passes to 0 over 120 updates**. Portrait and desktop also produce zero steady-state layouts. Original and changed card bounds agree within 0.02 CSS px. |
| Sprite/flame uploads | `needsUpdate` without update ranges sent all 256 sprite slots / 128 flame slots, regardless of visibility. | Upload only the packed active prefix, including warmup. In one settled corridor sample, actual WebGPU writes totalled **162,560 bytes instead of 1,040,384 capacity bytes: 84.4% less**. All 381 observed batch writes matched their live instance counts. This reduces bytes, not the number of upload calls. |
| Relic stat reads | Every stat read rebuilt a Map of duplicate relics and synthesized stacking modifiers. The HUD and combat repeatedly read those stats. | Cache preparation by a revision incremented before pickup/clear callbacks. Keep conditional HP checks live, preserve modifier order, and return current results on every read. At 20 / 100 relics, 20,000 reads fell from **65.2 / 125.4 ms to 32.9 / 52.7 ms** (median of five rounds, local Node 22). No-relic reads stayed around 4–5 ms. These are microbenchmarks, not frame-time savings. |
| Profiling harness | Phone DPR was incorrectly nested inside `viewport`, so the purported DPR-2 run actually used DPR 1. The launcher also bypassed the existing working WebGPU headless setup. | Pass DPR at context level and reuse canonical flags/shims from `headless-browser.ts`. The live upload probe verified `devicePixelRatio === 2` on `WebGPUBackend`. |

## Validation

- `npm test`: **150 test files passed**.
- `npm run verify`: TypeScript and script/test transpilation passed.
- `vite build`: production build/PWA generation passed. Existing large-chunk
  warnings remain; the largest application chunk is about 752 KB gzipped and
  the Clerk chunk about 573 KB gzipped. Loading those deserves separate startup
  profiling before changing the import architecture.
- Browser HUD probes: landscape 844×390, portrait 390×844, desktop 1280×720.
- Regression tests exercise the installed Three.js upload implementation,
  padded attributes, shrinking/growing/hidden batches, relic stacking curves,
  live HP thresholds, pickup listeners, clear/reload and enemy isolation.

The synthetic HUD stress fixture intentionally displays several previews at once.
Its tall card can overlap the prompt on short landscape viewports in **both** the
baseline and changed code; this pass preserves placement rather than redesigning
the existing clamping rules.

## Reproduce

Run from the worktree root:

```sh
npx tsx scripts/perf-floating-ui.ts --baseline=f9b514bf --snap
npx tsx scripts/perf-floating-ui.ts --check --snap
npx tsx scripts/perf-floating-ui.ts --check --portrait
npx tsx scripts/perf-floating-ui.ts --check --desktop
npx tsx scripts/perf-relic-stats.ts
npx tsx scripts/perf-particle-uploads.ts
npm test -- instance-upload relic-stats stack-curves
npm run verify
```

The upload probe waits for warmup and samples three seconds of real queue writes.
Scene population can vary, so its percentage is illustrative; its assertions check
the invariant that every observed upload covers exactly the live prefix. Initial
buffer allocation still needs full capacity.

Do not use the short default `npm run perf` sample as a steady-state allocation
benchmark: it can still include roster/shader warmup. The initial unpatched run
also produced device errors; its counters are not a usable baseline. Headless GPU
frame times and these component microbenchmarks cannot establish a phone FPS gain.
Use an on-device settled recording, with the same seed/view/settings, to determine
whether remaining time is GPU shading, draw/uniform submission, simulation or UI.
