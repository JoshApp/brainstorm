import * as THREE from 'three';
import { uSplatTex, uSplatWallTex, uSplatWallIdTex, uSplatBounds, uSplatOn } from '../scene/splat-map';
import { isWebGPU } from '../scene/renderer-mode';
import { texture as tslTexture, vec2, vec3, positionWorld, normalWorld, positionView, normalView, faceDirection, float, uniform as tslUniform, mix as tslMix, smoothstep as tslSmoothstep, clamp as tslClamp, mx_noise_float } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
// WebGPU surface shading: triplanar-sample the baked texture in world space and
// modulate the base albedo by its shade channel × tint, via a colorNode (a
// supported migration slot on standard materials under WebGPURenderer).
function installSurfaceDetailWebGPU(mat: THREE.MeshStandardMaterial, cfg: SurfaceTexConfig): void {
  // WORLD-PROJECTED UVs (matches the GLSL, not generic triplanar — which rotated
  // the bricks 90° on differently-facing walls). For a WALL the vertical texture
  // axis is ALWAYS world-Y, and the horizontal axis is whichever world axis the
  // wall faces along (Z for an ±X-facing wall, X for a ±Z-facing wall). For HORIZ
  // (floor/ceiling) it's the world XZ plane. Anisotropic tile is respected.
  const pos: any = positionWorld;
  const nrm: any = normalWorld;
  // Meter-space projected coords (sU,sV); uv divides by the tile to get repeats.
  let sU: any, sV: any;
  if (cfg.proj === 'wall') {
    sU = (nrm.x.abs().greaterThan(nrm.z.abs()) as any).select(pos.z, pos.x);
    sV = pos.y;
  } else {
    sU = pos.x; sV = pos.z;
  }
  const uv: any = (vec2 as any)(sU.div(cfg.tile[0]), sV.div(cfg.tile[1]));
  const sampled: any = (tslTexture as any)(cfg.tex, uv);
  const base = (vec3 as any)(mat.color.r, mat.color.g, mat.color.b);
  const tint = (vec3 as any)(cfg.tint[0], cfg.tint[1], cfg.tint[2]);
  let albedo: any = base.mul(sampled.rgb).mul(tint);

  // WORLD MOTTLE — non-tiling value noise (~3m) modulating shade ±6%. The baked
  // tile repeats every ~5m and the eye finds the repeat on long walls/floors;
  // the mottle reads as damp, wear, centuries — the main "not flat" layer the
  // GLSL path had that the bare baked sample lacks.
  const mot: any = (mx_noise_float as any)((vec3 as any)(sU.mul(0.33), sV.mul(0.33), 0)).mul(0.5).add(0.5);
  albedo = albedo.mul(float(0.94).add(mot.mul(0.12)));

  // Seam mask — strong in the low (recessed) grooves, used by both seep + wetness.
  const seam: any = float(1).sub((tslSmoothstep as any)(0.45, 0.85, sampled.a));

  // SEEP — the "liquid in the cracks" glow, walls only (grooveFill). Pools in the
  // seams, flows slowly with time, blended toward the floor's seep tint by
  // per-floor strength. Approximation of the GLSL groove-flow layer.
  if (cfg.grooveFill) {
    const flowPos = (vec3 as any)((positionWorld as any).x.mul(2.6), (positionWorld as any).z.mul(2.6).sub(seepTimeNode.mul(0.26)), 0);
    const flow = (mx_noise_float as any)(flowPos).mul(0.5).add(0.5);              // → ~[0,1]
    const seepAmt = (tslClamp as any)(seam.mul(seepStrengthNode).mul(flow), 0, 1);
    albedo = (tslMix as any)(albedo, seepTintNode, seepAmt);
  }

  // WETNESS — wet seams are DARKER + far GLOSSIER (lower roughness); the torches
  // then strike real specular glints along the mortar. Per-floor strength.
  const wetMask = (tslClamp as any)(seam.mul(wetnessNode), 0, 1);
  albedo = albedo.mul((tslMix as any)(float(1.0), float(0.6), wetMask));          // wet = darker
  (mat as any).roughnessNode = (tslMix as any)(float(mat.roughness), float(0.25), wetMask);

  // colorNode replaces only the albedo input — the standard PBR lighting,
  // roughness, emissive, etc. still apply on top.
  (mat as any).colorNode = albedo;

  // RELIEF — perturb the view normal from the height channel so the bricks +
  // crevices catch torchlight in 3D. This is perturbNormalArb (Mikkelsen) exactly
  // as the GLSL did it (dFdx/dFdy of the sampled height in view space). NOTE: the
  // built-in `bumpMap()` node CAN'T be used here — it re-samples a TEXTURE node at
  // UV offsets to get the gradient, but our height is an already-sampled `.a`
  // swizzle, so bumpMap's offset re-sample is a no-op → zero relief → flat walls.
  // Hand-rolling with the real screen-space derivative of `sampled.a` fixes it.
  // RELIEF_BOOST: the GLSL's relief (cfg.relief ~0.30) read flat under TSL — the
  // perturbation lands ~an order of magnitude smaller here (mip/anisotropy damps
  // the sampled-height gradient more under the node renderer). 8x was still only
  // "slight", so 20x. This drives BOTH the brick bevels AND the crevice/groove
  // light-catch (the groove walls tilt into/out of the torchlight). Tune to taste.
  const RELIEF_BOOST = 20;
  const h: any = sampled.a;
  const dH: any = (vec2 as any)(h.dFdx(), h.dFdy()).mul(float(cfg.relief * RELIEF_BOOST));
  const sp: any = positionView;
  const sx: any = sp.dFdx().normalize();
  const sy: any = sp.dFdy().normalize();
  const N: any = normalView;
  const R1: any = sy.cross(N);
  const R2: any = N.cross(sx);
  const fDet: any = sx.dot(R1).mul(faceDirection);
  const vGrad: any = fDet.sign().mul(dH.x.mul(R1).add(dH.y.mul(R2)));
  (mat as any).normalNode = fDet.abs().mul(N).sub(vGrad).normalize();
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
// WebGPU mirrors of the seep uniforms (the GLSL path uses the {value} objects
// above; the TSL colorNode reads these uniform nodes). Kept in sync below.
const seepTintNode = (tslUniform as any)(new THREE.Vector3(0.8, 0.1, 0.08));
const seepStrengthNode = (tslUniform as any)(0);
const seepTimeNode = (tslUniform as any)(0);

export function setSurfaceSeep(colorHex: number, strength: number): void {
  uSeepTint.value.set(
    ((colorHex >> 16) & 255) / 255,
    ((colorHex >> 8) & 255) / 255,
    (colorHex & 255) / 255,
  );
  uSeepStrength.value = strength;
  seepTintNode.value.copy(uSeepTint.value);
  seepStrengthNode.value = strength;
}

export function tickSurfaceSeep(timeSec: number): void {
  uSeepTime.value = timeSec;
  seepTimeNode.value = timeSec;
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
const wetnessNode = (tslUniform as any)(0);   // WebGPU mirror (TSL roughnessNode reads it)

export function setSurfaceWetness(strength: number): void {
  uWetness.value = strength;
  wetnessNode.value = strength;
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
  // WEBGPU PORT: onBeforeCompile is ignored by the node renderer. Instead set a
  // colorNode that triplanar-samples the (CPU-baked) surface texture in WORLD
  // space (matching the GLSL's world-projected UVs) and modulates the base
  // albedo by the shade channel × tint. First cut: albedo pattern only — relief
  // (height→normal), seep, wetness, and splat are deferred. See WEBGPU-MIGRATION.
  if (isWebGPU()) {
    installSurfaceDetailWebGPU(material as THREE.MeshStandardMaterial, cfg);
    return;
  }
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
    shader.uniforms.uSplatWallT = uSplatWallTex as unknown as THREE.IUniform;
    shader.uniforms.uSplatWallIdT = uSplatWallIdTex as unknown as THREE.IUniform;
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
      'uniform float uDetailStrength;\nuniform sampler2D uSurfTex;\nuniform vec2 uSurfTile;\nuniform vec3 uSurfTint;\nuniform float uSurfRelief;\nuniform vec3 uSeepTint;\nuniform float uSeepStrength;\nuniform float uSeepTime;\nuniform float uWetness;\nuniform sampler2D uSplatT;\nuniform sampler2D uSplatWallT;\nuniform sampler2D uSplatWallIdT;\nuniform vec4 uSplatB;\nuniform float uSplatO;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\nfloat seepNoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); vec3 h0=fract(vec3(i,i.x+i.y)*0.3183099+0.1); h0*=17.0; vec3 h1=fract(vec3(i+vec2(1.0,0.0),i.x+i.y+1.0)*0.3183099+0.1); h1*=17.0; vec3 h2=fract(vec3(i+vec2(0.0,1.0),i.x+i.y+1.0)*0.3183099+0.1); h2*=17.0; vec3 h3=fract(vec3(i+vec2(1.0,1.0),i.x+i.y+2.0)*0.3183099+0.1); h3*=17.0; float n00=fract(h0.x*h0.y*h0.z*(h0.x+h0.y+h0.z)); float n10=fract(h1.x*h1.y*h1.z*(h1.x+h1.y+h1.z)); float n01=fract(h2.x*h2.y*h2.z*(h2.x+h2.y+h2.z)); float n11=fract(h3.x*h3.y*h3.z*(h3.x+h3.y+h3.z)); return mix(mix(n00,n10,f.x),mix(n01,n11,f.x),f.y); }\n' +
      shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  ${!cfg.grooveFill ? 'float gSeepH = 1.0;\nvec2 gSeepUv = vec2(0.0);' : ''}
  ${cfg.splat ? 'float gSplatWet = 0.0;\n  float gSplatSeam = 0.0;\n  vec3 gSplatColor = vec3(0.0);' : ''}
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
      gSplatSeam = 1.0 - smoothstep(0.35, 0.70, s.a);
      gSplatWet = clamp(spl.a, 0.0, 1.0) * (0.80 + 0.35 * gSplatSeam);
      // Pools touch the world in 3D: the map is XZ, so fade by height —
      // floors (y≈0) read fully; wall bases and prop feet take the
      // stain. The reach is DYNAMIC: heavier pools push higher up the
      // stone (a death at the wall climbs ~1.2m; a speckle barely
      // licks the skirting).
      gSplatWet *= clamp(1.0 - vWorldPos.y / (0.28 + min(spl.a, 1.0) * 0.95), 0.0, 1.0);
      gSplatColor = spl.rgb;
      ${cfg.proj === 'wall' ? `
      // IMPACT ARCS — the wall map (deaths + crits thrown against this
      // wall). Plane-coordinate check in B kills ghosting between
      // parallel walls sharing an axis. Strongest signal wins.
      {
        float xf = step(abs(vWorldNormal.z), abs(vWorldNormal.x));
        float along = mix((vWorldPos.x - uSplatB.x) / uSplatB.z, (vWorldPos.z - uSplatB.y) / uSplatB.w, xf);
        float pc = mix((vWorldPos.z - uSplatB.y) / uSplatB.w, (vWorldPos.x - uSplatB.x) / uSplatB.z, xf);
        vec2 wuv = vec2(along * 0.5 + (1.0 - xf) * 0.5, clamp((vWorldPos.y + 10.0) / 16.0, 0.0, 1.0));
        vec4 wspl = texture2D(uSplatWallT, wuv) * uSplatO;
        // The plane coordinate lives in a SEPARATE no-blend ID buffer
        // (alpha blending dilutes coordinates: near arcs failed the
        // match, far walls ghosted). Stored scaled by 0.9; the clear
        // value 1.0 can never match a real wall. Metric tolerance.
        float storedPc = texture2D(uSplatWallIdT, wuv).r / 0.9;
        float axisExtent = mix(uSplatB.z, uSplatB.w, 1.0 - xf);
        float planeErrM = abs(storedPc - pc) * axisExtent;
        float match = 1.0 - smoothstep(0.30, 0.50, planeErrM);
        float ww = clamp(wspl.a, 0.0, 1.0) * match;
        if (ww > gSplatWet) {
          gSplatWet = ww;
          gSplatColor = wspl.rgb;
        }
      }
      ` : ''}
    }
    ` : ''}
    // ALBEDO — grayscale shade * per-surface tint (warm floor / cold ceiling).
    vec3 det = s.rgb * uSurfTint;
    diffuseColor.rgb *= mix(vec3(1.0), det, uDetailStrength);
  }`,
      );
    if (cfg.splat) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `// BLOOD — recolour the LIT RESULT, not the albedo. The floor's
  // base colour is near-black: albedo-stage stains come out as a few
  // least-significant bits and the PSX 32-level quantize eats them
  // ('slightly red white noise'). Operating on outgoingLight keeps
  // the stain at display magnitude: blood is a darker, saturated
  // remap of whatever light already lands there — reads in lamplight,
  // dries into darkness, survives the quantize.
  if (gSplatWet > 0.004) {
    float lum = dot(outgoingLight, vec3(0.45, 0.35, 0.2));
    // The stored stamp colour carries species (red blood, green ichor,
    // pale dust) AND age: drying desaturates toward brown-black, so
    // SATURATION is freshness — no extra channel needed. Fresh blood
    // FLOWS and GLISTENS below; dried blood and bone dust lie matte —
    // the shine is earned, never ambient.
    float maxc = max(gSplatColor.r, max(gSplatColor.g, gSplatColor.b));
    float minc = min(gSplatColor.r, min(gSplatColor.g, gSplatColor.b));
    float fresh = smoothstep(0.08, 0.40, maxc - minc);
    vec3 hue = gSplatColor / max(maxc, 0.10);
    // FLOW — while fresh, a slow creep animates the stain inside the
    // flagstone seams (the seep system's trick): blood still moving.
    float flow = 0.0;
    if (fresh > 0.05 && gSplatSeam > 0.05) {
      flow = seepNoise(vWorldPos.xz * 2.6 - vec2(0.0, uSeepTime * 0.10));
      flow = smoothstep(0.45, 0.9, flow) * gSplatSeam * fresh;
    }
    // The tiny self-term lets FRESH stains read on barely-lit walls
    // (arcs at chest height live above the light pools); it dries away.
    vec3 stain = lum * hue * (mix(0.55, 1.45, fresh) + flow * 0.55) + hue * 0.018 * fresh;
    outgoingLight = mix(outgoingLight, stain, min(gSplatWet, 1.0) * 0.9);
    // GLISTEN — a grazing-angle sheen on FRESH blood only, applied at
    // composite so the quantize can't eat it. Low-frequency by
    // construction (geometric normal dominates), modest by doctrine.
    float graze = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
    outgoingLight += hue * (lum + 0.06) * graze * fresh * min(gSplatWet, 1.0) * 0.85;
  }
  #include <opaque_fragment>`,
      );
    }
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
