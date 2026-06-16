// DEV-only fixed-step simulation stepper — the pure-sim path.
//
// What this is, and what it is NOT:
//   - src/harness/ drives the FULL (rendered) system pass in REAL-TIME tick
//     budgets — "a bot/operator plays the actual game, frames and all."
//   - THIS drives ONLY the kind:'sim' systems at a FIXED timestep with the
//     renderer untouched — "advance the world by hand, as fast as you like,
//     reproducibly." It is the substrate for headless balance runs,
//     deterministic replay, and a step/freeze/branch debugger.
//
// In-browser today (the prototype): freeze() parks the rAF loop's WORLD
// advance via the existing debug freeze, while render keeps drawing the frozen
// scene. step(n) then pumps n fixed sim ticks by hand. Because only sim
// systems run and their randomness comes from the seeded gameRng stream,
// the same seed + same inputs reproduces the same trace — snap() proves it.
// Headless-in-Node (Three in memory, no canvas, no rAF) is the next slice;
// the sim/present tagging this relies on is what makes that cheap.
//
// Stripped from prod: the whole module is installed behind `import.meta.env.DEV`
// in main.ts, so it dead-code-eliminates and window.__sim can never exist live.

import type { GameSystem, TickContext } from '../engine/loop';
import { runSystems } from '../engine/loop';
import { setWorldFrozen, isWorldFrozen } from './freeze';
import { getGameMode, isPlaying } from '../state/game-mode';
import { seedRng } from '../engine/rng';
import { getPlayerHp } from '../player/health';
import type { Enemy } from '../mobs/enemy';
import type { Intent } from '../harness/intent';
import { NEUTRAL_INTENT, installBus, setIntent } from '../harness/intent';
import { TapeRecorder, tapeFrame, serializeTape, deserializeTape } from '../harness/tape';

// Canonical sim rate. The feel was tuned at 60 Hz; fixing the step here means a
// headless run and a real-time run integrate over identical quanta, so their
// outcomes match. The whole point of fixed-step.
const FIXED_DT = 1 / 60;

export interface SimStepperDeps {
  /** The full ordered system list. The stepper filters to kind:'sim' itself. */
  systems: readonly GameSystem[];
  /** The live level handle, read fresh (it's reassigned on every floor load). */
  getLevel: () => { enemies: Enemy[] } | null | undefined;
  /** The seed the current run started with — stamped into recorded tapes so a
   *  tape carries everything needed to reproduce it. */
  getSeed: () => number;
}

let simSystems: readonly GameSystem[] = [];
let getLevel: SimStepperDeps['getLevel'] = () => null;
let getSeed: SimStepperDeps['getSeed'] = () => 0;
let stepsRun = 0;
// Fixed-step frame counter — the index a tape's intents are keyed by.
let frame = 0;

// One canonical clock. No hit-pause, no bullet-time, no death slow-mo — those
// are wall-clock FEEL layers and mean nothing when we advance by hand. Every dt
// channel carries the same fixed quantum; paused:false so the unpaused sim
// systems actually run.
function fixedCtx(): TickContext {
  return {
    realDt: FIXED_DT,
    scaledDt: FIXED_DT,
    playerDt: FIXED_DT,
    fxDt: FIXED_DT,
    paused: false,
    mode: getGameMode(),
    playing: isPlaying(),
  };
}

/** Fill a partial intent (what a console driver hands back) up to a full one. */
function normalizeIntent(p: Partial<Intent> | null | undefined): Intent {
  return {
    move: p?.move ?? [0, 0],
    look: p?.look ?? [0, 0],
    attack: p?.attack ?? false,
    dodge: p?.dodge ?? null,
  };
}

// The core drive loop: each fixed step pulls this frame's intent from `source`,
// writes it to the bus (drive-by-wire), optionally records it, then advances
// the sim systems. Intent BEFORE systems so input-camera/dash/combat read it
// this frame. This is the one place the clock and the input bus meet.
function driveSteps(
  source: (frame: number) => Intent,
  n: number,
  recorder?: TapeRecorder,
): void {
  const ctx = fixedCtx();
  for (let k = 0; k < n; k++) {
    const intent = source(frame);
    setIntent(intent);
    recorder?.record(intent);
    runSystems(simSystems, ctx);
    frame++;
    stepsRun++;
  }
}

/** Advance `n` fixed steps with NEUTRAL input (world simulates, player idle). */
function step(n = 1): number {
  driveSteps(() => NEUTRAL_INTENT, n);
  return stepsRun;
}

// A deterministic digest of observable sim state. Quantised to 1e-4 so float
// formatting noise can't masquerade as divergence; two identical runs give the
// identical string, a diverged run does not.
function digest(): string {
  const q = (v: number) => Math.round(v * 1e4) / 1e4;
  const parts: string[] = [`hp:${q(getPlayerHp())}`];
  const enemies = getLevel()?.enemies ?? [];
  // Sort by id so list order can't perturb the digest.
  const live = enemies
    .filter((e) => e.alive)
    .slice()
    .sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  parts.push(`mobs:${live.length}`);
  for (const e of live) {
    const p = e.position;
    parts.push(`${e.entityId}@${q(p.x)},${q(p.y)},${q(p.z)}#${q(e.hp)}`);
  }
  return parts.join('|');
}

/** Install window.__sim (DEV only). Returns nothing; the console is the UI. */
export function installSimStepper(deps: SimStepperDeps): void {
  simSystems = deps.systems.filter((s) => s.kind === 'sim');
  getLevel = deps.getLevel;
  getSeed = deps.getSeed;
  // Route control through the drive-by-wire bus so driven/replayed intents
  // reach the sim through the same seam a thumb would.
  installBus();

  const api = {
    /** Names of the sim systems this stepper will run, in order. */
    systems: simSystems.map((s) => s.name),
    /** Park the rAF loop's world advance (render keeps running) so step() owns
     *  the sim clock. Idempotent. */
    freeze() {
      setWorldFrozen(true);
      return `frozen — ${simSystems.length} sim systems under manual step`;
    },
    /** Resume normal real-time play. */
    thaw() {
      setWorldFrozen(false);
      return 'thawed';
    },
    frozen: () => isWorldFrozen(),
    /** Advance n fixed sim steps (default 1). Auto-freezes first so you never
     *  double-advance against the live loop. */
    step(n = 1) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      step(n);
      return digest();
    },
    /** Reseed the gameplay RNG, then report the digest. Pair with a recorded
     *  step count to replay a run from scratch. */
    seed(s: number) {
      seedRng(s >>> 0);
      return `seeded ${s >>> 0}`;
    },
    /** Current deterministic state digest. */
    snap: () => digest(),
    /** Determinism self-test: from the CURRENT digest, seed S and run N steps
     *  twice (reseeding between), and report whether the two traces match.
     *  Note: only sim state is restored by reseed; positions already advanced
     *  are not rewound, so call this right after entering a scenario. */
    proveDeterministic(seedValue = 12345, steps = 120) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      seedRng(seedValue >>> 0);
      step(steps);
      const a = digest();
      seedRng(seedValue >>> 0);
      step(steps);
      const b = digest();
      return { match: a === b, a, b };
    },
    /** Wall-clock how many fixed sim steps/sec this machine can push with no
     *  render — the "how fast can a headless run go" number. */
    bench(steps = 1000) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const t0 = performance.now();
      step(steps);
      const ms = performance.now() - t0;
      const stepsPerSec = Math.round((steps / ms) * 1000);
      return {
        steps,
        ms: Math.round(ms),
        stepsPerSec,
        realtimeMultiple: Math.round(stepsPerSec / 60),
      };
    },

    // ── Drive-by-wire + tape ──────────────────────────────────────────────
    /** Drive `n` fixed steps from a per-frame intent source — a
     *  `(frame) => Partial<Intent>` (missing fields default to neutral). Use to
     *  hand-fly the player; returns the digest. */
    drive(source: (frame: number) => Partial<Intent> | null, n = 60) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      driveSteps((f) => normalizeIntent(source(f)), n);
      return digest();
    },
    /** Record a driven run into a Tape: same source, but every frame's intent
     *  is captured. Returns the serialized tape + final digest. The tape is the
     *  whole run — seed + intents — and replays byte-identically from a fresh
     *  load at the same seed. */
    record(source: (frame: number) => Partial<Intent> | null, n = 150) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const rec = new TapeRecorder(getSeed() >>> 0);
      driveSteps((f) => normalizeIntent(source(f)), n, rec);
      const tape = rec.finish();
      return { tape: serializeTape(tape), frames: tape.frames.length, digest: digest() };
    },
    /** Replay a serialized tape: feed its recorded intents frame-by-frame.
     *  `extra` keeps simulating past the tape's end with neutral input. Run
     *  this from a FRESH load at the tape's seed (?seed=N&simfreeze=1) to
     *  reproduce the recorded run exactly. */
    replay(tapeJson: string, extra = 0) {
      const tape = deserializeTape(tapeJson);
      if (!isWorldFrozen()) setWorldFrozen(true);
      driveSteps((f) => tapeFrame(tape, f) ?? NEUTRAL_INTENT, tape.frames.length + extra);
      return { seed: tape.seed, frames: tape.frames.length, digest: digest() };
    },
  };

  (window as unknown as Record<string, unknown>).__sim = api;
  // eslint-disable-next-line no-console
  console.info(
    `[sim-stepper] window.__sim ready — ${simSystems.length} sim systems. ` +
      `Try: __sim.freeze(); __sim.step(60); __sim.bench(); __sim.proveDeterministic()`,
  );
}
