import * as THREE from 'three';
import { setMaterialRoomTopDarkWebGPU } from './banded-lighting-webgpu';
import { CONFIG } from '../config';
import { installSurfaceDetail, installNamedSurfaceDetail, registerSurfaceDetail } from './surface-detail';
import { bakeSurfaceTexture, SURFACE_TILE } from './surface-textures';
import type { DelveRenderer } from '../scene/create-renderer';

// Material library for the BIG STATIC SURFACES of the level (walls, floor,
// ceiling). Dynamic entities (enemies, sword, torches, chests) own their
// materials via ModelSpec.materials so per-instance state (hit flash,
// independent flame flicker) doesn't bleed across instances.

export interface StyleMaterials {
  wall: THREE.Material;
  floor: THREE.Material;
  /** Stair treads + risers — the floor look on a wall projection. See above. */
  stair: THREE.Material;
  ceiling: THREE.Material;
  /** Aged dark timber — mine-shaft bracing + plank doors. */
  timber: THREE.Material;
  /** Stone for PROPS (pillars, etc.) — wall colour, faint grain (no brick). */
  stone: THREE.Material;
  /** Dressed/ashlar stone for FRAMING — archways, doorframes, lintels. */
  dressed: THREE.Material;
  /** Wall brick, no vertex colours, double-sided — for chasm/crack drop walls. */
  chasmWall: THREE.Material;
}

export function buildMaterials(renderer: DelveRenderer): StyleMaterials {
  // Emissive baseline: a tiny self-luminance on every static surface so
  // even unlit corners imply geometry ("stone, but barely") instead of
  // reading as black void. Way better than cranking global ambient,
  // which would flatten the warm/cool torch contrast.
  const wallEmissive  = 0x0a0805;
  const floorEmissive = 0x06050a;
  const ceilEmissive  = 0x040303;
  const emissiveBoost = 1.0;

  const wallBase = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    vertexColors: true,   // per-vertex tint jitter breaks up uniform surfaces
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
    // Wall planes are single quads with their normal facing INTO the
    // room. When the player stands in a corridor and sees the back
    // side of the adjacent vault's south wall (or vice versa), back-
    // face culling would render it invisible — looked like "the wall
    // is missing a side." Double-sided is the small-cost fix; with
    // our wall count it doesn't move the perf needle.
    side: THREE.DoubleSide,
  });
  const floorBase = new THREE.MeshStandardMaterial({
    color: CONFIG.FLOOR_COLOR,
    // ROUGHNESS 1.0 → 0.72, and this is the half that isn't about colour.
    //
    // Wall 0.95 vs floor 1.0 is no difference at all: both are fully matte, so
    // both return light the same way and only the albedo separates them — and
    // with near-black albedo the LIGHT dominates, so they collapse into one
    // material at two brightnesses. That's the real reason value contrast alone
    // never fixed this.
    //
    // A rougher-than-matte floor can't have a highlight; a smoother one can.
    // At 0.72 the flagstones take a broad grazing sheen from torchlight — damp
    // stone — which does three things a colour change cannot: it CARRIES THE
    // LIGHT'S COLOUR (the premise Josh wants kept), it MOVES with the player,
    // and it responds to where the flame actually is. Floor and wall now differ
    // in how they answer light, not just in what colour they are.
    roughness: 0.72,
    metalness: 0.0,
    vertexColors: true,
    emissive: floorEmissive,
    emissiveIntensity: emissiveBoost,
  });
  const ceilingBase = new THREE.MeshStandardMaterial({
    color: CONFIG.CEILING_COLOR,
    roughness: 1.0,
    metalness: 0.0,
    emissive: ceilEmissive,
    emissiveIntensity: emissiveBoost,
  });

  // Timber — aged dark wood for mine-shaft bracing and plank doors. Warmer
  // and a touch lighter than the near-black stone so framing/doors read as a
  // distinct material under torchlight without breaking the grimdark palette.
  const timberBase = new THREE.MeshStandardMaterial({
    color: 0x3a2a18,
    roughness: 1.0,
    metalness: 0.0,
    emissive: 0x0a0703,
    emissiveIntensity: emissiveBoost,
  });

  // Stone for props (pillars). Same near-black stone as the walls. Gets a FAINT
  // grain (below) — not brick — so a round shaft catches torchlight without the
  // masonry pattern smearing around its curve.
  const propStone = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
  });

  // Dressed/ashlar stone for architectural FRAMING (archways, doorframes,
  // lintels). Big even blocks, thin clean joints — "finished" stone that frames
  // a passage, contrasting the rough masonry walls. Detail installed below.
  const dressedBase = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.92,
    metalness: 0.0,
    emissive: wallEmissive,
    emissiveIntensity: emissiveBoost,
  });

  // Chasm/crack drop walls + ceiling-shaft walls. Wall BRICK (the faces are
  // vertical, so they texture correctly), double-sided so the inner faces
  // show. vertexColors:true is load-bearing: the shaft/drop geometry bakes a
  // depth fade into its vertex colours (bright at the rim/lip → pure black a
  // few metres in — see applyDepthFade in geometry-prims.ts), which is what
  // makes a pit read as an abyss instead of a lit box. Emissive must stay
  // ZERO — vertex colour only multiplies albedo, so any emissive would leave
  // a residual glow at full depth and the void would never reach black.
  const chasmWall = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    vertexColors: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
  // Wall/floor baked AO rides the materials' vertexColors natively (node
  // pipeline multiplies vColor into diffuse) — no install step needed.

  // Baked, mipmapped tiling stone detail. WALLS = brick, FLOOR = flagstones,
  // CEILING = coffered panels (its own language). Warm tint on the floor, cold
  // on the ceiling, neutral walls. Mipmaps + anisotropy keep it stable under
  // the 0.4x render scale (no crawl/flicker).
  // (An AI-generated wall texture was trialled here behind ?surftex=ai and
  // REMOVED — Josh: *"lets scrap the texture approach and work on the
  // procedural a bit."* The generator survives as scripts/gen-surface-tex.ts if
  // it is ever wanted again; nothing in the runtime path depends on it now.)
  const wallTex = bakeSurfaceTexture(renderer, 'wall');
  // Shared with the STAIR material below, which is the floor's own stone on a wall
  // projection — baking it twice would be two identical textures and two uploads.
  const floorTex = bakeSurfaceTexture(renderer, 'floor');
  const wallCfg = {
    splat: true,
    brickDamage: true, grooveFill: true, seamGlow: true,
    tex: wallTex,
    tile: SURFACE_TILE.wall,
    proj: 'wall' as const,
    tint: [1.0, 1.0, 1.0] as const,
    relief: 0.30,
  };
  installSurfaceDetail(wallBase, wallCfg);
  // The wall's OWN stone, available to ModelSpec by name. Josh: *"i think we
  // should make archways just the standard wall material right now, we can
  // always tune it a bit."* A framed opening is a hole in a wall, so the
  // default answer for anything built into one is the wall's masonry — and
  // because the projection is world-space, a frame's courses line up with the
  // wall they interrupt instead of running to their own rhythm.
  registerSurfaceDetail('wall', wallCfg);
  installSurfaceDetail(chasmWall, {
    splat: true,
    tex: wallTex, brickDamage: true, grooveFill: true, seamGlow: true,
    tile: SURFACE_TILE.wall, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.30,
  });
  installSurfaceDetail(floorBase, {
    // Floor: SHADOW only (subtle), no coloured glow — the glow on the ground was
    // too light/yellow and broke the grimdark. Just a quiet darken in the gaps.
    splat: true, seamShadow: true, seamGlowScale: 0.35,
    tex: floorTex,
    // TINT WAS [1.08, 0.9, 0.64] — a hard amber multiply on the floor's albedo:
    // blue cut by 36%. THAT is why the floor and the wall read as the same
    // stone. Josh: *"the floor and wall look the exact same hue ... they have
    // the exact same shade."* The wall's tint is neutral [1,1,1], so the floor
    // was being pushed warm to meet it, and any change to FLOOR_COLOR was
    // multiplied straight back out again — which is why making the base colour
    // cool did nothing visible.
    //
    // Now cool, mirroring the ceiling's existing [0.7, 0.8, 1.05]. The system
    // always supported per-surface tinting; the floor was simply authored warm.
    // role:'floor' opts this one material into the live Sheen knobs — Josh:
    // *"the floor is a bit too silver metallic ... i think it could be cool if
    // we could experiment a bit with it."* The tint below stays the AUTHORED
    // value; the knobs ride on top of it, so nothing here has to move while
    // he's finding the look.
    role: 'floor',
    tile: SURFACE_TILE.floor, proj: 'horiz', tint: [0.90, 0.97, 1.12], relief: 0.32,
  });
  // ── STAIRS PROJECT LIKE A WALL, NOT LIKE A FLOOR ─────────────────────────
  //
  // Josh: *"can we make the stone texture read better on stairs like basically not just stretched
  // vertically."*
  //
  // The cause is the projection, not the texture. Stone is sampled in WORLD space, and the floor
  // uses `horiz` — the XZ plane. That is right for a floor and degenerate on a stair RISER: a
  // riser is vertical, so climbing it changes neither X nor Z, the sampled coordinate does not
  // move, and the last row of pixels before the edge is smeared the whole height of the step.
  // Stretched vertically is the exact signature of an XZ projection meeting a vertical face.
  //
  // `wall` is not a different look, it is a SUPERSET: it picks the world plane each face is most
  // parallel to, so a riser gets a wall layout and a tread — being up-facing — takes the same
  // ground-plane branch the floor projection would have given it. Treads keep the floor's look;
  // risers stop smearing.
  //
  // A separate material rather than switching the floor's own projection, which would re-phase
  // every floor in the game to fix the one surface that is broken. It costs one pipeline, on
  // floors that actually have a stair run.
  const stairBase = floorBase.clone();
  installSurfaceDetail(stairBase, {
    // ── STAIRS ARE MASONRY, AT MASONRY'S SIZE ──────────────────────────────
    //
    // Josh: *"can we make it so there are like nice stones vertically as well so it looks a bit
    // 3d around stairs?"*
    //
    // The projection fix stopped the smearing but left the stones FLOOR-SIZED, and that is why a
    // riser still read as a flat band: a riser is about a quarter-metre tall and a floor flagstone
    // is 1.05m across, so the face was showing a third of one stone with no edge in it. Nothing to
    // catch light, nothing to say "these are blocks".
    //
    // So stairs take the WALL's brick pattern — running bond is the right language for a riser,
    // which is a little retaining wall holding up a step — at roughly a third of wall scale.
    // Wall courses are 0.6m; at this tile they are near 0.22m, so a single riser shows one clean
    // course of blocks and a tread shows a few, and the two agree because they are the same
    // masonry seen on two faces. That agreement is what makes a flight read as one built object
    // rather than as stripes.
    //
    // brickDamage + grooveFill come with it: chipped arrises and filled joints are most of what
    // sells cut stone at close range, and stairs are always seen close.
    splat: true, seamShadow: true, seamGlowScale: 0.35,
    // ── THE FLOOR'S OWN STONES, WRAPPING THE CORNER ────────────────────────
    //
    // Josh: *"can you make the same nice floor geometry on the floors vertical texture so its
    // like these 3d stones going around the corner."*
    //
    // The first pass used the WALL's brick, and that was the mistake: a flight then spoke a
    // different masonry language from the floor it starts and ends on, so the eye read a change of
    // material at the top and bottom step instead of a continuous surface folding upward. Bricks
    // are also the wrong idea for this — a stair is cut out of the same flags you are walking on,
    // not bonded out of little blocks.
    //
    // So it is the FLOOR texture on both faces, and the corner-wrap follows for free from how the
    // projection works. Both faces are projected in WORLD space, and along the shared edge — the
    // nose — the tread's horizontal coordinate and the riser's horizontal coordinate are the SAME
    // world axis. Same texture, same tile, same axis: a stone that ends at the nose on top starts
    // at the nose on the face, and reads as one block turning the corner.
    tex: floorTex,
    role: 'floor',
    // Deeper relief than either the floor (0.32) or the wall (0.30). The whole ask is that a
    // flight reads as 3D, and a step is the one place the eye gets an unambiguous silhouette to
    // check the relief against — it can afford to be stronger here than on a flat surface where
    // it would only look noisy.
    // Roughly a third of floor scale. Floor flags are ~1.05m, which showed a third of one stone
    // on a quarter-metre riser; at this tile they are ~0.38m, so a riser carries most of a whole
    // flag and a tread carries several. Small enough to read as stone, large enough to still be
    // the floor's stone rather than gravel.
    tile: [1.90, 1.90], proj: 'wall', tint: [0.90, 0.97, 1.12], relief: 0.42,
  });

  installSurfaceDetail(ceilingBase, {
    seamShadow: true,   // panel/beam SHADOW for depth — no coloured glow (that looked weird up there)
    tex: bakeSurfaceTexture(renderer, 'ceiling'),
    tile: SURFACE_TILE.ceiling, proj: 'horiz', tint: [0.7, 0.8, 1.05], relief: 0.32,
  });

  // Framing (dressed ashlar) + prop columns (faint grain). Register the dressed
  // config by name too, so the ModelSpec compiler can opt archways/doorframes in.
  const dressedCfg = {
    tex: bakeSurfaceTexture(renderer, 'dressed'),
    // Relief 0.16 → 0.24: that value was set when dressedCPU emitted an almost
    // flat height field (a joint line and nothing else), so there was little for
    // the relief to show. It now carries set-out, tilt, doming, spall, chips and
    // a broken corner like the wall does, and at 0.16 most of that was being
    // flattened back out. Still under the wall's 0.30 — ashlar IS flatter.
    tile: SURFACE_TILE.dressed, proj: 'wall' as const, tint: [1.0, 1.0, 1.0] as const, relief: 0.24,
  };
  installSurfaceDetail(dressedBase, dressedCfg);
  registerSurfaceDetail('dressed', dressedCfg);
  // ── THE FRAME IS A DIALECT OF THE WALL, NOT A DIFFERENT LANGUAGE ──────────
  //
  // Josh, 2026-08-16, relaying a read of the gate against the new masonry: the
  // arch had stopped parsing as `wall → architectural frame → opening` and was
  // reading as `continuous noisy stone → black hole`. The diagnosis was that the
  // gate carries the same amount of speckle, chipping and quantised variation as
  // the wall around it, so nothing tells the eye which one is the important
  // architecture — and the recommendation was explicitly NOT to give it a
  // different shader, but to make it a quieter dialect of the same material.
  //
  // That is right, and the reason it is right is that the gate USED to establish
  // hierarchy materially: it was 'dressed' ashlar, a visibly finer stone. When it
  // moved to the wall's stone (so a doorway's courses would line up with the
  // masonry they interrupt — see archway.ts) it gained alignment and lost
  // hierarchy, and nobody replaced the hierarchy.
  //
  // So: THE WALL'S TEXTURE, on the wall's world projection, so the alignment is
  // kept exactly. What comes off is the loud layers laid ON TOP of that texture —
  // world-space brick damage (the missing bricks and uneven coursework), the
  // groove fill and the seam glow — plus a third off the relief. Same stone,
  // same lighting, same quantisation; the mason simply took more care here.
  //
  // Reusing 'dressed's exact FLAG SET is deliberate rather than incidental. The
  // flags select the node graph, so an unprecedented combination would be a new
  // pipeline variant to warm and a compile hitch the first time a doorway comes
  // into view. This one has been compiled since the day dressed stone existed.
  registerSurfaceDetail('frame', {
    tex: wallTex,
    tile: SURFACE_TILE.wall, proj: 'wall', tint: [1.0, 1.0, 1.0],
    // 0.20 against the wall's 0.30 — the ~35% less surface breakup the note asked
    // for, taken off the channel that actually carries it.
    relief: 0.20,
  });
  const grainTex = bakeSurfaceTexture(renderer, 'grain');
  registerSurfaceDetail('grain', {
    tex: grainTex,
    tile: SURFACE_TILE.grain, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.05,
  });
  // ── CARVED — stone with NO DIRECTION IN IT ────────────────────────────────
  //
  // For geometry that is ROTATED out of the wall's frame: the voussoirs of an
  // arch, and anything else laid on a curve.
  //
  // Josh forwarded the diagnosis 2026-08-16 and it is exactly right: *"don't
  // world-project rectangular masonry straight through an arch, it'll look like
  // someone cut an arch-shaped hole through wallpaper."* The wall's detail is
  // DIRECTIONAL — courses run at world Y = k x COURSE_H — and a voussoir sits at
  // 40 degrees to that, so horizontal mortar lines run diagonally across a stone
  // that is visibly a wedge. The block says "I am laid around a curve" and the
  // texture on it says "I am part of a flat coursed wall".
  //
  // The fix is not an angular projection mode (that needs per-part orientation
  // in the shader, i.e. a material per voussoir). It is to use a pattern with NO
  // PREFERRED DIRECTION, at which point rotation stops mattering at all. That
  // texture already exists: 'grain' was baked for exactly this problem one
  // surface over — materials.ts, on the prop columns, "so a round shaft catches
  // torchlight without the masonry pattern smearing around its curve." A curve is
  // a curve.
  //
  // Relief 0.14 rather than grain's 0.05, because a voussoir is a hand-dressed
  // block that should still catch a lamp, where a column shaft wants to stay
  // quiet. Same texture, same flags, so no new pipeline variant.
  registerSurfaceDetail('carved', {
    tex: grainTex,
    tile: SURFACE_TILE.grain, proj: 'wall', tint: [1.0, 1.0, 1.0], relief: 0.14,
  });
  installNamedSurfaceDetail(propStone, 'grain');   // columns: faint grain only

  // The dark under a room's ceiling reads `aRoomY`, which only shell geometry carries. Installed
  // on exactly the two materials the level builders tag, so no other material asks for an
  // attribute it will never have — see setMaterialRoomTopDarkWebGPU.
  setMaterialRoomTopDarkWebGPU(wallBase);
  setMaterialRoomTopDarkWebGPU(ceilingBase);

  return {
    wall: wallBase,
    floor: floorBase,
    stair: stairBase,
    ceiling: ceilingBase,
    timber: timberBase,
    stone: propStone,
    dressed: dressedBase,
    chasmWall,
  };
}
