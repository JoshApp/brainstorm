// Prints each weapon's class, reachMul, and (derived) reach. Run: npx tsx scripts/reach-report.ts
import { ITEMS } from '../src/content/items';

const rows: Array<[string, string, number, number, boolean]> = [];
for (const [id, item] of Object.entries(ITEMS)) {
  const w = item.weapon;
  if (!w) continue;
  const ranged = !!w.ranged;
  rows.push([id, w.class, w.reachMul ?? 1, w.reach ?? -1, ranged]);
}
rows.sort((a, b) => a[3] - b[3]);
console.log('reach   class        mul   id');
for (const [id, cls, mul, reach, ranged] of rows) {
  const tag = ranged ? ' (ranged/explicit)' : '';
  console.log(`${reach.toFixed(3).padStart(6)}  ${cls.padEnd(11)}  ${mul.toFixed(2)}  ${id}${tag}`);
}
