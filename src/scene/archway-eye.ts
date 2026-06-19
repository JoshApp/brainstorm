import * as THREE from 'three';

// ARCHWAY EYE — the diegetic exit cue, as the dungeon's own eye set in the
// keystone. A dark stone eyeball + a glowing iris + two stone lids, mounted at
// the frame model's keystone slots (see level/frame.ts). The nav system feeds it
// an open TARGET (open on the near entrance toward unexplored ground; closed once
// that branch is spent) and the player's position; the eye owns the rest of its
// life — easing open/shut, a faint flicker, an occasional blink, and TRACKING
// the player so the gaze follows you across the room. The living dungeon watches.

const EYE_W = 0.26;          // base eyeball width (almond)
const EYE_SCALE = 0.95;      // overall model size multiplier (the whole eye)

// The gaze colour — an UNCOMMON cool-pale light in the warm torchlit dark, so it
// reads as something OTHER, watching (and pops against the warm scene). Tune
// here: warm amber 0xffc060 / sickly green 0x9affc0 / blood 0xff5a4a /
// moonlight 0xbfe0ff. Core is the bright centre; glow is the halo spill.
const GAZE_CORE = 0xfff4ec;  // near-white, faint cool cast — the bright pupil-light
const GAZE_GLOW = 0xffcf8a;  // pale gold halo

const LID_PART = 0.085;      // how far each lid retracts when fully open
// The eye sits high on the keystone (~2.7m) and the player looks UP at it from
// ~1.6m, so a horizontal gaze buries it behind the lower lid. Pitch the whole
// eye down toward the floor so it faces the player below; the gaze-tracking then
// adjusts from this rest. ~32° reads face-on from a few metres back.
const REST_PITCH = 0.55;     // rad — downward tilt of the resting gaze
const KINDLE_RATE = 4;       // open / close ease speed
const MAX_GAZE = 0.5;        // rad — how far the eyeball turns to follow the player
const GAZE_RATE = 5;         // eyeball-turn ease speed
const BLINK_PERIOD = 5.5;    // seconds between blinks (per-eye phase offset)
const BLINK_FRAC = 0.03;     // fraction of the period a wink lasts (~0.16s)

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

// Scratch — reused across all eyes each frame (single-threaded, synchronous).
const _toPlayer = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, 1);
const _axis = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();

export interface ArchwayEye {
  group: THREE.Group;
  /** Per-frame life: ease toward `openTarget` (0..1), flicker, blink, and turn
   *  the gaze to track the player. Driven by the nav tick (threshold-draft). */
  update(dt: number, openTarget: number, player: { x: number; y: number; z: number }): void;
  dispose(): void;
}

export function buildArchwayEye(scene: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion): ArchwayEye {
  const group = new THREE.Group();
  // Placed at the frame model's eye slot (world transform). The eye is authored
  // facing +Z; the slot's orientation aims it out of the keystone, then we pitch
  // it down (local +X) so it looks toward the player standing below.
  group.position.copy(pos);
  group.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), REST_PITCH));
  group.scale.setScalar(EYE_SCALE);

  // The eye never moves — cache its world placement once for the gaze math
  // (invQuat is the FULL tilted orientation, so tracking adjusts from the rest).
  const eyeWorld = pos.clone();
  const invQuat = group.quaternion.clone().invert();
  // Stagger blinks so a row of eyes doesn't wink in unison.
  const blinkOffset = ((pos.x * 1.73 + pos.z * 0.91) % BLINK_PERIOD + BLINK_PERIOD) % BLINK_PERIOD;

  const stone = new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 1, metalness: 0, flatShading: true, fog: true });
  const lidStone = new THREE.MeshStandardMaterial({ color: 0x1d1913, roughness: 1, metalness: 0, flatShading: true, fog: true });

  // Socket ring — a carved rim so the eye reads as SET INTO the stone (fixed).
  const socket = new THREE.Mesh(new THREE.TorusGeometry(EYE_W * 0.62, EYE_W * 0.16, 8, 20), stone);
  socket.scale.set(1.15, 0.8, 0.5);
  socket.position.z = -0.02;
  group.add(socket);

  // Glow halo — soft additive disc so the open eye reads as LIGHT spilling out
  // (fixed; the gaze moves over it).
  const haloMat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: GAZE_GLOW, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(EYE_W * 1.5, EYE_W * 1.1), haloMat);
  halo.position.z = EYE_W * 0.16;
  group.add(halo);

  // GAZE PIVOT — the eyeball + iris + pupil ride this; rotating it turns the eye
  // to look at the player. The socket, halo, and lids stay put.
  const gaze = new THREE.Group();
  group.add(gaze);

  // Eyeball — flattened almond, recessed slightly into the keystone.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_W * 0.5, 16, 12), stone);
  ball.scale.set(1.2, 0.82, 0.6);
  ball.position.z = -0.05;
  gaze.add(ball);

  // Iris — the bright gaze. ADDITIVE so it reads as light, not a tinted surface.
  const irisMat = new THREE.MeshBasicMaterial({
    color: GAZE_CORE, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const iris = new THREE.Mesh(new THREE.CircleGeometry(EYE_W * 0.3, 20), irisMat);
  iris.position.z = EYE_W * 0.2;
  gaze.add(iris);

  // Pupil — a dark round centre over the glow so it reads as an EYE, not a gem.
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x080406, transparent: true, opacity: 0, fog: true });
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(EYE_W * 0.13, 16), pupilMat);
  pupil.position.z = EYE_W * 0.22;
  gaze.add(pupil);

  // Lids — upper + lower stone covers, IN FRONT of the iris so closing them
  // covers the gaze (a real wink). Open → they retract up/down; closed → meet.
  const mkLid = (): THREE.Mesh => {
    const lid = new THREE.Mesh(new THREE.SphereGeometry(EYE_W * 0.56, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lidStone);
    lid.scale.set(1.18, 0.62, 0.66);
    lid.position.z = EYE_W * 0.24;
    return lid;
  };
  const lidTop = mkLid();
  const lidBot = mkLid();
  lidBot.rotation.z = Math.PI;        // flip to cover the bottom
  group.add(lidTop, lidBot);

  scene.add(group);

  let lit = 0;   // eased open amount
  let t = 0;     // life clock (flicker + blink)

  const update = (dt: number, openTarget: number, player: { x: number; y: number; z: number }): void => {
    t += dt;
    lit += (Math.min(1, Math.max(0, openTarget)) - lit) * Math.min(1, dt * KINDLE_RATE);

    // Blink — a quick wink: lids dip + gaze dims for a fraction of the period.
    const ph = ((t + blinkOffset) / BLINK_PERIOD) % 1;
    const blink = ph < BLINK_FRAC ? 1 - Math.sin((ph / BLINK_FRAC) * Math.PI) * 0.92 : 1;
    const flicker = 0.9 + 0.1 * Math.sin(t * 2.3);
    const shown = lit * blink;

    irisMat.opacity = shown * flicker;
    haloMat.opacity = 0.8 * shown * flicker;
    pupilMat.opacity = shown;
    lidTop.position.y = LID_PART * shown;
    lidBot.position.y = -LID_PART * shown;

    // Track the player — turn the gaze toward them while the eye is open enough
    // to see; otherwise ease back to centre. Clamped to a cone so it never turns
    // past the socket.
    const track = lit > 0.15;
    _toPlayer.set(player.x - eyeWorld.x, player.y - eyeWorld.y, player.z - eyeWorld.z);
    if (track && _toPlayer.lengthSq() > 1e-6) {
      _toPlayer.normalize().applyQuaternion(invQuat);   // player dir in eye-local space
      _axis.crossVectors(_fwd, _toPlayer);
      if (_axis.lengthSq() > 1e-8) {
        _axis.normalize();
        _targetQuat.setFromAxisAngle(_axis, Math.min(_fwd.angleTo(_toPlayer), MAX_GAZE));
      } else _targetQuat.identity();
    } else _targetQuat.identity();
    gaze.quaternion.slerp(_targetQuat, Math.min(1, dt * GAZE_RATE));
  };
  update(0, 0, eyeWorld);   // spawn closed, gaze centred

  const dispose = (): void => {
    group.parent?.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
      for (const mm of mats) mm.dispose();
    });
  };

  return { group, update, dispose };
}
