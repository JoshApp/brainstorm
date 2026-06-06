// The keyframe DSL — one semantic, LLM-and-human-authorable schema for ALL
// authored animation (weapon swings, mob telegraphs, prop motion). A clip is a
// set of named TRACKS; each track is a list of keyframes {t, v, ease}. Track
// keys are SEMANTIC dotted paths into the rig — "blade.rot.x", "body.pos.y" —
// matching the model's slot/part names (the same anchor convention geometry
// already uses). Readable, diffable, ~0KB runtime. Sampling is PURE (no THREE),
// so it's fully unit-testable; src/anim/apply.ts writes a sample onto Object3Ds.
//
// Example:
//   { duration: 0.45, tracks: {
//     "blade.rot.x": [ {t:0,v:0}, {t:0.18,v:2.1,ease:"easeOutBack"}, {t:0.45,v:0,ease:"easeOutCubic"} ],
//     "blade.pos.z": [ {t:0,v:0}, {t:0.18,v:-0.3}, {t:0.45,v:0} ],
//   } }

import { ease, type EaseName } from './easing';

export interface Keyframe {
  /** Time in seconds. */
  t: number;
  /** Value at this keyframe. */
  v: number;
  /** Easing applied across the segment ENDING at this keyframe (i.e. how we
   *  arrive here from the previous key). Default 'linear'. */
  ease?: EaseName;
}

/** Keyframes for one channel, authored in ascending `t`. */
export type Track = Keyframe[];

export interface ClipSpec {
  /** Total length (s). Omit to derive from the latest keyframe across tracks. */
  duration?: number;
  /** Channel path → keyframes. Path = "node.prop.axis", e.g. "blade.rot.x". */
  tracks: Record<string, Track>;
  /** If true, sampling past the end wraps to the start (idle loops). */
  loop?: boolean;
}

/** A flattened evaluation of a clip at one instant: channel path → value. */
export type Sample = Record<string, number>;

/** Sample a single track at `time` (seconds). Clamps to the endpoints; the
 *  destination keyframe's `ease` shapes each segment. */
export function sampleTrack(track: Track, time: number): number {
  const n = track.length;
  if (n === 0) return 0;
  if (time <= track[0].t) return track[0].v;
  if (time >= track[n - 1].t) return track[n - 1].v;
  for (let i = 1; i < n; i++) {
    const b = track[i];
    if (time <= b.t) {
      const a = track[i - 1];
      const span = b.t - a.t;
      const u = span > 0 ? (time - a.t) / span : 1;
      return a.v + (b.v - a.v) * ease(b.ease, u);
    }
  }
  return track[n - 1].v;
}

/** Latest keyframe time across all tracks (the implied duration). */
export function clipDuration(spec: ClipSpec): number {
  if (spec.duration !== undefined) return spec.duration;
  let max = 0;
  for (const key in spec.tracks) {
    const tr = spec.tracks[key];
    if (tr.length) max = Math.max(max, tr[tr.length - 1].t);
  }
  return max;
}

/** Evaluate every track of a clip at `time`. Honors `loop`. */
export function sampleClip(spec: ClipSpec, time: number): Sample {
  let t = time;
  if (spec.loop) {
    const dur = clipDuration(spec);
    if (dur > 0) t = ((time % dur) + dur) % dur;
  }
  const out: Sample = {};
  for (const key in spec.tracks) out[key] = sampleTrack(spec.tracks[key], t);
  return out;
}
