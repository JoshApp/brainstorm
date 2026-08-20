// ── A NUMBER THAT DIFFERS PER OBJECT, INSIDE A SHARED MATERIAL ───────────────
//
// One material is used by many meshes, and a TSL `uniform()` in its graph is one value for all of
// them. This node is the escape hatch: it re-reads `mesh.userData[key]` for each object as that
// object is encoded, so a single shared material can shade a hundred creatures at a hundred
// different reveal states without forking a material — or a pipeline — per creature.
//
// The canonical three.webgpu pattern (the official webgpu_instance_uniform example), and NOT the
// instanced-attribute one: an attribute would have to be re-uploaded per object per frame, which
// is the exact cost the uniform-group work spent a day removing.
//
// It lives here rather than in ecs/build-model.ts, where it was written, because the LIGHTING
// model needs it too and build-model already imports from the lighting module — putting it in
// either one would make an import cycle. One definition, two importers, no cycle.

import { Node as TSLNode, NodeUpdateType } from 'three/webgpu';
import { nodeObject, uniform as tslUniform } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
class ObjectUniformScalar extends (TSLNode as any) {
  key: string;
  fallback: number;
  uniformNode: any;
  constructor(key: string, fallback = 0) {
    super('float');
    this.key = key;
    this.fallback = fallback;
    this.uniformNode = (tslUniform as any)(fallback);
    this.updateType = (NodeUpdateType as any).OBJECT;
  }

  update(frame: any): void {
    const v = frame.object?.userData?.[this.key];
    this.uniformNode.value = typeof v === 'number' ? v : this.fallback;
  }

  setup(): any { return this.uniformNode; }
}

/**
 * Per-object scalar TSL node bound to `mesh.userData[key]`.
 *
 * `fallback` is what an object that has never set the key reads — and it is load-bearing for any
 * term that MULTIPLIES. A reveal that falls back to 0 turns every mesh nobody has driven yet into
 * a black hole; falling back to 1 leaves it exactly as it was, which is the only safe default for
 * an effect being added to a material other things already use.
 */
export function objectScalar(key: string, fallback = 0): any {
  return (nodeObject as any)(new ObjectUniformScalar(key, fallback));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
