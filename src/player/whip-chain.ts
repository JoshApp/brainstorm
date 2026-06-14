import * as THREE from 'three';
import type { SwingPhase } from '../combat/swing-state';

// Whip chain ripple — secondary motion for the penitent's chain so a crack
// reads as a WHIP, not a rigid string of beads swinging as one block.
//
// The chain's beads are named chain0..chainN (base→tip) in the model. The
// viewmodel's overall swing pose moves the whole GROUP (the arm motion); on top
// of that, this animates each bead's LOCAL position with a trailing wave: the
// tip lags the base (a per-bead progress shift) and whips the most (amplitude
// grows toward the tip). Windup coils the chain back, strike snaps it forward,
// recover settles it, idle dangles it gently. Analytical (no frame history), so
// it's frame-rate independent.
//
// Module-level state — one wielded whip at a time. Set up at mount, cleared at
// unmount/weapon-swap.

interface Bead {
  mesh: THREE.Object3D;
  rest: THREE.Vector3;   // authored local position
  s: number;             // 0 (base) → 1 (tip)
}

let beads: Bead[] = [];
let idleClock = 0;

const BEAD_NAMES = ['chain0', 'chain1', 'chain2', 'chain3', 'chain4', 'chain5'];
const TIP_LAG = 0.5;     // how far (in phase-progress) the tip trails the base —
                         // higher = a longer travelling wave, less stiff
const SNAP_FWD = 0.40;   // metres the tip throws forward (−Z) at a full crack
const SNAP_LIFT = 0.34;  // metres the dangling tip LIFTS toward level as it lashes

/** Collect the named chain beads from a freshly-built model. Returns whether a
 *  chain was found (so the viewmodel only ticks it for whip-like weapons). */
export function setupWhipChain(parts: Map<string, THREE.Object3D>): boolean {
  beads = [];
  const found: THREE.Object3D[] = [];
  for (const n of BEAD_NAMES) {
    const o = parts.get(n);
    if (o) found.push(o);
  }
  if (found.length < 2) return false;
  const last = found.length - 1;
  found.forEach((mesh, i) => beads.push({ mesh, rest: mesh.position.clone(), s: i / last }));
  idleClock = 0;
  return true;
}

export function clearWhipChain(): void {
  beads = [];
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** The whip "drive" at a given phase + (already lag-shifted) progress:
 *  −1 coiled back (windup) → +1.3 snapped forward (strike) → 0 settled. */
function drive(phase: SwingPhase, p: number): number {
  if (phase === 'windup') return -p;                       // coil back
  if (phase === 'strike') return -1 + easeOut(p) * 2.3;    // snap forward (overshoot)
  if (phase === 'recover') return 1.3 * (1 - easeOut(p));  // settle
  return 0;
}

/** Animate the chain each frame. `phase`/`progress` from the swing sim; `dt` for
 *  the idle dangle. Sets each bead's local position = rest + ripple. */
export function tickWhipChain(phase: SwingPhase, progress: number, dt: number): void {
  if (beads.length === 0) return;
  idleClock += dt;
  for (const b of beads) {
    // The tip trails the base: read the drive at an earlier progress for beads
    // further down the chain — that's what makes the wave travel.
    const p = Math.max(0, Math.min(1, progress - b.s * TIP_LAG));
    const d = drive(phase, p);
    // amp grows toward the tip (tip whips most) but s^1.5 (not s²) lets the
    // MID-cord move too, so the whole lash ripples instead of a stiff tip-flick.
    const amp = Math.pow(b.s, 1.5);
    const sway = phase === 'idle' ? Math.sin(idleClock * 2.2 + b.s * 3) * 0.012 * b.s : 0;
    b.mesh.position.set(
      b.rest.x + sway,
      b.rest.y + d * amp * SNAP_LIFT,  // +Y on a crack: the dangling tip lifts toward level
      b.rest.z - d * amp * SNAP_FWD,   // −Z = forward: the crack throws the tip out
    );
  }
}
