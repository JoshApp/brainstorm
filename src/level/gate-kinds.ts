// ── A GATE IS THE CULLING PRIMITIVE, AND IT HAS A TYPE ───────────────────────
//
// Josh: *"your veil is one shape of a gate. We can make it so it's basically a closed door
// right until you open it, so we can cull behind it — and gates that are closed and open are
// the same language, they can specify what and how they cull. So the culler works with types
// of gates: some are simply LOS gated, some are activation gates."*
//
// That inverts what this codebase had. The veil was the thing and the gate was a number
// derived from its alpha, which is why every rule ended up thresholding a rendering value to
// recover a fact somebody already knew, and why each new kind of threshold — a bend, a door,
// a boss ward — needed its own special case somewhere else.
//
// A gate is an edge in the space graph. It knows how it decides it is shut, and it knows
// WHAT STILL CROSSES IT while it is. The veil is one skin on one kind of gate.
//
// ── WHY `passes` IS THE INTERESTING COLUMN ──────────────────────────────────
//
// It is what makes a closed door worth having. A veil is dark you can see fires through —
// that is its whole design, darkness changing the channel rather than removing the
// information. A closed door is not dark, it is STONE: nothing behind it is visible by any
// means, so nothing behind it needs to exist. One row in this table drops a whole wing of a
// floor, with no code anywhere that knows what a door is.
//
// The three channels are the three questions anything ever asks:
//
//   geometry — may this space's stone and props be drawn?
//   light    — may a light in it reach me?
//   signal   — may a flame, rune or eye in it read through?
//
// A CONSUMER names its channel and its horizon, and never learns what kind of gate stopped
// it (see CullPolicy in space-index.ts). That is the seam: adding a gate kind is a row here,
// and adding a kind of thing is a policy naming a channel. Neither has to touch the walk.

/** The channels anything can ask about. */
export type GateChannel = 'geometry' | 'light' | 'signal';

export type GateKindId = 'veil' | 'bare' | 'arch' | 'door' | 'ward';

export interface GateKind {
  /**
   * How it decides it is shut.
   *   proximity — eases open as the player commits to it. Veils and bends.
   *   state     — something else owns the answer: a door's latch, a ward's condition.
   *   never     — always open. It is an edge in the graph and nothing more.
   */
  seal: 'proximity' | 'state' | 'never';
  /**
   * Which channels MAY CROSS while it is shut — at a cost of one gate, not for free.
   *
   * The distinction is load-bearing and I got it wrong first: a channel that crosses at a
   * cost is one gate further away, and the consumer's own horizon decides whether that is
   * too far. A channel that cannot cross is at INFINITY — no distance, no path, nothing
   * behind it on that channel at all.
   *
   * Making a veil "block" geometry rather than charge it collapsed every space past a
   * threshold to Infinity, which left the horizons nothing to count and every detail tier
   * pinned at gate 0. A veil charges. A door blocks. That is the whole difference between
   * darkness and stone.
   */
  passes: Record<GateChannel, boolean>;
}

/** Charges every channel a gate. The horizons decide who can afford it. */
const CHARGES_ALL = { geometry: true, light: true, signal: true } as const;
/** Stone with a fire behind it: you may read the fire, you may not see the room or be lit
 *  by it. A boss ward is the canonical one. */
const SIGNAL_ONLY = { geometry: false, light: false, signal: true } as const;
/** Nothing at all. Only a closed door earns this. */
const NOTHING = { geometry: false, light: false, signal: false } as const;

export const GATE_KINDS: Record<GateKindId, GateKind> = {
  // The dark quad in a doorway. It charges every channel one gate; what makes it read as
  // "you cannot see the room but you can see its fires" is the HORIZONS — light stops at 0,
  // signal carries to 1 — not a block here. Darkness changes the channel; it is not stone.
  veil: { seal: 'proximity', passes: CHARGES_ALL },

  // A bend, a joint, any edge with nothing drawn in it. Seals exactly like a veil, and
  // deliberately has no quad — at a corner the stone already masks the change, and a black
  // plane across a corridor with no doorframe reads as a wall.
  bare: { seal: 'proximity', passes: CHARGES_ALL },

  // An opening that is simply open. In the graph so the flood can cross it; never seals, so
  // line of sight and the frustum do all the work.
  arch: { seal: 'never', passes: CHARGES_ALL },

  // ── THE ONE THAT PAYS ──────────────────────────────────────────────────────
  // A shut door is not darkness, it is stone. Nothing behind it is visible by any means, so
  // nothing behind it is drawn, lit, or read — its fires included. That is a real atmosphere
  // beat as well as the biggest cut available: doors seal on combat, and while one is shut
  // the wing behind it costs nothing at all.
  door: { seal: 'state', passes: NOTHING },

  // A fog gate or boss ward: sealed until something happens. The one gate that genuinely
  // blocks sight while passing signal — the point of a ward is that you can see what waits
  // without seeing the room it waits in.
  ward: { seal: 'state', passes: SIGNAL_ONLY },
};

/** Depth per channel from the player, in shut gates crossed. Infinity = no path at all. */
export type GateDepths = Record<GateChannel, number>;

export const AT_PLAYER: GateDepths = { geometry: 0, light: 0, signal: 0 };
export const UNREACHABLE: GateDepths = {
  geometry: Infinity, light: Infinity, signal: Infinity,
};

/**
 * Crossing one edge: what the depths become on the far side.
 *
 * Open costs nothing. Shut costs one to the channels the kind passes and ends the path for
 * the channels it does not — which is how a closed door removes a wing rather than merely
 * pushing it further away.
 *
 * SHUT IS PER CHANNEL, and that is not a detail. A threshold does not stop being shut for
 * everything at the same instant: stone has to be READY before you can see it, or it pops
 * into a doorway you are already looking through, while light and a fire's glow are the
 * things you actually perceive and should arrive exactly when the dark gives them up. So
 * geometry unseals early and perception unseals late, on the same easing veil. Josh: *"a
 * veil gate shouldn't do the rendering when below 50 — the moment a gate is engaged
 * slightly, that should be okay, yeah, we need that."*
 */
export function acrossGate(
  here: GateDepths, kind: GateKindId, shut: Record<GateChannel, boolean>,
): GateDepths {
  const p = GATE_KINDS[kind].passes;
  const step = (c: GateChannel): number => {
    if (!shut[c]) return here[c];
    return p[c] ? here[c] + 1 : Infinity;
  };
  return { geometry: step('geometry'), light: step('light'), signal: step('signal') };
}

/** True when no channel can get any further — the walk can stop expanding here. */
export function exhausted(d: GateDepths, maxGates: number): boolean {
  return d.geometry >= maxGates && d.light >= maxGates && d.signal >= maxGates;
}

/** Does `next` improve on `prev` for any channel? The relaxation test. */
export function improves(next: GateDepths, prev: GateDepths | undefined): boolean {
  if (!prev) return true;
  return next.geometry < prev.geometry || next.light < prev.light || next.signal < prev.signal;
}

/** Channel-wise best of two — used when a thing touches several spaces. */
export function bestOf(a: GateDepths, b: GateDepths): GateDepths {
  return {
    geometry: Math.min(a.geometry, b.geometry),
    light: Math.min(a.light, b.light),
    signal: Math.min(a.signal, b.signal),
  };
}
