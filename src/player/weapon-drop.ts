import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { playLootLand } from '../audio/sfx';
import { DEV } from '../debug/dev';
import type { ModelSpec } from '../ecs/model-types';

// Death-drop physics — the "you let go of everything as you fall" beat.
//
// On death we capture the held weapon viewmodel's WORLD transform, hide
// the first-person model, and spawn a fresh world-space copy of the
// weapon that tumbles out of the hand and clatters to the floor under
// gravity. The camera collapse (death.ts) then plays out over the
// dropped weapon lying in the dirt — messier, more final than sinking
// to the ground still gripping your sword.
//
// Self-contained: a module-level list of in-flight drops advanced by
// tickWeaponDrops(dt), driven each frame from the death tick. Uses the
// drop model (world-scale geometry with normal depth testing), NOT the
// viewmodel model (which renders on-top with depthTest off) — so it
// occludes against the world correctly once it's on the floor.

interface Drop {
  group: THREE.Group;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;   // tumble (rad/s)
  rested: boolean;
}

const drops: Drop[] = [];

const GRAVITY = -9.5;        // m/s² — a touch floaty so the tumble reads
const FLOOR_Y = 0.07;        // weapon lies just above the floor plane
const BOUNCE = 0.30;         // vertical velocity retained per bounce
const FRICTION = 0.65;       // horizontal damping per bounce
const REST_SPEED = 0.6;      // contact below this vertical speed → settle

let sceneRef: THREE.Object3D | null = null;

/** Register the scene root the dropped weapons get added to. Called once
 *  at boot from main.ts. */
export function initWeaponDrop(scene: THREE.Object3D): void {
  sceneRef = scene;
}

/**
 * Fling a held item to the floor. `source` is the live viewmodel group
 * (parented to the camera) — we read its WORLD transform for the spawn
 * point + orientation and hide it. `spec` is the world drop model.
 * `forward`/`right` are the flattened camera basis; `side` is -1/+1 for
 * which hand, so the toss arcs out and away before it lands.
 */
export function dropHeldItem(
  spec: ModelSpec,
  source: THREE.Object3D,
  forward: THREE.Vector3,
  right: THREE.Vector3,
  side: number,
): void {
  if (!sceneRef) return;

  source.updateWorldMatrix(true, true);
  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  source.matrixWorld.decompose(wp, wq, ws);

  const built = buildModel(spec);
  const g = built.group;
  g.position.copy(wp);
  g.quaternion.copy(wq);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  sceneRef.add(g);
  source.visible = false;   // the hand lets go — hide the held model

  // Toss: mostly forward (so it lands roughly where the collapsing camera
  // ends up looking) with a little outward push to the hand's side, plus a
  // soft upward pop so it arcs before clattering down. Randomised tumble so
  // no two deaths drop the weapon the same way.
  const vx = forward.x * 1.0 + right.x * side * 0.55;
  const vz = forward.z * 1.0 + right.z * side * 0.55;
  drops.push({
    group: g,
    vx, vy: 1.15, vz,
    ax: 3 + Math.random() * 5,
    ay: 1.5 + Math.random() * 3,
    az: 5 + Math.random() * 6,
    rested: false,
  });
}

/** Advance every in-flight drop. Driven from the death tick with REAL dt
 *  so the weapon lands promptly (well before the world freezes), then
 *  rests on the floor through the rest of the collapse. */
export function tickWeaponDrops(dt: number): void {
  if (drops.length === 0) return;
  for (const d of drops) {
    if (d.rested) continue;
    d.vy += GRAVITY * dt;
    d.group.position.x += d.vx * dt;
    d.group.position.y += d.vy * dt;
    d.group.position.z += d.vz * dt;
    d.group.rotation.x += d.ax * dt;
    d.group.rotation.y += d.ay * dt;
    d.group.rotation.z += d.az * dt;

    if (d.group.position.y <= FLOOR_Y && d.vy < 0) {
      d.group.position.y = FLOOR_Y;
      if (-d.vy < REST_SPEED) {
        // Settle — lay the weapon over on its side so it reads as
        // "fallen", not stabbed upright into the floor. Keep the tumbled
        // yaw for a messy, dropped-where-it-landed pose.
        d.rested = true;
        d.vx = d.vy = d.vz = 0;
        d.group.rotation.set(Math.PI / 2, d.group.rotation.y, 0);
        playLootLand(d.group.position);
      } else {
        d.vy = -d.vy * BOUNCE;
        d.vx *= FRICTION;
        d.vz *= FRICTION;
        d.ax *= 0.5;
        d.az *= 0.5;
        playLootLand(d.group.position);
      }
    }
  }
}

/** Drop everything + clear (scene rebuild / new run). */
export function clearWeaponDrops(): void {
  for (const d of drops) d.group.parent?.remove(d.group);
  drops.length = 0;
}

// DEV-only inspection hook (stripped from the production bundle via the
// DEV literal): lets a headless test confirm a weapon actually spawned and
// is falling/resting during the death sequence.
if (DEV && typeof window !== 'undefined') {
  (window as unknown as { __weaponDrops?: () => unknown }).__weaponDrops = () =>
    drops.map((d) => ({
      y: +d.group.position.y.toFixed(3),
      rested: d.rested,
    }));
}
