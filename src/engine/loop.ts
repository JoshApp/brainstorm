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
  /** realDt * death/hit-pause time-scale. Use for in-world simulation that
   *  should ease to a freeze with the death sequence. */
  scaledDt: number;
  /** isWorldPaused() — hit-pause OR open screen OR debug freeze. */
  paused: boolean;
  /** Player lifecycle phase. */
  mode: GameMode;
  /** Convenience: mode === 'playing'. */
  playing: boolean;
}

export type SystemPhase = 'unpaused' | 'always';

export interface GameSystem {
  name: string;
  phase: SystemPhase;
  /** If set, the system only ticks when the current mode is in this list. */
  modes?: GameMode[];
  tick(ctx: TickContext): void;
}

/** Dispatch one frame across an ordered system list, honouring each system's
 *  phase + mode gates. Order is the array order — top to bottom. */
export function runSystems(systems: readonly GameSystem[], ctx: TickContext): void {
  for (const sys of systems) {
    if (sys.phase === 'unpaused' && ctx.paused) continue;
    if (sys.modes && !sys.modes.includes(ctx.mode)) continue;
    sys.tick(ctx);
  }
}
