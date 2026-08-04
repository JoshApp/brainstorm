import type { ItemSpec, ItemKind } from './item-types';

// HOW BIG A THING IS, lying on the floor — in metres, across its widest side.
//
// The 2.5D relic billboard was a fixed 0.64m square for every relic in the game,
// so a finger ring, a milk tooth and a battle standard were all rendered
// two-thirds of a metre across. Scale is information: the first thing a player
// reads off an object on the ground is how big it is, and when everything is the
// same size that channel carries nothing (and small things read as absurd).
//
// This is deliberately DATA, and deliberately in METRES rather than a multiplier
// — a content layer authoring a new relic can answer "how big is this actually?"
// without knowing anything about billboard geometry or the number some previous
// author picked. Physical sizes for reference: a ring is ~2cm, a hand is ~19cm,
// a human skull ~20cm, a forearm ~26cm, a longsword ~100cm.
//
// Read by effects/relic-billboard.ts. Non-billboard drops ignore it — a
// hand-authored ModelSpec already states its own size in its part dimensions,
// and second-guessing that with a multiplier would just fight the author.

/**
 * A LEGIBILITY FLOOR, not a physical one. Rendered at true scale a ring is 2cm
 * across, which on a phone at walking distance is a few pixels of dark metal on
 * a dark floor — invisible, and the pickup glow ends up being the only thing you
 * see. Everything on the ground is drawn at least this big, so the object itself
 * always carries the read; the SIZE ORDERING between items survives, which is
 * the part that was actually missing.
 */
const MIN_READABLE_M = 0.26;

/** The default size for each item kind, before per-item overrides. */
const BY_KIND: Partial<Record<ItemKind, number>> = {
  relic: 0.24,         // the catch-all curio — a ring, a tooth, a signet
  consumable: 0.20,    // a flask, a phial
  key: 0.22,
  ember: 0.20,
  vestment: 0.50,      // a cloak or a helm — worn, so torso-or-head sized
  offhand: 0.45,       // a buckler, a lantern
  weapon: 0.85,        // the biggest thing you will find lying about
};

/** Anything with no entry above and no override. Deliberately modest: an
 *  unclassified curio should read as small, not as a shield. */
const FALLBACK_M = 0.28;

/**
 * How wide this item should be where it lies, in metres.
 *
 * Order: the item's own `dropSize` (the author knows best — a battle standard
 * and a signet are both `relic`), else its kind, else the fallback. Floored at
 * MIN_READABLE_M so nothing becomes a pixel.
 */
export function dropSizeMeters(item: Pick<ItemSpec, 'kind'> & { dropSize?: number }): number {
  const authored = item.dropSize;
  if (authored !== undefined) return Math.max(MIN_READABLE_M, authored);
  return Math.max(MIN_READABLE_M, BY_KIND[item.kind] ?? FALLBACK_M);
}

/**
 * A thing PRESENTED on a stone — a trove offering, a shop's stock — rather than
 * dropped on the floor. Held to a larger floor: you are being asked to choose
 * between these, and a choice you have to squint at is a worse choice. The
 * ordering still shows through (a weapon still dwarfs a ring), it just starts
 * higher up.
 */
const PEDESTAL_MIN_M = 0.42;

export function pedestalSizeMeters(item: Pick<ItemSpec, 'kind'> & { dropSize?: number }): number {
  return Math.max(PEDESTAL_MIN_M, dropSizeMeters(item));
}

/** Exported for tests + tooling: the readability floors and the kind table. */
export const DROP_SIZE = { MIN_READABLE_M, PEDESTAL_MIN_M, BY_KIND, FALLBACK_M } as const;
