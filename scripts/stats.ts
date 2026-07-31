/**
 * delve stats <bundle.json> — read a telemetry export and print balance tables.
 *
 * Input is the JSON produced by the in-game DEV export (__telemetry(), which
 * calls src/debug/telemetry-export.ts). No backend, no browser — pure offline
 * balancing from your own play history.
 *
 *   npm run delve stats delve-telemetry-1699999999999.json
 *
 * Prints: meta summary, a death-by-cause histogram (what kills you), a
 * depth-reached histogram (where runs end — the bounce signal), and per-run
 * averages (kills, items, minutes). The death-by-cause + depth histograms are
 * the two most actionable balance reads.
 */
import { readFileSync } from 'node:fs';

interface Ev { t: number; event: string; props: Record<string, unknown> }
interface Bundle { build?: string; exportedAt?: number; meta?: Record<string, unknown>; events?: Ev[] }

function num(v: unknown): number { return typeof v === 'number' ? v : 0; }

function histogram(title: string, counts: Map<string, number>, unit = ''): void {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows.reduce((m, [, c]) => Math.max(m, c), 1);
  const total = rows.reduce((s, [, c]) => s + c, 0);
  console.log(`\n${title}  (n=${total})`);
  for (const [k, c] of rows) {
    const bar = '█'.repeat(Math.round((c / max) * 28));
    const pct = total ? ((c / total) * 100).toFixed(0) : '0';
    console.log(`  ${k.padEnd(20)} ${String(c).padStart(4)} ${pct.padStart(3)}%  ${bar}${unit}`);
  }
}

function main(): void {
  const path = process.argv[2];
  if (!path) { console.error('usage: delve stats <bundle.json>'); process.exit(1); }
  let bundle: Bundle;
  try { bundle = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { console.error(`cannot read ${path}: ${(e as Error).message}`); process.exit(1); }

  const events = bundle.events ?? [];
  const meta = bundle.meta ?? {};
  const deaths = events.filter((e) => e.event === 'death');
  const runStarts = events.filter((e) => e.event === 'run_start');

  console.log(`\nDELVE STATS  —  build ${bundle.build ?? '?'}  ·  ${events.length} events  ·  ${deaths.length} deaths logged`);

  // ── Meta summary (lifetime aggregate) ──
  console.log('\nLIFETIME (meta-state)');
  const rows: [string, unknown][] = [
    ['runs attempted', meta.runsAttempted],
    ['runs died', meta.runsDied],
    ['deepest depth', meta.deepestDepth],
    ['total kills', meta.totalKills],
    ['unique enemies slain', Array.isArray(meta.enemiesSlain) ? meta.enemiesSlain.length : 0],
    ['unique items found', Array.isArray(meta.itemsFound) ? meta.itemsFound.length : 0],
    ['play time (min)', Math.round(num(meta.totalPlayMs) / 60000)],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} ${v ?? 0}`);

  if (deaths.length === 0) {
    console.log('\n(no death events in this bundle — play a few runs, then __telemetry() again)');
    return;
  }

  // ── Death-by-cause: what actually kills you ──
  const byCause = new Map<string, number>();
  for (const d of deaths) {
    const cause = String(d.props.killedBy ?? 'the dark');
    byCause.set(cause, (byCause.get(cause) ?? 0) + 1);
  }
  histogram('DEATH BY CAUSE — what kills you', byCause);

  // ── Depth-reached: where runs end (the bounce/wall signal) ──
  const byDepth = new Map<string, number>();
  for (const d of deaths) {
    const depth = num(d.props.depth);
    byDepth.set(`depth ${depth}`, (byDepth.get(`depth ${depth}`) ?? 0) + 1);
  }
  histogram('RUNS ENDED AT DEPTH — where the wall is', byDepth);

  // ── Per-run averages ──
  const avg = (sel: (d: Ev) => number) => (deaths.reduce((s, d) => s + sel(d), 0) / deaths.length);
  console.log('\nPER-RUN AVERAGES (from death events)');
  console.log(`  kills / run          ${avg((d) => num(d.props.kills)).toFixed(1)}`);
  console.log(`  items found / run    ${avg((d) => num(d.props.itemsFound)).toFixed(1)}`);
  console.log(`  minutes / run        ${avg((d) => num(d.props.elapsedMs) / 60000).toFixed(1)}`);
  console.log(`  deepest / run        ${avg((d) => num(d.props.depth)).toFixed(1)}`);
  console.log(`  run_start events     ${runStarts.length}`);
  console.log('');
}

main();
