import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';
import { emit } from '../broadcast/event-bus';
import type { EnemySpec } from '../content/enemies';
import type { WalkableRegion } from '../level/walkable';
import {
  spawn as spawnEntity,
  destroy as destroyEntity,
  get as getEntity,
  generateEntityId,
} from '../ecs/world';
import type { EntityId } from '../ecs/types';
import { buildModel } from '../ecs/build-model';
import { ITEMS } from '../content/items';
import { createPickup } from '../interactables/pickup';
import { computeDamage, setEntityCombatStats, clearEntityCombatStats, type DamageEvent } from '../combat/damage';
import { playEnemyDeath, playEnemyWindup, type EnemyDeathSize } from '../audio/sfx';
import { spawnProjectile } from '../combat/projectile-pool';
import { spawnSoulWisps } from '../effects/soul-wisps';

// Map an EnemySpec → audio size bucket. Used by death + windup sounds so
// big mobs sound big and the wraith reads as spectral, not physical.
function audioSizeFor(spec: EnemySpec): EnemyDeathSize {
  if (spec.id === 'wraith') return 'spectral';
  if (spec.id === 'rat') return 'small';
  return 'medium';
}

// Enemy = a mob driven by its EnemySpec.
//
// Geometry/materials come from spec.model via buildModel(). This module owns
// only the behavior glue:
//   - AI state machine + perception:
//       idle → alerted → chasing → winding → striking → recovering
//                                         ↓
//                                      searching → returning → idle
//   - Per-instance presentation state (hit flash, animated emissive)
//   - World-entity bookkeeping (HP lives in the world; effects can address it)
//
// Perception:
//   - Sight cone (range + half-angle): player must be inside AND line-of-
//     sight clear (no wall in between, queried from WalkableRegion).
//   - Hearing radius: small unconditional proximity that always aggros,
//     regardless of vision.
//   - Damage taken always aggros and resets the lose-sight timer.
//
// Two nested groups:
//   - `container` handles world position + yaw (face-player lookAt)
//   - `model.group` (inside container) handles internal tilt animations
// This way the body lean during windup doesn't fight the lookAt.

type EnemyState =
  | 'idle'        // at post, scanning, has not seen player
  | 'alerted'     // first sight — brief rear-up before committing
  | 'chasing'
  | 'winding'
  | 'striking'
  | 'recovering'
  | 'searching'   // lost sight, heading to last known position
  | 'returning';  // gave up search, walking back to post

// How long an enemy hesitates after first spotting the player before
// committing to chase. Sells the "I see you" moment — also gives the
// player a reaction window.
const ALERTED_DURATION = 0.45;

// How long the enemy will search at the last-known position before giving
// up. Doesn't override per-spec loseSightTime; this is the search PHASE
// duration after sight is already lost.
const SEARCH_DURATION = 3.0;

// Idle scan: rotates yaw target every N seconds within a small arc around
// the home direction. Makes idle enemies feel watchful rather than statues.
const IDLE_SCAN_INTERVAL = 2.5;
const IDLE_SCAN_HALF_ARC = 0.7;   // ±40° around home yaw

export interface Enemy {
  entityId: EntityId;
  group: THREE.Group;
  hitTargets: THREE.Object3D[];
  alive: boolean;
  /** True after hp hit zero AND the death animation is still ticking. */
  dying: boolean;
  hp: number;
  collisionRadius: number;
  takeDamage(event: DamageEvent): number;
  update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion): void;
  setDebugState(state: EnemyState, phaseTimer: number): void;
  setDebugPosition(x: number, z: number): void;
  /** Rotate the container so it faces a world point (head toward it). */
  faceWorld(x: number, z: number): void;
}

const tmpDir = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

export function createEnemy(
  scene: THREE.Object3D,
  position: THREE.Vector3,
  spec: EnemySpec,
): Enemy {
  // Container: world position + yaw to face player.
  const container = new THREE.Group();
  container.position.copy(position);

  // Built model: meshes + named parts + per-instance materials.
  const built = buildModel(spec.model);
  container.add(built.group);

  scene.add(container);

  // Look up the animation targets by name. tiltPart can be either a named
  // part OR a slot (slots are pure anchors useful when an enemy has a 'rig'
  // group holding everything that should tilt together).
  const tiltPart = built.parts.get(spec.tiltPartName) ?? built.slots.get(spec.tiltPartName);
  const flashMat = built.materials.get(spec.flashMaterialName) as THREE.MeshStandardMaterial | undefined;
  const eyeMat   = built.materials.get(spec.eyeMaterialName)   as THREE.MeshStandardMaterial | undefined;

  // Windup telegraph: eyes blaze brighter and shift toward hot red as the
  // enemy commits to a strike. We mutate the sprite halo material's color
  // (and scale) since the visible eyes are sprite billboards. The mesh
  // eye material is also mutated where it exists (rat) for consistency.
  const eyeHaloL = built.parts.get('eyeHaloL') as THREE.Sprite | undefined;
  const eyeHaloR = built.parts.get('eyeHaloR') as THREE.Sprite | undefined;
  const haloMatL = eyeHaloL?.material as THREE.SpriteMaterial | undefined;
  const haloMatR = eyeHaloR?.material as THREE.SpriteMaterial | undefined;
  const haloBaseScaleL = eyeHaloL ? eyeHaloL.scale.clone() : new THREE.Vector3(1, 1, 1);
  const haloBaseScaleR = eyeHaloR ? eyeHaloR.scale.clone() : new THREE.Vector3(1, 1, 1);
  const haloBaseColorL = haloMatL ? haloMatL.color.clone() : new THREE.Color(0xff5500);
  const haloBaseColorR = haloMatR ? haloMatR.color.clone() : new THREE.Color(0xff5500);

  const eyeBaseColor = eyeMat ? eyeMat.emissive.clone() : new THREE.Color(0xff5500);
  const eyeWindupColor = new THREE.Color(0xff1505);   // hot red at peak
  const haloWindupColor = new THREE.Color(0xffffff);  // sprite goes white-hot
  const tmpEyeColor = new THREE.Color();
  const tmpHaloColor = new THREE.Color();
  function setEyeFlare(t: number) {
    // t in [0, 1] = neutral to full windup.

    // Mesh eye material (for the rat — its eye spheres render fine).
    if (eyeMat) {
      eyeMat.emissiveIntensity = baseEyeEmissive * (1 + 7 * t);
      tmpEyeColor.copy(eyeBaseColor).lerp(eyeWindupColor, t);
      eyeMat.emissive.copy(tmpEyeColor);
    }

    // Sprite halos — the dominant visible cue on humanoid enemies.
    // Scale up by ~1.6x at peak windup; color brightens toward white.
    const haloScale = 1 + 0.6 * t;
    if (eyeHaloL && haloMatL) {
      eyeHaloL.scale.set(haloBaseScaleL.x * haloScale, haloBaseScaleL.y * haloScale, 1);
      tmpHaloColor.copy(haloBaseColorL).lerp(haloWindupColor, t * 0.75);
      // Boost overall brightness so additive blend cuts through even bright
      // background pixels (e.g. silhouetted in front of a torch).
      tmpHaloColor.multiplyScalar(1 + 1.2 * t);
      haloMatL.color.copy(tmpHaloColor);
    }
    if (eyeHaloR && haloMatR) {
      eyeHaloR.scale.set(haloBaseScaleR.x * haloScale, haloBaseScaleR.y * haloScale, 1);
      tmpHaloColor.copy(haloBaseColorR).lerp(haloWindupColor, t * 0.75);
      tmpHaloColor.multiplyScalar(1 + 1.2 * t);
      haloMatR.color.copy(tmpHaloColor);
    }
  }

  // World entity (HP + buffs).
  const entityId = generateEntityId(`enemy-${spec.id}`);
  spawnEntity({
    id: entityId,
    kind: 'enemy',
    hp: { base: spec.hp, current: spec.hp },
    buffs: [],
    passives: [],
  });
  // Register combat stats so the damage pipeline knows this enemy's armor +
  // (future) damage modifiers. Defaults to 0 armor, no bonuses — fields on
  // EnemySpec override per-enemy.
  setEntityCombatStats(entityId, {
    physicalArmor: spec.physicalArmor ?? 0,
    magicArmor: spec.magicArmor ?? 0,
  });

  // Per-instance presentation state.
  let flashTimer = 0;
  const originalColor = flashMat ? flashMat.color.clone() : new THREE.Color();
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);
  const baseEyeEmissive = spec.baseEyeEmissive;

  let state: EnemyState = 'idle';
  let phaseTimer = 0;
  let strikeAlreadyHit = false;
  let aliveLocal = true;

  // Perception state. lastSeenPos tracks the last known XZ of the player
  // for searching. Updated each frame the enemy currently has LOS.
  let aggroed = false;
  let timeSinceLOS = 0;             // seconds since enemy last had LOS to player
  const homePos = position.clone();  // post the enemy returns to when calm
  // Capture spawn yaw as "home yaw" so idle scan / returning faces back the
  // way the level placed us. Set after initial faceWorld() in builder.ts —
  // for now, read whatever rotation is on the container right now.
  let homeYaw = 0;                   // filled in on first idle-tick
  let homeYawSet = false;
  // Idle scan yaw target — rotates in place to feel watchful.
  let scanTimer = IDLE_SCAN_INTERVAL;  // pick a new target immediately
  let scanTargetYaw = 0;
  // Last position we saw the player at. Used by 'searching' state.
  const lastSeenPos = new THREE.Vector3();

  // Per-spec aggro params with defaults.
  const sightRange = spec.sightRange ?? 7;
  const sightRangeSq = sightRange * sightRange;
  const sightConeCos = Math.cos(spec.sightConeHalfAngle ?? 1.05);
  const hearingRange = spec.hearingRange ?? 2.5;
  const hearingRangeSq = hearingRange * hearingRange;
  const loseSightTime = spec.loseSightTime ?? 4;

  // Idle-state eye appearance: dim mesh emissive AND dim sprite halo. The
  // setEyeFlare(0) path is for windup-reset and goes back to FULL base
  // brightness, which is what aggroed-but-idle-frame should look like —
  // not what we want for a truly unaware mob.
  function applyIdleEyes() {
    // Tuned against the PSX bloom pipeline — 0.45/0.4 multipliers still
    // read as full-bright at distance. These low values give a faint
    // "watching pinprick" feel: visible enough to know something's there,
    // dim enough to read as unaware. Idle should be unsettling, not threatening.
    if (eyeMat) eyeMat.emissiveIntensity = baseEyeEmissive * 0.18;
    if (eyeHaloL && haloMatL) {
      eyeHaloL.scale.set(haloBaseScaleL.x * 0.55, haloBaseScaleL.y * 0.55, 1);
      haloMatL.color.copy(haloBaseColorL).multiplyScalar(0.15);
    }
    if (eyeHaloR && haloMatR) {
      eyeHaloR.scale.set(haloBaseScaleR.x * 0.55, haloBaseScaleR.y * 0.55, 1);
      haloMatR.color.copy(haloBaseColorR).multiplyScalar(0.15);
    }
  }
  // Apply immediately so unseen enemies don't pop with full-bright eyes
  // on the very first frame (before update runs even once).
  applyIdleEyes();
  // Per-cycle randomized windup duration so multiple enemies attacking in
  // unison de-synchronize over time (otherwise stacked mobs all strike on
  // the exact same frame and the player has no rhythm to read).
  let currentWindupTime = spec.windupTime;
  function rollWindupTime() {
    currentWindupTime = spec.windupTime * (0.78 + Math.random() * 0.44);  // ±22%
  }
  rollWindupTime();

  // Presence — continuous animation overlay applied each frame on top of
  // the per-state animation. Per-instance phase offset so two wraiths in
  // the same room drift out of sync. Cost = 2 sin() per wraith per frame.
  const presence = spec.presence;
  const presencePhase = Math.random() * Math.PI * 2;
  let presenceTime = 0;

  // Death sequence — once hp hits zero we DON'T immediately remove the
  // mesh. We ramp a dissolve uniform 0→1 over DEATH_DURATION while
  // additive soul wisps drift up + the body lifts. Only when the timer
  // expires does the container leave the scene.
  const DEATH_DURATION = 0.55;
  let deathTimer = -1;   // -1 = not dying; >=0 = ticking
  // Pre-collect every dissolve uniform we need to drive. Walking
  // `built.materials` per-frame would work too, but caching the refs
  // here keeps the per-frame tick branch-free.
  const dissolveUniforms: Array<{ value: number }> = [];
  for (const m of built.materials.values()) {
    const u = m.userData.uDissolve as { value: number } | undefined;
    if (u) dissolveUniforms.push(u);
  }

  /**
   * Apply incoming damage. Takes a DamageEvent and routes through the
   * pipeline (computes final after this enemy's armor for the type),
   * then mutates HP and fires presentation effects.
   *
   * Returns the actual amount applied (caller can use for damage numbers).
   */
  function takeDamage(event: DamageEvent): number {
    if (!aliveLocal) return 0;
    const entity = getEntity(entityId);
    if (!entity || !entity.hp) return 0;
    const result = computeDamage(event);
    entity.hp.current = Math.max(0, entity.hp.current - result.applied);
    flashTimer = CONFIG.ENEMY_HIT_FLASH_DURATION;
    // Damage from any source aggros (and keeps aggro for the full
    // loseSightTime window after the hit, even if the player breaks LOS
    // — a wounded mob doesn't forget). If we were idle/searching/etc,
    // jump straight to chasing (skip the alerted hesitation — being hit
    // IS the wake-up).
    aggroed = true;
    timeSinceLOS = 0;
    if (state === 'idle' || state === 'alerted' || state === 'searching' || state === 'returning') {
      state = 'chasing';
      phaseTimer = 0;
    }
    if (entity.hp.current <= 0) {
      // Mark dead immediately for combat/gameplay purposes (no more
      // damage, no AI ticks, kill counter triggers, drops spawn). The
      // container stays in the scene for the duration of the death
      // animation — the dissolve uniform + soul wisps run via the
      // dying-branch in update(). Final scene.remove happens when
      // deathTimer crosses DEATH_DURATION.
      aliveLocal = false;
      clearEntityCombatStats(entityId);
      destroyEntity(entityId);
      playEnemyDeath(audioSizeFor(spec));
      // Drop table: each entry rolls independently. Multiple successful
      // drops are spread in a small arc around the death position so they
      // don't stack on the same pixel.
      if (spec.drops) {
        const successful = spec.drops.filter(d => Math.random() < (d.chance ?? 1.0));
        const N = successful.length;
        // Loot fountain — each item pops out of the corpse on its own arc,
        // settles where it lands. Angles distributed evenly + jittered so
        // multiple drops spread out instead of clumping.
        successful.forEach((drop, i) => {
          const item = ITEMS[drop.itemId];
          if (!item) return;
          const pos = container.position.clone();
          const angle = (N > 1 ? (i / N) * Math.PI * 2 : Math.random() * Math.PI * 2)
            + (Math.random() - 0.5) * 0.6;
          const horizontalSpeed = 1.4 + Math.random() * 0.6;
          const verticalSpeed = 3.6 + Math.random() * 0.5;
          const launchVel = new THREE.Vector3(
            Math.cos(angle) * horizontalSpeed,
            verticalSpeed,
            Math.sin(angle) * horizontalSpeed,
          );
          createPickup(scene, pos, item, { velocity: launchVel });
        });
      }
      // Clear raycast targets so a swing mid-dissolve doesn't generate a
      // zero-damage "hit" on the disintegrating corpse.
      built.hitTargets.length = 0;
      emit({ type: 'enemy:killed', enemyId: spec.id });
      // Start the death animation. Spawn one wisp burst now; the dissolve
      // ramp + body lift happen each tick in update() below.
      deathTimer = 0;
      // Soul wisp color: match spectral enemies' eye glow if defined,
      // else a generic warm ember.
      const wispColor = presence === 'spectral' ? 0x88ffbb : 0xffaa55;
      const origin = container.position.clone();
      origin.y += 0.6;
      spawnSoulWisps(scene as THREE.Object3D, origin, wispColor, 6);
    }
    return result.applied;
  }

  function distToXZ(target: THREE.Vector3): number {
    const dx = container.position.x - target.x;
    const dz = container.position.z - target.z;
    return Math.hypot(dx, dz);
  }

  function faceTarget(target: THREE.Vector3) {
    // Three.js Object3D.lookAt() (for non-cameras) makes the object's +Z
    // axis face the target. Our models follow the OPPOSITE convention —
    // head/eyes/snout at -Z, tail/back at +Z (matching camera convention)
    // — so we add π to the yaw after lookAt so the model's -Z (head)
    // faces the target instead of its +Z (back).
    tmpFlat.set(target.x, container.position.y, target.z);
    container.lookAt(tmpFlat);
    container.rotation.y += Math.PI;
  }

  function applyTilt(angle: number) {
    if (tiltPart) tiltPart.rotation.x = angle;
  }

  function setEyeEmissive(intensity: number) {
    if (eyeMat) eyeMat.emissiveIntensity = intensity;
  }
  // (setEyeFlare lives above — combines intensity ramp + color shift.)

  // Perception check. Returns true if the enemy can detect the player
  // right now, via either:
  //   - Hearing (proximity inside hearingRange, ignores cone + LOS)
  //   - Sight (inside sightRange, inside cone, AND clear LOS to player)
  // Hearing wins ties — close enough always trips, regardless of facing.
  function canSeePlayer(playerPos: THREE.Vector3, walkable: WalkableRegion): boolean {
    const dx = playerPos.x - container.position.x;
    const dz = playerPos.z - container.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < hearingRangeSq) return true;
    if (distSq > sightRangeSq) return false;
    // Cone check (uses current container yaw — the enemy's facing).
    // Container facing: container's "forward" is -Z in local space (per
    // the lookAt convention we set in faceTarget). Convert to world.
    const dist = Math.sqrt(distSq);
    const ndx = dx / dist;
    const ndz = dz / dist;
    const forwardX = -Math.sin(container.rotation.y);
    const forwardZ = -Math.cos(container.rotation.y);
    const dot = forwardX * ndx + forwardZ * ndz;
    if (dot < sightConeCos) return false;
    // LOS — straight line, blocked by walls only (not pillars/altar).
    return walkable.hasLineOfSight(
      container.position.x, container.position.z,
      playerPos.x, playerPos.z,
    );
  }

  function tickDying(dt: number) {
    deathTimer += dt;
    const t = Math.min(1, deathTimer / DEATH_DURATION);

    // Drive the dissolve uniform on every dissolvable material on the
    // mob. The shader injection (build-model.ts attachShaderExtensions)
    // converts uDissolve into a top-down ragged discard with an
    // emissive edge band.
    for (const u of dissolveUniforms) u.value = t;

    // Body lifts as the soul leaves — spectral enemies rise more (sells
    // the float), physical creatures sag a touch.
    const lift = presence === 'spectral'
      ?  0.55 * t
      : -0.08 * t;
    built.group.position.y = lift;

    // Eye flare — spike then crash. The mob "sees clearly" the instant
    // it dies, then the lights go out before the body is gone.
    const eyeT = t < 0.18
      ?  t / 0.18
      :  1 - (t - 0.18) / 0.82;
    setEyeFlare(Math.max(0, eyeT));

    // Halo opacity fades alongside.
    if (haloMatL) haloMatL.opacity = Math.max(0, 1 - t);
    if (haloMatR) haloMatR.opacity = Math.max(0, 1 - t);

    if (t >= 1) {
      // Animation complete — remove the container and mark fully done.
      scene.remove(container);
      deathTimer = -1;
      // Dispose the geometries we built for this mob. Materials are
      // safe to leak (the program cache key dedup means subsequent
      // spawns hit the cached compile).
      built.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
    }
  }

  function update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion) {
    if (!aliveLocal) {
      // Dying branch — run the death animation; everything else (AI,
      // perception, movement) is gated off.
      if (deathTimer >= 0) tickDying(dt);
      return;
    }

    if (flashMat) {
      if (flashTimer > 0) {
        flashTimer -= dt;
        const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
        flashMat.color.copy(originalColor).lerp(flashColor, t);
      } else {
        flashMat.color.copy(originalColor);
      }
    }

    // Capture home yaw the very first tick so idle scan rotates around the
    // actual placed-orientation (set by builder via faceWorld at spawn).
    if (!homeYawSet) {
      homeYaw = container.rotation.y;
      scanTargetYaw = homeYaw;
      homeYawSet = true;
    }

    // ── Perception ─────────────────────────────────────────────────────
    // Refresh sight check every frame. Once aggroed, we stay aggroed
    // until loseSightTime seconds pass with no LOS AND we've transitioned
    // out of mid-attack states (winding/striking/recovering finish before
    // we drop aggro).
    const seesPlayer = canSeePlayer(playerPos, walkable);
    if (seesPlayer) {
      timeSinceLOS = 0;
      lastSeenPos.copy(playerPos);
      if (!aggroed) {
        aggroed = true;
        if (state === 'idle' || state === 'returning') {
          state = 'alerted';
          phaseTimer = 0;
          playEnemyWindup(audioSizeFor(spec));  // "I see you" growl
        }
      }
    } else if (aggroed) {
      timeSinceLOS += dt;
      // Drop aggro only when we've lost sight long enough AND we're not
      // mid-attack. Mid-attack we let the swing finish first.
      const attackingStates: ReadonlyArray<EnemyState> = ['winding', 'striking', 'recovering'];
      if (timeSinceLOS >= loseSightTime && !attackingStates.includes(state)) {
        aggroed = false;
        if (state === 'chasing') {
          state = 'searching';
          phaseTimer = 0;
        }
      }
    }

    const distance = distToXZ(playerPos);

    // Face target is conditional — idle/returning faces the scan target,
    // not the player.
    if (state !== 'idle' && state !== 'returning') {
      faceTarget(playerPos);
    }

    switch (state) {
      case 'idle': {
        // Slow scan around home yaw. Pick a new target angle every
        // IDLE_SCAN_INTERVAL seconds; lerp toward it. Dim eye flare so
        // a watching player can tell at a glance "this one hasn't seen me yet."
        scanTimer += dt;
        if (scanTimer >= IDLE_SCAN_INTERVAL) {
          scanTimer = 0;
          scanTargetYaw = homeYaw + (Math.random() * 2 - 1) * IDLE_SCAN_HALF_ARC;
        }
        // Lerp container yaw toward scan target. Wrap delta to nearest π.
        let delta = scanTargetYaw - container.rotation.y;
        while (delta >  Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        container.rotation.y += delta * Math.min(1, dt * 1.2);
        applyIdleEyes();
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'alerted': {
        // Brief "I see you" pause. Eyes flare bright, body rears back
        // slightly, then commits to chase. Face player during this so the
        // moment reads — the model snaps from scan-pose to confront-pose.
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / ALERTED_DURATION);
        faceTarget(playerPos);
        setEyeFlare(t);
        applyTilt(-0.15 * t);   // slight rear-back (negative tilt)
        built.group.position.y = 0;
        if (phaseTimer >= ALERTED_DURATION) {
          state = 'chasing';
          phaseTimer = 0;
        }
        break;
      }

      case 'searching': {
        // Walk toward last known position. If we get close to it without
        // re-acquiring (canSeePlayer handles that above by resetting
        // state to chasing on re-acquire), wait a beat, then return home.
        phaseTimer += dt;
        const dxs = lastSeenPos.x - container.position.x;
        const dzs = lastSeenPos.z - container.position.z;
        const distToLast = Math.hypot(dxs, dzs);
        // Face the search direction.
        faceTarget(lastSeenPos);
        if (distToLast > 0.4) {
          tmpDir.set(dxs, 0, dzs).normalize();
          const step = spec.moveSpeed * 0.7 * dt;  // slower than chase — wary search
          const newX = container.position.x + tmpDir.x * step;
          const newZ = container.position.z + tmpDir.z * step;
          const resolved = walkable.clampMove(
            container.position.x, container.position.z,
            newX, newZ, spec.collisionRadius,
          );
          container.position.x = resolved.x;
          container.position.z = resolved.z;
        }
        // Search times out either by phaseTimer or by re-acquiring (above).
        if (phaseTimer >= SEARCH_DURATION) {
          state = 'returning';
          phaseTimer = 0;
        }
        // Dimmer eye flare during search — alert but not committed.
        if (eyeMat) eyeMat.emissiveIntensity = baseEyeEmissive * 0.85;
        if (haloMatL) haloMatL.color.copy(haloBaseColorL).multiplyScalar(0.8);
        if (haloMatR) haloMatR.color.copy(haloBaseColorR).multiplyScalar(0.8);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'returning': {
        // Walk back to spawn post. On arrival, snap to home yaw and idle.
        const dxr = homePos.x - container.position.x;
        const dzr = homePos.z - container.position.z;
        const distHome = Math.hypot(dxr, dzr);
        if (distHome < 0.25) {
          state = 'idle';
          // Reset scan so it picks a fresh target next idle tick.
          scanTimer = IDLE_SCAN_INTERVAL;
          scanTargetYaw = homeYaw;
          break;
        }
        tmpDir.set(dxr, 0, dzr).normalize();
        const step = spec.moveSpeed * 0.6 * dt;
        const newX = container.position.x + tmpDir.x * step;
        const newZ = container.position.z + tmpDir.z * step;
        const resolved = walkable.clampMove(
          container.position.x, container.position.z,
          newX, newZ, spec.collisionRadius,
        );
        container.position.x = resolved.x;
        container.position.z = resolved.z;
        // Face direction of travel.
        tmpFlat.set(container.position.x + tmpDir.x, container.position.y, container.position.z + tmpDir.z);
        container.lookAt(tmpFlat);
        container.rotation.y += Math.PI;
        applyIdleEyes();
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'chasing': {
        if (distance > spec.attackRange) {
          tmpDir.subVectors(playerPos, container.position);
          tmpDir.y = 0;
          tmpDir.normalize();
          const step = spec.moveSpeed * dt;
          const newX = container.position.x + tmpDir.x * step;
          const newZ = container.position.z + tmpDir.z * step;
          const resolved = walkable.clampMove(
            container.position.x, container.position.z,
            newX, newZ,
            spec.collisionRadius,
          );
          container.position.x = resolved.x;
          container.position.z = resolved.z;
        } else {
          state = 'winding';
          phaseTimer = 0;
          strikeAlreadyHit = false;
          rollWindupTime();
          playEnemyWindup(audioSizeFor(spec));
        }
        setEyeFlare(0);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'winding': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / currentWindupTime);
        setEyeFlare(t);
        applyTilt(0.5 * t);
        built.group.position.y = 0.10 * t;
        // Continue closing during windup at HALF chase-speed so a stationary
        // player gets hit (the rat used to stop exactly at attackRange and
        // strike from there — but strikeRange < attackRange means strike
        // misses unless the rat closes further). Backpedaling player still
        // escapes since they retreat faster than the half-speed windup walk.
        if (distance > spec.strikeRange) {
          tmpDir.subVectors(playerPos, container.position);
          tmpDir.y = 0;
          tmpDir.normalize();
          const step = spec.moveSpeed * 0.45 * dt;
          const newX = container.position.x + tmpDir.x * step;
          const newZ = container.position.z + tmpDir.z * step;
          const resolved = walkable.clampMove(
            container.position.x, container.position.z,
            newX, newZ,
            spec.collisionRadius,
          );
          container.position.x = resolved.x;
          container.position.z = resolved.z;
        }
        if (phaseTimer >= currentWindupTime) {
          state = 'striking';
          phaseTimer = 0;
        }
        break;
      }

      case 'striking': {
        phaseTimer += dt;
        if (!strikeAlreadyHit) {
          if (spec.ranged) {
            // Ranged shooter — spawn a projectile from the muzzle slot.
            // Muzzle offset is rig/container-local; compose with the
            // container's world matrix so the spawn point matches the
            // visible staff/orb regardless of facing.
            const m = spec.ranged.muzzleOffset;
            tmpMuzzle.set(m[0], m[1], m[2]);
            container.updateMatrixWorld();
            tmpMuzzle.applyMatrix4(container.matrixWorld);
            // Target the player's torso height so a too-low orb doesn't
            // arc down through the floor (projectiles move in a straight
            // line — no gravity).
            tmpTarget.set(playerPos.x, tmpMuzzle.y, playerPos.z);
            spawnProjectile({
              typeId: spec.ranged.projectileId,
              origin: tmpMuzzle,
              target: tmpTarget,
              damage: spec.attackDamage,
              source: entityId,
            });
            strikeAlreadyHit = true;
          } else if (distance <= spec.strikeRange) {
            // Enemy melee strike — physical, sourced from this enemy.
            // damagePlayer routes through the pipeline (player armor applies
            // per the enemy's configured damage type — 'physical' default,
            // 'magic' for wraiths, etc.).
            damagePlayer(spec.attackDamage, entityId, spec.damageType ?? 'physical');
            strikeAlreadyHit = true;
          }
        }
        // Slam past neutral on the strike (follow-through). Eyes blaze at peak.
        applyTilt(-0.25);
        built.group.position.y = 0;
        setEyeFlare(1);
        if (phaseTimer >= spec.strikeTime) {
          state = 'recovering';
          phaseTimer = 0;
        }
        break;
      }

      case 'recovering': {
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / spec.recoverTime);
        applyTilt(THREE.MathUtils.lerp(-0.25, 0, t));
        // Eye flare fades back to baseline over the recovery.
        setEyeFlare(1 - t);
        built.group.position.y = 0;
        if (phaseTimer >= spec.recoverTime) {
          state = 'chasing';
          phaseTimer = 0;
        }
        break;
      }
    }

    // ── Presence overlay ─────────────────────────────────────────────
    // Applied AFTER the state animation so it stacks on whatever the
    // state set (e.g. winding's 0.10*t lift gets a bob on top — looks
    // like the wraith levitates higher as it rears up).
    if (presence === 'spectral') {
      presenceTime += dt;
      const t = presenceTime + presencePhase;
      // Slow vertical bob, ±10cm.
      built.group.position.y += Math.sin(t * 1.7) * 0.10;
      // Micro yaw sway — the head doesn't sit perfectly still on the
      // body. Small enough not to break the lookAt-at-player feel.
      container.rotation.y += Math.sin(t * 0.9) * 0.05;
    }
  }

  function setDebugState(s: EnemyState, t: number) {
    state = s;
    phaseTimer = t;
    strikeAlreadyHit = false;
    switch (s) {
      case 'chasing':
        setEyeFlare(0);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      case 'winding': {
        const f = Math.min(1, t / spec.windupTime);
        setEyeFlare(f);
        applyTilt(0.5 * f);
        built.group.position.y = 0.10 * f;
        break;
      }
      case 'striking':
        setEyeFlare(1);
        applyTilt(-0.25);
        built.group.position.y = 0;
        break;
      case 'recovering': {
        const f = Math.min(1, t / spec.recoverTime);
        setEyeFlare(1 - f);
        applyTilt(THREE.MathUtils.lerp(-0.25, 0, f));
        built.group.position.y = 0;
        break;
      }
    }
  }

  function setDebugPosition(x: number, z: number) {
    container.position.x = x;
    container.position.z = z;
  }

  function faceWorld(x: number, z: number) {
    tmpFlat.set(x, container.position.y, z);
    container.lookAt(tmpFlat);
    container.rotation.y += Math.PI;
  }

  return {
    entityId,
    group: container,
    hitTargets: built.hitTargets,
    collisionRadius: spec.collisionRadius,
    get alive() {
      return aliveLocal;
    },
    get dying() {
      return deathTimer >= 0;
    },
    get hp() {
      const e = getEntity(entityId);
      return e?.hp?.current ?? 0;
    },
    takeDamage,
    update,
    setDebugState,
    setDebugPosition,
    faceWorld,
  };
}
