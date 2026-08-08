// THE TOOL THAT DECIDES WHAT NOT TO RUN.
//
// `npm test -- --affected` runs only the tests whose import graph reaches a
// changed file. That turns a ten-minute suite into a short one, and it is the
// most dangerous thing in this repo, because its failure mode is not a broken
// build — it is a GREEN RUN THAT NEVER EXECUTED the test that would have caught
// the bug. A slow suite costs minutes; a suite that quietly skipped the right
// file costs a shipped regression and the belief that it was verified.
//
// So the selector is tested harder than the thing it selects, and every test
// here is about the SAFE direction:
//
//   - a real dependency is never missed, transitively
//   - anything unresolvable poisons its test into always running
//   - a change the graph cannot place runs everything
//   - "everything" is reported as full, so the cache stamp stays honest
//
// Over-selection is not a bug here and is not asserted against: running a few
// extra files is the cost of being sure.
//
//   npm test -- test-impact

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { buildImpactGraph, selectAffected } from '../scripts/test-impact';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** A throwaway repo: tests/ + src/, with the import shape each case needs. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'impact-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}
const testsIn = (root: string) => readdirSync(join(root, 'tests')).sort();

test('A DIRECT DEPENDENCY IS SELECTED', () => {
  const root = fixture({
    'tests/a.test.ts': `import { x } from '../src/a';\n`,
    'tests/b.test.ts': `import { y } from '../src/b';\n`,
    'src/a.ts': `export const x = 1;\n`,
    'src/b.ts': `export const y = 2;\n`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  const sel = selectAffected(g, testsIn(root), ['src/a.ts']);
  assert.deepEqual(sel.files, ['a.test.ts']);
  assert.equal(sel.full, false);
  rmSync(root, { recursive: true, force: true });
});

test('AND SO IS A DEPENDENCY FOUR MODULES DEEP', () => {
  // The whole point is TRANSITIVE reach. A selector that only looked at direct
  // imports would skip the test that actually covers the change, which is the
  // exact failure this file exists to prevent.
  const root = fixture({
    'tests/deep.test.ts': `import { a } from '../src/a';\n`,
    'src/a.ts': `import { b } from './b';\nexport const a = b;\n`,
    'src/b.ts': `import { c } from './c';\nexport const b = c;\n`,
    'src/c.ts': `import { d } from './d';\nexport const c = d;\n`,
    'src/d.ts': `export const d = 1;\n`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  const sel = selectAffected(g, testsIn(root), ['src/d.ts']);
  assert.deepEqual(sel.files, ['deep.test.ts'], 'a four-deep dependency was not reached');
  rmSync(root, { recursive: true, force: true });
});

test('A CYCLE DOES NOT HANG OR HIDE ANYTHING', () => {
  // src/ has real import cycles; a naive walk either loops forever or bails.
  const root = fixture({
    'tests/cyc.test.ts': `import { a } from '../src/a';\n`,
    'src/a.ts': `import { b } from './b';\nexport const a = 1;\n`,
    'src/b.ts': `import { a } from './a';\nexport const b = 2;\n`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  assert.deepEqual(selectAffected(g, testsIn(root), ['src/b.ts']).files, ['cyc.test.ts']);
  rmSync(root, { recursive: true, force: true });
});

test('AN UNRESOLVABLE IMPORT MAKES ITS TEST ALWAYS RUN', () => {
  // The poison rule. A relative import this resolver does not understand could
  // be hiding any dependency at all, so the only safe reading is "everything".
  // Silence must never be read as "no dependency".
  const root = fixture({
    'tests/mystery.test.ts': `import { z } from '../src/gone';\n`,
    'tests/plain.test.ts': `import { y } from '../src/b';\n`,
    'src/b.ts': `export const y = 2;\n`,
    'src/other.ts': `export const q = 3;\n`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  assert.ok(g.unresolved.has('mystery.test.ts'), 'a broken import did not poison its test');
  const sel = selectAffected(g, testsIn(root), ['src/other.ts']);
  assert.ok(sel.files.includes('mystery.test.ts'),
    'a test with an unresolvable import was skipped — it could depend on anything');
  rmSync(root, { recursive: true, force: true });
});

test('A CHANGE THE GRAPH CANNOT PLACE RUNS EVERYTHING', () => {
  // package.json, tsconfig, a shell script, a fixture, the runner itself. The
  // blast radius of these is exactly what this analysis cannot see.
  const root = fixture({
    'tests/a.test.ts': `import { x } from '../src/a';\n`,
    'src/a.ts': `export const x = 1;\n`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  const sel = selectAffected(g, testsIn(root), ['package.json']);
  assert.equal(sel.files.length, testsIn(root).length);
  assert.equal(sel.full, true, 'an unmapped change must report a FULL run so the stamp stays honest');
  rmSync(root, { recursive: true, force: true });
});

test('AND SO DOES CHANGING NOTHING', () => {
  const root = fixture({
    'tests/a.test.ts': `import { x } from '../src/a';\n`,
    'src/a.ts': `export const x = 1;\n`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  const sel = selectAffected(g, testsIn(root), []);
  assert.equal(sel.full, true);
  rmSync(root, { recursive: true, force: true });
});

test('A TEST FILE THAT ITSELF CHANGED IS SELECTED', () => {
  // Its own path is in its dependency set (the walk starts there), so editing a
  // test runs that test. Obvious, and it would be a maddening thing to get
  // wrong: you would edit an assertion and never see it execute.
  const root = fixture({
    'tests/a.test.ts': `import { x } from '../src/a';\n`,
    'tests/b.test.ts': `import { x } from '../src/a';\n`,
    'src/a.ts': `export const x = 1;\n`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  assert.deepEqual(selectAffected(g, testsIn(root), ['tests/a.test.ts']).files, ['a.test.ts']);
  rmSync(root, { recursive: true, force: true });
});

test('VITE ASSET QUERIES RESOLVE INSTEAD OF POISONING', () => {
  // `./x.woff2?url` is a real file plus a build-time instruction. Unhandled, it
  // was the ONLY unresolved import in the repo — and because the poison rule is
  // transitive it marked every test reaching ui/fonts.ts (36 of 109) as
  // depending on everything. Safe, and a third of the suite unskippable for a
  // reason that was pure parsing.
  const root = fixture({
    'tests/a.test.ts': `import { f } from '../src/fonts';\n`,
    'tests/b.test.ts': `import { y } from '../src/b';\n`,
    'src/fonts.ts': `import url from '../assets/x.woff2?url';\nexport const f = url;\n`,
    'src/b.ts': `export const y = 1;\n`,
    'assets/x.woff2': `binary-ish`,
  });
  const g = buildImpactGraph(root, testsIn(root));
  assert.equal(g.unresolved.size, 0, 'a ?url asset import was treated as unresolvable');
  assert.deepEqual(selectAffected(g, testsIn(root), ['assets/x.woff2']).files, ['a.test.ts'],
    'the asset itself should select the test that reaches it');
  rmSync(root, { recursive: true, force: true });
});

test('THE REAL REPO RESOLVES CLEANLY AND STILL NARROWS', () => {
  // Against the actual tests/ + src/, because every fixture above is a shape I
  // chose and the repo is the thing this runs on. Two claims:
  //   - nothing is unresolvable, so the poison rule is not silently making the
  //     whole suite unskippable (it was, for 36 files, until ?url was handled);
  //   - a leaf module selects a real subset, so the tool does something at all.
  const root = join(import.meta.dirname, '..');
  const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.ts')).sort();
  const g = buildImpactGraph(root, files);
  assert.equal(g.unresolved.size, 0,
    `${g.unresolved.size} test files have unresolvable imports and will always run: `
    + `${[...g.unresolved].slice(0, 5).join(', ')}`);
  const sel = selectAffected(g, files, ['src/level/poly-floor.ts']);
  assert.ok(sel.files.length < files.length,
    'changing one level module selected the entire suite — the graph is not narrowing');
  assert.ok(sel.files.includes('poly-floor.test.ts') && sel.files.includes('poly-spawns.test.ts'),
    'the tests that directly cover poly-floor were not selected');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
