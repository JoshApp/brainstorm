// Per-vault structural validation. Codifies the checks I used to hand-roll as
// throwaway scripts every time I authored a vault, so authoring a broken room
// fails `npm test` instead of shipping. Pure on the ASCII + void rects — no
// rendering.
//
//   npm test
//
// Invariants, per vault:
//   1. rectangular map (all rows equal length)
//   2. solid '#' border on all four sides
//   3. only known tile chars (structural + a real enemy char + X/B slots)
//   4. interior is ONE connected region (no walled-off pocket) — voids excluded
//   5. each edge's MIDPOINT cell is walkable floor (the winding composer
//      connects a corridor at the centre of an edge — it must land on floor,
//      never a wall or the abyss)
//   6. no enemy spawns on a void cell (would spawn into the chasm)

import assert from 'node:assert/strict';
import { VAULTS } from '../src/level/vault-library';
import { ENEMY_BY_CHAR } from '../src/content/enemies';
import type { Vault } from '../src/level/vault';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// Structural / interactable / placeholder chars (mirrors the vault-library
// legend + the reserved set in enemies.ts). Enemy chars are added below.
const STRUCTURAL = new Set([
  '#', ' ', '.', ',', 'S', '/', 'o', 'O', 'D', '^', 'F', 'C',
  'P', 'A', 'c', 'v', 'V', 'T', 't', '<', '>', '%', 'X', 'B',
  '$',   // loot slot (rolled to chest / empty at gen time)
]);
const KNOWN = new Set([...STRUCTURAL, ...ENEMY_BY_CHAR.keys()]);
const isFloorish = (ch: string) => ch !== '#' && ch !== ' ';

function cols(v: Vault): number { return v.map[0].length; }
function rows(v: Vault): number { return v.map.length; }
// Map cell (col,row) → vault-local coords (1m cells, room centred at 0,0).
function localX(v: Vault, col: number): number { return col - (cols(v) - 1) / 2; }
function localZ(v: Vault, row: number): number { return row - (rows(v) - 1) / 2; }
function inVoid(v: Vault, col: number, row: number): boolean {
  const x = localX(v, col), z = localZ(v, row);
  return (v.voids ?? []).some((vd) =>
    Math.abs(x - vd.x) < vd.w / 2 - 1e-6 && Math.abs(z - vd.z) < vd.d / 2 - 1e-6);
}

test('every vault map is rectangular', () => {
  for (const v of VAULTS) {
    const w = v.map[0].length;
    for (let r = 0; r < v.map.length; r++) {
      assert.equal(v.map[r].length, w, `vault '${v.id}' row ${r} len ${v.map[r].length} != ${w}`);
    }
  }
});

test('every vault has a solid # border (door chars allowed as openings)', () => {
  // o/O/D are legitimate door openings authored into the border.
  const borderOk = (ch: string) => ch === '#' || ch === 'o' || ch === 'O' || ch === 'D';
  for (const v of VAULTS) {
    const C = cols(v), R = rows(v);
    for (let c = 0; c < C; c++) {
      assert.ok(borderOk(v.map[0][c]), `vault '${v.id}' top border breached at col ${c} ('${v.map[0][c]}')`);
      assert.ok(borderOk(v.map[R - 1][c]), `vault '${v.id}' bottom border breached at col ${c} ('${v.map[R - 1][c]}')`);
    }
    for (let r = 0; r < R; r++) {
      assert.ok(borderOk(v.map[r][0]), `vault '${v.id}' left border breached at row ${r} ('${v.map[r][0]}')`);
      assert.ok(borderOk(v.map[r][C - 1]), `vault '${v.id}' right border breached at row ${r} ('${v.map[r][C - 1]}')`);
    }
  }
});

test('every vault uses only known tile chars', () => {
  for (const v of VAULTS) {
    for (let r = 0; r < v.map.length; r++) {
      for (const ch of v.map[r]) {
        assert.ok(KNOWN.has(ch), `vault '${v.id}' row ${r}: unknown tile char '${ch}'`);
      }
    }
  }
});

test('every vault interior is one connected region (no walled-off pocket)', () => {
  for (const v of VAULTS) {
    const C = cols(v), R = rows(v);
    const open = (c: number, r: number) =>
      c >= 0 && r >= 0 && c < C && r < R && isFloorish(v.map[r][c]) && !inVoid(v, c, r);
    // total open cells
    let total = 0;
    let seed: [number, number] | null = null;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (open(c, r)) { total++; if (!seed) seed = [c, r]; }
    assert.ok(seed, `vault '${v.id}' has no walkable interior`);
    // flood fill from seed
    const seen = new Set<number>();
    const stack = [seed![1] * C + seed![0]]; seen.add(stack[0]);
    while (stack.length) {
      const k = stack.pop()!; const c = k % C, r = (k - c) / C;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (open(nc, nr) && !seen.has(nr * C + nc)) { seen.add(nr * C + nc); stack.push(nr * C + nc); }
      }
    }
    assert.equal(seen.size, total, `vault '${v.id}' interior splits into ${total - seen.size}+ stranded cell(s)`);
  }
});

test('every vault edge midpoint is walkable floor (winding composer entry)', () => {
  for (const v of VAULTS) {
    const C = cols(v), R = rows(v);
    const okCell = (c: number, r: number) => isFloorish(v.map[r][c]) && !inVoid(v, c, r);
    const midC = Math.round((C - 1) / 2), midR = Math.round((R - 1) / 2);
    assert.ok(okCell(midC, 1), `vault '${v.id}': N edge entry (col ${midC}) blocked`);
    assert.ok(okCell(midC, R - 2), `vault '${v.id}': S edge entry (col ${midC}) blocked`);
    assert.ok(okCell(1, midR), `vault '${v.id}': W edge entry (row ${midR}) blocked`);
    assert.ok(okCell(C - 2, midR), `vault '${v.id}': E edge entry (row ${midR}) blocked`);
  }
});

test('no enemy spawn sits on a void cell', () => {
  for (const v of VAULTS) {
    for (let r = 0; r < v.map.length; r++) {
      for (let c = 0; c < v.map[r].length; c++) {
        const ch = v.map[r][c];
        const isEnemy = ch === 'X' || ch === 'B' || ENEMY_BY_CHAR.has(ch);
        if (isEnemy) assert.ok(!inVoid(v, c, r), `vault '${v.id}': enemy '${ch}' at (${c},${r}) is over a void`);
      }
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
