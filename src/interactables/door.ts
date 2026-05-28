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
const CLOSE_DURATION = 0.22;        // arena slam — much faster than the open swing
const OPEN_ANGLE = Math.PI * 0.55;  // ~100° — feels like the door swings clear
const DOOR_THICKNESS = 0.08;
const DOOR_HEIGHT_FALLBACK = 2.8;

export function spawnDoor(
  parent: THREE.Object3D,
  spec: DoorSpec,
  walkable: WalkableRegion,
  materials: StyleMaterials,
  enemyRoomMembership: () => Map<string, number>, // roomId -> alive count
  wallHeight: number = DOOR_HEIGHT_FALLBACK,
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

  // ── Lintel ─────────────────────────────────────────────────────────
  // Static wall block above the door, filling from the top of the door
  // panel up to the room's ceiling. Without this the doorway has an
  // open gap above the door reaching the ceiling — you can see right
  // through into the next room over the top of the closed door.
  // Parented to the LEVEL ROOT (not the pivot) so it stays put while
  // the door swings. Match the wall's surface material so it reads
  // continuous with the wall around it.
  const lintelHeight = Math.max(0, wallHeight - height);
  if (lintelHeight > 0.02) {
    const lintelGeo = new THREE.BoxGeometry(length, lintelHeight, DOOR_THICKNESS);
    const lintel = new THREE.Mesh(lintelGeo, materials.wall);
    const cxL = (spec.ax + spec.bx) / 2;
    const czL = (spec.az + spec.bz) / 2;
    const yawL = Math.atan2(spec.bz - spec.az, spec.bx - spec.ax);
    lintel.position.set(cxL, height + lintelHeight / 2, czL);
    lintel.rotation.y = yawL;
    lintel.receiveShadow = true;
    lintel.castShadow = true;
    parent.add(lintel);
  }

  // Wall segment that represents the door's collision while closed. Identity
  // matters: WalkableRegion add/remove by reference.
  const wallSeg: WallSegment = { ax: spec.ax, az: spec.az, bx: spec.bx, bz: spec.bz };
  walkable.addWall(wallSeg);

  // ── Threshold light ────────────────────────────────────────────────
  // A faint emissive strip on the floor along the doorway, parented to
  // the LEVEL ROOT (not the pivot) so it doesn't swing with the panel.
  // Reads from a distance as "passage here" — guides the eye even when
  // the room beyond is dark + the door itself is in shadow. Color
  // shifts cool/sealed → warm/open as the door's state changes.
  const cxThresh = (spec.ax + spec.bx) / 2;
  const czThresh = (spec.az + spec.bz) / 2;
  const lengthThresh = Math.hypot(spec.bx - spec.ax, spec.bz - spec.az);
  const thresholdMat = new THREE.MeshBasicMaterial({
    color: 0x8c5a30,
    transparent: true,
    opacity: 0.6,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const thresholdGeo = new THREE.BoxGeometry(lengthThresh * 0.92, 0.04, 0.18);
  const threshold = new THREE.Mesh(thresholdGeo, thresholdMat);
  threshold.position.set(cxThresh, 0.025, czThresh);
  // Rotate the strip to align with the door span (so it spans the
  // doorway, not crossing it perpendicular).
  const ang = Math.atan2(spec.bz - spec.az, spec.bx - spec.ax);
  threshold.rotation.y = -ang;
  parent.add(threshold);

  // Determine swing direction. The +X axis of the local pivot is the panel's
  // length direction. Rotating about Y by +angle pulls the far end into the
  // hinge's +Z side; -angle into the -Z side. spec.swingDir picks which.
  const swingSign = spec.swingDir ?? 1;
  const targetAngle = swingSign * OPEN_ANGLE;

  // State machine. Adds two new states beyond the classic
  // sealed/closed/opening/open progression to support arena
  // lock-on-enter:
  //   'arena-open' — door starts OPEN + passable; tick watches the
  //                  player's side relative to the door's axis and
  //                  triggers the slam the FRAME the side flips
  //                  (the player just walked through). Works for
  //                  perimeter doors AND interior-wall doors.
  //   'closing'    — fast reverse animation. Wall returns IMMEDIATELY
  //                  at the start so the player can't squeeze back
  //                  out mid-slam. Ends in 'sealed' (with the
  //                  cleared-unlock condition taking it the rest of
  //                  the way).
  let state: 'arena-open' | 'sealed' | 'closed' | 'opening' | 'closing' | 'open' = 'closed';
  let openTimer = 0;
  let closeTimer = 0;
  // Committed-side trigger state. We track the side of the door the
  // player has CLEARLY committed to — not just where their centre
  // sits. "Clearly" means at least COMMIT_THRESHOLD past the door's
  // axis along the perpendicular. While they're inside the doorway
  // (distance < threshold) we don't update the committed side, so the
  // slam fires only ONCE the player has stepped fully clear of the
  // door onto the other side. Critical for the wall-add: if we slam
  // while the player's collision circle still straddles the door
  // axis, the new wall ends up INSIDE the player and clampMove blocks
  // every direction — trapping them in the doorway.
  //
  // PLAYER_RADIUS (camera.ts) is 0.30; threshold is 0.40 for safety.
  const COMMIT_THRESHOLD = 0.40;
  let committedSide: 1 | -1 | null = null;
  // Door axis perpendicular (unit vector in XZ). Cached.
  const doorAxisLen = Math.hypot(spec.bx - spec.ax, spec.bz - spec.az) || 1;
  const perpX = -(spec.bz - spec.az) / doorAxisLen;
  const perpZ =  (spec.bx - spec.ax) / doorAxisLen;
  const doorMidX = (spec.ax + spec.bx) / 2;
  const doorMidZ = (spec.az + spec.bz) / 2;

  // Door center for the interactable hit position.
  const cx = (spec.ax + spec.bx) / 2;
  const cz = (spec.az + spec.bz) / 2;

  const interactable = {
    id: generateEntityId(`door-${spec.id}`),
    position: new THREE.Vector3(cx, 0, cz),
    radius: 1.4,
    // Door labels at hand-height — the door is 2m+ tall and its
    // position pivot is at the FOOT. The default 0.6m offset reads as
    // knee-height; 1.4m lands the label right over the lock plate.
    labelOffsetY: 1.4,
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
    tick(_dt: number, playerPos: THREE.Vector3) {
      // Arena trigger: while open + passable, watch the player's
      // COMMITTED side of the door's axis. Slam when the committed
      // side changes (player walked through AND stepped clear). The
      // door doesn't slam mid-cross — that would add a wall inside
      // the player's collision circle and trap them in the doorway.
      if (state === 'arena-open' && spec.unlock?.kind === 'arena') {
        const ox = playerPos.x - doorMidX;
        const oz = playerPos.z - doorMidZ;
        const dot = perpX * ox + perpZ * oz;
        // Only update the committed side when the player is CLEARLY
        // past the door. Inside the doorway: leave the committed
        // side alone (waits for the player to step through fully).
        if (Math.abs(dot) >= COMMIT_THRESHOLD) {
          const newSide: 1 | -1 = dot >= 0 ? 1 : -1;
          if (committedSide !== null && newSide !== committedSide) {
            // SLAM. Wall up immediately, audio sting, threshold
            // flashes cool/sealed; the closing animation runs over
            // the next CLOSE_DURATION.
            state = 'closing';
            closeTimer = 0;
            walkable.addWall(wallSeg);
            playChestOpen();
            thresholdMat.color.setHex(0xb04030);   // brief red — visual punch
            thresholdMat.opacity = 0.75;
          }
          committedSide = newSide;
        }
      }
      // Closing animation — reverses the swing fast.
      if (state === 'closing') {
        closeTimer += _dt;
        const t = Math.min(1, closeTimer / CLOSE_DURATION);
        // Ease-IN (start slow, accelerate) so the slam feels weighty
        // at the end rather than thudding instantly.
        const ease = t * t;
        pivot.rotation.y = initialYaw + targetAngle * (1 - ease);
        if (closeTimer >= CLOSE_DURATION) {
          state = 'sealed';
          interactable.promptLabel = 'SEALED';
          // Threshold settles to the cool/sealed colour now that the
          // slam flash is done.
          thresholdMat.color.setHex(0x405060);
          thresholdMat.opacity = 0.35;
        }
      }
      // Check unlock progression every frame (cheap — just a map lookup).
      if (state === 'sealed' && isUnlocked()) {
        state = 'closed';
        interactable.promptLabel = 'OPEN';
        // Sealed → closed: threshold warms up. Subtle "the way is now
        // open" cue beyond the SEALED-label flip.
        thresholdMat.color.setHex(0x8c5a30);
        thresholdMat.opacity = 0.6;
      }
      if (state === 'opening') {
        openTimer += _dt;
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
  // Both 'cleared' AND 'arena' use the same predicate once the door is
  // in the sealed state — arena just adds the lock-on-enter trigger
  // that gets it there in the first place.
  function isUnlocked(): boolean {
    if (!spec.unlock) return true;
    if (spec.unlock.kind === 'cleared' || spec.unlock.kind === 'arena') {
      const counts = enemyRoomMembership();
      for (const roomId of spec.unlock.roomIds) {
        if ((counts.get(roomId) ?? 0) > 0) return false;
      }
      return true;
    }
    return true;
  }
  // Initial visible/passable state, branching on unlock kind:
  //   arena   → starts OPEN + passable; tick triggers the slam.
  //   cleared → standard "sealed until cleared" behaviour.
  //   none    → closed, ready to open on use.
  if (spec.unlock?.kind === 'arena') {
    state = 'arena-open';
    interactable.promptLabel = '';
    // Remove the collision wall: the doorway is passable.
    walkable.removeWall(wallSeg);
    // Render the panel at the visibly-open angle.
    pivot.rotation.y = initialYaw + targetAngle;
    // Threshold uses the warm/open palette while the door is
    // arena-open so the player can read it as "passable now."
    thresholdMat.color.setHex(0x8c5a30);
    thresholdMat.opacity = 0.6;
  } else if (!isUnlocked()) {
    state = 'sealed';
    interactable.promptLabel = 'SEALED';
    // Sealed: cool gray threshold — reads as "passage exists, but
    // closed off." Still visible from distance so the eye finds it.
    thresholdMat.color.setHex(0x405060);
    thresholdMat.opacity = 0.35;
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
      thresholdMat.color.setHex(0x8c5a30);
      thresholdMat.opacity = 0.6;
    }
  });

  registerInteractable(interactable);

  // Return a teardown helper so level cleanup can detach this door's
  // listener. Without this, draining listeners pile up across descent.
  return { teardown: () => { unsubscribe(); } };
}
