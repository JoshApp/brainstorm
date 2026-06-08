import type * as THREE from 'three';

// Stylized surface detail for the big stone surfaces (walls / floor / ceiling).
//
// Earlier this was organic fbm bump — but that read as a low-res noisy photo
// texture and fought the clean flat-shaded primitive look (no "shape language",
// and it stole the eye from the lighting, which is the game's actual signal).
// This version draws DELIBERATE carved STONE BLOCKS instead:
//
//  - A world-space running-bond block grid (chunky, readable macro forms).
//  - Mortar = a recessed groove: darkened (light-DIRECTION-independent, so it
//    reads evenly) + a small normal tilt so the SEAMS catch raking light. The
//    relief lives only at the seams, not all over, so it stays quiet and barely
//    couples to bright light (the old "torch makes it rocky" problem).
//  - Per-block flat tone + a whisper of break-up so blocks aren't dead flat.
//  - A subtle per-block roughness variation for lo-fi specular life.
//  - Footprint AA fades the whole thing where a pixel can't resolve the mortar
//    (far / grazing), so seams never shimmer and distant walls stay clean.
//
// World-anchored, no texture maps, derivative-based (no tangents). Free GPU-wise
// (we're CPU-bound). Toggleable live via a uniform (coherent branch, no
// recompile). Chains the surface-AO onBeforeCompile and touches a different
// chunk, so they compose.

const uDetailStrength = { value: 1 };   // 0 = off, 1 = on

export function setSurfaceDetailEnabled(on: boolean): void {
  uDetailStrength.value = on ? 1 : 0;
}

const DETAIL_GLSL = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform float uDetailStrength;
float dHash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float dVNoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(dHash(i+vec3(0,0,0)),dHash(i+vec3(1,0,0)),f.x),
                 mix(dHash(i+vec3(0,1,0)),dHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(dHash(i+vec3(0,0,1)),dHash(i+vec3(1,0,1)),f.x),
                 mix(dHash(i+vec3(0,1,1)),dHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
`;

// --- tunables (metres / 0..1) ---
const BLOCK = 'vec2(1.2, 0.62)';   // block size: width × height (chunky dungeon stone)
const MORTAR_M = '0.035';          // mortar half-width in metres
const MORTAR_DARK = '0.55';        // mortar groove darkness
const GROOVE = '0.45';             // seam relief (normal tilt) strength
const TONE_LO = '0.86';            // darkest per-block flat tone (1.0 = base)

export function installSurfaceDetail(material: THREE.Material): void {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uDetailStrength = uDetailStrength;
    shader.vertexShader =
      'varying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\n' +
      shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        )
        .replace(
          '#include <beginnormal_vertex>',
          '#include <beginnormal_vertex>\n  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
        );
    shader.fragmentShader = DETAIL_GLSL + shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
  if (uDetailStrength > 0.0) {
    // Surface-plane coords: pick the two in-plane axes by the dominant world
    // normal (floor/ceiling = XZ, walls = the vertical plane).
    vec3 an = abs(vWorldNormal);
    vec2 uv = (an.y >= an.x && an.y >= an.z) ? vWorldPos.xz
            : (an.x >= an.z) ? vWorldPos.zy : vWorldPos.xy;

    // Running-bond block grid.
    vec2 g = uv / ${BLOCK};
    float row = floor(g.y);
    g.x += 0.5 * mod(row, 2.0);
    vec2 cell = vec2(floor(g.x), row);
    vec2 inb = fract(g);

    // Mortar groove: uniform metric width around each block.
    vec2 dM = min(inb, 1.0 - inb) * ${BLOCK};
    float d = min(dM.x, dM.y);
    float mortar = 1.0 - smoothstep(${MORTAR_M}, ${MORTAR_M} + 0.03, d);

    // Footprint AA — fade the whole treatment where a pixel can't resolve the
    // mortar (far / grazing); keeps seams from shimmering, distant walls clean.
    float fp = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));
    float aa = 1.0 - smoothstep(0.045, 0.14, fp);

    if (aa > 0.001) {
      // RELIEF — recess the seams so raking light catches the carved edges.
      float h = -mortar;
      vec3 sp = -vViewPosition;
      vec3 sx = dFdx(sp), sy = dFdy(sp);
      vec3 R1 = cross(sy, normal);
      vec3 R2 = cross(normal, sx);
      float fDet = dot(sx, R1) * faceDirection;
      normal = normalize(abs(fDet) * normal - (${GROOVE} * aa) * sign(fDet) * (dFdx(h) * R1 + dFdy(h) * R2));

      // ALBEDO — per-block flat tone (quiet, never brightens), darkened mortar,
      // a whisper of break-up. Light-direction-independent so it stays even.
      float bt = dHash(vec3(cell, 3.7));
      float blockTone = mix(${TONE_LO}, 1.0, bt) * mix(0.97, 1.0, dVNoise(vWorldPos * 1.7));
      float shade = mix(blockTone, ${MORTAR_DARK}, mortar);
      diffuseColor.rgb *= mix(1.0, shade, aa);

      // Subtle per-block roughness variation — specular breaks block to block.
      roughnessFactor = clamp(roughnessFactor * mix(0.93, 1.05, bt), 0.04, 1.0);
    }
  }`,
    );
  };
  material.needsUpdate = true;
}
