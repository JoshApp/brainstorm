import * as THREE from 'three';
import { CONFIG } from '../config';
import { forEachLight } from './light-pool';
import type { WalkableRegion } from '../level/walkable';

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
const LIT_DARK = 0.18;
const LIT_BRIGHT = 0.85;
// Slow UP, fast DOWN — feedback: previous "fast up + slow down"
// orientation felt twitchy ("it ramps up immediately and then
// fades"). Inverted now: the dark has to GROW on you (~1.5s to
// fully adapt) before your eye lifts it, then any bright light
// snaps you back almost instantly (~0.1s). Models how real eyes
// actually work — dark adaptation takes seconds-to-minutes;
// light reflex is near-instant.
const ADAPT_UP_RATE = 0.45;          // per-sec approach while dark (~2.5s to adapt — slower, less twitchy)
const ADAPT_DOWN_RATE = 14.0;        // per-sec approach while lit (near-instant re-blind — the light reflex)

// Brightness multiplier at full adaptation. The blit shader multiplies the
// image by darkAdaptBrightness() (1.0 = neutral), and the AmbientLight is
// scaled by the same factor as a secondary fill.
const MAX_BRIGHTNESS_BOOST = 0.8;    // → 1.8× at full dark

let adaptation = 0;   // 0..1

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface TorchLike { position: THREE.Vector3; }

/**
 * Analytic estimate of the light reaching the player's eye this frame, in the
 * same 0..1 register tickDarkAdaptation expects. No GPU readback — sums two
 * passes and takes the brighter:
 *   - SURFACE: torches (LOS) + environment lights + lamp falloff at the point
 *     the player is looking at, fogged by look distance.
 *   - CAMERA: torches + environment lights within an FOV cone of the eye
 *     itself (lamp excluded — it's the baseline you've already adapted past).
 *
 * `cx,cz` = camera position; `fx,fz` = normalised forward (x,z). Pulled out of
 * main.ts's per-frame loop so the sampling math lives beside the adaptation it
 * feeds.
 */
export function sampleLitSignal(
  cx: number, cz: number,
  fx: number, fz: number,
  torches: readonly TorchLike[],
  walkable: WalkableRegion | undefined,
): number {
  const lightRange = CONFIG.TORCH_DISTANCE;

  // Surface sample — the point the player is looking at.
  const hitDist = walkable ? walkable.rayWallDistance(cx, cz, fx, fz, 9) : 9;
  const lookDist = Math.max(0.8, Math.min(hitDist - 0.3, 8));
  const lx = cx + fx * lookDist;
  const lz = cz + fz * lookDist;
  let lookTorch = 0;
  for (const t of torches) {
    const dx = t.position.x - lx;
    const dz = t.position.z - lz;
    const d = Math.hypot(dx, dz);
    if (d >= lightRange) continue;
    if (walkable && !walkable.hasLineOfSight(lx, lz, t.position.x, t.position.z)) continue;
    lookTorch += 1 - d / lightRange;
  }
  // Non-torch environment lights (bonfire, god rays, floor glows, candles).
  // Without this, bonfire-lit rooms read "dark" and over-adapt. Torch sources
  // are skipped (already counted above) — they prefix their id with 'torch-'.
  let envLit = 0;
  forEachLight('environment', (src) => {
    if (src.id.startsWith('torch-')) return;
    const dx = src.position.x - lx;
    const dz = src.position.z - lz;
    const d = Math.hypot(dx, dz);
    const r = Math.max(2, src.distance);
    if (d >= r) return;
    if (walkable && !walkable.hasLineOfSight(lx, lz, src.position.x, src.position.z)) return;
    // Weight by intensity (strong bonfire > small candle), normalised against
    // a torch so it shares the 0..1 register.
    const w = Math.min(1.5, src.intensity / CONFIG.TORCH_INTENSITY);
    envLit += (1 - d / r) * w;
  });
  // Lamp reaches the looked-at surface by falloff over LAMP_DISTANCE.
  const lampLit = Math.max(0, 1 - lookDist / CONFIG.LAMP_DISTANCE);

  // Fog visibility — the analytic signal must agree with the fogged screen.
  // 1 at distance ≤ FOG_NEAR, 0 at distance ≥ FOG_FAR, smooth between.
  const fogVis = (d: number): number => {
    const t = (CONFIG.FOG_FAR - d) / (CONFIG.FOG_FAR - CONFIG.FOG_NEAR);
    return Math.max(0, Math.min(1, t));
  };

  // Camera-position sample — "what light is on MY eye." FOV-gated (lights
  // behind the player don't light the screen) and fog-attenuated. Cutoff at
  // ~110° total (cos(55°) ≈ 0.574), slightly wider than the frustum. Lamp
  // excluded on purpose — counting it would mean lamp-lit corridors never adapt.
  // SOFT cone weight (was a hard boolean cutoff). A hard cone meant a torch just
  // outside view counted 0 and a torch just inside counted full — so a ~5° turn
  // FLIPPED the signal and the adaptation snapped. Ramp the weight smoothly across
  // the cone edge instead, so small view changes nudge the signal, not flip it.
  const coneWeight = (sx: number, sz: number): number => {
    const ldx = sx - cx;
    const ldz = sz - cz;
    const ldist = Math.hypot(ldx, ldz) || 1e-6;
    const dot = (fx * ldx + fz * ldz) / ldist;
    return smoothstep(0.40, 0.66, dot);   // 0 well behind, ramps to 1 inside the ~110° cone
  };
  let camTorch = 0;
  for (const t of torches) {
    const dx = t.position.x - cx;
    const dz = t.position.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= lightRange) continue;
    if (walkable && !walkable.hasLineOfSight(cx, cz, t.position.x, t.position.z)) continue;
    camTorch += (1 - d / lightRange) * fogVis(d) * coneWeight(t.position.x, t.position.z);
  }
  let camEnv = 0;
  forEachLight('environment', (src) => {
    if (src.id.startsWith('torch-')) return;
    const dx = src.position.x - cx;
    const dz = src.position.z - cz;
    const d = Math.hypot(dx, dz);
    const r = Math.max(2, src.distance);
    if (d >= r) return;
    if (walkable && !walkable.hasLineOfSight(cx, cz, src.position.x, src.position.z)) return;
    const w = Math.min(1.5, src.intensity / CONFIG.TORCH_INTENSITY);
    camEnv += (1 - d / r) * w * fogVis(d) * coneWeight(src.position.x, src.position.z);
  });

  // OMNIDIRECTIONAL PROXIMITY — a light right beside you keeps your eye lit even
  // when you look AWAY from it. Without this, standing next to a torch but facing
  // a dark doorway read "dark" and adapted — the inconsistency where being near a
  // flame still triggered. View-independent; the nearest source dominates.
  const NEAR_R = 5.0;   // metres: within this, a source counts regardless of facing
  let nearLit = 0;
  for (const t of torches) {
    const d = Math.hypot(t.position.x - cx, t.position.z - cz);
    if (d >= NEAR_R) continue;
    if (walkable && !walkable.hasLineOfSight(cx, cz, t.position.x, t.position.z)) continue;
    nearLit = Math.max(nearLit, 1 - d / NEAR_R);
  }
  forEachLight('environment', (src) => {
    if (src.id.startsWith('torch-')) return;
    const d = Math.hypot(src.position.x - cx, src.position.z - cz);
    if (d >= NEAR_R) return;
    if (walkable && !walkable.hasLineOfSight(cx, cz, src.position.x, src.position.z)) return;
    const w = Math.min(1.5, src.intensity / CONFIG.TORCH_INTENSITY);
    nearLit = Math.max(nearLit, (1 - d / NEAR_R) * w);
  });

  // Surface signal fogged by lookDist; camera signal omits the lamp.
  const litSurface = (lookTorch + envLit + lampLit) * fogVis(lookDist);
  const litCamera = camTorch + camEnv;
  return Math.max(litSurface, litCamera, nearLit);
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
