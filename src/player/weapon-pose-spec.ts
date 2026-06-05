import type { SwingPhase } from './viewmodel';

// Data-driven weapon pose authoring.
//
// Reading weapon-animations.ts, ~80% of the hand-coded pose functions are the
// SAME envelope: windup lerps the rest pose toward a WIND keyframe, strike lerps
// WIND → END (ease-out), recover lerps END → rest (ease-out). So a pose is just
// two keyframes — a WIND delta and an END delta from the idle rest pose — plus
// the occasional sine modifier (a forward arc, a body drop). That collapses to
// DATA: author a new weapon's moveset by writing keyframe offsets, no code.
//
// This is the authoring surface the other layers plug into (CLAUDE.md): one
// evaluator here, a data table in weapon-animations.ts. Poses that genuinely
// don't fit the envelope (a reload dip, a two-pulse stab, a staff tremble) stay
// hand-authored and fall through. A numeric test pins every migrated spec to its
// original function so the data can't silently drift from the tuned animation.
//
// Units match weapon-animations.ts: pos in metres camera-local (+X right, +Y up,
// −Z forward), rot in radians. Deltas are RELATIVE to the weapon's idle pose.

/** A keyframe as offsets from the idle rest pose. Omitted axes = 0. */
export interface PoseDelta {
  x?: number; y?: number; z?: number;
  rotX?: number; rotY?: number; rotZ?: number;
}

export interface PoseSpec {
  /** Wound-up keyframe (windup eases the rest pose to here). */
  wind: PoseDelta;
  /** Strike-end keyframe (strike eases WIND → here; recover eases here → rest). */
  end: PoseDelta;
  /** Strike-only forward (−Z) arc peaking at mid-strike — the swinging-through
   *  arc of a horizontal smash. 0 at both endpoints, so it doesn't disturb the
   *  WIND/END keyframes. */
  arcForwardPush?: number;
  /** Strike-only downward (−Y) dip peaking at mid-strike — a lunge body-drop. */
  dropSin?: number;
}

/** The six-DOF pose the viewmodel applies. Structurally identical to
 *  weapon-animations' WeaponPose, so its scratch object can be passed as `out`. */
export interface Pose6 {
  x: number; y: number; z: number;
  rotX: number; rotY: number; rotZ: number;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Evaluate a data pose for the current phase + progress, writing into `out`
 *  (no allocation). `idle` is the weapon's rest pose; deltas are added to it.
 *  Mirrors the standard envelope in weapon-animations.ts exactly. */
export function evalPoseSpec(spec: PoseSpec, idle: Pose6, phase: SwingPhase, t: number, out: Pose6): Pose6 {
  const w = spec.wind, e = spec.end;
  if (phase === 'windup') {
    // Linear lerp idle → WIND.
    out.x = idle.x + (w.x ?? 0) * t;
    out.y = idle.y + (w.y ?? 0) * t;
    out.z = idle.z + (w.z ?? 0) * t;
    out.rotX = idle.rotX + (w.rotX ?? 0) * t;
    out.rotY = idle.rotY + (w.rotY ?? 0) * t;
    out.rotZ = idle.rotZ + (w.rotZ ?? 0) * t;
    return out;
  }
  if (phase === 'strike') {
    // Ease-out lerp WIND → END, then the strike-only sine modifiers.
    const s = easeOut(t);
    out.x = idle.x + (w.x ?? 0) + ((e.x ?? 0) - (w.x ?? 0)) * s;
    out.y = idle.y + (w.y ?? 0) + ((e.y ?? 0) - (w.y ?? 0)) * s;
    out.z = idle.z + (w.z ?? 0) + ((e.z ?? 0) - (w.z ?? 0)) * s;
    out.rotX = idle.rotX + (w.rotX ?? 0) + ((e.rotX ?? 0) - (w.rotX ?? 0)) * s;
    out.rotY = idle.rotY + (w.rotY ?? 0) + ((e.rotY ?? 0) - (w.rotY ?? 0)) * s;
    out.rotZ = idle.rotZ + (w.rotZ ?? 0) + ((e.rotZ ?? 0) - (w.rotZ ?? 0)) * s;
    if (spec.arcForwardPush) out.z -= spec.arcForwardPush * Math.sin(Math.PI * t);
    if (spec.dropSin) out.y -= spec.dropSin * Math.sin(Math.PI * t);
    return out;
  }
  // recover — ease-out lerp END → idle. (Modifiers are 0 at t=1, so END is clean.)
  const s = easeOut(t);
  out.x = idle.x + (e.x ?? 0) * (1 - s);
  out.y = idle.y + (e.y ?? 0) * (1 - s);
  out.z = idle.z + (e.z ?? 0) * (1 - s);
  out.rotX = idle.rotX + (e.rotX ?? 0) * (1 - s);
  out.rotY = idle.rotY + (e.rotY ?? 0) * (1 - s);
  out.rotZ = idle.rotZ + (e.rotZ ?? 0) * (1 - s);
  return out;
}
