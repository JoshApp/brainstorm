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
