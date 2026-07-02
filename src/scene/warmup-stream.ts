import * as THREE from 'three';
import { deferredWarmupHooks } from '../content/warmup-registry';
import { descentWorkHeartbeat } from '../ui/descent-fade';

// ── DEFERRED WARMUP DRAIN (WebGPU) ───────────────────────────────────────────
//
// The DEFERRED warmup roster compiles here, BEHIND the first descent's cover —
// gated into the loader's prewarm, never in live play. History: this used to be
// an idle-paced stream that ran DURING play after the first floor revealed, one
// subject per calm moment. That made sense when the deferred roster was the
// whole heavy creature/item set; the registry has since gone default-essential
// (boot warms everything) and the deferred list shrank to a handful of
// viewmodel-class subjects — but each streamed step still built + compiled its
// pipelines in LIVE frames, and on slow drivers (phones) that was a
// several-second render freeze right after the first descent landed. The player
// felt "something compiling right after". The rule now (Josh, 2026-07-02): ALL
// loading happens behind a load screen — gameplay is never the compile lane.
//
// HOW it compiles the right pipeline:
//  - Each deferred subject is built into an OFF-SCREEN group parked far below any
//    floor (y = -4000), frustum culling forced OFF so the covered live render
//    still draws (and therefore compiles) it — it projects to no on-screen
//    pixels, and the descent cover is opaque above the canvas anyway. The draw
//    goes through the REAL PSX pipeline, so the pipeline compiles at the live
//    target format. (An offscreen-RT warm was tried and reverted — binding an
//    output target changes the node variants; see render-webgpu warmRender note.)
//  - Materials are RETAINED for the renderer's life so the compiled pipeline
//    survives the subject's teardown.

const retained: THREE.Material[] = [];   // pin drained pipelines for the renderer's life
let started = false;   // once per session — a completed drain must not re-run

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

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

/** Drain the DEFERRED warmup roster NOW, awaiting completion. Idempotent (once
 *  per session). Call from the first descent's gated prewarm — the cover is up,
 *  the scene + lights are in play state, and the loader holds the reveal on the
 *  returned promise, so every subject's build + compile lands behind the black. */
export async function drainWarmupStream(scene: THREE.Scene): Promise<void> {
  if (started) return;
  started = true;
  const group = new THREE.Group();
  group.position.set(0, -4000, 0);   // out of the fog even though the cover hides the frame anyway
  group.frustumCulled = false;
  group.matrixAutoUpdate = false; group.updateMatrix();
  const noCull = (obj: THREE.Object3D): void => {
    obj.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
  };
  scene.add(group);
  const queue = deferredWarmupHooks().slice();
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmup-stream] draining ${queue.length} deferred subjects behind the descent cover`);
  }
  for (const hook of queue) {
    descentWorkHeartbeat();       // pet the cover watchdog — this drain is live warm work
    try {
      hook.spawn(group);          // sync build — heavy is fine here, the cover is up
      noCull(group);              // BEFORE the render frames — else the off-screen subject frustum-culls
      await raf(); await raf();   // two live (covered) frames draw it through the PSX pipeline → compile at right format
      retainMaterials(group);     // pin the compiled pipeline
    } catch { /* one bad hook must not sink the drain */ } finally {
      try { hook.clear(); } catch { /* skip */ }     // empty any pool the hook spawned into
      emptyGroup(group);                              // and the group itself — no accumulation
    }
  }
  scene.remove(group);
}
