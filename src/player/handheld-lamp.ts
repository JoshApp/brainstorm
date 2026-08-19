import * as THREE from 'three';
import { boneArmsWanted } from '../debug/bone-hand';
import { buildLantern, preloadLantern, onLanternLoaded, lanternBodyCentreY }
  from '../debug/bone-lantern';
import { disposeGpu, disposeGpuTree } from '../scene/gpu-dispose';

// Worn hip lantern — a small lantern model parented to the player
// camera, hanging LOW at the hip (not in a hand). Holds a warm
// flickering PointLight inside its cage so the lamp visibly is the
// source of the light.
//
// This is the player's BASELINE light (CLAUDE.md "Lighting as signal":
// "The player's lamp is the BASELINE everywhere"). It is baked into the
// player permanently — attached once at startup, never detached — so
// the immediate surroundings are always lit and the OFFHAND slot is
// free for shields/foci. It sits at the hip rather than the off-hand so
// it never competes with a held shield (the old position overlapped the
// offhand viewmodel almost exactly).
//
// Scene-graph shape (matters for the pendulum):
//
//   camera
//     └ hinge      ← positioned at the lantern's HANDLE.
//                    rotation.z is the pendulum angle.
//        └ body    ← offset DOWN from hinge by ~the cage height
//                    so the lantern visibly hangs below the pivot.
//                    All cage + flame meshes live here.
//
// When the hinge rotates, the body swings around the handle in a real
// pendulum arc — no manual parametric-arc math needed in the tick.

import { CONFIG } from '../config';
import { darkKnobs } from '../debug/tuning-dark';
import { registerLight, unregisterLight, type LightSource } from '../scene/light-pool';
import { registerViewmodel, unregisterViewmodel, applyViewmodelDepthWebGPU } from '../style/render-frame';
import { mergeRigidViewmodel } from './viewmodel-merge';
import { getLanternSwing, getBobOffset } from './viewmodel-bob';
import { getLampSway, getWeaponSway } from './viewmodel-sway';
import { getViewmodelPullback, getViewmodelPullbackFrac } from './viewmodel-pullback';
import { getTexture } from '../style/procedural-textures';

interface FlameSprite {
  sprite: THREE.Sprite;
  baseW: number;
  baseH: number;
  baseY: number;
  speed: number;
  scaleAmp: number;
  bobAmp: number;
  phase: number;
}

interface LampState {
  /** World position vector — mutated each frame from the lantern body's
   *  scene-graph transform. Same vector the light pool reads. */
  worldPos: THREE.Vector3;
  /** Hinge group, child of the camera. Its rotation.z is the swing. */
  hinge: THREE.Group;
  /** Body group, child of hinge. Holds all visible geometry. */
  body: THREE.Group;
  /** Flame-stack sprites — bonfire-style but scaled to lantern size.
   *  Each sprite carries its own flicker schedule so the layers don't
   *  sync. Materials are shared via flameMats so the colour-tone tick
   *  only touches a small set. */
  flameSprites: FlameSprite[];
  flameMats: THREE.SpriteMaterial[];
  baseIntensity: number;
  /** Computed each frame by tickLamp; pool reads via getIntensity. */
  currentIntensity: number;
  flickerT: number;
  /** The off-hand grip target — an empty Object3D at the ring centre,
   *  inside the body group so it swings with the pendulum. lamp-arm.ts
   *  reads its world position each frame to drive the left arm's IK. */
  ringAnchor: THREE.Object3D;
}

let lamp: LampState | null = null;
/** The registered source, kept so its `distance` can be driven live. */
let lampSource: LightSource | null = null;

// HINGE position — where the pendulum's pivot sits. Two carry poses,
// swapped on equip (setLampStowed); tickLamp eases between them:
//   RAISED — the default. Up at the visible lower-LEFT of the frame so
//     the lantern is clearly on screen (it carries the player's light,
//     it should read). Used whenever the offhand is empty (the common
//     case — most runs have no shield yet).
//   STOWED — dropped to the hip when an offhand item (shield/focus) is
//     equipped, so the item takes the hand. The lamp's LIGHT is
//     unchanged; the lantern just slides down rather than vanishing, so
//     there's never a "light from nowhere" moment.
// The body offset below hangs the lantern visibly under whichever pivot.
//
// PRESENCE PASS (viewmodel v3) — this DELIBERATELY reverses the earlier
// trim-down. That pass pushed the lantern back (Z -0.60 → -0.78) and down
// (Y -0.11 → -0.26) to make it "a peripheral light source rather than
// dominating the lower-left corner." The brief changed: the lantern is the
// player's one carried light and it should read as a HELD OBJECT, so it comes
// back forward to the old Z and part-way back up.
//   Z  -0.78 → -0.60   restores the pre-trim depth; the lantern regains mass.
//   Y  -0.26 → -0.13   13cm up, and this is the number that actually mattered.
//                      The hinge is a PIVOT, not the lantern: the body hangs
//                      BODY_OFFSET_Y (-0.108) BELOW it and that offset scales
//                      with the hinge, so at 1.7 the body centre sits ~18cm
//                      under the hinge. -0.24 and -0.20 both still cropped the
//                      body on the bottom edge — the hinge has to ride high
//                      for the lantern to sit low-and-visible. Lands the body
//                      near the old pre-trim -0.11 hinge without the old
//                      scale-1.8 bulk on top of it.
//   X  -0.36 → -0.38   2cm out, so the nearer body doesn't crowd centre-frame.
// ── RAISED AND PULLED IN (2026-08-19) ────────────────────────────────
// The scanned lantern hangs from its BAIL and is bigger than the cage it replaced, so its body
// sits ~25cm below the hinge where the old one sat ~11cm below. At the old hinge height that put
// the lantern's bottom off the frame. Josh: "make the lamp fully visible".
//   Y  -0.13 → -0.06   the whole lantern clears the bottom edge again
//   X  -0.38 → -0.36   2cm back in, so the wider body is not clipped at the left edge
// ── LOWER AND FURTHER LEFT, FOR THE FLOATING HAND (2026-08-19) ───────
// With the forearm gone the lantern no longer has to sit high enough to keep an elbow out of
// shot, so it drops into the lower-left where it belongs: the light then reads as coming from
// BELOW, lighting the hands and the near floor while the ceiling stays black.
//
// NOT as low as it first went (-0.17). A lantern DANGLING from two hooked fingers is a thing
// that has to be seen swinging under them to read as dangling at all; cropped at the bottom
// edge it is just a glow, and the pose above it stops meaning anything. The lantern is smaller
// now (0.15m body), so it fits in the lower-left corner whole.
const LAMP_RAISED = new THREE.Vector3(-0.38, -0.09, -0.54);
// STOWED sits at the lower-LEFT corner — further left than the offhand
// viewmodel (-0.32) and lower than RAISED, so a held shield gets the
// hand while the lantern still PEEKS on screen (not dropped fully out
// of frame).
// Tracks RAISED forward by the same presence pass so stowing still reads as a
// SLIDE DOWN-AND-BACK from the carry pose, not a jump to a different depth.
const LAMP_STOWED = new THREE.Vector3(-0.49, -0.31, -0.46);
// Live target the hinge eases toward each frame. Mutated by
// setLampStowed; starts RAISED.
const lampTarget = LAMP_RAISED.clone();
// Eased carry pose — separate from the live hinge.position so frame-
// by-frame bob/sway offsets don't feed back into the lerp. tickLamp
// lerps THIS toward lampTarget, then writes hinge.position = carry +
// momentary offset.
const lampCarryPos = LAMP_RAISED.clone();
const _lampPosOffset = new THREE.Vector3();
const _camWorldScratch = new THREE.Vector3();
// Body offset DOWN from the hinge (in scaled body local). Tuned so the
// visible centre of the lantern lands roughly where the old single
// group sat (~y = -0.26 worldspace at scale 1.8).
const BODY_OFFSET_Y = -0.108;
const LAMP_COLOR = 0xffc488;  // warm oil-lamp tone

export function attachLamp(camera: THREE.Camera) {
  if (lamp) return;

  // ── Hinge + body groups ───────────────────────────────────────────
  // Hinge owns the position + scale; rotation drives the pendulum.
  // Body is the visible lantern, hanging below the hinge.
  const hinge = new THREE.Group();
  hinge.position.copy(lampTarget);
  // Presence pass: 1.4 → 1.7. The trim-down took this from 1.8; we come most
  // of the way back, but not all — the lantern now sits 18cm nearer the eye
  // than it did at 1.8, so the same scale would read bigger than it used to.
  hinge.scale.setScalar(1.7);
  camera.add(hinge);
  registerViewmodel(hinge);   // near-depth pass (see render-target.ts)

  const body = new THREE.Group();
  body.position.y = BODY_OFFSET_Y;
  hinge.add(body);

  // Iron parts — dark metal with a slight emissive baseline so the
  // lantern reads even in pitch-black areas.
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x1a1410,
    metalness: 0.7,
    roughness: 0.45,
    emissive: 0x2a1a08,
    emissiveIntensity: 0.5,
    fog: false,
    flatShading: true,
  });

  // 4 vertical bars forming a cage so the flame inside shines through.
  const barH = 0.10;
  const cageRadius = 0.045;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, barH, 0.01),
      ironMat,
    );
    bar.position.set(Math.cos(a) * cageRadius, 0, Math.sin(a) * cageRadius);
    body.add(bar);
  }

  // Top + bottom plates connecting the cage.
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.045, 0.015, 8),
    ironMat,
  );
  top.position.y = barH / 2 + 0.005;
  body.add(top);

  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.052, 0.015, 8),
    ironMat,
  );
  bottom.position.y = -barH / 2 - 0.005;
  body.add(bottom);

  // Small upright post + VERTICAL O-ring. Ring sits in the XY plane
  // (torus default axis along Z = horizontal) — its hole faces the
  // camera and the lantern dangles from it like a real lamp on a
  // wrist hook. `src/player/lamp-arm.ts` mounts a left arm whose
  // wrist targets the ring centre, so the fingers visibly close
  // around it.
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6),
    ironMat,
  );
  post.position.y = barH / 2 + 0.035;
  body.add(post);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.020, 0.005, 6, 16),
    ironMat,
  );
  ring.position.y = barH / 2 + 0.060;
  // No rotation.x — torus axis stays along Z (horizontal), so the
  // ring is VERTICAL (its plane contains the up axis).
  body.add(ring);

  // Grip anchor — the SLOT the off-hand's palm_anchor aligns to,
  // the same pattern weapons use (their grip_anchor matches the
  // hand's palm_anchor). Sits at the ring centre; lamp-arm.ts reads
  // its world position each frame and computes the IK wrist target
  // such that the palm lands here.
  const ringAnchor = new THREE.Object3D();
  ringAnchor.position.copy(ring.position);
  body.add(ringAnchor);

  // ── THE SCANNED LANTERN, WHEN THE TRIAL IS ON ─────────────────────────
  //
  // DEV-only and flag-gated. It replaces the SHELL only — the bars, plates, post and ring that
  // read as iron — and leaves the flame stack, the light and the ring anchor untouched: the fire
  // inside is a separate concern the atmosphere work already tuned, and swapping the shell
  // should not disturb it.
  //
  // Placing it is one assignment, because prep-lantern.py origins the model on its BAIL: put it
  // where the ring is and it hangs from the hook. It arrives from a file long after this runs,
  // so the swap rides the load hook.
  if (import.meta.env.DEV && boneArmsWanted()) {
    const iron = [top, bottom, post, ring, ...body.children.filter(
      (c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry,
    )];
    let installed: THREE.Object3D | null = null;
    const swap = (): void => {
      const shell = buildLantern();
      if (!shell) return;
      // Detach only. `buildLantern` returns a clone(true) of the loaded GLTF scene, and a
      // Three clone SHARES geometry and material with its source — disposing one would break
      // every future clone, including the one this swap is about to install.
      if (installed) installed.removeFromParent();
      shell.position.copy(ring.position);
      body.add(shell);
      installed = shell;

      // ── REMOVE THE OLD SHELL, INCLUDING THE MERGED COPY ─────────────
      //
      // Josh: "the old lamp is still drawn." It was, and removing the parts I built was not
      // enough: mergeRigidViewmodel collapses this body into a single `lamp-merged` mesh at
      // BUILD time and DETACHES the originals. This swap runs later, off a file load, so it was
      // dutifully removing meshes that had already been detached and left the merged copy — the
      // actual cage — untouched. Exactly the trap the weapon hand hit: a merge that hands you
      // back one mesh and quietly orphans the ones you were holding.
      //
      // So the merged mesh is removed by name too, and either order is safe.
      for (const m of iron) { m.removeFromParent(); disposeGpuTree(m); }
      iron.length = 0;
      for (const c of [...body.children]) {
        if (c.name === 'lamp-merged') { c.removeFromParent(); disposeGpuTree(c); }
      }

      // ── PUT THE FLAME INSIDE THE LANTERN ────────────────────────────
      //
      // Josh: "the lamp on the flame isnt properly in place." The flame stack is authored at the
      // old cage's centre; the scanned lantern hangs from its BAIL, so its body sits well below
      // that and the fire was burning up by the handle. Shift the whole stack — both the live
      // position and the baseY the flicker bobs around, or the next tick would put it back.
      const flameY = shell.position.y + lanternBodyCentreY();
      for (const f of flameSprites) {
        const drop = flameY - f.baseY;
        f.baseY += drop;
        f.sprite.position.y += drop;
      }

      // The viewmodel render pass ran at build time, before this shell existed, so it gets the
      // same treatment here: depth-test on, depth-write off, drawn under the weapon.
      shell.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
          if (!m) continue;
          m.depthTest = true;
          m.depthWrite = false;
          m.transparent = false;
          m.needsUpdate = true;
          applyViewmodelDepthWebGPU(m);
        }
        mesh.renderOrder = 998;
      });
      if (import.meta.env.DEV) {
        // What is LEFT under the lamp, by name. This is how the merged copy was caught: the
        // count said the cage was gone and one nameless mesh remained, and the name said
        // `lamp-merged`. A swap that reports only what it added cannot see what it missed.
        const left: string[] = [];
        body.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && !shell.getObjectById(o.id)) left.push(o.name || '(unnamed)');
        });
        // eslint-disable-next-line no-console
        console.log(`[lantern] shell installed · ${left.length} old meshes remain`,
          left.length ? `: ${left.join(',')}` : '');
      }
    };
    onLanternLoaded(swap);
    void preloadLantern().then(swap);
  }

  // ── Flame stack ───────────────────────────────────────────────────
  // Same pattern as the bonfire / candle flame stacks but scaled to
  // lantern-cage size: white-hot core → yellow body → orange tongue
  // → soft warmth haze. All additive sprites on the 'fire-wisp'
  // texture; each layer carries its own flicker rate + phase so they
  // don't pulse together. Sized to fit inside the cage (radius 0.045,
  // bar height 0.10) without clipping through the bars.
  const flameSprites: FlameSprite[] = [];
  const flameMats: THREE.SpriteMaterial[] = [];
  const FLAME_LAYERS: Array<{
    pos: [number, number, number];
    size: [number, number];
    color: number;
    opacity: number;
    flicker: { scale: number; bob: number; speed: number };
  }> = [
    // White-hot core — bright, small, fastest flicker.
    { pos: [0, -0.012, 0], size: [0.032, 0.034], color: 0xffe8b0, opacity: 0.95,
      flicker: { scale: 0.18, bob: 0.004, speed: 3.4 } },
    // Yellow body — slightly taller, slower.
    { pos: [0,  0.000, 0], size: [0.038, 0.052], color: 0xffd070, opacity: 0.85,
      flicker: { scale: 0.22, bob: 0.006, speed: 2.6 } },
    // Orange tongue — tallest layer, lazy bob.
    { pos: [0,  0.012, 0], size: [0.046, 0.068], color: 0xff9040, opacity: 0.65,
      flicker: { scale: 0.26, bob: 0.008, speed: 1.9 } },
    // Outer warmth haze — wide + dim, very slow. Sells "glow filling
    // the cage" without putting bright pixels outside the bars.
    { pos: [0,  0.000, 0], size: [0.090, 0.080], color: 0xc8642a, opacity: 0.40,
      flicker: { scale: 0.10, bob: 0.003, speed: 0.9 } },
  ];
  for (const layer of FLAME_LAYERS) {
    const mat = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color: layer.color,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      // Match the rest of the viewmodel: paint over world geometry
      // (depthTest off + write off) and sort into the transparent
      // phase so renderOrder beats world-space sprites. The hinge
      // traverse below only handles meshes, so set this here.
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(layer.pos[0], layer.pos[1], layer.pos[2]);
    sprite.scale.set(layer.size[0], layer.size[1], 1);
    sprite.renderOrder = 998;
    body.add(sprite);
    flameMats.push(mat);
    flameSprites.push({
      sprite,
      baseW: layer.size[0],
      baseH: layer.size[1],
      baseY: layer.pos[1],
      speed: layer.flicker.speed,
      scaleAmp: layer.flicker.scale,
      bobAmp: layer.flicker.bob,
      phase: Math.random() * 100,
    });
  }

  // ── Viewmodel rendering ───────────────────────────────────────────
  // depthTest off + high renderOrder so the lantern always paints over
  // world geometry — matches how the sword viewmodel handles it (no
  // close walls clip through the lantern). Traverse from the hinge so
  // every child gets the same treatment.
  hinge.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        m.depthTest = false;
        m.depthWrite = false;   // depth comes from the renderer's viewmodel
                               // depth-only pass (render-target.ts); flame
                               // SPRITES (not isMesh) are skipped there.
        // Sort into the transparent phase so renderOrder 998 actually
        // wins against world-space transparent sprites — see the same
        // pattern in sword.ts for the long version of why.
        m.transparent = true;
        m.needsUpdate = true;
        applyViewmodelDepthWebGPU(m);   // WebGPU: opaque lamp parts write own depth (no pre-pass); additive flame left transparent
      }
      mesh.renderOrder = 998;  // just under the sword (999)
    }
  });
  // Collapse the lantern's rigid cage/bracket meshes. Merge at the BODY (it
  // swings as one unit under the hinge — merging at the hinge would bake the
  // swing pose). Flame sprites aren't meshes and the glass is transparent, so
  // both stay loose per the merge's own rules.
  mergeRigidViewmodel(body, null, 'lamp-merged');

  // ── Logical light source via the pool ──────────────────────────────
  // The lantern doesn't own a THREE.PointLight directly — every
  // PointLight in the scene is owned by src/scene/light-pool.ts. We
  // expose a position vector + dynamic intensity, and the pool decides
  // each frame whether to bind us to one of its slots. Persistent=true
  // so we survive level swaps (camera-attached, no level scope).
  //
  // The worldPos is read from the BODY's matrixWorld so the light
  // tracks the swinging lantern, not the static hinge.
  const worldPos = new THREE.Vector3();
  const state: LampState = {
    worldPos,
    hinge,
    body,
    flameSprites,
    flameMats,
    baseIntensity: CONFIG.LAMP_INTENSITY,
    currentIntensity: CONFIG.LAMP_INTENSITY,
    flickerT: 0,
    ringAnchor,
  };
  lamp = state;

  // Held, not just passed: the light pool reads `distance` off the source every tick, so
  // keeping the reference is what makes the Dark tab's `lamp reach` slider live. Intensity
  // already had a callback for the flicker; reach never needed one until now.
  const src: LightSource = {
    id: 'player-lamp',
    category: 'lamp',  // own dedicated slot — never crowded out
    position: worldPos,
    color: LAMP_COLOR,
    intensity: CONFIG.LAMP_INTENSITY,
    distance: CONFIG.LAMP_DISTANCE,
    decay: 1.4,
    getIntensity: () => state.currentIntensity,
    persistent: true,
  };
  lampSource = src;
  registerLight(src);
}

/** Live lamp intensity (flicker included) — for the spot-shadow split to track. */
export function getLampIntensity(): number { return lamp?.currentIntensity ?? 0; }
/** Live lamp world position (the swinging lantern body), or null if unattached. */
export function getLampWorldPos(out: THREE.Vector3): THREE.Vector3 | null {
  return lamp ? out.copy(lamp.worldPos) : null;
}

/** World-space position of the lantern's RING ANCHOR — the slot the
 *  off-hand's palm aligns to (the saber-grip pattern, but for a ring
 *  instead of a hilt). Lives inside the body group, so it swings with
 *  the pendulum. Returns null when the lamp hasn't been attached yet. */
export function getLampRingAnchorWorldPosition(out: THREE.Vector3): THREE.Vector3 | null {
  if (!lamp) return null;
  return lamp.ringAnchor.getWorldPosition(out);
}

/** Remove the lamp viewmodel + unregister its light. Idempotent. */
export function detachLamp() {
  if (!lamp) return;
  unregisterViewmodel(lamp.hinge);
  lamp.hinge.parent?.remove(lamp.hinge);
  unregisterLight('player-lamp');
  // Dispose so we don't leak GPU memory when the player swaps offhand
  // back and forth between lamp and shield.
  // Deferred: a swap happens mid-play, with the lamp drawn on the frame still
  // in flight (see scene/gpu-dispose.ts). disposeGpuTree also picks up the
  // sprite materials the old isMesh-only traverse missed.
  disposeGpuTree(lamp.hinge);
  disposeGpu(...lamp.flameMats);
  lamp = null;
}

/** Stow the lamp to the hip (true) or raise it to the visible hand
 *  (false). Called when an offhand item is equipped/removed. The light
 *  is unaffected — only the lantern's carry pose changes, eased in
 *  tickLamp. Safe to call before attachLamp (just sets the target). */
export function setLampStowed(stowed: boolean) {
  lampTarget.copy(stowed ? LAMP_STOWED : LAMP_RAISED);
}

/** Per-frame tick. Layered-sine flicker on intensity + flame brightness,
 *  plus pendulum swing on the hinge. */
export function tickLamp(dt: number) {
  if (!lamp) return;
  lamp.flickerT += dt;
  const f = lamp.flickerT;
  // Three layered sines — never repeats, never feels mechanical.
  const flicker =
      Math.sin(f * 7.3) * 0.06 +
      Math.sin(f * 13.1) * 0.03 +
      Math.sin(f * 23.7) * 0.02;
  // The Dark tab's `lamp strength` slider, live. The lamp is the baseline the whole
  // lighting grammar is stated against ("anything brighter than the lamp is a signal"),
  // so it has to be draggable next to the crush rather than in another panel.
  lamp.baseIntensity = darkKnobs.lampIntensity();
  if (lampSource) lampSource.distance = darkKnobs.lampDistance();
  lamp.currentIntensity = lamp.baseIntensity * (1 + flicker);

  // Ease the carry pose toward the current target (RAISED ↔ STOWED) so
  // equipping/removing an offhand slides the lantern between hand + hip
  // instead of snapping. Lerp the SEPARATE carry vector so the per-
  // frame bob/sway offset added below doesn't feed back into the ease.
  lampCarryPos.lerp(lampTarget, Math.min(1, dt * 7));

  // Per-frame translation offset — the lamp + hand + arm assembly
  // translates as ONE rigid unit on top of the carry pose. The arm IK
  // re-solves toward the moved ring anchor each frame, so the visible
  // result is "the whole left-hand viewmodel sways with player motion."
  //
  //   - Walk bob → small vertical + horizontal translation (the lamp
  //     bobs with each footfall). Scaled to ~60 % of the weapon bob so
  //     the off-hand reads as the "calmer" hand.
  //   - Look-around yaw lag → horizontal translation in the camera-
  //     local X axis (the lamp trails behind a quick head turn). The
  //     hinge's existing rotation.z covers the pendulum response; this
  //     adds the positional component so the ARM visibly trails too —
  //     the ring sits ~3 mm from the pivot, so rotation alone barely
  //     budges the IK target.
  const bob = getBobOffset();
  const sway = getWeaponSway();
  // Pull-back: retract the whole lantern toward camera when a wall is
  // closer than the pull threshold. Same global pullback the weapon
  // viewmodel reads; camera-local +Z = toward camera. Camera-local Z is
  // also what the lamp hinge already lives in, so adding here pulls the
  // entire lamp + arm assembly back as one unit (the lamp-arm's IK
  // re-solves toward the moved ring anchor).
  const pull = getViewmodelPullback();
  _lampPosOffset.set(
    bob.x * 0.6 + sway.yaw * 0.05,
    bob.y * 0.6,
    pull,
  );
  lamp.hinge.position.copy(lampCarryPos).add(_lampPosOffset);

  // Pendulum swing — rotation on the hinge. Body is a child offset
  // downward, so rotating the hinge automatically swings the body
  // around the handle in a true pendulum arc. Walk swing + view-sway
  // (camera-rotation lag) compose into one angle: stride bob continues
  // while a hard look-around sets the lamp swinging.
  lamp.hinge.rotation.z = getLanternSwing() + getLampSway();

  // Update the light's world position from the BODY's transform — the
  // light should track the visibly-swinging lantern, not the static
  // hinge. updateMatrixWorld on the HINGE (not the body) so the chain
  // hinge→body→ringAnchor is all-current this frame — lamp-arm.ts runs
  // immediately after this and reads ringAnchor.getWorldPosition(),
  // and if the hinge's own matrixWorld is stale the arm's IK target
  // lags by a frame and the sway reads soft.
  lamp.hinge.updateMatrixWorld(true);
  lamp.worldPos.setFromMatrixPosition(lamp.body.matrixWorld);
  // Wall-proximity light shift — as the viewmodel pull-back retracts the
  // lantern body toward the camera, slide the LIGHT source itself toward
  // the camera too, by the same fraction. Otherwise the body retracts but
  // the light still emits from where the body USED to be — which can be
  // beyond the wall the player has pressed into, so the room reads
  // pitch-black even with the lamp visibly in frame. Lerp on world
  // position, not local: lamp.hinge.parent IS the camera, so
  // parent.getWorldPosition gives us the camera world position cheaply.
  const pullFrac = getViewmodelPullbackFrac();
  if (pullFrac > 0 && lamp.hinge.parent) {
    lamp.hinge.parent.getWorldPosition(_camWorldScratch);
    // Cap the lerp at ~0.85 so the light still trails the body slightly
    // (a light at exactly the camera position looks like a flashlight).
    lamp.worldPos.lerp(_camWorldScratch, pullFrac * 0.85);
  }

  // Per-sprite flicker — bonfire pattern: two superimposed sines at
  // slightly different rates so each layer wobbles on its own clock,
  // never resyncing. Drives both scale (the flame breathes) and Y bob
  // (the tongue rises + falls slightly inside the cage).
  for (const s of lamp.flameSprites) {
    const omega = (Math.PI * 2) * s.speed;
    const t = lamp.flickerT + s.phase;
    const a = Math.sin(omega * t);
    const b = Math.sin(omega * 1.7 * t + 1.3);
    const wobble = (a * 0.6 + b * 0.4);
    const scale = 1 + wobble * s.scaleAmp;
    s.sprite.scale.set(s.baseW * scale, s.baseH * scale, 1);
    s.sprite.position.y = s.baseY + wobble * s.bobAmp;
  }
}
