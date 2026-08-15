// Freeing GPU resources for things that have ALREADY BEEN DRAWN.
//
// THE RULE: `material.dispose()` / `geometry.dispose()` destroys the backing
// GPU buffers SYNCHRONOUSLY, and we render with frames in flight. A submit the
// GPU has not finished executing still references those buffers, so a dispose
// that lands in that window is a use-after-free:
//
//   [Buffer "bindingBuffer2610_object_(vertex,fragment,compute)"] used in
//   submit while destroyed.
//
// One of those poisons the command encoder, so every following submit fails
// validation too — and THAT is the console storm, hundreds of lines of
// "[Texture "output"] usage (TextureBinding|RenderAttachment) includes
// writable usage…" and "Async render pipeline creation failed", none of which
// name the real culprit. The first line is the bug; the rest is wreckage.
//
// So nothing that has been rendered may be freed on the spot. `deferGpuDispose`
// (style/render-webgpu.ts) is the seam that holds a disposal until the queue is
// provably empty — no live submits, no warm submits, no warm driving. It had
// three callers (the level teardown, the static batcher, the lux target) and
// every ephemeral EFFECT still freed itself synchronously, which is why the
// storm kept coming back in a new disguise: a weapon swap, an enemy dying, a
// telegraph ending, a card claimed.
//
// WHAT DOES *NOT* NEED THIS: geometry that was never drawn. The merge helpers
// (viewmodel-merge, creature-skinned, outline's shell build, stairs, door,
// spike-trap) dispose intermediate geometries they built and consumed in the
// same call, before anything rendered them — those own no GPU buffers yet, so
// a direct dispose is correct and cheaper there. The test is simply: has this
// object ever been in the scene during a frame?

import * as THREE from 'three';
import { deferGpuDispose } from '../style/render-webgpu';

type Disposable = { dispose: () => void } | null | undefined;

/**
 * Free GPU resources once the GPU queue has drained.
 *
 * Drop-in for a burst of `.dispose()` calls in an effect's teardown:
 * `disposeGpu(geo, mat)` instead of `geo.dispose(); mat.dispose();`.
 * Nullish entries are ignored, so optional handles need no guard.
 */
export function disposeGpu(...targets: Disposable[]): void {
  const doomed = targets.filter((t): t is { dispose: () => void } => !!t);
  if (doomed.length === 0) return;
  deferGpuDispose(() => {
    for (const d of doomed) {
      try { d.dispose(); } catch { /* best-effort — one bad handle must not strand the rest */ }
    }
  });
}

/**
 * Free every geometry and material under `root` (inclusive) once the queue has
 * drained — the teardown for an effect that owns a small subtree rather than a
 * couple of named handles.
 *
 * Materials are de-duplicated, so a shared material referenced by ten meshes is
 * disposed once. It does NOT walk into textures: those are usually pooled
 * (`getTexture`) and shared far beyond the subtree, so freeing them here would
 * pull the rug out from under everything else drawing with them.
 */
export function disposeGpuTree(root: THREE.Object3D): void {
  const doomed: Disposable[] = [];
  const seen = new Set<unknown>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); doomed.push(m.geometry); }
    const mat = (o as THREE.Mesh).material;
    for (const one of Array.isArray(mat) ? mat : [mat]) {
      if (one && !seen.has(one)) { seen.add(one); doomed.push(one); }
    }
  });
  disposeGpu(...doomed);
}
