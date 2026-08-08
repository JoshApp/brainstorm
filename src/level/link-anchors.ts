import type { Poly } from './room-shape';
import { type PortalAnchor, facesToward, PORTAL_BANDS } from './anchors';
import { MIN_WALKABLE_WIDTH } from './corridor-types';

// ── A LINK PICKS TWO ANCHORS AND AGREES ON ONE OPENING ───────────────────────
//
// Step 3 of docs/SPACES-AND-THRESHOLDS.md, and the one that removes the
// overshoot. Today `connect()` guesses: it tries lateral offsets
// `[0, ±1.5, ±3, ±4.5]`, ray-casts each room's polygon to find where its wall
// happens to be, and then pushes 0.9m PAST it so the rect-crossing finders can
// see a crossing. That 0.9m is the lookup key the whole repair layer exists to
// undo.
//
// With anchors there is nothing to look up. Both walls already published where
// they can be opened, so the link picks a pair and both ends are known exactly.
//
// ── WHAT IS MEASURED, NOT ASSUMED ────────────────────────────────────────────
//
// Over 183 real links on 48 floors, a facing anchor pair with overlapping
// lateral spans exists for 98% of them, and the overlap affords:
//
//   a mainline door (1.35m)  84%
//   a wide opening (2.2m)    68%
//   a gate (4m+)             35%
//
// So the pairing works for the large majority and fails for a real minority.
// That minority is why `chooseLinkOpening` returns null instead of clamping to
// something illegal: a link whose walls cannot agree is a placement problem to
// be fixed upstream, and silently building a 0.9m mainline would hide it.

/** Where an anchor's usable run actually sits in the world, and which way the
 *  wall runs. Both are needed to know whether two anchors can see each other. */
export interface AnchorSpan {
  /** The two ends of the usable run, world metres. */
  from: readonly [number, number];
  to: readonly [number, number];
  /** True when the wall runs along X (so the opening's width is measured in X). */
  alongX: boolean;
}

export function anchorSpan(anchor: PortalAnchor, poly: Poly): AnchorSpan {
  const p = poly[anchor.edge], q = poly[(anchor.edge + 1) % poly.length];
  const dx = q[0] - p[0], dz = q[1] - p[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  return {
    from: [p[0] + ux * anchor.t0, p[1] + uz * anchor.t0],
    to: [p[0] + ux * anchor.t1, p[1] + uz * anchor.t1],
    alongX: Math.abs(dx) > Math.abs(dz),
  };
}

/** The opening two anchors settled on. */
export interface LinkOpening {
  a: PortalAnchor;
  b: PortalAnchor;
  /** The corridor's centre line on the axis perpendicular to travel. */
  lateral: number;
  /** Clear width, agreed by both walls. */
  width: number;
  /** Which band it landed in — `door` for anything the layout may rely on. */
  band: 'crawl' | 'door' | 'gate';
}

export interface LinkSide {
  poly: Poly;
  anchors: readonly PortalAnchor[];
}

/**
 * HOW WIDE AN AGREED OPENING WANTS TO BE.
 *
 * Josh: *"the big entrances are probably better by default."*
 *
 * So the default is not "whatever the corridor section is" — it is the section
 * OPENED OUT as far as both walls can afford, up to a cap. A passage 2.2m wide
 * arriving through a 3.5m mouth is the splayed embrasure the doc argues for
 * (put the flare on the threshold, not the corridor); it costs one model
 * variant instead of a variable-width corridor.
 *
 * The cap is what stops "as wide as possible" from turning every seam into a
 * gate and destroying the thing that makes a gate mean something.
 */
export const GENEROSITY = 1.6;
/** Above this, an opening is a monument and must be ASKED for, never inherited
 *  from an arithmetic maximum. */
export const GATE_MIN = 4.0;

export interface OpeningWant {
  /** What the corridor section wants to be — its own clear width. */
  section: number;
  /** Set when this seam has earned a monument (an act boundary, a sanctum, a
   *  boss ward). Only then may the opening reach the gate band. */
  monumental?: boolean;
  /**
   * The narrowest BAND this link will accept. Defaults to `door`, and that
   * default is load-bearing.
   *
   * Without it the chooser happily returned a 1.0m opening whenever two walls
   * only overlapped by that much — legal against both anchors' published
   * ranges, and a deadlock in practice, because a mainline is a corridor every
   * mob on the floor must be able to walk down. 24 of 183 links did exactly
   * that before this existed.
   *
   * Josh: *"having the option for smaller ways could be handy for secret
   * passages."* That is what `'crawl'` is for — asked for by a link that means
   * it, never inherited from a wall that happened to be short.
   */
  minBand?: 'crawl' | 'door';
}

/**
 * Pick the best facing anchor pair for a link, and the width both walls accept.
 *
 * `toward` is the direction from side A to side B; only anchors facing that way
 * and standing on walls PERPENDICULAR to it can serve — a wall parallel to
 * travel cannot be entered head-on.
 *
 * Returns null when no pair overlaps by a usable width. That is a real answer,
 * not a failure to try: it means these two rooms do not face each other enough
 * to be joined here, and the layout should move one or route around.
 */
export function chooseLinkOpening(
  A: LinkSide, B: LinkSide, toward: readonly [number, number], want: OpeningWant,
): LinkOpening | null {
  const [dx, dz] = toward;
  const alongX = Math.abs(dx) > Math.abs(dz);
  let best: LinkOpening | null = null;

  for (const a of A.anchors) {
    if (!facesToward(a, dx, dz)) continue;
    const sa = anchorSpan(a, A.poly);
    if (sa.alongX === alongX) continue;   // wall runs along travel — not enterable
    const la = lateralRange(sa, alongX);

    for (const b of B.anchors) {
      if (!facesToward(b, -dx, -dz)) continue;
      const sb = anchorSpan(b, B.poly);
      if (sb.alongX === alongX) continue;
      const lb = lateralRange(sb, alongX);

      const lo = Math.max(la[0], lb[0]), hi = Math.min(la[1], lb[1]);
      const room = hi - lo;
      if (room <= 0) continue;

      // Both walls' own published ranges still bound it — an anchor may not be
      // cut wider than the run it declared, however much the overlap allows.
      const ceiling = Math.min(room, a.width[1], b.width[1]);
      // The link's own floor, not just the walls'. A mainline needs a door;
      // only a link that ASKS for a crawl may go under it.
      const floor = Math.max(
        a.width[0], b.width[0],
        want.minBand === 'crawl' ? 0 : MIN_WALKABLE_WIDTH,
      );
      if (ceiling < floor) continue;

      const width = pickWidth(ceiling, want);
      if (width < floor) continue;
      const cand: LinkOpening = {
        a, b, lateral: (lo + hi) / 2, width, band: bandOf(width),
      };
      // Widest wins. With "big by default" that is the whole selection rule —
      // and it is stable, where "closest to the room centres" flips on a
      // centimetre and makes the floor jitter between seeds.
      if (!best || cand.width > best.width) best = cand;
    }
  }
  return best;
}

function lateralRange(s: AnchorSpan, alongX: boolean): [number, number] {
  const a = alongX ? s.from[1] : s.from[0];
  const b = alongX ? s.to[1] : s.to[0];
  return a < b ? [a, b] : [b, a];
}

/**
 * NOTE — an opening may come out NARROWER than its corridor.
 *
 * A gallery (3.6m) meeting two walls that only overlap by 3.0m gets a 3.0m
 * mouth: a pinch, not a flare. That is the honest answer — the wall cannot
 * afford the corridor — but the right response is upstream, in the section
 * choice: a link whose walls can only agree on 3.0m should not have been
 * called a gallery. Wiring that feedback is step 4; until then the caller can
 * compare `opening.width` against `want.section` and see it.
 */
function pickWidth(ceiling: number, want: OpeningWant): number {
  const generous = want.section * GENEROSITY;
  if (want.monumental) return Math.min(ceiling, Math.max(generous, GATE_MIN));
  // Never widen INTO the gate band by accident. An ordinary seam that happens
  // to have 9m of wall available is still an ordinary seam.
  return Math.min(ceiling, generous, GATE_MIN - 0.01);
}

function bandOf(width: number): 'crawl' | 'door' | 'gate' {
  if (width >= GATE_MIN) return 'gate';
  return width >= MIN_WALKABLE_WIDTH ? 'door' : 'crawl';
}

/** The band an opening of this width belongs to, for callers that have a width
 *  but no opening (the wall builder, the frame chooser). */
export function bandForWidth(width: number): typeof PORTAL_BANDS[number] | null {
  return PORTAL_BANDS.find((b) => width >= b.width[0] && width <= b.width[1]) ?? null;
}
