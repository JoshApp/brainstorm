/**
 * Perf A/B CLI — compare a scenario across two or more flag configs and print
 * the DELTAS, so "what does this knob actually cost" is one command, not two
 * runs you eyeball side by side. Boots Vite + the browser ONCE and reloads the
 * page per variant, so it's also faster than N separate `npm run perf` runs.
 *
 *   # the canonical lamp-shadow A/B (the default when no variants given):
 *   npm run perf:ab perf-horde phone
 *
 *   # explicit variants — each token is a comma-joined flag set; first = baseline:
 *   npm run perf:ab perf-horde phone shadows=hero shadows=off
 *   npm run perf:ab perf-creatures phone n=8 n=16            # per-creature cost
 *   npm run perf:ab perf-items phone n=1 n=6 n=20            # ground-item pile scaling
 *   npm run perf:ab perf-max phone base shadows=off portalcull=1
 *
 * `base` / `-` / `default` as a token means "no flags" (a clean baseline).
 * Counts are deterministic (see perf-core.ts) so these deltas reproduce on any
 * machine — that's the whole point of measuring deltas instead of FPS.
 */

import { withHarness, parseCommonArgs, num, padL, pad, type PerfAggregate, type SampleConfig } from './perf-core';

/** A variant token → URL flags. "shadows=off,n=16" → { shadows:'off', n:'16' };
 *  "base"/"-"/"default" → {} (a clean run). */
function parseVariant(token: string): { flags: Record<string, string>; label: string } {
  if (token === 'base' || token === '-' || token === 'default') return { flags: {}, label: 'base' };
  const flags: Record<string, string> = {};
  for (const piece of token.split(',')) {
    const eq = piece.indexOf('=');
    if (eq === -1) flags[piece] = '1';
    else flags[piece.slice(0, eq)] = piece.slice(eq + 1);
  }
  return { flags, label: token };
}

function delta(v: number, base: number): string {
  const d = v - base;
  if (Math.abs(d) < 0.0005) return '—';
  return (d > 0 ? '+' : '') + num(d, Number.isInteger(d) ? 0 : 1);
}

function printComparison(results: PerfAggregate[]): void {
  const base = results[0];
  const W = { name: 22, n: 9, d: 10 };
  const head =
    `  ${pad('variant', W.name)}${padL('draws', W.n)}${padL('Δ', W.d)}` +
    `${padL('tris', W.n + 2)}${padL('Δ', W.d)}${padL('lights', W.n)}${padL('alloc/s', W.n)}`;
  console.log('\n' + head);
  console.log('  ' + '─'.repeat(head.length - 2));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const isBase = i === 0;
    const name = r.label + (isBase ? ' (base)' : '');
    const alloc = r.allocRateMBs ? num(r.allocRateMBs.avg, 1) : 'n/a';
    console.log(
      `  ${pad(name, W.name)}` +
      `${padL(num(r.draws.avg), W.n)}${padL(isBase ? '—' : delta(r.draws.avg, base.draws.avg), W.d)}` +
      `${padL(num(r.tris.avg), W.n + 2)}${padL(isBase ? '—' : delta(r.tris.avg, base.tris.avg), W.d)}` +
      `${padL(num(r.lightsActive.avg, 1), W.n)}${padL(alloc, W.n)}`,
    );
  }
  console.log('  ' + '─'.repeat(head.length - 2));
  console.log(`  (avg over the sample window · counts deterministic · Δ vs base)\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const { positionals, viewport, viewportName, secs, port } = parseCommonArgs(argv);
  const scenario = positionals[0] ?? 'perf-horde';
  // Remaining positionals are variant tokens; default to the lamp-shadow A/B.
  const tokens = positionals.slice(1);
  const variants = (tokens.length ? tokens : ['shadows=hero', 'shadows=off']).map(parseVariant);

  console.log(
    `\nPERF A/B · scenario "${scenario}" · ${viewportName} ${viewport.width}×${viewport.height}` +
    ` · ${secs}s · ${variants.length} variants`,
  );

  await withHarness({ viewport, port, onLog: (l) => console.log('  ' + l) }, async (h) => {
    const results: PerfAggregate[] = [];
    for (const v of variants) {
      const cfg: SampleConfig = { scenario, flags: v.flags, secs, label: v.label };
      results.push(await h.sample(cfg));
    }
    printComparison(results);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
