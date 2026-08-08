// WHICH TESTS COULD THIS CHANGE POSSIBLY BREAK?
//
// The suite is 109 files and ~10 minutes, and every commit pays it. Most of
// that is wasted: editing `content/buffs.ts` cannot affect `corridor-route`,
// and running it anyway is the single biggest tax on landing a change.
//
// So: build the import graph from each test file down through `src/`, and run
// only the tests whose transitive closure contains something that changed.
// This is ordinary test-impact analysis; what matters here is that it is
// implemented to fail in the SAFE direction, because the failure mode of
// getting it wrong is not a slow suite, it is a green run that never executed
// the test that would have caught the bug.
//
// The three rules that keep it safe:
//
//   1. AN IMPORT WE CANNOT RESOLVE POISONS THE TEST. If a test (or anything it
//      reaches) imports a relative path this resolver does not understand, that
//      test is marked as depending on everything and always runs. Silence is
//      never read as "no dependency".
//   2. A CHANGE OUTSIDE THE GRAPH RUNS EVERYTHING. package.json, tsconfig, the
//      runner itself, a fixture, a shell script — anything not reachable as a
//      module by some test is a change whose blast radius this analysis cannot
//      see, so it does not pretend to.
//   3. THE FULL SUITE IS STILL THE GATE. `--affected` is for the inner loop.
//      The pre-push hook runs everything, and only a genuine full pass writes
//      the cache stamp. This makes the loop fast without making the gate weaker.
//
// Rule 1 is why this reads imports with a regex rather than the TypeScript
// compiler: a regex that over-matches costs a few extra test files, and one
// that under-matches is caught by the unresolved-import poison. Pulling in the
// compiler to be exact would buy precision in the direction that does not
// matter and cost startup time in the loop this exists to speed up.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** Every relative import/export/`import()` specifier in a source file. */
const SPEC = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(SPEC)) {
    const s = m[1] ?? m[2];
    if (s) out.push(s);
  }
  return out;
}

/** Resolve a relative specifier to a real file, or null if we cannot. */
function resolveSpec(fromFile: string, spec: string): string | null {
  // Vite asset queries — `./x.woff2?url`, `?raw`, `?worker`. The suffix is a
  // build-time instruction, not part of the path. Left unhandled these were the
  // ONLY unresolved imports in the whole repo, and because the poison rule is
  // transitive they marked every test that reaches `ui/fonts.ts` — 36 of 109 —
  // as "depends on everything". Safe, and it made a third of the suite
  // unskippable for no reason.
  const base = resolve(dirname(fromFile), spec.replace(/\?.*$/, ''));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`,
                   join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && !c.endsWith('/')) {
      try { if (readFileSync(c).length >= 0) return c; } catch { /* not a file */ }
    }
  }
  return null;
}

export interface ImpactGraph {
  /** test file name (as in tests/) → every repo-relative file it can reach. */
  deps: Map<string, Set<string>>;
  /** Tests whose import graph could not be fully resolved — always run these. */
  unresolved: Set<string>;
  /** Every file reachable from any test. A change outside this is unmapped. */
  covered: Set<string>;
}

/**
 * Walk each test's imports transitively.
 *
 * `testFiles` are bare names as they appear in `tests/`. Paths in the result are
 * repo-relative so they compare directly against `git diff --name-only`.
 */
export function buildImpactGraph(root: string, testFiles: readonly string[]): ImpactGraph {
  const deps = new Map<string, Set<string>>();
  const unresolved = new Set<string>();
  const covered = new Set<string>();
  /** file → resolved children, memoised across tests (they share most of src). */
  const childCache = new Map<string, { kids: string[]; bad: boolean }>();

  const childrenOf = (file: string): { kids: string[]; bad: boolean } => {
    const hit = childCache.get(file);
    if (hit) return hit;
    let src = '';
    try { src = readFileSync(file, 'utf8'); }
    catch { const miss = { kids: [], bad: true }; childCache.set(file, miss); return miss; }
    const kids: string[] = [];
    let bad = false;
    for (const spec of specifiers(src)) {
      const r = resolveSpec(file, spec);
      if (r) kids.push(r); else bad = true;   // rule 1
    }
    const entry = { kids, bad };
    childCache.set(file, entry);
    return entry;
  };

  for (const t of testFiles) {
    const entry = join(root, 'tests', t);
    const seen = new Set<string>([entry]);
    const stack = [entry];
    let bad = false;
    while (stack.length) {
      const f = stack.pop()!;
      const { kids, bad: b } = childrenOf(f);
      if (b) bad = true;
      for (const k of kids) if (!seen.has(k)) { seen.add(k); stack.push(k); }
    }
    const rel = new Set([...seen].map((f) => relative(root, f)));
    deps.set(t, rel);
    for (const f of rel) covered.add(f);
    if (bad) unresolved.add(t);
  }
  return { deps, unresolved, covered };
}

export interface Selection {
  /** The tests to run. */
  files: string[];
  /** Why — for the runner to print, because a silent skip is indistinguishable
   *  from a pass and this tool's whole risk is skipping the wrong thing. */
  reason: string;
  /** True when the selection is "everything", so the caller may still treat the
   *  run as a full pass (and write the cache stamp). */
  full: boolean;
}

/**
 * The tests worth running for a given set of changed files.
 *
 * Returns everything — and says so — whenever the analysis cannot account for a
 * change (rule 2) or nothing changed at all.
 */
export function selectAffected(
  graph: ImpactGraph, allTests: readonly string[], changed: readonly string[],
): Selection {
  if (changed.length === 0) {
    return { files: [...allTests], reason: 'nothing changed — running everything', full: true };
  }
  const unmapped = changed.filter((c) => !graph.covered.has(c));
  if (unmapped.length) {
    return {
      files: [...allTests],
      reason: `${unmapped.length} changed file(s) outside the import graph `
        + `(${unmapped.slice(0, 3).join(', ')}${unmapped.length > 3 ? ', …' : ''}) — running everything`,
      full: true,
    };
  }
  const changedSet = new Set(changed);
  const picked = allTests.filter((t) =>
    graph.unresolved.has(t) || [...(graph.deps.get(t) ?? [])].some((d) => changedSet.has(d)));
  if (picked.length === allTests.length) {
    return { files: [...allTests], reason: 'every test depends on something that changed', full: true };
  }
  return {
    files: picked,
    reason: `${picked.length}/${allTests.length} test files reach the ${changed.length} changed file(s)`,
    full: false,
  };
}
