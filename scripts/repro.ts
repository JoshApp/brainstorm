// REPRO-FROM-REPORT — turn a player bug report into a deterministic repro of the
// exact floor it happened on. A report captures the run SEED + DEPTH, and the
// game boots any seed+depth via ?seed=&depth=&dev=1 (the seeded-jump path), so a
// report is directly reproducible.
//
//   npm run delve repro <report.json>          # print the repro summary + URL
//   npm run delve repro <report.json> --snap   # also headless-snap that floor
//   npm run delve repro --id 42                # pull report #42 from the collector first
//
// With --id it fetches from the collector (REPORT_ENDPOINT / REPORT_READ_KEY, same
// env as `delve reports`). Closes the self-development loop: report → repro → fix.
//
// IT REPRODUCES THE VIEW, NOT JUST THE FLOOR. A report carries the camera POSE
// and a crosshair raycast (report/look-target.ts), so this prints what the
// player was aiming at — named, with the ancestor chain that says which system
// built it — and replays the pose through `?at=&yaw=&pitch=`. Before that, a
// repro rebuilt the right floor and dropped you at the spawn, which for "a
// doorway three rooms away is wrong" is the easy half of the problem.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

interface LookHit {
  name?: string; owner?: string; distance?: number;
  point?: { x: number; y: number; z: number };
  geometry?: string | null; material?: string | null;
}
interface PlaceRef { id?: string; kind?: string; corridorType?: string; linkId?: string }
interface Placement { inside?: PlaceRef[]; nearest?: (PlaceRef & { distance?: number }) | null }
interface Report {
  build?: string;
  at?: number;
  userText?: string;
  run?: {
    seed?: number | null; depth?: number | null; floorId?: string | null;
    cameraPos?: { x: number; y: number; z: number } | null;
    yaw?: number | null; pitch?: number | null;
  };
  device?: { viewport?: { w: number; h: number }; userAgent?: string };
  looking?: {
    hits?: LookHit[];
    aim?: { x: number; y: number; z: number };
    nearby?: Array<{ owner?: string; count?: number; nearest?: number; example?: string }>;
    place?: { at?: Placement; aim?: Placement } | null;
  } | null;
}

function has(name: string) { return process.argv.includes(name); }
function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadReport(): Promise<Report> {
  const id = argVal('--id');
  if (id) {
    const endpoint = process.env.REPORT_ENDPOINT;
    const key = process.env.REPORT_READ_KEY;
    if (!endpoint || !key) throw new Error('Set REPORT_ENDPOINT + REPORT_READ_KEY to use --id (see scripts/reports.ts).');
    const res = await fetch(`${endpoint}?id=eq.${encodeURIComponent(id)}&select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Collector ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as Array<{ data?: Report }>;
    if (!rows.length || !rows[0].data) throw new Error(`No report #${id}.`);
    return rows[0].data;
  }
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('Usage: delve repro <report.json> [--snap]  |  delve repro --id <n> [--snap]');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  // Accept a raw report, or a collector row ({ data: report }).
  return (parsed.data ?? parsed) as Report;
}

async function main() {
  const r = await loadReport();
  const seed = r.run?.seed;
  const depth = r.run?.depth ?? 1;
  const text = (r.userText ?? '').trim() || '(no description)';

  console.log('\n── REPORT ─────────────────────────────────────────────');
  console.log(`build:  ${r.build ?? '?'}`);
  console.log(`floor:  depth ${depth}${r.run?.floorId ? ` (${r.run.floorId})` : ''}`);
  console.log(`seed:   ${seed ?? '(none — not reproducible)'}`);
  if (r.device?.viewport) console.log(`device: ${r.device.viewport.w}×${r.device.viewport.h}`);
  console.log(`\n"${text}"`);
  console.log('───────────────────────────────────────────────────────\n');

  if (seed == null) {
    console.log('This report carries no seed, so the floor cannot be reproduced deterministically.');
    return;
  }

  // WHAT THE REPORT IS ABOUT. The crosshair raycast, nearest hit first — the
  // owner chain is the useful half, because this codebase names its groups after
  // the system that built them, so it points at the file to open.
  const hits = r.looking?.hits ?? [];
  if (hits.length) {
    console.log('Looking at:');
    for (const h of hits) {
      const p = h.point ? `(${h.point.x}, ${h.point.y}, ${h.point.z})` : '?';
      console.log(`  ${String(h.distance ?? '?').padStart(6)}m  ${h.name ?? '?'}  ${p}`);
      if (h.owner) console.log(`          owner: ${h.owner}`);
    }
    console.log('');
  }

  // WHERE, IN THE FLOOR PLAN'S OWN WORDS. Room and corridor ids are the thing a
  // reader can go and open a file about; a coordinate is not.
  const fmtPlace = (pl?: Placement | null): string => {
    if (!pl) return '';
    const parts = (pl.inside ?? []).map((r) => {
      const extra = [r.corridorType, r.linkId].filter(Boolean).join(', ');
      return `${r.id}${extra ? ` (${extra})` : ''}`;
    });
    if (parts.length) return parts.join(' + ');
    const n = pl.nearest;
    return n ? `outside everything — nearest ${n.id} at ${n.distance}m` : '';
  };
  const at = fmtPlace(r.looking?.place?.at);
  const aimAt = fmtPlace(r.looking?.place?.aim);
  if (at || aimAt) {
    console.log('Where:');
    if (at) console.log(`  standing in: ${at}`);
    if (aimAt && aimAt !== at) console.log(`  aimed at:    ${aimAt}`);
    console.log('');
  }

  // THE VICINITY. Precise aim is the wrong thing to ask of a thumb, and these
  // bugs are usually BESIDE the thing you can point at — or are a hole, with no
  // geometry to hit. So this lists what lives around the aim point, grouped by
  // producer, which is normally where the answer actually is.
  const near = r.looking?.nearby ?? [];
  if (near.length) {
    const a = r.looking?.aim;
    console.log(`Around the aim point${a ? ` (${a.x}, ${a.y}, ${a.z})` : ''}:`);
    for (const n of near) {
      const tag = (n.count ?? 1) > 1 ? ` ×${n.count}` : '';
      console.log(`  ${String(n.nearest ?? '?').padStart(6)}m  ${n.example ?? '?'}${tag}`);
      if (n.owner) console.log(`          ${n.owner}`);
    }
    console.log('');
  }

  // STAND WHERE THEY STOOD. Seed + depth rebuild the floor; the pose is what
  // puts a reader in front of the thing instead of at the stairs a room away.
  const c = r.run?.cameraPos;
  const pose = c
    ? `&at=${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`
      + (r.run?.yaw != null ? `&yaw=${r.run.yaw.toFixed(4)}` : '')
      + (r.run?.pitch != null ? `&pitch=${r.run.pitch.toFixed(4)}` : '')
    : '';
  if (!c) console.log('(no camera pose in this report — falls back to the spawn point)\n');

  const reproScenario = `run-${seed}-${depth}`;
  const query = `autostart=1&seed=${seed}&depth=${depth}&dev=1${pose}`;
  console.log('Reproduce it:');
  console.log(`  headless snap:  npm run delve snap ${reproScenario} phone${pose ? ` --q="${pose.slice(1)}"` : ''}`);
  console.log(`  in a browser:   /brainstorm/?${query}\n`);

  if (has('--snap')) {
    const viewport = argVal('--viewport') ?? 'phone';
    console.log(`Snapping ${reproScenario} (${viewport})${pose ? ' from the reporter\u2019s exact pose' : ''}…`);
    const args = ['run', 'delve', 'snap', reproScenario, viewport];
    if (pose) args.push(`--q=${pose.slice(1)}`);
    const res = spawnSync('npm', args, { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
