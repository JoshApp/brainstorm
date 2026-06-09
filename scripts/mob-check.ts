/**
 * Mob-pack check — boots a combat scenario, lets the mobs aggro + chase + ring
 * up for a few seconds, then reads window.__mobPack() (per-enemy distance +
 * bearing to the player + AI state) and reports whether the crowd RINGS the
 * player (bearings spread, distance clustered near strike range) or PILES on
 * one point (distance ≈ 0, bearings clustered).
 *
 *   npm run mob-check                 (perf-horde, 5s settle)
 *   npm run mob-check perf-max 6
 */

import { withHarness, VIEWPORTS } from './perf-core';

interface Mob { kind: string; state: string; dist: number; ang: number; }

function circStd(angles: number[]): number {
  // Circular spread (0 = all same bearing, ~1 = fully spread around the ring).
  if (angles.length < 2) return 0;
  let sx = 0, sy = 0;
  for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a); }
  const r = Math.hypot(sx, sy) / angles.length;
  return 1 - r;   // 1 - mean resultant length
}

async function main() {
  const scenario = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'perf-horde';
  const secs = Number(process.argv[3]) || 5;

  await withHarness({ viewport: VIEWPORTS.phone, onLog: (l) => console.log('  ' + l) }, async (h) => {
    const data = await h.read<{ tokens: number; mobs: Mob[] } | null>({ scenario, secs }, '__mobPack');
    const mobs = data?.mobs;
    if (!mobs || !mobs.length) { console.log('  no mobs (DEV server? scenario?)'); return; }

    const chasing = mobs.filter((m) => ['chasing', 'winding', 'striking', 'recovering'].includes(m.state));
    const dists = chasing.map((m) => m.dist);
    const angs = chasing.map((m) => m.ang);
    const near = chasing.filter((m) => m.dist < 0.6).length;   // ~piled on the player point

    const byState: Record<string, number> = {};
    for (const m of mobs) byState[m.state] = (byState[m.state] ?? 0) + 1;

    console.log(`\nMOB PACK · "${scenario}" · ${secs}s settle`);
    console.log(`  attack tokens held: ${data?.tokens}`);
    console.log(`  states: ${Object.entries(byState).map(([s, n]) => `${n} ${s}`).join(' · ')}`);
    if (chasing.length) {
      const min = Math.min(...dists), max = Math.max(...dists);
      const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
      console.log(`  chasing/attacking: ${chasing.length}`);
      console.log(`  dist to player: min ${min.toFixed(2)} · avg ${avg.toFixed(2)} · max ${max.toFixed(2)}  (ring = clustered, NOT ~0)`);
      console.log(`  piled (<0.6m): ${near}/${chasing.length}  (lower = better)`);
      console.log(`  bearing spread: ${circStd(angs).toFixed(2)}  (0 = one direction, ~1 = surrounded)`);
    console.log(`  chasers (dist@bearing): ${chasing.slice(0, 12).map((m) => `${m.kind[0]}:${m.dist}`).join(' ')}`);
    }
    console.log('');
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
