import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { BONFIRE } from '../content/bonfire';
import { registerFateFire } from '../level/fate-fire';
import { registerInteractable } from '../interactables/system';
import { registerLight } from '../scene/light-pool';
import { generateEntityId } from '../ecs/world';
import { getTexture } from '../style/procedural-textures';
import { kickShake, kickJolt } from '../combat/screen-shake';
import { playImpact, playGateRaise, playWhoosh } from '../audio/sfx';

// ── THE BOSS BONFIRE — it rises from the ground where the boss fell ──────────
//
// A boss doesn't drop a chest. When the whole encounter ends (the king AND its
// warded brood all dead), the arena SHUDDERS and a bonfire heaves up out of the
// floor — the boss's own essence, its green soul-light drawn down into the pit
// and set alight as a rest-fire the delver earns by surviving. The moment reads
// in three beats that play together over ~1.8s:
//
//   1. RUMBLE — the floor kicks (screen shake pulses + a low impact) as the fire
//      breaks the surface, climbing from RISE_DIST below to its resting height.
//   2. SOULS — a ring of the boss's acid-green wisps spirals inward and DOWN
//      into the rising pit, pouring the thing that died into the thing being
//      born. They fade as they arrive; by the time the fire settles they're
//      spent, become the flame.
//   3. TAKE — on settle the fire is a REST fire (heal + a MAJOR arcana draw via
//      the shared fate-fire path), gating the descent until you sit at it.
//
// Driven by ONE throwaway interactable's tick (the interactable system already
// ticks every registered interactable each frame — no new loop wiring). When the
// rise finishes the throwaway hands off to registerFateFire on the SAME settled
// model group and removes itself; the fate-fire owns the rest from there.

const RISE_DIST = 1.5;    // how far below the floor the fire starts (m)
const RISE_S = 1.8;       // seconds to climb into place
const SOUL_COUNT = 14;    // acid-green wisps that pour into the pit
const SOUL_RING = 2.4;    // radius the souls start out at (m)
const SOUL_COLOR = 0x9cff3a;   // the king's core-green — his essence

// A boss bonfire is a GRANDER fire than the found rest-fires — bigger stack,
// bigger pool — so it reads as the major, run-defining rest it is (it's the one
// that deals the major arcana now; the safe-room fire stepped down to a minor).
const BOSS_FIRE_SCALE = 1.5;

/** Spawn the emerging boss bonfire at `pos` (ground height). Owns its own rise
 *  animation + soul VFX, then becomes a shared fate rest-fire. `fromPos` (the
 *  boss's death spot, when given) is where the death-energy STREAM originates —
 *  the souls flow from there into the rising fire, guiding the eye from the fallen
 *  boss to the reward. `depth` reserved for future depth-scaled presence. */
export function spawnBossBonfire(scene: THREE.Object3D, pos: THREE.Vector3, _depth: number, fromPos?: THREE.Vector3): void {
  const built = buildModel(BONFIRE);
  const group = built.group;
  group.scale.setScalar(BOSS_FIRE_SCALE);
  group.position.set(pos.x, pos.y - RISE_DIST, pos.z);   // start buried
  scene.add(group);

  // Pooled light — climbs from a buried ember to full as it surfaces, then
  // holds until the fate-fire spends it (spentFactor set via dimLight).
  const lightId = generateEntityId('boss-bonfire-light');
  let riseFactor = 0.12;   // 0.12 buried → 1 surfaced
  let spentFactor = 1;     // 1 lit → ~0.16 once drawn
  const p1 = Math.PI * 0.7, p2 = Math.PI * 1.3;
  registerLight({
    id: lightId,
    category: 'environment',
    position: new THREE.Vector3(pos.x, pos.y + 0.55, pos.z),
    color: 0xffb066,
    intensity: 40,
    distance: 8.0,
    decay: 2.0,
    getIntensity: () => {
      const t = performance.now() / 1000;
      const flicker = 1 + 0.10 * (0.6 * Math.sin(t * 5.1 + p1) + 0.4 * Math.sin(t * 8.7 + p2));
      return 40 * riseFactor * spentFactor * flicker;
    },
  });

  // Soul wisps — additive green sprites in a ring, spiralling in + down into the
  // pit as the fire rises. Parented to a group at the fire's SETTLED position so
  // their local coords are relative to the pit mouth.
  const soulRoot = new THREE.Group();
  soulRoot.position.set(pos.x, pos.y, pos.z);
  scene.add(soulRoot);
  const soulMat = new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'),
    color: SOUL_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  // Where the souls START (soulRoot-local). With a death spot, they gather at the
  // fallen boss and STREAM to the fire; without one, they rise from a ring around
  // the pit. `+ index jitter` so the stream reads as a shoal, not a single point.
  const streamFrom = fromPos ? new THREE.Vector3(fromPos.x - pos.x, 1.1, fromPos.z - pos.z) : null;
  interface Soul { spr: THREE.Sprite; ox: number; oy: number; oz: number; a0: number; spin: number; }
  const souls: Soul[] = [];
  for (let i = 0; i < SOUL_COUNT; i++) {
    const spr = new THREE.Sprite(soulMat.clone());
    const s = 0.28 + (i % 3) * 0.06;
    spr.scale.set(s, s, s);
    const a0 = (i / SOUL_COUNT) * Math.PI * 2;
    let ox: number, oy: number, oz: number;
    if (streamFrom) {
      ox = streamFrom.x + Math.cos(a0) * 0.5;
      oy = streamFrom.y + (i % 5) * 0.14;
      oz = streamFrom.z + Math.sin(a0) * 0.5;
    } else {
      const r0 = SOUL_RING * (0.8 + (i % 4) * 0.08);
      ox = Math.cos(a0) * r0; oy = 1.2 + (i % 5) * 0.18; oz = Math.sin(a0) * r0;
    }
    spr.position.set(ox, oy, oz);
    soulRoot.add(spr);
    souls.push({ spr, ox, oy, oz, a0, spin: 1.4 + (i % 3) * 0.5 });
  }

  // The break-surface beat — the floor HEAVES up as the fire punches through:
  // an upward directional jolt (the ground bulges) layered over the rattle, so
  // this reads as the earth moving, not just a camera shake.
  playImpact(pos);
  kickShake(0.34, 0.5);
  kickJolt(0, 1, 0, 0.26, 0.7, 5);   // heave UP, ring out ~4 bounces

  let t = 0;
  let shakePulse = 0;
  let settled = false;
  const baseY = pos.y;

  const id = generateEntityId('boss-bonfire-rise');
  const rise = {
    id,
    position: pos.clone(),
    radius: 0.1,
    // No prompt while it's still climbing — the fate-fire below owns 'REST'.
    promptLabel: '',
    // Throwaway built payload: the real bonfire group is owned by the scene (and
    // handed to the fate-fire on settle), so destroying this interactable must
    // NOT dispose it.
    built: { group: new THREE.Group(), parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    keepBuiltOnDestroy: true,
    onUse() { /* inert while rising — the fate-fire takes over on settle */ },
    tick(dt: number) {
      if (settled) return;
      t = Math.min(1, t + dt / RISE_S);
      // Ease-out rise: fast out of the ground, easing into the resting height.
      const ease = 1 - (1 - t) * (1 - t);
      group.position.y = baseY - RISE_DIST * (1 - ease);
      riseFactor = 0.12 + 0.88 * ease;

      // Ground-thud pulses on the way up (every ~0.34s), tapering as it settles:
      // a rattle plus a small vertical jolt so the earth SHUDDERS while the mass
      // climbs, not just a flat vibration.
      shakePulse -= dt;
      if (shakePulse <= 0 && t < 0.92) {
        kickShake(0.10 * (1 - t) + 0.05, 0.18);
        kickJolt(0, -1, 0, 0.09 * (1 - t) + 0.03, 0.26, 6);
        shakePulse = 0.34;
      }

      // Souls STREAM from their origin (the boss's death spot, or a ring) into the
      // pit, curling as they go and guttering out as they arrive. Their whole life
      // is the rise window.
      const soulOpacity = Math.sin(Math.min(1, t * 1.15) * Math.PI);   // 0→1→0 over the rise
      for (const s of souls) {
        const k = 1 - ease;                              // 1 at start → 0 settled
        const swirl = s.a0 + t * s.spin * Math.PI;       // curl the path so it isn't a straight line
        const curl = 0.35 * k;                           // sideways wobble, fading as it nears the fire
        const x = s.ox * k + Math.cos(swirl) * curl;
        const z = s.oz * k + Math.sin(swirl) * curl;
        const y = 0.15 + (s.oy - 0.15) * k;              // sink toward the pit mouth
        s.spr.position.set(x, y, z);
        (s.spr.material as THREE.SpriteMaterial).opacity = soulOpacity;
      }

      if (t >= 1) {
        settled = true;
        group.position.y = baseY;
        // The souls are spent — clear them.
        for (const s of souls) { soulRoot.remove(s.spr); (s.spr.material as THREE.Material).dispose(); }
        scene.remove(soulRoot);
        soulMat.dispose();
        // The fire TAKES — a rising whoosh + a settling thud as the whole mass
        // slams home into the floor (a heavy DOWN jolt under the rattle).
        playGateRaise(pos);
        playWhoosh();
        kickShake(0.2, 0.4);
        kickJolt(0, -1, 0, 0.22, 0.55, 5);
        // Hand the settled model to the shared fate rest-fire. isBig: heals to
        // full, deals a MAJOR arcana, and seals the descent until drawn.
        registerFateFire({
          group,
          position: pos.clone(),
          isBig: true,
          dimLight: (f) => { spentFactor = f; },
        });
        // Remove this throwaway animator (the fate-fire owns the fire now).
        rise.destroyed = true;
      }
    },
    destroyed: false,
  };
  registerInteractable(rise);
}
