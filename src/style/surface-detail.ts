import * as THREE from 'three';

// Surface detail for the big stone surfaces — now driven by BAKED, MIPMAPPED
// tiling textures (see surface-textures.ts) rather than a per-pixel procedural
// pattern. The scene renders at 0.4x resolution, so the old per-pixel mortar
// lines were undersampled and crawled/flickered under motion; sampling a
// mipmapped + anisotropic texture lets the GPU resolve them per-pixel (the
// proper fix), and the relief reads off the mip-filtered height channel so it
// auto-settles at distance/grazing instead of buzzing. That made the old
// grazing-fade and footprint-fade hacks unnecessary — gone.
//
// World-PROJECTED UVs (axis picked by the surface normal): no UV authoring on
// the geometry, and it works on the tilted/arched ceilings too. RepeatWrapping
// tiles it; the hardware computes mip LOD from the UV derivatives, seamlessly.

export interface SurfaceTexConfig {
  tex: THREE.Texture;
  tile: readonly [number, number];     // world metres per repeat
  proj: 'wall' | 'horiz';              // wall = vertical plane, horiz = floor/ceiling
  tint: readonly [number, number, number];
  relief: number;                      // normal-perturbation strength
}

const uDetailStrength = { value: 1 };   // 0 = off, 1 = on (live toggle)

export function setSurfaceDetailEnabled(on: boolean): void {
  uDetailStrength.value = on ? 1 : 0;
}

// Config kept out of material.userData on purpose: Material.clone() JSON-copies
// userData and would choke on the Texture ref. A WeakMap lets the arched-ceiling
// clone re-install from its base (see reinstallSurfaceDetail).
const cfgMap = new WeakMap<THREE.Material, SurfaceTexConfig>();

export function installSurfaceDetail(material: THREE.Material, cfg: SurfaceTexConfig): void {
  cfgMap.set(material, cfg);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uDetailStrength = uDetailStrength;
    shader.uniforms.uSurfTex = { value: cfg.tex };
    shader.uniforms.uSurfTile = { value: new THREE.Vector2(cfg.tile[0], cfg.tile[1]) };
    shader.uniforms.uSurfTint = { value: new THREE.Vector3(cfg.tint[0], cfg.tint[1], cfg.tint[2]) };
    shader.uniforms.uSurfRelief = { value: cfg.relief };

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

    const projGLSL =
      cfg.proj === 'wall'
        ? 'vec2 sUv = (abs(vWorldNormal.x) >= abs(vWorldNormal.z)) ? vWorldPos.zy : vWorldPos.xy;'
        : 'vec2 sUv = vWorldPos.xz;';

    shader.fragmentShader =
      'uniform float uDetailStrength;\nuniform sampler2D uSurfTex;\nuniform vec2 uSurfTile;\nuniform vec3 uSurfTint;\nuniform float uSurfRelief;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\n' +
      shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  if (uDetailStrength > 0.0) {
    ${projGLSL}
    vec2 uvT = sUv / uSurfTile;
    vec4 s = texture2D(uSurfTex, uvT);
    // RELIEF — perturb the normal from the mip-filtered height (s.a). Because the
    // sample is band-limited to the pixel footprint, this derivative is stable
    // (no buzz) and naturally flattens at distance as the mips average out.
    vec3 sp = -vViewPosition;
    vec3 sx = dFdx(sp), sy = dFdy(sp);
    vec3 R1 = cross(sy, normal);
    vec3 R2 = cross(normal, sx);
    float fDet = dot(sx, R1) * faceDirection;
    float sc = uSurfRelief * uDetailStrength;
    normal = normalize(abs(fDet) * normal - sc * sign(fDet) * (dFdx(s.a) * R1 + dFdy(s.a) * R2));
    // ALBEDO — grayscale shade * per-surface tint (warm floor / cold ceiling).
    vec3 det = s.rgb * uSurfTint;
    diffuseColor.rgb *= mix(vec3(1.0), det, uDetailStrength);
  }`,
      );
  };
  material.needsUpdate = true;
}

// Re-install onto a clone (the arched-ceiling material clones the base ceiling
// material, and clone() does not carry onBeforeCompile). Reset first so we don't
// double-install. Pass the BASE material whose config is registered.
export function reinstallSurfaceDetail(clone: THREE.Material, base: THREE.Material): void {
  const cfg = cfgMap.get(base);
  if (!cfg) return;
  clone.onBeforeCompile = () => {};
  installSurfaceDetail(clone, cfg);
}
