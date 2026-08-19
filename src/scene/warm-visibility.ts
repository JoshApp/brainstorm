import type * as THREE from 'three';

// ── "THE WARM MAY NOT TOUCH THIS OBJECT'S VISIBILITY" ─────────────────────────
//
// The warm passes (content/warmup-pass.ts, content/warm-real-roster.ts,
// style/render-webgpu.ts → warmSceneCompile) each sweep the WHOLE scene and
// temporarily rewrite `visible` on every drawable, then restore what they
// snapshotted. That works for scenery, whose visibility means "is this on
// screen" and is re-derived every tick by the room culler.
//
// It does NOT work for a POOL. A pool parks its idle slots in the scene and
// uses `visible = false` to mean "this slot is not in use" — a piece of
// SYSTEM STATE, not a culling decision, and nothing re-derives it next tick. A
// warm pass that snapshots such a slot mid-use and restores it later writes a
// stale lifetime decision back into the pool's own bookkeeping. The projectile
// pool lost that argument for months: an idle slot restored to visible is a
// full-size unlit sphere parked at the world origin, on every floor, because
// the pool lives on the Scene rather than on level.root.
//
// So a pool marks its parked objects and every warm pass leaves them alone:
// not snapshotted, not hidden, not force-shown, not restored. Their materials
// still get warmed — via the pool's own `registerWarmup` hook, which spawns
// real instances through the real code path, which is the honest way to warm a
// pooled thing anyway.
//
// This is the mirror of `userData.warmKeep` ("keep me VISIBLE through the
// warm" — the GPU embers). warmKeep says what the value should be; warmIgnore
// says the warm has no opinion at all.

/** Mark `o` (and everything under it) as owned by its own system: no warm pass
 *  may read or write its visibility. Call once, at pool construction. */
export function markWarmIgnored(o: THREE.Object3D): void {
  o.userData.warmIgnore = true;
}

/** True if `o` or any ancestor is marked. Visibility is hierarchical, so a
 *  marked parent covers its whole subtree. */
export function isWarmIgnored(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (p.userData.warmIgnore) return true;
    p = p.parent;
  }
  return false;
}
