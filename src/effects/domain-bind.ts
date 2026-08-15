import * as THREE from 'three';
import type { DomainId } from '../content/domains';
import { DOMAIN_VISUAL } from '../art/domains';
import { getTexture } from '../style/procedural-textures';
import { flashDomainGlow } from '../ui/vignette';
import { disposeGpu } from '../scene/gpu-dispose';

// BINDING WITH A DOMAIN — the shared "this marks you" beat.
//
// Taking a fate OR a domain trinket isn't a silent stat change: for a breath the
// domain's SIGIL burns into view, a rune-ring closes around it, and the whole
// mark is drawn DOWN into the chest — you are binding to that power. Fates and
// trinkets both route through here, so the two systems SPEAK THE SAME LANGUAGE
// on collect (the first thread of unifying them). The domain's colour also floods
// the view (the existing acquisition flood), tying the screen wash to the sigil.
//
// Camera-parented (like the sword viewmodel + card-claim) so it stays in front of
// the eyes through any look, and self-driven off wall-clock time in onBeforeRender
// — no frame-loop wiring, cleans itself up when the ~1.05s beat ends.

const REST_Z = -0.82;                   // camera-local: in front, behind a claimed card (−0.60)
const REST_Y = -0.02;
const BLOOM_MS = 340;
const BIND_MS = 700;
const TOTAL_MS = BLOOM_MS + BIND_MS;

let cameraRef: THREE.PerspectiveCamera | null = null;

/** Wire the beat to the player camera (call once at boot, like initBreath). */
export function initDomainBind(camera: THREE.PerspectiveCamera): void {
  cameraRef = camera;
}

// The domain sigil rasterised to a canvas texture (drawn WHITE; the sprite's
// material colour tints it to the domain under additive blending). Cached per
// domain — one raster, reused for every bind of that domain.
const sigilCache = new Map<DomainId, THREE.CanvasTexture>();
function sigilTexture(domain: DomainId): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cached = sigilCache.get(domain);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sigilCache.set(domain, tex);
  const inner = DOMAIN_VISUAL[domain]?.svg ?? '';
  // White fill/stroke so the sprite colour is the only tint; the domain glyphs
  // use currentColor for their strokes, so set color too.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" color="#ffffff" fill="#ffffff" stroke="#ffffff">${inner}</svg>`;
  const img = new Image();
  img.onload = () => {
    const g = canvas.getContext('2d');
    if (g) { g.clearRect(0, 0, size, size); g.drawImage(img, 0, 0, size, size); tex.needsUpdate = true; }
  };
  img.onerror = () => { /* ring + flood still carry the beat */ };
  img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return tex;
}

/** Play the "binding with a domain" beat for `domain`, at `strength` (0..1 flood
 *  weight). `withFlood` adds the colour wash (default true; the card reading
 *  already floods, so card-claim passes false). No-op headless / pre-boot. */
export function bindToDomain(
  domain: DomainId,
  opts: { strength?: number; withFlood?: boolean } = {},
): void {
  const camera = cameraRef;
  if (!camera || typeof document === 'undefined') return;
  const vis = DOMAIN_VISUAL[domain];
  if (!vis) return;
  const color = new THREE.Color(vis.color);
  const strength = opts.strength ?? 0.85;
  if (opts.withFlood !== false) {
    try { flashDomainGlow(vis.color, strength); } catch { /* presentation */ }
  }

  const rig = new THREE.Group();
  rig.position.set(0, REST_Y, REST_Z);
  rig.frustumCulled = false;
  camera.add(rig);

  // The rune-ring — a flat annulus facing the player (camera-local, no billboard
  // needed), closing inward as the bind takes.
  const ringGeo = new THREE.RingGeometry(0.16, 0.19, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 9990;
  ring.frustumCulled = false;
  rig.add(ring);

  // The domain sigil — a tinted glyph sprite that blooms then is pulled in.
  const sigilTex = sigilTexture(domain);
  const sigilMat = new THREE.SpriteMaterial({
    map: sigilTex ?? getTexture('fire-wisp'), color,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  });
  const sigil = new THREE.Sprite(sigilMat);
  sigil.scale.set(0.2, 0.2, 0.2);
  sigil.renderOrder = 9991;
  sigil.frustumCulled = false;
  rig.add(sigil);

  // A soft domain-tinted glow behind the sigil so it reads against the dark.
  const glowMat = new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'), color,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(0.5, 0.5, 0.5);
  glow.position.z = -0.02;
  glow.renderOrder = 9989;
  glow.frustumCulled = false;
  rig.add(glow);

  const start = performance.now();
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    camera.remove(rig);
    // Deferred: these were drawn on the frame that is very likely still in
    // flight right now (see scene/gpu-dispose.ts).
    disposeGpu(ringGeo, ringMat, sigilMat, glowMat);
  };

  ring.onBeforeRender = () => {
    const el = performance.now() - start;
    if (el >= TOTAL_MS) { cleanup(); return; }

    if (el < BLOOM_MS) {
      // BLOOM — sigil + ring fade up bright, ring wide, sigil at rest size.
      const t = el / BLOOM_MS;
      const ease = 1 - (1 - t) * (1 - t);
      ringMat.opacity = ease * 0.9;
      ring.scale.setScalar(1.6 - 0.6 * ease);
      ring.rotation.z = t * 0.6;
      sigilMat.opacity = ease;
      sigil.scale.setScalar(0.18 + 0.14 * ease);
      glowMat.opacity = ease * 0.7;
      glow.scale.setScalar(0.4 + 0.2 * ease);
    } else {
      // BIND — the ring closes to a point, the sigil is pulled DOWN + IN toward
      // the chest and fades: the mark taken into you.
      const t = (el - BLOOM_MS) / BIND_MS;
      const rush = t * t;
      ring.scale.setScalar(1.0 * (1 - 0.9 * rush));
      ring.rotation.z = 0.6 + t * 1.6;
      ringMat.opacity = 0.9 * (1 - t);
      rig.position.z = REST_Z + 0.5 * rush;      // toward the eyes
      rig.position.y = REST_Y - 0.2 * rush;      // and down, into the chest
      sigilMat.opacity = 1 - rush;
      sigil.scale.setScalar(0.32 * (1 - 0.4 * rush));
      glowMat.opacity = 0.7 * (1 - t);
    }
  };
}
