import * as THREE from 'three';
import { CONFIG } from '../config';

// ── FLOOR ARRIVAL — wake at the bonfire ──────────────────────────────
//
// Every floor begins seated at the threshold fire, and the transition
// is WAKING, not fading: two soft eyelids part from black, sag once in
// a heavy half-blink, then open fully while the camera stands from the
// seat into eye height. One clock drives lids and rise together.

const SIT_HEIGHT = 0.92;

// Two ceremonies (anti-staleness): the FULL wake — sit, heavy blink,
// blur-to-focus — plays where the fiction says you slept (run start,
// the tutorial, leaving a safe room's rest). Regular floor-to-floor
// descents get the QUICK wake: a brisk lid-part with mild focus, the
// stitch without the pageantry.
const DUR_FULL = 2.1;
const DUR_QUICK = 0.9;

const LID_KEYS_FULL: Array<[number, number]> = [
  [0.00, 0],
  [0.16, 0],
  [0.42, 0.62],
  [0.56, 0.40],
  [1.00, 1],
];
const LID_KEYS_QUICK: Array<[number, number]> = [
  [0.00, 0],
  [0.10, 0],
  [1.00, 1],
];

let t = -1;   // -1 = idle
let offset = 0;
let duration = DUR_FULL;
let lidKeys = LID_KEYS_FULL;
let maxBlur = 7;
let lidTop: HTMLDivElement | null = null;
let lidBot: HTMLDivElement | null = null;
let blurEl: HTMLDivElement | null = null;

function lidOpenness(k: number): number {
  const LID_KEYS = lidKeys;
  for (let i = 1; i < LID_KEYS.length; i++) {
    const [k1, v1] = LID_KEYS[i];
    const [k0, v0] = LID_KEYS[i - 1];
    if (k <= k1) {
      const f = (k - k0) / (k1 - k0);
      const e = 0.5 - 0.5 * Math.cos(f * Math.PI);   // cosine ease per segment
      return v0 + (v1 - v0) * e;
    }
  }
  return 1;
}

function ensureLids(): void {
  if (lidTop) return;
  const make = (top: boolean) => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      left: '-10vw',
      width: '120vw',
      height: '62vh',
      [top ? 'top' : 'bottom']: '0',
      background: '#000',
      zIndex: '9996',
      pointerEvents: 'none',
      // Soft, slightly curved inner edge — an eyelid, not a shutter.
      borderRadius: top ? '0 0 50% 50% / 0 0 9vh 9vh' : '50% 50% 0 0 / 9vh 9vh 0 0',
      filter: 'blur(10px)',
      transform: 'translateY(0)',
      willChange: 'transform',
      display: 'none',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    return el;
  };
  lidTop = make(true);
  lidBot = make(false);
  // Focus layer — backdrop blur over the canvas between the lids; the
  // world sharpens as the eyes finish opening.
  blurEl = document.createElement('div');
  Object.assign(blurEl.style, {
    position: 'fixed', inset: '0', zIndex: '9995',
    pointerEvents: 'none', display: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(blurEl);
}

function setFocus(open: number): void {
  if (!blurEl) return;
  // Blur eases out as the eyes open; gone by 85% open.
  const b = maxBlur * Math.max(0, 1 - open / 0.85);
  if (b < 0.3) { blurEl.style.display = 'none'; return; }
  blurEl.style.display = 'block';
  (blurEl.style as unknown as Record<string, string>).backdropFilter = `blur(${b.toFixed(1)}px)`;
  (blurEl.style as unknown as Record<string, string>).webkitBackdropFilter = `blur(${b.toFixed(1)}px)`;
}

function setLids(open: number): void {
  if (!lidTop || !lidBot) return;
  // Each lid retreats up to its full height (62vh) + blur margin.
  const travel = open * 72;
  lidTop.style.transform = `translateY(${-travel}vh)`;
  lidBot.style.transform = `translateY(${travel}vh)`;
  const show = open < 0.999 ? 'block' : 'none';
  lidTop.style.display = show;
  lidBot.style.display = show;
}

let suppressed = false;

/** DEV (scenario boot path): skip the wake ceremony entirely, now and for
 *  every later floor load this session. Scenario previews + snap captures
 *  exist to show the world; a 2.1s eyelid ceremony over the frame turned
 *  every headless snap into a black rectangle. */
export function suppressArrivalCeremony(): void {
  suppressed = true;
  t = -1;
  offset = 0;
  setLids(1);
  setFocus(1);
}

export function beginArrival(opts?: { full?: boolean }): void {
  if (suppressed) { t = -1; offset = 0; setLids(1); setFocus(1); return; }
  const full = opts?.full ?? false;
  duration = full ? DUR_FULL : DUR_QUICK;
  lidKeys = full ? LID_KEYS_FULL : LID_KEYS_QUICK;
  maxBlur = full ? 7 : 3.5;
  t = 0;
  offset = SIT_HEIGHT - CONFIG.PLAYER_HEIGHT;
  ensureLids();
  setLids(0);
  setFocus(0);
}

/** Advance the wake clock. The camera system applies the height offset —
 *  movement locks eye height every frame, so writing camera.y from
 *  here would be stomped within the same frame. */
export function tickArrival(_camera: THREE.Camera, dt: number): void {
  if (t < 0) return;
  t += dt;
  const k = Math.min(1, t / duration);
  // The stand starts once the eyes have first parted, easing in late.
  const standK = Math.max(0, (k - 0.30) / 0.70);
  const e = standK * standK * (3 - 2 * standK);
  offset = (SIT_HEIGHT - CONFIG.PLAYER_HEIGHT) * (1 - e);
  const open = lidOpenness(k);
  setLids(open);
  setFocus(open);
  if (k >= 1) {
    t = -1; offset = 0; setLids(1); setFocus(1);
    // The ceremony ends, the THRESHOLD begins — see below.
    threshold = true;
    thresholdAge = 0;
  }
}

// ── THE THRESHOLD — you have arrived, but you have not started ───────
//
// The wake ceremony ends on a timer, and for that second or two the player is
// untouchable. Then it hands over to a room the player has never seen, on a
// phone, with their thumbs not yet on the sticks. Anything that hits them there
// hit someone who wasn't playing yet, and a pack that aggros there is already
// mid-charge by the time they can answer. That's not indifference, it's a cheap
// shot, and the first thing it teaches a new floor is that arriving is dangerous
// in a way you cannot act on.
//
// So the safety doesn't end with the ceremony. It ends when the player DOES
// something — a step, a look, a swing, a use. Not on a clock: someone who needs
// six seconds to get their bearings on a bus gets six seconds. Nothing notices
// them and nothing can hurt them until they move first.

/** Backstop only. If nothing ends the threshold by now, an end-call went
 *  missing somewhere and we would rather the player be mortal than immortal for
 *  a whole floor. Long enough never to fire during honest orientation. */
const THRESHOLD_CEILING_S = 45;

let threshold = false;
let thresholdAge = 0;

/** The player acted. Ends the threshold; idempotent and cheap, so input
 *  handlers can call it unconditionally. */
export function endArrivalThreshold(): void {
  threshold = false;
}

/** Age the backstop. Driven from the same tick as the ceremony. */
export function tickArrivalThreshold(dt: number): void {
  if (!threshold) return;
  thresholdAge += dt;
  if (thresholdAge >= THRESHOLD_CEILING_S) threshold = false;
}

/**
 * Is the player still standing in the doorway — either mid-wake or arrived but
 * not yet moved? The single predicate for "leave them alone": read by
 * player/health (damage refused) and by mob sight (nothing notices them).
 */
export function isArrivalGrace(): boolean {
  return t >= 0 || threshold;
}

/** Negative while rising from the bonfire seat; 0 once standing. */
export function getArrivalHeightOffset(): number {
  return offset;
}

/** True while waking — movement is held and the player can't be hurt
 *  (mobs don't get to swing at someone mid-blink). Look stays free.
 *  For "leave the player alone" checks use isArrivalGrace, which also covers
 *  the threshold that follows the ceremony. */
export function isArrivalActive(): boolean {
  return t >= 0;
}
