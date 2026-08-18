// ── TWO LAYERS OF SIGHT ──────────────────────────────────────────────────────
//
// Josh found this by accident, looking through a veiled doorway: the room was gone and a
// torch flame was still there, flickering in the black. *"What if we gate rendering of
// things besides things like glowing monster eyes and other such markers?"*
//
// It works because a veil is a MULTIPLY, not an occluder — alpha blend, no depth write —
// so at 92% it passes 8% of everything behind it. Dim diffuse stone at 8% is black. A
// bright additive flame at 8% is still a flame. The channel split was already happening;
// it was just happening by accident, at whatever ratio the alpha landed on.
//
// This makes it deliberate:
//
//   THE LIT LAYER    stone, form, props — what you fight and navigate by. Drawn BEFORE
//                    the veil, so the veil multiplies it toward nothing.
//   THE SIGNAL LAYER flames, eyes, runes, glints, sigils — drawn AFTER the veil, at full
//                    strength, untouched.
//
// So darkness stops being an absence of information and becomes a CHANGE OF CHANNEL. You
// do not see less through a veiled doorway; you see the signal constellation instead of
// the room — three pairs of eyes, one flame, a glint in the corner. You can count what is
// in there without seeing it. That is a read the light could never give you, and it is
// what stops the darkness costing the player visual clarity: they never lose information
// they need, they lose FORM and keep SIGNAL.
//
// ── DEPTH STILL OCCLUDES ────────────────────────────────────────────────────
//
// Drawing after the veil does not mean drawing through walls. Signal materials keep
// `depthTest`, and the veil never writes depth — so a flame seen through a DOORWAY passes
// the test (there is no geometry in a hole) while a flame behind a WALL fails it. The veil
// decides brightness; the wall still decides visibility. Anything marked here that also
// disables depth testing would genuinely draw through stone, which is why marking is a
// deliberate call and not a material sniff.
//
// ── WHY MARKED AND NOT DETECTED ─────────────────────────────────────────────
//
// The tempting shortcut is "additive blending means signal". It is wrong twice: a blood
// burst and a blade trail are additive and are emphatically not navigation markers, and a
// carved sigil that reads by its own emissive is signal without being additive. What
// belongs in this layer is an authoring decision about what the dungeon is willing to tell
// you through the dark, so it is declared at the producer.
import * as THREE from 'three';
import { portalDepthOf, spaceIdAt } from '../level/room-culling';
import { signalKnobs } from '../debug/tuning-signal';
import { DEV } from '../debug/dev';

/** Reused per test — this runs over every marker, every frame. */
const scratch = new THREE.Vector3();

/**
 * Draw order. The veil sits at VEIL_ORDER; anything above it composites on top and is
 * therefore not multiplied by it.
 *
 * Both are in the transparent bucket, where three sorts by renderOrder first and distance
 * second — so this is an ordering guarantee and not a depth trick.
 */
export const VEIL_ORDER = 3;
export const SIGNAL_ORDER = 12;

/**
 * Declare an object part of the SIGNAL layer: it punches through veils at full strength.
 *
 * Applies to the whole subtree, because a flame stack or a rune decal is usually a small
 * group rather than one mesh, and half a marker coming through a doorway is worse than
 * none.
 */
export function markAsSignal(root: THREE.Object3D): void {
  signalDrawOrder(root);
  // Tracked at the ROOT only. Occlusion is a question about a PLACE, and every mesh in one
  // marker is in the same place — testing each would be the same answer several times.
  track(root);
}

/**
 * Draw order only — for a signal surface that has no place of its own.
 *
 * The sprite batch is the case: one global mesh at the origin holding every flame on the
 * floor as instances. It needs to composite after the veil like any marker, but it must NOT
 * be occlusion-tested, because the answer would be about the world origin and would hide or
 * show every flame in the dungeon together. Its instances are gated individually through
 * their placeholders, which DO have places.
 */
export function signalDrawOrder(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.renderOrder = SIGNAL_ORDER;
    o.userData.signal = true;
  });
}

/** Is this object in the signal layer? Read by the culler: a space below the visibility
 *  floor keeps its signal and drops everything else. */
export function isSignal(o: THREE.Object3D): boolean {
  return o.userData?.signal === true;
}

// ── SIGNAL SUPPLIES ITS OWN OCCLUSION ────────────────────────────────────────
//
// Josh, once the transmittance cull landed: *"since the room is culled I can see flames I
// shouldn't be able to see ... otherwise the flame vanishes the moment the room is rendered
// behind the veil when I approach."*
//
// Both halves are the same fact. A marker draws AFTER the veil, so it is not sorted against
// the world — its only occluder is whatever happens to be in the DEPTH BUFFER. Culling is
// what fills that buffer, so tightening the cull (3.0 spaces where it used to submit 5.0)
// deleted the very walls the signal layer was relying on to hide behind. The flame
// reappearing when you approach is the occluder being submitted again.
//
// So the invariant is stated where it belongs: ANYTHING THAT RENDERS AFTER THE VEIL HAS
// OPTED OUT OF THE DEPTH-SORTED WORLD AND MUST SUPPLY ITS OWN OCCLUSION. Not a special case
// for flames, and not something the culler can be asked to fix by drawing more — a signal
// gated on what the culler happens to keep would go back to changing as you walked.
//
// Line of sight against the level's own walls, the same `walkable.hasLineOfSight` the light
// pool has always used to keep a torch from lighting through a wall. It is the right
// question ("can the player see this point"), it is independent of what is drawn, and it
// costs about sixty segment tests a frame next to the pool's twenty-odd.
type LOS = (ax: number, az: number, bx: number, bz: number,
            opts?: { includeObstacles?: boolean }) => boolean;

interface Marker {
  o: THREE.Object3D;
  /** The space it stands in. Resolved once and kept — markers do not move. */
  space: string | null;
  resolved: boolean;
  /** Last frame's verdict, for the DEV probe. '' = shown. */
  why: string;
  gates: number;
}

const registry: Marker[] = [];
let lastEyeX = 0, lastEyeZ = 0;
let lastLos: LOS | undefined;

/** Everything marked, so the occlusion pass does not have to walk the scene. */
function track(o: THREE.Object3D): void {
  if (registry.some((m) => m.o === o)) return;
  registry.push({ o, space: null, resolved: false, why: '', gates: 0 });
}

/**
 * How far short of a marker the sight test stops.
 *
 * ── A SCONCE IS ON THE WALL, AND THE WALL IS THE OCCLUDER ────────────────────
 *
 * Josh: *"the embers are properly culled, but also when I am actually in the room with the
 * flames."* Standing in front of a torch, gates is 0 and the fire is right there — and the
 * sight test still said no, because a torch is a WALL SCONCE. Its position sits on the wall
 * plane, so the segment from the eye to it crosses the very wall it is mounted on, and
 * `includeObstacles` adds its own bracket on top. Every marker in the game is fixed to
 * something, so this was never about torches.
 *
 * Stopping a hand's breadth short puts the endpoint in open air in front of the mount. A
 * wall genuinely BETWEEN you and the fire is still crossed, and crossed long before the last
 * 35cm, so nothing that should be hidden is let through.
 *
 * Clamped to half the distance so walking right up to a marker cannot push the endpoint
 * behind the eye and invert the test.
 */
const MOUNT_CLEARANCE = 0.35;

/** Can the eye reach this point, ignoring whatever the marker itself is bolted to? */
function seeable(x: number, z: number): boolean {
  if (!lastLos) return true;
  const dx = x - lastEyeX, dz = z - lastEyeZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return true;
  const back = Math.min(MOUNT_CLEARANCE, d * 0.5);
  return lastLos(lastEyeX, lastEyeZ, x - (dx / d) * back, z - (dz / d) * back,
                 { includeObstacles: true });
}

/**
 * Hide every signal marker the player cannot actually see.
 *
 * Runs before the sprite batch folds its instances, so a hidden placeholder is a hidden
 * flame in the same frame — the batch already reads placeholder visibility up the parent
 * chain, so this composes with the room culler rather than fighting it.
 *
 * With no LOS available (the vault path, a level mid-load) everything stays visible: a
 * missing occluder should cost a wrong-looking flame, never a missing one, because the
 * marker is the thing the player is navigating by.
 */
export function tickSignalOcclusion(eyeX: number, eyeZ: number, los: LOS | undefined): void {
  // Kept so anything that EMITS signal can ask the same question without being handed the
  // camera and the level — see canSeeSignalAt.
  lastEyeX = eyeX; lastEyeZ = eyeZ; lastLos = los;
  if (!los) return;
  const maxGates = signalKnobs.gates();
  for (const m of registry) {
    if (!m.o.parent) continue;                    // torn down; the batch drops it anyway
    m.o.getWorldPosition(scratch);
    if (!m.resolved) {
      m.space = spaceIdAt(scratch.x, scratch.z);
      // ONLY LATCH ON AN ANSWER. The culler publishes its node map on its first tick, and a
      // marker built before that would resolve to null — then, latched, be treated as "in
      // your own space" and never gate again. Retrying until it answers costs one lookup
      // per marker for the first frame or two of a floor.
      m.resolved = m.space !== null;
    }

    // ── HOW MANY GATES DEEP ──────────────────────────────────────────────────
    //
    // Josh: *"flames only visible if it's gated by one gate and not more — so you can't see
    // it across a room and a corridor, but you have to break the corridor's seal."*
    //
    // Line of sight alone cannot say this. Two doorways can line up perfectly, so the
    // segment from your eye to a fire two spaces away is geometrically clear and it draws —
    // and reading a room you have not committed to reaching is the thing the veil exists to
    // prevent. GATES are the unit the player feels: the corridor is one, the room past it is
    // two, and stepping into the corridor is what breaks the next seal.
    //
    // An unresolved marker counts as being in your own space, which fails toward visible.
    const gates = m.space ? portalDepthOf(m.space) : 0;
    m.gates = gates;
    if (gates > maxGates) { m.why = 'gates'; m.o.visible = false; continue; }

    // ...and it still has to be SEEN — stopping short of whatever it is mounted on, see
    // MOUNT_CLEARANCE.
    const lit = seeable(scratch.x, scratch.z);
    m.why = lit ? '' : 'los';
    m.o.visible = lit;
  }
}

/**
 * Can the player see a signal at this point, by the same rule the markers use?
 *
 * For EMITTERS rather than objects. An ember cloud is one GPU draw whose whole trajectory
 * is a function of time and index, so there is no per-particle object to hide — but there
 * IS a short list of torches feeding it, and asking about those is 16 tests instead of 800.
 *
 * Uses the eye and the LOS from the last occlusion tick, so a caller anywhere in the frame
 * gets the same answer the markers got. Fails VISIBLE when there is no LOS yet, for the same
 * reason the markers do.
 */
export function canSeeSignalAt(x: number, z: number): boolean {
  if (!lastLos) return true;
  const space = spaceIdAt(x, z);
  const gates = space ? portalDepthOf(space) : 0;
  if (gates > signalKnobs.gates()) return false;
  return seeable(x, z);
}

/** Drop the registry — called on level load. */
export function clearSignals(): void { registry.length = 0; }

// ── THE PROBE ────────────────────────────────────────────────────────────────
//
// `window.__signal()` — every marker, where it is, which space it resolved to, how many
// gates that is, and which test hid it. Three plausible causes for "the flames are occluded
// and I can see them" were each right about something and wrong about the whole, and every
// round trip cost Josh a walk to a torch. This answers it in one line instead.
if (DEV && typeof window !== 'undefined') {
  (window as unknown as { __signal?: unknown }).__signal = () => {
    const rows = registry.map((m) => {
      m.o.getWorldPosition(scratch);
      return {
        name: m.o.name || m.o.type,
        at: `${scratch.x.toFixed(1)},${scratch.z.toFixed(1)}`,
        space: m.space ?? '(none)',
        gates: m.gates,
        hiddenBy: m.why || '—',
        visible: m.o.visible,
        parented: !!m.o.parent,
      };
    });
    const by = (k: string) => rows.filter((r) => r.hiddenBy === k).length;
    // eslint-disable-next-line no-console
    console.log(`${rows.length} markers · shown ${rows.filter((r) => r.visible).length}`
      + ` · hidden by gates ${by('gates')} · by line of sight ${by('los')}`
      + ` · eye ${lastEyeX.toFixed(1)},${lastEyeZ.toFixed(1)} · gate limit ${signalKnobs.gates()}`);
    // eslint-disable-next-line no-console
    console.table(rows);
    return rows;
  };
}

/** How many markers are tracked, for a debug readout. */
export function signalCount(): number { return registry.length; }
