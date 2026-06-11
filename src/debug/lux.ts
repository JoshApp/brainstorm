import * as THREE from 'three';
import { listLightSourcesNear } from '../scene/light-pool';
import type { LevelSpec } from '../level/types';

// ── LUX — the perceived-light meter ──────────────────────────────────
//
// "Too dark" and "too bright" are claims about PIXELS, not about light
// sources — so this measures the actual rendered frame (post chain and
// all: dark-adapt, amber, dither) and reports display-referred
// luminance statistics, together with the CONTEXT needed to act on
// them: which room, what tier, which sources were nearby.
//
// Two consumers:
//   - Josh, in game: press the LUX button (?lux=1 on any build; always
//     available in DEV) → an overlay card renders the numbers ON the
//     frame, so a single phone screenshot carries the scene AND the
//     measurement AND the room id.
//   - Claude, headless: window.__lux.measure() / window.__lux.tour()
//     (DEV only) — tour teleports the camera through every room of the
//     live floor, measures each, and returns the table. scripts/
//     lux-scan.ts drives it across scenarios/seeds.
//
// TARGET BANDS (the tuning contract, display luma 0..1): what a room's
// MEAN should sit in, by darkness tier. Calibrated against the
// pools-not-floods falloff; revise from tour data, not vibes.
export const LUX_BANDS: Record<string, [number, number]> = {
  lit: [0.085, 0.20],
  dim: [0.050, 0.13],
  dark: [0.022, 0.080],
};

export interface LuxReport {
  at: { x: number; z: number; yawDeg: number };
  room: { id: string; tier: string; w: number; d: number } | null;
  screen: {
    mean: number; p05: number; p50: number; p95: number;
    voidPct: number;     // pixels < 0.03 — can't see anything there
    brightPct: number;   // pixels > 0.45 — washed
    zones: number[];     // 3×3 means, rows top→bottom
  };
  sources: Array<{ id: string; d: number; intensity: number }>;
  verdict: string;
}

let cameraRef: THREE.Camera | null = null;
let specAccess: (() => LevelSpec | null) | null = null;
const pending: Array<(r: LuxReport) => void> = [];

export function initLux(camera: THREE.Camera, getSpec: () => LevelSpec | null): void {
  cameraRef = camera;
  specAccess = getSpec;
}

export function requestLux(): Promise<LuxReport> {
  return new Promise((resolve) => pending.push(resolve));
}

export function luxPending(): boolean {
  return pending.length > 0;
}

function srgbLuma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function roomAt(x: number, z: number): { id: string; tier: string; w: number; d: number } | null {
  const spec = specAccess?.();
  if (!spec) return null;
  let best: { id: string; tier: string; w: number; d: number } | null = null;
  let bestArea = Infinity;
  for (const r of [...spec.rooms, ...spec.corridors]) {
    if (r.logicalOnly) continue;
    const hw = r.rect.w / 2, hd = r.rect.d / 2;
    if (x < r.rect.x - hw || x > r.rect.x + hw) continue;
    if (z < r.rect.z - hd || z > r.rect.z + hd) continue;
    const area = r.rect.w * r.rect.d;
    if (area < bestArea) {
      bestArea = area;
      const isCorridor = spec.corridors.includes(r);
      best = { id: r.id, tier: isCorridor ? 'dim(corridor)' : (r.lightTier ?? 'lit'), w: r.rect.w, d: r.rect.d };
    }
  }
  return best;
}

function verdictFor(mean: number, voidPct: number, brightPct: number, tier: string): string {
  const band = LUX_BANDS[tier.replace('(corridor)', '')] ?? LUX_BANDS.lit;
  if (mean < band[0] * 0.7 || voidPct > 72) return `TOO DARK for '${tier}' (target ${band[0]}–${band[1]})`;
  if (mean > band[1] * 1.3 || brightPct > 30) return `TOO BRIGHT for '${tier}' (target ${band[0]}–${band[1]})`;
  if (mean < band[0]) return `dark side of band for '${tier}'`;
  if (mean > band[1]) return `bright side of band for '${tier}'`;
  return `in band for '${tier}'`;
}

/** Called by the render loop RIGHT AFTER renderWithStyle, while the
 *  default framebuffer still holds the frame (works regardless of
 *  preserveDrawingBuffer). */
export function flushLux(renderer: THREE.WebGLRenderer): void {
  if (pending.length === 0 || !cameraRef) return;
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

  const lumas: number[] = [];
  const zoneSum = new Array(9).fill(0);
  const zoneN = new Array(9).fill(0);
  const STRIDE = 3;
  let voidN = 0, brightN = 0;
  for (let y = 0; y < h; y += STRIDE) {
    for (let x = 0; x < w; x += STRIDE) {
      const i = (y * w + x) * 4;
      const L = srgbLuma(buf[i], buf[i + 1], buf[i + 2]);
      lumas.push(L);
      if (L < 0.03) voidN++;
      if (L > 0.45) brightN++;
      // gl rows are bottom-up; flip so zone rows read top→bottom.
      const zr = 2 - Math.min(2, Math.floor((y / h) * 3));
      const zc = Math.min(2, Math.floor((x / w) * 3));
      zoneSum[zr * 3 + zc] += L;
      zoneN[zr * 3 + zc]++;
    }
  }
  lumas.sort((a, b) => a - b);
  const q = (p: number) => lumas[Math.min(lumas.length - 1, Math.floor(p * lumas.length))];
  const mean = lumas.reduce((t, v) => t + v, 0) / lumas.length;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;

  const cam = cameraRef;
  const yawDeg = Math.round((cam.rotation.y * 180) / Math.PI);
  const room = roomAt(cam.position.x, cam.position.z);
  const tier = room?.tier ?? 'lit';
  const screen = {
    mean: r3(mean), p05: r3(q(0.05)), p50: r3(q(0.5)), p95: r3(q(0.95)),
    voidPct: Math.round((100 * voidN) / lumas.length),
    brightPct: Math.round((100 * brightN) / lumas.length),
    zones: zoneSum.map((s, i) => r3(s / Math.max(1, zoneN[i]))),
  };
  const report: LuxReport = {
    at: { x: r3(cam.position.x), z: r3(cam.position.z), yawDeg },
    room,
    screen,
    sources: listLightSourcesNear(cam.position.x, cam.position.z, 10)
      .slice(0, 8)
      .map((s) => ({ id: s.id, d: r3(s.range), intensity: r3(s.intensity) })),
    verdict: verdictFor(mean, screen.voidPct, screen.brightPct, tier),
  };
  console.log('[lux] ' + JSON.stringify(report));
  for (const cb of pending.splice(0)) cb(report);
}

// ── The overlay card (screenshot relay) ──────────────────────────────

let card: HTMLDivElement | null = null;
let cardTimer: ReturnType<typeof setTimeout> | null = null;

export function showLuxCard(r: LuxReport): void {
  if (!card) {
    card = document.createElement('div');
    Object.assign(card.style, {
      position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(8,10,14,0.92)', color: '#cfd6e4',
      font: '11px ui-monospace, monospace', padding: '8px 12px',
      borderRadius: '6px', border: '1px solid #2a3242', zIndex: '9999',
      whiteSpace: 'pre', pointerEvents: 'none', lineHeight: '1.45',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(card);
  }
  const z = r.screen.zones.map((v) => v.toFixed(2));
  card.textContent =
    `LUX  ${r.room ? `${r.room.id} · ${r.room.tier} · ${r.room.w}×${r.room.d}` : 'no room'}  @(${r.at.x}, ${r.at.z}) yaw ${r.at.yawDeg}°\n` +
    `mean ${r.screen.mean}  p05 ${r.screen.p05}  p95 ${r.screen.p95}  void ${r.screen.voidPct}%  bright ${r.screen.brightPct}%\n` +
    `zones  ${z[0]} ${z[1]} ${z[2]} / ${z[3]} ${z[4]} ${z[5]} / ${z[6]} ${z[7]} ${z[8]}\n` +
    `sources(${r.sources.length}): ${r.sources.map((s) => s.id).join(', ') || 'none in 10m'}\n` +
    `→ ${r.verdict}`;
  card.style.display = 'block';
  if (cardTimer) clearTimeout(cardTimer);
  cardTimer = setTimeout(() => { if (card) card.style.display = 'none'; }, 12000);
}

// ── Headless tour (DEV) ──────────────────────────────────────────────

function frames(n: number): Promise<void> {
  return new Promise((res) => {
    const step = (left: number) => (left <= 0 ? res() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });
}

export interface LuxTourStop { roomId: string; tier: string; yawDeg: number; report: LuxReport }

/** Teleport the camera through every room of the live floor, two
 *  facings each, measuring after the light pool settles. */
export async function luxTour(eyeHeight = 1.5): Promise<LuxTourStop[]> {
  const spec = specAccess?.();
  const cam = cameraRef;
  if (!spec || !cam) return [];
  const out: LuxTourStop[] = [];
  for (const room of spec.rooms) {
    if (room.logicalOnly) continue;
    for (const yaw of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
      cam.position.set(room.rect.x, eyeHeight, room.rect.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = yaw;
      cam.rotation.x = 0;
      await frames(4);   // let the light pool rebind + ease
      const report = await requestLux();
      out.push({ roomId: room.id, tier: room.lightTier ?? 'lit', yawDeg: Math.round((yaw * 180) / Math.PI), report });
    }
  }
  return out;
}
