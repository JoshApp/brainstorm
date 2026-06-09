// Data-driven model definition. A ModelSpec is a list of geometric PARTS
// (primitives, lathe-revolved profiles, extruded 2D shapes, or sprites) plus
// optional named SLOTS (anchor points other models can be attached to) and an
// optional attached LIGHT. Materials are scoped to the model so per-instance
// state (hit-flash color, animated emissive intensity) doesn't bleed between
// instances of the same spec.
//
// What this enables:
//   - Author a new enemy as ~10 lines of JSON instead of writing a new class.
//   - Reuse the same model with different materials (palette swaps).
//   - Compose: attach a weapon model to an enemy's `weapon` slot.
//   - Animate by name: look up parts by their `name` field and mutate them.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// --- Materials ----------------------------------------------------------

export interface MaterialDef {
  color?: number;
  emissive?: number;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  /** 'auto' = use the current global style (flat = true for PSX-style). */
  flatShading?: boolean | 'auto';
  transparent?: boolean;
  opacity?: number;
  /** If false, the material ignores scene fog (use for first-person held items). */
  fog?: boolean;
  /**
   * Opt this material into a baked, mipmapped surface detail by NAME (see
   * style/surface-textures.ts) — e.g. 'dressed' (ashlar framing for archways /
   * doorframes), 'grain' (faint column grain). World-projected, so no UVs
   * needed. Registered at material-build time; unknown names no-op.
   */
  detail?: 'dressed' | 'grain';
  /**
   * Fresnel rim glow — brightens fragments where the surface normal
   * grazes the view direction (the silhouette edge). Classic "ghost
   * edge brightness" effect. `power` controls falloff (higher = thinner
   * rim). `intensity` scales the additive contribution. Implemented as
   * a per-fragment addition after lighting, so it pops on dark mobs.
   */
  rim?: {
    color: number; power?: number; intensity?: number;
    /**
     * 0..1 — make the rim DARKNESS-REACTIVE. At 0 (default) the rim is a
     * constant edge-sheen (the blade's hot rim). At 1 the rim carries the
     * form where scene light DOESN'T: full-strength on fragments the
     * torches leave dark, fading to a quarter where light catches them. The
     * "revealed in the dark, not silhouette" look as a MATERIAL property —
     * a creature self-draws its contour in glowing colour out of black,
     * with no light source needed.
     */
    darkReactive?: number;
  };
  /**
   * If true, the material is built with a `uDissolve` uniform (initially
   * 0). Setting it >0 at runtime ramps a top-down ragged dissolve effect
   * with an emissive edge. Used by mob deaths. Reference is stashed on
   * `mat.userData.uDissolve` so callers can mutate `.value` without
   * triggering a shader recompile.
   */
  dissolvable?: boolean;
}

// --- Parts (discriminated union) ---------------------------------------

interface PartCommon {
  /** Optional name — required if animations need to look this part up later. */
  name?: string;
  /**
   * Optional parent — name of another part OR a slot. If set, this part is
   * attached as a child of that node (its pos/rot/scale become relative to
   * the parent instead of the model root). Use to express hinges: parent the
   * chest lid to a 'hinge' slot at the back edge of the box, then rotating
   * the slot anchor swings the lid around that edge.
   */
  parent?: string;
  /** Local position within the parent (model root by default). Default [0,0,0]. */
  pos?: Vec3;
  /** Local rotation (Euler XYZ radians). Default [0,0,0]. */
  rot?: Vec3;
  /** Local scale. Default [1,1,1]. */
  scale?: Vec3;
  /** Cast shadows? Default true for solid meshes, false for sprites. */
  castShadow?: boolean;
  /** Receive shadows? Default true for solid meshes, false for sprites. */
  receiveShadow?: boolean;
  /**
   * Vertex jitter amplitude in meters. If > 0, each vertex of the
   * generated geometry is perturbed by a per-position random offset of
   * magnitude up to this value. Coincident vertices move together so
   * the surface stays watertight. Builds in once at construction —
   * costs nothing per frame. Use for organic / gnarled silhouettes
   * (zombies, ghosts, horrors) where clean primitive surfaces feel
   * too perfect.
   */
  jitter?: number;
}

export type PartSpec =
  // --- Primitives ---
  | (PartCommon & { kind: 'sphere'; radius: number; segments?: [number, number]; mat: string })
  | (PartCommon & {
      kind: 'box'; size: Vec3; mat: string;
      /** Rounded edges. When > 0, the box is built with RoundedBoxGeometry
       *  using `bevel` as the corner radius (meters). Use a value smaller
       *  than half of the smallest size dimension; otherwise the corners
       *  collapse into one another. Default = unrounded (hard edges).
       *  Per-edge subdivision count controlled by `bevelSegments`
       *  (default 3 — enough to read as soft without exploding the
       *  triangle budget). */
      bevel?: number;
      bevelSegments?: number;
    })
  | (PartCommon & { kind: 'capsule'; radius: number; height: number; mat: string })
  | (PartCommon & { kind: 'cylinder'; radius: number; radiusTop?: number; height: number; segments?: number; mat: string })
  | (PartCommon & { kind: 'cone'; radius: number; height: number; segments?: number; mat: string })
  // --- Bones (joint-first authoring) ---
  // A cylinder that automatically spans two named slots. Author the
  // JOINTS (slots) at the angles you want; the bone's position,
  // rotation, and length are computed from the slot positions at
  // build time. Moving a joint reflows every bone connected to it —
  // no more humerus-floating-off-the-shoulder gap bugs.
  //
  // Convention: `from` is the PROXIMAL joint (closer to the rig's
  // root), `to` is DISTAL. `parent` defaults to the `from` slot, so
  // rotating that joint swings the bone naturally. Set `parent`
  // explicitly only for unusual rigs.
  //
  // The bone's pos/rot in PartCommon are IGNORED — they're computed.
  // `offset` (in parent-local, perpendicular to the bone) lets two
  // bones share endpoints (radius + ulna in a forearm) without each
  // needing its own slot pair.
  | (PartCommon & {
      kind: 'bone';
      from: string;
      to: string;
      radius: number;
      radiusTop?: number;
      segments?: number;
      offset?: Vec3;
      mat: string;
    })
  // --- Profiled / extruded geometry ---
  // Lathe: rotate a 2D profile (defined as [r, y] points) around the Y axis.
  // Good for chalices, columns, bottles, fluted blades, lantern globes.
  | (PartCommon & { kind: 'lathe'; profile: Vec2[]; segments?: number; mat: string })
  // Extrude: push a closed 2D shape (defined as [x, y] points) into 3D depth.
  // Good for keys, skull silhouettes, runes, gears, irregular flat objects.
  //
  // Bevel knobs — three's ExtrudeGeometry already does these; we just
  // surface them. `bevel: true` enables the bevel with sensible defaults
  // (a small rounded edge); `bevelSize`/`bevelThickness`/`bevelSegments`
  // let an author tune it further (e.g. a deep blade fuller). All omitted
  // bevel fields fall back to three's defaults.
  | (PartCommon & {
      kind: 'extrude'; shape: Vec2[]; depth: number; mat: string;
      bevel?: boolean;
      bevelSize?: number;        // how far the bevel sticks out past the outline
      bevelThickness?: number;   // how deep into the shape the bevel cuts
      bevelSegments?: number;    // curve resolution
    })
  // --- Constructive Solid Geometry ---
  // CSG: boolean op between two child specs. Powered by three-bvh-csg
  // (BVH-accelerated, build-time only; we don't re-evaluate per frame).
  // Resulting mesh's pos/rot/scale + material come from THIS spec, NOT
  // from the children — children only contribute their shape. The two
  // operands ARE built at their authored local positions, so the child
  // pos/rot are how you place B relative to A.
  //
  // Operations:
  //   'subtract'   — A minus B (carve B out of A)
  //   'add'        — A union B (fuse into one watertight shape)
  //   'intersect'  — keep only the overlap region
  //
  // Watertight input matters: closed primitives (sphere, capsule,
  // closed cylinder/cone, box, lathe with a closed profile) are safe.
  // Open shapes (sprite, decal, line, anything 2D) will produce
  // garbage and are runtime-rejected. Nest with care — the research
  // says LLM CSG state tracking degrades after 2-3 levels of nesting.
  | (PartCommon & {
      kind: 'csg';
      op: 'subtract' | 'add' | 'intersect';
      a: PartSpec;
      b: PartSpec;
      mat: string;
    })
  // Torus (ring/donut). Centered at pos with the hole's axis along local Z.
  // Useful for: jewelry, rings, halo geometry, lamp shades.
  | (PartCommon & { kind: 'torus'; radius: number; tube: number; segments?: Vec2; mat: string })
  // --- Sprites ---
  // 2D textured quad that always faces the camera. Texture is generated by a
  // registered procedural generator (see src/style/procedural-textures.ts).
  // Good for fire wisps, particles, distant figures, signage.
  //
  // Optional `flicker` attaches a built-in onBeforeRender wobble — uses
  // Date.now() so no external tick is needed. Useful for cheap "alive"
  // animation on bonfire/torch sprites without registering them with the
  // torchlight flicker system.
  | (PartCommon & {
      kind: 'sprite';
      size: Vec2;
      texture: string;
      color?: number;
      blending?: 'normal' | 'additive';
      /** 0..1 transparency. Default 1. */
      opacity?: number;
      flicker?: {
        /** Scale wobble amplitude as a fraction (e.g. 0.15 = ±15%). */
        scale?: number;
        /** Y position wobble in metres (additive on top of `pos.y`). */
        bob?: number;
        /** Oscillation speed in Hz. */
        speed: number;
        /** Phase offset in seconds. Defaults to a random per-build value
         *  so multiple instances of the same model don't sync. */
        phase?: number;
      };
    })
  // --- Decals ---
  // 2D textured plane with explicit orientation (does NOT billboard). Use for
  // wall/floor decoration: moss patches, blood splatter on the floor, soot
  // streaks on walls, runic glyphs. pos/rot place the plane in world space.
  //
  // Default is a lit, alpha-blended decal (MeshStandardMaterial). Pass
  // `blending: 'additive'` for unlit emissive shapes that add over what's
  // behind them — light shafts, glow planes, god rays. With additive
  // blending the material switches to MeshBasicMaterial (color is the
  // emitted hue; `emissive` is ignored) and `fog`/`depthWrite` default
  // to false to keep the glow from being eaten by fog or occluding
  // particles behind it.
  | (PartCommon & {
      kind: 'decal';
      size: Vec2;
      texture: string;
      color?: number;
      emissive?: number;
      emissiveIntensity?: number;
      blending?: 'normal' | 'additive';
      /** Set to render as an OPAQUE alpha-CUTOUT (transparent gaps discarded at
       *  this threshold) instead of alpha-blended. Writes depth and casts a real
       *  texture-shaped shadow — robust on mobile (no transparency sorting). */
      alphaTest?: number;
      /** Default true for normal, false for additive. */
      fog?: boolean;
      /** Default true for normal, false for additive. */
      depthWrite?: boolean;
      /** 0..1 transparency. Default 1. */
      opacity?: number;
    });

// --- Slots & lights -----------------------------------------------------

export interface SlotSpec {
  pos: Vec3;
  rot?: Vec3;
  /**
   * Optional parent — another slot or a named part. When set, the slot
   * is nested under that node so it inherits its transform (and its
   * `pos`/`rot` are interpreted in the parent's local space). Used for
   * jointed rigs: a shoulder slot parented to the body `rig` swings the
   * arm AND follows the body's lean. Default: direct child of the model
   * root. */
  parent?: string;
  /**
   * Marks the slot as an EDITOR ANCHOR — a part of the model the
   * author cares about referring to by axis when iterating. The
   * in-game HAND AXES overlay (Settings → Debug) draws an RGB triad
   * at every slot whose `debug === 'axes'`. Slots without this flag
   * are invisible to the overlay even when toggled on.
   *
   * Use sparingly — one per "thing you might want to rotate" (wrist,
   * fingertips, upper arm, lower arm). Don't tag PIP / DIP / contact
   * slots; you don't want 30 axis crosses fighting for attention.
   */
  debug?: 'axes';
}

export interface LightSpec {
  color: number;
  intensity: number;
  distance: number;
  decay: number;
  pos?: Vec3;
  castShadow?: boolean;
  shadowMapSize?: number;
  shadowBias?: number;
}

// --- The model spec itself ---------------------------------------------

/**
 * Shadow participation for a whole model — the prop-author intent knob. The
 * player's lamp is a PointLight, so a CASTER re-renders into the shadow cube's
 * 6 faces every frame; casting is the expensive half, receiving is cheap. Pick
 * by what the prop IS:
 *   - 'both'    cast + receive. Structural mass that anchors a room — pillars,
 *               buttresses, fallen columns, large rubble mounds, statues.
 *               (Default — unchanged from before this knob existed.)
 *   - 'receive' catch shadows but throw none. Medium floor clutter that should
 *               sit IN the lighting without paying the cast — small mounds,
 *               vases, breakables near the player.
 *   - 'cast'    throw a shadow, don't receive (rare).
 *   - 'none'    neither. Tiny floor/wall clutter + decals too small to read a
 *               cast — bones, shards, sand, ash, cracks, scorch, planks, grates.
 * A per-part `castShadow`/`receiveShadow` still overrides this for one mesh.
 */
export type ShadowRole = 'both' | 'cast' | 'receive' | 'none';

export interface ModelSpec {
  id: string;
  parts: PartSpec[];
  /** Whole-model shadow intent (see ShadowRole). Default 'both'. */
  shadow?: ShadowRole;
  /**
   * Opt into the "lego-figure" merge (see mergeRigidSegments): after build,
   * collapse the unnamed non-sprite meshes under each joint into one mesh per
   * material. Joints still move (arms/legs/head animate), named parts + sprites
   * stay separate. Big draw + shadow-caster win for many-part rigs (enemies).
   */
  mergeRigid?: boolean;
  /** Named anchor points for attaching other models / lights / effects. */
  slots?: Record<string, SlotSpec>;
  /** Optional attached light (e.g. torch glow). */
  light?: LightSpec;
  /** Materials this model uses, keyed by `mat` field on parts. */
  materials: Record<string, MaterialDef>;
  /**
   * If true, the BUILDER recolours this model's flame materials + any
   * additive sprite particles + its attached light to match the room's
   * average torch tint at spawn time. Used by candles so a yellow
   * floor candle becomes violet in a violet vault, sickly-green in a
   * green vault, etc. — without each vault having to author a tinted
   * variant.
   *
   * Limits: only mutates materials named 'flame' and additive sprite
   * particles. Wax / iron / wood stay the same. Fixtures with a
   * SIGNATURE colour (bonfire embers, fountain shine, named floor
   * glows) intentionally don't set this — their palette is the point.
   */
  moodTintable?: boolean;
}
