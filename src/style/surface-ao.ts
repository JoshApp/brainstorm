import type * as THREE from 'three';

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

export function setSurfaceAOStrength(v: number): void {
  uAOStrength.value = v;
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
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uAOStrength = uAOStrength;
    shader.vertexShader =
      'varying float vWorldY;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;',
      );
    shader.fragmentShader =
      'uniform float uAOStrength;\nvarying float vWorldY;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    float occ = clamp((1.0 - smoothstep(0.0, ${PROP_AO_FADE.toFixed(2)}, vWorldY)) * ${PROP_AO_OCC.toFixed(2)} * uAOStrength, 0.0, 1.0);
    diffuseColor.rgb *= mix(vec3(1.0), ${SHADOW_TINT_GLSL}, occ);
  }`,
      );
  };
  material.needsUpdate = true;
}
