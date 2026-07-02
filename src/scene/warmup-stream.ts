import * as THREE from 'three';
import { deferredWarmupHooks } from '../content/warmup-registry';

// ── DEFERRED WARMUP STREAM (WebGPU) ──────────────────────────────────────────
//
// The proper fix for the boot freeze: don't warm the whole roster up front. Boot
// warms only the cheap ESSENTIAL hooks (core combat VFX) behind the loading cover;
// the heavy DEFERRED roster — enemy bodies (CSG creatures), item drops, destructibles
// — is STREAMED here during play, one subject per calm moment.
//
// HOW it compiles the right pipeline without a visible flash:
//  - Each deferred subject is built into an OFF-SCREEN group parked far below any
//    floor (y = -4000), frustum culling forced OFF so the live render still draws
//    (and therefore compiles) it — it just projects to no on-screen pixels. The
//    draw goes through the REAL PSX pipeline, so the pipeline compiles at the live
//    target format. (An offscreen-RT warm was tried and reverted — binding an
//    output target changes the node variants; see render-webgpu warmRender note.)
//  - Materials are RETAINED for the renderer's life so the compiled pipeline
//    survives the subject's teardown.
//
// PACING — the "lags for a few seconds after spawn" fix: a subject build
// (buildCreature/CSG) is a heavy SYNCHRONOUS block that can't be split, so the only
// lever is WHEN it runs. Steps fire on requestIdleCallback with a generous timeout,
// but additionally require (a) a minimum gap since the last step and (b) a healthy
// last frame — if the loop just spent >24ms on a frame (arrival ceremony, combat
// burst, GC), the step re-queues instead of piling on. The stream finishing a few
// seconds later is free; the player feeling it is not.

const retained: THREE.Material[] = [];   // pin streamed pipelines for the renderer's life
let started = false;   // once per session — a completed stream must not re-run

const STEP_GAP_MS = 350;        // minimum spacing between subject builds
const HEALTHY_FRAME_MS = 24;    // skip the idle slot if the last frame ran longer

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const onIdle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 4000 }); else setTimeout(fn, 400);
};

function retainMaterials(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) retained.push(mat);
  });
}
/** Empty the warm group after a subject is compiled: REMOVE the meshes so they stop
 *  rendering. We do NOT dispose the geometry — on WebGPU you cannot free a buffer
 *  the backend may still reference in an in-flight submit ("used in submit while
 *  destroyed"), and there's no CPU-side completion signal to know when it's safe.
 *  Same trade-off as warmup-pass.ts: the warmed roster's resident geometry is
 *  retained for the session (a few MB), pipelines pinned via the materials. */
function emptyGroup(group: THREE.Group): void {
  for (const child of group.children.slice()) group.remove(child);
}

// Last-frame health signal, fed by the frame loop (engine/frame-loop.ts) so the
// stream can yield to a struggling frame without importing loop internals.
let lastFrameMs = 0;
export function feedStreamFrameMs(ms: number): void { lastFrameMs = ms; }

/** Start streaming the DEFERRED warmup roster during play. Idempotent (once per
 *  session). Call after the first floor reveals — the essential warm is done and the
 *  player is in-game, so the idle scheduler has calm moments to work in. */
export function startWarmupStream(scene: THREE.Scene, onComplete?: () => void): void {
  if (started) return;
  started = true;
  const group = new THREE.Group();
  group.position.set(0, -4000, 0);   // out of the fog even if a live frame catches it
  group.frustumCulled = false;
  group.matrixAutoUpdate = false; group.updateMatrix();
  const noCull = (obj: THREE.Object3D): void => {
    obj.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
  };
  scene.add(group);
  const queue = deferredWarmupHooks().slice();
  let lastStep = 0;

  const step = async (): Promise<void> => {
    // Re-queue rather than pile onto a busy moment: too soon since the last
    // build, or the loop just had a slow frame (combat burst / ceremony / GC).
    const now = performance.now();
    if (now - lastStep < STEP_GAP_MS || lastFrameMs > HEALTHY_FRAME_MS) {
      onIdle(() => { void step(); });
      return;
    }
    lastStep = now;
    const hook = queue.shift();
    if (!hook) {
      scene.remove(group);
      // Everything's warm now — let the self-policing guard arm (any compile from
      // here is a genuine unwarmed gap).
      try { onComplete?.(); } catch { /* skip */ }
      return;
    }
    try {
      hook.spawn(group);          // sync — heavy for creatures, unsplittable
      noCull(group);              // BEFORE the render frames — else the off-screen subject frustum-culls
      await raf(); await raf();   // two live frames draw it through the PSX pipeline → compile at right format
      retainMaterials(group);     // pin the compiled pipeline
    } catch { /* one bad hook must not sink the stream */ } finally {
      try { hook.clear(); } catch { /* skip */ }     // empty any pool the hook spawned into
      emptyGroup(group);                              // and the group itself — no accumulation
    }
    onIdle(() => { void step(); });
  };
  onIdle(() => { void step(); });

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmup-stream] streaming ${queue.length} deferred subjects during play`);
  }
}
