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
    case 'merchant':  return planMerchant(site);
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
  const longAxis: 'x' | 'z' = site.w >= site.d ? 'x' : 'z';
  let slots: Array<{ x: number; z: number }> | null = null;
  outer:
  for (let n = wantN; n >= MIN_TROVE_OFFERINGS; n--) {
    for (const axis of [longAxis, longAxis === 'x' ? 'z' : 'x'] as const) {
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
    props.push({ kind: 'offering', x: s.x, z: s.z, itemId: item.id, groupId, style: 'pedestal' });
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

function planMerchant(site: CentrepieceSite): PlacedCentrepiece {
  if (!site.free(site.x, site.z)) return EMPTY;
  return {
    props: [{ kind: 'merchant', x: site.x, z: site.z }],
    claimed: [{ x: site.x, z: site.z }],
  };
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
