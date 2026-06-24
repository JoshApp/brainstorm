import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';
import type { EnemySpec } from '../content/enemies';
import { CONFIG } from '../config';

// Enemy visual presentation, extracted from enemy.ts. Two small controllers
// the factory builds once and the update loop drives:
//
//   - EyePresenter  — the eye/halo windup telegraph (brighten + shift hot-red
//                     as the enemy commits to a strike) and the dim idle look.
//   - CoreReactor   — the hit-flash. Plain mobs get a brief colour flash; mobs
//                     with a `coreGlow` orb (the king-slime nucleus) get an
//                     idle heartbeat + a punchy white-hot flare/pop on damage.
//
// Both own their own material refs + scratch colours, so this lifts a tangle
// of presentation state out of the createEnemy closure. enemy.ts keeps thin
// `setEyeFlare` / `applyIdleEyes` aliases so the AI state machine's call sites
// are unchanged.

export interface EyePresenter {
  /** t in [0,1] = neutral to full windup. */
  setFlare(t: number): void;
  /** Dim "unaware" eyes for a truly idle (unalerted) mob. */
  applyIdle(): void;
  /** Mid-brightness "alert but not committed" look for the search state. */
  applySearch(): void;
  /** Fade the halo sprites' opacity (death dissolve). */
  setHaloOpacity(o: number): void;
  /** Reactive-defense telegraph: paint the eyes/halos a flat THREAT colour
   *  (white = deflectable, red = unblockable) while a reachable strike is
   *  committing — overrides the normal flare. Pass null to release. */
  setThreatFlash(color: THREE.Color | null): void;
}

export function createEyePresenter(built: BuiltModel, spec: EnemySpec): EyePresenter {
  const eyeMat = built.materials.get(spec.eyeMaterialName) as THREE.MeshStandardMaterial | undefined;
  const baseEyeEmissive = spec.baseEyeEmissive;

  // Windup telegraph: eyes blaze brighter and shift toward hot red as the
  // enemy commits to a strike. The visible eyes are sprite billboards
  // (halos); the mesh eye material is also mutated where it exists (rat).
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
  // Reactive-defense threat flash — when set, overrides the flare with a flat,
  // bright, pulsing colour (white = deflect this, red = dodge this).
  let threatColor: THREE.Color | null = null;
  function setThreatFlash(c: THREE.Color | null) { threatColor = c; }
  function paintThreat() {
    // Pulse so it READS as "act now," not a static tint. ~6Hz throb.
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 1000 * 38);
    if (eyeMat) {
      eyeMat.emissiveIntensity = baseEyeEmissive * (1 + 9 * pulse);
      eyeMat.emissive.copy(threatColor!);
    }
    const haloScale = 1.7 + 0.3 * pulse;
    if (eyeHaloL && haloMatL) {
      eyeHaloL.scale.set(haloBaseScaleL.x * haloScale, haloBaseScaleL.y * haloScale, 1);
      haloMatL.color.copy(threatColor!).multiplyScalar(1.8 + pulse);
    }
    if (eyeHaloR && haloMatR) {
      eyeHaloR.scale.set(haloBaseScaleR.x * haloScale, haloBaseScaleR.y * haloScale, 1);
      haloMatR.color.copy(threatColor!).multiplyScalar(1.8 + pulse);
    }
  }

  function setFlare(t: number) {
    if (threatColor) { paintThreat(); return; }   // threat flash owns the eyes
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

  function applyIdle() {
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

  function applySearch() {
    // Dimmer eye flare during search — alert but not committed.
    if (eyeMat) eyeMat.emissiveIntensity = baseEyeEmissive * 0.85;
    if (haloMatL) haloMatL.color.copy(haloBaseColorL).multiplyScalar(0.8);
    if (haloMatR) haloMatR.color.copy(haloBaseColorR).multiplyScalar(0.8);
  }

  function setHaloOpacity(o: number) {
    if (haloMatL) haloMatL.opacity = o;
    if (haloMatR) haloMatR.opacity = o;
  }

  return { setFlare, applyIdle, applySearch, setHaloOpacity, setThreatFlash };
}

export interface CoreReactor {
  /** Trigger the hit reaction (flash + core flare). Call from takeDamage. */
  hit(): void;
  /** Advance the heartbeat + flash decay. Call once per frame from update. */
  tick(dt: number): void;
}

/** The whole-body hit flash is a material-COLOR lerp on built.materials (below).
 *  The creature renders as ONE SkinnedMesh that reuses those material objects,
 *  so the lerp reaches the whole body directly — no per-slot instanceColor. */
export function createCoreReactor(
  built: BuiltModel, spec: EnemySpec,
): CoreReactor {
  const flashMat = built.materials.get(spec.flashMaterialName) as THREE.MeshStandardMaterial | undefined;
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);
  // Base emissive intensity so the damage pulse can boost it (for materials
  // with bright emissive — e.g. the king-slime's core orb — base-color
  // lerping alone is invisible because the emissive overwhelms diffuse).
  const originalEmissiveIntensity = flashMat ? flashMat.emissiveIntensity : 0;

  // Whole-body flash set: EVERY material on the model, not just
  // spec.flashMaterialName. Previously only the single named material lit
  // up on hit — so the acolyte (flashMaterialName 'body' = just the head
  // sphere) flashed its head while the robe + hood ('robe' material) stayed
  // dark, which read as "only part of it reacts." Flashing all materials
  // makes the whole creature register the blow. Emissive parts get an
  // intensity bump too so the pulse shows through their glow.
  const bodyFlashMats: { mat: THREE.MeshStandardMaterial; color: THREE.Color; emissive: number }[] = [];
  for (const m of built.materials.values()) {
    const sm = m as THREE.MeshStandardMaterial;
    if (!sm.color) continue;
    bodyFlashMats.push({ mat: sm, color: sm.color.clone(), emissive: sm.emissiveIntensity ?? 0 });
  }

  // Glowing-core hit reaction (the king's bright 'core' orb): an enemy that
  // ships a `coreGlow` sprite gets the "real core" treatment — idle heartbeat
  // + punchy white-hot flare/pop on damage. flashMat is the core orb material.
  const coreMesh = built.parts.get(spec.flashMaterialName) as THREE.Mesh | undefined;
  const coreMeshBaseScale = coreMesh ? coreMesh.scale.clone() : null;
  const coreBaseEmissive = flashMat ? flashMat.emissive.clone() : new THREE.Color();
  const coreGlow = built.parts.get('coreGlow') as THREE.Sprite | undefined;
  const coreGlowMat = coreGlow?.material as THREE.SpriteMaterial | undefined;
  const coreGlowBaseScale = coreGlow ? coreGlow.scale.clone() : null;
  const hasGlowingCore = !!coreGlow && !!flashMat && originalEmissiveIntensity > 0;
  const CORE_WHITE = new THREE.Color(0xffffff);
  const tmpCoreEmissive = new THREE.Color();
  const CORE_HIT_DECAY = 0.22;   // seconds for the hit flare/pop to fall off

  let flashTimer = 0;
  let hitPulse = 0;              // 1 on hit, decays — drives flare + pop
  let coreTime = 0;             // idle heartbeat clock

  function hit() {
    flashTimer = CONFIG.ENEMY_HIT_FLASH_DURATION;
    hitPulse = 1;   // drives the glowing-core flare + pop (king)
  }

  function tick(dt: number) {
    coreTime += dt;
    if (hasGlowingCore && flashMat) {
      // The king's nucleus: a slow idle heartbeat (so the eye is drawn to
      // the weak point) overlaid with a punchy hit flare — white-hot
      // emissive spike + a scale POP on the orb + a bloom flare on the
      // halo sprite, all decaying over CORE_HIT_DECAY. Unmistakable even
      // behind the 0.55-opacity body.
      hitPulse = Math.max(0, hitPulse - dt / CORE_HIT_DECAY);
      const beat = Math.sin(coreTime * 2.4);
      flashMat.emissiveIntensity = originalEmissiveIntensity * (1 + 0.18 * beat + 4.5 * hitPulse);
      tmpCoreEmissive.copy(coreBaseEmissive).lerp(CORE_WHITE, 0.85 * hitPulse);
      flashMat.emissive.copy(tmpCoreEmissive);
      if (coreMesh && coreMeshBaseScale) {
        coreMesh.scale.copy(coreMeshBaseScale).multiplyScalar(1 + 0.55 * hitPulse + 0.04 * beat);
      }
      if (coreGlow && coreGlowMat && coreGlowBaseScale) {
        coreGlowMat.opacity = 0.45 + 0.12 * beat + 0.95 * hitPulse;
        coreGlow.scale.copy(coreGlowBaseScale).multiplyScalar(1 + 0.5 * hitPulse + 0.06 * beat);
      }
    } else if (flashTimer > 0) {
      // Plain mobs — brief colour flash across the WHOLE body on hit.
      flashTimer -= dt;
      const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
      for (const b of bodyFlashMats) {
        b.mat.color.copy(b.color).lerp(flashColor, t);
        if (b.emissive > 0) b.mat.emissiveIntensity = b.emissive * (1 + 1.5 * t);
      }
      // Snap everything back to base the frame the flash ends — no per-frame
      // writes once idle.
      if (flashTimer <= 0) {
        for (const b of bodyFlashMats) {
          b.mat.color.copy(b.color);
          if (b.emissive > 0) b.mat.emissiveIntensity = b.emissive;
        }
      }
    }
  }

  return { hit, tick };
}
