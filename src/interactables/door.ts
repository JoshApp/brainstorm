import * as THREE from 'three';
import type { DoorSpec } from '../level/types';
import type { StyleMaterials } from '../style/materials';
import type { WalkableRegion, WallSegment } from '../level/walkable';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { on as onEvent } from '../broadcast/event-bus';
import { playChestOpen } from '../audio/sfx';

// Door = a hinged panel that plugs a doorway. Three states:
//   sealed   — locked by an unlock condition (e.g. room not cleared). No
//              interact prompt; collision wall is up.
//   closed   — unlocked, ready to be opened. Prompt 'OPEN'; collision up.
//   opening  — swinging the panel. Collision wall comes DOWN at the start
//              of the swing (so the player can step through as it opens).
//   open     — fully open. No prompt; no collision wall.
//
// The interact prompt visibility hinges on promptLabel — empty string means
// inert (the system module already respects that).

const OPEN_DURATION = 0.6;          // seconds for swing animation
const OPEN_ANGLE = Math.PI * 0.55;  // ~100° — feels like the door swings clear
const DOOR_THICKNESS = 0.08;
const DOOR_HEIGHT_FALLBACK = 2.8;

export function spawnDoor(
  parent: THREE.Object3D,
  spec: DoorSpec,
  walkable: WalkableRegion,
  materials: StyleMaterials,
  enemyRoomMembership: () => Map<string, number>, // roomId -> alive count
) {
  // Geometry: a flat plank in the doorway. The wall segment is axis-aligned
  // so the door is axis-aligned. Width = segment length; thickness pulled
  // from DOOR_THICKNESS.
  const dx = spec.bx - spec.ax;
  const dz = spec.bz - spec.az;
  const length = Math.hypot(dx, dz);
  const height = spec.height ?? DOOR_HEIGHT_FALLBACK;

  // Hinge pivot — one end of the segment. The door rotates about a vertical
  // axis at this point.
  const hingeEnd = spec.hinge ?? 'a';
  const hingeX = hingeEnd === 'a' ? spec.ax : spec.bx;
  const hingeZ = hingeEnd === 'a' ? spec.az : spec.bz;
  // Vector from hinge to the OTHER end. The panel will be aligned along this.
  const farX = hingeEnd === 'a' ? spec.bx : spec.ax;
  const farZ = hingeEnd === 'a' ? spec.bz : spec.az;
  const fdx = farX - hingeX;
  const fdz = farZ - hingeZ;
  // Initial rotation aligning a +X-axis-extending panel with hinge→far.
  const initialYaw = Math.atan2(fdz, fdx);

  // Build a group at the hinge so rotation pivots correctly. The panel mesh
  // sits inside, offset +X by length/2 (its center).
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, 0, hingeZ);
  pivot.rotation.y = initialYaw;
  parent.add(pivot);

  const panelGeo = new THREE.BoxGeometry(length, height, DOOR_THICKNESS);
  const panel = new THREE.Mesh(panelGeo, materials.wall);
  panel.position.set(length / 2, height / 2, 0);
  panel.castShadow = true;
  panel.receiveShadow = true;
  pivot.add(panel);

  // Iron banding — horizontal strips + a vertical center seam. Distinguishes
  // the door from a plain wall slab at a glance, even in shadow. Slight
  // emissive + brighter color so torches catch them and they read at distance.
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a25,
    roughness: 0.5,
    metalness: 0.8,
    emissive: 0x382010,
    emissiveIntensity: 0.7,
  });
  for (const bandY of [height * 0.25, height * 0.75]) {
    const bandGeo = new THREE.BoxGeometry(length * 0.94, 0.09, DOOR_THICKNESS + 0.018);
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(length / 2, bandY, 0);
    pivot.add(band);
  }
  // Central iron stud / lock plate — visual anchor at handle height.
  const stud = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, DOOR_THICKNESS + 0.03),
    bandMat,
  );
  stud.position.set(length * 0.78, height * 0.5, 0);
  pivot.add(stud);

  // Wall segment that represents the door's collision while closed. Identity
  // matters: WalkableRegion add/remove by reference.
  const wallSeg: WallSegment = { ax: spec.ax, az: spec.az, bx: spec.bx, bz: spec.bz };
  walkable.addWall(wallSeg);

  // Determine swing direction. The +X axis of the local pivot is the panel's
  // length direction. Rotating about Y by +angle pulls the far end into the
  // hinge's +Z side; -angle into the -Z side. spec.swingDir picks which.
  const swingSign = spec.swingDir ?? 1;
  const targetAngle = swingSign * OPEN_ANGLE;

  let state: 'sealed' | 'closed' | 'opening' | 'open' = 'closed';
  let openTimer = 0;

  // Door center for the interactable hit position.
  const cx = (spec.ax + spec.bx) / 2;
  const cz = (spec.az + spec.bz) / 2;

  const interactable = {
    id: generateEntityId(`door-${spec.id}`),
    position: new THREE.Vector3(cx, 0, cz),
    radius: 1.4,
    promptLabel: '',  // set per state below
    onUse() {
      if (state !== 'closed') return;
      state = 'opening';
      openTimer = 0;
      interactable.promptLabel = '';
      // Walls come down at the START of the swing — feels much better than
      // waiting for the door to be 100% open. Player can flow through.
      walkable.removeWall(wallSeg);
      playChestOpen();  // creaky hinge sfx reused — chests + doors share vibe
    },
    tick(dt: number) {
      // Check unlock progression every frame (cheap — just a map lookup).
      if (state === 'sealed' && isUnlocked()) {
        state = 'closed';
        interactable.promptLabel = 'OPEN';
      }
      if (state === 'opening') {
        openTimer += dt;
        const t = Math.min(1, openTimer / OPEN_DURATION);
        // Ease-out so the door slows as it reaches open
        const ease = 1 - (1 - t) * (1 - t);
        pivot.rotation.y = initialYaw + targetAngle * ease;
        if (openTimer >= OPEN_DURATION) {
          state = 'open';
        }
      }
    },
    destroyed: false,
    /** When destroyed, system removes built.group from parent. Wrap pivot. */
    built: { group: pivot, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };

  // Initial unlock state. If sealed condition isn't satisfied at spawn,
  // mark as sealed; tick() will flip to closed automatically when it is.
  function isUnlocked(): boolean {
    if (!spec.unlock) return true;
    if (spec.unlock.kind === 'cleared') {
      const counts = enemyRoomMembership();
      for (const roomId of spec.unlock.roomIds) {
        if ((counts.get(roomId) ?? 0) > 0) return false;
      }
      return true;
    }
    return true;
  }
  if (!isUnlocked()) {
    state = 'sealed';
    interactable.promptLabel = 'SEALED';
  } else {
    interactable.promptLabel = 'OPEN';
  }

  // Subscribe to room-clear events for sealed-state UX punch — when the
  // unlock condition flips, we want feedback (the SEALED label goes away
  // immediately even without a re-tick).
  const unsubscribe = onEvent((event) => {
    if (event.type !== 'room:cleared') return;
    if (state !== 'sealed') return;
    if (isUnlocked()) {
      state = 'closed';
      interactable.promptLabel = 'OPEN';
      // A subtle "unsealed" chime might go here later. For now silent.
    }
  });

  registerInteractable(interactable);

  // Return a teardown helper so level cleanup can detach this door's
  // listener. Without this, draining listeners pile up across descent.
  return { teardown: () => { unsubscribe(); } };
}
