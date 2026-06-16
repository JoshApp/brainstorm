import * as THREE from 'three';
import { CONFIG } from '../config';
import { gameRng } from '../engine/rng';

// Pack coordinator — makes a crowd of chasing mobs behave as a SURROUNDING,
// TAKING-TURNS pack instead of a pile that all swing at once. Computed once per
// frame for the whole crowd (the one place that sees every mob at the same
// time). Three layers:
//
//   1. ENCIRCLEMENT — each chaser's goal is a point at its strike distance
//      along ITS bearing to the player, so mobs fan out by approach angle.
//   2. SEPARATION — chasers within SEPARATION_RADIUS push apart, never stack.
//   3. ATTACK TOKENS — only ATTACK_TOKENS mobs may COMMIT to an attack at once.
//      The rest hold the ring and PROWL (slow orbit), waiting their turn. This
//      turns a swarm from a damage-blob stunlock into a choreographed pack that
//      circles and darts in — overwhelming but survivable, and it reads as
//      having intent.
//
// Mobs register once on spawn with live accessors and leave on death. enemy.ts
// reads packMoveTarget(id) as its chase goal and requestToken(id) to gate a
// commit. Module-level state (the codebase's pattern); the player is one point.

interface Member {
  id: string;
  pos: THREE.Vector3;          // LIVE ref to the mob's world position (container.position)
  reach: number;               // ring radius for this mob (≈ its strike range)
  active: () => boolean;       // in the fight this frame (chasing/attacking)?
  attacking: () => boolean;    // mid-attack (winding/striking/recovering)?
  tx: number; tz: number;      // computed ring target (slot + separation + prowl) for this frame
  sepX: number; sepZ: number;  // separation push
  orbitDir: number;            // ±1 current prowl direction (split per-mob, and it REVERSES)
  orbitFlipIn: number;         // s until this mob reverses its orbit — so a pack weaves, not circles
  tokenCd: number;             // s before this mob may grab a token again
}

// FNV-1a hash → a well-mixed bit from the whole id, so consecutive ids
// (enemy-rat-0, enemy-rat-1, …) split ~50/50 on parity. The old `id.length &
// 1` gave every same-length id the SAME bit, so a rat pack all circled one way.
function idBit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h & 1;
}
function nextFlipDelay(): number {
  return P.ORBIT_FLIP_MIN + gameRng() * (P.ORBIT_FLIP_MAX - P.ORBIT_FLIP_MIN);
}

const members = new Map<string, Member>();
const tokens = new Set<string>();   // ids currently holding an attack commit token

const P = CONFIG.ENEMY_AI.PACK;
const SEP_RADIUS_SQ = P.SEPARATION_RADIUS * P.SEPARATION_RADIUS;

/** Register a mob (call once on spawn). `pos` is held by reference. `reach` is
 *  the ring radius (strike range). `active` = in the fight this frame;
 *  `attacking` = mid-attack (token-holding window). */
export function joinPack(
  id: string, pos: THREE.Vector3, reach: number,
  active: () => boolean, attacking: () => boolean,
): void {
  members.set(id, {
    id, pos, reach, active, attacking,
    tx: pos.x, tz: pos.z, sepX: 0, sepZ: 0,
    // Split the starting prowl direction per-mob (well-mixed id bit), then let
    // it reverse on a varied timer (tickPack) so a pack weaves instead of
    // orbiting one way forever.
    orbitDir: idBit(id) ? 1 : -1,
    orbitFlipIn: nextFlipDelay(),
    tokenCd: 0,
  });
}

/** Drop a mob from the pack (call on death / level teardown). */
export function leavePack(id: string): void {
  members.delete(id);
  tokens.delete(id);
}

/** Recompute the whole crowd: separation, ring targets (with prowl for waiters),
 *  and auto-release tokens from mobs that stopped attacking. Call ONCE per frame,
 *  BEFORE the enemy update loop, with dt + the player position. */
export function tickPack(dt: number, player: THREE.Vector3): void {
  const active: Member[] = [];
  for (const m of members.values()) {
    m.sepX = 0; m.sepZ = 0;
    if (m.tokenCd > 0) m.tokenCd = Math.max(0, m.tokenCd - dt);
    // Reverse the prowl direction on a varied timer → the pack weaves around
    // you instead of circling predictably one way.
    m.orbitFlipIn -= dt;
    if (m.orbitFlipIn <= 0) { m.orbitDir = -m.orbitDir; m.orbitFlipIn = nextFlipDelay(); }
    // Auto-release a token the instant its holder stops attacking (or goes
    // inactive) — and start its re-acquire cooldown so a waiter gets the turn.
    if (tokens.has(m.id) && !m.attacking()) {
      tokens.delete(m.id);
      m.tokenCd = P.TOKEN_REACQUIRE_CD;
    }
    if (m.active()) active.push(m);
  }
  const n = active.length;

  // Pairwise separation (O(n²) over a handful of active chasers).
  for (let i = 0; i < n; i++) {
    const a = active[i];
    for (let j = i + 1; j < n; j++) {
      const b = active[j];
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= SEP_RADIUS_SQ || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (1 - d / P.SEPARATION_RADIUS) * P.SEPARATION_FORCE;
      const ux = dx / d, uz = dz / d;
      a.sepX += ux * push; a.sepZ += uz * push;
      b.sepX -= ux * push; b.sepZ -= uz * push;
    }
  }

  // Ring target per active member: a slot at strike distance along its bearing,
  // + separation. WAITERS (no token) advance a slow prowl angle so they circle
  // the player instead of standing; token-holders hold their bearing to strike.
  for (const m of active) {
    let bx = m.pos.x - player.x, bz = m.pos.z - player.z;
    let bl = Math.hypot(bx, bz);
    if (bl < 1e-3) { bx = m.sepX; bz = m.sepZ; bl = Math.hypot(bx, bz) || 1; }
    let bearing = Math.atan2(bx, bz);
    // Waiters (no token) aim a FIXED angle ahead along the ring → they prowl/
    // circle the player. Fixed lead (not an accumulating phase) keeps the target
    // at full ring radius each frame, so it orbits without spiralling inward.
    if (!tokens.has(m.id) && !m.attacking()) bearing += m.orbitDir * P.ORBIT_LEAD;
    const ring = m.reach + P.RING_RADIUS_BONUS;
    m.tx = player.x + Math.sin(bearing) * ring + m.sepX;
    m.tz = player.z + Math.cos(bearing) * ring + m.sepZ;
  }
}

const tmp = new THREE.Vector3();

/** The world point a chasing mob should move toward (ring slot + separation +
 *  prowl), as computed by the last tickPack. Null if unregistered (caller falls
 *  back to the player's position). Writes into `out`. */
export function packMoveTarget(id: string, _player: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
  const m = members.get(id);
  if (!m) return null;
  out.set(m.tx, m.pos.y, m.tz);
  return out;
}

/** Try to claim an attack-commit token. Returns true if this mob already holds
 *  one OR a slot is free and it's off its re-acquire cooldown. Call at the
 *  moment of committing to an attack; the token auto-releases (tickPack) when
 *  the mob leaves its attack states. */
export function requestToken(id: string): boolean {
  if (tokens.has(id)) return true;
  const m = members.get(id);
  if (!m || m.tokenCd > 0) return false;
  if (tokens.size >= P.ATTACK_TOKENS) return false;
  tokens.add(id);
  return true;
}

/** Reusable scratch the caller can borrow for packMoveTarget. */
export function packScratch(): THREE.Vector3 { return tmp; }

/** Diagnostic: how many attack tokens are held right now (≤ ATTACK_TOKENS). */
export function packTokenCount(): number { return tokens.size; }

/** Clear the whole pack (level teardown). */
export function clearPack(): void { members.clear(); tokens.clear(); }
