import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';

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

/** Call once per frame with the player/lamp world position + look direction. */
export function updateLampReveal(playerPos: THREE.Vector3, lookDir: THREE.Vector3): void {
  uLampPos.value.copy(playerPos);
  uLampDir.value.copy(lookDir).normalize();
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
