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

const DARK_LIGHT_THRESHOLD = 0.25;   // LOS torch-proximity below this reads as "dark"
const ADAPT_UP_RATE = 0.6;           // per-sec approach while dark (~1.7s to adjust)
const ADAPT_DOWN_RATE = 4.0;         // per-sec approach while lit (~0.25s — re-blinded)

// Tone-map exposure: BASE matches the renderer init.
export const BASE_EXPOSURE = 0.9;
const MAX_EXPOSURE_BOOST = 0.7;      // → 1.6 at full dark (~1.8× brighter image)
// Ambient fill on top of the configured baseline.
const MAX_AMBIENT_BOOST = 1.6;       // → baseline + 1.6 at full dark

let adaptation = 0;   // 0..1

/**
 * Advance adaptation toward its dark/lit target and return the 0..1 value.
 * `lightLevel` = LINE-OF-SIGHT torch proximity (0 = no visible nearby torch).
 * Use realDt so adjustment runs at real-time.
 */
export function tickDarkAdaptation(lightLevel: number, dt: number): number {
  const target = lightLevel < DARK_LIGHT_THRESHOLD ? 1 : 0;
  const rate = target > adaptation ? ADAPT_UP_RATE : ADAPT_DOWN_RATE;
  adaptation += (target - adaptation) * (1 - Math.exp(-rate * dt));
  return adaptation;
}

/** ACES tone-map exposure to apply this frame. */
export function darkAdaptExposure(): number {
  return BASE_EXPOSURE + adaptation * MAX_EXPOSURE_BOOST;
}

/** AmbientLight intensity to apply this frame. */
export function darkAdaptAmbient(): number {
  return CONFIG.AMBIENT_INTENSITY + adaptation * MAX_AMBIENT_BOOST;
}

export function getDarkAdaptation(): number {
  return adaptation;
}

/** Reset on level load (descend into the dark, then your eyes adjust). */
export function resetDarkAdaptation(): void {
  adaptation = 0;
}
