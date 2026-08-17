// ── TWO LAYERS OF SIGHT ──────────────────────────────────────────────────────
//
// Josh found this by accident, looking through a veiled doorway: the room was gone and a
// torch flame was still there, flickering in the black. *"What if we gate rendering of
// things besides things like glowing monster eyes and other such markers?"*
//
// It works because a veil is a MULTIPLY, not an occluder — alpha blend, no depth write —
// so at 92% it passes 8% of everything behind it. Dim diffuse stone at 8% is black. A
// bright additive flame at 8% is still a flame. The channel split was already happening;
// it was just happening by accident, at whatever ratio the alpha landed on.
//
// This makes it deliberate:
//
//   THE LIT LAYER    stone, form, props — what you fight and navigate by. Drawn BEFORE
//                    the veil, so the veil multiplies it toward nothing.
//   THE SIGNAL LAYER flames, eyes, runes, glints, sigils — drawn AFTER the veil, at full
//                    strength, untouched.
//
// So darkness stops being an absence of information and becomes a CHANGE OF CHANNEL. You
// do not see less through a veiled doorway; you see the signal constellation instead of
// the room — three pairs of eyes, one flame, a glint in the corner. You can count what is
// in there without seeing it. That is a read the light could never give you, and it is
// what stops the darkness costing the player visual clarity: they never lose information
// they need, they lose FORM and keep SIGNAL.
//
// ── DEPTH STILL OCCLUDES ────────────────────────────────────────────────────
//
// Drawing after the veil does not mean drawing through walls. Signal materials keep
// `depthTest`, and the veil never writes depth — so a flame seen through a DOORWAY passes
// the test (there is no geometry in a hole) while a flame behind a WALL fails it. The veil
// decides brightness; the wall still decides visibility. Anything marked here that also
// disables depth testing would genuinely draw through stone, which is why marking is a
// deliberate call and not a material sniff.
//
// ── WHY MARKED AND NOT DETECTED ─────────────────────────────────────────────
//
// The tempting shortcut is "additive blending means signal". It is wrong twice: a blood
// burst and a blade trail are additive and are emphatically not navigation markers, and a
// carved sigil that reads by its own emissive is signal without being additive. What
// belongs in this layer is an authoring decision about what the dungeon is willing to tell
// you through the dark, so it is declared at the producer.
import type * as THREE from 'three';

/**
 * Draw order. The veil sits at VEIL_ORDER; anything above it composites on top and is
 * therefore not multiplied by it.
 *
 * Both are in the transparent bucket, where three sorts by renderOrder first and distance
 * second — so this is an ordering guarantee and not a depth trick.
 */
export const VEIL_ORDER = 3;
export const SIGNAL_ORDER = 12;

/**
 * Declare an object part of the SIGNAL layer: it punches through veils at full strength.
 *
 * Applies to the whole subtree, because a flame stack or a rune decal is usually a small
 * group rather than one mesh, and half a marker coming through a doorway is worse than
 * none.
 */
export function markAsSignal(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.renderOrder = SIGNAL_ORDER;
    o.userData.signal = true;
  });
}

/** Is this object in the signal layer? Read by the culler: a space below the visibility
 *  floor keeps its signal and drops everything else. */
export function isSignal(o: THREE.Object3D): boolean {
  return o.userData?.signal === true;
}
