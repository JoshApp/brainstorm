import * as THREE from 'three';
import { buildModel, type BuiltModel } from '../ecs/build-model';
import type { ModelSpec } from '../ecs/model-types';
import { HAND_RIGHT } from '../content/hand';

// Shared composition: BUILD a hand, BUILD a weapon (if any), ALIGN the
// weapon's grip_anchor to the hand's palm_anchor, ADJUST the hand's
// finger joint curl to the weapon's grip thickness. The result is a
// single THREE.Group containing the hand with the weapon parented into
// its palm.
//
// One place owns the math so the in-game viewmodel (src/player/viewmodel.ts)
// and the standalone asset bench (src/bench/*) show the same thing.
// Without this shared module the bench was rendering the hand alone or
// the weapon alone — Josh couldn't iterate on the COMPOSITION (where
// the grip sits in the palm, how the fingers wrap) which is exactly
// what an LLM author needs eyes on. The bench's --hand flag now drops
// the weapon viewmodel into a properly-composed hand.

export interface HeldWeaponCompose {
  /** The composition's outer group — drop this in a scene. */
  group: THREE.Group;
  /** The built hand model — slots/parts accessible by name. */
  hand: BuiltModel;
  /** The built weapon model, or null if composing an unarmed fist. */
  weapon: BuiltModel | null;
}

// Empirical baseline for the authored finger curl. The bone hand's
// finger joint slots are pre-rotated for a standard sword hilt
// (≈0.022m radius). Other grips nudge from there.
const BASELINE_GRIP_RADIUS = 0.022;
// Empirical sensitivity — dagger (0.014m) ⇒ +0.20 rad tighter curl.
const GRIP_CURL_SCALE = 25;

const FINGER_SLOT_NAMES = [
  'finger_index', 'finger_middle', 'finger_ring', 'finger_pinky', 'finger_thumb',
] as const;

/** Walk `spec.parts` for the first part named 'grip' or 'haft' (the
 *  conventional grip-cylinder name across every authored weapon) and
 *  return its radius. Falls back to the baseline if no grip is named. */
export function inferGripRadius(spec: ModelSpec): number {
  for (const part of spec.parts) {
    if (part.name !== 'grip' && part.name !== 'haft') continue;
    if (part.kind === 'cylinder' || part.kind === 'cone' || part.kind === 'capsule') {
      return part.radius;
    }
  }
  return BASELINE_GRIP_RADIUS;
}

/** Adjust every finger joint's curl so the fingers wrap THIS weapon's
 *  grip. Tighter grip → more curl; wider grip → less. Mutates the live
 *  slot rotations on the just-built hand. */
export function adjustFingersForGrip(
  handSlots: Map<string, THREE.Object3D>,
  gripRadius: number,
): void {
  const delta = (BASELINE_GRIP_RADIUS - gripRadius) * GRIP_CURL_SCALE;
  if (delta === 0) return;
  for (const name of FINGER_SLOT_NAMES) {
    const slot = handSlots.get(name);
    if (slot) slot.rotation.x -= delta;     // rest curl is negative; tighten by going further negative
  }
}

/** Build hand + weapon, align the weapon's grip_anchor to the hand's
 *  palm_anchor, curl the fingers to grip. Returns the composed group
 *  plus the BuiltModels so the caller can poke at named parts/slots
 *  (e.g., the in-game viewmodel applies its render trick on top). */
export function composeHeldWeapon(
  weaponSpec: ModelSpec | null,
  handSpec: ModelSpec = HAND_RIGHT,
): HeldWeaponCompose {
  const hand = buildModel(handSpec);
  let weapon: BuiltModel | null = null;
  if (weaponSpec) {
    weapon = buildModel(weaponSpec);
    // The weapon's grip_anchor (in weapon-local space) should land at
    // the hand's palm_anchor in world space. We achieve this by
    // positioning the weapon group at -grip_anchor.pos within the
    // palm slot — palm_anchor itself is at (0,0,0) in the slot's
    // own frame, so the weapon's grip_anchor offsets cancel out.
    const gripPos = weaponSpec.slots?.grip_anchor?.pos ?? [0, 0, 0];
    weapon.group.position.set(-gripPos[0], -gripPos[1], -gripPos[2]);
    const palm = hand.slots.get('palm_anchor') ?? hand.group;
    palm.add(weapon.group);
    adjustFingersForGrip(hand.slots, inferGripRadius(weaponSpec));
  }
  const group = new THREE.Group();
  group.add(hand.group);
  return { group, hand, weapon };
}
