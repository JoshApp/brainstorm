/**
 * Node-side manifest IO for the art run log (see src/art/runs.ts for the model).
 * Read/append runs, promote a winner, set the active frame. All writes are
 * append-or-update on a single JSON file; images are written once and never
 * mutated.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ArtManifest, type ArtRun, EMPTY_MANIFEST } from '../src/art/runs';

export const ART_DIR = resolve(process.cwd(), 'public/art');
export const RUNS_DIR = resolve(ART_DIR, 'runs');
const MANIFEST = resolve(RUNS_DIR, 'index.json');

export function load(): ArtManifest {
  if (!existsSync(MANIFEST)) return { ...EMPTY_MANIFEST };
  try {
    return { ...EMPTY_MANIFEST, ...(JSON.parse(readFileSync(MANIFEST, 'utf8')) as ArtManifest) };
  } catch {
    return { ...EMPTY_MANIFEST };
  }
}

export function save(m: ArtManifest): void {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

/** Absolute path for a run's image. */
export function runImagePath(id: string): string {
  return resolve(RUNS_DIR, `${id}.png`);
}

/** Next run id, monotonic across the whole manifest. */
export function nextId(m: ArtManifest): { id: string; n: number } {
  const n = m.runs.reduce((mx, r) => Math.max(mx, r.n), 0) + 1;
  return { id: `r${n}`, n };
}

export function findRun(m: ArtManifest, id: string): ArtRun | undefined {
  return m.runs.find((r) => r.id === id);
}

/** Append a run record (the image must already be written to runImagePath). */
export function addRun(m: ArtManifest, run: ArtRun): void {
  m.runs.push(run);
}

/** Promote a run: cards set per-subject; frames set the single active frame. */
export function promote(m: ArtManifest, id: string): ArtRun {
  const run = findRun(m, id);
  if (!run) throw new Error(`no run ${id}`);
  if (run.kind === 'frame') m.activeFrame = id;
  else m.promoted[run.subject] = id;
  return run;
}
