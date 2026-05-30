import { CONFIG } from '../config';

// Eye dark-adaptation. When the player lingers in darkness, the scene lifts so
// a torchless corridor becomes navigable; moving back toward torchlight drops
// it FAST (bright light re-blinds you).
//
// Two levers, both ramped by the same 0..1 adaptation:
//   - EXPOSURE (ACES tone-map): scales the WHOLE rendered image, so even the
//     near-black surfaces visibly lift. This is the lever that actually shows —
//     ambient alone barely does, because the static surfaces keep their ambient
//     colour near-black on purpose (to preserve warm/cool torch contrast).
//   - AMBIENT: a secondary fill so unlit corners gain a little body, not just
//     a uniform exposure gain.
//
// Driven by LINE-OF-SIGHT torch proximity (computed by the caller): a torch
// behind a wall doesn't count, and the handheld lamp is excluded, so a
// lamp-only hall correctly reads "dark." Adaptation rests at 0 wherever
// there's visible torchlight, so torchlit rooms keep their grimdark look.

// "Lit" thresholds — the estimated light reaching the surface you're looking
// at (torches with line-of-sight + your lamp's falloff, summed by the caller).
// At/below LIT_DARK the eye fully adapts; at/above LIT_BRIGHT it rests. No GPU
// readback (framebuffer metering stalled the pipeline) — this is analytic.
const LIT_DARK = 0.15;
const LIT_BRIGHT = 0.65;
// Faster ramps than the previous 0.6/4.0 values — feedback was
// "this feels too slow for gameplay". Now ~0.6s to adapt UP and
// ~0.12s to slam DOWN. Still keeps the asymmetry (bright re-
// blinds you instantly; darkness takes a beat to grow into).
const ADAPT_UP_RATE = 1.6;           // per-sec approach while dark
const ADAPT_DOWN_RATE = 8.0;         // per-sec approach while lit

// Brightness multiplier at full adaptation. The blit shader multiplies the
// image by darkAdaptBrightness() (1.0 = neutral), and the AmbientLight is
// scaled by the same factor as a secondary fill.
const MAX_BRIGHTNESS_BOOST = 0.8;    // → 1.8× at full dark

let adaptation = 0;   // 0..1

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Advance adaptation toward its target and return the 0..1 value. `lit` =
 * estimated light on the surface you're looking at (torch LOS + lamp falloff).
 * Dark → adapt toward 1; lit → toward 0. Use realDt so it runs at real-time.
 */
export function tickDarkAdaptation(lit: number, dt: number): number {
  // LIT_BRIGHT → 0, LIT_DARK → 1 (smoothstep handles edge0 > edge1).
  const target = smoothstep(LIT_BRIGHT, LIT_DARK, lit);
  const rate = target > adaptation ? ADAPT_UP_RATE : ADAPT_DOWN_RATE;
  adaptation += (target - adaptation) * (1 - Math.exp(-rate * dt));
  return adaptation;
}

/** Relative brightness multiplier for this frame — 1.0 at rest, up to
 *  1 + MAX_BRIGHTNESS_BOOST in full darkness. Applied to the blit exposure
 *  and (scaled) to the ambient fill. */
export function darkAdaptBrightness(): number {
  return 1 + adaptation * MAX_BRIGHTNESS_BOOST;
}

/** AmbientLight intensity to apply this frame (baseline × brightness). */
export function darkAdaptAmbient(): number {
  return CONFIG.AMBIENT_INTENSITY * darkAdaptBrightness();
}

export function getDarkAdaptation(): number {
  return adaptation;
}

/** Reset on level load (descend into the dark, then your eyes adjust). */
export function resetDarkAdaptation(): void {
  adaptation = 0;
}
