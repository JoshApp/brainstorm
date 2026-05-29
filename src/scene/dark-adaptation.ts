import { CONFIG } from '../config';

// Eye dark-adaptation. When the player lingers away from torchlight, a dim
// ambient floor fades UP so a pitch-black, torchless corridor stays just
// navigable; stepping back toward torchlight fades it down FAST (bright light
// re-blinds you). Driven by torch proximity ONLY — the handheld lamp is
// excluded, so a torchless hall (lit only by your lamp) correctly counts as
// "dark" and your eyes adjust to it.
//
// Crucially, adaptation rests at 0 wherever there's torchlight, so the
// grimdark darkness around torches is untouched — this only rescues the
// "can't see a wall at all" failure, it doesn't flatten the mood.

const DARK_LIGHT_THRESHOLD = 0.25;   // torch-proximity below this reads as "dark"
const ADAPT_UP_RATE = 0.5;           // per-sec approach while dark (~2s to adjust)
const ADAPT_DOWN_RATE = 4.0;         // per-sec approach while lit (~0.25s — re-blinded)
const MAX_BOOST = 1.4;               // ambient intensity added at full adaptation

let adaptation = 0;   // 0..1

/**
 * Advance adaptation toward its dark/lit target and return the ambient
 * intensity to apply this frame. `lightLevel` = torch proximity (0 = no
 * nearby torchlight). Use realDt so adjustment runs at real-time.
 */
export function tickDarkAdaptation(lightLevel: number, dt: number): number {
  const target = lightLevel < DARK_LIGHT_THRESHOLD ? 1 : 0;
  const rate = target > adaptation ? ADAPT_UP_RATE : ADAPT_DOWN_RATE;
  adaptation += (target - adaptation) * (1 - Math.exp(-rate * dt));
  return CONFIG.AMBIENT_INTENSITY + adaptation * MAX_BOOST;
}

export function getDarkAdaptation(): number {
  return adaptation;
}

/** Reset on level load so a new floor starts un-adapted (descend into the
 *  dark, then your eyes adjust). */
export function resetDarkAdaptation(): void {
  adaptation = 0;
}
