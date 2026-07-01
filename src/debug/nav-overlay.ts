// DEV nav-grid debug overlay.
//
// Draws the level's NavGrid (the A* grid mobs + the harness bot route on) directly
// on the floor so you can SEE why an agent clips a doorframe or wedges a pillar:
//   - cell tiers: BLOCKED (dark red) / FULL (green) / TIGHT (yellow) / GATE (cyan).
//     Blocked cells ARE drawn — that's how you spot a doorframe the grid renders too
//     thin, or a gap too narrow for the 0.5m pitch to see.
//   - NavGates: a cyan post at each framed-opening centre + its band width.
//   - live PATHS: the harness bot's route (white) and each enemy's cached route
//     (orange), waypoint-to-waypoint.
//
// Toggle: window.__navDebug() / ?navdebug=1 / press N (DEV only). Strips from prod.

import * as THREE from 'three';
import type { NavGrid } from '../level/nav-grid';
import type { NavGate } from '../level/types';
import { getLatestBotPath } from '../harness/pathfind';

interface Vec2 { x: number; z: number }
interface LevelLike {
  nav: NavGrid;
  spec: { navGates?: NavGate[] };
  enemies: ReadonlyArray<{ alive: boolean; debugPath?: readonly Vec2[] }>;
}

// tier index → colour. 0 BLOCKED, 1 FULL, 2 TIGHT, 3 GATE.
const TIER_COLOR = [0x662222, 0x1f9d3a, 0xcaa81e, 0x1fcaca];
const CELL_Y = 0.05;          // hover just above the floor
const CELL_FILL = 0.42;       // quad size < cell pitch so the grid lines show

let scene: THREE.Scene | null = null;
let getLevel: (() => LevelLike | null) | null = null;
let enabled = false;

let gridGroup: THREE.Group | null = null;
let pathGroup: THREE.Group | null = null;
let builtFor: NavGrid | null = null;

export function initNavOverlay(s: THREE.Scene, getLevelFn: () => LevelLike | null): void {
  scene = s;
  getLevel = getLevelFn;
}

/** Toggle (or set) the overlay. Returns the new state. */
export function setNavOverlay(on?: boolean): boolean {
  enabled = on ?? !enabled;
  if (!enabled) teardown();
  return enabled;
}

export function isNavOverlayOn(): boolean { return enabled; }

function teardown(): void {
  if (gridGroup) { scene?.remove(gridGroup); disposeGroup(gridGroup); gridGroup = null; }
  if (pathGroup) { scene?.remove(pathGroup); disposeGroup(pathGroup); pathGroup = null; }
  builtFor = null;
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh & THREE.Line;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as THREE.Mesh).material;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
  });
}

/** Build the static cell + gate visuals for a level's grid. */
function buildGrid(nav: NavGrid, gates: NavGate[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'nav-overlay-grid';
  const { cols, rows } = nav;
  const geo = new THREE.PlaneGeometry(CELL_FILL, CELL_FILL);
  geo.rotateX(-Math.PI / 2);   // lie flat on the floor
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
  const cells = new THREE.InstancedMesh(geo, mat, cols * rows);
  cells.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tier = nav.tierAt(c, r);
      const w = nav.cellToWorld(c, r);
      dummy.position.set(w.x, CELL_Y, w.z);
      dummy.updateMatrix();
      cells.setMatrixAt(n, dummy.matrix);
      cells.setColorAt(n, col.setHex(TIER_COLOR[tier] ?? 0x662222));
      n++;
    }
  }
  cells.instanceMatrix.needsUpdate = true;
  if (cells.instanceColor) cells.instanceColor.needsUpdate = true;
  group.add(cells);

  // Gate posts + band lines (the archway funnel centres).
  for (const g of gates) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6),
      new THREE.MeshBasicMaterial({ color: 0x1fcaca, toneMapped: false }),
    );
    post.position.set(g.x, 1.1, g.z);
    post.frustumCulled = false;
    group.add(post);
    // Band: a line across the gate's passable width.
    const bx = Math.cos(g.rotY), bz = -Math.sin(g.rotY);
    const bandGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(g.x - bx * g.halfBand, 0.1, g.z - bz * g.halfBand),
      new THREE.Vector3(g.x + bx * g.halfBand, 0.1, g.z + bz * g.halfBand),
    ]);
    group.add(new THREE.Line(bandGeo, new THREE.LineBasicMaterial({ color: 0x66ffff, toneMapped: false })));
  }
  return group;
}

function makePathLine(path: readonly Vec2[], color: number, y: number): THREE.Line {
  const pts = path.map((p) => new THREE.Vector3(p.x, y, p.z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, toneMapped: false }));
  line.frustumCulled = false;
  return line;
}

/** Per-frame: (re)build grid on level change, refresh path lines. Cheap when off. */
export function tickNavOverlay(): void {
  if (!enabled) return;
  const level = getLevel?.();
  if (!level || !level.nav) { teardown(); return; }

  // Grid: rebuild when the level's grid instance changes (descent).
  if (builtFor !== level.nav) {
    if (gridGroup) { scene?.remove(gridGroup); disposeGroup(gridGroup); }
    gridGroup = buildGrid(level.nav, level.spec.navGates ?? []);
    scene?.add(gridGroup);
    builtFor = level.nav;
  }

  // Paths: rebuilt each tick (a handful of short polylines — cheap).
  if (pathGroup) { scene?.remove(pathGroup); disposeGroup(pathGroup); }
  pathGroup = new THREE.Group();
  pathGroup.name = 'nav-overlay-paths';
  const botPath = getLatestBotPath();
  if (botPath.length > 1) pathGroup.add(makePathLine(botPath, 0xffffff, 0.18));
  for (const e of level.enemies) {
    if (e.alive && e.debugPath && e.debugPath.length > 1) {
      pathGroup.add(makePathLine(e.debugPath, 0xff8822, 0.15));
    }
  }
  scene?.add(pathGroup);
}
