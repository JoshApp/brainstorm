import * as THREE from 'three';

// Threshold draft — the diegetic "a way through here" cue at an open archway,
// replacing the old floor ember (which read as a placed object). Two parts:
//
//   - DUST: a few motes drifting slowly along the passage axis, like a draft
//     pulled between rooms. Always present (when near) — gives the doorway life.
//   - HAZE: a soft, irregular curtain of dusty air filling the opening that
//     BLOOMS as the player approaches and fades again behind them. Invisible
//     at distance (so it never reveals the whole map) and fades when you're
//     right on top of it (so it doesn't white out your view passing through).
//
// Both are diffuse + in-motion + tied to the opening's function (air/dust in a
// gap), so they read as atmosphere, not a marker. Faint + warm-neutral so the
// haze never looks like a sci-fi portal.

const DUST_COLOR = 0x9c937c;
const HAZE_COLOR = 0xb4aa90;
const HAZE_MAX_OPACITY = 0.16;     // faint — well under the lamp
const HAZE_HEIGHT = 2.4;
const MOTES_PER_DRAFT = 5;
const TICK_RANGE = 9;              // skip motes for drafts further than this
const DUST_SPEED = 0.18;          // m/s along the passage axis

type Axis = 'x' | 'z';

interface Mote {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  // Offset from the opening centre (the mote rides the draft from here).
  ox: number; oy: number; oz: number;
  vAxis: number;   // drift speed along the passage axis (signed)
  vLat: number;    // lateral wander
  baseOpacity: number;
}

interface Draft {
  cx: number; cz: number;
  axis: Axis;
  width: number;
  haze: THREE.Mesh;
  hazeMat: THREE.MeshBasicMaterial;
  motes: Mote[];
  t: number;
}

const drafts: Draft[] = [];
let hazeTex: THREE.Texture | null = null;
let moteTex: THREE.Texture | null = null;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Soft, irregular dust curtain — denser in the middle, fading at all edges,
// with a few faint dapples so it's not a clean gradient (clean = portal).
function hazeTexture(): THREE.Texture {
  if (hazeTex) return hazeTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s * 0.55, 0, s / 2, s * 0.55, s * 0.55);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  // Faint dapples for irregularity.
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const x = (Math.sin(i * 12.9) * 0.5 + 0.5) * s;
    const y = (Math.sin(i * 78.2 + 1.3) * 0.5 + 0.5) * s;
    const r = 6 + (Math.sin(i * 3.1) * 0.5 + 0.5) * 14;
    const dg = g.createRadialGradient(x, y, 0, x, y, r);
    dg.addColorStop(0, 'rgba(255,255,255,0.10)');
    dg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = dg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  hazeTex = new THREE.CanvasTexture(c);
  return hazeTex;
}

function moteTexture(): THREE.Texture {
  if (moteTex) return moteTex;
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  moteTex = new THREE.CanvasTexture(c);
  return moteTex;
}

// Cosmetic randomness only — fine on Math.random (matches the flame-phase
// build-model exclusion; doesn't affect gameplay or reproducible floors).
function rand(): number { return Math.random(); }

/** Place a draft at an open archway. `axis` is the passage direction (the
 *  motes drift along it; the haze faces across it); `width` is the opening
 *  width. Added under `scene` (the level root). */
export function spawnThresholdDraft(scene: THREE.Object3D, x: number, z: number, axis: Axis, width: number): void {
  const w = Math.min(2.2, Math.max(0.8, width));

  const hazeMat = new THREE.MeshBasicMaterial({
    map: hazeTexture(),
    color: HAZE_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(w, HAZE_HEIGHT), hazeMat);
  haze.position.set(x, HAZE_HEIGHT * 0.48, z);
  if (axis === 'x') haze.rotation.y = Math.PI / 2;   // normal along X (default plane faces +Z)
  scene.add(haze);

  const motes: Mote[] = [];
  for (let i = 0; i < MOTES_PER_DRAFT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: moteTexture(),
      color: DUST_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    const sprite = new THREE.Sprite(mat);
    const sz = 0.03 + rand() * 0.03;
    sprite.scale.set(sz, sz, 1);
    scene.add(sprite);
    const m: Mote = {
      sprite, mat,
      ox: (rand() - 0.5) * w,
      oy: 0.3 + rand() * 1.8,
      oz: (rand() - 0.5) * 0.8,
      vAxis: (rand() < 0.5 ? -1 : 1) * DUST_SPEED * (0.6 + rand() * 0.8),
      vLat: (rand() - 0.5) * 0.04,
      baseOpacity: 0.25 + rand() * 0.35,
    };
    motes.push(m);
    placeMote(x, z, axis, m);
  }

  drafts.push({ cx: x, cz: z, axis, width: w, haze, hazeMat, motes, t: rand() * 10 });
}

function placeMote(cx: number, cz: number, axis: Axis, m: Mote): void {
  // ox = along the passage axis; oz = lateral (across the opening).
  if (axis === 'z') {
    m.sprite.position.set(cx + m.oz, m.oy, cz + m.ox);
  } else {
    m.sprite.position.set(cx + m.ox, m.oy, cz + m.oz);
  }
}

/** Per-frame. Haze blooms with player proximity; dust drifts (only near). */
export function tickThresholdDrafts(dt: number, playerPos: THREE.Vector3): void {
  for (const d of drafts) {
    d.t += dt;
    const dist = Math.hypot(d.cx - playerPos.x, d.cz - playerPos.z);

    // Haze: 0 beyond 5m, blooms toward ~1.8m, then fades as you pass through
    // (so it doesn't white out the doorway you're standing in).
    const near = smoothstep(5.0, 1.8, dist);
    const notInside = smoothstep(0.4, 1.5, dist);
    const flicker = 0.88 + 0.12 * Math.sin(d.t * 1.7);
    d.hazeMat.opacity = HAZE_MAX_OPACITY * near * notInside * flicker;

    if (dist > TICK_RANGE) {
      for (const m of d.motes) m.mat.opacity = 0;
      continue;
    }
    // Dust visibility tracks proximity too (a touch wider than the haze).
    const dustVis = smoothstep(TICK_RANGE, 2.0, dist);
    for (const m of d.motes) {
      m.ox += m.vAxis * dt;
      m.oz += m.vLat * dt;
      m.oy += 0.02 * dt;
      // Recycle when it drifts out of the draft column.
      if (Math.abs(m.ox) > 1.3 || m.oy > 2.3) {
        m.ox = -Math.sign(m.vAxis) * (1.0 + rand() * 0.3);
        m.oy = 0.3 + rand() * 1.6;
        m.oz = (rand() - 0.5) * 0.8;
      }
      placeMote(d.cx, d.cz, d.axis, m);
      // Fade in at the ends of the column so they don't pop.
      const endFade = 1 - smoothstep(0.9, 1.3, Math.abs(m.ox));
      m.mat.opacity = m.baseOpacity * dustVis * endFade;
    }
  }
}

/** Remove all drafts + dispose. Call on level teardown. */
export function clearThresholdDrafts(): void {
  for (const d of drafts) {
    d.haze.parent?.remove(d.haze);
    d.haze.geometry.dispose();
    d.hazeMat.dispose();
    for (const m of d.motes) {
      m.sprite.parent?.remove(m.sprite);
      m.mat.dispose();
    }
  }
  drafts.length = 0;
}
