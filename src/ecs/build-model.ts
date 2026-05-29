import * as THREE from 'three';
import type { MaterialDef, ModelSpec, PartSpec, Vec3 } from './model-types';
import { getStyle } from '../style';
import { getTexture } from '../style/procedural-textures';

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
  const flatShadingDefault = getStyle() === 'flat';

  // Fresh material instances per-model (so hit-flash on one ghoul doesn't
  // tint another, etc.).
  const materials = new Map<string, THREE.Material>();
  for (const [id, def] of Object.entries(spec.materials)) {
    materials.set(id, createMaterial(def, flatShadingDefault));
  }

  const group = new THREE.Group();
  const parts = new Map<string, THREE.Object3D>();
  const hitTargets: THREE.Object3D[] = [];

  // Slots first (parts may parent to slots, so slots must exist first).
  const slots = new Map<string, THREE.Object3D>();
  if (spec.slots) {
    for (const [name, slotSpec] of Object.entries(spec.slots)) {
      const anchor = new THREE.Object3D();
      anchor.position.fromArray(slotSpec.pos);
      if (slotSpec.rot) anchor.rotation.fromArray(slotSpec.rot);
      anchor.name = `slot:${name}`;
      group.add(anchor);
      slots.set(name, anchor);
    }
  }

  // First pass: build all parts, track them by index in a parallel array
  // (so unnamed parts can still be reparented in pass 2).
  const builtParts: THREE.Object3D[] = [];
  for (const part of spec.parts) {
    const obj = buildPart(part, materials);
    applyTransform(obj, part);
    if (part.name) {
      obj.name = part.name;
      parts.set(part.name, obj);
    }
    group.add(obj);
    if (part.kind !== 'sprite') hitTargets.push(obj);
    builtParts.push(obj);
  }

  // Second pass: reparent any part with a `parent` field to its parent node.
  // Names are NOT required — we look up the built object by index. Without
  // this, unnamed children stayed at the model root, often INSIDE other meshes.
  for (let i = 0; i < spec.parts.length; i++) {
    const part = spec.parts[i];
    if (!part.parent) continue;
    const child = builtParts[i];
    const parentNode = parts.get(part.parent) ?? slots.get(part.parent);
    if (!parentNode) {
      // eslint-disable-next-line no-console
      console.warn(`Part references unknown parent "${part.parent}"`);
      continue;
    }
    parentNode.add(child);
  }

  // Third pass: nest any SLOT that declares a parent (slot or part).
  // Enables jointed rigs — a shoulder slot parented to the body `rig`
  // both swings its arm and inherits the body's lean. Runs after parts
  // are built so a slot can parent to a named part too; the slot keeps
  // its authored local pos/rot (now interpreted in the parent's space).
  if (spec.slots) {
    for (const [name, slotSpec] of Object.entries(spec.slots)) {
      if (!slotSpec.parent) continue;
      const node = slots.get(name);
      const parentNode = slots.get(slotSpec.parent) ?? parts.get(slotSpec.parent);
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
      frag += 'uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimIntens;\n';
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
      gl_FragColor.rgb += uRimColor * rim * uRimIntens;
      ` : ''}
    `;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `${injection}\n#include <dithering_fragment>`,
    );
  };
}

function buildPart(part: PartSpec, materials: Map<string, THREE.Material>): THREE.Object3D {
  switch (part.kind) {
    case 'sphere': {
      const segs = part.segments ?? [16, 12];
      const geo = new THREE.SphereGeometry(part.radius, segs[0], segs[1]);
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'box': {
      const geo = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'capsule': {
      const geo = new THREE.CapsuleGeometry(part.radius, part.height, 4, 12);
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'cylinder': {
      const geo = new THREE.CylinderGeometry(
        part.radiusTop ?? part.radius,
        part.radius,
        part.height,
        part.segments ?? 12,
      );
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'torus': {
      const segs = part.segments ?? [10, 8];
      const geo = new THREE.TorusGeometry(part.radius, part.tube, segs[1], segs[0]);
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'cone': {
      const geo = new THREE.ConeGeometry(part.radius, part.height, part.segments ?? 12);
      jitterGeometry(geo, part.jitter);
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
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: part.depth,
        bevelEnabled: part.bevel ?? false,
      });
      // Center the extrusion on its origin (ExtrudeGeometry extrudes from z=0
      // to z=depth; shift back by half so `pos` means the part's center).
      geo.translate(0, 0, -part.depth / 2);
      jitterGeometry(geo, part.jitter);
      return makeMesh(geo, materials.get(part.mat)!, part);
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
  }
}

function makeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, part: PartSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = part.castShadow ?? true;
  mesh.receiveShadow = part.receiveShadow ?? true;
  return mesh;
}

function applyTransform(obj: THREE.Object3D, part: PartSpec) {
  if (part.pos) obj.position.fromArray(part.pos as Vec3);
  if (part.rot) obj.rotation.fromArray(part.rot as Vec3);
  if (part.scale) obj.scale.fromArray(part.scale as Vec3);
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
