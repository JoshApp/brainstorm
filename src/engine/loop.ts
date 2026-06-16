import type { GameMode } from '../state/game-mode';

// Frame-loop scaffolding. The per-frame work is expressed as an ordered list
// of GameSystems instead of one long inline function, so "what runs, in what
// order, and under which conditions" is declarative data rather than control
// flow buried in main.ts.
//
// Two axes gate a system:
//   - phase: 'unpaused' systems are skipped while the world is paused
//     (hit-pause, open menu, debug freeze); 'always' systems run every frame
//     (rendering, HUD, ambient drift) so the screen stays live in menus.
//   - modes: optional whitelist of lifecycle modes. Omit = runs in all modes.
//     e.g. a control system can restrict itself to ['playing'] so it goes
//     quiet during the death sequence without an inline isDying() check.
//
// Systems read everything else (dt, pause flag, lifecycle mode) off the
// TickContext. They still close over the concrete scene refs (camera, level,
// input) at their definition site — this module only owns dispatch.

export interface TickContext {
  /** Real elapsed seconds this frame, capped. Use for motion that must NOT
   *  slow during the death slow-mo (viewmodel flicker, HUD, ambient drift). */
  realDt: number;
  /** realDt * death/hit-pause time-scale, AND the reactive-defense bullet-time
   *  slow. The WORLD clock — enemies, projectiles, world props ease to a
   *  freeze with the death sequence and crawl during bullet-time. */
  scaledDt: number;
  /** realDt * death/hit-pause time-scale, WITHOUT the bullet-time slow. The
   *  PLAYER clock — camera, movement, attacks. During a clean deflect/dodge
   *  the player keeps acting at full speed while scaledDt slows the world
   *  (the asymmetric bullet-time payoff). Equals scaledDt outside bullet-time. */
  playerDt: number;
  /** realDt * the reactive-defense bullet-time slow ONLY (no hit-pause / death
   *  scale). The AMBIENT-FX clock: dust/motes drift at full real-time normally
   *  (no stutter on a hit-pause freeze) but HANG with the world during a
   *  perfect-dodge dip. Equals realDt outside bullet-time. */
  fxDt: number;
  /** isWorldPaused() — hit-pause OR open screen OR debug freeze. */
  paused: boolean;
  /** Player lifecycle phase. */
  mode: GameMode;
  /** Convenience: mode === 'playing'. */
  playing: boolean;
}

export type SystemPhase = 'unpaused' | 'always';

// Orthogonal to `phase`. `phase` answers "does it run while the world is
// paused?"; `kind` answers "does it mutate SIM state (positions, HP, AI,
// cooldowns, combat/loot outcomes) or only PRESENT it (render, camera, HUD,
// VFX, audio, lighting, culling)?". The headless fixed-step stepper
// (debug/sim-stepper.ts) runs ONLY kind:'sim' systems, so a run can advance
// with no renderer driving it. Absent = 'present' — the safe default, so an
// untagged system never silently advances a headless sim. The two axes cross:
// most sim systems are phase:'unpaused' (enemies, combat) but a couple are
// phase:'always' (player-stats recompute, interactable use).
export type SystemKind = 'sim' | 'present';

export interface GameSystem {
  name: string;
  phase: SystemPhase;
  /** SIM (mutates game state) vs PRESENT (draws/sounds it). Absent = present.
   *  Drives headless sim-only stepping; see SystemKind. */
  kind?: SystemKind;
  /** If set, the system only ticks when the current mode is in this list. */
  modes?: GameMode[];
  tick(ctx: TickContext): void;
}

// Optional per-system timing hooks. Both null/false in the normal (and
// production) path, so runSystems takes its zero-overhead fast loop. The DEV
// profiler sets these to measure each system's wall-clock cost — the "which
// system got slower" breakdown. Kept as plain module state so the engine never
// imports the debug layer; the profiler reaches IN to install itself.
export type SystemProbe = (name: string, ms: number) => void;
let systemProbe: SystemProbe | null = null;
export function setSystemProbe(probe: SystemProbe | null): void {
  systemProbe = probe;
}
// When true, each system also emits a User Timing `performance.measure` named
// after the system. That puts a labeled span per system into the browser's
// Timings track, so a Chrome DevTools Performance recording (incl. remote
// over USB from a phone) shows the same per-system flame chart natively.
let marksEnabled = false;
export function setMarksEnabled(on: boolean): void {
  marksEnabled = on;
}

/** Dispatch one frame across an ordered system list, honouring each system's
 *  phase + mode gates. Order is the array order — top to bottom. */
export function runSystems(systems: readonly GameSystem[], ctx: TickContext): void {
  // Instrumented path — only taken when the DEV profiler is recording / marking.
  if (systemProbe || marksEnabled) {
    for (const sys of systems) {
      if (sys.phase === 'unpaused' && ctx.paused) continue;
      if (sys.modes && !sys.modes.includes(ctx.mode)) continue;
      const t0 = performance.now();
      sys.tick(ctx);
      const t1 = performance.now();
      if (systemProbe) systemProbe(sys.name, t1 - t0);
      if (marksEnabled) performance.measure(sys.name, { start: t0, end: t1 });
    }
    return;
  }
  for (const sys of systems) {
    if (sys.phase === 'unpaused' && ctx.paused) continue;
    if (sys.modes && !sys.modes.includes(ctx.mode)) continue;
    sys.tick(ctx);
  }
}
