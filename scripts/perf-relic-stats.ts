// CPU-only stress probe: repeated live stat reads with a growing reliquary.
// npm exec tsx scripts/perf-relic-stats.ts
import { performance } from 'node:perf_hooks';
import { computePlayerStats } from '../src/combat/modifiers';
import { addRelic, clearReliquary } from '../src/player/reliquary';
import type { ItemSpec } from '../src/content/items';

for (const count of [0, 20, 100]) {
  clearReliquary();
  for (let i = 0; i < count; i++) {
    addRelic({ id: `perf-${i % 20}`, modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'crit-chance', amount: 0.01, stack: 'hyperbolic' },
    ] } as ItemSpec);
  }
  for (let i = 0; i < 5000; i++) computePlayerStats();
  const rounds: number[] = [];
  let damage = 0;
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let i = 0; i < 20000; i++) damage = computePlayerStats().weaponDamageBonus;
    rounds.push(performance.now() - start);
  }
  rounds.sort((a, b) => a - b);
  console.log(JSON.stringify({ relics: count, reads: 20000, medianMs: rounds[2], damage }));
}
clearReliquary();
