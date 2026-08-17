import * as THREE from 'three';
import { DEV } from './dev';
import { originOf } from '../scene/provenance';
import { pointInPoly } from '../level/room-shape';
import { deriveAnchors, CORNER_CLEAR, type PortalAnchor } from '../level/anchors';
import { getKnob } from './tuning';
import type { LevelSpec, RoomSpec } from '../level/types';

// ── THE OBSERVER — a second pair of eyes in the running game ──────────────────
//
// Josh, 2026-08-17: *"can you do a probe thats like an observer in the background
// so i can move and you can just query the geometry and ids you need? like tapping
// into the live games graph and screenshot ... we can combine that with putting
// you yourself in places and look around etc. but i can also steer and tell you
// look at this."*
//
// ── WHY THIS BEATS WHAT WE WERE DOING ────────────────────────────────────────
//
// Until now a geometry bug travelled as a screenshot plus a sentence. That is a
// rendering of the symptom, and the whole difficulty of this week has been that
// the symptom and the cause are in different systems: a half-arc opening is a
// straddled cut, a protruding hull is a corridor trimmed against the wrong plane,
// z-fighting is two owners on one surface. None of those are visible in a picture,
// and I spent three rounds on the corridor texture bug proposing causes and
// falsifying them one at a time because I could not ask the running game anything.
//
// So: read-only queries against the live level, answered in the terms the
// GENERATOR thinks in — room and corridor ids, links, anchors, and which code path
// placed the thing you are standing in front of.
//
// ── TWO MODES, BECAUSE JOSH OFFERED BOTH ─────────────────────────────────────
//
// STEERED — he walks somewhere broken and says look at this; `here()` and
//   `look()` answer immediately.
// RECORDED — `rec()` samples in the background while he plays and `dump()` hands
//   back the trail. This is the one that matters for a bug he walks PAST, and it
//   decouples his movement from my querying: he does not have to hold still while
//   I ask, and I do not have to be watching at the moment it happens.
//
// ── WHAT IT MAY NOT DO ───────────────────────────────────────────────────────
//
// READ ONLY. No input, no bus, no driving the loop. The sim-stepper taught this
// the hard way — it called installBus() at boot and seized the keyboard, and the
// symptom was "I can't move", which reads as a movement bug rather than as a debug
// tool. An observer that changes what it observes is worse than none, and one that
// steals input is worse than that.
//
// DEV-gated, so the whole module dead-code-eliminates from the shipped bundle.

interface Sample {
  t: number;
  at: { x: number; z: number };
  yaw: number;
  room: string | null;
  corridor: string | null;
  servedBy: 'route' | 'guess' | null;
  /** Distance to the nearest doorway of the room/corridor we are in. */
  nearestDoor: number | null;
}

// ── MARKS — Josh points, and I know exactly what he pointed at ────────────────
//
// Josh: *"where i have like some sort of pointer where i can mark things and you
// get the idea what i am marking."*
//
// This is the piece that replaces the workflow we have actually been using: a
// screenshot with a red X drawn on it, and a sentence trying to say which of the
// four things near the X is the one. Every round of the corridor investigation
// lost time to that — "the small piece z fighting" is unambiguous to whoever is
// looking at it and is three candidate objects to me.
//
// A mark is a RESOLVED DIAGNOSIS at the crosshair, not a coordinate: what was
// hit, which system emitted it, which room and corridor own that point, how the
// corridor got placed, and what the nearest doorway is. Press M.
//
// The key listener does not preventDefault and does not touch the input system —
// see the note at the top of the file about the sim-stepper seizing the keyboard.
// It is a passive read of a keypress the game does not use.
const MARK_KEY = 'm';
interface Mark { n: number; note: string; when: string; what: unknown }
const marks: Mark[] = [];

// ── INSPECT MODE — Josh points, and SEES what he is pointing at ───────────────
//
// Josh: *"how about you make a mode where viewmodel is off and i am in inspect
// mode in the same tab ... i can enable the kinda mode to point at things for
// you"*, and *"basically tools that allow me to tag and flag geometry and
// visuals."*
//
// Two things, and the second is the one that makes this work. The viewmodel goes
// off — which also fixes a real problem with the probe: the sword and lamp are
// the nearest geometry to the camera, so `look()` kept answering "your own hand"
// before it ever reached a wall.
//
// And a live readout under the crosshair, so HE sees the identity BEFORE marking
// it. That closes the loop without me in it: the failure mode of a marking tool
// is marking the wrong thing and not finding out until someone reads the log an
// hour later. If the overlay says `polytrim:poly-2` and he meant the wall behind
// it, he can see that and step sideways.
const RING = 600;                 // ~2 minutes at 5Hz
const ring: Sample[] = [];
let timer: number | null = null;
let getLevel: (() => LevelSpec | null) | null = null;
let getCamera: (() => THREE.Camera | null) | null = null;
let getRoot: (() => THREE.Object3D | null) | null = null;
/** Last raycast's health — see the note in look(). */
let lastProbe: { targets: number; threw: number; lastErr: string } = { targets: 0, threw: 0, lastErr: '' };
let hud: HTMLDivElement | null = null;
let hudTimer: number | null = null;

// ── THE VISIBLE RAY ──────────────────────────────────────────────────────────
//
// Josh: *"giving me a kinda ray thats visible so i see where i point."*
//
// A screen-centre reticle is not enough on its own, and the reason is depth: the
// dot sits on the near plane, so it tells you the DIRECTION you are pointing and
// nothing about WHERE the point lands. Pointing at a doorway's jamb and pointing
// through it at the far wall look identical.
//
// So the ray is drawn in the WORLD and stops at the hit: a thin line from the eye
// to the surface, with a small marker sitting ON the surface. Depth-tested off so
// it stays visible against dark stone, which is the whole dungeon.
//
// The objects live at the SCENE root and are excluded from the probe's own target
// collection — a ray that can see itself reports itself, which is the same class
// of mistake as the viewmodel answering "your own hand".
let rayLine: THREE.Line | null = null;
let rayDot: THREE.Mesh | null = null;
const RAY_TAG = '__obsRay';

/** Wire the observer to the running game. Called once from the DEV hook path. */
export function installObserver(src: {
  level: () => LevelSpec | null;
  camera: () => THREE.Camera | null;
  root: () => THREE.Object3D | null;
}): void {
  if (!DEV || typeof window === 'undefined') return;
  getLevel = src.level; getCamera = src.camera; getRoot = src.root;
  (window as unknown as { __obs: unknown }).__obs = api;
  // `?inspect=1` survives the reload, which matters: an HMR edit drops you back
  // in and re-enabling by hand every time is how a tool stops getting used.
  if (new URLSearchParams(window.location.search).get('inspect') === '1') {
    window.setTimeout(() => api.inspect(true), 1200);
  }
  // Deliberately NOT auto-started. A sampler running unasked is a tool that
  // changes the frame budget of every session that happens to be in DEV.
  console.info('[observer] window.__obs ready — inspect() here() look() doorways() anchors() rec() dump() mark()');
}

function spec(): LevelSpec | null { return getLevel ? getLevel() : null; }

function roomAt(s: LevelSpec, x: number, z: number): RoomSpec | null {
  for (const r of s.rooms) {
    if (r.logicalOnly) continue;
    if (r.poly && r.poly.length >= 3) { if (pointInPoly(r.poly as never, x, z)) return r; }
    else if (Math.abs(x - r.rect.x) <= r.rect.w / 2 && Math.abs(z - r.rect.z) <= r.rect.d / 2) return r;
  }
  return null;
}

function corridorAt(s: LevelSpec, x: number, z: number): RoomSpec | null {
  for (const c of s.corridors ?? []) {
    if (c.logicalOnly) continue;
    if (Math.abs(x - c.rect.x) <= c.rect.w / 2 && Math.abs(z - c.rect.z) <= c.rect.d / 2) return c;
  }
  return null;
}

/** Every doorway of a room: where a corridor rect's end lands inside its poly. */
function doorsOf(s: LevelSpec, r: RoomSpec): Array<{ x: number; z: number; corridor: string; servedBy: string }> {
  const out: Array<{ x: number; z: number; corridor: string; servedBy: string }> = [];
  if (!r.poly || r.poly.length < 3) return out;
  for (const c of s.corridors ?? []) {
    const rc = c.rect;
    const ends = rc.w > rc.d
      ? [{ x: rc.x - rc.w / 2, z: rc.z }, { x: rc.x + rc.w / 2, z: rc.z }]
      : [{ x: rc.x, z: rc.z - rc.d / 2 }, { x: rc.x, z: rc.z + rc.d / 2 }];
    for (const e of ends) {
      if (pointInPoly(r.poly as never, e.x, e.z)) {
        out.push({ x: +e.x.toFixed(2), z: +e.z.toFixed(2), corridor: c.id, servedBy: c.servedBy ?? '?' });
      }
    }
  }
  return out;
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
/** World forward. `cam.rotation.y` is local to the rig and is not the yaw anyone
 *  means when they say "which way am I facing". */
const dirOf = (cam: THREE.Camera) => cam.getWorldDirection(new THREE.Vector3());

/** Is this anchor's normal axis-aligned? The router refuses anything else, so it
 *  is the single most useful fact about an unused anchor. */
function isAxis(n: readonly [number, number]): boolean {
  return Math.abs(n[0]) < 1e-3 || Math.abs(n[1]) < 1e-3;
}

function describeAnchor(a: PortalAnchor, from?: { x: number; z: number }): Record<string, unknown> {
  return {
    edge: (a as unknown as { edge?: number }).edge,
    at: [+a.at[0].toFixed(2), +a.at[1].toFixed(2)],
    width: (a.width as readonly number[]).map((w) => +w.toFixed(2)),
    axis: isAxis(a.normal as readonly [number, number]) ? 'axis' : 'CHAMFER',
    ...(from ? { away: +dist(from.x, from.z, a.at[0], a.at[1]).toFixed(2) } : {}),
  };
}

/** Draw the pointer from the eye to the hit, or hide it when nothing is hit. */
function drawRay(hit?: { point?: { x: number; y: number; z: number } }): void {
  const cam = getCamera?.(); const root = getRoot?.();
  if (!cam || !root) return;
  if (!hit?.point) { hideRay(); return; }
  const to = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
  if (!rayLine) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const m = new THREE.LineBasicMaterial({
      color: 0xffd070, transparent: true, opacity: 0.85, depthTest: false, fog: false,
    });
    rayLine = new THREE.Line(g, m);
    rayLine.frustumCulled = false;
    rayLine.renderOrder = 9999;
    rayLine.userData[RAY_TAG] = true;
    root.add(rayLine);

    rayDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe6a0, depthTest: false, fog: false }),
    );
    rayDot.frustumCulled = false;
    rayDot.renderOrder = 9999;
    rayDot.userData[RAY_TAG] = true;
    root.add(rayDot);
  }
  // Start a little in FRONT of the eye, or the line vanishes into the near plane
  // and reads as no ray at all.
  const fwd = cam.getWorldDirection(new THREE.Vector3());
  const from = cam.getWorldPosition(new THREE.Vector3()).add(fwd.multiplyScalar(0.35));
  const pos = rayLine.geometry.attributes.position as THREE.BufferAttribute;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  rayLine.geometry.computeBoundingSphere();
  rayLine.visible = true;
  if (rayDot) { rayDot.position.copy(to); rayDot.visible = true; }
}

function hideRay(): void {
  if (rayLine) rayLine.visible = false;
  if (rayDot) rayDot.visible = false;
}

const api = {
  /** Where am I, in the generator's terms? */
  here(): unknown {
    const s = spec(); const cam = getCamera?.();
    if (!s || !cam) return 'no level';
    const p = cam.getWorldPosition(new THREE.Vector3());
    const room = roomAt(s, p.x, p.z);
    const cor = corridorAt(s, p.x, p.z);
    const doors = room ? doorsOf(s, room) : [];
    doors.sort((a, b) => dist(p.x, p.z, a.x, a.z) - dist(p.x, p.z, b.x, b.z));
    return {
      floor: s.id,
      at: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
      yaw: +Math.atan2(-dirOf(cam).x, -dirOf(cam).z).toFixed(3),
      room: room?.id ?? null,
      corridor: cor ? { id: cor.id, link: cor.linkId, type: cor.corridorType, servedBy: cor.servedBy ?? '?' } : null,
      // THE FIRST THING WORTH KNOWING in front of a broken doorway.
      nearestDoors: doors.slice(0, 3).map((d) => ({
        ...d, away: +dist(p.x, p.z, d.x, d.z).toFixed(2),
      })),
    };
  },

  /** What am I looking at? Raycast forward and name it by provenance. */
  look(maxDist = 12): unknown {
    const cam = getCamera?.(); const root = getRoot?.();
    if (!cam || !root) return 'no scene';
    // ── WORLD SPACE, NOT LOCAL ─────────────────────────────────────────────
    // `cam.quaternion` and `cam.position` are LOCAL to the camera's parent. The
    // camera hangs off the player rig, so the first version pointed the ray in
    // whatever direction the camera faces WITHIN the rig and fired it from the
    // rig's origin — which is why it reported nothing within 25m while standing
    // five metres from a wall, and why every earlier hit was the viewmodel (near
    // enough to be struck from any direction). getWorldDirection/getWorldPosition
    // are correct under any parenting, which is the whole reason they exist.
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const eye = cam.getWorldPosition(new THREE.Vector3());
    // ── NEAR 0.6m, AND IT IS NOT ARBITRARY ─────────────────────────────────
    // The player capsule holds you roughly 0.3m off any wall, so no world surface
    // can ever be nearer than that. Anything inside 0.6m is carried: the lamp, the
    // sword, the flame sprites, the lamp's own glow. Hiding the viewmodel removed
    // the named ones and left an UNNAMED hit at 0.17m — chasing each of those by
    // identity is a losing game when distance separates them cleanly.
    const ray = new THREE.Raycaster(eye, dir, 0.6, maxDist);
    // ── RAYCAST A COLLECTED LIST, NOT THE SCENE GRAPH ──────────────────────
    //
    // `intersectObject(scene, true)` threw "Cannot read properties of null
    // (reading 'matrixWorld')" — the graph holds nodes Three's recursive raycast
    // cannot walk (sprite batches, instanced pools, objects mid-teardown). One
    // such node kills the whole probe, and a debug tool that dies on the scene it
    // is inspecting is worthless precisely when it is needed.
    //
    // So: collect plain visible meshes with geometry, intersect them
    // NON-recursively, and let one bad node cost only itself.
    //
    // AND SKIP THE VIEWMODEL. It is parented to the camera, so it is always the
    // nearest thing to it — the first probe reported `cylinder·bind` at 0.05m,
    // which is the lamp in Josh's own hand. A tool for asking "what is that wall"
    // that always answers "your sword" is not a tool.
    const underCamera = (o: THREE.Object3D): boolean => {
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n === cam) return true;
      return false;
    };
    // EFFECTIVE visibility, not the mesh's own flag. `showvm` hides the viewmodel
    // by setting `visible = false` on its ROOT (debug/tuning-view.ts), and a
    // child's own `visible` stays true — so inspect mode turned the sword off on
    // screen and the probe went on reporting it, which is worse than not hiding
    // it at all. Three's traverse walks into hidden subtrees; the renderer does
    // not, and the probe should agree with the renderer.
    const shown = (o: THREE.Object3D): boolean => {
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    // World matrices must be current before a raycast. The static batcher and the
    // render-bundle freeze both set `matrixAutoUpdate = false` on what they own,
    // so a probe that runs outside the render loop can be reading matrices the
    // renderer last wrote several frames ago — or never wrote at all.
    root.updateMatrixWorld(true);
    const targets: THREE.Object3D[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.userData?.[RAY_TAG]) return;      // never raycast our own pointer
      if (m.isMesh && m.geometry && shown(m) && !underCamera(m)) targets.push(m);
    });
    const hits: THREE.Intersection[] = [];
    // COUNT the failures rather than only surviving them. The first version
    // swallowed every exception silently, and when the probe then reported
    // "nothing within 500m" there was no way to tell an empty scene from a
    // raycast that threw on all 67 targets. A catch that hides its own rate is
    // how a tool lies about the thing it was built to measure.
    let threw = 0; let lastErr = '';
    for (const t of targets) {
      try { hits.push(...ray.intersectObject(t, false)); }
      catch (e) { threw++; lastErr = (e as Error)?.message ?? String(e); }
    }
    lastProbe = { targets: targets.length, threw, lastErr };
    hits.sort((a, b) => a.distance - b.distance);
    const s = spec();
    return {
      from: { x: +eye.x.toFixed(2), y: +eye.y.toFixed(2), z: +eye.z.toFixed(2) },
      probe: lastProbe,
      hits: hits.slice(0, 6).map((h) => {
        const o = h.object;
        // `o.parent` can be null for a direct scene child, and originOf walks
        // matrixWorld — guarded rather than cast, because the cast is what threw.
        const org = originOf(o) ?? (o.parent ? originOf(o.parent) : null);
        const pt = h.point;
        return {
          at: +h.distance.toFixed(2),
          point: { x: +pt.x.toFixed(2), y: +pt.y.toFixed(2), z: +pt.z.toFixed(2) },
          name: o.name || (o.parent?.name ?? '?'),
          origin: org ? `${org.system}${org.rect ? `:${org.rect}` : ''}` : null,
          // Which room/corridor OWNS the surface I am looking at — the thing that
          // says "this hull belongs to the corridor, not the room".
          inRoom: s ? roomAt(s, pt.x, pt.z)?.id ?? null : null,
          inCorridor: s ? corridorAt(s, pt.x, pt.z)?.id ?? null : null,
        };
      }),
    };
  },

  /** Every doorway near me, with its diagnosis. */
  doorways(radius = 14): unknown {
    const s = spec(); const cam = getCamera?.();
    if (!s || !cam) return 'no level';
    const p = cam.getWorldPosition(new THREE.Vector3());
    const out: unknown[] = [];
    for (const r of s.rooms) {
      if (!r.poly || r.poly.length < 3) continue;
      for (const d of doorsOf(s, r)) {
        const away = dist(p.x, p.z, d.x, d.z);
        if (away > radius) continue;
        out.push({ room: r.id, ...d, away: +away.toFixed(2) });
      }
    }
    return (out as Array<{ away: number }>).sort((a, b) => a.away - b.away);
  },

  /**
   * What the room I am in offered, and what got used.
   *
   * The point of this one: Josh's report is *"some of the doors simply end up in
   * suboptimal places cutting into non straight faces even tho theres straight
   * sections."* This lists the straight sections that were available.
   */
  anchors(): unknown {
    const s = spec(); const cam = getCamera?.();
    if (!s || !cam) return 'no level';
    const p = cam.getWorldPosition(new THREE.Vector3());
    const room = roomAt(s, p.x, p.z);
    if (!room?.poly) return 'not in a polygon room';
    const all = deriveAnchors(room.id, room.poly as never, room.height);
    const doors = doorsOf(s, room);
    // An anchor counts as USED if a doorway sits within a clearance of it.
    const used = new Set<number>();
    all.forEach((a, i) => {
      for (const d of doors) if (dist(a.at[0], a.at[1], d.x, d.z) < CORNER_CLEAR + 1.2) used.add(i);
    });
    return {
      room: room.id,
      doorways: doors.length,
      anchors: all.length,
      axisAligned: all.filter((a) => isAxis(a.normal as readonly [number, number])).length,
      used: [...used].map((i) => describeAnchor(all[i], p)),
      UNUSED_AND_STRAIGHT: all
        .map((a, i) => ({ a, i }))
        .filter(({ a, i }) => !used.has(i) && isAxis(a.normal as readonly [number, number]))
        .map(({ a }) => describeAnchor(a, p))
        .sort((x, y) => (x.away as number) - (y.away as number)),
    };
  },

  /** Start sampling in the background. Read-only; costs one interval, no frame work. */
  rec(hz = 5): string {
    if (timer !== null) return 'already recording';
    ring.length = 0;
    timer = window.setInterval(() => {
      const s = spec(); const cam = getCamera?.();
      if (!s || !cam) return;
      const p = cam.getWorldPosition(new THREE.Vector3());
      const room = roomAt(s, p.x, p.z);
      const cor = corridorAt(s, p.x, p.z);
      const doors = room ? doorsOf(s, room) : [];
      let near: number | null = null;
      for (const d of doors) {
        const dd = dist(p.x, p.z, d.x, d.z);
        if (near === null || dd < near) near = dd;
      }
      ring.push({
        t: Math.round(performance.now()),
        at: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
        yaw: +Math.atan2(-dirOf(cam).x, -dirOf(cam).z).toFixed(2),
        room: room?.id ?? null,
        corridor: cor?.id ?? null,
        servedBy: (cor?.servedBy ?? null) as Sample['servedBy'],
        nearestDoor: near === null ? null : +near.toFixed(2),
      });
      if (ring.length > RING) ring.shift();
    }, Math.max(50, 1000 / hz));
    return `recording at ${hz}Hz (ring ${RING})`;
  },

  stop(): string {
    if (timer === null) return 'not recording';
    window.clearInterval(timer); timer = null;
    return `stopped, ${ring.length} samples`;
  },

  /** The trail. Consecutive identical places are collapsed, so a dump is a list
   *  of PLACES VISITED rather than a wall of near-duplicate rows. */
  dump(): unknown {
    const out: Array<Sample & { held?: number }> = [];
    for (const s of ring) {
      const last = out[out.length - 1];
      if (last && last.room === s.room && last.corridor === s.corridor) {
        last.held = (last.held ?? 1) + 1;
        continue;
      }
      out.push({ ...s });
    }
    return { samples: ring.length, places: out.length, trail: out };
  },

  /** Everything at once — the one call to make when Josh says "look at this". */
  scan(): unknown {
    return { here: api.here(), look: api.look(), anchors: api.anchors() };
  },

  /**
   * INSPECT MODE. Viewmodel off, live readout of whatever the crosshair is on.
   *
   * The viewmodel is turned off through the EXISTING `showvm` knob rather than by
   * hiding meshes directly — one owner for "is the viewmodel visible", so leaving
   * inspect mode cannot fight the TUNE panel over it.
   */
  inspect(on = true): string {
    const vm = getKnob('showvm');
    if (vm) vm.set(on ? 0 : 1);
    if (!on) {
      if (hud) { hud.remove(); hud = null; }
      if (hudTimer !== null) { window.clearInterval(hudTimer); hudTimer = null; }
      hideRay();
      return 'inspect off';
    }
    if (!hud) {
      hud = document.createElement('div');
      Object.assign(hud.style, {
        position: 'fixed', left: '50%', top: '54%', transform: 'translateX(-50%)',
        zIndex: '99999', pointerEvents: 'none', maxWidth: '78vw',
        padding: '6px 9px', borderRadius: '5px',
        background: 'rgba(8,10,16,0.78)', border: '1px solid rgba(150,180,255,0.35)',
        color: 'rgba(215,232,255,0.95)', textAlign: 'center',
        font: '600 10px ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: '0.03em', lineHeight: '1.45', whiteSpace: 'pre-line',
      } as Partial<CSSStyleDeclaration>);
      document.body.append(hud);
      // A reticle, so it is obvious WHERE the readout is reading from.
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        position: 'fixed', left: '50%', top: '50%', width: '5px', height: '5px',
        transform: 'translate(-50%,-50%)', zIndex: '99999', pointerEvents: 'none',
        borderRadius: '50%', background: 'rgba(255,220,150,0.9)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
      } as Partial<CSSStyleDeclaration>);
      hud.append(dot);
    }
    if (hudTimer === null) {
      // 4Hz. Enough to feel live while pointing, far too slow to matter to the
      // frame budget — and it raycasts a collected list, not the graph.
      hudTimer = window.setInterval(() => {
        if (!hud) return;
        const l = api.look(30) as { hits?: Array<Record<string, unknown>> };
        const h = l.hits?.[0];
        drawRay(h as { point?: { x: number; y: number; z: number } } | undefined);
        const at = api.here() as Record<string, unknown>;
        const cor = at.corridor as { id: string; servedBy: string } | null;
        // THE HIT's corridor provenance, not just the one you are standing in.
        // Josh's first real use pointed at a surface 6.78m away belonging to
        // cor-1 while he stood in poly-0, and the readout showed servedBy for the
        // corridor he was IN (none) rather than for the thing he was LOOKING AT —
        // which is the whole question when a hull is poking into a room.
        const hitCor = h?.inCorridor
          ? (spec()?.corridors ?? []).find((c) => c.id === h.inCorridor)
          : undefined;
        const hitTag = h?.inCorridor
          ? ` / ${h.inCorridor}${hitCor?.servedBy ? ` (${hitCor.servedBy})` : ''}`
          : '';
        hud.textContent = h
          ? `${h.name || '(unnamed)'}  ${h.origin ? `[${h.origin}]` : ''}\n`
            + `${h.at}m · in ${h.inRoom ?? '—'}${hitTag}\n`
            + `you: ${at.room ?? '—'}${cor ? ` / ${cor.id} (${cor.servedBy})` : ''}   —   M to mark`
          : `nothing within 30m\nyou: ${at.room ?? '—'}${cor ? ` / ${cor.id}` : ''}   —   M to mark`;
      }, 250);
    }
    return 'inspect on — viewmodel off, M marks what the reticle is on';
  },

  /**
   * Mark whatever is at the crosshair right now.
   *
   * Also bound to M, which is the point — Josh should not have to type into a
   * console to say "this one". The note is optional and only useful when he adds
   * it from the console; the mark is already self-describing without one.
   */
  mark(note = ''): unknown {
    const m: Mark = {
      n: marks.length + 1,
      note,
      when: new Date(Date.now()).toISOString().slice(11, 19),
      what: { here: api.here(), look: api.look() },
    };
    marks.push(m);
    // Logged as well as stored: Josh sees it register, which is the difference
    // between a tool he trusts and one he presses twice.
    console.info(`[observer] mark #${m.n}${note ? ` — ${note}` : ''}`, m.what);
    return `mark #${m.n} taken`;
  },

  /** Everything marked so far, with the room's anchor picture attached to each. */
  marks(): unknown { return { count: marks.length, marks }; },
  clearMarks(): string { const n = marks.length; marks.length = 0; return `cleared ${n}`; },
};

if (DEV && typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key?.toLowerCase() !== MARK_KEY) return;
    // Never while typing into something, and never stealing the event.
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!getCamera?.()) return;
    api.mark('(M)');
  }, { passive: true });
}
