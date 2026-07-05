// Uniform-grid spatial hash over 2D items (wall segments, obstacles) so the
// collision/LOS queries in walkable.ts test only NEARBY items instead of the
// whole floor's list. hasLineOfSight alone runs dozens of times per frame
// (light pool env sources, torch audio, dark-adaptation probes, every awake
// mob's perception) and was O(all walls) per call; clampMove runs twice per
// moving agent per frame. The hash turns each into O(items near the query).
//
// Design constraints, in order:
//   - MUTABLE membership: doors add/remove doorway plug segments at runtime,
//     boss mist adds obstacles. remove() must not require the caller to
//     re-supply bounds, so insert() remembers each item's cells.
//   - ALLOCATION-FREE queries: these run per-mob-per-frame. Queries fill a
//     caller-owned scratch array and return a count — no closures, no
//     iterators, no per-call arrays.
//   - Duplicates are allowed in query results: an item spanning several
//     visited cells appears once per cell. Every current caller either
//     early-returns on first hit or folds with min/boolean, so testing an
//     item twice is harmless — callers must NOT count results.

/** Pack a cell coordinate pair into one integer Map key. Cells span
 *  [-32768, 32767] in each axis — at 4m cells that's ±131km of floor. */
function cellKey(cx: number, cz: number): number {
  return ((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff);
}

export class SpatialHash<T> {
  private readonly cells = new Map<number, T[]>();
  private readonly itemCells = new Map<T, number[]>();

  constructor(private readonly cellSize: number) {}

  /** Register an item under every cell its AABB overlaps. Re-inserting an
   *  item replaces its previous registration. */
  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (this.itemCells.has(item)) this.remove(item);
    const cs = this.cellSize;
    const cx0 = Math.floor(minX / cs);
    const cx1 = Math.floor(maxX / cs);
    const cz0 = Math.floor(minZ / cs);
    const cz1 = Math.floor(maxZ / cs);
    const keys: number[] = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const key = cellKey(cx, cz);
        let bucket = this.cells.get(key);
        if (!bucket) { bucket = []; this.cells.set(key, bucket); }
        bucket.push(item);
        keys.push(key);
      }
    }
    this.itemCells.set(item, keys);
  }

  /** Unregister an item (identity match, like the walls/obstacles arrays). */
  remove(item: T): void {
    const keys = this.itemCells.get(item);
    if (!keys) return;
    for (const key of keys) {
      const bucket = this.cells.get(key);
      if (!bucket) continue;
      const i = bucket.indexOf(item);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) this.cells.delete(key);
    }
    this.itemCells.delete(item);
  }

  private gather(cx: number, cz: number, out: T[]): void {
    const bucket = this.cells.get(cellKey(cx, cz));
    if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
  }

  /** Collect items whose cells overlap the query AABB into `out` (cleared
   *  first). Returns the count. May contain duplicates. */
  queryAabb(minX: number, minZ: number, maxX: number, maxZ: number, out: T[]): number {
    out.length = 0;
    const cs = this.cellSize;
    const cx0 = Math.floor(minX / cs);
    const cx1 = Math.floor(maxX / cs);
    const cz0 = Math.floor(minZ / cs);
    const cz1 = Math.floor(maxZ / cs);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) this.gather(cx, cz, out);
    }
    return out.length;
  }

  /** Collect items along the segment (a→b) into `out` (cleared first) by
   *  walking the cells the segment passes through (Amanatides & Woo grid
   *  traversal). Returns the count. May contain duplicates.
   *
   *  Items are stored by AABB with a small inflation at the insert site, so
   *  a segment running exactly along a cell boundary still sees items
   *  touching that boundary from either side. */
  querySegment(ax: number, az: number, bx: number, bz: number, out: T[]): number {
    out.length = 0;
    const cs = this.cellSize;
    let cx = Math.floor(ax / cs);
    let cz = Math.floor(az / cs);
    const exCell = Math.floor(bx / cs);
    const ezCell = Math.floor(bz / cs);
    const dx = bx - ax;
    const dz = bz - az;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(cs / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(cs / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((cx + (stepX > 0 ? 1 : 0)) * cs - ax) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((cz + (stepZ > 0 ? 1 : 0)) * cs - az) / dz : Infinity;
    // Guard bounds the walk against float-edge runaways (NaN deltas, an
    // endpoint cell never matched exactly); 4096 cells ≫ any real floor.
    for (let guard = 0; guard < 4096; guard++) {
      this.gather(cx, cz, out);
      if (cx === exCell && cz === ezCell) break;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; }
      else { cz += stepZ; tMaxZ += tDeltaZ; }
    }
    return out.length;
  }
}
