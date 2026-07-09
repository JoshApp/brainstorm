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
import { rollChestLoot, rollMimic } from './decor-defaults';

type Anchor = Extract<PropSpec, { kind: 'loot-anchor' }>;

/** Minimum metres between two placed pieces — keeps them from clustering even if
 *  two anchors sit close. */
const MIN_CHEST_SPACING = 4.5;

// The L4D-style Director budget — anchors are POTENTIAL spots; this decides how
// many of each content type actually fill this floor. Corpses are a loot EVENT
// too (a fallen delver you search), so they share the anchor pool with chests.
interface LootBudget { wood: number; silver: number; gold: number; corpse: number; }

/** Per-floor content budget. Deliberately small — wood is the staple, silver an
 *  occasional treat, gold a rare event (likelier deep), a corpse or two. */
function rollBudget(depth: number, rand: () => number): LootBudget {
  const wood = 1 + (rand() < 0.55 ? 1 : 0);                     // 1–2 wood
  const silver = rand() < 0.45 ? 1 : 0;                          // ~half the floors
  const gold = rand() < Math.min(0.4, 0.06 + depth * 0.035) ? 1 : 0;  // rare, ramps with depth
  const corpse = (rand() < 0.6 ? 1 : 0) + (rand() < 0.25 ? 1 : 0);    // 0–2, mostly 1
  return { wood, silver, gold, corpse };
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
  const content: PropSpec[] = [];
  const place = (make: (a: Anchor) => PropSpec, first: Anchor[], second: Anchor[]) => {
    const a = take(first, second);
    if (a) content.push(make(a));
  };

  // Prized tiers prefer MAJOR (prominent) anchors; wood + corpses take minors.
  for (let i = 0; i < budget.gold; i++)   place((a) => makeChest(a, 'gold', depth, rand), majors, minors);
  for (let i = 0; i < budget.silver; i++) place((a) => makeChest(a, 'silver', depth, rand), majors, minors);
  for (let i = 0; i < budget.corpse; i++) place((a) => makeCorpse(a, rand), minors, majors);
  for (let i = 0; i < budget.wood; i++)   place((a) => makeChest(a, 'wood', depth, rand), minors, majors);

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
