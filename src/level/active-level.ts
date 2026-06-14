import type { LiveLevel } from './builder';

// Active-level holder — the live level reference, split OUT of loader.ts so
// read-only consumers (HUD effects, interactables) can ask "what level is
// live?" WITHOUT importing the loader. The loader pulls in the whole
// level-build pipeline AND the PWA updater (a Vite `virtual:` import); a
// consumer that only needs "the current level" shouldn't drag all that in.
// Load-bearing for tests: the `virtual:` import breaks pure-logic test graphs
// run under tsx (it can't resolve the scheme), so a combat module reaching
// the loader transitively poisons its test. loader.ts owns the WRITE via
// setActiveLevel; everyone else only reads.

let activeLevel: LiveLevel | null = null;

/** The currently-loaded level, or null before the first load / during teardown. */
export function getActiveLevel(): LiveLevel | null {
  return activeLevel;
}

/** Loader-only: publish (or clear) the live level. */
export function setActiveLevel(level: LiveLevel | null): void {
  activeLevel = level;
}
