// Measure actual batch writeBuffer traffic in the game, using the same phone
// harness as npm run perf. Byte counts are useful on software GPUs; FPS isn't.
import assert from 'node:assert/strict';
import { withHarness, VIEWPORTS } from './perf-core';

await withHarness({ viewport: VIEWPORTS.phone }, async harness => {
  await harness.withPage({ scenario: 'in-corridor', flags: { god: '1' } }, async page => {
    await page.waitForFunction(() => !!(window as any).__renderer?.backend?.device && !!(window as any).__scene);
    await page.waitForFunction(async () => {
      const { isLoading } = await import('/brainstorm/src/scene/loading-gate.ts');
      const { warmLockHolder } = await import('/brainstorm/src/content/warm-lock.ts');
      if (isLoading() || warmLockHolder()) return false;
      let active = false;
      (window as any).__scene.traverse((o: any) => {
        if (o.name.startsWith('sprite-batch:') && o.visible && o.geometry.instanceCount > 1) active = true;
      });
      return active;
    }, undefined, { timeout: 45000 });
    // Streaming roster warmup can acquire the lock again after initial reveal.
    await page.waitForTimeout(25000);
    // tsx injects this helper into named callbacks serialized for the page.
    await page.evaluate('window.__name = (fn) => fn');
    const result = await page.evaluate(async () => {
      const w = window as any;
      const backend = w.__renderer.backend;
      const queue = backend.device.queue;
      const tracked = new Map<object, { mesh: any; attribute: any; stride: number }>();
      const batches: unknown[] = [];
      w.__scene.traverse((mesh: any) => {
        if (!(mesh.name.startsWith('sprite-batch:') || mesh.name === 'flame-mesh-batch')) return;
        batches.push({ name: mesh.name, visible: mesh.visible, instances: mesh.geometry.instanceCount });
        for (const attribute of Object.values(mesh.geometry.attributes) as any[]) {
          if (!attribute.isInstancedBufferAttribute) continue;
          const state = backend.get(attribute);
          if (state.buffer) tracked.set(state.buffer, { mesh, attribute, stride: state._paddedItemSize ?? attribute.itemSize });
        }
      });
      let bytes = 0, fullCapacityBytes = 0, calls = 0, allCalls = 0, mismatches = 0;
      const original = queue.writeBuffer;
      queue.writeBuffer = function(buffer: object, offset: number, data: any, start?: number, size?: number) {
        allCalls++;
        const entry = tracked.get(buffer);
        if (entry) {
          const actual = (size ?? data.length) * data.BYTES_PER_ELEMENT;
          const expected = entry.mesh.geometry.instanceCount * entry.stride * data.BYTES_PER_ELEMENT;
          bytes += actual;
          fullCapacityBytes += entry.attribute.count * entry.stride * data.BYTES_PER_ELEMENT;
          calls++;
          if (actual !== expected) mismatches++;
        }
        return original.call(this, buffer, offset, data, start, size);
      };
      try {
        await new Promise<void>(resolve => setTimeout(resolve, 3000));
      } finally { queue.writeBuffer = original; }
      return { dpr: devicePixelRatio, backend: backend.constructor.name, batches, allCalls, calls, bytes, fullCapacityBytes, mismatches };
    });
    console.log(JSON.stringify(result));
    assert.equal(result.dpr, 2, 'phone harness must actually use DPR 2');
    assert.ok(result.calls > 0, 'must observe real particle uploads');
    assert.equal(result.mismatches, 0, 'all uploads must match the live instance prefix');
    assert.ok(result.bytes < result.fullCapacityBytes, 'sparse batches should upload less than capacity');
  });
});
