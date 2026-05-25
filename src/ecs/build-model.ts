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

  let light: THREE.PointLight | undefined;
  if (spec.light) {
    light = new THREE.PointLight(
      spec.light.color,
      spec.light.intensity,
      spec.light.distance,
      spec.light.decay,
    );
    if (spec.light.pos) light.position.fromArray(spec.light.pos);
    if (spec.light.castShadow) {
      light.castShadow = true;
      const sz = spec.light.shadowMapSize ?? 512;
      light.shadow.mapSize.set(sz, sz);
      light.shadow.bias = spec.light.shadowBias ?? -0.005;
    }
    group.add(light);
  }

  return { group, parts, slots, materials, hitTargets, light };
}

function createMaterial(def: MaterialDef, defaultFlatShading: boolean): THREE.Material {
  const flatShading =
    def.flatShading === 'auto' ? defaultFlatShading : (def.flatShading ?? false);
  return new THREE.MeshStandardMaterial({
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
}

function buildPart(part: PartSpec, materials: Map<string, THREE.Material>): THREE.Object3D {
  switch (part.kind) {
    case 'sphere': {
      const segs = part.segments ?? [16, 12];
      const geo = new THREE.SphereGeometry(part.radius, segs[0], segs[1]);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'box': {
      const geo = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'capsule': {
      const geo = new THREE.CapsuleGeometry(part.radius, part.height, 4, 12);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'cylinder': {
      const geo = new THREE.CylinderGeometry(
        part.radiusTop ?? part.radius,
        part.radius,
        part.height,
        part.segments ?? 12,
      );
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'cone': {
      const geo = new THREE.ConeGeometry(part.radius, part.height, part.segments ?? 12);
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'lathe': {
      const pts = part.profile.map((p) => new THREE.Vector2(p[0], p[1]));
      const geo = new THREE.LatheGeometry(pts, part.segments ?? 12);
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
      return makeMesh(geo, materials.get(part.mat)!, part);
    }
    case 'sprite': {
      const spriteMat = new THREE.SpriteMaterial({
        map: getTexture(part.texture),
        color: part.color ?? 0xffffff,
        transparent: true,
        blending: part.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(part.size[0], part.size[1], 1);
      return sprite;
    }
    case 'decal': {
      const geo = new THREE.PlaneGeometry(part.size[0], part.size[1]);
      const mat = new THREE.MeshStandardMaterial({
        map: getTexture(part.texture),
        color: part.color ?? 0xffffff,
        emissive: part.emissive ?? 0x000000,
        emissiveIntensity: part.emissiveIntensity ?? 0,
        transparent: true,
        alphaTest: 0.05,    // discard fully transparent pixels so shadow + depth stay clean
        depthWrite: true,
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
