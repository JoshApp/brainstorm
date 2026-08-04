// GENERATOR ECONOMY AUDIT — "theoretical telemetry" (no play data needed).
//
// generateFloor(depth, seed) is PURE data (no THREE / DOM), so we can build
// hundreds of real floors in node and read the whole content economy off them:
// what the generator SEEDS (rooms, enemies, events), what it lets you ACQUIRE
// (chests + enemy/corpse drops + set-piece fires, resolved through the actual
// drop-table executor), and — the point — whether that spread reads as FUN or
// as one of the boredom failure modes the loot-design literature names.
//
//   npx tsx scripts/audit.ts                       # default sweep (depths 1-12)
//   npx tsx scripts/audit.ts --floors 300          # seeds per depth
//   npx tsx scripts/audit.ts --depths 1-8
//   npx tsx scripts/audit.ts --json audit.json     # structured dump for the AI layer
//
// It is the BEFORE/AFTER harness for economy tuning: run it, change a drop
// table / spawn rate / vault, run it again, compare. Sibling to
// scripts/placement-audit.ts (which measures clustering) and scripts/balance.ts
// (which measures combat DPS/TTK).
//
// ── The research this reads against (why each flag exists) ───────────────────
// Reward design in games leans on a few well-studied levers; the HEALTH section
// scores the generator against them:
//   1. VARIABLE-RATIO reinforcement (Skinner). Unpredictable reward TIMING is the
//      strongest pull. We measure the variance of the per-floor reward stream:
//      too regular reads as a metronome (no anticipation); too sparse reads as
//      grind. Want spread, not a flat line.
//   2. REWARD DROUGHT / dead floors. Long runs of "nothing notable" are where
//      players disengage. We measure the dead-floor rate + the expected LONGEST
//      drought (Monte-Carlo), because the average hides the tail that actually
//      bounces people.
//   3. RARITY ESCALATION. The progression fantasy needs reward QUALITY to trend
//      up with depth. A flat rarity curve = "depth 10 loot feels like depth 2" =
//      the classic mid-game slump. We fit mean-rarity vs depth and flag flatness.
//   4. NOTABLE-BEAT CADENCE (the hook). A "notable" beat (a rare+ item, a relic,
//      a miniboss, a gated vault) wants to land roughly every 1-2 floors — often
//      enough to keep the next-floor pull alive, rare enough that it lands. We
//      report expected floors-between-notables.
//   5. CHURN / CHOICE. Gear upgrades must appear often enough to keep build
//      decisions alive without drowning their value. We report gear-items/floor.
// These are heuristics with defensible target BANDS, not laws — the point is a
// number you can watch move, plus a flag when it leaves the band.

import { generateFloor } from '../src/level/procgen';
import { rollDropTable, type DropTableId } from '../src/content/drop-tables';
import { ENEMIES } from '../src/content/enemies';
import { isBossDepth } from '../src/level/acts';
import { RARITY_ORDER, type ItemSpec, type Rarity } from '../src/content/items';
import type { PropSpec, EnemySpawnSpec } from '../src/level/types';

// ── args ─────────────────────────────────────────────────────────────────────
function argNum(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}
function argStr(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const FLOORS = argNum('--floors', 200);           // seeds per depth
const [D0, D1] = argStr('--depths', '1-12').split('-').map(Number);
const JSON_OUT = argStr('--json', '');

// Deterministic seedable RNG (mulberry32) — reproducible sweeps.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(...ns: number[]): number {
  let h = 2166136261 >>> 0;
  for (const n of ns) { h = Math.imul(h ^ (n >>> 0), 16777619) >>> 0; }
  return h >>> 0;
}

// ── stats helpers ─────────────────────────────────────────────────────────────
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const stdev = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const pct = (num: number, den: number) => (den ? (100 * num) / den : 0);
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const padR = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
function bar(v: number, max: number, width = 24): string {
  return '█'.repeat(Math.max(0, Math.round((v / (max || 1)) * width)));
}

// ── classification ─────────────────────────────────────────────────────────
const EVENT_KINDS = new Set([
  'altar', 'blood-altar', 'starter-altar', 'challenge-offering', 'fountain',
  'tithe-basin', 'reliquary', 'tome-pillar', 'merchant', 'trinket-merchant',
  'blacksmith', 'fate-fire', 'gate-offering',
]);
const RARITY_IDX: Record<Rarity, number> = RARITY_ORDER.reduce(
  (m, r, i) => { m[r] = i; return m; }, {} as Record<Rarity, number>,
);
// 'cursed' + 'fabled' read as the "wow" tiers for cadence/escalation purposes;
// 'rare' and up counts as a notable-quality drop.
const RARE_PLUS = new Set<Rarity>(['rare', 'cursed', 'fabled']);
const isGear = (it: ItemSpec) => it.kind === 'weapon' || it.kind === 'offhand' || it.kind === 'vestment';
const isRelic = (it: ItemSpec) => it.kind === 'relic';

interface FloorSample {
  depth: number;
  rooms: number;
  enemies: number;
  enemyTypes: Map<string, number>;
  events: Map<string, number>;      // event kind → count on this floor
  chests: { wood: number; silver: number; gold: number; mimic: number };
  corpses: number;
  miniboss: boolean;
  gatedRooms: number;
  // ACQUISITION — every item the floor's PASSIVE sources yield this seed, resolved
  // through the real drop executor. Gold is the summed payout.
  incomeGold: number;
  incomeItems: ItemSpec[];
  incomePickups: ItemSpec[];
  vases: number;
}

/** Roll one floor's whole passive acquisition through the actual executor.
 *  Chests carry a pre-rolled bundle in the spec (baked at gen time), so we read
 *  those directly — the real outcome for this seed. Enemy + corpse + set-piece
 *  drops resolve at kill/interact time, so we roll their tables here with a
 *  floor-seeded rand (one sample per source per seed → a proper Monte-Carlo
 *  across the sweep). */
function sampleFloor(depth: number, seed: number): FloorSample {
  const spec = generateFloor(depth, seed);
  const rand = mulberry32(hash(seed, depth, 0x10c7));

  const enemyTypes = new Map<string, number>();
  const events = new Map<string, number>();
  const chests = { wood: 0, silver: 0, gold: 0, mimic: 0 };
  let corpses = 0, miniboss = false, gatedRooms = 0;
  let incomeGold = 0;
  const incomeItems: ItemSpec[] = [];    // BUILD PIECES only — what grows a build
  const incomePickups: ItemSpec[] = [];  // currencies + consumables — what you spend
  let vases = 0;
  /** Route a bundle's items into the two economies. Counting a key or an ember
   *  as "loot" is what made the acquisition table read as a flood when what was
   *  actually flowing was resources. */
  const pushIncome = (items: readonly ItemSpec[]) => {
    for (const it of items) {
      if (it.kind === 'key' || it.kind === 'ember' || it.kind === 'consumable') incomePickups.push(it);
      else incomeItems.push(it);
    }
  };

  // Enemies — count types + roll each one's drop table.
  for (const s of spec.spawns as EnemySpawnSpec[]) {
    const spc = ENEMIES[s.enemyId];
    if (!spc) continue;
    enemyTypes.set(s.enemyId, (enemyTypes.get(s.enemyId) ?? 0) + 1);
    if (spc.miniboss) miniboss = true;
    // Vermin (maggots) never fight/reward — skip their drops (faction-neutral).
    if (spc.faction === 'vermin') continue;
    // Minibosses defer to the set-piece fire below, not their own body drop.
    if (spc.isBoss || spc.miniboss) continue;
    const bundle = rollDropTable((spc.dropTable ?? 'enemy') as DropTableId, depth, rand);
    incomeGold += bundle.gold;
    pushIncome(bundle.items);
  }

  // Props — events, chests (baked loot), corpses (rolled).
  for (const p of spec.props as PropSpec[]) {
    const kind = p.kind;
    if (EVENT_KINDS.has(kind)) events.set(kind, (events.get(kind) ?? 0) + 1);
    if (kind === 'chest') {
      const c = p as Extract<PropSpec, { kind: 'chest' }>;
      if (c.gateId) gatedRooms++;                       // counted once per gated chest
      if (c.mimic) { chests.mimic++; continue; }
      const tier = (c.tier ?? 'wood') as 'wood' | 'silver' | 'gold';
      chests[tier]++;
      if (c.loot) { incomeGold += c.loot.gold; pushIncome(c.loot.items); }
    } else if (kind === 'vase' || kind === 'vase-cluster') {
      // VASES were MISSING from this table entirely — they're destructibles
      // resolved at break time, not baked into the spec like a chest, so the
      // sampler walked straight past them. On floors 1-2 they're the ONLY
      // ambient key source (the director spends the single chest on the early
      // spark), so omitting them made early-floor pickup income read as zero.
      // A cluster is several pots; count it as three.
      const pots = kind === 'vase-cluster' ? 3 : 1;
      vases += pots;
      for (let i = 0; i < pots; i++) {
        const bundle = rollDropTable('vase', depth, rand);
        incomeGold += bundle.gold;
        pushIncome(bundle.items);
      }
    } else if (kind === 'corpse') {
      corpses++;
      const bundle = rollDropTable('corpse', depth, rand);
      incomeGold += bundle.gold;
      pushIncome(bundle.items);
    }
  }

  // The TROVE — the floor's guaranteed choice. Several offering stones share one
  // groupId and taking any ONE closes the rest, so the income is one item per
  // GROUP, not per stone. Counting stones would triple the floor's apparent
  // build income; ignoring the group entirely (what this audit did before the
  // trove existed) hides the single most reliable build source on the floor.
  const troveGroups = new Set<string>();
  for (const p of spec.props as PropSpec[]) {
    if (p.kind !== 'offering') continue;
    troveGroups.add((p as Extract<PropSpec, { kind: 'offering' }>).groupId);
  }
  for (const _ of troveGroups) {
    const t = rollDropTable('trove', depth, rand);
    incomeGold += t.gold;
    pushIncome(t.items);
  }

  // Set-piece FIRES — a boss floor's boss, or a miniboss arena, gives a deferred
  // reward when the fight ends. Model it as its table's payout (taken on clear).
  if (isBossDepth(depth)) {
    const b = rollDropTable('boss', depth, rand);
    incomeGold += b.gold; pushIncome(b.items);
  }
  if (miniboss) {
    const b = rollDropTable('miniboss', depth, rand);
    incomeGold += b.gold; pushIncome(b.items);
  }

  // Gated ROOMS distinct from gated chest count — a gate-offering prop marks one.
  const gateProps = (spec.props as PropSpec[]).filter((p) => p.kind === 'gate-offering').length;
  gatedRooms = Math.max(gatedRooms, gateProps);

  return { depth, rooms: spec.rooms.length, enemies: spec.spawns.length, enemyTypes, events, chests, corpses, vases, miniboss, gatedRooms, incomeGold, incomeItems, incomePickups };
}

// ── per-depth aggregate ──────────────────────────────────────────────────────
interface DepthAgg {
  depth: number; n: number;
  rooms: number[]; enemies: number[];
  enemyMix: Map<string, number>;
  eventFloors: Map<string, number>;   // # floors that had ≥1 of this event
  chestGold: number; chestSilver: number; chestWood: number; chestMimic: number;
  corpseFloors: number; minibossFloors: number; gatedFloors: number;
  itemsPerFloor: number[]; pickupsPerFloor: number[]; goldPerFloor: number[];
  rarityCount: Record<Rarity, number>;
  relicFloors: number; gearFloors: number;
  // Notable-beat flag per floor: a rare+ item OR relic OR miniboss OR gated room.
  notableFloors: number;
  // The reward STREAM (items+relic-weighted) per floor, for variance.
  rewardStream: number[];
}
function newAgg(depth: number): DepthAgg {
  return {
    depth, n: 0, rooms: [], enemies: [], enemyMix: new Map(), eventFloors: new Map(),
    chestGold: 0, chestSilver: 0, chestWood: 0, chestMimic: 0,
    corpseFloors: 0, minibossFloors: 0, gatedFloors: 0,
    itemsPerFloor: [], pickupsPerFloor: [], goldPerFloor: [],
    rarityCount: RARITY_ORDER.reduce((m, r) => { m[r] = 0; return m; }, {} as Record<Rarity, number>),
    relicFloors: 0, gearFloors: 0, notableFloors: 0, rewardStream: [],
  };
}
function fold(agg: DepthAgg, s: FloorSample): void {
  agg.n++;
  agg.rooms.push(s.rooms); agg.enemies.push(s.enemies);
  for (const [k, c] of s.enemyTypes) agg.enemyMix.set(k, (agg.enemyMix.get(k) ?? 0) + c);
  for (const k of s.events.keys()) agg.eventFloors.set(k, (agg.eventFloors.get(k) ?? 0) + 1);
  agg.chestGold += s.chests.gold; agg.chestSilver += s.chests.silver;
  agg.chestWood += s.chests.wood; agg.chestMimic += s.chests.mimic;
  if (s.corpses > 0) agg.corpseFloors++;
  if (s.miniboss) agg.minibossFloors++;
  if (s.gatedRooms > 0) agg.gatedFloors++;
  agg.itemsPerFloor.push(s.incomeItems.length);
  agg.pickupsPerFloor.push(s.incomePickups.length);
  agg.goldPerFloor.push(s.incomeGold);
  let hasRelic = false, hasGear = false, hasRarePlus = false;
  for (const it of s.incomeItems) {
    agg.rarityCount[it.rarity]++;
    if (isRelic(it)) hasRelic = true;
    if (isGear(it)) hasGear = true;
    if (RARE_PLUS.has(it.rarity)) hasRarePlus = true;
  }
  if (hasRelic) agg.relicFloors++;
  if (hasGear) agg.gearFloors++;
  const notable = hasRarePlus || hasRelic || s.miniboss || s.gatedRooms > 0;
  if (notable) agg.notableFloors++;
  // Reward "weight": each item 1, a rare+ 2, a relic 2, a set-piece +3. This is
  // the stream whose variance answers "is the reward timing spiky or metronomic".
  let w = s.incomeItems.length
    + s.incomeItems.filter((i) => RARE_PLUS.has(i.rarity)).length
    + s.incomeItems.filter(isRelic).length
    + (s.miniboss ? 3 : 0) + (isBossDepth(s.depth) ? 4 : 0);
  agg.rewardStream.push(w);
}

// Mean rarity index across all items a depth yielded (progression-curve input).
function meanRarity(agg: DepthAgg): number {
  let sum = 0, n = 0;
  for (const r of RARITY_ORDER) { sum += RARITY_IDX[r] * agg.rarityCount[r]; n += agg.rarityCount[r]; }
  return n ? sum / n : 0;
}

// Expected LONGEST drought (consecutive non-notable floors) a player hits over a
// 12-floor descent, Monte-Carlo'd from each depth's notable probability.
function expectedLongestDrought(pByDepth: Map<number, number>, depths: number[], trials = 20000): number {
  const rand = mulberry32(0xD12047);
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    let cur = 0, longest = 0;
    for (const d of depths) {
      const p = pByDepth.get(d) ?? 0.5;
      if (rand() < p) { longest = Math.max(longest, cur); cur = 0; }   // notable → reset
      else cur++;
    }
    longest = Math.max(longest, cur);
    sum += longest;
  }
  return sum / trials;
}

// ── run the sweep ────────────────────────────────────────────────────────────
const depths: number[] = [];
for (let d = D0; d <= D1; d++) depths.push(d);
const aggs = new Map<number, DepthAgg>();
for (const d of depths) aggs.set(d, newAgg(d));

for (const d of depths) {
  const agg = aggs.get(d)!;
  for (let seed = 1; seed <= FLOORS; seed++) fold(agg, sampleFloor(d, seed));
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\nGENERATOR ECONOMY AUDIT  —  ${FLOORS} floors/depth, depths ${D0}-${D1}\n${'='.repeat(72)}`);

// 1. STRUCTURE — what gets built + seeded.
console.log('\n1. STRUCTURE  (per floor)');
console.log(`  ${padR('depth', 6)}${padL('rooms', 7)}${padL('enemies', 9)}${padL('chests', 9)}${padL('corpse%', 9)}${padL('mini%', 7)}${padL('gate%', 7)}`);
for (const d of depths) {
  const a = aggs.get(d)!;
  const chestsPer = (a.chestGold + a.chestSilver + a.chestWood + a.chestMimic) / a.n;
  console.log(`  ${padR('D' + d, 6)}${padL(f1(mean(a.rooms)), 7)}${padL(f1(mean(a.enemies)), 9)}${padL(f1(chestsPer), 9)}${padL(f1(pct(a.corpseFloors, a.n)), 8)}%${padL(f1(pct(a.minibossFloors, a.n)), 6)}%${padL(f1(pct(a.gatedFloors, a.n)), 6)}%`);
}

// 2. EVENT FREQUENCY — % of floors carrying each event beat.
console.log('\n2. EVENT FREQUENCY  (% of floors with ≥1)');
const allEvents = new Set<string>();
for (const d of depths) for (const k of aggs.get(d)!.eventFloors.keys()) allEvents.add(k);
const evList = [...allEvents].sort();
console.log(`  ${padR('depth', 6)}${evList.map((e) => padL(e.replace('-', '').slice(0, 7), 8)).join('')}`);
for (const d of depths) {
  const a = aggs.get(d)!;
  const row = evList.map((e) => padL(f1(pct(a.eventFloors.get(e) ?? 0, a.n)), 8)).join('');
  console.log(`  ${padR('D' + d, 6)}${row}`);
}

// 3. ACQUISITION — the passive loot income (chests + drops + set-piece fires).
console.log('\n3. ACQUISITION  (passive income per floor: chests + enemy/corpse drops + set-piece fires)');
// BUILD vs PICKUPS are two different economies and must never share a column.
// `build` is what grows you (relics/gear); `pickup` is what you spend (keys,
// embers, draughts). A key counted as loot is what made this table read as a
// flood when what was actually flowing was resources.
console.log(`  ${padR('depth', 6)}${padL('build', 7)}${padL('pickup', 8)}${padL('gold', 7)}${padL('P(relic)', 10)}${padL('P(gear)', 9)}${padL('meanRar', 9)}`);
for (const d of depths) {
  const a = aggs.get(d)!;
  console.log(`  ${padR('D' + d, 6)}${padL(f2(mean(a.itemsPerFloor)), 7)}${padL(f2(mean(a.pickupsPerFloor)), 8)}${padL(f1(mean(a.goldPerFloor)), 7)}${padL(f1(pct(a.relicFloors, a.n)) + '%', 10)}${padL(f1(pct(a.gearFloors, a.n)) + '%', 9)}${padL(f2(meanRarity(a)), 9)}`);
}

// 4. RARITY MIX — the escalation curve (share of items at each tier, by depth).
console.log('\n4. RARITY MIX  (share of dropped items, by tier)');
console.log(`  ${padR('depth', 6)}${RARITY_ORDER.map((r) => padL(r.slice(0, 7), 9)).join('')}`);
for (const d of depths) {
  const a = aggs.get(d)!;
  const tot = RARITY_ORDER.reduce((s, r) => s + a.rarityCount[r], 0) || 1;
  console.log(`  ${padR('D' + d, 6)}${RARITY_ORDER.map((r) => padL(f1(pct(a.rarityCount[r], tot)) + '%', 9)).join('')}`);
}

// ── HEALTH — read the numbers against the research bands. ────────────────────
console.log(`\n${'='.repeat(72)}\nHEALTH  (research-grounded flags — target bands, not laws)\n`);
const flags: string[] = [];
const ok: string[] = [];
function judge(pass: boolean, label: string, detail: string): void {
  (pass ? ok : flags).push(`${pass ? '  ✓' : '  ⚠'} ${padR(label, 26)} ${detail}`);
}

// (2) Dead-floor rate — floors with NO notable beat. Band: keep < 25%.
const deadByDepth = new Map<number, number>();
for (const d of depths) {
  const a = aggs.get(d)!;
  deadByDepth.set(d, pct(a.n - a.notableFloors, a.n));
}
const worstDead = [...deadByDepth.entries()].sort((x, y) => y[1] - x[1])[0];
judge(worstDead[1] < 25, 'dead-floor rate',
  `worst D${worstDead[0]} = ${f1(worstDead[1])}% floors with no notable beat (band <25%)`);

// (4) Notable cadence — expected floors between notables (mean over depths).
const pNotable = new Map<number, number>();
for (const d of depths) { const a = aggs.get(d)!; pNotable.set(d, a.notableFloors / a.n); }
const meanP = mean([...pNotable.values()]);
const floorsPerNotable = meanP > 0 ? 1 / meanP : Infinity;
judge(floorsPerNotable <= 2.2, 'notable cadence',
  `a notable beat every ${f2(floorsPerNotable)} floors on average (band ≤2.0-2.2)`);

// (2b) Longest expected drought over a full descent — the tail that bounces.
const drought = expectedLongestDrought(pNotable, depths);
judge(drought <= 3.0, 'longest drought (12-floor)',
  `expected worst dry streak ≈ ${f2(drought)} floors (band ≤3)`);

// (3) Rarity escalation — mean rarity should rise with depth. Slope over the run.
const rar = depths.map((d) => meanRarity(aggs.get(d)!));
const xs = depths.map((_, i) => i);
const mx = mean(xs), my = mean(rar);
const slope = xs.reduce((s, x, i) => s + (x - mx) * (rar[i] - my), 0) / (xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1);
judge(slope > 0.02, 'rarity escalation',
  `mean-rarity slope = ${f2(slope)} per depth (want >0.02 — reward quality should climb)`);

// (1) Reward variance — the variable-ratio texture. Coefficient of variation of
// the per-floor reward stream, averaged. Too LOW = metronomic; too HIGH = grind.
const covs = depths.map((d) => { const a = aggs.get(d)!; const m = mean(a.rewardStream); return m ? stdev(a.rewardStream) / m : 0; });
const meanCov = mean(covs);
judge(meanCov >= 0.45 && meanCov <= 1.4, 'reward variance (CoV)',
  `${f2(meanCov)} — spread of the reward stream (band 0.45-1.4: not a metronome, not famine)`);

// (5) Gear churn — gear-bearing floors, so build choices stay live. Band 20-70%.
// BUILD CHURN — how often a floor hands you a build piece. Weapons and
// vestments deliberately no longer drop (you carry one weapon; it evolves), so
// the build layer is RELICS now — measuring "gear" here would flag 0% forever
// and train us to ignore the health check.
const buildMean = mean(depths.map((d) => pct(aggs.get(d)!.relicFloors, aggs.get(d)!.n)));
judge(buildMean >= 20 && buildMean <= 90, 'build churn',
  `${f1(buildMean)}% of floors offer a build piece (band 20-90%: a build grows, not drowns)`);

// Mimic share — a surprise lever; flag if it's punishingly common.
let mimicTot = 0, chestTot = 0;
for (const d of depths) { const a = aggs.get(d)!; mimicTot += a.chestMimic; chestTot += a.chestGold + a.chestSilver + a.chestWood + a.chestMimic; }
judge(pct(mimicTot, chestTot) <= 20, 'mimic share',
  `${f1(pct(mimicTot, chestTot))}% of chests are mimics (band ≤20% — surprise, not tax)`);

for (const line of flags) console.log(line);
for (const line of ok) console.log(line);
console.log(`\n${flags.length} flag(s), ${ok.length} healthy.  Bands are heuristics — read the tables above for the why.\n`);

// ── optional JSON dump for the AI-authoring layer / diffing ─────────────────
if (JSON_OUT) {
  const out = {
    params: { floors: FLOORS, depths: [D0, D1] },
    perDepth: depths.map((d) => {
      const a = aggs.get(d)!;
      const tot = RARITY_ORDER.reduce((s, r) => s + a.rarityCount[r], 0) || 1;
      return {
        depth: d, n: a.n,
        rooms: mean(a.rooms), enemies: mean(a.enemies),
        chestsPerFloor: (a.chestGold + a.chestSilver + a.chestWood + a.chestMimic) / a.n,
        corpsePct: pct(a.corpseFloors, a.n), minibossPct: pct(a.minibossFloors, a.n), gatedPct: pct(a.gatedFloors, a.n),
        events: Object.fromEntries([...a.eventFloors].map(([k, v]) => [k, pct(v, a.n)])),
        itemsPerFloor: mean(a.itemsPerFloor), goldPerFloor: mean(a.goldPerFloor),
        pRelic: pct(a.relicFloors, a.n), pGear: pct(a.gearFloors, a.n), meanRarity: meanRarity(a),
        rarityShare: RARITY_ORDER.reduce((m, r) => { m[r] = pct(a.rarityCount[r], tot); return m; }, {} as Record<string, number>),
        notablePct: pct(a.notableFloors, a.n),
      };
    }),
    health: {
      worstDeadFloorPct: worstDead[1], floorsPerNotable, longestDrought: drought,
      raritySlope: slope, rewardCoV: meanCov, gearPct: gearMean, mimicPct: pct(mimicTot, chestTot),
    },
  };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
  console.log(`wrote ${JSON_OUT}`);
}
