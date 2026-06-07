import GUI from 'lil-gui';
import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';
import { sampleClip } from '../anim/keyframes';
import { POSE_CLIPS } from '../content/clips-weapons';

// Live-edit sidebar — a lil-gui panel on the bench page that lets
// Josh drag a slot's position / rotation and SEE the result while
// composing. The bench's render is on-demand (not in a rAF loop), so
// each slider change calls the caller-supplied `redraw()` so the
// scene re-renders against the mutated transforms.
//
// The big iteration unlock: a multi-joint hand has 20+ slots. Reading
// a JSON readout and editing TypeScript in a loop is exhausting; this
// shrinks the loop to "drag a slider, eye the result, copy values
// when satisfied."
//
// Enabled by URL flag `?edit=1` so the panel only shows in
// interactive browser sessions, never in headless snap captures.
//
// To get the current values out, the panel has a "Copy spec" button
// that prints the slot block as a TypeScript snippet to the dev
// console — paste it back into the spec file. Lossy by design: rounds
// to mm precision in pos and 0.01 rad in rot so the output stays
// readable.

const POS_RANGE = 0.30;        // ±30cm — covers anything in a viewmodel-scale spec
const ROT_RANGE = Math.PI;     // ±π — full Euler range
const POS_STEP = 0.001;        // 1mm precision (matches readout)
const ROT_STEP = 0.01;         // ~0.6° precision

interface LiveEditOpts {
  /** The hand BuiltModel (always present). */
  hand: BuiltModel;
  /** The composed weapon, when in --hand mode. */
  weapon?: BuiltModel | null;
  /** Re-render the studio. Called after every slider change. */
  redraw: () => void;
}

/** Mount the live-edit panel on the bench page. Returns a disposer
 *  that removes the panel + reverts every modified slot (handy in
 *  tests; not used in production). */
export function attachLiveEdit(opts: LiveEditOpts): () => void {
  const gui = new GUI({ title: 'live-edit', width: 320 });
  // Pull the panel to the right side of the viewport so it doesn't
  // overlap the title chip in the top-left.
  Object.assign(gui.domElement.style, {
    position: 'fixed', top: '8px', right: '8px',
  } as CSSStyleDeclaration);

  // Group slots by their "family" — fingers cluster nicely so each
  // finger's MCP/PIP/DIP collapse into one folder. Everything else
  // goes to a Misc folder.
  const families = new Map<string, Array<[string, THREE.Object3D]>>();
  const addToFamily = (familyName: string, slotName: string, node: THREE.Object3D) => {
    let list = families.get(familyName);
    if (!list) { list = []; families.set(familyName, list); }
    list.push([slotName, node]);
  };
  for (const [name, node] of opts.hand.slots) {
    if (name.startsWith('finger_thumb')) addToFamily('thumb', name, node);
    else if (name.startsWith('finger_index')) addToFamily('index', name, node);
    else if (name.startsWith('finger_middle')) addToFamily('middle', name, node);
    else if (name.startsWith('finger_ring')) addToFamily('ring', name, node);
    else if (name.startsWith('finger_pinky')) addToFamily('pinky', name, node);
    else if (name === 'wrist' || name === 'palm_anchor') addToFamily('root', name, node);
    else addToFamily('misc', name, node);
  }
  if (opts.weapon) {
    for (const [name, node] of opts.weapon.slots) {
      addToFamily('weapon', name, node);
    }
  }

  // Capture initial values so the "Reset" button restores the baseline.
  const baselines = new Map<THREE.Object3D, { pos: THREE.Vector3; rot: THREE.Euler }>();
  for (const list of families.values()) {
    for (const [, node] of list) {
      baselines.set(node, { pos: node.position.clone(), rot: node.rotation.clone() });
    }
  }

  // Build folders in a consistent order so the panel reads the same
  // every session.
  const familyOrder = ['root', 'thumb', 'index', 'middle', 'ring', 'pinky', 'misc', 'weapon'];
  for (const family of familyOrder) {
    const list = families.get(family);
    if (!list || list.length === 0) continue;
    const folder = gui.addFolder(family);
    // Collapse most folders by default; expand "root" (wrist + palm)
    // because that's the most-touched layer.
    if (family !== 'root') folder.close();
    for (const [name, node] of list) {
      const sub = folder.addFolder(name);
      sub.close();
      sub.add(node.position, 'x', -POS_RANGE, POS_RANGE, POS_STEP).name('posX').onChange(opts.redraw);
      sub.add(node.position, 'y', -POS_RANGE, POS_RANGE, POS_STEP).name('posY').onChange(opts.redraw);
      sub.add(node.position, 'z', -POS_RANGE, POS_RANGE, POS_STEP).name('posZ').onChange(opts.redraw);
      sub.add(node.rotation, 'x', -ROT_RANGE, ROT_RANGE, ROT_STEP).name('rotX').onChange(opts.redraw);
      sub.add(node.rotation, 'y', -ROT_RANGE, ROT_RANGE, ROT_STEP).name('rotY').onChange(opts.redraw);
      sub.add(node.rotation, 'z', -ROT_RANGE, ROT_RANGE, ROT_STEP).name('rotZ').onChange(opts.redraw);
    }
  }

  // ── ANIMATION SCRUBBER ─────────────────────────────────────────────
  // Time-scrub through any clip in POSE_CLIPS by applying the clip
  // sample's deltas to the composed hand group (mirrors what the live
  // viewmodel does to the swing group). Iteration tightens from
  // "author clip → run bench --anim → look" to "author clip → drag
  // slider → look in real time."
  const clipNames = Object.keys(POSE_CLIPS);
  if (clipNames.length > 0 && opts.weapon) {
    const animFolder = gui.addFolder('animation');
    const animState = {
      clip: clipNames[0],
      time: 0,
    };
    const baselinePos = opts.hand.group.position.clone();
    const baselineRot = opts.hand.group.rotation.clone();
    const onAnimChange = () => {
      const clip = (POSE_CLIPS as Record<string, Parameters<typeof sampleClip>[0]>)[animState.clip];
      if (!clip) {
        opts.hand.group.position.copy(baselinePos);
        opts.hand.group.rotation.copy(baselineRot);
        opts.redraw();
        return;
      }
      const sample = sampleClip(clip, animState.time);
      opts.hand.group.position.set(
        baselinePos.x + (sample['weapon.pos.x'] ?? 0),
        baselinePos.y + (sample['weapon.pos.y'] ?? 0),
        baselinePos.z + (sample['weapon.pos.z'] ?? 0),
      );
      opts.hand.group.rotation.set(
        baselineRot.x + (sample['weapon.rot.x'] ?? 0),
        baselineRot.y + (sample['weapon.rot.y'] ?? 0),
        baselineRot.z + (sample['weapon.rot.z'] ?? 0),
      );
      opts.redraw();
    };
    animFolder.add(animState, 'clip', clipNames).onChange(onAnimChange);
    animFolder.add(animState, 'time', 0, 1, 0.001).onChange(onAnimChange);
    animFolder.add({ resetPose: () => { animState.time = 0; onAnimChange();
      gui.controllersRecursive().forEach((c) => c.updateDisplay()); } },
      'resetPose').name('Reset to idle');
  }

  // Top-level action row — copy + reset.
  const actions = {
    'Copy spec to console': () => {
      const lines: string[] = ['// — Live-edited slots — paste back into the ModelSpec'];
      for (const list of families.values()) {
        for (const [name, node] of list) {
          const px = round(node.position.x, 3), py = round(node.position.y, 3), pz = round(node.position.z, 3);
          const rx = round(node.rotation.x, 2), ry = round(node.rotation.y, 2), rz = round(node.rotation.z, 2);
          lines.push(`${name}: { pos: [${px}, ${py}, ${pz}], rot: [${rx}, ${ry}, ${rz}] },`);
        }
      }
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'));
    },
    'Reset all to baseline': () => {
      for (const [node, base] of baselines) {
        node.position.copy(base.pos);
        node.rotation.copy(base.rot);
      }
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      opts.redraw();
    },
  };
  gui.add(actions, 'Copy spec to console');
  gui.add(actions, 'Reset all to baseline');

  return () => gui.destroy();
}

function round(n: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
