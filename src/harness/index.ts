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
    reachability(opts?: { strict?: boolean }): {
      ok: boolean; reachableCells: number; strictCells: number; openableBarriers: Array<{ x: number; z: number }>;
      unreachedRooms: string[];
      stairs: Array<{ x: number; z: number; reachable: boolean; minDist: number; blockedBy?: string }>;
    } {
      const c = tryGetContext();
      const level = c?.getLevel();
      if (!level) {
        return { ok: false, reachableCells: 0, strictCells: 0, openableBarriers: [], unreachedRooms: [], stairs: [] };
      }
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
      // THE QUESTION THIS ANSWERS IS ABOUT LAYOUT, NOT ABOUT DOORS.
      //
      // A closed door adds a real wall segment, so a naive flood stops dead at
      // every one of them. That is what made this check report unreachable
      // stairs on 5 of 7 sampled floors — it was measuring "where can you walk
      // without opening anything", which is never the question. A player opens
      // doors; an arena gate lifts on room-clear; boss mist lifts when the boss
      // dies. None of them is geometry.
      //
      // So the default flood ignores barriers tagged `openable` (see
      // WallSegment), and the STRICT flood — which does not — is reported
      // alongside it. The difference is exactly "how much of this floor is
      // behind something that opens", which is worth knowing and was previously
      // indistinguishable from a soft-lock.
      const flood = (ignoreOpenable: boolean): Set<string> => {
        const seen = new Set<string>([key(sp.x, sp.z)]);
        const q: Array<[number, number]> = [[sp.x, sp.z]];
        while (q.length) {
          const [x, z] = q.pop()!;
          for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]] as const) {
            const nx = x + dx, nz = z + dz;
            if (nx < mnX || nx > mxX || nz < mnZ || nz > mxZ) continue;
            const k = key(nx, nz);
            if (seen.has(k)) continue;
            if (W.contains(nx, nz, R, { ignoreOpenable })) { seen.add(k); q.push([nx, nz]); }
          }
        }
        return seen;
      };
      const strictSeen = flood(false);
      const seen = opts?.strict ? strictSeen : flood(true);
      // Report WHERE they are, not just how many. "1 barrier" was enough to
      // explain the false alarm but not enough to say which producer put it
      // there, and I spent three runs bisecting producers by hand to find out.
      const barriers = W.listWalls().filter((w) => w.openable).map((w) => ({
        x: +((w.ax + w.bx) / 2).toFixed(1), z: +((w.az + w.bz) / 2).toFixed(1),
      }));
      const pts = [...seen].map((s) => s.split(',').map(Number));
      const minDist = (tx: number, tz: number) => {
        let m = Infinity;
        for (const [a, b] of pts) { const d = Math.hypot(a * CELL - tx, b * CELL - tz); if (d < m) m = d; }
        return m;
      };
      // Which rooms the flood never entered. An unreachable stair with a named
      // room beside it is a lead; a bare distance is a puzzle.
      const unreachedRooms: string[] = [];
      for (const r of rects) {
        const b = r.rect;
        const hit = pts.some(([a, c]) =>
          Math.abs(a * CELL - b.x) <= b.w / 2 && Math.abs(c * CELL - b.z) <= b.d / 2);
        if (!hit) unreachedRooms.push(r.id);
      }
      const stairs = (spec.stairs ?? []).map((st) => {
        const md = minDist(st.x, st.z);
        const reachable = md <= INTERACT;
        // If even the permissive flood can't get there, say what kind of thing
        // sits nearest the stair — the difference between "sealed by geometry"
        // and "we still can't model this" is the whole value of the report.
        let blockedBy: string | undefined;
        if (!reachable) {
          const room = rects.find((r) =>
            Math.abs(st.x - r.rect.x) <= r.rect.w / 2 && Math.abs(st.z - r.rect.z) <= r.rect.d / 2);
          blockedBy = room ? `room ${room.id} never entered` : 'stair is outside every room rect';
        }
        return { x: +st.x.toFixed(1), z: +st.z.toFixed(1), reachable, minDist: +md.toFixed(2), blockedBy };
      });
      return {
        ok: true,
        reachableCells: seen.size,
        strictCells: strictSeen.size,
        openableBarriers: barriers,
        unreachedRooms,
        stairs,
      };
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
      lookRadiansPerUnit: 0,
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
