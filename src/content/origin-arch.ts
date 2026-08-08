import type { ModelSpec, PartSpec } from '../ecs/model-types';

// THE WAY YOU CAME, SHUT BEHIND YOU.
//
// The pair of doors on the wall behind every floor's spawn. It closes the
// descent-continuity loop: at the bottom of the last floor's stairwell these
// same doors stood AJAR with firelight through the crack
// (interactables/stairs.ts, "THE DOORS"); you passed through, and they shut at
// your back. Pure set dressing — no collision (it is flush to a wall), no
// interaction. They do not open from this side, and the boards say so.
//
// ── WHY IT WAS REBUILT ───────────────────────────────────────────────────────
//
// Josh, on a polygon floor: *"the bolted door at the backside of the first room
// doesn't look good anymore now after the poly upgrade."*
//
// Nothing about it changed — everything around it did. The doorways it stands
// beside were rebuilt this week into one masonry family: dressed stone at
// 0x262a30, a real voussoir ring with a keystone, plinth-and-impost jambs
// (content/archway.ts and content/doorframe.ts). This gate was still the old
// palette — a lighter 0x3a363e framing stone, a squashed 0.66 arc that is not
// the curve either threshold turns, and warm brown timber. Beside the new
// posterns it read as a prop from a different game.
//
// So it is now the same masonry as the rest, with the ROUND arch the postern
// turns — which is the right quote to make, because this IS a narrow doorway,
// and a player who has learned that a round arch means "a way through" should
// feel that promise being broken by the boards nailed across it.
//
// The seal is what carries the meaning and it stays loud: an X of weathered
// planks, a barring beam, nail heads. Pristine doors with pull rings read as
// openable and players tried to go back through them.
//
// Authoring axes (matches archway.ts / doorframe.ts):
//   +X along the wall, +Y up, +Z out of the wall toward the room.

const OPEN_W = 1.9;              // clear opening width
const HALF = OPEN_W / 2;
const SPRING = 2.05;             // where the arch springs — the postern's line
const RISE = HALF;               // ROUND. rise = half-span, as the postern turns
const JAMB_HALF = 0.14;          // matches the postern's jamb
const JAMB_OFF = HALF + JAMB_HALF;
const BASE_H = 0.24;
const BASE_OVER = 0.06;
const IMPOST_H = 0.14;
const IMPOST_OVER = 0.065;
const COURSES = 2;

/** Depth out of the wall. The gate stands proud so a lamp rakes it, but less
 *  than a real threshold's reveal — there is no passage behind this one, and a
 *  deep reveal would promise one. */
const FILL_D = 0.30;
const ARCH_D = FILL_D + 0.10;
const KEY_D = FILL_D + 0.20;
const JAMB_D = 0.34;

const VOUSSOIRS = 5;
const VOUSSOIR_RADIAL = 0.17;
const KEYSTONE_RADIAL = 0.30;

// A true semicircle: radius = half-span, centre ON the springing line.
const RADIUS = (HALF * HALF + RISE * RISE) / (2 * RISE);
const CENTRE_Y = SPRING + RISE - RADIUS;
const HALF_ANGLE = Math.atan2(HALF, RADIUS - RISE);

const parts: PartSpec[] = [];

// ── THE RING ─────────────────────────────────────────────────────────────────
// Same polar construction as the postern's, and the same sign convention: −theta
// about Z swings an unrotated box (local +Y radially out at theta = 0) round the
// arc. NOT on the 'glow' material — this gate is dead. The proximity glow means
// "a way through" everywhere else in the dungeon, and lighting up the one door
// that never opens would be the cruellest possible misuse of that signal.
{
  const step = (2 * HALF_ANGLE) / VOUSSOIRS;
  for (let i = 0; i < VOUSSOIRS; i++) {
    const theta = -HALF_ANGLE + (i + 0.5) * step;
    const key = i === (VOUSSOIRS - 1) / 2;
    const radial = key ? KEYSTONE_RADIAL : VOUSSOIR_RADIAL;
    const rho = RADIUS + radial / 2;
    parts.push({
      kind: 'box',
      name: key ? 'keystone' : `voussoir-${i}`,
      pos: [rho * Math.sin(theta), CENTRE_Y + rho * Math.cos(theta), FILL_D / 2],
      rot: [0, 0, -theta],
      size: [RADIUS * step * (key ? 1.28 : 1.12), radial, key ? KEY_D : ARCH_D],
      mat: 'stone',
    } as PartSpec);
  }
}

// ── THE JAMBS ────────────────────────────────────────────────────────────────
// Plinth, two coursed blocks with alternating depth, and a springer impost —
// the postern's jamb, so the two read as the same mason's work. One course is
// chipped, on one side only: a gate identical left and right is the tell that
// nobody built it.
for (const side of [-1, 1] as const) {
  const x = side * JAMB_OFF;
  parts.push({
    kind: 'box', name: 'plinth',
    pos: [x, BASE_H / 2, FILL_D / 2],
    size: [JAMB_HALF * 2 + BASE_OVER * 2, BASE_H, JAMB_D + 0.10],
    mat: 'stone',
  } as PartSpec);

  const shaftTop = SPRING - IMPOST_H;
  const courseH = Math.max(0.18, (shaftTop - BASE_H) / COURSES);
  for (let c = 0; c < COURSES; c++) {
    const deep = c % 2 === 0 ? 0.02 : -0.02;
    const chipped = side === 1 && c === 0;
    parts.push({
      kind: 'box', name: `course-${c}`,
      pos: [x - (chipped ? 0.02 : 0), BASE_H + courseH * (c + 0.5), FILL_D / 2 - (chipped ? 0.03 : 0)],
      size: [
        JAMB_HALF * 2 - (chipped ? 0.04 : 0),
        courseH - 0.012,
        JAMB_D + deep - (chipped ? 0.06 : 0),
      ],
      mat: 'stone',
    } as PartSpec);
  }

  parts.push({
    kind: 'box', name: 'impost',
    pos: [x, SPRING - IMPOST_H / 2, FILL_D / 2],
    size: [(JAMB_HALF + IMPOST_OVER) * 2, IMPOST_H, JAMB_D + 0.08],
    mat: 'stone',
  } as PartSpec);
}

// ── WHAT IS BEHIND THE DOORS ─────────────────────────────────────────────────
// Nothing, and it must LOOK like nothing. A dark plate fills the whole opening
// including the lunette under the arch, so the gaps between the boards read as
// depth rather than as the room's own wall showing through.
parts.push({
  kind: 'box', name: 'void',
  pos: [0, (SPRING + RISE) / 2, 0.02],
  size: [OPEN_W, SPRING + RISE, 0.04], mat: 'void',
} as PartSpec);

// ── THE LEAVES ───────────────────────────────────────────────────────────────
// Three planks a side with alternating depth, so the wood reads as boards rather
// than a slab. Recessed into the reveal, and darker than the old timber — this
// is wood that has been underground a long time, not a fresh door.
const LEAF_H = SPRING - 0.05;
for (const side of [-1, 1] as const) {
  const plankW = OPEN_W / 6 - 0.012;
  for (let i = 0; i < 3; i++) {
    parts.push({
      kind: 'box', name: `plank-${i}`,
      pos: [side * (0.04 + plankW / 2 + i * (plankW + 0.012)), LEAF_H / 2, 0.10 + (i % 2) * 0.025],
      size: [plankW, LEAF_H, 0.10], mat: 'timber',
    } as PartSpec);
  }
  // Two bands and a hinge strap per leaf.
  for (const by of [0.52, 1.74]) {
    parts.push({
      kind: 'box', name: 'band',
      pos: [side * (OPEN_W / 4 + 0.02), by, 0.17],
      size: [OPEN_W / 2 - 0.06, 0.085, 0.05], mat: 'iron',
    } as PartSpec);
  }
  parts.push({
    kind: 'box', name: 'strap',
    pos: [side * (HALF - 0.17), 1.12, 0.17],
    size: [0.34, 0.07, 0.05], mat: 'iron',
  } as PartSpec);
}

// ── SEALED ───────────────────────────────────────────────────────────────────
// The whole point, and the reason there are no pull rings any more: rings say
// "pull me", and players did. An X of weathered plank, a barring beam across the
// jambs, and nails where they cross. The boards are a DIFFERENT grey from the
// door — older, rougher — so the seal reads as hammered on afterwards by someone
// who wanted this shut, rather than as part of the door.
parts.push(
  { kind: 'box', name: 'board-x1', pos: [0, 1.08, 0.215], size: [2.55, 0.17, 0.06], rot: [0, 0, 0.72], mat: 'board' },
  { kind: 'box', name: 'board-x2', pos: [0, 1.08, 0.215], size: [2.55, 0.17, 0.06], rot: [0, 0, -0.72], mat: 'board' },
  // The bar reaches PAST the jambs onto the stone either side. A beam that stops
  // at the door is a decoration; one socketed into the masonry is a decision.
  { kind: 'box', name: 'bar', pos: [0, 0.62, 0.23], size: [OPEN_W + JAMB_HALF * 4, 0.16, 0.07], mat: 'board' },
  { kind: 'box', name: 'nail', pos: [-0.86, 1.72, 0.25], size: [0.10, 0.10, 0.05], mat: 'iron' },
  { kind: 'box', name: 'nail', pos: [0.86, 1.72, 0.25], size: [0.10, 0.10, 0.05], mat: 'iron' },
  { kind: 'box', name: 'nail', pos: [-0.86, 0.42, 0.25], size: [0.10, 0.10, 0.05], mat: 'iron' },
  { kind: 'box', name: 'nail', pos: [0.86, 0.42, 0.25], size: [0.10, 0.10, 0.05], mat: 'iron' },
  { kind: 'box', name: 'spike', pos: [0, 1.08, 0.27], size: [0.13, 0.13, 0.05], mat: 'iron' },
);

export const ORIGIN_ARCH: ModelSpec = {
  id: 'origin-arch2',
  materials: {
    // THE ARCHWAY'S STONE, EXACTLY. This gate stands in the same wall as the
    // posterns; a different grey says it was quarried in another century.
    stone: { color: 0x262a30, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
    // Old wood, underground. The previous 0x5c4326 was a warm furniture brown
    // that fought a palette built on restraint.
    timber: { color: 0x3a2c1e, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
    iron: { color: 0x17191d, roughness: 0.5, metalness: 0.6, flatShading: true },
    // The seal — and it is the LIGHTEST thing in the gate on purpose.
    //
    // First pass had this at 0x3d352c against a 0x2e2418 door and the bench
    // showed the result immediately: the X, the bar and the nails all vanished
    // into the void plate behind them. The boards ARE the message; a seal you
    // cannot see is just a dark doorway. Dry split wood that has never been
    // underground as long as the door has, which is also true of it.
    board: { color: 0x6f5f49, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
    // Not a colour so much as an absence — unlit, so no lamp can find a back
    // wall behind the boards.
    void: { color: 0x05060a, roughness: 1.0, metalness: 0.0, emissive: 0x05060a, emissiveIntensity: 1.0 },
  },
  parts,
};
