// ── HOW MUCH OF A CREATURE YOU CAN SEE ───────────────────────────────────────
//
// Josh: *"eyes only and then veiled silhouette and glowing parts ... if its not culled it is
// kinda drawn and then states of reveal."*
//
// This is the number that drives it. Each creature carries a `reveal` in 0..1 on its mesh, and
// the lighting model scales its LIT contribution by it (style/banded-lighting-webgpu.ts,
// setMaterialCreatureRevealWebGPU). Emissive is added by three afterwards and is not scaled — so
// at 0 a creature is a black shape with its eyes and glowing parts still burning, and at 1 it is
// simply itself.
//
// ── IT IS DRIVEN BY LIGHT, WHICH IS THE WHOLE POINT ─────────────────────────
//
// Not by distance, and not by whether the room is "explored". The game's rule is that light is
// what reveals (docs/VISUAL-LANGUAGE.md — significant forms revealed by light out of black), so
// the thing that decides whether you can see a creature has to be the light actually falling on
// it. That also makes the mechanic legible without a word of UI: raise the lamp and the shape
// resolves, back away and it returns to eyes. The player learns the rule by using it.
//
// ── WHY IT IS EASED ─────────────────────────────────────────────────────────
//
// The behaviour this replaces was a boolean — a mob crossed into a drawn rect and arrived at full
// material in one frame, which is the popping. A number can be eased, and easing it is what turns
// "appearing" into "emerging". Asymmetric on purpose: revealing is quicker than fading, because a
// thing stepping into your light should resolve promptly (you need to fight it) while a thing
// leaving it should linger a moment as an after-image of a shape.
//
// ── COST ────────────────────────────────────────────────────────────────────
//
// Per enemy per frame: a walk over the live light sources, each a squared distance. That is the
// same shape of work dark-adaptation already does once for the player, and enemies are few. No
// raycasts, no line-of-sight — a creature lit from around a corner is a acceptable error, and
// buying the exact answer would cost more than the effect is worth.

import * as THREE from 'three';
import { forEachLight } from '../scene/light-pool';
import { getLampWorldPos, getLampIntensity } from '../player/handheld-lamp';
import { CONFIG } from '../config';

/** Below this the creature is a silhouette; above it, itself. */
const FULL_AT = 0.55;

/** Per-second rates. Coming into the light is faster than going out of it — see the header. */
const RISE = 6.0;
const FALL = 2.2;

const _lampScratch = new THREE.Vector3();
const _lamp = { x: 0, y: 0, z: 0 };
let _haveLamp = false;

/** Light arriving at a point, in units where one torch at its own radius is about 1. */
function litAt(x: number, y: number, z: number): number {
  let lit = 0;
  forEachLight('environment', (src) => {
    const r = src.distance;
    if (r <= 0) return;
    const dx = src.position.x - x;
    const dy = src.position.y - y;
    const dz = src.position.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return;
    const falloff = 1 - Math.sqrt(d2) / r;
    lit += falloff * falloff * (src.intensity / CONFIG.TORCH_INTENSITY);
  });
  // THE LAMP COUNTS, AND COUNTS MOST. It is the instrument the player aims, so it has to be the
  // thing that resolves a shape — an effect you cannot point at teaches nobody anything.
  if (_haveLamp) {
    const dx = _lamp.x - x;
    const dy = _lamp.y - y;
    const dz = _lamp.z - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const r = CONFIG.LAMP_DISTANCE;
    if (d < r) {
      const falloff = 1 - d / r;
      lit += falloff * falloff * (getLampIntensity() / CONFIG.LAMP_INTENSITY) * 1.6;
    }
  }
  return lit;
}

export interface RevealTarget {
  group: THREE.Object3D;
}

/**
 * Advance every creature's reveal toward the light falling on it.
 *
 * Writes `userData.reveal` on each mesh under the group — the lighting model reads it per object,
 * so it has to be on the drawn meshes rather than on the group. Cached on the group's userData so
 * the tree is walked once per creature rather than once per frame.
 */
export function tickEnemyReveal(enemies: readonly RevealTarget[], dt: number): void {
  const lampPos = getLampWorldPos(_lampScratch);
  _haveLamp = !!lampPos;
  if (lampPos) { _lamp.x = lampPos.x; _lamp.y = lampPos.y; _lamp.z = lampPos.z; }

  const step = Math.min(Math.max(dt, 0), 0.1);
  for (const e of enemies) {
    const g = e.group;
    if (!g.visible) continue;                 // culled — nothing to drive, and nothing drawn
    const meshes = meshesOf(g);
    if (!meshes.length) continue;
    const p = g.position;
    // Sampled at the CREATURE'S MIDDLE, not its feet: a torch on the floor of a tall room should
    // not count as fully lighting a thing standing over it, and the head is what the player looks
    // at when deciding whether they can see what it is.
    const target = Math.min(1, litAt(p.x, p.y + 0.9, p.z) / FULL_AT);
    const cur = typeof g.userData.reveal === 'number' ? g.userData.reveal : 0;
    const rate = target > cur ? RISE : FALL;
    const next = cur + (target - cur) * (1 - Math.exp(-rate * step));
    g.userData.reveal = next;
    for (const m of meshes) m.userData.reveal = next;
  }
}

function meshesOf(g: THREE.Object3D): THREE.Object3D[] {
  const cached = g.userData.__revealMeshes as THREE.Object3D[] | undefined;
  if (cached) return cached;
  const out: THREE.Object3D[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) out.push(o);
  });
  g.userData.__revealMeshes = out;
  return out;
}
