import { CONFIG } from '../config';
import { gameNow } from '../engine/game-clock';
import { isDodging } from '../combat/dash';
import { isInCombat } from '../combat/combat-state';
import { playWhoosh } from '../audio/sfx';

// THE VAULT STEP — walking over the knee-high stuff instead of stopping dead.
//
// The dungeon is full of things you could obviously step over: a fallen pillar
// segment, a low rubble bank, the lip of a crack. Collision treats them as
// walls, so in first person, on a phone, walking into one reads as the game
// being broken rather than as terrain. You already CAN clear them — the dodge
// vaults (combat/dash.ts `dashOverActive`) — which means the geometry is
// correct and only the ordinary walk was missing.
//
// So: walk into a vaultable obstacle with a clear landing beyond it, and you go
// over. No button, no charge, no stamina.
//
// ── THE RULE THAT MAKES IT SAFE ──────────────────────────────────────────────
// THE DODGE ALWAYS WINS. A vault must never fire while dodging, while a swing
// is live, or with a fight on. If it could, a panic-dodge toward a low wall
// might serve you a traversal move instead of your i-frames — losing your
// defensive option to a convenience feature, in a game where that option is the
// whole defence. Out of combat this is traversal polish; in combat it does not
// exist. That's a hard gate, not a heuristic, because the failure is a betrayal
// rather than a bug.

/** How the camera moves through a vault. Short — this is a step, not a stunt. */
const RISE_M = 0.42;         // how high the eye arcs over the obstacle
const CARRY_M = 1.15;        // forward distance the step covers

let activeUntil = 0;
let startedAt = 0;
let dirX = 0, dirZ = 0;
let fromX = 0, fromZ = 0;

/** Is a vault step playing right now? Movement input is carried by it. */
export function isVaulting(): boolean { return gameNow() < activeUntil; }

/**
 * The eye's vertical offset through the step — a single arc up and back down.
 * 0 when not vaulting, so the caller can add it unconditionally.
 */
export function vaultHeightOffset(): number {
  if (!isVaulting()) return 0;
  const k = (gameNow() - startedAt) / (CONFIG.VAULT.DURATION_S * 1000);
  return Math.sin(Math.max(0, Math.min(1, k)) * Math.PI) * RISE_M;
}

/** Where the vault wants the player this frame, or null when none is running. */
export function vaultPosition(): { x: number; z: number } | null {
  if (!isVaulting()) return null;
  const k = Math.max(0, Math.min(1, (gameNow() - startedAt) / (CONFIG.VAULT.DURATION_S * 1000)));
  // Ease-out: most of the ground is covered early, so the landing settles
  // rather than arriving at speed.
  const e = 1 - (1 - k) * (1 - k);
  return { x: fromX + dirX * CARRY_M * e, z: fromZ + dirZ * CARRY_M * e };
}

export interface VaultProbe {
  /** True when a straight line from here to there crosses ONLY vaultable
   *  obstacles and lands on valid floor. The dodge's own test — reused so a
   *  walk-vault can never clear something a dodge couldn't. */
  canDashOver(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
}

/**
 * Consider starting a vault. Call it on the frame the walk was BLOCKED —
 * that's the honest trigger, because it means the player pushed into something
 * and the world said no.
 *
 * Returns true when a vault began (the caller should stop applying ordinary
 * movement this frame and read vaultPosition instead).
 */
export function tryVaultStep(
  x: number, z: number,
  moveX: number, moveZ: number,
  radius: number,
  walkable: VaultProbe,
): boolean {
  if (!CONFIG.VAULT.ENABLED) return false;
  if (isVaulting()) return false;
  // THE DODGE ALWAYS WINS — see the header. All three of these are absolute.
  if (isDodging()) return false;
  if (isInCombat()) return false;

  const len = Math.hypot(moveX, moveZ);
  if (len < 0.35) return false;   // must be genuinely walking INTO it, not brushing
  const nx = moveX / len, nz = moveZ / len;
  if (!walkable.canDashOver(x, z, x + nx * CARRY_M, z + nz * CARRY_M, radius)) return false;

  fromX = x; fromZ = z;
  dirX = nx; dirZ = nz;
  startedAt = gameNow();
  activeUntil = startedAt + CONFIG.VAULT.DURATION_S * 1000;
  playWhoosh();
  return true;
}

/** Drop any in-flight vault (death, level load, teleport). */
export function cancelVaultStep(): void {
  activeUntil = 0;
}
