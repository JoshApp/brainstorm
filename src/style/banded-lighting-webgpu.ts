import { PhysicalLightingModel, MeshStandardNodeMaterial } from 'three/webgpu';
import { vec3, diffuseColor, luminance, mix, normalView, BRDF_Lambert, BRDF_GGX, specularColor, roughness, float, attribute, normalWorld, positionWorld, cameraPosition, screenCoordinate, smoothstep, vec2, sin } from 'three/tsl';
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
import { ROOM_Y_ATTR } from '../scene/room-height';

const uBands = tuneUniform({
  id: 'bands', group: 'Light', label: 'Light bands', min: 2, max: 24, value: 5, step: 1,
  hint: 'how many steps the direct light is posterised into',
});
const uBandSoft = tuneUniform({
  id: 'bandsoft', group: 'Light', label: 'Band softness', min: 0, max: 1, value: 0.4,
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
  id: 'bandcurve', group: 'Light', label: 'Band curve', min: 0.5, max: 2.5, value: 1,
  hint: 'above 1 makes the brightest band an accent instead of a region',
});

// ── DITHER THE THRESHOLD, NOT THE SCREEN ────────────────────────────────────
// A quantised light draws its own iso-intensity contours as clean curved lines,
// which is the one thing that gives posterisation away as a filter rather than
// a material. Ordered dithering breaks that line into a stipple — but only
// where a line exists.
//
// The trick is WHERE it is applied. Screen-wide dithering adds noise to
// everything and costs contrast for nothing. Nudging the value by a Bayer
// offset just BEFORE the floor means a pixel deep inside a band cannot move
// (it is nowhere near a threshold), while a pixel close to one falls either
// side depending on its position in the pattern. The dither is therefore
// confined to the contours automatically, with no mask and no extra branch.
//
// The pattern is in RENDER pixels, so at the 0.4x buffer it comes out chunky —
// which is period-correct rather than a compromise.
// DEFAULT IS LOW, and 0.35 taught me why. The offset is in BAND UNITS, so how
// much of the SCREEN it covers depends on how fast the tone is changing — and
// across a wall lit by one distant candle the tone changes very slowly, so a
// narrow band-space window is an enormous spatial one. At 0.35 the stipple
// covered whole blocks rather than their contours. The knob is honest; the
// default was not.
// ── THE SPECULAR GETS ITS OWN CURVE ─────────────────────────────────────────
// Band curve is shared by the diffuse and the specular, which is right for
// keeping the two in the same language but wrong for one specific thing worth
// doing: making the TOP specular band narrow.
//
// The suggestion is a good one — "retain the big graphic highlight regions, but
// only genuinely favourable normal/light/view angles get the almost-flat bright
// one", so the response reads dark stone -> subtle sheen -> broad lit response
// -> small hard highlight, rather than dark stone -> BAM. That is a curve above
// 1 applied to the specular ONLY; doing it on the shared knob would drag the
// diffuse's band positions along with it, which is a different edit.
//
// Defaults to 1 (no change from the shared curve's behaviour) so nothing moves
// until it is asked to.
const uSpecCurve = tuneUniform({
  id: 'speccurve', group: 'Light', label: 'Specular curve', min: 0.5, max: 2.5, value: 1,
  hint: 'above 1 narrows the top highlight band into an accent',
});

const uBandDither = tuneUniform({
  id: 'banddither', group: 'Light', label: 'Band dither', min: 0, max: 1, value: 0.08,
  hint: 'stipples the band edges; meant to be found, not noticed',
});

// ── THE LADDER: WHERE A BAND STARTS AND HOW BRIGHT IT IS, SEPARATELY ────────
//
// Even bands couple two decisions that have no reason to be coupled. With N
// steps of equal width, moving a threshold moves every other threshold, and the
// brightness of a band is fixed at wherever it happens to land. The Band curve
// knob loosens that — it moves all the thresholds along a power law — but it
// still cannot say "the top band should start late AND be only this bright".
//
// Here the two are independent: four thresholds decide WHERE the light steps,
// five values decide WHAT it steps to. That is the difference between tuning a
// formula and drawing a response curve, and it is what makes the brightest band
// an ACCENT — a thin sliver of near-white on the few surfaces facing a flame —
// rather than a region that claims every well-lit slab.
//
// Defaults are the shape ChatGPT proposed and they are a reasonable start:
// thresholds bunched low so most of the material lives in the middle bands, and
// a top value short of 1.0 so nothing clips to paper.
//
// Off by default (Ladder mode 0) because the even path is what Josh has been
// tuning all day, and switching the whole lighting response out from under a
// set he chose would not be an improvement, it would be a different game.
const uBandMode = tuneUniform({
  id: 'bandmode', group: 'Ladder', label: 'Ladder mode', min: 0, max: 1, value: 0, step: 1,
  hint: '0 = even bands (count + curve), 1 = the explicit ladder below',
});
const LADDER_T = [0.10, 0.27, 0.52, 0.78];
const LADDER_V = [0.06, 0.18, 0.38, 0.64, 0.90];
const uLt = LADDER_T.map((v, i) => tuneUniform({
  id: `lt${i}`, group: 'Ladder', label: `Step ${i + 1} at`, min: 0, max: 1, value: v,
  hint: `light level where band ${i + 2} begins`,
}));
const uLv = LADDER_V.map((v, i) => tuneUniform({
  id: `lv${i}`, group: 'Ladder', label: `Band ${i + 1} value`, min: 0, max: 1, value: v,
  hint: i === 0 ? 'the shadow floor' : i === 4 ? 'the highlight accent' : 'a mid band',
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 2x2 ordered Bayer as an integer 0..3, branchless.
 *  [[0,2],[3,1]] — verified at all four positions rather than trusted:
 *  (0,0)=0, (1,0)=2, (0,1)=3, (1,1)=2+3-4=1. */
function bayer2i(p: any): any {
  const mx: any = p.x.floor().mod(2);
  const my: any = p.y.floor().mod(2);
  return mx.mul(2).add(my.mul(3)).sub(mx.mul(my).mul(4));
}
/** 4x4 Bayer in [0,1), built by nesting the 2x2 — the standard construction. */
function bayer4(p: any): any {
  return bayer2i(p.mul(0.5)).mul(4).add(bayer2i(p)).div(16);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Posterise a [0,1] tone into `bands` steps, with `curve` deciding where those
 *  steps fall. Shared by the diffuse and the specular so the two cannot drift
 *  into different-looking quantisation. */
function posterise(tone: any, bands: any, curve: any, allowLadder = false, warp: any = null): any {
  // Offset in BAND UNITS, so its effect is relative to the step size rather
  // than to the absolute value — a coarse quantisation and a fine one dither by
  // the same visual proportion.
  let jitter: any = (bayer4(screenCoordinate as any) as any).sub(0.5).mul(uBandDither as any);
  // ── AND THE BANDS THEMSELVES WANDER ────────────────────────────────────────
  //
  // Josh: *"i love how light works etc. but its kinda a perfect circular
  // highlight on close sources ... if the light is close it gets this kinda
  // perfect circular banded sheen."*
  //
  // He is describing a bullseye, and it is honest output: a point light's
  // irradiance falls off radially, a flat wall turns that into concentric
  // circles, and quantising a smooth radial gradient draws those circles as
  // hard rings. Every step is correct and the result reads as a target painted
  // on the stone.
  //
  // The Bayer dither above cannot help. It breaks a band edge at the PIXEL
  // scale, which is what it is for (removing the staircase), and it lives in
  // SCREEN space, so it swims when the camera moves and leaves the ring's shape
  // exactly where it was. What the ring needs is for its BOUNDARY to wander —
  // in world space, over metres, so a circle becomes a broken crescent and then
  // islands.
  //
  // So the caller may hand in a warp, in the same BAND UNITS as the jitter, and
  // it is added at the same place. Where it comes from is the surface's
  // business, not the lighting model's: the stone shader knows which STONE a
  // fragment belongs to, and per-stone is the strongest version of this — a ring
  // crossing five stones breaks into five offset arcs, which is masonry catching
  // light rather than a gradient being posterised.
  //
  // WEIGHTED TOWARD THE OUTER BANDS. The hot core is where the eye reads the
  // light source and it should stay clean; the faint outer rings are where the
  // bullseye actually reads as one. `1 - tone` does that in one term.
  if (warp !== null) {
    const outer: any = (float as any)(1).sub(tone as any).clamp(0, 1);
    jitter = jitter.add((warp as any).mul(outer));
  }
  const bent: any = (tone as any).max(0.0001).pow(curve);
  const q: any = bent.mul(bands).add(jitter).add(0.5).floor().div(bands);
  const even: any = q.max(0.0001).pow((float as any)(1).div(curve));
  // The specular never takes the ladder: it is a different quantity in a
  // different range, and a tonal response curve authored for diffuse light
  // would mean nothing applied to a highlight's magnitude.
  if (!allowLadder) return even;
  // Ladder. Jitter converted to TONE units — a band is roughly 0.2 wide — so the
  // dither carries the same visual weight in both modes rather than silently
  // changing strength when the mode flips.
  const t: any = (tone as any).add(jitter.mul(0.2));
  let lad: any = uLv[0];
  for (let i = 0; i < 4; i++) lad = (t.greaterThan(uLt[i] as any) as any).select(uLv[i + 1], lad);
  return ((uBandMode as any).greaterThan(0.5) as any).select(lad, even);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
// ── THE TOP OF EVERY ROOM IS NOTHING ─────────────────────────────
//
// Josh, after three attempts that each failed differently: *"i want a room height based effect,
// basically i want the top of every room to be pitch black, but it not looking like i just
// painted the ceiling black, instead i want it to feel like yes its pitchblack like infinite
// there, and the painted black effect distorted by having it be irregular and kinda vanishing on
// the last few steps for small rooms that needs to be small for large rooms it can be a bit
// larger."*
//
// That is a precise brief, and it names the three things that make it read as DEPTH rather than
// as paint. All three matter; drop any one and an earlier failure comes back.
//
//   1. IT REACHES TRUE ZERO. Not a small fraction, not a cap — nothing. A surface at 4% still
//      answers the light: it has shading, a specular sheen, a normal you can read, and the eye
//      reconstructs a ceiling from those cues however dim they are. That IS what painted-black
//      looks like. At exactly zero there are no cues left to reconstruct anything from, which is
//      what makes it read as absence rather than as a dark surface.
//
//   2. THE BOUNDARY IS IRREGULAR. A level edge is a horizontal line, and a horizontal line across
//      a wall is a plane — the first version's entire failure. Wandered by WORLD position, so two
//      walls meeting at a corner agree about where the dark begins instead of showing a seam.
//
//   3. IT VANISHES IN THE LAST FEW STEPS. The band is weighted toward its top: most of it only
//      takes the edge off and the final stretch takes everything. A linear ramp spends its whole
//      length visibly dimming, which reads as a gradient someone painted; a weighted one reads as
//      light giving out.
//
// SCALED TO THE ROOM, which is the part the eye-relative version could not do. The band is a
// FRACTION of the room's own height, so a low corridor gets a shallow one and a hall a deeper one
// — small for small, larger for large — and it is anchored to the room's CEILING rather than to
// the camera, so it does not slide when the player climbs a stair. Each shell surface carries its
// room's floor and ceiling Y on a vertex attribute (scene/room-height.ts); untagged geometry
// reads (0, 0) and is left entirely alone.
const uBlackBand = tuneUniform({
  id: 'blackband', group: 'The dark', label: 'Black band (frac of room H)',
  min: 0.05, max: 0.9, value: 0.37, step: 0.01,
  hint: "how much of the room's top is taken; scales with the room, so small rooms lose less",
});
const uBlackEdge = tuneUniform({
  id: 'blackedge', group: 'The dark', label: 'Edge irregularity (m)',
  min: 0, max: 1.5, value: 0.95, step: 0.05,
  hint: 'how far the boundary wanders; 0 is a dead level line and reads as a painted plane',
});
const uBlackBias = tuneUniform({
  id: 'blackbias', group: 'The dark', label: 'Vanish late',
  min: 1, max: 6, value: 1.8, step: 0.1,
  hint: '1 = an even ramp; higher holds the light, then drops it in the last few steps',
});

/**
 * A slow wander on the boundary, so the dark does not end in a spirit level.
 *
 * Three incommensurable sines on world XZ. This is sampled on every lit surface in the scene, so
 * it has to be nearly free — and what it is asked to do is wander, not to look like anything.
 * Driven by WORLD position rather than by each surface's own coordinates so that two walls meeting
 * at a corner agree about where the dark starts.
 */
function blackEdgeNoise(): any {
  const p: any = (vec2 as any)((positionWorld as any).x, (positionWorld as any).z).mul(0.85);
  const a: any = (sin as any)(p.x.add(p.y.mul(0.7)));
  const b: any = (sin as any)(p.x.mul(-0.63).add(p.y.mul(1.31)).add(2.1));
  const c: any = (sin as any)(p.x.mul(1.87).add(p.y.mul(-1.09)).add(4.7));
  return a.mul(0.5).add(b.mul(0.33)).add(c.mul(0.17));      // ~[-1, 1]
}

/** How much light survives here. Exactly 0 at the ceiling, exactly 1 below the band. */
function roomTopTransmission(): any {
  const roomY: any = (attribute as any)(ROOM_Y_ATTR, 'vec2');
  const span: any = roomY.y.sub(roomY.x);
  const below: any = roomY.y.sub((positionWorld as any).y);     // metres BELOW the ceiling
  const band: any = span.mul(uBlackBand as any)
    .add(blackEdgeNoise().mul(uBlackEdge as any))
    .max(0.05);
  // 1 at the ceiling, 0 at the bottom of the band.
  const t: any = below.div(band).clamp(0, 1).oneMinus();
  // Weighted to the top: most of the band barely dims, the last stretch takes everything.
  const eaten: any = t.pow(uBlackBias as any);
  return (span.greaterThan(0.01) as any).select(eaten.oneMinus(), (float as any)(1));
}

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
  /** Per-fragment offset to the band boundaries, in BAND UNITS — see posterise.
   *  Supplied by the stone shader so the rings a close light draws follow the
   *  masonry instead of the falloff. Null on every other material. */
  bandWarp: any;
  // Per-material DIFFUSE band count. A floor's enormous irregular polygons turn
  // hard quantisation into graphic shapes; a wall already has brick boundaries,
  // surface variation and RGB separation competing for the same edges, so it
  // wants a gentler curve. Null = use the global.
  bandsNode: any;
  constructor(
    chroma = 1, chromaNode: any = null, rimDarkReactive = 0,
    specScale: any = null, specBands: any = null, bandsNode: any = null,
    bandWarp: any = null,
  ) {
    super();
    this.chroma = chroma;
    this.chromaNode = chromaNode;
    this.rimDarkReactive = rimDarkReactive;
    this.specScale = specScale;
    this.specBands = specBands;
    this.bandsNode = bandsNode;
    this.bandWarp = bandWarp;
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
    const quantTone: any = posterise(tone, dBands, uBandCurve as any, true, this.bandWarp);
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
      const sq: any = posterise(st, this.specBands, (uBandCurve as any).mul(uSpecCurve as any),
        false, this.bandWarp).min(0.95);
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
    // ── AND THE TOP OF THE ROOM TAKES WHAT IS LEFT ────────────────────────
    // Last, and on the TOTAL — direct, ambient, specular, rim and all. Per light was an earlier
    // version's mistake: a small room's ceiling is lit mostly by the AMBIENT term, which a
    // per-light attenuation never sees, so nothing visibly happened there. And it has to come
    // after the rim, or the rim keeps burning a silhouette into a ceiling meant to be absent.
    out = out.mul(roomTopTransmission());
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
  mat: any,
  opts: { chromaNode?: any; specScale?: any; specBands?: any; bands?: any; bandWarp?: any },
): void {
  const chromaNode = opts.chromaNode ?? null;
  const specScale = opts.specScale ?? null;
  const specBands = opts.specBands ?? null;
  const bands = opts.bands ?? null;
  const bandWarp = opts.bandWarp ?? null;
  mat.setupLightingModel = () =>
    new BandedPhysicalLightingModel(1, chromaNode, 0, specScale, specBands, bands, bandWarp);
}

/** Restore the stock (un-banded) lighting model on a material — used for the
 *  close-up viewmodel, where cel-banding a flickering lamp-lit arm reads as
 *  flicker. Smooth lighting there is steadier and barely distinguishable. */
export function unbandMaterialWebGPU(mat: any): void {
  if (origSetupLightingModel) mat.setupLightingModel = origSetupLightingModel;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
