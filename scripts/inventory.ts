/**
 * delve inventory — print/export the WHOLE game catalog.
 *
 * Walks every content registry and emits a normalized catalog: one row per
 * entity (enemies, items, weapons, relics, bosses, cards, rites, affixes,
 * drop tables) with its id, name, include-flag `status`, and the key
 * balance fields. The point is a single source of truth a human OR the planned
 * AI-authoring layer can consume — "what does this game contain right now?" —
 * without reading 20 content files.
 *
 *   npm run delve inventory                 console summary + per-family listing
 *   npm run delve inventory --json out.json full structured dump to disk
 *   npm run delve inventory --md   out.md   markdown tables to disk
 *   npm run delve inventory --status=dev    only rows with that status
 *
 * Node-safe: imports the content registries directly (same as scripts/balance.ts
 * and `delve list`). No browser.
 */
import { writeFileSync } from 'node:fs';
import { ENEMIES } from '../src/content/enemies';
import { ITEMS } from '../src/content/items';
import { BOSSES } from '../src/content/bosses';
import { CARDS } from '../src/content/cards';
import { RITES } from '../src/content/rites';
import { AFFIXES } from '../src/content/affixes';
import { SETS } from '../src/content/sets';
import { TABLES } from '../src/content/drop-tables';
import { statusOf, type ContentStatus } from '../src/content/content-status';

// A flattened catalog row — the shape every family collapses to. `fields` holds
// the family-specific balance columns as plain data so JSON/MD/console all read
// from one structure.
interface Row {
  family: string;
  id: string;
  name: string;
  status: ContentStatus;
  fields: Record<string, string | number | boolean | undefined>;
}

/** Read an optional field off a spec without fighting per-family types. */
function f(o: unknown, key: string): string | number | boolean | undefined {
  if (o == null || typeof o !== 'object') return undefined;
  const v = (o as Record<string, unknown>)[key];
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.join('/');
  if (typeof v === 'object') return JSON.stringify(v);
  return v as string | number | boolean;
}

function buildCatalog(): Row[] {
  const rows: Row[] = [];
  const push = (family: string, id: string, name: string, spec: unknown, fields: Row['fields']) =>
    rows.push({ family, id, name, status: statusOf(spec as { status?: ContentStatus }), fields });

  for (const [id, e] of Object.entries(ENEMIES)) {
    push('enemy', id, e.name, e, {
      hp: f(e, 'hp'), boss: f(e, 'isBoss'), tile: f(e, 'tileChar'),
      ranged: (e as Record<string, unknown>).ranged ? true : undefined,
      splits: f(e, 'splitsInto'),
    });
  }
  for (const [id, it] of Object.entries(ITEMS)) {
    const fam = it.kind === 'weapon' ? 'weapon' : it.kind === 'relic' ? 'relic' : 'item';
    push(fam, id, it.name, it, {
      kind: it.kind, rarity: f(it, 'rarity'), domain: f(it, 'domain'), set: f(it, 'setId'),
      minDepth: f(it.drop, 'minDepth'), weight: f(it.drop, 'weight'),
      pool: f(it.drop, 'pool'), noDrop: f(it.drop, 'noDrop'),
    });
  }
  for (const [id, b] of Object.entries(BOSSES)) {
    push('boss', id, f(b, 'defaultName') as string ?? id, b, {
      enemy: b.enemyId,
    });
  }
  for (const [id, c] of Object.entries(CARDS)) {
    push('card', id, c.name, c, { arcana: f(c, 'arcana'), domains: f(c, 'domains'), fate: f(c, 'fate') });
  }
  for (const [id, r] of Object.entries(RITES)) {
    push('rite', id, r.name, r, { domain: f(r, 'domain'), hunger: f(r, 'hungerCost'), fate: f(r, 'fate') });
  }
  for (const [id, a] of Object.entries(AFFIXES)) {
    push('affix', id, f(a, 'suffix') as string ?? id, a, { suffix: f(a, 'suffix'), weight: f(a, 'weight') });
  }
  for (const [id, s] of Object.entries(SETS)) {
    push('set', id, f(s, 'name') as string ?? id, s, {});
  }
  for (const [id, t] of Object.entries(TABLES)) {
    push('droptable', id, id, t, { pools: (t as { pools?: unknown[] }).pools?.length });
  }
  return rows;
}

function fmtFields(fields: Row['fields']): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

function printConsole(rows: Row[]): void {
  const families = [...new Set(rows.map((r) => r.family))];
  // Summary: counts per family × status.
  console.log('\nINVENTORY — counts by family × status\n');
  const statuses: ContentStatus[] = ['release', 'dev', 'draft'];
  console.log(`  ${'family'.padEnd(12)} ${statuses.map((s) => s.padStart(8)).join('')}   total`);
  for (const fam of families) {
    const fr = rows.filter((r) => r.family === fam);
    const counts = statuses.map((s) => String(fr.filter((r) => r.status === s).length).padStart(8));
    console.log(`  ${fam.padEnd(12)} ${counts.join('')}   ${String(fr.length).padStart(5)}`);
  }
  console.log(`  ${'—'.repeat(12)} ${''.padStart(24)}   ${String(rows.length).padStart(5)}\n`);
  // Per-family listing — status flagged so non-release content is obvious.
  for (const fam of families) {
    const fr = rows.filter((r) => r.family === fam);
    console.log(`${fam.toUpperCase()} (${fr.length})`);
    for (const r of fr) {
      const flag = r.status === 'release' ? '' : `[${r.status.toUpperCase()}] `;
      console.log(`  ${flag}${r.id.padEnd(22)} ${fmtFields(r.fields)}`.trimEnd());
    }
    console.log('');
  }
}

function toMarkdown(rows: Row[]): string {
  const families = [...new Set(rows.map((r) => r.family))];
  let out = '# DELVE — Content Inventory\n\n';
  out += `Total ${rows.length} entries across ${families.length} families.\n\n`;
  for (const fam of families) {
    const fr = rows.filter((r) => r.family === fam);
    const cols = [...new Set(fr.flatMap((r) => Object.keys(r.fields)))];
    out += `## ${fam} (${fr.length})\n\n`;
    out += `| id | name | status | ${cols.join(' | ')} |\n`;
    out += `|---|---|---|${cols.map(() => '---').join('|')}|\n`;
    for (const r of fr) {
      const cells = cols.map((c) => String(r.fields[c] ?? ''));
      out += `| ${r.id} | ${r.name} | ${r.status} | ${cells.join(' | ')} |\n`;
    }
    out += '\n';
  }
  return out;
}

export function runInventory(argv: string[]): void {
  let rows = buildCatalog();
  const statusArg = argv.find((a) => a.startsWith('--status='))?.split('=')[1];
  if (statusArg) rows = rows.filter((r) => r.status === statusArg);

  const jsonPath = argv[argv.indexOf('--json') + 1];
  const mdPath = argv[argv.indexOf('--md') + 1];

  if (argv.includes('--json') && jsonPath && !jsonPath.startsWith('--')) {
    writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
    console.log(`Wrote ${rows.length} entries → ${jsonPath}`);
  }
  if (argv.includes('--md') && mdPath && !mdPath.startsWith('--')) {
    writeFileSync(mdPath, toMarkdown(rows));
    console.log(`Wrote markdown → ${mdPath}`);
  }
  if (!argv.includes('--json') && !argv.includes('--md')) printConsole(rows);
}

// Run when invoked directly (tsx scripts/inventory.ts …), not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  runInventory(process.argv.slice(2));
}
