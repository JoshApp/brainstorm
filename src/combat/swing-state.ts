import { getCurrentWeapon } from '../player/current-weapon';
import type { ResolvedComboStep } from '../content/weapon-classes';

// The swing/combo SIMULATION — extracted from the viewmodel so the
// feel-critical logic (phase machine, combo progression, input buffering,
// directional/charged overrides) lives in one pure, presentation-free,
// unit-testable place. The viewmodel is now just a VIEW that reads this to
// pose the weapon; combat reads it for hit windows + lifecycle events.
//
// "Separate the model from the view": this module is the model (the authority
// for "did a swing happen, which combo step, are we in the hit window"); the
// THREE.Group pose is a downstream view of it. Nothing in here imports three.
//
// State machine:
//   idle    — at rest. A press starts a swing.
//   windup  — winding up. Charged releases SKIP this (already paid by holding).
//   strike  — the HIT WINDOW. combat reads isStriking() to gate raycasts.
//   recover — locked-out follow-through. comboStep advances when this ends.

/** Movement intent at press time — picked from the joystick in
 *  combat/attack.ts. A directional/charged move overrides the normal combo
 *  step (lunge, sweep, retreat, ward). Strafe splits L/R. */
export type AttackDirection = 'forward' | 'back' | 'strafe-left' | 'strafe-right' | null;

export type SwingPhase = 'idle' | 'windup' | 'strike' | 'recover';

export interface SwingStateOptions {
  /** Fired every time a NEW windup (or charged strike) begins — the first
   *  press AND every buffered combo chain. This is the single per-real-swing
   *  event: combat wires whoosh + the 'attack:swing' emit + stamina spend here,
   *  so cost is billed once per swing, never per button press. `charged` is
   *  true only for a charged release (skipWindup). */
  onSwingStart?: (info: { charged: boolean }) => void;
  /** Gate: may a swing START right now? Combat passes the stamina check (a
   *  sliver is enough — Elden Ring-style), so a swing won't begin OR a combo
   *  chain into an empty bar. Defaults to always-allowed. The initial press is
   *  also gated by combat before requestSwing, but this keeps the sim
   *  self-consistent and stops buffered chains continuing while gassed. */
  canSwing?: () => boolean;
}

export interface SwingState {
  /** Begin a swing if idle; otherwise buffer the next combo step (unless the
   *  current step is the finisher). Returns whether a swing actually started. */
  requestSwing(opts?: { skipWindup?: boolean; direction?: AttackDirection }): boolean;
  /** Advance the simulation by dt seconds: ages the clock, drives phase
   *  transitions, advances/chains the combo, fires onSwingStart on chains. */
  advance(dt: number): void;
  getPhase(): SwingPhase;
  /** 0..1 progress through the current phase (idle → 0). The view interpolates
   *  the pose with this; combat doesn't need it. */
  getPhaseProgress(): number;
  /** The resolved step the swing is currently animating — ALWAYS non-null
   *  (used by the view for the idle/rest pose too). */
  getCurrentStep(): ResolvedComboStep;
  /** Combat contract: the active step, or null when idle. */
  getActiveStep(): ResolvedComboStep | null;
  /** Current combo index (0-based). For a combo HUD and for tests. */
  getComboStep(): number;
  isStriking(): boolean;
  isSwinging(): boolean;
  isFinisherStrike(): boolean;
  /** Wipe in-flight swing/combo state (weapon swap). */
  reset(): void;
  /** Debug-only: jump straight to a phase + phase timer (no transition). */
  setDebugPhase(phase: SwingPhase, phaseTimer: number): void;
}

export function createSwingState(options: SwingStateOptions = {}): SwingState {
  const canSwing = options.canSwing ?? (() => true);
  let phase: SwingPhase = 'idle';
  let phaseTimer = 0;            // seconds into the current phase
  let comboStep = 0;            // index into the weapon's combo array
  let comboWindowExpiresAt = 0;  // seconds (internal clock basis)
  let queuedPress = false;
  // Directional/charged move override — set at requestSwing when a direction
  // was held. Used in place of the combo step until cleared on idle.
  let activeDirectionalStep: ResolvedComboStep | null = null;
  // Internal monotonic clock in SECONDS, advanced by advance(dt). Replaces
  // performance.now() so the machine is deterministic + testable: ticks are
  // the only source of time, so a test drives behaviour purely by advance().
  let clock = 0;

  /** Resolve the step for the CURRENT combo index, defensively wrapping in
   *  case the weapon was swapped to a shorter combo mid-swing. Directional
   *  override beats the combo. */
  function currentStep(): { combo: ResolvedComboStep[]; step: ResolvedComboStep } {
    const w = getCurrentWeapon();
    if (activeDirectionalStep) return { combo: w.combo, step: activeDirectionalStep };
    const idx = ((comboStep % w.combo.length) + w.combo.length) % w.combo.length;
    return { combo: w.combo, step: w.combo[idx] };
  }

  function phaseDuration(): number {
    const { step } = currentStep();
    return phase === 'windup' ? step.windupTime
      : phase === 'strike' ? step.strikeTime
      : step.recoverTime;
  }

  function requestSwing(opts?: { skipWindup?: boolean; direction?: AttackDirection }): boolean {
    // Can't START a swing on an empty bar (combat gates this too, with the HUD
    // flash; this is the sim staying self-consistent).
    if (phase === 'idle' && !canSwing()) return false;
    if (phase !== 'idle') {
      // Mid-swing press buffers the next combo step UNLESS the current step is
      // the finisher (last in the array) — a finisher spam-burst would
      // otherwise wrap the combo and auto-start a fresh chain at step 0.
      const w = getCurrentWeapon();
      const isFinisher = comboStep >= w.combo.length - 1;
      if (!isFinisher) queuedPress = true;
      return false;
    }
    // Pick the active step. Lookup order (highest priority first):
    //   1. CHARGED + direction → chargedMoves[dir] (ward / spin / plunge)
    //   2. direction → directionalMoves[dir] (lunge / sweeps / retreat)
    //   3. neither → normal combo step
    // Charge modifiers (+reach/+cone/+damage) still stack in attack.ts.
    // Firing a directional/charged override resets the combo to step 0.
    const w = getCurrentWeapon();
    activeDirectionalStep = null;
    const dir = opts?.direction;
    const isCharged = !!opts?.skipWindup;
    if (dir) {
      const chargeKey: 'forward' | 'back' | 'strafe' =
        dir === 'forward' ? 'forward' : dir === 'back' ? 'back' : 'strafe';
      const dirKey =
        dir === 'forward' ? 'forward' :
        dir === 'back' ? 'back' :
        dir === 'strafe-left' ? 'strafeLeft' : 'strafeRight';
      const chargedMove = isCharged && w.chargedMoves ? w.chargedMoves[chargeKey] : undefined;
      const directional = w.directionalMoves ? w.directionalMoves[dirKey] : undefined;
      activeDirectionalStep = chargedMove ?? directional ?? null;
      if (activeDirectionalStep) comboStep = 0;
    }
    // No override + past the combo window → previous chain is dead, restart at
    // step 0. Inside the window, comboStep was pre-advanced at the last
    // recover-end, so fire whatever it currently is.
    if (!activeDirectionalStep && clock >= comboWindowExpiresAt) {
      comboStep = 0;
    }
    // Charged release skips windup — the player already paid by holding; the
    // cocked-back idle pose blends seamlessly into the strike's t=0 pose.
    phase = opts?.skipWindup ? 'strike' : 'windup';
    phaseTimer = 0;
    options.onSwingStart?.({ charged: isCharged });
    return true;
  }

  function advance(dt: number) {
    clock += dt;

    if (phase === 'idle') {
      // Combo window lapsed while idle → drop back to step 0 so any combo HUD
      // / held-pose preview reflects the reset.
      if (comboStep !== 0 && clock >= comboWindowExpiresAt) comboStep = 0;
      return;
    }

    phaseTimer += dt;
    if (phaseTimer < phaseDuration()) return;

    if (phase === 'windup') {
      phase = 'strike';
      phaseTimer = 0;
    } else if (phase === 'strike') {
      phase = 'recover';
      phaseTimer = 0;
    } else {
      // Recover ended — pre-advance the combo and either chain straight into
      // the next windup (a press buffered) or open the idle combo window.
      const w = getCurrentWeapon();
      comboStep = (comboStep + 1) % w.combo.length;
      if (queuedPress && canSwing()) {
        queuedPress = false;
        // A buffered chain always advances the COMBO — directional moves are
        // one-off, so a buffered press falls back to the next combo step.
        activeDirectionalStep = null;
        phase = 'windup';
        phaseTimer = 0;
        // Buffered steps are always light taps (a charged release can't be
        // buffered) → bill the light cost via charged:false.
        options.onSwingStart?.({ charged: false });
      } else {
        // No buffer, or gassed (a chain can't continue into an empty bar).
        queuedPress = false;
        activeDirectionalStep = null;
        comboWindowExpiresAt = clock + w.comboWindowMs / 1000;
        phase = 'idle';
        phaseTimer = 0;
      }
    }
  }

  return {
    requestSwing,
    advance,
    getPhase: () => phase,
    getPhaseProgress: () => (phase === 'idle' ? 0 : Math.min(1, phaseTimer / Math.max(phaseDuration(), 0.001))),
    getCurrentStep: () => currentStep().step,
    getActiveStep: () => (phase === 'idle' ? null : currentStep().step),
    getComboStep: () => comboStep,
    isStriking: () => phase === 'strike',
    isSwinging: () => phase !== 'idle',
    isFinisherStrike: () => phase === 'strike' && comboStep === getCurrentWeapon().combo.length - 1,
    reset() {
      phase = 'idle';
      phaseTimer = 0;
      comboStep = 0;
      comboWindowExpiresAt = 0;
      queuedPress = false;
      activeDirectionalStep = null;
    },
    setDebugPhase(p: SwingPhase, t: number) {
      phase = p;
      phaseTimer = t;
    },
  };
}
