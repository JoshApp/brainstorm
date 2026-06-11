import * as THREE from 'three';
import { uSplatTex, uSplatBounds, uSplatOn } from '../scene/splat-map';

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
  /** WORLD-SPACE brick damage (rough masonry walls only): sparse
   *  missing bricks + uneven coursework, hashed on the WORLD brick id
   *  so it never repeats with the baked tile's 4-brick period. Keep
   *  OFF for dressed stone (clean frames) and non-brick surfaces. */
  brickDamage?: boolean;
  /** Sample the gameplay SPLAT MAP (scene/splat-map.ts): blood and
   *  spills stain, darken and wet this surface where events stamped.
   *  Floors only — ceilings share the 'horiz' projection but should
   *  not catch blood. */
  splat?: boolean;
  /** Groove fill + seep (the liquid-light layer). ONLY for surfaces
   *  whose height channel carries a real seam network (the brick
   *  walls). Near-flat heights (grain pillars ≈ 0.5 everywhere) read
   *  as all-seam to the mask and the WHOLE surface fills — the
   *  round-pillar bug. */
  grooveFill?: boolean;
}

const uDetailStrength = { value: 1 };   // 0 = off, 1 = on (live toggle)

// ── SEEP — liquid light in the grooves ───────────────────────────────
// The groove-glow made deliberate-then-LIQUID: a slow descending flow
// of emissive beads inside the mortar network, GATED by the direct
// light the fragment receives — torches spill it, darkness dries it.
// Tint + strength set per floor by the builder (dominant room mood:
// blood floors bleed, green floors ooze ichor). Walls only.
const uSeepTint = { value: new THREE.Vector3(0.8, 0.1, 0.08) };
const uSeepStrength = { value: 0 };      // 0 = off; builder enables per floor
const uSeepTime = { value: 0 };

export function setSurfaceSeep(colorHex: number, strength: number): void {
  uSeepTint.value.set(
    ((colorHex >> 16) & 255) / 255,
    ((colorHex >> 8) & 255) / 255,
    (colorHex & 255) / 255,
  );
  uSeepStrength.value = strength;
}

export function tickSurfaceSeep(timeSec: number): void {
  uSeepTime.value = timeSec;
}

// ── WETNESS — the crevices pick up light for real ────────────────────
// The liquid read that matters is SPECULAR, not emissive: wet seams
// are darker and far glossier than dry stone, so every torch (and the
// player's lamp) strikes real view-dependent glints that run along
// the mortar network and slide as you move. The light does the work;
// the colour comes from the lights themselves. Per-floor strength
// (mood floors run wet); the future splat map (kills, altar overflow)
// will feed the same uniform per-fragment.
const uWetness = { value: 0 };

export function setSurfaceWetness(strength: number): void {
  uWetness.value = strength;
}

export function setSurfaceDetailEnabled(on: boolean): void {
  uDetailStrength.value = on ? 1 : 0;
}
export function getSurfaceDetailEnabled(): boolean { return uDetailStrength.value > 0; }

// Config kept out of material.userData on purpose: Material.clone() JSON-copies
// userData and would choke on the Texture ref. A WeakMap lets the arched-ceiling
// clone re-install from its base (see reinstallSurfaceDetail).
const cfgMap = new WeakMap<THREE.Material, SurfaceTexConfig>();

// Named configs (registered at material-build time) so the ModelSpec material
// compiler (build-model.ts) can opt a material into a detail by NAME — e.g. a
// 'dressed' archway, a 'grain' column — without importing the baked textures.
const namedConfigs = new Map<string, SurfaceTexConfig>();
export function registerSurfaceDetail(name: string, cfg: SurfaceTexConfig): void {
  namedConfigs.set(name, cfg);
}
export function installNamedSurfaceDetail(material: THREE.Material, name: string): void {
  const cfg = namedConfigs.get(name);
  if (cfg) installSurfaceDetail(material, cfg);
}

export function installSurfaceDetail(material: THREE.Material, cfg: SurfaceTexConfig): void {
  cfgMap.set(material, cfg);
  // The injected onBeforeCompile has identical .toString() across every detail
  // material, and the projection branch is baked into the fragment STRING (not
  // the function source) — so two materials with the same params but different
  // proj could collide in three's program cache. customProgramCacheKey is
  // ADDITIVE to the default param key, so composing a proj tag here keeps the
  // wall vs floor/ceiling programs distinct while still sharing within a proj.
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) + '|' : '') + 'sd-' + cfg.proj + (cfg.brickDamage ? '-dmg' : '') + (cfg.grooveFill ? '-gf' : '') + (cfg.splat ? '-sp' : '');
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uDetailStrength = uDetailStrength;
    shader.uniforms.uSeepTint = uSeepTint;
    shader.uniforms.uSeepStrength = uSeepStrength;
    shader.uniforms.uSeepTime = uSeepTime;
    shader.uniforms.uWetness = uWetness;
    shader.uniforms.uSplatT = uSplatTex as unknown as THREE.IUniform;
    shader.uniforms.uSplatB = uSplatBounds;
    shader.uniforms.uSplatO = uSplatOn;
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
      'uniform float uDetailStrength;\nuniform sampler2D uSurfTex;\nuniform vec2 uSurfTile;\nuniform vec3 uSurfTint;\nuniform float uSurfRelief;\nuniform vec3 uSeepTint;\nuniform float uSeepStrength;\nuniform float uSeepTime;\nuniform float uWetness;\nuniform sampler2D uSplatT;\nuniform vec4 uSplatB;\nuniform float uSplatO;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\nfloat seepNoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); vec3 h0=fract(vec3(i,i.x+i.y)*0.3183099+0.1); h0*=17.0; vec3 h1=fract(vec3(i+vec2(1.0,0.0),i.x+i.y+1.0)*0.3183099+0.1); h1*=17.0; vec3 h2=fract(vec3(i+vec2(0.0,1.0),i.x+i.y+1.0)*0.3183099+0.1); h2*=17.0; vec3 h3=fract(vec3(i+vec2(1.0,1.0),i.x+i.y+2.0)*0.3183099+0.1); h3*=17.0; float n00=fract(h0.x*h0.y*h0.z*(h0.x+h0.y+h0.z)); float n10=fract(h1.x*h1.y*h1.z*(h1.x+h1.y+h1.z)); float n01=fract(h2.x*h2.y*h2.z*(h2.x+h2.y+h2.z)); float n11=fract(h3.x*h3.y*h3.z*(h3.x+h3.y+h3.z)); return mix(mix(n00,n10,f.x),mix(n01,n11,f.x),f.y); }\n' +
      shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  ${!cfg.grooveFill ? 'float gSeepH = 1.0;\nvec2 gSeepUv = vec2(0.0);' : ''}
  if (uDetailStrength > 0.0) {
    ${projGLSL}
    vec2 uvT = sUv / uSurfTile;
    vec4 s = texture2D(uSurfTex, uvT);
    ${cfg.brickDamage ? `
    // WORLD-SPACE BRICK DAMAGE — the baked tile repeats every 4 bricks,
    // so authoring a missing brick THERE would echo it in a visible
    // grid. Hashing the world brick id instead makes each damaged brick
    // unique. Grid constants mirror surface-textures.ts brick()
    // exactly (tile = whole bricks, so world and baked grids align).
    {
      vec2 bsz = vec2(1.15, 0.6);
      vec2 bg = sUv / bsz;
      float brow = floor(bg.y);
      bg.x += 0.5 * mod(brow, 2.0);
      vec2 bid = vec2(floor(bg.x), brow);
      vec3 hp = fract(vec3(bid, bid.x + bid.y) * 0.3183099 + 0.1);
      hp *= 17.0;
      float dmg = fract(hp.x * hp.y * hp.z * (hp.x + hp.y + hp.z));
      vec2 binb = fract(bg);
      float bedge = min(min(binb.x, 1.0 - binb.x) * bsz.x, min(binb.y, 1.0 - binb.y) * bsz.y);
      float aaw = fwidth(bedge) + 0.012;
      if (dmg > 0.965) {
        // MISSING BRICK — a SOCKET, not a stamp: the cavity is darkest
        // at its top (occluded from the torchlight that comes from
        // above), opens slightly toward the floor, and its LOWER lip
        // catches a sliver of light the way a real hole's sill does.
        // Height drops near zero so the relief carves a hard rim.
        float cav = smoothstep(0.03, 0.03 + aaw, bedge);
        float innerY = binb.y;   // 0 = brick bottom, 1 = top
        float cavShade = mix(0.42, 0.14, smoothstep(0.15, 0.85, innerY));
        s.rgb *= mix(1.0, cavShade, cav);
        float lip = (1.0 - smoothstep(0.02, 0.12, innerY)) * cav;
        s.rgb *= 1.0 + lip * 0.45;
        s.a = mix(s.a, 0.05, cav);
      } else if (dmg > 0.875) {
        // UNEVEN COURSEWORK — the whole brick sits a touch proud or
        // sunken with an off tone, like centuries of settling.
        float dir = step(0.92, dmg) * 2.0 - 1.0;
        float body = smoothstep(0.015, 0.015 + aaw, bedge);
        s.rgb *= mix(1.0, 1.0 + 0.10 * dir, body);
        s.a += 0.07 * dir * body;
      } else if (dmg > 0.795) {
        // CRACKED BRICK — a PIECEWISE-LINEAR jag: straight runs between
        // random breakpoints, sharp elbows, propagating from the
        // brick's top edge and dying out partway down. (We A/B'd this
        // against the original straight seam-split; the jag won.)
        float cx = mix(0.30, 0.70, fract(dmg * 37.7));
        float segI = floor(binb.y * 4.0);
        float f0 = fract((segI + dmg * 91.7) * 0.1031); f0 *= f0 + 33.33;
        float f1 = fract((segI + 1.0 + dmg * 91.7) * 0.1031); f1 *= f1 + 33.33;
        float o0 = (fract(f0 * f0) - 0.5) * 0.24;
        float o1 = (fract(f1 * f1) - 0.5) * 0.24;
        float wob = mix(o0, o1, fract(binb.y * 4.0));
        float dcrack = abs(binb.x - cx + wob) * bsz.x;
        float reach = 1.0 - (0.55 + fract(dmg * 53.1) * 0.45);
        float alive = smoothstep(reach, reach + 0.10, binb.y);
        float crack = (1.0 - smoothstep(0.009, 0.009 + aaw, dcrack))
                    * smoothstep(0.015, 0.05, bedge) * alive;
        s.rgb = mix(s.rgb, s.rgb * 0.50, crack);
        s.a = mix(s.a, 0.4, crack * 0.85);
      }
    }
    ` : ''}
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
    // LARGE-SCALE WEAR MOTTLE — two octaves of world-space value noise
    // (~3m + ~1m) modulating the shade ±6%. The baked patterns tile
    // every ~5m and the eye finds the repeat on long floors; the
    // mottle is non-repeating and reads as damp, wear, centuries.
    {
      vec2 mp = sUv * 0.33;
      vec2 mi = floor(mp), mf = fract(mp);
      mf = mf * mf * (3.0 - 2.0 * mf);
      vec3 h0 = fract(vec3(mi, mi.x + mi.y) * 0.3183099 + 0.1); h0 *= 17.0;
      vec3 h1 = fract(vec3(mi + vec2(1.0, 0.0), mi.x + mi.y + 1.0) * 0.3183099 + 0.1); h1 *= 17.0;
      vec3 h2 = fract(vec3(mi + vec2(0.0, 1.0), mi.x + mi.y + 1.0) * 0.3183099 + 0.1); h2 *= 17.0;
      vec3 h3 = fract(vec3(mi + vec2(1.0, 1.0), mi.x + mi.y + 2.0) * 0.3183099 + 0.1); h3 *= 17.0;
      float n00 = fract(h0.x * h0.y * h0.z * (h0.x + h0.y + h0.z));
      float n10 = fract(h1.x * h1.y * h1.z * (h1.x + h1.y + h1.z));
      float n01 = fract(h2.x * h2.y * h2.z * (h2.x + h2.y + h2.z));
      float n11 = fract(h3.x * h3.y * h3.z * (h3.x + h3.y + h3.z));
      float mot = mix(mix(n00, n10, mf.x), mix(n01, n11, mf.x), mf.y);
      s.rgb *= 0.94 + 0.12 * mot;
    }
    // WET SEAMS — liquid sits darker in the grooves...
    ${cfg.grooveFill ? `
    float wetSeam = (1.0 - smoothstep(0.40, 0.70, s.a)) * uWetness;
    s.rgb *= 1.0 - 0.45 * wetSeam;
    ` : ''}
    // SPLAT STAIN — blood (and whatever else was spilt) darkens and
    // tints the stone where gameplay stamped it; the flagstone SEAMS
    // hold the deepest stain, the way liquid actually settles.
    ${cfg.splat ? `
    {
      vec2 spUv = (vWorldPos.xz - uSplatB.xy) / uSplatB.zw;
      vec4 spl = texture2D(uSplatT, spUv) * uSplatO;
      float wet = clamp(spl.a, 0.0, 1.0);
      if (wet > 0.003) {
        // CHROMATIC stain, amplified: the floor's base colour is
        // near-black, so any brightness-only change is crushed below
        // the 32-level quantize — only HUE survives. The red channel
        // runs >1 to survive the dark multiply; seams hold it deepest.
        float seamF = 1.0 - smoothstep(0.35, 0.70, s.a);
        vec3 stain = vec3(1.7, 0.10, 0.07) * (0.62 + 0.30 * seamF);
        s.rgb = mix(s.rgb, stain, wet * 0.85);
      }
    }
    ` : ''}
    // ALBEDO — grayscale shade * per-surface tint (warm floor / cold ceiling).
    vec3 det = s.rgb * uSurfTint;
    diffuseColor.rgb *= mix(vec3(1.0), det, uDetailStrength);
  }`,
      );
    if (cfg.grooveFill) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  // gSeep* are declared HERE because this chunk runs FIRST in the
  // fragment pipeline (before normal_fragment_maps) — the seep and
  // wet-albedo blocks below reuse them.
  float gSeepH = 1.0;
  vec2 gSeepUv = vec2(0.0);
  if (uDetailStrength > 0.0) {
    vec2 sUvR = (abs(vWorldNormal.x) >= abs(vWorldNormal.z)) ? vWorldPos.zy : vWorldPos.xy;
    gSeepUv = sUvR;
    gSeepH = texture2D(uSurfTex, sUvR / uSurfTile).a;
    // (No roughness modulation: specular glints at 0.4x render scale
    // alias into glitter — the PS1 pipeline punishes that frequency.
    // The wet read comes from the matte GROOVE FILL at composite time.)
  }`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `// GROOVE FILL + SEEP — light pours into the crevices.
  if (uDetailStrength > 0.0) {
    float seam = 1.0 - smoothstep(0.42, 0.72, gSeepH);
    if (seam > 0.002) {
      // INCIDENT light, with the near-black albedo divided back out —
      // this is the light actually ARRIVING at the fragment, in the
      // light's own colour (lamp pale, blood torch red).
      vec3 inc = reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(0.02));
      // FILL — the matte, stable read: grooves accumulate the light
      // around them, view-independent, no sparkle for the PS1 chain
      // to chew on. Wet floors fill deeper; dry floors still gather a
      // little (your lamp pours into every seam you pass).
      vec3 fill = clamp(inc * 1.35, 0.0, 1.8) * (seam * mix(0.13, 0.38, uWetness));
      outgoingLight += fill;
      // CREEP — the slow descending flow, kept as a quiet animation
      // on committed-mood floors only.
      if (uSeepStrength > 0.0) {
        float f1 = seepNoise(vec2(gSeepUv.x * 3.1, gSeepUv.y * 2.3 - uSeepTime * 0.22));
        float f2 = seepNoise(vec2(gSeepUv.x * 7.7, gSeepUv.y * 5.3 - uSeepTime * 0.55));
        float flow = smoothstep(0.52, 0.95, f1 * 0.58 + f2 * 0.42);
        float lit = clamp(dot(inc, vec3(0.333)) * 1.6, 0.0, 1.0);
        outgoingLight += uSeepTint * (seam * flow * lit * uSeepStrength);
      }
    }
  }
  #include <opaque_fragment>`,
      );
    }
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
