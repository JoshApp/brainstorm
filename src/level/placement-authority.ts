import type { PropSpec, WalkableRect } from './types';

// ── THE PLACEMENT AUTHORITY ──────────────────────────────────────────────────
//
// One object per floor that answers "may I put this here, and if not, why not".
// See docs/LEVEL-OWNERSHIP.md for the diagnosis it exists to fix; the short
// version is that SEVEN files put objects into a floor and only ONE consulted
// the occupancy grid, so every rule had to be re-enforced by a cull at the end —
// and a cull can only delete, never place something better.
//
// ── WHY NOT JUST USE occupancy-grid.ts ───────────────────────────────────────
// Because it is addressed in VAULT-LOCAL ASCII coordinates (`col,row` inside one
// vault's tilemap). Every downstream producer — clutter, decor, centrepieces,
// the loot director, the builder — works in WORLD metres and literally cannot
// address it. That, not indiscipline, is why they each grew a private idea of
// "free". This is the same idea in the coordinate system everyone speaks.
//
// ── THINGS ARE AWARE OF EACH OTHER, NOT JUST OF SPACE ────────────────────────
// Josh's framing, and the part a plain occupancy bitmap cannot express:
//
//   "you can place an event and decorate it with candles
//    but you can't put a pillar inside it"
//
// So a claim carries INTENT, and a feature declares an APRON around itself with
// a policy about what may join it. Candles and torches are welcome in an altar's
// apron — the lighting doctrine actively wants them there. A pillar, a spike
// trap or a second event are refused. One rule, stated once, by the thing that
// knows: the altar.
//
// The payoff is that a refusal is INFORMATIVE. A producer told "no — a feature's
// apron" can try its next candidate cell. A cull at the end can only delete what
// it finds, which is why the shop-spawn cull had to be moved earlier the moment
// it started pushing floors under their combat minimum.

/** What a thing IS, for placement purposes. Not its art — its behaviour. */
export type PlaceKind =
  /** An interactable / event: altar, chest, fountain, merchant, stairs. Owns its
   *  cell and declares an apron around it. */
  | 'feature'
  /** Geometry you cannot walk through: pillar, statue, rubble bank, fallen
   *  column. The thing that must never end up inside an event. */
  | 'blocker'
  /** Hurts, or removes floor: spike trap, carved chasm. */
  | 'hazard'
  /** Small, floor-standing, discardable: candle, vase, bones, debris. WELCOME in
   *  a feature's apron — this is what dressing an event means. */
  | 'decor'
  /** Wall-mounted, coexists with anything on the floor: torch, wall rune. */
  | 'light'
  /** Where an enemy stands up. */
  | 'spawn'
  /** A pickup / offering lying on the ground. */
  | 'loot';

/** Why a claim was refused. Producers may branch on it; humans read it in the
 *  audit output, which is most of its value. */
export type RefusalReason =
  | 'off-floor'        // no walkable rect here at all
  | 'void'             // a carved chasm
  | 'occupied'         // something of a conflicting kind already holds the cell
  | 'feature-apron'    // too close to an event that refuses this kind
  | 'room-refuses';    // the room's TYPE says no (a shop takes no enemies)

export interface ClaimResult {
  ok: boolean;
  why?: RefusalReason;
}

/** Metres per cell. One metre matches the vault ASCII grid, so an authority cell
 *  and a vault cell are the same square and the two reconcile without
 *  resampling. */
const CELL = 1;

/** How far a feature's apron reaches. Sized from the interact clearance the
 *  elbow-room sweep already used (1.25m) — the distance at which clutter starts
 *  visibly crowding a thing you have to walk up to and touch. */
const APRON_M = 1.25;

/** What a feature's apron ADMITS. Everything else is refused inside it. This one
 *  line is "decorate the altar with candles, don't put a pillar in it", as
 *  data. */
const APRON_ADMITS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['decor', 'light', 'loot']);

/** Kinds that stand on the floor and therefore exclude each other outright. */
const FLOOR_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>([
  'feature', 'blocker', 'hazard', 'decor', 'spawn', 'loot',
]);

interface Cell {
  kind: PlaceKind;
  roomId?: string;
  /** Debug: what actually claimed it. */
  by: string;
}

export interface PlacementOpts {
  /** Walkable floor rectangles — rooms AND corridors. */
  rects: readonly WalkableRect[];
  /** Carved chasms. Nothing but a hazard belongs over one. */
  voids?: readonly WalkableRect[];
}

export class PlacementAuthority {
  private readonly cells = new Map<string, Cell>();
  /** Feature centres, for the apron test. A list because there are only ever a
   *  handful per floor and the test is a distance check. */
  private readonly features: Array<{ x: number; z: number }> = [];
  private readonly rects: readonly WalkableRect[];
  private readonly voids: readonly WalkableRect[];
  /** Room types that refuse a kind — filled by the composer, the only thing that
   *  knows the room→type assignment. */
  private readonly roomRefuses = new Map<string, Set<PlaceKind>>();
  /** Audit: every refusal this floor, by reason. */
  readonly refusals: Record<string, number> = {};

  constructor(opts: PlacementOpts) {
    this.rects = opts.rects;
    this.voids = opts.voids ?? [];
  }

  private key(x: number, z: number): string {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  /** Teach the authority that a room's TYPE refuses something — "a shop takes no
   *  enemies". Stated once, here, instead of by every producer separately. */
  refuse(roomId: string, ...kinds: PlaceKind[]): void {
    const set = this.roomRefuses.get(roomId) ?? new Set<PlaceKind>();
    for (const k of kinds) set.add(k);
    this.roomRefuses.set(roomId, set);
  }

  private onFloor(x: number, z: number): boolean {
    return this.rects.some((r) =>
      Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2);
  }

  private inVoid(x: number, z: number): boolean {
    return this.voids.some((v) =>
      Math.abs(x - v.x) <= v.w / 2 && Math.abs(z - v.z) <= v.d / 2);
  }

  /** Would this land? Pure — ask as often as you like while hunting for a spot. */
  test(x: number, z: number, kind: PlaceKind, roomId?: string, radius = 0): ClaimResult {
    const no = (why: RefusalReason): ClaimResult => {
      this.refusals[why] = (this.refusals[why] ?? 0) + 1;
      return { ok: false, why };
    };

    if (kind !== 'light') {
      if (!this.onFloor(x, z)) return no('off-floor');
      // A VOID under a thing is Josh's report: "the basin is standing like almost
      // in the void or slightly over it". A hazard may BE a void; nothing else
      // may sit on one.
      if (kind !== 'hazard' && this.inVoid(x, z)) return no('void');
    }

    if (roomId) {
      const refused = this.roomRefuses.get(roomId);
      if (refused?.has(kind)) return no('room-refuses');
    }

    // A feature's apron: candles and torches welcome, pillars and spikes not.
    if (!APRON_ADMITS.has(kind)) {
      // The apron is measured against the thing's FOOTPRINT, not its anchor.
      // A rubble pile anchored 1.3m from an altar with a metre of spread still
      // grows out of the altar's plinth — which is exactly what the elbow-room
      // sweep was deleting afterwards. Callers pass the radius they already know
      // (clutter's own spacing distance), so the refusal happens at proposal
      // time and the sampler simply picks elsewhere.
      const reach = APRON_M + radius;
      for (const f of this.features) {
        if (Math.abs(f.x - x) > reach || Math.abs(f.z - z) > reach) continue;
        if (Math.hypot(f.x - x, f.z - z) <= reach) return no('feature-apron');
      }
    }

    if (FLOOR_KINDS.has(kind)) {
      const held = this.cells.get(this.key(x, z));
      if (held && FLOOR_KINDS.has(held.kind)) return no('occupied');
    }
    return { ok: true };
  }

  /**
   * Take the cell. Same verdict `test` gives, and only writes when it's ok — so
   * `if (!auth.claim(...).ok) continue;` is the whole idiom a producer needs.
   */
  claim(x: number, z: number, kind: PlaceKind, by: string, roomId?: string, radius = 0): ClaimResult {
    const verdict = this.test(x, z, kind, roomId, radius);
    if (!verdict.ok) return verdict;
    if (FLOOR_KINDS.has(kind)) this.cells.set(this.key(x, z), { kind, roomId, by });
    if (kind === 'feature') this.features.push({ x, z });
    return verdict;
  }

  /**
   * Learn what the EARLIER passes already did. Those producers ran before this
   * seam existed; rather than rewrite all twenty-six sites at once (the staging
   * in LEVEL-OWNERSHIP.md), the authority reads their output and then holds the
   * line for everyone who comes after.
   */
  seedFrom(props: readonly PropSpec[]): void {
    for (const p of props) {
      const kind = placeKindOf(p.kind);
      if (!kind) continue;
      const px = (p as unknown as { x?: number }).x;
      const pz = (p as unknown as { z?: number }).z;
      if (typeof px !== 'number' || typeof pz !== 'number') continue;
      if (FLOOR_KINDS.has(kind)) this.cells.set(this.key(px, pz), { kind, by: 'seed' });
      if (kind === 'feature') this.features.push({ x: px, z: pz });
    }
  }

  /** Debug/audit: what holds this cell. */
  at(x: number, z: number): Cell | undefined {
    return this.cells.get(this.key(x, z));
  }

  /** Audit: claimed cells by kind. */
  census(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.cells.values()) out[c.kind] = (out[c.kind] ?? 0) + 1;
    return out;
  }
}

/**
 * Prop kind → placement kind. THE one classification, so the six producers stop
 * each keeping their own.
 *
 * Default is 'blocker', deliberately: an unclassified prop is assumed to be
 * something you can walk into, so the authority errs toward keeping an unknown
 * thing OUT of an event's apron rather than letting it crowd one.
 */
const FEATURE_KINDS = new Set<string>([
  'chest', 'stash-chest', 'altar', 'blood-altar', 'starter-altar', 'fountain',
  'tithe-basin', 'reliquary', 'tome-pillar', 'merchant', 'trinket-merchant',
  'blacksmith', 'challenge-offering', 'offering', 'corpse', 'searchable',
  'stairs', 'boss-mist',
]);
// NOT cobwebs. Decor is admitted into a feature's apron because dressing an
// event is the point — but a candle TENDS a thing and a cobweb says nobody has.
// Classified as a blocker, it gets refused from the apron like a pillar, which is
// what "the merchant stands inside his own cobwebs" actually needed.
const DECOR_KINDS = new Set<string>(['vase', 'candle', 'bones', 'debris', 'rubble']);
const HAZARD_KINDS = new Set<string>(['spike-trap']);
const LIGHT_KINDS = new Set<string>(['torch', 'wall-rune']);

export function placeKindOf(kind: string): PlaceKind | null {
  if (kind === 'decal' || kind === 'loot-anchor') return null;   // coexists with anything
  if (FEATURE_KINDS.has(kind)) return 'feature';
  if (DECOR_KINDS.has(kind)) return 'decor';
  if (HAZARD_KINDS.has(kind)) return 'hazard';
  if (LIGHT_KINDS.has(kind)) return 'light';
  if (kind === 'spawn') return 'spawn';
  if (kind === 'pickup') return 'loot';
  return 'blocker';
}
