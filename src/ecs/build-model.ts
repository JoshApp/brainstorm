import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import type { MaterialDef, ModelSpec, PartSpec, Vec3 } from './model-types';
import { getTexture } from '../style/procedural-textures';
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

export function buildModel(spec: ModelSpec): BuiltModel {
  const flatShadingDefault = false;   // PS1 is the only style; smooth shading

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
    const parentNode = parts.get(parentName) ?? slots.get(parentName);
    if (!parentNode) {
      // eslint-disable-next-line no-console
      console.warn(`Part references unknown parent "${parentName}"`);
      continue;
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

function createMaterial(def: MaterialDef, defaultFlatShading: boolean): THREE.Material {
  const flatShading =
    def.flatShading === 'auto' ? defaultFlatShading : (def.flatShading ?? false);
  const mat = new THREE.MeshStandardMaterial({
    color: def.color,
    emissive: def.emissive,
    emissiveIntensity: def.emissiveIntensity ?? 1,
    roughness: def.roughness ?? 0.95,
    metalness: def.metalness ?? 0,
    flatShading,
    transparent: def.transparent,
    opacity: def.opacity ?? 1,
    fog: def.fog ?? true,
  });

  // Inject custom GLSL for rim glow + dissolve. We do this once at
  // build time so the shader compiles during warmup; the death sequence
  // mutates uniform values at runtime, which doesn't trigger a recompile.
  attachShaderExtensions(mat, def);
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
  if (!hasRim && !hasDissolve) return;

  const uRimColor   = { value: new THREE.Color(def.rim?.color ?? 0xffffff) };
  const uRimPower   = { value: def.rim?.power ?? 2.5 };
  const uRimIntens  = { value: def.rim?.intensity ?? 1.0 };
  const uRimDark    = { value: def.rim?.darkReactive ?? 0 };
  const uDissolve   = { value: 0 };

  // Expose for external mutation. Death sequence reads userData.uDissolve.
  mat.userData.uDissolve = uDissolve;

  // Stable cache key so two wraiths (different instances, same def shape)
  // hit the same compiled program. Different shapes get different keys.
  const cacheKey = `enemy-ext|${hasRim ? '1' : '0'}|${hasDissolve ? '1' : '0'}`;
  mat.customProgramCacheKey = () => cacheKey;

  mat.onBeforeCompile = (shader) => {
    if (hasRim) {
      shader.uniforms.uRimColor  = uRimColor;
      shader.uniforms.uRimPower  = uRimPower;
      shader.uniforms.uRimIntens = uRimIntens;
      shader.uniforms.uRimDark   = uRimDark;
    }
    if (hasDissolve) {
      shader.uniforms.uDissolve  = uDissolve;
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
    shader.fragmentShader = frag + shader.fragmentShader;

    const injection = `
      ${hasDissolve ? `
      if (uDissolve > 0.0) {
        // Hash noise on local XZ (stable in world); biased by local Y
        // so the dissolve travels top-down — the body crumbles from
        // the head down to the feet.
        float n = fract(sin(dot(vLocalPos.xz * 11.0, vec2(12.9898, 78.233))) * 43758.5453);
        float t = (vLocalPos.y * 0.55 + 0.5) - uDissolve * 1.45 + n * 0.18;
        if (t < 0.0) discard;
        // Edge band — fragments close to the discard threshold get a
        // bright additive flare in spectral cyan-green. Reads as energy
        // leaking out as the body unmakes itself.
        float edge = 1.0 - smoothstep(0.0, 0.13, t);
        gl_FragColor.rgb += vec3(0.45, 1.0, 0.72) * edge * 3.5 * uDissolve;
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
      mesh.castShadow = false;
      mesh.receiveShadow = part.receiveShadow ?? false;
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
  mesh.castShadow = part.castShadow ?? true;
  mesh.receiveShadow = part.receiveShadow ?? true;
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
  result.castShadow = part.castShadow ?? true;
  result.receiveShadow = part.receiveShadow ?? true;
  return result;
}

function applyTransform(obj: THREE.Object3D, part: PartSpec) {
  // Bones compute their own pos/rot from slot positions — never
  // overwrite with the spec's pos/rot (they're ignored fields on bones).
  if (part.kind === 'bone') {
    if (part.scale) obj.scale.fromArray(part.scale as Vec3);
    return;
  }
  if (part.pos) obj.position.fromArray(part.pos as Vec3);
  if (part.rot) obj.rotation.fromArray(part.rot as Vec3);
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
