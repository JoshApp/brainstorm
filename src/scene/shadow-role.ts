import * as THREE from 'three';
import type { ShadowRole } from '../ecs/model-types';

// ── Shadow role — ONE vocabulary for "what casts / receives" ─────────────
//
// Casting is the expensive half: the lamp is a PointLight, so every caster
// within its range is re-rendered into all 6 cube-map faces each shadow update.
// Receiving is cheap (a per-lit-fragment depth lookup, already paid by lighting).
// So geometry declares its INTENT through a ShadowRole and the flags follow:
//
//   'both'    — pillars, freestanding monuments, enemies: cast + receive
//   'cast'    — casts only (rare)
//   'receive' — walls/floor/ceiling, doors, most props: catch shadows, throw none
//   'none'    — clutter, dropped items, decals: out of the shadow system entirely
//
// ModelSpec-authored geometry resolves this via `spec.shadow` / `spec.class`
// (see PROP_CLASS_POLICY in build-model.ts). HAND-BUILT (imperative) meshes —
// the level shell, interactables — declare it with applyShadowRole() instead of
// scattering raw `castShadow = true`, so both paths speak the same policy.

/** Cast/receive flags for a role. Single source of truth (build-model imports
 *  this for its per-build default too).
 *
 *  RECEIVE IS ALWAYS ON. Whether a material receives is baked into its fragment
 *  shader (three includes the shadow lookup only for receivers), so a role that
 *  switched it off gave every material family a second fragment program — one
 *  with the lookup, one without — for a saving of one depth sample per lit
 *  fragment on clutter. Measured 2026-09-08: six pipelines on a floor. The role
 *  now decides CASTING only, which is the half that costs anything. */
export function shadowFlags(role?: ShadowRole): { cast: boolean; receive: boolean } {
  switch (role) {
    case 'receive':
    case 'none':    return { cast: false, receive: true };
    default:        return { cast: true,  receive: true };   // 'both' / 'cast' / undefined
  }
}

/** Apply a shadow role to a mesh OR an entire subtree (traverses, so passing a
 *  group classifies every mesh under it in one call). The front door for
 *  hand-built geometry to opt into the shadow policy — replaces per-mesh
 *  `castShadow`/`receiveShadow` assignments. */
export function applyShadowRole(obj: THREE.Object3D, role: ShadowRole): void {
  const f = shadowFlags(role);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = f.cast;
      m.receiveShadow = f.receive;
    }
  });
}
