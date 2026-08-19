// ── ONE WARM AT A TIME ────────────────────────────────────────────────────────
//
// Three passes — runWarmupPassWebGPU, warmRealRoster, warmSceneCompile — each
// reach across the WHOLE scene and temporarily rewrite state that nothing owns
// exclusively: every drawable's `visible` flag, the room culler's enabled bit,
// the warm render resolution. Each pass is symmetric ON ITS OWN (snapshot,
// mutate, restore in a `finally`). None of them is safe against ANOTHER pass
// doing the same thing at the same time — pass B snapshots what pass A has
// already forced, and B's restore then writes A's TEMPORARY state back as if it
// were the truth. Whatever A forced is now permanent.
//
// That is not hypothetical. Trapping the `visible` setter across a real
// title → DESCEND boot caught the title vignette's `warmSceneCompile` still
// running `restoreCull` while `bootWarm` had already begun spawning warm
// projectiles: two chains, one set of flags, interleaved. Both stranding
// directions were live:
//
//   - stranded VISIBLE — an unspawned projectile-pool slot left on, which is a
//     2m unlit white sphere parked at the world origin. The pool lives on the
//     Scene, not on level.root, so it survived every teardown and reappeared on
//     every floor.
//   - stranded HIDDEN — floor geometry switched off by a restore that ran after
//     the level had already been rebuilt underneath it. The starter chamber is
//     the first level built after the title, i.e. squarely inside the window,
//     which is why the weapon-pick chamber was the one that rendered void.
//
// So warms are serialized. THE UNIT OF EXCLUSION IS THE CHAIN, not the
// individual pass: inside one chain the passes are deliberately ordered and
// share their setup (culler off, low-res on, lights pumped to play state), and
// taking the lock per-pass would deadlock the moment one nested inside another.
// Callers wrap their whole prewarm body in `withWarmLock` and keep the passes
// themselves lock-free.
//
// Queue, not a "bail if busy": a warm that gets skipped is a floor that
// compiles in live frames later, which is the hitch this whole subsystem
// exists to prevent. Waiting is always the right answer — every caller is
// already behind a cover.

// DEV via the shared gate, not the bare `import.meta.env.DEV` literal: this
// module is pure async logic and is exercised by tests/warm-lock.test.ts under
// tsx, where `import.meta.env` does not exist (see debug/dev.ts).
import { DEV } from '../debug/dev';

/** Tail of the queue. Every warm chains onto it, so they run in call order. */
let tail: Promise<unknown> = Promise.resolve();
/** Label of the chain currently inside the lock, for diagnostics. */
let holder: string | null = null;

/** Which warm chain holds the lock right now (null = none). DEV diagnostics. */
export function warmLockHolder(): string | null {
  return holder;
}

/**
 * Run `fn` with exclusive access to the scene's warm-time global state.
 *
 * Never call this from inside another `withWarmLock` body — the lock is not
 * re-entrant and would deadlock. Wrap whole prewarm CHAINS, never the
 * individual passes they call.
 */
export function withWarmLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const prev = tail;
  const run = (async (): Promise<T> => {
    if (DEV && holder !== null) {
      // eslint-disable-next-line no-console
      console.log(`[warm-lock] "${label}" waits for "${holder}"`);
    }
    // Swallow the predecessor's failure — a warm that threw must not wedge the
    // queue for every warm behind it. Its own caller already handled it.
    await prev.catch(() => {});
    holder = label;
    try {
      return await fn();
    } finally {
      holder = null;
    }
  })();
  tail = run.catch(() => {});
  return run;
}
