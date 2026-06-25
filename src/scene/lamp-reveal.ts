import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { isWebGPU } from './renderer-mode';
import { getDarkAdaptation } from './dark-adaptation';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { uniform as tslUniform, texture as tslTexture, positionWorld, vec3, float, smoothstep as tslSmoothstep } from 'three/tsl';

// THE LAMP REVEALS WHAT THE DEAD LEFT.
//
// Emissive marks — wall-runes, the glint on a corpse's held loot — that hide in
// the dark and BLOOM where the player sweeps the lamp. The baseline of the
// dungeon is darkness and the white hand-lamp is the tension (dread-light art
// direction); this makes the lamp an active instrument of discovery.
//
// Reveal is gaze-gated: a mark is barely a hint until you LOOK at it (your lamp/
// gaze cone falls across it), then it blooms full. So finding a rune is an act —
// you scan the wall — not a freebie. A faint base term keeps them findable (a
// sharp eye catches the hint and turns to confirm). On top of the cone, a radial
// falloff means distant marks stay dark.
//
// One SHARED set of uniforms, referenced by every reveal material, so a single
// write per frame updates them all — the gore-splat pattern (uSplatTex in
// scene/splat-map.ts): zero per-material cost, one shared compiled program.

export const uLampPos = { value: new THREE.Vector3(0, 0, 0) };
export const uLampDir = { value: new THREE.Vector3(0, 0, -1) };   // camera forward (world, unit)
// Radial: full within inner metres, gone past outer.
export const uRevealInner = { value: 1.4 };
export const uRevealOuter = { value: 6.0 };
// Gaze cone (cosines of the half-angle): full reveal when the mark is within the
// inner cone of where you look, fading to the base hint past the outer cone.
export const uConeInner = { value: 0.90 };   // ~25°
export const uConeOuter = { value: 0.55 };   // ~57°
// How visible an unlooked-at mark is when you're close (0 = invisible until
// looked at, 1 = no gaze gating). A faint scratch you might catch.
export const uRevealBase = { value: 0.12 };

const _toMark = new THREE.Vector3();

// ── WebGPU mirrors of the shared uniforms (TSL node graphs can't read the WebGL
// {value} objects). Kept in sync per frame in updateLampReveal. Plus a dark-adapt
// node: the reveal's BASE hint rises as the eye adapts — your adjusted eye catches
// the faint scratch even before you look straight at it (ties the rediscovered
// lamp-reveal to the eye dark-adaptation we built). ──
/* eslint-disable @typescript-eslint/no-explicit-any */
const nLampPos = (tslUniform as any)(new THREE.Vector3());
const nLampDir = (tslUniform as any)(new THREE.Vector3(0, 0, -1));
const nRevealInner = (tslUniform as any)(uRevealInner.value);
const nRevealOuter = (tslUniform as any)(uRevealOuter.value);
const nConeInner = (tslUniform as any)(uConeInner.value);
const nConeOuter = (tslUniform as any)(uConeOuter.value);
const nRevealBase = (tslUniform as any)(uRevealBase.value);
const nDarkAdapt = (tslUniform as any)(0);
const ADAPT_BASE_BOOST = 0.6;   // dark-adapted eye lifts the base hint (0.12 → ~0.30 at the 0.3 adapt cap)
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Call once per frame with the player/lamp world position + look direction. */
export function updateLampReveal(playerPos: THREE.Vector3, lookDir: THREE.Vector3): void {
  uLampPos.value.copy(playerPos);
  uLampDir.value.copy(lookDir).normalize();
  if (isWebGPU()) {
    nLampPos.value.copy(uLampPos.value);
    nLampDir.value.copy(uLampDir.value);
    nRevealInner.value = uRevealInner.value;
    nRevealOuter.value = uRevealOuter.value;
    nConeInner.value = uConeInner.value;
    nConeOuter.value = uConeOuter.value;
    nRevealBase.value = uRevealBase.value;
    nDarkAdapt.value = getDarkAdaptation();
  }
}

export interface RevealOpts {
  /** Glyph map id (procedural-textures) — bright marks on black. */
  texture: string;
  /** Tint of the glow. */
  color?: number;
  /** Quad size in metres [w, h]. */
  size: [number, number];
  /** Brightness multiplier on the revealed glow. */
  intensity?: number;
}

/**
 * An additive, gaze-reactive glow material for a flat glyph quad. Black where
 * the glyph isn't (additive → adds nothing → invisible); the glyph blooms in
 * the tint where the lamp/gaze falls, a faint hint elsewhere, all gated by
 * distance. depthWrite off: a glow decal, never occludes, never z-fights.
 */
export function makeRevealMaterial(opts: RevealOpts): THREE.MeshBasicMaterial {
  if (isWebGPU()) return makeRevealMaterialWebGPU(opts);
  const mat = new THREE.MeshBasicMaterial({
    map: getTexture(opts.texture),
    color: opts.color ?? 0x8fd8ff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  const uIntensity = { value: opts.intensity ?? 1 };
  // Expose for runtime modulation (e.g. a wall-rune's arcane pulse).
  mat.userData.uRevealIntensity = uIntensity;

  // Every reveal material runs the same injected GLSL, so they share one
  // compiled program regardless of map/color/intensity (those are uniforms).
  mat.customProgramCacheKey = () => 'lamp-reveal-gaze';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLampPos = uLampPos;
    shader.uniforms.uLampDir = uLampDir;
    shader.uniforms.uRevealInner = uRevealInner;
    shader.uniforms.uRevealOuter = uRevealOuter;
    shader.uniforms.uConeInner = uConeInner;
    shader.uniforms.uConeOuter = uConeOuter;
    shader.uniforms.uRevealBase = uRevealBase;
    shader.uniforms.uRevealIntensity = uIntensity;

    // Vertex: world position of the fragment (reveal is measured in world
    // space, stable as the camera moves).
    shader.vertexShader = `varying vec3 vRevealWorld;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRevealWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );

    // Fragment: radial falloff × gaze cone (with a base hint floor), applied to
    // the additive colour just before dithering.
    shader.fragmentShader = `varying vec3 vRevealWorld;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform float uRevealInner;
uniform float uRevealOuter;
uniform float uConeInner;
uniform float uConeOuter;
uniform float uRevealBase;
uniform float uRevealIntensity;
${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      `vec3 _lampToFrag = vRevealWorld - uLampPos;
float _rd = length(_lampToFrag);
float _radial = 1.0 - smoothstep(uRevealInner, uRevealOuter, _rd);
vec3 _dir = _lampToFrag / max(_rd, 0.001);
float _cosA = dot(_dir, uLampDir);
float _cone = smoothstep(uConeOuter, uConeInner, _cosA);
float _reveal = _radial * (uRevealBase + (1.0 - uRevealBase) * _cone);
gl_FragColor.rgb *= _reveal * uRevealIntensity;
#include <dithering_fragment>`,
    );
  };
  return mat;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** WebGPU port of makeRevealMaterial — onBeforeCompile is ignored under the node
 *  renderer, so the gaze-gated reveal is rebuilt as a TSL colorNode on an additive
 *  basic node material. Same radial × gaze-cone math as the GLSL, plus the dark-
 *  adapt base-hint lift. Black where the glyph is black (additive → invisible). */
function makeRevealMaterialWebGPU(opts: RevealOpts): THREE.MeshBasicMaterial {
  const mat: any = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.fog = true;
  mat.side = THREE.DoubleSide;

  const uIntensity = (tslUniform as any)(opts.intensity ?? 1);
  mat.userData.uRevealIntensity = uIntensity;   // runtime pulse updates .value (same as WebGL)

  const glyph: any = (tslTexture as any)(getTexture(opts.texture));
  const c = new THREE.Color(opts.color ?? 0x8fd8ff);
  const tint: any = (vec3 as any)(c.r, c.g, c.b);

  // Reveal measured in WORLD space (stable as the camera moves), exactly as the GLSL.
  const lampToFrag: any = (positionWorld as any).sub(nLampPos);
  const rd: any = lampToFrag.length();
  const radial: any = (float as any)(1).sub((tslSmoothstep as any)(nRevealInner, nRevealOuter, rd));
  const dir: any = lampToFrag.div(rd.max(0.001));
  const cosA: any = dir.dot(nLampDir);
  const cone: any = (tslSmoothstep as any)(nConeOuter, nConeInner, cosA);
  // DARK-ADAPT tie: the base hint floor rises with adaptation — the adjusted eye
  // catches the faint scratch before looking straight at it; the gaze cone still
  // blooms it to full. (min 1 so a deep-adapted base can't exceed full reveal.)
  const base: any = nRevealBase.add(nDarkAdapt.mul(ADAPT_BASE_BOOST)).min(1.0);
  const reveal: any = radial.mul(base.add((float as any)(1).sub(base).mul(cone)));

  mat.colorNode = glyph.rgb.mul(tint).mul(reveal).mul(uIntensity);
  return mat as THREE.MeshBasicMaterial;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Gameplay side of the reveal: is this point both close AND within the gaze
 *  cone right now — i.e. has the player actually LOOKED at it? Drives whether a
 *  rune's message whispers. Slightly more generous cone than the visual so a
 *  read fires as it blooms, not a beat after. */
export function isLampRevealed(worldPos: THREE.Vector3): boolean {
  const mid = (uRevealInner.value + uRevealOuter.value) * 0.5;
  _toMark.copy(worldPos).sub(uLampPos.value);
  const d = _toMark.length();
  if (d > mid) return false;
  _toMark.divideScalar(Math.max(d, 0.001));
  return _toMark.dot(uLampDir.value) > 0.74;   // within ~42°
}
