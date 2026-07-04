import * as THREE from 'three';
import { registerWarmup } from '../content/warmup-registry';
import { acquireClone, releaseClone } from '../scene/effect-clone-pool';

// Slime tentacle for the king's lash. A tapered limb that FORMS out of the
// body and reaches toward the player: it's parented to the caster's
// container (which faces the player), so it points along local -Z
// (forward) and grows out over the wind-up — a readable "something is
// reaching for you" tell — then snaps to full extension + flares on the
// strike, and retracts as it disposes.
//
// Built at full length; growth/retraction is just the group's z-scale, so
// it's cheap to drive each frame.

export interface LashTendril {
  /** 0..1 over the wind-up — how far the tentacle has reached out. */
  setProgress(t: number): void;
  /** Strike — snap to full extension + flare. */
  snap(): void;
  dispose(): void;
}

const SEGMENTS = 7;

// Shared GPU resources — built ONCE, never disposed. The per-segment sphere
// radii are fixed (taper depends only on the segment index, not on reach), so
// every lash reuses the same 7 segment geometries + 1 tip geometry. The
// materials are per-lash instances (colour/emissive vary per caster) ACQUIRED
// from the effect-clone-pool and released on teardown — never disposed. On
// WebGPU, disposing the last live clone releases the compiled pipeline + node
// builder state and the next lash recompiles mid-fight (see
// scene/effect-clone-pool.ts).
let _segGeo: THREE.SphereGeometry[] | null = null;
let _tipGeo: THREE.SphereGeometry | null = null;
let _matTpl: THREE.MeshStandardMaterial | null = null;
let _tipMatTpl: THREE.MeshBasicMaterial | null = null;
function shared() {
  if (!_segGeo) {
    _segGeo = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const f = i / (SEGMENTS - 1);
      const r = 0.55 * (1 - f) + 0.1;        // taper thick → thin (index-only → shareable)
      _segGeo.push(new THREE.SphereGeometry(r, 9, 7));
    }
  }
  if (!_tipGeo) _tipGeo = new THREE.SphereGeometry(0.34, 12, 10);
  if (!_matTpl) _matTpl = new THREE.MeshStandardMaterial({
    color: 0x081004, emissive: 0xffffff, emissiveIntensity: 2.0,
    roughness: 0.5, transparent: true, opacity: 0.96, depthWrite: false,
  });
  if (!_tipMatTpl) _tipMatTpl = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  return { segGeo: _segGeo, tipGeo: _tipGeo, matTpl: _matTpl, tipMatTpl: _tipMatTpl };
}

export function spawnLashTendril(
  parent: THREE.Object3D,
  originY: number,
  reach: number,
  color: number,
): LashTendril {
  const { segGeo, tipGeo, matTpl, tipMatTpl } = shared();
  const group = new THREE.Group();
  group.position.set(0, originY, 0);   // caster-local; -Z is forward (faces player)
  parent.add(group);

  // Tapered tube of slime — stacked tapering spheres from a thick base to a
  // thin tip, so it reads organic rather than a clean cone. One pooled emissive
  // material shared across the limb so it flares together (colour set per caster;
  // reset every animated field — a recycled clone carries its last lash's values).
  const mat = acquireClone(matTpl);
  mat.emissive.setHex(color);
  mat.emissiveIntensity = 2.0;
  mat.opacity = 0.96;
  for (let i = 0; i < SEGMENTS; i++) {
    const f = i / (SEGMENTS - 1);            // 0 base → 1 tip
    const seg = new THREE.Mesh(segGeo[i], mat);
    seg.position.z = -reach * f;             // march along forward (-Z)
    // Slight organic sag/wave so it isn't a ruler-straight stick.
    seg.position.y = -0.18 * Math.sin(f * Math.PI);
    group.add(seg);
  }
  // Glowing tip blob — the "head" of the tentacle.
  const tipMat = acquireClone(tipMatTpl);
  tipMat.color.setHex(color);
  tipMat.opacity = 0.9;
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.set(0, -0.18 * Math.sin(Math.PI), -reach);
  group.add(tip);

  group.scale.z = 0.001;   // starts unformed (a bud at the body)

  return {
    setProgress(t: number) {
      const g = Math.max(0.001, t);
      group.scale.z = g;
      mat.emissiveIntensity = 1.6 + 1.6 * t;
      tipMat.opacity = 0.5 + 0.4 * t;
    },
    snap() {
      group.scale.z = 1;
      mat.emissiveIntensity = 6.0;   // hot flare on the strike
      tipMat.opacity = 1.0;
    },
    dispose() {
      parent.remove(group);
      // RELEASE the clones to the pool — never dispose (disposing the last live
      // clone releases the pipeline; the next lash would recompile mid-fight).
      releaseClone(matTpl, mat);
      releaseClone(tipMatTpl, tipMat);
    },
  };
}

// Warm the lasher tendril's shared template program (pinned once, never disposed).
let _warmLash: ReturnType<typeof spawnLashTendril> | null = null;
registerWarmup({ label: 'lash-tendril', spawn: (s) => { _warmLash = spawnLashTendril(s, 0, 1, 0xff4444); }, clear: () => { _warmLash?.dispose(); _warmLash = null; } });
