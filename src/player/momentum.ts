import { CONFIG } from '../config';
import { on } from '../broadcast/event-bus';
import { isInCombat } from '../combat/combat-state';

// ── MOMENTUM — the one number that makes stride, vault and chain one system ──
//
// docs/MOVEMENT.md is the argument; this is the implementation. The short
// version: DELVE's "flutter jump" was already in the build — it is the
// edge-vault Josh found by accident — and it failed exactly one of the five
// things that make a traversal tech great. It was not ALWAYS AVAILABLE, because
// chaining it meant spending dodges, and the dodge is the whole defence.
//
// So: a hidden scalar, 0 → 1.
//
//   It BUILDS from travel you actually made. Not from holding a stick — from
//   ground covered. Walk into a wall and it drains, because you did not go
//   anywhere. Half-push the stick and it builds half as fast, because you half
//   went somewhere.
//
//   It GRANTS SPEED as it fills, which is why sprint stops being a button and
//   becomes a consequence of having run. The old hold-to-run is still here and
//   still means something — it fills momentum faster — but it no longer hands
//   you a flat multiplier the instant you press it.
//
//   It is SPENT BY A VAULT. A run-up clears what a standing step cannot. This
//   is the part that changes what the dungeon MEANS: a gap you cannot take cold
//   you can take with a straight thirty metres behind you, so the level re-reads
//   as you get better at holding a line.
//
//   It DIES IN COMBAT. Not "is gated in combat" — dies, fast, and instantly on
//   taking a hit. That is what keeps it from competing with the dodge: it is
//   not a system somebody has to remember to gate, it is a system that cannot
//   be in the room when a fight is.
//
// ── WHY IT IS FREE ───────────────────────────────────────────────────────────
//
// No stamina, no bar, no cooldown. That is deliberate and it is the property
// that makes mastery compound — a rationed tech is one you spend, not one you
// get good at. DELVE already has one bar governing the dodge, and putting the
// traversal tech on it would make every clever line a tax on your defence.
//
// ── WHY THERE IS NO METER ────────────────────────────────────────────────────
//
// A hidden scalar with no tell is unlearnable, so momentum has to be FELT: the
// view opens as it fills (fovOffset below), your stride carries further, the
// hop goes higher. The player should feel fast before they know why. A meter
// would make it a resource, and it is not one — it is a state you are in.

/** Where the number lives between frames. Module-level, per the codebase's
 *  convention, because there is exactly one player. */
let level = 0;

/** Zeroed instantly on damage — not decayed. Getting hit is the thing that
 *  stops you, and a soft decay there would let you tank a hit and keep running,
 *  which is precisely the interaction that would make this a combat tool. */
on((e) => { if (e.type === 'player:damaged') level = 0; });

/** 0 → 1. Read by anything that wants to know how much run you have in you. */
export function momentum(): number { return level; }

/** Wipe it. Floor load, death, teleport — anywhere continuity breaks. */
export function resetMomentum(): void { level = 0; }

/** Test seam. Nothing in the game sets this directly; the sim does. */
export function setMomentumForTest(v: number): void { level = Math.max(0, Math.min(1, v)); }

/**
 * THE WHOLE RULE, as a pure function, so a test exercises the shipping maths
 * rather than a copy of it (docs/DESIGN-METHOD.md).
 *
 * `travelFrac` is the fraction of a full-speed frame you ACTUALLY covered:
 * 1 for an unobstructed run, 0 for standing still or grinding along a wall,
 * something between for a half-pushed stick or a slide along a corner.
 *
 * Build is proportional to travel; decay only bites BELOW the stall line (see
 * inline). So deliberate movement at any real speed builds, while a stall or a
 * grind along a wall bleeds — which is what makes picking a clean line the
 * skill rather than making it a tax on anyone with a soft thumb.
 */
export function stepMomentum(
  current: number,
  dt: number,
  o: { travelFrac: number; holdingRun: boolean; inCombat: boolean },
): number {
  const M = CONFIG.MOMENTUM;
  if (!M.ENABLED) return 0;
  const t = Math.max(0, Math.min(1, o.travelFrac));
  // In a fight it only ever falls, however fast you are moving. Kiting must not
  // be a way to build a traversal buff.
  if (o.inCombat) return Math.max(0, current - dt / M.COMBAT_DECAY_S);
  const build = (t / M.BUILD_S) * (o.holdingRun ? M.HOLD_BUILD_MUL : 1);
  // DECAY ONLY BITES BELOW THE STALL LINE, and this shape is load-bearing.
  //
  // The first version bled in proportion to (1 - travelFrac), which reads fine
  // and is wrong on a phone: a thumb rarely pushes a virtual stick to the rim,
  // so a perfectly deliberate 60%-speed jog came out net NEGATIVE and momentum
  // was unreachable for anyone not holding the stick against the stop. The
  // mechanic would have been dead on the device it is for, and alive on the
  // keyboard it isn't.
  //
  // Above the stall line any real movement builds, just proportionally slower.
  // Below it — stopped, or grinding along a wall covering nothing — you bleed.
  const stall = Math.max(0, (M.STALL_AT - t) / M.STALL_AT);
  const decay = stall / M.DECAY_S;
  return Math.max(0, Math.min(1, current + (build - decay) * dt));
}

/**
 * Advance momentum one frame.
 *
 * `distanceMoved` is metres the player ACTUALLY travelled — after collision,
 * after sliding round an enemy. That is the whole reason this is called at the
 * end of the move rather than the start: intent is not travel, and a player
 * pushing hopefully into a pillar has not earned anything.
 */
export function tickMomentum(dt: number, distanceMoved: number, holdingRun: boolean): void {
  if (dt <= 0) return;
  const full = CONFIG.MOVE_SPEED * dt;
  const travelFrac = full > 1e-6 ? distanceMoved / full : 0;
  level = stepMomentum(level, dt, { travelFrac, holdingRun, inCombat: isInCombat() });
}

/** Speed multiplier from momentum: 1 at rest, SPEED_MUL_MAX at full.
 *  Rides the same multiplicative chain as every other move modifier, so being
 *  winded or slowed still means what it meant. */
export function momentumSpeedMul(): number {
  return 1 + (CONFIG.MOMENTUM.SPEED_MUL_MAX - 1) * level;
}

/**
 * Extra metres a vault step carries, and extra metres it rises.
 *
 * Both, on purpose. Distance is what lets you clear a wider thing; HEIGHT is
 * what changes what the level means, because it is height that turns "I cannot
 * get up there" into "I can if I run at it". Eased on the square so a trickle
 * of momentum gives almost nothing and the top of the range is where the
 * traversal actually opens up — a smeared bonus reads as the vault being
 * inconsistent rather than as you being fast.
 */
export function momentumVaultBonus(): { carryM: number; riseM: number } {
  const k = level * level;
  return {
    carryM: CONFIG.MOMENTUM.VAULT_CARRY_BONUS_M * k,
    riseM: CONFIG.MOMENTUM.VAULT_RISE_BONUS_M * k,
  };
}

/** Degrees to open the view by. The tell — see the header on why it is this and
 *  not a meter. Eased on the square for the same reason as the vault bonus: the
 *  opening should read as a threshold you crossed, not a slider you nudged. */
export function momentumFovOffset(): number {
  return CONFIG.MOMENTUM.FOV_MAX_DEG * level * level;
}
