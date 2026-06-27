import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import type { AimDir, MaterialDef, ModelSpec, PartSpec, PropClass, ShadowRole, Vec3 } from './model-types';
import { shadowFlags } from '../scene/shadow-role';
import { orient, tilt, DIR, type Vec3Tuple } from '../anim/orient';
import { getTexture } from '../style/procedural-textures';
import { installNamedSurfaceDetail } from '../style/surface-detail';
import { uSplatTex, uSplatBounds, uSplatOn } from '../scene/splat-map';
import { isWebGPU } from '../scene/renderer-mode';
import { setMaterialChromaWebGPU } from '../style/banded-lighting-webgpu';
import { vec3, normalWorld, positionWorld, cameraPosition, positionGeometry, uniform as tslUniform, float as tslFloat, smoothstep as tslSmoothstep } from 'three/tsl';
import {
  pooledBox, pooledSphere, pooledCylinder, pooledCone, pooledTorus, pooledCapsule,
} from '../scene/geometry-pool';

// One Evaluator instance reused across every CSG build — internally
// reusable state, no shared output. Cheap to keep around.
const CSG_EVAL = new Evaluator();

// buildModel — turn a ModelSpec into a live THREE.Group with named parts,
// slot anchors, fresh per-instance materials, and an optional attached light.
//
// The returned BuiltModel gives O(1) lookup of parts/slots/materials by name
// so animations and effects can find what they need without traversing the
// scene graph each frame.

export interface BuiltModel {
  group: THREE.Group;
  parts: Map<string, THREE.Object3D>;
  slots: Map<string, THREE.Object3D>;
  /** All materials created for this model, keyed by material id. */
  materials: Map<string, THREE.Material>;
  /** Hit targets — meshes that should accept raycast from combat. Excludes sprites. */
  hitTargets: THREE.Object3D[];
  light?: THREE.PointLight;
}

// Model-level shadow default for the build currently in flight. buildModel is
// fully synchronous (no await) and never re-entrant across models, so a module
// scalar is safe and saves threading the default through every buildPart /
// makeMesh / buildCsg / decal call. A per-part castShadow/receiveShadow still
// overrides it (`part.castShadow ?? curShadow.cast`).
let curShadow: { cast: boolean; receive: boolean } = { cast: true, receive: true };
// Per-material unique id for WebGPU. three.webgpu otherwise shares render BINDINGS
// (not just the compiled program) across structurally-identical materials, so removing
// one dissolving/flashing mob leaves its uniform state stuck on the whole species
// (the death-dissolve / hit-sheen "all mobs break" bug). A unique programCacheKey per
// material instance isolates the bindings. See installRevealWebGPU.
let webgpuMatSeq = 0;

// Render policy per prop class — the single table the `class` knob resolves
// through. Casting is the expensive half (the lamp re-renders every caster into
// its 6 cube faces each frame), so the class declares what a prop IS and the
// shadow role follows. See PropClass for the intent behind each row.
const PROP_CLASS_POLICY: Record<PropClass, { shadow: ShadowRole }> = {
  clutter:    { shadow: 'none' },      // flat dull scatter — casts nothing
  structural: { shadow: 'both' },      // architectural mass — casts + receives
  decor:      { shadow: 'receive' },   // material character, needn't cast
};

/** Effective shadow role for a model: class default, overridden by the raw
 *  `shadow` knob, falling back to legacy (cast+receive) when neither is set. */
export function propClassShadow(spec: ModelSpec): ShadowRole | undefined {
  return spec.shadow ?? (spec.class ? PROP_CLASS_POLICY[spec.class].shadow : undefined);
}

export function buildModel(spec: ModelSpec): BuiltModel {
  const flatShadingDefault = false;   // PS1 is the only style; smooth shading
  curShadow = shadowFlags(propClassShadow(spec));

  // Fresh material instances per-model (so hit-flash on one ghoul doesn't
  // tint another, etc.).
  const materials = new Map<string, THREE.Material>();
  for (const [id, def] of Object.entries(spec.materials)) {
    materials.set(id, createMaterial(def, flatShadingDefault));
  }

  const group = new THREE.Group();
  const parts = new Map<string, THREE.Object3D>();
  const hitTargets: THREE.Object3D[] = [];

  // PASS 1: create slots + reparent slot-to-slot. We do the slot
  // reparenting BEFORE building parts so that the 'bone' primitive
  // (which spans two slots) can read the slots' world transforms
  // when computing its position/rotation/length. Slots that parent
  // to NAMED PARTS get reparented later in pass 4 (parts don't exist
  // yet here).
  const slots = new Map<string, THREE.Object3D>();
  if (spec.slots) {
    for (const [name, slotSpec] of Object.entries(spec.slots)) {
      const anchor = new THREE.Object3D();
      anchor.position.fromArray(slotSpec.pos);
      if (slotSpec.rot) anchor.rotation.fromArray(slotSpec.rot);
      anchor.name = `slot:${name}`;
      // Surface the spec's `debug` flag onto userData so runtime
      // overlays (e.g. the in-game HAND AXES) can filter to author-
      // tagged anchors without re-walking the spec tree.
      if (slotSpec.debug) anchor.userData.debug = slotSpec.debug;
      group.add(anchor);
      slots.set(name, anchor);
    }
    for (const [name, slotSpec] of Object.entries(spec.slots)) {
      if (!slotSpec.parent) continue;
      const parentSlot = slots.get(slotSpec.parent);
      if (!parentSlot) continue;   // slot-parented-to-part is handled in pass 4
      const node = slots.get(name);
      if (node) parentSlot.add(node);
    }
  }
  // Slot world transforms are now correct; bone primitives will read
  // them via getWorldPosition + worldToLocal.
  group.updateMatrixWorld(true);

  // PASS 2: build all parts (non-bone go through the regular path;
  // bone parts get the slot context they need to compute their pose).
  const builtParts: THREE.Object3D[] = [];
  for (const part of spec.parts) {
    const obj = part.kind === 'bone'
      ? buildBone(part, slots, parts, group, materials)
      : buildPart(part, materials);
    applyTransform(obj, part);
    if (part.name) {
      obj.name = part.name;
      parts.set(part.name, obj);
    } else {
      // Diagnostic label for unnamed parts — the bench's structural
      // linter (readout.ts findFloatingIslands) reports THIS, so a
      // floating island reads as "cone·fur@0,-0.012,-0.12", not
      // "mesh#10". Cheap (string at build), zero runtime use.
      // `userData.autoName` marks the name as DIAGNOSTIC, not authored —
      // consumers that treat "named" as "referenced by code/animation"
      // (mergeRigidSegments, creature instancing) check this flag so the
      // label doesn't make the part look load-bearing. Without it, the
      // lego-figure merge silently became a no-op the day these labels
      // were added (every part suddenly "had a name").
      const mat = 'mat' in part ? (part as { mat?: string }).mat : undefined;
      const at = part.pos ? `@${part.pos.map((n) => Math.round(n * 1000) / 1000).join(',')}` : '';
      obj.name = `${part.kind}${mat ? '·' + mat : ''}${at}`;
      obj.userData.autoName = true;
    }
    group.add(obj);
    if (part.kind !== 'sprite' && part.kind !== 'bone') hitTargets.push(obj);
    builtParts.push(obj);
  }

  // PASS 3: reparent any part with a `parent` field to its parent node.
  // Names are NOT required — we look up the built object by index. Without
  // this, unnamed children stayed at the model root, often INSIDE other meshes.
  //
  // Bones get an IMPLICIT parent of their `from` slot — the geometry was
  // computed in that slot's local frame, so the mesh has to live there too
  // or it renders at the model root using shoulder-local coords (= floating
  // far from the joint).
  for (let i = 0; i < spec.parts.length; i++) {
    const part = spec.parts[i];
    const parentName = part.parent ?? (part.kind === 'bone' ? part.from : undefined);
    if (!parentName) continue;
    const child = builtParts[i];
    let parentNode = parts.get(parentName) ?? slots.get(parentName);
    if (!parentNode) {
      // eslint-disable-next-line no-console
      console.warn(`Part references unknown parent "${parentName}"`);
      continue;
    }
    // Resolve a self-reference to the SLOT of the same name. This is the
    // common creature pattern where a skin part is NAMED after the joint
    // it hangs on (e.g. the king-ooze 'core' orb sits on the 'core'
    // joint — and the orb must keep the name 'core' so the presentation
    // layer can find it via flashMaterialName). Parts are looked up
    // before slots, so the part finds ITSELF; the intent is the joint.
    // Fall back to the slot so the part lands on its joint (correct
    // position) instead of THREE rejecting add(self) and stranding it at
    // the model root.
    if (parentNode === child) {
      const slot = slots.get(parentName);
      if (slot && slot !== child) {
        parentNode = slot;
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[${spec.id}] part "${parentName}" is parented to itself with no slot of that name — leaving at root`);
        continue;
      }
    }
    parentNode.add(child);
  }

  // PASS 4: nest any SLOT that declares a parent on a named PART (slot-
  // to-slot already happened in pass 1). Enables jointed rigs where a
  // slot's transform should follow a part — e.g. a candle slot
  // parented to a 'base' part.
  if (spec.slots) {
    for (const [name, slotSpec] of Object.entries(spec.slots)) {
      if (!slotSpec.parent) continue;
      if (slots.has(slotSpec.parent)) continue;   // already reparented in pass 1
      const node = slots.get(name);
      const parentNode = parts.get(slotSpec.parent);
      if (!node) continue;
      if (!parentNode) {
        // eslint-disable-next-line no-console
        console.warn(`Slot "${name}" references unknown parent "${slotSpec.parent}"`);
        continue;
      }
      parentNode.add(node);
    }
  }

  // Lights are NOT created here anymore — every PointLight in the scene
  // is owned by src/scene/light-pool.ts. buildModel reports the model's
  // optional light SPEC (color/intensity/distance/decay/local-pos) and
  // leaves it up to the caller to register a logical source with the
  // pool. This is the architectural change that lets us have many more
  // logical light sources than the GPU could afford as real PointLights.
  return { group, parts, slots, materials, hitTargets, light: undefined };
}

/**
 * "Lego-figure" merge for rigged models. Under EACH node, the unnamed,
 * non-sprite child meshes are collapsed into one mesh per material, their local
 * transforms baked into the geometry. What's preserved:
 *   - JOINT NODES (rig / shoulders / hips / neck slots) keep their own
 *     transform, so each joint's merged chunk still moves as a unit — arms
 *     swing, legs gait, head cranes. The merge is per-node, never across a joint.
 *   - NAMED parts (the animation/presentation looks them up by name — 'body',
 *     'head', a glowing core) stay separate.
 *   - SPRITES (eye halos, billboards) stay separate.
 * A ~27-mesh skeleton collapses to ~8-10 meshes — and the same drop in shadow
 * casters — with zero animation change. Call right after buildModel; opt in via
 * ModelSpec.mergeRigid so only rigged content (enemies) takes it.
 *
 * `ignoreNames`: also fold NAMED parts in. Use only for content that never
 * animates or looks up parts by name after build — e.g. a ground PICKUP, whose
 * drop model is often a weapon viewmodel with named parts (for the held swing)
 * that are dead weight once it's a static, whole-group-bobbing pickup.
 */
export function mergeRigidSegments(built: BuiltModel, opts?: { ignoreNames?: boolean }): void {
  const ignoreNames = opts?.ignoreNames ?? false;
  const nodes: THREE.Object3D[] = [];
  built.group.traverse((o) => nodes.push(o));   // snapshot — we mutate children below
  for (const node of nodes) {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of node.children) {
      const m = child as THREE.Mesh;
      const isSprite = (m as unknown as { isSprite?: boolean }).isSprite === true;
      // "Named" means AUTHORED-named (animation/presentation looks it up).
      // Diagnostic labels (userData.autoName) don't protect a part from the
      // merge — they're debug strings, not references.
      const authoredName = !!m.name && m.userData.autoName !== true;
      if (!m.isMesh || isSprite || (!ignoreNames && authoredName) || !m.geometry) continue;
      const mat = m.material as THREE.Material;
      const arr = byMat.get(mat);
      if (arr) arr.push(m); else byMat.set(mat, [m]);
    }
    for (const [mat, meshes] of byMat) {
      if (meshes.length < 2) continue;   // nothing to save
      const geos: THREE.BufferGeometry[] = [];
      for (const m of meshes) {
        m.updateMatrix();
        const baked = m.geometry.clone().applyMatrix4(m.matrix);   // bake LOCAL transform
        // Normalize to NON-INDEXED so a group mixing indexed (box/cylinder) and
        // non-indexed (RoundedBox/bevel, CSG) geometries still merges — otherwise
        // mergeGeometries rejects the mismatch. Creatures freely mix shapes per
        // joint, so this must be robust.
        if (baked.index) { const ni = baked.toNonIndexed(); baked.dispose(); geos.push(ni); }
        else geos.push(baked);
      }
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;   // attribute mismatch — leave the originals intact
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = meshes[0].castShadow;
      mesh.receiveShadow = meshes[0].receiveShadow;
      node.add(mesh);
      // Originals were never rendered (merge runs before the model is added to
      // the scene), so their GPU buffers were never uploaded — just detach.
      for (const m of meshes) node.remove(m);
    }
  }
  // Hit targets referenced the now-removed meshes; rebuild from survivors.
  built.hitTargets.length = 0;
  built.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) built.hitTargets.push(m);
  });
}

/** Mint a material from a MaterialDef — same path buildModel uses for its
 *  per-model materials. Exported for the creature-instancing batches, which
 *  need ONE shared material per segment batch built from the same def (rim/
 *  chroma extensions included) rather than borrowing any single enemy's
 *  per-instance material. */
export function createMaterialFromDef(def: MaterialDef, defaultFlatShading = false): THREE.Material {
  return createMaterial(def, defaultFlatShading);
}

function createMaterial(def: MaterialDef, defaultFlatShading: boolean): THREE.Material {
  const flatShading =
    def.flatShading === 'auto' ? defaultFlatShading : (def.flatShading ?? false);
  const mat = new THREE.MeshStandardMaterial({
    color: def.color,
    // Default the optional fields — passing `undefined` to the material
    // constructor makes THREE warn ("parameter 'emissive' has value of
    // undefined") on EVERY built model, which spammed the console on each
    // enemy/prop spawn. Equivalent to THREE's own defaults, just stated.
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 1,
    roughness: def.roughness ?? 0.95,
    metalness: def.metalness ?? 0,
    flatShading,
    transparent: def.transparent ?? false,
    opacity: def.opacity ?? 1,
    fog: def.fog ?? true,
  });

  // Inject custom GLSL for rim glow + dissolve. We do this once at
  // build time so the shader compiles during warmup; the death sequence
  // mutates uniform values at runtime, which doesn't trigger a recompile.
  attachShaderExtensions(mat, def);
  // Opt-in baked surface detail (dressed framing / column grain). Chains after
  // the rim/dissolve onBeforeCompile; no-ops if the named config isn't found.
  if (def.detail) installNamedSurfaceDetail(mat, def.detail);
  return mat;
}

/**
 * Inject custom rim + dissolve passes into a MeshStandardMaterial via
 * onBeforeCompile. The injected code runs AFTER lighting + tonemapping
 * but BEFORE dithering — so the rim color isn't washed by tone curves
 * and reads as the stylized accent we want.
 *
 * Uniforms are stashed on `mat.userData` so callers can mutate values
 * (dissolve.value = 0.4) without going through Three.js's per-frame
 * uniform tracking. Three.js still pushes the bound uniforms to GPU
 * each render — we just write into the box it reads from.
 *
 * `customProgramCacheKey` lets shader programs share across material
 * instances with the same shape (same set of injected extensions),
 * avoiding a fresh compile per enemy spawn.
 */
function attachShaderExtensions(mat: THREE.MeshStandardMaterial, def: MaterialDef): void {
  const hasRim = !!def.rim;
  const hasDissolve = !!def.dissolvable;
  const hasChroma = def.chroma != null && def.chroma !== 1;
  // GORE CREEP — every opaque lit prop/creature surface samples the
  // floor's splat map by world XZ with a height fade: crates standing
  // in pools get bloodied at the base, mobs wading through gore pick
  // it up on their feet. Per-fragment world position means instanced
  // batches work unmodified. Skipped for transparent/additive
  // materials (blood on a flame would be wrong).
  const hasGore = mat.transparent !== true && mat.blending === THREE.NormalBlending;
  if (!hasRim && !hasDissolve && !hasChroma && !hasGore) return;

  // WEBGPU: onBeforeCompile is dead under the node renderer. Port the RIM REVEAL
  // (the core "forms emerge from black" identity) as a TSL emissive node. The
  // situational effects — dissolve (death crumble), gore creep, chroma (PAINTED
  // over-saturation) — still need their own node ports; see WEBGPU-MIGRATION.md.
  if (isWebGPU()) {
    installRevealWebGPU(mat, def);
    // Isolate this material's render bindings so per-material uniforms (uDissolve, the
    // hit/death flash, chroma) can't leak across the species when a mob dies + is removed.
    const matKey = 'delve-mat-' + (webgpuMatSeq++);
    (mat as unknown as { customProgramCacheKey: () => string }).customProgramCacheKey = () => matKey;
    return;
  }

  const uRimColor   = { value: new THREE.Color(def.rim?.color ?? 0xffffff) };
  const uRimPower   = { value: def.rim?.power ?? 2.5 };
  const uRimIntens  = { value: def.rim?.intensity ?? 1.0 };
  const uRimDark    = { value: def.rim?.darkReactive ?? 0 };
  const uChroma     = { value: def.chroma ?? 1 };
  const uDissolve   = { value: 0 };

  // Expose for external mutation. Death sequence reads userData.uDissolve.
  mat.userData.uDissolve = uDissolve;

  // Stable cache key so two wraiths (different instances, same def shape)
  // hit the same compiled program. Different shapes get different keys.
  const cacheKey = `enemy-ext|${hasRim ? '1' : '0'}|${hasDissolve ? '1' : '0'}|${hasChroma ? '1' : '0'}|${hasGore ? '1' : '0'}`;
  mat.customProgramCacheKey = () => cacheKey;

  mat.onBeforeCompile = (shader) => {
    if (hasRim) {
      shader.uniforms.uRimColor  = uRimColor;
      shader.uniforms.uRimPower  = uRimPower;
      shader.uniforms.uRimIntens = uRimIntens;
      shader.uniforms.uRimDark   = uRimDark;
    }
    if (hasChroma) {
      shader.uniforms.uChroma    = uChroma;
    }
    if (hasDissolve) {
      shader.uniforms.uDissolve  = uDissolve;
    }
    if (hasGore) {
      // Distinct names from surface-detail's uSplat* — a material can
      // carry BOTH injections (dressed archways), and duplicate GLSL
      // uniform declarations are a compile error (invisible meshes).
      shader.uniforms.uGoreT = uSplatTex as unknown as THREE.IUniform;
      shader.uniforms.uGoreB = uSplatBounds as unknown as THREE.IUniform;
      shader.uniforms.uGoreO = uSplatOn as unknown as THREE.IUniform;
    }

    // Vertex: capture local position so the dissolve noise is stable in
    // world (doesn't shift as the camera moves). `transformed` is the
    // canonical "post-vertex-shader local position" variable in
    // three.js's shader chunks.
    if (hasDissolve) {
      shader.vertexShader = `varying vec3 vLocalPos;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLocalPos = transformed;',
      );
    }
    if (hasGore) {
      // Instancing-aware world position (the batched creatures are
      // InstancedMeshes — modelMatrix alone would park them at origin).
      shader.vertexShader = `varying vec3 vGoreWorld;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec4 gw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    gw = instanceMatrix * gw;
  #endif
  vGoreWorld = (modelMatrix * gw).xyz;
}`,
      );
    }

    // Fragment: declare uniforms + varyings, then inject the rim +
    // dissolve passes just before the final dithering chunk. This
    // ordering ensures lighting is fully applied first, and our
    // additive contributions get the same dither treatment as the
    // base color.
    let frag = '';
    if (hasDissolve) {
      frag += 'varying vec3 vLocalPos;\nuniform float uDissolve;\n';
    }
    if (hasRim) {
      frag += 'uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimIntens;\nuniform float uRimDark;\n';
    }
    if (hasChroma) {
      frag += 'uniform float uChroma;\n';
    }
    if (hasGore) {
      frag += 'varying vec3 vGoreWorld;\nuniform sampler2D uGoreT;\nuniform vec4 uGoreB;\nuniform float uGoreO;\n';
    }
    shader.fragmentShader = frag + shader.fragmentShader;

    const injection = `
      ${hasGore ? `
      // Gore creep — same composite-stage recolour as the floors
      // (albedo math dies under the PSX quantize on dark surfaces).
      {
        vec2 gUv = (vGoreWorld.xz - uGoreB.xy) / uGoreB.zw;
        if (gUv.x > 0.0 && gUv.x < 1.0 && gUv.y > 0.0 && gUv.y < 1.0) {
          vec4 gs = texture2D(uGoreT, gUv) * uGoreO;
          float gw = clamp(gs.a, 0.0, 1.0) * clamp(1.0 - vGoreWorld.y / 0.55, 0.0, 1.0);
          if (gw > 0.004) {
            float glum = dot(gl_FragColor.rgb, vec3(0.45, 0.35, 0.2));
            float gmaxc = max(gs.r, max(gs.g, gs.b));
            float gminc = min(gs.r, min(gs.g, gs.b));
            float gfresh = smoothstep(0.08, 0.40, gmaxc - gminc);
            vec3 ghue = gs.rgb / max(gmaxc, 0.10);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, glum * ghue * mix(0.55, 1.45, gfresh), gw * 0.8);
          }
        }
      }
      ` : ''}
      ${hasChroma ? `
      // PAINTED mode — push the fully-lit colour away from its own luma to
      // over-saturate whatever coloured light the room cast onto this pale
      // matte surface (a faint red room → vividly red bone). Runs first so the
      // rim (if any) adds on top of the saturated base. max() guards the
      // extrapolation from going negative.
      {
        float pl = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor.rgb = max(mix(vec3(pl), gl_FragColor.rgb, uChroma), 0.0);
      }
      ` : ''}
      ${hasDissolve ? `
      if (uDissolve > 0.0) {
        // GRIMDARK CRUMBLE. Discard is driven by a hash QUANTIZED into coarse
        // cells (floor of local pos), so the body breaks into chunky flakes —
        // not the per-pixel "TV static" a raw per-fragment hash gives — which
        // suits the blocky PS1 look. Spread across 0..1 so it erodes
        // progressively over the whole ramp (the per-joint meshes have a tiny
        // local-Y span, so a Y sweep alone would plop the whole body at once);
        // a faint top-down lean rides on top for direction.
        float n = fract(sin(dot(floor(vLocalPos * 13.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float thresh = n * 0.85 + (vLocalPos.y * 0.5 + 0.5) * 0.15;
        if (thresh < uDissolve) discard;
        float front = thresh - uDissolve;   // 0 at the erosion edge, grows inward
        // HEAT — flakes glow HOT before they crumble. A wide additive band, so
        // the smoldering front READS regardless of base albedo: on a pale skeleton
        // the char alone read fine, but on a near-black ghoul darkening did
        // nothing and chunks just flickered out. Heating them makes a dark mob
        // show a sweeping ember front too.
        float heat = 1.0 - smoothstep(0.0, 0.16, front);
        gl_FragColor.rgb += vec3(1.0, 0.40, 0.10) * (heat * heat) * (0.5 + 0.9 * uDissolve);
        // CHAR — a thin black scorch right at the crumble edge (the flake burning
        // through), so the front has a dark lip under the glow.
        gl_FragColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 0.045, front));
        // CORE — the hottest sliver at the very edge.
        float core = 1.0 - smoothstep(0.0, 0.02, front);
        gl_FragColor.rgb += vec3(1.0, 0.72, 0.34) * core * uDissolve;
      }
      ` : ''}
      ${hasRim ? `
      // Fresnel rim — brightest where surface normal grazes the view ray.
      // pow() controls falloff (high power = thin rim, low power = soft).
      vec3 viewDir = normalize(vViewPosition);
      float rim = 1.0 - max(dot(viewDir, normalize(vNormal)), 0.0);
      rim = pow(rim, uRimPower);
      // DARKNESS-REACTIVE (uRimDark): the rim carries the form where scene
      // light doesn't. gl_FragColor is the fully-lit colour here, so its
      // luma tells us how lit this fragment already is — scale the rim up in
      // shadow, down in light. uRimDark 0 = constant rim (unchanged).
      float litLuma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float darkGate = mix(1.0, mix(1.0, 0.22, clamp(litLuma, 0.0, 1.0)), uRimDark);
      gl_FragColor.rgb += uRimColor * rim * uRimIntens * darkGate;
      ` : ''}
    `;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `${injection}\n#include <dithering_fragment>`,
    );
  };
}

/** WEBGPU rim reveal — additive fresnel emissive ("forms emerge from black").
 *  The GLSL seam's rim was darkness-reactive (brighter where scene light isn't);
 *  an emissive node can't read the final lit luma, so this is the constant-rim
 *  approximation (the darkReactive dimming is deferred). World-space fresnel so
 *  it's unambiguous regardless of the node renderer's view-space conventions. */
function installRevealWebGPU(mat: THREE.MeshStandardMaterial, def: MaterialDef): void {
  // PAINTED chroma — over-saturate toward the room's coloured light (pale bone in
  // a red room → vivid red). Runs via a per-material banded+chroma lighting model.
  if (def.chroma != null && def.chroma !== 1) setMaterialChromaWebGPU(mat, def.chroma);

  const hasRim = !!def.rim;
  const hasDissolve = !!def.dissolvable;
  if (!hasRim && !hasDissolve) return;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const e = mat.emissive, ei = mat.emissiveIntensity;
  let emissive: any = (vec3 as any)(e.r * ei, e.g * ei, e.b * ei);

  // RIM — fresnel emissive ("forms emerge from black"). World-space so it's
  // unambiguous under the node renderer's conventions. (darkReactive deferred.)
  if (hasRim) {
    const power = def.rim!.power ?? 2.5;
    const intens = def.rim!.intensity ?? 1.0;
    const c = new THREE.Color(def.rim!.color ?? 0xffffff);
    const viewDir = (cameraPosition as any).sub(positionWorld).normalize();
    const fres = (normalWorld as any).dot(viewDir).clamp(0, 1).oneMinus().pow(power);
    emissive = emissive.add((vec3 as any)(c.r, c.g, c.b).mul(fres).mul(intens));
  }

  // DISSOLVE — death crumble. The body erodes by chunky cells (alpha-cutout) with
  // a smoldering ember front. Port of the GLSL onBeforeCompile path; the death
  // sequence ramps userData.uDissolve 0→1 (a TSL uniform exposes .value the same
  // way the {value} object did). Inert at 0 (gated by `active`).
  if (hasDissolve) {
    const uDissolve: any = (tslUniform as any)(0);
    mat.userData.uDissolve = uDissolve;
    // Stable bind-space position → chunky cell hash (floor) = blocky flakes, not
    // per-pixel static; a faint top-down lean rides on top.
    const lp: any = positionGeometry;
    const cell = lp.mul(13.0).floor();
    const n = cell.dot((vec3 as any)(12.9898, 78.233, 37.719)).sin().mul(43758.5453).fract();
    const thresh = n.mul(0.85).add(lp.y.mul(0.5).add(0.5).mul(0.15));
    const front = thresh.sub(uDissolve);
    const dissolving = uDissolve.greaterThan(0.0);
    const active = (dissolving as any).select((tslFloat as any)(1), (tslFloat as any)(0));
    // Erode: discard a cell ONLY while actually dissolving AND its threshold has
    // been passed. Gating on `dissolving` guarantees full opacity at rest — else a
    // few low-threshold cells could alpha-test away on a living mob (the ghoul, a
    // dissolvable body with no rim, went near-invisible).
    mat.alphaTest = 0.5;
    const eroded = (dissolving as any).and(thresh.lessThan(uDissolve));
    (mat as any).opacityNode = (eroded as any).select((tslFloat as any)(0), (tslFloat as any)(1));
    // HEAT — a wide additive ember band at the front so it reads on any albedo.
    const heat = (tslSmoothstep as any)(0.0, 0.16, front).oneMinus();
    const heatTerm = (vec3 as any)(1.0, 0.40, 0.10).mul(heat.mul(heat)).mul(uDissolve.mul(0.9).add(0.5)).mul(active);
    // CORE — the hottest sliver at the very edge.
    const core = (tslSmoothstep as any)(0.0, 0.02, front).oneMinus();
    const coreTerm = (vec3 as any)(1.0, 0.72, 0.34).mul(core).mul(uDissolve).mul(active);
    emissive = emissive.add(heatTerm).add(coreTerm);
  }

  (mat as any).emissiveNode = emissive;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

function buildPart(part: PartSpec, materials: Map<string, THREE.Material>): THREE.Object3D {
  // For primitives without per-instance mutation (`jitter`), pull a
  // SHARED geometry from the pool — every identical part across every
  // instance points at the same vertex buffer. Jittered parts go
  // through fresh constructors + in-place jitterGeometry: each is
  // unique by design, so caching would defeat the point.
  const pooled = !part.jitter;
  switch (part.kind) {
    case 'sphere': {
      const segs = part.segments ?? [16, 12];
      const geo = pooled
        ? pooledSphere(part.radius, segs[0], segs[1])
        : new THREE.SphereGeometry(part.radius, segs[0], segs[1]);
      if (!pooled) jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'box': {
      // Bevelled boxes use RoundedBoxGeometry — softens hard edges so
      // chunky shapes (bracers, chests, benches) catch light instead
      // of reading as cheap cubes. Bypass the pool: per-instance bevel
      // tuning makes geometry sharing impractical, and these are rare
      // enough that the duplicate allocation is fine.
      const bevel = part.bevel ?? 0;
      let geo: THREE.BufferGeometry;
      if (bevel > 0) {
        const segments = part.bevelSegments ?? 3;
        geo = new RoundedBoxGeometry(
          part.size[0], part.size[1], part.size[2], segments, bevel,
        );
      } else {
        geo = pooled
          ? pooledBox(part.size[0], part.size[1], part.size[2])
          : new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
        if (!pooled) jitterGeometry(geo, part.jitter);
      }
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'capsule': {
      const geo = pooled
        ? pooledCapsule(part.radius, part.height, 4, 12)
        : new THREE.CapsuleGeometry(part.radius, part.height, 4, 12);
      if (!pooled) jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'cylinder': {
      const rTop = part.radiusTop ?? part.radius;
      const segs = part.segments ?? 12;
      const geo = pooled
        ? pooledCylinder(rTop, part.radius, part.height, segs)
        : new THREE.CylinderGeometry(rTop, part.radius, part.height, segs);
      if (!pooled) jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'torus': {
      const segs = part.segments ?? [10, 8];
      const geo = pooled
        ? pooledTorus(part.radius, part.tube, segs[1], segs[0])
        : new THREE.TorusGeometry(part.radius, part.tube, segs[1], segs[0]);
      if (!pooled) jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'cone': {
      const segs = part.segments ?? 12;
      const geo = pooled
        ? pooledCone(part.radius, part.height, segs)
        : new THREE.ConeGeometry(part.radius, part.height, segs);
      if (!pooled) jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'lathe': {
      const pts = part.profile.map((p) => new THREE.Vector2(p[0], p[1]));
      const geo = new THREE.LatheGeometry(pts, part.segments ?? 12);
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'extrude': {
      if (part.shape.length < 3) {
        // Empty shape — return an empty Object3D so the caller doesn't crash.
        return new THREE.Object3D();
      }
      const shape = new THREE.Shape();
      shape.moveTo(part.shape[0][0], part.shape[0][1]);
      for (let i = 1; i < part.shape.length; i++) {
        shape.lineTo(part.shape[i][0], part.shape[i][1]);
      }
      shape.closePath();
      // Bevel params — when the author opts in via `bevel: true`, three's
      // ExtrudeGeometry rounds the entry/exit faces. Tunable per-spec
      // via bevelSize/Thickness/Segments; omitted fields fall back to
      // three's defaults (0.1 / 0.1 / 3).
      const bevelEnabled = part.bevel ?? false;
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: part.depth,
        bevelEnabled,
        ...(bevelEnabled ? {
          bevelSize: part.bevelSize,
          bevelThickness: part.bevelThickness,
          bevelSegments: part.bevelSegments,
        } : {}),
      });
      // Center the extrusion on its origin (ExtrudeGeometry extrudes from z=0
      // to z=depth; shift back by half so `pos` means the part's center).
      geo.translate(0, 0, -part.depth / 2);
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'csg': {
      return buildCsg(part, materials);
    }
    case 'sprite': {
      const spriteMat = new THREE.SpriteMaterial({
        map: getTexture(part.texture),
        color: part.color ?? 0xffffff,
        transparent: true,
        opacity: part.opacity ?? 1,
        blending: part.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const baseW = part.size[0];
      const baseH = part.size[1];
      sprite.scale.set(baseW, baseH, 1);
      // Optional cheap flicker — wobbles scale + Y position via a
      // sine wave on Date.now(). No external tick needed.
      if (part.flicker) {
        const f = part.flicker;
        const baseY = part.pos?.[1] ?? 0;
        const phase = (f.phase ?? Math.random() * 100) * 1000;   // seconds → ms
        const omega = (Math.PI * 2) * f.speed;
        const scaleAmp = f.scale ?? 0;
        const bobAmp = f.bob ?? 0;
        sprite.onBeforeRender = () => {
          const t = (Date.now() + phase) / 1000;
          // Two superimposed sines at slightly different rates so
          // the wobble doesn't look like a clean oscillation.
          const a = Math.sin(omega * t);
          const b = Math.sin(omega * 1.7 * t + 1.3);
          const s = 1 + (a * 0.6 + b * 0.4) * scaleAmp;
          sprite.scale.set(baseW * s, baseH * s, 1);
          sprite.position.y = baseY + (a * 0.6 + b * 0.4) * bobAmp;
        };
      }
      return sprite;
    }
    case 'decal': {
      const geo = new THREE.PlaneGeometry(part.size[0], part.size[1]);
      const additive = part.blending === 'additive';
      // CUTOUT — opaque, alpha-tested. No transparency (robust on mobile tilers,
      // which mis-sort/mis-blend stacked transparent quads) and it writes depth,
      // so it casts a real texture-shaped shadow.
      const cutout = part.alphaTest != null;
      const mat = additive
        ? new THREE.MeshBasicMaterial({
            map: getTexture(part.texture),
            color: part.color ?? 0xffffff,
            transparent: true,
            opacity: part.opacity ?? 1,
            blending: THREE.AdditiveBlending,
            fog: part.fog ?? false,
            depthWrite: part.depthWrite ?? false,
            side: THREE.DoubleSide,
          })
        : cutout
        ? new THREE.MeshStandardMaterial({
            map: getTexture(part.texture),
            color: part.color ?? 0xffffff,
            emissive: part.emissive ?? 0x000000,
            emissiveIntensity: part.emissiveIntensity ?? 0,
            transparent: false,
            alphaTest: part.alphaTest,
            depthWrite: true,
            fog: part.fog ?? true,
            roughness: 0.95,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshStandardMaterial({
            map: getTexture(part.texture),
            color: part.color ?? 0xffffff,
            emissive: part.emissive ?? 0x000000,
            emissiveIntensity: part.emissiveIntensity ?? 0,
            transparent: true,
            opacity: part.opacity ?? 1,
            alphaTest: 0.05,    // discard fully transparent pixels so shadow + depth stay clean
            depthWrite: part.depthWrite ?? true,
            fog: part.fog ?? true,
            roughness: 0.95,
            side: THREE.DoubleSide,
            // Polygon offset pushes the decal slightly toward the camera so it
            // doesn't z-fight with the wall/floor it sits on.
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          });
      const mesh = new THREE.Mesh(geo, mat);
      // Cutout decals can cast a real (texture-shaped) shadow; blended/additive
      // ones never do (a transparent quad would cast a solid black rectangle).
      mesh.castShadow = cutout ? (part.castShadow ?? curShadow.cast) : false;
      mesh.receiveShadow = part.receiveShadow ?? (cutout && curShadow.receive);
      return mesh;
    }
    case 'bone':
      // Bones are routed through buildBone() in the outer loop because
      // they need slot context that buildPart doesn't see. Reaching
      // here means the dispatcher missed a case.
      throw new Error('bone parts must be built via buildBone()');
  }
}

function makeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, part: PartSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = part.castShadow ?? curShadow.cast;
  mesh.receiveShadow = part.receiveShadow ?? curShadow.receive;
  return mesh;
}

// Build a CSG node — a boolean op between two child specs. Each
// operand is built via buildPart (so it can itself be a CSG node — nest
// at your own risk; research finds LLM state tracking degrades past 2-3
// levels). The operands' pos/rot/scale get BAKED into their geometry
// before the boolean runs, so the outer CSG spec's transform can apply
// on top of the resulting carving like any other primitive.
//
// CSG only works on meshes. If an operand resolves to anything else (a
// Sprite, a Group, a no-op Object3D from a too-short shape), the build
// throws — the spec is bad data and crashing early is the right
// failure mode.
function buildCsg(
  part: Extract<PartSpec, { kind: 'csg' }>,
  materials: Map<string, THREE.Material>,
): THREE.Mesh {
  const a = buildPart(part.a, materials);
  const b = buildPart(part.b, materials);
  // Authored transforms for the operands — the caller's main loop applies
  // these for ordinary parts. We apply them manually here because we
  // immediately bake them into the geometry instead of letting them ride
  // as live Object3D transforms.
  applyTransform(a, part.a);
  applyTransform(b, part.b);

  if (!(a as THREE.Mesh).isMesh) throw new Error(`csg operand A is not a mesh: kind=${part.a.kind}`);
  if (!(b as THREE.Mesh).isMesh) throw new Error(`csg operand B is not a mesh: kind=${part.b.kind}`);

  const meshA = a as THREE.Mesh;
  const meshB = b as THREE.Mesh;
  meshA.updateMatrix();
  meshB.updateMatrix();
  const geoA = meshA.geometry.clone();
  const geoB = meshB.geometry.clone();
  geoA.applyMatrix4(meshA.matrix);
  geoB.applyMatrix4(meshB.matrix);

  const brushA = new Brush(geoA);
  const brushB = new Brush(geoB);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();

  const op =
    part.op === 'subtract'  ? SUBTRACTION :
    part.op === 'add'       ? ADDITION :
                              INTERSECTION;
  const result = CSG_EVAL.evaluate(brushA, brushB, op);

  // Replace the result's material with the CSG spec's chosen one and
  // free the operand geometries — they're no longer referenced.
  result.material = materials.get(part.mat)!;
  geoA.dispose();
  geoB.dispose();
  result.castShadow = part.castShadow ?? curShadow.cast;
  result.receiveShadow = part.receiveShadow ?? curShadow.receive;
  return result;
}

const AIM_VECTORS: Record<AimDir, Vec3Tuple> = {
  forward: DIR.FORWARD, back: DIR.BACKWARD, up: DIR.UP,
  down: DIR.DOWN, left: DIR.LEFT, right: DIR.RIGHT,
};

function applyTransform(obj: THREE.Object3D, part: PartSpec) {
  // Bones compute their own pos/rot from slot positions — never
  // overwrite with the spec's pos/rot (they're ignored fields on bones).
  if (part.kind === 'bone') {
    if (part.scale) obj.scale.fromArray(part.scale as Vec3);
    return;
  }
  if (part.pos) obj.position.fromArray(part.pos as Vec3);
  if (part.aim) {
    // Intent-based aim: point the part's +Y (cone apex, cylinder
    // length) at the named direction — orient() solves the Euler so
    // the sign confusion that pointed every muzzle backward can't be
    // authored. See PartCommon.aim in model-types.ts.
    if (part.rot) {
      throw new Error(
        `Part '${part.name ?? part.kind}' sets BOTH aim and rot — use one. ` +
        `aim is the intent form of rot; composing them silently would defeat it.`,
      );
    }
    const principal = AIM_VECTORS[part.aim];
    const dir = part.aimTilt
      ? tilt(principal, AIM_VECTORS[part.aimTilt], part.aimTiltAmount ?? 0.2)
      : principal;
    obj.rotation.fromArray(orient({ yAxisTo: dir }));
  } else if (part.rot) {
    obj.rotation.fromArray(part.rot as Vec3);
  }
  if (part.scale) obj.scale.fromArray(part.scale as Vec3);
}

// Scratch vectors so buildBone doesn't churn allocations.
const _boneFromWorld = new THREE.Vector3();
const _boneToWorld   = new THREE.Vector3();
const _boneDir       = new THREE.Vector3();
const _boneY         = new THREE.Vector3(0, 1, 0);

/**
 * Build a 'bone' primitive: a cylinder that spans two named slots.
 * The from/to slots' world positions are read off the (already-
 * reparented) slot scene graph; positions are converted into the
 * bone's parent-local frame, then the cylinder is positioned at the
 * midpoint, oriented so its +Y axis points from→to, and sized to the
 * exact distance. No magic numbers, no gap bugs.
 *
 * Parent defaults to the FROM slot — i.e. the proximal joint — so
 * rotating that joint swings the bone naturally. Override with the
 * `parent` field for unusual rigs.
 *
 * `offset` (parent-local) shifts the bone perpendicular to its axis;
 * used for dual-bone forearms where the radius + ulna share endpoints
 * but sit on either side of the centerline.
 */
function buildBone(
  part: Extract<PartSpec, { kind: 'bone' }>,
  slots: Map<string, THREE.Object3D>,
  parts: Map<string, THREE.Object3D>,
  group: THREE.Group,
  materials: Map<string, THREE.Material>,
): THREE.Object3D {
  const fromSlot = slots.get(part.from);
  const toSlot = slots.get(part.to);
  if (!fromSlot || !toSlot) {
    // eslint-disable-next-line no-console
    console.warn(`bone: unknown slot "${!fromSlot ? part.from : part.to}"`);
    return new THREE.Group();
  }
  // Resolve parent: explicit `parent` if present, otherwise from-slot
  // (the proximal-joint default). Parent must be a slot or a part
  // that exists by now — parts in pass 2 are built in source order,
  // and we run after slots are reparented, so any part-typed parent
  // referenced before its own definition would fail naturally here.
  const parentName = part.parent ?? part.from;
  const parentObj = slots.get(parentName) ?? parts.get(parentName) ?? group;
  // Both endpoints in parent-local frame. worldToLocal mutates its
  // arg, so we re-fetch the world positions each call.
  fromSlot.getWorldPosition(_boneFromWorld);
  toSlot.getWorldPosition(_boneToWorld);
  parentObj.worldToLocal(_boneFromWorld);
  parentObj.worldToLocal(_boneToWorld);
  _boneDir.subVectors(_boneToWorld, _boneFromWorld);
  const length = _boneDir.length();
  if (length < 1e-6) {
    // eslint-disable-next-line no-console
    console.warn(`bone: from "${part.from}" and to "${part.to}" coincide`);
    return new THREE.Group();
  }
  _boneDir.divideScalar(length);

  const rTop = part.radiusTop ?? part.radius;
  const segs = part.segments ?? 12;
  // Bones share geometry through the cylinder pool — the rare 3-decimal
  // length difference between equipped instances is the only thing
  // preventing cache hits, and cylinders are cheap to instantiate.
  const geo = pooledCylinder(rTop, part.radius, length, segs);
  const mesh = makeMesh(geo, materials.get(part.mat)!, part);
  // Midpoint + perpendicular offset for dual-bone arrangements.
  mesh.position.addVectors(_boneFromWorld, _boneToWorld).multiplyScalar(0.5);
  if (part.offset) {
    mesh.position.x += part.offset[0];
    mesh.position.y += part.offset[1];
    mesh.position.z += part.offset[2];
  }
  // Cylinder's local +Y is the bone axis; align to from→to direction.
  mesh.quaternion.setFromUnitVectors(_boneY, _boneDir);
  return mesh;
}

/**
 * Per-vertex jitter. Coincident vertices (those at the same logical
 * position in the original geometry) move together — without bucketing
 * we'd tear seams in capsule caps, sphere poles, and ExtrudeGeometry
 * edges. Each part gets a fresh random pattern at construction time, so
 * two ghouls spawned next to each other are visibly distinct without
 * any per-instance authoring.
 *
 * Runs ONCE at build, not per-frame. Recomputes normals so flat-shaded
 * materials don't get smooth highlights leftover from the pre-jitter
 * positions.
 */
function jitterGeometry(geo: THREE.BufferGeometry, amp: number | undefined): void {
  if (!amp || amp <= 0) return;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  // Bucket by rounded position (1mm precision) so neighbors that started
  // at the same point land on the same offset.
  const buckets = new Map<string, [number, number, number]>();
  const key = (x: number, y: number, z: number): string =>
    `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  for (let i = 0; i < arr.length; i += 3) {
    const k = key(arr[i], arr[i + 1], arr[i + 2]);
    if (!buckets.has(k)) {
      buckets.set(k, [
        (Math.random() - 0.5) * 2 * amp,
        (Math.random() - 0.5) * 2 * amp,
        (Math.random() - 0.5) * 2 * amp,
      ]);
    }
  }
  for (let i = 0; i < arr.length; i += 3) {
    const k = key(arr[i], arr[i + 1], arr[i + 2]);
    const off = buckets.get(k)!;
    arr[i + 0] += off[0];
    arr[i + 1] += off[1];
    arr[i + 2] += off[2];
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}
