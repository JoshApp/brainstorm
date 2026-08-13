import * as THREE from 'three';
import type { ModelSpec, PartSpec, Vec3 } from '../ecs/model-types';

// ── THE GAME'S SHAPES, WITHOUT THE GAME'S RENDERER ───────────────────────────
//
// Josh: *"can we reuse our games models for the sandbox?"* Yes — but not by
// calling the real builder, and the reason is worth writing down.
//
// `ecs/build-model.ts` imports TSL and `three/webgpu`; its materials are NODE
// materials. A plain-WebGL sandbox cannot use them, and moving the lab to
// WebGPU used to break the headless contact sheet outright. (That reason has
// since expired — headless WebGPU works as of 2026-08-13, see
// scripts/headless-browser.ts — but the conclusion below stands on its own.)
//
// That blocker points straight at the right answer. The sandbox RE-SKINS
// everything anyway: every recipe throws away the materials and assigns its
// own. So the game's materials were never what we wanted from it. We wanted the
// SHAPES — and `ModelSpec` is pure data.
//
// Hence this: a deliberately dumb spec → plain THREE.Mesh builder. Primitives
// only, one shared placeholder material, no CSG, no sprites, no jitter, no
// merge, no shadow roles, no animation. Under a hundred lines, no coupling, and
// it turns the lab from "a capsule I invented" into "the actual silhouettes we
// ship" — which matters, because a style that flatters an invented blob and
// destroys the real creature is exactly the failure the lab exists to catch.
//
// WHAT IT SKIPS, and why that is fine here:
//   csg / extrude / lathe → approximated or dropped. A boolean cut is a detail;
//                           the sandbox judges silhouette and value, and neither
//                           survives being read at thumbnail size anyway.
//   sprite / decal        → dropped. They are flat quads with authored art; a
//                           style recipe has nothing to say about them yet.
//   bone                  → dropped. Rig structure, not shape.
// If a recipe ever turns on something these omissions would change the verdict
// about, that is the moment to grow this — not before.

/** One material for everything; recipes overwrite it by role immediately. */
const PLACEHOLDER = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 });

function applyCommon(m: THREE.Mesh, p: PartSpec): void {
  const pos = (p as { pos?: Vec3 }).pos;
  const rot = (p as { rot?: Vec3 }).rot;
  const scale = (p as { scale?: Vec3 | number }).scale;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (typeof scale === 'number') m.scale.setScalar(scale);
  else if (Array.isArray(scale)) m.scale.set(scale[0], scale[1], scale[2]);
  const name = (p as { name?: string }).name;
  if (name) m.name = name;
}

/** Geometry for one part, or null for a kind the sandbox does not need. */
function geometryFor(p: PartSpec): THREE.BufferGeometry | null {
  switch (p.kind) {
    case 'box':
      return new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
    case 'sphere':
      return new THREE.SphereGeometry(p.radius, p.segments?.[0] ?? 12, p.segments?.[1] ?? 10);
    case 'capsule':
      return new THREE.CapsuleGeometry(p.radius, p.height, 4, 10);
    case 'cylinder':
      return new THREE.CylinderGeometry(
        p.radiusTop ?? p.radius, p.radius, p.height, p.segments ?? 12);
    case 'cone':
      return new THREE.ConeGeometry(p.radius, p.height, p.segments ?? 12);
    case 'torus':
      return new THREE.TorusGeometry(p.radius, p.tube, p.segments?.[0] ?? 8, p.segments?.[1] ?? 16);
    case 'lathe':
      return new THREE.LatheGeometry(
        p.profile.map((v) => new THREE.Vector2(v[0], v[1])), p.segments ?? 12);
    case 'extrude': {
      const shape = new THREE.Shape(p.shape.map((v) => new THREE.Vector2(v[0], v[1])));
      return new THREE.ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: false });
    }
    // A boolean is a DETAIL. Approximate with the positive operand so the part
    // still occupies space and still has a silhouette — better than a hole in
    // the model where a skull's cranium should be.
    case 'csg':
      return geometryFor(p.a);
    default:
      return null;   // sprite / decal / bone — nothing a style recipe judges
  }
}

/**
 * Build a ModelSpec as plain meshes. Returns a group; every mesh shares the
 * placeholder material, so a recipe can re-skin by traversal.
 */
export function buildSpecMeshes(spec: ModelSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = spec.id;
  for (const part of spec.parts) {
    const geo = geometryFor(part);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, PLACEHOLDER);
    applyCommon(m, part);
    group.add(m);
  }
  return group;
}

/** Every mesh under a built spec — for role assignment in the lab. */
export function meshesOf(group: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}
