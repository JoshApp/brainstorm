import { DEV } from './dev';

// BOOT TIMELINE — where the boot's seconds actually go.
//
// Written 2026-08-05 after Josh: *"the first loading screen takes a while even
// while already in game and pressing new run you go back to the main menu which
// kinda starts at 80% and then takes a while while the descent is almost instant
// once you've been through it."*
//
// He is describing a boot whose progress bar covers ONE of its three phases. The
// reason nobody caught that by reading the code is that the phases live as
// sequential `await`s inside one function, with no name and no clock on any of
// them — so "which part is slow" was never a question the code could answer, and
// every past fix was a guess at the phase someone happened to suspect.
//
// This makes the boot self-describing. Mark a phase, get a table:
//
//   [boot] title-settle   3140ms  ████████████░░░░░░░░  44%
//   [boot] roster-warm    2380ms  █████████░░░░░░░░░░░  33%
//   [boot] clean-frames   1610ms  ██████░░░░░░░░░░░░░░  23%
//   [boot] TOTAL          7130ms
//
// DEV-only, and free in prod: the calls collapse to `if (false)` and the whole
// module is dead-code-eliminated (CLAUDE.md, "dev-only code must not ship").
//
// Also exposed as `window.__bootTimeline` so a headless run can read the phases
// back and assert on them, rather than a human eyeballing a console.

interface Phase { name: string; ms: number }

const phases: Phase[] = [];
let openName: string | null = null;
let openAt = 0;

/**
 * Close the phase in flight (if any) and open `name`. Call with no argument at
 * the end of the boot to close the last one.
 *
 * Deliberately a single call rather than begin/end pairs — a boot is a strict
 * sequence, and paired calls would let a phase silently go unclosed on the early
 * -return paths (the PWA-update branch, the scenario shortcut) that this is most
 * useful for measuring.
 */
export function bootPhase(name?: string): void {
  if (!DEV) return;
  const now = performance.now();
  if (openName !== null) phases.push({ name: openName, ms: now - openAt });
  openName = name ?? null;
  openAt = now;
}

/** Print the table. Safe to call more than once; only the first prints. */
export function reportBootTimeline(): void {
  if (!DEV || reported) return;
  bootPhase();          // close whatever is still open
  if (!phases.length) return;
  reported = true;
  const total = phases.reduce((a, p) => a + p.ms, 0);
  const w = Math.max(...phases.map((p) => p.name.length));
  for (const p of phases) {
    const frac = total > 0 ? p.ms / total : 0;
    const filled = Math.round(frac * 20);
    console.log(
      `[boot] ${p.name.padEnd(w)}  ${String(Math.round(p.ms)).padStart(5)}ms  ` +
      `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}  ${(frac * 100).toFixed(0)}%`,
    );
  }
  console.log(`[boot] ${'TOTAL'.padEnd(w)}  ${String(Math.round(total)).padStart(5)}ms`);
}
let reported = false;

/** The recorded phases, for a headless harness to assert against. */
export function bootPhases(): readonly Phase[] {
  return phases;
}

if (DEV) {
  (window as unknown as { __bootTimeline?: () => readonly Phase[] }).__bootTimeline = bootPhases;
}
