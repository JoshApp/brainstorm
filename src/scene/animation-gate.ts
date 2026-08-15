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
