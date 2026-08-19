// ── THE GRIP BENCH ───────────────────────────────────────────────────────────
//
// `?gripbench=1` — the composed hand and weapon, close, large, and slowly turning in front of
// the camera.
//
// It exists because judging a grip has been the bottleneck all session. In every scenario the
// viewmodel's hand sits at the very bottom edge of the frame, so a snap shows a sword and a few
// pixels of knuckle; I have been fixing this system by reading millimetre reports because I
// could not see it. A contact report tells you a fingertip is 0.0mm off the hilt. It does not
// tell you the fist is sitting on the cross-guard.
//
// So: the same composeHeldWeapon the game uses — not a rebuild of it, or the bench would drift
// from what ships — mounted where it can actually be looked at, turning so one snap with
// `--frames` covers every side.
//
//   npm run snap spawn --inspect --frames=6 --q=gripbench=1&bonearm=1
//
// DEV-only, flag-gated, dead-code-eliminated in production.

import * as THREE from 'three';
import { DEV } from './dev';
import { composeHeldWeapon } from '../player/held-weapon-compose';
import { SWORD_RUSTED } from '../content/sword';
import type { ModelSpec } from '../ecs/model-types';

/** Seconds for a full turn. Slow enough that a 6-frame grid reads as six distinct views. */
const TURN_SECONDS = 8;

/** Is the grip bench on? */
export function gripBenchWanted(): boolean {
  return DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('gripbench') === '1';
}

/**
 * Mount the composed grip in front of the camera, turning.
 *
 * The weapon defaults to the starter sword — the one every run begins with, and so the one
 * whose grip has to be right before any other weapon's is worth looking at.
 */
export function mountGripBench(camera: THREE.Object3D, spec: ModelSpec = SWORD_RUSTED): void {
  if (!DEV) return;

  const stage = new THREE.Group();
  stage.position.set(0, 0, -0.55);
  camera.add(stage);

  // The spinner turns about the vertical so every side of the fist comes round; the composed
  // group hangs off it, shifted so the GRIP — not the blade tip, and not the wrist — sits at
  // the centre of rotation. A sword is mostly blade, and centring the whole model would put the
  // thing being judged out at the edge of the frame.
  const spinner = new THREE.Group();
  stage.add(spinner);

  const composed = composeHeldWeapon(spec);
  spinner.add(composed.group);

  const palm = composed.hand.slots.get('palm_anchor') ?? composed.hand.group;
  composed.group.updateMatrixWorld(true);
  const focus = new THREE.Vector3().setFromMatrixPosition(palm.matrixWorld);
  composed.group.position.sub(focus);

  // Scale so the fist fills a good part of the frame. A hand is ~0.19m and the stage sits 0.55m
  // out, which reads as a thumbnail without this.
  stage.scale.setScalar(2.4);

  const spin = (): void => {
    const t = (performance.now() / 1000) % TURN_SECONDS;
    spinner.rotation.y = (t / TURN_SECONDS) * Math.PI * 2;
    requestAnimationFrame(spin);
  };
  requestAnimationFrame(spin);

  // eslint-disable-next-line no-console
  console.log(`[grip-bench] ${spec.id} mounted — turning once every ${TURN_SECONDS}s`);
}
