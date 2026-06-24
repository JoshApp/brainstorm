import { PhysicalLightingModel } from 'three/webgpu';
import { vec3, float, diffuseColor } from 'three/tsl';

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
  finish(builder: any): void {
    const context = builder.context;
    const outgoing: any = context.outgoingLight;
    // Albedo-independent light magnitude (divide the stone's own colour back out
    // so banding keys off the LIGHT, not how dark the brick is).
    const alb: any = (diffuseColor as any).rgb.max((vec3 as any)(0.004, 0.004, 0.004));
    const light: any = outgoing.div(alb);
    const mag: any = light.r.max(light.g).max(light.b);
    // Band in Reinhard-tonemapped space so the steps span the perceived range.
    const tone: any = mag.div(mag.add(1.0));
    const bandedTone: any = tone.mul(BANDS).add(0.5).floor().div(BANDS).min(0.88);
    const bandedMag: any = bandedTone.div(bandedTone.oneMinus().max(0.001));
    // Rescale outgoing to the banded magnitude; leave genuinely-black untouched.
    const banded: any = outgoing.mul(bandedMag.div(mag.max(0.0015)));
    outgoing.assign((mag.greaterThan(0.0015) as any).select(banded, outgoing));
    super.finish(builder);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Override a node material's lighting model with the banded one. (Typed `any` —
 *  the setupLightingModel hook only exists on the WebGPU node-material side.) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyBandedLightingWebGPU(mat: any): void {
  mat.setupLightingModel = () => new BandedPhysicalLightingModel();
}
