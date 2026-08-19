// ── ?fast=1 — NO WARMING, NO WAITING, STRAIGHT TO THE MENU ───────────────────
//
// Josh: *"can we make a url flag that completely skips warming so it goes straight to the main
// menu and descent is instant? i need this for iterating faster."*
//
// Boot is slow ON PURPOSE. Every material on WebGPU is a pipeline that must compile before it
// can draw, the compile is async, and the whole warm architecture exists so the player never
// sees a half-compiled scene or a mid-fight hitch — see main.ts's bootWarm and the descent
// prewarm. All of that is right, and none of it is worth paying twenty times an hour while
// iterating on where a hand sits in the frame.
//
// So this is a deliberate, ADMITTED trade: with the flag on, pipelines compile lazily and the
// game WILL stutter on first use of anything. That is the expected behaviour, not a regression
// to chase. Nothing measured under `?fast=1` says anything about how the game performs.
//
// What it turns off, in the three places that cost the seconds:
//   · the boot roster warm and the compile-settle waits before the title
//   · the per-descent warm (roster, scene compile, prepare pass)
//   · the fade and presented-frame gates either side of a descent
//
// `?nowarm=1` already existed and does the FIRST two — it is the A/B switch for whether warming
// is behind a particular hazard, and headless snaps use it. This is the bigger hammer: nowarm
// still waits out the compile-settle budget and the fades, because in that context those waits
// are the thing being measured against.
//
// DEV-ONLY, so it is dead-code-eliminated in production and cannot be turned on from the live
// site by anyone who reads this file (see the CLAUDE.md dev-gate rule).

import { DEV } from './dev';

function flag(name: string): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(name) === '1';
}

/** Skip all warming AND all the waits around it. DEV-only. */
export const FAST_BOOT = DEV && flag('fast');

/**
 * Skip pipeline warming — either flag does it.
 *
 * `?nowarm=1` is the narrow one and is NOT DEV-gated, because headless snaps run it against a
 * build and it changes no game rule; `?fast=1` implies it.
 */
export function skipWarming(): boolean {
  return FAST_BOOT || flag('nowarm');
}
