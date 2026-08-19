import type * as THREE from 'three';
import { positionWorld, vec3, float, smoothstep as tslSmoothstep, mix as tslMix, uniform as tslUniform, materialColor, frameGroup } from 'three/tsl';

// Live control of the baked surface AO (the wall/floor vertex colours, which
// carry the corner/base darkening from geometry-prims.ts). The wall/floor AO is
// applied natively by the node material's vertexColors (multiplied into the
// diffuse); this uniform scales the PROP height-AO below and rides a settings
// slider so it can be tuned live:
//   0   = off, 1 = as baked, >1 = amplified contrast (art-direction).
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
// frameGroup — a global strength read by many materials. In the default
// objectGroup, changing the AO slider would re-upload every object that reads
// it; shared, it is one buffer. (See style/surface-detail.ts.)
const uAOStrengthNode = (tslUniform as any)(1.0).setGroup(frameGroup);

export function setSurfaceAOStrength(v: number): void {
  uAOStrengthNode.value = v;
}

// Cool shadow colour shared with the baked AO (geometry-prims SHADOW_TINT).
const SHADOW_TINT_GLSL = 'vec3(0.40, 0.45, 0.55)';
const PROP_AO_FADE = 0.55;   // metres up from the floor the base-darkening fades
const PROP_AO_OCC = 0.65;    // max occlusion right at the base

/**
 * Prop HEIGHT AO: darken a static prop's lower geometry toward the floor so its
 * base sits in shadow — grounds free-standing props alongside their floor
 * contact shadow. World-Y driven, so it survives the static merge (which bakes
 * world positions into geometry). Scaled by the same uAOStrength slider as the
 * surface AO, so one control governs the whole grounding pass. Chains any
 * existing onBeforeCompile so it won't clobber a prop's own shader work.
 */
export function installPropHeightAO(material: THREE.Material): void {
  installPropHeightAOWebGPU(material as THREE.MeshStandardMaterial);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// WebGPU port of the prop HEIGHT AO — the cheap "fake SSAO" the old game used:
// darken a prop's lower geometry toward the floor (world-Y driven) so its base
// sits in a soft contact-shadow. Pure per-fragment ALU, no extra pass — vastly
// cheaper than the GTAO screen-space pass (which measured ~+6ms). Composes with
// surface-detail's albedo colorNode if present, else the material's base colour.
function installPropHeightAOWebGPU(mat: THREE.MeshStandardMaterial): void {
  const existing: any = (mat as any).colorNode;
  // Base albedo as the UNIFORM-backed materialColor node, NOT vec3(c.r,c.g,c.b):
  // a vec3(...) literal inlines the colour into the WGSL, so every distinctly-
  // coloured prop minted its OWN shader/pipeline — the per-floor pipeline churn
  // the warmup forensics pinned (each floor's props recompiling on reveal, ~10
  // pipelines/floor). materialColor reads mat.color from a per-material uniform,
  // so the generated WGSL is byte-identical across every colour → ONE shared
  // pipeline, warmed once, covering every prop tint. (Same lesson the reveal path
  // already applied to emissive+rim via per-vertex attributes; props group by
  // colour in the static merge, so a per-material uniform suffices here.)
  const base: any = existing ?? materialColor;
  const occ: any = (float as any)(1)
    .sub((tslSmoothstep as any)(0.0, PROP_AO_FADE, (positionWorld as any).y))
    .mul(PROP_AO_OCC).mul(uAOStrengthNode).clamp(0, 1);
  const tint: any = (vec3 as any)(0.40, 0.45, 0.55);
  (mat as any).colorNode = base.mul((tslMix as any)((vec3 as any)(1, 1, 1), tint, occ));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
