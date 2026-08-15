import * as THREE from 'three';
import { freezeTransform, isDrawn } from './animation-gate';
import { disposeGpu } from './gpu-dispose';
import { isPooledGeometry, pooledCircle, pooledPlane, pooledSphere, pooledTorus } from './geometry-pool';
import { stdMat } from '../style/material-registry';

// ARCHWAY EYE — the diegetic exit cue, as the dungeon's own eye set in the
// keystone. A dark stone eyeball + a glowing iris + two stone lids, mounted at
// the frame model's keystone slots (see level/frame.ts). The nav system feeds it
// an open TARGET (open on the near entrance toward unexplored ground; closed once
// that branch is spent) and the player's position; the eye owns the rest of its
// life — easing open/shut, a faint flicker, an occasional blink, and TRACKING
// the player so the gaze follows you across the room. The living dungeon watches.

const EYE_W = 0.26;          // base eyeball width (almond)
const EYE_SCALE = 0.95;      // overall model size multiplier (the whole eye)

// The gaze colour — an UNCOMMON cool-pale light in the warm torchlit dark, so it
// reads as something OTHER, watching (and pops against the warm scene). Tune
// here: warm amber 0xffc060 / sickly green 0x9affc0 / blood 0xff5a4a /
// moonlight 0xbfe0ff. Core is the bright centre; glow is the halo spill.
const GAZE_CORE = 0xfff4ec;  // near-white, faint cool cast — the bright pupil-light
const GAZE_GLOW = 0xffcf8a;  // pale gold halo

const LID_PART = 0.085;      // how far each lid retracts when fully open
// The eye sits high on the keystone (~2.7m) and the player looks UP at it from
// ~1.6m, so a horizontal gaze buries it behind the lower lid. Pitch the whole
// eye down toward the floor so it faces the player below; the gaze-tracking then
// adjusts from this rest. ~32° reads face-on from a few metres back.
const REST_PITCH = 0.55;     // rad — downward tilt of the resting gaze
const KINDLE_RATE = 4;       // open / close ease speed
const MAX_GAZE = 0.5;        // rad — how far the eyeball turns to follow the player
const GAZE_RATE = 5;         // eyeball-turn ease speed
const BLINK_PERIOD = 5.5;    // seconds between blinks (per-eye phase offset)
const BLINK_FRAC = 0.03;     // fraction of the period a wink lasts (~0.16s)

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

// ── THE STONE OF EVERY EYE ON THE FLOOR, IN THREE OBJECTS ────────────────────
//
// A phone capture (2026-08-15) settled what a scene actually costs here, and it
// is not what the plan assumed. Frame CPU correlated with GPU UPLOADS at r≈0.75
// and with DRAW COUNT at r≈0.0 — one recording carried twice the draws of the
// other at slightly lower CPU. 848 of 900 sampled uploads were `updateBinding →
// writeBuffer`: a uniform write per RENDER OBJECT. So the currency is render
// objects, and render bundles explain the gap — bundling removes draw calls but
// not the binding update behind each one.
//
// The archway eye was 70 of the floor's 218 meshes, seven render objects per
// eye. Its four opaque parts are the same two materials and four shapes on every
// keystone, differing only by transform — the textbook case for instancing, and
// under this cost model an InstancedMesh is ONE render object no matter how many
// eyes it carries.
//
// The transparent three (halo, iris, pupil) stay loose deliberately: each
// animates its own opacity per eye, and per-instance opacity is not a thing an
// InstancedMesh does without emulating it through instanceColor (fine for the
// two additive ones, wrong for the normal-blended pupil). That is a second step
// with its own visual risk, and this one is meant to be provably identical.
const MAX_POOLED_EYES = 64;

interface EyePool {
  root: THREE.Object3D;          // the level root these eyes belong to
  group: THREE.Group;
  socket: THREE.InstancedMesh;
  ball: THREE.InstancedMesh;
  lids: THREE.InstancedMesh;     // two per eye, at 2i and 2i+1
  count: number;
}
let pool: EyePool | null = null;

/** Collapsed to nothing — how an instance is "hidden". An InstancedMesh has one
 *  visibility flag for the whole batch, so a culled eye zeroes its transform
 *  instead; the vertex shader still runs but the triangles are degenerate. */
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _mb = new THREE.Matrix4();

function ensurePool(root: THREE.Object3D, stone: THREE.Material, lidStone: THREE.Material): EyePool {
  if (pool && pool.root === root) return pool;
  // A new floor: the old pool belongs to a level that is being torn down.
  if (pool) disposeEyePool();
  const group = new THREE.Group();
  group.name = 'archway-eye-pool';
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.count = 0;                       // grows as eyes register
    im.frustumCulled = false;           // its instances span the floor; three objects, always submit
    im.userData.dynamicPart = true;     // never sweep an animated batch into a static one
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(im);
    return im;
  };
  pool = {
    root, group,
    socket: mk(pooledTorus(EYE_W * 0.62, EYE_W * 0.16, 8, 20), stone, MAX_POOLED_EYES),
    ball: mk(pooledSphere(EYE_W * 0.5, 16, 12), stone, MAX_POOLED_EYES),
    lids: mk(pooledSphere(EYE_W * 0.56, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lidStone, MAX_POOLED_EYES * 2),
    count: 0,
  };
  root.add(group);
  return pool;
}

/** Drop the shared batch. Called when a floor's eyes are torn down. */
export function disposeEyePool(): void {
  if (!pool) return;
  pool.group.parent?.remove(pool.group);
  // Geometry is pooled and the materials are registry-shared — neither is ours
  // to free (see the eye's own dispose). The InstancedMeshes are.
  disposeGpu(pool.socket, pool.ball, pool.lids);
  pool = null;
}

// Scratch — reused across all eyes each frame (single-threaded, synchronous).
const _toPlayer = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, 1);
const _axis = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();

export interface ArchwayEye {
  group: THREE.Group;
  /** Per-frame life: ease toward `openTarget` (0..1), flicker, blink, and turn
   *  the gaze to track the player. Driven by the nav tick (threshold-draft). */
  update(dt: number, openTarget: number, player: { x: number; y: number; z: number }): void;
  dispose(): void;
}

/**
 * Build an eye and mount it in `root` — the LEVEL ROOT, deliberately, and not
 * the frame group it visually belongs to.
 *
 * Parenting it into the frame is the obvious move and it is wrong. The eye's
 * parts are opaque MeshStandardMaterial, and the static batcher walks each
 * level-root child's whole subtree; inside the frame they land in the sweep,
 * and although each carries the `dynamicPart` opt-out, this is precisely the
 * arrangement that produced the original "the navigation eyes are always
 * closed" bug — measured again 2026-08-15 when it was tried: the opaque parts
 * (socket, ball, both lids) vanished from the eye and only the transparent
 * halo/iris/pupil survived, because transparency is a second, independent
 * reason to skip. An eye with no lids cannot open. Staying a root child keeps
 * the feature out of that whole class of interaction.
 *
 * The cost of staying at the root is that the culler's assignment loop has no
 * rule that matches a bare Group, so the eyes were never toggled at all — all
 * fourteen drawn every frame in every room. `dbgKind: 'archway-eye'` plus the
 * frame's own placement stamped below gives the culler what it needs to treat
 * the eye as a BOUNDARY object, visible while either adjoining room is, which
 * is the same exemption the doorway stone already gets and for the same reason:
 * cull an archway by its own centre and it disappears while you are looking
 * straight at it from the other side.
 */
export function buildArchwayEye(root: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion): ArchwayEye {
  const group = new THREE.Group();
  // Placed at the frame model's eye slot (world transform). The eye is authored
  // facing +Z; the slot's orientation aims it out of the keystone, then we pitch
  // it down (local +X) so it looks toward the player standing below.
  group.position.copy(pos);
  group.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), REST_PITCH));
  group.scale.setScalar(EYE_SCALE);

  // The eye never moves — cache its world placement once for the gaze math
  // (invQuat is the FULL tilted orientation, so tracking adjusts from the rest).
  const eyeWorld = pos.clone();
  const invQuat = group.quaternion.clone().invert();
  // Stagger blinks so a row of eyes doesn't wink in unison.
  const blinkOffset = ((pos.x * 1.73 + pos.z * 0.91) % BLINK_PERIOD + BLINK_PERIOD) % BLINK_PERIOD;

  // THE STONE IS THE SAME STONE IN EVERY EYE. Both of these were minted per
  // eye, so a floor carried 32 identical MeshStandardMaterials — 32 sets of
  // uniforms and bind groups expressing one surface. They are never animated
  // per eye (only the halo/iris/pupil below are), so they belong in the shared
  // pool, which is also the authority this repo enforces by ratchet test
  // (tests/material-authority.test.ts). NOTHING MAY DISPOSE THESE — see dispose.
  const stone = stdMat({ color: 0x17140f, roughness: 1, metalness: 0, flatShading: true, fog: true });
  const lidStone = stdMat({ color: 0x1d1913, roughness: 1, metalness: 0, flatShading: true, fog: true });

  // Socket ring — a carved rim so the eye reads as SET INTO the stone (fixed).
  // A TRANSFORM HOLDER, not a mesh: the geometry lives in the shared batch, and
  // this only exists to say where this eye's copy of it sits. Same for the ball
  // and the two lids below.
  const socket = new THREE.Object3D();
  socket.scale.set(1.15, 0.8, 0.5);
  socket.position.z = -0.02;

  // Glow halo — soft additive disc so the open eye reads as LIGHT spilling out
  // (fixed; the gaze moves over it).
  const haloMat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: GAZE_GLOW, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const halo = new THREE.Mesh(pooledPlane(EYE_W * 1.5, EYE_W * 1.1), haloMat);
  halo.position.z = EYE_W * 0.16;
  group.add(halo);

  // GAZE PIVOT — the eyeball + iris + pupil ride this; rotating it turns the eye
  // to look at the player. The socket, halo, and lids stay put.
  const gaze = new THREE.Group();
  group.add(gaze);

  // Eyeball — flattened almond, recessed slightly into the keystone. Batched, so
  // this holder rides the gaze pivot's transform without being in the graph.
  const ball = new THREE.Object3D();
  ball.scale.set(1.2, 0.82, 0.6);
  ball.position.z = -0.05;

  // Iris — the bright gaze. ADDITIVE so it reads as light, not a tinted surface.
  const irisMat = new THREE.MeshBasicMaterial({
    color: GAZE_CORE, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const iris = new THREE.Mesh(pooledCircle(EYE_W * 0.3, 20), irisMat);
  iris.position.z = EYE_W * 0.2;
  gaze.add(iris);

  // Pupil — a dark round centre over the glow so it reads as an EYE, not a gem.
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x080406, transparent: true, opacity: 0, fog: true });
  const pupil = new THREE.Mesh(pooledCircle(EYE_W * 0.13, 16), pupilMat);
  pupil.position.z = EYE_W * 0.22;
  gaze.add(pupil);

  // Lids — upper + lower stone covers, IN FRONT of the iris so closing them
  // covers the gaze (a real wink). Open → they retract up/down; closed → meet.
  const mkLid = (): THREE.Object3D => {
    const lid = new THREE.Object3D();
    lid.scale.set(1.18, 0.62, 0.66);
    lid.position.z = EYE_W * 0.24;
    return lid;
  };
  const lidTop = mkLid();
  const lidBot = mkLid();
  lidBot.rotation.z = Math.PI;        // flip to cover the bottom

  // THE EYE IS ANIMATED — KEEP IT OUT OF THE STATIC BATCH.
  //
  // The eye is mounted on the archway keystone, so it lives inside the level
  // root, and the static batcher sweeps that root for "opaque, non-animated"
  // meshes. Nothing here matched an exclusion: it isn't an interactable, a
  // torch, an enemy, a door, transparent, or named 'flame'. So every part of it
  // was baked into `static-batch-world` and the source meshes stopped existing
  // as drawables — measured, on real floors: ZERO lid meshes left in the scene.
  //
  // Which means `update()` has been writing `lidTop.position.y` to something
  // nobody draws. The lids never move, so the eyes are permanently shut and the
  // whole navigation-eye feature is invisible. (Reported from the phone: "the
  // navigation eyes are always closed ... maybe after batching." It was.)
  //
  // `dynamicPart` is the existing opt-out both batchers honour (static-batch.ts
  // and merge-static.ts each check it per MESH, not per group — hence the
  // traverse). The cost is a handful of loose meshes per eye; the alternative is
  // a feature that cannot render.
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.userData.dynamicPart = true; });

  // Claim the population. These meshes were a large slice of the draw report's
  // anonymous `untagged` count, which is the ratchet that tells us how much of
  // the scene nothing accounts for — and an unnamed group is also unfindable
  // from a debug console when you are trying to answer "what ARE these 98
  // meshes".
  group.name = 'archway-eye';
  group.userData.dbgKind = 'archway-eye';

  root.add(group);

  // NOTHING HERE RECOMPOSES A MATRIX IT DID NOT CHANGE.
  //
  // Exactly three parts of an eye ever move: the two lids retract and the gaze
  // pivot turns. The other six objects are nailed to the keystone at build
  // time — and yet Three's default would rebuild all nine local matrices every
  // frame, for every eye on the floor, forever. Sixteen eyes is 144 pointless
  // matrix composes a frame before the player has done anything.
  //
  // So the eye owns its matrices: they compose once here, and update()
  // recomposes only what it just wrote (see freezeTransform's footgun note —
  // moving a frozen object without recomposing it does nothing at all).
  // Together with the visibility gate this makes an unseen eye free: it does
  // not update, so it does not recompose, so it costs only being walked.
  freezeTransform(group, socket, halo, gaze, ball, iris, pupil, lidTop, lidBot);

  // Register this eye's stone in the floor's shared batch and place the parts
  // that never move. `group` is a direct child of `root`, and so is the pool, so
  // a part's transform in pool space is simply group.matrix x part.matrix — no
  // world matrices, no dependence on when the graph was last updated.
  const p = ensurePool(root, stone, lidStone);
  const slot = p.count < MAX_POOLED_EYES ? p.count++ : -1;
  if (slot < 0 && import.meta.env.DEV) {
    // A floor with more keystones than the batch holds would silently lose its
    // stone — eyes rendered as a floating iris. Sixty-four is far past the ~18 a
    // real floor builds, so this firing means the assumption changed.
    // eslint-disable-next-line no-console
    console.warn(`[archway-eye] pool full at ${MAX_POOLED_EYES}; this eye has no stone`);
  }
  if (slot >= 0) {
    p.socket.count = p.count;
    p.ball.count = p.count;
    p.lids.count = p.count * 2;
    p.socket.setMatrixAt(slot, _m.multiplyMatrices(group.matrix, socket.matrix));
    p.socket.instanceMatrix.needsUpdate = true;
  }
  /** Write this eye's moving stone into the batch. Cheap: three matrix
   *  multiplies, and the batch uploads once for all eyes rather than once per
   *  mesh per eye. */
  const writeInstances = (): void => {
    if (slot < 0 || !pool || pool.root !== root) return;
    pool.ball.setMatrixAt(slot, _m.multiplyMatrices(group.matrix, _mb.multiplyMatrices(gaze.matrix, ball.matrix)));
    pool.lids.setMatrixAt(slot * 2, _m.multiplyMatrices(group.matrix, lidTop.matrix));
    pool.lids.setMatrixAt(slot * 2 + 1, _m.multiplyMatrices(group.matrix, lidBot.matrix));
    pool.ball.instanceMatrix.needsUpdate = true;
    pool.lids.instanceMatrix.needsUpdate = true;
  };
  /** Fold this eye's stone away while it is culled. One write on the transition,
   *  not per frame — a hidden eye must cost nothing, which is the whole point. */
  const collapseInstances = (): void => {
    if (slot < 0 || !pool || pool.root !== root) return;
    pool.socket.setMatrixAt(slot, _ZERO);
    pool.ball.setMatrixAt(slot, _ZERO);
    pool.lids.setMatrixAt(slot * 2, _ZERO);
    pool.lids.setMatrixAt(slot * 2 + 1, _ZERO);
    pool.socket.instanceMatrix.needsUpdate = true;
    pool.ball.instanceMatrix.needsUpdate = true;
    pool.lids.instanceMatrix.needsUpdate = true;
  };
  const restoreSocket = (): void => {
    if (slot < 0 || !pool || pool.root !== root) return;
    pool.socket.setMatrixAt(slot, _m.multiplyMatrices(group.matrix, socket.matrix));
    pool.socket.instanceMatrix.needsUpdate = true;
  };
  let wasDrawn = true;

  let lit = 0;   // eased open amount
  let t = 0;     // life clock (flicker + blink)

  const update = (dt: number, openTarget: number, player: { x: number; y: number; z: number }): void => {
    // OFF-SCREEN EYES DO NOT ANIMATE (scene/animation-gate.ts), and now they do
    // not occupy the batch either. The gate lives here rather than in the caller
    // because the eye is what owns the instance slot, so it is what has to fold
    // it away — once, on the transition.
    if (!isDrawn(group)) {
      if (wasDrawn) { wasDrawn = false; collapseInstances(); }
      return;
    }
    if (!wasDrawn) { wasDrawn = true; restoreSocket(); }
    t += dt;
    lit += (Math.min(1, Math.max(0, openTarget)) - lit) * Math.min(1, dt * KINDLE_RATE);

    // Blink — a quick wink: lids dip + gaze dims for a fraction of the period.
    const ph = ((t + blinkOffset) / BLINK_PERIOD) % 1;
    const blink = ph < BLINK_FRAC ? 1 - Math.sin((ph / BLINK_FRAC) * Math.PI) * 0.92 : 1;
    const flicker = 0.9 + 0.1 * Math.sin(t * 2.3);
    const shown = lit * blink;

    irisMat.opacity = shown * flicker;
    haloMat.opacity = 0.8 * shown * flicker;
    pupilMat.opacity = shown;
    lidTop.position.y = LID_PART * shown;
    lidBot.position.y = -LID_PART * shown;
    lidTop.updateMatrix();   // frozen transforms — the writer recomposes
    lidBot.updateMatrix();

    // Track the player — turn the gaze toward them while the eye is open enough
    // to see; otherwise ease back to centre. Clamped to a cone so it never turns
    // past the socket.
    const track = lit > 0.15;
    _toPlayer.set(player.x - eyeWorld.x, player.y - eyeWorld.y, player.z - eyeWorld.z);
    if (track && _toPlayer.lengthSq() > 1e-6) {
      _toPlayer.normalize().applyQuaternion(invQuat);   // player dir in eye-local space
      _axis.crossVectors(_fwd, _toPlayer);
      if (_axis.lengthSq() > 1e-8) {
        _axis.normalize();
        _targetQuat.setFromAxisAngle(_axis, Math.min(_fwd.angleTo(_toPlayer), MAX_GAZE));
      } else _targetQuat.identity();
    } else _targetQuat.identity();
    gaze.quaternion.slerp(_targetQuat, Math.min(1, dt * GAZE_RATE));
    gaze.updateMatrix();
    writeInstances();
  };
  update(0, 0, eyeWorld);   // spawn closed, gaze centred

  const dispose = (): void => {
    group.parent?.remove(group);
    // FREE ONLY WHAT THIS EYE OWNS. The geometry is pooled and the stone
    // materials are shared through the registry, so both outlive this eye and
    // belong to every other one on the floor — disposing them here would blank
    // the archways that are still standing. Only the three animated materials
    // are per-eye. (Deferred, because a teardown can land while the frame that
    // last drew this eye is still in flight — see scene/gpu-dispose.ts.)
    const owned: THREE.BufferGeometry[] = [];
    group.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g && !isPooledGeometry(g)) owned.push(g);
    });
    disposeGpu(haloMat, irisMat, pupilMat, ...owned);
  };

  return { group, update, dispose };
}
