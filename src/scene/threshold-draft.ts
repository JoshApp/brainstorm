import * as THREE from 'three';
import { type ArchwayEye } from './archway-eye';

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
const HAZE_MAX_OPACITY = 0.22;     // per-layer base (×weight, ×3 layers); tune to taste
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

// The haze used to be a few layered planes at slightly different depths
// within the archway frame, but it ALWAYS read as a portal at glance
// — disabled by setting the layer count to 0. The dust motes + the
// frame proximity glow still carry the "way through here" cue without
// any plane-of-air across the opening.
const HAZE_LAYERS = 0;
const HAZE_DEPTH = 0.4;
const HAZE_WIDTH_INSET = 0.82;
const HAZE_LAYER_WEIGHT = [0.45, 0.72, 0.45];

interface HazeLayer { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; weight: number; }

interface Draft {
  cx: number; cz: number;
  axis: Axis;
  width: number;
  floorY: number;   // world-Y of the floor under this opening (rooms vary in elevation)
  hazeLayers: HazeLayer[];
  motes: Mote[];
  t: number;
}

const drafts: Draft[] = [];
let hazeTex: THREE.Texture | null = null;
let moteTex: THREE.Texture | null = null;

// Archway frame glow — the lintel/keystone 'glow' material on each corridor
// archway, brightened by player proximity so the gate's crown lights up to
// mark a passage. Registered by the builder for props flagged proximityGlow.
// Toned down from 0.3 to 0.13 so the archway crown still warms as
// the player approaches but doesn't read as a bright "glow".
// Combined with the emissive colour shift on the 'glow' material
// (0xff8c3a → 0xc05a18 in content/archway.ts), the peak proximity
// glow now sits at a much more restrained register.
const GLOW_MAX_EMISSIVE = 0.16;

interface FrameGlow { mat: THREE.MeshStandardMaterial; x: number; z: number; }
const frameGlows: FrameGlow[] = [];

export function registerArchwayGlow(mat: THREE.MeshStandardMaterial, x: number, z: number): void {
  frameGlows.push({ mat, x, z });
}

// EXIT LURE — the diegetic navigation cue, the dungeon's own EYE set in the arch
// keystone (see scene/archway-eye.ts). It OPENS (lids part, iris kindles) on the
// near entrance to ground that still holds unexplored stuff, and CLOSES (lidded,
// dark) once that branch is explored. The living dungeon watches the ways still
// worth taking and loses interest in the rest — the architecture expresses its
// attention. Shown only on the near end, never the far exit down a corridor.
//
// `cold` (branch beyond is done) + `near` (adjacent to current room) are set
// EXTERNALLY by the explored-map nav system; this file only renders the lure.

export interface Lure {
  eye: ArchwayEye;
  x: number; z: number;             // archway centre — the match key for explored-map
  cold: boolean;                    // set by nav: branch beyond is exhausted
  near: boolean;                    // set by nav: adjacent to the player's current room
}
const lures: Lure[] = [];

/** Register an archway eye (built by the builder at the frame model's keystone
 *  slot) as an exit lure. `x,z` is the archway's world centre — the key the nav
 *  system matches against floor-graph edges. The eye owns its own open easing,
 *  flicker, blink, and gaze (see archway-eye.ts); the lure just carries cold/near. */
export function registerArchwayLure(eye: ArchwayEye, x: number, z: number): void {
  lures.push({ eye, x, z, cold: false, near: false });
}

/** The live exit-lure handles (the nav system matches these to floor edges and
 *  drives their `cold` + `near` flags). */
export function getArchwayLures(): readonly Lure[] {
  return lures;
}

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
export function spawnThresholdDraft(scene: THREE.Object3D, x: number, z: number, axis: Axis, width: number, floorY = 0, ceilingH = 3.2): void {
  const w = Math.min(2.2, Math.max(0.8, width)) * HAZE_WIDTH_INSET;

  // Layered haze planes at staggered depths within the archway frame.
  const hazeLayers: HazeLayer[] = [];
  for (let i = 0; i < HAZE_LAYERS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: hazeTexture(),
      color: HAZE_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });
    // Vary size per layer so the stack doesn't read as one crisp rectangle.
    const sclW = 0.86 + (i % 2) * 0.18;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * sclW, HAZE_HEIGHT * (0.9 + (i % 2) * 0.08)), mat);
    const off = (HAZE_LAYERS > 1 ? i / (HAZE_LAYERS - 1) - 0.5 : 0) * HAZE_DEPTH;
    if (axis === 'z') {
      mesh.position.set(x, HAZE_HEIGHT * 0.46, z + off);
    } else {
      mesh.position.set(x + off, HAZE_HEIGHT * 0.46, z);
      mesh.rotation.y = Math.PI / 2;   // normal along X (default plane faces +Z)
    }
    scene.add(mesh);
    hazeLayers.push({ mesh, mat, weight: HAZE_LAYER_WEIGHT[i] ?? 0.5 });
  }

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
    const sz = 0.04 + rand() * 0.04;
    sprite.scale.set(sz, sz, 1);
    scene.add(sprite);
    const m: Mote = {
      sprite, mat,
      ox: (rand() - 0.5) * w,
      oy: 0.3 + rand() * 1.8,
      oz: (rand() - 0.5) * 0.8,
      vAxis: (rand() < 0.5 ? -1 : 1) * DUST_SPEED * (0.6 + rand() * 0.8),
      vLat: (rand() - 0.5) * 0.04,
      baseOpacity: 0.35 + rand() * 0.4,
    };
    motes.push(m);
    placeMote(x, z, floorY, axis, m);
  }

  drafts.push({ cx: x, cz: z, axis, width: w, floorY, hazeLayers, motes, t: rand() * 10 });

  void ceilingH;   // (the eye is built separately, at the archway model's slot)
}

function placeMote(cx: number, cz: number, floorY: number, axis: Axis, m: Mote): void {
  // ox = along the passage axis; oz = lateral (across the opening). oy is height
  // ABOVE THE FLOOR under the opening (so motes don't float in elevated rooms).
  if (axis === 'z') {
    m.sprite.position.set(cx + m.oz, floorY + m.oy, cz + m.ox);
  } else {
    m.sprite.position.set(cx + m.ox, floorY + m.oy, cz + m.oz);
  }
}

/** Per-frame. Haze blooms with player proximity; dust drifts (only near);
 *  archway frames glow brighter as you approach. */
export function tickThresholdDrafts(dt: number, playerPos: THREE.Vector3): void {
  // Archway crown — its natural warm proximity glow (decoration, not the cue).
  for (const f of frameGlows) {
    const dist = Math.hypot(f.x - playerPos.x, f.z - playerPos.z);
    f.mat.emissiveIntensity = GLOW_MAX_EMISSIVE * smoothstep(2.5, 1.0, dist);
  }

  // Exit eyes — OPEN only where it's a NEAR entrance (adjacent to the current
  // room) to unexplored ground; CLOSE where the branch is explored. The open
  // TARGET blooms by proximity (the gaze kindles as you near it, not across the
  // whole floor); the eye owns the easing + flicker + blink + player-tracking.
  for (const lure of lures) {
    const dist = Math.hypot(lure.x - playerPos.x, lure.z - playerPos.z);
    const want = (lure.near && !lure.cold) ? smoothstep(8.0, 2.0, dist) : 0;
    lure.eye.update(dt, want, playerPos);
  }
  for (const d of drafts) {
    d.t += dt;
    const dist = Math.hypot(d.cx - playerPos.x, d.cz - playerPos.z);

    // Haze: 0 beyond 6m, blooms toward ~2m, then fades as you pass through
    // (so it doesn't white out the doorway you're standing in).
    const near = smoothstep(6.0, 2.0, dist);
    const notInside = smoothstep(0.4, 1.5, dist);
    const flicker = 0.88 + 0.12 * Math.sin(d.t * 1.7);
    const hazeOp = HAZE_MAX_OPACITY * near * notInside * flicker;
    for (const l of d.hazeLayers) l.mat.opacity = hazeOp * l.weight;

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
      placeMote(d.cx, d.cz, d.floorY, d.axis, m);
      // Fade in at the ends of the column so they don't pop.
      const endFade = 1 - smoothstep(0.9, 1.3, Math.abs(m.ox));
      m.mat.opacity = m.baseOpacity * dustVis * endFade;
    }
  }
}

/** Remove all drafts + dispose. Call on level teardown. */
export function clearThresholdDrafts(): void {
  for (const d of drafts) {
    for (const l of d.hazeLayers) {
      l.mesh.parent?.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mat.dispose();
    }
    for (const m of d.motes) {
      m.sprite.parent?.remove(m.sprite);
      m.mat.dispose();
    }
  }
  for (const lure of lures) lure.eye.dispose();
  drafts.length = 0;
  frameGlows.length = 0;
  lures.length = 0;
}
