// THE RULE: if the renderer will not draw it this frame, it does not animate.
//
// Per-frame updaters in this codebase have each decided for themselves whether
// to do work, which in practice meant they all did it always. The archway eyes
// were the case that made the cost legible — fourteen of them on a floor, every
// one running an ease, a flicker, a blink and a quaternion gaze-solve every
// frame, including the ones inside rooms the culler had hidden and the player
// could not possibly see.
//
// That is a per-object cost multiplied by however many of a thing a floor
// happens to contain, and floors get bigger. So the gate belongs in one place
// that every animated system asks, not in fourteen hand-written distance
// checks that drift apart.
//
// WHY VISIBILITY AND NOT DISTANCE. Distance is the tempting gate and it is the
// wrong one here. The archway eye is deliberately readable from across a wide
// room — "a cue you can only read once you have already chosen the door is not
// a cue" (threshold-draft.ts) — so any distance cut close enough to save work
// is also close enough to kill the feature. Visibility has no such conflict:
// something the renderer skips is something the player cannot see, by
// definition, so skipping its animation is free of design consequences.
//
// Systems that genuinely need to keep running off-screen (a timer, a cooldown,
// anything the player will notice the state of when they return) must NOT use
// this. It gates PRESENTATION work — the easing, the flicker, the transform
// writes — not simulation.

import type * as THREE from 'three';

/**
 * True when `o` and every one of its ancestors is visible — i.e. the renderer
 * will actually submit it this frame.
 *
 * This asks the same question the renderer asks, which is the point: it needs
 * no registry, no per-system bookkeeping, and it cannot fall out of agreement
 * with whatever decides visibility (today the room culler, tomorrow whatever
 * replaces it). Cost is a walk up the parent chain, which is single-digit
 * pointer hops at this scene depth — nothing next to the work it skips.
 *
 * NOTE it does not test the frustum. Room culling is the win worth having and
 * is already computed; per-object frustum tests here would duplicate work the
 * renderer does anyway, and would make an object's animation depend on where
 * the camera happens to point, which flickers.
 */
export function isDrawn(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

/**
 * Compose these objects' local matrices once and stop Three recomposing them
 * every frame. The transform half of the same rule: work that changes nothing
 * should not be repeated per frame.
 *
 * `matrixAutoUpdate` defaults to true on every Object3D, so by default the
 * renderer rebuilds a matrix from position/quaternion/scale for EVERY node in
 * the scene on EVERY frame — including the overwhelming majority that were
 * placed once at build time and never move again. Measured on a real floor:
 * 703 of 811 level nodes doing that, and hardly any of them moving.
 *
 * THE FOOTGUN, stated plainly: once frozen, writing `position`/`quaternion`/
 * `scale` does nothing until someone calls `updateMatrix()`. So freeze only
 * what you own and know to be fixed, and if a frozen object does move later,
 * the code that moves it must recompose it — which is the pattern the archway
 * eye follows: everything freezes here, and its update() recomposes exactly the
 * three parts it just wrote.
 */
export function freezeTransform(...objects: readonly THREE.Object3D[]): void {
  for (const o of objects) {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  }
}

/**
 * Opt an object into three's per-object STATIC fast path.
 *
 * `NodeMaterialObserver.needsRefresh()` decides, per object per frame, whether
 * to re-run the node updates, the geometry update and the binding walk. On a
 * phone that block is ~25µs of the ~40µs an object costs, and it is the largest
 * single item in the frame. Marking an object static makes it return false.
 *
 * TWO CONDITIONS, both real:
 *
 * 1. The material must carry NO node property. `hasNode` short-circuits ahead
 *    of the static check (NodeMaterialObserver.js:719), so one `colorNode` or
 *    `emissiveNode` anywhere on the material silently voids this. Measured on a
 *    floor: 70 of 94 drawn objects are already node-free, so most geometry
 *    qualifies — but anything with a rim, a dissolve, surface detail or an
 *    outline does not.
 *
 * 2. NOTHING ABOUT IT MAY CHANGE. Not its transform, not its material, not its
 *    geometry attributes. A static object stops having its uniforms pushed, so
 *    a later change is simply not reflected — the same class of footgun as
 *    freezeTransform, one level up. Visibility is safe (the culler toggles it
 *    outside this path), and so is being drawn in a different pass.
 *
 * Reserve it for geometry built once and never touched again: merged room
 * shells, merged fixtures. NOT batched meshes whose instances retire, NOT
 * doors, NOT anything whose material is written per frame.
 */
export function markStatic(...objects: readonly THREE.Object3D[]): void {
  for (const o of objects) o.static = true;
}
