import * as THREE from 'three';
import { buildModel, mergeRigidSegments } from '../ecs/build-model';
import type { ModelSpec, PartSpec, SlotSpec, Vec3 } from '../ecs/model-types';
import { applyZoneSpecs, type Hurtbox, type HurtZone, type ZoneShape, type ZoneRole } from '../combat/hurtbox';
import type { Creature, CreatureSpec, SkeletonDef } from './creature-types';
import { SKELETONS, resolveProportions } from './skeletons';

// buildCreature — the skeleton-first build pipeline (docs/CREATURE-SYSTEM.md).
// Compiles a CreatureSpec into a ModelSpec (skeleton joints → slots, skin →
// parts parented to joints), runs the proven buildModel + merge, then MEASURES
// the result and auto-derives the hurtbox from the skeleton. Everything the game
// needs (bounds, joints, hitzones) comes from one source of truth.

/** Compile a CreatureSpec's skeleton + skin into a flat ModelSpec (joints →
 *  parent-local slots, skin parts → parts parented to their joint). This is the
 *  geometry source buildCreature builds; exposed so other tools (the model
 *  bench) can render a creature through the plain buildModel path. */
export function compileCreatureModelSpec(spec: CreatureSpec): ModelSpec {
  const p = resolveProportions(spec.archetype, spec.proportions);
  const skel = spec.skeleton ?? SKELETONS[spec.archetype](p);

  const absByName = new Map<string, Vec3>();
  for (const j of skel.joints) absByName.set(j.name, j.abs);
  const slots: Record<string, SlotSpec> = {};
  for (const j of skel.joints) {
    const pa = j.parent ? absByName.get(j.parent) ?? [0, 0, 0] : [0, 0, 0];
    slots[j.name] = { pos: [j.abs[0] - pa[0], j.abs[1] - pa[1], j.abs[2] - pa[2]], parent: j.parent, rot: j.rot };
  }
  const parts: PartSpec[] = spec.skin.map((sp) => {
    if (sp.kind === 'bone') return sp;            // bones reference joints via from/to
    const { joint, ...rest } = sp;
    return { ...rest, parent: joint ?? rest.parent } as PartSpec;
  });
  return { id: spec.id, slots, parts, materials: spec.materials };
}

/** Build a creature: skeleton → geometry → measured bounds → auto hitzones. */
export function buildCreature(spec: CreatureSpec): Creature {
  const p = resolveProportions(spec.archetype, spec.proportions);
  const skel = spec.skeleton ?? SKELETONS[spec.archetype](p);
  const absByName = new Map<string, Vec3>();
  for (const j of skel.joints) absByName.set(j.name, j.abs);

  // ── Compile skeleton → slots (parent-local), skin → parts ──
  const modelSpec = compileCreatureModelSpec(spec);
  const built = buildModel(modelSpec);
  // Validate presentation bindings up front — a missing material is a build
  // error with a clear message, not a silent runtime crash later.
  if (spec.eyes && !built.materials.has(spec.eyes.material)) {
    throw new Error(`creature '${spec.id}': eyes.material '${spec.eyes.material}' not in materials`);
  }
  if (spec.flash?.material && !built.materials.has(spec.flash.material)) {
    throw new Error(`creature '${spec.id}': flash.material '${spec.flash.material}' not in materials`);
  }
  // Lego-merge static skin per joint (joints stay movable — see mergeRigidSegments).
  mergeRigidSegments(built);

  // ── Measure (the one source of truth) ──
  built.group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(built.group);
  const center = box.getCenter(new THREE.Vector3());

  // ── Seat on the floor (baked into the geometry) ──
  // How far the lowest geometry dips BELOW the rig floor (y=0). The boiling-
  // king's squashed body bottomed out under the floor; without this it sinks.
  // We BAKE the lift into the model (shift every top-level child up) rather
  // than offset the group at runtime — the enemy tick zeroes group.y every
  // frame and leaps drive container.y, so a runtime offset gets wiped. Baked,
  // the grounded y=0 is simply correct everywhere. Clamped at 0 so an
  // intentional FLOATER (a ghost whose wisp hovers above the floor) is never
  // dragged DOWN to touch it; measures 0 for feet-at-floor bipeds, so they're
  // untouched. Scale (spec.scale) multiplies it later via the group scale.
  const groundOffset = Math.max(0, -box.min.y);
  if (groundOffset > 0) {
    for (const child of built.group.children) child.position.y += groundOffset;
    center.y += groundOffset;            // measured centre moves up with the model
    built.group.updateWorldMatrix(true, true);
  }

  const bounds = {
    height: box.max.y - Math.min(0, box.min.y),
    top: box.max.y + groundOffset,
    radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
    center,
    aimHeight: center.y,                 // measured body centre — replaces 0.6×scale guess
    groundOffset,                        // already baked above; kept for reference/debug
  };

  // ── Auto hurtbox from the skeleton, then layer authored zones ──
  const hurtbox = autoHurtbox(spec, skel, absByName, built, p.girth);
  applyZoneSpecs(hurtbox, spec.zones, built);

  // Hide a joint subtree + the zones following it (part-breaks / phase reveals).
  const setJointVisible = (jointName: string, on: boolean): void => {
    const j = built.slots.get(jointName);
    if (j) j.visible = on;
    for (const z of hurtbox.zones) if (z.follow && z.follow === j) z.enabled = on;
  };

  return {
    group: built.group,
    bounds,
    joints: built.slots,
    parts: built.parts,
    materials: built.materials,
    hitTargets: built.hitTargets,
    hurtbox,
    setJointVisible,
  };
}

const ROLE_PRIORITY: Record<ZoneRole, number> = { body: 0, head: 10, weak: 20, armor: 5 };

/** Build a zone that FOLLOWS a joint (so it animates with the bone). `a`/`b`/
 *  `center` are local to that joint. */
function followZone(
  id: string, role: ZoneRole, shape: ZoneShape, follow: THREE.Object3D | null,
  opts?: { damageMul?: number; critBonus?: number },
): HurtZone {
  return {
    id, shape, role,
    damageMul: opts?.damageMul ?? (role === 'head' ? 1.2 : 1),
    enabled: true,
    priority: ROLE_PRIORITY[role],
    crit: false,
    critBonus: opts?.critBonus ?? (role === 'head' ? 0.25 : 0),
    follow,
    openWhenStaggered: false,
  };
}

/** Derive body + head + per-limb capsules from the skeleton. Radii come from
 *  `girth` (proportional, robust); zones follow their joints so they animate. */
function autoHurtbox(
  spec: CreatureSpec, skel: SkeletonDef, abs: Map<string, Vec3>,
  built: ReturnType<typeof buildModel>, girth: number,
): Hurtbox {
  const zones: HurtZone[] = [];
  const local = (name: string, from: Vec3): Vec3 => {
    const a = abs.get(name) ?? [0, 0, 0];
    return [a[0] - from[0], a[1] - from[1], a[2] - from[2]];
  };

  // Body capsule along the spine, following the mid-spine joint.
  if (skel.spine.length > 0) {
    const followName = skel.spine[Math.floor(skel.spine.length / 2)] ?? skel.root;
    const fAbs = abs.get(followName) ?? [0, 0, 0];
    const bottom = local(skel.spine[0], fAbs);
    // Span the spine chain's ends — works for a VERTICAL body (biped pelvis→neck,
    // ghost tail→head) AND a HORIZONTAL one (quadruped chest→hips). The head is
    // its own sphere, so the body capsule needn't reach it.
    const top = local(skel.spine[skel.spine.length - 1], fAbs);
    zones.push(followZone('body', 'body', {
      kind: 'capsule',
      a: new THREE.Vector3(...bottom),
      b: new THREE.Vector3(...top),
      radius: girth,
    }, built.slots.get(followName) ?? null));
  }

  // Head sphere at the head joint. A touch bigger than before (min 0.16,
  // girth·0.9) so the headshot zone is reliably hittable by both the swept
  // melee capsule AND a bolt — a head you can't realistically hit isn't a
  // feature. Priority 10 beats body (0), so grazing it counts as a headshot
  // (×1.2 damage + crit-chance bonus — a modest, reliable reward).
  if (skel.head) {
    zones.push(followZone('head', 'head', {
      kind: 'sphere', center: new THREE.Vector3(0, 0, 0), radius: Math.max(0.16, girth * 0.9),
    }, built.slots.get(skel.head) ?? null));
  }

  // Per-limb capsules (proximal → distal), thinner than the body.
  for (const chain of skel.limbs) {
    const j0 = chain[0], jN = chain[chain.length - 1];
    const fAbs = abs.get(j0) ?? [0, 0, 0];
    zones.push(followZone(`limb-${j0}`, 'body', {
      kind: 'capsule',
      a: new THREE.Vector3(0, 0, 0),
      b: new THREE.Vector3(...local(jN, fAbs)),
      radius: girth * 0.45,
    }, built.slots.get(j0) ?? null));
  }

  void spec;
  return { root: built.group, zones };
}
