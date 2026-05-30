// Dev-only mid-floor snapshot — preserves the player's POSE + HP +
// BUFFS across a dev hot-reload (DEV AUTO-UPDATE setting). Mob and
// interactable state still reset on reload; this just keeps the player
// where they were instead of teleporting them back to the floor's
// spawn point.
//
// Lifecycle:
//   - captureDevSnapshot() runs JUST BEFORE the dev-mode applyUpdate
//     triggers a reload. Writes to localStorage under the current
//     floor id.
//   - applyDevSnapshot() runs from main.ts's onLoaded after the
//     floor builds. If the snapshot's floor id matches the loaded
//     floor, we restore pose/HP/buffs, then clear the snapshot
//     (one-shot — a second reload would have written a fresh one).
//   - clearDevSnapshot() runs on player:killed and on level:loaded
//     when the floor id differs (i.e. the player descended after
//     the snapshot was taken).
//
// Not used by live auto-update — that path takes the update during
// the next level transition, so the player would land at the new
// floor's spawn anyway. This is strictly for the "patch mid-floor"
// dev iteration loop.

import * as THREE from 'three';
import type { ActiveBuff, Entity } from '../ecs/types';
import { setCameraYaw, setCameraPitch } from '../controls/camera';

const STORAGE_KEY = 'delve:dev-snap';
const SNAPSHOT_VERSION = 1;

interface DevSnapshot {
  version: number;
  floorId: string;
  /** Camera position. The Y component is whatever PLAYER_HEIGHT was at
   *  capture time; we don't trust it across builds (CONFIG might
   *  change), so the apply side resets Y from CONFIG.PLAYER_HEIGHT. */
  posX: number;
  posZ: number;
  yaw: number;
  pitch: number;
  hp: number;
  buffs: Array<{ specId: string; remaining: number; stacks: number }>;
  /** ms timestamp so we can refuse stale snapshots (e.g. dev left a
   *  browser tab idle overnight). Snapshots older than ~30 min are
   *  discarded — better to drop the player at spawn than to restore
   *  state that's no longer meaningful. */
  takenAt: number;
}

const MAX_AGE_MS = 30 * 60 * 1000;   // 30 minutes

/** Capture the player's pose + health + buffs to localStorage. Called
 *  on the dev-mode update path right before applyUpdate. */
export function captureDevSnapshot(
  floorId: string,
  camera: THREE.PerspectiveCamera,
  player: Entity,
): void {
  if (!player.hp) return;   // Player entities always have hp — guard for safety.
  const snap: DevSnapshot = {
    version: SNAPSHOT_VERSION,
    floorId,
    posX: camera.position.x,
    posZ: camera.position.z,
    yaw: camera.rotation.y,
    pitch: camera.rotation.x,
    hp: player.hp.current,
    buffs: player.buffs.map((b) => ({
      specId: b.specId,
      remaining: b.remaining,
      stacks: b.stacks,
    })),
    takenAt: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota / disabled — silently no-op */
  }
}

function readSnapshot(): DevSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as DevSnapshot;
    if (snap.version !== SNAPSHOT_VERSION) return null;
    if (Date.now() - snap.takenAt > MAX_AGE_MS) {
      // Stale — discard.
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

/** Apply a pending snapshot if one exists AND it matches the loaded
 *  floor. Restores camera pose, player HP, and active buffs. Clears
 *  the snapshot after applying (one-shot). Returns true if applied. */
export function applyDevSnapshot(
  loadedFloorId: string,
  camera: THREE.PerspectiveCamera,
  player: Entity,
  playerHeightY: number,
): boolean {
  const snap = readSnapshot();
  if (!snap) return false;
  if (snap.floorId !== loadedFloorId) {
    // Snapshot belongs to a different floor — drop it. The player has
    // crossed floors since the snapshot was taken (e.g. they reloaded
    // mid-fade and the reload landed on the new floor naturally).
    clearDevSnapshot();
    return false;
  }

  // ── Camera pose ─────────────────────────────────────────────────────
  camera.position.set(snap.posX, playerHeightY, snap.posZ);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = snap.yaw;
  camera.rotation.x = snap.pitch;
  // The camera-controls module tracks yaw/pitch in module-level state.
  // Without these, the next input frame would snap back to module values.
  setCameraYaw(snap.yaw);
  setCameraPitch(snap.pitch);

  // ── Player HP + buffs ───────────────────────────────────────────────
  if (player.hp) {
    player.hp.current = Math.max(1, Math.min(snap.hp, player.hp.base));
  }
  // Replace the buff list. The level just built; the player has no
  // residual buffs from the previous frame's pre-reload state, so we
  // can write fresh entries directly without dedup.
  player.buffs.length = 0;
  for (const b of snap.buffs) {
    const restored: ActiveBuff = {
      specId: b.specId,
      remaining: b.remaining,
      stacks: b.stacks,
      tickAccumulator: 0,
      sourceId: undefined,
    };
    player.buffs.push(restored);
  }

  clearDevSnapshot();
  return true;
}

/** Drop the snapshot — called on player:killed and when level:loaded
 *  reports a different floor (player descended after the snapshot). */
export function clearDevSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
