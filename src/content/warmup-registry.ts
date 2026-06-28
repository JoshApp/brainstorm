import type * as THREE from 'three';

// Self-registering warmup hooks — the architecture that lets us warm the whole
// game WITHOUT a hand-maintained god-list in warmup.ts.
//
// THE PROBLEM. WebGL compiles a shader program the first time a unique material
// configuration is rendered. The first kill, first proc, first pickup mid-fight
// pays that compile as a frame hitch. The fix is to render every material
// configuration once at boot. The old approach hand-listed each subject in
// warmup.ts, which silently rots: add a new pop effect, forget to warm it, ship
// a first-use hitch.
//
// THE SEAM. An effect module registers its OWN warmup right next to its
// spawn/tick/clear. The boot warmup (warmup.ts) drains this registry: it calls
// every spawn() into a throwaway scratch scene, renders ONE frame against the
// main renderer (compiling each material's program + the shadow-depth variant),
// then calls every clear() to empty the pools again.
//
// The payoff: warmup coverage tracks USAGE. The moment an effect is wired into
// the game it's imported into the boot module graph, its module-level
// registerWarmup() runs, and it self-warms. Nothing central to keep in sync.
//
// CONTRACT for a hook:
//  - spawn() adds a REPRESENTATIVE instance (the worst-case material set — the
//    variant whose program you most want compiled) at/near the scratch scene's
//    origin. It may push into the effect's real pool; that's expected.
//  - clear() is the effect's normal clear() — it must remove + dispose whatever
//    spawn() pushed, so a warmup instance never ticks during real gameplay.
//  - spawn() must be safe to call at BOOT (no level loaded, no player) — so
//    avoid effects whose spawn stamps the splat map or plays audio; those warm
//    naturally on the first hit anyway.

export interface WarmupHook {
  /** Short label — surfaces in DEV warmup logging / profiling. */
  label: string;
  /** Add a representative instance to the scratch scene. */
  spawn: (scene: THREE.Object3D) => void;
  /** The effect's normal clear() — empties the pool spawn() pushed to. */
  clear: () => void;
  /** LIVE-only: skip in the boot scratch (no fog / 1 light), run ONLY in the
   *  real-scene pass (runWarmupPass). Set for any material whose program is
   *  keyed on render state — enemies, props, lit models — so it warms the
   *  variant the live render actually uses, not a wrong scratch variant. */
  live?: boolean;
  /** TIER — when this hook is warmed on the WebGPU streamed path (scene/warmup-stream.ts):
   *   - 'essential' → warmed at BOOT behind the loading cover; the reveal blocks on it.
   *     Reserve for CHEAP, immediately-needed materials (core combat VFX) so boot stays fast.
   *   - 'deferred' (DEFAULT) → NOT warmed at boot; streamed during play by the idle
   *     scheduler (one subject per idle callback, off-screen). Use for everything heavy or
   *     not-instantly-needed: enemy bodies (CSG creatures), item drops, destructibles, rare
   *     effects. The heavy roster no longer blocks boot.
   *  Lean lights (one pipeline regardless of light count) is what makes off-screen streaming
   *  correct — the pipeline variant is material-determined, not scene-light-count-keyed. */
  tier?: 'essential' | 'deferred';
}

const hooks: WarmupHook[] = [];

/** Register an effect's boot-warmup. Call at module scope, next to the
 *  effect's spawn/clear. Idempotent enough for HMR: duplicate labels are
 *  collapsed so a hot-reload doesn't double-register. */
export function registerWarmup(hook: WarmupHook): void {
  const existing = hooks.findIndex((h) => h.label === hook.label);
  if (existing >= 0) hooks[existing] = hook;
  else hooks.push(hook);
}

/** A hook's tier — the explicit field, else a sane default by label: the heavy,
 *  numerous CONTENT (enemy/item/destructible bodies) STREAMS during play; everything
 *  else (the cheap core effects) is ESSENTIAL and boot-warms. */
function tierOf(h: WarmupHook): 'essential' | 'deferred' {
  if (h.tier) return h.tier;
  return /^(enemy|item|destructible):/.test(h.label) ? 'deferred' : 'essential';
}

/** Cheap, immediately-needed hooks — warmed at boot behind the loading cover. */
export function essentialWarmupHooks(): WarmupHook[] {
  return hooks.filter((h) => tierOf(h) === 'essential');
}

/** Heavy / not-instantly-needed hooks — streamed during play (scene/warmup-stream.ts). */
export function deferredWarmupHooks(): WarmupHook[] {
  return hooks.filter((h) => tierOf(h) === 'deferred');
}

export function getWarmupHooks(): readonly WarmupHook[] {
  return hooks;
}
