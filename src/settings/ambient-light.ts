import { getSettings } from './settings';
import { setWickFillMul } from '../scene/light-pool';
import { setDisplayLegibility } from '../style/render-frame';

// THE ROOM YOU ARE ACTUALLY IN — driving the wick from the phone's light sensor.
//
// DELVE is authored for a dark room. Played on a bus at noon, the dungeon's whole
// bottom end — the part the game is made of — collapses into a grey screen with
// some orange dots on it, and the player has no idea they are missing anything.
// The wick ritual exists for exactly this (settings.wick RE-TARGETS the dark:
// it lifts the darkness-weighted floor and the ambient fills together while
// torch pools and signal lights stay at authored levels, so the chiaroscuro
// hierarchy survives sunlight) — but it asks the player to notice the problem,
// go find a bonfire and calibrate. The sensor just knows.
//
// SO: this reads ambient lux and produces a MULTIPLIER on the player's own wick.
// It never overwrites their calibration; it rides on top of it, so someone who
// tended the fire in a dark room still gets their darkness back the moment they
// step out of the sun.
//
// ── What actually works on a phone ────────────────────────────────────────────
// AmbientLightSensor is a Generic Sensor API class. Honesty about support,
// because it changes what this module is for:
//   - Chrome/Android: implemented, but behind the "Generic Sensor Extra Classes"
//     flag for most builds, and it requires a permission and a secure context.
//   - Safari/iOS: not implemented, and Apple has been explicit about not
//     shipping it (fingerprinting surface).
// So on most phones today this module does NOTHING and must do nothing LOUDLY —
// no permission prompt the player didn't ask for, no error, no console noise.
// It is written as a capability that switches itself on where it exists. The
// wick ritual remains the answer everywhere else, which is why this only ever
// nudges the wick rather than replacing it.

/** Sensor readings are noisy and a room's light changes slowly. Time constant
 *  for the exponential smoother, in seconds. Deliberately long: a hand passing
 *  over the phone, or a bus going under a bridge, must not pump the exposure.
 *  This is the difference between "adapts" and "flickers". */
const SMOOTH_TAU_S = 6.0;

/** Below this the room is dark enough that the authored darkness is correct.
 *  ~ a dim living room at night. */
const DARK_LUX = 12;

/** At and above this we give the full lift — direct daylight, or close.
 *  Mapping is on a LOG scale because perceived brightness is: the useful range
 *  runs across three orders of magnitude and a linear ramp spends all of itself
 *  in the first 5% of it. */
const BRIGHT_LUX = 4000;

/** The most the sensor may lift the wick, as a multiplier on the player's own
 *  setting. Capped deliberately: past this the dungeon stops being dark, and a
 *  game that silently un-darkens itself is worse than one you can't see. If the
 *  sun genuinely beats this, the player is meant to move. */
const MAX_LIFT = 1.85;

type SensorLike = {
  addEventListener(type: string, fn: () => void): void;
  start(): void;
  stop(): void;
  illuminance?: number;
};

let sensor: SensorLike | null = null;
let rawLux: number | null = null;
let smoothedLux: number | null = null;
/** The live multiplier. 1 until we have a reading, and 1 forever where the
 *  sensor does not exist — every consumer can multiply unconditionally. */
let lift = 1;
let supported = false;
let running = false;

/** Is there a sensor on this device that we were allowed to read? False on iOS,
 *  false on a flagless Chrome — the settings UI uses this to explain itself
 *  rather than showing a toggle that does nothing. */
export function ambientLightSupported(): boolean { return supported; }

/** The last smoothed reading in lux, or null when we have none. For the settings
 *  readout and the debug overlay — seeing the number is how you tell "the sensor
 *  is wrong" from "the mapping is wrong". */
export function ambientLux(): number | null { return smoothedLux; }

/**
 * The multiplier the ambient sensor wants to apply to the player's wick.
 * 1 when unsupported, disabled, or in a dark room.
 */
export function ambientWickLift(): number {
  return getSettings().autoWick ? lift : 1;
}

/** Map lux to a wick multiplier on a log ramp between DARK_LUX and BRIGHT_LUX. */
export function liftForLux(lux: number): number {
  if (!(lux > 0)) return 1;
  if (lux <= DARK_LUX) return 1;
  const t = Math.log(lux / DARK_LUX) / Math.log(BRIGHT_LUX / DARK_LUX);
  return 1 + Math.min(1, Math.max(0, t)) * (MAX_LIFT - 1);
}

/**
 * Advance the smoother. Called from the frame loop — the sensor pushes readings
 * at its own rate (often ~5Hz or slower), and we do the easing here so the lift
 * moves at a rate the eye reads as adaptation rather than as a flicker.
 */
export function tickAmbientLight(dt: number): void {
  if (rawLux === null) return;
  if (smoothedLux === null) smoothedLux = rawLux;
  else {
    const k = 1 - Math.exp(-dt / SMOOTH_TAU_S);
    smoothedLux += (rawLux - smoothedLux) * k;
  }
  lift = liftForLux(smoothedLux);
}

/**
 * Try to start reading the sensor. Safe to call unconditionally and safe to call
 * twice. Never throws, never prompts where it can't deliver, and never logs on
 * the (very common) unsupported path — an unsupported capability is not an
 * error, and a console line per boot on every iPhone is just noise.
 */
export async function startAmbientLight(): Promise<void> {
  if (running) return;
  const Ctor = (globalThis as { AmbientLightSensor?: new (o: { frequency: number }) => SensorLike })
    .AmbientLightSensor;
  if (!Ctor) return;

  // Ask permission FIRST where the Permissions API knows about it. Constructing
  // the sensor without a grant throws a SecurityError asynchronously into an
  // error event, which is a worse way to find out.
  try {
    const perms = (navigator as unknown as {
      permissions?: { query(d: { name: string }): Promise<{ state: string }> };
    }).permissions;
    if (perms?.query) {
      const status = await perms.query({ name: 'ambient-light-sensor' });
      if (status.state === 'denied') return;
    }
  } catch {
    // The Permissions API may not know this name — that is not a refusal, so
    // fall through and let the construction below be the real test.
  }

  try {
    // 2Hz: the smoother owns the response curve, so there is nothing to gain
    // from a fast sensor and there is battery to lose.
    const s = new Ctor({ frequency: 2 });
    s.addEventListener('reading', () => {
      const v = s.illuminance;
      if (typeof v === 'number' && isFinite(v) && v >= 0) rawLux = v;
    });
    s.addEventListener('error', () => { stopAmbientLight(); });
    s.start();
    sensor = s;
    supported = true;
    running = true;
  } catch {
    // Blocked, unavailable, or refused. Stay silent and stay at 1.
    supported = false;
  }
}

/** The most the sensor may push DAYLIGHT LEGIBILITY on top of the player's own
 *  choice. Same shape as MAX_LIFT above and the same reasoning: it rides on the
 *  setting rather than replacing it, so someone who picked "dark room" indoors
 *  still gets a readable screen when they walk outside, and gets their darkness
 *  back when they come in. Capped below 1 so the sensor alone can never flatten
 *  the game to its most washed-out state — that remains a deliberate choice. */
const MAX_DAYLIGHT_BOOST = 0.55;

/** How much legibility the measured room wants ON TOP of the player's setting.
 *  0 when unsupported, disabled, or in a dark room — so this is always safe to
 *  add unconditionally. */
export function ambientDaylightBoost(): number {
  if (!getSettings().autoWick || smoothedLux === null) return 0;
  return boostForLux(smoothedLux);
}

/** Log ramp between DARK_LUX and BRIGHT_LUX, same curve the wick lift uses —
 *  perceived brightness is logarithmic and a linear ramp spends itself in the
 *  first few percent of the useful range. */
export function boostForLux(lux: number): number {
  if (!(lux > 0) || lux <= DARK_LUX) return 0;
  const t = Math.log(lux / DARK_LUX) / Math.log(BRIGHT_LUX / DARK_LUX);
  return Math.min(1, Math.max(0, t)) * MAX_DAYLIGHT_BOOST;
}

/** The player's choice plus whatever the sensor is asking for, clamped. THE one
 *  place the two combine, so the settings screen and the sensor cannot disagree
 *  about who last wrote it. */
export function effectiveDaylight(): number {
  return Math.min(1, Math.max(0, getSettings().daylight + ambientDaylightBoost()));
}

let appliedDaylight = -1;

/** Push the effective daylight legibility into the render grade. Called every
 *  frame; early-outs unless the value actually moved. */
export function applyDaylight(): void {
  const d = effectiveDaylight();
  if (Math.abs(d - appliedDaylight) < 0.002) return;
  appliedDaylight = d;
  setDisplayLegibility(d);
}

let appliedWick = -1;

/**
 * Push the EFFECTIVE wick — the player's own calibration times whatever the
 * sensor is asking for — into the light pool.
 *
 * The single place the wick reaches the renderer, so the settings screen and the
 * sensor can't disagree about who last wrote it. Early-outs unless the value
 * actually moved: this runs every frame and the light pool's fill multiplier is
 * not free to re-derive.
 */
export function applyAmbientWick(): void {
  const w = getSettings().wick * ambientWickLift();
  if (Math.abs(w - appliedWick) < 0.002) return;
  appliedWick = w;
  setWickFillMul(Math.pow(w, 1.5));
}

/** Stop reading and fall back to the player's own wick. Idempotent. */
export function stopAmbientLight(): void {
  try { sensor?.stop(); } catch { /* already gone */ }
  sensor = null;
  running = false;
  rawLux = null;
  smoothedLux = null;
  lift = 1;
  appliedDaylight = -1;
}
