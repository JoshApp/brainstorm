// LOOK TEST — switches over the current look (Josh, 2026-11-24: "I kinda love
// the style as it is, I just wanted to see if we can take it even further").
// Each is a switch so it can be judged in play against the shipped look; all
// OFF by default = the shipped look. Judge them on the look bench (ui/look-bench.ts).
//
// Settled 2026-11-24 and moved into the defaults: SOFT FRINGE (CA_AMOUNT in
// style/render-webgpu.ts), LESS SPECKLE (the dark-only dither there, and the
// band break-up knobs), NEUTRAL STONE (pushed further than the test: stone
// warmth, joint warmth and hue spread in style/surface-detail.ts). DRY FLOOR
// changed nothing you could see and is gone.
//
// Still open:
//   shadow lift     a faint charcoal pedestal above black (daylight phones)

import type { Settings } from '../settings/settings';
import { setWebGPULook } from './render-webgpu';

/** The switches still under test, as one value. */
export interface LookFlags { shadowLift: boolean }

export const LOOK_SWITCHES: ReadonlyArray<{ key: keyof LookFlags; setting: keyof Settings; name: string }> = [
  { key: 'shadowLift', setting: 'lookShadowLift', name: 'SHADOW LIFT' },
];

export const SHIPPED_LOOK: LookFlags = { shadowLift: false };

export function lookFromSettings(s: Settings): LookFlags {
  return { shadowLift: s.lookShadowLift };
}

/** Put a look on screen now. Every switch is live (a uniform), so the bench
 *  can flip between two looks inside a frame. */
export function applyLook(f: LookFlags): void {
  setWebGPULook({ shadowLift: f.shadowLift });
}

export function applyLookLab(s: Settings): void { applyLook(lookFromSettings(s)); }
