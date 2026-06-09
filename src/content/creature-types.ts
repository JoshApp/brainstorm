import type * as THREE from 'three';
import type { PartSpec, MaterialDef, Vec3 } from '../ecs/model-types';
import type { HurtZoneSpec, Hurtbox } from '../combat/hurtbox';

// Skeleton-first creature authoring (docs/CREATURE-SYSTEM.md). A creature picks
// an ARCHETYPE (a standard joint skeleton), tunes named PROPORTIONS, and hangs
// SKIN (primitives) on NAMED JOINTS. Dimensions, hitzones, and animation all
// derive from the skeleton — the author only describes the look. Built for LLM
// authoring: symbolic joint anchors (not raw coordinates), constrained choices,
// sensible defaults, build-time validation.

export type Archetype = 'biped' | 'quadruped' | 'blob';

/** Named feel-knobs that scale an archetype's rest skeleton. All optional —
 *  set `height` and the rest reproportion from it; override specifics as needed. */
export interface Proportions {
  height: number;      // overall standing height, metres (feet → crown)
  girth: number;       // body radius (drives torso + zone thickness)
  headSize: number;    // head radius
  armLength: number;   // shoulder → hand
  legLength: number;   // hip → foot
  neckLength: number;  // chest → head base
  hunch: number;       // head forward lean (stoop)
}

/** A skin primitive hung on a joint. Same vocabulary as ModelSpec parts, but
 *  positioned by JOINT (symbolic anchor) instead of raw offsets. `bone` parts
 *  use their own from/to (joint names) and need no `joint`. */
export type SkinPart = PartSpec & { joint?: string };

export interface CreatureSpec {
  id: string;
  archetype: Archetype;
  proportions?: Partial<Proportions>;
  skin: SkinPart[];
  /** Weak/armor/openWhenStaggered zones layered over the AUTO per-bone zones. */
  zones?: HurtZoneSpec[];
  materials: Record<string, MaterialDef>;
  /** Explicit, validated presentation bindings (no magic-string coupling). Omit
   *  `eyes` for eyeless mobs. */
  eyes?: { material: string; emissive: number; halo?: boolean };
  flash?: { material?: string };
}

// ── Skeleton definition (per archetype) ──────────────────────────────────────

export interface JointDef {
  name: string;
  parent?: string;       // joint name; omitted = child of the model root
  abs: Vec3;             // REST position in root frame (metres); compiled to parent-local
}

export interface SkeletonDef {
  joints: JointDef[];
  root: string;
  /** Ordered pelvis→neck joints — the body capsule spans these. */
  spine: string[];
  /** Head joint (auto head sphere), or null for headless archetypes. */
  head: string | null;
  /** Limb chains [proximal..distal] — each gets an auto capsule. */
  limbs: string[][];
}

export type SkeletonFn = (p: Proportions) => SkeletonDef;

// ── Built creature (what the game consumes) ──────────────────────────────────

export interface CreatureBounds {
  height: number;             // measured feet → crown
  top: number;                // world-Y of the crown (above-head anchor)
  radius: number;             // fitted horizontal half-extent
  center: THREE.Vector3;      // bbox centre
  aimHeight: number;          // body centre the swing aims at + numbers float from
}

export interface Creature {
  group: THREE.Group;
  bounds: CreatureBounds;
  joints: Map<string, THREE.Object3D>;
  parts: Map<string, THREE.Object3D>;
  materials: Map<string, THREE.Material>;
  /** Raycast targets for tap-to-attack (meshes; excludes sprites). */
  hitTargets: THREE.Object3D[];
  hurtbox: Hurtbox;
  // anim + presentation controllers attach in the next increment.
}
