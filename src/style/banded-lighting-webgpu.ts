import { PhysicalLightingModel, MeshStandardNodeMaterial } from 'three/webgpu';
import { vec3, diffuseColor, luminance, mix, normalView, BRDF_Lambert, BRDF_GGX, specularColor, roughness, float, attribute, normalWorld, positionWorld, cameraPosition } from 'three/tsl';
import { applyGoreWebGPU } from '../scene/gore-webgpu';

// WEBGPU port of banded-lighting.ts (cel / posterized direct lighting). The
// GLSL version appended to THREE.ShaderChunk.lights_fragment_end globally; under
// the node renderer there's no shader-chunk seam, so instead we subclass the
// material's lighting model and band in its finish() hook.
//
// The original recovered the pure LIGHT term (directDiffuse / albedo), banded it
// in tonemapped space, and re-applied albedo — so a dark wall and a pale bone
// band at the same light levels (band the LIGHT, not the material). At finish()
// we only have the composed `outgoingLight`, so we approximate: rescale outgoing
// by the banded vs. raw magnitude of its ALBEDO-INDEPENDENT light term. Specular
// + ambient ride along proportionally (small under DELVE's torch-lit diffuse
// look). Matches the original's BAND_COUNT + Reinhard-space stepping.

const BANDS = 4.0;

/* eslint-disable @typescript-eslint/no-explicit-any */
class BandedPhysicalLightingModel extends PhysicalLightingModel {
  // chroma > 1 = PAINTED: over-saturate the lit colour toward the coloured light
  // that struck it (a pale skeleton in a red room → vividly red). 1 = off.
  // chromaNode (optional TSL node) is a PER-FRAGMENT chroma — used to amplify the
  // hue only where a mask says to (e.g. the mortar seams glowing the light's hue).
  chroma: number;
  chromaNode: any;
  // rimDarkReactive > 0 = the EMISSIVE reveal rim lives HERE instead of the
  // material's emissiveNode. The GLSL rim was darkness-reactive — brighter where
  // scene light isn't — which an emissiveNode can't do (it composites after
  // lighting, blind to it). finish() sees the lit colour, so the parity port
  // adds the rim scaled by (1 − darkReactive·litLuma): full strength in the
  // dark, fading as the lamp finds the form. Colour·intensity + fresnel power
  // still ride the per-vertex aRevealRim vec4 — one shared pipeline.
  rimDarkReactive: number;
  constructor(chroma = 1, chromaNode: any = null, rimDarkReactive = 0) {
    super();
    this.chroma = chroma;
    this.chromaNode = chromaNode;
    this.rimDarkReactive = rimDarkReactive;
  }
  // SINGLE-SCATTER direct specular — match WebGL's RE_Direct_Physical EXACTLY.
  // Three's WGSL PhysicalLightingModel.direct() uses BRDF_GGX_MULTISCATTER, which
  // is single-scatter GGX PLUS two DFG-LUT *texture lookups* + energy-compensation
  // math PER LIGHT (×~13 lights × every fragment). Three's GLSL direct path does
  // NONE of that — it's plain single-scatter BRDF_GGX; multiscatter lives only in
  // the GLSL indirect/IBL path. So the WGSL was doing strictly MORE work than the
  // WebGL we're matching. This override drops only the multiscatter compensation
  // (a subtle energy-conservation correction, invisible on matte stone) — the
  // diffuse + GGX glint are byte-for-byte the WebGL look, at ~half the lighting
  // cost. (finish() still bands the direct diffuse exactly as before.)
  direct({ lightDirection, lightColor, reflectedLight }: any): void {
    const dotNL: any = (normalView as any).dot(lightDirection).clamp();
    const irradiance: any = dotNL.mul(lightColor);
    reflectedLight.directDiffuse.addAssign(irradiance.mul((BRDF_Lambert as any)({ diffuseColor })));
    reflectedLight.directSpecular.addAssign(
      irradiance.mul((BRDF_GGX as any)({ lightDirection, f0: specularColor, f90: (float as any)(1), roughness })),
    );
  }
  finish(builder: any): void {
    const context = builder.context;
    const rl: any = context.reflectedLight;
    // Band ONLY the direct diffuse — leave indirect (ambient) + specular smooth,
    // exactly like the GLSL. (Banding the composed outgoing crushed the dim
    // ambient wall-light to black; ambient is the floor that keeps surfaces lit.)
    const alb: any = (diffuseColor as any).rgb.max((vec3 as any)(0.004, 0.004, 0.004));
    const dd: any = rl.directDiffuse;
    const light: any = dd.div(alb);                       // albedo-independent light term
    const mag: any = light.r.max(light.g).max(light.b);
    const tone: any = mag.div(mag.add(1.0));              // Reinhard → perceived range
    const bandedTone: any = tone.mul(BANDS).add(0.5).floor().div(BANDS).min(0.88);
    const bandedMag: any = bandedTone.div(bandedTone.oneMinus().max(0.001));
    const bandedDD: any = dd.mul(bandedMag.div(mag.max(0.0015)));
    const newDD: any = (mag.greaterThan(0.0015) as any).select(bandedDD, dd);
    // Recompose outgoing with the banded direct diffuse + the untouched rest.
    let out: any = newDD.add(rl.indirectDiffuse).add(rl.directSpecular).add(rl.indirectSpecular);
    // CHROMA / PAINTED — over-saturate the lit colour toward the light's hue.
    // A per-fragment chromaNode (seam mask) wins over the scalar when present.
    if (this.chromaNode) {
      const lum: any = (luminance as any)(out);
      out = (mix as any)((vec3 as any)(lum, lum, lum), out, this.chromaNode).max((vec3 as any)(0, 0, 0));
    } else if (this.chroma !== 1) {
      const lum: any = (luminance as any)(out);
      out = (mix as any)((vec3 as any)(lum, lum, lum), out, this.chroma).max((vec3 as any)(0, 0, 0));
    }
    // DARK-REACTIVE RIM — parity with the GLSL reveal rim ("forms emerge from
    // black"): world-space fresnel in the aRevealRim colour, dimmed by how lit
    // the fragment already is. In darkness the silhouette burns; under the
    // lamp it recedes and the true material reads.
    if (this.rimDarkReactive > 0) {
      const rimAttr: any = (attribute as any)('aRevealRim', 'vec4');
      const viewDir: any = (cameraPosition as any).sub(positionWorld).normalize();
      const fres: any = (normalWorld as any).dot(viewDir).clamp(0, 1).oneMinus().pow(rimAttr.w);
      // The exact GLSL-era gate (7f07509): mix(1, mix(1, 0.22, litLuma), dr)
      // = 1 − 0.78·dr·litLuma — full rim in black, easing toward a 0.22 floor
      // as the fragment lights up. Parity, not a re-tune.
      const litLuma: any = (luminance as any)(out).clamp(0, 1);
      const dim: any = litLuma.mul(0.78 * this.rimDarkReactive).oneMinus();
      out = out.add(rimAttr.xyz.mul(fres).mul(dim));
    }
    // GORE creep — recolour toward blood where the WebGPU splat buffer covers this
    // fragment (floor pools full, surface bases creep up). Post-lighting, like the
    // GLSL composite-stage gore. ~free when there's no blood (the loop breaks at
    // count 0). See scene/gore-webgpu.ts.
    out = applyGoreWebGPU(out);
    context.outgoingLight.assign(out);
    super.finish(builder);
  }
}
// LEAN variant — Lambert diffuse ONLY, dropping BRDF_GGX_Multiscatter (the per-light
// cost wall: full GGX D·G·F + multiscatter energy compensation). DELVE surfaces are
// matte stone (roughness ~0.9) where the GGX specular is a dim broad lobe that barely
// reads; for them the diffuse term is the whole look. The diffuse here is IDENTICAL to
// Physical's (same BRDF_Lambert), and finish() bands the same way — so the cel look is
// preserved while each light gets cheaper. (A cheap Blinn-Phong highlight can be added
// back per-material for metal/bone/wet where the glint matters.)
class LeanBandedLightingModel extends BandedPhysicalLightingModel {
  constructor(chroma = 1, chromaNode: any = null, rimDarkReactive = 0) { super(chroma, chromaNode, rimDarkReactive); }
  direct({ lightDirection, lightColor, reflectedLight }: any): void {
    const dotNL: any = (normalView as any).dot(lightDirection).clamp();
    const irradiance: any = dotNL.mul(lightColor);
    reflectedLight.directDiffuse.addAssign(irradiance.mul((BRDF_Lambert as any)({ diffuseColor })));
  }
}

// Toggle: when true, the global patch installs the LEAN model instead of the full
// Physical-derived one. Flipping needs materials to recompile to take effect live.
let useLean = false;
export function setLeanLightingWebGPU(on: boolean): void { useLean = on; }
export function leanLightingOn(): boolean { return useLean; }
/* eslint-enable @typescript-eslint/no-explicit-any */

// Patch the standard node material's lighting model GLOBALLY (the GLSL version
// banded ALL lit materials via a shared shader chunk; this is the node-renderer
// equivalent). Must run before any material compiles. Props/creatures/surfaces
// then all band consistently — fixes the "dirt mound isn't band-lit, looks
// disconnected from the banded ground" mismatch.
/* eslint-disable @typescript-eslint/no-explicit-any */
let origSetupLightingModel: any = null;
export function installBandedLightingWebGPU(on: boolean): void {
  const proto: any = (MeshStandardNodeMaterial as any).prototype;
  if (origSetupLightingModel === null) origSetupLightingModel = proto.setupLightingModel;
  proto.setupLightingModel = on
    ? function () { return useLean ? new LeanBandedLightingModel() : new BandedPhysicalLightingModel(); }
    : origSetupLightingModel;
}

/** Per-material PAINTED chroma — band AND over-saturate toward the light's hue
 *  (pale skeletons/bone take on the torch colour vividly). */
export function setMaterialChromaWebGPU(mat: any, chroma: number): void {
  mat.setupLightingModel = () => new BandedPhysicalLightingModel(chroma);
}

/** Per-material reveal lighting — PAINTED chroma and/or a DARK-REACTIVE rim
 *  (the rim reads the fragment's lit luminance and fades under light; colour +
 *  fresnel power ride the per-vertex aRevealRim attribute). One installer so
 *  rim'd + painted materials compose through a single lighting model. */
export function setMaterialRevealLightingWebGPU(mat: any, opts: { chroma?: number; rimDarkReactive?: number }): void {
  const chroma = opts.chroma ?? 1;
  const dr = opts.rimDarkReactive ?? 0;
  mat.setupLightingModel = () => new BandedPhysicalLightingModel(chroma, null, dr);
}

/** Per-material PER-FRAGMENT chroma — over-saturate toward the light's hue only
 *  where the node says (e.g. a mortar-seam mask), so crevices glow VIVIDLY with
 *  the light's colour while the slab faces stay neutral. Still banded. */
export function setMaterialSeamChromaWebGPU(mat: any, chromaNode: any): void {
  mat.setupLightingModel = () => new BandedPhysicalLightingModel(1, chromaNode);
}

/** Restore the stock (un-banded) lighting model on a material — used for the
 *  close-up viewmodel, where cel-banding a flickering lamp-lit arm reads as
 *  flicker. Smooth lighting there is steadier and barely distinguishable. */
export function unbandMaterialWebGPU(mat: any): void {
  if (origSetupLightingModel) mat.setupLightingModel = origSetupLightingModel;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
