import * as THREE from 'three';

// Stagger "seeing stars" indicator — the cartoon/WC3 stun tell over a reeling
// enemy's head, rendered in a grimdark register (cold spectral sparks, not
// bright primary stars). A small ring of star sprites that ORBITS the head while
// the enemy is staggered, fading in/out. Paired with the model's dizzy tumble
// (driven in enemy.ts) it reads unmistakably as "stunned, open."

let starTex: THREE.CanvasTexture | null = null;

/** A 4-point sparkle drawn once, shared by every enemy's stun ring. */
function getStarTexture(): THREE.CanvasTexture {
  if (starTex) return starTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  // Soft glow core.
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(200,225,255,0.35)');
  g.addColorStop(1, 'rgba(160,200,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, s / 2, 0, Math.PI * 2); ctx.fill();
  // 4-point star spikes.
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  const R = s / 2 - 4, r = 5;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}

export interface StunStars {
  /** Advance the orbit + fade. `staggered` drives fade in/out. Returns nothing. */
  tick(dt: number, staggered: boolean): void;
  dispose(): void;
}

const STAR_COUNT = 3;
const ORBIT_RADIUS = 0.26;

// Template SpriteMaterial — built ONCE (with the shared star texture), cloned
// per stagger. Every star in a ring fades together (same opacity), so ONE clone
// covers all STAR_COUNT sprites; the clone shares the template's program and the
// never-disposed template pins it. Was STAR_COUNT fresh SpriteMaterials per
// stagger — a program/material churn on the most frequent combat beat.
let starMatTpl: THREE.SpriteMaterial | null = null;
function getStarMatTemplate(): THREE.SpriteMaterial {
  if (!starMatTpl) starMatTpl = new THREE.SpriteMaterial({
    // depthTest OFF + high renderOrder → an OVERLAY cue that always reads
    // above the head, never buried inside the (often tall) body mesh.
    map: getStarTexture(), color: 0xeaf2ff, transparent: true, opacity: 0,
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false,
  });
  return starMatTpl;
}

/** Build a stun-star ring parented to `parent` (the enemy container) at local
 *  height `y`. Hidden until tick(dt, true) fades it in. */
export function createStunStars(parent: THREE.Object3D, y: number): StunStars {
  const group = new THREE.Group();
  group.position.set(0, y, 0);
  group.visible = false;
  // One material clone for the whole ring (all stars share opacity).
  const mat = getStarMatTemplate().clone();
  const sprites: THREE.Sprite[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 9500;
    const a = (i / STAR_COUNT) * Math.PI * 2;
    sp.position.set(Math.cos(a) * ORBIT_RADIUS, 0, Math.sin(a) * ORBIT_RADIUS);
    sp.scale.setScalar(0.24);
    group.add(sp);
    sprites.push(sp);
  }
  parent.add(group);

  let opacity = 0;
  let spin = 0;

  function tick(dt: number, staggered: boolean): void {
    const target = staggered ? 1 : 0;
    opacity += (target - opacity) * Math.min(1, dt * 12);
    if (opacity < 0.01 && !staggered) {
      if (group.visible) group.visible = false;
      return;
    }
    group.visible = true;
    spin += dt * 3.2;                       // the orbit
    group.rotation.y = spin;
    mat.opacity = opacity * 0.9;            // shared across the ring → set once
    for (let i = 0; i < sprites.length; i++) {
      // gentle vertical bob, desynced per star
      sprites[i].position.y = Math.sin(spin * 2 + i * 2.1) * 0.05;
    }
  }

  function dispose(): void {
    parent.remove(group);
    mat.dispose();   // the single ring material clone (geometry is Sprite-internal/shared)
  }

  return { tick, dispose };
}
