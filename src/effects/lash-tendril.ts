import * as THREE from 'three';

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

export function spawnLashTendril(
  parent: THREE.Object3D,
  originY: number,
  reach: number,
  color: number,
): LashTendril {
  const group = new THREE.Group();
  group.position.set(0, originY, 0);   // caster-local; -Z is forward (faces player)
  parent.add(group);

  // Tapered tube of slime — stacked tapering spheres from a thick base to a
  // thin tip, so it reads organic rather than a clean cone. Shares one
  // emissive material so the whole limb flares together.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x081004,
    emissive: color,
    emissiveIntensity: 2.0,
    roughness: 0.5,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  });
  const SEGMENTS = 7;
  for (let i = 0; i < SEGMENTS; i++) {
    const f = i / (SEGMENTS - 1);            // 0 base → 1 tip
    const r = 0.55 * (1 - f) + 0.1;          // taper thick → thin
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), mat);
    seg.position.z = -reach * f;             // march along forward (-Z)
    // Slight organic sag/wave so it isn't a ruler-straight stick.
    seg.position.y = -0.18 * Math.sin(f * Math.PI);
    group.add(seg);
  }
  // Glowing tip blob — the "head" of the tentacle.
  const tipMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), tipMat);
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
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    },
  };
}
