// REPRO-FROM-REPORT — turn a player bug report into a deterministic repro of the
// exact floor it happened on. A report captures the run SEED + DEPTH, and the
// game boots any seed+depth via ?seed=&depth=&dev=1 (the seeded-jump path), so a
// report is directly reproducible.
//
//   npm run delve repro <report.json>          # print the repro summary + URL
//   npm run delve repro <report.json> --snap   # also headless-snap that floor
//   npm run delve repro --id 42                # pull report #42 from the collector first
//
// With --id it fetches from the collector (REPORT_ENDPOINT / REPORT_READ_KEY, same
// env as `delve reports`). Closes the self-development loop: report → repro → fix.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

interface Report {
  build?: string;
  at?: number;
  userText?: string;
  run?: { seed?: number | null; depth?: number | null; floorId?: string | null };
  device?: { viewport?: { w: number; h: number }; userAgent?: string };
}

function has(name: string) { return process.argv.includes(name); }
function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadReport(): Promise<Report> {
  const id = argVal('--id');
  if (id) {
    const endpoint = process.env.REPORT_ENDPOINT;
    const key = process.env.REPORT_READ_KEY;
    if (!endpoint || !key) throw new Error('Set REPORT_ENDPOINT + REPORT_READ_KEY to use --id (see scripts/reports.ts).');
    const res = await fetch(`${endpoint}?id=eq.${encodeURIComponent(id)}&select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Collector ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as Array<{ data?: Report }>;
    if (!rows.length || !rows[0].data) throw new Error(`No report #${id}.`);
    return rows[0].data;
  }
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('Usage: delve repro <report.json> [--snap]  |  delve repro --id <n> [--snap]');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  // Accept a raw report, or a collector row ({ data: report }).
  return (parsed.data ?? parsed) as Report;
}

async function main() {
  const r = await loadReport();
  const seed = r.run?.seed;
  const depth = r.run?.depth ?? 1;
  const text = (r.userText ?? '').trim() || '(no description)';

  console.log('\n── REPORT ─────────────────────────────────────────────');
  console.log(`build:  ${r.build ?? '?'}`);
  console.log(`floor:  depth ${depth}${r.run?.floorId ? ` (${r.run.floorId})` : ''}`);
  console.log(`seed:   ${seed ?? '(none — not reproducible)'}`);
  if (r.device?.viewport) console.log(`device: ${r.device.viewport.w}×${r.device.viewport.h}`);
  console.log(`\n"${text}"`);
  console.log('───────────────────────────────────────────────────────\n');

  if (seed == null) {
    console.log('This report carries no seed, so the floor cannot be reproduced deterministically.');
    return;
  }

  const reproScenario = `run-${seed}-${depth}`;
  console.log('Reproduce it:');
  console.log(`  headless snap:  npm run delve snap ${reproScenario} phone`);
  console.log(`  in a browser:   /brainstorm/?autostart=1&seed=${seed}&depth=${depth}&dev=1\n`);

  if (has('--snap')) {
    const viewport = argVal('--viewport') ?? 'phone';
    console.log(`Snapping ${reproScenario} (${viewport})…`);
    const res = spawnSync('npm', ['run', 'delve', 'snap', reproScenario, viewport], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
