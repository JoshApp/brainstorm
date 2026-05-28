import * as THREE from 'three';
import type { StairsSpec } from '../level/types';
import type { StyleMaterials } from '../style/materials';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
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
    color: 0x88aaff,
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
    map: getTexture('fire-wisp'),
    color: 0x4a78c8,
    transparent: true,
    opacity: 0.55,
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

  // God-ray shaft instead of the old vertical billboards. The
  // previous pass used three sprite billboards (mega-halo, outer
  // beam, core beam) stacked vertically — they read as a fuzzy
  // pillar of light, not a beam. Now: two tilted additive planes
  // (haze + core) plus a handful of bright dust motes along the
  // shaft. Same visual family as the godRay() model used in the
  // signature vaults so the stair feels consistent with the rest
  // of the ambient light system. Cool blue palette throughout so
  // it matches the floor ring + inverse-hull outline.
  const shaftTint  = 0xb0c8ff;
  const shaftCore  = 0xe8eeff;
  const shaftLandY = 0.3;     // bottom of the shaft sits just above the parapet
  const shaftTopY  = 3.0;     // top reaches above the ceiling line
  const shaftMidY  = (shaftLandY + shaftTopY) / 2;
  const shaftLen   = shaftTopY - shaftLandY;
  const shaftTilt  = 0.18;    // ~10° off vertical — reads as light through a crack
  const shaftPivotZ = totalDepth / 2;   // shaft centred over the mouth

  // Wider, softer outer plane — the diffuse haze around the beam.
  const shaftOuterMat = new THREE.MeshBasicMaterial({
    map: getTexture('fire-wisp'),
    color: shaftTint,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shaftOuter = new THREE.Mesh(
    new THREE.PlaneGeometry(1.55, shaftLen),
    shaftOuterMat,
  );
  shaftOuter.position.set(0, shaftMidY, shaftPivotZ);
  shaftOuter.rotation.z = shaftTilt;
  group.add(shaftOuter);

  // Narrower bright core — the visible centre of the ray.
  const shaftCoreMat = new THREE.MeshBasicMaterial({
    map: getTexture('fire-wisp'),
    color: shaftCore,
    transparent: true,
    opacity: 0.90,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shaftCoreMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, shaftLen),
    shaftCoreMat,
  );
  shaftCoreMesh.position.set(0, shaftMidY, shaftPivotZ + 0.02);
  shaftCoreMesh.rotation.z = shaftTilt;
  group.add(shaftCoreMesh);

  // Dust motes along the shaft — bright additive sprites at
  // varied positions catch the "particles drifting in the beam"
  // feel without running a particle system. Slight offset along
  // the shaft tilt so they read as INSIDE the beam.
  const moteMat = new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'),
    color: shaftCore,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
  });
  const moteOffsets: Array<[number, number]> = [
    [-0.05, 0.6], [-0.10, 1.2], [-0.18, 1.85], [-0.25, 2.45], [-0.13, 2.8],
  ];
  const motes: THREE.Sprite[] = [];
  for (const [ox, oy] of moteOffsets) {
    const m = new THREE.Sprite(moteMat);
    const size = 0.07 + Math.random() * 0.04;
    m.scale.set(size, size, 1);
    m.position.set(ox, shaftLandY + oy, shaftPivotZ);
    group.add(m);
    motes.push(m);
  }

  // Slow breath — opacity oscillates ±15% on a ~2.4s cycle.
  // Drives the ring, outline, shaft layers and mote sprites
  // together so the call pulses as one.
  const beamBreathSeed = Math.random() * Math.PI * 2;
  const baseOuter       = shaftOuterMat.opacity;
  const baseCore        = shaftCoreMat.opacity;
  const baseMote        = moteMat.opacity;
  const baseRing        = floorRingMat.opacity;
  const baseOutline     = outlineMat.opacity;
  const baseOutlineHalo = outlineOuterMat.opacity;
  shaftOuter.onBeforeRender = () => {
    const t = (Date.now() / 1000) * (Math.PI * 2 / 2.4) + beamBreathSeed;
    const b = 0.85 + 0.15 * Math.sin(t);
    shaftOuterMat.opacity = baseOuter * b;
    shaftCoreMat.opacity = baseCore * b;
    moteMat.opacity = baseMote * b;
    floorRingMat.opacity = baseRing * b;
    outlineMat.opacity = baseOutline * b;
    outlineOuterMat.opacity = baseOutlineHalo * b;
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
