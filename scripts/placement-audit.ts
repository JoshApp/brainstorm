// PLACEMENT AUDIT — headless measurement of event/loot clustering across many
// procgen floors. composeFloor(depth, rand, ...) is pure data (no THREE/DOM), so
// we can generate hundreds of floors in node and MEASURE how often an EVENT
// (bonfire/fountain/altar/basin/challenge/…) ends up with a secondary LOOTABLE
// (chest/corpse/loot-anchor) stacked right on top of it — the "cluster of two"
// the designer keeps seeing.
//
//   npx tsx scripts/placement-audit.ts            # default sweep
//   npx tsx scripts/placement-audit.ts --floors 400 --examples 20
//
// This is the BEFORE/AFTER harness for the centerpiece-vs-secondary placement
// work (#69): run it, change the placer, run it again, compare.

import { composeFloor } from '../src/level/vault-compose';
import type { PropSpec, RoomSpec } from '../src/level/types';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}

// Deterministic seedable RNG (mulberry32) — reproducible sweeps.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A prop is an EVENT (a room centerpiece) if it's one of these interactable
// set-pieces, or a bonfire model.
const EVENT_KINDS = new Set([
  'altar', 'blood-altar', 'starter-altar', 'challenge-offering', 'fountain',
  'tithe-basin', 'reliquary', 'tome-pillar', 'merchant',
]);
// A prop is SECONDARY LOOT if it's a container/corpse/anchor the player loots.
const LOOT_KINDS = new Set(['chest', 'loot-anchor', 'stash-chest', 'corpse']);

type Tagged = { x: number; z: number; label: string };

function classify(p: PropSpec): { kind: 'event' | 'loot' | 'other'; label: string } {
  const anyP = p as { kind: string; model?: { id?: string } };
  if (anyP.kind === 'model') {
    if (anyP.model?.id === 'bonfire') return { kind: 'event', label: 'bonfire' };
    return { kind: 'other', label: `model:${anyP.model?.id ?? '?'}` };
  }
  if (EVENT_KINDS.has(anyP.kind)) return { kind: 'event', label: anyP.kind };
  if (LOOT_KINDS.has(anyP.kind)) return { kind: 'loot', label: anyP.kind };
  return { kind: 'other', label: anyP.kind };
}

function roomOf(p: { x: number; z: number }, rooms: RoomSpec[]): RoomSpec | null {
  for (const r of rooms) {
    const hw = r.rect.w / 2, hd = r.rect.d / 2;
    if (p.x >= r.rect.x - hw && p.x <= r.rect.x + hw && p.z >= r.rect.z - hd && p.z <= r.rect.z + hd) return r;
  }
  return null;
}

const CLUSTER_M = 2.5;    // event↔loot within this reads as a "cluster of two"
const OVERLAP_M = 0.7;    // near-exact stack (two set-pieces on one spot)

const FLOORS = arg('--floors', 300);
const EXAMPLES = arg('--examples', 12);
const MAX_DEPTH = 8;

let roomsWithEvent = 0;
let eventRoomsWithLoot = 0;                 // event-room that also holds ≥1 loot
let eventLootClusters = 0;                  // event↔loot pairs closer than CLUSTER_M
let multiEventRooms = 0;                    // ≥2 events in one room
let eventOverlaps = 0;                      // event↔event closer than OVERLAP_M
const nearestDists: number[] = [];          // per event-room: nearest loot distance
const examples: string[] = [];
const pairCounts = new Map<string, number>();   // "event↔loot" → cluster count

for (let n = 0; n < FLOORS; n++) {
  const depth = 1 + (n % MAX_DEPTH);
  const rand = mulberry32(0x9e37 + n * 2654435761);
  let level;
  try {
    level = composeFloor(depth, rand, 'next', { id: `audit-${n}`, isBossFloor: false });
  } catch (e) {
    examples.push(`compose failed d${depth} #${n}: ${(e as Error).message}`);
    continue;
  }
  const byRoom = new Map<string, { events: Tagged[]; loot: Tagged[] }>();
  for (const p of level.props) {
    const c = classify(p);
    if (c.kind === 'other') continue;
    const xz = p as { x: number; z: number };
    if (typeof xz.x !== 'number') continue;
    const room = roomOf(xz, level.rooms);
    if (!room) continue;
    const bucket = byRoom.get(room.id) ?? { events: [], loot: [] };
    (c.kind === 'event' ? bucket.events : bucket.loot).push({ x: xz.x, z: xz.z, label: c.label });
    byRoom.set(room.id, bucket);
  }

  for (const [roomId, { events, loot }] of byRoom) {
    if (events.length === 0) continue;
    roomsWithEvent++;
    if (events.length >= 2) {
      multiEventRooms++;
      for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
        const d = Math.hypot(events[i].x - events[j].x, events[i].z - events[j].z);
        if (d < OVERLAP_M) eventOverlaps++;
      }
    }
    if (loot.length > 0) {
      eventRoomsWithLoot++;
      let nearest = Infinity;
      for (const e of events) for (const l of loot) {
        const d = Math.hypot(e.x - l.x, e.z - l.z);
        nearest = Math.min(nearest, d);
        if (d < CLUSTER_M) {
          eventLootClusters++;
          const pk = `${e.label} ↔ ${l.label}`;
          pairCounts.set(pk, (pairCounts.get(pk) ?? 0) + 1);
          if (examples.length < EXAMPLES) {
            examples.push(`d${depth} #${n} room ${roomId}: ${pk} = ${d.toFixed(2)}m`);
          }
        }
      }
      nearestDists.push(nearest);
    }
  }
}

nearestDists.sort((a, b) => a - b);
const pct = (n: number, d: number) => (d > 0 ? ((100 * n) / d).toFixed(1) : '0.0');
const q = (f: number) => nearestDists.length ? nearestDists[Math.floor(f * (nearestDists.length - 1))].toFixed(2) : 'n/a';

console.log(`\n═══ PLACEMENT AUDIT — ${FLOORS} floors (depths 1–${MAX_DEPTH}) ═══\n`);
console.log(`Rooms with an event:              ${roomsWithEvent}`);
console.log(`  …that also hold loot:           ${eventRoomsWithLoot}  (${pct(eventRoomsWithLoot, roomsWithEvent)}%)`);
console.log(`  …with event↔loot < ${CLUSTER_M}m:       ${eventLootClusters} clusters`);
console.log(`Rooms with ≥2 events:             ${multiEventRooms}`);
console.log(`  event↔event overlaps < ${OVERLAP_M}m:   ${eventOverlaps}`);
console.log(`\nNearest event→loot distance (event-rooms holding loot):`);
console.log(`  min ${q(0)}m · p25 ${q(0.25)}m · median ${q(0.5)}m · p75 ${q(0.75)}m · max ${q(1)}m`);
console.log(`\nCluster breakdown by pair (< ${CLUSTER_M}m) — altar↔corpse is the intentional altar-ritual:`);
for (const [pk, c] of [...pairCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.toString().padStart(3)}  ${pk}`);
console.log(`\nExample clusters (event↔loot < ${CLUSTER_M}m):`);
for (const e of examples) console.log(`  ${e}`);
console.log('');
