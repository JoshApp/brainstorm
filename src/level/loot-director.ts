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
import { rollChestLoot, rollMimic } from './decor-defaults';

type Anchor = Extract<PropSpec, { kind: 'loot-anchor' }>;

/** Minimum metres between two placed chests — keeps them from clustering even if
 *  two anchors sit close. */
const MIN_CHEST_SPACING = 4.5;

interface LootBudget { wood: number; silver: number; gold: number; }

/** Per-floor loot budget. Deliberately small — wood is the staple, silver an
 *  occasional treat, gold a rare event (likelier the deeper you go). */
function rollBudget(depth: number, rand: () => number): LootBudget {
  const wood = 1 + (rand() < 0.55 ? 1 : 0);                     // 1–2 wood
  const silver = rand() < 0.45 ? 1 : 0;                          // ~half the floors
  const gold = rand() < Math.min(0.4, 0.06 + depth * 0.035) ? 1 : 0;  // rare, ramps with depth
  return { wood, silver, gold };
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
 *  chests. Everything else passes through untouched. Deterministic given rand. */
export function distributeLoot(props: PropSpec[], depth: number, rand: () => number): PropSpec[] {
  const anchors = props.filter((p): p is Anchor => p.kind === 'loot-anchor');
  const kept = props.filter((p) => p.kind !== 'loot-anchor');
  if (anchors.length === 0) return props;

  // Prefer major anchors for the prized tiers; wood takes minors first.
  const majors = shuffled(anchors.filter((a) => a.prominence === 'major'), rand);
  const minors = shuffled(anchors.filter((a) => a.prominence === 'minor'), rand);
  const used = new Set<Anchor>();
  const placed: { x: number; z: number }[] = [];

  const farEnough = (a: Anchor) =>
    placed.every((p) => (p.x - a.x) ** 2 + (p.z - a.z) ** 2 >= MIN_CHEST_SPACING ** 2);

  // Take the first free, well-spaced anchor from `first` then `second` queue.
  const take = (first: Anchor[], second: Anchor[]): Anchor | null => {
    for (const q of [first, second]) {
      for (const a of q) if (!used.has(a) && farEnough(a)) { used.add(a); placed.push({ x: a.x, z: a.z }); return a; }
    }
    return null;
  };

  const budget = rollBudget(depth, rand);
  const chests: PropSpec[] = [];
  const place = (tier: ChestTier, first: Anchor[], second: Anchor[]) => {
    const a = take(first, second);
    if (a) chests.push(makeChest(a, tier, depth, rand));
  };

  for (let i = 0; i < budget.gold; i++)   place('gold', majors, minors);
  for (let i = 0; i < budget.silver; i++) place('silver', majors, minors);
  for (let i = 0; i < budget.wood; i++)   place('wood', minors, majors);

  return [...kept, ...chests];
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
