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
vec2 dHash2(vec2 p){ return vec2(dHash(vec3(p,0.13)), dHash(vec3(p,4.71))); }
float dVNoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(dHash(i+vec3(0,0,0)),dHash(i+vec3(1,0,0)),f.x),
                 mix(dHash(i+vec3(0,1,0)),dHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(dHash(i+vec3(0,0,1)),dHash(i+vec3(1,0,1)),f.x),
                 mix(dHash(i+vec3(0,1,1)),dHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
// Irregular flagstones — Voronoi. Returns (distance-to-nearest-slab-border,
// nearest-slab-cell-id.xy). Two-pass (nearest point, then true edge distance)
// so the mortar lines are clean. Jitter kept moderate so 3x3 search is exact.
vec3 dFlagstone(vec2 x){
  vec2 ip=floor(x), fp=fract(x);
  vec2 mr=vec2(0.0), mg=vec2(0.0); float md=9.0;
  for(int j=-1;j<=1;j++){ for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec2 o=0.5+0.42*(dHash2(ip+g)*2.0-1.0);
    vec2 r=g+o-fp; float d=dot(r,r);
    if(d<md){ md=d; mr=r; mg=ip+g; }
  }}
  float ed=9.0;
  for(int j=-1;j<=1;j++){ for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec2 o=0.5+0.42*(dHash2(ip+g)*2.0-1.0);
    vec2 r=g+o-fp; vec2 diff=r-mr;
    if(dot(diff,diff)>1e-5) ed=min(ed, dot(0.5*(mr+r), normalize(diff)));
  }}
  return vec3(ed, mg);
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

    // Surface scheme by dominant world normal: WALLS get brick running-bond,
    // FLOOR/CEILING get irregular Voronoi FLAGSTONES — genuinely different stone
    // languages, not the same grid at two scales.
    vec3 an = abs(vWorldNormal);
    bool horiz = (an.y >= an.x && an.y >= an.z);
    vec2 uv = horiz ? vWorldPos.xz : (an.x >= an.z ? vWorldPos.zy : vWorldPos.xy);

    // Pixel footprint (world m) drives BOTH analytic AA and the far fade.
    float fp = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));
    float aaw = max(fp, 0.006);                 // seam edge softness = ~1px

    // Per-branch outputs, fed into the shared relief/albedo tail below.
    float recess;     // 0..1 darkening at seams (+ missing slabs)
    float groove;     // height field the relief differentiates (raised at seams)
    float bt;         // per-block/slab tone hash 0..1
    float toneLo;     // darkest per-block flat tone (wider = more uneven)
    float missing = 0.0;  // floor only: this slab is gone (recessed dark gap)

    if (horiz) {
      // FLAGSTONES — irregular slabs, uneven tone, occasional missing stone.
      const float FLAG = 1.05;                  // ~slab size (m) — larger blocks
      vec3 fo = dFlagstone(uv / FLAG);
      float edM = fo.x * FLAG;                  // metric distance to slab border
      bt = dHash(vec3(fo.yz, 1.3));
      // ~7% of FLOOR slabs missing (a dark recessed gap). Ceiling keeps all.
      missing = step(0.93, dHash(vec3(fo.yz, 8.1))) * step(0.0, vWorldNormal.y);
      float seam = 1.0 - smoothstep(MORTAR_M - aaw, MORTAR_M + aaw, edM);
      recess = max(seam, missing);
      groove = (1.0 - smoothstep(0.0, MORTAR_M * 3.5, edM)) + missing * 0.45;
      toneLo = 0.78;                            // uneven slabs vary more than walls
    } else {
      // BRICK WALL — running bond, varied widths, occasional crack (unchanged).
      vec2 bsz = vec2(1.15, 0.6);
      vec2 g = uv / bsz;
      float row = floor(g.y);
      g.x += 0.5 * mod(row, 2.0);
      vec2 cell = vec2(floor(g.x), row);
      vec2 inb = fract(g);
      float dH = min(inb.y, 1.0 - inb.y) * bsz.y;
      float dV = min(inb.x, 1.0 - inb.x) * bsz.x;
      float vKeep = step(0.18, dHash(vec3(floor(g.x + 0.5), row, 9.1)));
      float dseam = min(dH, (vKeep > 0.5) ? dV : 1e3);
      float seamVar = mix(0.4, 1.0, dHash(vec3(cell, 2.3)));
      float mortar = (1.0 - smoothstep(MORTAR_M - aaw, MORTAR_M + aaw, dseam)) * seamVar;
      float crackable = step(0.92, dHash(vec3(cell, 5.5)));
      float cpos = mix(0.3, 0.7, dHash(vec3(cell, 7.7)));
      float wob = (dVNoise(vec3(inb.y * 5.0, cell)) - 0.5) * 0.07;
      float crack = crackable * (1.0 - smoothstep(0.0, 0.015 + aaw, abs(inb.x - cpos + wob)));
      recess = max(mortar, crack * 0.85);
      groove = (1.0 - smoothstep(0.0, MORTAR_M * 3.0, dseam)) + crack * 0.6;
      bt = dHash(vec3(cell, 3.7));
      toneLo = TONE_LO;
    }

    // GRAZING fade — WALLS ONLY. On glancing side walls PS1 vertex jitter swims
    // the world-anchored pattern; fading there hides the swim. Floors are VIEWED
    // at glancing angles, so the same fade is what flattened them — give the
    // flagstones full detail (analytic AA keeps them stable on its own).
    float ndv = abs(dot(normalize(vViewPosition), normal));
    float graze = horiz ? 1.0 : smoothstep(0.12, 0.4, ndv);
    recess *= graze;

    // RELIEF — smooth groove valley, faded over a gentle near range so it eases
    // in (no pop) and the normal derivative never buzzes.
    float reliefFade = (1.0 - smoothstep(0.03, 0.16, fp)) * graze;
    if (reliefFade > 0.001) {
      vec3 sp = -vViewPosition;
      vec3 sx = dFdx(sp), sy = dFdy(sp);
      vec3 R1 = cross(sy, normal);
      vec3 R2 = cross(normal, sx);
      float fDet = dot(sx, R1) * faceDirection;
      normal = normalize(abs(fDet) * normal + (GROOVE * reliefFade) * sign(fDet) * (dFdx(groove) * R1 + dFdy(groove) * R2));
    }

    // ALBEDO — per-block/slab flat tone + recessed seams; missing slabs darken
    // further into a gap. Light-direction-independent, reads evenly everywhere.
    float blockTone = mix(toneLo, 1.0, bt) * mix(0.97, 1.0, dVNoise(vWorldPos * 1.7));
    float shade = mix(blockTone, MORTAR_DARK, recess) * mix(1.0, 0.45, missing);
    // Persist seams to ALL distances. The analytic AA above smooths a sub-pixel
    // seam to a gentle darkening (no shimmer), so detail no longer needs to fade
    // out — that fade was what made distant floor read flat and "form" crevices
    // as you walked up. Only a very-far safety fade settles the extreme distance.
    float vis = 1.0 - smoothstep(0.5, 1.1, fp);
    diffuseColor.rgb *= mix(1.0, shade, vis);

    // Per-surface tint so floor / walls / ceiling read as DISTINCT stone, not one
    // continuous material. Floor = warm worn sandstone, ceiling = cold shadowed
    // stone, walls neutral. Deliberately obvious (hue shift, not a faint nudge).
    vec3 surfTint = !horiz ? vec3(1.0)
                  : (vWorldNormal.y > 0.0 ? vec3(1.08, 0.9, 0.64)    // floor: warm
                                          : vec3(0.7, 0.8, 1.05));   // ceiling: cold
    diffuseColor.rgb *= surfTint;

    // Subtle per-block roughness variation — specular breaks block to block.
    roughnessFactor = clamp(roughnessFactor * mix(0.93, 1.05, bt), 0.04, 1.0);
  }`,
    );
  };
  material.needsUpdate = true;
}
