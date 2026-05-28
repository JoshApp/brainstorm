// Annotated screenshot pipeline.
//
// Forces a fresh render, reads the WebGL canvas as a data URL, then
// composites onto a 2D canvas with entity bounding boxes + labels.
// Returns the composite PNG + the structured annotation list so the
// CLI driver can dump a JSON sidecar alongside the image.
//
// Entity bbox derivation: project the entity's world position (camera-
// projected NDC) into pixel space. Estimate height + width from the
// entity's collision radius — close enough that the box reads as
// "this is where the rat is", which is what I want when scrolling
// transcripts.

import * as THREE from 'three';
import { buildObservation } from './observation';
import type { Screenshot, Annotation, Observation } from './types';
import type { HarnessContext } from './state';

const tmpVec = new THREE.Vector3();

export async function captureScreenshot(
  ctx: HarnessContext,
  opts?: { annotated?: boolean },
): Promise<Screenshot> {
  const level = ctx.getLevel();
  if (!level) throw new Error('[harness] no live level — cannot screenshot');

  // Force a fresh render so the next read sees the current state. The
  // tick loop renders every frame too, but explicit render here makes
  // the screenshot self-contained: paused frame → click → captured
  // exactly that frame.
  ctx.renderer.render(ctx.scene, ctx.camera);

  // Read raw WebGL canvas as PNG.
  const rawPng = ctx.canvas.toDataURL('image/png');
  const size = { w: ctx.canvas.width, h: ctx.canvas.height };

  // Build observation now so annotations align with the post-render
  // world state.
  const obs = buildObservation(ctx.camera, level);
  const annotations = computeAnnotations(ctx, obs);

  let outPng = rawPng;
  if (opts?.annotated !== false) {
    outPng = await composite(rawPng, size, annotations);
  }

  return {
    pngDataUrl: outPng,
    size,
    camera: {
      pos: { x: round(ctx.camera.position.x), y: round(ctx.camera.position.y), z: round(ctx.camera.position.z) },
      yaw: round(ctx.camera.rotation.y, 3),
      pitch: round(ctx.camera.rotation.x, 3),
    },
    annotations,
  };
}

function computeAnnotations(ctx: HarnessContext, obs: Observation): Annotation[] {
  const out: Annotation[] = [];
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Enemies — taller boxes, height ≈ 1.6m
  for (const e of obs.visible.enemies) {
    // Approximate body center at +0.8m above the ground.
    const proj = projectWorldToScreen(ctx.camera, e.pos.x, 0.8, e.pos.z, w, h);
    if (!proj || !proj.onScreen) continue;
    // Estimate pixel half-extents from a 0.3m horizontal offset projected
    // at the same world point. NDC width per metre depends on distance.
    const widthPx = pixelExtent(ctx.camera, e.pos.x, 0.8, e.pos.z, 0.3, w);
    const heightPx = widthPx * 2.2;  // body taller than wide
    out.push({
      id: e.id,
      kind: e.kind,
      label: `${e.kind} ${e.hp.current}/${e.hp.max} ${e.state}${e.inSight ? '' : ' [LOS]'}`,
      bbox: makeBbox(proj.px, proj.py, widthPx, heightPx),
      visible: e.inSight && e.inLight,
    });
  }

  // Interactables — flatter boxes
  for (const it of obs.visible.interactables) {
    const yEstimate = it.kind === 'door' ? 1.2 : 0.6;
    const proj = projectWorldToScreen(ctx.camera, it.pos.x, yEstimate, it.pos.z, w, h);
    if (!proj || !proj.onScreen) continue;
    const widthPx = pixelExtent(ctx.camera, it.pos.x, yEstimate, it.pos.z, 0.4, w);
    out.push({
      id: it.id,
      kind: it.kind,
      label: `${it.kind} ${it.state}${it.inRange ? ' [use]' : ''}`,
      bbox: makeBbox(proj.px, proj.py, widthPx, widthPx * 1.2),
      visible: it.inSight,
    });
  }

  return out;
}

/** World (x, y, z) → screen pixels. Returns null if not in the camera
 *  frustum (z behind camera) and onScreen=false if projected outside
 *  the viewport but the math is still valid (for off-screen indicator
 *  lines later if we want them). */
function projectWorldToScreen(
  camera: THREE.PerspectiveCamera,
  x: number, y: number, z: number,
  w: number, h: number,
): { px: number; py: number; onScreen: boolean } | null {
  tmpVec.set(x, y, z);
  tmpVec.project(camera);
  // NDC.z > 1 = behind camera or beyond far plane
  if (tmpVec.z < -1 || tmpVec.z > 1) return null;
  const px = (tmpVec.x + 1) * 0.5 * w;
  const py = (1 - (tmpVec.y + 1) * 0.5) * h;
  const onScreen = tmpVec.x >= -1 && tmpVec.x <= 1 && tmpVec.y >= -1 && tmpVec.y <= 1;
  return { px, py, onScreen };
}

/** Pixel width subtended by `worldExtent` metres at the world point.
 *  Approximates by projecting the centre + an offset perpendicular to
 *  the camera-to-point ray. */
function pixelExtent(
  camera: THREE.PerspectiveCamera,
  x: number, y: number, z: number,
  worldExtent: number,
  canvasW: number,
): number {
  // Direction perpendicular to view axis in the horizontal plane: use
  // camera's local +X (right). That's roughly correct unless the
  // target is far above/below camera level.
  const rx = Math.cos(camera.rotation.y);
  const rz = -Math.sin(camera.rotation.y);
  const x2 = x + rx * worldExtent;
  const z2 = z + rz * worldExtent;
  tmpVec.set(x, y, z);
  tmpVec.project(camera);
  const ax = (tmpVec.x + 1) * 0.5 * canvasW;
  tmpVec.set(x2, y, z2);
  tmpVec.project(camera);
  const bx = (tmpVec.x + 1) * 0.5 * canvasW;
  return Math.max(8, Math.abs(bx - ax) * 2);  // ~diameter, clamp minimum
}

function makeBbox(cx: number, cy: number, w: number, h: number) {
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
}

/** Composite a raw frame PNG with annotation boxes + labels via an
 *  offscreen 2D canvas. */
async function composite(rawPng: string, size: { w: number; h: number }, annotations: Annotation[]): Promise<string> {
  const offscreen = document.createElement('canvas');
  offscreen.width = size.w;
  offscreen.height = size.h;
  const g = offscreen.getContext('2d');
  if (!g) return rawPng;  // give up gracefully

  // Draw frame
  const img = await loadImage(rawPng);
  g.drawImage(img, 0, 0, size.w, size.h);

  // Draw annotations
  g.font = '12px ui-monospace, monospace';
  for (const a of annotations) {
    const stroke = a.visible ? '#7df59a' : '#ff8050';
    const fill = a.visible ? 'rgba(125, 245, 154, 0.16)' : 'rgba(255, 128, 80, 0.10)';
    g.strokeStyle = stroke;
    g.fillStyle = fill;
    g.lineWidth = 1.5;
    g.strokeRect(a.bbox.x, a.bbox.y, a.bbox.w, a.bbox.h);
    g.fillRect(a.bbox.x, a.bbox.y, a.bbox.w, a.bbox.h);

    // Label
    const text = a.label;
    const padding = 4;
    const metrics = g.measureText(text);
    const tw = metrics.width + padding * 2;
    const th = 16;
    const tx = a.bbox.x;
    const ty = Math.max(0, a.bbox.y - th - 2);
    g.fillStyle = 'rgba(0, 0, 0, 0.7)';
    g.fillRect(tx, ty, tw, th);
    g.fillStyle = stroke;
    g.fillText(text, tx + padding, ty + th - 5);
  }

  return offscreen.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`image load failed: ${e}`));
    img.src = src;
  });
}

function round(n: number, decimals = 1): number {
  if (!Number.isFinite(n)) return n;
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
