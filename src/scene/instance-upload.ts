import type { BufferAttribute } from 'three';

/** Batches rewrite a packed prefix every tick. Upload that prefix, not the
 * allocation's full capacity. Replace pending ranges because a hidden batch
 * may have ticked several times without a render consuming them. */
export function uploadActiveInstances(attribute: BufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  if (count === 0) return;  // the batch is hidden; no data is consumed
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}
