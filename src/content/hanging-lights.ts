import type { ModelSpec } from '../ecs/model-types';
import { orient } from '../anim/orient';

// ── LIGHT THAT HANGS ─────────────────────────────────────────────────────────
//
// Josh, walking a polygon floor: *"braziers in the middle especially the tall
// ones look a bit lost in the middle of the room. we need more ceiling lights,
// things that can hang down, smaller / bigger."*
//
// He is describing a real failure and not a taste. A standing light in the
// middle of a room is a piece of FURNITURE: it has a footprint, you walk round
// it, and in a big room it reads as an object that happens to be lit rather
// than as the room being lit. That is exactly wrong for a hall, where the thing
// that needs saying is "this space is large and somebody lit it".
//
// A hung source says that instead, and it costs nothing on the floor — which is
// the other half of the problem, because the middle of a big room is where the
// encounter wants to be. Hung light is the only kind that can be central
// without being in the way.
//
// ── THE FAMILY, AND WHY IT IS A FAMILY ───────────────────────────────────────
//
// One chandelier for every room is the state we are leaving. It has the same
// disease the walls had before wall-courses.ts: one answer, so every room that
// takes the answer looks like every other. Four sizes, and the size is chosen
// by the ROOM (headroom and how much light it needs), not by taste:
//
//   HOOK_LAMP     a single lamp on a short chain. Corridor, alcove, over a
//                 door, over a thing worth looking at. Tight pool.
//   CHAIN_RING    the workhorse: an iron ring, four candle stubs. A chamber.
//   IRON_CORONA   two tiers, nine flames, a long drop. A hall, and only a
//                 hall — it needs the headroom to hang below the vault and
//                 still clear a head, and it looks absurd in a low room.
//   COLD_HOOK     A CHAIN WITH NOTHING BURNING ON IT. See below.
//
// ── THE COLD HOOK IS NOT AN OVERSIGHT ────────────────────────────────────────
//
// CLAUDE.md's lighting doctrine says an uncommon light means something is
// happening there, and the player learns that from repetition. The counterpart
// is worth as much and costs nothing: a fitting the player has learned means
// LIGHT, hanging empty. It is the room saying somebody used to keep this place
// and does not any more, in one object, with no text and no light budget.
//
// It also does honest work for the encounter: hung over the middle of a dark
// room it draws the eye upward to nothing, which is the cheapest way to make a
// player uneasy about a room that is, in fact, empty.
//
// ── CONVENTIONS ──────────────────────────────────────────────────────────────
//
// Origin is the CEILING ATTACHMENT, and everything hangs in −Y from it. So a
// placer puts the origin at the ceiling plane and never has to know how far a
// given fixture drops — which is the whole point of a family whose members drop
// different distances. `mount.to = 'ceiling'`, standoff 0.
//
// `slots.hang_point` marks that attachment and `slots.flame_ring` marks where
// the fire actually is, so the light-placer can put its point light at the
// flames rather than at the ceiling. Both are intent anchors in the sense
// CLAUDE.md means: they survive a redesign of the ironwork above them.
//
// Chains are thin cylinders, not link chains. `chain-links.ts` builds real
// links and is right for the hand-placed hall chandelier you walk under; at
// four metres in torchlight a 2.4cm cylinder is the same picture for a
// twentieth of the triangles, and these go in every room.

/** Iron everything is made of. One material, so the family reads as one smith. */
const IRON = { color: 0x16140f, roughness: 0.6, metalness: 0.75, flatShading: 'auto' as const };
const WAX = { color: 0xb0a184, roughness: 0.95, flatShading: 'auto' as const };
const FLAME_MAT = {
  color: 0x000000, emissive: 0xffaa55, emissiveIntensity: 2.4, roughness: 1.0, fog: false,
};
/** Cold iron — the same metal, read as unlit. Slightly bluer and rougher so it
 *  does not catch a highlight the way a tended fitting does. */
const DEAD_IRON = { color: 0x14151a, roughness: 0.85, metalness: 0.5, flatShading: 'auto' as const };

/**
 * A chain running from a point on the ring's rim UP AND IN to the eye.
 *
 * Splayed, not parallel, and that is the whole silhouette. Three vertical
 * chains at one radius read as three poles holding a hoop up — a scaffold. Three
 * chains converging on one eye read as something HUNG, which is the only thing
 * this family is trying to say. (First version had them vertical. In the ortho
 * contact sheet it looked like a plant stand.)
 *
 * The lean is solved by `orient`, not by hand-picked Euler decimals — the axis
 * to tilt about depends on where round the ring this chain is, which is exactly
 * the case CLAUDE.md warns produces three iterations with the wrong sign.
 */
function chain(rBottom: number, rTop: number, angle: number, drop: number, mat = 'iron') {
  const bx = Math.cos(angle) * rBottom, bz = Math.sin(angle) * rBottom;
  const tx = Math.cos(angle) * rTop, tz = Math.sin(angle) * rTop;
  const dx = tx - bx, dy = drop, dz = tz - bz;
  const len = Math.hypot(dx, dy, dz);
  return {
    kind: 'cylinder' as const,
    // Midpoint of the run — a cylinder is centred on its own origin.
    pos: [(bx + tx) / 2, -drop / 2, (bz + tz) / 2] as [number, number, number],
    // Local +Y along the run, bottom to top.
    rot: orient({ yAxisTo: [dx, dy, dz] }),
    radius: 0.012,
    height: len,
    segments: 5,
    mat,
  };
}

/** A candle stub with its flame, standing on a rim at height `y`, radius `r`. */
function stub(r: number, angle: number, y: number, h = 0.09) {
  const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return [
    { kind: 'cylinder' as const, pos: [x, y + h / 2, z] as [number, number, number], radius: 0.024, radiusTop: 0.019, height: h, segments: 6, mat: 'wax' },
    { name: 'flame', kind: 'sphere' as const, pos: [x, y + h + 0.03, z] as [number, number, number], radius: 0.024, segments: [7, 5] as [number, number], mat: 'flame' },
  ];
}

// ── SMALL ────────────────────────────────────────────────────────────────────
//
// A lamp on a hook. The only member of the family that fits a corridor, and the
// one to hang over something you want looked at — its pool is small enough that
// what it lights is a statement rather than a side effect.
export const HOOK_LAMP: ModelSpec = {
  id: 'hook-lamp',
  mount: { to: 'ceiling', standoff: 0 },
  moodTintable: true,
  materials: { iron: IRON, flame: FLAME_MAT, horn: { color: 0xc9b487, roughness: 0.7, transparent: true, opacity: 0.45 } },
  slots: {
    hang_point: { pos: [0, 0, 0] },
    flame_ring: { pos: [0, -0.62, 0] },
  },
  parts: [
    // The eye it hangs from, then the chain, then the hook it hangs ON.
    { name: 'eye', kind: 'torus', pos: [0, -0.04, 0], radius: 0.035, tube: 0.012, segments: [12, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    chain(0, 0, 0, 0.44),
    { name: 'hook', kind: 'torus', pos: [0, -0.47, 0], radius: 0.05, tube: 0.011, segments: [12, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    // The lantern: a cage of four uprights and a cap, horn panes between.
    { name: 'cap', kind: 'cone', pos: [0, -0.53, 0], radius: 0.11, height: 0.09, segments: 4, mat: 'iron' },
    { name: 'pane', kind: 'box', pos: [0, -0.64, 0], size: [0.13, 0.16, 0.13], mat: 'horn' },
    { kind: 'box', pos: [0.065, -0.64, 0.065], size: [0.016, 0.17, 0.016], mat: 'iron' },
    { kind: 'box', pos: [-0.065, -0.64, 0.065], size: [0.016, 0.17, 0.016], mat: 'iron' },
    { kind: 'box', pos: [0.065, -0.64, -0.065], size: [0.016, 0.17, 0.016], mat: 'iron' },
    { kind: 'box', pos: [-0.065, -0.64, -0.065], size: [0.016, 0.17, 0.016], mat: 'iron' },
    { name: 'base', kind: 'box', pos: [0, -0.735, 0], size: [0.15, 0.03, 0.15], mat: 'iron' },
    { name: 'flame', kind: 'sphere', pos: [0, -0.65, 0], radius: 0.032, segments: [7, 5], mat: 'flame' },
  ],
  light: { color: 0xffaa55, intensity: 26, distance: 7, decay: 2.0 },
};

// ── MEDIUM ───────────────────────────────────────────────────────────────────
//
// The workhorse. A ring of iron on three chains with four stubs guttering on
// the rim — the fixture a chamber gets when its walls cannot reach its middle.
export const CHAIN_RING: ModelSpec = {
  id: 'chain-ring',
  mount: { to: 'ceiling', standoff: 0 },
  moodTintable: true,
  materials: { iron: IRON, wax: WAX, flame: FLAME_MAT },
  slots: {
    hang_point: { pos: [0, 0, 0] },
    flame_ring: { pos: [0, -0.92, 0] },
  },
  parts: [
    { name: 'eye', kind: 'torus', pos: [0, -0.04, 0], radius: 0.04, tube: 0.013, segments: [12, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    chain(0.47, 0.05, 0.5, 0.86),
    chain(0.47, 0.05, 0.5 + (Math.PI * 2) / 3, 0.86),
    chain(0.47, 0.05, 0.5 + (Math.PI * 4) / 3, 0.86),
    { name: 'ring', kind: 'torus', pos: [0, -0.9, 0], radius: 0.5, tube: 0.032, segments: [22, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    ...stub(0.46, 0.3, -0.88),
    ...stub(0.46, 0.3 + Math.PI / 2, -0.88, 0.07),
    ...stub(0.46, 0.3 + Math.PI, -0.88, 0.11),
    ...stub(0.46, 0.3 + (Math.PI * 3) / 2, -0.88),
  ],
  light: { color: 0xffaa55, intensity: 52, distance: 9, decay: 2.0 },
};

// ── LARGE ────────────────────────────────────────────────────────────────────
//
// Two tiers and a long drop, for a room whose ceiling is high enough that a
// single ring reads as a coin on the ceiling. Needs the headroom — the skin
// refuses it below it rather than shrinking it, because a corona that has been
// scaled down to fit is just a ring with extra triangles.
export const IRON_CORONA: ModelSpec = {
  id: 'iron-corona',
  mount: { to: 'ceiling', standoff: 0 },
  moodTintable: true,
  materials: { iron: IRON, wax: WAX, flame: FLAME_MAT },
  slots: {
    hang_point: { pos: [0, 0, 0] },
    flame_ring: { pos: [0, -1.36, 0] },
  },
  parts: [
    { name: 'eye', kind: 'torus', pos: [0, -0.05, 0], radius: 0.05, tube: 0.016, segments: [12, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    chain(0.78, 0.06, 0.2, 1.29),
    chain(0.78, 0.06, 0.2 + (Math.PI * 2) / 3, 1.29),
    chain(0.78, 0.06, 0.2 + (Math.PI * 4) / 3, 1.29),
    // Outer tier, six flames.
    { name: 'ring', kind: 'torus', pos: [0, -1.34, 0], radius: 0.82, tube: 0.036, segments: [28, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    ...[0, 1, 2, 3, 4, 5].flatMap((i) => stub(0.78, 0.15 + (i * Math.PI) / 3, -1.32, 0.07 + (i % 3) * 0.03)),
    // Inner tier, hung under the outer on short ties — three more flames, and
    // the depth that stops it reading as a flat hoop from directly below.
    { kind: 'box', pos: [0.34, -1.44, 0], size: [0.014, 0.2, 0.014], mat: 'iron' },
    { kind: 'box', pos: [-0.17, -1.44, 0.29], size: [0.014, 0.2, 0.014], mat: 'iron' },
    { kind: 'box', pos: [-0.17, -1.44, -0.29], size: [0.014, 0.2, 0.014], mat: 'iron' },
    { name: 'ring-inner', kind: 'torus', pos: [0, -1.54, 0], radius: 0.38, tube: 0.026, segments: [18, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    ...[0, 1, 2].flatMap((i) => stub(0.34, 0.9 + (i * Math.PI * 2) / 3, -1.52, 0.08)),
  ],
  light: { color: 0xffaa55, intensity: 78, distance: 12, decay: 2.0 },
};

// ── AND THE ONE THAT ISN'T LIT ───────────────────────────────────────────────
//
// No `light`. That is the model, not a bug in it. See the header: the doctrine
// only pays off if the player has also met the fitting with nothing burning on
// it. Keep it rare — it is a sentence, and a room full of them is noise.
export const COLD_HOOK: ModelSpec = {
  id: 'cold-hook',
  mount: { to: 'ceiling', standoff: 0 },
  materials: { iron: DEAD_IRON, wax: { color: 0x6b6355, roughness: 1.0, flatShading: 'auto' } },
  slots: {
    hang_point: { pos: [0, 0, 0] },
    // Named the same as its lit siblings ON PURPOSE. Anything that wants to put
    // something where the fire used to be — a narration hook, a relight
    // interaction, a spawn — asks the same question of every member.
    flame_ring: { pos: [0, -0.88, 0] },
  },
  parts: [
    { name: 'eye', kind: 'torus', pos: [0, -0.04, 0], radius: 0.04, tube: 0.013, segments: [12, 5], rot: [Math.PI / 2, 0, 0], mat: 'iron' },
    chain(0.40, 0.04, 0.4, 0.82),
    // The ring is still there, hanging crooked off ONE surviving chain — two
    // gave way. That is what makes it read as abandoned rather than as unbuilt,
    // and it only reads if the tilt is STEEP: a hoop on a single chain tips
    // most of the way over, and at 15 degrees the contact sheet just showed a
    // level ring with one wire, which looks like a fitting nobody finished.
    { name: 'ring', kind: 'torus', pos: [0.09, -0.86, 0.03], radius: 0.44, tube: 0.03, segments: [20, 5], rot: [Math.PI / 2 + 0.62, 0, 0.34], mat: 'iron' },
    // No wax. The first version left two burnt stubs on the rim and, once the
    // ring tipped over properly, they hung in the air beside it — a detail
    // authored against the OLD pose, which is the standing hazard of tuning a
    // parent after its children. The crooked ring and the snapped chain are the
    // whole sentence anyway; a stub is a word it does not need.
    // A snapped chain end, still hanging from the ceiling with nothing under it.
    { kind: 'cylinder', pos: [-0.16, -0.13, 0.1], radius: 0.012, height: 0.26, segments: 5, mat: 'iron' },
  ],
};
