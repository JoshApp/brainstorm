// PIPELINE CENSUS — the decode of three's WebGPU pipeline cache key.
//
// The key is composed in exactly two places in three.js:
//   Pipelines._getRenderCacheKey   → `${stageVertex.id},${stageFragment.id},${backend.getRenderCacheKey(o)}`
//   WebGPUBackend.getRenderCacheKey → the material/render-state array, .join()ed
// so KEY_FIELDS mirrors those. Nothing warns if a three upgrade reorders that
// array — the labels would just silently start lying, and every verdict built on
// them ("side 0→1") would be fiction. These tests are that alarm: they decode a
// key captured verbatim from a phone recording and assert the anchors land where
// the field order says they should.
//
//   npm test -- pipeline-census

import assert from 'node:assert/strict';
import {
  KEY_FIELDS, decodePipelineKey, stateSignature, diffState, classifyKey,
} from '../src/debug/pipeline-census';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Build a key with the documented field order. */
function key(over: Partial<Record<(typeof KEY_FIELDS)[number], string>> = {}, tail = 'normal,3,position,3,uv,2,0'): string {
const base: Record<string, string> = {
  vertexStage: '69', fragmentStage: '70',
  transparent: 'false', blending: '1', premultipliedAlpha: 'false',
  blendSrc: '204', blendDst: '205', blendEquation: '100',
  blendSrcAlpha: '', blendDstAlpha: '', blendEquationAlpha: '',
  colorWrite: 'true',
  depthWrite: 'true', depthTest: 'true', depthFunc: '3',
  stencilWrite: 'false', stencilFunc: '519',
  stencilFail: '7680', stencilZFail: '7680', stencilZPass: '7680',
  stencilFuncMask: '255', stencilWriteMask: '255',
  side: '0', frontFaceCW: 'false',
  sampleCount: '1',
  colorSpace: '', colorFormat: 'rgba16float', depthStencilFormat: 'depth24plus',
  topology: 'triangle-list',
};
Object.assign(base, over);
return KEY_FIELDS.map((f) => base[f]).join(',') + ',' + tail;
}

test('labels the fields three actually emits, in order', () => {
  const d = decodePipelineKey(key());
  assert.equal(d.vertexStage, '69');
  assert.equal(d.fragmentStage, '70');
  assert.equal(d.state.transparent, 'false');
  assert.equal(d.state.side, '0');
  assert.equal(d.state.colorFormat, 'rgba16float');
  assert.equal(d.state.topology, 'triangle-list');
  assert.equal(d.tail, 'normal,3,position,3,uv,2,0');
});

test('decodes a real key captured from the phone', () => {
  // Verbatim from a 2026-08-10 combat recording (modeldef:dis:d). The stencil
  // 255,255 pair and the trailing rgba16float are the anchors that prove the
  // offsets line up — they are unmistakable at their positions.
  const real = '69,70,false,1,false,204,205,100,,,,true,true,true,3,false,519,7680,7680,7680,'
    + '255,255,0,false,1,,rgba16float,depth24plus,triangle-list,normal,3,position,3,skinIndex,4,skinWeight,4,uv,2,0';
  const d = decodePipelineKey(real);
  assert.equal(d.state.stencilFuncMask, '255');
  assert.equal(d.state.stencilWriteMask, '255');
  assert.equal(d.state.colorFormat, 'rgba16float');
  assert.equal(d.state.depthStencilFormat, 'depth24plus');
  assert.equal(d.state.topology, 'triangle-list');
  assert.ok(String(d.tail).includes('skinIndex'), `missing 'skinIndex' in ${d.tail}`);
});

test('tolerates a short/foreign key without throwing', () => {
  const d = decodePipelineKey('12,13');
  assert.equal(d.vertexStage, '12');
  assert.equal(d.state.topology, '');
  assert.equal(d.tail, '');
});

test('ignores the shader program ids', () => {
  const a = stateSignature(decodePipelineKey(key({ vertexStage: '1', fragmentStage: '2' })));
  const b = stateSignature(decodePipelineKey(key({ vertexStage: '900', fragmentStage: '901' })));
  assert.equal(a, b);
});

test('separates keys that differ in render state', () => {
  const a = stateSignature(decodePipelineKey(key({ side: '0' })));
  const b = stateSignature(decodePipelineKey(key({ side: '1' })));
  assert.notEqual(a, b);
});

test('separates keys that differ only in geometry layout', () => {
  const a = stateSignature(decodePipelineKey(key({}, 'position,3')));
  const b = stateSignature(decodePipelineKey(key({}, 'position,3,skinIndex,4')));
  assert.notEqual(a, b);
});

test('names the differing field and its direction', () => {
  const live = decodePipelineKey(key({ side: '1' }));
  const warm = decodePipelineKey(key({ side: '0' }));
  assert.deepEqual(diffState(live, warm), ['side 0→1']);
});

test('reports a geometry-layout difference separately from state', () => {
  const live = decodePipelineKey(key({}, 'position,3,skinIndex,4'));
  const warm = decodePipelineKey(key({}, 'position,3'));
  assert.deepEqual(diffState(live, warm), ['geometry/clipping layout differs']);
});

test('is empty for keys differing only by program id', () => {
  const live = decodePipelineKey(key({ vertexStage: '5' }));
  const warm = decodePipelineKey(key({ vertexStage: '99' }));
  assert.deepEqual(diffState(live, warm), []);
});

test('RECOMPILE — the exact key was warmed and compiled again', () => {
  const k = key();
  assert.equal(classifyKey(k, [k]).verdict, 'RECOMPILE');
});

test('PROGRAM-CHURN — same state and layout, a freshly minted program', () => {
  // This is the shape the phone recordings show: 31 compiles of one material
  // whose render state is byte-identical, differing only in stage ids. No
  // amount of extra warm SUBJECTS fixes it, so it must not read as a gap.
  const warm = key({ vertexStage: '10', fragmentStage: '11' });
  const live = key({ vertexStage: '80', fragmentStage: '81' });
  const c = classifyKey(live, [warm]);
  assert.equal(c.verdict, 'PROGRAM-CHURN');
  assert.ok(String(c.detail).includes('80/81'), `missing '80/81' in ${c.detail}`);
});

test('STATE-MISMATCH — warmed the family, missed the state, and names the field', () => {
  const warm = key({ side: '0' });
  const live = key({ side: '1', vertexStage: '80', fragmentStage: '81' });
  const c = classifyKey(live, [warm]);
  assert.equal(c.verdict, 'STATE-MISMATCH');
  assert.equal(c.detail, 'side 0→1');
});

test('NOT-WARMED — nothing warmed resembles it', () => {
  const warm = key({ side: '0' });
  const live = key({
    transparent: 'true', blending: '2', depthWrite: 'false', depthTest: 'false',
    colorFormat: 'rgba8unorm', topology: 'point-list', side: '2', frontFaceCW: 'true',
  });
  assert.equal(classifyKey(live, [warm]).verdict, 'NOT-WARMED');
});

test('NOT-WARMED when no warm set was captured at all', () => {
  assert.equal(classifyKey(key(), []).verdict, 'NOT-WARMED');
});

test('prefers the nearest warmed key when several are close', () => {
  const far = key({ side: '2', transparent: 'true', depthWrite: 'false', blending: '2' });
  const near = key({ side: '0' });
  const live = key({ side: '1', vertexStage: '80', fragmentStage: '81' });
  assert.equal(classifyKey(live, [far, near]).detail, 'side 0→1');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
