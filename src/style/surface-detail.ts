import type * as THREE from 'three';

// Procedural surface detail for the big stone surfaces (walls / floor / ceiling).
// A world-space fbm height field perturbs the LIGHTING NORMAL so torchlight
// catches fake roughness — the flicker plays across the stone and it comes
// alive, with NO texture maps. Since the game is CPU-bound (GPU idle) this
// per-fragment noise is essentially free headroom.
//
//  - World-ANCHORED: height is sampled at world position, so the detail sits on
//    the stone and doesn't swim as the camera moves.
//  - Derivative-based bump (three's own perturbNormalArb maths): needs no
//    tangents/UVs, works on any orientation. `normal`, `vViewPosition` and
//    `faceDirection` are all live at <normal_fragment_maps>, and `diffuseColor`
//    is already set there too, so the normal perturbation + a subtle albedo
//    grime ride one injection.
//  - Toggleable live via a shared uniform (0 = off; the `if` is a coherent
//    uniform branch, no recompile to flip).
//  - Chains any existing onBeforeCompile (surface AO) and touches a DIFFERENT
//    chunk than it, so the two compose cleanly.

const DETAIL_STRENGTH = 0.22;   // bump intensity when ON
const uDetailStrength = { value: DETAIL_STRENGTH };
const uDetailFreq = { value: 2.6 };   // base-octave noise cycles per metre

export function setSurfaceDetailEnabled(on: boolean): void {
  uDetailStrength.value = on ? DETAIL_STRENGTH : 0;
}

// 3-octave value-noise fbm. Cheap hash, trilinear, world-space input.
const NOISE_GLSL = `
varying vec3 vWorldPos;
uniform float uDetailStrength;
uniform float uDetailFreq;
float dHash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float dVNoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(dHash(i+vec3(0,0,0)),dHash(i+vec3(1,0,0)),f.x),
                 mix(dHash(i+vec3(0,1,0)),dHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(dHash(i+vec3(0,0,1)),dHash(i+vec3(1,0,1)),f.x),
                 mix(dHash(i+vec3(0,1,1)),dHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float dFbm(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<3;i++){ s+=a*dVNoise(p); p*=2.03; a*=0.5; } return s; }
`;

export function installSurfaceDetail(material: THREE.Material): void {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uDetailStrength = uDetailStrength;
    shader.uniforms.uDetailFreq = uDetailFreq;
    shader.vertexShader =
      'varying vec3 vWorldPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = NOISE_GLSL + shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
  if (uDetailStrength > 0.0) {
    // Normal perturbation — bump the lighting normal by the height gradient.
    float dh = uDetailStrength * dFbm(vWorldPos * uDetailFreq);
    vec3 sp = -vViewPosition;
    vec3 sx = dFdx(sp), sy = dFdy(sp);
    vec3 R1 = cross(sy, normal);
    vec3 R2 = cross(normal, sx);
    float fDet = dot(sx, R1) * faceDirection;
    normal = normalize(abs(fDet) * normal - sign(fDet) * (dFdx(dh) * R1 + dFdy(dh) * R2));
    // Subtle albedo grime on the coarser octave — crevices read a touch dirtier.
    float grime = dFbm(vWorldPos * uDetailFreq * 0.5);
    diffuseColor.rgb *= 1.0 - uDetailStrength * 0.55 * (1.0 - grime);
  }`,
    );
  };
  material.needsUpdate = true;
}
