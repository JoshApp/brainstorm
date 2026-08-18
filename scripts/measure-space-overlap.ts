// Do corridors ACTUALLY reach inside the rooms they serve, or is the overlap the culler
// negotiates with every frame just an artifact of using BOUNDING BOXES as the footprint?
//
// Josh: *"why do corridor rects reach inside the room it serves — didn't we get rid of
// that?"* The culler's node graph is built on `RoomSpec.rect`, and the type contract says
// that rect "must be the polygon's BOUNDING BOX". A room's box is strictly larger than its
// floor, so a corridor that stops cleanly at the wall still overlaps the room's BOX. That
// would make the ambiguity — and the tie-break that has caused every attribution bug —
// entirely self-inflicted.
//
// This measures both, on real floors, by area:
//   BOX  overlap: rect ∩ rect, what the culler currently sees.
//   FLOOR overlap: poly ∩ poly, what is physically true.
//
// Run: npx tsx scripts/measure-space-overlap.ts
import { generateFloor } from '../src/level/procgen';
import { pointInPoly } from '../src/level/room-shape';
import type { RoomSpec } from '../src/level/types';

type Poly = ReadonlyArray<readonly [number, number]>;

const STEP = 0.15;   // sampling pitch, metres

function boxOverlapArea(a: RoomSpec, b: RoomSpec): number {
  const ax0 = a.rect.x - a.rect.w / 2, ax1 = a.rect.x + a.rect.w / 2;
  const az0 = a.rect.z - a.rect.d / 2, az1 = a.rect.z + a.rect.d / 2;
  const bx0 = b.rect.x - b.rect.w / 2, bx1 = b.rect.x + b.rect.w / 2;
  const bz0 = b.rect.z - b.rect.d / 2, bz1 = b.rect.z + b.rect.d / 2;
  const w = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const d = Math.min(az1, bz1) - Math.max(az0, bz0);
  return w > 0 && d > 0 ? w * d : 0;
}

/** Area of a ∩ b by sampling a's footprint. Uses the polygon when there is one, the rect
 *  otherwise — which is itself the answer for corridors if they carry no polygon. */
function footprintOverlapArea(a: RoomSpec, b: RoomSpec): number {
  const ap = a.poly as Poly | undefined;
  const bp = b.poly as Poly | undefined;
  const ax0 = a.rect.x - a.rect.w / 2, ax1 = a.rect.x + a.rect.w / 2;
  const az0 = a.rect.z - a.rect.d / 2, az1 = a.rect.z + a.rect.d / 2;
  const inA = (x: number, z: number) => (ap && ap.length >= 3 ? pointInPoly(ap, x, z) : true);
  const inB = (x: number, z: number) => {
    if (bp && bp.length >= 3) return pointInPoly(bp, x, z);
    return x >= b.rect.x - b.rect.w / 2 && x <= b.rect.x + b.rect.w / 2
      && z >= b.rect.z - b.rect.d / 2 && z <= b.rect.z + b.rect.d / 2;
  };
  let hits = 0;
  for (let x = ax0; x <= ax1; x += STEP) {
    for (let z = az0; z <= az1; z += STEP) {
      if (inA(x, z) && inB(x, z)) hits++;
    }
  }
  return hits * STEP * STEP;
}

const SEEDS = [4242, 1337, 90210, 55555, 8080];
let corridorsTotal = 0;
let corridorsWithPoly = 0;
let pairsBoxOverlap = 0;
let pairsFloorOverlap = 0;
let boxArea = 0;
let floorArea = 0;
const worst: Array<{ floor: string; cor: string; room: string; box: number; fp: number }> = [];

for (const seed of SEEDS) {
  for (let depth = 1; depth <= 4; depth++) {
    const spec = generateFloor(depth, seed, `depth-${depth + 1}`);
    const rooms = spec.rooms.filter((r) => !r.logicalOnly);
    for (const cor of spec.corridors) {
      corridorsTotal++;
      if (cor.poly && cor.poly.length >= 3) corridorsWithPoly++;
      for (const room of rooms) {
        const box = boxOverlapArea(cor, room);
        if (box <= 0) continue;
        pairsBoxOverlap++;
        boxArea += box;
        const fp = footprintOverlapArea(cor, room);
        if (fp > 0.05) { pairsFloorOverlap++; floorArea += fp; }
        worst.push({ floor: `${seed}/d${depth}`, cor: cor.id, room: room.id, box, fp });
      }
    }
  }
}

worst.sort((a, b) => b.fp - a.fp);

console.log(`corridors                 ${corridorsTotal}`);
console.log(`  carrying a polygon      ${corridorsWithPoly} (${(corridorsWithPoly / corridorsTotal * 100).toFixed(0)}%)`);
console.log('');
console.log(`corridor↔room pairs whose BOXES overlap    ${pairsBoxOverlap}   total ${boxArea.toFixed(1)} m²`);
console.log(`                        FLOORS overlap    ${pairsFloorOverlap}   total ${floorArea.toFixed(1)} m²`);
console.log('');
const share = pairsBoxOverlap ? (pairsFloorOverlap / pairsBoxOverlap * 100) : 0;
console.log(`So ${(100 - share).toFixed(0)}% of the overlap the culler negotiates is BOUNDING BOX ONLY —`);
console.log(`there is no shared floor there at all.`);
console.log('');
console.log('worst real floor overlaps:');
for (const w of worst.slice(0, 8)) {
  console.log(`  ${w.floor.padEnd(12)} ${w.cor.padEnd(12)} ∩ ${w.room.padEnd(16)} box ${w.box.toFixed(1)} m²  floor ${w.fp.toFixed(1)} m²`);
}
