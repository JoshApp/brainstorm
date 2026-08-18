// ── WHERE IS THIS, AND CAN IT BE SEEN FROM WHERE I AM? ───────────────────────
//
// One question, and until this file there were four owners of it.
//
// The culler knew which spaces it was drawing and how many thresholds each was from the
// player, and published both as module-level maps. Then the light pool, the signal layer and
// the ember emitters each took a world position, ran their OWN point lookup against the
// culler's node map, cached the answer because the lookup is a scan, and read the maps
// directly. Three private caches over one shared global, each with its own invalidation
// story — which is to say, three different bugs:
//
//   · A light resolved while the title screen's vignette was up cached its room as 'tv'.
//     'tv' is never drawn again once a run starts, so the torch was dark for the rest of the
//     run no matter where the player stood. Josh: *"the lights are culled when I am in the
//     room."*
//   · Space ids are per floor and source ids repeat across floors ('torch-3' exists on every
//     level), so a cache that outlived its floor priced this floor's torches by the last
//     one's layout.
//   · Two cullers can be alive at once — the title vignette does not vanish the instant a
//     run starts — and both wrote the globals every tick, so the answer was whoever ticked
//     last.
//
// I fixed those three times in a row, each fix local to one consumer, before Josh stopped
// me: *"instead of patchworking this, can't we make a proper system for culling?"* He is
// right. Every one of those is the same fault — an answer outliving the world that gave it —
// and it cannot be fixed in the consumers because the consumers are not where the world is
// known.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────
//
// A WORLD IS PART OF AN ANSWER'S IDENTITY. Not a version to compare, not a timestamp to
// check — part of the identity, so an answer from a dead world cannot be mistaken for an
// answer about this one even when the space ids are spelled the same.
//
// So: one index, one cache, one invalidation. A caller hands over a key and a position and
// gets back what it actually wants to know — is this drawn, how many thresholds away is it —
// and never sees a node, a space id, or a world number. When the world changes, every
// binding re-resolves, once, here.
//
// ── WHY A LIGHT ASKS ABOUT SPACES, PLURAL ───────────────────────────────────
//
// A thing mounted on the architecture does not sit in one room. Rooms are polygons, corridor
// rects deliberately reach INSIDE the room they serve (the only way to touch a wall set back
// from the room's own bounding box), and a sconce stands where two of them overlap. Asking
// "which one" forces a tie-break, and the tie-break was smallest-box-wins, which hands a
// room's torch to the corridor behind it.
//
// A light does not belong to a room, it FALLS ON one. So a binding holds every space it
// touches and the answers take the most generous reading: drawn if ANY of them is drawn,
// priced by the NEAREST of them in thresholds. Both directions matter — a sconce between a
// room and its corridor must not go out because the corridor is hidden, and must not be
// priced two gates away because a point lookup happened to name the corridor.
//
// ── FAILING OPEN IS A RULE, NOT A FALLBACK ──────────────────────────────────
//
// Every "I don't know" here resolves to VISIBLE. No world, no frame published yet, a
// position off the floor plan, a binding from a retired world — all of it shows. A thing we
// have no argument for hiding is a thing we must not hide, and every bug in this system so
// far has been the opposite choice made silently.

import { type RectLike } from './rect-at';

/** What the index needs from a space. The culler's RectNode satisfies it. */
export interface SpaceNode extends RectLike {
  id: string;
}

/**
 * What a caller actually wants to know. No ids, no world number, no nodes — those are this
 * module's business, and every time they leaked out a consumer grew a cache and a bug.
 */
// ── CULLING IS COMPOSABLE: A CONSUMER DECLARES WHAT BINDS IT ─────────────────
//
// Josh: *"shouldn't we make it composable, so things can opt in to certain culling things?
// Make this proper."*
//
// Three consumers, three different questions, and they were three hardcoded rules scattered
// across three files: geometry took the flood, lights took the gate count, signals took the
// gate count plus their own sightline. Nothing named the axes, so nobody could see that
// lights had been handed the SIGNAL rule — which is how a torch two rooms away kept its slot
// because an open veil costs zero gates.
//
// So: name the axes, and let each consumer state which ones bind it, in one line you can
// read without opening the culler.
//
//   maxGates  — how many CLOSED thresholds may stand between you and it.
//
// A threshold is closed or it is not — the veil's own draw cutoff decides, so a veil that
// has visibly lifted costs nothing to cross and any other costs one. At 0 a thing is bound
// to the space you are standing in and the spaces whose doorways have already opened for
// you, which is Josh's rule stated exactly: *"you leave a room, lights are gone."*
//
// I briefly added a second, continuous axis here — a minimum fraction of light surviving the
// veils — and Josh threw it out: *"what the heck is reach, that is total nonsense. Why are
// lights lighting that are in other rooms or can't be visible because we have the veil?"* He
// was right. The rule he wanted already existed; what was broken was that the gate step
// tested `veilAlpha > 0` on a value that eases and is therefore almost never exactly zero,
// so every threshold read as permanently shut, so the horizon had to be loosened to 1 to be
// usable, which let a whole chain of rooms stay lit. One epsilon, not one more concept.
//
// THE FRUSTUM IS DELIBERATELY NOT AN AXIS, and that absence is load-bearing. It belongs to
// the draw list and nothing else: what to render depends on where you are looking, what can
// light you does not. Offering it as an option is offering the bug — a light culled by the
// view cone guttered every time Josh turned his head, and it took a day to find.
export interface CullPolicy {
  /** Most closed thresholds allowed. Infinity = this axis does not bind. */
  readonly maxGates: number;
}

/** Does this thing survive its own rule? Fails OPEN on an unplaceable thing, like everything
 *  else here — see the header. */
export function passes(policy: CullPolicy, at: Located): boolean {
  return at.gates <= policy.maxGates;
}

export interface Located {
  /**
   * Thresholds to the nearest space this thing touches. 0 = you are standing in it. Fails
   * open to 0 — "I cannot place this" must never read as "infinitely far away".
   *
   * ── AND THIS IS THE ONLY THING THE INDEX WILL TELL YOU ───────────────────
   *
   * It used to also answer "is this space being drawn", and that was a trap I walked
   * straight into an hour after building this file. The drawn set is the RENDERER's answer
   * and it includes the frustum, because of course it does — it is the list of things to
   * draw. But a light does not care where you are looking. I culled lights by it anyway, so
   * strafing across a room pushed a torch's space off the edge of the screen, the torch lost
   * its slot, and the entire pool of light it was casting blinked out and back. Josh:
   * *"moving left and right in the same room culls and re-renders, then culls the lamps,
   * embers and fire effect, also the light."*
   *
   * Gates are the frustum-free half of the same walk: a pure traversal of the portal graph
   * where a closed threshold costs one and an open one costs nothing. Turning your head
   * cannot change it. Walking through a doorway can, which is exactly the rule the veil is
   * teaching the player anyway.
   *
   * So the drawn set does not leave the culler. Geometry culling is allowed to depend on
   * where the camera points; nothing else is.
   */
  readonly gates: number;
}

/** The answer when we have nothing to say. Shared, because it is immutable and returned a
 *  lot: every binding on every frame before the first world publishes. */
const UNKNOWN: Located = { gates: 0 };

interface Binding {
  x: number;
  z: number;
  /** Which world `spaces` describes. Never compared to a "current world" that has only been
   *  BUILT — see publishedWorld. */
  world: number;
  /** Every space this point touches, most generous reading. Empty = off the floor plan. */
  spaces: string[];
}

/** Bindings by caller key. Keys are caller-scoped ('light:torch-3', 'signal:17') and may
 *  repeat across floors — that is exactly what `world` is for. */
const bindings = new Map<string, Binding>();

// ── THE CURRENT WORLD ────────────────────────────────────────────────────────
//
// TWO numbers, and the distance between them is a real bug I shipped and had to measure.
// `builtWorld` ticks when a culler is CONSTRUCTED. `publishedWorld` ticks when one first
// SPEAKS. They differ by at least a frame, and during that frame the maps still hold the
// previous world's data. Stamping a binding with the built number in that window latches the
// old world's answer under the new world's name — which is not a stale cache, it is a cache
// that looks fresh. Bindings are stamped with `publishedWorld`, always: the number of the
// world whose answers you are actually being given.
let builtWorld = 0;
let publishedWorld = 0;

/** Nodes of the world currently speaking. Null between worlds. */
let nodes: SpaceNode[] | null = null;
/** Thresholds from the player, per space. */
const gates = new Map<string, number>();

/**
 * Claim a world number. Called when a culler is built, BEFORE it can say anything.
 *
 * The number is the culler's own; it hands it back on every publish so a culler that has
 * been superseded goes quiet by itself. No teardown call to forget, because every teardown
 * hook that has to be remembered is one that will eventually be missed.
 */
export function claimWorld(): number {
  return ++builtWorld;
}

/** Is this world still the one allowed to speak? A superseded culler still culls its own
 *  geometry — the title vignette keeps rendering behind the menu — it just may not answer
 *  for the floor any more. */
export function worldIsCurrent(world: number): boolean {
  return world === builtWorld;
}

/**
 * This frame's answer, from the world that owns it.
 *
 * Called once per tick by the active culler with everything it decided. The index does not
 * compute visibility — that is the culler's job and it is good at it. The index owns who is
 * allowed to say it, who is asking, and what happens when the world underneath changes.
 */
export function publishFrame(
  world: number,
  worldNodes: SpaceNode[],
  gatesById: ReadonlyMap<string, number>,
): void {
  if (!worldIsCurrent(world)) return;
  publishedWorld = world;
  nodes = worldNodes;
  gates.clear();
  for (const [id, n] of gatesById) gates.set(id, n);
}

/**
 * Stand down. The index answers UNKNOWN — which is to say, everything is visible — until
 * some world publishes again.
 *
 * Only the current speaker may retire the index, so a stale culler shutting down cannot
 * blind the live one.
 */
export function retireWorld(world: number): void {
  if (world !== publishedWorld) return;
  publishedWorld = 0;
  nodes = null;
  gates.clear();
}

/** Slack on the box test, metres. The masonry band is 0.25m; this clears it with room, so a
 *  sconce set into the stone still finds the room it faces. */
const MOUNT_MARGIN = 0.6;

/**
 * The nearest of several spaces, in thresholds — the generous reading, see the header.
 *
 * A space with no gate count is one the walk never reached. Reachability is the culler's to
 * state, and if it did not state it we do not invent it: the OTHER spaces this thing touches
 * decide, and if none of them were reached either, it shows.
 */
function nearestGate(spaces: string[]): number {
  let nearest = Infinity;
  for (const id of spaces) {
    const g = gates.get(id);
    if (g !== undefined && g < nearest) nearest = g;
  }
  return nearest === Infinity ? 0 : nearest;
}

function resolve(x: number, z: number): string[] {
  if (!nodes) return [];
  const out: string[] = [];
  for (const n of nodes) {
    if (x < n.cx - n.hw - MOUNT_MARGIN || x > n.cx + n.hw + MOUNT_MARGIN
      || z < n.cz - n.hd - MOUNT_MARGIN || z > n.cz + n.hd + MOUNT_MARGIN) continue;
    out.push(n.id);
  }
  return out;
}

/**
 * Where a fixed thing is, and whether it can be seen from where the player is.
 *
 * `key` identifies the thing to this index and nothing else — it is never compared across
 * worlds, so a light id that repeats on every floor is fine. Resolution is cached and
 * re-runs by itself whenever the world underneath changes.
 *
 * Costs one scan of the node list the first time a key is seen in a world, and two map reads
 * per call after that.
 */
export function locate(key: string, x: number, z: number): Located {
  if (publishedWorld === 0) return UNKNOWN;

  let b = bindings.get(key);
  if (!b || b.world !== publishedWorld || b.x !== x || b.z !== z) {
    b = { x, z, world: publishedWorld, spaces: resolve(x, z) };
    bindings.set(key, b);
  }
  if (b.spaces.length === 0) return UNKNOWN;
  return { gates: nearestGate(b.spaces) };
}

/**
 * The player's own position, for callers that need to reason about a MOVING point.
 *
 * Deliberately not `locate` — a binding is for something fixed, and keying a moving point
 * would rewrite its cache entry every frame for no gain. This is the uncached path and it
 * is the honest one for the caller who needs it.
 */
export function locateMoving(x: number, z: number): Located {
  if (publishedWorld === 0) return UNKNOWN;
  const spaces = resolve(x, z);
  if (spaces.length === 0) return UNKNOWN;
  return { gates: nearestGate(spaces) };
}

/** For the DEV probes, so a readout reports the index's own state rather than re-deriving
 *  it and laundering a guess as a measurement. */
export function spaceIndexState(): {
  world: number; spaces: number; reachable: number; bindings: number;
  gates: Record<string, number>;
} {
  return {
    world: publishedWorld,
    spaces: nodes?.length ?? 0,
    reachable: gates.size,
    bindings: bindings.size,
    gates: Object.fromEntries(gates),
  };
}
