import { setBootProgress } from './boot-veil';

// THE BOOT BAR, SPANNING THE WHOLE BOOT.
//
// Written 2026-08-05 after Josh: *"the first loading screen takes a while even
// while already in game, and pressing new run you go back to the main menu which
// kinda starts at 80% and then takes a while."*
//
// He was reading the bar correctly; the bar was lying. Boot has FOUR phases and
// the bar was wired to ONE of them:
//
//   1. boot-gate      check for a fresh build, then mount the title vignette
//   2. title-settle   wait for the title vignette's pipelines to stop compiling
//   3. roster-warm    build + compile the content roster   ← the only phase with a bar
//   4. clean-frames   wait for presented frames + a second compile settle
//
// Measured (headless, software raster, so roster-warm is exaggerated — but the
// DEAD ZONES are what matter and they are hardware-independent):
//
//   5.4s of boot elapsed with NO BAR AT ALL, then the bar revealed already part-
//   filled, then it SAT AT 100% for 2.5s before the veil dropped.
//
// The "starts at 80%" is those two facts meeting: the bar revealed itself on its
// FIRST update, behind a 0.4s opacity fade, so on hardware where roster-warm is
// quick the fill had already run most of its travel before the player could see
// the bar at all. The three phases it could not express are the "takes a while".
// Nothing was slow that wasn't slow before; the bar measured a quarter of the
// wait and called it the whole thing.
//
// After: revealed at 0%, and pinned at full for 0.2s instead of 2.5s.
//
// ── WHY THE WEIGHTS ARE LEARNED, NOT CONSTANTS ───────────────────────────────
// The phases' relative cost is not a property of the game, it is a property of
// the DEVICE. title-settle and clean-frames are budget-capped waits (4s and 4.5s
// worst case) that finish early once compiling settles; roster-warm is unbounded
// real work that takes a couple of seconds on a good GPU and forty on a software
// rasteriser. Any constant weighting is badly wrong on one of them.
//
// So each boot records what its phases actually cost and the NEXT boot uses those
// as its weights. That fits the complaint exactly: "new run" is `location.reload()`
// (settings-menu abandonRun / quitToMenu), so the boot the player complains about
// is never the first one — it always has a previous boot's measurements to use.
// First-ever boot uses the defaults below and is the only one that can be far off.

export type BootPhaseName = 'boot-gate' | 'title-settle' | 'roster-warm' | 'clean-frames';

const ORDER: readonly BootPhaseName[] = ['boot-gate', 'title-settle', 'roster-warm', 'clean-frames'];

/** First-boot guesses, from the headless measurement scaled toward real hardware.
 *  Only ever used before this device has booted once. */
const DEFAULT_MS: Record<BootPhaseName, number> = {
  'boot-gate': 2500,
  'title-settle': 2000,
  'roster-warm': 4000,
  'clean-frames': 2000,
};

const STORE_KEY = 'delve:boot-phase-ms';

/** How much a fresh measurement moves the stored estimate. Low, so one anomalous
 *  boot (a backgrounded tab, a thermal-throttled phone) doesn't hand the next
 *  boot a wildly wrong bar — but high enough that a real change (a new device, a
 *  content drop that grows the roster) is absorbed within a few runs. */
const SMOOTHING = 0.4;

function loadMs(): Record<BootPhaseName, number> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_MS };
    const parsed = JSON.parse(raw) as Partial<Record<BootPhaseName, number>>;
    const out = { ...DEFAULT_MS };
    for (const name of ORDER) {
      const v = parsed[name];
      // Reject nonsense rather than trusting storage — a corrupted or
      // hand-edited entry would otherwise pin the bar at 0 or 1 forever.
      if (typeof v === 'number' && isFinite(v) && v > 0 && v < 120_000) out[name] = v;
    }
    return out;
  } catch { return { ...DEFAULT_MS }; }
}

let weights: Record<BootPhaseName, number> = { ...DEFAULT_MS };
const offsets = {} as Record<BootPhaseName, number>;
const spans = {} as Record<BootPhaseName, number>;
let current: BootPhaseName | null = null;
let phaseStart = 0;
const measured: Partial<Record<BootPhaseName, number>> = {};
/** Monotonic — a phase that finishes early must never walk the bar backwards. */
let shown = 0;

/**
 * Start the boot bar. Call BEFORE the first phase.
 *
 * Reveals the bar immediately at zero, which is the other half of the fix: the
 * bar's 0.4s opacity fade now overlaps the beginning of the wait instead of the
 * middle of it, so the player sees it start from empty rather than catching it
 * already most of the way along.
 */
export function beginBootProgress(): void {
  weights = loadMs();
  const total = ORDER.reduce((a, n) => a + weights[n], 0) || 1;
  let acc = 0;
  for (const name of ORDER) {
    offsets[name] = acc / total;
    spans[name] = weights[name] / total;
    acc += weights[name];
  }
  shown = 0;
  setBootProgress(0);
}

/** Enter a phase. Closes the previous one and records what it cost. */
export function enterBootPhase(name: BootPhaseName): void {
  const now = performance.now();
  if (current) measured[current] = now - phaseStart;
  current = name;
  phaseStart = now;
  emit(0);
}

/**
 * Report progress WITHIN the current phase, 0..1.
 *
 * Phases that do real countable work (the roster warm) pass their own fraction.
 * Phases that are budget-capped WAITS pass elapsed/budget — honest, because the
 * budget IS their worst case and finishing early just means the bar jumps
 * forward to the next phase's floor. Either way the bar keeps moving, which is
 * what "the boot is alive" has to look like.
 */
export function bootPhaseProgress(local: number): void {
  emit(local);
}

function emit(local: number): void {
  if (!current) return;
  const t = offsets[current] + spans[current] * Math.max(0, Math.min(1, local));
  if (t <= shown) return;      // monotonic — never rewind
  shown = t;
  setBootProgress(t);
}

/**
 * Boot is done. Closes the last phase, writes the measurements back for the next
 * boot's weights, and pins the bar full.
 */
export function endBootProgress(): void {
  if (current) measured[current] = performance.now() - phaseStart;
  current = null;
  shown = 1;
  setBootProgress(1);
  try {
    const prev = loadMs();
    const next: Record<string, number> = {};
    for (const name of ORDER) {
      const m = measured[name];
      next[name] = m !== undefined && isFinite(m) && m > 0
        ? prev[name] * (1 - SMOOTHING) + m * SMOOTHING
        : prev[name];
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch { /* private mode / quota — the bar just stays on defaults */ }
}

/** What this boot measured, for the DEV timeline + a headless harness. */
export function bootPhaseMeasurements(): Readonly<Partial<Record<BootPhaseName, number>>> {
  return measured;
}
