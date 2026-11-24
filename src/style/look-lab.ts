// LOOK TEST — five switches over the current look (Josh, 2026-11-24: "I kinda
// love the style as it is, I just wanted to see if we can take it even
// further"). A second opinion (ChatGPT) and Claude agreed on the same few
// subtractions; each is a switch so it can be judged on the phone, in play,
// against the shipped look. All OFF by default = the shipped look, untouched.
//
//   soft fringe     chromatic split at ~30% (it read as digital damage)
//   dark dither     dither only in the darks, and the light-step edges less
//                   scattered: lit stone stops looking corroded
//   shadow lift     a faint charcoal pedestal above black (daylight phones)
//   neutral stone   the stone loses its own warmth, so the amber is the fire's
//   dry floor       the floor's wet traffic sheen mostly gone
//
// The last two drive the existing surface knobs (style/surface-detail.ts), so
// they are live: switching back restores whatever the knob held before.
// Keep the winners by moving their values into the defaults; delete the rest.

import type { Settings } from '../settings/settings';
import { setWebGPULook } from './render-webgpu';
import { getKnob } from '../debug/tuning';

/** Knob values each material switch moves to. */
const NEUTRAL_STONE: Record<string, number> = { wallwarm: -0.45, mortarwarmw: 0.0, stonehue: 0.12 };
const DRY_FLOOR: Record<string, number> = { flrpolish: 0.08 };
// The "corroded" speckle on lit stone is mostly the light-step BREAK-UP in the
// stone shader (each band edge scattered per pixel), not the post dither: so
// the dither switch calms both.
const CALM_BANDS: Record<string, number> = { bandwarp: 0.2, bandwarpn: 0.15 };

const before = new Map<string, number>();

function drive(values: Record<string, number>, on: boolean): void {
  for (const [id, v] of Object.entries(values)) {
    const k = getKnob(id);
    if (!k) continue;
    if (on) {
      if (!before.has(id)) before.set(id, k.get());
      if (k.get() !== v) k.set(v);
    } else if (before.has(id)) {
      k.set(before.get(id)!);
      before.delete(id);
    }
  }
}

/** The five switches, as one value. */
export interface LookFlags {
  softFringe: boolean; darkDither: boolean; shadowLift: boolean; neutralStone: boolean; dryFloor: boolean;
}

export const LOOK_SWITCHES: ReadonlyArray<{ key: keyof LookFlags; setting: keyof Settings; name: string }> = [
  { key: 'softFringe', setting: 'lookSoftFringe', name: 'SOFT FRINGE' },
  { key: 'darkDither', setting: 'lookDarkDither', name: 'LESS SPECKLE' },
  { key: 'neutralStone', setting: 'lookNeutralStone', name: 'NEUTRAL STONE' },
  { key: 'dryFloor', setting: 'lookDryFloor', name: 'DRY FLOOR' },
  { key: 'shadowLift', setting: 'lookShadowLift', name: 'SHADOW LIFT' },
];

export const SHIPPED_LOOK: LookFlags = { softFringe: false, darkDither: false, shadowLift: false, neutralStone: false, dryFloor: false };

export function lookFromSettings(s: Settings): LookFlags {
  return {
    softFringe: s.lookSoftFringe, darkDither: s.lookDarkDither, shadowLift: s.lookShadowLift,
    neutralStone: s.lookNeutralStone, dryFloor: s.lookDryFloor,
  };
}

/** Put a look on screen now. Every switch is live (uniforms), so the bench can
 *  flip between two looks inside a frame. */
export function applyLook(f: LookFlags): void {
  setWebGPULook({ softFringe: f.softFringe, darkDither: f.darkDither, shadowLift: f.shadowLift });
  drive(NEUTRAL_STONE, f.neutralStone);
  drive(DRY_FLOOR, f.dryFloor);
  drive(CALM_BANDS, f.darkDither);
}

export function applyLookLab(s: Settings): void { applyLook(lookFromSettings(s)); }
