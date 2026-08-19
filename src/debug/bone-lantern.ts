// ── THE SCANNED LANTERN ──────────────────────────────────────────────────────
//
// Josh modelled a medieval lantern to go with the bone arms, and this loads it in place of the
// procedural cage that player/handheld-lamp.ts builds out of primitives.
//
// ── THE CONTRACT IS ITS ORIGIN ──────────────────────────────────────────────
//
// scripts/blender/prep-lantern.py origins the model at its BAIL — the hanging loop — so placing
// it is one assignment: put it where the lamp's `ringAnchor` is and it hangs from the hook the
// way a real lantern does. Everything else follows from that. It hangs 17.6cm below its own
// origin and reaches 3cm above it, which is the loop.
//
// That is deliberately the whole interface. An offset authored at this end would be a number
// nobody could check against the mesh; an origin ON the landmark is checkable by looking.
//
// ── WHAT IT DOES NOT REPLACE ────────────────────────────────────────────────
//
// The flame stack, the light, and the ring anchor stay exactly as they are. The lantern is a
// SHELL — the thing that reads as iron and glass — and the fire inside it is a separate concern
// that the atmosphere work already tuned. Swapping the shell should not disturb the flame.
//
// DEV-only, on the same `?bonearm=1` flag as the hands, and dead-code-eliminated in production.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEV } from './dev';

let source: THREE.Object3D | null = null;
let loading: Promise<void> | null = null;
const listeners: Array<() => void> = [];

/** Run `fn` once the lantern is in — immediately if it already is. The lamp is built at boot,
 *  long before a GLB can land, so the swap rides this. */
export function onLanternLoaded(fn: () => void): void {
  if (source) { fn(); return; }
  listeners.push(fn);
}

/** Start loading. Safe to call repeatedly — the load happens once. */
export function preloadLantern(): Promise<void> {
  if (!DEV) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    new GLTFLoader().load(
      `${import.meta.env.BASE_URL}models/lantern.glb`,
      (gltf) => {
        source = gltf.scene;
        source.updateMatrixWorld(true);
        for (const fn of listeners.splice(0)) fn();
        resolve();
      },
      undefined,
      (err) => { console.warn('[lantern] load failed', err); resolve(); },
    );
  });
  return loading;
}

/**
 * A fresh lantern shell, origin on its bail. Null until the asset has landed.
 *
 * The caller positions it at the lamp's ring anchor and it hangs.
 */
export function buildLantern(): THREE.Object3D | null {
  if (!DEV || !source) return null;
  return source.clone(true);
}
