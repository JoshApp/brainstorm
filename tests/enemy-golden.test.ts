// Enemy behaviour golden — every enemy spec, one scripted fight, compared
// sample by sample to tests/golden/enemy-trace.txt (see tests/enemy-trace.ts
// for what is driven and recorded).
//
// This is the net under the createEnemy split (docs/OPEN-ITEMS.md, Phase 3):
// a refactor that only MOVES code reproduces the golden exactly. If this
// fails after a change you MEANT to make (a tuning, a new ability), re-record:
//
//   npx tsx tests/enemy-trace.ts --write
//
// and say in the commit what moved. If it fails after a refactor, the first
// diverging sample below names the spec, the tick and the column.
//
//   npm test -- enemy-golden

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traceAll, parseGolden, GOLDEN } from './enemy-trace';

const COLUMNS = 'tick state intent moveMode release x y z yaw hp poise aggression alive dying playerDmg nodes/visible posSum rotSum scaleSum sceneChildren addsAlive';

const golden = parseGolden(readFileSync(GOLDEN, 'utf8'));
const now = traceAll();

assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort(),
  'the set of enemy specs changed — re-record the golden (npx tsx tests/enemy-trace.ts --write)');

const diverged: string[] = [];
for (const id of Object.keys(golden)) {
  const a = golden[id], b = now[id];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      diverged.push(`${id} @ sample ${i}\n    golden: ${a[i]}\n    now:    ${b[i]}`);
      break;
    }
  }
}
assert.equal(diverged.length, 0,
  `${diverged.length} enemy spec(s) behave differently from the golden.\n  columns: ${COLUMNS}\n  ${diverged.join('\n  ')}`);
console.log(`enemy-golden: ${Object.keys(golden).length} specs match`);
