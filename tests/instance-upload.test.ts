import assert from 'node:assert/strict';
import { InstancedBufferAttribute } from 'three';
import WebGPUAttributeUtils from 'three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js';
import { uploadActiveInstances } from '../src/scene/instance-upload';

// Exercise the installed renderer's actual range-to-writeBuffer conversion,
// including vec3 -> vec4 padding on storage-backed attributes.
for (const itemSize of [2, 3]) {
  for (const padded of [false, true]) {
    const attribute = new InstancedBufferAttribute(new Float32Array(256 * itemSize), itemSize);
    const gpu = new Float32Array(256 * (padded ? 4 : itemSize));
    let uploadedBytes = 0;
    const state = { buffer: gpu, _itemSize: itemSize, _paddedItemSize: padded ? 4 : undefined };
    const utils = new WebGPUAttributeUtils({
      get: () => state,
      device: { queue: { writeBuffer(dest: Float32Array, offset: number, data: Float32Array, start = 0, count = data.length) {
        dest.set(data.subarray(start, start + count), offset / 4);
        uploadedBytes += count * 4;
      } } },
    });
    for (const count of [20, 3, 0, 1, 256]) {
      const version = attribute.version;
      for (let i = 0; i < count * itemSize; i++) attribute.array[i] = count + i;
      // Simulate two ticks before a render: the newer packed prefix owns data.
      uploadActiveInstances(attribute, 120);
      uploadActiveInstances(attribute, count);
      uploadedBytes = 0;
      if (count === 0) {
        assert.equal(attribute.version, version + 1, 'empty batches must not request an upload');
        continue;
      }
      utils.updateAttribute(attribute);
      assert.equal(uploadedBytes, count * (padded ? 4 : itemSize) * 4);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < itemSize; c++) {
          assert.equal(gpu[i * (padded ? 4 : itemSize) + c], count + i * itemSize + c);
        }
      }
      assert.equal(attribute.updateRanges.length, 0, 'renderer consumes pending ranges');
    }
  }
}
console.log('instance uploads: packed prefixes, shrink/grow, hidden batches and WebGPU padding passed');
