import * as THREE from 'three';
import { registerWarmup } from '../content/warmup-registry';
import { groundYAt } from '../level/elevation';
import { acquireClone, releaseClone } from '../scene/effect-clone-pool';

// Summon telegraph — the "something is being called up HERE" tell that
// precedes a wave mob in an arena. Two layers:
//   - a glowing occult SIGIL burned into the floor (pentagram in a ring),
//     additive + blood-tinted, that fades in, slow-rotates, and pulses
//     harder as the spawn nears — pure lighting-as-signal,
//   - dark SMOKE boiling up out of it (normal-blended murk rising +
//     swelling), so the mob reads as clawing its way up through the floor.
// At spawn, burst() pops the sigil white-hot for a frame of punctuation.
//
// Lifecycle owned by the wave controller: spawn at telegraph start,
// setProgress() each frame over the windup, burst() + dispose() when the
// mob materialises.

let sigilTex: THREE.Texture | null = null;
function sigilTexture(): THREE.Texture {
  if (sigilTex) return sigilTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  const cx = s / 2;
  const cy = s / 2;
  const R = s * 0.42;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2.5;
  // Outer ring.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Pentagram — 5 points, connect every other ({5/2} star).
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82]);
  }
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const p = pts[(i * 2) % 5];
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.stroke();
  sigilTex = new THREE.CanvasTexture(c);
  return sigilTex;
}

let smokeTex: THREE.Texture | null = null;
function smokeTexture(): THREE.Texture {
  if (smokeTex) return smokeTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}

export interface SummonTelegraph {
  setProgress(t: number): void;   // 0..1 over the telegraph window
  burst(): void;                  // spawn-moment punctuation
  dispose(): void;
}

const SMOKE_COUNT = 5;

// Shared GPU resources — created ONCE, never disposed. Every telegraph reuses
// the same unit sigil plane (scaled per spawn) and ACQUIRES its material
// instances from the effect-clone-pool, releasing them on dispose. The old
// version minted 1 sigil + 5 smoke materials per telegraph and DISPOSED them
// the frame the mob materialised — on WebGPU that released the compiled
// pipelines with the last clone, so every arena wave paid a node rebuild +
// pipeline create (the recorded prog −3/+3 churn and 44–183ms spawn hitches).
let _sigilGeo: THREE.PlaneGeometry | null = null;
let _sigilTpl: THREE.MeshBasicMaterial | null = null;
let _smokeTpl: THREE.SpriteMaterial | null = null;
function shared() {
  if (!_sigilGeo) _sigilGeo = new THREE.PlaneGeometry(2, 2);   // unit sigil — scaled by radius
  if (!_sigilTpl) _sigilTpl = new THREE.MeshBasicMaterial({
    map: sigilTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  if (!_smokeTpl) _smokeTpl = new THREE.SpriteMaterial({
    map: smokeTexture(),
    color: 0x231a1c,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
  });
  return { sigilGeo: _sigilGeo, sigilTpl: _sigilTpl, smokeTpl: _smokeTpl };
}

export function spawnSummonTelegraph(
  scene: THREE.Object3D,
  x: number,
  z: number,
  tint = 0xc01818,
  radius = 0.7,
): SummonTelegraph {
  const { sigilGeo, sigilTpl, smokeTpl } = shared();
  const group = new THREE.Group();
  // Sit the sigil on the floor under the spawn point — arena rooms can be
  // elevated, and Y=0 floated the ring above a sunken arena's floor.
  group.position.set(x, groundYAt(x, z), z);
  scene.add(group);

  // Floor sigil — pooled material instance; reset the animated fields (a
  // recycled clone carries its previous wave's colour/opacity).
  const sigilMat = acquireClone(sigilTpl);
  sigilMat.color.setHex(tint);
  sigilMat.opacity = 0;
  const sigil = new THREE.Mesh(sigilGeo, sigilMat);
  sigil.scale.set(radius, radius, 1);
  sigil.position.y = 0.02;
  sigil.rotation.x = -Math.PI / 2;
  group.add(sigil);

  // Rising smoke puffs (normal-blended murk so it occludes the glow as it
  // billows up — additive dark would be invisible). Per-sprite pooled material
  // instances (each puff's opacity animates on its own phase).
  const smoke: THREE.Sprite[] = [];
  const smokeMats: THREE.SpriteMaterial[] = [];
  const smokeBase: number[] = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const m = acquireClone(smokeTpl);
    m.opacity = 0;
    smokeMats.push(m);
    const sp = new THREE.Sprite(m);
    const off = (i / SMOKE_COUNT) * Math.PI * 2;
    sp.userData.ox = Math.cos(off) * radius * 0.35;
    sp.userData.oz = Math.sin(off) * radius * 0.35;
    sp.userData.phase = i / SMOKE_COUNT;
    smokeBase.push(0.5 + (i % 2) * 0.2);
    group.add(sp);
    smoke.push(sp);
  }

  let disposed = false;

  function setProgress(t: number) {
    if (disposed) return;
    const c = Math.max(0, Math.min(1, t));
    // Sigil fades in fast, then pulses harder toward the spawn.
    const pulse = 0.7 + 0.3 * Math.sin(c * 28);
    sigilMat.opacity = Math.min(1, c * 2) * (0.55 + 0.45 * c) * pulse;
    sigil.rotation.z = c * 2.2;                       // slow occult turn
    const sc = radius * (0.7 + 0.3 * c);              // unit plane → scale carries the radius
    sigil.scale.set(sc, sc, 1);
    // Smoke rises + swells + thickens.
    for (let i = 0; i < smoke.length; i++) {
      const sp = smoke[i];
      const local = Math.max(0, Math.min(1, (c - sp.userData.phase * 0.25) / 0.75));
      const h = 0.1 + local * 1.4;
      sp.position.set(sp.userData.ox * (1 + local), h, sp.userData.oz * (1 + local));
      const size = 0.3 + local * 0.7;
      sp.scale.set(size, size, 1);
      (sp.material as THREE.SpriteMaterial).opacity = smokeBase[i] * Math.sin(local * Math.PI) * 0.9;
    }
  }

  function burst() {
    if (disposed) return;
    sigilMat.color.setHex(0xffd0c0);
    sigilMat.opacity = 1;
    sigil.scale.set(radius * 1.3, radius * 1.3, 1);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    // RELEASE the pooled clones — never dispose materials or the shared sigil
    // plane (disposing released the pipelines with the last telegraph, and the
    // next wave's sigil recompiled mid-play — the recorded spawn hitches).
    releaseClone(sigilTpl, sigilMat);
    for (const m of smokeMats) releaseClone(smokeTpl, m);
  }

  setProgress(0);
  return { setProgress, burst, dispose };
}

// Warm the caster telegraph (acolyte cast etc.) — a heavy first-use compile
// (~259ms freeze seen on the first cast of a fight). noCull renders it.
let _warmTel: ReturnType<typeof spawnSummonTelegraph> | null = null;
registerWarmup({ label: 'summon-telegraph', spawn: (s) => { _warmTel = spawnSummonTelegraph(s, 0, 0); }, clear: () => { _warmTel?.dispose(); _warmTel = null; } });
