// How an enemy moves and faces.
//
// moveTowards is the one locomotion verb every state uses: it beelines when
// the line is clear, follows a cached A* route (refreshed every PATH_REFRESH s)
// when it isn't or when the beeline would graze a framed opening, sidesteps
// when pinned against geometry, ticks footsteps by distance actually covered,
// and stands on the ground under its feet. Facing: snap-chase toward a target
// (faceTarget), face the direction of travel (faceMovement), plus the arc and
// reach checks abilities and the parry read. Feints live here because they are
// pure position pulses.
//
// A subsystem of createEnemy over EnemyCtx (mobs/enemy-ctx.ts).

import { playEnemyFootstep } from '../audio/sfx';
import { withinForwardArc } from '../combat/attack-arc';
import { CONFIG } from '../config';
import { type Ability } from '../content/abilities';
import { getCameraYaw } from '../controls/camera';
import { gameRng } from '../engine/rng';
import { groundYAt } from '../level/elevation';
import { type NavGrid } from '../level/nav-grid';
import { type WalkableRegion } from '../level/walkable';
import type { EnemyCtx } from './enemy-ctx';

/** clampMoveInto scratch (synchronous use only). */
const tmpClampFwd = { x: 0, z: 0 };
import * as THREE from 'three';

const NAV_STUCK_TIME = CONFIG.ENEMY_AI.NAV_STUCK_TIME;

const tmpClampLeft = { x: 0, z: 0 };

const tmpClampRight = { x: 0, z: 0 };

const PATH_REFRESH = 0.5;

const WAYPOINT_REACHED_SQ = 0.35 * 0.35;

export function moveTowards(
  self: EnemyCtx,
  targetX: number, targetZ: number, speed: number, dt: number,
  walkable: WalkableRegion, nav?: NavGrid,
) {
  let mx = targetX;
  let mz = targetZ;
  if (!self.spec.phasing && nav) {
    // includeObstacles: pillars + altars + fountains BLOCK movement
    // even though they don't block perception. Without this the mob
    // sees clear LOS through a pillar, beelines, and clampMove pins
    // it against the pillar's edge.
    // A clean line to the target isn't enough near a framed opening:
    // the beeline aims at the TARGET, not the gap centre, so it can
    // graze an archway column and pin the mob there. Demote to pathing
    // whenever the straight route passes a gate too close to its
    // blockers — the path's funnel pass aims the centre instead.
    const directLOS = walkable.hasLineOfSight(
      self.container.position.x, self.container.position.z, targetX, targetZ,
      { includeObstacles: true },
    ) && !nav.directRouteGrazesGate(
      self.container.position.x, self.container.position.z, targetX, targetZ,
      self.spec.collisionRadius,
    );
    if (!directLOS) {
      // Invalidate the cached path if the target drifted significantly
      // from where we last planned to (player moved across the room).
      if (self.loco.path.length > 0) {
        const last = self.loco.path[self.loco.path.length - 1];
        const tdx = targetX - last.x;
        const tdz = targetZ - last.z;
        if (tdx * tdx + tdz * tdz > 2.25) {
          self.loco.path.length = 0;
          self.loco.pathTime = 0;
        }
      }
      self.loco.pathTime += dt;
      if (self.loco.pathTime >= PATH_REFRESH || self.loco.path.length === 0) {
        // Radius-aware: a wide body (collisionRadius past the grid's
        // full-clearance tier) treats narrow-doorway cells as walls
        // instead of wedging into a gap it can't physically fit.
        self.loco.path = nav.findPath(self.container.position.x, self.container.position.z, targetX, targetZ,
          { radius: self.spec.collisionRadius });
        self.loco.pathTime = 0;
      }
      // Walk the waypoint queue, popping any we've already reached.
      while (self.loco.path.length > 0) {
        const wp = self.loco.path[0];
        const dwx = wp.x - self.container.position.x;
        const dwz = wp.z - self.container.position.z;
        if (dwx * dwx + dwz * dwz < WAYPOINT_REACHED_SQ) {
          self.loco.path.shift();
        } else {
          mx = wp.x;
          mz = wp.z;
          break;
        }
      }
    } else {
      // We can see the target — drop any stale path so we beeline.
      self.loco.pathTime = 0;
      self.loco.path.length = 0;
    }
  }

  const dx = mx - self.container.position.x;
  const dz = mz - self.container.position.z;
  const distSq = dx * dx + dz * dz;
  if (distSq < 1e-6) return;
  const dist = Math.sqrt(distSq);
  const inv = 1 / dist;
  // Don't OVERSHOOT the target — clamp the step to the remaining distance so a
  // mob that has essentially arrived doesn't lurch past its slot and lurch back
  // next frame (an overshoot oscillation that reads as jitter, worst when
  // holding a ring slot at close range).
  const step = Math.min(speed * dt, dist);
  const clampOpts = self.spec.phasing ? { ignoreObstacles: true } : undefined;
  const cx = self.container.position.x, cz = self.container.position.z;
  let resolved = walkable.clampMoveInto(tmpClampFwd, cx, cz, cx + dx * inv * step, cz + dz * inv * step, self.spec.collisionRadius, clampOpts);

  // Stuck → sidestep. If the forward move was almost fully blocked by geometry
  // (a prop corner, a wall), accumulate stuck time; once pinned, try sliding
  // PERPENDICULAR to the target — both sides, take whichever makes progress —
  // so the mob flows AROUND the obstacle instead of grinding into its face
  // ("tries to go around but can't"). Cheap: the two extra clamps only run
  // while genuinely pinned.
  const fwdMoved = Math.hypot(resolved.x - cx, resolved.z - cz);
  if (fwdMoved < step * 0.3) {
    self.loco.stuckT += dt;
    if (self.loco.stuckT > NAV_STUCK_TIME) {
      const px = -dz * inv, pz = dx * inv;   // unit perpendicular to the target dir
      const left = walkable.clampMoveInto(tmpClampLeft, cx, cz, cx + px * step, cz + pz * step, self.spec.collisionRadius, clampOpts);
      const right = walkable.clampMoveInto(tmpClampRight, cx, cz, cx - px * step, cz - pz * step, self.spec.collisionRadius, clampOpts);
      const lMov = Math.hypot(left.x - cx, left.z - cz);
      const rMov = Math.hypot(right.x - cx, right.z - cz);
      const best = lMov >= rMov ? left : right;
      if (Math.max(lMov, rMov) > step * 0.3) resolved = best;   // a side is open — slide
    }
  } else {
    self.loco.stuckT = 0;
  }
  // Footstep foley — accumulate the distance ACTUALLY moved (post-clamp, so
  // a mob pinned against a wall goes silent) and tick a locomotion sound
  // every stride. Stride scales with body size so a stoneguard plods and a
  // rat patters. Spectral mobs (wraiths) drift in silence — they don't walk.
  if (self.vocalArch && self.spec.presence !== 'spectral') {
    const mdx = resolved.x - self.container.position.x;
    const mdz = resolved.z - self.container.position.z;
    self.audio.strideAccum += Math.sqrt(mdx * mdx + mdz * mdz);
    const stride = 0.42 + self.spec.collisionRadius * 0.9;
    if (self.audio.strideAccum >= stride) {
      self.audio.strideAccum = 0;
      playEnemyFootstep(self.vocalArch, self.container.position);
    }
  }
  self.container.position.x = resolved.x;
  self.container.position.z = resolved.z;
  // Stand on the ground under our feet — 0 on flat floors; follows
  // room plateaus + corridor ramps on floors with elevation.
  self.container.position.y = groundYAt(resolved.x, resolved.z);
}

/** Is `target` inside this mob's forward attack wedge?
 *
 *  THE FAIRNESS GATE. Enemy melee used to be a pure distance test, so a mob
 *  could hit you while you stood behind it — and because facing is LOCKED
 *  through strike + recover, that's exactly the moment you'd have dodged
 *  around it. The aim-lock has always promised "circle out of the arc to whiff
 *  it" (see faceTarget); this is that arc.
 *
 *  Three callers must agree on it or the game lies: the melee action (does it
 *  hit), the threat flash (does it warn), and the immediate parry (can you
 *  turn it). If the flash used a wider test than the damage, we'd warn about
 *  attacks that can't land; if it used a narrower one, we'd hit you without
 *  warning. Same function, all three. */
export function withinArc(self: EnemyCtx, target: THREE.Vector3, halfAngle?: number): boolean {
  return withinForwardArc(
    self.container.position.x, self.container.position.z, self.container.rotation.y,
    target.x, target.z,
    halfAngle ?? CONFIG.ENEMY_AI.MELEE_ARC_HALF,
  );
}

/** The arc of the ability's opening melee, for the flash + parry gates. null
 *  when the ability doesn't open on a melee (a dash body-checks you from any
 *  angle; an aoe/blast is radial by nature — neither gets an arc). */
export function meleeArcOf(self: EnemyCtx, ability: Ability): number | null {
  const a = ability.steps[0]?.action;
  return a && a.kind === 'melee' ? (a.arc ?? CONFIG.ENEMY_AI.MELEE_ARC_HALF) : null;
}

export function distToXZ(self: EnemyCtx, target: THREE.Vector3): number {
  const dx = self.container.position.x - target.x;
  const dz = self.container.position.z - target.z;
  return Math.hypot(dx, dz);
}

export function faceTarget(self: EnemyCtx, target: THREE.Vector3, dt: number) {
  self.loco.dbgFaceX = target.x; self.loco.dbgFaceZ = target.z;   // DEV gizmo: what it's TRYING to face this frame
  const dx = target.x - self.container.position.x;
  const dz = target.z - self.container.position.z;
  if (dx * dx + dz * dz < 1e-8) return;
  // Committed to a swing → LOCK facing entirely (the strike goes where it
  // aimed; circle out of the arc to whiff it).
  if (self.fsm.state === 'striking' || self.fsm.state === 'recovering') return;

  // THE moonwalk fix: force a clean PURE-YAW orientation. lookAt (used by
  // spawn faceWorld + kiter steering) represents a "-Z toward a target in the
  // -Z hemisphere" as rotation.x = rotation.z = ±π — a FLIP. Writing only
  // rotation.y (the atan2 facing) left that stale flip in place, inverting the
  // model so it faced away and walked in backwards. Zeroing x/z each frame
  // kills the flip; -Z then faces the target by yaw alone (atan2 + π).
  self.container.rotation.x = 0;
  self.container.rotation.z = 0;
  const desiredY = Math.atan2(dx, dz) + Math.PI;

  // Turn toward it at a CAPPED rate so facing has weight (your turn-rate ask).
  //   • WINDING: AIM ramp — fast onto you at the start (a swing never launches
  //     facing wrong), easing to 0 by commit so a LATE juke slips the aim.
  //   • CHASING / alerted / searching: the steady TURN_RATE — tracks a
  //     circling player smoothly, converging to the correct toward-you heading.
  let rate: number;
  if (self.fsm.state === 'winding') {
    const prog = self.combat.currentWindupTime > 0 ? Math.min(1, self.fsm.phaseTimer / self.combat.currentWindupTime) : 1;
    rate = CONFIG.ENEMY_AI.WINDUP_AIM_RATE * (1 - prog);
  } else {
    rate = CONFIG.ENEMY_AI.TURN_RATE;
  }
  const diff = Math.atan2(Math.sin(desiredY - self.container.rotation.y), Math.cos(desiredY - self.container.rotation.y));
  const maxStep = rate * dt;
  self.container.rotation.y += Math.max(-maxStep, Math.min(maxStep, diff));
}

export function faceMovement(self: EnemyCtx, dispX: number, dispZ: number, playerPos: THREE.Vector3, dt: number) {
  if (dt > 0) {
    const a = 1 - Math.exp(-dt / 0.12);   // ~0.12s heading smoothing
    self.loco.smoothVelX += (dispX / dt - self.loco.smoothVelX) * a;
    self.loco.smoothVelZ += (dispZ / dt - self.loco.smoothVelZ) * a;
  }
  const speed = Math.hypot(self.loco.smoothVelX, self.loco.smoothVelZ);
  // Smooth BLEND between "face the player" (stationary) and "face travel"
  // (moving) — a hard speed threshold would flip-flop the facing frame to frame
  // right at the cutoff (jitter). w ramps 0→1 across a band around FACE_MOVE_MIN.
  const lo = CONFIG.ENEMY_AI.FACE_MOVE_MIN * 0.55;
  const hi = CONFIG.ENEMY_AI.FACE_MOVE_MIN * 1.7;
  const w = Math.max(0, Math.min(1, (speed - lo) / (hi - lo)));
  if (w <= 0) { faceTarget(self, playerPos, dt); return; }
  let px = playerPos.x - self.container.position.x, pz = playerPos.z - self.container.position.z;
  const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
  const vx = self.loco.smoothVelX / (speed || 1), vz = self.loco.smoothVelZ / (speed || 1);
  self._faceMove.set(
    self.container.position.x + px * (1 - w) + vx * w,
    0,
    self.container.position.z + pz * (1 - w) + vz * w,
  );
  faceTarget(self, self._faceMove, dt);
}

// Telegraph-the-wait: a holding mob periodically FEINTS — darts in toward the
// player, then snaps back — so it reads as a coiled predator circling for an
// opening instead of a frozen satellite waiting its turn. Pure position pulse;
// it squares up to the player throughout (a menacing fake-out). Returns true
// while a feint is actively driving movement (so the caller skips its hold).
export function tickFeint(self: EnemyCtx, dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion, nav?: NavGrid): boolean {
  const F = CONFIG.ENEMY_AI.INTENT;
  if (self.intent.feintT < 0) {
    self.intent.feintCd -= dt;
    if (self.intent.feintCd > 0) return false;
    self.intent.feintT = 0;   // start a feint
  }
  self.intent.feintT += dt;
  if (self.intent.feintT <= F.FEINT_IN) {
    moveTowards(self, playerPos.x, playerPos.z, F.FEINT_SPEED, dt, walkable, nav);   // dart IN
  } else if (self.intent.feintT <= F.FEINT_IN + F.FEINT_OUT) {
    const dx = self.container.position.x - playerPos.x, dz = self.container.position.z - playerPos.z;
    const l = Math.hypot(dx, dz) || 1;
    moveTowards(self, self.container.position.x + (dx / l) * 1.5, self.container.position.z + (dz / l) * 1.5,
                F.FEINT_SPEED * 0.85, dt, walkable, nav);   // snap BACK
  } else {
    self.intent.feintT = -1;   // done — arm the next one
    self.intent.feintCd = F.FEINT_MIN + gameRng() * F.FEINT_JITTER;
    return false;
  }
  faceTarget(self, playerPos, dt);   // square up to the player through the whole fake-out
  return true;
}

/** Is the player looking roughly AT this enemy? A parry only catches a strike
 *  from in front of you (CONFIG.DEFLECT.FACING_DOT cone) — you can't deflect a
 *  blow you aren't facing. Uses the camera yaw (player forward) vs the
 *  direction to this mob. */
export function playerFacingThis(self: EnemyCtx, playerPos: THREE.Vector3): boolean {
  const yaw = getCameraYaw();
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // camera forward XZ (looks down -Z)
  let ex = self.container.position.x - playerPos.x;
  let ez = self.container.position.z - playerPos.z;
  const len = Math.hypot(ex, ez);
  if (len < 1e-4) return true;
  ex /= len; ez /= len;
  return fx * ex + fz * ez >= CONFIG.DEFLECT.FACING_DOT;
}

export function applyTilt(self: EnemyCtx, angle: number) {
  if (self.tiltPart) self.tiltPart.rotation.x = angle;
}

/** Face a world XZ (head toward it), PURE YAW — see faceTarget. Sets x/z to 0
 *  so no stale lookAt ±π flip can invert the model. */
export function faceXZ(self: EnemyCtx, x: number, z: number) {
  self.container.rotation.x = 0;
  self.container.rotation.z = 0;
  self.container.rotation.y = Math.atan2(x - self.container.position.x, z - self.container.position.z) + Math.PI;
}
