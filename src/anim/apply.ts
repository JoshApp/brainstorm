// Write a sampled animation pose onto a live rig. Channel keys are
// "node.prop.axis" — node = a slot/part name, prop ∈ pos|rot|scale, axis ∈
// x|y|z — so a sample like { "blade.rot.x": 2.1, "blade.pos.z": -0.3 } sets the
// matching local transforms. Values are ABSOLUTE local transform (the base
// pose + any additive layers were already merged in the sample). The only
// THREE-touching part of the anim engine; everything upstream is pure.

import type { Object3D } from 'three';

type Slots = Map<string, Object3D> | Record<string, Object3D>;

function getNode(slots: Slots, name: string): Object3D | undefined {
  return slots instanceof Map ? slots.get(name) : slots[name];
}

const PROP: Record<string, 'position' | 'rotation' | 'scale'> = {
  pos: 'position',
  rot: 'rotation',
  scale: 'scale',
};

/** Apply a flat channel→value sample onto the rig's named nodes. Unknown
 *  nodes/props/axes are skipped (a clip that references a node a given model
 *  lacks just no-ops on it — same graceful-degrade as the pose-clip layer). */
export function applySample(slots: Slots, sample: Record<string, number>): void {
  for (const key in sample) {
    const parts = key.split('.');
    if (parts.length < 3) continue;
    const axis = parts[parts.length - 1];
    const propKey = parts[parts.length - 2];
    const node = parts.slice(0, -2).join('.');
    const prop = PROP[propKey];
    if (!prop || (axis !== 'x' && axis !== 'y' && axis !== 'z')) continue;
    const obj = getNode(slots, node);
    if (!obj) continue;
    obj[prop][axis] = sample[key];
  }
}
