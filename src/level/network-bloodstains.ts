// Async bloodstains — real other-player (and your own past) deaths, made
// physical in the world.
//
// This is the Phase-4 payoff of the death table: deaths recorded at this
// depth are rendered as loot-free fallen-delver corpses you descend past.
// It reuses the existing corpse system (content/corpses.ts is explicitly the
// seam "async multiplayer will fill with real players' deaths"), so a network
// death whispers its epitaph through the same lamp-reveal path as an authored
// one.
//
// Floors are procgen PER SEED, so a death's stored (x, z) is from a different
// layout and means nothing here — we don't trust it. Instead we place each
// body at a deterministic WALKABLE cell in THIS floor, so a bloodstain never
// clips a wall and stays put across rebuilds. This pass runs AFTER the
// deterministic build (its RNG is isolated), so it can't desync buildRng.

import * as THREE from 'three';
import type { LevelSpec } from './types';
import type { WalkableRegion } from './walkable';
import { groundYAt } from './elevation';
import { spawnCorpse } from '../interactables/corpse';
import type { FallenDelver, CorpsePose } from '../content/corpses';
import { deathsAtDepth, type DeathRecord } from '../net/delve-net';

// At most this many networked bloodstains per floor — enough to feel
// inhabited, not a graveyard.
const MAX_PER_FLOOR = 3;

const POSES: CorpsePose[] = ['crawled', 'curled', 'slumped'];

// In-world grim epitaphs (the PLACE's voice — terse, cruel, indifferent; not
// the snarky voice in the deep). Whispered when your lamp finds the body.
const EPITAPHS = [
  'No further than this.',
  'They came this far. Then nothing.',
  'The dark kept the rest of them.',
  'Down to here, and down for good.',
  'Another who thought they were ready.',
  'The stairs went on. They did not.',
];

// Cheap deterministic string hash (FNV-1a) — same death always lands the
// same way on the same floor.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Place the depth's recorded deaths as loot-free fallen-delver corpses at
 *  valid positions in the just-built floor. No-op when offline / unsynced /
 *  not a combat floor. */
export function spawnNetworkBloodstains(
  root: THREE.Object3D,
  walkable: WalkableRegion,
  spec: LevelSpec,
): void {
  const depth = spec.depth ?? 0;
  if (depth < 1) return;                          // nothing before the descent proper
  if ((spec.spawns?.length ?? 0) === 0) return;   // combat floors only — sanctuaries stay clean
  const rooms = spec.rooms ?? [];
  if (rooms.length === 0) return;

  const deaths = deathsAtDepth(depth);
  if (deaths.length === 0) return;

  // One body per distinct delver; cap the count.
  const seen = new Set<string>();
  const chosen: DeathRecord[] = [];
  for (const d of deaths) {
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    chosen.push(d);
    if (chosen.length >= MAX_PER_FLOOR) break;
  }

  const seedKey = String(spec.seed ?? spec.id);
  for (const d of chosen) {
    const h = hashStr(`${seedKey}:${d.name}`);
    const room = rooms[h % rooms.length].rect;
    // Deterministic point inside the room (kept off the walls), then snapped
    // to a walkable cell so it never lands in geometry.
    const fx = ((h & 0xffff) / 0xffff - 0.5) * 0.7;
    const fz = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.7;
    const p = walkable.resolveSpawn(room.x + fx * room.w, room.z + fz * room.d, 0.3);
    const fallen: FallenDelver = {
      name: d.name,
      epitaph: EPITAPHS[h % EPITAPHS.length],
      pose: POSES[h % POSES.length],
      decay: 'fleshy',
      // no `carried` → loot-free, READ-only (a trace, not a treasure)
    };
    const rotY = (h % 628) / 100;
    spawnCorpse(root, new THREE.Vector3(p.x, groundYAt(p.x, p.z), p.z), rotY, fallen, null);
  }
}
