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
  const body = mesh(new THREE.CapsuleGeometry(0.38, 0.9, 4, 10), -1.1, 1.0, -3.2);
  const head = mesh(new THREE.SphereGeometry(0.3, 12, 10), -1.1, 1.8, -3.2);
  const armL = mesh(new THREE.CapsuleGeometry(0.09, 0.7, 3, 6), -1.6, 1.1, -3.1);
  const armR = mesh(new THREE.CapsuleGeometry(0.09, 0.7, 3, 6), -0.6, 1.1, -3.1);
  armL.rotation.z = 0.4; armR.rotation.z = -0.3;
  roles.creature.push(body, head, armL, armR);

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

  return { scene, camera, roles, lights };
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
  riso: {
    id: 'riso', name: 'RISO 2-INK', note: 'Two inks on paper, nothing else. Depth carried by WHICH ink, not by value.',
    apply(lab) {
      const paper = 0xdad2c0, inkA = 0x1d2b4a, inkB = 0xb0402f;
      lab.scene.background = new THREE.Color(paper);
      lab.scene.fog = new THREE.Fog(paper, 10, 26);
      setAll(lab, (role) => new THREE.MeshBasicMaterial({
        color: role === 'creature' ? inkB
             : role === 'emissive' ? inkB
             : role === 'shell' ? paper : inkA,
      }));
      for (const l of lab.lights) l.visible = false;
      addHullOutline(lab, 0.03);
    },
  },

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
  'baseline', 'bleached', 'riso', 'summoned',
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
