// Test runner — globs tests/*.test.ts and runs each in its OWN tsx process,
// several at a time.
//
// Isolation is deliberate: the codebase leans on module-level mutable state
// (getter/setter singletons), so tests must not share one process or they'd
// leak state into each other. Each file gets a fresh tsx run.
//
// And that isolation is precisely what makes running them CONCURRENTLY safe —
// separate processes cannot leak into each other by construction, so there is
// no shared-state hazard to reason about. The suite was serial only because it
// grew out of a hand-chained `&&` list.
//
// ── WHY THIS MATTERS ─────────────────────────────────────────────────────────
//
// Josh, on the loop feeling like a 20-minute pipeline: *"it's like a single
// threading issue, all is blocking and slow at the same time."* Correct
// diagnosis. The suite was 313s wall clock on 4 cores doing maybe 90s of work.
//
//   npm test                     # run everything
//   npm test -- --affected       # only tests that can reach what you changed
//   npm test -- --affected --since=origin/main
//   npm test -- --jobs=1         # serial, for debugging interleaved output
//   npm test -- poly floor       # only files whose name contains any of these
//   tsx tests/foo.test.ts        # still run one file directly
//
// ── --affected: THE INNER LOOP ───────────────────────────────────────────────
//
// 109 files and ten minutes, paid on every commit, most of it wasted — editing
// content/buffs.ts cannot break corridor-route. `--affected` walks the import
// graph from each test and runs only those that can reach a changed file. See
// scripts/test-impact.ts for the three rules that keep it safe; the important
// one is that anything the analysis cannot account for runs EVERYTHING, and an
// affected run never writes the full-pass stamp. The gate does not get weaker,
// only the loop gets faster.
//
// Output is BUFFERED per file and printed when that file finishes, so parallel
// runs don't interleave into nonsense. A file's output still appears as one
// contiguous block exactly as it did serially.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildImpactGraph, selectAffected } from './test-impact';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

const argv = process.argv.slice(2);
const jobsArg = argv.find((a) => a.startsWith('--jobs='));
// Leave a core for the parent and the OS. One job would be the old behaviour.
const JOBS = jobsArg ? Math.max(1, Number(jobsArg.slice(7))) : Math.max(1, cpus().length - 1);
const filters = argv.filter((a) => !a.startsWith('--'));
const affected = argv.includes('--affected');
const sinceArg = argv.find((a) => a.startsWith('--since='));

let files = readdirSync(join(root, 'tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .sort();
if (filters.length) files = files.filter((f) => filters.some((q) => f.includes(q)));
if (files.length === 0) {
  console.log(`no test files match ${filters.join(' ')}`);
  process.exit(1);
}

// ── AFFECTED SELECTION ───────────────────────────────────────────────────────
/** Repo-relative paths of everything that differs from the baseline. */
function changedFiles(): string[] | null {
  const git = (args: string[]) => spawnSync('git', args, { cwd: root, maxBuffer: 1 << 28 });
  const out = new Set<string>();
  // Against a ref when asked (what a branch changed); otherwise the working
  // tree against HEAD (what you are editing right now).
  const ranges = sinceArg
    ? [['diff', '--name-only', `${sinceArg.slice(8)}...HEAD`], ['diff', '--name-only', 'HEAD']]
    : [['diff', '--name-only', 'HEAD']];
  for (const r of ranges) {
    const res = git(r);
    if (res.status !== 0) return null;      // no git / bad ref → caller runs everything
    for (const f of res.stdout.toString().split('\n').filter(Boolean)) out.add(f);
  }
  const others = git(['ls-files', '--others', '--exclude-standard']);
  if (others.status !== 0) return null;
  for (const f of others.stdout.toString().split('\n').filter(Boolean)) out.add(f);
  return [...out];
}

/** True when the run covered every test file — gates the cache stamp. */
let ranEverything = filters.length === 0;

if (affected) {
  const changed = changedFiles();
  if (!changed) {
    console.log('[affected] git unavailable — running everything');
  } else {
    const graph = buildImpactGraph(root, files);
    const sel = selectAffected(graph, files, changed);
    console.log(`[affected] ${sel.reason}`);
    files = sel.files;
    ranEverything = sel.full;
  }
}

/**
 * SLOWEST FIRST.
 *
 * With N workers and one file far longer than the rest, starting it last means
 * every worker idles waiting for it — the whole point of parallelising is lost
 * to the tail. Durations are not tracked between runs (a stat file is one more
 * thing to go stale), so this is a static ordering by the only signal available
 * without running anything: the floor-generation tests are the slow ones, and
 * they are the ones whose names say so.
 */
const SLOW = /^(poly-floor|floor-|poly-|corridor-|portals|rect-at|doorway|threshold|anchors|encounter|prop-claims|room-)/;
files.sort((a, b) => Number(SLOW.test(b)) - Number(SLOW.test(a)));

// ── DON'T RUN THE SUITE TWICE ON THE SAME BYTES ──────────────────────────────
//
// `npm run ship` and `npm run live` invoke the pre-push hook, which runs this
// suite — usually seconds after the exact same suite passed by hand. That is
// the second half of the wall-clock problem, and it is pure duplicate work: the
// inputs did not change, so neither can the answer.
//
// The key is the full content of the tree: HEAD, plus every tracked change
// against it (staged or not), plus the content of every untracked non-ignored
// file. If any byte a test could read differs, the hash differs and the suite
// runs. A stamp is only written on a clean full-suite pass — never for a
// filtered run, which by construction did not check everything.
//
// `FORCE_TESTS=1` or `--force` re-runs regardless. The cached line says so
// explicitly, because a cache that looks like a fresh pass is worse than none.
const STAMP = join(root, '.git', 'delve-test-pass');

function treeHash(): string | null {
  const git = (args: string[]) => spawnSync('git', args, { cwd: root, maxBuffer: 1 << 28 });
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0) return null;
  const h = createHash('sha256').update(head.stdout);
  const diff = git(['diff', 'HEAD', '--binary']);
  if (diff.status !== 0) return null;
  h.update(diff.stdout);
  const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
  if (others.status !== 0) return null;
  for (const f of others.stdout.toString().split('\0').filter(Boolean).sort()) {
    h.update(f);
    try { h.update(readFileSync(join(root, f))); } catch { /* vanished mid-run */ }
  }
  return h.digest('hex');
}

const forced = process.env.FORCE_TESTS === '1' || argv.includes('--force');
const full = ranEverything;
const hash = full && !forced ? treeHash() : null;

if (hash) {
  try {
    const [prev, when] = readFileSync(STAMP, 'utf8').trim().split(/\s+/);
    if (prev === hash) {
      console.log(`✓ ${files.length} test files passed  (CACHED — tree unchanged since `
        + `${new Date(Number(when)).toLocaleTimeString()}; FORCE_TESTS=1 to re-run)`);
      process.exit(0);
    }
  } catch { /* no stamp yet */ }
}

const start = Date.now();
const failures: string[] = [];
let next = 0;

function runOne(file: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(tsx, [join('tests', file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('close', (code) => {
      // One contiguous block per file, printed on completion — parallel output
      // that interleaves line-by-line is unreadable and hides which file failed.
      process.stdout.write(Buffer.concat(chunks));
      if (code !== 0) failures.push(file);
      resolve();
    });
  });
}

async function worker(): Promise<void> {
  while (next < files.length) await runOne(files[next++]);
}

await Promise.all(Array.from({ length: Math.min(JOBS, files.length) }, worker));

const secs = ((Date.now() - start) / 1000).toFixed(1);
console.log('\n' + '─'.repeat(52));
if (failures.length === 0) {
  console.log(`✓ ${files.length} test files passed  (${secs}s, ${JOBS} jobs)`);
  // Re-hash rather than reuse: a file edited WHILE the suite ran was not the
  // thing that just passed, and stamping the pre-run hash would certify it.
  if (full) { const h = treeHash(); if (h) writeFileSync(STAMP, `${h} ${Date.now()}\n`); }
} else {
  console.log(`✗ ${failures.length}/${files.length} test files FAILED  (${secs}s, ${JOBS} jobs)`);
  for (const f of failures.sort()) console.log(`    tests/${f}`);
  process.exit(1);
}
