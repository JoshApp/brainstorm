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

/** The directionalMoves key for an AttackDirection (strafe split L/R). */
type DirKey = 'forward' | 'back' | 'strafeLeft' | 'strafeRight';
function dirKeyOf(dir: AttackDirection): DirKey | null {
  return !dir ? null
    : dir === 'forward' ? 'forward'
    : dir === 'back' ? 'back'
    : dir === 'strafe-left' ? 'strafeLeft' : 'strafeRight';
}

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
  let comboStep = 0;            // index into the ACTIVE track's combo array
  let comboWindowExpiresAt = 0;  // seconds (internal clock basis)
  let queuedPress = false;
  // Which combo TRACK comboStep indexes — the light tap chain or the heavy
  // charged chain (hold→hold→hold). Switches on press type; resets to light on
  // window lapse / reset.
  let track: 'light' | 'heavy' = 'light';
  // Directional/charged move override — set at requestSwing when a direction
  // was held. Used in place of the combo step until cleared on idle.
  let activeDirectionalStep: ResolvedComboStep | null = null;
  // ENDER override — a charged release that cashed out a light chain. One-off
  // finisher (like a directional move); cleared on the next recover-end.
  let activeEnderStep: ResolvedComboStep | null = null;
  // Direction flavor for the combo OPENER only (comboStep 0). A tap held in a
  // direction swaps step 0 for that directional move's pose/stats, but the combo
  // still ADVANCES — moving never breaks the chain, and the second step +
  // finisher are always the fixed combo. Distinct from activeDirectionalStep so
  // the opener still buffers/chains like a normal step. Cleared each recover-end.
  let openerDirKey: DirKey | null = null;
  // Internal monotonic clock in SECONDS, advanced by advance(dt). Replaces
  // performance.now() so the machine is deterministic + testable: ticks are
  // the only source of time, so a test drives behaviour purely by advance().
  let clock = 0;

  /** The combo array comboStep indexes — the heavy chain when on the heavy track
   *  (and the weapon has one), else the light combo. */
  function comboArray(w: ReturnType<typeof getCurrentWeapon>): ResolvedComboStep[] {
    return track === 'heavy' && w.heavyCombo && w.heavyCombo.length ? w.heavyCombo : w.combo;
  }

  /** Resolve the step for the CURRENT combo index, defensively wrapping in
   *  case the weapon was swapped to a shorter combo mid-swing. Directional /
   *  ender overrides beat the combo. */
  function currentStep(): { combo: ResolvedComboStep[]; step: ResolvedComboStep } {
    const w = getCurrentWeapon();
    if (activeDirectionalStep) return { combo: w.combo, step: activeDirectionalStep };
    if (activeEnderStep) return { combo: w.combo, step: activeEnderStep };
    // OPENER flavor: a held direction swaps the light combo's step 0 for that
    // directional move — moving leans your entry, but the chain still advances.
    if (track === 'light' && comboStep === 0 && openerDirKey) {
      const v = w.directionalMoves?.[openerDirKey];
      if (v) return { combo: w.combo, step: v };
    }
    const arr = comboArray(w);
    const idx = ((comboStep % arr.length) + arr.length) % arr.length;
    return { combo: arr, step: arr[idx] };
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
      // Only the LIGHT tap chain buffers — heavy steps are discrete charged
      // presses, charged releases can't buffer, and overrides are finishers.
      // (A finisher spam-burst would otherwise wrap the combo to step 0.)
      const w = getCurrentWeapon();
      const canBuffer = track === 'light' && !opts?.skipWindup
        && activeDirectionalStep === null && activeEnderStep === null
        && comboStep < w.combo.length - 1;
      if (canBuffer) queuedPress = true;
      return false;
    }
    // Pick the active step. Priority: directional/charged-directional override,
    // then the heavy chain / ender (non-directional charged), else the light
    // combo. Charge modifiers (+reach/+cone/+damage) still stack in attack.ts.
    const w = getCurrentWeapon();
    activeDirectionalStep = null;
    activeEnderStep = null;
    const dir = opts?.direction;
    const isCharged = !!opts?.skipWindup;
    const inWindow = clock < comboWindowExpiresAt;
    const dirKey = dirKeyOf(dir ?? null);
    openerDirKey = null;
    // CHARGED + direction → a deliberate directional SPECIAL (charged move or the
    // directional move with charge bonuses), telegraphed during the hold. One-off,
    // resets the chain.
    if (isCharged && dir) {
      const chargeKey: 'forward' | 'back' | 'strafe' =
        dir === 'forward' ? 'forward' : dir === 'back' ? 'back' : 'strafe';
      const chargedMove = w.chargedMoves ? w.chargedMoves[chargeKey] : undefined;
      const directional = dirKey ? w.directionalMoves?.[dirKey] : undefined;
      activeDirectionalStep = chargedMove ?? directional ?? null;
      if (activeDirectionalStep) { comboStep = 0; track = 'light'; }
    }
    if (!activeDirectionalStep) {
      const heavy = w.heavyCombo && w.heavyCombo.length ? w.heavyCombo : null;
      if (isCharged && heavy) {
        if (track === 'light' && comboStep > 0 && inWindow && w.ender) {
          // Cash out a light chain → ENDER (one-off finisher).
          activeEnderStep = w.ender;
        } else if (track === 'heavy' && inWindow) {
          // Continue the heavy chain at the pre-advanced comboStep.
        } else {
          // Start the heavy chain fresh.
          track = 'heavy';
          comboStep = 0;
        }
      } else {
        // Light tap (or a charged release on a weapon with no heavy combo) →
        // the light track, preserving the original window/reset behaviour.
        if (track === 'heavy') { track = 'light'; comboStep = 0; }
        else if (!inWindow) comboStep = 0;
        // TAP + direction flavors ONLY the OPENER (comboStep 0). The chain still
        // advances on taps — moving never breaks it — and the second step +
        // finisher are always the fixed combo. (A charged release is handled
        // above as a special, not an opener.)
        if (!isCharged && dirKey && comboStep === 0 && w.directionalMoves?.[dirKey]) {
          openerDirKey = dirKey;
        }
      }
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
      // Combo window lapsed while idle → drop back to a fresh light step 0 so any
      // combo HUD / held-pose preview reflects the reset.
      if ((comboStep !== 0 || track !== 'light') && clock >= comboWindowExpiresAt) {
        comboStep = 0;
        track = 'light';
        openerDirKey = null;
      }
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
      if (activeEnderStep) {
        // The ender finishes the chain — back to a fresh light step 0.
        comboStep = 0;
        track = 'light';
      } else {
        comboStep = (comboStep + 1) % comboArray(w).length;
      }
      // The opener's direction flavor is spent once the swing completes — the
      // chain is now on its fixed middle/finisher (a buffered chain is a tap, no
      // direction).
      openerDirKey = null;
      if (queuedPress && canSwing()) {
        queuedPress = false;
        // A buffered chain is always a LIGHT tap (only the light track buffers) —
        // directional / ender overrides are one-off, so clear them.
        activeDirectionalStep = null;
        activeEnderStep = null;
        phase = 'windup';
        phaseTimer = 0;
        // Buffered steps are always light taps (a charged release can't be
        // buffered) → bill the light cost via charged:false.
        options.onSwingStart?.({ charged: false });
      } else {
        // No buffer, or gassed (a chain can't continue into an empty bar).
        queuedPress = false;
        activeDirectionalStep = null;
        activeEnderStep = null;
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
    isFinisherStrike: () => {
      if (phase !== 'strike') return false;
      if (activeEnderStep) return true;   // the ender is itself a finisher
      return comboStep === comboArray(getCurrentWeapon()).length - 1;
    },
    reset() {
      phase = 'idle';
      phaseTimer = 0;
      comboStep = 0;
      comboWindowExpiresAt = 0;
      queuedPress = false;
      track = 'light';
      activeDirectionalStep = null;
      activeEnderStep = null;
      openerDirKey = null;
    },
    setDebugPhase(p: SwingPhase, t: number) {
      phase = p;
      phaseTimer = t;
    },
  };
}
