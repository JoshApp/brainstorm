// Additive pose layering — the architectural backbone for "alive" motion. A
// base sample (idle/locomotion) plus weighted DELTA layers (a telegraph
// windup, an aim offset, a flinch, recoil) composed per channel. Each layer
// carries a 0..1 weight you typically spring in/out, so a telegraph blends on
// and off instead of popping. Pure (operates on flat channel→value samples),
// so it's testable and engine-agnostic; the result is then applied to the rig
// by src/anim/apply.ts.
//
// "Additive" here = simple per-channel sum of euler/offset deltas (the DSL's
// channels are euler rotations + position/scale offsets, which add cleanly for
// the small deltas a telegraph/aim layer uses — far more authorable than
// quaternion composition, and matches the existing pose-clips offset model).

import type { Sample } from './keyframes';

export interface PoseLayer {
  /** Per-channel DELTA to add on top of the base (channel path → delta value). */
  delta: Sample;
  /** Blend weight 0..1 (spring this in/out). */
  weight: number;
}

/** Compose a base sample with additive, weighted delta layers. Returns a new
 *  sample; inputs are untouched. Channels only in a layer (not the base) start
 *  from 0 so a pure-additive layer still contributes. */
export function blendAdditive(base: Sample, layers: readonly PoseLayer[]): Sample {
  const out: Sample = { ...base };
  for (const layer of layers) {
    if (layer.weight <= 0) continue;
    for (const key in layer.delta) {
      out[key] = (out[key] ?? 0) + layer.delta[key] * layer.weight;
    }
  }
  return out;
}
