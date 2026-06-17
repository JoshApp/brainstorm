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
import { setDeterministicClock, advanceGameClock } from '../engine/game-clock';
import { getPlayerHp } from '../player/health';
import type * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import type { Observation } from '../harness/types';
import { buildObservation } from '../harness/observation';
import { decideIntent, probeIntent } from '../harness/pilot';
import type { Intent } from '../harness/intent';
import { NEUTRAL_INTENT, installBus, setIntent } from '../harness/intent';
import { TapeRecorder, tapeFrame, serializeTape, deserializeTape } from '../harness/tape';
import { startRecording, stopRecording, recordedSteps, peekLastRunTape } from '../harness/run-recorder';

// Canonical sim rate. The feel was tuned at 60 Hz; fixing the step here means a
// headless run and a real-time run integrate over identical quanta, so their
// outcomes match. The whole point of fixed-step.
const FIXED_DT = 1 / 60;

/** One row of the bot's feed — what it saw + chose at frame `f`. */
interface BotFrame {
  f: number;
  mobs: number;
  hp: number;
  /** Nearest live enemy distance (m), or null if none visible. */
  near: number | null;
  atk: boolean;
}

export interface SimStepperDeps {
  /** The full ordered system list. The stepper filters to kind:'sim' itself. */
  systems: readonly GameSystem[];
  /** The live level handle, read fresh (it's reassigned on every floor load). */
  getLevel: () => LiveLevel | null | undefined;
  /** The player camera — doubles as the player transform; observations read it. */
  getCamera: () => THREE.PerspectiveCamera;
  /** The seed the current run started with — stamped into recorded tapes so a
   *  tape carries everything needed to reproduce it. */
  getSeed: () => number;
  /** Probe of the player's swing state machine — for diagnosing whether a
   *  swing's strike window opens under the headless clock. */
  getSwing: () => SwingProbe;
}

/** Snapshot of the swing state machine, read each frame by the diagnostic. */
export interface SwingProbe {
  phase: string;
  striking: boolean;
  swinging: boolean;
}

let simSystems: readonly GameSystem[] = [];
let getLevel: SimStepperDeps['getLevel'] = () => null;
let getCamera: SimStepperDeps['getCamera'] = () => null as unknown as THREE.PerspectiveCamera;
let getSeed: SimStepperDeps['getSeed'] = () => 0;
let getSwing: SimStepperDeps['getSwing'] = () => ({ phase: 'idle', striking: false, swinging: false });
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
  onStep?: (frame: number) => void,
): void {
  // Drives are deterministic-clock contexts: gameNow() must be the accumulated
  // sim clock (not wall-clock) or the time-based timers (hit-pause, dodge
  // windows) would make replays diverge. The world is frozen here, so flipping
  // the global clock is safe.
  setDeterministicClock(true);
  const ctx = fixedCtx();
  for (let k = 0; k < n; k++) {
    const intent = source(frame);
    setIntent(intent);
    recorder?.record(intent);
    advanceGameClock(FIXED_DT); // advance the game clock per fixed step
    runSystems(simSystems, ctx);
    onStep?.(frame);
    frame++;
    stepsRun++;
  }
}

/** Replay a tape capturing the digest at EVERY frame — the run's full
 *  trajectory. One-shot from spawn (call right after a fresh ?simfreeze load).
 *  trajectory[i] = world digest after frame i. */
function traceReplay(tape: ReturnType<typeof deserializeTape>): string[] {
  const trajectory: string[] = [];
  driveSteps(
    (f) => tapeFrame(tape, f) ?? NEUTRAL_INTENT,
    tape.frames.length,
    undefined,
    () => trajectory.push(digest()),
  );
  return trajectory;
}

/** First frame at which two trajectories disagree (or null if identical up to
 *  the shorter one's length). The divergence finder: where did two runs split? */
function firstDivergence(
  a: string[],
  b: string[],
): { frame: number; a: string; b: string } | null {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { frame: i, a: a[i], b: b[i] };
  }
  if (a.length !== b.length) {
    return { frame: n, a: a[n] ?? '<end>', b: b[n] ?? '<end>' };
  }
  return null;
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

// Structured read of the current world — the bot's and the operator's eyes.
// Reuses the harness observation builder; works on the frozen world because it
// only READS sim/scene state (entities, raycasts, light slots).
function observe(): Observation {
  const level = getLevel();
  if (!level) throw new Error('[sim] no level to observe');
  return buildObservation(getCamera(), level as LiveLevel);
}

/** Install window.__sim (DEV only). Returns nothing; the console is the UI. */
export function installSimStepper(deps: SimStepperDeps): void {
  simSystems = deps.systems.filter((s) => s.kind === 'sim');
  getLevel = deps.getLevel;
  getCamera = deps.getCamera;
  getSeed = deps.getSeed;
  getSwing = deps.getSwing;
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
      // Restore the clock to whatever live play uses (deterministic only when
      // the page is ?fixedstep=1) so resumed live play isn't left on a stuck
      // accumulated clock.
      setDeterministicClock(new URLSearchParams(location.search).get('fixedstep') === '1');
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
    /** DEBUG: raw full-precision enemy positions (parity diagnostics). */
    rawEnemies: () => (getLevel()?.enemies ?? []).filter((e) => e.alive).map((e) => ({
      kind: e.kind, x: e.position.x, z: e.position.z, hp: e.hp,
    })),
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

    // ── Live run recorder (validation prereq) ─────────────────────────────
    /** Start the live run recorder (captures the per-step intent the SIM
     *  resolves, via the input-camera hook — allocation-free). */
    recStart(seed = getSeed()) {
      startRecording(seed >>> 0);
      return `recording from seed ${seed >>> 0}`;
    },
    /** Stop recording; returns the captured tape (serialized) + step count. */
    recStop() {
      const tape = stopRecording();
      return { tape: tape ? serializeTape(tape) : null, frames: tape?.frames.length ?? 0 };
    },
    recSteps: () => recordedSteps(),
    /** The last COMPLETED run's tape (held after death), serialized — what the
     *  leaderboard would submit for server replay-verification. */
    lastRunTape() {
      const t = peekLastRunTape();
      return t ? serializeTape(t) : null;
    },

    // ── Observe + autonomous bot ──────────────────────────────────────────
    /** Structured read of the world right now (the bot's eyes). */
    observe: () => observe(),
    /** Run the built-in reactive pilot autonomously for `n` fixed steps,
     *  recording a tape AND a per-frame transcript (the bot's "feed": what it
     *  saw + what it chose each frame). Each step: observe → decideIntent →
     *  drive → record. The headless autonomous loop — a bot playing with no
     *  renderer, deterministically, emitting a replayable run + an inspectable
     *  trace of why it did what it did. */
    runBot(n = 300) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const rec = new TapeRecorder(getSeed() >>> 0, 'bot');
      const transcript: BotFrame[] = [];
      driveSteps((f) => {
        const obs = observe();              // state at the START of frame f
        const intent = decideIntent(obs);
        const live = obs.visible.enemies.filter((e) => e.hp.current > 0);
        let near = Infinity;
        for (const e of live) if (e.distance < near) near = e.distance;
        transcript.push({
          f,
          mobs: live.length,
          hp: obs.player.hp.current,
          near: near === Infinity ? null : Math.round(near * 100) / 100,
          atk: intent.attack,
        });
        return intent;
      }, n, rec);
      const tape = rec.finish();
      // Inline SUMMARY so the console isn't flooded; full transcript also returned.
      const hps = transcript.map((t) => t.hp);
      const summary = {
        attacks: transcript.filter((t) => t.atk).length,
        minHp: hps.length ? Math.min(...hps) : null,
        startMobs: transcript[0]?.mobs ?? null,
        endMobs: transcript.at(-1)?.mobs ?? null,
        nearestStart: transcript[0]?.near ?? null,
        nearestEnd: transcript.at(-1)?.near ?? null,
      };
      return { tape: serializeTape(tape), frames: tape.frames.length, digest: digest(), summary, transcript };
    },

    // ── Enemy threat probe (combat balance) ───────────────────────────────
    /** Stand a PASSIVE punching-bag player in front of the spawned enemies and
     *  measure RAW enemy offense: how fast they kill an undefended player.
     *  Returns time-to-kill + effective DPS. The bot never attacks/dodges, so
     *  this isolates ENEMY threat from player skill — the unit a balance sweep
     *  aggregates across seeds + enemy types. */
    threatProbe(n = 2400) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const obs0 = observe();
      const maxHp = obs0.player.hp.max;
      let deathFrame: number | null = null;
      let endHp = maxHp;
      driveSteps((f) => {
        const obs = observe();
        endHp = obs.player.hp.current;
        if (deathFrame === null && endHp <= 0) deathFrame = f;
        return probeIntent(obs);
      }, n);
      const sec = (frames: number) => Math.round((frames / 60) * 100) / 100;
      const died = deathFrame !== null;
      // DPS: if killed, maxHp over time-to-kill; else damage taken over the window.
      const dps = died
        ? Math.round((maxHp / (deathFrame! / 60)) * 100) / 100
        : Math.round(((maxHp - endHp) / (n / 60)) * 100) / 100;
      return {
        died,
        ttkSec: died ? sec(deathFrame!) : null,
        ttkFrames: deathFrame,
        dps,
        maxHp,
        endHp,
        windowSec: sec(n),
      };
    },

    /** Run the FIGHTING pilot vs the spawned enemies and report the OUTCOME:
     *  did the player win (clear the room) or die, how long it took, and how
     *  much HP it cost. The player-side counterpart to threatProbe — the unit a
     *  win-rate / player-TTK sweep aggregates across seeds + enemy types. */
    duel(n = 1800) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const maxHp = observe().player.hp.max;
      let clearF: number | null = null;
      let deathF: number | null = null;
      let endHp = maxHp;
      driveSteps((f) => {
        const obs = observe();
        endHp = obs.player.hp.current;
        const live = obs.visible.enemies.filter((e) => e.hp.current > 0).length;
        if (clearF === null && live === 0) clearF = f;
        if (deathF === null && endHp <= 0) deathF = f;
        return decideIntent(obs);
      }, n);
      const won = clearF !== null && (deathF === null || clearF <= deathF);
      const sec = (fr: number | null) => (fr == null ? null : Math.round((fr / 60) * 10) / 10);
      return {
        won,
        died: deathF !== null && !won,
        clearSec: won ? sec(clearF) : null,
        hpLost: Math.round((maxHp - Math.max(0, endHp)) * 10) / 10,
        maxHp,
      };
    },

    // ── Trace + divergence (dig into runs, verify tapes) ──────────────────
    /** DIAGNOSTIC: drive a sustained forward+attack and record the swing state
     *  machine each frame — phase / striking / swinging / inCone — plus the
     *  nearest enemy's hp. Answers "does the strike window open headless, and
     *  does the cone catch the target?" without guessing. */
    swingTrace(n = 90) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const rows: Array<SwingProbe & { f: number; near: number | null; bearing: number | null; yaw: number; inCone: boolean; ehp: number | null }> = [];
      driveSteps((f) => {
        const obs = observe();
        const live = obs.visible.enemies.filter((e) => e.hp.current > 0);
        let nearest = live[0];
        for (const e of live) if (!nearest || e.distance < nearest.distance) nearest = e;
        rows.push({
          f,
          ...getSwing(),
          near: nearest ? Math.round(nearest.distance * 100) / 100 : null,
          bearing: nearest ? Math.round(nearest.bearing * 100) / 100 : null,
          yaw: Math.round(obs.player.facingYaw * 100) / 100,
          inCone: nearest?.inCone ?? false,
          ehp: nearest?.hp.current ?? null,
        });
        // Face the nearest enemy (pilot logic) and force a swing every frame.
        return { ...decideIntent(obs), attack: true };
      }, n);
      // The key question: does striking EVER coincide with a target in the cone?
      return {
        everStruck: rows.some((r) => r.striking),
        everSwinging: rows.some((r) => r.swinging),
        strikeWithTargetInCone: rows.some((r) => r.striking && r.inCone),
        phasesSeen: [...new Set(rows.map((r) => r.phase))],
        ehpStart: rows[0]?.ehp ?? null,
        ehpEnd: rows.at(-1)?.ehp ?? null,
        sample: rows.filter((r) => r.f % 6 === 0),
      };
    },
    /** DIAGNOSTIC: run the REAL pilot and report every STRIKE — its bearing,
     *  distance, inCone, and whether the enemy actually lost HP. Answers "why do
     *  the bot's swings whiff?" with the ground truth (a strike in cone + reach
     *  that draws no blood points somewhere other than positioning). */
    combatTrace(n = 1200) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const rows: Array<{ f: number; striking: boolean; dist: number | null; bearing: number | null; inCone: boolean; ehp: number | null }> = [];
      driveSteps((f) => {
        const obs = observe();
        const live = obs.visible.enemies.filter((e) => e.hp.current > 0);
        let near = live[0];
        for (const e of live) if (!near || e.distance < near.distance) near = e;
        const sw = getSwing();
        rows.push({
          f, striking: sw.striking,
          dist: near ? Math.round(near.distance * 100) / 100 : null,
          bearing: near ? Math.round(near.bearing * 100) / 100 : null,
          inCone: near?.inCone ?? false,
          ehp: near?.hp.current ?? null,
        });
        return decideIntent(obs); // the REAL pilot, not forced
      }, n);
      // Collapse strike windows; for each, did the enemy's hp drop?
      const strikes: Array<{ f: number; dist: number | null; bearing: number | null; inCone: boolean; landed: boolean }> = [];
      let i = 0;
      while (i < rows.length) {
        if (!rows[i].striking) { i++; continue; }
        const start = i;
        const hpBefore = rows[i].ehp;
        while (i < rows.length && rows[i].striking) i++;
        const hpAfter = rows[Math.min(i, rows.length - 1)].ehp;
        strikes.push({
          f: rows[start].f, dist: rows[start].dist, bearing: rows[start].bearing, inCone: rows[start].inCone,
          landed: hpBefore != null && hpAfter != null && hpAfter < hpBefore,
        });
      }
      return {
        strikes: strikes.length,
        landed: strikes.filter((s) => s.landed).length,
        enemyHpStart: rows[0]?.ehp ?? null,
        enemyHpEnd: rows.at(-1)?.ehp ?? null,
        sample: strikes.slice(0, 14),
      };
    },
    /** Replay a tape, returning the digest at EVERY frame — the full
     *  trajectory. One-shot from spawn (fresh ?simfreeze load). */
    trace(tapeJson: string): string[] {
      if (!isWorldFrozen()) setWorldFrozen(true);
      return traceReplay(deserializeTape(tapeJson));
    },
    /** First frame two trajectories disagree — where did the runs split?
     *  Pure: pass two arrays from trace(). null = identical. */
    diff: (a: string[], b: string[]) => firstDivergence(a, b),
    /** Leaderboard-style verify: replay a submitted tape and check its final
     *  state matches a claimed digest. The trust-but-verify primitive — the
     *  same call a server makes on a submitted run. */
    verify(tapeJson: string, claimedFinalDigest: string) {
      if (!isWorldFrozen()) setWorldFrozen(true);
      const tape = deserializeTape(tapeJson);
      driveSteps((f) => tapeFrame(tape, f) ?? NEUTRAL_INTENT, tape.frames.length);
      const actual = digest();
      return { ok: actual === claimedFinalDigest, actual, claimed: claimedFinalDigest };
    },
  };

  (window as unknown as Record<string, unknown>).__sim = api;
  // eslint-disable-next-line no-console
  console.info(
    `[sim-stepper] window.__sim ready — ${simSystems.length} sim systems. ` +
      `Try: __sim.freeze(); __sim.step(60); __sim.bench(); __sim.proveDeterministic()`,
  );
}
