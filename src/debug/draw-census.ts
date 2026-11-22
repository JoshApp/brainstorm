// DRAW CENSUS — every object the renderer drew in one frame, by pass.
//
// The matrix census counts VISIBLE meshes; the frame's draw count is far more
// than that (a 2026-11-22 phone recording: ~29 visible, ~85 draws), because a
// mesh is drawn once per pass it lands in — the lamp's shadow cube (six faces),
// the viewmodel depth pre-pass, the main pass, post. This names them.
//
//   await __drawCensus()      // DEV console: the next frame's draws, tallied
//
// Wraps three's Renderer._renderObjectDirect (every draw goes through it).
// DEV-only; inert until armed.

import type * as THREE from 'three';

let armed = false;
const counts = new Map<string, number>();

function ownerOf(o: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const ud = p.userData as { dbgKind?: string } | undefined;
    const k = p.name || ud?.dbgKind;
    if (k) return String(k).replace(/[0-9]+$/, '').split('·')[0].trim();
  }
  return o.type;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function installDrawCensus(renderer: unknown, mainCamera: THREE.Camera): void {
  if (!import.meta.env.DEV) return;
  const r = renderer as any;
  const orig = r._renderObjectDirect;
  if (typeof orig !== 'function') return;
  r._renderObjectDirect = function (object: any, material: any, scene: any, camera: any, ...rest: unknown[]) {
    if (armed) {
      const rt = r.getRenderTarget?.();
      const pass = camera === mainCamera
        ? (rt ? `main→rt(${rt.width}x${rt.height})` : 'main→canvas')
        : camera?.isOrthographicCamera ? 'ortho' : `other-cam(${camera?.type})`;
      const key = `${pass} | ${ownerOf(object)} | ${material?.type ?? '?'}${object.isInstancedMesh ? ' [inst]' : ''}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return orig.call(this, object, material, scene, camera, ...rest);
  };
  // Averaged over FRAMES animation frames: arming for exactly one rAF can fall between two
  // renders (the game's own rAF callback may run before or after ours) and read 0.
  const FRAMES = 10;
  (window as any).__drawCensus = (): Promise<string> => new Promise((resolve) => {
    counts.clear();
    armed = true;
    let left = FRAMES;
    const step = (): void => {
      if (--left > 0) { requestAnimationFrame(step); return; }
      armed = false;
      // Frames RENDERED, not animation frames (headless and capped runs skip): the final
      // output pass draws exactly once per presented frame.
      let rendered = 0;
      for (const [key, n] of counts) if (key.includes('| Render Pipeline |')) rendered += n;
      rendered = Math.max(1, rendered);
      const list = [...counts].map(([key, n]) => ({ key, draws: n / rendered })).sort((x, y) => y.draws - x.draws);
      const total = list.reduce((n, t) => n + t.draws, 0);
      resolve(`${total.toFixed(1)} draws/frame over ${rendered} frames; ` + list.map((t) => `${+t.draws.toFixed(1)}× ${t.key}`).join('; '));
    };
    requestAnimationFrame(step);
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
