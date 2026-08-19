// ── WHAT IS SITTING AT THE ORIGIN ────────────────────────────────────────────
//
// `?originprobe=1` — walks the scene a few seconds after boot and reports every object whose
// world position is near (0,0,0), with its name, type, size and ancestry.
//
// Josh: *"there is a wierd sphere spawning inside 0/0/0 and persistent through the floors."* A
// thing at the world origin that survives level swaps is parented to something persistent, and
// the fastest way to find out WHICH is to ask the scene rather than to reason about which system
// could plausibly own it. I guessed twice before writing this — once at a disposal I had added
// an hour earlier (ruled out: the sphere predates it by days) and once at the flame batch (its
// unwritten slots have zero scale, so they render degenerate, not metre-wide). Both were
// plausible and neither was checked first.
//
// Prints the ancestry because "persistent through floors" is a fact about the PARENT: whatever
// it hangs from is not the level root.
//
// DEV-only, flag-gated, dead-code-eliminated in production.

import * as THREE from 'three';
import { DEV } from './dev';
import { flameBatchDebug } from '../scene/flame-mesh-batch';
import { spriteBatchDebug } from '../scene/sprite-batch';

/** How close to the origin counts, and how big is worth reporting. */
const NEAR = 2.5;
const BIG = 0.15;

export function originProbeWanted(): boolean {
  return DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('originprobe') === '1';
}

function ancestry(o: THREE.Object3D): string {
  const names: string[] = [];
  let cur: THREE.Object3D | null = o.parent;
  while (cur) {
    names.push(cur.name || cur.type);
    cur = cur.parent;
  }
  return names.join(' < ');
}

/** Report anything sizeable sitting at the world origin. */
export function runOriginProbe(scene: THREE.Object3D): void {
  if (!DEV) return;
  const pos = new THREE.Vector3();
  const size = new THREE.Vector3();
  const box = new THREE.Box3();
  const hits: string[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const sprite = o as THREE.Sprite;
    if (!mesh.isMesh && !sprite.isSprite) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    // The BOX'S CENTRE, not the object's origin. Merged level batches keep their origin at
    // (0,0,0) while spanning the whole floor — `static-batch-world` is 50m across — so testing
    // the origin reported the entire level as sitting at the origin.
    box.getCenter(pos);
    if (pos.length() > NEAR) return;
    box.getSize(size);
    const span = Math.max(size.x, size.y, size.z);
    // Small enough to BE a loose object rather than a batch that happens to straddle the middle.
    // Wide net on size: a 4m ceiling assumed the thing was hand-sized, and the object being
    // hunted is a sphere that fills a good part of the frame from several metres away.
    if (span < BIG || span > 30) return;
    // VISIBLE THROUGH THE WHOLE CHAIN. The origin is where warmup dummies and pooled templates
    // are parked, and they are all `visible = false` — 54 of them on the first run, which buries
    // the one object that is actually rendering. An object's own flag says nothing; an invisible
    // ancestor hides it just as well.
    let cur: THREE.Object3D | null = o;
    let shown = true;
    while (cur) { if (!cur.visible) { shown = false; break; } cur = cur.parent; }
    if (!shown) return;
    hits.push(
      `${o.name || '(unnamed)'} [${o.type}] `
      + `at [${pos.toArray().map((v) => v.toFixed(2)).join(',')}] `
      + `size [${size.toArray().map((v) => v.toFixed(2)).join(',')}] `
      + `· under ${ancestry(o)}`,
    );
  });
  // eslint-disable-next-line no-console
  console.log(`[origin-probe] ${hits.length} VISIBLE object(s) within ${NEAR}m of origin and >${BIG}m:`);
  for (const h of hits) {
    // eslint-disable-next-line no-console
    console.log(`[origin-probe]   ${h}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[origin-probe] ${flameBatchDebug()}`);
  // eslint-disable-next-line no-console
  console.log(`[origin-probe] ${spriteBatchDebug()}`);
}
