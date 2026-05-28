// Input orchestrator — attaches one or more input SCHEMES to the canvas,
// each writing into a shared InputState. Schemes coexist (touch +
// desktop run simultaneously; their event types don't overlap), so
// hybrid devices work without configuration. Adding a new scheme
// (gamepad, VR, etc.) means dropping in a new file under controls/
// that exports an InputScheme, then listing it here.
//
// The shared options bag carries semantic-action callbacks (onTap,
// onInteract) so schemes don't need to know about game state.

import { touchScheme } from './input-touch';
import { desktopScheme } from './input-desktop';
import type { InputScheme, InputState, InputOptions, InputTick } from './input-types';

export type { InputState, InputOptions };
// Back-compat alias for the previous name.
export type TouchInputOptions = InputOptions;

const ALL_SCHEMES: InputScheme[] = [touchScheme, desktopScheme];

// Optional override that REPLACES the per-frame scheme ticks. Set by the
// AI-playable harness so its synthetic moveX/moveY values aren't fought
// by the touch/desktop schemes (which write 0 whenever there's no human
// input). Pass null to restore normal scheme-driven behaviour.
let overrideTick: ((state: InputState) => void) | null = null;

/** Replace the per-frame input tick with a custom hook. Used by the
 *  harness to drive synthetic movement; passing null restores the
 *  touch + desktop schemes. */
export function setInputOverride(fn: ((state: InputState) => void) | null): void {
  overrideTick = fn;
}

export function createTouchInput(
  canvas: HTMLCanvasElement,
  options: InputOptions = {},
): InputState {
  const state: InputState = {
    moveX: 0, moveY: 0, lookDx: 0, lookDy: 0,
    tickInput: () => {},
  };

  // Attach each scheme; collect any per-frame ticks they need.
  const ticks: InputTick[] = [];
  for (const scheme of ALL_SCHEMES) {
    const tick = scheme.attach({ canvas, state, options });
    if (tick) ticks.push(tick);
  }

  // Compose per-frame ticks into the InputState's tickInput hook.
  state.tickInput = (dt: number) => {
    if (overrideTick) {
      overrideTick(state);
      return;
    }
    for (const t of ticks) t(dt);
  };

  return state;
}
