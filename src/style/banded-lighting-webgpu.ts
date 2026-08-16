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

// ── THE BANDING WAS ALWAYS HERE. THE SPECULAR SMEAR WAS HIDING IT ───────────
//
// Only the DIRECT DIFFUSE is banded (line ~67); indirect and specular stay
// smooth. Direct diffuse scales with albedo — and the stone's albedo is ~0.004
// linear, while a dielectric's specular F0 is 0.04. So for the whole life of
// this look, the banded term has been roughly a tenth of the signal and the
// smooth specular has been nine tenths: four hard steps, buried under a sheen.
//
// Lift the albedo to something a real stone has and the ratio inverts — the
// banded term dominates, and four steps across the entire lit range is far too
// few to carry an image. That is not a new bug introduced by the lift; it is
// the cel model finally being visible, at a step count chosen when it wasn't.
//
// So both halves are dials now:
//   BANDS     how many steps. 4 was fine as a garnish, and is not enough as
//             the main event.
//   SOFTNESS  blends the quantised tone back toward the continuous one. Cel
//             shading wants a hard edge; a hard edge at 0.4x render scale with
//             a MOVING lamp crawls. This is the knob for that trade, and it is
//             a trade rather than a bug to fix.
import { tuneUniform } from '../debug/tuning';

const uBands = tuneUniform({
  id: 'bands', group: 'Light', label: 'Light bands', min: 2, max: 24, value: 5, step: 1,
  hint: 'how many steps the direct light is posterised into',
});
const uBandSoft = tuneUniform({
  id: 'bandsoft', group: 'Light', label: 'Band softness', min: 0, max: 1, value: 0.075,
  hint: '0 = hard cel steps, 1 = smooth gradient',
});

// ── WHERE THE BANDS LAND, not how many there are ────────────────────────────
// The band count decides how many steps; this decides where they SIT. Straight
// quantisation spaces them evenly, so the brightest band gets as much of the
// surface as the base tone does — which is why large areas go almost white while
// the cracks go almost black. Bending the tone before quantising moves the
// thresholds without changing their number:
//
//   > 1  pushes thresholds toward the BRIGHT end, so most of the material lives
//        in the middle bands and the top one becomes an accent rather than a
//        region. This is the direction that fixes the blown floor slabs.
//   < 1  the opposite: more resolution in the shadows.
//
// The inverse power is applied after quantising so the endpoints do not move —
// otherwise this would just be a gamma slider that darkens everything, and the
// band POSITIONS are the whole point.
const uBandCurve = tuneUniform({
  id: 'bandcurve', group: 'Light', label: 'Band curve', min: 0.5, max: 2.5, value: 1.25,
  hint: 'above 1 makes the brightest band an accent instead of a region',
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Posterise a [0,1] tone into `bands` steps, with `curve` deciding where those
 *  steps fall. Shared by the diffuse and the specular so the two cannot drift
 *  into different-looking quantisation. */
function posterise(tone: any, bands: any, curve: any): any {
  const bent: any = (tone as any).max(0.0001).pow(curve);
  const q: any = bent.mul(bands).add(0.5).floor().div(bands);
  return q.max(0.0001).pow((float as any)(1).div(curve));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  // Optional node scaling this material's DIRECT SPECULAR. See the note on
  // setMaterialStoneLightingWebGPU — this is how the stone's sheen gets turned
  // down without touching the exposure every other object in the game shares.
  specScale: any;
  // When set, the DIRECT SPECULAR is posterised the same way the diffuse is.
  // See the note in finish().
  specBands: any;
  // Per-material DIFFUSE band count. A floor's enormous irregular polygons turn
  // hard quantisation into graphic shapes; a wall already has brick boundaries,
  // surface variation and RGB separation competing for the same edges, so it
  // wants a gentler curve. Null = use the global.
  bandsNode: any;
  constructor(
    chroma = 1, chromaNode: any = null, rimDarkReactive = 0,
    specScale: any = null, specBands: any = null, bandsNode: any = null,
  ) {
    super();
    this.chroma = chroma;
    this.chromaNode = chromaNode;
    this.rimDarkReactive = rimDarkReactive;
    this.specScale = specScale;
    this.specBands = specBands;
    this.bandsNode = bandsNode;
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
    let spec: any = irradiance.mul((BRDF_GGX as any)({ lightDirection, f0: specularColor, f90: (float as any)(1), roughness }));
    if (this.specScale) spec = spec.mul(this.specScale);
    reflectedLight.directSpecular.addAssign(spec);
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
    // Per-material band count when the material supplied one (stone surfaces do,
    // so a floor's huge polygons can take harder quantisation than a wall's
    // rectangles), else the global.
    const dBands: any = this.bandsNode ?? uBands;
    const quantTone: any = posterise(tone, dBands, uBandCurve as any);
    const bandedTone: any = (mix as any)(quantTone, tone, uBandSoft as any).min(0.88);
    const bandedMag: any = bandedTone.div(bandedTone.oneMinus().max(0.001));
    const bandedDD: any = dd.mul(bandedMag.div(mag.max(0.0015)));
    const newDD: any = (mag.greaterThan(0.0015) as any).select(bandedDD, dd);
    // ── AND THE SPECULAR CAN BE POSTERISED TOO ────────────────────────────────
    // Only the DIFFUSE has ever been banded, so the highlight underneath it has
    // always been a smooth physical falloff. On a floor at grazing incidence
    // that smooth lobe is the loudest thing in the frame, and it is the one part
    // of the image still rendered as "PBR with a retro filter over it" rather
    // than in the game's own language.
    //
    // Quantising it gives chunky highlight REGIONS with edges instead of a
    // gradient — the same cel logic, applied to the term that was escaping it.
    //
    // Done here on the TOTAL rather than per light in direct(): quantising each
    // light's contribution and then summing them re-smooths the result, because
    // three quantised lights at different levels add to something continuous
    // again. The banding has to happen after the accumulation or it does not
    // band at all.
    let spec: any = rl.directSpecular;
    if (this.specBands) {
      const sm: any = spec.r.max(spec.g).max(spec.b);
      const st: any = sm.div(sm.add(1.0));                       // Reinhard, as the diffuse does
      const sq: any = posterise(st, this.specBands, uBandCurve as any).min(0.95);
      const sMag: any = sq.div(sq.oneMinus().max(0.001));
      spec = (sm.greaterThan(0.0008) as any).select(spec.mul(sMag.div(sm.max(0.0008))), spec);
    }
    // Recompose outgoing with the banded direct diffuse + the untouched rest.
    let out: any = newDD.add(rl.indirectDiffuse).add(spec).add(rl.indirectSpecular);
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

/**
 * STONE LIGHTING — seam chroma plus a specular scale, installed on every
 * surface that goes through style/surface-detail.ts.
 *
 * ── WHY THE SPECULAR AND NOT THE EXPOSURE ───────────────────────────────────
 * Measured 2026-08-16: the stone's base colour is ~0.004 linear while a
 * dielectric's specular F0 is 0.04, so these surfaces are close to a pure
 * specular lobe over a black substrate. Every colour operation in the surface
 * shader lands under that lobe, which is why every colour knob read at the
 * noise floor while every roughness knob was strong.
 *
 * The obvious fix — lift the albedo and pull the grade's exposure down to
 * compensate — works, and it is measurably right for stone (stone hue spread
 * went from 1.2x the noise floor to 5.5x at matched brightness). But exposure
 * is GLOBAL. Creatures, flames, items, particles and every UI-adjacent overlay
 * were all balanced against the current one, and none of them go through this
 * shader, so cutting it to fix the walls would darken the entire rest of the
 * game to pay for it. That is a regression bought with a fix.
 *
 * Scaling the stone's own specular changes the SAME RATIO and touches nothing
 * else. It is also the more defensible reading physically: weathered, sooted,
 * dry dungeon stone genuinely reflects less than the 4% default a clean
 * dielectric gets, and the 4% was never authored for it — it is simply what
 * MeshStandardMaterial assumes when nobody says otherwise.
 *
 * So: albedo UP and stone specular DOWN, with global exposure untouched.
 */
export function setMaterialStoneLightingWebGPU(
  mat: any, opts: { chromaNode?: any; specScale?: any; specBands?: any; bands?: any },
): void {
  const chromaNode = opts.chromaNode ?? null;
  const specScale = opts.specScale ?? null;
  const specBands = opts.specBands ?? null;
  const bands = opts.bands ?? null;
  mat.setupLightingModel = () =>
    new BandedPhysicalLightingModel(1, chromaNode, 0, specScale, specBands, bands);
}

/** Restore the stock (un-banded) lighting model on a material — used for the
 *  close-up viewmodel, where cel-banding a flickering lamp-lit arm reads as
 *  flicker. Smooth lighting there is steadier and barely distinguishable. */
export function unbandMaterialWebGPU(mat: any): void {
  if (origSetupLightingModel) mat.setupLightingModel = origSetupLightingModel;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
