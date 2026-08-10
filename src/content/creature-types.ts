import type * as THREE from 'three';
import type { PartSpec, MaterialDef, Vec3 } from '../ecs/model-types';
import type { HurtZoneSpec, Hurtbox } from '../combat/hurtbox';

// Skeleton-first creature authoring (docs/CREATURE-SYSTEM.md). A creature picks
// an ARCHETYPE (a standard joint skeleton), tunes named PROPORTIONS, and hangs
// SKIN (primitives) on NAMED JOINTS. Dimensions, hitzones, and animation all
// derive from the skeleton — the author only describes the look. Built for LLM
// authoring: symbolic joint anchors (not raw coordinates), constrained choices,
// sensible defaults, build-time validation.

export type Archetype = 'biped' | 'quadruped' | 'blob' | 'ghost' | 'arachnid' | 'flier';

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
  // ── GESTURE (rig v3) ────────────────────────────────────────────────────
  // `hunch` used to be the ONLY thing that could change a creature's rest pose,
  // and it bends the spine only. Everything else came out of the same upright
  // mannequin: arms straight down at exactly ±girth, legs at a fixed track,
  // both sides identical. That is why every biped in the roster reads as the
  // same silhouette with different lumps on it — at six metres, in fog, the
  // outline is the ONLY information left, and we were authoring one outline.
  //
  // These four are pure gesture. All default to the neutral value, and at their
  // defaults the skeleton is byte-identical to the old one, so adopting them is
  // opt-in per creature.
  /** Metres the hands sit OUTSIDE the shoulder line. 0 = straight down, flush
   *  against the body. Positive splays the arms out and puts AIR between limb
   *  and torso — the difference between a plank and a figure. */
  armSplay: number;
  /** Metres the hands reach FORWARD (−Z) of the shoulder. Turns a hanging arm
   *  into a reaching one without an animation. */
  armReach: number;
  /** Multiplier on hip half-width. >1 widens the stance (braced, bow-legged),
   *  <1 narrows it (spindly, unsteady). */
  stance: number;
  /** 0..1 — how far the LEFT side outgrows the right: shoulder rides higher,
   *  arm hangs longer. Symmetry is what makes a creature read as an object;
   *  this is the cheapest cure, and it also stops three of the same mob in one
   *  room looking like three copies. */
  lopsided: number;
}

/** A skin primitive hung on a joint. Same vocabulary as ModelSpec parts, but
 *  positioned by JOINT (symbolic anchor) instead of raw offsets. `bone` parts
 *  use their own from/to (joint names) and need no `joint`. */
export type SkinPart = PartSpec & { joint?: string };

export interface CreatureSpec {
  id: string;
  archetype: Archetype;
  proportions?: Partial<Proportions>;
  /** Escape hatch: a bespoke joint skeleton that REPLACES the archetype's
   *  standard one. For a hand-tuned boss whose rig + keyframe clips predate the
   *  archetypes (the Marrow Sovereign) — keep its exact joints, skin, and clips,
   *  but route it through the creature pipeline (measured bounds, setJointVisible
   *  part-breaks, one hit path). Its `spine`/`head`/`limbs` drive the auto
   *  hurtbox; leave them empty to author every zone explicitly via `zones`. */
  skeleton?: SkeletonDef;
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
  rot?: Vec3;            // optional local Euler (radians) — for a bespoke rig whose
                         // joints carry orientation (e.g. a yaw correction). Most
                         // archetype joints omit it (rest orientation = identity).
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
  groundOffset: number;       // lift (m, model-space) to seat the lowest geometry on y=0
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
  /** Show/hide a joint and its entire subtree (skin + child joints), AND
   *  enable/disable the hurtbox zones that follow it. The clean way bosses do
   *  part-breaks / lose-a-limb and phase reveals — `setJointVisible('shoulderL',
   *  false)` drops the whole left arm, geometry and hitbox together. */
  setJointVisible(jointName: string, on: boolean): void;
}
