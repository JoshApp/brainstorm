import * as THREE from 'three';
import type { EnemySpec } from '../content/enemies';
import type { BuiltModel } from '../ecs/build-model';

// Hurtbox zones — the TARGET side of the combat hit system (see
// docs/COMBAT-HIT-SYSTEM.md). An enemy's hurtbox is an ordered list of named
// VOLUMES (capsule or sphere) in the enemy's local frame, each with a damage
// multiplier and a runtime ENABLED flag. This generalizes "the head" into a
// toolkit: a body baseline, a head locational bonus, toggleable WEAK points
// (glowing cores, exposed backs), and ARMOR zones that soak until broken.
//
// Zones are authored/derived in WORLD-SCALE METRES relative to the enemy's
// origin (the container). A zone may FOLLOW an animated bone (the head sphere
// rides the head; a weak point rides a flailing arm); otherwise it is static in
// the root-local frame and rotates with the body's facing.
//
// This module is the data model + derivation + the pure geometric tests the
// resolver and the debug overlay both consume. It does not apply damage itself.

export type ZoneRole = 'body' | 'head' | 'weak' | 'armor';

export type ZoneShape =
  | { kind: 'capsule'; a: THREE.Vector3; b: THREE.Vector3; radius: number }
  | { kind: 'sphere'; center: THREE.Vector3; radius: number };

export interface HurtZone {
  /** Stable id — 'body' | 'head' | 'core' | 'left-pauldron' | … Used by
   *  setZoneEnabled() and by narration/effects. */
  id: string;
  shape: ZoneShape;        // local-frame geometry (relative to `follow` or root)
  role: ZoneRole;
  /** 0 = immune (armor), 1 = normal, >1 = weak point. */
  damageMul: number;
  /** Runtime activate/deactivate. A disabled zone is skipped by the resolver
   *  and drawn ghosted in the debug overlay. */
  enabled: boolean;
  /** When a hit overlaps several enabled zones, the highest priority wins. */
  priority: number;
  /** Force a crit when this is the zone hit (head defaults true). */
  crit: boolean;
  /** If set, the zone tracks this animated bone's world transform; the shape's
   *  local coords become offsets from the bone. Null → static in the root frame. */
  follow: THREE.Object3D | null;
  /** Runtime trigger: the enemy enables this zone only while STAGGERED (poise
   *  broken) and disables it otherwise — an exposed weak point in the free-hit
   *  window. Such zones start disabled. */
  openWhenStaggered: boolean;
}

export interface Hurtbox {
  /** The node the static zones are placed relative to (the enemy container). */
  root: THREE.Object3D;
  zones: HurtZone[];
}

// ── Derivation ──────────────────────────────────────────────────────────────

/** Build a sensible default hurtbox from the enemy's spec + built model:
 *  always a body capsule; a head sphere when the model exposes a `head` part.
 *  A spec can later override/extend (a boss authoring its `core`). The numbers
 *  are world-scale metres (aimHeight is already × scale), so they don't apply
 *  the model group's scale again. Heuristic — tuned by eye on-device; the
 *  resolver reads exactly these volumes, so what you see in debug is the truth. */
export function deriveHurtbox(spec: EnemySpec, built: BuiltModel, aimHeight: number): Hurtbox {
  const bodyRadius = Math.max(spec.hitRadius ?? 0, spec.collisionRadius, 0.16);
  // Body capsule spans roughly knees → shoulders, centred on aimHeight. Authored
  // generously tall so a swing that reads as "on the body" connects vertically.
  const bottom = Math.max(0.08, aimHeight * 0.35);
  const top = aimHeight * 1.45;
  const zones: HurtZone[] = [
    {
      id: 'body',
      shape: { kind: 'capsule', a: new THREE.Vector3(0, bottom, 0), b: new THREE.Vector3(0, top, 0), radius: bodyRadius },
      role: 'body',
      damageMul: 1,
      enabled: true,
      priority: 0,
      crit: false,
      follow: null,
      openWhenStaggered: false,
    },
  ];

  // Head sphere — follows the model's `head` part when present, so it tracks the
  // head-crane/telegraph animation. Radius is a heuristic fraction of the body;
  // bosses/specials can override. Locational bonus + crit.
  const headNode = built.parts.get('head') ?? built.slots.get('head') ?? null;
  if (headNode) {
    zones.push({
      id: 'head',
      shape: { kind: 'sphere', center: new THREE.Vector3(0, 0, 0), radius: Math.max(0.14, bodyRadius * 0.85) },
      role: 'head',
      damageMul: 1.5,
      enabled: true,
      priority: 10,
      crit: true,
      follow: headNode,
      openWhenStaggered: false,
    });
  }

  return { root: built.group.parent ?? built.group, zones };
}

// ── Authoring surface — spec-declared zones (content layer) ───────────────────
// A spec adds/overrides zones declaratively (weak points, armor plates) without
// touching the resolver. Coords are local metres (relative to `follow` if named,
// else the enemy root). See docs/COMBAT-HIT-SYSTEM.md.

export interface HurtZoneSpec {
  id: string;
  shape:
    | { kind: 'capsule'; a: [number, number, number]; b: [number, number, number]; radius: number }
    | { kind: 'sphere'; center: [number, number, number]; radius: number };
  /** Default 'weak'. */
  role?: ZoneRole;
  /** Default by role: weak 2, armor 0.25, head 1.5, body 1. */
  damageMul?: number;
  /** Default true, unless openWhenStaggered (then starts disabled). */
  enabled?: boolean;
  /** Default by role: weak 20, armor 5, head 10, body 0. Highest wins. */
  priority?: number;
  /** Default true for weak/head. */
  crit?: boolean;
  /** Part/slot name to track (the zone rides that animated bone). */
  follow?: string;
  /** Enable only while the enemy is staggered (an exposed window). */
  openWhenStaggered?: boolean;
}

const ROLE_DEFAULT_MUL: Record<ZoneRole, number> = { body: 1, head: 1.5, weak: 2, armor: 0.25 };
const ROLE_DEFAULT_PRIORITY: Record<ZoneRole, number> = { body: 0, head: 10, weak: 20, armor: 5 };

/** Merge spec-declared zones into a derived hurtbox: same id replaces, new id
 *  appends. Resolves `follow` part names against the built model. */
export function applyZoneSpecs(hb: Hurtbox, specs: HurtZoneSpec[] | undefined, built: BuiltModel): void {
  if (!specs) return;
  for (const sp of specs) {
    const role = sp.role ?? 'weak';
    const shape: ZoneShape = sp.shape.kind === 'capsule'
      ? { kind: 'capsule', a: new THREE.Vector3(...sp.shape.a), b: new THREE.Vector3(...sp.shape.b), radius: sp.shape.radius }
      : { kind: 'sphere', center: new THREE.Vector3(...sp.shape.center), radius: sp.shape.radius };
    const follow = sp.follow ? (built.parts.get(sp.follow) ?? built.slots.get(sp.follow) ?? null) : null;
    const open = sp.openWhenStaggered ?? false;
    const zone: HurtZone = {
      id: sp.id,
      shape,
      role,
      damageMul: sp.damageMul ?? ROLE_DEFAULT_MUL[role],
      enabled: sp.enabled ?? !open,
      priority: sp.priority ?? ROLE_DEFAULT_PRIORITY[role],
      crit: sp.crit ?? (role === 'weak' || role === 'head'),
      follow,
      openWhenStaggered: open,
    };
    const idx = hb.zones.findIndex((z) => z.id === sp.id);
    if (idx >= 0) hb.zones[idx] = zone; else hb.zones.push(zone);
  }
}

// ── World-space resolution ────────────────────────────────────────────────────

const _m = new THREE.Vector3();

/** Resolve a zone's capsule endpoints into world space. The transform node is
 *  the followed bone if set, else the hurtbox root. Caller passes the root so a
 *  static zone places correctly. Returns the world radius. */
export function worldCapsule(zone: HurtZone, root: THREE.Object3D, outA: THREE.Vector3, outB: THREE.Vector3): number {
  if (zone.shape.kind !== 'capsule') { outA.set(0, 0, 0); outB.set(0, 0, 0); return 0; }
  const node = zone.follow ?? root;
  node.updateWorldMatrix(true, false);
  outA.copy(zone.shape.a); node.localToWorld(outA);
  outB.copy(zone.shape.b); node.localToWorld(outB);
  return zone.shape.radius;
}

/** Resolve a zone's sphere centre into world space; returns the world radius. */
export function worldSphere(zone: HurtZone, root: THREE.Object3D, outCenter: THREE.Vector3): number {
  if (zone.shape.kind !== 'sphere') { outCenter.set(0, 0, 0); return 0; }
  const node = zone.follow ?? root;
  node.updateWorldMatrix(true, false);
  outCenter.copy(zone.shape.center); node.localToWorld(outCenter);
  return zone.shape.radius;
}

// ── Geometric tests (pure; consumed by the resolver) ──────────────────────────

const _seg = new THREE.Vector3();

/** Distance² from point p to segment a→b. */
export function pointSegDistSq(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  _seg.set(bx - ax, by - ay, bz - az);
  const len2 = _seg.lengthSq() || 1e-6;
  let t = ((px - ax) * _seg.x + (py - ay) * _seg.y + (pz - az) * _seg.z) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + _seg.x * t, cy = ay + _seg.y * t, cz = az + _seg.z * t;
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  return dx * dx + dy * dy + dz * dz;
}

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Closest distance² between segment p1→q1 and segment p2→q2 (the capsule-vs-
 *  capsule core). Standard clamped-parametric solve (Ericson, Real-Time
 *  Collision Detection). */
export function segSegDistSq(
  p1: THREE.Vector3, q1: THREE.Vector3,
  p2: THREE.Vector3, q2: THREE.Vector3,
): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s: number, t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    return _r.lengthSq();
  }
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1x = p1.x + _d1.x * s, c1y = p1.y + _d1.y * s, c1z = p1.z + _d1.z * s;
  const c2x = p2.x + _d2.x * t, c2y = p2.y + _d2.y * t, c2z = p2.z + _d2.z * t;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  return dx * dx + dy * dy + dz * dz;
}

const _za = new THREE.Vector3();
const _zb = new THREE.Vector3();
const _zc = new THREE.Vector3();

export interface ZoneHit {
  zone: HurtZone;
  damageMul: number;
  crit: boolean;
}

/** Test a weapon capsule (segA→segB, radius wr) against a hurtbox's ENABLED
 *  zones. Returns the highest-priority overlapping zone (the resolver's verdict
 *  for this enemy), or null if the weapon volume missed every zone. Pure — does
 *  not apply damage. */
export function queryHurtbox(hb: Hurtbox, segA: THREE.Vector3, segB: THREE.Vector3, wr: number): ZoneHit | null {
  let best: HurtZone | null = null;
  for (const z of hb.zones) {
    if (!z.enabled) continue;
    let overlap = false;
    if (z.shape.kind === 'capsule') {
      const r = worldCapsule(z, hb.root, _za, _zb);
      const sum = r + wr;
      overlap = segSegDistSq(segA, segB, _za, _zb) <= sum * sum;
    } else {
      const r = worldSphere(z, hb.root, _zc);
      const sum = r + wr;
      overlap = pointSegDistSq(_zc.x, _zc.y, _zc.z, segA.x, segA.y, segA.z, segB.x, segB.y, segB.z) <= sum * sum;
    }
    if (!overlap) continue;
    if (!best || z.priority > best.priority) best = z;
  }
  if (!best) return null;
  return { zone: best, damageMul: best.damageMul, crit: best.crit };
}

// ── Swept-resolution path (the resolver's hot loop) ──────────────────────────
// queryHurtbox resolves a zone's world transform on every call — fine for a
// single segment, wasteful when a swing tests N swept samples against the same
// enemy. resolveWorldZones() snapshots an enemy's ENABLED zones to world ONCE
// per strike-frame; testSegmentZones() then tests each weapon sample against
// that snapshot with zero matrix work.

export interface WorldZone {
  zone: HurtZone;
  isCapsule: boolean;
  a: THREE.Vector3;   // capsule end A, or sphere centre
  b: THREE.Vector3;   // capsule end B (unused for sphere)
  radius: number;
}

/** Snapshot a hurtbox's ENABLED zones into world space. Reuses the `out` array's
 *  entries (pooled Vector3s) so it allocates nothing after warmup. Returns the
 *  number of live zones written. */
export function resolveWorldZones(hb: Hurtbox, out: WorldZone[]): number {
  let n = 0;
  for (const z of hb.zones) {
    if (!z.enabled) continue;
    let w = out[n];
    if (!w) { w = out[n] = { zone: z, isCapsule: true, a: new THREE.Vector3(), b: new THREE.Vector3(), radius: 0 }; }
    w.zone = z;
    if (z.shape.kind === 'capsule') {
      w.isCapsule = true;
      w.radius = worldCapsule(z, hb.root, w.a, w.b);
    } else {
      w.isCapsule = false;
      w.radius = worldSphere(z, hb.root, w.a);
    }
    n++;
  }
  return n;
}

/** Test one weapon capsule (segA→segB, radius wr) against a resolved world-zone
 *  snapshot. Returns the highest-priority overlapping zone, or null. */
export function testSegmentZones(world: WorldZone[], count: number, segA: THREE.Vector3, segB: THREE.Vector3, wr: number): ZoneHit | null {
  let best: WorldZone | null = null;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const w = world[i];
    const sum = w.radius + wr;
    const d2 = w.isCapsule
      ? segSegDistSq(segA, segB, w.a, w.b)
      : pointSegDistSq(w.a.x, w.a.y, w.a.z, segA.x, segA.y, segA.z, segB.x, segB.y, segB.z);
    if (d2 > sum * sum) continue;
    if (!best || w.zone.priority > best.zone.priority || (w.zone.priority === best.zone.priority && d2 < bestD)) {
      best = w;
      bestD = d2;
    }
  }
  if (!best) return null;
  return { zone: best.zone, damageMul: best.zone.damageMul, crit: best.zone.crit };
}

/** Flip a zone on/off by id. Returns true if a zone matched. */
export function setZoneEnabled(hb: Hurtbox, id: string, on: boolean): boolean {
  let found = false;
  for (const z of hb.zones) if (z.id === id) { z.enabled = on; found = true; }
  return found;
}
