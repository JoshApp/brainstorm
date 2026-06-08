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

// uDetailStrength is now an ON/OFF flag (0 or 1); the actual intensities are the
// GLSL constants below, split so the harsh light-coupled BUMP can stay low while
// the light-direction-independent TEXTURE carries the stone read.
const uDetailStrength = { value: 1 };
const uDetailFreq = { value: 3.4 };   // base-octave noise cycles per metre (finer = more masonry, less blob)

export function setSurfaceDetailEnabled(on: boolean): void {
  uDetailStrength.value = on ? 1 : 0;
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
    vec3 sp = -vViewPosition;
    vec3 sx = dFdx(sp), sy = dFdy(sp);
    // Pixel FOOTPRINT on the surface (world metres). Where it's large — far away
    // or at a grazing angle — the noise is sub-pixel and would alias into soft
    // "cottage-cheese" lumps, so fade the detail out there. Keeps the look
    // CONSISTENT as the camera moves and kills the shimmer.
    float fp = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));
    float period = 1.0 / uDetailFreq;
    float aa = 1.0 - smoothstep(period * 0.35, period * 1.2, fp);
    if (aa > 0.001) {
      // RELIEF (normal) — deliberately LOW. The normal couples hard to light
      // intensity, so a bright torch on the wall would read as exaggerated rock;
      // we keep just enough to catch RAKING light and let the albedo below carry
      // the rest. (bump intensity)
      float h = dFbm(vWorldPos * uDetailFreq);
      vec3 R1 = cross(sy, normal);
      vec3 R2 = cross(normal, sx);
      float fDet = dot(sx, R1) * faceDirection;
      vec3 vGrad = sign(fDet) * (dFdx(h) * R1 + dFdy(h) * R2);
      normal = normalize(abs(fDet) * normal - (0.08 * aa) * vGrad);
      // STONE TEXTURE (albedo) — light-DIRECTION-independent, so it reads evenly
      // everywhere (not just under raking light). Stylised: smoothstep'd into
      // defined patches rather than mush, darkening the low patches like grime.
      float tex = smoothstep(0.28, 0.78, dFbm(vWorldPos * uDetailFreq * 0.6 + 11.3));
      diffuseColor.rgb *= mix(1.0 - 0.18 * aa, 1.0, tex);
    }
  }`,
    );
  };
  material.needsUpdate = true;
}
