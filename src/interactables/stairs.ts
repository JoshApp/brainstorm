import * as THREE from 'three';
import type { StairsSpec } from '../level/types';
import type { StyleMaterials } from '../style/materials';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, getInRangeInteractable } from './system';
import { registerLight } from '../scene/light-pool';
import { getTexture } from '../style/procedural-textures';

// Stairs = a visible descent CARVED into the floor (the top of the
// stairwell sits below floor level, framed by a low parapet lip), plus
// an interactable that requests the level transition. The actual
// loadLevel call lives in main.ts (it owns the scene + the player);
// stairs delegate via a callback passed in at spawn time.
//
// Visual structure (top → bottom):
//   parapet lip      — short box above the floor that frames the opening
//   floor cutout     — dark rectangle masking the world floor at the mouth
//   8 steps          — descending into the well, recessed below floor y=0
//   throat walls     — flanking the steps, recede deep below floor
//   black pit floor  — at the bottom, masking far geometry
//   portal seam      — additive cyan strip at the bottom edge, glowing
//   floor halo + beam moonbeam — visible from across the room

export const STEP_COUNT = 8;
export const STEP_DEPTH = 0.32;
export const STEP_HEIGHT = 0.22;
export const STEP_WIDTH = 1.95;
const TOP_RECESS = 0.04;          // top tread sits this far BELOW floor
const PARAPET_HEIGHT = 0.10;      // lip above the floor that frames the hole

/** Total footprint of one stairwell in stair-local coordinates. The
 *  level builder uses this to compute a hole shape in the room floor
 *  so the floor mesh no longer renders OVER the stairwell. */
export const STAIRWELL_TOTAL_DEPTH = STEP_COUNT * STEP_DEPTH;
export const STAIRWELL_HALF_WIDTH = STEP_WIDTH / 2;

export function spawnStairs(
  parent: THREE.Object3D,
  spec: StairsSpec,
  materials: StyleMaterials,
  onDescend: (targetLevel: string) => void,
) {
  const group = new THREE.Group();
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.rotY ?? 0;
  parent.add(group);

  const totalDepth = STEP_COUNT * STEP_DEPTH;
  const totalDrop = STEP_COUNT * STEP_HEIGHT;

  // NOTE: The "floor cutout" plane used to live here. It's replaced by
  // an actual HOLE punched into the room's floor mesh — see the
  // collectStairHoles + makeFloorWithHoles path in level/builder.ts.
  // Without the real hole the jittered floor peaks (y ≈ +0.04) poked
  // up through the cutout plane (y = +0.005) regardless of polygon
  // offset.

  // Meshes that get inverse-hull outlined later (parapet lips +
  // top few treads/risers). Collected here while we build them so
  // the outline pass is a single loop after we've defined the
  // outline material.
  const outlineTargets: THREE.Mesh[] = [];

  // ── PARAPET LIP ───────────────────────────────────────────────────
  // Short low wall ringing the OPENING above the floor — sells "carved
  // hole in the floor" rather than "stairs plopped on top." Three sides
  // (the open mouth is the side facing the player approach, so no lip
  // there).
  const parapetMat = materials.wall;
  // Left + right side parapets, running the full length of the well.
  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, PARAPET_HEIGHT, totalDepth + 0.10),
      parapetMat,
    );
    lip.position.set(
      side * (STEP_WIDTH / 2 + 0.05),
      PARAPET_HEIGHT / 2,
      totalDepth / 2,
    );
    lip.receiveShadow = true;
    lip.castShadow = true;
    group.add(lip);
    outlineTargets.push(lip);
  }
  // Far-end parapet (across the back of the well so the player doesn't
  // see beyond it into world geometry).
  const farLip = new THREE.Mesh(
    new THREE.BoxGeometry(STEP_WIDTH + 0.20, PARAPET_HEIGHT, 0.10),
    parapetMat,
  );
  farLip.position.set(0, PARAPET_HEIGHT / 2, totalDepth + 0.05);
  farLip.receiveShadow = true;
  farLip.castShadow = true;
  group.add(farLip);
  outlineTargets.push(farLip);

  // ── STEPS ─────────────────────────────────────────────────────────
  // Treads are RECESSED (top tread top edge at y = -TOP_RECESS). The
  // first riser becomes the visible "drop into the floor" cue from
  // above, and the recess prevents z-fighting with the cutout.
  for (let i = 0; i < STEP_COUNT; i++) {
    const yTop = -TOP_RECESS - i * STEP_HEIGHT;
    const zFront = i * STEP_DEPTH;
    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(STEP_WIDTH, 0.05, STEP_DEPTH),
      materials.floor,
    );
    tread.position.set(0, yTop - 0.025, zFront + STEP_DEPTH / 2);
    tread.receiveShadow = true;
    group.add(tread);
    const riser = new THREE.Mesh(
      new THREE.BoxGeometry(STEP_WIDTH, STEP_HEIGHT, 0.04),
      materials.wall,
    );
    riser.position.set(0, yTop - STEP_HEIGHT / 2, zFront);
    riser.receiveShadow = true;
    group.add(riser);
    // Only outline the first three treads + risers — those are the
    // visible "edge into the void" that the eye reads. Outlining
    // every step would just glow everywhere, washing the cue out.
    if (i < 3) {
      outlineTargets.push(tread);
      outlineTargets.push(riser);
    }
  }

  // ── THROAT WALLS ──────────────────────────────────────────────────
  // Side walls of the well below the parapet. They extend from floor
  // level down past the deepest step so the player can never see "around"
  // the stairwell into world geometry.
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, totalDrop + 1.2, totalDepth),
      materials.wall,
    );
    wall.position.set(
      side * (STEP_WIDTH / 2 + 0.05),
      -totalDrop / 2 - 0.3,
      totalDepth / 2,
    );
    wall.receiveShadow = true;
    group.add(wall);
  }

  // ── PIT FLOOR (very dark, below deepest step) ─────────────────────
  // A horizontal dark plane some distance BELOW the last tread, so
  // looking down the stairwell you see darkness receding — depth read.
  const pitFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(STEP_WIDTH, STEP_DEPTH * 2),
    new THREE.MeshBasicMaterial({ color: 0x020203, fog: false }),
  );
  pitFloor.rotation.x = -Math.PI / 2;
  pitFloor.position.set(0, -totalDrop - 0.40, totalDepth + STEP_DEPTH);
  group.add(pitFloor);

  // ── BACK WALL (darkness beyond the last step) ─────────────────────
  // Slight angle so it reads as "this corridor continues out of sight."
  const backMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(STEP_WIDTH, totalDrop + 1.4),
    backMat,
  );
  back.position.set(0, -totalDrop / 2 - 0.2, totalDepth + STEP_DEPTH * 1.9);
  group.add(back);

  // ── PORTAL SEAM AT THE BOTTOM ─────────────────────────────────────
  // Glowing cyan band where the deepest step meets the pit floor. Reads
  // as "something is down there." Plane facing the camera (player's view
  // angle from above), additive over the dark plane.
  const seamMat = new THREE.MeshBasicMaterial({
    map: getTexture('fire-wisp'),
    color: 0x4a78b0,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const seam = new THREE.Mesh(new THREE.PlaneGeometry(STEP_WIDTH * 0.9, 0.55), seamMat);
  seam.position.set(0, -totalDrop - 0.15, totalDepth + STEP_DEPTH * 0.8);
  seam.rotation.x = -Math.PI / 4;   // tilt toward the camera
  group.add(seam);

  // Wider haze around the seam for atmosphere.
  const seamHazeMat = new THREE.MeshBasicMaterial({
    map: getTexture('fire-wisp'),
    color: 0x2a4a7c,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const seamHaze = new THREE.Mesh(new THREE.PlaneGeometry(STEP_WIDTH * 1.4, 1.2), seamHazeMat);
  seamHaze.position.set(0, -totalDrop, totalDepth + STEP_DEPTH * 0.4);
  seamHaze.rotation.x = -Math.PI / 4;
  group.add(seamHaze);

  // ── DEEP GLOW LIGHT ──────────────────────────────────────────────
  // Cool pool-of-light at the bottom of the stairwell — bright enough
  // that the bottom edge of the staircase reads as the path forward.
  const glowLocal = new THREE.Vector3(0, -totalDrop + 0.5, totalDepth - 0.2);
  const glowWorld = new THREE.Vector3()
    .copy(glowLocal)
    .applyEuler(new THREE.Euler(0, spec.rotY ?? 0, 0))
    .add(new THREE.Vector3(spec.x, 0, spec.z));
  registerLight({
    id: `stairs-${spec.id ?? spec.targetLevel}-glow`,
    category: 'environment',
    position: glowWorld,
    // Cool moonlight blue — same palette family as the
    // passive outline / shaft.
    color: 0x6ea0ff,
    intensity: 5.5,
    distance: 6.5,
    decay: 1.5,
  });

  // ── MOONBEAM (rises from the mouth) ───────────────────────────────
  // Three layers + an outline highlight on the stair geometry:
  //   - Floor RING — pool of light on the REAL floor around the
  //     parapet (the old disk hovered over the carved hole because
  //     the floor under it was gone).
  //   - Inverse-hull outlines — slightly enlarged backface-rendered
  //     duplicates of the parapets + first few steps, so the stair
  //     reads as glowing against the dark interior of the well.
  //   - Outer haze + bright core sprites — the vertical god-ray that
  //     calls from across a fogged room.
  // A slow opacity breath gives the eye something to latch onto.

  // Floor RING — RingGeometry has an inner radius cut out, so the
  // glow only lands on the REAL floor outside the carved hole.
  // Inner radius matches the parapet footprint + a tiny margin so
  // there's no peek across the rim edge.
  const ringInner = Math.max(STEP_WIDTH / 2 + 0.18, STAIRWELL_TOTAL_DEPTH / 2 + 0.20);
  const ringOuter = ringInner + 2.0;
  const floorRingMat = new THREE.MeshBasicMaterial({
    // Neutral 'moonbeam' texture so the floor pool stays pure
    // blue in passive, pure gold in active — no red tint from
    // the fire-wisp gradient bleeding through.
    map: getTexture('moonbeam'),
    color: 0x4a78c8,
    transparent: true,
    opacity: 0.45,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const floorRing = new THREE.Mesh(
    new THREE.RingGeometry(ringInner, ringOuter, 24),
    floorRingMat,
  );
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.set(0, 0.012, totalDepth / 2);
  group.add(floorRing);

  // Inverse-hull outline on the parapet lips + first few visible
  // steps. Two stacked layers — a wider OUTER outline (faint, 1.22x
  // scale) plus a tighter INNER outline (bright, 1.10x scale).
  // The outer layer reads from across a dark room (a soft blue
  // glow around the silhouette); the inner crisps the edge up
  // close. Together they make the stair "definitely recognizable
  // in the dark" without flooding the room with light.
  const outlineColor = 0xc8ddff;
  const outlineOuterMat = new THREE.MeshBasicMaterial({
    color: outlineColor,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
  });
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0xe0eaff,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    transparent: true,
    opacity: 1.0,
  });
  /** Add TWO inverse-hull duplicates of a mesh: a wide soft
   *  outer halo + a tight bright inner edge. Both parented to
   *  the original's parent so they follow it. */
  const addOutline = (mesh: THREE.Mesh) => {
    const outer = new THREE.Mesh(mesh.geometry, outlineOuterMat);
    outer.position.copy(mesh.position);
    outer.rotation.copy(mesh.rotation);
    outer.scale.copy(mesh.scale).multiplyScalar(1.22);
    outer.renderOrder = -2;
    mesh.parent?.add(outer);
    const inner = new THREE.Mesh(mesh.geometry, outlineMat);
    inner.position.copy(mesh.position);
    inner.rotation.copy(mesh.rotation);
    inner.scale.copy(mesh.scale).multiplyScalar(1.10);
    inner.renderOrder = -1;
    mesh.parent?.add(inner);
  };
  for (const m of outlineTargets) addOutline(m);

  // Two-state god ray.
  //
  //   PASSIVE  — player not near the stair. Small, dim, BLUE
  //              shaft matching the outline / ring palette.
  //              Reads as "ambient light source over there,
  //              come find it".
  //   HIGHLIGHTED — player walks into interact range. Same
  //              shaft scales up + brightens + shifts to GOLD,
  //              signalling "you can descend here, this is the
  //              way out". Outline + ring shift palette too so
  //              the whole stair lighting unifies the colour.
  //
  // We use ONE shaft (outer haze + bright core) instead of the
  // earlier triple-sprite stack. Per-frame lerp between the two
  // colour/scale targets based on whether THIS stair is the in-
  // range interactable.
  const shaftPivotZ = totalDepth / 2;
  const shaftLandY  = 0.3;
  const shaftTopY   = 3.0;
  const shaftMidY   = (shaftLandY + shaftTopY) / 2;
  const shaftLen    = shaftTopY - shaftLandY;
  const shaftTilt   = 0.18;

  // Outer haze plane — small + dim by default. When highlighted
  // it'll be scaled up + opacity boosted via the per-frame tick.
  // Uses the NEUTRAL 'moonbeam' texture (white-to-transparent
  // radial) so the colour comes purely from the material tint.
  // Earlier passes used 'fire-wisp' which has red/orange in its
  // gradient — that bled through additive blending and made the
  // shaft read as reddish even when tinted blue.
  const shaftOuterMat = new THREE.MeshBasicMaterial({
    map: getTexture('moonbeam'),
    color: 0xa8c4ff,         // passive blue (overwritten by tween below)
    transparent: true,
    opacity: 0.22,           // very subtle by default
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shaftOuter = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, shaftLen),       // narrower default
    shaftOuterMat,
  );
  shaftOuter.position.set(0, shaftMidY, shaftPivotZ);
  shaftOuter.rotation.z = shaftTilt;
  group.add(shaftOuter);

  // Bright core — much thinner default. Scales up when highlighted.
  const shaftCoreMat = new THREE.MeshBasicMaterial({
    map: getTexture('moonbeam'),
    color: 0xd8e0ff,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shaftCoreMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, shaftLen),
    shaftCoreMat,
  );
  shaftCoreMesh.position.set(0, shaftMidY, shaftPivotZ + 0.02);
  shaftCoreMesh.rotation.z = shaftTilt;
  group.add(shaftCoreMesh);

  // Dust motes along the shaft — keep them, they sell the
  // volumetric beam feel. Same neutral 'moonbeam' texture.
  const moteMat = new THREE.SpriteMaterial({
    map: getTexture('moonbeam'),
    color: 0xd8e0ff,
    transparent: true,
    opacity: 0.50,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
  });
  const moteOffsets: Array<[number, number]> = [
    [-0.05, 0.6], [-0.10, 1.2], [-0.18, 1.85], [-0.25, 2.45], [-0.13, 2.8],
  ];
  for (const [ox, oy] of moteOffsets) {
    const m = new THREE.Sprite(moteMat);
    const size = 0.05 + Math.random() * 0.03;
    m.scale.set(size, size, 1);
    m.position.set(ox, shaftLandY + oy, shaftPivotZ);
    group.add(m);
  }

  // ── Two-state palette + tween ──────────────────────────────────
  // We lerp colours + opacities between passive (blue) and
  // highlighted (gold) targets each frame. The shaft outer mesh
  // owns the onBeforeRender — drives every material in the
  // stair's lighting set so they stay coherent.
  // Cool moonlight palette for the passive state. Bumped
  // saturation noticeably blue — earlier pale blues read as
  // washed-out / reddish against warm torch-lit scenes because
  // additive blending diluted the blue against an orange-tinted
  // backdrop. Pure moonlight reads as moonlight from any angle.
  const PASSIVE_OUTLINE_INNER = new THREE.Color(0xa0c4ff);
  const PASSIVE_OUTLINE_OUTER = new THREE.Color(0x6ea0ff);
  const PASSIVE_RING          = new THREE.Color(0x2a60c8);
  const PASSIVE_SHAFT_OUTER   = new THREE.Color(0x6ea0ff);
  const PASSIVE_SHAFT_CORE    = new THREE.Color(0xa0c4ff);
  const ACTIVE_OUTLINE_INNER  = new THREE.Color(0xfff0c0);
  const ACTIVE_OUTLINE_OUTER  = new THREE.Color(0xffd680);
  const ACTIVE_RING           = new THREE.Color(0xffb050);
  const ACTIVE_SHAFT_OUTER    = new THREE.Color(0xffc060);
  const ACTIVE_SHAFT_CORE     = new THREE.Color(0xfff0c8);

  // Opacity + scale targets for each state. Passive opacities
  // pulled down a touch from the previous pass — the user
  // wanted "subtle god ray" not "bright god ray waiting for
  // attention".
  const PASSIVE = {
    outerOp: 0.22, coreOp: 0.38, moteOp: 0.50,
    ringOp:  0.45, outlineInner: 0.85, outlineOuter: 0.45,
    shaftScale: 0.85,
  };
  const ACTIVE = {
    outerOp: 0.85, coreOp: 1.00, moteOp: 0.90,
    ringOp:  0.95, outlineInner: 1.00, outlineOuter: 1.00,
    shaftScale: 1.7,        // wider + taller when called
  };

  // Lerp helper.
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  let highlightT = 0;    // 0 = passive, 1 = highlighted
  const breathSeed = Math.random() * Math.PI * 2;
  // Store base shaft scale so we can scale up/down dynamically.
  const shaftOuterBaseW = 0.95;
  const shaftCoreBaseW  = 0.30;
  shaftOuter.onBeforeRender = () => {
    // Smoothly track the highlight state. dtApprox is the time
    // between renders; we approximate via a fixed exponential
    // tween factor — looks identical on both 60fps and 120fps.
    const target = (getInRangeInteractable() === interactable) ? 1 : 0;
    highlightT += (target - highlightT) * 0.12;
    const t = highlightT;
    // Slow breath on top of the highlight tween — so even the
    // passive state has a faint heartbeat.
    const wave = (Date.now() / 1000) * (Math.PI * 2 / 2.4) + breathSeed;
    const b = 0.88 + 0.12 * Math.sin(wave);

    // Material colours.
    shaftOuterMat.color.copy(PASSIVE_SHAFT_OUTER).lerp(ACTIVE_SHAFT_OUTER, t);
    shaftCoreMat.color.copy(PASSIVE_SHAFT_CORE).lerp(ACTIVE_SHAFT_CORE, t);
    moteMat.color.copy(PASSIVE_SHAFT_CORE).lerp(ACTIVE_SHAFT_CORE, t);
    floorRingMat.color.copy(PASSIVE_RING).lerp(ACTIVE_RING, t);
    outlineMat.color.copy(PASSIVE_OUTLINE_INNER).lerp(ACTIVE_OUTLINE_INNER, t);
    outlineOuterMat.color.copy(PASSIVE_OUTLINE_OUTER).lerp(ACTIVE_OUTLINE_OUTER, t);

    // Opacities.
    shaftOuterMat.opacity   = lerp(PASSIVE.outerOp,        ACTIVE.outerOp,        t) * b;
    shaftCoreMat.opacity    = lerp(PASSIVE.coreOp,         ACTIVE.coreOp,         t) * b;
    moteMat.opacity         = lerp(PASSIVE.moteOp,         ACTIVE.moteOp,         t) * b;
    floorRingMat.opacity    = lerp(PASSIVE.ringOp,         ACTIVE.ringOp,         t) * b;
    outlineMat.opacity      = lerp(PASSIVE.outlineInner,   ACTIVE.outlineInner,   t);
    outlineOuterMat.opacity = lerp(PASSIVE.outlineOuter,   ACTIVE.outlineOuter,   t) * b;

    // Shaft widens visibly when called — the highlight feels
    // physical, like the beam opens up.
    const s = lerp(PASSIVE.shaftScale, ACTIVE.shaftScale, t);
    shaftOuter.scale.set(s, 1, 1);
    shaftCoreMesh.scale.set(s, 1, 1);
    void shaftOuterBaseW; void shaftCoreBaseW;   // (geometry width is static; scale.x does the work)
  };

  const interactable = {
    id: generateEntityId(`stairs-${spec.id ?? spec.targetLevel}`),
    // World-space center of the top tread.
    position: new THREE.Vector3(spec.x, 0, spec.z).add(
      new THREE.Vector3(0, 0, STEP_DEPTH / 2).applyEuler(new THREE.Euler(0, spec.rotY ?? 0, 0)),
    ),
    radius: 1.6,
    // Position is at the TOP TREAD on the floor; default 0.6m offset
    // would put the label inside the parapet lip. Lift to 1.0m so it
    // floats above the parapet, clearly visible from the approach.
    labelOffsetY: 1.0,
    promptLabel: 'DESCEND',
    onUse() {
      // Lock so multi-tap doesn't trigger N loads.
      if (interactable.promptLabel === '') return;
      interactable.promptLabel = '';
      onDescend(spec.targetLevel);
    },
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
