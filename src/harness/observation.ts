// Build a structured Observation from the live world state.
//
// All reads are O(world) — fine for occasional calls. The harness is
// turn-based so observations only fire when the operator asks (after each
// action, on screenshot, on explicit observe()).

import * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import type { RoomSpec } from '../level/types';
import { get as getEntity } from '../ecs/world';
import { getCurrentDepth } from '../level/loader';
import { getEquipment } from '../player/equipment';
import { sampleLightAt, getRegisteredSourceCount } from '../scene/light-pool';
import { CONFIG } from '../config';
import { pausedReason } from '../world-paused';
import { getSettings } from '../settings/settings';
import { getTurn, getTickClock } from './state';
import { getAllInteractables } from '../interactables/system';
import type {
  Observation, ObservedEnemy, ObservedInteractable, ObservedPickup,
  Direction8,
} from './types';

const EIGHTH = Math.PI / 8;

export function buildObservation(
  camera: THREE.PerspectiveCamera,
  level: LiveLevel,
): Observation {
  const px = camera.position.x;
  const py = camera.position.y;
  const pz = camera.position.z;
  const yaw = camera.rotation.y;

  // ── Player ────────────────────────────────────────────────────────
  const player = getEntity('player');
  const hpCurrent = player?.hp?.current ?? 0;
  const hpMax = player?.hp?.base ?? 0;
  const buffs = (player?.buffs ?? []).map((b) => b.specId);

  const eq = getEquipment();
  const equipped: Record<string, string | null> = {};
  for (const slot of Object.keys(eq) as Array<keyof typeof eq>) {
    equipped[slot] = eq[slot]?.id ?? null;
  }

  // ── Enemies ──────────────────────────────────────────────────────
  const enemies: ObservedEnemy[] = [];
  for (const e of level.enemies) {
    if (!e.alive && !e.dying) continue;
    const ex = e.group.position.x;
    const ey = e.group.position.y;
    const ez = e.group.position.z;
    const dx = ex - px;
    const dz = ez - pz;
    const distance = Math.hypot(dx, dz);
    const bearing = normalizeAngle(Math.atan2(dx, -dz) + yaw);
    const compass = compassFor(dx, dz);
    const inSight = level.walkable.hasLineOfSight(px, pz, ex, ez);
    // 60° cone half-angle for "is in my forward view". Wider than the
    // interact cone (which is for tap-target precision); this is what
    // a player would notice without turning.
    const inCone = Math.abs(bearing) < Math.PI / 3;
    const lightAtEntity = sampleLightAt(ex, ey + 0.5, ez);
    enemies.push({
      id: e.entityId,
      kind: e.kind,
      pos: { x: round(ex), z: round(ez), y: round(ey + (e.aimHeight ?? 0.5)) },
      distance: round(distance),
      bearing: round(bearing, 3),
      compass,
      state: e.dying ? 'dying' : (e.alive ? e.aiState : 'dead'),
      hp: { current: e.hp, max: e.maxHp },
      inLight: lightAtEntity > 0.1,
      inSight,
      inCone,
    });
  }
  enemies.sort((a, b) => a.distance - b.distance);

  // ── Interactables ────────────────────────────────────────────────
  const interactables: ObservedInteractable[] = [];
  for (const it of getAllInteractables()) {
    const ix = it.position.x;
    const iz = it.position.z;
    const dx = ix - px;
    const dz = iz - pz;
    const distance = Math.hypot(dx, dz);
    const bearing = normalizeAngle(Math.atan2(dx, -dz) + yaw);
    const compass = compassFor(dx, dz);
    const inSight = level.walkable.hasLineOfSight(px, pz, ix, iz);
    interactables.push({
      id: it.id,
      kind: kindFromId(it.id),
      pos: { x: round(ix), z: round(iz), y: round(it.position.y) },
      distance: round(distance),
      bearing: round(bearing, 3),
      compass,
      state: it.promptLabel || 'inert',
      inRange: distance <= it.radius,
      inSight,
    });
  }
  interactables.sort((a, b) => a.distance - b.distance);

  // ── Pickups (subset of interactables — id starts with 'pickup') ──
  // Pickups are interactables in this codebase, so the previous loop
  // already covered them. Surface them again here as a convenience
  // view since "what loot is on the floor" is a common question.
  const pickups: ObservedPickup[] = interactables
    .filter((i) => i.kind === 'pickup')
    .map((i) => ({
      id: i.id,
      kind: i.state,            // pickup's promptLabel encodes item kind
      pos: i.pos,
      distance: i.distance,
      bearing: i.bearing,
      compass: i.compass,
      inSight: i.inSight,
    }));

  // ── Geometry: 8-cardinal wall raycasts ───────────────────────────
  const walls8 = {
    N:  wallDistance(level, px, pz,  0, -1),
    NE: wallDistance(level, px, pz,  1, -1),
    E:  wallDistance(level, px, pz,  1,  0),
    SE: wallDistance(level, px, pz,  1,  1),
    S:  wallDistance(level, px, pz,  0,  1),
    SW: wallDistance(level, px, pz, -1,  1),
    W:  wallDistance(level, px, pz, -1,  0),
    NW: wallDistance(level, px, pz, -1, -1),
  } as Record<Direction8, number>;

  // ── Light ────────────────────────────────────────────────────────
  const atPlayer = sampleLightAt(px, py, pz);
  const nearbySources = getRegisteredSourceCount();

  // ── Room + floor ─────────────────────────────────────────────────
  const roomId = findRoomContaining(px, pz, level.spec.rooms);
  const depth = getCurrentDepth();
  const floorId = level.spec.id;

  return {
    turn: getTurn(),
    tickClock: round(getTickClock(), 3),
    depth,
    floorId,
    roomId,
    pausedReason: pausedReason(),
    player: {
      pos: { x: round(px), y: round(py), z: round(pz) },
      facingYaw: round(yaw, 3),
      lookRadiansPerUnit: getSettings().lookSensitivity,
      hp: { current: hpCurrent, max: hpMax },
      buffs,
      equipped,
    },
    light: {
      atPlayer: round(atPlayer, 3),
      nearbySources,
    },
    visible: { enemies, interactables, pickups },
    geometry: { walls8 },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function compassFor(dx: number, dz: number): Direction8 {
  const a = Math.atan2(dx, -dz);  // 0 = N, +π/2 = E, ±π = S, -π/2 = W
  if (a >= -EIGHTH && a < EIGHTH) return 'N';
  if (a >= EIGHTH && a < 3 * EIGHTH) return 'NE';
  if (a >= 3 * EIGHTH && a < 5 * EIGHTH) return 'E';
  if (a >= 5 * EIGHTH && a < 7 * EIGHTH) return 'SE';
  if (a >= 7 * EIGHTH || a < -7 * EIGHTH) return 'S';
  if (a >= -7 * EIGHTH && a < -5 * EIGHTH) return 'SW';
  if (a >= -5 * EIGHTH && a < -3 * EIGHTH) return 'W';
  return 'NW';
}

/** Coarse ray-march along (ux, uz) (unit direction, will be normalized)
 *  until walkable.contains returns false. Returns the last walkable
 *  distance, or Infinity if no wall within 20m. */
function wallDistance(
  level: LiveLevel,
  px: number, pz: number,
  dx: number, dz: number,
): number {
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const step = 0.25;
  const max = 20;
  // Match the player's actual collision radius so walls8 reports the
  // distance the PLAYER can travel, not the distance a 0.05m point
  // can travel. Mismatched radii were making the bot think doorways
  // and gaps were navigable when they're too narrow to fit through.
  const radius = 0.3;
  let lastFree = 0;
  for (let d = step; d <= max; d += step) {
    const x = px + ux * d;
    const z = pz + uz * d;
    if (level.walkable.contains(x, z, radius)) {
      lastFree = d;
    } else {
      return round(lastFree, 2);
    }
  }
  return Infinity;
}

/** Find the most specific (logical-only) room rect containing (x, z),
 *  falling back to main rooms. Duplicates findRoomContaining from
 *  builder.ts to avoid widening the builder's public surface. */
function findRoomContaining(x: number, z: number, rooms: RoomSpec[]): string | null {
  const here = (r: RoomSpec): boolean => {
    const hw = r.rect.w / 2;
    const hd = r.rect.d / 2;
    return x >= r.rect.x - hw && x <= r.rect.x + hw && z >= r.rect.z - hd && z <= r.rect.z + hd;
  };
  for (const r of rooms) if (r.logicalOnly && here(r)) return r.id;
  for (const r of rooms) if (!r.logicalOnly && here(r)) return r.id;
  return null;
}

/** Derive a coarse kind label from an interactable id. Ids follow the
 *  `<kind>-<n>` convention set by each spawn function (see grep in
 *  src/interactables/). 'stairs-depth-2-7' → 'stairs', etc. */
function kindFromId(id: string): string {
  const i = id.indexOf('-');
  return i > 0 ? id.slice(0, i) : id;
}

function round(n: number, decimals = 1): number {
  if (!Number.isFinite(n)) return n;
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

// `CONFIG` import is kept so future use (cone half-angle, max obs range)
// has the right module wired. Currently unused.
void CONFIG;
