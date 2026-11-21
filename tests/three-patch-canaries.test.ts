// three.js PATCH CANARIES — every private internal our renderer patches reach
// into must still exist in the installed three.
//
// We carry instance patches on WebGPURenderer / its backend for upstream bugs
// (src/scene/bundle-pass-order.ts, stable-buffer-names.ts, stable-shader-names.ts,
// stale-vertex-buffers.ts, material-attribution.ts) and call LightsNode's
// prototype directly from src/scene/tiled-lighting.ts. Each patch checks that its
// seam exists and, if not, SKIPS ITSELF with a DEV-only console.warn. That keeps
// the game booting after a three upgrade — and lets the bug it was fixing come
// back with nothing red anywhere: flames painted behind walls, duplicate
// pipelines, a stale vertex buffer drawn.
//
// This turns the silent skip into a failing test. When one fails after a three
// bump: read the upstream change, then either re-seat the patch on the new seam
// or — if upstream fixed the bug (see docs/OPEN-ITEMS.md, Phase 2) — delete the
// patch AND its line here. Node cannot construct a WebGPURenderer (no DOM), so
// instance-only seams are checked against three's own source; `npm run
// backend-boot` checks the patches actually install on a live WebGPU page.
//
//   npm test -- canaries

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as W from 'three/webgpu';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const any = W as unknown as Record<string, { prototype: Record<string, unknown> } | undefined>;
function method(cls: string, name: string, patch: string) {
  test(`${cls}.${name} exists (${patch})`, () => {
    const C = any[cls];
    assert.ok(C, `three/webgpu no longer exports ${cls}`);
    assert.equal(typeof C.prototype[name], 'function', `${cls}.prototype.${name} is gone — ${patch} would skip itself`);
  });
}

// bundle-pass-order.ts — re-orders bundle execution against transparents.
method('WebGPURenderer', '_renderBundles', 'bundle-pass-order');
method('WebGPURenderer', '_renderTransparents', 'bundle-pass-order');
method('WebGPUBackend', 'beginRender', 'bundle-pass-order');

// stable-buffer-names.ts / stable-shader-names.ts — wrap the backend's node
// builder to make uniform-buffer and var names shape-derived.
method('WebGPUBackend', 'createNodeBuilder', 'stable-buffer-names + stable-shader-names');
method('NodeBuilder', 'getUniformFromNode', 'stable-buffer-names + stable-shader-names');
method('NodeBuilder', 'getVarFromNode', 'stable-shader-names');
method('NodeBuilder', 'getDataFromNode', 'stable-shader-names');

// stale-vertex-buffers.ts — wraps backend.draw (both backends).
method('WebGPUBackend', 'draw', 'stale-vertex-buffers');
method('WebGLBackend', 'draw', 'stale-vertex-buffers');

// tiled-lighting.ts — calls these on LightsNode.prototype directly.
method('LightsNode', 'setLights', 'tiled-lighting');
method('LightsNode', 'getLights', 'tiled-lighting');
method('LightsNode', 'setupLights', 'tiled-lighting');

// material-attribution.ts — wraps renderer._pipelines.getForRender. `_pipelines`
// is created in Renderer.init(), which Node can't run, so read three's source.
// `three` resolves to <root>/build/three.cjs; its src/ sits beside build/.
const threeRoot = dirname(dirname(createRequire(import.meta.url).resolve('three')));
function src(rel: string): string {
  return readFileSync(join(threeRoot, 'src', rel), 'utf8');
}
test('Renderer assigns this._pipelines (material-attribution)', () => {
  assert.match(src('renderers/common/Renderer.js'), /this\._pipelines\s*=/,
    'Renderer no longer has a _pipelines field — material-attribution would skip itself');
});
test('Pipelines.getForRender exists (material-attribution)', () => {
  assert.match(src('renderers/common/Pipelines.js'), /\n\tgetForRender\s*\(/,
    'Pipelines.getForRender is gone — material-attribution would skip itself');
});

console.log(`three-patch-canaries: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
