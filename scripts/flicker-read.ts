/**
 * Turn a flicker trace into a diagnosis.
 *
 * Josh: *"i can walk different paths and you measure why."* So the question this answers is
 * not "does it flicker" but WHICH emitter, on WHICH test, and how far the camera had moved
 * when it changed its mind. A verdict that reverses while the camera moves a centimetre is a
 * knife-edge; one that reverses over a metre is the player crossing a real threshold, and
 * from inside the game the two look identical.
 *
 *   npx tsx scripts/flicker-read.ts            # newest trace
 *   npx tsx scripts/flicker-read.ts flicker-3  # a named one
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'perf-recordings';

interface Sample {
  t: number; cam: [number, number, number]; yaw: number;
  sig: Array<[number, number, number, number, string, number]>;
  lit: Array<[string, number, number, string, number, number, number]>;
}

const want = process.argv[2];
const files = readdirSync(DIR)
  .filter((f) => f.startsWith('flicker-') && f.endsWith('.json'))
  .filter((f) => !want || f.startsWith(want))
  .map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs }))
  .sort((a, b) => a.m - b.m);

if (!files.length) {
  console.log(`no flicker traces in ${DIR}/ — load the game with ?flicker=1 and walk.`);
  process.exit(0);
}

// Every chunk, in order — a walk posts one every 8s and they are one continuous trace.
const samples: Sample[] = [];
for (const { f } of files) {
  const rec = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { samples?: Sample[] };
  if (rec.samples) samples.push(...rec.samples);
}
samples.sort((a, b) => a.t - b.t);
console.log(`${files.length} chunk(s), ${samples.length} samples, `
  + `${(samples.at(-1)!.t - samples[0].t).toFixed(1)}s of walking\n`);

const dist = (a: Sample, b: Sample) =>
  Math.hypot(a.cam[0] - b.cam[0], a.cam[2] - b.cam[2]);

// ── SIGNAL MARKERS ───────────────────────────────────────────────────────────
interface Flip { key: string; from: number; to: number; moved: number; why: string; t: number;
                 at: [number, number] }
const sigFlips: Flip[] = [];
const prevSig = new Map<string, { e: number; s: Sample }>();
for (const s of samples) {
  for (const [i, x, z, e, why] of s.sig) {
    const key = `${i}@${x},${z}`;
    const p = prevSig.get(key);
    if (p) {
      // A REVERSAL, not a change: exposure crossing a visible threshold in either direction.
      const wasOn = p.e > 0.5, isOn = e > 0.5;
      if (wasOn !== isOn) {
        sigFlips.push({ key, from: p.e, to: e, moved: dist(p.s, s), why, t: s.t, at: [x, z] });
      }
    }
    prevSig.set(key, { e, s });
  }
}

const byMarker = new Map<string, Flip[]>();
for (const f of sigFlips) (byMarker.get(f.key) ?? byMarker.set(f.key, []).get(f.key)!).push(f);

console.log(`── SIGNAL MARKERS (flames, eyes, runes) ─────────────────────────`);
if (!byMarker.size) console.log('  no marker crossed the visible threshold. Not the flames.\n');
for (const [key, fs] of [...byMarker].sort((a, b) => b[1].length - a[1].length)) {
  const knife = fs.filter((f) => f.moved < 0.15).length;
  const whys = new Map<string, number>();
  for (const f of fs) whys.set(f.why, (whys.get(f.why) ?? 0) + 1);
  console.log(`  ${key}  ${fs.length} flips  (${knife} within 15cm of camera movement)`
    + `  why: ${[...whys].map(([w, n]) => `${w || 'shown'}×${n}`).join(' ')}`);
  for (const f of fs.slice(0, 4)) {
    console.log(`      t=${f.t.toFixed(1)}s  ${f.from.toFixed(2)} → ${f.to.toFixed(2)}`
      + `  camera moved ${(f.moved * 100).toFixed(1)}cm  (${f.why || 'shown'})`);
  }
}

// ── LIGHTS ───────────────────────────────────────────────────────────────────
console.log(`\n── LIGHTS ───────────────────────────────────────────────────────`);
const litFlips = new Map<string, Flip[]>();
const prevLit = new Map<string, { emit: number; why: string; s: Sample }>();
for (const s of samples) {
  for (const [id, x, z, why, , , emit] of s.lit) {
    const p = prevLit.get(id);
    if (p) {
      const wasOn = p.emit > 0.05, isOn = emit > 0.05;
      if (wasOn !== isOn || (p.why !== why && (p.why === '' || why === ''))) {
        const arr = litFlips.get(id) ?? litFlips.set(id, []).get(id)!;
        arr.push({ key: id, from: p.emit, to: emit, moved: dist(p.s, s), why, t: s.t, at: [x, z] });
      }
    }
    prevLit.set(id, { emit, why, s });
  }
}
if (!litFlips.size) console.log('  no light changed state. Not the light pool.\n');
for (const [id, fs] of [...litFlips].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
  const knife = fs.filter((f) => f.moved < 0.15).length;
  const whys = new Map<string, number>();
  for (const f of fs) whys.set(f.why, (whys.get(f.why) ?? 0) + 1);
  console.log(`  ${id.padEnd(22)} ${fs.length} flips  (${knife} within 15cm)`
    + `  why: ${[...whys].map(([w, n]) => `${w || 'bound'}×${n}`).join(' ')}`);
  for (const f of fs.slice(0, 3)) {
    console.log(`      t=${f.t.toFixed(1)}s  emit ${f.from.toFixed(2)} → ${f.to.toFixed(2)}`
      + `  camera moved ${(f.moved * 100).toFixed(1)}cm  (${f.why || 'bound'})`);
  }
}

// ── SLOT CHURN ───────────────────────────────────────────────────────────────
// A light that keeps losing and regaining its slot never eases up to full, so the room
// pulses without any single light ever reading as "culled".
let churn = 0, seenMax = 0;
const prevSet = new Set<string>();
for (const s of samples) {
  const now = new Set(s.lit.filter((l) => l[3] === '').map((l) => l[0]));
  seenMax = Math.max(seenMax, now.size);
  for (const id of now) if (!prevSet.has(id)) churn++;
  prevSet.clear();
  for (const id of now) prevSet.add(id);
}
console.log(`\n── SLOT CHURN ───────────────────────────────────────────────────`);
console.log(`  bound lights re-bound ${churn} times over ${samples.length} samples`
  + `  (peak ${seenMax} bound at once)`);
console.log(churn > samples.length * 0.5
  ? '  HIGH — lights are trading slots faster than they can ease up, which reads as a pulsing room.'
  : '  low — slot competition is not the story.');
