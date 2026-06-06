import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';

// Bench debug overlays — auxiliary geometry the bench can paint OVER (or
// INSTEAD OF) a model's real materials so the author can see what the
// scene-graph actually contains. None of this ships to the live game; it
// lives only on the bench page.
//
// Three overlays, each individually toggleable:
//
//   GNOMON       — small RGB axis helper at the studio origin. The
//                  research consistently flags axis confusion as the
//                  #1 LLM-CAD failure mode (Z-up vs Y-up, rotation
//                  order). Painting the axes in every render gives the
//                  vision-LLM a grounding signal.
//
//   SLOTS        — per-slot label + axis helper at every named slot
//                  position. Slots are invisible in normal renders;
//                  this surfaces them so I can verify the weapon's
//                  grip_anchor really did land where the parent
//                  rotation said it should.
//
//   COLOR-BY-PART — replace every mesh's material with a flat unlit
//                   colour derived from a hash of its name. A model
//                   that reads as "one brown blob" in production
//                   shading reads as discrete colours here, so I can
//                   tell whether parts are where I think they are and
//                   whether any are buried inside others.
//
// Also exports a bounding-box helper for size reference.

const GNOMON_NAME = 'bench-gnomon';
const SLOT_GROUP_NAME = 'bench-slot-overlay';
const BBOX_NAME = 'bench-bbox';

/** Add a small RGB axis helper at world origin. Length scales with the
 *  subject's radius so it reads against any subject. Idempotent. */
export function addGnomon(parent: THREE.Object3D, radius: number): void {
  const existing = parent.getObjectByName(GNOMON_NAME);
  if (existing) parent.remove(existing);
  const axes = new THREE.AxesHelper(Math.max(0.05, radius * 0.6));
  axes.name = GNOMON_NAME;
  // The standard AxesHelper colours are red/green/blue for X/Y/Z; bump
  // their depth-test off so the axes always render on top, even when
  // the subject overlaps the origin.
  setDepthTestOff(axes);
  axes.renderOrder = 999;
  parent.add(axes);
}

function setDepthTestOff(obj: { material: THREE.Material | THREE.Material[] }): void {
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const m of mats) m.depthTest = false;
}

/** Add an axis helper at every slot in the built model, with a small
 *  HTML label sprite naming each one. The label is a CanvasTexture so
 *  it ends up in the screenshot like everything else.
 *
 *  `highlight` (optional) — names that get bigger axes + the label
 *  rendered in magenta. The rest of the slot overlay stays as a quiet
 *  reference layer so the highlighted slots pop. */
export function addSlotOverlay(
  parent: THREE.Object3D,
  built: BuiltModel,
  radius: number,
  highlight: ReadonlySet<string> = new Set(),
): void {
  const existing = parent.getObjectByName(SLOT_GROUP_NAME);
  if (existing) parent.remove(existing);
  const group = new THREE.Group();
  group.name = SLOT_GROUP_NAME;
  const axisLength = Math.max(0.02, radius * 0.18);
  for (const [name, anchor] of built.slots) {
    const hit = highlight.has(name);
    const axes = new THREE.AxesHelper(hit ? axisLength * 2.0 : axisLength);
    setDepthTestOff(axes);
    axes.renderOrder = 999;
    anchor.add(axes);
    const sprite = makeTextSprite(name, hit ? 1.15 : 0.85, hit);
    const labelOffset = axisLength * (hit ? 1.6 : 1.3);
    sprite.position.set(labelOffset, labelOffset, 0);
    anchor.add(sprite);
    group.userData[name] = { axes, sprite };
  }
  parent.add(group);
}

/** Replace every mesh's material in `built.group` with a flat unlit
 *  colour derived from the mesh's part name (or its index when
 *  unnamed). If `highlight` is non-empty, every mesh whose name
 *  matches gets a bright magenta; everything else FADES to a quarter
 *  brightness so the highlighted parts pop out of the model.
 *
 *  Stash the original materials so they can be restored. */
export function colorByPart(
  built: BuiltModel,
  highlight: ReadonlySet<string> = new Set(),
): () => void {
  const saved: Array<{ mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[] }> = [];
  let i = 0;
  const nameByMesh = new Map<THREE.Object3D, string>();
  for (const [name, obj] of built.parts) nameByMesh.set(obj, name);
  // Highlight resolution also walks each named PART's subtree (the
  // mesh hierarchy under `built.parts.get('hand')` etc.) so a name
  // match colours every descendant mesh too.
  const subtreeHighlight = new Set<THREE.Object3D>();
  if (highlight.size > 0) {
    for (const name of highlight) {
      const node = built.parts.get(name);
      if (!node) continue;
      node.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) subtreeHighlight.add(obj); });
    }
  }
  const hasHighlight = highlight.size > 0;

  built.group.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    saved.push({ mesh, mat: mesh.material });
    const tag = nameByMesh.get(mesh) ?? `_${i++}`;
    const hit = subtreeHighlight.has(mesh) || highlight.has(tag);
    let color: THREE.Color;
    if (hit) {
      color = new THREE.Color(0xff3aff);  // hot magenta — pops on any background
    } else if (hasHighlight) {
      color = hashColor(tag).multiplyScalar(0.25);  // dim non-targets
    } else {
      color = hashColor(tag);
    }
    mesh.material = new THREE.MeshBasicMaterial({ color });
  });

  return function restore() {
    for (const { mesh, mat } of saved) mesh.material = mat;
  };
}

/** Draw a wireframe AABB around the built model, sized to the current
 *  geometry. The box edges render on top so they're visible even when
 *  the subject's silhouette grazes the bounds. */
export function addBoundingBox(parent: THREE.Object3D, target: THREE.Object3D): void {
  const existing = parent.getObjectByName(BBOX_NAME);
  if (existing) parent.remove(existing);
  const box = new THREE.Box3().setFromObject(target);
  const helper = new THREE.Box3Helper(box, new THREE.Color(0xffff66));
  helper.name = BBOX_NAME;
  (helper.material as THREE.LineBasicMaterial).depthTest = false;
  helper.renderOrder = 998;
  parent.add(helper);
}

/** Hash a string to a hue and return an HSL colour. Stable: the same
 *  name always gets the same colour across runs. */
function hashColor(s: string): THREE.Color {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.65, 0.55);
}

/** Tiny canvas-backed sprite for a single line of label text. Cheap; we
 *  only ever create a handful per render. Highlighted labels pull a
 *  magenta border + brighter fill so they stand out from the quiet
 *  amber default. */
function makeTextSprite(text: string, scale: number, highlight = false): THREE.Sprite {
  const dpr = 2;
  const padding = 6;
  const fontSize = 24;
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d')!;
  ctx.font = `bold ${fontSize}px ui-monospace, monospace`;
  const measured = ctx.measureText(text);
  const w = Math.ceil(measured.width) + padding * 2;
  const h = fontSize + padding * 2;
  cvs.width = w * dpr;
  cvs.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = `bold ${fontSize}px ui-monospace, monospace`;
  ctx.fillStyle = highlight ? 'rgba(40, 0, 40, 0.85)' : 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = highlight ? 'rgba(255, 80, 255, 0.95)' : 'rgba(255, 220, 130, 0.55)';
  ctx.lineWidth = highlight ? 2 : 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = highlight ? 'rgba(255, 200, 255, 1)' : 'rgba(255, 230, 180, 0.95)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding, h / 2);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // Sprites in three are 1×1 by default at the camera; scale so the
  // label reads at a fixed size relative to the model radius.
  sprite.scale.set((w / h) * scale * 0.10, scale * 0.10, 1);
  sprite.renderOrder = 1000;
  return sprite;
}
