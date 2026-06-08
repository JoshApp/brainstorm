import type * as THREE from 'three';

// Stylized surface detail for the big stone surfaces (walls / floor / ceiling).
//
// Deliberate carved STONE BLOCKS, not organic noise — readable macro forms that
// give the dungeon an architectural identity and sit with the flat-shaded
// primitives, while staying quiet enough that the LIGHT leads the eye.
//
//  - WALLS: running-bond brick courses. FLOOR/CEILING: larger square slabs — a
//    different language so the three surfaces don't read as one continuous grid.
//  - Mortar = a recessed, darkened seam (light-DIRECTION-independent → reads
//    evenly, doesn't fight the lighting signal). ANALYTICALLY ANTI-ALIASED: each
//    seam is kept ~1px wide and fades cleanly when sub-pixel, so it does NOT
//    shimmer as you walk toward a wall (that flicker was motion-sickness-y).
//  - Relief (normal tilt at seams) is SMOOTH + faded to near-distance only, so
//    the screen-space derivative never buzzes.
//  - Broken up: per-block seam-intensity variation (some edges vanish), ~some
//    merged vertical seams (varied block widths), occasional cracked block.
//  - Per-block flat tone + subtle per-block roughness for lo-fi life.
//
// World-anchored, no texture maps, derivative-based (no tangents), free GPU-wise
// (CPU-bound). Toggleable live via a uniform. Chains the surface-AO
// onBeforeCompile and touches a different chunk, so they compose.

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
    // --- tunables (metres / 0..1) ---
    const float MORTAR_M = 0.03;     // seam half-width
    const float MORTAR_DARK = 0.5;   // seam/groove darkness
    const float GROOVE = 0.4;        // near-field seam relief strength
    const float TONE_LO = 0.86;      // darkest per-block flat tone

    // Surface plane + block scheme by dominant world normal: floor/ceiling get
    // LARGE SQUARE SLABS, walls get brick running-bond — different languages.
    vec3 an = abs(vWorldNormal);
    bool horiz = (an.y >= an.x && an.y >= an.z);
    vec2 uv = horiz ? vWorldPos.xz : (an.x >= an.z ? vWorldPos.zy : vWorldPos.xy);
    vec2 bsz = horiz ? vec2(1.5) : vec2(1.15, 0.6);
    float bond = horiz ? 0.0 : 0.5;

    vec2 g = uv / bsz;
    float row = floor(g.y);
    g.x += bond * mod(row, 2.0);
    vec2 cell = vec2(floor(g.x), row);
    vec2 inb = fract(g);

    // Pixel footprint (world m) drives BOTH analytic AA and the far fade.
    float fp = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));
    float aaw = max(fp, 0.004);                 // seam edge softness = ~1px

    // Seam distances (metres). ~18% of vertical seams MERGE → varied widths.
    float dH = min(inb.y, 1.0 - inb.y) * bsz.y;
    float dV = min(inb.x, 1.0 - inb.x) * bsz.x;
    float vKeep = step(0.18, dHash(vec3(floor(g.x + 0.5), row, 9.1)));
    float dseam = min(dH, (vKeep > 0.5) ? dV : 1e3);

    // Per-block seam intensity — some blocks' edges nearly vanish (de-grid).
    float seamVar = mix(0.4, 1.0, dHash(vec3(cell, 2.3)));
    // Analytic-AA'd mortar line: constant ~px width, fades cleanly sub-pixel
    // (this is what stops the walk-toward-wall shimmer).
    float mortar = (1.0 - smoothstep(MORTAR_M - aaw, MORTAR_M + aaw, dseam)) * seamVar;

    // Occasional cracked block (~8%) — a thin, slightly wavering fissure.
    float crackable = step(0.92, dHash(vec3(cell, 5.5)));
    float cpos = mix(0.3, 0.7, dHash(vec3(cell, 7.7)));
    float wob = (dVNoise(vec3(inb.y * 5.0, cell)) - 0.5) * 0.07;
    float crack = crackable * (1.0 - smoothstep(0.0, 0.015 + aaw, abs(inb.x - cpos + wob)));
    float recess = max(mortar, crack * 0.85);

    // RELIEF — smooth groove valley, low strength, faded over a GENTLE near
    // range so it eases in (not a hard pop) and the normal derivative never
    // buzzes (smooth h + small footprint).
    float reliefFade = 1.0 - smoothstep(0.02, 0.085, fp);
    if (reliefFade > 0.001) {
      float groove = (1.0 - smoothstep(0.0, MORTAR_M * 3.0, dseam)) + crack * 0.6;
      vec3 sp = -vViewPosition;
      vec3 sx = dFdx(sp), sy = dFdy(sp);
      vec3 R1 = cross(sy, normal);
      vec3 R2 = cross(normal, sx);
      float fDet = dot(sx, R1) * faceDirection;
      normal = normalize(abs(fDet) * normal + (GROOVE * reliefFade) * sign(fDet) * (dFdx(groove) * R1 + dFdy(groove) * R2));
    }

    // ALBEDO — per-block flat tone (quiet, never brightens) + recessed seams.
    // Whole treatment fades toward base at distance (footprint) to settle the
    // far field. Light-direction-independent, so it reads evenly everywhere.
    float bt = dHash(vec3(cell, 3.7));
    float blockTone = mix(TONE_LO, 1.0, bt) * mix(0.97, 1.0, dVNoise(vWorldPos * 1.7));
    float shade = mix(blockTone, MORTAR_DARK, recess);
    // Persist seams to ALL distances. The analytic AA above smooths a sub-pixel
    // seam to a gentle darkening (no shimmer), so detail no longer needs to fade
    // out — that fade was what made distant floor read flat and "form" crevices
    // as you walked up. Only a very-far safety fade settles the extreme distance.
    float vis = 1.0 - smoothstep(0.5, 1.1, fp);
    diffuseColor.rgb *= mix(1.0, shade, vis);

    // Subtle per-surface tint so floor / walls / ceiling don't read as one stone.
    vec3 surfTint = !horiz ? vec3(1.0)                                  // walls: neutral
                  : (vWorldNormal.y > 0.0 ? vec3(1.0, 0.95, 0.88) * 0.9    // floor: warmer, worn, darker
                                          : vec3(0.9, 0.93, 1.0) * 0.82);  // ceiling: cooler, in shadow
    diffuseColor.rgb *= surfTint;

    // Subtle per-block roughness variation — specular breaks block to block.
    roughnessFactor = clamp(roughnessFactor * mix(0.93, 1.05, bt), 0.04, 1.0);
  }`,
    );
  };
  material.needsUpdate = true;
}
