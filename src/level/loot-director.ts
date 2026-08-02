// The floor LOOT DIRECTOR (docs/BUILD-ECONOMY.md) — distributes big loot with
// INTENT instead of letting vault-authored chest cells stack randomly. Vaults
// expose `loot-anchor` props (candidate spots, authored in good places with a
// prominence); this runs once per floor, rolls a small BUDGET (counts by tier),
// and fills a SPACED subset of anchors with chests. Unfilled anchors vanish.
//
// The result: few chests, each in a deliberate spot, and a gold chest lands in a
// prominent (major) anchor — the imposing find, not carpet.

import type { PropSpec } from './types';
import type { ChestTier } from '../interactables/chest';
import type { CorpsePose } from '../content/corpses';
import { rollChestLoot, rollMimic, rollChestTier } from './decor-defaults';
import { roomFor, type RoomBox } from './placement';

type Anchor = Extract<PropSpec, { kind: 'loot-anchor' }>;

/** Minimum metres between two placed pieces — keeps them from clustering even if
 *  two anchors sit close. */
const MIN_CHEST_SPACING = 4.5;
/** Keep a director chest this far from an event centrepiece (altar, basin…), so
 *  loot reads as a SECONDARY position in the room, not stacked on the event (#69). */
const BLOCKER_CLEARANCE = 3.0;

// Every EVENT centrepiece + blocker a loot piece must stand clear of. Was missing
// tithe-basin / reliquary / blood-altar / starter-altar / tome-pillar, which is
// why chests kept landing on basins and reliquaries. 'model' covers the bonfire.
const EVENT_BLOCKERS = new Set([
  'altar', 'blood-altar', 'starter-altar', 'challenge-offering', 'fountain',
  'tithe-basin', 'reliquary', 'tome-pillar', 'merchant', 'pillar', 'model',
  'corpse', 'stash-chest',
]);

// The L4D-style Director budget — anchors are POTENTIAL spots; this decides how
// many pieces actually fill this floor. The COUNT lives here; each chest's TIER
// comes from the data-driven frequency table (drop-tables rollChestTier), so
// "which varieties appear how often" is authored as config, not code here.
interface LootBudget { chestTiers: ChestTier[]; corpse: number; }

const TIER_ORDER: Record<ChestTier, number> = { gold: 0, silver: 1, wood: 2 };

/** Per-floor content budget. Deliberately small — a chest or two (tier rolled
 *  from data), plus the occasional corpse. */
function rollBudget(depth: number, rand: () => number): LootBudget {
  const chestCount = 1 + (rand() < 0.5 ? 1 : 0) + (rand() < 0.18 ? 1 : 0);   // 1–3
  const chestTiers = Array.from({ length: chestCount }, () => rollChestTier(depth, rand))
    .sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b]);   // prized tiers claim major anchors first
  // Fallen delvers are now a RARE find (was 28%/floor) — a body you stumble on
  // every few floors, not clutter — and they carry a real reward for it (see the
  // upgraded 'corpse' drop table). Rarity is what makes the loot feel earned.
  const corpse = rand() < 0.14 ? 1 : 0;
  return { chestTiers, corpse };
}

/** Fisher-Yates on a deterministic rand. */
function shuffled<T>(arr: readonly T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Transform a floor's props: `loot-anchor` markers → a budgeted, spaced set of
 *  chests + corpses. BIG content (chests, plus the fire/altars already present)
 *  respects a PER-ROOM budget scaled by area — a small room gets ONE big thing, so
 *  a bonfire + a treasure never clump in a closet. Deterministic given rand. */
export function distributeLoot(props: PropSpec[], depth: number, rand: () => number, rooms: readonly RoomBox[]): PropSpec[] {
  const anchors = props.filter((p): p is Anchor => p.kind === 'loot-anchor');
  const kept = props.filter((p) => p.kind !== 'loot-anchor');
  if (anchors.length === 0) return props;

  const majors = shuffled(anchors.filter((a) => a.prominence === 'major'), rand);
  const minors = shuffled(anchors.filter((a) => a.prominence === 'minor'), rand);
  const used = new Set<Anchor>();
  const placed: { x: number; z: number }[] = [];

  // Authored SET-PIECES + events the director keeps chests clear of (never on an
  // altar, basin, fire…).
  const blockers = kept
    .filter((p) => EVENT_BLOCKERS.has(p.kind))
    .map((p) => p as unknown as { x: number; z: number });

  const farEnough = (a: Anchor) =>
    placed.every((p) => (p.x - a.x) ** 2 + (p.z - a.z) ** 2 >= MIN_CHEST_SPACING ** 2)
    && blockers.every((b) => (b.x - a.x) ** 2 + (b.z - a.z) ** 2 >= BLOCKER_CLEARANCE ** 2);

  // PER-ROOM BIG-CONTENT budget (Layer 1): a small room gets ONE big thing, a
  // larger one 2–3. The FIRE + any authored event already in a room COUNT against
  // it, so the director won't add a chest to a room that's already spoken for.
  const BIG_KINDS = new Set(['chest', 'altar', 'blood-altar', 'starter-altar', 'fountain', 'challenge-offering', 'merchant', 'reliquary', 'tithe-basin', 'tome-pillar', 'stash-chest']);
  const isBigFire = (p: PropSpec) => p.kind === 'model' && (p as unknown as { model?: { id?: string } }).model?.id === 'bonfire';
  const bigLeft = new Map<RoomBox, number>();
  for (const r of rooms) bigLeft.set(r, r.w * r.d < 50 ? 1 : r.w * r.d < 100 ? 2 : 3);
  for (const p of kept) {
    if (!BIG_KINDS.has(p.kind) && !isBigFire(p)) continue;
    const q = p as unknown as { x?: number; z?: number };
    if (q.x === undefined || q.z === undefined) continue;
    const r = roomFor(q.x, q.z, rooms);
    if (r) bigLeft.set(r, (bigLeft.get(r) ?? 0) - 1);
  }
  const roomBudgetOk = (a: Anchor) => { const r = roomFor(a.x, a.z, rooms); return !r || (bigLeft.get(r) ?? 0) > 0; };
  const spendRoom = (a: Anchor) => { const r = roomFor(a.x, a.z, rooms); if (r) bigLeft.set(r, (bigLeft.get(r) ?? 0) - 1); };

  // Take the first free, well-spaced anchor that also passes `ok` (the room budget).
  const take = (first: Anchor[], second: Anchor[], ok: (a: Anchor) => boolean = () => true): Anchor | null => {
    for (const q of [first, second]) {
      for (const a of q) if (!used.has(a) && farEnough(a) && ok(a)) { used.add(a); placed.push({ x: a.x, z: a.z }); return a; }
    }
    return null;
  };

  const budget = rollBudget(depth, rand);
  const content: PropSpec[] = [];

  // CHESTS are BIG — placed only where the room budget allows, and spending it.
  for (const tier of budget.chestTiers) {
    const major = tier !== 'wood';
    const a = take(major ? majors : minors, major ? minors : majors, roomBudgetOk);
    if (a) { content.push(makeChest(a, tier, depth, rand)); spendRoom(a); }
  }
  // CORPSES are small finds — no budget, just spacing.
  for (let i = 0; i < budget.corpse; i++) {
    const a = take(minors, majors);
    if (a) content.push(makeCorpse(a, rand));
  }

  return [...kept, ...content];
}

/** A fallen delver at an anchor, POSED by its surroundings — the pose-by-context
 *  you asked for. Against a wall (facing it) → SLUMPED (leaning/sitting); open
 *  floor → CRAWLED or CURLED. The builder resolves who the delver was + their loot. */
function makeCorpse(a: Anchor, rand: () => number): PropSpec {
  const againstWall = a.facing?.kind === 'wall-away' || a.facing?.kind === 'wall-toward';
  const pose: CorpsePose = againstWall ? 'slumped' : (rand() < 0.5 ? 'crawled' : 'curled');
  return { kind: 'corpse', x: a.x, z: a.z, rotY: a.rotY, facing: a.facing, pose };
}

function makeChest(a: Anchor, tier: ChestTier, depth: number, rand: () => number): PropSpec {
  const mimic = rollMimic(tier, rand);
  return {
    kind: 'chest',
    x: a.x,
    z: a.z,
    rotY: a.rotY,
    facing: a.facing,
    tier,
    mimic,
    // A mimic carries no bundle — its branch handles the reveal.
    loot: mimic ? undefined : rollChestLoot(tier, rand, depth),
  };
}
