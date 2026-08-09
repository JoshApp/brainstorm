import * as THREE from 'three';
import { getSettings } from '../settings/settings';
import { runSystems, type GameSystem, type TickContext } from './loop';
import {
  interpStepBegin, interpStepEnd, interpApply, interpRestore,
  setRenderInterpEnabled, setInterpPositionOnly,
} from './render-interp';
import { advanceGameClock, setDeterministicClock } from './game-clock';
import { isWorldPaused, shouldFreezeGameClock } from '../world-paused';
import { getGameMode, isPlaying } from '../state/game-mode';
import { getTimeScale, tickDeath } from '../player/death';
import { tickBulletTime, getWorldTimeScale } from '../combat/reactive-defense';
import { tickBossSlowmo, getBossSlowmoTimeScale } from '../combat/boss-slowmo';
import { tickStillness, getStillnessTimeScale } from '../combat/rite-stillness';
import { tickFinisher, finisherWorldTimeScale } from '../combat/finisher';
import { tickPlayerAction } from '../combat/player-action';
import { tickArrival } from '../player/arrival';
import { tickChasmPresence } from '../effects/chasm-presence';
import { tickEmbersGPU } from '../effects/embers-gpu';
import { tickLampSpot } from '../player/lamp-spot';
import { tickPendingLoad } from '../level/loader';
import { pacerShouldDraw, pacerEffectiveFps } from '../scene/frame-pacer';
import { isContextLost } from '../scene/context-recovery';
import { isLoading } from '../scene/loading-gate';
import { tickAdaptiveResolution, feedAdaptiveGpuMs } from '../scene/adaptive-resolution';
import { lastWebGPUGpuMs } from '../style/render-webgpu';
import { frameBegin, frameEnd } from '../debug/frame-timing';
import { tickCompileWatch } from '../debug/webgpu-compile-guard';
import { tickPerfProbe } from '../debug/perf-probe';
import { tickNavOverlay } from '../debug/nav-overlay';
import { tickMobAiReadout, mobAiReadoutEnabled } from '../debug/mob-ai-readout';
import { tickAiGizmos } from '../debug/ai-gizmos';
import { tickCombatDebug } from '../combat/combat-debug';
import { tickGoreDebug } from '../debug/gore-debug';
import { tickChargeRing } from '../ui/charge-ring';
import { tickRiteButton } from '../controls/rite-button';
import { tickPerfOverlay, reportRendererInfo } from '../ui/perf-overlay';
import { captureError, buildReport } from '../telemetry/telemetry';
import { showCrashOverlay } from '../ui/crash-overlay';
import { peekActiveTape } from '../harness/run-recorder';
import { bootSucceeded } from '../boot-guard';
import type { DelveRenderer } from '../scene/create-renderer';
import type { LiveLevel } from '../level/builder';
import type { Enemy } from '../mobs/enemy';

// The frame loop — cadence (frame-rate cap), the fixed-step sim / present
// split, render interpolation, and the fatal-error guard. Extracted from
// main.ts (async-boot phase 2) so the loop is one concern in one file; main
// wires the world objects in through FrameLoopDeps and calls startFrameLoop().
//
// LOOP SHAPE. Fixed-step is the DEFAULT: a 60Hz deterministic sim, decoupled
// from the draw rate (which the FRAME RATE cap matches to it). This makes
// gameplay frame-rate-independent + fair across devices, and — critically —
// records a replay tape for EVERY run (the leaderboard verifier needs it).
// Render interpolation draws a pose lerped between the two most-recent sim
// snapshots so the 60Hz sim doesn't beat against the display clock (see
// engine/render-interp.ts). Escape hatches, A/B-able on the phone:
//   ?varstep=1   — the legacy variable-dt interleaved loop
//   ?nointerp=1  — fixed-step, draw the raw latest sim pose
const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 6; // realDt is capped at 0.1s, so ≤6 fixed steps/frame

export interface FrameLoopDeps {
  renderer: DelveRenderer;
  camera: THREE.PerspectiveCamera;
  weapon: {
    group: THREE.Object3D;
  };
  input: { lookDx: number; lookDy: number };
  systems: GameSystem[];
  getLevel: () => (LiveLevel & { checkRoomClear?: () => void }) | null;
  /** Build/tear-down the room culler to match the active level + setting. */
  syncRoomCuller: () => void;
  /** Lazily-assigned harness tick (null when ?harness is off). */
  getHarnessTick: () => ((realDt: number, worldRunning: boolean) => void) | null;
  /** True when the lamp spot-shadow split (?lampspot=1) is active. */
  lampSpotEnabled: boolean;
}

// SIM TURBO (DEV only): fast-forward the world by running N× the fixed steps
// per frame — for headless/bot testing where waiting real-time through a boss
// fight is the bottleneck. CPU-bound (N× the sim work per frame), so the real
// speedup is min(N, whatever the frame can sustain). Strips from prod (DEV
// gate at the read sites). Set via ?turbo=N at boot or window.__turbo(N) live.
let simTurbo = 1;
if (import.meta.env.DEV) {
  const t = Number(new URLSearchParams(location.search).get('turbo'));
  if (Number.isFinite(t) && t >= 1) simTurbo = Math.min(8, Math.floor(t));
}
/** DEV fast-forward — clamped 1..8. Returns the applied value. */
export function setSimTurbo(n: number): number {
  simTurbo = Math.max(1, Math.min(8, Math.floor(n) || 1));
  return simTurbo;
}

const USE_FIXED_STEP =
  new URLSearchParams(location.search).get('varstep') !== '1';
const USE_INTERP =
  USE_FIXED_STEP && new URLSearchParams(location.search).get('nointerp') !== '1';

/** True when the deterministic fixed-step loop is active (default). The run
 *  recorder only tapes fixed-step runs — a variable-dt tape can't replay. */
export function isFixedStepLoop(): boolean {
  return USE_FIXED_STEP;
}

let deps: FrameLoopDeps = null as unknown as FrameLoopDeps;
let SIM_SYSTEMS: GameSystem[] = [];
let PRESENT_SYSTEMS: GameSystem[] = [];

const clock = new THREE.Timer();   // THREE.Clock is deprecated; Timer.update()+getDelta() each frame
let simAccumulator = 0;

// Reused scratch for the interpolation target list (camera + weapon + live
// enemies), refilled in place each step so the loop never allocates.
const interpTargets: THREE.Object3D[] = [];
function fillInterpTargets(): void {
  interpTargets.length = 0;
  interpTargets.push(deps.camera);
  // First-person weapon: its swing + held pose live on the root group, authored
  // ABSOLUTELY each fixed sim step ('weapon' is kind:'sim'), so on a non-60Hz
  // display the swing samples in 1/60 jumps and judders against the camera. The
  // group is camera-local, so interp lerps its local pose — bringing the sword
  // in line with the lamp/offhand viewmodels (those tick at present-rate and are
  // already smooth). The arm IK under it is solved from this pose and rides
  // along rigidly; its sub-pose is ≤1 step stale during a fast swing, masked by
  // the swing speed. weapon.update sets the group absolutely, so the lerped draw
  // pose can never feed back into the sim — no drift even before interpRestore.
  interpTargets.push(deps.weapon.group);
  const enemies = deps.getLevel()?.enemies;
  if (enemies) {
    for (const e of enemies) {
      if (e.alive || e.dying) { interpTargets.push(e.group); setInterpPositionOnly(e.group, true); }
    }
  }
}

// ── THE CLOCKS ───────────────────────────────────────────────────────────────
//
// TWO clocks and a third for ambience, composed HERE and nowhere else.
//
//   base  = hit-pause × death slow-mo × boss-death slow-mo. These freeze
//           EVERYONE, player included — the world stops, and so do you.
//   world = perfect-dodge bullet-time × the rite's held stillness × the
//           finisher hush. These slow only the WORLD (enemies, projectiles,
//           ambient FX) while the player keeps acting at full speed. That
//           asymmetry IS the payoff for a dodge, a rite, or an execution.
//
//   scaledDt = base × world   → the world
//   playerDt = base           → camera / movement / attack
//   fxDt     = world          → dust and motes, which should hang with the
//                               world during a dip but never stutter on a
//                               hit-pause (base is deliberately absent)
//
// Three call sites needed this identical expression (fixed-step sim, present
// pass, legacy variable path), which is three places for a new contributor to
// be added to only two of. One function instead.
function tickTimeScales(realDt: number): void {
  // All advanced in REAL time, so no dip is ever slowed by its own dilation.
  tickDeath(realDt);
  tickBulletTime(realDt);
  tickBossSlowmo(realDt);
  tickStillness(realDt);
  tickFinisher(realDt);
}

interface Clocks { scaledDt: number; playerDt: number; fxDt: number }

function composeClocks(dt: number): Clocks {
  const base = getTimeScale() * getBossSlowmoTimeScale();
  const world = getWorldTimeScale() * getStillnessTimeScale() * finisherWorldTimeScale();
  return { scaledDt: dt * base * world, playerDt: dt * base, fxDt: dt * world };
}

/** Advance the SIM by one fixed step: the time-scale drivers + player FSM +
 *  sim systems, all on the fixed clock (so the world is deterministic). */
function advanceSimStep(dt: number): void {
  // Advance the deterministic game clock by the real-time quantum — so the
  // time-based gameplay timers (skill windows, hit-pause/bullet-time durations)
  // that read gameNow() are reproducible. Advances during hit-pause so the
  // freeze ends, but FREEZES during a menu / harness / debug pause: otherwise a
  // pause burns in-flight skill windows and leaks real wall-clock time into the
  // recorded tape, breaking replay determinism for any run that opened a menu.
  if (!shouldFreezeGameClock()) advanceGameClock(dt);
  // Time-scale drivers on the FIXED clock (deterministic hit-pause / bullet-
  // time / death slow-mo / finisher hush), then the same clock split every
  // other path uses.
  tickTimeScales(dt);
  const { scaledDt, playerDt, fxDt } = composeClocks(dt);
  if (!isWorldPaused()) tickPlayerAction(playerDt);
  const paused = isWorldPaused();
  if (paused) { deps.input.lookDx = 0; deps.input.lookDy = 0; }
  runSystems(SIM_SYSTEMS, {
    realDt: dt, scaledDt, playerDt, fxDt, paused,
    mode: getGameMode(), playing: isPlaying(),
  });
}

/** Run the PRESENT (render/HUD/VFX/camera) systems once per frame, with the
 *  real frame dt + the live time-scales — so visuals stay smooth and VFX
 *  slow-mo (which rides scaledDt) reads exactly as it does today. */
function presentPass(realDt: number): void {
  if (import.meta.env.DEV) tickNavOverlay();   // DEV nav-grid overlay (strips in prod)
  tickArrival(deps.camera, realDt);
  if (!isWorldPaused()) tickChasmPresence(deps.camera, realDt);
  runSystems(PRESENT_SYSTEMS, {
    realDt,
    ...composeClocks(realDt),
    paused: isWorldPaused(),
    mode: getGameMode(),
    playing: isPlaying(),
  });
}

function tickInner() {
  // FRAME RATE cap: skip DRAWING this frame if we're ahead of the chosen fps.
  // A drift-free time accumulator (scene/frame-pacer.ts) — never above the cap,
  // jitter-immune (no creep down to 55), even on any panel, graceful under load.
  // The sim isn't lost on a skip — clock.getDelta() accumulates the skipped time,
  // so the next drawn frame advances the sim by the full elapsed time.
  const frameCap = Number(getSettings().frameCap);
  if (!pacerShouldDraw(frameCap, performance.now())) { requestAnimationFrame(tick); return; }
  // Apply any pending level swap BEFORE any per-frame reads on the level.
  // Stairs interactables call loadLevel() during the previous frame's
  // interactables tick; the swap lands here at the top of the next frame.
  tickPendingLoad();
  // Build/tear-down the room culler to match the active level + setting.
  deps.syncRoomCuller();

  clock.update();   // Timer computes its delta at update(); getDelta() then returns this frame's
  const realDt = Math.min(clock.getDelta(), 0.1);
  // Harness: drain any in-flight tick budget and advance game-time clock.
  // Cheap when off. Called BEFORE the pause snapshot below so a budget that
  // ends this frame re-pauses the world for the same frame's update gate.
  deps.getHarnessTick()?.(realDt, !isWorldPaused());

  // Advance the GPU compute embers once per drawn frame, BEFORE either render
  // path (fixed-step presentPass or variable runSystems) reads the buffer.
  tickEmbersGPU();
  if (deps.lampSpotEnabled) tickLampSpot(deps.camera);   // place + aim the lamp's shadow spotlight

  if (USE_FIXED_STEP) {
    // FIXED-STEP path: advance the SIM in fixed 1/60s quanta (count =
    // accumulated wall-clock), then PRESENT once.
    // Restore last frame's authoritative camera pose HERE (frame start), not right after present. The
    // drawn pose carries the screen-shake offset, and on WebGPU the render completes async — the pose is
    // read after present returns. Restoring right after present wiped the shake (and the interp pose)
    // before that deferred read, so neither rendered. Restoring at the NEXT frame's start lets the drawn
    // pose + shake survive the async render, while still being clean before this frame's sim integrates.
    if (USE_INTERP) interpRestore(interpTargets);
    simAccumulator += realDt * simTurbo;   // DEV fast-forward (default ×1)
    let steps = 0;
    while (simAccumulator >= FIXED_DT && steps < MAX_SUBSTEPS * simTurbo) {
      if (USE_INTERP) { fillInterpTargets(); interpStepBegin(interpTargets); }
      advanceSimStep(FIXED_DT);
      if (USE_INTERP) { fillInterpTargets(); interpStepEnd(interpTargets); }
      simAccumulator -= FIXED_DT;
      steps++;
    }
    if (simAccumulator > FIXED_DT) simAccumulator = FIXED_DT; // drop the backlog
    // Interpolate the drawn pose between the last two sim snapshots by the
    // leftover fraction; on a 0-step frame this still advances the view toward
    // `curr` instead of freezing (the judder fix). Restored at the NEXT frame's
    // start so the sim integrates from authoritative state, not the draw pose.
    if (USE_INTERP) { fillInterpTargets(); interpApply(simAccumulator / FIXED_DT, interpTargets); }
    frameBegin();
    presentPass(realDt);
    frameEnd();
  } else {
    // VARIABLE-dt path (?varstep=1) — the legacy interleaved pass, unchanged.
    tickArrival(deps.camera, realDt);
    tickTimeScales(realDt);
    const { scaledDt, playerDt, fxDt } = composeClocks(realDt);
    // Advance the player-action FSM on the PLAYER clock, BEFORE input is
    // processed below, so a committed dodge/parry that expires this frame frees
    // the next action immediately.
    if (!isWorldPaused()) tickPlayerAction(playerDt);
    // Snapshot pause state AFTER the harness so a just-ended budget gates this
    // frame's unpaused systems.
    const paused = isWorldPaused();

    // The deep breathes only while the world runs — a pause menu full of
    // chasm whispers would give the trick away.
    if (!paused) tickChasmPresence(deps.camera, realDt);

    // While paused, drain look input so it doesn't snap when we unfreeze.
    // (The input-camera system is gated off by the pause, so it won't.)
    if (paused) {
      deps.input.lookDx = 0;
      deps.input.lookDy = 0;
    }

    const ctx: TickContext = {
      realDt,
      scaledDt,
      playerDt,
      fxDt,
      paused,
      mode: getGameMode(),
      playing: isPlaying(),
    };
    // Profiling brackets the system pass: begin opens the GPU timer + marks the
    // CPU start, end closes them and fans the frame sample out to the HUD +
    // recorder. Both early-return immediately unless something is listening (HUD
    // visible, recording, or marks on), so this is free for players who never
    // enable the PROFILER TOOLS setting — just two no-op calls per frame.
    frameBegin();
    runSystems(deps.systems, ctx);
    frameEnd();
  }

  // Charge-ring HUD — early-outs on no-progress so it's free when no
  // hold is in flight. Always ticked; the visual itself opts in.
  tickChargeRing();
  tickRiteButton();

  // Perf overlay (toggle in Settings → PERF METER). Internally early-
  // outs when hidden so it's free when off. reportRendererInfo reads
  // renderer.info AFTER the render system has run this frame, so the
  // tris/draws numbers reflect what was actually drawn.
  reportRendererInfo(deps.renderer);
  tickPerfOverlay(performance.now());
  // DEV mob-AI readout (?aidebug=1) — feed the NEAREST live mob to the jitter
  // diagnostic. Whole block DCEs in prod (import.meta.env.DEV → false).
  if (import.meta.env.DEV && mobAiReadoutEnabled()) {
    const es = deps.getLevel()?.enemies;
    let near: Enemy | null = null;
    let nearD = Infinity;
    if (es) for (const e of es) {
      if (!e.alive) continue;
      const dx = e.position.x - deps.camera.position.x, dz = e.position.z - deps.camera.position.z;
      const dd = dx * dx + dz * dz;
      if (dd < nearD) { nearD = dd; near = e; }
    }
    tickMobAiReadout(near, Math.sqrt(nearD), performance.now());
  }
  if (import.meta.env.DEV) tickAiGizmos(deps.getLevel()?.enemies);   // in-world facing gizmos (self-gates)
  // Adaptive resolution — self-gates (no-op unless enabled on a real phone). The
  // rAF interval can't see GPU load (skip-pacing pins it to vsync), so feed the
  // real GPU-timestamp ms.
  tickAdaptiveResolution(performance.now(), 1000 / pacerEffectiveFps(frameCap));
  feedAdaptiveGpuMs(lastWebGPUGpuMs());
  tickCombatDebug(realDt, deps.getLevel()?.enemies ?? []);
  tickGoreDebug();
  // Programmatic perf probe (window.__perf for the headless perf runner).
  // DEV-only — the literal-false guard dead-code-eliminates it from prod
  // (and tickPerfProbe is itself a no-op in prod, belt-and-suspenders).
  if (import.meta.env.DEV) tickPerfProbe(performance.now());

  // DEV: flash a banner on any in-play pipeline compile (a warm gap) or lag frame, so
  // hitches are impossible to miss as content is added. No-op in prod.
  tickCompileWatch();

  // First fully-rendered frame proves boot is good — clear the boot-loop flag.
  if (!bootConfirmed) { bootConfirmed = true; bootSucceeded(); }

  requestAnimationFrame(tick);
}

// DEV loop-health probe: window.__loopStats() → ticks/s + how many parallel
// rAF chains are driving the loop (must be 1 — a duplicated chain doubles CPU
// work, fights the in-flight cap, and inflates every rAF-counting fps meter).
let tickCount = 0;
let chainPeak = 0;
let lastStampTicks = 0;
let lastStamp = -1;
if (import.meta.env.DEV) {
  let windowStart = performance.now();
  (window as unknown as Record<string, unknown>).__loopStats = () => {
    const now = performance.now();
    const secs = (now - windowStart) / 1000;
    const out = { ticksPerSec: Math.round(tickCount / Math.max(0.001, secs)), parallelChains: chainPeak };
    tickCount = 0; chainPeak = 0; windowStart = now;
    return out;
  };
}

let bootConfirmed = false;
// Fatal-error guard around the loop. If a frame throws, the loop would otherwise
// die silently into a frozen screen. Catch it: capture (with the repro tape +
// context), show the in-character crash overlay, and stop rescheduling — one
// fault, handled, with a report path, instead of a black void.
let fatalHandled = false;
function tick(rafTs?: number) {
  if (import.meta.env.DEV) {
    tickCount++;
    // Chain detection: parallel loop chains fire within ONE vsync slot, so
    // they share the rAF callback timestamp.
    if (rafTs !== undefined) {
      if (rafTs === lastStamp) lastStampTicks++;
      else { lastStamp = rafTs; lastStampTicks = 1; }
      if (lastStampTicks > chainPeak) chainPeak = lastStampTicks;
    }
  }
  // While the GPU context is lost, idle the loop (no sim, no render — rendering
  // would throw) until recovery clears the flag.
  if (isContextLost()) { requestAnimationFrame(tick); return; }
  // While the first-floor warmup owns the frame, SKIP the whole game frame — no
  // sim, no audio, no render. Otherwise the warmup's rAF yields let the game loop
  // run underneath: it ticked the sim (sound/activity before the player could act)
  // and rendered the warmup's roster subjects (artifacts). Only the warmup + the
  // DOM loading cover run; the game resumes the instant warmup tears down.
  if (isLoading()) { requestAnimationFrame(tick); return; }
  try {
    tickInner();
  } catch (err) {
    if (fatalHandled) return;
    fatalHandled = true;
    const e = err instanceof Error ? err : new Error(String(err));
    if (import.meta.env.DEV) console.error('[fatal] game loop threw:', e);
    let repro: unknown = null;
    try { repro = peekActiveTape(); } catch { /* recorder unavailable */ }
    captureError(e, true, repro); // routes to Sentry (with the tape attached) or the beacon
    showCrashOverlay(buildReport(e, { repro }), e.message);
  }
}

/** Wire the loop's world objects. Call once at boot, before startFrameLoop. */
export function initFrameLoop(d: FrameLoopDeps): void {
  deps = d;
  SIM_SYSTEMS = d.systems.filter((s) => s.kind === 'sim');
  PRESENT_SYSTEMS = d.systems.filter((s) => s.kind !== 'sim');
  setRenderInterpEnabled(USE_INTERP);
  // In fixed-step, run the game clock deterministically (gameNow() = accumulated
  // sim time). In default play it stays on performance.now() — feel unchanged.
  setDeterministicClock(USE_FIXED_STEP);
}

/** Kick the rAF loop. IDEMPOTENT — startRun() calls this on every run start
 *  (title vignette, DESCEND, CONTINUE, test chambers), and each unguarded call
 *  used to fork a PARALLEL rAF chain: doubled CPU work, chains fighting the
 *  render backpressure into an erratic present cadence (4↔67ms measured), and
 *  every rAF-counting fps meter reading 2× the refresh rate. One loop, ever. */
let loopStarted = false;
export function startFrameLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  tick();
}
