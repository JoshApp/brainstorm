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
import { captureScreenshot } from './annotate';
import * as bot from './bot';
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
    async screenshot(opts?: { annotated?: boolean }): Promise<Screenshot> {
      const c = tryGetContext();
      if (!c) throw new Error('[harness] not booted');
      return captureScreenshot(c, opts);
    },
    state() {
      return {
        booted: isBooted(),
        turn: getTurn(),
        tickClock: getTickClock(),
        paused: isHarnessPaused(),
      };
    },
    /** Flood-fill the LIVE walkable region from spawn using the player's real
     *  collision radius, and report which stairs a reachable spot can actually
     *  reach. Faithful (sees archway columns, stairwell footprints, every
     *  obstacle the renderer-free rect tests can't) — used by `npm run reach`
     *  to verify a seed isn't soft-locked. */
    reachability(): { ok: boolean; reachableCells: number; stairs: Array<{ x: number; z: number; reachable: boolean; minDist: number }> } {
      const c = tryGetContext();
      const level = c?.getLevel();
      if (!level) return { ok: false, reachableCells: 0, stairs: [] };
      const W = level.walkable;
      const spec = level.spec;
      const R = 0.3;          // player collision radius (controls/camera.ts PLAYER_RADIUS)
      const CELL = 0.25, INTERACT = 1.8;
      const rects = [...spec.rooms.filter((r) => !r.logicalOnly), ...spec.corridors];
      let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
      for (const r of rects) {
        const b = r.rect;
        mnX = Math.min(mnX, b.x - b.w / 2); mxX = Math.max(mxX, b.x + b.w / 2);
        mnZ = Math.min(mnZ, b.z - b.d / 2); mxZ = Math.max(mxZ, b.z + b.d / 2);
      }
      const key = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
      const sp = spec.startPos;
      const seen = new Set<string>([key(sp.x, sp.z)]);
      const q: Array<[number, number]> = [[sp.x, sp.z]];
      while (q.length) {
        const [x, z] = q.pop()!;
        for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]] as const) {
          const nx = x + dx, nz = z + dz;
          if (nx < mnX || nx > mxX || nz < mnZ || nz > mxZ) continue;
          const k = key(nx, nz);
          if (seen.has(k)) continue;
          if (W.contains(nx, nz, R)) { seen.add(k); q.push([nx, nz]); }
        }
      }
      const pts = [...seen].map((s) => s.split(',').map(Number));
      const minDist = (tx: number, tz: number) => {
        let m = Infinity;
        for (const [a, b] of pts) { const d = Math.hypot(a * CELL - tx, b * CELL - tz); if (d < m) m = d; }
        return m;
      };
      const stairs = (spec.stairs ?? []).map((st) => {
        const md = minDist(st.x, st.z);
        return { x: +st.x.toFixed(1), z: +st.z.toFixed(1), reachable: md <= INTERACT, minDist: +md.toFixed(2) };
      });
      return { ok: true, reachableCells: seen.size, stairs };
    },
    pause() { setHarnessPaused(true); },
    resume() { setHarnessPaused(false); },
    updateStatus() { return getUpdateStatus(); },
    async applyUpdate() { await applyUpdate(); },
    bot: {
      step: bot.step,
      async run(opts?: bot.RunOpts) {
        const c = tryGetContext();
        if (!c) throw new Error('[harness] not booted');
        return bot.run(c, opts);
      },
    },
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
