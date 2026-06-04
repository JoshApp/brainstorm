import * as THREE from 'three';

// Banded (cel / posterized) DIRECT lighting — global PSX chiaroscuro, done in
// LIGHTING space (not screen space). Steps the directional light falloff into
// hard light→dark bands while leaving ambient, specular, and emissive smooth.
//
// Why this version works where a screen-space one didn't:
//   Screen-space banding keys off final pixel BRIGHTNESS = albedo × light, so
//   a dark wall always reads "in shadow" and a pale bone "lit" under identical
//   lighting, and it pops as flicker slides pixels across band edges. This
//   bands the LIGHT TERM ONLY: divide the surface albedo back out of the
//   accumulated diffuse, posterise the pure light (in TONEMAPPED space so the
//   steps span the PERCEIVED range — the scene is HDR), re-apply the albedo.
//
// Implemented by APPENDING to THREE.ShaderChunk.lights_fragment_end so every
// lit material inherits it. setBandedLighting() swaps the chunk back and forth
// for the GRAPHICS toggle; the caller forces visible materials to recompile so
// it takes effect live (materials re-read the chunk on needsUpdate).

// Hard light→dark steps. Higher = subtler, lower = chunkier/more graphic.
const BAND_COUNT = 4.0;

const BANDED_CHUNK = `
  // ── DELVE banded direct lighting (cel chiaroscuro, albedo-independent) ──
  {
    vec3 dlvAlb = max(material.diffuseColor, vec3(0.004));
    vec3 dlvLight = reflectedLight.directDiffuse / dlvAlb;   // recover the pure light term
    float dlvMag = max(max(dlvLight.r, dlvLight.g), dlvLight.b);
    if (dlvMag > 0.0015) {
      // Band in TONEMAPPED space so the steps span the PERCEIVED brightness
      // range (the scene is HDR — no tonemap before the blit). Reinhard-map
      // to 0..1, posterise, invert back.
      float tone = dlvMag / (dlvMag + 1.0);
      float bandedTone = floor(tone * ${BAND_COUNT.toFixed(1)} + 0.5) / ${BAND_COUNT.toFixed(1)};
      bandedTone = min(bandedTone, 0.88);   // keep the inverse off the ∞ at tone=1
      float bandedMag = bandedTone / max(1.0 - bandedTone, 0.001);
      reflectedLight.directDiffuse = dlvLight * (bandedMag / dlvMag) * dlvAlb;
    }
  }
`;

let originalChunk: string | null = null;
let enabled = false;

/** Capture the stock lighting chunk + apply the initial banding state. Call
 *  ONCE before any material compiles. */
export function installBandedLighting(initialOn: boolean): void {
  if (originalChunk !== null) return;
  originalChunk = THREE.ShaderChunk.lights_fragment_end;
  applyChunk(initialOn);
}

function applyChunk(on: boolean): void {
  if (originalChunk === null) return;
  enabled = on;
  THREE.ShaderChunk.lights_fragment_end = on ? originalChunk + BANDED_CHUNK : originalChunk;
}

/** Toggle banded lighting at runtime (GRAPHICS setting). Returns true if the
 *  state actually changed (the caller should then force material recompile;
 *  materials re-read the chunk on needsUpdate). */
export function setBandedLighting(on: boolean): boolean {
  if (originalChunk === null || on === enabled) return false;
  applyChunk(on);
  return true;
}

export function isBandedLightingOn(): boolean {
  return enabled;
}
