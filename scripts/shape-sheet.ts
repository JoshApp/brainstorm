/**
 * Render generated room shapes to an SVG contact sheet, so a shape can be
 * LOOKED AT before any of it becomes walls.
 *
 *   npx tsx scripts/shape-sheet.ts [out.svg]
 *
 * SVG on purpose: it's text, needs no image library, diffs, and renders inline.
 */
import { writeFileSync } from 'node:fs';
import {
  ARCHETYPES, generateRoomShape, polyArea, polyBounds, type Poly,
} from '../src/level/room-shape';

/** Deterministic PRNG so a sheet is reproducible and two runs are comparable. */
function mulberry(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLS = 6;              // one column per archetype
const ROWS = 4;              // four samples each
const CELL = 190;            // px per cell
const PAD = 26;
const SCALE = 6.2;           // px per metre

const W = COLS * CELL + PAD * 2;
const H = ROWS * CELL + PAD * 3 + 30;

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
parts.push(`<rect width="${W}" height="${H}" fill="#0b0908"/>`);
parts.push(`<text x="${PAD}" y="${PAD + 4}" fill="#c8bfa8" font-family="Georgia,serif" font-size="15">` +
  `DELVE — room shape v2 · polygon floors from the archetype grammar</text>`);

let idx = 0;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const kind = ARCHETYPES[c];
    const rand = mulberry(1000 + idx * 37);
    idx++;
    // Sizes drawn from the REAL distribution measured on generated floors:
    // median room ~60m², p90 ~120m². So 8-16m by 6-13m.
    const w = 8 + rand() * 8;
    const d = 6 + rand() * 7;
    const poly: Poly = generateRoomShape(kind, { w, d, rand, chamfer: 1.1 });

    const ox = PAD + c * CELL + CELL / 2;
    const oy = PAD + 30 + r * CELL + CELL / 2;
    if (poly.length >= 3) {
      const b = polyBounds(poly);
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const pts = poly.map(([x, z]) =>
        `${(ox + (x - cx) * SCALE).toFixed(1)},${(oy + (z - cz) * SCALE).toFixed(1)}`).join(' ');
      parts.push(`<polygon points="${pts}" fill="#221c16" stroke="#9c8f76" stroke-width="2" stroke-linejoin="round"/>`);
      // Vertex dots — makes the chamfers and the concave corners readable.
      for (const [x, z] of poly) {
        parts.push(`<circle cx="${(ox + (x - cx) * SCALE).toFixed(1)}" cy="${(oy + (z - cz) * SCALE).toFixed(1)}" r="1.8" fill="#d98b3a"/>`);
      }
      parts.push(`<text x="${ox}" y="${oy + CELL / 2 - 16}" fill="#6f6759" font-family="monospace" font-size="10" text-anchor="middle">` +
        `${polyArea(poly).toFixed(0)}m² · ${poly.length}v</text>`);
    }
    if (r === 0) {
      parts.push(`<text x="${ox}" y="${PAD + 26}" fill="#d98b3a" font-family="Georgia,serif" font-size="13" text-anchor="middle">${kind}</text>`);
    }
  }
}
parts.push('</svg>');

const out = process.argv[2] ?? '/tmp/room-shapes.svg';
writeFileSync(out, parts.join('\n'));
console.log(`wrote ${out}  (${COLS}x${ROWS} shapes)`);
