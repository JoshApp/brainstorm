// ── THE DARK LIVES IN THE DOORWAYS ───────────────────────────────────────────
//
// Josh: *"the crush to black is too hard ... is there a way we can artificially do black
// at entrances, so you can see the room but not further, and then when you get close it
// lifts?"*
//
// This inverts where the darkness is kept. The depth crush hides DISTANCE — it has to be
// brutal, because it is the only thing stopping you seeing three rooms down a corridor,
// and it pays for that by crushing the room you are standing in too. A veil hides the
// THRESHOLD instead: your own space reads fully, and what you cannot see is specifically
// what is through the door. The crush stops doing load-bearing work and goes back to
// being atmosphere, which is the whole reason it can be relaxed.
//
// ── WHY IT IS CHEAP, AND WHY IT IS CHEAP NOW ────────────────────────────────
//
// A veil is one unlit quad in a doorway, a handful per floor. It is only possible to
// place one exactly because of the v3 link work: every opening is a DECLARED cut with an
// edge, a span, a height, a midpoint, an outward normal and the two spaces it joins. That
// is a quad, already computed. A week ago the doorway's position was recovered by
// intersecting a deliberately-overshooting rect with a polygon, and this would have
// inherited every error in that.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
//
// A veil lifts with PROXIMITY, not with entry. Standing in a room, its doorways are far,
// so they are opaque and you see the room and nothing beyond. Walk toward one and it
// thins — so leaning into a doorway to peek is an action with no button on it, and you
// are exposed while you do it. Step through, and the veil behind you re-forms as you walk
// away: from a dark corridor you cannot see back into a dark room, which is both true and
// the more frightening of the two options.
//
// Deliberately NOT keyed on the explored/visited state yet. Permanence — a room you have
// LIT stays open — is the natural next stage and it is the first piece that needs saved
// per-space state, so it should not ride along with the geometry.
//
// ── WHAT IT MUST NOT LOOK LIKE ──────────────────────────────────────────────
//
// A black card floating in a hole. Two things prevent that: the quad sits at the MIDDLE
// of the wall's thickness, so from an angle you read dark INSIDE the opening rather than
// a plane across it; and its alpha falls off at the rim, so it meets the jambs as shadow
// instead of as an edge. A 3.6m gallery opening is the case that tests both.
import * as THREE from 'three';
import { DEV } from '../debug/dev';
import { WALL_T } from '../level/poly-shell-plan';
import { veilKnobs } from '../debug/tuning-veil';
import { VEIL_ORDER, SIGNAL_ORDER } from './signal-layer';

interface Veil {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  /** World position of the opening's middle — what proximity is measured to. */
  x: number;
  z: number;
  y: number;
  /** The two spaces this threshold joins, and its current alpha. Read by the culler:
   *  a veil is a portal, and how open it is decides both what you can see through it
   *  and what is worth submitting behind it. */
  a: string;
  b: string;
  alpha: number;
  /** False until its first tick — see the snap in tickThresholdVeils. */
  warm: boolean;
}

const veils: Veil[] = [];
/** Keyed on the unordered pair, so the culler can ask about a doorway it knows only by
 *  the two rects it separates. */
const byPair = new Map<string, Veil>();
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
let veilTex: THREE.Texture | null = null;

/**
 * The falloff. Opaque through the middle, easing to nothing at the rim.
 *
 * RGB is black and only ALPHA varies, so the veil darkens what is behind it rather than
 * painting over it — at half strength you get a half-lit read of the next room, which is
 * the peek. A hard-edged quad would instead read as a shape, and the shape would be a
 * rectangle, which is the one thing a dungeon has none of.
 */
function veilTexture(): THREE.Texture {
  if (veilTex) return veilTex;
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // Distance to the nearest edge, 0 at the rim and 1 at the centre, per axis.
      const u = Math.min(i, N - 1 - i) / (N * 0.5);
      const v = Math.min(j, N - 1 - j) / (N * 0.5);
      // The SOFT band is a fraction of the half-extent, so a wide gallery opening and a
      // narrow squeeze fade over proportionally the same rim rather than the same metres.
      const soft = (t: number): number => {
        const s = Math.min(1, t / 0.22);
        return s * s * (3 - 2 * s);
      };
      const a = soft(u) * soft(v);
      const o = (j * N + i) * 4;
      img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 0;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  veilTex = tex;
  return tex;
}

/**
 * Hang a veil in one opening.
 *
 * `mid` and `normal` come straight off the portal — the inner wall line and the outward
 * face normal — so the quad is pushed half the wall's thickness outward to sit in the
 * middle of the masonry band. `rotY` is the portal's own, the same yaw a frame is mounted
 * with, which puts the plane's +Z through the opening.
 */
export function spawnThresholdVeil(scene: THREE.Object3D, o: {
  mid: readonly [number, number];
  normal: readonly [number, number];
  rotY: number;
  width: number;
  height: number;
  floorY: number;
  /** The two spaces it joins — the room's id and the corridor's. */
  a: string;
  b: string;
}): void {
  const { mid, normal, rotY, width, height, floorY } = o;
  const mat = new THREE.MeshBasicMaterial({
    map: veilTexture(),
    transparent: true,
    opacity: 0,
    // NO DEPTH WRITE. The veil darkens what is already drawn; writing depth would make it
    // occlude anything sorted after it, including the motes and the threshold haze that
    // are supposed to drift through the same doorway.
    depthWrite: false,
    side: THREE.DoubleSide,
    // The veil IS the darkness. Fogging it would fade the thing doing the fading.
    fog: false,
  });
  // OVERSIZED, slightly. The aperture is exactly `width` × `height`, and a quad cut to
  // exactly that leaves a hairline of un-veiled opening at the jambs where the falloff has
  // already reached zero. The rim fade means the extra is invisible.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.12, height * 1.08), mat);
  const x = mid[0] + normal[0] * (WALL_T / 2);
  const z = mid[1] + normal[1] * (WALL_T / 2);
  const y = floorY + height / 2;
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  // Below SIGNAL_ORDER, which is the whole point — see scene/signal-layer.ts.
  mesh.renderOrder = VEIL_ORDER;
  mesh.name = 'threshold-veil';
  scene.add(mesh);
  const veil: Veil = { mesh, mat, x, z, y, a: o.a, b: o.b, alpha: 0, warm: false };
  veils.push(veil);
  // Last one wins if two openings somehow share a pair; they cannot today, and a wrong
  // answer here fails toward MORE drawing, which is the safe direction.
  byPair.set(pairKey(o.a, o.b), veil);
}

/**
 * Lift each veil by how near the player is to it — and let it MOVE.
 *
 * ── DISTANCE SETS THE TARGET; THE DARK TAKES ITS OWN TIME GETTING THERE ──────
 *
 * Josh: *"can we make it so the big reveal of the veil isn't instant, but rather a
 * transition — the darkness giving way, you know, veiling and unveiling."*
 *
 * It used to be a pure function of position: alpha WAS smoothstep(distance), so the veil did
 * not open, it tracked. Two things gave that away. It jittered with head bob and strafing,
 * because a value bolted to the camera inherits every twitch of the camera. And walking at a
 * doorway threw it open at exactly your walking speed, which reads as a property of the
 * player rather than as anything the dungeon did.
 *
 * So distance sets a TARGET and the alpha eases toward it. The lag IS the effect: the dark
 * has to be pushed back, and it takes a moment to go.
 *
 * ASYMMETRIC, AND THE SLOW DIRECTION IS OPENING. It gives way reluctantly and takes the
 * ground back quickly — the same shape dark-adaptation already uses (four seconds to lift,
 * a tenth of one to re-blind you), and the same idea: the dungeon concedes slowly and
 * reclaims fast.
 *
 * On the REAL clock, so a veil cannot ease open in bullet-time and turn a deflect into a
 * lighting event.
 */
export function tickThresholdVeils(playerPos: THREE.Vector3, dt: number): void {
  if (!veils.length) return;
  const near = veilKnobs.liftNear();
  const far = veilKnobs.liftFar();
  const strength = veilKnobs.strength();
  const span = Math.max(0.01, far - near);
  const through = veilKnobs.signalThrough() > 0.5;
  const openTau = Math.max(0.001, veilKnobs.openTime());
  const closeTau = Math.max(0.001, veilKnobs.closeTime());
  for (const v of veils) {
    const dx = playerPos.x - v.x, dy = playerPos.y - v.y, dz = playerPos.z - v.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const t = Math.min(1, Math.max(0, (d - near) / span));
    const eased = t * t * (3 - 2 * t);
    const target = eased * strength;

    // A FALLING alpha is the veil opening (less dark); rising is it closing back in.
    const tau = target < v.alpha ? openTau : closeTau;
    // 1 - e^(-dt/tau) closes the same FRACTION of the remaining gap per unit time whatever
    // the frame rate. A plain lerp by a constant would open twice as fast at 120fps.
    const k = 1 - Math.exp(-Math.max(0, dt) / tau);
    // SNAP ON THE FIRST TICK. Easing up from the spawn value would fade every veil in from
    // clear at the start of a floor, which reads as the whole dungeon lighting up.
    const a = v.warm ? v.alpha + (target - v.alpha) * k : target;
    v.warm = true;
    v.alpha = a;
    v.mat.opacity = a;
    // Above the signal layer means the veil eats it too — the pre-split behaviour, kept as
    // a live A/B rather than as a memory of what it used to look like.
    v.mesh.renderOrder = through ? VEIL_ORDER : SIGNAL_ORDER + 5;
    // A fully-lifted veil is not drawn at all. A hundred transparent quads at alpha 0 are
    // a hundred draws that do nothing, and the ones you are standing among are exactly
    // the ones that are lifted.
    v.mesh.visible = a > 0.004;
  }
}

/**
 * How closed is the threshold between these two spaces, 0..1?
 *
 * ── THIS IS THE CULLER'S QUESTION TOO ───────────────────────────────────────
 *
 * A veil is a portal, and how open it is decides two things at once: what the player can
 * see through it, and what is worth submitting behind it. Those were separate notions of
 * visibility before — the fog wall for the eye, `cullDist2 = sightFar²` for the culler,
 * kept in lockstep by hand — which is exactly why the darkness could not be relaxed
 * without doubling the draw count.
 *
 * FAILS OPEN. An unknown pair returns 0, meaning wide open, so anything this does not know
 * about is drawn. A veil that is missing should cost frames, never geometry.
 */
export function veilAlphaBetween(a: string, b: string): number {
  return byPair.get(pairKey(a, b))?.alpha ?? 0;
}

// Which thresholds exist and how closed each one is. The gate rule is built entirely on
// this map, and a pair it does not contain fails open — so a keying mismatch here reads as
// "the whole floor is one open space" with nothing anywhere reporting an error.
//
// `warm` is the load-bearing field: it flips on a veil's first tick, so warm 0 means the
// tick has never run. That is how I found that this system sits in the 'unpaused' phase and
// therefore does not run in a POSED SCENARIO — every gate measurement I took in one was
// against veils that had never opened or closed, which is to say against no veils at all.
if (DEV && typeof window !== 'undefined') {
  (window as unknown as { __veils?: unknown }).__veils = () => ({
    veils: veils.length,
    pairs: byPair.size,
    warm: veils.filter((v) => v.warm).length,
    rows: [...byPair.entries()].map(([k, v]) => ({ pair: k, alpha: +v.alpha.toFixed(3) })),
  });
}

/** Drop every veil — called on level load, like the drafts. */
export function clearThresholdVeils(): void {
  for (const v of veils) {
    v.mesh.removeFromParent();
    v.mesh.geometry.dispose();
    v.mat.dispose();
  }
  veils.length = 0;
  byPair.clear();
}

/** How many are hanging, for a debug readout. */
export function thresholdVeilCount(): number { return veils.length; }
