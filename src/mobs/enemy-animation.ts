import * as THREE from 'three';
import { CONFIG } from '../config';
import type { BuiltModel } from '../ecs/build-model';
import type { EnemySpec } from '../content/enemies';
import type { WalkableRegion } from '../level/walkable';

// Enemy body-animation overlays, extracted from enemy.ts into one controller
// the factory builds once and the update loop drives AFTER the per-state
// animation. Owns its own mutable gait/head/knockback/presence state + the
// body refs (hips, neck, the chant orb), so the createEnemy closure no longer
// carries it.
//
// All four ticks write the body transform (container position/yaw, built.group
// position.y/roll). They ADD to position.y on top of what the state code set,
// so the call ORDER in update() is load-bearing — keep them invoked in the
// same sequence (head, knockback, locomotion, presence).

export interface BodyAnimator {
  /** Set a decaying recoil impulse (charge contact, future stagger). */
  applyKnockback(dirX: number, dirZ: number, speed: number): void;
  /** Snap a parry-recoil pose: the body pitches back hard then eases out over
   *  `dur`. `mag` is the peak backward lean in radians. A brief shudder rides the
   *  decay so the parry reads as a violent jolt, not a slow bow. */
  flinch(mag: number, dur?: number): void;
  /** The LIGHT rung of the hit ladder: a quick, small recoil so every solid hit
   *  visibly registers on the creature ("it felt that"). A short flinch. */
  twitch(): void;
  /** Tip the head toward the player when `aware` (pitch), and — DOOM-style focus
   *  tracking — twist it in YAW toward the player so it keeps watching you while
   *  the body's root faces its movement. `yawToPlayer` = signed angle from the
   *  root's facing to the player (radians). */
  tickHeadCrane(dt: number, distance: number, aware: boolean, yawToPlayer?: number): void;
  /** Integrate + decay the recoil impulse, clamped against walls. */
  tickKnockback(dt: number, walkable: WalkableRegion): void;
  /** Play the parry-recoil pitch overlay while it's active (owns rotation.x). */
  tickFlinch(dt: number): void;
  /** Swing legs from actual movement (gait) + a footfall bob. */
  tickLocomotion(dt: number): void;
  /** Continuous "alive" idle overlay (per spec.presence). */
  tickPresence(dt: number): void;
}

export function createBodyAnimator(
  container: THREE.Group,
  built: BuiltModel,
  spec: EnemySpec,
): BodyAnimator {
  const hipL = built.slots.get('hipL');
  const hipR = built.slots.get('hipR');
  const hipBaseLX = hipL ? hipL.rotation.x : 0;
  const hipBaseRX = hipR ? hipR.rotation.x : 0;
  const neck = built.slots.get('neck');
  const neckBaseX = neck ? neck.rotation.x : 0;
  const neckBaseY = neck ? neck.rotation.y : 0;
  // Quadruped legs (trot gait). Present only on quadruped creatures; the gait
  // swings diagonal pairs. Base rotations captured so we offset, not overwrite.
  const frontL = built.slots.get('frontL');
  const frontR = built.slots.get('frontR');
  const hindL = built.slots.get('hindL');
  const hindR = built.slots.get('hindR');
  const fLB = frontL ? frontL.rotation.x : 0;
  const fRB = frontR ? frontR.rotation.x : 0;
  const hLB = hindL ? hindL.rotation.x : 0;
  const hRB = hindR ? hindR.rotation.x : 0;
  // Flier wings (pit-moth). A moth beats its wings CONTINUOUSLY — even
  // hovering — so the flap is time-based (not stride-gated like the gait). Roll
  // the wing joints about local Z (the body's fore-aft axis), mirrored L/R so
  // both tips rise together; hind pair a touch shallower. Base rots are ~0 (the
  // skin carries the spread), captured so we offset rather than overwrite.
  const wingL = built.slots.get('wingL');
  const wingR = built.slots.get('wingR');
  const wingL2 = built.slots.get('wingL2');
  const wingR2 = built.slots.get('wingR2');
  const hasWings = !!(wingL || wingR || wingL2 || wingR2);
  const wLz = wingL ? wingL.rotation.z : 0;
  const wRz = wingR ? wingR.rotation.z : 0;
  const wL2z = wingL2 ? wingL2.rotation.z : 0;
  const wR2z = wingR2 ? wingR2.rotation.z : 0;

  // Presence — continuous overlay applied each frame on top of the per-state
  // animation. Per-instance phase so two of the same mob drift out of sync.
  const presence = spec.presence;
  const presencePhase = Math.random() * Math.PI * 2;
  // 'chant' drives the orb material's emissive pulse; null for non-chant.
  const orbMat = presence === 'chant'
    ? (built.materials.get('orb') as THREE.MeshStandardMaterial | undefined)
    : undefined;
  const orbBaseEmissive = orbMat?.emissiveIntensity ?? 0;

  const STRIDE_LENGTH = 0.7;   // metres per full leg cycle
  const GAIT_SWING = 0.5;      // peak hip rotation (rad) at full gait

  let headPitch = 0;
  let headYaw = 0;
  // Locomotion lean (forward pitch + bank roll) on the container, eased.
  let leanPitch = 0, leanRoll = 0, prevHeading = 0, hasHeading = false;
  let knockVX = 0;
  let knockVZ = 0;
  let prevX = container.position.x;
  let prevZ = container.position.z;
  let stridePhase = Math.random() * Math.PI * 2;   // desync mobs
  let gaitAmp = 0;
  let presenceTime = 0;
  let flapTime = Math.random() * Math.PI * 2;      // desync a swarm's wingbeats

  // Parry-recoil pitch overlay. flinchT counts DOWN from FLINCH_DUR; while > 0
  // tickFlinch owns built.group.rotation.x (a transient — a parried mob isn't
  // mid phase-fall, the only other writer of that axis).
  const FLINCH_DUR = 0.34;
  let flinchT = 0;
  let flinchMag = 0;
  let flinchDur = FLINCH_DUR;   // the duration of the CURRENT flinch/twitch (twitch is shorter)

  function applyKnockback(dirX: number, dirZ: number, speed: number) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-5) return;
    knockVX = (dirX / len) * speed;
    knockVZ = (dirZ / len) * speed;
  }

  function flinch(mag: number, dur: number = FLINCH_DUR) {
    flinchT = dur;
    flinchMag = mag;
    flinchDur = dur;
  }

  // The light rung: a quick, small backward recoil so a solid hit reads on the
  // creature. Just a short, shallow flinch — reuses the same overlay.
  function twitch() {
    flinch(CONFIG.POISE.TWITCH_MAG, CONFIG.POISE.TWITCH_DUR);
  }

  function tickFlinch(_dt: number) {
    if (flinchT <= 0) return;
    flinchT = Math.max(0, flinchT - _dt);
    const k = flinchT / flinchDur;             // 1 at impact → 0 settled
    // Ease-out so it snaps to the peak lean and decays back; a fast shudder
    // rides the front of the decay for the "jolt" read.
    const ease = k * k;
    const shudder = Math.sin(k * Math.PI * 7) * 0.10 * k;
    // +rotation.x tips the body's top toward +Z (away from its −Z facing) —
    // a backward recoil off the player it's squared up to.
    built.group.rotation.x = flinchMag * (ease + shudder);
  }

  function tickHeadCrane(dt: number, distance: number, aware: boolean, yawToPlayer = 0) {
    if (!neck) return;
    const prox = Math.max(0, 1 - distance / 5);   // 0 far → 1 point-blank
    const targetPitch = aware ? -0.45 * prox : 0;
    headPitch += (targetPitch - headPitch) * Math.min(1, dt * 6);
    neck.rotation.x = neckBaseX + headPitch;
    // FOCUS TRACKING (DOOM-style): twist the head in YAW toward the player so it
    // keeps WATCHING you while the body's root faces its movement — a strafing /
    // circling mob eyes you instead of looking wherever its feet carry it, which
    // is what makes decoupled locomotion read coherently instead of "facing a
    // random direction." Clamped to a predator's swivel (not an owl-spin); eased.
    const MAX = CONFIG.ENEMY_AI.HEAD_TRACK_MAX;
    const targetYaw = aware ? Math.max(-MAX, Math.min(MAX, yawToPlayer)) : 0;
    headYaw += (targetYaw - headYaw) * Math.min(1, dt * 8);
    neck.rotation.y = neckBaseY + headYaw;
  }

  function tickKnockback(dt: number, walkable: WalkableRegion) {
    if (knockVX === 0 && knockVZ === 0) return;
    const r = walkable.clampMove(
      container.position.x, container.position.z,
      container.position.x + knockVX * dt,
      container.position.z + knockVZ * dt,
      spec.collisionRadius,
      spec.phasing ? { ignoreObstacles: true } : undefined,
    );
    container.position.x = r.x;
    container.position.z = r.z;
    const decay = Math.exp(-dt * 9);
    knockVX *= decay;
    knockVZ *= decay;
    if (Math.abs(knockVX) < 0.05 && Math.abs(knockVZ) < 0.05) { knockVX = 0; knockVZ = 0; }
  }

  function tickLocomotion(dt: number) {
    // Wingbeat — continuous fast flutter, biased upward so the wings spend more
    // time raised than dropped (reads as a beat, not a metronome). ~3.8 Hz.
    if (hasWings) {
      flapTime += dt;
      const flap = Math.sin(flapTime * 24) * 0.45 + 0.12;
      if (wingL) wingL.rotation.z = wLz - flap;
      if (wingR) wingR.rotation.z = wRz + flap;
      const fh = flap * 0.8;
      if (wingL2) wingL2.rotation.z = wL2z - fh;
      if (wingR2) wingR2.rotation.z = wR2z + fh;
    }
    const quad = !!(frontL || frontR || hindL || hindR);
    if (hipL || hipR || quad) {
      const movedX = container.position.x - prevX;
      const movedZ = container.position.z - prevZ;
      const moved = Math.hypot(movedX, movedZ);
      // Advance the cycle by distance covered → feet roughly track the
      // ground, less moonwalk than a time-based cycle.
      stridePhase += (moved / STRIDE_LENGTH) * Math.PI * 2;
      // Ease gait in/out so legs return to rest when the enemy stops
      // (a frozen mid-stride pose reads worse than settling to neutral).
      const targetAmp = moved > 0.0005 ? GAIT_SWING : 0;
      gaitAmp += (targetAmp - gaitAmp) * Math.min(1, dt * 9);
      const swing = Math.sin(stridePhase) * gaitAmp;
      if (quad) {
        // Trot — diagonal pairs swing together (FL+HR, FR+HL). Shorter throw
        // than a biped stride; a quick double-frequency bob.
        const s = swing * 0.7;
        if (frontL) frontL.rotation.x = fLB + s;
        if (hindR) hindR.rotation.x = hRB + s;
        if (frontR) frontR.rotation.x = fRB - s;
        if (hindL) hindL.rotation.x = hLB - s;
        built.group.position.y += Math.abs(Math.sin(stridePhase * 2)) * gaitAmp * 0.02;
      } else {
        if (hipL) hipL.rotation.x = hipBaseLX + swing;
        if (hipR) hipR.rotation.x = hipBaseRX - swing;
        // Subtle vertical bob synced to the stride (up on each footfall).
        built.group.position.y += Math.abs(Math.sin(stridePhase)) * gaitAmp * 0.05;
      }
    }
    // LEAN — the body leans FORWARD into its run and BANKS into turns, so
    // movement carries weight and a circling mob leans like a predator on a
    // curve (DOOM's adaptive-animation read, approximated). On the CONTAINER
    // roll/pitch: faceTarget zeros those each frame and nothing else writes them,
    // so this never fights the inner-body telegraph / stagger / flinch poses.
    {
      const movedX = container.position.x - prevX;
      const movedZ = container.position.z - prevZ;
      const moved = Math.hypot(movedX, movedZ);
      const speed = dt > 0 ? moved / dt : 0;
      const spd01 = Math.min(1, speed / 2.6);   // 0..1 vs a typical run speed
      let targetPitch = 0, targetRoll = 0;
      if (moved > 0.0008) {
        // Forward lean: −rotation.x tips the body's top toward its −Z facing.
        targetPitch = -CONFIG.ENEMY_AI.LEAN_PITCH_MAX * spd01;
        if (hasHeading) {
          const heading = Math.atan2(movedX, movedZ);
          const turn = Math.atan2(Math.sin(heading - prevHeading), Math.cos(heading - prevHeading));
          prevHeading = heading;
          targetRoll = Math.max(-1, Math.min(1, (turn / Math.max(dt, 1e-3)) * 0.22))
            * CONFIG.ENEMY_AI.LEAN_ROLL_MAX * spd01;
        } else {
          prevHeading = Math.atan2(movedX, movedZ);
          hasHeading = true;
        }
      } else {
        hasHeading = false;
      }
      const a = Math.min(1, dt * 8);
      leanPitch += (targetPitch - leanPitch) * a;
      leanRoll += (targetRoll - leanRoll) * a;
      container.rotation.x = leanPitch;
      container.rotation.z = leanRoll;
    }
    prevX = container.position.x;
    prevZ = container.position.z;
  }

  function tickPresence(dt: number) {
    if (!presence) return;
    presenceTime += dt;
    const t = presenceTime + presencePhase;
    switch (presence) {
      case 'spectral': {
        // Slow vertical bob + micro yaw sway. Wraith — float + drift.
        built.group.position.y += Math.sin(t * 1.7) * 0.10;
        container.rotation.y   += Math.sin(t * 0.9) * 0.05;
        break;
      }
      case 'lurch': {
        // Shambling corpse — lateral roll with a shamble-step dip
        // synced to the roll. Reads as heavy + off-balance.
        built.group.rotation.z  = Math.sin(t * 1.45) * 0.08;
        built.group.position.y += Math.abs(Math.sin(t * 1.45)) * 0.05 - 0.025;
        break;
      }
      case 'twitch': {
        // Rat — fast yaw micro-shudder + scurry bob. Yaw is on
        // container so the whole body twitches, not just the head.
        container.rotation.y   += Math.sin(t * 7.0) * 0.045;
        built.group.position.y += Math.abs(Math.sin(t * 8.5)) * 0.012;
        break;
      }
      case 'coiled': {
        // Skirmisher — taut shoulder bob + subtle weight-shift roll.
        // Reads as ready to spring rather than at rest.
        built.group.position.y += Math.sin(t * 2.4) * 0.022;
        built.group.rotation.z  = Math.sin(t * 1.7) * 0.030;
        break;
      }
      case 'chant': {
        // Acolyte — slow ritual side rock + horizontal drift + orb
        // emissive pulse. The orb pulse is what sells "channelling"
        // even when the caster is just standing.
        built.group.rotation.z  = Math.sin(t * 1.0) * 0.08;
        built.group.position.x  = Math.sin(t * 0.8) * 0.025;
        if (orbMat) {
          orbMat.emissiveIntensity = orbBaseEmissive * (1 + 0.35 * Math.sin(t * 1.4));
        }
        break;
      }
    }
  }

  return { applyKnockback, flinch, twitch, tickHeadCrane, tickKnockback, tickFlinch, tickLocomotion, tickPresence };
}
