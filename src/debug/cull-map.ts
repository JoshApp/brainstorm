// ── THE CULL MAP — LOOK DOWN AT THE ALGORITHM ────────────────────────────────
//
// Josh: *"can you make me a debug overlay so I can see what is culled — a 2D room map of
// the dungeon with light sources, that shows me where I am and what is rendering around me,
// also things rendering in other rooms I can't see, to catch bugs."*
//
// Every visibility bug this session shared one property: it was a WRONG DECISION ABOUT A
// PLACE THE PLAYER COULD NOT SEE. A torch dark in the room you are standing in is at least
// visible as a symptom. A torch still burning three rooms away, a flame drawn behind a
// sealed door, a space at gate 4 that is somehow still in the draw list — none of those can
// be seen from inside the game, by construction, because seeing them is the thing being
// decided. So they were found by reading probe output in a console and holding a floor plan
// in my head, which took most of a day and got the diagnosis wrong twice.
//
// A top-down plan is the instrument that was missing. It shows the decision, not the
// consequence.
//
// ── WHAT IT DRAWS, AND WHY EACH LAYER IS THERE ──────────────────────────────
//
//   SPACES     — every rect the culler knows, filled by whether it is being DRAWN, labelled
//                with its gate count. The floor plan is the frame everything else hangs on.
//   RINGS      — fog near/far, crush start/end, lamp reach, as circles around the player.
//                Four systems darken distance independently and none of them knew about the
//                others; drawn concentrically you can finally see which one is the wall you
//                are hitting. Josh asked for exactly this: *"fog and crush drawn in as an
//                indicator around me."*
//   FOV        — the camera's real horizontal field of view, from its fov and aspect. The
//                frustum is why the draw list is not a fact about the world, and the wedge
//                is what makes that visible: swing it and watch spaces drop out.
//   VEILS      — each threshold as a segment, opacity = how closed. Gate counts are
//                computed FROM these, so a map full of pale veils explains a floor that has
//                collapsed to gate 0 far faster than any number does.
//   LIGHTS     — every source with the test that dropped it: range, gates, off-screen,
//                outranked, or bound.
//   SIGNALS    — flames, runes, markers, and whether each is drawn.
//   LEGEND     — drawn with the same functions as the marks, so it cannot go stale.
//   ANOMALIES  — the point of the whole thing. A light bound in a space that is not drawn, a
//                signal drawn past the gate horizon, a drawn space the walk never reached.
//                Ringed in red and counted in the header, so a bug announces itself instead
//                of waiting to be noticed.
//
// DEV only, `pointer-events: none` so it can never eat a look-drag, and it reads snapshots
// rather than recomputing anything — a debug view that re-derives the rule it is checking
// is a debug view that agrees with itself and lies to you.

import * as THREE from 'three';
import { DEV } from './dev';
import { debugCullSnapshot, type CullSnapshotSpace } from '../level/room-culling';
import { passes } from '../level/space-index';
import { debugLightMap, type LightMapRow } from '../scene/light-pool';
import { debugVeilMap, type VeilMapRow } from '../scene/threshold-veil';
import { debugSignalMap, type SignalMapRow } from '../scene/signal-layer';
import { sightNear, sightFar } from '../scene/sight-distance';
import { webGPUDarknessLive } from '../style/render-webgpu';
import { darkKnobs } from './tuning-dark';
import { signalKnobs } from './tuning-signal';
import { pausedReason } from '../world-paused';

// ── PALETTE ─────────────────────────────────────────────────────────────────
// Warm = being drawn, cold = not. Deliberately NOT the game's palette: this is an
// instrument, and it should never be mistaken for a look.
const C = {
  bg: 'rgba(8, 10, 16, 0.88)',
  frame: 'rgba(150, 180, 255, 0.35)',
  // Drawn vs culled has to survive a glance on a phone, so they differ on THREE counts at
  // once — fill, outline brightness, and solid-versus-dashed — rather than on two shades of
  // the same blue, which is what Josh was squinting at: *"I see 3 levels of light blue and
  // green, what are these?"* The portal graph is cyan and was reading as a third blue, so it
  // moves further toward teal and away from the space colours.
  spaceDrawn: 'rgba(120, 170, 255, 0.28)',
  spaceDrawnEdge: 'rgba(150, 200, 255, 0.9)',
  spaceDark: 'rgba(80, 90, 120, 0.05)',
  spaceDarkEdge: 'rgba(105, 120, 160, 0.5)',
  standing: 'rgba(120, 255, 190, 0.85)',
  text: 'rgba(200, 225, 255, 0.85)',
  dim: 'rgba(160, 180, 220, 0.45)',
  player: 'rgba(255, 240, 200, 0.95)',
  fov: 'rgba(255, 240, 200, 0.10)',
  veil: 'rgba(255, 120, 200, 0.95)',
  veilOpen: 'rgba(120, 255, 170, 0.95)',
  portalOpen: 'rgba(80, 230, 200, 0.55)',
  portalShut: 'rgba(70, 110, 105, 0.35)',
  portalMouth: 'rgba(80, 240, 205, 0.95)',
  lightBound: 'rgba(255, 200, 90, 0.95)',
  lightDropped: 'rgba(120, 130, 150, 0.55)',
  signalOn: 'rgba(150, 255, 200, 0.9)',
  signalOff: 'rgba(90, 110, 100, 0.5)',
  bad: 'rgba(255, 70, 70, 0.95)',
  ringFog: 'rgba(120, 160, 255, 0.5)',
  ringCrush: 'rgba(255, 140, 80, 0.5)',
  ringLamp: 'rgba(255, 240, 180, 0.35)',
};

let wrap: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let enabled = false;
let camera: THREE.Camera | null = null;

// ── WHERE THE WINDOW SITS, REMEMBERED ────────────────────────────────────────
//
// A window position IS a preference — unlike a camera yaw, which is a verb and is
// deliberately never saved (see markTransient in tuning.ts). Moving the map somewhere and
// having it stay there across a reload is the whole point of moving it.
const RECT_KEY = 'delve.cullmap.rect';
interface WinRect { x: number; y: number; w: number; h: number }

function loadRect(): WinRect {
  const side = Math.round(Math.min(window.innerHeight, window.innerWidth) * 0.46);
  const fallback: WinRect = { x: 10, y: window.innerHeight - side - 10, w: side, h: side };
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (!raw) return fallback;
    const r = JSON.parse(raw) as WinRect;
    if (![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return fallback;
    return clampRect(r);
  } catch { return fallback; }
}

/** Never let it be dragged somewhere it cannot be dragged back from. Keeps at least the
 *  title strip on screen in both axes, which is the part you grab. */
function clampRect(r: WinRect): WinRect {
  const w = Math.max(160, Math.min(r.w, window.innerWidth));
  const h = Math.max(140, Math.min(r.h, window.innerHeight));
  return {
    w, h,
    x: Math.max(-w + 80, Math.min(r.x, window.innerWidth - 80)),
    y: Math.max(0, Math.min(r.y, window.innerHeight - 24)),
  };
}

function saveRect(r: WinRect): void {
  try { localStorage.setItem(RECT_KEY, JSON.stringify(r)); } catch { /* private mode */ }
}

function applyRect(r: WinRect): void {
  if (!wrap) return;
  wrap.style.left = `${r.x}px`;
  wrap.style.top = `${r.y}px`;
  wrap.style.width = `${r.w}px`;
  wrap.style.height = `${r.h}px`;
}

/** Wired once at boot so the overlay can read the player's pose. */
export function initCullMap(cam: THREE.Camera): void {
  camera = cam;
}

export function cullMapEnabled(): boolean { return enabled; }

/** Toggle (or set). Returns the new state. */
export function setCullMap(on?: boolean): boolean {
  if (!DEV) return false;
  enabled = on ?? !enabled;
  if (!enabled && wrap) { wrap.style.display = 'none'; }
  if (enabled) mount();
  return enabled;
}

// ── DRAGGABLE AND RESIZABLE, WITHOUT GIVING UP THE ONE GUARANTEE ────────────
//
// Josh: *"make the map draggable and resizable."*
//
// The map has been `pointer-events: none` from the start and that is not incidental — a
// debug view that swallows a look-drag makes the bug you are chasing harder to reproduce,
// which is the opposite of the job. So the WINDOW stays transparent to input and exactly two
// small targets are not: a title strip you grab to move it, and a corner grip you pull to
// size it. Everything else, including the whole plan, still lets a drag through to the game
// underneath.
//
// Pointer events with capture, so a drag that leaves the handle keeps tracking — on a phone
// a resize drag crosses the map body constantly, and without capture the first crossing ends
// the gesture.
function mount(): void {
  if (wrap) { wrap.style.display = 'flex'; return; }

  const rect = loadRect();
  wrap = document.createElement('div');
  wrap.id = 'cull-map-window';
  Object.assign(wrap.style, {
    position: 'fixed',
    left: `${rect.x}px`, top: `${rect.y}px`,
    width: `${rect.w}px`, height: `${rect.h}px`,
    display: 'flex', flexDirection: 'column',
    border: '1px solid rgba(150, 180, 255, 0.35)',
    borderRadius: '4px',
    overflow: 'hidden',
    zIndex: '8050',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);

  // The grab strip. Doubles as a label so the window says what it is.
  const bar = document.createElement('div');
  bar.textContent = '⠿ CULL MAP';
  Object.assign(bar.style, {
    flex: '0 0 auto',
    padding: '3px 6px',
    background: 'rgba(20, 26, 40, 0.95)',
    borderBottom: '1px solid rgba(150, 180, 255, 0.25)',
    color: 'rgba(190, 215, 255, 0.8)',
    font: '600 10px ui-monospace, monospace',
    letterSpacing: '0.12em',
    cursor: 'move',
    pointerEvents: 'auto',
    touchAction: 'none',
    userSelect: 'none',
  } as Partial<CSSStyleDeclaration>);

  canvas = document.createElement('canvas');
  canvas.id = 'cull-map';
  Object.assign(canvas.style, {
    flex: '1 1 auto',
    width: '100%',
    minHeight: '0',
    display: 'block',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);

  const grip = document.createElement('div');
  Object.assign(grip.style, {
    position: 'absolute',
    right: '0', bottom: '0',
    width: '22px', height: '22px',
    background: 'linear-gradient(135deg, transparent 50%, rgba(150, 180, 255, 0.5) 50%)',
    cursor: 'nwse-resize',
    pointerEvents: 'auto',
    touchAction: 'none',
  } as Partial<CSSStyleDeclaration>);

  wrap.append(bar, canvas, grip);
  document.body.appendChild(wrap);
  ctx2d = canvas.getContext('2d');

  let mode: 'move' | 'size' | null = null;
  let startX = 0, startZ = 0;
  let start: WinRect = rect;

  const begin = (kind: 'move' | 'size') => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    mode = kind;
    startX = e.clientX; startZ = e.clientY;
    start = { x: parseFloat(wrap!.style.left), y: parseFloat(wrap!.style.top),
              w: wrap!.offsetWidth, h: wrap!.offsetHeight };
    // Capture is an OPTIMISATION, not the mechanism: without it a drag that leaves the
    // handle stops tracking, but a failure to acquire it must not abort the gesture — and
    // it does fail for synthetic pointers, which is how the save below got skipped.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
  };
  const move = (e: PointerEvent) => {
    if (!mode) return;
    e.preventDefault();
    const dx = e.clientX - startX, dy = e.clientY - startZ;
    const next = mode === 'move'
      ? { ...start, x: start.x + dx, y: start.y + dy }
      : { ...start, w: start.w + dx, h: start.h + dy };
    applyRect(clampRect(next));
  };
  const end = (e: PointerEvent) => {
    if (!mode) return;
    mode = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* fine */ }
    saveRect({ x: parseFloat(wrap!.style.left), y: parseFloat(wrap!.style.top),
               w: wrap!.offsetWidth, h: wrap!.offsetHeight });
  };
  for (const [el, kind] of [[bar, 'move'], [grip, 'size']] as const) {
    el.addEventListener('pointerdown', begin(kind));
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // A resized viewport (phone rotation) can strand the window off-screen.
  window.addEventListener('resize', () => {
    if (!wrap) return;
    applyRect(clampRect({ x: parseFloat(wrap.style.left), y: parseFloat(wrap.style.top),
                          w: wrap.offsetWidth, h: wrap.offsetHeight }));
  });
}

/** World→canvas fit, recomputed per frame: the floor does not change but the canvas can. */
interface Fit { ox: number; oz: number; s: number; }

/**
 * Fit the plan into the space the CHROME leaves, not the whole canvas.
 *
 * The header, the legend column and the active readout are drawn over fixed corners, so a
 * fit against the full rect puts the plan underneath them — invisible at exactly the window
 * sizes where you most want it, because the chrome does not shrink.
 */
function fitFor(spaces: CullSnapshotSpace[], w: number, h: number,
                inset: { top: number; right: number; bottom: number }): Fit {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const sp of spaces) {
    minX = Math.min(minX, sp.cx - sp.hw); maxX = Math.max(maxX, sp.cx + sp.hw);
    minZ = Math.min(minZ, sp.cz - sp.hd); maxZ = Math.max(maxZ, sp.cz + sp.hd);
  }
  if (!Number.isFinite(minX)) return { ox: 0, oz: 0, s: 1 };
  const pad = 8;
  const left = pad, top = inset.top + pad;
  const availW = Math.max(40, w - inset.right - left - pad);
  const availH = Math.max(40, h - inset.bottom - top - pad);
  const s = Math.min(availW / Math.max(1, maxX - minX), availH / Math.max(1, maxZ - minZ));
  // Centre the plan in what is left.
  const ox = left + (availW - (maxX - minX) * s) / 2 - minX * s;
  const oz = top + (availH - (maxZ - minZ) * s) / 2 - minZ * s;
  return { ox, oz, s };
}

const px = (f: Fit, x: number) => f.ox + x * f.s;
const pz = (f: Fit, z: number) => f.oz + z * f.s;

// ── THE GRAMMAR ──────────────────────────────────────────────────────────────
//
// Josh: *"what are the yellow circles that aren't lights? Some are portals but some are in
// the room. Can you vary the visual language so I know what objects are?"*
//
// They were all lights — but every kind of light was one amber dot, so a FILL source (an
// ambience light with no emitter you can look at, floating in the middle of a room by
// design) was indistinguishable from a torch on a wall. One glyph for five different things
// is not a legend problem, it is a grammar problem.
//
// Three axes, each carrying exactly one meaning, so any mark can be read without looking
// anything up:
//
//   SHAPE  = WHAT IT IS.     circle emitter · cross fill · square signal · ring portal mouth
//                            · triangle you · segment veil
//   FILL   = IS IT ON.       solid = bound / drawn / crossed. hollow = dropped / hidden.
//   COLOUR = IS IT RIGHT.    amber live · grey inert · cyan portal · pink veil · RED wrong.
//
// Red is reserved for anomalies and never used for a normal state, so anything red on this
// map is a bug and not a mood.

/** A ring: the portal mouth, and the hollow form of anything that got dropped. */
function ring(g: CanvasRenderingContext2D, x: number, z: number, r: number, col: string, lw: number): void {
  g.beginPath();
  g.arc(x, z, r, 0, Math.PI * 2);
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.stroke();
}

function disc(g: CanvasRenderingContext2D, x: number, z: number, r: number, col: string): void {
  g.beginPath();
  g.arc(x, z, r, 0, Math.PI * 2);
  g.fillStyle = col;
  g.fill();
}

/** A fill light — ambience with no emitter. A cross, because there is nothing there to see. */
function cross(g: CanvasRenderingContext2D, x: number, z: number, r: number, col: string, lw: number): void {
  g.beginPath();
  g.moveTo(x - r, z - r); g.lineTo(x + r, z + r);
  g.moveTo(x + r, z - r); g.lineTo(x - r, z + r);
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.stroke();
}

export function tickCullMap(): void {
  if (!DEV || !enabled || !canvas || !ctx2d || !camera) return;

  const spaces = debugCullSnapshot();
  const g = ctx2d;

  // Match the backing store to the CSS box once per size change, so lines stay crisp on a
  // phone's DPR without redoing it every frame.
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = C.bg;
  g.fillRect(0, 0, w, h);
  g.font = `${Math.round(9 * dpr)}px ui-monospace, monospace`;

  if (!spaces || spaces.length === 0) {
    g.fillStyle = C.dim;
    g.fillText('no culler publishing', 10 * dpr, 18 * dpr);
    return;
  }

  // Reserve what the chrome occupies: header rows on top, the legend column on the right,
  // the in-force readout along the bottom.
  const f = fitFor(spaces, w, h, {
    top: 26 * dpr,
    right: 118 * dpr,
    bottom: 62 * dpr,
  });
  const cam = camera.position;
  // Camera yaw in world terms: -Z is forward, so this is the angle of the view direction
  // projected onto the plan.
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const yaw = Math.atan2(dir.x, dir.z);

  const lights = debugLightMap();
  const veils = debugVeilMap();
  const signals = debugSignalMap();
  const maxSignalGates = signalKnobs.gates();
  const maxLightGates = signalKnobs.lightGates();

  // ── ANOMALIES ─────────────────────────────────────────────────────────────
  // Computed before drawing so the header can count them, and so each layer can ring its
  // own offenders. These are the questions that have no answer from inside the game.
  const drawnById = new Map(spaces.map((s) => [s.id, s]));
  let anomalies = 0;
  // ── AN ANOMALY IS A THING BREAKING ITS OWN RULE ───────────────────────────
  //
  // This used to flag any light bound in a space that was not being DRAWN, which was right
  // while lights were culled by the draw list and became wrong the moment they stopped
  // being: a room behind you is not drawn, and its torch legitimately lights the corridor
  // you are standing in. A check against the wrong rule reports honest behaviour as a bug,
  // which is worse than no check — it trains you to ignore the red.
  //
  // So each thing is checked against the policy that actually governs it. A light is
  // anomalous when it holds a slot while failing the light policy; a signal when it is drawn
  // while failing the signal policy. Both are self-consistency: the system contradicting
  // itself, which is the only thing a map can honestly call a bug.
  const lightPolicy = { maxGates: maxLightGates };
  // TWO ways a light can be wrong, and they look identical from inside the game.
  //   · It holds a slot it should not — it broke its own policy.
  //   · It holds a slot and emits NOTHING — Josh: *"why did lights stop drawing even though
  //     the map shows them as active?"* That is the gap between winning a slot and putting
  //     out light, and it is invisible to any count of binds.
  const lightBad = (l: LightMapRow) =>
    l.why === '' && (!passes(lightPolicy, { gates: l.gates }) || l.emit < 0.01);
  const signalBad = (m: SignalMapRow) =>
    m.visible && !passes({ maxGates: maxSignalGates }, { gates: m.gates });
  const spaceBad = (sp: CullSnapshotSpace) => sp.drawn && !Number.isFinite(sp.gates);
  for (const l of lights) if (lightBad(l)) anomalies++;
  for (const m of signals) if (signalBad(m)) anomalies++;
  for (const sp of spaces) if (spaceBad(sp)) anomalies++;

  // ── THE PORTAL GRAPH ──────────────────────────────────────────────────────
  //
  // Josh: *"show the portals."* This is the structure both walks actually run on — the
  // visibility flood and the gate count are traversals of these edges and nothing else. A
  // room that will not light up has two completely different causes that look the same from
  // the floor: a threshold the flood refused to cross, or NO EDGE AT ALL between the two
  // rects. Drawn, they are one glance apart.
  //
  // Bright when both ends are being drawn — the flood came through here this frame. Dim when
  // it did not. The dot is the opening's own position, which is also worth seeing: a
  // doorway inferred from two bounding boxes can land in solid stone, and that has been a
  // real bug on this floor plan more than once.
  for (const sp of spaces) {
    for (const o of sp.openings) {
      const other = drawnById.get(o.to);
      if (!other || other.id < sp.id) continue;      // one line per pair
      const crossed = sp.drawn && other.drawn;
      g.beginPath();
      g.moveTo(px(f, sp.cx), pz(f, sp.cz));
      g.lineTo(px(f, o.x), pz(f, o.z));
      g.lineTo(px(f, other.cx), pz(f, other.cz));
      g.strokeStyle = crossed ? C.portalOpen : C.portalShut;
      g.lineWidth = (crossed ? 1.2 : 0.8) * dpr;
      g.stroke();
      // A RING, never a disc: a portal mouth is a hole, and the one thing it must not be
      // confused with is a light. Filled when the flood came through it this frame.
      ring(g, px(f, o.x), pz(f, o.z), 2.2 * dpr, crossed ? C.portalMouth : C.portalShut, 1.2 * dpr);
    }
  }

  // ── SPACES ────────────────────────────────────────────────────────────────
  for (const sp of spaces) {
    g.beginPath();
    if (sp.poly && sp.poly.length >= 3) {
      g.moveTo(px(f, sp.poly[0][0]), pz(f, sp.poly[0][1]));
      for (let i = 1; i < sp.poly.length; i++) g.lineTo(px(f, sp.poly[i][0]), pz(f, sp.poly[i][1]));
      g.closePath();
    } else {
      g.rect(px(f, sp.cx - sp.hw), pz(f, sp.cz - sp.hd), sp.hw * 2 * f.s, sp.hd * 2 * f.s);
    }
    g.fillStyle = sp.drawn ? C.spaceDrawn : C.spaceDark;
    g.fill();
    // DASHED means culled. A third channel beyond fill and brightness, because two shades of
    // blue is not a distinction you can make at a glance on a phone in a dark room.
    g.setLineDash(sp.drawn || sp.standing ? [] : [3 * dpr, 3 * dpr]);
    g.lineWidth = (sp.standing ? 2.4 : 1) * dpr;
    g.strokeStyle = spaceBad(sp) ? C.bad : sp.standing ? C.standing : sp.drawn ? C.spaceDrawnEdge : C.spaceDarkEdge;
    g.stroke();
    g.setLineDash([]);

    // Closed thresholds from you — the one axis anything outside the culler is bound by, so
    // a thing culled here can be read straight off the plan.
    g.fillStyle = sp.drawn ? C.text : C.dim;
    const label = Number.isFinite(sp.gates) ? `g${sp.gates}` : 'g∞';
    g.fillText(label, px(f, sp.cx) - 5 * dpr, pz(f, sp.cz) + 3 * dpr);
  }

  // ── RINGS: the four systems that darken distance, concentric ──────────────
  const cxp = px(f, cam.x), czp = pz(f, cam.z);
  const distRing = (metres: number, colour: string, dash: number[], label: string) => {
    const r = metres * f.s;
    if (r < 3 || r > Math.max(w, h)) return;
    g.beginPath();
    g.setLineDash(dash.map((d) => d * dpr));
    g.arc(cxp, czp, r, 0, Math.PI * 2);
    g.strokeStyle = colour;
    g.lineWidth = 1 * dpr;
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = colour;
    g.fillText(label, cxp + 2 * dpr, czp - r - 2 * dpr);
  };
  const dark = webGPUDarknessLive();
  distRing(sightNear(), C.ringFog, [2, 3], '');
  distRing(sightFar(), C.ringFog, [4, 3], 'fog');
  distRing(dark.crushStart, C.ringCrush, [2, 4], '');
  distRing(dark.crushEnd, C.ringCrush, [5, 4], 'crush');
  distRing(darkKnobs.lampDistance(), C.ringLamp, [1, 3], 'lamp');

  // ── FOV WEDGE — the reason the draw list is not a fact about the world ────
  const persp = camera as THREE.PerspectiveCamera;
  if (persp.isPerspectiveCamera) {
    const vFov = (persp.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * persp.aspect);
    const reach = Math.max(sightFar(), dark.crushEnd) * f.s;
    g.beginPath();
    g.moveTo(cxp, czp);
    // Plan angles: screen +x is world +x, screen +y is world +z, so a world direction
    // (dx, dz) points along (dx, dz) here too. Zero is +z, growing toward +x.
    g.arc(cxp, czp, reach, Math.PI / 2 - yaw - hFov / 2, Math.PI / 2 - yaw + hFov / 2);
    g.closePath();
    g.fillStyle = C.fov;
    g.fill();
  }

  // ── VEILS ─────────────────────────────────────────────────────────────────
  // ── VEILS: HOW SHUT, AND THE MOMENT ONE GIVES ─────────────────────────────
  //
  // Josh: *"can you indicate when a veil opens and how much, so I can see when it gives?"*
  //
  // Three things at once, because the interesting event is not the alpha drifting, it is the
  // instant it crosses the line where the gate stops counting:
  //
  //   COLOUR  ramps pink (shut) → green (open), so easing is visible as it happens.
  //   WEIGHT  thins as it lifts, so a doorway that has given reads as a thinner mark.
  //   DASH    is the EVENT. Solid means this threshold still costs a gate; dashed means it
  //           has crossed VEIL_SHUT_ALPHA and is free to walk through. That flip is the exact
  //           frame the room beyond joins your light, and it is the thing worth watching.
  //
  // The number is the alpha in percent, drawn beside it when there is room for it.
  const showVeilNums = f.s > 3.5;
  for (const v of veils) {
    const half = 0.9 * f.s;
    // The veil's local X runs along the wall; rotY is how it was placed.
    const dx = Math.cos(v.rotY) * half, dz = -Math.sin(v.rotY) * half;
    const x = px(f, v.x), z = pz(f, v.z);
    const shut = v.alpha > 0.5;      // must match VEIL_SHUT_ALPHA in room-culling.ts
    g.beginPath();
    g.moveTo(x - dx, z - dz);
    g.lineTo(x + dx, z + dz);
    // An unwarmed veil has never ticked. It is not open, it is UNASKED — red, because a
    // whole floor of them means the world is paused and every gate on this map is stale.
    if (!v.warm) {
      g.strokeStyle = C.bad;
      g.lineWidth = 2.5 * dpr;
    } else {
      g.strokeStyle = shut ? C.veil : C.veilOpen;
      g.lineWidth = (1 + v.alpha * 2) * dpr;
      g.setLineDash(shut ? [] : [2.5 * dpr, 2.5 * dpr]);
    }
    g.stroke();
    g.setLineDash([]);
    if (showVeilNums && v.warm) {
      g.fillStyle = shut ? C.veil : C.veilOpen;
      g.fillText(String(Math.round(v.alpha * 100)), x + 4 * dpr, z - 3 * dpr);
    }
  }

  // ── LIGHTS ────────────────────────────────────────────────────────────────
  for (const l of lights) {
    const x = px(f, l.x), z = pz(f, l.z);
    const bad = lightBad(l);
    const on = l.why === '';
    const col = bad ? C.bad : on ? C.lightBound : C.lightDropped;
    // Kind from the source's own fields, not from its id: category and priority are what
    // the pool actually decides on, and an id prefix is a naming convention that will drift.
    if (l.priority === 'low') {
      // A FILL. No emitter, nothing to look at — which is why it kept reading as a mystery
      // circle in the middle of an empty room.
      cross(g, x, z, 2.4 * dpr, col, 1.2 * dpr);
    } else if (l.category === 'lamp') {
      // Your own lantern. Drawn as a wide ring because it is centred on you and a disc here
      // would just sit under the player triangle.
      ring(g, x, z, 5 * dpr, col, 1 * dpr);
    } else if (on && l.emit < 0.01) {
      // Bound and emitting nothing: drawn as a hollow RED disc so it cannot be mistaken for
      // either a lit torch or a culled one.
      ring(g, x, z, 3 * dpr, C.bad, 1.4 * dpr);
    } else if (on) {
      disc(g, x, z, 3 * dpr, col);
    } else {
      ring(g, x, z, 2.4 * dpr, col, 1 * dpr);
    }
    if (bad) ring(g, x, z, 7 * dpr, C.bad, 1.5 * dpr);
  }

  // ── SIGNALS ───────────────────────────────────────────────────────────────
  for (const m of signals) {
    const x = px(f, m.x), z = pz(f, m.z);
    const bad = signalBad(m);
    const col = bad ? C.bad : m.visible ? C.signalOn : C.signalOff;
    const r = 1.8 * dpr;
    if (m.visible || bad) {
      g.fillStyle = col;
      g.fillRect(x - r, z - r, r * 2, r * 2);
    } else {
      g.strokeStyle = col;
      g.lineWidth = 1 * dpr;
      g.strokeRect(x - r, z - r, r * 2, r * 2);
    }
  }

  // ── PLAYER ────────────────────────────────────────────────────────────────
  g.save();
  g.translate(cxp, czp);
  g.rotate(-yaw);
  g.beginPath();
  g.moveTo(0, -6 * dpr);
  g.lineTo(4 * dpr, 4 * dpr);
  g.lineTo(-4 * dpr, 4 * dpr);
  g.closePath();
  g.fillStyle = C.player;
  g.fill();
  g.restore();

  // ── HEADER ────────────────────────────────────────────────────────────────
  const drawnCount = spaces.filter((s) => s.drawn).length;
  const boundCount = lights.filter((l) => l.why === '').length;
  const darkCount = lights.filter((l) => l.why === '' && l.emit < 0.01).length;
  const shownSignals = signals.filter((m) => m.visible).length;
  const unwarmed = veils.filter((v) => !v.warm).length;
  g.fillStyle = anomalies > 0 ? C.bad : C.text;
  g.fillText(
    `${drawnCount}/${spaces.length} drawn · ${boundCount}/${lights.length} lit`
    + (darkCount ? ` (${darkCount} DARK)` : '')
    + ` · ${shownSignals}/${signals.length} sig · gate≤${maxLightGates}`
    + (anomalies ? `  ⚠ ${anomalies}` : ''),
    8 * dpr, 12 * dpr,
  );
  if (unwarmed) {
    g.fillStyle = C.bad;
    g.fillText(`${unwarmed}/${veils.length} veils never ticked`, 8 * dpr, 24 * dpr);
  }

  // ── THE LEGEND ────────────────────────────────────────────────────────────
  //
  // Josh: *"provide a small legend in the map."* Drawn with the SAME functions that draw the
  // marks, so it cannot drift from what it describes — a legend maintained separately from
  // its map is a legend that is wrong within a week.
  //
  // Right-aligned so it never collides with the plan, which grows leftward from the fit.
  const lx = w - 8 * dpr;
  let ly = 26 * dpr;
  const row = (draw: (x: number, y: number) => void, label: string) => {
    g.fillStyle = C.dim;
    const tw = g.measureText(label).width;
    g.fillText(label, lx - tw, ly + 3 * dpr);
    draw(lx - tw - 8 * dpr, ly);
    ly += 11 * dpr;
  };
  // The space states come first: they are the frame everything else is read against, and
  // the legend used to describe only the marks drawn ON them.
  const swatch = (fill: string, edge: string, dash: boolean, lw: number) => (x: number, y: number) => {
    const w2 = 5 * dpr, h2 = 3.5 * dpr;
    g.fillStyle = fill;
    g.fillRect(x - w2, y - h2, w2 * 2, h2 * 2);
    g.setLineDash(dash ? [2 * dpr, 2 * dpr] : []);
    g.strokeStyle = edge;
    g.lineWidth = lw * dpr;
    g.strokeRect(x - w2, y - h2, w2 * 2, h2 * 2);
    g.setLineDash([]);
  };
  row(swatch(C.spaceDrawn, C.standing, false, 2.4), 'you are in it');
  row(swatch(C.spaceDrawn, C.spaceDrawnEdge, false, 1), 'drawn');
  row(swatch(C.spaceDark, C.spaceDarkEdge, true, 1), 'culled');
  row((x, y) => disc(g, x, y, 3 * dpr, C.lightBound), 'torch · lit');
  row((x, y) => ring(g, x, y, 2.4 * dpr, C.lightDropped, 1 * dpr), 'torch · dropped');
  row((x, y) => cross(g, x, y, 2.4 * dpr, C.lightBound, 1.2 * dpr), 'fill · no emitter');
  row((x, y) => { g.fillStyle = C.signalOn; g.fillRect(x - 1.8 * dpr, y - 1.8 * dpr, 3.6 * dpr, 3.6 * dpr); }, 'signal · shown');
  row((x, y) => { g.strokeStyle = C.signalOff; g.lineWidth = dpr; g.strokeRect(x - 1.8 * dpr, y - 1.8 * dpr, 3.6 * dpr, 3.6 * dpr); }, 'signal · hidden');
  row((x, y) => ring(g, x, y, 2.2 * dpr, C.portalMouth, 1.2 * dpr), 'portal mouth');
  row((x, y) => {
    g.strokeStyle = C.veil; g.lineWidth = 2.5 * dpr;
    g.beginPath(); g.moveTo(x - 4 * dpr, y); g.lineTo(x + 4 * dpr, y); g.stroke();
  }, 'veil shut · costs a gate');
  row((x, y) => {
    g.strokeStyle = C.veilOpen; g.lineWidth = 1.2 * dpr;
    g.setLineDash([2.5 * dpr, 2.5 * dpr]);
    g.beginPath(); g.moveTo(x - 4 * dpr, y); g.lineTo(x + 4 * dpr, y); g.stroke();
    g.setLineDash([]);
  }, 'veil given · free');
  row((x, y) => {
    g.fillStyle = C.player;
    g.beginPath(); g.moveTo(x, y - 4 * dpr); g.lineTo(x + 3 * dpr, y + 3 * dpr);
    g.lineTo(x - 3 * dpr, y + 3 * dpr); g.closePath(); g.fill();
  }, 'you');
  row((x, y) => ring(g, x, y, 3 * dpr, C.bad, 1.4 * dpr), 'lit but DARK');
  row((x, y) => ring(g, x, y, 3.5 * dpr, C.bad, 1.5 * dpr), 'ANOMALY');

  // ── WHAT IS ACTUALLY IN FORCE ─────────────────────────────────────────────
  //
  // Josh: *"include things like what's active."* Every number on this list is live and
  // several of them are on sliders, so a map read without them is a picture of a state
  // nobody can reproduce. They are also the four independent distance-darkening systems in
  // one column, which is the comparison the DARK tab exists to make possible — here it sits
  // beside the plan those metres are drawn on.
  // ── IS THE WORLD EVEN RUNNING? ────────────────────────────────────────────
  //
  // Josh: *"why is every gate labeled g0 on the map?"* Because every threshold was reading
  // as OPEN, because every veil alpha was zero, because the veil tick had never run — it
  // lives in an 'unpaused' system, and the world was paused. Three separate sessions of mine
  // measured gate counts against veils that had never opened or closed and drew the wrong
  // conclusion each time.
  //
  // A paused world silently voids most of this map: no veil easing, so no gates; no torch
  // flicker; no AI. That is not a footnote, so it goes at the top of the readout in red with
  // the REASON attached — `pausedReason()` already names it, and 'transition' is the one that
  // catches you, because a descent fade that never finished looks exactly like play.
  const why = pausedReason();
  const lines = [];
  if (why) lines.push(`WORLD PAUSED · ${why} — gates and flicker are stale`);
  lines.push(
    `fog    ${sightNear().toFixed(1)} → ${sightFar().toFixed(1)} m`,
    `crush  ${dark.crushStart.toFixed(1)} → ${dark.crushEnd.toFixed(1)} m  floor ${dark.crushFloor.toFixed(2)}`,
    `lamp   ${darkKnobs.lampDistance().toFixed(1)} m`,
    `veil   ${veils.length} · shut ${veils.filter((v) => v.alpha > 0.5).length}`
      // The MOST OPEN one, which is the one about to give — not the nearest, which is a
      // different question and would need the player position to answer.
      + ` · most open ${veils.length ? Math.round(Math.min(...veils.map((v) => v.alpha)) * 100) : 0}%`,
    `gates  light ≤${maxLightGates} · signal ≤${maxSignalGates}`,
  );
  for (let i = 0; i < lines.length; i++) {
    g.fillStyle = why && i === 0 ? C.bad : C.dim;
    g.fillText(lines[i], 8 * dpr, h - (lines.length - i) * 11 * dpr - 4 * dpr);
  }
}
