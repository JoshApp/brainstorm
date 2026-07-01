import type * as THREE from 'three';
import { positionWorld, vec3, float, smoothstep as tslSmoothstep, mix as tslMix, uniform as tslUniform, materialColor } from 'three/tsl';

// Live control of the baked surface AO (the wall/floor vertex colours, which
// carry the corner/base darkening from geometry-prims.ts). The AO is baked
// per-vertex, but its STRENGTH rides a shared uniform so a settings slider can
// scale it live — no level rebuild:
//   0   = off (flat full-colour walls/floors)
//   1   = as baked
//   >1  = amplified contrast (handy for SEEING it / art-direction)
//
// Implemented by replacing three's <color_fragment> (which does
// `diffuseColor *= vColor` under USE_COLOR) with a uniform-scaled lerp, guarded
// by USE_COLOR so geometries WITHOUT a vertex-colour attribute that share this
// material (pillars, stairwell floors, …) are untouched. Banded lighting uses a
// global ShaderChunk swap rather than onBeforeCompile, so this doesn't collide.

const uAOStrength = { value: 1.0 };
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const uAOStrengthNode = (tslUniform as any)(1.0);   // WebGPU mirror of uAOStrength

export function setSurfaceAOStrength(v: number): void {
  uAOStrength.value = v;
  uAOStrengthNode.value = v;
}

export function installSurfaceAO(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAOStrength = uAOStrength;
    shader.fragmentShader =
      'uniform float uAOStrength;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#ifdef USE_COLOR\n  diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, uAOStrength);\n#endif',
      );
  };
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
