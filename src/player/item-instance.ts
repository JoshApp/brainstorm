import { RARITY_AFFIX_BUDGET, type ItemSpec } from '../content/items';
import { rollAffixes, type AffixInstance } from '../content/affixes';
import type { StatModifier } from '../combat/modifiers';

// Rolled-up state for ONE pickup's affixes. V1 lifetime: from the
// moment a pickup is auto-equipped into a slot until that slot is
// cleared. (Future: tie this to a per-bag InventoryEntry so affixes
// survive going to the bag and being re-equipped manually.)
//
// We don't replace ItemSpec — slots still hold an ItemSpec for legacy
// reads (rendering, kind dispatch). The affix modifiers + suffix list
// ride alongside via the sidecar storage in src/player/equipment.ts.

export interface RolledInstance {
  /** Spec the affixes were rolled against. */
  spec: ItemSpec;
  /** Rolled affixes — empty if the spec has no affixPool. */
  affixes: AffixInstance[];
}

/** Roll an instance for a freshly-picked-up item. Always returns a
 *  RolledInstance, even when the spec has no affix pool (just empty
 *  affixes).
 *
 *  Rarity drives the roll: the affix COUNT defaults to the rarity budget
 *  (spec.maxAffixes overrides it when the author set one), and the
 *  per-affix continueChance always comes from rarity — so a rare item
 *  rolls more affixes, more reliably, than a mundane one. */
export function rollItemInstance(spec: ItemSpec): RolledInstance {
  const budget = RARITY_AFFIX_BUDGET[spec.rarity ?? 'mundane'];
  // Author intent wins on count when set; otherwise the rarity budget.
  // An item with no affixPool still resolves to empty affixes below.
  const maxAffixes = spec.maxAffixes ?? budget.maxAffixes;
  const affixes = rollAffixes(spec.affixPool, maxAffixes, budget.continueChance);
  return { spec, affixes };
}

/** Display name for a rolled instance — base name followed by each
 *  affix's suffix, joined by spaces. Pure unique instances (no rolled
 *  affix) just return the base name. */
export function instanceDisplayName(inst: RolledInstance): string {
  if (inst.affixes.length === 0) return inst.spec.name;
  const suffixes = inst.affixes.map((a) => a.suffix).filter(Boolean);
  return suffixes.length === 0
    ? inst.spec.name
    : `${inst.spec.name} ${suffixes.join(' ')}`;
}

/** All modifiers contributed by an instance — base spec mods plus
 *  every rolled affix's mods. The equipment aggregator drives this
 *  directly into the central stat pipeline. */
export function instanceModifiers(inst: RolledInstance): StatModifier[] {
  const out: StatModifier[] = [];
  if (inst.spec.modifiers) out.push(...inst.spec.modifiers);
  for (const a of inst.affixes) out.push(...a.modifiers);
  return out;
}
