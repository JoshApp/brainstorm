// The asset viewer — a DEV-only in-browser screen (`?viewer=1`) for browsing
// and inspecting every authorable subject (mob / weapon / item) live in the
// real engine, NOT a separate render path. It is pure composition over machinery
// that already exists:
//
//   - WHAT to show           → listAuthorables() (src/debug/authorables.ts)
//   - HOW to pose/light it    → the auto-generated preview scenarios + inspect
//                               mode, reached by navigating to ?scenario=<name>
//   - playback / phase scrub  → setWorldFrozen + weapon.setDebugPhase
//
// So this file is just UI + a camera orbit. Two surfaces:
//   mountViewerLauncher()  — the picker (shown when ?viewer=1 has no scenario)
//   mountViewerControls()  — the control bar + orbit (shown once a subject loads)
//
// DEV-only: main.ts gates both calls behind import.meta.env.DEV && ?viewer=1,
// and the whole module tree-shakes out of the production bundle with the rest
// of the debug graph.

import * as THREE from 'three';
import { listAuthorables, type Authorable, type AuthorableKind } from './authorables';
import { setWorldFrozen, isWorldFrozen } from './freeze';
import { SCENARIOS } from './scenarios';
import type { WeaponViewmodel, SwingPhase } from '../player/viewmodel';

const KIND_ORDER: AuthorableKind[] = ['mob', 'weapon', 'item'];
const KIND_LABEL: Record<AuthorableKind, string> = {
  mob: 'Mobs & Bosses',
  weapon: 'Weapons (held)',
  item: 'Items (drop model)',
};

/** Build the URL that drops the engine into the chosen subject's preview,
 *  keeping ?viewer=1 so the control bar re-mounts after the reload. Mobs +
 *  items want studio lighting + subject isolation; weapons keep the
 *  camera-anchored first-person framing (inspect would fight it). */
function subjectUrl(a: Authorable): string {
  const p = new URLSearchParams();
  p.set('viewer', '1');
  p.set('scenario', a.scenario);
  if (a.kind !== 'weapon') {
    p.set('inspect', 'true');
    p.set('inspectSubjectOnly', 'true');
  }
  return `${location.pathname}?${p.toString()}`;
}

// ── Launcher ─────────────────────────────────────────────────────────
// Full-screen grouped, searchable picker. Tapping a row navigates to that
// subject (a reload — robust, reuses the entire scenario/inspect path).

export function mountViewerLauncher(): void {
  const root = document.createElement('div');
  root.id = 'viewer-launcher';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '9000',
    background: '#0b0c0e', color: '#cdd2d8',
    font: '13px ui-monospace, monospace', overflowY: 'auto',
    padding: 'env(safe-area-inset-top,8px) 0 24px',
  } as CSSStyleDeclaration);

  const all = listAuthorables();

  const head = document.createElement('div');
  Object.assign(head.style, {
    position: 'sticky', top: '0', background: '#0b0c0eee', backdropFilter: 'blur(4px)',
    padding: '12px 14px 10px', borderBottom: '1px solid #23262b', zIndex: '1',
  } as CSSStyleDeclaration);
  head.innerHTML = `<div style="font-size:11px;letter-spacing:0.25em;color:#6b7280;text-transform:uppercase">Delve · Asset Viewer</div>`;

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = `filter ${all.length} subjects…`;
  Object.assign(search.style, {
    width: '100%', marginTop: '8px', padding: '9px 11px', borderRadius: '8px',
    border: '1px solid #2b2f36', background: '#16181c', color: '#e6e9ee',
    font: '14px ui-monospace, monospace', outline: 'none', boxSizing: 'border-box',
  } as CSSStyleDeclaration);
  head.appendChild(search);
  root.appendChild(head);

  const listWrap = document.createElement('div');
  root.appendChild(listWrap);

  function render(filter: string): void {
    const q = filter.trim().toLowerCase();
    listWrap.replaceChildren();
    for (const kind of KIND_ORDER) {
      const rows = all.filter((a) => a.kind === kind && matches(a, q));
      if (!rows.length) continue;

      const section = document.createElement('div');
      const title = document.createElement('div');
      Object.assign(title.style, {
        padding: '14px 14px 6px', fontSize: '11px', letterSpacing: '0.18em',
        color: '#7c8492', textTransform: 'uppercase',
      } as CSSStyleDeclaration);
      title.textContent = `${KIND_LABEL[kind]} · ${rows.length}`;
      section.appendChild(title);

      for (const a of rows) section.appendChild(rowEl(a));
      listWrap.appendChild(section);
    }
    if (!listWrap.childElementCount) {
      const none = document.createElement('div');
      Object.assign(none.style, { padding: '24px 14px', color: '#6b7280' } as CSSStyleDeclaration);
      none.textContent = 'no subjects match.';
      listWrap.appendChild(none);
    }
  }

  search.addEventListener('input', () => render(search.value));
  render('');
  document.body.appendChild(root);
  // Autofocus on desktop; harmless on mobile (no keyboard popped until tap).
  if (matchMedia('(pointer:fine)').matches) search.focus();
}

function matches(a: Authorable, q: string): boolean {
  if (!q) return true;
  return (
    a.id.includes(q) ||
    a.label.toLowerCase().includes(q) ||
    a.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function rowEl(a: Authorable): HTMLElement {
  const row = document.createElement('a');
  row.href = subjectUrl(a);
  Object.assign(row.style, {
    display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none',
    color: '#cdd2d8', padding: '10px 14px', borderBottom: '1px solid #16181c',
  } as CSSStyleDeclaration);
  const name = document.createElement('div');
  name.style.flex = '1';
  name.innerHTML = `<div style="font-size:14px;color:#e6e9ee">${esc(a.label)}</div>` +
    `<div style="font-size:11px;color:#5f6772">${esc(a.id)}</div>`;
  const tags = document.createElement('div');
  Object.assign(tags.style, { fontSize: '10px', color: '#7c8492', textAlign: 'right', maxWidth: '45%' } as CSSStyleDeclaration);
  tags.textContent = a.tags.join(' · ');
  row.append(name, tags);
  row.addEventListener('pointerdown', () => { row.style.background = '#16181c'; });
  return row;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// ── Control bar + orbit ──────────────────────────────────────────────
// Mounted once a subject scenario is loaded. A slim bar (back / play-pause /
// weapon phase scrub) plus a drag-to-orbit camera that takes over while the
// world is frozen — which it is by default in a preview. Pressing PLAY unfreezes
// so animations run; the camera then holds at the orbited pose (the FP look
// system reads zero input).

export interface ViewerControlsOpts {
  camera: THREE.PerspectiveCamera;
  weapon: WeaponViewmodel;
  /** The ?scenario= currently loaded, so we can read its framing + kind. */
  scenarioName: string;
}

const PHASES: SwingPhase[] = ['windup', 'strike', 'recover'];
// Big enough timers that getPhaseProgress clamps to the settled end-of-phase
// pose (matches the snap ?phase= convention).
const PHASE_TIMER: Record<SwingPhase, number> = { windup: 0.1, strike: 0.2, recover: 0.02 } as Record<SwingPhase, number>;

export function mountViewerControls(o: ViewerControlsOpts): void {
  const isWeapon = o.scenarioName.startsWith('viewmodel-');
  const pivot = pivotFor(o.scenarioName);

  // Orbit state, seeded from the scenario's authored camera so PLAY→PAUSE
  // doesn't jump. Updated live by drag; applied each frame while frozen.
  const orbit = sphericalFromCamera(o.camera, pivot);
  let dragging = false;
  let lastX = 0, lastY = 0;

  const bar = document.createElement('div');
  bar.id = 'viewer-bar';
  Object.assign(bar.style, {
    position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9000',
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
    padding: '8px 10px calc(env(safe-area-inset-bottom,8px) + 8px)',
    background: '#0b0c0ecc', backdropFilter: 'blur(6px)', borderTop: '1px solid #23262b',
    font: '12px ui-monospace, monospace', color: '#cdd2d8',
  } as CSSStyleDeclaration);

  const back = btn('‹ Browse', () => { location.search = '?viewer=1'; });
  bar.appendChild(back);

  const label = document.createElement('div');
  label.textContent = o.scenarioName.replace(/^(mob|item|viewmodel)-/, '');
  Object.assign(label.style, { flex: '1', color: '#e6e9ee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as CSSStyleDeclaration);
  bar.appendChild(label);

  // Play/Pause toggles the global freeze. Frozen = orbit owns the camera.
  const playBtn = btn('▶ Play', () => {
    const nowFrozen = !isWorldFrozen();
    setWorldFrozen(nowFrozen);
    playBtn.textContent = nowFrozen ? '▶ Play' : '⏸ Pause';
    // Re-seed orbit from the live camera when re-freezing so we resume cleanly.
    if (nowFrozen) Object.assign(orbit, sphericalFromCamera(o.camera, pivot));
  });
  bar.appendChild(playBtn);

  if (isWeapon) {
    // Phase scrubber — pose the held swing without playing it.
    bar.appendChild(btn('idle', () => { o.weapon.group.visible = true; o.weapon.setDebugPhase('windup', 0); }));
    for (const ph of PHASES) {
      bar.appendChild(btn(ph, () => { o.weapon.group.visible = true; o.weapon.setDebugPhase(ph, PHASE_TIMER[ph]); }));
    }
  } else {
    // Zoom buttons for mob/item inspection (orbit handles rotation).
    bar.appendChild(btn('–', () => { orbit.radius = Math.min(orbit.radius * 1.25, 30); }));
    bar.appendChild(btn('+', () => { orbit.radius = Math.max(orbit.radius * 0.8, 0.3); }));
  }

  document.body.appendChild(bar);

  // Orbit drag — only meaningful for mob/item (the weapon viewmodel is anchored
  // to the camera, so orbiting it is a no-op). Listen on the canvas so the bar's
  // own buttons aren't hijacked.
  if (!isWeapon) {
    const canvas = document.getElementById('scene')!;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      orbit.az -= (e.clientX - lastX) * 0.01;
      orbit.el = clamp(orbit.el + (e.clientY - lastY) * 0.01, -1.4, 1.4);
      lastX = e.clientX; lastY = e.clientY;
    });

    // Apply orbit every frame while the world is frozen (the FP look system is
    // gated off then, so we own the camera). Self-contained rAF — no hot-loop edit.
    const applyOrbit = () => {
      if (isWorldFrozen()) {
        o.camera.position.set(
          pivot.x + orbit.radius * Math.sin(orbit.az) * Math.cos(orbit.el),
          pivot.y + orbit.radius * Math.sin(orbit.el),
          pivot.z + orbit.radius * Math.cos(orbit.az) * Math.cos(orbit.el),
        );
        o.camera.lookAt(pivot);
      }
      requestAnimationFrame(applyOrbit);
    };
    requestAnimationFrame(applyOrbit);
  }
}

interface Spherical { az: number; el: number; radius: number; }

function pivotFor(scenarioName: string): THREE.Vector3 {
  const sc = SCENARIOS[scenarioName];
  const la = sc?.playerPos?.lookAt;
  if (la) return new THREE.Vector3(la.x, la.y ?? 0, la.z);
  // Items float at (0, 1.4, 0); weapons don't orbit (pivot unused there).
  return new THREE.Vector3(0, 1.4, 0);
}

function sphericalFromCamera(camera: THREE.Camera, pivot: THREE.Vector3): Spherical {
  const d = new THREE.Vector3().subVectors(camera.position, pivot);
  const radius = Math.max(d.length(), 0.3);
  return {
    radius,
    el: Math.asin(clamp(d.y / radius, -1, 1)),
    az: Math.atan2(d.x, d.z),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function btn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  Object.assign(b.style, {
    padding: '8px 12px', borderRadius: '7px', border: '1px solid #2b2f36',
    background: '#16181c', color: '#cdd2d8', font: '12px ui-monospace, monospace',
    cursor: 'pointer', minWidth: '36px',
  } as CSSStyleDeclaration);
  b.addEventListener('click', onClick);
  return b;
}
