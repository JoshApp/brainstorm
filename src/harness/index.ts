// Harness public entry point. Boots the module, binds `window.harness`,
// and ties the pause/budget plumbing to the live world.
//
// Foundation cut: pause integration is wired and the public surface
// (window.harness) is exposed, but observe/act/screenshot return stubs.
// Subsequent steps flesh out each one.

import {
  setContext, isBooted, getTurn, getTickClock, advanceTickClock,
  tryGetContext,
} from './state';
import {
  isHarnessPaused, setHarnessPaused, consumeTickBudget,
} from './pause';
import { buildObservation } from './observation';
import { renderObservationText } from './observation-text';
import { applyAction } from './action';
import { getUpdateStatus, applyUpdate } from '../pwa-update';
import type { HarnessApi, Observation, Action, ActionResult, Screenshot } from './types';
import type { HarnessContext } from './state';

let readyResolve: () => void = () => {};
const ready = new Promise<void>((res) => { readyResolve = res; });

/** Called once at boot from main.ts after camera/renderer/scene/input/
 *  level-getter are all in place. After this resolves, window.harness
 *  can read observations and run actions. */
export function bootHarness(ctx: HarnessContext): void {
  setContext(ctx);

  const api: HarnessApi & {
    /** Convenience: same as observe() but rendered as a terse text block.
     *  Cheaper to scan in the console than the JSON. */
    observeText(): string;
  } = {
    ready,
    observe(): Observation {
      const c = tryGetContext();
      const level = c?.getLevel();
      if (!c || !level) return buildPlaceholderObservation();
      return buildObservation(c.camera, level);
    },
    observeText(): string {
      return renderObservationText(this.observe());
    },
    async act(action: Action): Promise<ActionResult> {
      const c = tryGetContext();
      if (!c) throw new Error('[harness] not booted');
      return applyAction(c, action);
    },
    async screenshot(_opts?: { annotated?: boolean }): Promise<Screenshot> {
      throw new Error('[harness] screenshot() not yet implemented (Task 4)');
    },
    state() {
      return {
        booted: isBooted(),
        turn: getTurn(),
        tickClock: getTickClock(),
        paused: isHarnessPaused(),
      };
    },
    pause() { setHarnessPaused(true); },
    resume() { setHarnessPaused(false); },
    updateStatus() { return getUpdateStatus(); },
    async applyUpdate() { await applyUpdate(); },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).harness = api;
  // The "ready" gate resolves once the first level is loaded. main.ts
  // notifies us by calling notifyLevelReady() from its onLoaded
  // callback, which we patch in below.
}

let resolvedReady = false;
/** Called from main.ts's level loader onLoaded — the harness becomes
 *  callable once a level exists to observe. Idempotent. */
export function notifyLevelReady(): void {
  if (resolvedReady) return;
  resolvedReady = true;
  readyResolve();
}

/** Called once per frame from the main loop with realDt. Drains the
 *  tick budget AND advances the harness's game-time clock when the
 *  world is actually running. */
export function tickHarness(realDt: number, worldRunning: boolean): void {
  if (worldRunning) advanceTickClock(realDt);
  consumeTickBudget(realDt);
}

// Stub observation while observation.ts is unimplemented. Has the
// correct top-level shape so external callers can probe.
function buildPlaceholderObservation(): Observation {
  return {
    turn: getTurn(),
    tickClock: getTickClock(),
    depth: 0,
    floorId: 'unknown',
    roomId: null,
    pausedReason: isHarnessPaused() ? 'harness' : null,
    player: {
      pos: { x: 0, y: 0, z: 0 },
      facingYaw: 0,
      hp: { current: 0, max: 0 },
      buffs: [],
      equipped: {},
    },
    light: { atPlayer: 0, nearbySources: 0 },
    visible: { enemies: [], interactables: [], pickups: [] },
    geometry: {
      walls8: {
        N: Infinity, NE: Infinity, E: Infinity, SE: Infinity,
        S: Infinity, SW: Infinity, W: Infinity, NW: Infinity,
      },
    },
  };
}
