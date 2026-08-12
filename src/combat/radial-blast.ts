import * as THREE from 'three';
import type { EntityId } from '../ecs/types';
import type { DamageType } from './damage';
import { damagePlayer } from '../player/health';
import { applyPlayerKnockback } from '../player/knockback';
import { kickShake } from './screen-shake';
import { spawnShatterBurst } from '../effects/shatter-burst';
import { spawnDustPuff } from '../effects/dust-puff';
import { playBlast } from '../audio/sfx';
import { blastDamageScale } from './blast-falloff';

// ONE explosion primitive — a point, a radius, and everything inside it takes
// it. Before this there were three copies of the same loop, each blind to half
// the world: the `aoe` ability action damaged the PLAYER only (mobs/enemy.ts),
// the rite nova damaged MOBS only (rites.ts), and the bleed chain re-walked the
// list a third time to apply a status. Nothing in the game could simply "go off"
// and hurt whatever was standing there.
//
// That blindness isn't a tidiness problem, it's a design one. A bomb that only
// hurts the player is a hazard; a bomb that hurts EVERYONE is a tactical object
// you can drag into a pack. The second is worth building enemies around, and it
// only exists if the primitive treats both sides the same way.
//
// FALLOFF IS ON BY DEFAULT. A flat-damage radius punishes the edge of the circle
// exactly as hard as the centre, so there's nothing to play against — you're
// either in or out, and "in" is unsurvivable. With falloff, clipping the rim is
// a survivable mistake and diving the centre is the real one. (This is also the
// standing complaint in PLAYTEST-FEEDBACK §A: "AoE hits everything — needs a cap
// / falloff".)

/** A blast-damageable mob. The Enemy shape subset this needs — same trick as
 *  `EnemyHittable` in projectile-pool, so this module doesn't drag in the whole
 *  Enemy type (and its Three.js graph) for a distance test. */
export interface BlastTarget {
  entityId: EntityId;
  position: THREE.Vector3;
  alive: boolean;
  takeDamage(event: {
    source: EntityId | null; target: EntityId; base: number; type: DamageType;
  }): unknown;
  applyKnockback(dx: number, dz: number, speed: number): void;
}

// Set once at level build (main.ts), same as setProjectileEnemyProvider — so a
// blast fired from deep inside a mob's ability timeline can still see the rest
// of the room without every call site threading the enemy list through.
let targetProvider: (() => readonly BlastTarget[]) | null = null;
export function setBlastTargetProvider(fn: (() => readonly BlastTarget[]) | null): void {
  targetProvider = fn;
}

export interface BlastOpts {
  x: number; y: number; z: number;
  radius: number;
  /** Where the player is. Passed in rather than imported: every caller already
   *  holds it, and a blast that silently misses the player because a global got
   *  stale is the worst possible failure for this system. Omit for a blast that
   *  should only threaten mobs. */
  playerPos?: { x: number; z: number };
  /** Damage at the CENTRE. Scaled down toward the rim unless falloff is 0. */
  damage: number;
  /** Centre damage dealt to mobs. Defaults to `damage`. Split them when a
   *  blast should threaten the player without trivially clearing a room. */
  mobDamage?: number;
  type?: DamageType;
  /** Kill credit + aggro. null = environmental (a trap, a barrel). */
  source: EntityId | null;
  /** Never damage this entity — the mob that just detonated itself. Without
   *  it a self-destruct re-enters its own `takeDamage` mid-death. */
  exclude?: EntityId;
  /** Damage retained AT THE RIM, 0..1. 1 = flat (no falloff). Default 0.45. */
  rimDamageFrac?: number;
  /** Shove speed at the centre, scaled by the same falloff. 0 = no shove. */
  knockbackSpeed?: number;
  /** Debris tint. */
  color?: number;
  shake?: number;
  /** Skip the VFX/audio — for a blast that already has its own presentation. */
  silent?: boolean;
}

/** Resolve a blast: damage the player and every mob in radius, shove them,
 *  and play the pop. Returns how many mobs were caught (callers use it for
 *  broadcast lines / achievements). */
export function radialBlast(scene: THREE.Object3D, opts: BlastOpts): number {
  const {
    x, y, z, radius, damage, source, playerPos,
    mobDamage = damage,
    type = 'physical',
    rimDamageFrac = 0.45,
    knockbackSpeed = 0,
    color = 0x7a1c1c,
    shake = 0.5,
    silent = false,
  } = opts;

  const r2 = radius * radius;
  const scaleAt = (d: number) => blastDamageScale(d, radius, rimDamageFrac);

  if (!silent) {
    kickShake(shake, 0.45);
    playBlast({ x, y, z });
    spawnShatterBurst(scene, x, y + 0.25, z, false, color);
    spawnDustPuff(scene, x, y + 0.2, z, {
      count: 12, spread: radius * 0.5, size: radius * 0.42, rise: 1.6, life: 0.85,
    });
  }

  // --- The player ---
  // Measured in XZ like every other reach check in the game (mobs and the
  // player are never meaningfully separated in Y during a fight).
  if (playerPos) {
    const pdx = playerPos.x - x;
    const pdz = playerPos.z - z;
    const pd2 = pdx * pdx + pdz * pdz;
    if (pd2 <= r2) {
      const d = Math.sqrt(pd2);
      damagePlayer(Math.max(1, Math.round(damage * scaleAt(d))), source ?? undefined, type);
      if (knockbackSpeed > 0) applyPlayerKnockback(pdx, pdz, knockbackSpeed * scaleAt(d));
    }
  }

  // --- Everything else in the room ---
  let caught = 0;
  for (const t of targetProvider?.() ?? []) {
    if (!t.alive || t.entityId === opts.exclude) continue;
    const dx = t.position.x - x;
    const dz = t.position.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2);
    const s = scaleAt(d);
    t.takeDamage({
      source, target: t.entityId, base: Math.max(1, Math.round(mobDamage * s)), type,
    });
    if (knockbackSpeed > 0 && d > 1e-4) {
      t.applyKnockback(dx / d, dz / d, knockbackSpeed * s);
    }
    caught++;
  }
  return caught;
}
