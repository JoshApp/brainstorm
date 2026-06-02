import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { bossMistModel } from '../content/boss-mist';
import { registerInteractable } from './system';
import { engageBoss, registerFogWall } from '../ui/boss-engagement';
import { onBossEncounterComplete } from '../mobs/boss-encounter';
import { setPlayerInvulnerable } from '../player/health';
import { kickShake } from '../combat/screen-shake';
import { playWhoosh } from '../audio/sfx';
import { startFogWalkthrough } from '../player/fog-walkthrough';
import { openingNormal, openingEndpoints } from '../level/opening';
import type { WalkableRegion, WallSegment } from '../level/walkable';

// Boss-arena fog gate — soulslike threshold seal you INTERACT with. Installed
// via spawnFitting into a unified wall Opening (centre + wall-line rotY + gap
// width), exactly like a door — so it sits at the real entrance, framed, no
// special placement code.
//
//   - On build the gate BLOCKS the threshold (a wall segment across the gap),
//     so you can't wander into the arena — you walk up and it prompts you.
//   - Interacting OPENS it (seal removed) + engages the boss (bar + intro) + a
//     forced walk through. You step through.
//   - The instant you cross to the arena side it RE-SEALS behind you — locked
//     in with the boss.
//   - When the boss ENCOUNTER completes (every body incl. the split dead) the
//     seal lifts. The mist panel stays as a "cleared this place" marker.

const CROSS_EPSILON = 0.05;    // signed-distance flip threshold
const WALK_THROUGH_DIST = 1.4; // end just past the threshold, not mid-arena
const WALK_SECONDS = 2.1;      // slow, deliberate soulslike step-through

export function spawnBossMist(
  scene: THREE.Object3D,
  walkable: WalkableRegion,
  opening: { x: number; z: number; rotY: number; widthM: number; height: number },
  color: number,
): { teardown?: () => void } {
  const { x, z, rotY, widthM: width, height } = opening;
  const built = buildModel(bossMistModel(color, width / 2, height));
  built.group.position.set(x, 0, z);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  // Grab the translucent curtain materials so we can VISIBLY part the mist on
  // open and re-solidify it on seal — the gate's state has to read at a glance
  // (a silent obstacle that vanishes feels like nothing happened).
  const mistMats: THREE.Material[] = [];
  const baseOpacity = new Map<THREE.Material, number>();
  built.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && (m as THREE.Material).transparent && !baseOpacity.has(m)) {
        baseOpacity.set(m, (m as THREE.Material & { opacity: number }).opacity ?? 1);
        mistMats.push(m);
      }
    }
  });
  function setMistOpen(open: boolean) {
    for (const m of mistMats) {
      const base = baseOpacity.get(m) ?? 0.55;
      (m as THREE.Material & { opacity: number }).opacity = open ? base * 0.3 : base;
    }
  }

  // Plane normal pointing INTO the arena (the way you pass through), derived
  // from the opening's wall-line rotY — the single shared convention.
  const n = openingNormal(rotY);
  const normal = { x: n.x, z: n.z };

  // The seal — a wall segment spanning the gap (same primitive doors use), so
  // every fitting blocks movement the same way. Identity matters: the walkable
  // adds/removes by reference.
  const ep = openingEndpoints({ x, z, rotY, widthM: width });
  const seg: WallSegment = { ax: ep.ax, az: ep.az, bx: ep.bx, bz: ep.bz };
  let blocking = false;
  function block() { if (!blocking) { walkable.addWall(seg); blocking = true; } }
  function unblock() { if (blocking) { walkable.removeWall(seg); blocking = false; } }

  block();   // the gate is closed on arrival — you must commit to enter

  let opened = false;
  let sealed = false;
  let prevSign = 0;

  // Commit: open the gate, engage the boss, then a soulslike forced walk
  // THROUGH the mist into the arena. Idempotent.
  //
  // Gameplay-critical actions run FIRST (unblock + engage + invuln + the
  // walk) so a cosmetic call throwing can never strand the player in a
  // half-opened gate with a boss that never woke.
  function openGate() {
    if (opened) return;
    opened = true;
    unblock();
    engageBoss();
    // Immortal across the walk + a landing beat — the boss wakes the instant
    // we engage, and we don't want it bombing the player during the cutscene.
    setPlayerInvulnerable(WALK_SECONDS + 1.2);
    // Forced step through the gate: end a few metres INTO the arena, along
    // the threshold normal. Crossing the plane mid-walk re-seals behind us.
    const through = new THREE.Vector3(
      x + normal.x * WALK_THROUGH_DIST,
      0,
      z + normal.z * WALK_THROUGH_DIST,
    );
    startFogWalkthrough(through, WALK_SECONDS);
    // Cosmetic.
    setMistOpen(true);   // the curtain parts — you may pass
    playWhoosh();
    kickShake(0.12, 0.30);
  }

  const id = generateEntityId('boss-mist');
  registerInteractable({
    id,
    position: new THREE.Vector3(x, 0, z),
    radius: 2.8,
    promptLabel: 'enter the mist',
    // Explicit interact (tap the gate / press E) is the ONLY way through —
    // a real soulslike commitment, not an auto-open you walk into. The
    // curtain now fully fills the doorway so the tap-raycast reliably hits
    // it (rather than slipping past to the dormant boss behind).
    onUse() { openGate(); },
    tick(_dt: number, playerPos: THREE.Vector3) {
      if (!opened || sealed) return;
      const dx = playerPos.x - x;
      const dz = playerPos.z - z;
      // Watch for the player crossing to the arena side, then re-seal.
      const d = dx * normal.x + dz * normal.z;
      const sign = d > CROSS_EPSILON ? 1 : d < -CROSS_EPSILON ? -1 : 0;
      if (prevSign === 0) { prevSign = sign; return; }
      if (prevSign < 0 && sign > 0) {
        block();            // crossed in — locked behind you
        sealed = true;
        setMistOpen(false); // curtain re-solidifies — sealed in
        playWhoosh();
        kickShake(0.10, 0.25);
      }
      prevSign = sign;
    },
    built,
  });
  registerFogWall();

  // Release when the boss ENCOUNTER is fully done (king + all spawns) —
  // the container is the single source of truth, so the seal can't lift
  // mid-fight when one body dropped but its spawns are still up.
  onBossEncounterComplete(() => { unblock(); setMistOpen(true); });
  return {};
}
