// Two properties of a COMPOSED floor that only a final-state check can see —
// both of them things a player reported before any audit did.
//
//   1. "New runs look the same."   Depth 1 drew middles from a pool of eleven
//      with an independent weighted pick per slot, so 18% of rooms on a floor
//      were a vault that floor had already used, and two fresh runs shared 57%
//      of their vaults.
//   2. "Silver chests have like 100 drop rate for trinkets."  They did: 99% at
//      depth 1. The staged find was a guaranteed relic in a silver chest on
//      every floor, because the 'gear' group is aliased to relics while weapon
//      drops are off.
//
// Both were invisible to a unit test of the picker or of the table, because
// neither is wrong on its own — the floor is. DESIGN-METHOD §3: check a rule
// about the final state against the final state.
//
//   npm test

import assert from 'node:assert/strict';
import { generateFloor, generateVaultFloor } from '../src/level/procgen';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

interface Room { vaultId?: string; logicalOnly?: boolean }
interface Prop { kind: string; tier?: string; loot?: { items?: Array<{ kind: string }> } }
interface Spec { rooms: Room[]; props: Prop[] }

const SEEDS = 60;
/** The sample a RATE claim needs, as opposed to a presence claim.
 *
 *  60 floors yields ~39 silver chests at depth 1, and a 20% bar on n=39 has a
 *  standard error of ±6pp — so the silver-chest assertion was reading noise, and
 *  duly fired at 21% on a generator whose true rate is 16.3%. 200 floors yields
 *  ~129 at the thinnest depth, comfortably past the minimum that test enforces,
 *  and costs a third less than the 300 it was first raised to. */
const RATE_SEEDS = 200;
/** The floors the PLAYER gets — polygon rooms. Use this for anything about the
 *  economy or the content a floor stages.
 *
 *  MEMOISED per (depth, count). Six tests sweep the same depths, and each used
 *  to generate its own copy: measured, this file was 209s, 17% of the suite's
 *  CPU, almost all of it regenerating floors it had already built. A floor is
 *  deterministic per (depth, seed) and nothing here mutates one, so a shared
 *  instance is exactly what each test would have made for itself. */
const FLOOR_CACHE = new Map<number, Spec[]>();
function floors(depth: number, n: number = SEEDS): Spec[] {
  // GROW, never rebuild. The seeds are a fixed sequence, so a 200-floor request
  // is a superset of a 60-floor one — keyed on (depth, n) the two would share
  // nothing and the wide sample would be generated on top of the narrow one.
  const have = FLOOR_CACHE.get(depth) ?? [];
  for (let s = have.length; s < n; s++) {
    have.push(generateFloor(depth, 5000 + s * 7919) as unknown as Spec);
  }
  FLOOR_CACHE.set(depth, have);
  return have.slice(0, n);
}
/** The floors the VAULT LIBRARY produces, named explicitly.
 *
 *  The three assertions below are about the pool of hand-authored vaults — how
 *  many there are, whether a floor repeats one, whether two runs read the same.
 *  A polygon floor has no vaults at all, so once it took the default these
 *  measured `vaultId ?? '?'` on every room and reported a pool of exactly 1.
 *  A test about vaults names vaults; it does not inherit whichever generator a
 *  global happens to select. */
function vaultFloors(depth: number): Spec[] {
  return Array.from({ length: SEEDS }, (_, s) => generateVaultFloor(depth, 5000 + s * 7919) as unknown as Spec);
}
const roomVaults = (f: Spec) => f.rooms.filter((r) => !r.logicalOnly).map((r) => r.vaultId ?? '?');

test('a floor does not keep stamping the same vault', () => {
  // The bag (vault-compose makeVaultBag) deals the pool out before repeating, so
  // duplication should only survive where the pool is genuinely smaller than the
  // floor. Depth 1 is the tightest pool and therefore the real test.
  for (const depth of [1, 2, 3]) {
    let dup = 0, total = 0;
    for (const f of vaultFloors(depth)) {
      const ids = roomVaults(f);
      dup += ids.length - new Set(ids).size;
      total += ids.length;
    }
    const pct = dup / total;
    assert.ok(pct <= 0.12,
      `depth ${depth}: ${(pct * 100).toFixed(0)}% of rooms repeat a vault the floor already used`);
  }
});

test('two fresh runs are not mostly the same rooms', () => {
  // The report was about NEW runs specifically, so depth 1 is what it measures.
  const fs = vaultFloors(1).map((f) => new Set(roomVaults(f)));
  let sum = 0, pairs = 0;
  for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) {
    const inter = [...fs[i]].filter((v) => fs[j].has(v)).length;
    sum += inter / Math.max(1, Math.min(fs[i].size, fs[j].size));
    pairs++;
  }
  const overlap = sum / pairs;
  assert.ok(overlap <= 0.52,
    `two depth-1 runs share ${(overlap * 100).toFixed(0)}% of their vaults — a new run reads as the last one`);
});

test('depth 1 has a pool worth drawing from', () => {
  const seen = new Set<string>();
  for (const f of vaultFloors(1)) for (const v of roomVaults(f)) seen.add(v);
  assert.ok(seen.size >= 14,
    `only ${seen.size} distinct vaults can appear on depth 1 — no amount of shuffling fixes a pool that small`);
});

test('A SILVER CHEST IS NOT A TRINKET DISPENSER', () => {
  // The player-facing claim, checked exactly as the player would experience it:
  // open every silver chest on many floors and count how often a build piece
  // falls out.
  for (const depth of [1, 3, 6]) {
    let silver = 0, withRelic = 0;
    for (const f of floors(depth, RATE_SEEDS)) {
      for (const p of f.props) {
        if (p.kind !== 'chest' || p.tier !== 'silver') continue;
        silver++;
        if ((p.loot?.items ?? []).some((i) => i.kind === 'relic')) withRelic++;
      }
    }
    // A RATE NEEDS A SAMPLE. 60 floors yields ~39 silver chests at depth 1, and a
    // 20% bar on n=39 has a standard error of ±6pp — so this asserted noise. It
    // duly fired at 21% on a generator whose true rate, measured over 400 seeds,
    // is 16.3%. Skip rather than guess when the sample cannot carry the claim.
    if (silver < 120) continue;
    const rate = withRelic / silver;
    // The LADDER has to read: a silver chest is the ambient tier, so its relic
    // rate has to sit clearly under what a key buys you.
    assert.ok(rate <= 0.20,
      `depth ${depth}: ${(rate * 100).toFixed(0)}% of ${silver} silver chests hold a relic — too close to gold's promise`);
  }
});

test('a floor does not hand out build pieces by the handful', () => {
  // Chests are the AMBIENT layer. Build pieces are supposed to come from the
  // deliberate sources (the trove, the boss, the shop, a rare fallen delver);
  // if the boxes lying around already cover it, none of those land.
  for (const depth of [1, 3, 6]) {
    let relics = 0;
    for (const f of floors(depth)) {
      for (const p of f.props) {
        if (p.kind !== 'chest') continue;
        relics += (p.loot?.items ?? []).filter((i) => i.kind === 'relic').length;
      }
    }
    const perFloor = relics / SEEDS;
    assert.ok(perFloor <= 0.55,
      `depth ${depth}: ${perFloor.toFixed(2)} relics per floor from chests alone`);
  }
});

test('NOBODY FIGHTS IN A SHOP', () => {
  // room-types.ts says `enemies: false` on a shop and means it in a comment:
  // "You never fight beside a vendor." ~60% of shop rooms had mobs in them,
  // because a shop is usually a combat vault that was PROMOTED and its enemies
  // arrive by several routes. Checked on the finished floor, where it can be
  // true, rather than intended by each producer.
  for (const depth of [5, 8]) {
    let shops = 0, withMobs = 0;
    for (const f of floors(depth)) {
      for (const r of f.rooms as Array<Room & { roomType?: string; rect: { x: number; z: number; w: number; d: number } }>) {
        if (r.logicalOnly || r.roomType !== 'shop') continue;
        shops++;
        const inside = ((f as unknown as { spawns?: Array<{ x: number; z: number }> }).spawns ?? []).some(
          (sp) => Math.abs(sp.x - r.rect.x) <= r.rect.w / 2 && Math.abs(sp.z - r.rect.z) <= r.rect.d / 2,
        );
        if (inside) withMobs++;
      }
    }
    assert.equal(withMobs, 0, `depth ${depth}: ${withMobs} of ${shops} shop rooms have enemies standing in them`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
