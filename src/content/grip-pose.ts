// ── THE FIST, AUTHORED ONCE ──────────────────────────────────────────────────
//
// Josh, after watching the solver produce a technically-perfect grip that did not look like a
// hand: *"the index finger and ring finger are close but really far up on the grip and the thumb
// is kinda held like a kitchen knife spine reinforcement — cant we make this simpler like a lego
// hand gripping? isnt there a good way we can do this without you having to spend ages doing
// it."*
//
// Yes, and this is it. The previous approach solved every joint INDEPENDENTLY against the grip
// cylinder: rotate this joint until the one below it touches. Fifteen little optimisations, each
// correct on its own terms, none of them aware of what a hand looks like. Contact distance
// cannot tell a grip from a set of fingers that happen to be the right distance from a line, so
// it kept finding poses that scored well and read wrong — and every fix I made revealed the next
// wrong assumption underneath.
//
// A lego hand does not solve anything. It is one C-shaped claw, and the weapon goes in it. That
// is the correct amount of machinery for this problem.
//
// ── SO: ONE POSE, ONE NUMBER ────────────────────────────────────────────────
//
// The angles below ARE the grip — a hand closed on a hilt, authored as data, in the proportions
// of a real grip rather than discovered per weapon. At runtime exactly one thing is solved: a
// single CURL SCALE applied to all of them together, found so the fist's hollow matches the
// weapon's grip radius. A thin dagger curls tighter, a fat flask bulb curls looser, and every
// finger keeps its relation to every other because they all move by the same factor.
//
// One number, and the hand cannot come apart. That is the whole trade: a fist that is slightly
// off the hilt everywhere beats a fist that touches perfectly and looks broken.
//
// ── THE NUMBERS ─────────────────────────────────────────────────────────────
//
// A real grip is not four identical fingers. The index sits nearly straight along the hilt and
// takes the weapon's line; the little finger curls hardest and anchors the butt of the grip.
// That progression is what makes a fist read as gripping rather than as clenching at nothing,
// and it is the thing fifteen independent solves could never find.

/** Flexion per joint, radians, knuckle outward. Positive = closing. */
export interface FingerCurl {
  /** [MCP, PIP, DIP] — the thumb uses [MCP, IP] and ignores the third. */
  joints: [number, number, number];
}

export interface FistPose {
  index: FingerCurl;
  middle: FingerCurl;
  ring: FingerCurl;
  pinky: FingerCurl;
  thumb: FingerCurl;
}

const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * A hand closed around a hilt.
 *
 * Authored against a ~22mm grip — the starter sword's — because that is the one every run
 * begins with, and CALIBRATED so that weapon solves to a curl of 1.0. The reference pose should
 * BE the reference: a table that only ever runs at 0.64 is a table with a hidden constant in it.
 * Other radii come out of the single curl scale solved at runtime.
 */
export const FIST: FistPose = {
  // The index barely curls at the knuckle: it lies along the hilt and sets the weapon's line.
  index: { joints: [deg(37), deg(51), deg(26)] },
  middle: { joints: [deg(42), deg(56), deg(29)] },
  ring: { joints: [deg(46), deg(59), deg(31)] },
  // The little finger closes hardest, anchoring the butt of the grip against the palm.
  pinky: { joints: [deg(50), deg(61), deg(33)] },
  // The thumb lies ACROSS the fingers rather than bracing along the spine — a fist, not a
  // paring-knife grip. Shallow angles, because the distance is made up by opposition (below)
  // and not by curling the thumb into its own palm.
  thumb: { joints: [deg(28), deg(24), 0] },
};

/**
 * How far the thumb swings ACROSS the hand, about the palm normal, radians.
 *
 * This is opposition, and it is the difference between a fist and a hand with a thumb stuck out
 * beside it. Kept separate from the curl above because it rotates about a different axis and
 * must NOT scale with grip radius: a thumb opposes the same amount whatever it is holding.
 */
export const THUMB_OPPOSE = deg(52);

/**
 * How much of the needed convergence to apply, 0..1.
 *
 * Josh: *"in a real grip [the fingers] should touch right? on the sword the fingers still read
 * as a claw."* Yes — so the target is not a taste number, it is "touching": four fingers side by
 * side occupy three finger-widths, and the solver converges until the fingertip span is that.
 *
 * This knob only scales how much of that gap is closed, and exists so the fist can be loosened
 * without editing the rule. 1 = fingers touch.
 *
 * It replaced a fixed FRACTION of the spread, which could not serve two hands at once. Measured
 * across the knuckles: the authored hand spans 41mm and its fingertips already land at 27mm —
 * tighter than touching, needing nothing. The scanned bone hand spans 72mm and its tips fan to
 * 101mm, because its palm is genuinely 1.7x broader. One fraction either left the bone hand a
 * claw or crushed the authored hand into a knot. An absolute target serves both, and any hand
 * added later, without a per-hand number.
 */
export const CONVERGE = 1;

/** Bounds for the runtime curl scale. Below the first the hand is open, above the second it
 *  folds through itself; a grip that needs more than this is the wrong grip for the hand. */
export const CURL_RANGE: [number, number] = [0.25, 1.60];
