// CI helper: promote the NEWEST run of each relic subject, so bake-relics.ts has
// promoted art to bake. Used by the relic-art workflow's auto path (generate one
// candidate → promote it → bake). For hand-curation, skip this and
// `delve art promote rX` the runs you actually want instead.
//
//   npx tsx scripts/art-promote-relics.ts [all | <id> <id> …]
//
import { RELIC_ART } from '../src/art/relic-art';
import { runsFor } from '../src/art/runs';
import * as M from './art-runs';

const args = process.argv.slice(2).filter((a) => a !== 'all');
const wanted = args.length ? new Set(args) : new Set(RELIC_ART.map((r) => r.id));

const m = M.load();
let promoted = 0;
for (const spec of RELIC_ART) {
  if (!wanted.has(spec.id)) continue;
  const runs = runsFor(m, spec.id);          // oldest → newest
  const newest = runs[runs.length - 1];
  if (!newest) { console.log(`  no runs for ${spec.id}`); continue; }
  M.promote(m, newest.id);
  promoted++;
  console.log(`  ${spec.id.padEnd(20)} → ${newest.id}`);
}
M.save(m);
console.log(`\npromoted ${promoted} relic run(s).`);
