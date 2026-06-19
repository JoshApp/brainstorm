import * as THREE from 'three';

// ARCHWAY EYE — the diegetic exit cue, as the dungeon's own eye set in the
// keystone. A dark stone eyeball + a glowing iris + two stone lids. The explored
// -map nav system drives it: OPEN (lids parted, iris kindled) on the near entrance
// toward unexplored ground; CLOSED (lidded, dark) once that branch is spent. The
// living dungeon watches the ways still worth taking and loses interest in the
// rest — the architecture expresses its attention. No HUD, no real light source
// (the iris is emissive + bloom). Built procedurally here (a scene effect, kin to
// the threshold drafts); placement + the open/close drive live in threshold-draft.

const EYE_W = 0.26;          // eyeball width (almond)
const IRIS_COLOR = 0xffc060; // warm amber-gold — the dungeon's gaze
const LID_PART = 0.085;      // how far each lid retracts when fully open

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export interface ArchwayEye {
  group: THREE.Group;
  /** 0 = lidded + dark; 1 = open + glowing. Eased externally. */
  setOpen(a: number): void;
  dispose(): void;
}

export function buildArchwayEye(scene: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion): ArchwayEye {
  const group = new THREE.Group();
  // Placed at the archway model's eye slot (world transform). The eye is
  // authored facing +Z; the slot's orientation aims it out of the keystone.
  group.position.copy(pos);
  group.quaternion.copy(quat);

  const stone = new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 1, metalness: 0, flatShading: true, fog: true });
  const lidStone = new THREE.MeshStandardMaterial({ color: 0x1d1913, roughness: 1, metalness: 0, flatShading: true, fog: true });

  // Socket ring — a carved rim so the eye reads as SET INTO the stone.
  const socket = new THREE.Mesh(new THREE.TorusGeometry(EYE_W * 0.62, EYE_W * 0.16, 8, 20), stone);
  socket.scale.set(1.15, 0.8, 0.5);
  socket.position.z = -0.02;
  group.add(socket);

  // Eyeball — flattened almond, recessed slightly into the keystone.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_W * 0.5, 16, 12), stone);
  ball.scale.set(1.2, 0.82, 0.6);
  ball.position.z = -0.05;
  group.add(ball);

  // Glow halo — a soft, larger additive disc behind the iris so the open eye
  // reads as LIGHT spilling out (pops against the warm stone via bloom).
  const haloMat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: IRIS_COLOR, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(EYE_W * 1.5, EYE_W * 1.1), haloMat);
  halo.position.z = EYE_W * 0.16;
  group.add(halo);

  // Iris — the bright gaze. ADDITIVE near-white-hot so it reads as light, not a
  // tinted surface. Opacity = how open the eye is.
  const irisMat = new THREE.MeshBasicMaterial({
    color: 0xffe8c0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const iris = new THREE.Mesh(new THREE.CircleGeometry(EYE_W * 0.3, 20), irisMat);
  iris.position.z = EYE_W * 0.2;
  group.add(iris);

  // Pupil — a dark round centre over the glow so it reads as an EYE, not a gem.
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(EYE_W * 0.13, 16), new THREE.MeshBasicMaterial({ color: 0x080406, transparent: true, opacity: 0, fog: true }));
  pupil.position.z = EYE_W * 0.22;
  group.add(pupil);

  // Lids — upper + lower stone covers. Closed → they meet over the iris; open →
  // they retract up/down to reveal the gaze. Half-dome ellipsoids.
  const mkLid = (): THREE.Mesh => {
    const lid = new THREE.Mesh(new THREE.SphereGeometry(EYE_W * 0.56, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lidStone);
    lid.scale.set(1.18, 0.62, 0.66);
    return lid;
  };
  const lidTop = mkLid();
  lidTop.position.z = EYE_W * 0.06;
  const lidBot = mkLid();
  lidBot.rotation.z = Math.PI;        // flip to cover the bottom
  lidBot.position.z = EYE_W * 0.06;
  group.add(lidTop, lidBot);

  scene.add(group);

  const setOpen = (a: number): void => {
    const t = Math.min(1, Math.max(0, a));
    irisMat.opacity = t;                 // the gaze kindles
    haloMat.opacity = 0.8 * t;           // light spills out
    (pupil.material as THREE.MeshBasicMaterial).opacity = t;   // pupil shows once the iris glows behind it
    // Lids part as it opens (closed at t=0 — domes meet at the centreline).
    lidTop.position.y = LID_PART * t;
    lidBot.position.y = -LID_PART * t;
  };
  setOpen(0);   // spawns CLOSED; the nav system opens it on near + unexplored

  const dispose = (): void => {
    group.parent?.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
      for (const mm of mats) mm.dispose();
    });
  };

  return { group, setOpen, dispose };
}
