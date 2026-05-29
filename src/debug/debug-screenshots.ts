// Extra debug screenshot layers for the capture tool.
//
// Each grabs the current rendered frame once, then composites a
// diagnostic overlay onto a 2D canvas:
//   - geometry  : wall segments + room rects, rooms labelled by vault
//   - lightHeat : floor light-level heatmap (samples sampleLightAt over
//                 a screen grid via floor-plane raycasts) + source markers
//   - cone      : boxes every object in the forward cone, provenance-labelled
//
// Kept separate from harness/annotate.ts (which is the entity-only
// annotated shot reused as the primary screenshot).

import * as THREE from 'three';
import type { DebugContext, LookAtInfo } from './capture';
import { sampleLightAt, listLightSourcesNear } from '../scene/light-pool';

const tmp = new THREE.Vector3();

interface Frame {
  base: HTMLImageElement;
  w: number;
  h: number;
  camera: THREE.PerspectiveCamera;
}

/** Grab the current frame as an Image once, for reuse across overlays. */
async function grabFrame(ctx: DebugContext): Promise<Frame> {
  ctx.renderer.render(ctx.scene, ctx.camera);
  const url = ctx.canvas.toDataURL('image/png');
  const base = await loadImage(url);
  return { base, w: ctx.canvas.width, h: ctx.canvas.height, camera: ctx.camera };
}

function newCanvas(f: Frame): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = f.w; c.height = f.h;
  const g = c.getContext('2d')!;
  g.drawImage(f.base, 0, 0, f.w, f.h);
  return { c, g };
}

/** World → screen pixels. Returns null if behind camera. */
function project(f: Frame, x: number, y: number, z: number): { px: number; py: number } | null {
  tmp.set(x, y, z).project(f.camera);
  if (tmp.z < -1 || tmp.z > 1) return null;
  return { px: (tmp.x + 1) * 0.5 * f.w, py: (1 - (tmp.y + 1) * 0.5) * f.h };
}

// ── Geometry overlay ─────────────────────────────────────────────────

export async function captureGeometryOverlay(
  ctx: DebugContext,
  f?: Frame,
): Promise<string> {
  const frame = f ?? await grabFrame(ctx);
  const level = ctx.getLevel();
  const { c, g } = newCanvas(frame);
  if (!level) return c.toDataURL('image/png');

  // Wall segments — project each end at floor + at wall height, draw the
  // base line + faint verticals so walls read as planes.
  const walls = level.walkable.getWallsForDebug();
  g.strokeStyle = 'rgba(90, 200, 255, 0.75)';
  g.lineWidth = 1.5;
  for (const w of walls) {
    const a = project(frame, w.ax, 0.05, w.az);
    const b = project(frame, w.bx, 0.05, w.bz);
    if (a && b) {
      g.beginPath(); g.moveTo(a.px, a.py); g.lineTo(b.px, b.py); g.stroke();
    }
    // verticals at the ends
    const at = project(frame, w.ax, 2.4, w.az);
    const bt = project(frame, w.bx, 2.4, w.bz);
    g.strokeStyle = 'rgba(90, 200, 255, 0.28)';
    if (a && at) { g.beginPath(); g.moveTo(a.px, a.py); g.lineTo(at.px, at.py); g.stroke(); }
    if (b && bt) { g.beginPath(); g.moveTo(b.px, b.py); g.lineTo(bt.px, bt.py); g.stroke(); }
    g.strokeStyle = 'rgba(90, 200, 255, 0.75)';
  }

  // Room rects — outline at floor + a label with the vault template.
  g.font = '12px ui-monospace, monospace';
  for (const room of level.spec.rooms) {
    if (room.logicalOnly) continue;
    const r = room.rect;
    const corners = [
      [r.x - r.w / 2, r.z - r.d / 2], [r.x + r.w / 2, r.z - r.d / 2],
      [r.x + r.w / 2, r.z + r.d / 2], [r.x - r.w / 2, r.z + r.d / 2],
    ].map(([x, z]) => project(frame, x, 0.03, z));
    g.strokeStyle = 'rgba(255, 210, 90, 0.6)';
    g.lineWidth = 1;
    g.beginPath();
    let started = false;
    for (const cn of corners) {
      if (!cn) continue;
      if (!started) { g.moveTo(cn.px, cn.py); started = true; } else g.lineTo(cn.px, cn.py);
    }
    if (started) { g.closePath(); g.stroke(); }
    // label at room centre
    const ctr = project(frame, r.x, 0.5, r.z);
    if (ctr) {
      const vault = level.spec.roomVaults?.[room.id];
      const label = vault ? `${room.id} [${vault}]` : room.id;
      drawLabel(g, label, ctr.px, ctr.py, 'rgba(255, 210, 90, 0.95)');
    }
  }
  return c.toDataURL('image/png');
}

// ── Light heatmap ────────────────────────────────────────────────────

export async function captureLightHeatmap(
  ctx: DebugContext,
  f?: Frame,
): Promise<string> {
  const frame = f ?? await grabFrame(ctx);
  const level = ctx.getLevel();
  const { c, g } = newCanvas(frame);
  if (!level) return c.toDataURL('image/png');

  // Floor-plane raycast per screen-grid cell → sample light there → tint.
  const ray = new THREE.Raycaster();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const STEP = 16; // px between samples
  const ndc = new THREE.Vector2();
  g.globalAlpha = 0.5;
  for (let py = 0; py < frame.h; py += STEP) {
    for (let px = 0; px < frame.w; px += STEP) {
      ndc.set((px / frame.w) * 2 - 1, -((py / frame.h) * 2 - 1));
      ray.setFromCamera(ndc, frame.camera);
      if (!ray.ray.intersectPlane(floor, hit)) continue;
      // Only sample points in front + within a sane range.
      const d = hit.distanceTo(frame.camera.position);
      if (d > 30) continue;
      const lvl = sampleLightAt(hit.x, 0.2, hit.z);
      g.fillStyle = heatColor(lvl);
      g.fillRect(px - STEP / 2, py - STEP / 2, STEP, STEP);
    }
  }
  g.globalAlpha = 1;

  // Mark light sources with a ring + intensity.
  const lights = listLightSourcesNear(frame.camera.position.x, frame.camera.position.z, 18);
  g.font = '11px ui-monospace, monospace';
  for (const lt of lights) {
    const p = project(frame, lt.pos.x, lt.pos.y, lt.pos.z);
    if (!p) continue;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(p.px, p.py, 7, 0, Math.PI * 2); g.stroke();
    drawLabel(g, `${lt.category} i${lt.intensity}`, p.px + 9, p.py, 'rgba(255,255,255,0.9)');
  }
  // legend
  drawLabel(g, 'light: blue=dark → red=bright', 8, frame.h - 10, 'rgba(255,255,255,0.85)');
  return c.toDataURL('image/png');
}

// ── Cone-objects annotated ───────────────────────────────────────────

export async function captureConeOverlay(
  ctx: DebugContext,
  cone: LookAtInfo[],
  f?: Frame,
): Promise<string> {
  const frame = f ?? await grabFrame(ctx);
  const { c, g } = newCanvas(frame);
  g.font = '12px ui-monospace, monospace';
  for (const obj of cone) {
    if (!obj.point) continue;
    const p = project(frame, obj.point.x, obj.point.y, obj.point.z);
    if (!p) continue;
    const color = obj.kind === 'enemy' ? 'rgba(255,90,90,0.95)'
      : obj.kind === 'interactable' ? 'rgba(120,220,255,0.95)'
      : 'rgba(180,255,150,0.9)';
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath(); g.arc(p.px, p.py, 6, 0, Math.PI * 2); g.stroke();
    const prov = obj.source ? ` {${obj.source}}` : '';
    drawLabel(g, `${obj.label}${prov}  ${obj.distance.toFixed(1)}m`, p.px + 8, p.py, color);
  }
  return c.toDataURL('image/png');
}

/** Capture all three overlays sharing a single base frame. */
export async function captureAllOverlays(
  ctx: DebugContext,
  cone: LookAtInfo[],
): Promise<{ geometry: string; lightHeat: string; cone: string }> {
  const f = await grabFrame(ctx);
  return {
    geometry: await captureGeometryOverlay(ctx, f),
    lightHeat: await captureLightHeatmap(ctx, f),
    cone: await captureConeOverlay(ctx, cone, f),
  };
}

// ── shared draw helpers ──────────────────────────────────────────────

function drawLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  const pad = 3;
  const w = g.measureText(text).width + pad * 2;
  const h = 15;
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(x, y - h, w, h);
  g.fillStyle = color;
  g.fillText(text, x + pad, y - 4);
}

/** Map a light level (raw sampleLightAt units) to a heat colour. The
 *  scale is empirical — torchlit floor reads ~50-300, pitch black ~0. */
function heatColor(level: number): string {
  const t = Math.min(1, level / 120);
  // blue (dark) → green → red (bright)
  const r = Math.round(255 * Math.min(1, t * 1.6));
  const b = Math.round(255 * Math.max(0, 1 - t * 1.6));
  const gr = Math.round(180 * (1 - Math.abs(t - 0.5) * 2));
  return `rgb(${r},${gr},${b})`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = (e) => rej(new Error('img load: ' + e));
    img.src = src;
  });
}
