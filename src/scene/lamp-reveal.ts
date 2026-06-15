import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';

// THE LAMP REVEALS WHAT THE DEAD LEFT.
//
// Emissive marks — wall-runes, the glint on a corpse's held loot — that are
// near-invisible in the dark and BLOOM as the player's hand-lamp falls across
// them. The baseline of the dungeon is darkness and the white hand-lamp is the
// tension (see the dread-light art direction); this makes the lamp an active
// instrument of discovery, not just illumination.
//
// The reveal is radial around the player (the lamp rides the player), a
// smoothstep falloff from inner→outer metres. One SHARED uniform object,
// referenced by every reveal material, so a single write per frame updates them
// all — the gore-splat pattern (uSplatTex in scene/splat-map.ts), which keeps
// the per-material cost at zero and the programs sharing one compile.

export const uLampPos = { value: new THREE.Vector3(0, 0, 0) };
// Full glow within inner metres; faded to nothing past outer. The band between
// is the "sweep your lamp and it blooms" feel. Tuned for the hip-lamp radius.
export const uRevealInner = { value: 1.4 };
export const uRevealOuter = { value: 5.0 };

/** Call once per frame with the player/lamp world position. */
export function updateLampReveal(playerPos: THREE.Vector3): void {
  uLampPos.value.copy(playerPos);
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
 * An additive, lamp-reactive glow material for a flat glyph quad. Black where
 * the glyph isn't (additive → adds nothing → invisible), the glyph blooms in
 * the tint, the whole thing scaled by how close the lamp is. depthWrite off:
 * it's a glow decal, never occludes and never z-fights.
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

  // Every reveal material runs the same injected GLSL, so they can share one
  // compiled program regardless of map/color/intensity (those are uniforms).
  mat.customProgramCacheKey = () => 'lamp-reveal';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLampPos = uLampPos;
    shader.uniforms.uRevealInner = uRevealInner;
    shader.uniforms.uRevealOuter = uRevealOuter;
    shader.uniforms.uRevealIntensity = uIntensity;

    // Vertex: world position of the fragment, so the reveal distance is
    // measured in world space (stable as the camera moves).
    shader.vertexShader = `varying vec3 vRevealWorld;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRevealWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );

    // Fragment: fade the (already additive) colour by lamp proximity, just
    // before dithering so it gets the same quantize as everything else.
    shader.fragmentShader = `varying vec3 vRevealWorld;
uniform vec3 uLampPos;
uniform float uRevealInner;
uniform float uRevealOuter;
uniform float uRevealIntensity;
${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      `float _rd = distance(vRevealWorld, uLampPos);
float _reveal = 1.0 - smoothstep(uRevealInner, uRevealOuter, _rd);
gl_FragColor.rgb *= _reveal * uRevealIntensity;
#include <dithering_fragment>`,
    );
  };
  return mat;
}

/** True when a point is currently within the lamp's full-reveal-ish range —
 *  the gameplay side of the same falloff (e.g. "is this rune readable now").
 *  Uses the midpoint of the fade band so it agrees with what the eye sees. */
export function isLampRevealed(worldPos: THREE.Vector3): boolean {
  const mid = (uRevealInner.value + uRevealOuter.value) * 0.5;
  return worldPos.distanceTo(uLampPos.value) <= mid;
}
