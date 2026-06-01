// Per-verb action handlers for the harness. Each verb either:
//   (a) mutates camera/input directly with no time cost (turn, face,
//       inspect, use), OR
//   (b) requests a tick budget that unpauses the world for a duration
//       OR until a predicate fires, then re-pauses (move, attack, wait,
//       interact).
//
// All synthetic input flows through setInputOverride() so the touch +
// desktop schemes don't clobber the harness's writes.

import type { InputState } from '../controls/input';
import { setInputOverride } from '../controls/input';
import { setCameraYaw } from '../controls/camera';
import { triggerAttack } from '../controls/attack-input';
import { useFirstConsumable } from '../controls/consumable-bar';
import { getInRangeInteractable, getAllInteractables } from '../interactables/system';
import { requestTickBudget } from './pause';
import { buildObservation } from './observation';
import { incrementTurn } from './state';
import type { HarnessContext } from './state';
import type {
  Action, ActionResult, Direction8, Observation,
} from './types';

const ROOT2_INV = 1 / Math.SQRT2;

/** Unit world-space direction per compass label. N = -Z (Three.js
 *  default camera forward at yaw=0). */
const DIRS: Record<Direction8, { wx: number; wz: number }> = {
  N:  { wx:  0,         wz: -1 },
  NE: { wx:  ROOT2_INV, wz: -ROOT2_INV },
  E:  { wx:  1,         wz:  0 },
  SE: { wx:  ROOT2_INV, wz:  ROOT2_INV },
  S:  { wx:  0,         wz:  1 },
  SW: { wx: -ROOT2_INV, wz:  ROOT2_INV },
  W:  { wx: -1,         wz:  0 },
  NW: { wx: -ROOT2_INV, wz: -ROOT2_INV },
};

const MOVE_SECONDS_DEFAULT = 0.25;
/** Cap any single attack action at this many seconds — guards against a
 *  sword state machine that gets stuck and never returns to idle. */
const ATTACK_MAX_SECONDS = 2.0;

export async function applyAction(ctx: HarnessContext, action: Action): Promise<ActionResult> {
  const start = performance.now();
  let result: Omit<ActionResult, 'observation' | 'elapsed'>;
  try {
    result = await dispatch(ctx, action);
  } catch (err) {
    result = { ok: false, reason: (err as Error).message ?? 'error' };
  }
  // Always ensure input override is cleared after an action — even on
  // throw — so a stuck override doesn't freeze controls.
  setInputOverride(null);
  ctx.input.moveX = 0;
  ctx.input.moveY = 0;

  incrementTurn();
  const elapsed = (performance.now() - start) / 1000;
  const observation = observe(ctx);
  return { ...result, elapsed, observation };
}

function observe(ctx: HarnessContext): Observation {
  const level = ctx.getLevel();
  if (!level) {
    throw new Error('[harness] no live level — action issued before ready?');
  }
  return buildObservation(ctx.camera, level);
}

async function dispatch(
  ctx: HarnessContext,
  action: Action,
): Promise<Omit<ActionResult, 'observation' | 'elapsed'>> {
  switch (action.kind) {
    case 'move':   return moveAction(ctx, action.dir, action.seconds);
    case 'turn':   return turnAction(ctx, action.angle);
    case 'face':   return faceAction(ctx, action.target);
    case 'attack': return attackAction(ctx);
    case 'interact': return interactAction();
    case 'use':    return useAction(action.slot);
    case 'wait':   return waitAction(action.seconds);
    case 'inspect': return inspectAction(ctx, action.id);
    default: {
      const exhaustive: never = action;
      void exhaustive;
      return { ok: false, reason: 'unknown-action' };
    }
  }
}

// ── Movement ─────────────────────────────────────────────────────────

async function moveAction(
  ctx: HarnessContext,
  dir: Direction8,
  seconds?: number,
): Promise<Omit<ActionResult, 'observation' | 'elapsed'>> {
  const target = DIRS[dir];
  if (!target) return { ok: false, reason: 'unknown-direction' };

  // Translate world-direction → camera-relative moveX/moveY so the
  // existing updateCamera path can consume it. See math derivation in
  // observation.ts notes.
  setInputOverride((state: InputState) => {
    const yaw = ctx.camera.rotation.y;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    state.moveX =  target.wx * cy - target.wz * sy;
    state.moveY =  target.wx * sy + target.wz * cy;
    state.lookDx = 0;
    state.lookDy = 0;
  });

  const end = await requestTickBudget({
    maxSeconds: seconds ?? MOVE_SECONDS_DEFAULT,
  });
  return { ok: true, budgetEnd: end.reason };
}

// ── Look / turn ──────────────────────────────────────────────────────

function turnAction(
  ctx: HarnessContext,
  angle: number,
): Omit<ActionResult, 'observation' | 'elapsed'> {
  // Mutate camera yaw directly. updateCamera reads yaw from the camera
  // module's internal `yaw` variable — but it also writes it back
  // every frame from lookDx. Easiest: set camera.rotation.y AND clear
  // the camera module's internal yaw via setCameraYaw.
  const newYaw = normalizeAngle(ctx.camera.rotation.y + angle);
  // Direct rotation on the camera; updateCamera resyncs from its
  // internal yaw on the next unpaused frame. Avoid driving lookDx
  // because that's sensitivity-scaled and would be imprecise.
  ctx.camera.rotation.y = newYaw;
  // Resync the camera module's internal yaw so the next frame's
  // updateCamera doesn't snap back.
  setCameraYaw(newYaw);
  return { ok: true };
}

function faceAction(
  ctx: HarnessContext,
  target: Direction8 | { id: string },
): Omit<ActionResult, 'observation' | 'elapsed'> {
  let desiredYaw: number;
  if (typeof target === 'object' && 'id' in target) {
    const level = ctx.getLevel();
    if (!level) return { ok: false, reason: 'no-level' };
    const e = level.enemies.find((x) => x.entityId === target.id);
    const interactable = e ? null : findInteractableById(target.id);
    let tx: number, tz: number;
    if (e) {
      tx = e.group.position.x;
      tz = e.group.position.z;
    } else if (interactable) {
      tx = interactable.position.x;
      tz = interactable.position.z;
    } else {
      return { ok: false, reason: 'no-target' };
    }
    const dx = tx - ctx.camera.position.x;
    const dz = tz - ctx.camera.position.z;
    desiredYaw = yawForWorldDirection(dx, dz);
  } else {
    const d = DIRS[target];
    desiredYaw = yawForWorldDirection(d.wx, d.wz);
  }
  ctx.camera.rotation.y = desiredYaw;
  setCameraYaw(desiredYaw);
  return { ok: true };
}

// ── Combat ───────────────────────────────────────────────────────────

async function attackAction(
  ctx: HarnessContext,
): Promise<Omit<ActionResult, 'observation' | 'elapsed'>> {
  // Queue an attack press. combat.tick consumes this via
  // consumeAttackPressed and calls sword.startSwing() — that doesn't
  // happen until the NEXT unpaused frame, so we gate on "we've seen
  // isSwinging flip true at least once" to avoid the predicate
  // firing on the still-idle sword in the first check.
  triggerAttack();
  let started = false;
  const end = await requestTickBudget({
    maxSeconds: ATTACK_MAX_SECONDS,
    stopWhen: () => {
      if (ctx.weapon.isSwinging) started = true;
      return started && !ctx.weapon.isSwinging;
    },
  });
  if (end.reason === 'timeout') {
    // Two distinct failure modes here:
    //   - started=false: the swing never began (player is unarmed,
    //                    combat is locked out, etc.)
    //   - started=true:  the swing began but never finished — sword
    //                    state machine is stuck.
    if (!started) return { ok: false, reason: 'no-swing', budgetEnd: end.reason };
    return { ok: false, reason: 'attack-stuck', budgetEnd: end.reason };
  }
  return { ok: true, budgetEnd: end.reason };
}

// ── Interact ─────────────────────────────────────────────────────────

async function interactAction(): Promise<Omit<ActionResult, 'observation' | 'elapsed'>> {
  const it = getInRangeInteractable();
  if (!it) return { ok: false, reason: 'no-target' };
  it.onUse();
  // Some interactables trigger side effects that need real-time ticks
  // to play out — stairs schedule a 220ms fade then a level swap, chest
  // lids animate, fountains open a result UI. Give 500ms of world time
  // so the side effect lands before we re-pause and return the obs.
  // No predicate — we don't know what the side effect will be, so
  // we just budget a window.
  const end = await requestTickBudget({ maxSeconds: 0.5 });
  return { ok: true, budgetEnd: end.reason };
}

// ── Use consumable ───────────────────────────────────────────────────

function useAction(slot: number): Omit<ActionResult, 'observation' | 'elapsed'> {
  // V1: only slot 1 is supported. useFirstConsumable picks the first
  // consumable on the bar (which is HP potion if low HP, else whatever).
  if (slot !== 1) return { ok: false, reason: 'only-slot-1-supported-in-v1' };
  useFirstConsumable();
  return { ok: true };
}

// ── Wait ─────────────────────────────────────────────────────────────

async function waitAction(seconds: number): Promise<Omit<ActionResult, 'observation' | 'elapsed'>> {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false, reason: 'invalid-duration' };
  }
  const end = await requestTickBudget({ maxSeconds: seconds });
  return { ok: true, budgetEnd: end.reason };
}

// ── Inspect ──────────────────────────────────────────────────────────

function inspectAction(
  ctx: HarnessContext,
  id: string,
): Omit<ActionResult, 'observation' | 'elapsed'> {
  // V1: inspect is read-only and surfaces extra fields via the next
  // observation. No behavior change yet — left as a no-op so callers
  // can pre-shape requests now.
  void ctx; void id;
  return { ok: true };
}

// ── Helpers ──────────────────────────────────────────────────────────

function findInteractableById(id: string) {
  return getAllInteractables().find((i) => i.id === id) ?? null;
}

/** World-space direction (dx, dz) → yaw such that camera forward at
 *  that yaw points in (dx, dz). camera.forward at yaw=0 is (0, -1)
 *  (i.e., -Z = north). yaw rotates CCW around +Y. */
function yawForWorldDirection(dx: number, dz: number): number {
  // forward(yaw) = (-sin(yaw), 0, -cos(yaw)); want (dx, dz) parallel
  // to that → atan2(-dx, -dz). Then normalize.
  return normalizeAngle(Math.atan2(-dx, -dz));
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
