import * as THREE from 'three';
import { VASE_TALL, VASE_FLASK, VASE_BROKEN } from '../content/vase';
import { archway } from '../content/archway';
import { buildSpecMeshes, meshesOf } from './spec-mesh';

// ── THE STYLE LAB — bounce ideas off a fake dungeon ──────────────────────────
//
// Josh: *"a sorta fake site ... instead of having to actually build it we can
// make a sorta fake prototype to test styles rather quickly even things that
// are completely different from what we have."*
//
// This is a DIFFERENT TOOL from style/look-presets.ts, and the difference is
// the whole reason both exist:
//
//   LOOK PRESETS tweak the REAL pipeline. Constrained to knobs the game
//   actually has — but what you see is what ships. It answers "what do we
//   HAVE?"
//
//   THE STYLE LAB is a sandbox with its own scene, its own renderer and no
//   game code underneath. A recipe here may do ANYTHING: throw away every
//   material, relight from scratch, render the world as flat black shapes on
//   bone. Nothing it shows is shippable as-is. It answers "what do we WANT?"
//
// Keeping them apart is the point. A sandbox that had to respect the real
// pipeline could not show you an idea the pipeline cannot express yet, which is
// exactly the class of idea worth finding early — and a comparison sheet of the
// real pipeline must never be contaminated by a promise the game cannot keep.
//
// THE SCENE IS FAKE ON PURPOSE. It is a dungeon corner built from primitives in
// forty lines: two walls, a floor, a doorway, some clutter, a creature-shaped
// blob, one warm light. It boots instantly, has no level generator, no content
// registry and no asset pipeline behind it. That is what makes trying a style
// cost a minute instead of an afternoon.
//
// A recipe that survives here gets PORTED — into look-presets if the real
// pipeline can already express it, or into a real feature if it cannot. Nothing
// here is on a path to shipping by itself.

// ── The fake dungeon ────────────────────────────────────────────────────────

export interface LabScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Everything a recipe is allowed to re-skin, by role — so a recipe can say
   *  "walls flat, creature black, light source emissive" without knowing the
   *  construction order. Roles, not names: the point is that a style decision
   *  applies to a KIND of thing. */
  roles: {
    shell: THREE.Mesh[];      // walls, floor, ceiling
    frame: THREE.Mesh[];      // the doorway
    clutter: THREE.Mesh[];    // props
    creature: THREE.Mesh[];   // the thing that has to read as alive
    emissive: THREE.Mesh[];   // the light source itself
  };
  lights: THREE.Light[];
  /** The creatures, kept apart so one recipe can give each a different reveal
   *  mode — the only way to ask whether the modes coexist. */
  creatureGroups: THREE.Mesh[][];
}

function mesh(
  geo: THREE.BufferGeometry, x: number, y: number, z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a8578 }));
  m.position.set(x, y, z);
  return m;
}

/** Build the corner. Deliberately crude — it is a stand-in, not a level. */
export function buildLabScene(): LabScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(0, 1.6, 6.2);
  camera.lookAt(0, 1.3, -4);

  const roles: LabScene['roles'] = { shell: [], frame: [], clutter: [], creature: [], emissive: [] };

  // Floor + two walls + ceiling — the box you stand in.
  const floor = mesh(new THREE.BoxGeometry(12, 0.4, 20), 0, -0.2, -2);
  const ceil = mesh(new THREE.BoxGeometry(12, 0.4, 20), 0, 4.4, -2);
  const wallL = mesh(new THREE.BoxGeometry(0.4, 4.6, 20), -6, 2.1, -2);
  const wallR = mesh(new THREE.BoxGeometry(0.4, 4.6, 20), 6, 2.1, -2);
  const wallB = mesh(new THREE.BoxGeometry(12, 4.6, 0.4), 0, 2.1, -12);
  roles.shell.push(floor, ceil, wallL, wallR, wallB);

  // THE REAL ARCHWAY. Not three invented boxes — the actual ModelSpec the
  // dungeon builds at every wide opening, rebuilt as plain meshes by
  // lab/spec-mesh.ts. This is the shape the player sees more than any other, so
  // it is the one a style has to survive.
  const arch = buildSpecMeshes(archway({ width: 2.6, ceilingHeight: 4.2 }));
  arch.position.set(0, 0, -11.9);
  scene.add(arch);
  roles.frame.push(...meshesOf(arch));
  // Something faintly visible THROUGH the doorway — depth needs a beyond.
  const beyond = mesh(new THREE.BoxGeometry(6, 4.6, 0.4), 0, 2.1, -17);
  roles.shell.push(beyond);

  // Clutter — the REAL vases. Small forms are the first things a bad style turns
  // to mush, and these are the actual ones, lathe profiles and all.
  for (const [spec, x, z] of [
    [VASE_TALL, -2.6, 1.2], [VASE_FLASK, -3.4, 0.1], [VASE_BROKEN, 3.0, 0.6],
  ] as const) {
    const g = buildSpecMeshes(spec);
    g.position.set(x, 0, z);
    scene.add(g);
    roles.clutter.push(...meshesOf(g));
  }

  // A creature: capsule body, sphere head, two thin arms. Not good — it only
  // has to have a SILHOUETTE, because that is the thing a style either
  // preserves or destroys.
  // THREE of them, at different distances and different sides. One creature
  // cannot answer "do these reveal modes live together" — that question is
  // about a ROOM, so the room needs more than one thing in it.
  const creatureGroups: THREE.Mesh[][] = [];
  for (const [cx, cz] of [[-2.2, -2.4], [1.4, -4.6], [3.4, -1.4]] as const) {
    const body = mesh(new THREE.CapsuleGeometry(0.38, 0.9, 4, 10), cx, 1.0, cz);
    const head = mesh(new THREE.SphereGeometry(0.3, 12, 10), cx, 1.8, cz);
    const armL = mesh(new THREE.CapsuleGeometry(0.09, 0.7, 3, 6), cx - 0.5, 1.1, cz + 0.1);
    const armR = mesh(new THREE.CapsuleGeometry(0.09, 0.7, 3, 6), cx + 0.5, 1.1, cz + 0.1);
    armL.rotation.z = 0.4; armR.rotation.z = -0.3;
    const g = [body, head, armL, armR];
    creatureGroups.push(g);
    roles.creature.push(...g);
  }

  // The light source, visible as an object — a style has to decide what a
  // FLAME looks like, and it cannot if there is nothing there.
  const flame = mesh(new THREE.SphereGeometry(0.16, 10, 8), -4.4, 2.5, -1.0);
  roles.emissive.push(flame);

  const torch = new THREE.PointLight(0xffa04a, 22, 16, 2);
  torch.position.set(-4.4, 2.5, -1.0);
  const fill = new THREE.AmbientLight(0x223044, 0.5);
  const lights: THREE.Light[] = [torch, fill];

  for (const list of Object.values(roles)) for (const m of list) scene.add(m);
  for (const l of lights) scene.add(l);

  return { scene, camera, roles, lights, creatureGroups };
}

// ── Style recipes ───────────────────────────────────────────────────────────

export interface StyleRecipe {
  id: string;
  name: string;
  /** What this is TRYING, one line. Same rule as the look presets: a variant
   *  you cannot summarise is one you cannot judge. */
  note: string;
  apply(lab: LabScene): void;
}

/** A 2-3 step gradient ramp for MeshToonMaterial — flat fills with hard steps. */
function toonRamp(steps: number): THREE.DataTexture {
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A procedural matcap — a lit sphere baked to a disc. Cheap way to get a
 *  hand-painted-metal read with no lights at all. */
function matcap(a: THREE.Color, b: THREE.Color): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const nx = (x / N) * 2 - 1, ny = (y / N) * 2 - 1;
    const r2 = nx * nx + ny * ny;
    const i = (y * N + x) * 4;
    // Key light up-left, rim on the lower right — the standard matcap read.
    const nz = Math.sqrt(Math.max(0, 1 - r2));
    const key = Math.max(0, -nx * 0.6 + ny * 0.6 + nz * 0.5);
    const rim = Math.pow(1 - nz, 3);
    const c = a.clone().lerp(b, Math.min(1, key)).addScalar(rim * 0.35);
    data[i] = Math.min(255, c.r * 255); data[i + 1] = Math.min(255, c.g * 255);
    data[i + 2] = Math.min(255, c.b * 255); data[i + 3] = r2 <= 1 ? 255 : 0;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** Add an inverted-hull outline: the same geometry, scaled up, back faces only,
 *  flat black. The oldest ink trick there is, and it needs no G-buffer — which
 *  is exactly why a sandbox should try it before anyone writes a shader. */
function addHullOutline(lab: LabScene, thickness: number): void {
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  // NOT the shell. A scale-hull on a 12x20 wall pushes its outline 0.4m
  // outward — past the camera, so the "ink" is a black box you are standing
  // inside and never see. Scale-hulls only work on things small relative to
  // their own dimensions. (Found by looking at the first sheet: three cells
  // that should have differed were identical.)
  for (const list of [lab.roles.frame, lab.roles.clutter, lab.roles.creature]) {
    for (const m of list) {
      const o = new THREE.Mesh(m.geometry, outlineMat);
      o.position.copy(m.position);
      o.rotation.copy(m.rotation);
      // Scale is a crude hull — correct would be extruding along the normal,
      // but on convex primitives the difference is invisible and this is free.
      const s = 1 + thickness;
      o.scale.set(s, s, s);
      lab.scene.add(o);
    }
  }
}

function setAll(lab: LabScene, make: (role: keyof LabScene['roles'], m: THREE.Mesh) => THREE.Material): void {
  for (const key of Object.keys(lab.roles) as Array<keyof LabScene['roles']>) {
    for (const m of lab.roles[key]) m.material = make(key, m);
  }
}


// ── THE RISO FAMILY — does "hue means depth" survive a real palette? ─────────
//
// RISO was the strongest thing the lab produced, so the next question is not
// "is it pretty" but "is it a SYSTEM". Hollow Knight's power is that hue means
// PLACE: you know which region you are in from a thumbnail. The claim to test
// here is the descent version — hue means DEPTH.
//
// A family, not a set of one-offs. Every member runs the SAME recipe and
// differs in exactly three numbers: paper, ink A, ink B. Holding the recipe
// identical is what makes the sheet an experiment instead of four drawings —
// if act 3 reads as more menacing than act 1, that is the PALETTE talking, and
// nothing else was free to talk.
//
// Two things a family has to do at once, and they pull against each other:
//   DISTINCT   — the four cells must be tellable apart at a glance, or depth
//                is not legible and the whole idea fails.
//   KIN        — they must read as one game. Four unrelated colour schemes is
//                not an art direction, it is four art directions.
// The sheet is where you find out whether a given set does both.

/** A tiling pattern texture — bayer dots for 1-bit, diagonal rules for
 *  engraving. UV-space, not screen-space: the lines follow each primitive's
 *  own mapping, so they shift scale between a wall and a vase. True hatching is
 *  a screen-space post pass; this is the sandbox approximation, and the seams
 *  it produces are an artefact of the shortcut, not of the idea. */
function patternTexture(kind: 'bayer' | 'hatch', repeat: number): THREE.DataTexture {
  const N = 8;
  const data = new Uint8Array(N * N * 4);
  const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const v = kind === 'bayer'
      ? (BAYER[y * N + x] / 63) * 255
      : ((x + y) % 4 === 0 ? 40 : 235);   // diagonal rules
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}


/** The lighting both IMPORTANCE recipes share — identical on purpose, so the
 *  only difference between those two cells is surface chroma. Two SATURATED
 *  sources of opposing hue, so a single pale surface is sampled by both and the
 *  colour shift is visible across one object rather than across the room. */

// ── THE THREE WAYS THE DARK GIVES A THING UP ────────────────────────────────
//
// Josh, rejecting the doc's taxonomy: *"I am not sure if rim should be the
// differentiator between arcane and not, a lot of the rules in the docs are
// arbitrarily things we concluded halfways."* He is right — and the doc says of
// itself that overthrowing a rule deliberately beats following it accidentally.
//
// So drop the fiction-based split (mundane vs arcane) and classify by LIGHT
// BEHAVIOUR instead, which is physical and readable without being told:
//
//   REFLECTED  high albedo, no chroma — it takes the room's colour. (skeleton)
//   EDGED      dark body, lit rim — its outline comes out of the black. (maggot)
//   SELF-LIT   it makes light nothing else made.
//
// The discipline is then about FREQUENCY, not lore: one mode per creature, and
// the rarer a mode is, the more it means. "15 of 23 are self-lit" is damning
// under any theory; "an ooze may not have a rim because it is not magic" is
// not, and that is the part that was arbitrary.
//
// Rim here is a scaled back-face hull in a bright colour — no shader, and good
// enough to judge. The real one is a fresnel term the game already has.
type Reveal = 'reflected' | 'edged' | 'selflit';

function applyReveal(lab: LabScene, meshes: THREE.Mesh[], mode: Reveal, tint: number): void {
  if (mode === 'reflected') {
    for (const m of meshes) m.material = new THREE.MeshLambertMaterial({ color: 0xf0ece2 });
    return;
  }
  if (mode === 'selflit') {
    for (const m of meshes) {
      m.material = new THREE.MeshLambertMaterial({ color: 0x14151a, emissive: tint, emissiveIntensity: 1.0 });
    }
    return;
  }
  // EDGED — near-black body, bright hull behind it. The body vanishes; the
  // outline is the only thing the dark gives up.
  const rimMat = new THREE.MeshBasicMaterial({ color: tint, side: THREE.BackSide });
  for (const m of meshes) {
    m.material = new THREE.MeshLambertMaterial({ color: 0x0d0d10 });
    const o = new THREE.Mesh(m.geometry, rimMat);
    o.position.copy(m.position); o.rotation.copy(m.rotation);
    o.scale.setScalar(1.07);
    lab.scene.add(o);
  }
}

/** The room every reveal-mode cell is judged in: dark, neutral, two saturated
 *  sources. Identical across the four so the MODE is the only variable. */
function revealRoom(lab: LabScene): void {
  lab.scene.background = new THREE.Color(0x040405);
  lab.scene.fog = new THREE.Fog(0x040405, 5, 20);
  for (const key of ['shell', 'frame', 'clutter'] as const) {
    for (const m of lab.roles[key]) {
      m.material = new THREE.MeshLambertMaterial({
        color: key === 'shell' ? 0x232327 : key === 'frame' ? 0x35353a : 0x2b2b2f,
      });
    }
  }
  for (const m of lab.roles.emissive) m.material = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const l of lab.lights) l.visible = false;
  const warm = new THREE.PointLight(0xff5a1e, 34, 16, 2);
  warm.position.set(-4.4, 2.5, -1.0);
  const cold = new THREE.PointLight(0x2e6cff, 22, 17, 2);
  cold.position.set(3.6, 2.6, -8.0);
  lab.scene.add(warm, cold, new THREE.AmbientLight(0x0a0c12, 0.32));
}

function revealRecipe(id: string, name: string, note: string, mode: Reveal): StyleRecipe {
  return {
    id, name, note,
    apply(lab) {
      revealRoom(lab);
      for (const g of lab.creatureGroups) applyReveal(lab, g, mode, 0xffb066);
    },
  };
}

function applyImportanceLights(lab: LabScene): void {
  for (const l of lab.lights) l.visible = false;
  const warm = new THREE.PointLight(0xff4a12, 38, 16, 2);
  warm.position.set(-4.4, 2.5, -1.0);
  const cold = new THREE.PointLight(0x2a5cff, 26, 17, 2);
  cold.position.set(3.6, 2.6, -8.0);
  // Barely anything: the point is that unlit means UNSEEN.
  lab.scene.add(warm, cold, new THREE.AmbientLight(0x08080c, 0.3));
}

function risoRecipe(
  id: string, name: string, note: string,
  paper: number, inkA: number, inkB: number,
): StyleRecipe {
  return {
    id, name, note,
    apply(lab) {
      const paperC = new THREE.Color(paper);
      lab.scene.background = paperC;
      lab.scene.fog = new THREE.Fog(paper, 10, 26);
      // The shell gets paper pulled a little toward ink A — still only two
      // inks, but the room has a BODY. Pure paper walls made the first riso
      // cell an archway floating in nothing: striking, and useless for judging
      // whether a room reads.
      const shellC = paperC.clone().lerp(new THREE.Color(inkA), 0.18);
      setAll(lab, (role) => new THREE.MeshBasicMaterial({
        color: role === 'creature' || role === 'emissive' ? inkB
             : role === 'shell' ? shellC.getHex() : inkA,
      }));
      for (const l of lab.lights) l.visible = false;
      addHullOutline(lab, 0.03);
    },
  };
}

/**
 * One pair per act, arranged as a DESCENT.
 *
 * The progression is deliberate rather than decorative: paper DARKENS as you go
 * down, ink A goes from earth to stone to black, and ink B — always the
 * creature, always the only warm thing in frame — goes from rust to sickly to
 * arterial. So the thing that is ALIVE gets more alive-looking the deeper you
 * are, which is the read the fiction wants anyway.
 *
 * The paper darkening is not decoration either, and the first version of this
 * family got it wrong in a way worth recording. The papers were 0xdcd3bd,
 * 0xc3c6c4, 0xd6cfc0 — luminance 211, 197, 207. Flat. The comment claimed a
 * descent and the numbers did not perform one, so on the sheet acts I-III were
 * IDENTICAL in the grayscale row: distinguishable by hue alone.
 *
 * That is the failure this project's own look-sheet rule exists to catch — a
 * look carried only by hue collapses the moment a screen washes out, and depth
 * legibility is not something to stake on colour vision. Papers now run 211 /
 * 169 / 130, so the descent is in the VALUE and the hue is the second signal
 * rather than the only one.
 */
function risoFamily(): Record<string, StyleRecipe> {
  const members = [
    ['riso1', 'RISO · ACT I', 'Warm paper, iron ink, rust creature — the place still remembers being a building.',
     0xdcd3bd, 0x2b2419, 0xb0492f],
    ['riso2', 'RISO · ACT II', 'Cold paper, slate ink, verdigris creature — stone and damp, no warmth left in it.',
     0xa8aaa6, 0x1d2b3a, 0x63996a],
    ['riso3', 'RISO · ACT III', 'Bone paper, black ink, arterial creature — the deep, and the only warm thing is meat.',
     0x8a8175, 0x14100f, 0xc4262a],
    ['riso4', 'RISO · SUNKEN', 'Inverted: ink paper, bone ink. Does the family survive being turned inside out?',
     0x191d24, 0xb9b3a2, 0xc46a2a],
  ] as const;
  const out: Record<string, StyleRecipe> = {};
  for (const [id, name, note, paper, a, b] of members) {
    out[id] = risoRecipe(id, name, note, paper, a, b);
  }
  return out;
}

export const STYLES: Record<string, StyleRecipe> = {
  baseline: {
    id: 'baseline', name: 'BASELINE', note: 'Plain lit stone. The control — every other cell is judged against this.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x07070a);
      lab.scene.fog = new THREE.Fog(0x07070a, 4, 22);
      setAll(lab, (role) => role === 'emissive'
        ? new THREE.MeshBasicMaterial({ color: 0xffd08a })
        : new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 }));
    },
  },

  silhouette: {
    id: 'silhouette', name: 'SILHOUETTE', note: 'Everything flat black on bone. The Hollow Knight question: does the SHAPE read?',
    apply(lab) {
      lab.scene.background = new THREE.Color(0xcfc7b4);
      lab.scene.fog = new THREE.Fog(0xcfc7b4, 6, 26);
      // The shell IS the bone — you are inside a closed box, so the clear
      // colour is never on screen and cannot be the ground the shapes sit on.
      setAll(lab, (role) => new THREE.MeshBasicMaterial({
        color: role === 'shell' ? 0xcfc7b4 : 0x000000,
      }));
      for (const l of lab.lights) l.visible = false;
    },
  },

  toon: {
    id: 'toon', name: 'TOON 3-STEP', note: 'Hard 3-step ramp: flat fills, no gradients. Illustrated rather than rendered.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x0b0a10);
      lab.scene.fog = new THREE.Fog(0x1a1622, 5, 24);
      // A POINT light's distance attenuation is smooth and multiplies straight
      // through the ramp, so the bands vanish into a gradient — the first sheet
      // showed TOON and BASELINE as identical cells. A directional key has no
      // falloff, so the steps survive. Worth knowing before anyone tries toon
      // shading in a torch-lit game for real.
      for (const l of lab.lights) l.visible = false;
      const key = new THREE.DirectionalLight(0xffb070, 2.6);
      key.position.set(-4, 6, 3);
      lab.scene.add(key);
      lab.scene.add(new THREE.AmbientLight(0x33304a, 0.9));
      const ramp = toonRamp(3);
      setAll(lab, (role) => role === 'emissive'
        ? new THREE.MeshBasicMaterial({ color: 0xffd08a })
        : new THREE.MeshToonMaterial({
            color: role === 'creature' ? 0x6d5f52 : 0x9a9384, gradientMap: ramp,
          }));
    },
  },

  toonink: {
    id: 'toonink', name: 'TOON + HULL INK', note: 'The 3-step ramp with a real black outline around every solid. The full drawn read.',
    apply(lab) {
      STYLES.toon.apply(lab);
      addHullOutline(lab, 0.035);
    },
  },

  matcapstone: {
    id: 'matcapstone', name: 'MATCAP', note: 'No lights at all — shading baked into a matcap. Hand-painted look, zero light cost.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x0a0a0c);
      lab.scene.fog = new THREE.Fog(0x14121a, 5, 24);
      const stone = matcap(new THREE.Color(0x22201e), new THREE.Color(0xb9b0a0));
      const flesh = matcap(new THREE.Color(0x1a1012), new THREE.Color(0xa8624c));
      setAll(lab, (role) => role === 'emissive'
        ? new THREE.MeshBasicMaterial({ color: 0xffd08a })
        : new THREE.MeshMatcapMaterial({ matcap: role === 'creature' ? flesh : stone }));
      for (const l of lab.lights) l.visible = false;
    },
  },

  blueprint: {
    id: 'blueprint', name: 'BLUEPRINT', note: 'Wireframe on ink-blue: structure only. Ugly by design — it shows what the FORMS are doing.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x081018);
      lab.scene.fog = null;
      setAll(lab, () => new THREE.MeshBasicMaterial({ color: 0x5fa8d8, wireframe: true }));
      for (const l of lab.lights) l.visible = false;
    },
  },

  bonewash: {
    id: 'bonewash', name: 'BONE WASH', note: 'Pale unlit shell, near-black creatures, coloured air. Value structure carries everything.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x2b2a33);
      lab.scene.fog = new THREE.Fog(0x2b2a33, 3, 18);
      setAll(lab, (role) => {
        if (role === 'emissive') return new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
        if (role === 'creature') return new THREE.MeshBasicMaterial({ color: 0x0a0a0c });
        if (role === 'frame') return new THREE.MeshBasicMaterial({ color: 0x16161c });
        return new THREE.MeshLambertMaterial({ color: 0xb6ad99 });
      });
    },
  },

  emberglass: {
    id: 'emberglass', name: 'EMBER GLASS', note: 'Dark stone, hot rim, everything else swallowed. Light as the ONLY information.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x000000);
      lab.scene.fog = new THREE.Fog(0x000000, 2, 12);
      setAll(lab, (role) => role === 'emissive'
        ? new THREE.MeshBasicMaterial({ color: 0xffb060 })
        : new THREE.MeshStandardMaterial({
            color: 0x1a1613, roughness: 0.35, metalness: 0.55,
            emissive: role === 'creature' ? 0x2a0805 : 0x000000,
          }));
      (lab.lights[0] as THREE.PointLight).intensity = 40;
    },
  },




  // ── REVEAL-MODE EXPERIMENT ────────────────────────────────────────────────
  revReflected: revealRecipe('revReflected', 'REFLECTED', 'All three creatures take the room\'s colour. Albedo only, no rim, no glow.', 'reflected'),
  revEdged: revealRecipe('revEdged', 'EDGED', 'All three are black with a lit outline. The rim IS the light-out-of-shadow effect.', 'edged'),
  revSelflit: revealRecipe('revSelflit', 'SELF-LIT', 'All three make their own light. What the roster currently does to 15 of 23.', 'selflit'),
  revMixed: {
    id: 'revMixed', name: 'MIXED', note: 'One of each in one room — the only cell that answers whether the modes are one style or three.',
    apply(lab) {
      revealRoom(lab);
      const modes: Reveal[] = ['reflected', 'edged', 'selflit'];
      const tints = [0xffffff, 0xffb066, 0x7fd4ff];
      lab.creatureGroups.forEach((g, i) => applyReveal(lab, g, modes[i % 3], tints[i % 3]));
    },
  },

  // ── THE IMPORTANCE RULE ───────────────────────────────────────────────────
  //
  // Josh, after trying ink: *"it looked like any other game ... the light
  // emerging from shadows is way cooler I don't see the generalization rule of
  // that effect."* And separately: *"things that matter to pop out of the
  // dungeon, currently it's all like same. shaded even a lot of creatures are
  // brown thats a mess."*
  //
  // The reason ink disappointed is that an outline is a UNIFORM treatment — it
  // applies equally to the wall, the vase and the creature, so it improves
  // legibility and creates no HIERARCHY. It was solving the wrong problem.
  //
  // The rule the skeleton is the beginning of:
  //
  //     ALBEDO IS THE IMPORTANCE CHANNEL.
  //
  // What you see in a dark game is albedo x light. If every surface is
  // mid-brown, everything lands in the same value band however it is lit —
  // which IS the mush. The skeleton pops because it is the only high-albedo
  // thing in a low-albedo world; not because it is white, because it is the
  // EXCEPTION. So albedo gets assigned by importance rather than by realism.
  //
  // And the second half, which is the "light out of shadow" he likes:
  // SURFACES HAVE NO COLOUR, LIGHT HAS ALL OF IT. Then a creature in a
  // blood-lit hall IS red and the same creature under the lamp is bone — which
  // is what docs/VISUAL-LANGUAGE.md already prescribes (lamp is truth, torches
  // are rhetoric) and what the brown creatures are currently breaking.
  //
  // TWO CLAIMS, TWO RECIPES. `importance` runs the full rule; `importancehue`
  // keeps the sepia chroma and changes only the albedo. Sheeting both is the
  // only way to learn WHICH half is doing the work — the whole rule looking
  // good proves nothing about either of its halves.
  importance: {
    id: 'importance', name: 'IMPORTANCE', note: 'Albedo = how much this matters. Zero chroma anywhere. Light does all the colouring.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x030304);
      lab.scene.fog = new THREE.Fog(0x030304, 5, 22);
      // Pure greys, stepped by IMPORTANCE and nothing else.
      setAll(lab, (role) => {
        if (role === 'emissive') return new THREE.MeshBasicMaterial({ color: 0xfff2d8 });
        const albedo = role === 'creature' ? 0xf4f4f4    // matters most
                     : role === 'frame' ? 0xb4b4b4       // a threshold matters
                     : role === 'clutter' ? 0x343436     // present, not competing
                     : 0x121214;                          // shell: describes space, nothing more
        return new THREE.MeshLambertMaterial({ color: albedo });
      });
      applyImportanceLights(lab);
    },
  },
  importancehue: {
    id: 'importancehue', name: 'IMPORTANCE + HUE', note: 'Same albedo hierarchy, but surfaces KEEP their sepia. Isolates which half of the rule works.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x050403);
      lab.scene.fog = new THREE.Fog(0x050403, 5, 22);
      setAll(lab, (role) => {
        if (role === 'emissive') return new THREE.MeshBasicMaterial({ color: 0xfff2d8 });
        const albedo = role === 'creature' ? 0xd8c4a0
                     : role === 'frame' ? 0x9c8158
                     : role === 'clutter' ? 0x3a3026
                     : 0x16120d;
        return new THREE.MeshLambertMaterial({ color: albedo });
      });
      applyImportanceLights(lab);
    },
  },

  // ── THE FOUR BORROWED DIRECTIONS ──────────────────────────────────────────

  // BONELIGHT — Josh's own discovery, generalised. He noticed the skeleton
  // shifting red→yellow→white with distance and light, and loved it. That is
  // not an accident of the skeleton: a HIGH-ALBEDO, LOW-CHROMA surface has no
  // opinion of its own, so it reports whatever light hits it. It is a light
  // meter (docs/VISUAL-LANGUAGE.md already calls this the PAINTED mode).
  //
  // Which gives the diagnosis of the sepia problem from the other side: our
  // WALLS are pre-coloured. A brown wall cannot be made browner by a warm torch
  // or cold by a blue one — the surfaces spent the colour budget before the
  // lights got a turn. So this recipe does the opposite of "add more hues":
  // desaturate the shell to near-neutral dark, saturate the LIGHTS, and put
  // bone where the colour should land.
  bonelight: {
    id: 'bonelight', name: 'BONELIGHT', note: 'Neutral dark shell, bone creatures, saturated lights — the skeleton effect as a system.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x050507);
      lab.scene.fog = new THREE.Fog(0x050507, 4, 20);
      setAll(lab, (role) => {
        if (role === 'emissive') return new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
        // BONE: high albedo, no chroma of its own. The light does the colouring.
        if (role === 'creature' || role === 'clutter') {
          return new THREE.MeshLambertMaterial({ color: 0xf2ece0 });
        }
        // The shell gives up its brown so the lights can speak.
        return new THREE.MeshLambertMaterial({ color: role === 'frame' ? 0x3a3a3e : 0x2a2a2e });
      });
      for (const l of lab.lights) l.visible = false;
      // Two SATURATED sources of different hue, so one bone surface is sampled
      // by both and the shift is visible across a single object.
      const warm = new THREE.PointLight(0xff5a1e, 34, 15, 2);
      warm.position.set(-4.4, 2.5, -1.0);
      const cold = new THREE.PointLight(0x2e6cff, 22, 16, 2);
      cold.position.set(3.6, 2.6, -8.0);
      lab.scene.add(warm, cold, new THREE.AmbientLight(0x0c1018, 0.35));
    },
  },

  // MIGNOLA — enormous flat black masses, almost no midtone, ONE hot accent,
  // hard contour. The closest published thing to what this game is reaching
  // for, and the intersection of the three cells the lab has already shown work
  // (SILHOUETTE + RISO + INK).
  mignola: {
    id: 'mignola', name: 'MIGNOLA', note: 'Flat black masses on a saturated field, one hot accent, hard ink. No midtones.',
    apply(lab) {
      const field = 0x8a2b1e;   // the saturated ground a Mignola panel sits on
      lab.scene.background = new THREE.Color(field);
      lab.scene.fog = new THREE.Fog(field, 12, 30);
      setAll(lab, (role) => new THREE.MeshBasicMaterial({
        color: role === 'emissive' ? 0xffc24a
             : role === 'shell' ? field
             : 0x08070a,   // everything solid is one black mass
      }));
      for (const l of lab.lights) l.visible = false;
      addHullOutline(lab, 0.028);
    },
  },

  // HATCH — engraving. Line DENSITY as the shading model instead of smooth
  // falloff, which suits torchlight: a woodcut has no gradients either.
  hatch: {
    id: 'hatch', name: 'HATCH', note: 'Dürer, not a renderer: shading by line density. UV-space approximation — see patternTexture.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0xd8d2c2);
      lab.scene.fog = new THREE.Fog(0xd8d2c2, 12, 30);
      const ramp = toonRamp(4);
      setAll(lab, (role) => role === 'emissive'
        ? new THREE.MeshBasicMaterial({ color: 0x241a10 })
        : new THREE.MeshToonMaterial({
            color: role === 'creature' ? 0x8a7a68 : 0xcac2b0,
            gradientMap: ramp,
            map: patternTexture('hatch', role === 'shell' ? 14 : 4),
          }));
      for (const l of lab.lights) l.visible = false;
      const key = new THREE.DirectionalLight(0xffffff, 3.0);
      key.position.set(-4, 6, 3);
      lab.scene.add(key, new THREE.AmbientLight(0xffffff, 0.55));
      addHullOutline(lab, 0.02);
    },
  },

  // OBRA DINN — 1-bit. No palette at all; form carried purely by value and a
  // dither pattern. The extreme end, and the lesson transfers even if the style
  // does not: if dithering can do the shading, colour is freed entirely for
  // MEANING. (Approximated: a 2-step ramp plus a bayer map. The real thing
  // dithers in SCREEN space as a post pass, which this sandbox has no
  // composer for.)
  obradinn: {
    id: 'obradinn', name: '1-BIT', note: 'Two values, dithered. If pattern can shade, colour is freed entirely for meaning.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0xe8e4d8);
      lab.scene.fog = new THREE.Fog(0xe8e4d8, 10, 26);
      const ramp = toonRamp(2);
      setAll(lab, (role) => role === 'emissive'
        ? new THREE.MeshBasicMaterial({ color: 0x111111 })
        : new THREE.MeshToonMaterial({
            color: 0xffffff, gradientMap: ramp,
            map: patternTexture('bayer', role === 'shell' ? 20 : 6),
          }));
      for (const l of lab.lights) l.visible = false;
      const key = new THREE.DirectionalLight(0xffffff, 3.2);
      key.position.set(-4, 6, 3);
      lab.scene.add(key, new THREE.AmbientLight(0xffffff, 0.35));
      addHullOutline(lab, 0.022);
    },
  },

  // ── THE THREE UNEXPLORED DIRECTIONS ───────────────────────────────────────
  // Every look tried so far assumes darkness is the ground and light is the
  // information. These three each break one of those assumptions on purpose.

  // 1. INVERT THE VALUE. Bone walls, ink creatures, and the lamp casting a
  //    SHADOW instead of a glow. Unexplored, instantly distinctive, and it
  //    solves daylight legibility outright — you cannot wash out a page. Less
  //    of a betrayal of "grimdark through restraint" than it sounds: Mörk Borg
  //    is mostly cream paper.
  bleached: {
    id: 'bleached', name: 'BLEACHED', note: 'Pale dungeon, ink creatures, light as ABSENCE. Kill the assumption that dark is the ground.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0xe4dccb);
      lab.scene.fog = new THREE.Fog(0xe4dccb, 8, 30);
      setAll(lab, (role) => {
        if (role === 'creature') return new THREE.MeshBasicMaterial({ color: 0x100e10 });
        if (role === 'emissive') return new THREE.MeshBasicMaterial({ color: 0x3a2a18 });
        if (role === 'clutter' || role === 'frame') return new THREE.MeshLambertMaterial({ color: 0x8d867a });
        return new THREE.MeshLambertMaterial({ color: 0xded6c4 });
      });
      // A DARK light: the lamp subtracts. Three cannot do negative lights, so
      // the effect comes from an ambient that is already near-full and a point
      // light tinted below it — the room dims toward the torch instead of
      // brightening. Crude, and exactly the sort of thing a sandbox is for.
      for (const l of lab.lights) l.visible = false;
      lab.scene.add(new THREE.AmbientLight(0xffffff, 2.4));
      const shade = new THREE.PointLight(0x2a2438, 26, 14, 2);
      shade.position.set(-4.4, 2.5, -1.0);
      lab.scene.add(shade);
    },
  },

  // 2. TWO INKS AND PAPER. Not a palette — a risograph. Every hue in frame is
  //    one of two, and DEPTH is carried by which ink you are in. Cheap,
  //    memorable, and the room-mood tint system already supplies the second ink.
  ...risoFamily(),

  // 3. THE LAMP DRAWS THE WORLD. VOID taken seriously as geometry rather than
  //    as fog: outside the lamp there is no surface, only paper. Things enter
  //    existence as you illuminate them. The one that would get filmed — and
  //    the one most likely to be unreadable, which is exactly why it belongs in
  //    a sandbox and not in a sprint.
  summoned: {
    id: 'summoned', name: 'SUMMONED', note: 'NOT WORKING YET — the reveal radius keeps missing the subject. See the note below.',
    apply(lab) {
      lab.scene.background = new THREE.Color(0x07060a);
      // A HARD fog wall rather than a gradient: near and far almost equal, so
      // there is no fade — a surface is either present or it is not.
      lab.scene.fog = new THREE.Fog(0x07060a, 5.6, 8.2);
      setAll(lab, (role) => role === 'emissive'
        ? new THREE.MeshBasicMaterial({ color: 0xffe6b0 })
        : new THREE.MeshLambertMaterial({ color: role === 'creature' ? 0x6a5a4a : 0xcfc7b4 }));
      for (const l of lab.lights) l.visible = false;
      // TWO staging attempts, both recorded because the sensitivity IS the
      // finding: a hard reveal wall is brutally sensitive to what you point it
      // at. First pass had the wall at 5m with the archway 18m away — empty
      // black frame. Second moved the camera to 5.4m from the arch and the wall
      // was STILL 5.0 — empty again, by four tenths of a metre. A style whose
      // entire read depends on one object falling inside a hard radius needs
      // the radius and the staging designed together, which is a real cost to
      // weigh before anyone builds this for the game.
      //
      // MOVE UP. A hard 5m reveal wall with the archway 18m away renders an
      // empty black frame — the first sheet showed exactly that, and it read as
      // "the recipe is broken" when the recipe was fine and the STAGING was
      // wrong. A style that only shows what is within arm's reach has to be
      // judged from within arm's reach of something. Recipes may move the
      // camera; that is part of what a look decides.
      lab.camera.position.set(0, 1.6, -6.5);
      lab.camera.lookAt(0, 1.4, -13);
      // The lamp sits AT the camera — the reveal has to follow the eye, which
      // is the whole conceit.
      const lamp = new THREE.PointLight(0xfff0d0, 30, 6.5, 1.6);
      lamp.position.copy(lab.camera.position);
      lab.scene.add(lamp);
      lab.scene.add(new THREE.AmbientLight(0x0a0a12, 0.4));
    },
  },
};

export const STYLE_ORDER: readonly string[] = [
  'revReflected', 'revEdged', 'revSelflit', 'revMixed',
  'importance', 'importancehue', 'bonelight', 'riso3', 'mignola', 'hatch', 'obradinn',
  'riso1', 'riso2', 'riso4',
  'baseline', 'bleached', 'summoned',
  'toonink', 'toon', 'silhouette',
  'bonewash', 'matcapstone', 'emberglass', 'blueprint',
];

// ── Boot ────────────────────────────────────────────────────────────────────

/** Rebuild from scratch for each style. A recipe is allowed to mutate anything,
 *  so reusing one scene across styles would let recipe N inherit recipe N-1's
 *  leftovers — the same contamination the look sheet re-navigates to avoid. */
export function mountStyleLab(canvas: HTMLCanvasElement): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

  let lab: LabScene | null = null;

  function show(id: string): boolean {
    const recipe = STYLES[id];
    if (!recipe) return false;
    lab = buildLabScene();
    recipe.apply(lab);
    resize();
    return true;
  }

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    if (lab) { lab.camera.aspect = w / h; lab.camera.updateProjectionMatrix(); }
  }
  window.addEventListener('resize', resize);

  function frame(): void {
    if (lab) renderer.render(lab.scene, lab.camera);
    requestAnimationFrame(frame);
  }

  const w = window as unknown as Record<string, unknown>;
  w.__style = (id: string) => show(id);
  w.__styles = () => STYLE_ORDER.map((id) => ({ id, name: STYLES[id].name, note: STYLES[id].note }));
  w.__styleReady = true;

  const wanted = new URLSearchParams(window.location.search).get('style');
  show(wanted && STYLES[wanted] ? wanted : 'baseline');
  frame();
}
