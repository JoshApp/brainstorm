import * as THREE from 'three';

// Banded (cel / posterized) DIRECT lighting — global PSX chiaroscuro, done in
// LIGHTING space (not screen space). Steps the directional light falloff into
// hard light→dark bands while leaving ambient, specular, and emissive smooth.
//
// Why this version works where the screen-space one didn't:
//   The screen-space attempt banded final pixel BRIGHTNESS = albedo × light,
//   so a dark-coloured wall always read "in shadow" and a pale bone always
//   read "lit" under identical lighting — and it popped as torch flicker slid
//   pixels across band edges. This bands the LIGHT TERM ONLY: it divides the
//   surface albedo back out of the accumulated diffuse, posterises the pure
//   light, then re-applies the albedo. Albedo-independent → every surface
//   steps the same way, and it's stable because the lighting is smooth.
//
// Implemented by appending to THREE.ShaderChunk.lights_fragment_end ONCE, so
// every lit material (walls, floor, creatures, props) inherits it for free.
// MUST run before the first render (materials compile lazily from the chunk).
// Emissive cores + the dark-reactive rims live outside reflectedLight, so the
// glow stays smooth — only the lit SHADING bands.

// Hard light→dark steps. Higher = subtler, lower = chunkier/more graphic.
const BAND_COUNT = 4.0;

let installed = false;

/** Patch the global lighting chunk to band direct diffuse. Idempotent. */
export function installBandedLighting(): void {
  if (installed) return;
  installed = true;
  const bands = BAND_COUNT.toFixed(1);
  THREE.ShaderChunk.lights_fragment_end = `${THREE.ShaderChunk.lights_fragment_end}
  // ── DELVE banded direct lighting (cel chiaroscuro, albedo-independent) ──
  {
    vec3 dlvAlb = max(material.diffuseColor, vec3(0.004));
    vec3 dlvLight = reflectedLight.directDiffuse / dlvAlb;   // recover the pure light term
    float dlvMag = max(max(dlvLight.r, dlvLight.g), dlvLight.b);
    if (dlvMag > 0.0015) {
      // Round the light magnitude to the nearest band (0 stays dark, top
      // reaches full), preserving the light's hue, then re-apply albedo.
      float dlvBand = floor(dlvMag * ${bands} + 0.5) / ${bands};
      reflectedLight.directDiffuse = dlvLight * (dlvBand / dlvMag) * dlvAlb;
    }
  }
  `;
}
