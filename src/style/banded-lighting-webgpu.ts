import { PhysicalLightingModel, MeshStandardNodeMaterial } from 'three/webgpu';
import { vec3, diffuseColor, luminance, mix } from 'three/tsl';

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
  chroma: number;
  constructor(chroma = 1) { super(); this.chroma = chroma; }
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
    if (this.chroma !== 1) {
      const lum: any = (luminance as any)(out);
      out = (mix as any)((vec3 as any)(lum, lum, lum), out, this.chroma).max((vec3 as any)(0, 0, 0));
    }
    context.outgoingLight.assign(out);
    super.finish(builder);
  }
}
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
    ? function () { return new BandedPhysicalLightingModel(); }
    : origSetupLightingModel;
}

/** Per-material PAINTED chroma — band AND over-saturate toward the light's hue
 *  (pale skeletons/bone take on the torch colour vividly). */
export function setMaterialChromaWebGPU(mat: any, chroma: number): void {
  mat.setupLightingModel = () => new BandedPhysicalLightingModel(chroma);
}

/** Restore the stock (un-banded) lighting model on a material — used for the
 *  close-up viewmodel, where cel-banding a flickering lamp-lit arm reads as
 *  flicker. Smooth lighting there is steadier and barely distinguishable. */
export function unbandMaterialWebGPU(mat: any): void {
  if (origSetupLightingModel) mat.setupLightingModel = origSetupLightingModel;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
