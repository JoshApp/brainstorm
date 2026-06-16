// Throwaway: point the manifest's promoted deck + active frame at one style,
// so the atelier renders a full single-style deck.  npx tsx scripts/_deck.ts linocut
import { readFileSync, writeFileSync } from 'node:fs';
import type { ArtManifest } from '../src/art/runs';
const p = 'public/art/runs/index.json';
const style = process.argv[2];
const m: ArtManifest = JSON.parse(readFileSync(p, 'utf8'));
const cards = [...new Set(m.runs.filter((r) => r.kind === 'card').map((r) => r.subject))];
for (const c of cards) {
  const runs = m.runs.filter((r) => r.subject === c && r.style === style);
  if (runs.length) m.promoted[c] = runs[runs.length - 1].id;
}
const frames = m.runs.filter((r) => r.kind === 'frame' && r.style === style);
if (frames.length) m.activeFrame = frames[frames.length - 1].id;
writeFileSync(p, JSON.stringify(m, null, 2));
console.log(`deck → ${style}  ·  ${Object.entries(m.promoted).map(([k, v]) => `${k}:${v}`).join(' ')}  ·  frame ${m.activeFrame}`);
