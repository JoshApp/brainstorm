import { getCurrentWeapon } from '../player/current-weapon';
import type { ResolvedComboStep } from '../content/weapon-classes';
import { CONFIG } from '../config';

// Extra grace ms added to the combo window when the just-finished step was on
// the HEAVY track. Sized to a full melee charge time (CHARGED_COST /
// RESERVE_PER_SEC) so chaining heavies actually works: a heavy release pre-
// advances comboStep, the player then HAS to hold to charge the next one, and
// the cadence-set comboWindowMs alone (~380-520ms) lapses before the charge
// completes — so by the time the next release fires it's "out of window" and
// the chain resets. This pushes the window out far enough that a back-to-back
// charged release lands inside it, while a fully-cooled-down press still
// starts a fresh chain.
function heavyChargeGraceMs(): number {
  return (CONFIG.STAMINA.CHARGED_COST / CONFIG.CHARGE.RESERVE_PER_SEC) * 1000;
}

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
  /** Abort the current windup/strike — jump straight to recover so the swing
   *  visibly ends short. Used when the blade clanks into a wall: the wall
   *  bounced you off, the strike is done, the recover plays from here. No-op
   *  when not actively swinging. */
  interruptSwing(): void;
  /** Debug-only: jump straight to a phase + phase timer (no transition). */
  setDebugPhase(phase: SwingPhase, phaseTimer: number): void;
}

// The combo BUFFER only opens toward the END of the current swing. A press
// during windup (or the early active frames) is too soon to bank the next
// attack — without this gate a fast double-tap during windup queues a second
// swing the player never meant. The buffer opens once the strike is this far
// through, and stays open across the whole recover (the natural chain window).
const BUFFER_OPEN_STRIKE_FRAC = 0.5;

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
  //
  // Applies to BOTH tracks:
  //   - LIGHT track → looks up w.directionalMoves[openerDirKey] for the opener.
  //   - HEAVY track → looks up w.chargedMoves[chargeKey] first (the dedicated
  //     charged variant — sword's ward-back, etc.), falling back to
  //     w.directionalMoves[openerDirKey]. The heavy chain then advances 2, 3
  //     unflavored, same as the light pattern.
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
    // OPENER flavor: a held direction swaps step 0 for the directional variant.
    // The chain still advances on the next press — direction flavors the
    // OPENER ONLY, never the middle or finisher. Symmetric across light/heavy:
    //   - LIGHT → directionalMoves[dirKey]
    //   - HEAVY → chargedMoves[chargeKey] (dedicated charged variant, e.g.
    //     sword's ward-back) first, then directionalMoves[dirKey] as fallback.
    if (comboStep === 0 && openerDirKey) {
      if (track === 'heavy') {
        const chargeKey: 'forward' | 'back' | 'strafe' =
          openerDirKey === 'forward' ? 'forward'
          : openerDirKey === 'back'  ? 'back'
          : 'strafe';
        const chargedMove = w.chargedMoves?.[chargeKey];
        if (chargedMove) return { combo: comboArray(w), step: chargedMove };
        const directional = w.directionalMoves?.[openerDirKey];
        if (directional) return { combo: comboArray(w), step: directional };
      } else {
        const v = w.directionalMoves?.[openerDirKey];
        if (v) return { combo: w.combo, step: v };
      }
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

  /** Is the swing late enough to accept a buffered combo chain? Recover is
   *  always open; the strike opens only past BUFFER_OPEN_STRIKE_FRAC; windup is
   *  never open — that's the "double-tap too early banks a second swing" bug. */
  function inBufferWindow(): boolean {
    if (phase === 'recover') return true;
    if (phase === 'strike') {
      const { step } = currentStep();
      return step.strikeTime <= 0 || phaseTimer >= step.strikeTime * BUFFER_OPEN_STRIKE_FRAC;
    }
    return false;
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
        && comboStep < w.combo.length - 1
        && inBufferWindow();   // only late-strike + recover — never windup
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
    const heavy = w.heavyCombo && w.heavyCombo.length ? w.heavyCombo : null;
    if (isCharged && heavy) {
      // CHARGED + heavy combo present → enter / advance the heavy 1-2-3.
      // Direction (if any) FLAVORS the heavy opener — same pattern as a light
      // tap with direction — and then the heavy chain runs unflavored on the
      // next press. The previous behaviour overrode the chain entirely whenever
      // direction was held, so heavy 1-2-3 never actually started against a
      // moving player.
      if (track === 'light' && comboStep > 0 && inWindow && w.ender) {
        // Cash out a light chain → ENDER (one-off finisher).
        activeEnderStep = w.ender;
      } else if (track === 'heavy' && inWindow) {
        // Continue the heavy chain at the pre-advanced comboStep — direction
        // ignored past the opener.
      } else {
        // Start the heavy chain fresh.
        track = 'heavy';
        comboStep = 0;
      }
      // Opener flavor: heavy step 0 only. currentStep() resolves chargedMoves
      // first, then directionalMoves, so the dedicated charged variants (e.g.
      // sword's ward-back) front the heavy chain when held.
      if (track === 'heavy' && comboStep === 0 && dirKey
          && (w.chargedMoves || w.directionalMoves?.[dirKey])) {
        openerDirKey = dirKey;
      }
    } else if (isCharged && dir) {
      // Charged + direction on a weapon WITHOUT a heavy chain → the original
      // one-off directional / charged-directional special (no chain to feed
      // into). Resets to light for the recover, like an ender.
      const chargeKey: 'forward' | 'back' | 'strafe' =
        dir === 'forward' ? 'forward' : dir === 'back' ? 'back' : 'strafe';
      const chargedMove = w.chargedMoves ? w.chargedMoves[chargeKey] : undefined;
      const directional = dirKey ? w.directionalMoves?.[dirKey] : undefined;
      activeDirectionalStep = chargedMove ?? directional ?? null;
      if (activeDirectionalStep) { comboStep = 0; track = 'light'; }
    } else if (isCharged && track === 'light' && comboStep > 0 && inWindow && w.ender) {
      // Charged release with no direction cashing out a light chain → ENDER,
      // for weapons without a heavy chain that still ship an ender.
      activeEnderStep = w.ender;
    } else {
      // Light tap (or a charged release on a weapon with no heavy combo / no
      // ender path) → the light track, preserving the original window/reset
      // behaviour.
      if (track === 'heavy') { track = 'light'; comboStep = 0; }
      else if (!inWindow) comboStep = 0;
      // TAP + direction flavors ONLY the OPENER (comboStep 0). The chain still
      // advances on taps — moving never breaks it — and the second step +
      // finisher are always the fixed combo.
      if (!isCharged && dirKey && comboStep === 0 && w.directionalMoves?.[dirKey]) {
        openerDirKey = dirKey;
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
        // Heavy chain → extend the window by the typical charge time so the
        // player has room to hold the next heavy to full. Light chain → bare
        // comboWindowMs (taps are fast, no charge to wait through).
        const graceMs = track === 'heavy' ? heavyChargeGraceMs() : 0;
        comboWindowExpiresAt = clock + (w.comboWindowMs + graceMs) / 1000;
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
    interruptSwing() {
      // Only meaningful from windup / strike. Jump to recover with phaseTimer
      // zeroed so the recover curve plays from its start pose (= the strike's
      // END pose) toward idle. The clank-back impulse on the viewmodel masks
      // the brief snap from current-strike-pose to recover-start.
      if (phase === 'windup' || phase === 'strike') {
        phase = 'recover';
        phaseTimer = 0;
        // Drop any buffered chain — you can't chain through a wall.
        queuedPress = false;
      }
    },
  };
}
