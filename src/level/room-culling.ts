import * as THREE from 'three';
import type { LiveLevel } from './builder';
import { on as onEvent } from '../broadcast/event-bus';
import { getAllInteractables } from '../interactables/system';
import { setStaticBatchRectVisible, showAllStaticBatches } from '../scene/static-batch';
import { CONFIG } from '../config';
import { DEV } from '../debug/dev';
import { sightFar } from '../scene/sight-distance';
import { pointInPoly } from './room-shape';
import { veilAlphaBetween } from '../scene/threshold-veil';
import { isSignal } from '../scene/signal-layer';
import { type Poly } from './room-shape';
import { rectAtIn, RECT_EPS } from './rect-at';
import { propClassGateLimit } from '../ecs/build-model';
import { signalKnobs } from '../debug/tuning-signal';
import {
  AT_PLAYER, GATE_KINDS, acrossGate, bestOf, exhausted, improves,
  type GateDepths, type GateKindId,
} from './gate-kinds';
import type { PropClass } from '../ecs/model-types';
import { claimWorld, worldIsCurrent, publishFrame, retireWorld } from './space-index';

// Portal/room visibility culling. Three.js frustum-culls (the view cone) but
// never OCCLUSION-culls — a wall doesn't stop the frustum, so a room hidden
// behind a wall you're facing still gets submitted as draw calls. This module
// fixes that for the room-based dungeon: it renders only the room you're in
// plus rooms reachable through doorways that are actually in view, and hides
// the rest (sets their static geometry `.visible = false`).
//
// Fully self-contained: it reads the FINISHED level (root children + torches +
// rect list) and never touches the builder. It groups each rect's toggleable
// static content (walls/floor/ceiling by their dbgSource room tag; torches by
// position) and flips visibility per frame from a frustum-gated flood-fill over
// the doorway graph.
//
// Conservative by design: it errs toward rendering (generous doorway margin,
// 2-hop sightlines over-render slightly rather than pop in). The MARGIN is the
// knob to tune on-device — bigger = rooms reveal earlier = less pop-in, more
// draws. Pillars (level-merged) + instanced decor can't be per-room toggled, so
// they stay always-visible; this culls shells + torches, which is the bulk.

interface RectNode {
  id: string;
  cx: number; cz: number; hw: number; hd: number;   // centre + half-extents
  /** The room's real floor, when it has one. Its rect is a BOUNDING BOX and a
   *  corridor's rect reaches inside it — see rectAt. */
  poly?: Poly;
  objects: THREE.Object3D[];                          // toggleable static content
  neighbors: Neighbour[];
}

/** One doorway, from this rect to `id`. `ox/oz` is the hole's midpoint; `hx/hz`
 *  is half its span along the wall line, so the tests can ask about a HOLE and
 *  not about a point. `guessed` marks a midpoint inferred from rect overlap
 *  rather than read off the frame that was actually built there. */
interface Neighbour {
  id: string;
  ox: number; oz: number;
  hx: number; hz: number;
  /** Unit vector pointing THROUGH the hole, from this rect into `id`. The
   *  sample points are pushed along it so they land in the far room's open
   *  floor instead of on the wall plane — see canSeeThrough. */
  nx: number; nz: number;
  guessed: boolean;
}

// Doorway-reveal margin (metres): a neighbour room renders when its connecting
// doorway is within this distance of the view frustum. Generous = less pop-in.
const MARGIN = 1.5;
const EPS = RECT_EPS;

// Distance cap on the flood-fill: a doorway beyond the sight distance leads
// ONLY to geometry that's already 100% fog-black (fog reaches full opacity
// there), so the room behind it can't be seen and shouldn't be drawn. The
// frustum used to be the only distance gate; on a long straight sightline
// through aligned doorways nothing broke LOS, so every room out to the far
// plane was submitted — including the fogged-invisible ones. Gating the doorway
// cross on the fog distance cuts those rooms at the source, independent of the
// frustum, and keeps the two clips in lockstep with the fog wall.
//
// ASKED, NOT CACHED. This was `const cullDist2 = CONFIG.FOG_FAR ** 2`, frozen
// at import — which is why the sight distance could not be changed at runtime
// without the culler disagreeing with the fog and clipping rooms inside visible
// air. scene/sight-distance.ts owns the number now.
const cullDist2 = (): number => sightFar() * sightFar();

// ── TRANSMITTANCE: HOW MUCH OF A SPACE ACTUALLY REACHES THE EYE ──────────────
//
// The flood already walks thresholds. This gives it a VALUE instead of a boolean: crossing
// a doorway multiplies by (1 - veilAlpha), so every space carries the fraction of light
// that reaches the camera along its best path. Two half-open veils in series is 25%, which
// is what the eye gets and therefore what the renderer should spend.
//
// WHY THIS AND NOT JUST THE DISTANCE CAP. `cullDist2` is the fog wall, and the comment on
// it says the two are kept "in lockstep" deliberately — which is precisely why the
// darkness could not be relaxed. Push fog out for legibility and the culler pushes out
// with it: measured over 733 viewpoints, fog at 20m submits 10.4 spaces against 9m's 5.0.
// The veil predicate instead submits 3.0, because it asks what the player can SEE rather
// than how far away it is.
//
// BOTH TESTS ARE KEPT. Transmittance is the tighter one while veils are on, and the
// distance cap is the backstop for when they are not — `veil · strength` at 0 restores
// exactly today's behaviour rather than flooding the whole floor.
//
// THE CUT IS EXACT, NOT TUNED. The post tail quantises to 32 levels with a 1/24 Bayer
// dither ahead of it, so half of one level — 1/64 — is below what the display can
// distinguish from black. A space dimmer than that cannot pop when it appears, because it
// was already indistinguishable from nothing.
const T_INVISIBLE = 1 / 64;
// HYSTERESIS. A space oscillating across the threshold as you strafe would flicker, so it
// is held to a looser bar once drawn — the same asymmetry the light pool uses with its
// area bonus. Enter late, leave later.
const T_KEEP = T_INVISIBLE * 0.4;

/** How far the gate walk bothers to count. Nothing asks about the far side of the floor,
 *  and a bound is what keeps a relaxation over a cyclic graph obviously terminating. */
const MAX_GATES = 4;
/**
 * A threshold counts as CLOSED while it is more shut than open.
 *
 * The first version of this used 0.004 — threshold-veil's "not worth drawing" cutoff — on
 * the reasoning that below it the veil has visibly lifted. True, but far too late to be the
 * rule: a veil only eases that low within `veil · clear by` (1.6m), so a room's light joined
 * you only once you were standing IN its doorway, and everything else on the floor sat at
 * gate 1 or worse. Josh: *"lights are broken, now they don't render."*
 *
 * Half is the honest reading of "shut". With the shipped easing (clear by 1.6m, full by 5m,
 * strength 0.9) a doorway crosses it about 3.4m out — you see the next space light up as you
 * commit to it, rather than at arm's length.
 */
const VEIL_SHUT_ALPHA = 0.5;
/**
 * How near you must be for a BARE portal — one with no veil to ease — to count as given.
 *
 * Matched to where a veil crosses VEIL_SHUT_ALPHA under the shipped easing (clear by 1.6m,
 * full by 5m), so a corner and a doorway hand you the next space at about the same distance
 * and there is one rule to learn rather than two.
 */
const BARE_PORTAL_OPEN_M = 3.5;
const BARE_PORTAL_OPEN_M2 = BARE_PORTAL_OPEN_M * BARE_PORTAL_OPEN_M;
/** Half a head, roughly — how far off the view axis an eye can be while peeking. */
const EYE_APERTURE_M = 0.28;

export interface RoomCuller {
  /** Recompute visibility for this frame. */
  tick(camera: THREE.Camera): void;
  /** Turn culling off → restore everything visible (does not free the culler). */
  setEnabled(on: boolean): void;
  /** Restore all visibility (called on level teardown / disable). */
  dispose(): void;
  /** Count of currently-visible rects (debug readout). */
  visibleCount(): number;
  /** DEV: the full crossing decision from where the camera stands — every
   *  doorway out of the current rect, with the three gates evaluated. */
  explain(camera: THREE.Camera): unknown;
  /** Force a set of rooms to always render this frame onward — used by ARENAS
   *  while their encounter is active so a portcullis (which blocks LOS for
   *  walkable but is visually see-through bars) doesn't make the arena pop
   *  out from inside the alcove. Cleared by clearForceVisible(). */
  addForceVisible(roomIds: readonly string[]): void;
  /** Drop a previously-forced set. */
  removeForceVisible(roomIds: readonly string[]): void;
  /** DEV: what the camera can ACTUALLY see vs what we drew. See auditCull. */
  audit(camera: THREE.Camera, opts?: { cols?: number; rows?: number }): CullAudit;
}

/** The result of one cull audit from one camera pose. `holes` is the finding:
 *  a rect whose geometry is the nearest surface along a ray through the view,
 *  which the culler nevertheless hid — i.e. a black gap the player can see. */
export interface CullAudit {
  /** Rect ids the rays actually hit (nearest surface, culling suspended). */
  seen: string[];
  /** Rect ids the culler decided to draw this frame. */
  drawn: string[];
  /** seen \ drawn — the visible holes. Empty is the only good answer.
   *  `why` names the gate that refused the crossing from an adjacent rect that
   *  WAS drawn, so a finding points at a line of code rather than a symptom. */
  holes: Array<{ id: string; rays: number; nearest: number; why: string }>;
  /** Total rays cast, and how many hit anything (for a sanity read). */
  rays: number;
  hits: number;
}

// ── THE CULLER COMPUTES; THE INDEX ANSWERS ───────────────────────────────────
//
// This file used to publish three module-level maps — the node map, the gate counts, the
// drawn set — that three other systems read directly and cached privately. That is where the
// title-screen 'tv' bug, the per-floor id-reuse bug and the two-live-cullers race all came
// from, and I patched each of them separately before Josh stopped me: *"instead of
// patchworking this, can't we make a proper system for culling?"*
//
// So the split is now explicit. The culler decides WHAT IS VISIBLE — frustum, sightlines,
// transmittance across the portal graph, gate counts — because that is the thing it is good
// at and none of it moved. `level/space-index.ts` owns WHO MAY ANSWER and WHO IS ASKING: one
// cache, one invalidation, one rule about worlds. Nothing outside this file reads a node map
// or a space id any more; see the header there.

// ── WHAT THE ACTIVE CULLER DECIDED, FOR THE MAP TO DRAW ─────────────────────
//
// DEV ONLY, AND NOT A VISIBILITY ANSWER. This is the drawn set — the thing that was just
// taken away from every consumer because it depends on where the camera points. It is
// published again here for exactly one reader, `debug/cull-map.ts`, whose entire job is to
// SHOW you that dependence. If anything else ever imports this, the bug it causes will be
// the one this session spent six hours on.
export interface CullSnapshotSpace {
  id: string;
  cx: number; cz: number; hw: number; hd: number;
  poly?: Poly;
  drawn: boolean;
  /** Thresholds from the player. Infinity when the walk never reached it. */
  gates: number;
  /** Fraction of light getting here across the portal graph, 0..1. The DRAW rule's number,
   *  frustum included — shown on the map, used for nothing else. */
  trans: number;
  /** True while the player's own position is inside this rect. */
  standing: boolean;
  /** The portal graph out of this space — the thing the flood and the gate walk both run
   *  on. Drawing it is the difference between seeing WHAT was culled and seeing WHY: a
   *  missing edge and a sealed one look identical from inside the game. */
  openings: Array<{ to: string; x: number; z: number }>;
}
let cullSnapshot: CullSnapshotSpace[] | null = null;
export function debugCullSnapshot(): CullSnapshotSpace[] | null {
  return DEV ? cullSnapshot : null;
}

export function createRoomCuller(level: LiveLevel): RoomCuller {
  // Two cullers can be alive at once — the title vignette does not go away the instant a
  // run starts — so a culler holds the world it was built for and the index ignores anything
  // an older one says. It still culls its OWN geometry; it just stops speaking for the floor.
  const myWorld = claimWorld();
  const nodes = new Map<string, RectNode>();
  // Occlusion comes from the walkable grid's line-of-sight (the same check the
  // light pool uses): a doorway with a wall between it and the camera fails LOS
  // and its room is culled. This is what frustum-alone can't see.
  const los = (ax: number, az: number, bx: number, bz: number) =>
    level.walkable.hasLineOfSight(ax, az, bx, bz);

  // 1) Rect nodes from rooms + corridors. SKIP logicalOnly sub-rooms — they
  //    have no baked walls/floor/ceiling and exist only as bounding rects for
  //    enemy attribution. If we kept them, rectAt() (which prefers the smallest
  //    containing rect) would return the LOGICAL sub-room as the player's start
  //    node — but that node has no geometry, and the parent vault rect that DOES
  //    own the geometry is not its rect-edge neighbour (parent contains sub-
  //    room rather than sharing an edge), so the parent culls out. Symptom:
  //    floor + walls disappear when you look at certain angles while standing
  //    in an arena's alcove/proper. Excluding logical rooms makes rectAt fall
  //    through to the parent automatically.
  const rects = [
    ...level.spec.rooms.filter((r) => !r.logicalOnly).map((r) => ({ id: r.id, rect: r.rect, poly: r.poly })),
    ...level.spec.corridors.map((c) => ({ id: c.id, rect: c.rect, poly: c.poly })),
  ];
  for (const { id, rect, poly } of rects) {
    nodes.set(id, {
      id, cx: rect.x, cz: rect.z, hw: rect.w / 2, hd: rect.d / 2,
      poly: poly && poly.length >= 3 ? poly : undefined,
      objects: [], neighbors: [],
    });
  }

  // Logical sub-room id → containing parent rect id. Encounters reference
  // sub-room ids (e.g. arena:<subRoomId>); the culler's force-visible set
  // operates on real rect ids, so we translate at the event boundary.
  const subroomToParent = new Map<string, string>();
  for (const sub of level.spec.rooms) {
    if (!sub.logicalOnly) continue;
    let bestParent: { id: string; area: number } | null = null;
    for (const candidate of level.spec.rooms) {
      if (candidate.logicalOnly) continue;
      const cw2 = candidate.rect.w / 2, cd2 = candidate.rect.d / 2;
      const sw2 = sub.rect.w / 2, sd2 = sub.rect.d / 2;
      const containsX = candidate.rect.x - cw2 <= sub.rect.x - sw2 + 1e-3
                     && candidate.rect.x + cw2 >= sub.rect.x + sw2 - 1e-3;
      const containsZ = candidate.rect.z - cd2 <= sub.rect.z - sd2 + 1e-3
                     && candidate.rect.z + cd2 >= sub.rect.z + sd2 - 1e-3;
      if (!containsX || !containsZ) continue;
      const area = candidate.rect.w * candidate.rect.d;
      if (!bestParent || area < bestParent.area) bestParent = { id: candidate.id, area };
    }
    if (bestParent) subroomToParent.set(sub.id, bestParent.id);
  }

  // 2) Adjacency: two rects are connected if a wall edge coincides and overlaps
  //    along the run axis — the doorway. Opening midpoint = centre of the
  //    overlap on the shared edge. O(n²), n small.
  /** rect id → rects whose floor it shares (see the note in the loop below). */
  const spill = new Map<string, string[]>();
  const arr = [...nodes.values()];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      // ── GEOMETRY THAT STANDS IN SOMEONE ELSE'S ROOM ──────────────────────
      //
      // The flood asks "can I see THROUGH the doorway into that rect." For most
      // pairs that is the whole story. It is not the whole story when one rect's
      // geometry is INSIDE the other's floor — and on a polygon floor that is by
      // construction: a corridor's rect reaches into the room it meets, because
      // that is the only way to touch a wall that sits back from its bounding
      // box (see rectAt). Its plate and wall stubs therefore stand in the room
      // WITH you, on your side of the doorway.
      //
      // Measured: at seed 4 depth 7 the rays hit cor-4-2 at 3.08m while its own
      // doorway was 3.65m away — the visible stone was NEARER than the hole it
      // was supposed to be seen through. A sightline test cannot reach that, at
      // any margin, because the question it asks is the wrong question.
      //
      // So: rects that share floor area are drawn together. Not transitive (only
      // partners of flood-visible rects), so it cannot cascade across a floor.
      if (rectsOverlap(a, b)) {
        (spill.get(a.id) ?? spill.set(a.id, []).get(a.id)!).push(b.id);
        (spill.get(b.id) ?? spill.set(b.id, []).get(b.id)!).push(a.id);
      }
      const opening = sharedOpening(a, b);
      if (opening) {
        // No frame to read a direction off, so aim at the other rect's centre.
        const toB = unit(b.cx - opening.x, b.cz - opening.z);
        const toA = unit(a.cx - opening.x, a.cz - opening.z);
        a.neighbors.push({ id: b.id, ox: opening.x, oz: opening.z, hx: 0, hz: 0, ...toB, guessed: true });
        b.neighbors.push({ id: a.id, ox: opening.x, oz: opening.z, hx: 0, hz: 0, ...toA, guessed: true });
      }
    }
  }

  // A framed opening is not IN a room, it is BETWEEN two — see the note at the
  // assignment below. Held apart from `node.objects` because its visibility is
  // an OR of two rooms, and the per-node loop can only write one answer.
  // ── THINGS PLACED BY POSITION BELONG TO EVERY SPACE THEY TOUCH ────────────
  //
  // Josh: *"lights vanishing in rooms I am actively standing in based on how I move,
  // without looking away, so they couldn't be frustum culled — there are inconsistencies."*
  //
  // Anything attributed by a POINT was attributed by `rectAt`, which must answer with one
  // id, and does it by smallest-box-wins. On a polygon floor that is a coin toss at every
  // boundary: a corridor rect deliberately reaches INSIDE the room it serves, so a prop or
  // a sconce standing in the overlap belongs, by the tie-break, to whichever rect happens
  // to be smaller. Cull that rect and the object goes dark while the player stands in the
  // room it is physically in.
  //
  // Worse, three systems each ran their OWN version of that lookup with their own tie-break
  // — the culler by smallest box, the light pool and the signal layer by the index's
  // generous overlap — so one torch's stone, its light and its flame could disagree about
  // which room they were in. That is the flicker.
  //
  // One rule now: a thing placed by position belongs to EVERY space whose footprint it
  // touches, and it is drawn while ANY of them is. Shells keep their exact single owner —
  // a wall is stamped with its rect id at build time and there is nothing to guess.
  const placed: Array<{
    o: THREE.Object3D;
    spaces: string[];
    /** Gate depth past which this thing stops being drawn — see PROP_CLASS_POLICY. */
    gateLimit: number;
    /** Last gate depth applied, so the shadow flags are only walked when it CHANGES.
     *  Traversing every prop every frame to set a boolean that rarely moves is the kind of
     *  cost this whole tier system exists to avoid. */
    lastGate: number;
    /** Meshes that were AUTHORED to cast, captured once. Gating shadows means turning these
     *  off and back on — never turning on something the class policy said should not cast,
     *  which is why the authored value is remembered rather than assumed. */
    casters: THREE.Mesh[];
  }> = [];

  /**
   * What KIND of gate joins these two spaces.
   *
   * Today: a veil where one hangs, bare everywhere else. Doors and wards slot in here as
   * they learn to register, and nothing else in the walk changes when they do — which is
   * the point of the kind being data (level/gate-kinds.ts).
   */
  function gateKindBetween(a: string, b: string): GateKindId {
    return veilAlphaBetween(a, b) > 0 ? 'veil' : 'bare';
  }

  /**
   * Is it shut right now?
   *
   * A PROXIMITY gate gives as the player commits to it. A veil says so with its own alpha;
   * a bare one has no alpha to read, so it uses distance directly, on a radius matched to
   * where a veil crosses shut — so a corner and a doorway hand you the next space at about
   * the same distance and there is one rule to learn rather than two.
   *
   * A STATE gate is somebody else's answer and is shut until they say otherwise; until doors
   * register, nothing produces one.
   */
  function gateIsShut(kind: GateKindId, a: string, nb: Neighbour, cx: number, cz: number): boolean {
    const seal = GATE_KINDS[kind].seal;
    if (seal === 'never') return false;
    if (seal === 'proximity') {
      if (kind === 'veil') return veilAlphaBetween(a, nb.id) > VEIL_SHUT_ALPHA;
      const dx = nb.ox - cx, dz = nb.oz - cz;
      return dx * dx + dz * dz > BARE_PORTAL_OPEN_M2;
    }
    return true;
  }

  /** Every mesh under this object that the model author allowed to cast, captured once at
   *  build. The gate tier turns casting off and on, and it must restore exactly what was
   *  AUTHORED rather than promote something the class policy deliberately excluded. */
  function castersOf(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.castShadow) out.push(m); });
    return out;
  }

  /** The margin is the masonry band plus slack, so a sconce set into the stone still finds
   *  the room it faces. Same number and same reason as the space index's own lookup. */
  const MOUNT_MARGIN = 0.6;
  function spacesTouching(x: number, z: number): string[] {
    const out: string[] = [];
    for (const n of nodes.values()) {
      if (x < n.cx - n.hw - MOUNT_MARGIN || x > n.cx + n.hw + MOUNT_MARGIN
        || z < n.cz - n.hd - MOUNT_MARGIN || z > n.cz + n.hd + MOUNT_MARGIN) continue;
      out.push(n.id);
    }
    return out;
  }

  const boundary: Array<{ o: THREE.Object3D; a: string | null; b: string | null }> = [];
  /** Every framed opening that joins two tracked rects — the floor's REAL
   *  doorway list, harvested from what was actually built. */
  const frameDoorways: Array<{
    a: string; b: string; x: number; z: number; rotY: number; o: THREE.Object3D;
  }> = [];
  /** How far through a gate to step when asking which rooms it joins. Past the
   *  wall (0.25m) and past the frame's own reveal, into open floor on each side. */
  const FRAME_PROBE = 1.0;

  // 3) Assign toggleable static objects to rects.
  //    Shells (floor/ceiling/walls) carry userData.dbgSource = "<kind> · <id> …".
  for (const child of level.root.children) {
    const src = child.userData?.dbgSource;
    if (typeof src === 'string') {
      const id = parseRectId(src);
      const node = id ? nodes.get(id) : undefined;
      if (node) {
        node.objects.push(child);
        continue;
      }
    }
    // Decoration PROPS tagged with userData.dbgKind = 'prop' (clutter, chests,
    // braziers, ritual altars, everything authored through the prop pipeline)
    // don't carry a per-rect dbgSource — they're assigned by world position
    // to the smallest non-logical containing rect. Without this they stayed
    // visible inside a culled room (the player would see floor decoration
    // through a wall the culler had hidden).
    if (child.userData?.dbgKind === 'prop') {
      placed.push({
        o: child,
        spaces: spacesTouching(child.position.x, child.position.z),
        gateLimit: propClassGateLimit(child.userData?.propClass as PropClass | undefined),
        lastGate: -1,
        casters: castersOf(child),
      });
      continue;
    }
    // ── A FRAMED OPENING BELONGS TO BOTH SIDES ────────────────────────────
    //
    // Josh, on a screenshot: *"when viewing from an angle like the screenshots
    // it's there and then it gets culled, part of the doorframe."*
    //
    // An archway stands IN the wall between two spaces, so `rectAt` at its
    // centre resolves it to exactly ONE of them — and the moment that one is
    // culled the stone vanishes while you are looking straight at it from the
    // other side. Doors already carry an exemption for the same reason (see the
    // interactable loop below: "boundary objects that animate in place").
    //
    // So resolve both rooms once, at build time, by stepping through the gate
    // and back. The frame renders while EITHER is rendered, which is stricter
    // than the door exemption — a doorway three rooms away still culls.
    // THE ARCHWAY EYE IS PART OF THE DOORWAY, and has to be told so.
    //
    // It is mounted at the level root rather than inside the frame group (an
    // opaque mesh inside a frame gets swept into the static batch, which once
    // left every eye permanently shut — see archway-eye.ts). The cost of that
    // is this loop had no rule matching a bare Group, so the eyes fell straight
    // through and were never toggled: all fourteen on a floor drawn every
    // frame, in every room, whether or not the room they serve was culled.
    //
    // Its own transform is no use for the both-sides probe — it carries the
    // keystone slot's orientation plus a downward REST_PITCH, so stepping along
    // its local +Z walks out of the plane of the arch. installFrameFittings
    // stamps the FRAME's placement instead, and we resolve from that, so eye
    // and stone can never disagree about which two rooms they join.
    const bound = child.userData?.boundaryOf as { x: number; z: number; rotY: number } | undefined;
    if (bound) {
      const s = Math.sin(bound.rotY), c = Math.cos(bound.rotY);
      boundary.push({
        o: child,
        a: rectAt(nodes, bound.x + s * FRAME_PROBE, bound.z + c * FRAME_PROBE)?.id ?? null,
        b: rectAt(nodes, bound.x - s * FRAME_PROBE, bound.z - c * FRAME_PROBE)?.id ?? null,
      });
      continue;
    }
    if (child.userData?.dbgKind === 'frame') {
      // The frame's local +Z runs through the gate; rotY is how it was placed.
      const s = Math.sin(child.rotation.y), c = Math.cos(child.rotation.y);
      const px = child.position.x, pz = child.position.z;
      const entry = {
        o: child,
        a: rectAt(nodes, px + s * FRAME_PROBE, pz + c * FRAME_PROBE)?.id ?? null,
        b: rectAt(nodes, px - s * FRAME_PROBE, pz - c * FRAME_PROBE)?.id ?? null,
      };
      boundary.push(entry);
      // …AND it is the doorway itself. See publishFrameDoorways below.
      if (entry.a && entry.b && entry.a !== entry.b) {
        frameDoorways.push({ a: entry.a, b: entry.b, x: px, z: pz, rotY: child.rotation.y, o: child });
      }
    }
  }

  // ── THE DOORWAY IS NOT A GUESS ───────────────────────────────────────────
  //
  // portals.ts opens with the lesson: a doorway is a hole in a wall, and for a
  // long time TWO systems each decided where that hole was from two different
  // inputs, and they disagreed. This module was the THIRD, and nobody noticed
  // because it never draws a wall — it only decides what to draw, so being
  // wrong reads as "the renderer is popping" rather than as "the geometry
  // disagrees."
  //
  // `sharedOpening` infers an opening from where two BOUNDING BOXES meet. On a
  // rect floor that is the doorway. On a polygon floor it is not: the real wall
  // sits back from the box, corridors reach INSIDE it, and the centre of the
  // overlap can land metres away from the hole and INSIDE SOLID STONE. Then the
  // line-of-sight test — asked "can you see that point" about a point in a wall
  // — correctly answers no, and the corridor you are standing in front of is
  // not drawn until you walk into it and rectAt puts you there. Measured before
  // this: 8.9% of standing poses on real floors showed a hole, worst case 60 of
  // 74 rays (four fifths of the screen) landing on a corridor 1.2m away that
  // was hidden, and line-of-sight was the refusing gate in 28 of the 40 worst.
  //
  // The frames are the answer, and this file already had them in hand. Every
  // framed opening was BUILT at the hole planPortals computed, and the loop
  // above already resolves the two rooms it joins in order to keep the stone
  // visible from both sides. So publish that as the graph: a doorway named by
  // the thing standing in it beats a doorway inferred from two rectangles.
  //
  // The inferred edges stay as the fallback — hand-authored rect floors and
  // fitting openings have no frame — and a published doorway overwrites the
  // guess for that pair rather than adding a second edge beside it.
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  /** Widest a doorway is allowed to claim, so a freak bounding box can't turn
   *  one opening into a licence to render half the floor. */
  const MAX_HALF_SPAN = 3;
  /** Half a doorway when the frame can't be measured. By the time the culler is
   *  built, a frame's meshes may already have been absorbed into the static
   *  world batch, and `setFromObject` on the emptied group returns a degenerate
   *  box — which silently made every opening a POINT again (measured: `half: 0`
   *  on a published doorway). A stated default is honest; a zero is a lie. */
  const DEFAULT_HALF_SPAN = 0.9;
  function publishFrameDoorways(): void {
    for (const d of frameDoorways) {
      const a = nodes.get(d.a), b = nodes.get(d.b);
      if (!a || !b) continue;
      // Half the opening's span, along the wall line (the frame's local X).
      box.makeEmpty();
      box.setFromObject(d.o);
      box.getSize(size);
      const measured = Math.max(size.x, size.z) / 2;
      const half = Math.min(MAX_HALF_SPAN, measured > 0.2 ? measured : DEFAULT_HALF_SPAN);
      const wx = Math.cos(d.rotY) * half, wz = -Math.sin(d.rotY) * half;
      // Through-gate axis. `a` was probed at +(sin, cos), so a→b runs the other
      // way; b→a runs along it.
      const s = Math.sin(d.rotY), c = Math.cos(d.rotY);
      link(a, b, d.x, d.z, wx, wz, -s, -c);
      link(b, a, d.x, d.z, wx, wz, s, c);
    }
  }
  function link(
    from: RectNode, to: RectNode,
    x: number, z: number, hx: number, hz: number, nx: number, nz: number,
  ): void {
    const existing = from.neighbors.find((n) => n.id === to.id);
    if (existing && !existing.guessed) return;   // two frames on one pair: keep the first
    const edge: Neighbour = { id: to.id, ox: x, oz: z, hx, hz, nx, nz, guessed: false };
    if (existing) Object.assign(existing, edge);
    else from.neighbors.push(edge);
  }
  publishFrameDoorways();
  //    Torches by position (their group is a direct root child not tagged above).
  for (const torch of level.torches) {
    const node = rectAt(nodes, torch.group.position.x, torch.group.position.z);
    // A torch is architecture that burns: its bracket is structural and its flame is a
    // signal, and both want to survive a threshold. Never tiered out.
    placed.push({
      o: torch.group,
      spaces: spacesTouching(torch.group.position.x, torch.group.position.z),
      gateLimit: Infinity,
      lastGate: -1,
      casters: castersOf(torch.group),
    });
  }

  let enabled = true;
  const eyeFwd = new THREE.Vector3();
  let eyeRightX = 1, eyeRightZ = 0;
  const visible = new Set<string>();
  /** Thresholds from the player, per space, for THIS culler. Per-instance now rather than
   *  module-level: two cullers computing into one map was half of what the index fixed. */
  const portalDepth = new Map<string, GateDepths>();
  /** Transmittance per space for THIS frame — see T_INVISIBLE. */
  const trans = new Map<string, number>();
  /** Spaces the player is standing in — the seeds for BOTH walks. */
  const depthSeeds: string[] = [];
  /** What was drawn LAST frame, for the hysteresis on that threshold. */
  const wasVisible = new Set<string>();
  // Rooms forced to render every frame regardless of frustum / LOS — counted
  // by reference, so two encounters can claim the same room without one
  // dropping the other's claim when it ends.
  const forceVisibleCounts = new Map<string, number>();

  // Frustum scratch (no per-frame alloc).
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), MARGIN);
  // Pitch-flatten scratch: the doorway cull frustum is built from a YAW-ONLY
  // view (camera forward projected onto the floor plane), so camera PITCH never
  // gates which doorways read as "in view." A doorway is a full-height opening
  // — looking down at a corner must not cull the corridor/rooms ahead. The real
  // projection (FOV/aspect) is kept; it's just re-centred on the horizon.
  const fwd = new THREE.Vector3();
  const flatTarget = new THREE.Vector3();
  const flatWorld = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);

  /**
   * Can the camera see THROUGH this doorway — is any part of the hole both in
   * the view cone and unoccluded?
   *
   * A doorway is not a point. Testing only its centre fails two ways that both
   * showed up in the audit: standing beside a wide opening puts its centre
   * outside the yaw frustum while most of the hole is plainly in view, and a
   * centre sample that happens to graze a jamb answers "occluded" for an
   * opening you are looking straight through. So sample the centre and both
   * shoulders, and pass if ANY of the three does — which is also the honest
   * reading of "part of it is visible."
   *
   * Shoulders are pulled in to 70% of the half-span so they sit inside the
   * clear gap rather than on the jamb itself.
   *
   * And every sample is pushed THROUGH the hole first. A doorway's midpoint sits
   * on the wall plane, and a 2D segment test asked about a point lying exactly
   * on the wall line answers "blocked" for an opening you are staring straight
   * down — the jambs on either side of the gap are collinear with the target, so
   * grazing one counts as a hit. Aiming a step INTO the far room asks the
   * question we actually mean ("can I see that space") and puts the endpoint in
   * open floor where the arithmetic is not ambiguous.
   */
  const THROUGH_STEP = 0;   // measured: stepping off the wall plane made it worse
  /**
   * Can this doorway be crossed from where the camera stands?
   *
   * The frustum is part of it, and that is why NOTHING outside this file may use the result:
   * what to draw depends on where you are looking, and every other consumer's question does
   * not. They ask the gate walk below instead.
   */
  /**
   * ── AN EYE IS NOT A POINT, AND A DOORWAY IS NOT ITS CENTRE ─────────────────
   *
   * Josh: *"line of sight is calculated from the middle of the camera even though I can
   * peek around corners — is there a good solution for this?"*
   *
   * There is, and it is the standard one for portal culling: visibility through an opening
   * is a question about two SPANS, not two points. A ray from the centre of your head to the
   * centre of the doorway is blocked by a corner long after you can plainly see past it,
   * because leaning or strafing moves your eye off that centre line — and the room pops in
   * only once the middle ray finally clears.
   *
   * So both ends are sampled. The doorway across nearly its whole clear span (0.92 rather
   * than 0.7, which was leaving an eighth of the opening unreachable at each edge), and the
   * EYE across a head's width to either side, perpendicular to the view. Any unobstructed
   * pair means visible.
   *
   * Ordered cheapest-first and early-outs on the first hit, so the common case — standing in
   * a room looking straight at a doorway — still costs one sightline. The 3x3 worst case is
   * only paid at a corner you are actually peeking around, which is exactly when you want it
   * paid.
   */
  function canSeeThrough(nb: Neighbour, cx: number, cz: number, eyeY: number): boolean {
    const sx = nb.hx * 0.92, sz = nb.hz * 0.92;
    const wide = sx !== 0 || sz !== 0;
    const gate: Array<readonly [number, number]> = wide
      ? [[nb.ox, nb.oz], [nb.ox + sx, nb.oz + sz], [nb.ox - sx, nb.oz - sz]]
      : [[nb.ox, nb.oz]];
    // Head width, perpendicular to the view direction in the floor plane.
    const ex = -eyeRightZ * EYE_APERTURE_M, ez = eyeRightX * EYE_APERTURE_M;
    const eyes: Array<readonly [number, number]> = [
      [cx, cz], [cx + ex, cz + ez], [cx - ex, cz - ez],
    ];
    for (const [px, pz] of gate) {
      sphere.center.set(px, eyeY, pz);
      if (!frustum.intersectsSphere(sphere)) continue;
      for (const [ex0, ez0] of eyes) if (los(ex0, ez0, px, pz)) return true;
    }
    return false;
  }

  /**
   * THE SINGLE WALK. Fills `visible` + `trans` (what can be SEEN) and `portalDepth` (how far
   * each channel CARRIES) in one pass over the portal graph.
   *
   * Josh: *"I want one system governing all aspects of this, and then we can decide when we
   * cull and draw rooms — but it will be based on the gates and LOS and other things, as
   * everything else."*
   *
   * Two questions were being asked about every edge here, by two walks running one after the
   * other over the same nodes:
   *
   *   CAN IT BE SEEN — is the opening in the view cone, is the sightline clear, is it inside
   *   the fog. CHAINED, because seeing a third room means seeing through the two openings in
   *   front of it, which is why it cannot simply be a per-space test.
   *
   *   HOW FAR DOES IT CARRY — how many shut gates, per channel. Frustum-free, because a
   *   torch behind you still lights the wall in front of you.
   *
   * They are two properties of the same crossing, so they travel together. `sight` advances
   * only through openings that are genuinely visible; the gate depths advance through every
   * edge. A consumer then says which it needs — stone needs both, a light needs only the
   * second — and rooms stop being a separate mechanism and become the policy that happens to
   * ask for everything.
   */
  function floodOne(seeds: string[], cx: number, cz: number, eyeY: number): void {
    const queue: string[] = [];
    for (const id of seeds) {
      if (!nodes.has(id)) continue;
      visible.add(id);
      trans.set(id, 1);
      portalDepth.set(id, AT_PLAYER);
      queue.push(id);
    }
    while (queue.length) {
      const id = queue.pop()!;
      const node = nodes.get(id);
      if (!node) continue;
      const tHere = trans.get(id) ?? 0;
      const dHere = portalDepth.get(id) ?? AT_PLAYER;
      // A node the gate walk reached but sight did not has no transmittance to carry
      // onward, and sight stops there — which is what "you cannot see into it" means.
      const seenHere = visible.has(id);

      for (const nb of node.neighbors) {
        const kind = gateKindBetween(id, nb.id);
        const shut = gateIsShut(kind, id, nb, cx, cz);

        // ── HOW FAR IT CARRIES ─────────────────────────────────────────────
        const next = acrossGate(dHere, kind, shut);
        const prevD = portalDepth.get(nb.id);
        let queued = false;
        if (improves(next, prevD)) {
          portalDepth.set(nb.id, prevD ? bestOf(next, prevD) : next);
          if (!exhausted(next, MAX_GATES)) { queue.push(nb.id); queued = true; }
        }

        // ── AND WHETHER IT CAN BE SEEN ─────────────────────────────────────
        if (!seenHere || visible.has(nb.id)) continue;
        // Past the fog wall? The opening, and everything through it, is fully fog-black —
        // a cheap reject before the frustum and sightline tests.
        const ddx = nb.ox - cx, ddz = nb.oz - cz;
        if (ddx * ddx + ddz * ddz > cullDist2()) continue;
        // Past the VEIL? See T_INVISIBLE. A closed threshold means what is behind it is
        // below one output level, which is a stronger statement than "far away" and does
        // not move when the fog does.
        const t = tHere * (1 - veilAlphaBetween(id, nb.id));
        if (t <= (wasVisible.has(nb.id) ? T_KEEP : T_INVISIBLE)) continue;
        // Sampled at the CAMERA'S eye height, so a sunken or raised room is tested at the
        // height you are actually at.
        if (!canSeeThrough(nb, cx, cz, eyeY)) continue;
        visible.add(nb.id);
        trans.set(nb.id, t);
        if (!queued) queue.push(nb.id);
      }
    }
  }


  function showAll() {
    for (const node of nodes.values()) {
      for (const o of node.objects) o.visible = true;
      setStaticBatchRectVisible(node.id, true);
    }
    for (const p of placed) p.o.visible = true;
    for (const f of boundary) f.o.visible = true;
    showAllStaticBatches();   // instances in rects the culler doesn't track
    for (const e of level.enemies) e.group.visible = true;
    for (const it of getAllInteractables()) {
      const g = it.built?.group as THREE.Object3D | undefined;
      if (g && g.userData?.dbgKind !== 'prop') g.visible = true;
    }
  }

  function tick(camera: THREE.Camera) {
    if (!enabled) {
      // A culler that is not running must not keep ANSWERING. Its node map and gate counts
      // describe a floor nobody is standing on, and stale answers here hide things rather
      // than show them.
      // A culler that is not running must not keep ANSWERING: its gate counts describe a
      // floor nobody is standing on, and a stale answer here hides things rather than
      // showing them.
      retireWorld(myWorld);
      return;
    }

    camera.updateMatrixWorld();
    // YAW-ONLY cull frustum: camera forward flattened to the floor plane, so
    // PITCH never gates doorway visibility (angling down at a corner must not
    // cull the corridor/rooms ahead — a doorway is a full-height opening). Real
    // projection (FOV/aspect) is kept, just re-centred on the horizon.
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); else fwd.normalize();
    flatTarget.copy(camera.position).add(fwd);
    flatWorld.lookAt(camera.position, flatTarget, UP);   // rotation looking flat-forward
    flatWorld.setPosition(camera.position);              // → camera world matrix (pitch zeroed)
    projView.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      flatWorld.invert(),                                // → view matrix
    );
    frustum.setFromProjectionMatrix(projView);

    const cx = camera.position.x;
    const cz = camera.position.z;
    // View direction flattened to the floor, and the right vector from it — the axis a head
    // leans along. Recomputed once per tick rather than per doorway.
    camera.getWorldDirection(eyeFwd);
    const fl = Math.hypot(eyeFwd.x, eyeFwd.z) || 1;
    eyeRightX = -eyeFwd.z / fl;
    eyeRightZ = eyeFwd.x / fl;
    const start = rectAt(nodes, cx, cz) ?? nearestRect(nodes, cx, cz);

    const publishes = worldIsCurrent(myWorld);
    // Last frame's set, for the transmittance hysteresis. Copied rather than swapped —
    // it holds about five ids, and a swap here would be cleverness bought with confusion.
    wasVisible.clear();
    for (const id of visible) wasVisible.add(id);
    visible.clear();
    trans.clear();
    portalDepth.clear();
    depthSeeds.length = 0;
    // Force-visible rooms (active arenas etc.) always render — PLUS every
    // direct neighbour, so the alcove on the other side of an arena gate is
    // also rendered while the arena is active even though the gate's wall
    // segment blocks LOS. (The portcullis is visually bars; you should see
    // through it. Walking through it is what's sealed.)
    for (const id of forceVisibleCounts.keys()) {
      const node = nodes.get(id);
      if (!node) continue;
      visible.add(id);
      for (const nb of node.neighbors) visible.add(nb.id);
    }
    if (start) {
      // Flood-fill: from the current rect, cross any doorway that's in view;
      // from each newly-visible rect, cross ITS in-view doorways (handles
      // looking through two doorways). The current rect is always visible.
      visible.add(start.id);
      const queue = [start.id];
      // The rect you are standing in seeds the GATE WALK too, and it has to be pushed here
      // rather than in the loop below, which skips anything already visible — and the line
      // above just made this one visible. So when the camera stood in exactly one rect,
      // which is most of the time, `depthSeeds` came out EMPTY and the walk never ran. An
      // empty gate map reads as "nothing to say", which fails open to gate 0, so every gate
      // rule in the game silently did nothing and looked like it was working.
      depthSeeds.push(start.id);
      // EVERY rect the camera stands in, not just the best one. rectAt has to
      // answer "which room am I in" with a single id — the flood has to start
      // from it, the nav graph needs one answer. But a corridor's rect reaches
      // INTO the room it meets (the only way to touch a wall that sits back from
      // its bounding box), and standing on that overlap you are honestly in
      // both. Seeding only the winner is why a corridor you are standing at the
      // mouth of could go dark until one more step forward flipped rectAt over
      // to it — Josh, twice: *"it's very tight"*.
      for (const node of nodes.values()) {
        if (Math.abs(node.cx - cx) > node.hw + EPS || Math.abs(node.cz - cz) > node.hd + EPS) continue;
        // Seeded whether or not it is newly visible — standing on the overlap of a room and
        // the corridor reaching into it, you are honestly in both, and both are gate 0.
        if (node.id !== start.id) depthSeeds.push(node.id);
        if (queue.includes(node.id)) continue;
        queue.push(node.id);
      }
      floodOne(queue, cx, cz, camera.position.y);
    } else {
      // Player not resolvable to any rect — fail safe (render everything).
      showAll();
      return;
    }

    // ── AND STONE ANSWERS TO GATES, LIKE EVERYTHING ELSE ─────────────────────
    //
    // DEPTH IS NOT VISIBILITY — a space behind you is still one gate away, it is simply not
    // being drawn — and conflating them was a real bug: depth used to be counted inside the
    // sight pass, so stepping into a room dropped the corridor behind you to Infinity and
    // every sconce that resolved to it went dark on the threshold. Josh found that one in a
    // sentence: *"it happens exactly when I step into the room … probably because of the
    // gate check."*
    //
    // They stay distinct, and floodOne now carries both. What is left here is the JOIN: a
    // space is drawn when sight reached it AND its geometry depth is inside the horizon.
    // Before that line existed, stone read only the sight pass and everything else read only
    // the depths, so a room could be culled by one and lit by the other — and a gate kind
    // that blocks geometry, which is what a closed door is, would have changed nothing about
    // what draws.
    //
    // Force-visible rooms (an active arena) are exempt: that is an encounter overriding
    // visibility on purpose, not a question about sight.
    {
      const horizon = signalKnobs.geoGates();
      for (const id of [...visible]) {
        if (forceVisibleCounts.has(id)) continue;
        const d = portalDepth.get(id);
        if (!d || d.geometry > horizon) visible.delete(id);
      }
    }

    // Anything standing inside a drawn rect's floor is drawn with it.
    for (const id of [...visible]) {
      for (const other of spill.get(id) ?? []) visible.add(other);
    }

    // Hand the FRUSTUM-FREE half to the index. `visible` deliberately does not go with it:
    // it is the draw list and it depends on where the camera points, which is right for
    // stone and wrong for everything else — see the note on Located.gates.
    if (publishes) publishFrame(myWorld, [...nodes.values()], portalDepth);

    if (DEV && publishes) {
      const seeds = new Set(depthSeeds);
      cullSnapshot = [...nodes.values()].map((n) => ({
        id: n.id, cx: n.cx, cz: n.cz, hw: n.hw, hd: n.hd, poly: n.poly,
        drawn: visible.has(n.id),
        gates: portalDepth.get(n.id)?.geometry ?? Infinity,
        trans: trans.get(n.id) ?? 0,
        standing: seeds.has(n.id),
        openings: n.neighbors.map((nb) => ({ to: nb.id, x: nb.ox, z: nb.oz })),
      }));
    }

    for (const node of nodes.values()) {
      const vis = visible.has(node.id);
      for (const o of node.objects) {
        // ── A CULLED SPACE KEEPS ITS SIGNAL ─────────────────────────────────
        //
        // The whole point of culling by transmittance is that the space is below one
        // output level — so its STONE is genuinely invisible and worth dropping, while
        // its markers are what the player reads the room by (scene/signal-layer.ts). A
        // doorway you cannot see through should still show you the fires behind it.
        //
        // Flames survive by architecture rather than by this line: they live in one
        // global sprite batch with per-entry visibility, not under a per-rect group. This
        // covers the ones that ARE parented per rect. It only reaches the top level of
        // `node.objects` — a marked mesh nested under an unmarked group still goes dark
        // with its parent, which is worth knowing before relying on it for a new marker.
        const want = vis || isSignal(o);
        if (o.visible !== want) o.visible = want;
      }
      // Static-world BatchedMesh instances belonging to this rect toggle with
      // it (scene/static-batch.ts) — same occlusion granularity, one draw.
      setStaticBatchRectVisible(node.id, vis);
    }

    // ...and the position-attributed things, ONCE each, as an OR over every space they
    // touch. Per object rather than per node: a thing standing in the overlap of a drawn
    // room and a culled corridor belongs to both, and iterating nodes would let whichever
    // came last decide. An object that touches nothing the culler tracks always draws.
    for (const p of placed) {
      // Gate depth is the NEAREST of the spaces it touches — the generous reading, the same
      // one attribution uses. A thing standing in a doorway is as close as its closer side.
      // GEOMETRY is the channel a prop asks on — it is stone, not a signal.
      let gate = Infinity;
      for (const id of p.spaces) {
        const g = portalDepth.get(id);
        if (g !== undefined && g.geometry < gate) gate = g.geometry;
      }
      if (p.spaces.length === 0) gate = 0;   // untracked ground: show it

      const inDrawnSpace = p.spaces.length === 0 || p.spaces.some((id) => visible.has(id));
      const want = isSignal(p.o) || (inDrawnSpace && gate <= p.gateLimit);
      if (p.o.visible !== want) p.o.visible = want;

      // ── SHADOWS ONLY IN THE ROOM YOU ARE IN ────────────────────────────────
      //
      // The expensive half of a light is its casters: the lamp re-renders every one into six
      // cube faces every frame, and shadow encode was measured at ~44% of the CPU frame
      // during fights. A prop seen THROUGH a doorway does not need to cast — you are looking
      // at a room you have not committed to, and its shadows are the first thing the veil
      // eats anyway.
      //
      // Only walked when the depth actually changes, which is when a threshold gives.
      if (gate !== p.lastGate) {
        p.lastGate = gate;
        const cast = gate <= 0;
        for (const m of p.casters) m.castShadow = cast;
      }
    }

    // Framed openings — visible while EITHER of the rooms they join is. A frame
    // that resolved to neither (a fitting opening in geometry the culler does
    // not track) always renders, erring toward drawing rather than toward the
    // hole in the wall Josh photographed.
    for (const f of boundary) {
      const vis = (f.a === null && f.b === null)
        || (f.a !== null && visible.has(f.a))
        || (f.b !== null && visible.has(f.b));
      if (f.o.visible !== vis) f.o.visible = vis;
    }

    // Enemies are occlusion-culled DYNAMICALLY. Unlike shells (assigned once),
    // a mob walks between rooms, so we resolve its room from its live position
    // every frame and hide it when that room isn't rendered. This is the big
    // one: frustum culling alone can't occlusion-cull, so a wall between you and
    // a packed room still draws every enemy behind it — full geometry AND a
    // shadow-cube redraw each — for nothing (you see only the wall). The mob's
    // AI keeps ticking; only its rendering is culled. An enemy that doesn't
    // resolve to a rect (straddling a doorway) stays visible, erring to render.
    for (const e of level.enemies) {
      const node = rectAt(nodes, e.group.position.x, e.group.position.z);
      const vis = !node || visible.has(node.id);
      if (e.group.visible !== vis) e.group.visible = vis;
    }

    // Runtime-spawned interactables — loot PICKUPS dropped during play. These
    // never went through the builder, so they carry no per-rect tag and the
    // static assignment above can't see them; their mesh + ring + glow render
    // through walls like the enemies did. Cull them by live position too. Skip
    // anything tagged 'prop' (builder-placed chests/corpses already handled by
    // their static assignment) so we don't fight that path.
    for (const it of getAllInteractables()) {
      const g = it.built?.group as THREE.Object3D | undefined;
      // Skip props (handled by static per-rect assignment) AND doors (boundary
      // objects that animate in place — a single-rect cull at the doorway can
      // wrongly hide a sealing gate; they always render, ~1 draw each).
      if (!g || g.userData?.dbgKind === 'prop' || g.userData?.dbgKind === 'door') continue;
      const node = rectAt(nodes, it.position.x, it.position.z);
      const vis = !node || visible.has(node.id);
      if (g.visible !== vis) g.visible = vis;
    }
  }

  // ── THE AUDIT ────────────────────────────────────────────────────────────
  //
  // Three separate bug reports now (#152, #159, #160, and Josh's phone shots of
  // a corridor blinking out ahead of him) have been "the culler hid something I
  // was looking at." Every one was diagnosed by reading the code and guessing at
  // which of the three gates — fog distance, yaw frustum, line-of-sight — had
  // said no. That is the wrong instrument: the gates are a MODEL of visibility,
  // and asking the model whether the model is right cannot fail.
  //
  // So ask the SCENE instead. Suspend culling, fire a grid of rays through the
  // view, and record which rect owns the nearest surface each ray lands on. That
  // set is what the player can see, measured, with no theory in it. Anything in
  // it that the culler hid is a black hole in the frame — exactly what the
  // photographs show. The verdict is a count, not an opinion.
  //
  // DEV-only (it costs hundreds of raycasts and transiently unhides the world).
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function audit(camera: THREE.Camera, opts?: { cols?: number; rows?: number }): CullAudit {
    const cols = opts?.cols ?? 16, rows = opts?.rows ?? 9;
    if (!import.meta.env.DEV) return { seen: [], drawn: [], holes: [], rays: 0, hits: 0 };

    // Ground truth needs the whole world present; restored by the tick below.
    showAll();
    camera.updateMatrixWorld();
    raycaster.far = sightFar();

    const seenRays = new Map<string, { rays: number; nearest: number }>();
    let hits = 0;
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        // Cell CENTRES, so no ray rides the frustum edge where a half-pixel of
        // camera jitter would flip the answer.
        ndc.set((ix + 0.5) / cols * 2 - 1, 1 - (iy + 0.5) / rows * 2);
        raycaster.setFromCamera(ndc, camera as THREE.PerspectiveCamera);
        const hit = raycaster.intersectObject(level.root, true)[0];
        if (!hit) continue;
        hits++;
        const id = ownerRectId(hit.object) ?? rectAt(nodes, hit.point.x, hit.point.z)?.id;
        if (!id) continue;
        const prev = seenRays.get(id);
        if (!prev) seenRays.set(id, { rays: 1, nearest: hit.distance });
        else { prev.rays++; prev.nearest = Math.min(prev.nearest, hit.distance); }
      }
    }

    tick(camera);   // recompute + reapply the real visibility we just trampled

    const holes: CullAudit['holes'] = [];
    for (const [id, s] of seenRays) {
      if (!visible.has(id)) holes.push({ id, rays: s.rays, nearest: s.nearest, why: whyHidden(id, camera) });
    }
    holes.sort((a, b) => b.rays - a.rays);
    return { seen: [...seenRays.keys()], drawn: [...visible], holes, rays: cols * rows, hits };
  }

  /**
   * Re-run the three gates for the crossing INTO a hidden rect from whichever
   * drawn rect neighbours it, and name the one that said no. If nothing drawn
   * neighbours it at all, the flood could never have reached it and the graph
   * itself is the answer — a different bug with a different fix, so it gets a
   * different word.
   */
  function whyHidden(id: string, camera: THREE.Camera): string {
    const node = nodes.get(id);
    if (!node) return 'untracked-rect';
    const cx = camera.position.x, cz = camera.position.z;
    let sawDrawnNeighbour = false;
    const reasons: string[] = [];
    for (const nb of node.neighbors) {
      if (!visible.has(nb.id)) continue;
      sawDrawnNeighbour = true;
      const ddx = nb.ox - cx, ddz = nb.oz - cz;
      if (ddx * ddx + ddz * ddz > cullDist2()) { reasons.push('fog-distance'); continue; }
      const tag = nb.guessed ? '(guessed-door)' : '';
      const px = nb.ox + nb.nx * THROUGH_STEP, pz = nb.oz + nb.nz * THROUGH_STEP;
      sphere.center.set(px, camera.position.y, pz);
      if (!frustum.intersectsSphere(sphere)) { reasons.push(`yaw-frustum${tag}`); continue; }
      if (!canSeeThrough(nb, cx, cz, camera.position.y)) { reasons.push(`line-of-sight${tag}`); continue; }
      reasons.push('none-should-be-visible');
    }
    if (!sawDrawnNeighbour) return 'no-drawn-neighbour';
    // The crossing that came CLOSEST to succeeding is the one worth naming.
    for (const r of ['none-should-be-visible', 'line-of-sight', 'line-of-sight(guessed-door)',
                     'yaw-frustum', 'yaw-frustum(guessed-door)', 'fog-distance']) {
      if (reasons.includes(r)) return r;
    }
    return reasons[0] ?? 'unknown';
  }

  /** Which rect's geometry is this — walking up to whoever carries the tag. */
  function ownerRectId(o: THREE.Object3D | null): string | null {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) {
      const src = n.userData?.dbgSource;
      if (typeof src === 'string') {
        const id = parseRectId(src);
        if (id && nodes.has(id)) return id;
      }
    }
    return null;
  }

  /** DEV: every doorway out of every DRAWN rect, with each gate's verdict. The
   *  readout that turns "the culler hid it" into "this edge, this test, no." */
  function explain(camera: THREE.Camera): unknown {
    tick(camera);
    const cx = camera.position.x, cz = camera.position.z;
    const start = rectAt(nodes, cx, cz) ?? nearestRect(nodes, cx, cz);
    const edges: unknown[] = [];
    for (const id of visible) {
      const node = nodes.get(id);
      if (!node) continue;
      for (const nb of node.neighbors) {
        sphere.center.set(nb.ox, camera.position.y, nb.oz);
        edges.push({
          from: id, to: nb.id, drawn: visible.has(nb.id), guessed: nb.guessed,
          at: [+nb.ox.toFixed(2), +nb.oz.toFixed(2)],
          half: +Math.hypot(nb.hx, nb.hz).toFixed(2),
          dist: +Math.hypot(nb.ox - cx, nb.oz - cz).toFixed(2),
          frustum: frustum.intersectsSphere(sphere),
          los: los(cx, cz, nb.ox, nb.oz),
          seeThrough: canSeeThrough(nb, cx, cz, camera.position.y),
        });
      }
    }
    return { start: start?.id, drawn: [...visible], edges };
  }

  const culler: RoomCuller = {
    tick,
    audit,
    explain,
    setEnabled(on: boolean) {
      if (on === enabled) return;
      enabled = on;
      if (!on) showAll();
    },
    dispose() {
      showAll();
      unsubEvents();
    },
    visibleCount() { return visible.size; },
    addForceVisible(roomIds: readonly string[]) {
      for (const id of roomIds) {
        forceVisibleCounts.set(id, (forceVisibleCounts.get(id) ?? 0) + 1);
      }
    },
    removeForceVisible(roomIds: readonly string[]) {
      for (const id of roomIds) {
        const n = (forceVisibleCounts.get(id) ?? 0) - 1;
        if (n <= 0) forceVisibleCounts.delete(id);
        else forceVisibleCounts.set(id, n);
      }
    },
  };

  // Auto-track arena encounters via the bus: 'arena:<roomId>' encounter
  // activates → force-visible that roomId; completes → drop. This means
  // ANY arena (combat, challenge, future variants) automatically keeps its
  // room visible through the gate's see-through bars while the encounter
  // runs, without the builder having to plumb a reference to the culler.
  const ARENA_PREFIX = 'arena:';
  function arenaRectId(eventId: string): string {
    const subId = eventId.slice(ARENA_PREFIX.length);
    return subroomToParent.get(subId) ?? subId;
  }
  const unsubEvents = onEvent((event) => {
    if (event.type === 'encounter:activated' && event.id.startsWith(ARENA_PREFIX)) {
      culler.addForceVisible([arenaRectId(event.id)]);
    } else if (event.type === 'encounter:complete' && event.id.startsWith(ARENA_PREFIX)) {
      culler.removeForceVisible([arenaRectId(event.id)]);
    }
  });

  return culler;
}

/**
 * The doorway between two rects, or null when they don't connect.
 *
 * TWO WAYS TO CONNECT, and for a long time this only knew the first:
 *
 *   ABUT   — a wall edge coincides and the rects overlap along the run axis.
 *            That is how the vault composer's grid connects everything.
 *   OVERLAP— one rect reaches INTO the other. A polygon room's real wall sits
 *            back from its bounding box, so a corridor that meets the wall ends
 *            inside the rect rather than on its edge.
 *
 * Knowing only the first, the culler saw a polygon room and its corridor as
 * UNCONNECTED. So standing in a doorway looking down a corridor showed nothing:
 * the corridor was not a portal neighbour, and it only appeared once you were
 * physically inside it and `rectAt` put you there. That is the same abutment
 * assumption `findOpenings` carried, found in a second place.
 *
 * Inert on vault floors by construction — measured across 240 of them, no rect
 * ever runs through another's interior, so the overlap branch cannot fire there.
 */
/** Do these two rects share real floor AREA (not merely touch at an edge)? */
function rectsOverlap(a: RectNode, b: RectNode): boolean {
  const ox = Math.min(a.cx + a.hw, b.cx + b.hw) - Math.max(a.cx - a.hw, b.cx - b.hw);
  const oz = Math.min(a.cz + a.hd, b.cz + b.hd) - Math.max(a.cz - a.hd, b.cz - b.hd);
  return ox > EPS && oz > EPS;
}

/** Unit vector, or a stated fallback when the two points coincide. */
function unit(dx: number, dz: number): { nx: number; nz: number } {
  const len = Math.hypot(dx, dz);
  return len < 1e-6 ? { nx: 0, nz: 0 } : { nx: dx / len, nz: dz / len };
}

function sharedOpening(a: RectNode, b: RectNode): { x: number; z: number } | null {
  // Vertical shared edge (a's E == b's W, or vice versa) → overlap in Z.
  const ax0 = a.cx - a.hw, ax1 = a.cx + a.hw, az0 = a.cz - a.hd, az1 = a.cz + a.hd;
  const bx0 = b.cx - b.hw, bx1 = b.cx + b.hw, bz0 = b.cz - b.hd, bz1 = b.cz + b.hd;

  // OVERLAP: they share real area. The doorway is the centre of the shared
  // region — which for a corridor poking into a room is the mouth itself.
  const ox0 = Math.max(ax0, bx0), ox1 = Math.min(ax1, bx1);
  const oz0 = Math.max(az0, bz0), oz1 = Math.min(az1, bz1);
  if (ox1 - ox0 > EPS && oz1 - oz0 > EPS) {
    return { x: (ox0 + ox1) / 2, z: (oz0 + oz1) / 2 };
  }

  // East of A meets West of B (or symmetric): shared x line.
  if (Math.abs(ax1 - bx0) < EPS || Math.abs(bx1 - ax0) < EPS) {
    const z0 = Math.max(az0, bz0), z1 = Math.min(az1, bz1);
    if (z1 - z0 > EPS) {
      const x = Math.abs(ax1 - bx0) < EPS ? ax1 : ax0;
      return { x, z: (z0 + z1) / 2 };
    }
  }
  // North/South: shared z line, overlap in X.
  if (Math.abs(az1 - bz0) < EPS || Math.abs(bz1 - az0) < EPS) {
    const x0 = Math.max(ax0, bx0), x1 = Math.min(ax1, bx1);
    if (x1 - x0 > EPS) {
      const z = Math.abs(az1 - bz0) < EPS ? az1 : az0;
      return { x: (x0 + x1) / 2, z };
    }
  }
  return null;
}

/**
 * WHICH RECT AM I IN — the room the cull flood starts from.
 *
 * Smallest containing AABB, so a corridor nested against a room boundary wins
 * over the room. EXCEPT that a node whose POLYGON actually contains the point
 * beats one that merely boxes it.
 *
 * Josh, on a phone: *"there is a small space where I barely stand on the
 * elongated floor and the room I should be in gets culled, then if I move
 * forward just a little bit it reappears"* — a flicker on the way through every
 * doorway. A corridor's rect reaches INTO the room by design (it is the only
 * way to meet a wall that sits back from its bounding box), and standing on
 * that overlap, deep inside the room's floor, the smallest-box rule answered
 * "you are in the corridor" and the flood started from the wrong side.
 *
 * The plates that made you notice it are trimmed now (corridor-trim.ts), but
 * the rect still overlaps and always will — so the rule has to be right rather
 * than merely unobserved. Same fix, same reason, as room-graph.ts's rectAt.
 */
function rectAt(nodes: Map<string, RectNode>, x: number, z: number): RectNode | null {
  return rectAtIn(nodes.values(), x, z);
}

function nearestRect(nodes: Map<string, RectNode>, x: number, z: number): RectNode | null {
  let best: RectNode | null = null;
  let bestD = Infinity;
  for (const n of nodes.values()) {
    const dx = n.cx - x, dz = n.cz - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Pull the rect id out of a dbgSource like "walls · r0" / "floor · r0 @(…)". */
function parseRectId(src: string): string | null {
  const dot = src.indexOf('·');
  if (dot < 0) return null;
  const rest = src.slice(dot + 1).trim();
  const sp = rest.search(/\s/);
  return (sp < 0 ? rest : rest.slice(0, sp)) || null;
}
