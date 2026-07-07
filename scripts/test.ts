// Test runner — globs tests/*.test.ts and runs each in its OWN tsx process.
//
// Isolation is deliberate: the codebase leans on module-level mutable state
// (getter/setter singletons), so tests must not share one process or they'd
// leak state into each other. Each file gets a fresh tsx run, exactly like the
// old hand-chained `&&` list did — but now the list maintains itself. Drop a
// new tests/*.test.ts file and it's picked up; no package.json edit.
//
//   npm test              # run everything
//   tsx tests/foo.test.ts # still run one file directly

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const files = readdirSync(join(root, 'tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

const start = Date.now();
const failures: string[] = [];
for (const f of files) {
  const r = spawnSync(tsx, [join('tests', f)], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) failures.push(f);
}

const secs = ((Date.now() - start) / 1000).toFixed(1);
console.log('\n' + '─'.repeat(52));
if (failures.length === 0) {
  console.log(`✓ ${files.length} test files passed  (${secs}s)`);
} else {
  console.log(`✗ ${failures.length}/${files.length} test files FAILED  (${secs}s)`);
  for (const f of failures) console.log(`    tests/${f}`);
  process.exit(1);
}
