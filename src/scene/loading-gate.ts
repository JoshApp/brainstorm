// LOADING GATE — while the first-floor warmup runs, the whole game frame is
// SKIPPED (engine/main tick early-returns): no sim, no audio, no render. Two bugs
// this fixes, both from the warmup yielding to rAF while the game loop kept
// running underneath it:
//   1. ARTIFACTS — the warmup's roster subjects (built into the live scene at the
//      camera) were rendered by the game loop during the build, flashing through.
//   2. GAME-ALREADY-LIVE — the sim + audio ticked during the warmup, so sound and
//      activity started before the player could act.
// With the frame skipped, only the warmup (its own rAF yields) and the DOM loading
// cover run. The game resumes the instant the warmup tears down (endLoading), so
// the world renders for the reveal fade.

let loading = false;

/** True while the warmup owns the frame — the game loop must skip everything. */
export function isLoading(): boolean { return loading; }
export function beginLoading(): void { loading = true; }
export function endLoading(): void { loading = false; }
