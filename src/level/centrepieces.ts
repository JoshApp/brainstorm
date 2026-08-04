// CENTREPIECES — the ONE notable thing a role room stages.
//
// The room-type table (level/room-types.ts) says WHAT a room is and therefore
// what its centrepiece IS; this module turns that word into actual props at
// actual positions. The cap is structural: a room has exactly one centrepiece
// field, so it gets exactly one call here, so it can never end up with a
// bonfire AND a fountain AND an altar stacked in its middle (#64). The old
// spacing heuristics guarded against that by measuring distances after the
// fact; this makes it impossible up front.
//
// PURE — rand is injected, no scene, no THREE — so a floor's landmarks are
// deterministic per seed and unit-testable.
//
// A centrepiece the composer already owns (the director's fire, the staged
// deal, the boss vault, the stairs) returns NOTHING here on purpose. This
// module only places what the ROLE-ASSIGNMENT pass promoted; it does not
// second-guess passes that were already doing their job.

import { CONFIG } from '../config';
import { roomType, type Centrepiece } from './room-types';
import { rollDropItem } from '../content/drop-tables';
import { rollChestLoot } from './decor-defaults';
import { BONFIRE } from '../content/bonfire';
import { floorGlow } from '../content/light-props';
import type { PropSpec } from './types';

/** Where a centrepiece may stand, and what the room can tell it. */
export interface CentrepieceSite {
  roomId: string;
  /** The room's focal point in world XZ — normally its open centre. */
  x: number;
  z: number;
  /** Room extents in world units. Drives which axis a multi-slot piece lays along. */
  w: number;
  d: number;
  /** Is this world point standable, unclaimed floor? Supplied by the composer,
   *  which owns the occupancy view. */
  free: (x: number, z: number) => boolean;
  /**
   * Unit vector from the room's centre toward the way IN, if the composer knows
   * one. This is what lets a staged room face the player instead of facing north.
   *
   * A presentation only reads if it's composed from where the viewer stands: a
   * row of offerings should spread LEFT-TO-RIGHT across your view as you walk in
   * (so you take all three in at a glance and choose), and a shopkeeper should be
   * behind his wares with the goods between you and him. Laid out on a fixed
   * world axis instead, the same row becomes a queue you walk down and the stall
   * is something you approach from the side or the back.
   *
   * Absent (a room with no corridor, a hand-authored vault) → fall back to the
   * room's own proportions.
   */
  entranceDir?: { x: number; z: number };
}

export interface CentrepieceCtx {
  depth: number;
  rand: () => number;
}

/** What a centrepiece placed, so the composer can reserve the cells it took. */
export interface PlacedCentrepiece {
  props: PropSpec[];
  /** Every world point the centrepiece occupies — reserve these so no enemy,
   *  vase, or torch lands inside the thing the room is about. */
  claimed: Array<{ x: number; z: number }>;
}

const EMPTY: PlacedCentrepiece = { props: [], claimed: [] };

/** A choice needs an alternative. Below this the trove isn't a trove. */
const MIN_TROVE_OFFERINGS = 2;

/** How far behind the counter the keeper stands (m). */
const STALL_DEPTH = 1.5;

/** The trove's signature. Warm gold — deliberately the ONE hue the dungeon's
 *  own palette never produces, so a glimpse of it down a side passage reads as
 *  "something is being offered" before anything is legible. */
const TROVE_GOLD = 0xffc257;

/**
 * Stage a room's centrepiece. Returns EMPTY when the type has none, or when the
 * room's geometry can't carry the piece — an unplaceable centrepiece degrades to
 * an ordinary room rather than jamming furniture into a wall.
 */
export function planCentrepiece(
  roleId: string,
  site: CentrepieceSite,
  ctx: CentrepieceCtx,
): PlacedCentrepiece {
  const piece: Centrepiece = roomType(roleId).centrepiece;
  switch (piece) {
    case 'offerings': return planTrove(site, ctx);
    case 'merchant':  return planMerchant(site, ctx);
    case 'gauntlet':  return planGauntlet(site);
    case 'hazard':    return planHazard(site, ctx);
    case 'fire':      return planFire(site);
    // Owned by passes that already exist: the stairs pass the descent, the boss
    // vault its own arena, the fill stage the bargain. Nothing to do here — and
    // nothing to fight with.
    default: return EMPTY;
  }
}

// ── The trove: three stones, take one ────────────────────────────────

/** Lay N slots in a line centred on the site, along `axis`, `gap` apart. */
function lineSlots(
  site: CentrepieceSite, n: number, gap: number, axis: 'x' | 'z',
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const span = (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const off = -span / 2 + i * gap;
    out.push(axis === 'x' ? { x: site.x + off, z: site.z } : { x: site.x, z: site.z + off });
  }
  return out;
}

/**
 * The floor's guaranteed choice. Three offerings stood up in a row, spaced far
 * enough apart that their floating cards stay readable, laid along whichever
 * room axis has the room for them. Degrades gracefully: a tight room gets two,
 * a room too tight for even that gets a chest instead (see below).
 */
function planTrove(site: CentrepieceSite, ctx: CentrepieceCtx): PlacedCentrepiece {
  const gap = CONFIG.CENTREPIECE.OFFERING_MIN_SPACING;
  const wantN = CONFIG.CENTREPIECE.TROVE_OFFERINGS;
  // Try the long axis first (a row reads best down the room's length), then the
  // short one, then fewer stones. First layout where every slot is open wins.
  // ACROSS THE APPROACH, not along it. The row runs perpendicular to the way in,
  // so the three stones land LEFT / MIDDLE / RIGHT in your view the moment you
  // step through the door — one glance, three options, a choice. Laid out along
  // the approach instead, the same three stones are a corridor you walk down and
  // the comparison never happens.
  const acrossFirst = site.entranceDir
    ? (Math.abs(site.entranceDir.x) >= Math.abs(site.entranceDir.z) ? 'z' : 'x')
    : (site.w >= site.d ? 'x' : 'z');
  let slots: Array<{ x: number; z: number }> | null = null;
  outer:
  for (let n = wantN; n >= MIN_TROVE_OFFERINGS; n--) {
    for (const axis of [acrossFirst, acrossFirst === 'x' ? 'z' : 'x'] as const) {
      const trial = lineSlots(site, n, gap, axis);
      if (trial.every((s) => site.free(s.x, s.z))) { slots = trial; break outer; }
    }
  }
  // A room too cramped to stand two stones apart can't hold a CHOICE — and one
  // offering isn't a trove, it's a chest with extra ceremony. So it becomes a
  // chest: the reward still lands, it just stops pretending to be a decision.
  if (!slots) return planConsolationChest(site, ctx);

  // Distinct goods — an offering of three copies of one thing isn't a choice.
  const groupId = `trove:${site.roomId}`;
  const props: PropSpec[] = [];
  const taken = new Set<string>();
  for (const s of slots) {
    let item = null;
    for (let attempt = 0; attempt < 6 && !item; attempt++) {
      const rolled = rollDropItem('trove', ctx.depth, ctx.rand);
      if (rolled && !taken.has(rolled.id)) item = rolled;
    }
    if (!item) continue;
    taken.add(item.id);
    props.push({
      kind: 'offering', x: s.x, z: s.z, itemId: item.id, groupId, style: 'pedestal',
      rotY: facingEntrance(site),
    });
  }
  if (props.length === 0) return EMPTY;

  // THE TROVE IS A GIFT, AND IT SHOULD LOOK LIKE ONE.
  //
  // Lighting doctrine (docs/VISUAL-LANGUAGE.md, CLAUDE.md "Lighting as signal"):
  // the dungeon's baseline is dark and the player's lamp is the only warmth, so
  // a coloured floor glow means SOMETHING IS HAPPENING HERE. Gold is the one
  // colour the dark never offers on its own — the trove is the single place in a
  // run that gives freely, so it gets the warmest light in the game and earns it
  // by being rare (once per act now).
  //
  // A pool under each stone rather than one big wash: the light follows the
  // CHOICE, so three lit plinths in the dark read as three things on offer
  // before you're close enough to see what any of them are.
  for (const s of slots) {
    props.push({ kind: 'model', model: floorGlow(TROVE_GOLD), x: s.x, y: 0, z: s.z });
  }
  return { props, claimed: slots };
}

/** The trove's fallback when the room can't stand two stones apart: a single
 *  gold chest on the focal spot. Same reward tier, no false ceremony. */
function planConsolationChest(site: CentrepieceSite, ctx: CentrepieceCtx): PlacedCentrepiece {
  if (!site.free(site.x, site.z)) return EMPTY;
  return {
    // Loot is rolled HERE, not left to the procgen defaults: those only fill a
    // chest that declared no tier, and a centrepiece always declares one. A
    // chest that names its tier must name its contents too, or the room's whole
    // reason to exist opens empty.
    props: [{
      kind: 'chest', x: site.x, z: site.z, tier: 'gold',
      loot: rollChestLoot('gold', ctx.rand, ctx.depth), facing: { kind: 'wall-away' },
    }],
    claimed: [{ x: site.x, z: site.z }],
  };
}

// ── The rest: one prop, one cell ─────────────────────────────────────

/**
 * A STALL: the keeper stands behind his goods, and the goods face you.
 *
 * The merchant used to be a lone figure in the middle of a room whose entire
 * stock lived in a menu. A shop should read as a shop from the doorway — wares
 * laid out, a man behind them — so the keeper steps BACK from the room's centre
 * (away from the way in) and the stock stands in a row between you and him,
 * across your approach exactly like the trove's. You walk up to the counter.
 *
 * The goods are offerings with a price tag: the offering system already routes
 * costs through the same central applier as every other priced thing, so a stall
 * is a trove you have to pay for — no second mechanism.
 */
function planMerchant(site: CentrepieceSite, ctx: CentrepieceCtx): PlacedCentrepiece {
  if (!site.free(site.x, site.z)) return EMPTY;
  const dir = site.entranceDir ?? { x: 0, z: -1 };
  // The keeper stands a step BEYOND the counter, on the far side from the door.
  const keep = { x: site.x - dir.x * STALL_DEPTH, z: site.z - dir.z * STALL_DEPTH };
  const props: PropSpec[] = [];
  const claimed: Array<{ x: number; z: number }> = [];

  if (site.free(keep.x, keep.z)) {
    props.push({ kind: 'merchant', x: keep.x, z: keep.z, rotY: facingEntrance(site) });
    claimed.push(keep);
  } else {
    props.push({ kind: 'merchant', x: site.x, z: site.z, rotY: facingEntrance(site) });
    claimed.push({ x: site.x, z: site.z });
  }

  // THE COUNTER — wares across the approach, between you and him.
  const gap = CONFIG.CENTREPIECE.OFFERING_MIN_SPACING;
  const across: 'x' | 'z' = Math.abs(dir.x) >= Math.abs(dir.z) ? 'z' : 'x';
  const groupId = `stall:${site.roomId}`;
  const stalls = lineSlots(site, CONFIG.CENTREPIECE.STALL_WARES, gap, across);
  const taken = new Set<string>();
  for (const s of stalls) {
    if (!site.free(s.x, s.z)) continue;
    let item = null;
    for (let attempt = 0; attempt < 6 && !item; attempt++) {
      const rolled = rollDropItem('merchant', ctx.depth, ctx.rand);
      if (rolled && !taken.has(rolled.id)) item = rolled;
    }
    if (!item) continue;
    taken.add(item.id);
    props.push({
      kind: 'offering', x: s.x, z: s.z, itemId: item.id, groupId, style: 'ground',
      rotY: facingEntrance(site),
      // Priced, and you may buy MORE THAN ONE — a stall isn't a choice of one,
      // it's a shelf. `picks` is carried on the spawn side; the cost is what
      // makes it a shop rather than a gift.
      costGold: shopPrice(item.rarity, ctx.depth),
    });
    claimed.push(s);
  }
  return { props, claimed };
}

/** What a stall charges. Scales with rarity and depth — deeper goods cost more
 *  because you have more coin by then, not because they're better value. */
function shopPrice(rarity: string | undefined, depth: number): number {
  const tier = rarity === 'fabled' ? 4 : rarity === 'cursed' ? 3
    : rarity === 'rare' ? 3 : rarity === 'uncommon' ? 2 : 1;
  return Math.round((14 + tier * 16) * (1 + depth * 0.08));
}

/** rotY that turns a prop to face the way IN. Everything a room stages should
 *  look at the player, not at north. */
function facingEntrance(site: CentrepieceSite): number {
  const d = site.entranceDir;
  if (!d) return 0;
  return Math.atan2(d.x, d.z);
}

/**
 * A REST, as a planned event rather than a thing the director sprinkles.
 *
 * The fire is a `mercy` entry with `anywhere` placement (floor-plan.ts): Dark
 * Souls puts bonfires ON THE PATH, and the "thank god" is stumbling into one,
 * not routing to one. Staging it here — as a room's ONE centrepiece — is also
 * what makes "never combined with another event" structural instead of a rule:
 * a room has one centrepiece, so a fire room is a fire room.
 *
 * And because it's a centrepiece, it can be MODIFIED. `sanctum + contested` is a
 * fire you have to fight for; `sanctum + ambush` is mercy that turns on you.
 */
function planFire(site: CentrepieceSite): PlacedCentrepiece {
  if (!site.free(site.x, site.z)) return EMPTY;
  return {
    props: [{ kind: 'model', model: BONFIRE, x: site.x, y: 0, z: site.z, rotY: 0.7 }],
    claimed: [{ x: site.x, z: site.z }],
  };
}

/** The voluntary trial. The altar IS the trigger; the room's perimeter fitting
 *  (installed by the composer for an arena room) is the seal. */
function planGauntlet(site: CentrepieceSite): PlacedCentrepiece {
  if (!site.free(site.x, site.z)) return EMPTY;
  return {
    props: [{ kind: 'challenge-offering', x: site.x, z: site.z }],
    claimed: [{ x: site.x, z: site.z }],
  };
}

/**
 * The hazard and the prize it guards. A chest sits in the open, ringed by spike
 * traps — the reward is never hidden, only defended by the floor itself. Spikes
 * that can't fit are simply skipped, so a cramped room gets a thinner ring
 * rather than traps inside the walls.
 */
function planHazard(site: CentrepieceSite, ctx: CentrepieceCtx): PlacedCentrepiece {
  if (!site.free(site.x, site.z)) return EMPTY;
  const r = CONFIG.CENTREPIECE.HAZARD_RING_RADIUS;
  const n = CONFIG.CENTREPIECE.HAZARD_RING_SPIKES;
  const claimed = [{ x: site.x, z: site.z }];
  // Loot rolled here for the same reason as the consolation chest above — a
  // tier-declaring chest is skipped by the procgen default fill.
  const props: PropSpec[] = [{
    kind: 'chest', x: site.x, z: site.z, tier: 'silver',
    loot: rollChestLoot('silver', ctx.rand, ctx.depth), facing: { kind: 'wall-away' },
  }];
  // Offset the ring by a rolled phase so two trap rooms don't read identically.
  const phase = ctx.rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const x = site.x + Math.cos(a) * r;
    const z = site.z + Math.sin(a) * r;
    if (!site.free(x, z)) continue;
    props.push({ kind: 'spike-trap', x, z });
    claimed.push({ x, z });
  }
  return { props, claimed };
}
