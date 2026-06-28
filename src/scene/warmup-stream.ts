import * as THREE from 'three';
import { deferredWarmupHooks } from '../content/warmup-registry';

// ── DEFERRED WARMUP STREAM (WebGPU) ──────────────────────────────────────────
//
// The proper fix for the boot freeze: don't warm the whole roster up front. Boot
// warms only the cheap ESSENTIAL hooks (core combat VFX) behind the loading cover;
// the heavy DEFERRED roster — enemy bodies (CSG creatures), item drops, destructibles
// — is STREAMED here during play, one subject per idle period.
//
// HOW it compiles the right pipeline without a visible flash:
//  - Each deferred subject is built into an OFF-SCREEN group parked far below any floor
//    (y = -4000), with frustum culling forced OFF so the live render still draws it —
//    it just projects to no on-screen pixels. The draw goes through the REAL PSX
//    pipeline, so the pipeline compiles at the live target format (not the wrong canvas
//    format compileAsync alone would warm).
//  - LEAN LIGHTS is what makes "off-screen" correct: the lit pipeline is ONE variant
//    regardless of how many lights reach the fragment, so a subject warmed in the dark
//    compiles the exact pipeline combat uses. (Under stock per-light-count lighting this
//    would warm a wrong variant.)
//  - Materials are RETAINED for the renderer's life so the compiled pipeline survives the
//    subject's teardown.
//
// Scheduling: requestIdleCallback paces it to the main thread's free moments, so the
// per-subject compile cost lands in calm gaps, never during active input/combat — and
// each subject is warm long before the player descends to meet it.

const retained: THREE.Material[] = [];   // pin streamed pipelines for the renderer's life
let streaming = false;

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const onIdle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 1500 }); else setTimeout(fn, 200);
};

function noCull(obj: THREE.Object3D): void {
  obj.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
}
function retainMaterials(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) retained.push(mat);
  });
}
/** Empty the warm group after a subject is compiled: REMOVE the meshes so they stop
 *  re-rendering off-screen. We do NOT dispose the geometry — on WebGPU you cannot free a
 *  buffer the backend may still reference in an in-flight submit ("used in submit while
 *  destroyed"), and there's no CPU-side completion signal to know when it's safe. This is
 *  the same trade-off warmup-pass.ts makes: the resident geometry of the warmed roster is
 *  retained for the session (a few MB), and the pipelines stay pinned via the materials. */
function emptyGroup(group: THREE.Group): void {
  for (const child of group.children.slice()) group.remove(child);
}

/** Start streaming the DEFERRED warmup roster during play. Idempotent (once per
 *  session). Call after the first floor reveals — the essential warm is done and the
 *  player is in-game, so the idle scheduler has calm moments to work in. */
export function startWarmupStream(scene: THREE.Scene, onComplete?: () => void): void {
  if (streaming) return;
  streaming = true;
  const group = new THREE.Group();
  group.position.set(0, -4000, 0);   // far below any floor → rendered (compiles) but off-screen
  group.frustumCulled = false;
  group.matrixAutoUpdate = false; group.updateMatrix();
  scene.add(group);
  const queue = deferredWarmupHooks().slice();

  const step = async (): Promise<void> => {
    const hook = queue.shift();
    if (!hook) {
      streaming = false;
      // Everything's warm now — let the self-policing guard arm (any compile from
      // here is a genuine unwarmed gap).
      try { onComplete?.(); } catch { /* skip */ }
      return;
    }
    try {
      hook.spawn(group);
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
