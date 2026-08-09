/**
 * delve — the creator-suite front door. One CLI for author / preview / debug /
 * play, so you don't memorise six script names. Native commands (list, check)
 * run instantly in Node; the browser-driven ones delegate to their scripts.
 *
 *   npm run delve                          this index
 *   npm run delve list [mobs|items]        what can I point the tools at?
 *   npm run delve weapons                  weapon stat table (derived reach · class · arc)
 *   npm run delve bench <subject> [...]    MODEL author/inspect loop (--hand --ortho --debug)
 *   npm run delve check <seed> <depth>     fast STATIC floor analysis (no browser)
 *   npm run delve reach <seed> <depth>     FAITHFUL reachability (live walkable, browser)
 *   npm run delve snap  <target> [...]     headless screenshot (mob-<id>, item-<id>, scenario)
 *   npm run delve pilot <target> [--do …]  drive + inspect the live world
 *   npm run delve play  [...]              autonomous bot episode
 *   npm run delve test                     validation suite
 */
import { spawn } from 'node:child_process';
import { ENEMIES } from '../src/content/enemies';
import { ITEMS } from '../src/content/items';
import { generateFloor } from '../src/level/procgen';

const [cmd, ...rest] = process.argv.slice(2);

/** Hand off to a sibling script (browser tools own their own boot). */
function delegate(script: string, args: string[] = rest) {
  const p = spawn('npx', ['tsx', `scripts/${script}.ts`, ...args], { stdio: 'inherit' });
  p.on('exit', (c) => process.exit(c ?? 0));
}

function index() {
  console.log(`
DELVE — creator suite (author · preview · debug · play)

  MODELS & CONTENT
  delve list [mobs|items]           what can I point the tools at?
  delve inventory [--json f|--md f] FULL catalog (all families + include-flag status)
  delve audit [--floors N|--json f]  THEORETICAL telemetry — sweep the generator, read
                                      the loot economy + research-grounded health flags
  delve stats <bundle.json>         balance tables from an in-game telemetry export
  delve reports [--limit N|--dump]  pull player-filed bug reports from the collector
  delve weapons                     weapon stat table — derived reach · class · arc
  delve bench <subject> [flags]     author/inspect a MODEL (viewmodel-<id>, mob-<id>, model-<id>)
                                      --hand drop into the hand · --ortho 4-view · --debug slots+bbox
  delve art [<id>|--all]            generate 2D illustrations (tarot cards) → public/art/cards/
  delve ui <specimen>               menu fit across phones + desktop, with an overflow report
  delve optimize [dir]              PNG → webp for shipped assets (default public/textures)

  WORLD & PLAY
  delve check <seed> <depth>        fast STATIC floor analysis (overlap / archway / reachability)
  delve reach <seed> <depth>        FAITHFUL reachability — live walkable, real collision (browser)
  delve snap  <target> [vp] [--frames=N]   screenshot: mob-<id>, item-<id>, any scenario
  delve play  [--seed N --turns T]         autonomous bot episode
  delve test                        validation suite (load + floor invariants)

registry: ${Object.keys(ENEMIES).length} mobs · ${Object.keys(ITEMS).length} items
(prefix npm: e.g. \`npm run delve check 1780376544217 4\`)
`);
}

function list(kind = 'all') {
  if (kind === 'mobs' || kind === 'all') {
    console.log(`\nMOBS (${Object.keys(ENEMIES).length})  —  snap mob-<id>`);
    for (const [id, e] of Object.entries(ENEMIES)) {
      console.log(`  ${id.padEnd(18)} ${e.tileChar ? `'${e.tileChar}'` : '  '} ${e.isBoss ? 'BOSS' : ''}`.trimEnd());
    }
  }
  if (kind === 'items' || kind === 'all') {
    console.log(`\nITEMS (${Object.keys(ITEMS).length})  —  snap item --item <id>`);
    for (const id of Object.keys(ITEMS)) console.log(`  ${id}`);
  }
}

/** Fast static analysis of one floor — the same guards the CI sweep runs,
 *  printed for a single seed. STATIC (rect + emitted-prop collision); for the
 *  faithful built-collision version use `delve reach`. */
function check(seed: number, depth: number) {
  const spec = generateFloor(depth, seed) as unknown as {
    rooms: Array<{ rect: { x: number; z: number; w: number; d: number }; logicalOnly?: boolean }>;
    corridors: Array<{ rect: { x: number; z: number; w: number; d: number } }>;
    stairs?: Array<{ x: number; z: number }>;
    props: Array<{ _dbg?: string; x: number; z: number; collision?: unknown[] }>;
    voids?: Array<{ x: number; z: number; w: number; d: number }>;
    startPos: { x: number; z: number };
  };
  const issues: string[] = [];
  const rooms = spec.rooms.filter((r) => !r.logicalOnly).map((r) => r.rect);

  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    const pen = Math.min((a.w + b.w) / 2 - Math.abs(a.x - b.x), (a.d + b.d) / 2 - Math.abs(a.z - b.z));
    if (pen > 0.05) issues.push(`room overlap ${pen.toFixed(2)}m`);
  }
  for (const p of spec.props) if (p._dbg === 'archway' && p.collision) for (const st of spec.stairs ?? []) {
    const d = Math.hypot(p.x - st.x, p.z - st.z);
    if (d <= 3.5) issues.push(`column-archway ${d.toFixed(1)}m from a stair (choke risk)`);
  }
  // void radius-aware reachability (rect level)
  const R = 0.3, CELL = 0.25;
  const rects = [...rooms, ...spec.corridors.map((c) => c.rect)];
  let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const b of rects) { mnX = Math.min(mnX, b.x - b.w / 2); mxX = Math.max(mxX, b.x + b.w / 2); mnZ = Math.min(mnZ, b.z - b.d / 2); mxZ = Math.max(mxZ, b.z + b.d / 2); }
  const CX = Math.ceil((mxX - mnX) / CELL), CZ = Math.ceil((mxZ - mnZ) / CELL);
  const W = new Uint8Array(CX * CZ); const id = (x: number, z: number) => z * CX + x;
  const mark = (b: { x: number; z: number; w: number; d: number }, v: number) => {
    for (let cz = Math.max(0, Math.floor((b.z - b.d / 2 - mnZ) / CELL)); cz <= Math.min(CZ - 1, Math.floor((b.z + b.d / 2 - mnZ) / CELL)); cz++)
      for (let cx = Math.max(0, Math.floor((b.x - b.w / 2 - mnX) / CELL)); cx <= Math.min(CX - 1, Math.floor((b.x + b.w / 2 - mnX) / CELL)); cx++) W[id(cx, cz)] = v;
  };
  for (const b of rects) mark(b, 1);
  for (const v of spec.voids ?? []) mark({ x: v.x, z: v.z, w: v.w + 2 * R, d: v.d + 2 * R }, 0);
  const sx = Math.floor((spec.startPos.x - mnX) / CELL), sz = Math.floor((spec.startPos.z - mnZ) / CELL);
  const seen = new Uint8Array(CX * CZ); const q = [id(sx, sz)]; if (W[q[0]]) seen[q[0]] = 1;
  while (q.length) { const c = q.pop()!; const cx = c % CX, cz = (c - cx) / CX; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= CX || nz >= CZ) continue; const ni = id(nx, nz); if (W[ni] && !seen[ni]) { seen[ni] = 1; q.push(ni); } } }
  for (const st of spec.stairs ?? []) {
    const x = Math.floor((st.x - mnX) / CELL), z = Math.floor((st.z - mnZ) / CELL);
    let ok = false; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const a = x + dx, b = z + dz; if (a >= 0 && b >= 0 && a < CX && b < CZ && seen[id(a, b)]) ok = true; }
    if (!ok) issues.push(`stair @(${st.x.toFixed(1)},${st.z.toFixed(1)}) unreachable (rect level)`);
  }

  console.log(`check seed ${seed} depth ${depth}: ${rooms.length} rooms · ${spec.corridors.length} corridors · ${(spec.stairs ?? []).length} stairs · ${spec.props.length} props`);
  if (issues.length === 0) {
    console.log('✓ no static issues (overlap / archway-near-stair / void reachability)');
    console.log('  (static only — `delve reach` runs the faithful built-collision check)');
  } else {
    for (const i of issues) console.log('✗ ' + i);
    process.exit(1);
  }
}

/** Weapon stat table — class · reach · reachMul · damage · arc. Reach is the
 *  value DERIVED from each weapon's model at content-load (see the derive pass
 *  in content/items.ts); this is the read for balancing it without a browser. */
function weapons() {
  const rows = Object.entries(ITEMS)
    .filter(([, it]) => it.weapon)
    .map(([id, it]) => {
      const w = it.weapon!;
      return {
        id, cls: w.class, ranged: !!w.ranged,
        reach: w.reach ?? 0, mul: w.reachMul ?? 1, dmg: w.damage,
        arc: Math.round((w.coneHalfAngle * 180) / Math.PI),
      };
    })
    .sort((a, b) => a.reach - b.reach);
  console.log(`\nWEAPONS (${rows.length})  —  reach is DERIVED from the model (content/items.ts)`);
  console.log('reach   class            mul   dmg  arc°  id');
  for (const r of rows) {
    const tag = r.ranged ? '  (ranged: explicit reach)' : '';
    console.log(
      `${r.reach.toFixed(2).padStart(6)}  ${r.cls.padEnd(15)}  ${r.mul.toFixed(2)}  ${String(r.dmg).padStart(3)}  ${String(r.arc).padStart(4)}  ${r.id}${tag}`,
    );
  }
  console.log('\ninspect a weapon in-hand:  delve bench viewmodel-<id> --hand --ortho --debug');
}

switch (cmd) {
  case undefined: case 'help': case '--help': index(); break;
  case 'list': list(rest[0]); break;
  case 'inventory': delegate('inventory'); break;
  case 'audit': delegate('audit'); break;
  case 'stats': delegate('stats'); break;
  case 'reports': delegate('reports'); break;
  case 'repro': delegate('repro'); break;
  case 'check': check(Number(rest[0]), Number(rest[1] ?? 1)); break;
  case 'reach': delegate('reach', ['--seed', rest[0], '--depth', rest[1] ?? '1', ...rest.slice(2)]); break;
  case 'weapons': weapons(); break;
  case 'bench': delegate('bench'); break;
  case 'art': delegate('art'); break;
  case 'facing': delegate('model-facing', rest); break;
  case 'ui': delegate('ui-eval'); break;
  case 'optimize': delegate('optimize-images'); break;
  case 'snap': delegate('snap'); break;
  case 'pilot': delegate('pilot'); break;
  case 'play': delegate('play'); break;
  case 'test': { const p = spawn('npm', ['test'], { stdio: 'inherit' }); p.on('exit', (c) => process.exit(c ?? 0)); break; }
  default: console.error(`unknown command '${cmd}'\n`); index(); process.exit(1);
}
