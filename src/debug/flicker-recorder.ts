// ── RECORD THE FLICKER INSTEAD OF ARGUING ABOUT IT ───────────────────────────
//
// Josh, on the third round of a culling bug: *"can we live debug it instead of guessing?
// i can walk different paths and you measure why."*
//
// Right. Every previous round of this was diagnosed by reading the source, and every one of
// those diagnoses was partly wrong — props with no height, then props at all, then a single
// ray. The two debug maps already publish exactly the state that decides a flame or a lamp:
// `debugSignalMap` gives each marker's exposure and which test set it, `debugLightMap` gives
// each source's `why`, its eased `vis` and what it actually emits. Nothing was recording
// them over TIME, which is the only axis a flicker lives on.
//
// So this samples both while somebody walks, and posts the trace to the dev server
// (scripts/perf-record-plugin.ts already accepts `POST /__perf` and writes a JSON file), so
// the answer is a file to read rather than a theory to defend.
//
// ── WHAT MAKES A TRACE USEFUL ───────────────────────────────────────────────
//
// The camera pose goes in EVERY sample. "It flickers" is not a bug report; "this marker
// went 1 → 0 → 1 while the camera moved 6cm" is, and it also distinguishes the two causes
// that look identical from inside the game: a verdict oscillating on a knife-edge (the
// camera barely moved) from a verdict correctly changing as you cross a threshold (the
// camera moved through a doorway).
//
// DEV-only and behind a flag, so it costs a shipped build nothing: the whole module is
// dead-code-eliminated when `DEV` is false, and even in dev it does nothing until asked.

import * as THREE from 'three';
import { DEV } from './dev';
import { debugSignalMap } from '../scene/signal-layer';
import { debugLightMap } from '../scene/light-pool';

function flag(name: string): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(name) === '1';
}

/** Samples per second. Fast enough to catch a flicker, slow enough that a two-minute walk
 *  is a file rather than a heap problem. */
const HZ = 20;
/** Only what is near enough to be the thing being looked at. */
const RADIUS = 22;
/** Post this often, so a trace can be read WHILE someone is still walking. */
const POST_EVERY_S = 8;

interface Sample {
  t: number;
  cam: [number, number, number];
  yaw: number;
  /** [id, x, z, exposure, why, gates] per signal marker in range. */
  sig: Array<[number, number, number, number, string, number]>;
  /** [id, x, z, why, gates, vis, emit] per light in range. */
  lit: Array<[string, number, number, string, number, number, number]>;
}

let samples: Sample[] = [];
let accum = 0;
let sincePost = 0;
let seq = 0;
let running = false;
const _fwd = new THREE.Vector3();

function post(final = false): void {
  if (!samples.length) return;
  const body = JSON.stringify({
    id: `flicker-${seq++}`,
    recording: { kind: 'flicker', hz: HZ, final, samples },
  });
  samples = [];
  void fetch('/__perf', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    .catch(() => { /* the dev server is the only consumer; losing a chunk is not worth a throw */ });
}

/**
 * Sample the signal and light state around the camera.
 *
 * Called every frame from the system loop; it decimates itself to HZ rather than being
 * scheduled, because the thing being measured is per-frame and a scheduler would alias it.
 */
export function tickFlickerRecorder(camera: THREE.Camera, dt: number): void {
  if (!DEV || !running) return;
  accum += dt;
  sincePost += dt;
  if (accum < 1 / HZ) return;
  accum = 0;

  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  camera.getWorldDirection(_fwd);
  const r2 = RADIUS * RADIUS;

  const sig: Sample['sig'] = [];
  const rows = debugSignalMap();
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    const d2 = (m.x - cx) ** 2 + (m.z - cz) ** 2;
    if (d2 > r2) continue;
    sig.push([i, +m.x.toFixed(2), +m.z.toFixed(2), +m.exposure.toFixed(3), m.why, m.gates]);
  }

  const lit: Sample['lit'] = [];
  for (const l of debugLightMap()) {
    const d2 = (l.x - cx) ** 2 + (l.z - cz) ** 2;
    if (d2 > r2) continue;
    lit.push([l.id, +l.x.toFixed(2), +l.z.toFixed(2), l.why, l.gates,
              +l.vis.toFixed(3), +l.emit.toFixed(3)]);
  }

  samples.push({
    t: +(performance.now() / 1000).toFixed(3),
    cam: [+cx.toFixed(3), +cy.toFixed(3), +cz.toFixed(3)],
    yaw: +Math.atan2(_fwd.x, _fwd.z).toFixed(3),
    sig,
    lit,
  });

  if (sincePost >= POST_EVERY_S) { sincePost = 0; post(); }
}

/** Start/stop from the console, and report where the trace goes. */
export function setFlickerRecording(on: boolean): boolean {
  if (!DEV) return false;
  if (on === running) return running;
  running = on;
  if (!on) post(true);
  // eslint-disable-next-line no-console
  console.log(`[flicker] recording ${on ? 'ON' : 'OFF'} — traces post to perf-recordings/flicker-*.json`);
  return running;
}

if (DEV && typeof window !== 'undefined') {
  // ?flicker=1 — start the moment the world exists, so a walk needs no console.
  if (flag('flicker')) running = true;
  (window as unknown as { __flicker?: unknown }).__flicker = {
    start: () => setFlickerRecording(true),
    stop: () => setFlickerRecording(false),
    running: () => running,
    pending: () => samples.length,
  };
}
