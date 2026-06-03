import * as THREE from 'three';
import type { DoorSpec } from '../level/types';
import type { StyleMaterials } from '../style/materials';
import type { WalkableRegion, WallSegment } from '../level/walkable';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { on as onEvent } from '../broadcast/event-bus';
import { playChestOpen, playImpact } from '../audio/sfx';
import { hasEncounter, isEncounterComplete, activateEncounter } from '../encounters/registry';
import { arenaEncounterId } from '../level/arena-waves';

// Door = the thing that plugs a doorway. Two physical kinds, chosen by
// whether the door is GATED (has an unlock condition):
//
//   • Hinged panel (ungated 'o' doors) — a plank you walk up to and OPEN.
//     Swings about a vertical hinge. States: closed → opening → open.
//
//   • Portcullis (gated 'O'/'D' doors) — an iron grate the DUNGEON drops
//     and raises. No handle: a cleared-gate is barred until you clear the
//     room; an arena-gate drops the moment you step in and winches back up
//     when the last enemy falls. Reads as a trap, not a courtesy. Slides
//     on Y: dropped (sealed) ↔ raised (passable, teeth peeking from the
//     lintel). States: arena-open / sealed → closing(drop) / opening(rise)
//     → open.
//
// Shared states:
//   sealed   — locked by the unlock condition. Collision wall up. Label
//              'SEALED'. (Portcullis only — ungated doors are never sealed.)
//   closed   — unlocked hinged panel, ready to open. Prompt 'OPEN'.
//   opening  — animating toward passable. Collision wall drops at the
//              START so the player can flow through as it moves.
//   open     — fully passable. No prompt, no collision.
//
// The interact prompt visibility hinges on promptLabel — empty string means
// inert (the system module already respects that).

const OPEN_DURATION = 0.6;          // hinged swing animation
const CLOSE_DURATION = 0.22;        // arena slam — much faster than the open swing
const OPEN_ANGLE = Math.PI * 0.55;  // ~100° — feels like the door swings clear
const DOOR_THICKNESS = 0.08;
const DOOR_HEIGHT_FALLBACK = 2.8;

// Portcullis vertical-slide timings + travel.
const GATE_DROP_DURATION = 0.30;    // the slam — accelerates into the floor
const GATE_RISE_DURATION = 1.15;    // the winch — slow, mechanical, deliberate
const GATE_RAISED_PEEK = 0.20;      // when raised, the grate stops this far below
                                    // the lintel so the spike teeth still hang
                                    // visible in the opening (a sprung trap).

export function spawnDoor(
  parent: THREE.Object3D,
  spec: DoorSpec,
  walkable: WalkableRegion,
  materials: StyleMaterials,
  enemyRoomMembership: () => Map<string, number>, // roomId -> alive count
  wallHeight: number = DOOR_HEIGHT_FALLBACK,
) {
  const dx = spec.bx - spec.ax;
  const dz = spec.bz - spec.az;
  const length = Math.hypot(dx, dz);
  const height = spec.height ?? DOOR_HEIGHT_FALLBACK;

  // A door is a GATE (portcullis) iff it carries an unlock condition.
  // Plain interact-to-open doors stay hinged panels.
  const isGate = !!spec.unlock;

  // Door center + the wall-line yaw (used to align the portcullis with
  // the opening, and for the lintel/threshold which are center-anchored).
  const cx = (spec.ax + spec.bx) / 2;
  const cz = (spec.az + spec.bz) / 2;
  const doorYaw = Math.atan2(spec.bz - spec.az, spec.bx - spec.ax);

  // ── Hinge geometry (ungated panel only) ─────────────────────────────
  // Hinge pivot — one end of the segment. The door rotates about a vertical
  // axis at this point.
  const hingeEnd = spec.hinge ?? 'a';
  const hingeX = hingeEnd === 'a' ? spec.ax : spec.bx;
  const hingeZ = hingeEnd === 'a' ? spec.az : spec.bz;
  const farX = hingeEnd === 'a' ? spec.bx : spec.ax;
  const farZ = hingeEnd === 'a' ? spec.bz : spec.az;
  const initialYaw = Math.atan2(farZ - hingeZ, farX - hingeX);

  // The animated group. For a hinged panel it pivots at the hinge and
  // rotates on Y; for a portcullis it sits at the door center and slides
  // on Y. `raisedY` is how far up a portcullis travels when open.
  const group = new THREE.Group();
  const raisedY = Math.max(0.1, height - GATE_RAISED_PEEK);

  if (isGate) {
    group.position.set(cx, 0, cz);
    group.rotation.y = doorYaw;
    buildPortcullis(group, length, height);
  } else {
    group.position.set(hingeX, 0, hingeZ);
    group.rotation.y = initialYaw;
    buildHingedPanel(group, length, height, materials);
  }
  parent.add(group);

  // ── Lintel ─────────────────────────────────────────────────────────
  // Static wall block above the opening, filling from the top of the door
  // up to the room's ceiling — without it you'd see through the gap above
  // the door into the next room. Parented to the LEVEL ROOT (not the
  // animated group) so it stays put while the door swings/slides. It also
  // hides the raised portcullis bars, which tuck up behind it.
  const lintelHeight = Math.max(0, wallHeight - height);
  if (lintelHeight > 0.02) {
    const lintelGeo = new THREE.BoxGeometry(length, lintelHeight, DOOR_THICKNESS);
    const lintel = new THREE.Mesh(lintelGeo, materials.wall);
    lintel.position.set(cx, height + lintelHeight / 2, cz);
    lintel.rotation.y = doorYaw;
    lintel.receiveShadow = true;
    lintel.castShadow = true;
    parent.add(lintel);
  }

  // Wall segment that represents the door's collision while closed. Identity
  // matters: WalkableRegion add/remove by reference.
  const wallSeg: WallSegment = { ax: spec.ax, az: spec.az, bx: spec.bx, bz: spec.bz };
  walkable.addWall(wallSeg);

  // ── Threshold light ────────────────────────────────────────────────
  // A faint emissive strip on the floor along the doorway. Reads from a
  // distance as "passage here." Color shifts cool/sealed → warm/open.
  const lengthThresh = length;
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
  threshold.position.set(cx, 0.025, cz);
  threshold.rotation.y = -doorYaw;
  parent.add(threshold);

  // Hinged swing direction. +X of the local pivot is the panel length dir.
  const swingSign = spec.swingDir ?? 1;
  const targetAngle = swingSign * OPEN_ANGLE;

  // State machine. Hinged path uses rotation; gate path uses group.position.y.
  //   'arena-open' — gate starts raised + passable; tick watches the
  //                  player's committed side and drops the grate the frame
  //                  they step clear into the arena.
  //   'closing'    — gate slam (fast Y drop) / hinged reverse swing. The
  //                  collision wall returns IMMEDIATELY at the start so the
  //                  player can't squeeze back out mid-slam.
  let state: 'arena-open' | 'sealed' | 'closed' | 'opening' | 'closing' | 'open' = 'closed';
  let openTimer = 0;
  let closeTimer = 0;

  // Committed-side trigger state (arena slam). We track the side of the
  // door the player has CLEARLY committed to — at least COMMIT_THRESHOLD
  // past the door axis — so the slam fires only ONCE the player has
  // stepped fully clear of the doorway. Slamming while their collision
  // circle still straddles the door axis would drop a wall INSIDE them and
  // trap them in the gap.
  const COMMIT_THRESHOLD = 0.40;
  let committedSide: 1 | -1 | null = null;
  const doorAxisLen = Math.hypot(spec.bx - spec.ax, spec.bz - spec.az) || 1;
  const perpX = -(spec.bz - spec.az) / doorAxisLen;
  const perpZ =  (spec.bx - spec.ax) / doorAxisLen;
  const doorMidX = cx;
  const doorMidZ = cz;

  // ── Animation helpers ───────────────────────────────────────────────
  // Set the visible pose for a given progress. Hinged: rotate; gate: slide.
  const setSealedPose = () => {
    if (isGate) group.position.y = 0;            // grate down, teeth at floor
    else group.rotation.y = initialYaw;          // panel shut
  };
  const setOpenPose = () => {
    if (isGate) group.position.y = raisedY;       // grate up in the lintel
    else group.rotation.y = initialYaw + targetAngle;
  };

  const interactable = {
    id: generateEntityId(`door-${spec.id}`),
    position: new THREE.Vector3(cx, 0, cz),
    radius: 1.4,
    // Labels at hand-height — the door pivot is at the FOOT.
    labelOffsetY: 1.4,
    promptLabel: '',  // set per state below
    onUse() {
      // Only ungated hinged doors are opened by hand. Gates are automatic.
      if (state !== 'closed') return;
      state = 'opening';
      openTimer = 0;
      interactable.promptLabel = '';
      // Wall comes down at the START of the swing — player can flow through.
      walkable.removeWall(wallSeg);
      playChestOpen();  // creaky hinge
    },
    tick(_dt: number, playerPos: THREE.Vector3) {
      // Arena trigger: while raised + passable, watch the player's COMMITTED
      // side of the door axis. Drop the grate when the committed side flips
      // (player walked through AND stepped clear).
      if (state === 'arena-open' && spec.unlock?.kind === 'arena') {
        const ox = playerPos.x - doorMidX;
        const oz = playerPos.z - doorMidZ;
        const dot = perpX * ox + perpZ * oz;
        if (Math.abs(dot) >= COMMIT_THRESHOLD) {
          const newSide: 1 | -1 = dot >= 0 ? 1 : -1;
          if (committedSide !== null && newSide !== committedSide) {
            // SLAM. Wall up immediately, heavy impact, threshold flashes red.
            state = 'closing';
            closeTimer = 0;
            walkable.addWall(wallSeg);
            playImpact(interactable.position);
            thresholdMat.color.setHex(0xb04030);
            thresholdMat.opacity = 0.75;
            // Trip the wave-gauntlet encounter — it summons the waves and
            // stays unresolved (gate stays down) until they're all dead.
            for (const rid of spec.unlock?.roomIds ?? []) activateEncounter(arenaEncounterId(rid));
          }
          committedSide = newSide;
        }
      }

      // Closing — gate slam (Y drop, ease-IN so it accelerates and SLAMS)
      // or hinged reverse swing.
      if (state === 'closing') {
        closeTimer += _dt;
        const dur = isGate ? GATE_DROP_DURATION : CLOSE_DURATION;
        const t = Math.min(1, closeTimer / dur);
        const ease = t * t;            // accelerate into the impact
        if (isGate) group.position.y = raisedY * (1 - ease);
        else pivotRotate(group, initialYaw, targetAngle, 1 - ease);
        if (closeTimer >= dur) {
          state = 'sealed';
          interactable.promptLabel = 'SEALED';
          setSealedPose();
          thresholdMat.color.setHex(0x405060);
          thresholdMat.opacity = 0.35;
        }
      }

      // Unlock progression. A sealed GATE winches itself back up the frame
      // the room clears — no walk-up, no OPEN prompt (it's a trap, not a
      // door). A hinged door (only ever sealed in the legacy cleared case)
      // would become openable, but gated doors are always portcullises now.
      if (state === 'sealed' && isUnlocked()) {
        if (isGate) {
          state = 'opening';
          openTimer = 0;
          interactable.promptLabel = '';
          walkable.removeWall(wallSeg);   // passable as it rises
          playChestOpen();                // winch creak
          thresholdMat.color.setHex(0x8c5a30);
          thresholdMat.opacity = 0.6;
        } else {
          state = 'closed';
          interactable.promptLabel = 'OPEN';
          thresholdMat.color.setHex(0x8c5a30);
          thresholdMat.opacity = 0.6;
        }
      }

      // Opening — gate rise (ease-OUT, slow winch) or hinged swing.
      if (state === 'opening') {
        openTimer += _dt;
        const dur = isGate ? GATE_RISE_DURATION : OPEN_DURATION;
        const t = Math.min(1, openTimer / dur);
        const ease = 1 - (1 - t) * (1 - t);   // slow to a stop at the top
        if (isGate) group.position.y = raisedY * ease;
        else pivotRotate(group, initialYaw, targetAngle, ease);
        if (openTimer >= dur) {
          state = 'open';
          setOpenPose();
        }
      }
    },
    destroyed: false,
    /** When destroyed, system removes built.group from parent. */
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };

  // Unlock predicate — 'cleared' AND 'arena' share it once the door is in
  // the sealed state; arena just adds the lock-on-enter trigger that gets
  // it there.
  function isUnlocked(): boolean {
    if (!spec.unlock) return true;
    if (spec.unlock.kind === 'cleared' || spec.unlock.kind === 'arena') {
      for (const roomId of spec.unlock.roomIds) {
        // Arena rooms run a wave-gauntlet ENCOUNTER: defer to it, so the gate
        // stays down through the slam + inter-wave lulls and only rises when
        // the gauntlet is fully resolved. Non-arena rooms use the live enemy
        // count as before.
        if (hasEncounter(arenaEncounterId(roomId))) {
          if (!isEncounterComplete(arenaEncounterId(roomId))) return false;
        } else if ((enemyRoomMembership().get(roomId) ?? 0) > 0) {
          return false;
        }
      }
      return true;
    }
    return true;
  }

  // Initial visible/passable state.
  //   arena            → starts raised + passable; tick triggers the slam.
  //   gate, unlocked   → already open (room empty at spawn): raised + passable.
  //   gate, locked     → sealed: grate down, wall up.
  //   ungated          → closed hinged panel, ready to open on use.
  if (spec.unlock?.kind === 'arena') {
    state = 'arena-open';
    interactable.promptLabel = '';
    walkable.removeWall(wallSeg);
    setOpenPose();
    thresholdMat.color.setHex(0x8c5a30);
    thresholdMat.opacity = 0.6;
  } else if (isGate) {
    if (isUnlocked()) {
      state = 'open';
      interactable.promptLabel = '';
      walkable.removeWall(wallSeg);
      setOpenPose();
    } else {
      state = 'sealed';
      interactable.promptLabel = 'SEALED';
      setSealedPose();
      thresholdMat.color.setHex(0x405060);
      thresholdMat.opacity = 0.35;
    }
  } else {
    state = 'closed';
    interactable.promptLabel = 'OPEN';
  }

  // Sealed-state UX punch — when the unlock flips via the room-clear event,
  // kick the gate into its rise immediately (don't wait for the next tick).
  const unsubscribe = onEvent((event) => {
    if (event.type !== 'room:cleared') return;
    if (state !== 'sealed') return;
    if (!isUnlocked()) return;
    if (isGate) {
      state = 'opening';
      openTimer = 0;
      interactable.promptLabel = '';
      walkable.removeWall(wallSeg);
      playChestOpen();
      thresholdMat.color.setHex(0x8c5a30);
      thresholdMat.opacity = 0.6;
    } else {
      state = 'closed';
      interactable.promptLabel = 'OPEN';
      thresholdMat.color.setHex(0x8c5a30);
      thresholdMat.opacity = 0.6;
    }
  });

  registerInteractable(interactable);

  return { teardown: () => { unsubscribe(); } };
}

/** Rotate a hinged pivot to initialYaw + targetAngle * frac. */
function pivotRotate(group: THREE.Group, initialYaw: number, targetAngle: number, frac: number) {
  group.rotation.y = initialYaw + targetAngle * frac;
}

// ── Geometry builders ──────────────────────────────────────────────────

/** Hinged plank with iron banding — the classic ungated door. Built into
 *  `pivot`, offset +X by length/2 so it extends from the hinge. */
function buildHingedPanel(
  pivot: THREE.Group, length: number, height: number, materials: StyleMaterials,
) {
  const panelGeo = new THREE.BoxGeometry(length, height, DOOR_THICKNESS);
  // Timber plank (was stone) — with the existing iron bands it now reads as
  // a banded wooden door rather than a sliding stone slab.
  const panel = new THREE.Mesh(panelGeo, materials.timber);
  panel.position.set(length / 2, height / 2, 0);
  panel.castShadow = true;
  panel.receiveShadow = true;
  pivot.add(panel);

  const bandMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a25, roughness: 0.5, metalness: 0.8,
    emissive: 0x382010, emissiveIntensity: 0.7,
  });
  for (const bandY of [height * 0.25, height * 0.75]) {
    const bandGeo = new THREE.BoxGeometry(length * 0.94, 0.09, DOOR_THICKNESS + 0.018);
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(length / 2, bandY, 0);
    pivot.add(band);
  }
  const stud = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, DOOR_THICKNESS + 0.03), bandMat,
  );
  stud.position.set(length * 0.78, height * 0.5, 0);
  pivot.add(stud);
}

/** Iron portcullis — vertical bars + horizontal rails + pointed teeth at
 *  the bottom, built into `group` centered on the opening. Local +X runs
 *  along the wall line; bars stand on +Y; the whole group slides on Y to
 *  drop/raise. */
function buildPortcullis(group: THREE.Group, length: number, height: number) {
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x2a2622, roughness: 0.55, metalness: 0.85,
    emissive: 0x140a06, emissiveIntensity: 0.5,
  });
  const BAR = 0.06;
  const RAIL = 0.075;
  const inset = 0.07;                       // keep bars off the stone jambs
  const span = Math.max(0.2, length - inset * 2);
  const nBars = Math.max(2, Math.round(span / 0.34));

  for (let i = 0; i < nBars; i++) {
    const x = nBars === 1 ? 0 : -span / 2 + (i * span) / (nBars - 1);
    // Vertical bar.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(BAR, height - 0.02, BAR), ironMat);
    bar.position.set(x, height / 2, 0);
    bar.castShadow = true;
    group.add(bar);
    // Pointed tooth at the foot — the bite of the trap.
    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(BAR * 0.95, 0.22, 6), ironMat,
    );
    tooth.position.set(x, -0.05, 0);
    tooth.rotation.x = Math.PI;             // point down
    tooth.castShadow = true;
    group.add(tooth);
  }

  // Horizontal cross-rails tie the bars together.
  for (const railY of [height * 0.16, height * 0.5, height * 0.84]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(length - inset, RAIL, RAIL * 0.7), ironMat,
    );
    rail.position.set(0, railY, 0);
    rail.castShadow = true;
    group.add(rail);
  }

  // Thicker edge runners — the bars that ride the wall grooves.
  for (const ex of [-span / 2, span / 2]) {
    const runner = new THREE.Mesh(
      new THREE.BoxGeometry(BAR * 1.5, height, BAR * 1.5), ironMat,
    );
    runner.position.set(ex, height / 2, 0);
    runner.castShadow = true;
    group.add(runner);
  }
}
