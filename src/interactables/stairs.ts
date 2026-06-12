import * as THREE from 'three';
import { groundYAt } from '../level/elevation';
import type { StairsSpec } from '../level/types';
import type { StyleMaterials } from '../style/materials';
import { generateEntityId } from '../ecs/world';
import { chainRun } from '../content/chain-links';
import { buildRng } from '../engine/rng';
import { registerInteractable, getInRangeInteractable } from './system';
import { INTERACT_PRIORITY } from './types';
import { registerLight } from '../scene/light-pool';
import { getTexture } from '../style/procedural-textures';
import { getEquipped } from '../player/equipment';
import { pooledBox, pooledPlane, pooledRing } from '../scene/geometry-pool';
import { isBossEncounterComplete, onBossEncounterComplete } from '../mobs/boss-encounter';

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

const FIRE_AWAKE = new THREE.Color(0xff7a22);

export function spawnStairs(
  parent: THREE.Object3D,
  spec: StairsSpec,
  materials: StyleMaterials,
  onDescend: (targetLevel: string) => void,
) {
  // Stairs leading to a safe-N level get a WARM passive palette
  // (amber outline + gold ring + gold shaft) instead of the cool
  // moonlight blue. Player learns: blue beam ahead = deeper dark,
  // warm beam ahead = refuge. Active (in-range) state stays gold
  // either way, so the in-range read is unchanged.
  const isSafeVariant = spec.targetLevel.startsWith('safe-');

  const group = new THREE.Group();
  group.position.set(spec.x, groundYAt(spec.x, spec.z), spec.z);
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
      pooledBox(0.10, PARAPET_HEIGHT, totalDepth + 0.10),
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
    pooledBox(STEP_WIDTH + 0.20, PARAPET_HEIGHT, 0.10),
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
      pooledBox(STEP_WIDTH, 0.05, STEP_DEPTH),
      materials.floor,
    );
    tread.position.set(0, yTop - 0.025, zFront + STEP_DEPTH / 2);
    tread.receiveShadow = true;
    group.add(tread);
    const riser = new THREE.Mesh(
      pooledBox(STEP_WIDTH, STEP_HEIGHT, 0.04),
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
      pooledBox(0.10, totalDrop + 1.2, totalDepth),
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

  // ── THE LANDING + THE FIRE BELOW ──────────────────────────────────
  // The bottom of the well is not a grey mask any more — it's the NEXT
  // FLOOR'S THRESHOLD, seen from above: a stone landing, a round-top
  // archway into the dark, and the threshold bonfire behind it. The
  // fire smoulders as embers from afar and WAKES as the player comes
  // into interact range (see the highlight tween in onBeforeRender) —
  // the fire you descend toward is the fire you wake beside. The spawn
  // room of the next floor closes the loop with a sealed origin arch
  // behind its bonfire (content/origin-arch.ts).
  const landY = -totalDrop - 0.02;
  const landDepth = 1.7;
  const landing = new THREE.Mesh(
    pooledBox(STEP_WIDTH, 0.06, landDepth),
    materials.floor,
  );
  landing.position.set(0, landY - 0.03, totalDepth + landDepth / 2);
  landing.receiveShadow = true;
  group.add(landing);
  // Landing side walls — continue the throat so the alcove never leaks
  // world geometry at its flanks.
  for (const side of [-1, 1]) {
    const aw = new THREE.Mesh(
      pooledBox(0.10, totalDrop + 1.2, landDepth),
      materials.wall,
    );
    aw.position.set(side * (STEP_WIDTH / 2 + 0.05), -totalDrop / 2 - 0.3, totalDepth + landDepth / 2);
    aw.receiveShadow = true;
    group.add(aw);
  }

  // Round-top archway across the landing's far end. PS1 arch: two
  // jambs, a crown of three angled wedge boxes, dressed-stone face
  // panels filling the wall around it. Beyond the opening: black.
  const ARCH_W = STEP_WIDTH * 0.62;        // clear opening width
  const ARCH_SPRING = 1.30;                // jamb top / where the arc springs
  const ARCH_RISE = 0.45;                  // crown rise above the spring
  const archZ = totalDepth + landDepth - 0.35;
  const archFaceH = totalDrop + 1.4;       // face wall fills up the throat
  const jambW = 0.16;
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(pooledBox(jambW, ARCH_SPRING, 0.26), materials.dressed);
    jamb.position.set(side * (ARCH_W / 2 + jambW / 2), landY + ARCH_SPRING / 2, archZ);
    group.add(jamb);
    // Face panels left/right of the opening, floor to throat top.
    const panelW = (STEP_WIDTH - ARCH_W) / 2 - jambW;
    if (panelW > 0.02) {
      const panel = new THREE.Mesh(pooledBox(panelW, archFaceH, 0.18), materials.wall);
      panel.position.set(side * (ARCH_W / 2 + jambW + panelW / 2), landY + archFaceH / 2, archZ);
      group.add(panel);
    }
    // Crown wedges — angled boxes stepping toward the centre.
    const wedge = new THREE.Mesh(pooledBox(ARCH_W * 0.34, 0.16, 0.24), materials.dressed);
    wedge.position.set(side * ARCH_W * 0.26, landY + ARCH_SPRING + ARCH_RISE * 0.55, archZ);
    wedge.rotation.z = -side * 0.55;
    group.add(wedge);
  }
  const keyWedge = new THREE.Mesh(pooledBox(ARCH_W * 0.30, 0.18, 0.26), materials.dressed);
  keyWedge.position.set(0, landY + ARCH_SPRING + ARCH_RISE, archZ);
  group.add(keyWedge);
  // Face fill ABOVE the arch crown up to the throat top.
  const overH = archFaceH - (ARCH_SPRING + ARCH_RISE + 0.18);
  const over = new THREE.Mesh(pooledBox(ARCH_W + jambW * 2, overH, 0.18), materials.wall);
  over.position.set(0, landY + ARCH_SPRING + ARCH_RISE + 0.18 + overH / 2, archZ);
  group.add(over);

  // Darkness through the opening — pure black chamber walls beyond the
  // arch, so the fire floats in void until it wakes.
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  const voidBack = new THREE.Mesh(pooledPlane(STEP_WIDTH, totalDrop + 1.6), voidMat);
  voidBack.position.set(0, -totalDrop / 2 - 0.2, archZ + 1.6);
  group.add(voidBack);
  const voidFloor = new THREE.Mesh(pooledPlane(STEP_WIDTH, 1.8), voidMat);
  voidFloor.rotation.x = -Math.PI / 2;
  voidFloor.position.set(0, landY - 0.01, archZ + 0.9);
  group.add(voidFloor);

  // THE FIRE — a low twig pile + two flame sprites just beyond the arch.
  // Ember-dim at rest; the highlight tween (interact range) wakes it.
  const fireZ = archZ + 0.85;
  const twigMat = new THREE.MeshStandardMaterial({ color: 0x16100a, roughness: 1.0, flatShading: true });
  for (let i = 0; i < 3; i++) {
    const twig = new THREE.Mesh(pooledBox(0.46, 0.045, 0.05), twigMat);
    twig.position.set(0, landY + 0.05 + i * 0.012, fireZ);
    twig.rotation.y = i * 1.1 + 0.4;
    group.add(twig);
  }
  const fireMatA = new THREE.MeshBasicMaterial({
    map: getTexture('fire-wisp'), color: 0x6e1c06, transparent: true, opacity: 0.30,
    blending: THREE.AdditiveBlending, fog: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const fireMatB = fireMatA.clone();
  fireMatB.color.set(0x3c1004); fireMatB.opacity = 0.22;
  const fireA = new THREE.Mesh(pooledPlane(0.5, 0.7), fireMatA);
  fireA.position.set(0, landY + 0.42, fireZ);
  group.add(fireA);
  const fireB = new THREE.Mesh(pooledPlane(0.8, 1.0), fireMatB);
  fireB.position.set(0, landY + 0.55, fireZ + 0.05);
  group.add(fireB);

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
    // Cool moonlight blue for descent into more dungeon, warm
    // amber for stairs that lead UP to a safe room — the deep
    // pool of light matches the shaft above.
    color: isSafeVariant ? 0xff9050 : 0x6ea0ff,
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
    pooledRing(ringInner, ringOuter, 24),
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
    pooledPlane(0.95, shaftLen),       // narrower default
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
    pooledPlane(0.30, shaftLen),
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
    const size = 0.05 + buildRng() * 0.03;
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
  // Two passive palettes — cool moonlight for stairs descending into
  // more dungeon, warm amber for stairs that lead to a safe room.
  // The warm passive uses a slightly dimmer / less saturated cousin of
  // the ACTIVE colours so the safe variant still 'lights up' when the
  // player walks into range — same gold, but brighter + wider.
  const PASSIVE_OUTLINE_INNER = isSafeVariant
    ? new THREE.Color(0xffd6a8) : new THREE.Color(0xa0c4ff);
  const PASSIVE_OUTLINE_OUTER = isSafeVariant
    ? new THREE.Color(0xff9858) : new THREE.Color(0x6ea0ff);
  const PASSIVE_RING          = isSafeVariant
    ? new THREE.Color(0xc06028) : new THREE.Color(0x2a60c8);
  const PASSIVE_SHAFT_OUTER   = isSafeVariant
    ? new THREE.Color(0xff9858) : new THREE.Color(0x6ea0ff);
  const PASSIVE_SHAFT_CORE    = isSafeVariant
    ? new THREE.Color(0xffd0a0) : new THREE.Color(0xa0c4ff);
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
  const breathSeed = buildRng() * Math.PI * 2;
  // Store base shaft scale so we can scale up/down dynamically.
  const shaftOuterBaseW = 0.95;
  const shaftCoreBaseW  = 0.30;

  // ── BOSS-GATE WARD ──────────────────────────────────────────────────
  // A boss-floor descent is SEALED until the boss falls. No warm invite:
  // a taut additive membrane in the boss's own colour caps the mouth, and
  // HEAVY IRON CHAINS cross it with a padlock at the join — the glow says
  // "warded", the chains say "barred". The kill shatters the whole rig (it
  // rises + fades) and the warm beam resumes. Built only on a boss gate.
  const isBossGate = spec.unlock?.kind === 'boss-defeated';
  const sealColor = (spec.unlock?.kind === 'boss-defeated' && spec.unlock.color != null)
    ? spec.unlock.color : 0x88cc33;
  let sealActive = isBossGate && !isBossEncounterComplete();
  let breaking = false;
  let shatter = 0;
  let wardGroup: THREE.Group | null = null;
  let wardSlabMat: THREE.MeshBasicMaterial | null = null;
  const wardFadeMats: THREE.Material[] = [];   // everything that fades out on the shatter
  if (isBossGate) {
    wardGroup = new THREE.Group();
    // 1) The glowing membrane — additive, pulses while sealed.
    wardSlabMat = new THREE.MeshBasicMaterial({
      color: sealColor, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const slab = new THREE.Mesh(pooledBox(STEP_WIDTH, 0.02, totalDepth), wardSlabMat);
    slab.position.set(0, 0.09, totalDepth / 2);
    wardGroup.add(slab);
    wardFadeMats.push(wardSlabMat);
    // 2) Crossed iron chains over the mouth — REAL links (chain-links.ts)
    // sagging under their own implied weight, bolted to the stone at the
    // corners with anchor plates. The old version was two straight boxes,
    // which read as girders, not chains.
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x14130f, roughness: 0.6, metalness: 0.7, flatShading: true,
      transparent: true, opacity: 1,
    });
    wardFadeMats.push(ironMat);
    const hw = STEP_WIDTH / 2;
    const corners: Array<[THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(-hw, 0.16, 0.05), new THREE.Vector3(hw, 0.16, totalDepth - 0.05)],
      [new THREE.Vector3(hw, 0.16, 0.05), new THREE.Vector3(-hw, 0.16, totalDepth - 0.05)],
    ];
    for (const [a, b] of corners) {
      wardGroup.add(chainRun(a, b, ironMat, { sag: 0.10 }));
      // Anchor plates where the chain meets the stone lip.
      for (const end of [a, b]) {
        const plate = new THREE.Mesh(pooledBox(0.14, 0.05, 0.14), ironMat);
        plate.position.set(end.x, end.y - 0.02, end.z);
        wardGroup.add(plate);
      }
    }
    // 3) Padlock HANGING below the crossing — slightly tilted, the way a
    // heavy lock actually sits on slack chain. Body + U-shackle + a
    // seal-coloured keyhole that glows on the face.
    const lock = new THREE.Group();
    const lockBody = new THREE.Mesh(pooledBox(0.16, 0.20, 0.07), ironMat);
    lock.add(lockBody);
    const shoulder = new THREE.Mesh(pooledBox(0.12, 0.04, 0.06), ironMat);
    shoulder.position.y = 0.12;
    lock.add(shoulder);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.020, 6, 12, Math.PI), ironMat);
    shackle.position.y = 0.14;
    lock.add(shackle);
    // Keyhole: a small glowing disc + slot, sunk into the face.
    const holeDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10), wardSlabMat);
    holeDisc.rotation.x = Math.PI / 2;
    holeDisc.position.set(0, -0.015, -0.038);
    lock.add(holeDisc);
    const holeSlot = new THREE.Mesh(pooledBox(0.012, 0.045, 0.012), wardSlabMat);
    holeSlot.position.set(0, -0.045, -0.038);
    lock.add(holeSlot);
    // The ward is HORIZONTAL (it caps the stair mouth), so the lock
    // LIES on the chain crossing FACE-UP — hanging plumb would show
    // the player only its thin top edge. Scaled up: this is the focal
    // symbol of 'sealed', it must read from the room's approach.
    lock.scale.setScalar(1.5);
    lock.position.set(0, 0.10, totalDepth / 2);
    lock.rotation.x = -Math.PI / 2 + 0.12;   // face up, slight tilt off the plane
    lock.rotation.z = 0.18;                   // askew on the chains, not squared
    wardGroup.add(lock);

    wardGroup.visible = sealActive;
    group.add(wardGroup);
    // Break the seal the instant the boss encounter completes.
    if (sealActive) onBossEncounterComplete(() => { sealActive = false; breaking = true; });
  }

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

    // Boss gate. While sealed, the warm beam/halo is killed — only the ward
    // glows, with a faint cold floor-mark in the boss colour so the sealed
    // descent still reads from across the room. The kill shatters the ward
    // (rises + fades) and we fall through to the normal warm light below.
    if (isBossGate && wardGroup) {
      if (sealActive) {
        if (wardSlabMat) wardSlabMat.opacity = 0.26 + 0.10 * Math.sin(wave);
        shaftOuterMat.opacity = 0; shaftCoreMat.opacity = 0; moteMat.opacity = 0;
        outlineMat.opacity = 0; outlineOuterMat.opacity = 0;
        shaftOuter.scale.set(0, 1, 1); shaftCoreMesh.scale.set(0, 1, 1);
        floorRingMat.color.set(sealColor);
        floorRingMat.opacity = 0.16 + 0.07 * Math.sin(wave);
        return;
      }
      if (breaking) {
        // The whole rig (membrane + chains + lock) rips loose, rises and fades.
        shatter += (1 - shatter) * 0.05;
        wardGroup.position.y = shatter * 0.5;
        wardGroup.scale.set(1 + shatter * 0.3, 1 + shatter * 0.6, 1 + shatter * 0.3);
        for (const m of wardFadeMats) {
          const base = m === wardSlabMat ? 0.36 : 1;
          (m as THREE.Material & { opacity: number }).opacity = Math.max(0, base * (1 - shatter));
        }
        if (shatter > 0.97) { wardGroup.visible = false; breaking = false; }
      }
    }

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

    // The fire below wakes as the player nears the descent — embers at
    // rest, living flame in interact range. Continuity: that is the
    // NEXT floor's threshold bonfire, already burning for you.
    const fw = 0.85 + 0.15 * Math.sin(wave * 2.3);
    fireMatA.color.set(0x6e1c06).lerp(FIRE_AWAKE, t);
    fireMatA.opacity = (0.30 + 0.62 * t) * fw;
    fireMatB.opacity = (0.22 + 0.36 * t) * fw;
    fireA.scale.setScalar(1 + 0.45 * t * fw);
    fireB.scale.setScalar(1 + 0.30 * t);

    // Shaft widens visibly when called — the highlight feels
    // physical, like the beam opens up.
    const s = lerp(PASSIVE.shaftScale, ACTIVE.shaftScale, t);
    shaftOuter.scale.set(s, 1, 1);
    shaftCoreMesh.scale.set(s, 1, 1);
    void shaftOuterBaseW; void shaftCoreBaseW;   // (geometry width is static; scale.x does the work)
  };

  // Unlock predicate — null = always usable; otherwise re-evaluated
  // each tick to flip the prompt between SEALED and DESCEND.
  const unlock = spec.unlock;
  const isUnlocked = (): boolean => {
    if (!unlock) return true;
    if (unlock.kind === 'has-equipment') return getEquipped(unlock.slot) !== null;
    if (unlock.kind === 'boss-defeated') return isBossEncounterComplete();
    return true;
  };

  const interactable: import('./types').Interactable = {
    id: generateEntityId(`stairs-${spec.id ?? spec.targetLevel}`),
    // World-space center of the top tread.
    position: new THREE.Vector3(spec.x, 0, spec.z).add(
      new THREE.Vector3(0, 0, STEP_DEPTH / 2).applyEuler(new THREE.Euler(0, spec.rotY ?? 0, 0)),
    ),
    radius: 1.6,
    // Descend ranks below loot, above generic interactables (INTERACT_PRIORITY).
    priority: INTERACT_PRIORITY.descend,
    // Position is at the TOP TREAD on the floor; default 0.6m offset
    // would put the label inside the parapet lip. Lift to 1.0m so it
    // floats above the parapet, clearly visible from the approach.
    labelOffsetY: 1.0,
    promptLabel: isUnlocked() ? 'DESCEND' : 'SEALED',
    onUse() {
      // SEALED → no descent; the player still sees the prompt but
      // tapping does nothing until the gate predicate succeeds.
      if (interactable.promptLabel !== 'DESCEND') return;
      interactable.promptLabel = '';
      onDescend(spec.targetLevel);
    },
    // Re-evaluate the unlock each tick so the prompt flips the
    // instant the predicate becomes satisfied (e.g. the player
    // equips a weapon in the starter chamber).
    tick: unlock
      ? () => {
          // Don't unflag once the descent has started (promptLabel
          // === '' is the "loading" state).
          if (interactable.promptLabel === '') return;
          interactable.promptLabel = isUnlocked() ? 'DESCEND' : 'SEALED';
        }
      : undefined,
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
