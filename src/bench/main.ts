// Bench entry — the standalone asset editor. Loaded by bench.html, which is
// NOT part of the production build input, so this whole tree only exists on the
// dev server (and never ships to the live site). No game imports: just Three +
// the content builders + the studio.
//
//   /brainstorm/bench.html                     → picker (browse all subjects)
//   /brainstorm/bench.html?subject=mob-ghoul   → hero shot of the ghoul model
//   ?subject=...&grid=12                        → 12-angle turntable contact sheet
//   ?subject=mob-ghoul&anim=8                   → telegraph windup→strike→recover
//   ?subject=fx-shatter-burst&anim=8            → an effect's lifetime
//   ?subject=...&az=35&el=18                    → explicit azimuth/elevation
//
// The headless CLI (scripts/bench.ts) drives the same page via window.__bench.

import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { mountStudio } from './studio';
import { resolveSubject, listSubjects } from './subjects';
import { computeReadout, type Readout } from './readout';
import { makeMobAnimator, makeWeaponAnimator, type SubjectAnimator } from './animate';
import { effectDemo } from './effects';

const FP_FOV = 70;   // matches CONFIG.FOV — the player's eye for held-weapon swings

const canvas = document.getElementById('bench') as HTMLCanvasElement;

interface BenchApi {
  ready: boolean;
  view(az: number, el: number): void;
  turntable(n: number, el: number): void;
  /** Render the subject's animation arc (mob telegraph / effect lifetime). */
  anim(n: number, el: number): void;
  readout(): Readout | null;
  subjects(): string[];
}
declare global {
  interface Window { __bench: BenchApi; }
}

const params = new URLSearchParams(location.search);
const subjectId = params.get('subject');
const NOOP: BenchApi = {
  ready: true, view() {}, turntable() {}, anim() {},
  readout: () => null, subjects: () => listSubjects().map((s) => s.id),
};

function titleChip(text: string): void {
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;left:10px;top:8px;color:#9aa1ab;font:12px monospace;letter-spacing:.05em">${text}</div>`);
}

function onResize(draw: () => void): void {
  window.addEventListener('resize', () => { mounted!.resize(window.innerWidth, window.innerHeight); draw(); });
  mounted!.resize(window.innerWidth, window.innerHeight);
  draw();
}

let mounted: ReturnType<typeof mountStudio> | null = null;

if (!subjectId) {
  renderPicker();
  window.__bench = NOOP;
} else if (subjectId.startsWith('fx-')) {
  // ── Effect demo ──────────────────────────────────────────────────
  const demo = effectDemo(subjectId);
  mounted = mountStudio(canvas);
  if (!demo) {
    unknown(subjectId);
    window.__bench = NOOP;
  } else {
    mounted.frame(demo.radius);
    const animator = demo.start(mounted.root());
    const az = Number(params.get('az') ?? 35);
    const el = Number(params.get('el') ?? demo.el);
    const n = Math.max(1, Number(params.get('anim') ?? params.get('grid') ?? animator.frames));
    onResize(() => mounted!.renderPoseGrid(n, az, el, animator.poseAt));
    titleChip(`${animator.label} · effect · ${subjectId}`);
    window.__bench = {
      ...NOOP,
      anim: (m, e) => mounted!.renderPoseGrid(m, az, e, animator.poseAt),
    };
  }
} else {
  // ── Model / mob ──────────────────────────────────────────────────
  const subject = resolveSubject(subjectId);
  mounted = mountStudio(canvas);
  if (!subject) {
    unknown(subjectId);
    window.__bench = NOOP;
  } else {
    const built = buildModel(subject.spec);
    const az = Number(params.get('az') ?? 35);
    const el = Number(params.get('el') ?? 18);
    const gridN = Number(params.get('grid') ?? 0);
    const animN = Number(params.get('anim') ?? 0);

    const mobAnim = subject.enemy ? makeMobAnimator(built, subject.enemy) : null;
    const weaponAnim = subject.kind === 'weapon' && subject.item
      ? makeWeaponAnimator(built.group, subject.item) : null;

    let draw: () => void;
    if (animN > 0 && weaponAnim) {
      // Held first-person swing — the weapon is posed in camera space, so it
      // mounts at the studio origin un-recentered and renders from the eye.
      mounted.root().add(built.group);
      draw = () => mounted!.renderHeldGrid(animN, FP_FOV, weaponAnim.poseAt);
    } else {
      // Static / turntable / mob telegraph — wrap so recentering doesn't fight
      // a telegraph's vertical bob (on built.group.position.y).
      const holder = new THREE.Group();
      holder.add(built.group);
      mounted.show(holder);
      draw = () => {
        if (animN > 0 && mobAnim) mounted!.renderPoseGrid(animN, az, el, mobAnim.poseAt);
        else if (gridN > 0) mounted!.renderTurntable(gridN, el);
        else mounted!.renderView(az, el);
      };
    }
    onResize(draw);
    titleChip(`${subject.label} · ${subject.kind} · ${subjectId}`);
    window.__bench = {
      ready: true,
      view: (a, e) => mounted!.renderView(a, e),
      turntable: (m, e) => mounted!.renderTurntable(m, e),
      anim: (m, e) => {
        if (weaponAnim) mounted!.renderHeldGrid(m, FP_FOV, weaponAnim.poseAt);
        else if (mobAnim) mounted!.renderPoseGrid(m, az, e, mobAnim.poseAt);
      },
      readout: () => computeReadout(subject, built),
      subjects: () => listSubjects().map((s) => s.id),
    };
  }
}

function unknown(id: string): void {
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#c66;font:14px monospace">unknown subject: ${id}</div>`);
}

// ── Picker ───────────────────────────────────────────────────────────
function renderPicker(): void {
  canvas.style.display = 'none';
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', overflowY: 'auto',
    background: '#0b0c0e', color: '#cdd2d8', font: '13px ui-monospace, monospace',
    padding: '14px',
  } as CSSStyleDeclaration);
  root.innerHTML = `<div style="letter-spacing:.25em;color:#6b7280;text-transform:uppercase;margin-bottom:10px">Delve · Asset Bench</div>`;
  for (const s of listSubjects()) {
    const link = document.createElement('a');
    link.href = `?subject=${encodeURIComponent(s.id)}`;
    link.textContent = `${s.label}  ·  ${s.id}`;
    Object.assign(link.style, {
      display: 'block', padding: '7px 4px', color: '#cdd2d8',
      textDecoration: 'none', borderBottom: '1px solid #16181c',
    } as CSSStyleDeclaration);
    root.appendChild(link);
  }
  document.body.appendChild(root);
}
