import type * as THREE from 'three';

// ── EFFECT MATERIAL CLONE POOL — reuse, never dispose ────────────────────────
//
// Per-use effects (AoE telegraph, summon sigil, lash tendril, stun stars…) need
// a material INSTANCE per live effect so opacity/colour animate independently.
// The old idiom was `template.clone()` on spawn + `clone.dispose()` on teardown,
// with the never-disposed template "pinning the compiled program".
//
// That mental model is WEBGL. On WebGPU (the node renderer), a material that
// never RENDERS holds nothing: pipelines and node-builder states are refcounted
// per live RenderObject, so disposing the LAST clone of an effect releases both.
// The next spawn then pays the full TSL node build (CPU, tens of ms on a phone)
// plus a pipeline create — the recorded prog +N/-N churn and the 44–279ms
// in-fight hitches on every telegraph/lash/stun beat.
//
// The fix is this seam: clones are ACQUIRED from a per-template free-list and
// RELEASED back to it, and nothing is ever disposed mid-play. A reused clone
// keeps its render-object chain alive in the renderer, so the builder state and
// pipeline stay resident for the whole session. The pool is bounded by the max
// CONCURRENT effect count (a handful), not by use count.
//
// Contract:
//  - acquireClone(tpl) returns a clone of tpl (fresh or recycled). Callers must
//    reset every per-instance property they animate (opacity, color, …) —
//    a recycled clone carries its last user's values.
//  - releaseClone(tpl, clone) returns it to tpl's free-list. NEVER dispose it.

const freeLists = new WeakMap<THREE.Material, THREE.Material[]>();

/** Get a material instance cloned from `template` — recycled when available. */
export function acquireClone<T extends THREE.Material>(template: T): T {
  const list = freeLists.get(template);
  const recycled = list?.pop();
  if (recycled) return recycled as T;
  return template.clone() as T;
}

/** Return a clone to its template's free-list. Do NOT dispose it — keeping the
 *  instance alive is exactly what pins its compiled pipeline. */
export function releaseClone(template: THREE.Material, clone: THREE.Material): void {
  let list = freeLists.get(template);
  if (!list) { list = []; freeLists.set(template, list); }
  list.push(clone);
}
